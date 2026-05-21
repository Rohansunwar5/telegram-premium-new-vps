import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, RedisClientType } from 'redis';
import JWT from 'jsonwebtoken';
import config from '../config';
import logger from '../utils/logger';
import { encodedJWTCacheManager } from '../services/cache/entities';
import { decode, encode, encryptionKey } from '../services/crypto.service';

// ----- Types ---------------------------------------------------------------

interface JWTPayload {
  _id: string;
  sessionId: string;
}

// Extend Socket.io's socket data so downstream handlers are fully typed
interface SocketData {
  user: {
    _id: string;
    sessionId: string;
  };
}

// ----- Module-level singletons ---------------------------------------------

let io: Server;
let pubClient: RedisClientType;
let subClient: RedisClientType;

// ----- Helpers -------------------------------------------------------------

function makeRedisClient(): RedisClientType {
  return createClient({
    socket: {
      host: config.REDIS_LOCAL_HOST,
      port: config.REDIS_LOCAL_PORT,
      reconnectStrategy: (retries: number) => {
        if (retries > 10) {
          logger.error('[Socket.IO] Redis client exceeded max reconnect attempts');
          return new Error('Max reconnect attempts exceeded');
        }
        return Math.min(retries * 100, 3000);
      },
    },
  }) as RedisClientType;
}

// ----- Auth middleware -----------------------------------------------------

async function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void): Promise<void> {
  try {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      return next(new Error('Unauthorized: token missing'));
    }

    let payload: JWTPayload;
    try {
      payload = JWT.verify(token, config.JWT_SECRET) as JWTPayload;
    } catch {
      return next(new Error('Unauthorized: invalid or expired token'));
    }

    const { _id, sessionId } = payload;
    const key = await encryptionKey(config.JWT_CACHE_ENCRYPTION_KEY);
    const cachedJWT = await encodedJWTCacheManager.get({ userId: _id, sessionId });

    if (!cachedJWT) {
      // First time this token is seen — cache it (mirrors HTTP auth middleware behaviour)
      const encryptedData = await encode(token, key);
      await encodedJWTCacheManager.set({ userId: _id, sessionId }, encryptedData);
    } else {
      const storedToken = await decode(cachedJWT, key);
      if (storedToken !== token) {
        return next(new Error('Unauthorized: session expired'));
      }
    }

    (socket.data as SocketData).user = { _id, sessionId };
    next();
  } catch (err) {
    logger.error('[Socket.IO] Auth middleware error:', err);
    next(new Error('Unauthorized: internal error'));
  }
}

// ----- Connection handler --------------------------------------------------

function onConnection(socket: Socket): void {
  const { _id } = (socket.data as SocketData).user;

  logger.info(`[Socket.IO] Connected userId=${_id} socketId=${socket.id} pid=${process.pid}`);

  socket.on('join:session', ({ sessionId }: { sessionId?: string }) => {
    if (!sessionId || typeof sessionId !== 'string') return;
    const room = `session:${sessionId}`;
    socket.join(room);
    logger.info(`[Socket.IO] userId=${_id} joined room=${room}`);
  });

  socket.on('disconnect', (reason) => {
    logger.info(`[Socket.IO] Disconnected userId=${_id} socketId=${socket.id} reason=${reason}`);
  });

  socket.on('error', (err) => {
    logger.error(`[Socket.IO] Socket error userId=${_id}:`, err);
  });
}

// ----- Public API ----------------------------------------------------------

/**
 * Initialise the Socket.IO server on top of an existing HTTP server.
 * Must be called once per worker process after app.listen().
 */
export async function initSocketIO(httpServer: HttpServer): Promise<void> {
  pubClient = makeRedisClient();
  subClient = makeRedisClient();

  pubClient.on('error', (err) => logger.error('[Socket.IO] Pub client error:', err));
  subClient.on('error', (err) => logger.error('[Socket.IO] Sub client error:', err));

  await Promise.all([pubClient.connect(), subClient.connect()]);
  logger.info('[Socket.IO] Redis adapter clients connected');

  io = new Server<
    Record<string, never>,    // ClientToServerEvents
    Record<string, never>,    // ServerToClientEvents — not strongly typed here, events are string-keyed
    Record<string, never>,    // InterServerEvents
    SocketData                // SocketData
  >(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
        if (origin === config.ALLOWED_ORIGIN || isLocalhost) return callback(null, true);
        callback(new Error(`CORS: origin ${origin} not allowed`));
      },
      credentials: true,
      methods: ['GET', 'POST'],
    },
    // Prefer WebSocket; fall back to long-polling only when necessary
    transports: ['websocket', 'polling'],
    // Ping settings — keep-alive without hammering the server
    pingInterval: 25000,
    pingTimeout: 20000,
  });

  io.adapter(createAdapter(pubClient, subClient));
  io.use(socketAuthMiddleware);
  io.on('connection', onConnection);

  logger.info(`[Socket.IO] Server initialised with Redis adapter on worker pid=${process.pid}`);
}

/**
 * Emit an event to all sockets watching a specific decoy session room.
 * Safe to call from any worker process — the Redis adapter fans it out.
 */
export function emitToSession(sessionId: string, event: string, payload: unknown): void {
  if (!io) {
    logger.warn('[Socket.IO] emitToSession called before server initialised');
    return;
  }
  io.to(`session:${sessionId}`).emit(event, payload);
}

/**
 * Gracefully close the Socket.IO server and its Redis adapter clients.
 * Call this during worker process shutdown.
 */
export async function shutdownSocketIO(): Promise<void> {
  try {
    if (io) {
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }
    await Promise.allSettled([
      pubClient?.quit(),
      subClient?.quit(),
    ]);
    logger.info('[Socket.IO] Server and Redis adapter clients shut down');
  } catch (err) {
    logger.error('[Socket.IO] Error during shutdown:', err);
  }
}

export { io };
