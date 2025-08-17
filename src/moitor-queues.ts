// scripts/monitor-queues.ts
// Run with: npx ts-node scripts/monitor-queues.ts

import Bull from 'bull';
import mongoose from 'mongoose';
import config from './config';

const scrapeQueue = new Bull('scrape-queue', {
  redis: {
    host: config.REDIS_HOST || 'redis-13142.c62.us-east-1-4.ec2.redns.redis-cloud.com',
    port: Number(config.REDIS_PORT) || 13142,
    password: config.REDIS_PASSWORD || 'Hie2Ze4t6SYBnozINBsJS2yeWWuURTz6'
  }
});

const alertQueue = new Bull('alert-queue', {
  redis: {
    host: config.REDIS_HOST || 'redis-13142.c62.us-east-1-4.ec2.redns.redis-cloud.com',
    port: Number(config.REDIS_PORT) || 13142,
    password: config.REDIS_PASSWORD || 'Hie2Ze4t6SYBnozINBsJS2yeWWuURTz6'
  }
});

async function formatJobDetails(job: any, queueName: string) {
  const details: any = {
    id: job.id,
    name: job.name,
    data: job.data,
    attemptsMade: job.attemptsMade,
    createdAt: new Date(job.timestamp).toLocaleString()
  };

  if (job.opts.delay) {
    const processAt = new Date(job.timestamp + job.opts.delay);
    details.scheduledFor = processAt.toLocaleString();
    details.timeUntilProcess = formatTimeDiff(processAt.getTime() - Date.now());
  }

  if (job.opts.repeat) {
    details.repeat = {
      cron: job.opts.repeat.cron,
      tz: job.opts.repeat.tz,
      nextRun: job.opts.repeat.next ? new Date(job.opts.repeat.next).toLocaleString() : 'N/A'
    };
  }

  if (job.finishedOn) {
    details.completedAt = new Date(job.finishedOn).toLocaleString();
  }

  if (job.failedReason) {
    details.failedReason = job.failedReason;
  }

  return details;
}

function formatTimeDiff(ms: number): string {
  if (ms < 0) return 'Overdue';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

async function getBookmarkInfo(bookmarkId: string) {
  try {
    // Connect to MongoDB if not connected
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(config.MONGO_URI || 'mongodb://localhost:27017/darkmap');
    }

    const Bookmark = mongoose.model('Bookmark');
    const bookmark = await Bookmark.findById(bookmarkId);
    
    if (bookmark) {
      return {
        channelName: bookmark.channelName,
        alertTime: bookmark.alertTime,
        alertDays: bookmark.alertDays,
        isActive: bookmark.isActive,
        lastScrapedAt: bookmark.lastScrapedAt,
        nextScrapeAt: bookmark.nextScrapeAt
      };
    }
  } catch (error) {
    console.error('Error fetching bookmark info:', error);
  }
  return null;
}

