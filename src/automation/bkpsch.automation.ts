import { Download, Page } from 'playwright';
import config from '../config';
import { createContext, sendChatMessage, waitForMessageStreamSettle, closeBrowser } from './utils/browser.utils';
import { normalizeLookupValue, messageMatchesQuery } from './utils/validation.utils';
import { Mutex } from '../utils/mutex';

export class BkpschAutomation {
  private static readonly RESULT_WAIT_TIMEOUT_MS = 60000;
  private static readonly mutex = new Mutex();

  /**
   * Main entry flow for executing generalized chat automation, searching for a user/channel/info target.
   * Leverages exact matcher scripts to inherently skip empty or incorrect target results seamlessly.
   * Ensures the query we searched matches the EXACT title/username produced by the bot.
   * @param query Target username or ID to lookup against.
   * @returns Resolves a destructured object containing scraped content like .csvData, timestamp, extractedTitle, etc.
   */
  static async executeChatFlow(
    query: string,
  ): Promise<{ result: string; csvData: string | null; timestamp: string; profileText: string | null; extractedTitle?: string }> {
    const context = await createContext();
    const page: Page = await context.newPage();
    let csvData: string | null = null;
    let profileText: string | null = null;

    page.setDefaultTimeout(config.BKPSCH_TIMEOUT_NAVIGATION);

    try {
      page.on('download', async (download: Download) => {
        try {
          const stream = await download.createReadStream();
          const chunks: Buffer[] = [];

          await new Promise<void>((resolve, reject) => {
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', resolve);
            stream.on('error', reject);
          });

          csvData = Buffer.concat(chunks as any).toString('utf-8');
        } catch {
          csvData = null;
        }
      });

      await page.goto(config.BKPSCH_TARGET_URL, { waitUntil: 'domcontentloaded' });

      // Identify bot input form and wait for readiness
      const inputSelector = '#user-input';
      await page.waitForSelector(inputSelector, {
        timeout: config.BKPSCH_TIMEOUT_SELECTOR,
      });

      const baselineMessageCount = await page.locator('.msg-text').count();
      const normalizedQuery = normalizeLookupValue(query);
      const queryIsNumeric = /^\d+$/.test(normalizedQuery);

      // Send /info <query> as a single message to skip the bot's intermediate prompt
      await sendChatMessage(page, inputSelector, `/info ${query}`);

      // Wait for the bot to return a matching profile OR explicit no-results.
      // Check ALL new messages (not just last) — profile card and action buttons are separate elements.
      try {
        await page.waitForFunction(
          (args: { baseline: number; normalized: string; isNumeric: boolean }) => {
            const els = Array.from(document.querySelectorAll('.msg-text')).slice(Number(args.baseline));
            if (!els.length) return false;

            // Check for explicit no-results in any new message
            if (els.some((el) => {
              const t = (el.textContent || '').toLowerCase();
              return t.includes('there are no results for this search') || t.includes('no results found');
            })) return true;

            // Find the profile card message
            return els.some((el) => {
              const txt = (el.textContent || '').toLowerCase();
              if (!/id\s*:\s*\d+/i.test(txt)) return false;
              if (!args.normalized) return true;
              if (args.isNumeric) {
                return new RegExp(`(?:^|\\s)id\\s*:\\s*${args.normalized}\\b`, 'i').test(txt);
              }
              const handles = Array.from(txt.matchAll(/@([a-z0-9_]{3,})/g)).map((m) => m[1]);
              if (handles.includes(args.normalized)) return true;
              const usernameLine = txt.match(/username\s*:\s*([^\n]+)/i)?.[1]?.trim() || '';
              if (usernameLine === args.normalized || usernameLine.replace(/^@/, '') === args.normalized) return true;
              const titleLine = txt.match(/title\s*:\s*([^\n]+)/i)?.[1]?.trim() || '';
              return titleLine === args.normalized;
            });
          },
          { baseline: baselineMessageCount, normalized: normalizedQuery, isNumeric: queryIsNumeric },
          { timeout: this.RESULT_WAIT_TIMEOUT_MS },
        );
      } catch {
        // Timeout — proceed to re-verify loop
      }

      // Scroll to bottom to ensure latest messages are rendered
      await page.evaluate(() => {
        const scrollable = document.querySelector('.MessageList') || document.querySelector('.scrollable') || document.querySelector('.chat-list') || document.documentElement;
        if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
      });
      await page.waitForTimeout(300);

      // Re-verify: scan newest-first, stop at first profile or no-results
      const finalMessages = await page.$$('.msg-text');
      for (let i = finalMessages.length - 1; i >= baselineMessageCount; i--) {
        const text = await finalMessages[i].innerText();
        const lowText = text.toLowerCase();
        if (lowText.includes('there are no results for this search') || lowText.includes('no results found')) {
          throw new Error('TGDB_NO_RESULTS');
        }
        if (/id\s*:\s*\d+/i.test(text) && messageMatchesQuery(text, normalizedQuery, queryIsNumeric)) {
          profileText = text;
          break;
        }
      }

      if (!profileText) throw new Error('TARGET_NOT_FOUND');

      // Wait for the groups link to appear — it renders in the same message block as the profile
      // Use a fresh message count so we only look at messages from the profile card onward
      const afterProfileCount = await page.locator('.msg-text').count();
      try {
        await page.waitForFunction(
          (baseline) =>
            Array.from(document.querySelectorAll('.msg-text')).slice(Number(baseline)).some((el) =>
              (el.textContent || '').includes('What groups is the user a member of'),
            ),
          Math.max(afterProfileCount - 3, baselineMessageCount),
          { timeout: 12000 },
        );
        const groupsLink = page
          .locator('a, button, [role="button"]')
          .filter({ hasText: /What groups is the user a member of/i })
          .last();
        await groupsLink.scrollIntoViewIfNeeded();
        await groupsLink.click({ force: true });
        await page.waitForTimeout(500);
      } catch {
        // Link not present, skip
      }

      // Handle intermediate bot warnings if generated
      try {
        await page.waitForFunction(
          () =>
            Array.from(
              document.querySelectorAll("button, .btn, [role='button'], a"),
            ).some((el) =>
              el.textContent?.toLowerCase().includes('click here to continue'),
            ),
          { timeout: 10000 },
        );
        const continueBtn = page
          .locator("button, .btn, [role='button'], a")
          .filter({ hasText: /click here to continue/i })
          .last();
        await continueBtn.click();
        await page.waitForTimeout(150);
      } catch {
        // Optional button absent, skip cleanly
      }

      // Extract block where IDs are rendered
      try {
        await page.waitForFunction(
          (baseline) => {
            const els = Array.from(document.querySelectorAll('.msg-text')).slice(Number(baseline));
            return els.some((el) => el.textContent?.includes('#IDS'));
          },
          baselineMessageCount,
          { timeout: this.RESULT_WAIT_TIMEOUT_MS },
        );
      } catch {
        // Aborts wait but still relies on stream settle fallback
      }

      // Let stream finish before scraping lists entirely
      await waitForMessageStreamSettle(page, baselineMessageCount);
      const messageElements = await page.$$('.msg-text');
      let resultText = '';

      for (let i = messageElements.length - 1; i >= baselineMessageCount; i--) {
        const text = await messageElements[i].innerText();
        if (text.includes('#IDS')) {
          resultText = text;
          break;
        }
      }

      // If missing generic markers, guess fallback
      if (!resultText) {
        for (let i = messageElements.length - 1; i >= baselineMessageCount; i--) {
          const text = await messageElements[i].innerText();
          if (text.trim()) {
            resultText = text;
            break;
          }
        }
      }

      // Handle raw buffer writes locally over downloads triggering
      if (!csvData) {
        try {
          const csvLink = await page.$("a[href*='.csv'], a[download]");
          if (csvLink) {
            const [download] = await Promise.all([
              page.waitForEvent('download', { timeout: 8000 }),
              csvLink.click(),
            ]);
            const stream = await download.createReadStream();
            const chunks: Buffer[] = [];

            await new Promise<void>((resolve, reject) => {
              stream.on('data', (chunk: Buffer) => chunks.push(chunk));
              stream.on('end', resolve);
              stream.on('error', reject);
            });

            csvData = Buffer.concat(chunks as any).toString('utf-8');
          }
        } catch {
          csvData = null;
        }
      }

      // Secure Title parsing explicitly via Regex bindings
      const titleMatch = profileText ? profileText.match(/title:\s*([^\n]+)/i) : null;
      const extractedTitle = titleMatch ? titleMatch[1].trim() : undefined;

      return {
        result: resultText,
        csvData,
        timestamp: new Date().toISOString(),
        profileText,
        extractedTitle,
      };
    } catch (error: unknown) {
      if (page.url().includes('login') || page.url().includes('auth')) {
        throw new Error('SESSION_EXPIRED');
      }
      throw error;
    } finally {
      await page.close();
      await context.close();
    }
  }

