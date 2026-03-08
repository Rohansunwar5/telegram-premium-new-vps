import Bull, { Job, JobCounts } from 'bull';
import Redis from 'ioredis';

// Types and interfaces
interface RedisConfig {
  host: string;
  port: number;
  password: string;
  maxRetriesPerRequest: null;
  enableReadyCheck: boolean;
}

interface JobInfo {
  id: string | number;
  data: any;
  createdAt?: string;
  processedOn?: string | null;
  finishedOn?: string | null;
  failedReason?: string;
}

interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

interface QueueJobs {
  waiting: JobInfo[];
  active: JobInfo[];
  failed: JobInfo[];
}

interface QueueStatus {
  name: string;
  counts?: QueueCounts;
  totalCounts?: JobCounts;
  jobs?: QueueJobs;
  error?: string;
}

// Redis configuration
const redisConfig: RedisConfig = {
  host: 'redis-13142.c62.us-east-1-4.ec2.redns.redis-cloud.com',
  port: 13142,
  password: 'Hie2Ze4t6SYBnozINBsJS2yeWWuURTz6',
  maxRetriesPerRequest: null,
  enableReadyCheck: false
};

// Initialize queues
const scrapeQueue: Bull.Queue = new Bull('scrape-queue', { redis: redisConfig });
const alertQueue: Bull.Queue = new Bull('alert-queue', { redis: redisConfig });

async function getQueueStatus(queue: Bull.Queue, queueName: string): Promise<QueueStatus> {
  try {
    const [waiting, active, completed, failed, delayed, isPaused] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed(),
      queue.isPaused()
    ]);

    const counts: JobCounts = await queue.getJobCounts();

    const mapJobToInfo = (job: Job): JobInfo => ({
      id: job.id,
      data: job.data,
      createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : undefined,
      processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
      finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      failedReason: job.failedReason
    });

    return {
      name: queueName,
      counts: {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        paused: isPaused ? 1 : 0
      },
      totalCounts: counts,
      jobs: {
        waiting: waiting.slice(0, 5).map(mapJobToInfo),
        active: active.slice(0, 5).map(mapJobToInfo),
        failed: failed.slice(0, 5).map(mapJobToInfo)
      }
    };
  } catch (error) {
    console.error(`Error getting status for ${queueName}:`, (error as Error).message);
    return {
      name: queueName,
      error: (error as Error).message
    };
  }
}

function displayJobInfo(jobs: JobInfo[], title: string): void {
  if (jobs.length === 0) return;

  console.log(`\n${title}:`);
  jobs.forEach(job => {
    if (title.includes('Failed')) {
      console.log(`  • Job ${job.id}: ${JSON.stringify(job.data)}`);
      console.log(`    Reason: ${job.failedReason || 'Unknown'}`);
      console.log(`    Failed: ${job.finishedOn || 'Unknown'}`);
    } else if (title.includes('Active')) {
      console.log(`  • Job ${job.id}: ${JSON.stringify(job.data)} (Started: ${job.processedOn || 'Unknown'})`);
    } else {
      console.log(`  • Job ${job.id}: ${JSON.stringify(job.data)} (Created: ${job.createdAt || 'Unknown'})`);
    }
  });
}

async function displayQueueStatus(): Promise<void> {
  console.log('🔍 Checking Bull Queue Status...\n');
  console.log('='.repeat(60));
  
  try {
    const [scrapeStatus, alertStatus] = await Promise.all([
      getQueueStatus(scrapeQueue, 'Scrape Queue'),
      getQueueStatus(alertQueue, 'Alert Queue')
    ]);

    // Display results
    [scrapeStatus, alertStatus].forEach((status: QueueStatus) => {
      if (status.error) {
        console.log(`❌ ${status.name}: Error - ${status.error}\n`);
        return;
      }

      if (!status.counts || !status.jobs) return;

      console.log(`📊 ${status.name.toUpperCase()}`);
      console.log('-'.repeat(40));
      console.log(`📝 Waiting: ${status.counts.waiting}`);
      console.log(`⚡ Active: ${status.counts.active}`);
      console.log(`✅ Completed: ${status.counts.completed}`);
      console.log(`❌ Failed: ${status.counts.failed}`);
      console.log(`⏰ Delayed: ${status.counts.delayed}`);
      console.log(`⏸️  Paused: ${status.counts.paused}`);
      
      if (status.totalCounts) {
        console.log(`📈 Total processed: ${status.totalCounts.completed + status.totalCounts.failed}`);
      }

      // Show recent jobs
      displayJobInfo(status.jobs.waiting, '🕒 Recent Waiting Jobs');
      displayJobInfo(status.jobs.active, '⚡ Current Active Jobs');
      displayJobInfo(status.jobs.failed, '❌ Recent Failed Jobs');

      console.log('\n' + '='.repeat(60) + '\n');
    });

  } catch (error) {
    console.error('❌ Failed to check queue status:', (error as Error).message);
  }
}

async function main(): Promise<void> {
  console.log('🚀 Starting Queue Monitor...\n');
  
  // Parse command line arguments
  const args: string[] = process.argv.slice(2);
  const continuous: boolean = args.includes('--watch') || args.includes('-w');
  const intervalArg = args.find((arg: string) => arg.startsWith('--interval='));
  const interval: number = intervalArg ? parseInt(intervalArg.split('=')[1]) : 30;

  if (continuous) {
    console.log(`🔄 Running in watch mode (checking every ${interval} seconds)...`);
    console.log('Press Ctrl+C to stop\n');
    
    // Initial check
    await displayQueueStatus();
    
    // Set up interval
    const intervalId = setInterval(async () => {
      console.log(`\n🔄 Refreshing at ${new Date().toISOString()}...\n`);
      await displayQueueStatus();
    }, interval * 1000);
    
    // Keep the process alive
    return new Promise<void>(() => {
      // This promise never resolves, keeping the process running
    });
    
  } else {
    // Run once
    await displayQueueStatus();
    
    // Close connections
    await scrapeQueue.close();
    await alertQueue.close();
    
    console.log('✅ Queue check completed!');
    process.exit(0);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async (): Promise<void> => {
  console.log('\n\n🛑 Shutting down gracefully...');
  try {
    await Promise.all([
      scrapeQueue.close(),
      alertQueue.close()
    ]);
  } catch (error) {
    console.error('Error during shutdown:', (error as Error).message);
  }
  process.exit(0);
});

process.on('SIGTERM', async (): Promise<void> => {
  console.log('\n\n🛑 Received SIGTERM, shutting down...');
  try {
    await Promise.all([
      scrapeQueue.close(),
      alertQueue.close()
    ]);
  } catch (error) {
    console.error('Error during shutdown:', (error as Error).message);
  }
  process.exit(0);
});

// Run the script
main().catch((error: Error) => {
  console.error('💥 Script failed:', error.message);
  process.exit(1);
});