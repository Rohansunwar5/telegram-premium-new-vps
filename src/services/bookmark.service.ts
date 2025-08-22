import { alertQueue, scrapeQueue } from "../config/redis";
import { BadRequestError } from "../errors/bad-request.error";
import { InternalServerError } from "../errors/internal-server.error";
import { NotFoundError } from "../errors/not-found.error";
import { BookmarkRepository } from "../repository/bookmark.repository";
import { UserRepository } from "../repository/user.repository";
import logger from "../utils/logger";
import { ChannelService } from "./channel.service";
import mailService from "./mail.service";
import { S3Service } from "./s3.service";

interface IBookmarkChannelParams {
    userId: string;
    channelName: string;
    channelId: string;
    alertTime: string;
    alertDays?: string[];
}

interface IUpdateBookmarksSettingsParams {
    userId: string;
    bookmarkId: string;
    alertTime?: string;
    alertDays?: string[];
    isActive?: boolean;
}

interface IScrapeResult {
    messages: any[];
    firstMessageTimestamp: Date;
    lastMessageTimestamp: Date;
    messageCount: number;
}

class BookmarkService {
    constructor(
        private readonly _bookmarkRepository: BookmarkRepository,
        private readonly _s3Service: S3Service,
        private readonly _channelService: ChannelService,
        private readonly _userReposiotory: UserRepository
    ) {}

    async bookmarkChannel(params: IBookmarkChannelParams) {
        const { userId, channelName, channelId, alertTime, alertDays } = params;

        const existingBookmark = await this._bookmarkRepository.getBookmarkByUserAndChannel(userId, channelId);

        if(existingBookmark) throw new BadRequestError('Channel already bookmarked');
        

        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(alertTime)) throw new BadRequestError('Invalid alert time format. Use HH:mm format');

        // create bookmark 
        const bookmark = await this._bookmarkRepository.createBookmark({
            userId,
            channelName,
            channelId,
            alertTime,
            alertDays,
        });

        if(!bookmark) throw new InternalServerError('Failed to ceate bookmark');

        await scrapeQueue.add('scrape-channel', {
        bookmarkId: bookmark._id.toString(),
        channelId,
        channelName,
        isInitial: true
        }, {
        delay: 0
        });

        // Schedule daily alert
        await this.scheduleAlertJob(bookmark);

