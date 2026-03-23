import { chromium } from 'playwright';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import config from '../config';

const BKPSCH_AUTH_FILE = path.resolve(
  process.cwd(),
  config.BKPSCH_AUTH_FILE_PATH || 'auth/bkpsch.auth.json',
);
const BKPSCH_AUTH_DIR = path.dirname(BKPSCH_AUTH_FILE);
const BKPSCH_CHROME_DATA_DIR = path.resolve(
  process.cwd(),
  config.BKPSCH_CHROME_DATA_DIR || 'auth/bkpsch.chrome_data',
);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function runBkpschManualLogin() {
  if (!fs.existsSync(BKPSCH_AUTH_DIR)) {
    fs.mkdirSync(BKPSCH_AUTH_DIR, { recursive: true });
  }

  let context;
  let page;

  try {
    context = await chromium.launchPersistentContext(BKPSCH_CHROME_DATA_DIR, {
      headless: false,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: null,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--start-maximized',
        '--no-sandbox',
        '--disable-infobars',
      ],
    });

    page =
      context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    await page.goto(config.BKPSCH_TARGET_URL);
  } catch (error) {
    console.error('Failed to initialize BKPSCH login browser.', error);
    rl.close();
    return;
  }

  return new Promise<void>((resolve) => {
    rl.question(
      '\nPress Enter after successful manual login...\n',
      async () => {
        try {
          await context.storageState({ path: BKPSCH_AUTH_FILE });
          console.log(`BKPSCH auth state saved: ${BKPSCH_AUTH_FILE}`);
        } catch (error) {
          console.error('Failed to save BKPSCH auth state.', error);
        } finally {
          await context.close();
          rl.close();
          resolve();
        }
      },
    );
  });
}

runBkpschManualLogin().catch((error) => {
  console.error('Fatal BKPSCH login error:', error);
  process.exit(1);
});
