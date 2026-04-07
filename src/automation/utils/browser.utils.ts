import { Browser, BrowserContext, chromium, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import config from '../../config';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const BKPSCH_AUTH_FILE = path.resolve(
  PROJECT_ROOT,
  config.BKPSCH_AUTH_FILE_PATH || 'auth/bkpsch.auth.json',
);

let browserInstance: Browser | null = null;

/**
 * Initializes the persistent Chromium browser instance for scraping.
 * Implements headless logic based on environment variables and sandboxing protections.
 * @returns A loaded instance of Playwright Browser.
 */
export async function initBrowser(): Promise<Browser> {
  if (!browserInstance) {
    browserInstance = await chromium.launch({
      headless: config.BKPSCH_HEADLESS,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
    });
  }
  return browserInstance;
}

/**
 * Spawns a fresh Page context ensuring session authentication (state files) are provided.
 * Context handles sessions so repeating requests do not ask for SMS re-verification.
 * @returns An initialized browser context.
 */
export async function createContext(): Promise<BrowserContext> {
  const browser = await initBrowser();
  const contextOptions: Parameters<Browser['newContext']>[0] = {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };

  // Attempt attaching saved auth tokens to bypass logging in
  if (fs.existsSync(BKPSCH_AUTH_FILE)) {
    contextOptions.storageState = BKPSCH_AUTH_FILE;
  }

  return browser.newContext(contextOptions);
}

/**
 * Cleanly closes the instance if active to release ram manually.
 */
export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

/**
 * Simulates chat input actions directly bypassing explicit user interaction bugs.
 * Fills input fields and presses enter rapidly.
 * @param page The playwright page running the task.
 * @param inputSelector The CSS selector for our input.
 * @param text The exact command/search value string.
 */
export async function sendChatMessage(page: Page, inputSelector: string, text: string) {
  const input = page.locator(inputSelector).first();
  await input.click();
  await input.fill(text);
  await input.press('Enter');
  await page.waitForTimeout(150);
}

/**
 * Evaluates the DOM natively in Playwright, watching the text blocks count and updates.
 * Resolves only when the newly polled text streams stabilize (e.g. no new texts appended or altered).
 * @param page The scraping playwright page.
 * @param baselineCount Baseline target array offset to evaluate skipping previous queries.
 * @param timeoutMs The maximum allowable stall time before resolving manually.
 * @param stableMs Milliseconds required for DOM to be entirely stagnant.
 */
export async function waitForMessageStreamSettle(
  page: Page,
  baselineCount: number,
  timeoutMs = 6000,
  stableMs = 1000,
): Promise<void> {
  const startedAt = Date.now();
  let lastSignature = '';
  let stableForMs = 0;

  while (Date.now() - startedAt < timeoutMs) {
    // Force scroll to the bottom of the chat to trigger lazy rendering
    await page.evaluate(() => {
      const scrollable = document.querySelector('.MessageList') || document.querySelector('.scrollable') || document.querySelector('.chat-list') || document.documentElement;
      if (scrollable) {
        scrollable.scrollTop = scrollable.scrollHeight;
      }
    });

    const snapshot = await page.evaluate((baseline) => {
      const els = Array.from(document.querySelectorAll('.msg-text')).slice(Number(baseline));
      const count = els.length;
      const lastText = count > 0 ? ((els[count - 1].textContent || '').trim()) : '';
      return `${count}|${lastText}`;
    }, baselineCount);

    if (snapshot === lastSignature) {
      stableForMs += 200;
      if (stableForMs >= stableMs) {
        return; // stream settled, safely read.
      }
    } else {
      lastSignature = snapshot;
      stableForMs = 0;
    }

    await page.waitForTimeout(200);
  }
}
