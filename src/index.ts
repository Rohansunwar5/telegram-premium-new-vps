// index.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import os from 'os';
import cluster from 'cluster';
import app from './app';
import logger from './utils/logger';
import connectDB from './db';
import redisClient from './services/cache';

(async () => {
  logger.info('Connecting to Database...');
  await connectDB();
  logger.info('DB connected');
  
  logger.info('Connecting to Redis...');
  await redisClient.connect();
  logger.info('Redis connected');

  const numCPUs = process.env.NODE_ENV === 'production' ? os.cpus().length : 1;
  
  if (cluster.isMaster) {
    logger.info(`Master ${process.pid} is running`);
    
    // Initialize queue processors ONLY in master process
    logger.info('Initializing Bull Queue Processors...');
    
    try {
      // Import and initialize queue processors
      const { initializeQueueProcessors, cleanupQueues } = await import('./processors/queue.processor');
      await initializeQueueProcessors();
      logger.info('✅ Queue processors initialized and running');
      
      // Test queue connection
      const { scrapeQueue, alertQueue } = await import('./config/redis');
      
      // Check queue status
      const scrapeWaiting = await scrapeQueue.getWaitingCount();
      const scrapeDelayed = await scrapeQueue.getDelayedCount();
      const alertWaiting = await alertQueue.getWaitingCount();
      
      logger.info(`📊 Queue Status:`, {
        scrapeWaiting,
        scrapeDelayed,
        alertWaiting
      });
      
      // Graceful shutdown handlers
      const gracefulShutdown = async (signal: string) => {
        logger.info(`${signal} signal received: closing HTTP server and queues`);
        
        try {
          await cleanupQueues();
          logger.info('Queue connections closed');
          
          await redisClient.quit();
          logger.info('Redis connection closed');
          
          const mongoose = await import('mongoose');
          await mongoose.connection.close();
          logger.info('MongoDB connection closed');
          
          process.exit(0);
        } catch (error) {
          logger.error('Error during graceful shutdown:', error);
          process.exit(1);
        }
      };
      
      process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
      process.on('SIGINT', () => gracefulShutdown('SIGINT'));
      
    } catch (error) {
      logger.error('❌ Failed to initialize queue processors:', error);
      process.exit(1);
    }
    
    // Fork workers for HTTP handling
    for (let i = 0; i < numCPUs; i++) {
      cluster.fork();
    }
    
    cluster.on('exit', (worker) => {
      logger.info(`Worker ${worker.process.pid} died`);
      const newWorker = cluster.fork();
      logger.info(`New worker started with PID ${newWorker.process.pid}`);
    });
    
  } else {
    // Worker processes handle HTTP requests only
    const normalizePort = (val: any) => {
      const port = parseInt(val, 10);
      
      if (Number.isNaN(port)) {
        return val;
      }
      
      if (port >= 0) {
        return port;
      }
      
      return false;
    };
    
    const port = normalizePort(process.env.PORT || '4010');
    
    const onError = (error: any) => {
      if (error.syscall !== 'listen') {
        throw error;
      }
      
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
    
    app.on('error', onError);
    
    const onListening = () => {
      const bind = typeof port === 'string' ? `pipe ${port}` : `port ${port}`;
      logger.info(`Worker ${process.pid} listening on ${bind}`);
    };
    
    const server = app.listen(port, onListening);
    logger.info(`Worker ${process.pid} started`);
    
    // Worker shutdown
    const workerShutdown = async () => {
      logger.info(`Worker ${process.pid} shutting down...`);
      
      server.close(() => {
        logger.info(`Worker ${process.pid} closed HTTP connections`);
        process.exit(0);
      });
      
      setTimeout(() => {
        logger.error(`Worker ${process.pid} forcing shutdown`);
        process.exit(1);
      }, 10000);
    };
    
    process.on('SIGTERM', workerShutdown);
    process.on('SIGINT', workerShutdown);
  }
})();