import * as redis from 'redis';
import config from '../../config';
import logger from '../../utils/logger';

const redisClient = redis.createClient({
  socket: {
    host: config.REDIS_LOCAL_HOST,
    port: config.REDIS_LOCAL_PORT,
    reconnectStrategy: (retries: number) => {
      if (retries > 10) {
        logger.error('[Redis Cache] Max reconnect attempts reached — giving up');
        return new Error('Redis max reconnect attempts exceeded');
      }
      return Math.min(retries * 100, 3000);
    },
  },
  // Do not buffer commands while disconnected — fail fast so callers can handle it
  disableOfflineQueue: true,
});

redisClient.on('ready', () => {
  logger.info('[Redis Cache] Connected');
});

redisClient.on('error', (err) => {
  logger.error('[Redis Cache] Error:', err);
});

redisClient.on('reconnecting', () => {
  logger.warn('[Redis Cache] Reconnecting...');
});

export default redisClient;
