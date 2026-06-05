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
 *
 * Two delivery paths (belt-and-suspenders):
 *  1. Direct Socket.IO server emit — if the `io` instance lives in this
 *     process (dev mode, or same-process setups), emit straight to the room.
 *     This is the most reliable path because it skips Redis Pub/Sub entirely.
 *  2. Redis emitter — publishes into the Redis channel so that workers in a
 *     production cluster also receive the broadcast via the Redis adapter.
 */
export function emitToSession(sessionId: string, event: string, payload: unknown): void {
  let emittedDirectly = false;

  // 1. Direct path — emit through the Socket.IO server when available
  try {
    const { io } = require('./index');          // dynamic require avoids circular dep at load time
    if (io) {
      io.to(`session:${sessionId}`).emit(event, payload);
      emittedDirectly = true;
    }
  } catch {
    // io not available in this process (e.g. production master with no HTTP server)
  }

  // 2. Redis emitter path — cross-process fan-out for clustered workers
  if (emitter) {
    emitter.to(`session:${sessionId}`).emit(event, payload);
  }

  if (!emittedDirectly && !emitter) {
    logger.warn('[Socket Emitter] emitToSession: no IO server and no Redis emitter available');
  }
}

/**
 * Emit an event to all sockets watching a specific user room.
 */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  let emittedDirectly = false;

  // 1. Direct path
  try {
    const { io } = require('./index');
    if (io) {
      io.to(`user:${userId}`).emit(event, payload);
      emittedDirectly = true;
    }
  } catch {
    // io not available in this process
  }

  // 2. Redis emitter path
  if (emitter) {
    emitter.to(`user:${userId}`).emit(event, payload);
  }

  if (!emittedDirectly && !emitter) {
    logger.warn('[Socket Emitter] emitToUser: no IO server and no Redis emitter available');
  }
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
