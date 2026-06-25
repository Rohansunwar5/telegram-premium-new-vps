import mongoose from 'mongoose';

const scrapeDataSchema = new mongoose.Schema(
    {
        bookmarkId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        channelId: {
            type: String,
            required: true,
            index: true,
        },
        s3Key: {
            type: String,
            required: true,
        },
        messageCount: {
            type: Number,
            required: true,
        },
        firstMessageTimestamp: {
            type: Date,
            required: true,
        },
        lastMessageTimestamp: {
            type: Date,
            required: true,
        },
        timeDifference: {
            type: Number,
            required: true,
        },
        analysis: {
            frequencyHourly: [Number], // Array of 24 numbers for hourly frequency
            frequencyUser: {
                type: Map,
                of: Number // Map of username to message count
            },
            frequencyWeekday: {
                type: Map,
                of: Number // Map of weekday to message count
            },
            links: [{
                links: [String],
                messageId: Number
            }],
            triggerFrequency: {
                type: Map,
                of: mongoose.Schema.Types.Mixed, // For flexible nested objects
                default: () => new Map()
            }
        },
        statistics: {
            uniqueUsersCount: Number
        },
        scrapedAt: {
            type: Date,
            default: Date.now,
        },
        isProcessed: {
            type: Boolean,
            default: false,
        },
        processedAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

scrapeDataSchema.index({ bookmarkId: 1, scrapedAt: -1 });
scrapeDataSchema.index({ bookmarkId: 1, isProcessed: 1 });
// Serves getLatestScrapeData + the batched getLatestScrapeDataForBookmarks sort.
scrapeDataSchema.index({ bookmarkId: 1, firstMessageTimestamp: -1 });

export interface IScrapeData extends mongoose.Document {
  _id: string;
  bookmarkId: string;
  channelId: string;
  s3Key: string;
  messageCount: number;
  firstMessageTimestamp: Date;
  lastMessageTimestamp: Date;
  timeDifference: number;
  analysis?: {
    frequencyHourly: number[];
    frequencyUser: Map<string, number>;
    frequencyWeekday: Map<string, number>;
    links: Array<{
      links: string[];
      messageId: number;
    }>;
    triggerFrequency: Map<string, any>;
  };
  statistics?: {
    uniqueUsersCount: number;
  };
  scrapedAt: Date;
  isProcessed: boolean;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export default mongoose.model<IScrapeData>('ScrapeData', scrapeDataSchema);