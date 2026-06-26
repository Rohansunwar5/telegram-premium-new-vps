import mongoose from 'mongoose';
import { alertQueue, scrapeQueue } from '../config/redis';
import { BadRequestError } from '../errors/bad-request.error';
import { InternalServerError } from '../errors/internal-server.error';
import { NotFoundError } from '../errors/not-found.error';
import { IScrapeData } from '../models/scrapeData.model';
import { BookmarkRepository, ISeedBookmarkStats } from '../repository/bookmark.repository';
import { UserRepository } from '../repository/user.repository';
import logger from '../utils/logger';
import { calculateScrapeInterval, formatInterval } from '../utils/scrapeInterval.util';
import { ChannelService } from './channel.service';
import mailService from './mail.service';
import { S3Service } from './s3.service';


interface IGetScrapeDataParams {
    userId: string;
    bookmarkId: string;
    days?: number;
    limit?: number;
    page?: number;
}


interface IBookmarkChannelParams {
    userId: string;
    channelName: string;
    channelId: string;
    alertTime: string;
    alertDays?: string[];
    triggerWords?: string[];
    seedStats?: ISeedBookmarkStats;
}

interface IUpdateBookmarksSettingsParams {
    userId: string;
    bookmarkId: string;
    alertTime?: string;
    alertDays?: string[];
    isActive?: boolean;
    triggerWords?: string[];
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
        const { userId, channelName, channelId, alertTime, alertDays, triggerWords, seedStats } = params;

        const existingBookmark = await this._bookmarkRepository.getBookmarkByUserAndChannel(userId, channelId);

        if(existingBookmark) throw new BadRequestError('Channel already bookmarked');


        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
        if (!timeRegex.test(alertTime)) throw new BadRequestError('Invalid alert time format. Use HH:mm format');

