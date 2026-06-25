// clear-failed-jobs.ts
// Run this to clear failed jobs and retry them

import { scrapeQueue, alertQueue } from '../src/config/redis';

async function cleanQueues() {
  try {
    console.log('🧹 Cleaning failed jobs...\n');

    // Get failed jobs
    const failedScrapeJobs = await scrapeQueue.getJobs(['failed']);
    const failedAlertJobs = await alertQueue.getJobs(['failed']);

    console.log(`Found ${failedScrapeJobs.length} failed scrape jobs`);
    console.log(`Found ${failedAlertJobs.length} failed alert jobs\n`);

    // Show failed job details
    for (const job of failedScrapeJobs) {
      console.log(`Failed Job ${job.id}:`);
      console.log('  Data:', job.data);
      console.log('  Error:', job.failedReason);
      console.log(
        '  Failed at:',
        job.finishedOn !== undefined
          ? new Date(job.finishedOn).toISOString()
          : 'N/A'
      );

      // Retry the job
      console.log('  🔄 Retrying job...');
      await job.retry();
    }

    // Clean completed jobs older than 1 hour
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    await scrapeQueue.clean(oneHourAgo, 'completed');
    await scrapeQueue.clean(oneHourAgo, 'failed');

    console.log('\n✅ Queues cleaned');

    // Check current status
    const scrapeWaiting = await scrapeQueue.getWaitingCount();
    const scrapeDelayed = await scrapeQueue.getDelayedCount();
    const scrapeActive = await scrapeQueue.getActiveCount();

    console.log('\n📊 Current Queue Status:');
    console.log(`Scrape Queue - Waiting: ${scrapeWaiting}, Delayed: ${scrapeDelayed}, Active: ${scrapeActive}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await scrapeQueue.close();
    await alertQueue.close();
    process.exit(0);
  }
}

cleanQueues();