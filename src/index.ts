// index.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import os from 'os';
import cluster from 'cluster';
import http from 'http';
import app from './app';
import logger from './utils/logger';
import connectDB from './db';
import redisClient from './services/cache';

(async () => {
  logger.info('Connecting to Database...');
  await connectDB();
  logger.info('DB connected');

  logger.info('Connecting to Redis cache...');
  await redisClient.connect();
  logger.info('Redis cache connected');

  const isProduction = process.env.NODE_ENV === 'production';
  const numCPUs = isProduction ? os.cpus().length : 1;

  // ------------------------------------------------------------------ //
  //  PRODUCTION CLUSTER MASTER
  //  In dev we skip clustering entirely — Windows cluster IPC is unreliable
  // ------------------------------------------------------------------ //
  if (isProduction && cluster.isMaster) {
    logger.info(`Master ${process.pid} is running`);

    let cleanupQueues: () => Promise<void>;

    try {
      const queueProcessors = await import('./processors/queue.processor');
      cleanupQueues = queueProcessors.cleanupQueues;
      await queueProcessors.initializeQueueProcessors();
      logger.info('Queue processors initialised');

      const { scrapeQueue, alertQueue } = await import('./config/redis');
      const [scrapeWaiting, scrapeDelayed, alertWaiting] = await Promise.all([
        scrapeQueue.getWaitingCount(),
        scrapeQueue.getDelayedCount(),
        alertQueue.getWaitingCount(),
      ]);
      logger.info('Queue status:', { scrapeWaiting, scrapeDelayed, alertWaiting });
    } catch (err) {
      logger.error('Failed to initialise queue processors:', err);
      process.exit(1);
    }

    const { initSocketEmitter, shutdownSocketEmitter } = await import('./socket/emitter');

    try {
      await initSocketEmitter();
    } catch (err) {
      logger.error('Failed to initialise socket emitter:', err);
    }

    const { DecoyBotService } = await import('./services/decoyBot.service');
    const { DecoySessionRepository } = await import('./repository/decoySession.repository');
    const { DecoyAccountRepository } = await import('./repository/decoyAccount.repository');
    const { DecoyAIService } = await import('./services/decoyAI.service');

    const decoyBotService = new DecoyBotService(
      new DecoySessionRepository(),
      new DecoyAccountRepository(),
      new DecoyAIService()
    );

    try {
      await decoyBotService.resumeActiveSessions();
    } catch (err) {
      logger.error('Failed to resume active decoy sessions:', err);
    }

    type DecoyIpcMessage = {
      type: 'DECOY_START' | 'DECOY_STOP' | 'DECOY_RESUME';
      sessionId: string;
      stopStatus?: 'paused' | 'stopped';
    };

    cluster.on('message', (_worker, msg: DecoyIpcMessage) => {
      if (!msg?.type || !msg?.sessionId) return;

      switch (msg.type) {
        case 'DECOY_START':
          decoyBotService.startSession(msg.sessionId).catch((err) =>
            logger.error(`[IPC] DECOY_START failed for ${msg.sessionId}:`, err)
          );
          break;
        case 'DECOY_STOP':
          decoyBotService
            .stopSession(msg.sessionId, msg.stopStatus ?? 'stopped')
            .catch((err) =>
              logger.error(`[IPC] DECOY_STOP failed for ${msg.sessionId}:`, err)
            );
          break;
        case 'DECOY_RESUME':
          decoyBotService.resumeSession(msg.sessionId).catch((err) =>
            logger.error(`[IPC] DECOY_RESUME failed for ${msg.sessionId}:`, err)
          );
          break;
        default:
          break;
      }
    });

    const gracefulShutdown = async (signal: string) => {
      logger.info(`${signal} received — shutting down master`);
      try {
        if (cleanupQueues) await cleanupQueues();
        logger.info('Queues closed');
        await decoyBotService.stopAllSessions('paused');
        logger.info('Decoy sessions paused');
        await shutdownSocketEmitter();
        await redisClient.quit();
        logger.info('Redis cache closed');
        const mongoose = await import('mongoose');
        await mongoose.connection.close();
        logger.info('MongoDB closed');
        process.exit(0);
      } catch (err) {
        logger.error('Error during master shutdown:', err);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    for (let i = 0; i < numCPUs; i++) {
      cluster.fork();
    }

    cluster.on('exit', (worker) => {
      logger.warn(`Worker ${worker.process.pid} died — forking replacement`);
      cluster.fork();
    });

  } else {
    // ------------------------------------------------------------------ //
    //  DEV: single all-in-one process
    //  PROD WORKER: HTTP + Socket.IO only (master handles the rest via IPC)
    // ------------------------------------------------------------------ //

    // In dev, initialise master-only services in this same process
    let cleanupQueues: (() => Promise<void>) | undefined;
    let shutdownSocketEmitter: (() => Promise<void>) | undefined;
    let decoyBotService: any;

    if (!isProduction) {
      logger.info(`Dev process ${process.pid} is running (no cluster)`);

      try {
        const queueProcessors = await import('./processors/queue.processor');
        cleanupQueues = queueProcessors.cleanupQueues;
        await queueProcessors.initializeQueueProcessors();
        logger.info('Queue processors initialised');

        const { scrapeQueue, alertQueue } = await import('./config/redis');
        const [scrapeWaiting, scrapeDelayed, alertWaiting] = await Promise.all([
          scrapeQueue.getWaitingCount(),
          scrapeQueue.getDelayedCount(),
          alertQueue.getWaitingCount(),
        ]);
        logger.info('Queue status:', { scrapeWaiting, scrapeDelayed, alertWaiting });
      } catch (err) {
        logger.error('Failed to initialise queue processors:', err);
        process.exit(1);
      }

      try {
        const emitter = await import('./socket/emitter');
        shutdownSocketEmitter = emitter.shutdownSocketEmitter;
        await emitter.initSocketEmitter();
      } catch (err) {
        logger.error('Failed to initialise socket emitter:', err);
      }

      const { DecoyBotService } = await import('./services/decoyBot.service');
      const { DecoySessionRepository } = await import('./repository/decoySession.repository');
      const { DecoyAccountRepository } = await import('./repository/decoyAccount.repository');
      const { DecoyAIService } = await import('./services/decoyAI.service');
      const { setDecoyBotService } = await import('./services/decoyBot.singleton');

      decoyBotService = new DecoyBotService(
        new DecoySessionRepository(),
        new DecoyAccountRepository(),
        new DecoyAIService()
      );

      // Register so controllers can call the service directly in dev mode
      setDecoyBotService(decoyBotService);

      try {
        await decoyBotService.resumeActiveSessions();
      } catch (err) {
        logger.error('Failed to resume active decoy sessions:', err);
      }
    }

    // ------------------------------------------------------------------ //
    //  HTTP server
    // ------------------------------------------------------------------ //
    const normalizePort = (val: any): number | string | false => {
      const port = parseInt(val, 10);
      if (Number.isNaN(port)) return val;
      if (port >= 0) return port;
      return false;
    };

    const port = normalizePort(process.env.PORT || '4010');

    const onError = (error: any) => {
      if (error.syscall !== 'listen') throw error;
      const bind = typeof port === 'string' ? `pipe ${port}` : `port ${port}`;
      switch (error.code) {
        case 'EACCES':
          logger.error(`${bind} requires elevated privileges`);
          process.exit(1);
          break;
        case 'EADDRINUSE':
          logger.error(`${bind} is already in use`);
          process.exit(1);
          break;
        default:
          throw error;
      }
    };

    const server = http.createServer(app);
    server.on('error', onError);

    await new Promise<void>((resolve) => server.listen(port, resolve));
    logger.info(`${isProduction ? 'Worker' : 'Dev process'} ${process.pid} listening on port ${port}`);

    const { initSocketIO, shutdownSocketIO } = await import('./socket');

    try {
      await initSocketIO(server);
    } catch (err) {
      logger.error(`Process ${process.pid} failed to initialise Socket.IO:`, err);
    }

    // ------------------------------------------------------------------ //
    //  Graceful shutdown
    // ------------------------------------------------------------------ //
    const shutdown = async () => {
      logger.info(`Process ${process.pid} shutting down...`);

      if (!isProduction) {
        if (cleanupQueues) await cleanupQueues();
        logger.info('Queues closed');
        if (decoyBotService) await decoyBotService.stopAllSessions('paused');
        logger.info('Decoy sessions paused');
        if (shutdownSocketEmitter) await shutdownSocketEmitter();
      }

      await shutdownSocketIO();

      server.close(() => {
        logger.info(`Process ${process.pid} HTTP server closed`);
        process.exit(0);
      });

      setTimeout(() => {
        logger.error(`Process ${process.pid} forcing exit after timeout`);
        process.exit(1);
      }, 10000).unref();
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
})();