        const bookmark = await this._bookmarkRepository.createBookmark({
            userId,
            channelName,
            channelId,
            alertTime,
            alertDays,
            triggerWords,
            seedStats,
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

        await this.scheduleAlertJob(bookmark);

        return bookmark;
    }

    async getUserBookmarkslist(userId: string) {
        try {
            const bookmarks = await this._bookmarkRepository.getUserBookmarks(userId);

            return bookmarks;
        } catch (error) {
            logger.error('Error getting user bookmarks:', error);
            throw new InternalServerError('Failed to retrieve user bookmarks');
        }
    }

    async updateBookmarkSettings(params: IUpdateBookmarksSettingsParams) {
        const { userId, bookmarkId, alertTime, alertDays, isActive, triggerWords } = params;

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
            isActive,
            triggerWords
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

        // One batched query for the latest scrape of every bookmark (no N+1).
        const latestByBookmark = await this._bookmarkRepository.getLatestScrapeDataForBookmarks(
            bookmarks.map((b) => b._id.toString())
        );

        return bookmarks.map((bookmark) => {
            const latestScrape = latestByBookmark.get(bookmark._id.toString());
            return {
                ...bookmark.toObject(),
                lastScrapedAt: latestScrape?.scrapedAt || null,
                nextScrapeAt: bookmark.nextScrapeAt,
                messageCount: latestScrape?.messageCount || 0
            };
        });
    }

    async processScrapeJob(bookmarkId: string, channelId: string, channelName: string) {
        try {
            logger.info(`Starting scrape job for ${channelName}`);

            // Get bookmark to access triggerWords
            const bookmark = await this._bookmarkRepository.getBookmarkById(bookmarkId);
            if (!bookmark) {
                throw new NotFoundError('Bookmark not found');
            }

            const latestScrape = await this._bookmarkRepository.getLatestScrapeData(bookmarkId);

            const scrapeParams: any = {
                channelName,
                limit: 100,
            };

            // Add triggerWords if they exist
            if (bookmark.triggerWords && bookmark.triggerWords.length > 0) {
                scrapeParams.triggerWords = bookmark.triggerWords;
                logger.info(`🎯 Using trigger words: ${bookmark.triggerWords.join(', ')}`);
            }

            // IMPORTANT: firstMessageTimestamp is the NEWEST/LATEST message
            if (latestScrape && latestScrape.firstMessageTimestamp) {
                const lastNewestMessage = latestScrape.firstMessageTimestamp; // This is the LATEST message from last scrape
                logger.info(`📍 Last newest message was at: ${lastNewestMessage}`);

                // Only get messages NEWER than the latest message we already have
                scrapeParams.since = lastNewestMessage;
                scrapeParams.limit = null; // Remove limit to get all new messages
            } else if (bookmark.firstMessageEver || bookmark.lastMessageEver) {
                // Bookmark was seeded from the channel analysis at creation but has no
                // scrape record yet. Use the newest seeded message time as the cursor so
                // this first scrape only fetches messages newer than what the analysis
                // already counted — otherwise we'd re-count those ~100 and show false data.
                // (firstMessageEver/lastMessageEver naming is inconsistent upstream, so
                // take the later of the two defensively.)
                const seedCursor = [bookmark.firstMessageEver, bookmark.lastMessageEver]
                    .filter((d): d is Date => !!d)
                    .sort((a, b) => b.getTime() - a.getTime())[0];
                logger.info(`📍 Using seeded analysis cursor: ${seedCursor}`);
                scrapeParams.since = seedCursor;
                scrapeParams.limit = null;
            } else {
                logger.info(`📍 First scrape for this bookmark - getting latest 100 messages`);
            }

            const scrapeResult = await this._channelService.scrapeChannel(scrapeParams);

            logger.info(`Scrape result for ${channelName}:  ${scrapeResult}`);

            if (!scrapeResult || !scrapeResult.messages || scrapeResult.messages.length === 0)
            {
                if (latestScrape && latestScrape.timeDifference) {
                    const nextInterval = calculateScrapeInterval(latestScrape.timeDifference);
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

                newMessages = scrapeResult.messages.filter((msg: any) => {
                    const msgTime = new Date(msg.timestamp_raw || msg.timestamp).getTime();
                    return msgTime > lastNewestTime;
                });

                logger.info(`📊 Filtered: ${scrapeResult.messages.length} total, ${newMessages.length} truly new messages`);
            }

            if (newMessages.length === 0) {
                logger.info(`All messages were duplicates - skipping save`);

                // Schedule next scrape with longer interval (channel is less active
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
            const timestamp = Date.now();
            const s3Key = `${bookmark.s3Prefix}/${timestamp}.json`;

            logger.info(`💾 Saving ${newMessages.length} new messages to S3: ${s3Key}`);
            await this._s3Service.uploadJson(s3Key, newMessages);

            // Save scrape metadata with updated camelCase field names
            const scrapeDataPayload: any = {
                bookmarkId,
                channelId,
                s3Key,
                messageCount: newMessages.length,
                firstMessageTimestamp: firstTimestamp,
                lastMessageTimestamp: lastTimestamp,
                timeDifference
            };

            if (scrapeResult.analysis) {
                logger.info(`📊 Processing analysis data: ${Object.keys(scrapeResult.analysis).join(', ')}`);

                scrapeDataPayload.analysis = {
                frequencyHourly: scrapeResult.analysis.frequency_hourly || [],
                frequencyUser: scrapeResult.analysis.frequency_user
                    ? new Map(Object.entries(scrapeResult.analysis.frequency_user))
                    : new Map(),
                frequencyWeekday: scrapeResult.analysis.frequency_weekday
                    ? new Map(Object.entries(scrapeResult.analysis.frequency_weekday))
                    : new Map(),
                links: (scrapeResult.analysis.links || []).map((linkGroup: any) => ({
                    links: linkGroup.links || [],
                    messageId: linkGroup.message_id || 0
                })),
                triggerFrequency: scrapeResult.analysis.trigger_frequency
                    ? new Map(Object.entries(scrapeResult.analysis.trigger_frequency))
                    : new Map()
                };

                logger.info(`📊 Analysis data prepared:`, {
                    hourlyCount: scrapeDataPayload.analysis.frequencyHourly.length,
                    userCount: scrapeDataPayload.analysis.frequencyUser.size,
                    weekdayCount: scrapeDataPayload.analysis.frequencyWeekday.size,
                    linksCount: scrapeDataPayload.analysis.links.length,
                    triggerFrequencyCount: scrapeDataPayload.analysis.triggerFrequency.size
                });
            }

            if (scrapeResult.statistics) {
                logger.info(`📈 Processing statistics data: ${Object.keys(scrapeResult.statistics).join(', ')}`);

                scrapeDataPayload.statistics = {
                    uniqueUsersCount: scrapeResult.statistics.unique_users_count
                };

                logger.info(`📈 Statistics data prepared: ${scrapeDataPayload.statistics.uniqueUsersCount} unique users`);
            }

            logger.info(`💾 Creating scrape data document with payload:`, {
                messageCount: scrapeDataPayload.messageCount,
                hasAnalysis: !!scrapeDataPayload.analysis,
                hasStatistics: !!scrapeDataPayload.statistics
            });

            // Calculate next scrape interval based on activity
            const nextScrapeInterval = calculateScrapeInterval(timeDifference);
            const nextScrapeAt = new Date(Date.now() + nextScrapeInterval);

            // Persist atomically: create scrapeData + update aggregate stats +
            // advance the schedule commit together, so a crash can't leave the
            // stats stale relative to the stored data. A retried job re-runs the
            // since-filter above and no-ops (idempotent) since the new data is
            // already the latest.
            const scrapeData = await this.persistScrapeResult(bookmarkId, scrapeDataPayload, {
                lastScrapedAt: new Date(),
                nextScrapeAt,
                scrapeInterval: nextScrapeInterval
            });

            logger.info(`✅ Scrape data created with ID: ${scrapeData._id}`);
            logger.info(`📊 Saved analysis data:`, {
                frequencyHourlySaved: scrapeData.analysis?.frequencyHourly?.length || 0,
                frequencyUserSaved: scrapeData.analysis?.frequencyUser?.size || 0,
                frequencyWeekdaySaved: scrapeData.analysis?.frequencyWeekday?.size || 0,
                linksSaved: scrapeData.analysis?.links?.length || 0,
                uniqueUsersSaved: scrapeData.statistics?.uniqueUsersCount || 0
            });

            // Schedule next scrape
            await this.scheduleNextScrape(bookmarkId, channelId, channelName, nextScrapeInterval);

            logger.info(`✅ Scrape completed: ${newMessages.length} new messages saved`);
            logger.info(`⏰ Next scrape scheduled in ${formatInterval(nextScrapeInterval)}`);

            return {
                ...scrapeData.toObject(),
                newMessagesCount: newMessages.length,
                latestMessageTime: firstTimestamp, // For clarity
                oldestMessageTime: lastTimestamp // For clarity
            };
        } catch (error) {
            logger.error(`Error processing scrape job for bookmark ${bookmarkId}:`, error);
            throw error;
        }
    }

    // Commit create-scrapeData + aggregate-stats + schedule-advance in one
    // transaction. Falls back to sequential writes on a non-replica-set Mongo
    // (e.g. a standalone local dev instance) so dev still works.
    private async persistScrapeResult(
        bookmarkId: string,
        scrapeDataPayload: any,
        bookmarkUpdate: { lastScrapedAt: Date; nextScrapeAt: Date; scrapeInterval: number }
    ): Promise<IScrapeData> {
        const writes = async (session?: mongoose.ClientSession): Promise<IScrapeData> => {
            const scrapeData = await this._bookmarkRepository.createScrapeData(scrapeDataPayload, session);
            await this.updateBookmarkAggregateStatistics(bookmarkId, scrapeData, session);
            await this._bookmarkRepository.updateBookmark(bookmarkId, bookmarkUpdate, session);
            return scrapeData;
        };

        const session = await mongoose.startSession();
        try {
            let scrapeData!: IScrapeData;
            await session.withTransaction(async () => {
                scrapeData = await writes(session);
            });
            return scrapeData;
        } catch (err: unknown) {
            if (this.isTransactionUnsupported(err)) {
                logger.warn('Mongo transactions unavailable — persisting scrape result without a transaction');
                return writes();
            }
            throw err;
        } finally {
            await session.endSession();
        }
    }

    private isTransactionUnsupported(err: unknown): boolean {
        const e = err as { code?: number; message?: string };
        return e?.code === 20 ||
            /Transaction numbers are only allowed on a replica set|replica set member or mongos|Transactions are not supported/i.test(String(e?.message || ''));
    }

    private async updateBookmarkAggregateStatistics(bookmarkId: string, scrapeData: IScrapeData, session?: mongoose.ClientSession) {
        try {
            const bookmark = await this._bookmarkRepository.getBookmarkById(bookmarkId, session);
            if (!bookmark) {
                logger.error(`Bookmark ${bookmarkId} not found when updating statistics`);
                return;
            }

            const updates: any = {};

            // Initialize aggregate statistics if not present
            updates.totalMessages = (bookmark.totalMessages || 0) + scrapeData.messageCount;
            updates.totalScrapes = (bookmark.totalScrapes || 0) + 1;

            logger.info(`📊 Updating statistics - Messages: +${scrapeData.messageCount}, Scrapes: +1`);

            // Update unique users (take the maximum as it's cumulative)
            if (scrapeData.statistics?.uniqueUsersCount) {
                const oldUniqueUsers = bookmark.uniqueUsersTotal || 0;
                updates.uniqueUsersTotal = Math.max(oldUniqueUsers, scrapeData.statistics.uniqueUsersCount);
                logger.info(`👥 Unique users: ${oldUniqueUsers} -> ${updates.uniqueUsersTotal}`);
            }

            // Update hourly frequency
            if (scrapeData.analysis?.frequencyHourly && Array.isArray(scrapeData.analysis.frequencyHourly)) {
                logger.info(`⏰ Processing hourly frequency data with ${scrapeData.analysis.frequencyHourly.length} hours`);

                const currentHourly = bookmark.frequencyHourly || new Array(24).fill(0);
                updates.frequencyHourly = [...currentHourly];

                scrapeData.analysis.frequencyHourly.forEach((count, hour) => {
                    if (hour >= 0 && hour < 24 && typeof count === 'number') {
                        updates.frequencyHourly[hour] = (updates.frequencyHourly[hour] || 0) + count;
                        if (count > 0) {
                            logger.info(`⏰ Hour ${hour}: +${count} messages`);
                        }
                    }
                });
            }

            // Update user frequency
            if (scrapeData.analysis?.frequencyUser && scrapeData.analysis.frequencyUser instanceof Map) {
                logger.info(`👤 Processing user frequency data for ${scrapeData.analysis.frequencyUser.size} users`);

                const currentUserMap = bookmark.frequencyUser || new Map();
                updates.frequencyUser = new Map(currentUserMap);

                scrapeData.analysis.frequencyUser.forEach((count, username) => {
                    const currentCount = updates.frequencyUser.get(username) || 0;
                    updates.frequencyUser.set(username, currentCount + count);
                    logger.info(`👤 User ${username}: +${count} messages (total: ${currentCount + count})`);
                });
            }

            // Update weekday frequency
            if (scrapeData.analysis?.frequencyWeekday && scrapeData.analysis.frequencyWeekday instanceof Map) {
                logger.info(`📅 Processing weekday frequency data for ${scrapeData.analysis.frequencyWeekday.size} days`);

                const currentWeekdayMap = bookmark.frequencyWeekday || new Map([
                    ['monday', 0], ['tuesday', 0], ['wednesday', 0],
                    ['thursday', 0], ['friday', 0], ['saturday', 0], ['sunday', 0]
                ]);
                updates.frequencyWeekday = new Map(currentWeekdayMap);

                scrapeData.analysis.frequencyWeekday.forEach((count, weekday) => {
                    const currentCount = updates.frequencyWeekday.get(weekday.toLowerCase()) || 0;
                    updates.frequencyWeekday.set(weekday.toLowerCase(), currentCount + count);
                    logger.info(`📅 ${weekday}: +${count} messages (total: ${currentCount + count})`);
                });
            }

            // Update links count
            if (scrapeData.analysis?.links && Array.isArray(scrapeData.analysis.links)) {
                const linkCount = scrapeData.analysis.links.reduce((total, linkGroup) => {
                    return total + (linkGroup.links?.length || 0);
                }, 0);
                updates.totalLinks = (bookmark.totalLinks || 0) + linkCount;
                logger.info(`🔗 Added ${linkCount} links (total: ${updates.totalLinks})`);
            }

            // Update time ranges
            if (!bookmark.firstMessageEver || scrapeData.firstMessageTimestamp < bookmark.firstMessageEver) {
                updates.firstMessageEver = scrapeData.firstMessageTimestamp;
                logger.info(`📅 Updated first message ever: ${updates.firstMessageEver}`);
            }
            if (!bookmark.lastMessageEver || scrapeData.lastMessageTimestamp > bookmark.lastMessageEver) {
                updates.lastMessageEver = scrapeData.lastMessageTimestamp;
                logger.info(`📅 Updated last message ever: ${updates.lastMessageEver}`);
            }

            updates.lastStatisticsUpdate = new Date();

            // Save updated bookmark
            await this._bookmarkRepository.updateBookmark(bookmarkId, updates, session);

            logger.info(`✅ Updated statistics for bookmark ${bookmarkId}: ${updates.totalMessages} total messages, ${updates.totalScrapes} scrapes`);

        } catch (error) {
            logger.error(`Error updating bookmark statistics for ${bookmarkId}:`, error);
            // Inside a transaction, propagate so the whole scrape write rolls back
            // instead of committing with stale stats.
            if (session) throw error;
        }
    }

    private async scheduleNextScrape(bookmarkId: string, channelId: string, channelName: string, interval: number ) {
        await scrapeQueue.add('scrape-channel', {bookmarkId,channelId,channelName,isInitial: false } , { delay: interval });
    }

    private calculateManualAlertTimeWindow(alertTime: string) {
        const now = new Date();
        const fromTime = new Date(now.getTime() - 24 * 60 * 60 * 1000); // Exactly 24 hours ago

        console.log('Current time (now):', now.toISOString());
        console.log('24 hours ago:', fromTime.toISOString());

        return {
            from: fromTime,
            to: now,
            alertTime,
            explanation: `Last 24 hours of scraped data`
        };
    }

    async triggerManualAlert(userId: string, bookmarkId: string) {
        const bookmark = await this._bookmarkRepository.getBookmarkById(bookmarkId);

        if (!bookmark) throw new NotFoundError('Bookmark not found');

        if (bookmark.userId.toString() !== userId) throw new BadRequestError('Unauthorized to trigger alert for this bookmark');

        const user = await this._userReposiotory.getUserById(bookmark.userId.toString());
        if (!user || !user.email) throw new BadRequestError('User not found or email not set');

        const timeWindow = this.calculateManualAlertTimeWindow(bookmark.alertTime);

        const relevantScrapeData = await this._bookmarkRepository.getScrapeDataByTimeWindow(
            bookmarkId,
            timeWindow.from,
            timeWindow.to
        );

        if (relevantScrapeData.length === 0) {
            await mailService.sendMail(
                user.email,
                'no-updates.ejs',
                {
                    userName: user.firstName || 'User',
                    channelName: bookmark.channelName,
                    lastChecked: new Date(),
                },
                `No updates for ${bookmark.channelName} (Manual Alert)`
            );

            return {
                bookmarkId,
                channelName: bookmark.channelName,
                summary: 'No new data available for this time window',
                messagesProcessed: 0,
                generatedAt: new Date(),
                status: 'no_data_in_window',
                timeWindow
            };
        }

        logger.info(`Processing ${relevantScrapeData.length} scrape data files for manual alert`);

        const messagePromises = relevantScrapeData.map(async (scrapeData) => {
            try {
                const messages = await this._s3Service.getJson(scrapeData.s3Key);
                return messages;
            } catch (error) {
                logger.error(`Failed to fetch ${scrapeData.s3Key}:`, error);
                return [];
            }
        });

        const messageArrays = await Promise.all(messagePromises);
        const allMessages = messageArrays.flat();

        if (allMessages.length === 0) {
            throw new BadRequestError('No messages could be retrieved from S3');
        }

        logger.info(`Processing ${allMessages.length} messages for manual alert summarization`);

        const summary = await this._channelService.summarizeMessages(allMessages, bookmark.channelName);

        await mailService.sendMail(
            user.email,
            'channel-summary.ejs',
            {
                userName: user.firstName || 'User',
                channelName: bookmark.channelName,
                summary: summary,
                messageCount: allMessages.length,
                periodFrom: timeWindow.from,
                periodTo: timeWindow.to,
                scrapeCount: relevantScrapeData.length,
                isManualAlert: true,
            },
            `Manual Alert - ${bookmark.channelName}`
        );

        logger.info(`Manual alert completed successfully for bookmark ${bookmarkId} without affecting scheduler`);

        return {
            bookmarkId,
            channelName: bookmark.channelName,
            summary,
            messagesProcessed: allMessages.length,
            generatedAt: new Date(),
            status: 'success',
            timeWindow,
            scrapeCount: relevantScrapeData.length,
        };
    }

    async processAlertJob(bookmarkId: string) {
        try {
            const bookmark = await this._bookmarkRepository.getBookmarkById(bookmarkId);
            if (!bookmark || !bookmark.isActive) {
                logger.warn(`Bookmark ${bookmarkId} not found or inactive`);
                return {
                    bookmarkId,
                    channelName: bookmark ? bookmark.channelName : null,
                    summary: null,
                    messagesProcessed: 0,
                    generatedAt: new Date(),
                    status: 'no_user_or_email'
                };
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
                );
                return {
                    bookmarkId,
                    channelName: bookmark.channelName,
                    summary: 'No new updates available',
                    messagesProcessed: 0,
                    generatedAt: new Date(),
                    status: 'no_new_data',
                    lastChecked: new Date()
                };
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
                generatedAt: new Date(),
                status: 'success',
                period: {
                    from: period.from,
                    to: period.to
                },
                scrapeCount: scrapeDataList.length
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
        );
        const now = new Date();
        const nowIST = now.toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour12: false
        });

        console.log(`⏰ Current IST time: ${nowIST}`);
        console.log(`⏰ Next alert will trigger at: ${bookmark.alertTime} IST`);
    }

    async getBookmarkById(userId: string, bookmarkId: string) {
        try {
            const bookmark = await this._bookmarkRepository.getBookmarkById(bookmarkId);

            if (!bookmark) {
                throw new NotFoundError('Bookmark not found');
            }

            // Verify the bookmark belongs to the requesting user
            if (bookmark.userId.toString() !== userId) {
                throw new NotFoundError('Bookmark not found');
            }

            return bookmark;
        } catch (error) {
            if (error instanceof NotFoundError) {
                throw error;
            }
            logger.error('Error getting bookmark by ID:', error);
            throw new InternalServerError('Failed to retrieve bookmark');
        }
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
                formatInterval(bookmark.scrapeInterval) : null
        };
    }

