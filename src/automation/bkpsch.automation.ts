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
  ): Promise<{ result: string; csvData: string | null; timestamp: string; profileText: string | null }> {
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

      await page.fill(inputSelector, '/start');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);

      await page.fill(inputSelector, '/info');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);

      await page.fill(inputSelector, query);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);

      try {
        await page.waitForFunction(
          () => {
            const els = document.querySelectorAll('.msg-text');
            return Array.from(els).some((el) => {
              const txt = el.textContent || '';
              return /id\s*:\s*\d+/i.test(txt) && (/username\s*:/i.test(txt) || /title\s*:/i.test(txt));
            });
          },
          { timeout: 10000 },
        );
      } catch {
        // Continue flow if profile card is not detected in time.
      }

      const preActionMessages = await page.$$('.msg-text');
      for (let i = preActionMessages.length - 1; i >= 0; i--) {
        const text = await preActionMessages[i].innerText();
        if (/id\s*:\s*\d+/i.test(text) && (/username\s*:/i.test(text) || /title\s*:/i.test(text))) {
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
        await page.waitForTimeout(3000);
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
        await page.waitForTimeout(3000);
      } catch {
        // Continue flow if optional UI action is absent.
      }

      try {
        await page.waitForFunction(
          () => {
            const els = document.querySelectorAll('.msg-text');
            return Array.from(els).some((el) => el.textContent?.includes('#IDS'));
          },
          { timeout: 20000 },
        );
      } catch {
        // Continue with best effort extraction.
      }

      await page.waitForTimeout(4000);

      const messageElements = await page.$$('.msg-text');
      let resultText = '';

      for (let i = messageElements.length - 1; i >= 0; i--) {
        const text = await messageElements[i].innerText();
        if (text.includes('#IDS')) {
          resultText = text;
          break;
        }
      }

      if (!resultText) {
        for (let i = messageElements.length - 1; i >= 0; i--) {
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

      return {
        result: resultText,
        csvData,
        timestamp: new Date().toISOString(),
        profileText,
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
  ): Promise<{ result: string; csvData: string | null; timestamp: string; profileText: string | null }> {
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

      await page.fill(inputSelector, '/start');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);

      await page.fill(inputSelector, '/info');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);

      await page.fill(inputSelector, query);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(3000);

      try {
        await page.waitForFunction(
          () => {
            const els = document.querySelectorAll('.msg-text');
            return Array.from(els).some((el) => {
              const txt = el.textContent || '';
              return /id\s*:\s*\d+/i.test(txt) && (/username\s*:/i.test(txt) || /title\s*:/i.test(txt));
            });
          },
          { timeout: 10000 },
        );
      } catch {
        // Continue flow if profile card is not detected in time.
      }

      const preActionMessages = await page.$$('.msg-text');
      for (let i = preActionMessages.length - 1; i >= 0; i--) {
        const text = await preActionMessages[i].innerText();
        if (/id\s*:\s*\d+/i.test(text) && (/username\s*:/i.test(text) || /title\s*:/i.test(text))) {
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
        await page.waitForTimeout(3000);
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
        await page.waitForTimeout(3000);
      } catch {
        // Continue flow if optional UI action is absent.
      }

      try {
        await page.waitForFunction(
          () => {
            const els = document.querySelectorAll('.msg-text');
            return Array.from(els).some((el) => el.textContent?.includes('#IDS'));
          },
          { timeout: 20000 },
        );
      } catch {
        // Continue with best effort extraction.
      }

      await page.waitForTimeout(4000);

      const messageElements = await page.$$('.msg-text');
      let resultText = '';

      for (let i = messageElements.length - 1; i >= 0; i--) {
        const text = await messageElements[i].innerText();
        if (text.includes('#IDS')) {
          resultText = text;
          break;
        }
      }

      if (!resultText) {
        for (let i = messageElements.length - 1; i >= 0; i--) {
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

      return {
        result: resultText,
        csvData,
        timestamp: new Date().toISOString(),
        profileText,
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
