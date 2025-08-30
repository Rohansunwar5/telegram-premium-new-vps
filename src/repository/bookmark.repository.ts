import mongoose from "mongoose";
import bookmarkModel, { IBookmark } from "../models/bookmark.model";
import scrapeDataModel, { IScrapeData } from "../models/scrapeData.model";
import logger from "../utils/logger";
import { NotFoundError } from "../errors/not-found.error";

export interface ICreateBookmarkParams {
    userId: string;
    channelName: string;
    channelId: string;
    alertTime: string;
    alertDays?: string[];
    triggerWords?: string[];
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
    frequency_hourly: number[];
    frequency_user: Map<string, number> | Record<string, number>; // Support both formats
    frequency_weekday: Map<string, number> | Record<string, number>; // Support both formats
    links: Array<{
      links: string[];
      message_id: number;
    }>;
  };
  statistics?: {
    unique_users_count: number;
  };
}

export class BookmarkRepository {
    private _bookmarkModel = bookmarkModel;
    private _scrapeDataModel = scrapeDataModel;

    async createBookmark(params: ICreateBookmarkParams): Promise <IBookmark> {
        const { userId, channelName, channelId, alertTime, alertDays, triggerWords } = params;
        const s3Prefix = `bookmarks/${userId}/${channelId}`;
        
        return this._bookmarkModel.create({
        userId,
        channelName,
        channelId,
        alertTime,
        alertDays,
        triggerWords: triggerWords || [],
        s3Prefix,
        });
    }

    async getBookmarkById(bookmarkId: string):Promise<IBookmark | null> {
        return this._bookmarkModel.findById(bookmarkId);
    }

    async getBookmarkByUserAndChannel(userId: string, channelId: string): Promise<IBookmark | null> {
        return this._bookmarkModel.findOne({ userId, channelId });
    }

    async getUserBookmarks(userId: string): Promise<IBookmark[]> {
        return this._bookmarkModel.find({ userId, isActive: true }).sort({ createdAt: -1 });
    }

    async updateBookmark(bookmarkId: string, params: IUpdateBookmarkParams): Promise<IBookmark | null> {
        return this._bookmarkModel.findByIdAndUpdate(
            bookmarkId,
            { $set: params },
            { new: true }
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

    async createScrapeData(params: ICreateScrapeDataParams): Promise<IScrapeData> {
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
                    frequency_hourly_length: params.analysis.frequency_hourly?.length || 0,
                    frequency_user_type: params.analysis.frequency_user?.constructor?.name,
                    frequency_weekday_type: params.analysis.frequency_weekday?.constructor?.name,
                    links_length: params.analysis.links?.length || 0
                });

                processedParams.analysis = {
                    frequency_hourly: params.analysis.frequency_hourly || [],
                    frequency_user: params.analysis.frequency_user instanceof Map 
                        ? params.analysis.frequency_user 
                        : new Map(Object.entries(params.analysis.frequency_user || {})),
                    frequency_weekday: params.analysis.frequency_weekday instanceof Map 
                        ? params.analysis.frequency_weekday 
                        : new Map(Object.entries(params.analysis.frequency_weekday || {})),
                    links: params.analysis.links || []
                };

                logger.info(`Processed analysis data:`, {
                    frequency_hourly: processedParams.analysis.frequency_hourly.length,
                    frequency_user_size: processedParams.analysis.frequency_user.size,
                    frequency_weekday_size: processedParams.analysis.frequency_weekday.size,
                    links_count: processedParams.analysis.links.length
                });
            }

            // Handle statistics data
            if (params.statistics) {
                logger.info(`Processing statistics data:`, params.statistics);
                processedParams.statistics = {
                    unique_users_count: params.statistics.unique_users_count || 0
                };
            }

            const scrapeData = await this._scrapeDataModel.create(processedParams);
            
            logger.info(`✅ Scrape data created successfully with ID: ${scrapeData._id}`);
            logger.info(`Final saved data:`, {
                analysis_frequency_hourly: scrapeData.analysis?.frequency_hourly?.length || 0,
                analysis_frequency_user: scrapeData.analysis?.frequency_user?.size || 0,
                analysis_frequency_weekday: scrapeData.analysis?.frequency_weekday?.size || 0,
                analysis_links: scrapeData.analysis?.links?.length || 0,
                statistics_unique_users: scrapeData.statistics?.unique_users_count || 0
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
            .sort({ firstMessageTimestamp: -1 })  // firstMessageTimestamp is the NEWEST message
            .exec();
        } catch (error) {
            logger.error('Error getting latest scrape data:', error);
            return null;
        }
    }

    // Get the timestamp of the NEWEST message we have
    async getLatestMessageTimestamp(bookmarkId: string): Promise<Date | null> {
        try {
            const latestScrape = await this._scrapeDataModel.findOne({ 
                bookmarkId 
            })
            .sort({ firstMessageTimestamp: -1 })  // Sort by NEWEST message
            .select('firstMessageTimestamp')
            .exec();
            
            return latestScrape?.firstMessageTimestamp || null;  // Return the NEWEST message time
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
                        oldestMessageInDB: { $min: '$lastMessageTimestamp' },  // lastMessageTimestamp is OLDEST
                        newestMessageInDB: { $max: '$firstMessageTimestamp' }  // firstMessageTimestamp is NEWEST
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
    
    // Build the query
    let query: any = { bookmarkId: new mongoose.Types.ObjectId(bookmarkId) };
    
    // Add date filter if days is specified
    if (days && days > 0) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        query.scrapedAt = { $gte: cutoffDate };
    }

    // Build aggregation pipeline
    let pipeline: any[] = [
        { $match: query },
        { $sort: { scrapedAt: -1 } } // Most recent first
    ];

    // Add pagination if limit is specified
    if (limit && limit > 0) {
        const skip = (page - 1) * limit;
        pipeline.push(
            { $skip: skip },
            { $limit: limit }
        );
    }

    // Add lookup to get additional data if needed
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

    // Execute aggregation
    const [scrapeData, totalCount] = await Promise.all([
        this._scrapeDataModel.aggregate(pipeline),
        this._scrapeDataModel.countDocuments(query)
    ]);

    // Calculate pagination info
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

}