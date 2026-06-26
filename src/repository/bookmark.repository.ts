import mongoose from 'mongoose';
import bookmarkModel, { IBookmark } from '../models/bookmark.model';
import scrapeDataModel, { IScrapeData } from '../models/scrapeData.model';
import logger from '../utils/logger';
import { NotFoundError } from '../errors/not-found.error';

export interface ISeedBookmarkStats {
    totalMessages?: number;
    uniqueUsersTotal?: number;
    totalLinks?: number;
    frequencyHourly?: number[];
    frequencyUser?: Record<string, number>;
    frequencyWeekday?: Record<string, number>;
    firstMessageEver?: Date | string | null;
    lastMessageEver?: Date | string | null;
}

export interface ICreateBookmarkParams {
    userId: string;
    channelName: string;
    channelId: string;
    alertTime: string;
    alertDays?: string[];
    triggerWords?: string[];
    seedStats?: ISeedBookmarkStats;
}

interface IGetScrapeDataParams {
    bookmarkId: string;
    days?: number;
    limit?: number;
    page?: number;
}

export interface IUpdateBookmarkParams {
    alertTime?: string;
    alertDays?: string[];
    triggerWords?: string[];
    isActive?: boolean;
    lastScrapedAt?: Date;
    nextScrapeAt?: Date;
    scrapeInterval?: number;
    totalMessages?: number;
    totalScrapes?: number;
    uniqueUsersTotal?: number;
    frequencyHourly?: number[];
    frequencyUser?: Map<string, number>;
    frequencyWeekday?: Map<string, number>;
    totalLinks?: number;
    firstMessageEver?: Date | null;
    lastMessageEver?: Date | null;
    lastStatisticsUpdate?: Date | null;
}

export interface ICreateScrapeDataParams {
  bookmarkId: string;
  channelId: string;
  s3Key: string;
  messageCount: number;
  firstMessageTimestamp: Date;
  lastMessageTimestamp: Date;
  timeDifference: number;
  analysis?: {
    frequencyHourly: number[]; // Changed from frequency_hourly
    frequencyUser: Map<string, number> | Record<string, number>; // Changed from frequency_user
    frequencyWeekday: Map<string, number> | Record<string, number>; // Changed from frequency_weekday
    links: Array<{
      links: string[];
      messageId: number; // Changed from message_id
    }>;
    triggerFrequency?: Map<string, any> | Record<string, any>; // Changed from trigger_frequency
  };
  statistics?: {
    uniqueUsersCount: number; // Changed from unique_users_count
  };
}

export class BookmarkRepository {
    private _bookmarkModel = bookmarkModel;
    private _scrapeDataModel = scrapeDataModel;

    async createBookmark(params: ICreateBookmarkParams): Promise <IBookmark> {
        const { userId, channelName, channelId, alertTime, alertDays, triggerWords, seedStats } = params;
        const s3Prefix = `bookmarks/${userId}/${channelId}`;

        const doc: Record<string, any> = {
            userId,
            channelName,
            channelId,
            alertTime,
            alertDays,
            triggerWords: triggerWords || [],
            s3Prefix,
        };

        // Seed aggregate statistics from the channel analysis the user just viewed,
        // so the bookmark shows the same rich data immediately instead of zeros/1970.
        // Only defined values are copied so schema defaults still apply otherwise.
        if (seedStats) {
            const seedable: (keyof ISeedBookmarkStats)[] = [
                'totalMessages', 'uniqueUsersTotal', 'totalLinks',
                'frequencyHourly', 'frequencyUser', 'frequencyWeekday',
                'firstMessageEver', 'lastMessageEver',
            ];
            for (const key of seedable) {
                if (seedStats[key] !== undefined && seedStats[key] !== null) doc[key] = seedStats[key];
            }
            doc.totalScrapes = 1;
            doc.lastStatisticsUpdate = new Date();
            doc.lastScrapedAt = new Date();
        }

        return this._bookmarkModel.create(doc);
    }

    async getBookmarkById(bookmarkId: string, session?: mongoose.ClientSession):Promise<IBookmark | null> {
        return this._bookmarkModel.findById(bookmarkId).session(session ?? null);
    }

    async getBookmarkByUserAndChannel(userId: string, channelId: string): Promise<IBookmark | null> {
        return this._bookmarkModel.findOne({ userId, channelId });
    }