    async getBookmarkDashboardStats(bookmarkId: string, userId: string) {
    const bookmark = await this._bookmarkRepository.getBookmarkById(bookmarkId);

    if (!bookmark) {
        throw new NotFoundError('Bookmark not found');
    }

    if (bookmark.userId.toString() !== userId) {
        throw new BadRequestError('Unauthorized to view this bookmark statistics');
    }

    // Convert Maps to plain objects for JSON serialization
    const serializedStats = {
        totalMessages: bookmark.totalMessages || 0,
        totalScrapes: bookmark.totalScrapes || 0,
        uniqueUsersTotal: bookmark.uniqueUsersTotal || 0,
        frequencyHourly: bookmark.frequencyHourly || new Array(24).fill(0),
        frequencyUser: bookmark.frequencyUser ? Object.fromEntries(bookmark.frequencyUser) : {},
        frequencyWeekday: bookmark.frequencyWeekday ? Object.fromEntries(bookmark.frequencyWeekday) : {},
        totalLinks: bookmark.totalLinks || 0,
        firstMessageEver: bookmark.firstMessageEver,
        lastMessageEver: bookmark.lastMessageEver,
        lastStatisticsUpdate: bookmark.lastStatisticsUpdate
    };

    return {
        bookmarkId: bookmark._id,
        channelName: bookmark.channelName,
        isActive: bookmark.isActive,
        lastScrapedAt: bookmark.lastScrapedAt,
        nextScrapeAt: bookmark.nextScrapeAt,
        createdAt: bookmark.createdAt,
        statistics: serializedStats,
        // Additional useful calculated fields
        timeRange: {
            firstMessage: bookmark.firstMessageEver,
            lastMessage: bookmark.lastMessageEver,
            totalDuration: bookmark.firstMessageEver && bookmark.lastMessageEver
                ? bookmark.lastMessageEver.getTime() - bookmark.firstMessageEver.getTime()
                : null
        },
        averageMessagesPerScrape: (bookmark.totalScrapes || 0) > 0
            ? Math.round((bookmark.totalMessages || 0) / bookmark.totalScrapes)
            : 0,
        mostActiveHour: serializedStats.frequencyHourly.indexOf(Math.max(...serializedStats.frequencyHourly)),
        topUsers: Object.entries(serializedStats.frequencyUser)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 5)
            .map(([user, count]) => ({ user, count }))
    };
}

