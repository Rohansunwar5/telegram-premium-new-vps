import { BkpschAutomation } from './automation/bkpsch.automation';

process.on('SIGINT', async () => {
  await BkpschAutomation.closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await BkpschAutomation.closeBrowser();
  process.exit(0);
});
