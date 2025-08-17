import mongoose from "mongoose";
import bookmarkModel, { IBookmark } from "../models/bookmark.model";
import scrapeDataModel, { IScrapeData } from "../models/scrapeData.model";
import logger from "../utils/logger";

export interface ICreateBookmarkParams {
    userId: string;
    channelName: string;
    channelId: string;
    alertTime: string;
    alertDays?: string[];
}

export interface IUpdateBookmarkParams {
    alertTime?: string;
    alertDays?: string[];
    isActive?: boolean;
    lastScrapedAt?: Date;
    nextScrapeAt?: Date;
    scrapeInterval?: number;
}

export interface ICreateScrapeDataParams {
  bookmarkId: string;
  channelId: string;
  s3Key: string;
  messageCount: number;
  firstMessageTimestamp: Date;
  lastMessageTimestamp: Date;
  timeDifference: number;
}

export class BookmarkRepository {
    private _bookmarkModel = bookmarkModel;
    private _scrapeDataModel = scrapeDataModel;

    async createBookmark(params: ICreateBookmarkParams): Promise <IBookmark> {
        const { userId, channelName, channelId, alertTime, alertDays } = params;
        const s3Prefix = `bookmarks/${userId}/${channelId}`;
        
        return this._bookmarkModel.create({
        userId,
        channelName,
        channelId,
        alertTime,
        alertDays,
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
        return this._scrapeDataModel.create(params);
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
}