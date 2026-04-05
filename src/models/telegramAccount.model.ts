import mongoose from 'mongoose';

const telegramAccountSchema = new mongoose.Schema(
    {
        apiId: {
            type: Number,
            required: true,
        },
        apiHash: {
            type: String,
            required: true,
        },
        sessionString: {
            type: String,
            required: true,
        },
        phoneNumber: {
            type: String,
            required: true,
        },
        lastUsed: {
            type: Date,
            default: null,
        },
        rateLimitedUntil: {
            type: Date,
            default: null,
        },
        usageCount: {
            type: Number,
            default: 0,
        },
        index: {
            type: Number,
            required: true,
            unique: true,
        },
    },
    { timestamps: true }
);

telegramAccountSchema.index({ usageCount: 1 });
telegramAccountSchema.index({ rateLimitedUntil: 1 });

export interface ITelegramAccount extends mongoose.Document {
    _id: string;
    apiId: number;
    apiHash: string;
    sessionString: string;
    phoneNumber: string;
    lastUsed: Date | null;
    rateLimitedUntil: Date | null;
    usageCount: number;
    index: number;
    createdAt: Date;
    updatedAt: Date;
}

export default mongoose.model<ITelegramAccount>('TelegramAccount', telegramAccountSchema);
