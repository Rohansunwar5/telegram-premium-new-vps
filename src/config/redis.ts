import Bull from 'bull';
import Redis from 'ioredis';
import config from './index';

const redisConnection = new Redis({
  host: 'redis-13142.c62.us-east-1-4.ec2.redns.redis-cloud.com',
  port: Number(13142),
  password: 'Hie2Ze4t6SYBnozINBsJS2yeWWuURTz6',
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

// Queue for scraping channels
export const scrapeQueue = new Bull('scrape-queue', {
  redis: {
    host: 'redis-13142.c62.us-east-1-4.ec2.redns.redis-cloud.com',
    port: Number(13142),
    password: 'Hie2Ze4t6SYBnozINBsJS2yeWWuURTz6'
  },
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 50,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  }
});

// Queue for processing alerts
export const alertQueue = new Bull('alert-queue', {
  redis: {
    host: 'redis-13142.c62.us-east-1-4.ec2.redns.redis-cloud.com',
    port: Number(13142),
    password: 'Hie2Ze4t6SYBnozINBsJS2yeWWuURTz6'
  },
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 25,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  }
});

// Queue event listeners
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

export { redisConnection };