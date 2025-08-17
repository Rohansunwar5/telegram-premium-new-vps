import mongoose, { Schema } from "mongoose";

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
    },
    { timestamps: true }
);

bookmarkSchema.index({ userId: 1, channelId: 1 }, { unique: true });
bookmarkSchema.index({ nextScrapeAt: 1, isActive: 1 });
bookmarkSchema.index({ alertTime: 1, isActive: 1 });


export interface IBookmark extends mongoose.Document {
  _id: string;
  userId: string;
  channelName: string;
  channelId: string;
  alertTime: string;
  alertDays: string[];
  isActive: boolean;
  lastScrapedAt: Date | null;
  nextScrapeAt: Date | null;
  scrapeInterval: number | null;
  s3Prefix: string;
  createdAt: Date;
  updatedAt: Date;
}

export default mongoose.model<IBookmark>('Bookmark', bookmarkSchema);