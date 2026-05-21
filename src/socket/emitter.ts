/**
 * Master-process Socket.IO emitter.
 *
 * The master process has no HTTP server and therefore no Socket.IO server.
 * @socket.io/redis-emitter publishes events directly into the Redis Pub/Sub
 * channel that the workers' Socket.IO Redis Adapter subscribes to.  Workers
 * receive the pub and forward the event to whichever client holds the socket.
 *
 * Usage (Phase 2 — decoy bot polling loop runs in master):
 *   await initSocketEmitter();
 *   emitToSession(sessionId, 'decoy:message', payload);
 *   // On shutdown:
 *   await shutdownSocketEmitter();
 */

import { Emitter } from '@socket.io/redis-emitter';
import { createClient, RedisClientType } from 'redis';
import config from '../config';
import logger from '../utils/logger';

let emitter: Emitter;
let redisClient: RedisClientType;

/**
 * Connect to local Redis and initialise the emitter.
 * Must be called once in the master process before any emit calls.
 */
export async function initSocketEmitter(): Promise<void> {
  redisClient = createClient({
    socket: {
      host: config.REDIS_LOCAL_HOST,
      port: config.REDIS_LOCAL_PORT,
      reconnectStrategy: (retries: number) => {
        if (retries > 10) {
          logger.error('[Socket Emitter] Max reconnect attempts reached');
          return new Error('Max reconnect attempts exceeded');
        }
        return Math.min(retries * 100, 3000);
      },
    },
  }) as RedisClientType;

  redisClient.on('error', (err) => logger.error('[Socket Emitter] Redis client error:', err));
  redisClient.on('reconnecting', () => logger.warn('[Socket Emitter] Reconnecting...'));

  await redisClient.connect();
  emitter = new Emitter(redisClient);

  logger.info('[Socket Emitter] Initialised (master process)');
}

/**
 * Emit an event into a decoy session room.
 * All workers subscribed to that room via the Redis Adapter will forward it
 * to the browser clients watching that session.
 */
export function emitToSession(sessionId: string, event: string, payload: unknown): void {
  if (!emitter) {
    logger.warn('[Socket Emitter] emitToSession called before initialisation');
    return;
  }
  emitter.to(`session:${sessionId}`).emit(event, payload);
}

/**
 * Gracefully close the emitter's Redis client.
 * Call this during master process shutdown.
 */
export async function shutdownSocketEmitter(): Promise<void> {
  try {
    await redisClient?.quit();
    logger.info('[Socket Emitter] Redis client shut down');
  } catch (err) {
    logger.error('[Socket Emitter] Error during shutdown:', err);
  }
}
