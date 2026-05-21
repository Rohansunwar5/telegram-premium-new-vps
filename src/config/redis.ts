import Bull from 'bull';
import config from './index';

const localRedisConfig = {
  host: config.REDIS_LOCAL_HOST,
  port: config.REDIS_LOCAL_PORT,
  // Required by Bull/ioredis when used with blocking commands
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

export const scrapeQueue = new Bull('scrape-queue', {
  redis: localRedisConfig,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

export const alertQueue = new Bull('alert-queue', {
  redis: localRedisConfig,
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 25,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
  },
});

scrapeQueue.on('completed', (job) => {
  console.log(`Scrape job ${job.id} completed for bookmark ${job.data.bookmarkId}`);
});

scrapeQueue.on('failed', (job, err) => {
  console.error(`Scrape job ${job.id} failed:`, err);
});

alertQueue.on('completed', (job) => {
  console.log(`Alert job ${job.id} completed for bookmark ${job.data.bookmarkId}`);
});

alertQueue.on('failed', (job, err) => {
  console.error(`Alert job ${job.id} failed:`, err);
});