async function monitorQueues() {
  try {
    console.log('🔍 Redis Queue Monitor - ' + new Date().toLocaleString());
    console.log('='.repeat(80));

    // Check queue health
    const scrapeReady = await scrapeQueue.isReady();
    const alertReady = await alertQueue.isReady();
    
    console.log('\n📡 Connection Status:');
    console.log(`  Scrape Queue: ${scrapeReady ? '✅ Connected' : '❌ Disconnected'}`);
    console.log(`  Alert Queue: ${alertReady ? '✅ Connected' : '❌ Disconnected'}`);

    // Get all job states for both queues
    const queues = [
      { name: 'Scrape Queue', queue: scrapeQueue },
      { name: 'Alert Queue', queue: alertQueue }
    ];

    for (const { name, queue } of queues) {
      console.log(`\n${'='.repeat(40)}`);
      console.log(`📊 ${name} Status`);
      console.log('='.repeat(40));

      const waiting = await queue.getJobs(['waiting']);
      const active = await queue.getJobs(['active']);
      const delayed = await queue.getJobs(['delayed']);
      const completed = await queue.getJobs(['completed']);
      const failed = await queue.getJobs(['failed']);
      const paused = await queue.isPaused();

      // Get repeatable jobs
      const repeatableJobs = await queue.getRepeatableJobs();

      console.log('\n📈 Job Counts:');
      console.log(`  Waiting: ${waiting.length}`);
      console.log(`  Active: ${active.length}`);
      console.log(`  Delayed: ${delayed.length}`);
      console.log(`  Completed: ${completed.length}`);
      console.log(`  Failed: ${failed.length}`);
      console.log(`  Repeatable: ${repeatableJobs.length}`);
      console.log(`  Queue Status: ${paused ? '⏸️ PAUSED' : '▶️ RUNNING'}`);

      // Show active jobs
      if (active.length > 0) {
        console.log('\n🔄 Active Jobs:');
        for (const job of active) {
          const details = await formatJobDetails(job, name);
          console.log(`  Job #${details.id} (${job.name}):`);
          console.log(`    Data: ${JSON.stringify(details.data)}`);
          console.log(`    Started: ${details.createdAt}`);
        }
      }

      // Show scheduled/delayed jobs
      if (delayed.length > 0) {
        console.log('\n⏰ Scheduled Jobs:');
        const sortedDelayed = delayed.sort((a, b) => 
          (a.timestamp + (a.opts.delay || 0)) - (b.timestamp + (b.opts.delay || 0))
        );
        
        for (const job of sortedDelayed.slice(0, 5)) { // Show next 5
          const details = await formatJobDetails(job, name);
          console.log(`  Job #${details.id} (${job.name}):`);
          
          // Get bookmark info if available
          if (job.data.bookmarkId) {
            const bookmarkInfo = await getBookmarkInfo(job.data.bookmarkId);
            if (bookmarkInfo) {
              console.log(`    Channel: ${bookmarkInfo.channelName}`);
            }
          }
          
          console.log(`    Scheduled for: ${details.scheduledFor}`);
          console.log(`    Time until: ${details.timeUntilProcess}`);
          console.log(`    Data: ${JSON.stringify(details.data)}`);
        }
        
        if (sortedDelayed.length > 5) {
          console.log(`  ... and ${sortedDelayed.length - 5} more scheduled jobs`);
        }
      }

      // Show repeatable jobs (cron jobs)
      if (repeatableJobs.length > 0) {
        console.log('\n🔁 Repeatable Jobs (Cron):');
        for (const job of repeatableJobs) {
          console.log(`  ${job.name || 'Unnamed'}:`);
          console.log(`    Pattern: ${job.cron}`);
          console.log(`    Timezone: ${job.tz || 'UTC'}`);
          console.log(`    Next Run: ${job.next ? new Date(job.next).toLocaleString() : 'Not scheduled'}`);
          console.log(`    Job ID: ${job.id}`);
          console.log(`    Key: ${job.key}`);
        }
      }

      // Show recent failures
      if (failed.length > 0) {
        console.log('\n❌ Recent Failures:');
        const recentFailed = failed.slice(-3); // Show last 3 failures
        for (const job of recentFailed) {
          const details = await formatJobDetails(job, name);
          console.log(`  Job #${details.id} (${job.name}):`);
          console.log(`    Reason: ${details.failedReason}`);
          console.log(`    Attempts: ${details.attemptsMade}`);
        }
      }

      // Show next upcoming events
      console.log('\n📅 Next Events:');
      const allUpcoming = [
        ...delayed.map(job => ({ job, isRepeatable: false })),
        ...repeatableJobs.filter(j => j.next).map(job => ({ job, isRepeatable: true }))
      ];
      const sortedUpcoming = allUpcoming
        .map(({ job, isRepeatable }) => ({
          type: isRepeatable ? 'Repeatable' : 'Delayed',
          name: job.name,
          nextRun: isRepeatable
            ? (job as any).next // safely access 'next' for repeatable jobs
            : ('timestamp' in job && typeof job.timestamp === 'number'
                ? job.timestamp + (job.opts?.delay || 0)
                : Date.now()),
          data: 'data' in job ? job.data : job.id
        }))
        .sort((a, b) => a.nextRun - b.nextRun)
        .slice(0, 5);

      if (sortedUpcoming.length > 0) {
        for (const event of sortedUpcoming) {
          const timeUntil = formatTimeDiff(event.nextRun - Date.now());
          console.log(`  ${event.type} - ${event.name}: in ${timeUntil}`);
          console.log(`    (${new Date(event.nextRun).toLocaleString()})`);
        }
      } else {
        console.log('  No upcoming events');
      }
    }

    // Overall system health
    console.log('\n' + '='.repeat(80));
    console.log('💡 System Summary:');
    
    const totalWaiting = (await scrapeQueue.getWaitingCount()) + (await alertQueue.getWaitingCount());
    const totalDelayed = (await scrapeQueue.getDelayedCount()) + (await alertQueue.getDelayedCount());
    const totalActive = (await scrapeQueue.getActiveCount()) + (await alertQueue.getActiveCount());
    const totalFailed = (await scrapeQueue.getFailedCount()) + (await alertQueue.getFailedCount());
    
    console.log(`  Total Pending Jobs: ${totalWaiting + totalDelayed}`);
    console.log(`  Total Active Jobs: ${totalActive}`);
    console.log(`  Total Failed Jobs: ${totalFailed}`);
    
    // Check if queues are processing
    if (totalWaiting > 0 && totalActive === 0) {
      console.log('\n⚠️  WARNING: Jobs are waiting but none are active. Check if workers are running!');
    }

  } catch (error) {
    console.error('❌ Monitor Error:', error);
  } finally {
    await scrapeQueue.close();
    await alertQueue.close();
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
    process.exit(0);
  }
}

// Add command line options
const args = process.argv.slice(2);
if (args.includes('--watch')) {
  console.log('👁️  Running in watch mode. Press Ctrl+C to exit.\n');
  monitorQueues();
  setInterval(monitorQueues, 10000); // Refresh every 10 seconds
} else {
  monitorQueues();
}