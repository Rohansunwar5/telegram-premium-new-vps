import { Job } from 'bull';
import { scrapeQueue, alertQueue } from '../config/redis';
import BookmarkService from '../services/bookmark.service';
import { BookmarkRepository } from '../repository/bookmark.repository';
import { S3Service } from '../services/s3.service';
import { ChannelService } from '../services/channel.service';
import logger from '../utils/logger';
import { UserRepository } from '../repository/user.repository';

let bookmarkService: BookmarkService;

export const initializeQueueProcessors = async () => {
  try {
    logger.info('Initializing queue processors...');

    const bookmarkRepository = new BookmarkRepository();
    const s3Service = new S3Service();
    const channelService = new ChannelService();
    const userRepository = new UserRepository();
    bookmarkService = new BookmarkService(bookmarkRepository, s3Service, channelService, userRepository);
    
    // IMPORTANT: Make sure queues are not paused
    const scrapePaused = await scrapeQueue.isPaused();
    const alertPaused = await alertQueue.isPaused();
    
    if (scrapePaused) {
      logger.info('📢 Scrape queue was paused, resuming...');
      await scrapeQueue.resume();
    }
    
    if (alertPaused) {
      logger.info('📢 Alert queue was paused, resuming...');
      await alertQueue.resume();
    }
    
    // Register scrape processor
    scrapeQueue.process('scrape-channel', 5, async (job: Job) => {
      const { bookmarkId, channelId, channelName, isInitial } = job.data;
      
      logger.info(`🔄 Processing scrape job ${job.id} for channel ${channelName}`, { bookmarkId, isInitial });
      
      try {
        await job.progress(10);
        
        const result = await bookmarkService.processScrapeJob(bookmarkId, channelId, channelName);
        
        await job.progress(100);
        
        logger.info(`✅ Scrape job ${job.id} completed successfully`, {
          channelName,
          messagesScraped: result?.messageCount || 0
        });
        
        return result;
      } catch (error: any) {
        logger.error(`❌ Scrape job ${job.id} failed:`, {
          error: error.message,
          stack: error.stack
        });
        throw error;
      }
    });
    
    // Register alert processor
    alertQueue.process('process-alert', 3, async (job: Job) => {
      const { bookmarkId, userId } = job.data;
      
      logger.info(`🔔 Processing alert job ${job.id}`, {
        bookmarkId,
        userId
      });
      
      try {
        await job.progress(10);
        
        const result = await bookmarkService.processAlertJob(bookmarkId);
        
        await job.progress(100);
        
        if (result) {
          logger.info(`✅ Alert generated successfully`, {
            bookmarkId,
            messagesProcessed: result.messagesProcessed
          });
        }
        
        return result;
      } catch (error: any) {
        logger.error(`❌ Alert job ${job.id} failed:`, {
          error: error.message
        });
        throw error;
      }
    });
    
    // Event listeners
    scrapeQueue.on('active', (job) => {
      logger.info(`⚡ Scrape job ${job.id} is now active`);
    });
    
    scrapeQueue.on('completed', (job, result) => {
      logger.info(`✅ Scrape job ${job.id} completed`);
    });
    
    scrapeQueue.on('failed', (job, err) => {
      logger.error(`❌ Scrape job ${job?.id} failed: ${err.message}`);
    });
    
    scrapeQueue.on('stalled', (job) => {
      logger.warn(`⚠️ Scrape job ${job.id} stalled`);
    });
    
    alertQueue.on('active', (job) => {
      logger.info(`⚡ Alert job ${job.id} is now active`);
    });
    
    alertQueue.on('completed', (job, result) => {
      logger.info(`✅ Alert job ${job.id} completed`);
    });
    
    alertQueue.on('failed', (job, err) => {
      logger.error(`❌ Alert job ${job?.id} failed: ${err.message}`);
    });
    
    // Check and process any waiting jobs
    const scrapeWaiting = await scrapeQueue.getWaitingCount();
    const alertWaiting = await alertQueue.getWaitingCount();
    const scrapePausedFinal = await scrapeQueue.isPaused();
    const alertPausedFinal = await alertQueue.isPaused();
    
    logger.info(`📊 Queue Status after processor init:`, {
      scrapeWaiting,
      alertWaiting,
      scrapePaused: scrapePausedFinal,
      alertPaused: alertPausedFinal
    });
    
    // If there are waiting jobs and queue is not paused, they should start processing
    if (scrapeWaiting > 0 && !scrapePausedFinal) {
      logger.info(`🚀 ${scrapeWaiting} scrape jobs waiting to be processed`);
    }
    
    logger.info('✅ Queue processors registered and ready');
    
  } catch (error) {
    logger.error('❌ Failed to initialize queue processors:', error);
    throw error;
  }
};

export const cleanupQueues = async () => {
  try {
    logger.info('Cleaning up queues...');
    
    // DON'T pause here during cleanup if we want jobs to finish
    // Just close when ready
    await Promise.race([
      Promise.all([
        scrapeQueue.whenCurrentJobsFinished(),
        alertQueue.whenCurrentJobsFinished()
      ]),
      new Promise(resolve => setTimeout(resolve, 5000))
    ]);
    
    await scrapeQueue.close();
    await alertQueue.close();
    
    logger.info('✅ Queues cleaned up');
  } catch (error) {
    logger.error('Error cleaning up queues:', error);
  }
};