        return bookmark;   
    }

    async updateBookmarkSettings(params: IUpdateBookmarksSettingsParams) {
        const { userId, bookmarkId, alertTime, alertDays, isActive } = params;

        const bookmark = await this._bookmarkRepository.getBookmarkById(bookmarkId);
        if (!bookmark) {
        throw new NotFoundError('Bookmark not found');
        }

        if (bookmark.userId.toString() !== userId) {
        throw new BadRequestError('Unauthorized to update this bookmark');
        }

        if (alertTime) {
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(alertTime)) {
            throw new BadRequestError('Invalid alert time format. Use HH:mm format');
        }
        }

        const updatedBookmark = await this._bookmarkRepository.updateBookmark(bookmarkId, {
        alertTime,
        alertDays,
        isActive
        });

        if (updatedBookmark) {
        if (alertTime || alertDays) {
            await this.scheduleAlertJob(updatedBookmark);
        }
        }

        return updatedBookmark;
    }

    async deleteBookmark(userId: string, bookmarkId: string) {
        const bookmark = await this._bookmarkRepository.getBookmarkById(bookmarkId);
        if (!bookmark) {
        throw new NotFoundError('Bookmark not found');
        }

        if (bookmark.userId.toString() !== userId) {
        throw new BadRequestError('Unauthorized to delete this bookmark');
        }

        // Cancel scheduled jobs
        await scrapeQueue.removeRepeatableByKey(`scrape-${bookmarkId}`);
        await alertQueue.removeRepeatableByKey(`alert-${bookmarkId}`);

        const deleted = await this._bookmarkRepository.deleteBookmark(bookmarkId);
        return { success: !!deleted };
    }

    async getUserBookmarks(userId: string) {
        const bookmarks = await this._bookmarkRepository.getUserBookmarks(userId);
        
        // Get latest scrape data for each bookmark
        const bookmarksWithStatus = await Promise.all(
        bookmarks.map(async (bookmark) => {
            const latestScrape = await this._bookmarkRepository.getLatestScrapeData(
            bookmark._id.toString()
            );
            
            return {
            ...bookmark.toObject(),
            lastScrapedAt: latestScrape?.scrapedAt || null,
            nextScrapeAt: bookmark.nextScrapeAt,
            messageCount: latestScrape?.messageCount || 0
            };
        })
        );

        return bookmarksWithStatus;
    }

    async processScrapeJob(bookmarkId: string, channelId: string, channelName: string) {
        try {

        logger.info(`Starting scrape job got ${channelName}`);

        const latestScrape = await this._bookmarkRepository.getLatestScrapeData(bookmarkId);

        let scrapeParams: any = {
            channelName, 
            limit: 100, 
        }

        // IMPORTANT: firstMessageTimestamp is the NEWEST/LATEST message
        if (latestScrape && latestScrape.firstMessageTimestamp) {
            const lastNewestMessage = latestScrape.firstMessageTimestamp; // This is the LATEST message from last scrape
            logger.info(`📍 Last newest message was at: ${lastNewestMessage}`);
            
            // Only get messages NEWER than the latest message we already have
            scrapeParams.since = lastNewestMessage;
            scrapeParams.limit = null; // Remove limit to get all new messages
        } else {
            logger.info(`📍 First scrape for this bookmark - getting latest 100 messages`);
        }


        const scrapeResult = await this._channelService.scrapeChannel(scrapeParams);
        
        if (!scrapeResult || !scrapeResult.messages || scrapeResult.messages.length === 0) 
        {
            logger.info(`No new messages found for channel ${channelName}`);
            
            // Still schedule next scrape based on previous interval
            if (latestScrape && latestScrape.timeDifference) {
                const nextInterval = this.calculateScrapeInterval(latestScrape.timeDifference);
                await this.scheduleNextScrape(bookmarkId, channelId, channelName, nextInterval);
            } else {
                // Default to 1 hour if no previous data
                await this.scheduleNextScrape(bookmarkId, channelId, channelName, 60 * 60 * 1000);
            }
            
            return {
                messageCount: 0,
                newMessages: false
            };
        }

         // Filter out any potential duplicates (safety check)
        let newMessages = scrapeResult.messages;
            if (latestScrape && latestScrape.firstMessageTimestamp) {
                const lastNewestTime = new Date(latestScrape.firstMessageTimestamp).getTime();
                
                // Keep only messages NEWER than what we already have
                newMessages = scrapeResult.messages.filter((msg: any) => {
                    const msgTime = new Date(msg.timestamp_raw || msg.timestamp).getTime();
                    return msgTime > lastNewestTime;
                });
                
                logger.info(`📊 Filtered: ${scrapeResult.messages.length} total, ${newMessages.length} truly new messages`);
            }
        
        // If no new messages after filtering, don't save
        if (newMessages.length === 0) {
            logger.info(`All messages were duplicates - skipping save`);
            
            // Schedule next scrape with longer interval (channel is less active)
            await this.scheduleNextScrape(bookmarkId, channelId, channelName, 2 * 60 * 60 * 1000);
            
            return {
                messageCount: 0,
                newMessages: false,
                duplicatesFiltered: scrapeResult.messages.length
            };
        }

        // Calculate time difference
        const firstTimestamp = new Date(newMessages[0].timestamp_raw || newMessages[0].timestamp);
        const lastTimestamp = new Date(newMessages[newMessages.length - 1].timestamp_raw || newMessages[newMessages.length - 1].timestamp);
        const timeDifference = Math.abs(lastTimestamp.getTime() - firstTimestamp.getTime());
        
        // Save ONLY new messages to S3
        const bookmark = await this._bookmarkRepository.getBookmarkById(bookmarkId);
        if (!bookmark) {
            throw new NotFoundError('Bookmark not found');
        }
        
        const timestamp = Date.now();
        const s3Key = `${bookmark.s3Prefix}/${timestamp}.json`;
        
        logger.info(`💾 Saving ${newMessages.length} new messages to S3: ${s3Key}`);
        await this._s3Service.uploadJson(s3Key, newMessages);
        
        // Save scrape metadata
        const scrapeData = await this._bookmarkRepository.createScrapeData({
            bookmarkId,
            channelId,
            s3Key,
            messageCount: newMessages.length,
            firstMessageTimestamp: firstTimestamp,
            lastMessageTimestamp: lastTimestamp,
            timeDifference
        });
        
        // Calculate next scrape interval based on activity
        const nextScrapeInterval = this.calculateScrapeInterval(timeDifference);
        const nextScrapeAt = new Date(Date.now() + nextScrapeInterval);
        
        // Update bookmark with next scrape time
        await this._bookmarkRepository.updateBookmark(bookmarkId, {
            lastScrapedAt: new Date(),
            nextScrapeAt,
            scrapeInterval: nextScrapeInterval
        });
        
        // Schedule next scrape
        await this.scheduleNextScrape(bookmarkId, channelId, channelName, nextScrapeInterval);
        
        logger.info(`✅ Scrape completed: ${newMessages.length} new messages saved`);
        logger.info(`⏰ Next scrape scheduled in ${this.formatInterval(nextScrapeInterval)}`);
        
        return {
                ...scrapeData,
                newMessagesCount: newMessages.length,
                latestMessageTime: firstTimestamp,  // For clarity
                oldestMessageTime: lastTimestamp     // For clarity
            };
        } catch (error) {
            logger.error(`Error processing scrape job for bookmark ${bookmarkId}:`, error);
            throw error;
        }
    }

    private async scheduleNextScrape(
        bookmarkId: string, 
        channelId: string, 
        channelName: string, 
        interval: number
    ) {
        await scrapeQueue.add('scrape-channel', {
            bookmarkId,
            channelId,
            channelName,
            isInitial: false
        }, {
            delay: interval
        });
    }
    
    async processAlertJob(bookmarkId: string) {
        try {
            const bookmark = await this._bookmarkRepository.getBookmarkById(bookmarkId);
            if (!bookmark || !bookmark.isActive) {
                logger.warn(`Bookmark ${bookmarkId} not found or inactive`);
                return;
            }

            const user = await this._userReposiotory.getUserById(bookmark.userId.toString());

            if(!user || !user.email) { 
                logger.warn(`User ${bookmark.userId} not found or email not set`);
                return;
            }

            // Get all unprocessed scrape data
            const scrapeDataList = await this._bookmarkRepository.getUnprocessedScrapeData(bookmarkId);
            
            if (scrapeDataList.length === 0) {
                console.log(`No new data to process for bookmark ${bookmarkId}`);

                await mailService.sendMail(
                    user.email,
                    'no-updates.ejs',
                    {
                        userName: user.firstName || 'User',
                        channelName: bookmark.channelName,
                        lastChecked: new Date()
                    },
                    `No updates for ${bookmark.channelName}`
                )
                return;
            }

            
            logger.info(`📥 Fetching ${scrapeDataList.length} scrape data files from S3`);

            const messagePromises = scrapeDataList.map(async (scrapeData) => {
                try {
                    const messages = await this._s3Service.getJson(scrapeData.s3Key);
                    return messages;
                } catch (error) {
                    logger.error(`Failed to fetch ${scrapeData.s3Key}:`, error);
                    return [];
                }
            });

            // Retrieve all messages from S3
            const messageArrays = await Promise.all(messagePromises);
            const allMessages = messageArrays.flat();
            
            if (allMessages.length === 0) {
                throw new Error('No messages could be retrieved from S3');
            }
            logger.info(`📊 Processing ${allMessages.length} messages for summarization`);

            // Send to GPT for summarization
            const summary = await this._channelService.summarizeMessages(allMessages, bookmark.channelName);

            const oldestScrape = scrapeDataList[0];
            const newestScrape = scrapeDataList[scrapeDataList.length - 1];
            const period = {
                from: oldestScrape.scrapedAt,
                to: newestScrape.scrapedAt || new Date()
            };

            logger.info(`📧 Sending summary email to ${user.email}`);

            await mailService.sendMail(
                user.email,
                'channel-summary.ejs', 
                {
                    userName: user.firstName || 'User',
                    channelName: bookmark.channelName,
                    summary: summary,
                    messageCount: allMessages.length,
                    periodFrom: period.from,
                    periodTo: period.to,
                    scrapeCount: scrapeDataList.length
                },
                `Daily Summary - ${bookmark.channelName}`
            );


            // Mark scrape data as processed
            const scrapeDataIds = scrapeDataList.map(sd => sd._id.toString());
            await this._bookmarkRepository.markScrapeDataAsProcessed(scrapeDataIds);

            logger.info(`✅ Alert processed successfully for bookmark ${bookmarkId}`);

            // Optional: Clean up old S3 files after processing
            // if (process.env.AUTO_CLEANUP_S3 === 'true') {
            //     await this.cleanupOldS3Files(scrapeDataList);
            // }

            // Here you would send the summary to the user (via email, notification, etc.)
            // For now, we'll just return it
            return {
                bookmarkId,
                channelName: bookmark.channelName,
                summary,
                messagesProcessed: allMessages.length,
                generatedAt: new Date()
            };
        } catch (error) {
            console.error(`Error processing alert job for bookmark ${bookmarkId}:`, error);
            throw error;
        }
    }

    // private async cleanupOldS3Files(scrapeDataList: any[]) {
    //     try {
    //         const keysToDelete = scrapeDataList.map(sd => sd.s3Key);
    //         if (keysToDelete.length > 0) {
    //             await this._s3Service.deleteMultipleObjects(keysToDelete);
    //             logger.info(`🧹 Cleaned up ${keysToDelete.length} S3 files`);
    //         }
    //     } catch (error) {
    //         logger.error('Failed to cleanup S3 files:', error);
    //         // Don't throw - this is optional cleanup
    //     }
    // }

    private calculateScrapeInterval(timeDifference: number): number {
        // If messages span less than 1 hour, scrape every hour
        if (timeDifference < 60 * 60 * 1000) {
        return 60 * 60 * 1000; // 1 hour
        }
        // If messages span 1-6 hours, use that interval
        if (timeDifference <= 6 * 60 * 60 * 1000) {
        return timeDifference;
        }
        // If messages span 6-24 hours, scrape every 6 hours
        if (timeDifference <= 24 * 60 * 60 * 1000) {
        return 6 * 60 * 60 * 1000; // 6 hours
        }
        // Otherwise, scrape once a day
        return 24 * 60 * 60 * 1000; // 24 hours
    }

    private async scheduleAlertJob(bookmark: any) {
        const [hours, minutes] = bookmark.alertTime.split(':').map(Number);

        const dayMap: Record<string, number> = {
            sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
            thursday: 4, friday: 5, saturday: 6
        };

        // Creating cron expression for the alert time 
        const cronDays = bookmark.alertDays
            .map((day: string) => dayMap[day.toLowerCase()])
            .filter((day: number) => day !== undefined)
            .sort()
            .join(',');
    
        // Creating cron expression for the alert time 
        const cronExpression = `${minutes} ${hours} * * ${cronDays}`;

        console.log(`📅 Scheduling alert for bookmark ${bookmark._id} at ${bookmark.alertTime} IST on days: ${bookmark.alertDays.join(', ')}`);

        await alertQueue.add(
            'process-alert',
            {
                bookmarkId: bookmark._id.toString(),
                userId: bookmark.userId.toString()
            },
            {
                repeat: {
                    cron: cronExpression,
                    tz: 'Asia/Kolkata' 
                },
                jobId: `alert-${bookmark._id}`
            }
        )
        const now = new Date();
        const nowIST = now.toLocaleString('en-IN', { 
            timeZone: 'Asia/Kolkata',
            hour12: false 
        });
        
        console.log(`⏰ Current IST tim2e: ${nowIST}`);
        console.log(`⏰ Next alert will trigger at: ${bookmark.alertTime} IST`);
    }

    async pauseBookmark(userId: string, bookmarkId: string) {
        const bookmark = await this._bookmarkRepository.getBookmarkById(bookmarkId);
        
        if (!bookmark) {
            throw new NotFoundError('Bookmark not found');
        }

        if (bookmark.userId.toString() !== userId) {
            throw new BadRequestError('Unauthorized to pause this bookmark');
        }

        // Remove jobs from queues but don't delete bookmark
        const scrapeJobs = await scrapeQueue.getJobs(['waiting', 'delayed']);
        const bookmarkScrapeJobs = scrapeJobs.filter(job => 
            job.data.bookmarkId === bookmarkId
        );

        for (const job of bookmarkScrapeJobs) {
            await job.remove();
            logger.info(`Removed scrape job ${job.id} for bookmark ${bookmarkId}`);
        }

        // Remove repeatable alert job
        const repeatableJobs = await alertQueue.getRepeatableJobs();
        const alertJob = repeatableJobs.find(job => job.id === `alert-${bookmarkId}`);
        
        if (alertJob) {
            await alertQueue.removeRepeatableByKey(alertJob.key);
            logger.info(`Removed alert job for bookmark ${bookmarkId}`);
        }

        // Update bookmark status
        const updatedBookmark = await this._bookmarkRepository.updateBookmark(bookmarkId, {
            isActive: false,
            nextScrapeAt: undefined
        });

        return updatedBookmark;
    }

     async resumeBookmark(userId: string, bookmarkId: string) {
        const bookmark = await this._bookmarkRepository.getBookmarkById(bookmarkId);
        
        if (!bookmark) {
            throw new NotFoundError('Bookmark not found');
        }

        if (bookmark.userId.toString() !== userId) {
            throw new BadRequestError('Unauthorized to resume this bookmark');
        }

        // Update bookmark to active
        await this._bookmarkRepository.updateBookmark(bookmarkId, {
            isActive: true
        });

        // Schedule an immediate scrape
        await scrapeQueue.add('scrape-channel', {
            bookmarkId: bookmark._id.toString(),
            channelId: bookmark.channelId,
            channelName: bookmark.channelName,
            isInitial: false
        }, {
            delay: 0
        });

        // Reschedule alert job
        await this.scheduleAlertJob(bookmark);

        logger.info(`Resumed bookmark ${bookmarkId}`);

        return bookmark;
    }

     async triggerManualScrape(userId: string, bookmarkId: string) {
        const bookmark = await this._bookmarkRepository.getBookmarkById(bookmarkId);
        
        if (!bookmark) {
            throw new NotFoundError('Bookmark not found');
        }

        if (bookmark.userId.toString() !== userId) {
            throw new BadRequestError('Unauthorized to trigger scrape for this bookmark');
        }

        // Add immediate scrape job
        const job = await scrapeQueue.add('scrape-channel', {
            bookmarkId: bookmark._id.toString(),
            channelId: bookmark.channelId,
            channelName: bookmark.channelName,
            isInitial: false,
            isManual: true
        }, {
            delay: 0,
            priority: 1 
        });

        logger.info(`Manual scrape triggered for bookmark ${bookmarkId}, job ${job.id}`);

        return {
            jobId: job.id,
            bookmarkId,
            channelName: bookmark.channelName,
            status: 'queued'
        };
    }

    async triggerManualAlert(userId: string, bookmarkId: string) {
        const bookmark = await this._bookmarkRepository.getBookmarkById(bookmarkId);
        
        if (!bookmark) {
            throw new NotFoundError('Bookmark not found');
        }

        if (bookmark.userId.toString() !== userId) {
            throw new BadRequestError('Unauthorized to trigger alert for this bookmark');
        }

        // Add immediate alert job
        const job = await alertQueue.add('process-alert', {
            bookmarkId: bookmark._id.toString(),
            userId: bookmark.userId.toString(),
            isManual: true
        }, {
            delay: 0,
            priority: 1
        });

        logger.info(`Manual alert triggered for bookmark ${bookmarkId}, job ${job.id}`);

        return {
            jobId: job.id,
            bookmarkId,
            channelName: bookmark.channelName,
            status: 'queued'
        };
    }

    async getBookmarkStatus(userId: string, bookmarkId: string) {
        const bookmark = await this._bookmarkRepository.getBookmarkById(bookmarkId);
        
        if (!bookmark) {
            throw new NotFoundError('Bookmark not found');
        }

        if (bookmark.userId.toString() !== userId) {
            throw new BadRequestError('Unauthorized to view this bookmark');
        }

        // Get latest scrape data
        const latestScrape = await this._bookmarkRepository.getLatestScrapeData(bookmarkId);
        
        // Get pending jobs
        const scrapeJobs = await scrapeQueue.getJobs(['waiting', 'delayed', 'active']);
        const alertJobs = await alertQueue.getJobs(['waiting', 'delayed', 'active']);
        
        const pendingScrapes = scrapeJobs.filter(job => 
            job.data.bookmarkId === bookmarkId
        );
        
        const pendingAlerts = alertJobs.filter(job => 
            job.data.bookmarkId === bookmarkId
        );

        // Get next scheduled alert
        const repeatableJobs = await alertQueue.getRepeatableJobs();
        const alertSchedule = repeatableJobs.find(job => job.id === `alert-${bookmarkId}`);

        return {
            bookmark: {
                id: bookmark._id,
                channelName: bookmark.channelName,
                alertTime: bookmark.alertTime,
                alertDays: bookmark.alertDays,
                isActive: bookmark.isActive
            },
            lastScrape: latestScrape ? {
                at: latestScrape.scrapedAt,
                messageCount: latestScrape.messageCount,
                processed: latestScrape.isProcessed
            } : null,
            nextScrape: bookmark.nextScrapeAt,
            nextAlert: alertSchedule?.next ? new Date(alertSchedule.next) : null,
            pendingJobs: {
                scrapes: pendingScrapes.length,
                alerts: pendingAlerts.length
            },
            scrapeInterval: bookmark.scrapeInterval ? 
                this.formatInterval(bookmark.scrapeInterval) : null
        };
    }

    private formatInterval(ms: number): string {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        }
        return `${minutes}m`;
    }

    
}

export default BookmarkService;