    async getUserBookmarks(userId: string): Promise<IBookmark[]> {
        return this._bookmarkModel.find({ userId, isActive: true }).sort({ createdAt: -1 });
    }

    async updateBookmark(bookmarkId: string, params: IUpdateBookmarkParams, session?: mongoose.ClientSession): Promise<IBookmark | null> {
        return this._bookmarkModel.findByIdAndUpdate(
            bookmarkId,
            { $set: params },
            { new: true, session: session ?? undefined }
        );
    }

    async getBookmarksWithTriggerWords(userId?: string): Promise<IBookmark[]> {
        const query: any = {
            isActive: true,
            triggerWords: { $exists: true, $ne: [], $not: { $size: 0 } }
        };

        if (userId) {
            query.userId = userId;
        }

        return this._bookmarkModel.find(query);
    }

    async deleteBookmark(bookmarkId: string): Promise<IBookmark | null> {
        return this._bookmarkModel.findByIdAndDelete(bookmarkId);
    }

    async getBookmarksForScraping(currentTime: Date): Promise<IBookmark[]> {
        return this._bookmarkModel.find({
        isActive: true,
        $or: [
            { nextScrapeAt: null },
            { nextScrapeAt: { $lte: currentTime } }
        ]
        });
    }

    async getBookmarksForAlert(alertTime: string, dayOfWeek: string): Promise<IBookmark[]> {
        return this._bookmarkModel.find({
        isActive: true,
        alertTime: alertTime,
        alertDays: dayOfWeek.toLowerCase()
        });
    }

    async createScrapeData(params: ICreateScrapeDataParams, session?: mongoose.ClientSession): Promise<IScrapeData> {
        try {
            logger.info(`Creating scrape data with params:`, {
                bookmarkId: params.bookmarkId,
                messageCount: params.messageCount,
                hasAnalysis: !!params.analysis,
                hasStatistics: !!params.statistics
            });

            // Process the data before saving
            const processedParams = { ...params };

            // Handle analysis data conversion
            if (params.analysis) {
                logger.info(`Processing analysis data:`, {
                    frequencyHourlyLength: params.analysis.frequencyHourly?.length || 0, // Updated logging
                    frequencyUserType: params.analysis.frequencyUser?.constructor?.name,
                    frequencyWeekdayType: params.analysis.frequencyWeekday?.constructor?.name,
                    linksLength: params.analysis.links?.length || 0
                });

                processedParams.analysis = {
                    frequencyHourly: params.analysis.frequencyHourly || [], // Updated field name
                    frequencyUser: params.analysis.frequencyUser instanceof Map
                        ? params.analysis.frequencyUser
                        : new Map(Object.entries(params.analysis.frequencyUser || {})),
                    frequencyWeekday: params.analysis.frequencyWeekday instanceof Map
                        ? params.analysis.frequencyWeekday
                        : new Map(Object.entries(params.analysis.frequencyWeekday || {})),
                    links: params.analysis.links || [],
                    triggerFrequency: params.analysis.triggerFrequency instanceof Map // Updated field name
                        ? params.analysis.triggerFrequency
                        : new Map(Object.entries(params.analysis.triggerFrequency || {}))
                };

                logger.info(`Processed analysis data:`, {
                    frequencyHourly: processedParams.analysis.frequencyHourly.length,
                    frequencyUserSize: processedParams.analysis.frequencyUser.size,
                    frequencyWeekdaySize: processedParams.analysis.frequencyWeekday.size,
                    linksCount: processedParams.analysis.links.length
                });
            }

            // Handle statistics data
            if (params.statistics) {
                logger.info(`Processing statistics data:`, params.statistics);
                processedParams.statistics = {
                    uniqueUsersCount: params.statistics.uniqueUsersCount || 0 // Updated field name
                };
            }

            // create() requires the array form when an options object (session) is passed.
            const scrapeData = session
                ? (await this._scrapeDataModel.create([processedParams], { session }))[0]
                : await this._scrapeDataModel.create(processedParams);

            logger.info(`✅ Scrape data created successfully with ID: ${scrapeData._id}`);
            logger.info(`Final saved data:`, {
                analysisFrequencyHourly: scrapeData.analysis?.frequencyHourly?.length || 0,
                analysisFrequencyUser: scrapeData.analysis?.frequencyUser?.size || 0,
                analysisFrequencyWeekday: scrapeData.analysis?.frequencyWeekday?.size || 0,
                analysisLinks: scrapeData.analysis?.links?.length || 0,
                statisticsUniqueUsers: scrapeData.statistics?.uniqueUsersCount || 0
            });

            return scrapeData;

        } catch (error) {
            logger.error(`Error creating scrape data:`, error);
            logger.error(`Params that failed:`, params);
            throw error;
        }
    }