  /**
   * Automation Flow for requesting lists of strictly Nearby Users within close geographical proximity.
   * Matches string query rigorously using the exact equality validator check, ignoring 'no results'.
   * @param query The targeted string query explicitly verifying boundaries.
   * @returns Raw results output string alongside related .csv buffered payload.
   */
  static async executeNearbyFlow(
    query: string,
  ): Promise<{ result: string; csvData: string | null; timestamp: string; profileText: string | null; extractedTitle?: string }> {
    const context = await createContext();
    const page: Page = await context.newPage();
    let csvData: string | null = null;
    let profileText: string | null = null;

    page.setDefaultTimeout(config.BKPSCH_TIMEOUT_NAVIGATION);

    try {
      page.on('download', async (download: Download) => {
        try {
          const stream = await download.createReadStream();
          const chunks: Buffer[] = [];

          await new Promise<void>((resolve, reject) => {
            stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.on('end', resolve);
            stream.on('error', reject);
          });

          csvData = Buffer.concat(chunks as any).toString('utf-8');
        } catch {
          csvData = null;
        }
      });

      await page.goto(config.BKPSCH_TARGET_URL, { waitUntil: 'domcontentloaded' });

      const inputSelector = '#user-input';
      await page.waitForSelector(inputSelector, {
        timeout: config.BKPSCH_TIMEOUT_SELECTOR,
      });

      const baselineMessageCount = await page.locator('.msg-text').count();
      const normalizedQuery = normalizeLookupValue(query);
      const queryIsNumeric = /^\d+$/.test(normalizedQuery);

      // Send /info <query> as a single message to skip the bot's intermediate prompt
      await sendChatMessage(page, inputSelector, `/info ${query}`);

      // Wait for the bot to return a matching profile OR explicit no-results
      try {
        await page.waitForFunction(
          (args: { baseline: number; normalized: string; isNumeric: boolean }) => {
            const els = Array.from(document.querySelectorAll('.msg-text')).slice(Number(args.baseline));
            if (!els.length) return false;
            if (els.some((el) => {
              const t = (el.textContent || '').toLowerCase();
              return t.includes('there are no results for this search') || t.includes('no results found');
            })) return true;
            return els.some((el) => {
              const txt = (el.textContent || '').toLowerCase();
              if (!/id\s*:\s*\d+/i.test(txt)) return false;
              if (!args.normalized) return true;
              if (args.isNumeric) {
                return new RegExp(`(?:^|\\s)id\\s*:\\s*${args.normalized}\\b`, 'i').test(txt);
              }
              const handles = Array.from(txt.matchAll(/@([a-z0-9_]{3,})/g)).map((m) => m[1]);
              if (handles.includes(args.normalized)) return true;
              const usernameLine = txt.match(/username\s*:\s*([^\n]+)/i)?.[1]?.trim() || '';
              if (usernameLine === args.normalized || usernameLine.replace(/^@/, '') === args.normalized) return true;
              const titleLine = txt.match(/title\s*:\s*([^\n]+)/i)?.[1]?.trim() || '';
              return titleLine === args.normalized;
            });
          },
          { baseline: baselineMessageCount, normalized: normalizedQuery, isNumeric: queryIsNumeric },
          { timeout: this.RESULT_WAIT_TIMEOUT_MS },
        );
      } catch {
        // Timeout — proceed to re-verify
      }

      // Scroll to bottom to ensure latest messages are rendered
      await page.evaluate(() => {
        const scrollable = document.querySelector('.MessageList') || document.querySelector('.scrollable') || document.querySelector('.chat-list') || document.documentElement;
        if (scrollable) scrollable.scrollTop = scrollable.scrollHeight;
      });
      await page.waitForTimeout(300);

      // Re-verify: scan newest-first, stop at first profile or no-results
      const finalMessages = await page.$$('.msg-text');
      for (let i = finalMessages.length - 1; i >= baselineMessageCount; i--) {
        const text = await finalMessages[i].innerText();
        const lowText = text.toLowerCase();
        if (lowText.includes('there are no results for this search') || lowText.includes('no results found')) {
          throw new Error('TGDB_NO_RESULTS');
        }
        if (/id\s*:\s*\d+/i.test(text) && messageMatchesQuery(text, normalizedQuery, queryIsNumeric)) {
          profileText = text;
          break;
        }
      }

      if (!profileText) throw new Error('TARGET_NOT_FOUND');

      // Target Nearby Users specific flow button rendering clicks
      try {
        await page.waitForFunction(
          () =>
            Array.from(document.querySelectorAll('a')).some((el) =>
              el.textContent?.includes('Who are the nearby users'),
            ),
          { timeout: 10000 },
        );
        const groupsLink = page
          .locator('a')
          .filter({ hasText: /Who are the nearby users/i })
          .last();
        await groupsLink.click();
        await page.waitForTimeout(150);
      } catch {
        // Fallback for link omissions
      }

      try {
        await page.waitForFunction(
          () =>
            Array.from(
              document.querySelectorAll("button, .btn, [role='button'], a"),
            ).some((el) =>
              el.textContent?.toLowerCase().includes('click here to continue'),
            ),
          { timeout: 10000 },
        );
        const continueBtn = page
          .locator("button, .btn, [role='button'], a")
          .filter({ hasText: /click here to continue/i })
          .last();
        await continueBtn.click();
        await page.waitForTimeout(150);
      } catch {
        // Fallback omissions handles logic
      }

      // Collect IDS result structure
      try {
        await page.waitForFunction(
          (baseline) => {
            const els = Array.from(document.querySelectorAll('.msg-text')).slice(Number(baseline));
            return els.some((el) => el.textContent?.includes('#IDS'));
          },
          baselineMessageCount,
          { timeout: this.RESULT_WAIT_TIMEOUT_MS },
        );
      } catch {
        // Best effort
      }

      await waitForMessageStreamSettle(page, baselineMessageCount);
      const messageElements = await page.$$('.msg-text');
      let resultText = '';

      for (let i = messageElements.length - 1; i >= baselineMessageCount; i--) {
        const text = await messageElements[i].innerText();
        if (text.includes('#IDS')) {
          resultText = text;
          break;
        }
      }

      if (!resultText) {
        for (let i = messageElements.length - 1; i >= baselineMessageCount; i--) {
          const text = await messageElements[i].innerText();
          if (text.trim()) {
            resultText = text;
            break;
          }
        }
      }

      if (!csvData) {
        try {
          const csvLink = await page.$("a[href*='.csv'], a[download]");
          if (csvLink) {
            const [download] = await Promise.all([
              page.waitForEvent('download', { timeout: 8000 }),
              csvLink.click(),
            ]);
            const stream = await download.createReadStream();
            const chunks: Buffer[] = [];

            await new Promise<void>((resolve, reject) => {
              stream.on('data', (chunk: Buffer) => chunks.push(chunk));
              stream.on('end', resolve);
              stream.on('error', reject);
            });

            csvData = Buffer.concat(chunks as any).toString('utf-8');
          }
        } catch {
          csvData = null;
        }
      }

      const titleMatch = profileText ? profileText.match(/title:\s*([^\n]+)/i) : null;
      const extractedTitle = titleMatch ? titleMatch[1].trim() : undefined;

      return {
        result: resultText,
        csvData,
        timestamp: new Date().toISOString(),
        profileText,
        extractedTitle,
      };
    } catch (error: unknown) {
      if (page.url().includes('login') || page.url().includes('auth')) {
        throw new Error('SESSION_EXPIRED');
      }
      throw error;
    } finally {
      await page.close();
      await context.close();
    }
  }

  /**
   * Helper that acts as a secure facade linking server instances seamlessly, cleanly terminating idle process rams implicitly.
   */
  static async closeBrowser() {
    await closeBrowser();
  }
}
