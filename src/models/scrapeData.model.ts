import mongoose from "mongoose";

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

export interface IScrapeData extends mongoose.Document {
  _id: string;
  bookmarkId: string;
  channelId: string;
  s3Key: string;
  messageCount: number;
  firstMessageTimestamp: Date;
  lastMessageTimestamp: Date;
  timeDifference: number;
  scrapedAt: Date;
  isProcessed: boolean;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export default mongoose.model<IScrapeData>('ScrapeData', scrapeDataSchema);