    async getUnprocessedScrapeData(bookmarkId: string): Promise<IScrapeData[]> {
        return this._scrapeDataModel.find({
        bookmarkId,
        isProcessed: false
        }).sort({ scrapedAt: 1 });
    }

    async markScrapeDataAsProcessed(scrapeDataIds: string[]): Promise<void> {
        await this._scrapeDataModel.updateMany(
        { _id: { $in: scrapeDataIds } },
        {
            $set: {
            isProcessed: true,
            processedAt: new Date()
            }
        }
        );
    }

    // async getLatestScrapeData(bookmarkId: string): Promise<IScrapeData | null> {
    //     return this._scrapeDataModel.findOne({ bookmarkId }).sort({ scrapedAt: -1 });
    // }

    async getAllActiveBookmarks(): Promise<IBookmark[]> {
        return this._bookmarkModel.find({ isActive: true });
    }

    async getLatestScrapeData(bookmarkId: string): Promise<IScrapeData | null> {
        try {
            return await this._scrapeDataModel.findOne({
                bookmarkId
            })
            .sort({ firstMessageTimestamp: -1 }) // firstMessageTimestamp is the NEWEST message
            .exec();
        } catch (error) {
            logger.error('Error getting latest scrape data:', error);
            return null;
        }
    }

    // Batched version of getLatestScrapeData: returns the newest scrapeData per
    // bookmark in ONE aggregation (avoids the dashboard N+1). Keyed by bookmarkId string.
    async getLatestScrapeDataForBookmarks(bookmarkIds: string[]): Promise<Map<string, IScrapeData>> {
        const map = new Map<string, IScrapeData>();
        if (bookmarkIds.length === 0) return map;

        const objectIds = bookmarkIds.map((id) => new mongoose.Types.ObjectId(id));
        const rows = await this._scrapeDataModel.aggregate([
            { $match: { bookmarkId: { $in: objectIds } } },
            { $sort: { bookmarkId: 1, firstMessageTimestamp: -1 } },
            { $group: { _id: '$bookmarkId', doc: { $first: '$$ROOT' } } },
        ]);

        for (const row of rows) {
            map.set(row._id.toString(), row.doc as IScrapeData);
        }
        return map;
    }

    // Get the timestamp of the NEWEST message we have
    async getLatestMessageTimestamp(bookmarkId: string): Promise<Date | null> {
        try {
            const latestScrape = await this._scrapeDataModel.findOne({
                bookmarkId
            })
            .sort({ firstMessageTimestamp: -1 }) // Sort by NEWEST message
            .select('firstMessageTimestamp')
            .exec();

            return latestScrape?.firstMessageTimestamp || null; // Return the NEWEST message time
        } catch (error) {
            logger.error('Error getting latest message timestamp:', error);
            return null;
        }
    }

