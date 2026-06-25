import mongoose, { Schema } from 'mongoose';

const bookmarkSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        channelName: {
            type: String,
            required: true,
        },
        channelId: {
            type: String,
            required: true,
        },
        alertTime: {
            type: String,
            required: true,
        },
        alertDays: {
            type: [String],
            default: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        },
        triggerWords: {
            type: [String],
            default: [],
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        lastScrapedAt: {
            type: Date,
            default: null,
        },
        nextScrapeAt: {
            type: Date,
            default: null,
        },
        scrapeInterval: {
            type: Number,
            default: null,
        },
        s3Prefix: {
            type: String,
            required: true,
        },
        totalMessages: {
            type: Number,
            default: 0,
        },
        totalScrapes: {
            type: Number,
            default: 0,
        },
        uniqueUsersTotal: {
            type: Number,
            default: 0,
        },
        frequencyHourly: {
            type: [Number],
            default: () => new Array(24).fill(0)
        },
        frequencyUser: {
            type: Map,
            of: Number,
            default: () => new Map()
        },
        frequencyWeekday: {
            type: Map,
            of: Number,
            default: () => new Map([
                ['monday', 0],
                ['tuesday', 0],
                ['wednesday', 0],
                ['thursday', 0],
                ['friday', 0],
                ['saturday', 0],
                ['sunday', 0]
            ])
        },
        totalLinks: {
            type: Number,
            default: 0
        },
        firstMessageEver: {
            type: Date,
            default: null
        },
        lastMessageEver: {
            type: Date,
            default: null
        },
        lastStatisticsUpdate: {
            type: Date,
            default: null
        }
    },
    { timestamps: true }
);

bookmarkSchema.index({ userId: 1, channelId: 1 }, { unique: true });
bookmarkSchema.index({ nextScrapeAt: 1, isActive: 1 });
bookmarkSchema.index({ alertTime: 1, isActive: 1 });
// Covers the dashboard list: find({ userId, isActive }).sort({ createdAt: -1 })
bookmarkSchema.index({ userId: 1, isActive: 1, createdAt: -1 });


export interface IBookmark extends mongoose.Document {
 _id: string;
  userId: string;
  channelName: string;
  channelId: string;
  alertTime: string;
  alertDays: string[];
  triggerWords: string[];
  isActive: boolean;
  lastScrapedAt: Date | null;
  nextScrapeAt: Date | null;
  scrapeInterval: number | null;
  s3Prefix: string;
  totalMessages: number;
  totalScrapes: number;
  uniqueUsersTotal: number;
  frequencyHourly: number[];
  frequencyUser: Map<string, number>;
  frequencyWeekday: Map<string, number>;
  totalLinks: number;
  firstMessageEver: Date | null;
  lastMessageEver: Date | null;
  lastStatisticsUpdate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export default mongoose.model<IBookmark>('Bookmark', bookmarkSchema);