async getBookmarkScrapeData(params: IGetScrapeDataParams) {
    const { userId, bookmarkId, days = 2, limit, page = 1 } = params;

    // Verify bookmark ownership
    const bookmark = await this._bookmarkRepository.getBookmarkById(bookmarkId);
    if (!bookmark) {
        throw new NotFoundError('Bookmark not found');
    }

    if (bookmark.userId.toString() !== userId) {
        throw new BadRequestError('Unauthorized to access this bookmark data');
    }

    // Get scrape data documents from MongoDB
    return await this._bookmarkRepository.getBookmarkScrapeData({
        bookmarkId,
        days,
        limit,
        page
    });
}

    async getAllUserDashboardStats(userId: string) {
    const bookmarks = await this._bookmarkRepository.getUserBookmarks(userId);

    const dashboardStats = bookmarks.map(bookmark => ({
        bookmarkId: bookmark._id,
        channelName: bookmark.channelName,
        isActive: bookmark.isActive,
        lastScrapedAt: bookmark.lastScrapedAt,
        nextScrapeAt: bookmark.nextScrapeAt,
        summary: {
            totalMessages: bookmark.totalMessages || 0,
            totalScrapes: bookmark.totalScrapes || 0,
            uniqueUsers: bookmark.uniqueUsersTotal || 0,
            totalLinks: bookmark.totalLinks || 0,
            averageMessagesPerScrape: (bookmark.totalScrapes || 0) > 0
                ? Math.round((bookmark.totalMessages || 0) / bookmark.totalScrapes)
                : 0,
            lastUpdate: bookmark.lastStatisticsUpdate,
            mostActiveDay: bookmark.frequencyWeekday && bookmark.frequencyWeekday.size > 0
                ? Array.from(bookmark.frequencyWeekday.entries())
                    .reduce((a, b) => a[1] > b[1] ? a : b)[0]
                : null
        }
    }));

    // Calculate overall user statistics
    const overallStats = dashboardStats.reduce((acc, bookmark) => {
        acc.totalMessages += bookmark.summary.totalMessages;
        acc.totalScrapes += bookmark.summary.totalScrapes;
        acc.totalLinks += bookmark.summary.totalLinks;
        acc.activeBookmarksCount += bookmark.isActive ? 1 : 0;
        acc.totalBookmarksCount += 1;

        // Track max unique users across all channels
        if (bookmark.summary.uniqueUsers > acc.maxUniqueUsersInChannel) {
            acc.maxUniqueUsersInChannel = bookmark.summary.uniqueUsers;
        }

        return acc;
    }, {
        totalMessages: 0,
        totalScrapes: 0,
        totalLinks: 0,
        activeBookmarksCount: 0,
        totalBookmarksCount: 0,
        maxUniqueUsersInChannel: 0
    });

    return {
        overallStats,
        bookmarks: dashboardStats
    };

}

}

export default BookmarkService;