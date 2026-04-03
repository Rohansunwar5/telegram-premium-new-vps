import { chromium, Browser, BrowserContext, Download, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import config from '../config';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const BKPSCH_AUTH_FILE = path.resolve(
  PROJECT_ROOT,
  config.BKPSCH_AUTH_FILE_PATH || 'auth/bkpsch.auth.json',
);

export class BkpschAutomation {
  private static browser: Browser | null = null;
  private static readonly RESULT_WAIT_TIMEOUT_MS = 25000;

  private static normalizeLookupValue(value: string): string {
    return String(value || '')
      .trim()
      .replace(/^@+/, '')
      .toLowerCase();
  }

  private static messageMatchesQuery(text: string, normalizedQuery: string, queryIsNumeric: boolean): boolean {
    if (!normalizedQuery) return true;

    const normalizedText = String(text || '').toLowerCase();
    if (queryIsNumeric) {
      return new RegExp(`id\\s*:\\s*${normalizedQuery}\\b`, 'i').test(normalizedText);
    }

    const handleMatches = Array.from(normalizedText.matchAll(/@([a-z0-9_]{3,})/g)).map((match) => match[1]);
    if (handleMatches.includes(normalizedQuery)) {
      return true;
    }

    const usernameLine = normalizedText.match(/username\s*:\s*([^\n]+)/i)?.[1] || '';
    if (usernameLine.includes(normalizedQuery)) {
      return true;
    }

    const titleLine = normalizedText.match(/title\s*:\s*([^\n]+)/i)?.[1] || '';
    return titleLine.includes(normalizedQuery);
  }

  private static async waitForMessageStreamSettle(
    page: Page,
    baselineCount: number,
    timeoutMs = 6000,
    stableMs = 1000,
  ): Promise<void> {
    const startedAt = Date.now();
    let lastSignature = '';
    let stableForMs = 0;

    while (Date.now() - startedAt < timeoutMs) {
      const snapshot = await page.evaluate((baseline) => {
        const els = Array.from(document.querySelectorAll('.msg-text')).slice(Number(baseline));
        const count = els.length;
        const lastText = count > 0 ? ((els[count - 1].textContent || '').trim()) : '';
        return `${count}|${lastText}`;
      }, baselineCount);

      if (snapshot === lastSignature) {
        stableForMs += 200;
        if (stableForMs >= stableMs) {
          return;
        }
      } else {
        lastSignature = snapshot;
        stableForMs = 0;
      }

      await page.waitForTimeout(200);
    }
  }

  private static async sendChatMessage(page: Page, inputSelector: string, text: string) {
    const input = page.locator(inputSelector).first();
    await input.click();
    await input.fill(text);
    await input.press('Enter');
    await page.waitForTimeout(150);
  }

  static async initBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: config.BKPSCH_HEADLESS,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
        ],
      });
    }

    return this.browser;
  }

  static async createContext(): Promise<BrowserContext> {
    const browser = await this.initBrowser();
    const contextOptions: Parameters<Browser['newContext']>[0] = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };

    if (fs.existsSync(BKPSCH_AUTH_FILE)) {
      contextOptions.storageState = BKPSCH_AUTH_FILE;
    }

    return browser.newContext(contextOptions);
  }

  static async executeChatFlow(
    query: string,
  ): Promise<{ result: string; csvData: string | null; timestamp: string; profileText: string | null; extractedTitle?: string }> {
    const context = await this.createContext();
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

          csvData = Buffer.concat(chunks).toString('utf-8');
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
      const normalizedQuery = this.normalizeLookupValue(query);
      const queryIsNumeric = /^\d+$/.test(normalizedQuery);

      await this.sendChatMessage(page, inputSelector, '/info');
      await this.sendChatMessage(page, inputSelector, query);

      try {
        await page.waitForFunction(
          (args: { baseline: number; normalized: string; isNumeric: boolean }) => {
            const els = Array.from(document.querySelectorAll('.msg-text')).slice(Number(args.baseline));
            return els.some((el) => {
              const txt = (el.textContent || '').toLowerCase();
              const hasProfile = /id\s*:\s*\d+/i.test(txt) && (/username\s*:/i.test(txt) || /title\s*:/i.test(txt));
              if (!hasProfile) return false;

              if (!args.normalized) return true;
              if (args.isNumeric) {
                return new RegExp(`id\\s*:\\s*${args.normalized}\\b`, 'i').test(txt);
              }

              const handles = Array.from(txt.matchAll(/@([a-z0-9_]{3,})/g)).map((match) => match[1]);
              if (handles.includes(args.normalized)) return true;

              const usernameLine = txt.match(/username\s*:\s*([^\n]+)/i)?.[1] || '';
              if (usernameLine.includes(args.normalized)) return true;

              const titleLine = txt.match(/title\s*:\s*([^\n]+)/i)?.[1] || '';
              return titleLine.includes(args.normalized);
            });
          },
          {
            baseline: baselineMessageCount,
            normalized: normalizedQuery,
            isNumeric: queryIsNumeric,
          },
          { timeout: this.RESULT_WAIT_TIMEOUT_MS },
        );
      } catch {
        // Continue flow if profile card is not detected in time.
      }

      const preActionMessages = await page.$$('.msg-text');
      for (let i = preActionMessages.length - 1; i >= baselineMessageCount; i--) {
        const text = await preActionMessages[i].innerText();
        if (/id\s*:\s*\d+/i.test(text)
          && (/username\s*:/i.test(text) || /title\s*:/i.test(text))
          && this.messageMatchesQuery(text, normalizedQuery, queryIsNumeric)) {
          profileText = text;
          break;
        }
      }

      try {
        await page.waitForFunction(
          () =>
            Array.from(document.querySelectorAll('a')).some((el) =>
              el.textContent?.includes('What groups is the user a member of'),
            ),
          { timeout: 10000 },
        );
        const groupsLink = page
          .locator('a')
          .filter({ hasText: /What groups is the user a member of/i })
          .last();
        await groupsLink.click();
        await page.waitForTimeout(150);
      } catch {
        // Continue flow if optional UI action is absent.
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
        // Continue flow if optional UI action is absent.
      }

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
        // Continue with best effort extraction.
      }

      await this.waitForMessageStreamSettle(page, baselineMessageCount);

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

            csvData = Buffer.concat(chunks).toString('utf-8');
          }
        } catch {
          csvData = null;
        }
      }

      // Extract title from profileText (supports any language)
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

  static async executeNearbyFlow(
    query: string,
  ): Promise<{ result: string; csvData: string | null; timestamp: string; profileText: string | null; extractedTitle?: string }> {
    const context = await this.createContext();
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

          csvData = Buffer.concat(chunks).toString('utf-8');
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
      const normalizedQuery = this.normalizeLookupValue(query);
      const queryIsNumeric = /^\d+$/.test(normalizedQuery);

      await this.sendChatMessage(page, inputSelector, '/info');
      await this.sendChatMessage(page, inputSelector, query);

      try {
        await page.waitForFunction(
          (args: { baseline: number; normalized: string; isNumeric: boolean }) => {
            const els = Array.from(document.querySelectorAll('.msg-text')).slice(Number(args.baseline));
            return els.some((el) => {
              const txt = (el.textContent || '').toLowerCase();
              const hasProfile = /id\s*:\s*\d+/i.test(txt) && (/username\s*:/i.test(txt) || /title\s*:/i.test(txt));
              if (!hasProfile) return false;

              if (!args.normalized) return true;
              if (args.isNumeric) {
                return new RegExp(`id\\s*:\\s*${args.normalized}\\b`, 'i').test(txt);
              }

              const handles = Array.from(txt.matchAll(/@([a-z0-9_]{3,})/g)).map((match) => match[1]);
              if (handles.includes(args.normalized)) return true;

              const usernameLine = txt.match(/username\s*:\s*([^\n]+)/i)?.[1] || '';
              if (usernameLine.includes(args.normalized)) return true;

              const titleLine = txt.match(/title\s*:\s*([^\n]+)/i)?.[1] || '';
              return titleLine.includes(args.normalized);
            });
          },
          {
            baseline: baselineMessageCount,
            normalized: normalizedQuery,
            isNumeric: queryIsNumeric,
          },
          { timeout: this.RESULT_WAIT_TIMEOUT_MS },
        );
      } catch {
        // Continue flow if profile card is not detected in time.
      }

      const preActionMessages = await page.$$('.msg-text');
      for (let i = preActionMessages.length - 1; i >= baselineMessageCount; i--) {
        const text = await preActionMessages[i].innerText();
        if (/id\s*:\s*\d+/i.test(text)
          && (/username\s*:/i.test(text) || /title\s*:/i.test(text))
          && this.messageMatchesQuery(text, normalizedQuery, queryIsNumeric)) {
          profileText = text;
          break;
        }
      }

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
        // Continue flow if optional UI action is absent.
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
        // Continue flow if optional UI action is absent.
      }

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
        // Continue with best effort extraction.
      }

      await this.waitForMessageStreamSettle(page, baselineMessageCount);

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

            csvData = Buffer.concat(chunks).toString('utf-8');
          }
        } catch {
          csvData = null;
        }
      }

      // Extract title from profileText (supports any language)
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

  static async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