    async getBookmarkStatistics(bookmarkId: string): Promise<any> {
        const bookmark = await this.getBookmarkById(bookmarkId);
        if (!bookmark) {
            throw new NotFoundError('Bookmark not found');
        }

        return {
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
    }

    // Get scrape statistics with correct understanding
    async getScrapeStatistics(bookmarkId: string): Promise<any> {
        try {
            const stats = await this._scrapeDataModel.aggregate([
                { $match: { bookmarkId: new mongoose.Types.ObjectId(bookmarkId) } },
                {
                    $group: {
                        _id: null,
                        totalScrapes: { $sum: 1 },
                        totalMessages: { $sum: '$messageCount' },
                        processedCount: {
                            $sum: { $cond: ['$isProcessed', 1, 0] }
                        },
                        unprocessedCount: {
                            $sum: { $cond: ['$isProcessed', 0, 1] }
                        },
                        avgMessagesPerScrape: { $avg: '$messageCount' },
                        lastScrapeAt: { $max: '$scrapedAt' },
                        oldestMessageInDB: { $min: '$lastMessageTimestamp' },
                        newestMessageInDB: { $max: '$firstMessageTimestamp' }
                    }
                }
            ]);

            return stats[0] || {
                totalScrapes: 0,
                totalMessages: 0,
                processedCount: 0,
                unprocessedCount: 0,
                avgMessagesPerScrape: 0,
                lastScrapeAt: null,
                oldestMessageInDB: null,
                newestMessageInDB: null
            };
        } catch (error) {
            logger.error('Error getting scrape statistics:', error);
            return null;
        }
    }

    // Debug helper to show the timestamp ordering
    async debugTimestamps(bookmarkId: string): Promise<void> {
        const scrapes = await this._scrapeDataModel.find({ bookmarkId })
            .sort({ scrapedAt: -1 })
            .limit(3)
            .exec();

        console.log('\n📊 Timestamp Debug for Recent Scrapes:');
        scrapes.forEach((scrape, index) => {
            console.log(`\nScrape #${index + 1} (${scrape.scrapedAt}):`);
            console.log(`  First Message (NEWEST): ${scrape.firstMessageTimestamp}`);
            console.log(`  Last Message (OLDEST):  ${scrape.lastMessageTimestamp}`);
            console.log(`  Message Count: ${scrape.messageCount}`);
            console.log(`  Time Span: ${((scrape.firstMessageTimestamp.getTime() - scrape.lastMessageTimestamp.getTime()) / 1000 / 60).toFixed(2)} minutes`);
        });
    }

    async getBookmarkScrapeData(params: IGetScrapeDataParams) {
    const { bookmarkId, days, limit, page = 1 } = params;


    const query: any = { bookmarkId: new mongoose.Types.ObjectId(bookmarkId) };


    if (days && days > 0) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        query.scrapedAt = { $gte: cutoffDate };
    }


    const pipeline: any[] = [
        { $match: query },
        { $sort: { scrapedAt: -1 } }
    ];


    if (limit && limit > 0) {
        const skip = (page - 1) * limit;
        pipeline.push(
            { $skip: skip },
            { $limit: limit }
        );
    }

    pipeline.push({
        $project: {
            bookmarkId: 1,
            channelId: 1,
            s3Key: 1,
            messageCount: 1,
            firstMessageTimestamp: 1,
            lastMessageTimestamp: 1,
            timeDifference: 1,
            analysis: 1,
            statistics: 1,
            scrapedAt: 1,
            isProcessed: 1,
            processedAt: 1,
            createdAt: 1,
            updatedAt: 1
        }
    });

    const [scrapeData, totalCount] = await Promise.all([
        this._scrapeDataModel.aggregate(pipeline),
        this._scrapeDataModel.countDocuments(query)
    ]);

    const totalPages = limit ? Math.ceil(totalCount / limit) : 1;
    const hasNextPage = limit ? page < totalPages : false;
    const hasPrevPage = page > 1;

    return {
        data: scrapeData,
        pagination: {
            currentPage: page,
            totalPages,
            totalCount,
            hasNextPage,
            hasPrevPage,
            limit: limit || totalCount
        },
        summary: {
            totalScrapes: totalCount,
            totalMessages: scrapeData.reduce((sum: number, item: any) => sum + item.messageCount, 0),
            dateRange: {
                from: days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null,
                to: new Date()
            }
        }
    };


}

    async getScrapeDataByTimeWindow(bookmarkId: string, fromTime: Date, toTime: Date): Promise<IScrapeData[]> {
        try {
            return await this._scrapeDataModel.find({
                bookmarkId: new mongoose.Types.ObjectId(bookmarkId),
                createdAt: {
                    $gte: fromTime,
                    $lte: toTime
                }
            }).sort({ createdAt: 1 });
        } catch (error) {
            logger.error('Error fetching scrape data by time window:', error);
            throw error;
        }
    }

    async getScrapeDataByIds(scrapeDataIds: string[]): Promise<IScrapeData[]> {
        try {
            return await this._scrapeDataModel.find({
                _id: { $in: scrapeDataIds.map(id => new mongoose.Types.ObjectId(id)) }
            }).sort({ createdAt: 1 });
        } catch (error) {
            logger.error('Error fetching scrape data by IDs:', error);
            throw error;
        }
    }

}