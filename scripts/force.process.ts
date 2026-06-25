// force-process.ts
// Force process waiting jobs

import BookmarkService from '../src/services/bookmark.service';
import { BookmarkRepository } from '../src/repository/bookmark.repository';
import { S3Service } from '../src/services/s3.service';
import { ChannelService } from '../src/services/channel.service';
import { UserRepository } from '../src/repository/user.repository';
import { scrapeQueue } from '../src/config/redis';

async function forceProcess() {
  try {
    console.log('🔧 Force processing jobs...\n');

    // Resume queue if paused
    const isPaused = await scrapeQueue.isPaused();
    if (isPaused) {
      console.log('▶️ Queue is paused, resuming...');
      await scrapeQueue.resume();
    }

    // Get waiting jobs
    const waitingJobs = await scrapeQueue.getJobs(['waiting']);
    console.log(`Found ${waitingJobs.length} waiting jobs\n`);

    if (waitingJobs.length === 0) {
      console.log('No jobs to process');
      process.exit(0);
    }

    // Initialize services
    const bookmarkRepository = new BookmarkRepository();
    const s3Service = new S3Service();
    const channelService = new ChannelService();
    const userRepository = new UserRepository();
    const bookmarkService = new BookmarkService(bookmarkRepository, s3Service, channelService, userRepository);

    // Register processor
    console.log('📝 Registering processor...');
    scrapeQueue.process('scrape-channel', async (job) => {
      console.log(`\n🔄 Processing job ${job.id}:`, job.data);

      try {
        const { bookmarkId, channelId, channelName } = job.data;

        console.log(`  Calling Flask API for channel: ${channelName}`);
        const result = await bookmarkService.processScrapeJob(bookmarkId, channelId, channelName);

        console.log(`✅ Job ${job.id} completed successfully`);
        return result;
      } catch (error: any) {
        console.error(`❌ Job ${job.id} failed:`, error.message);
        throw error;
      }
    });

    console.log('⏳ Waiting for jobs to process...');
    console.log('Press Ctrl+C to stop\n');

    // Keep process alive
    setInterval(() => {
      scrapeQueue.getWaitingCount().then(count => {
        if (count > 0) {
          console.log(`Still ${count} jobs waiting...`);
        }
      });
    }, 5000);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n👋 Shutting down...');
  await scrapeQueue.close();
  process.exit(0);
});

forceProcess();