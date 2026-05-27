import mongoose from 'mongoose';

export type MediaKind = 'photo' | 'video' | 'audio' | 'sticker' | 'gif' | 'document' | 'unknown';

// Each entry is one turn in the conversation, stored in insertion order.
const messageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ['ai', 'target', 'manual'],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    mediaUrl: {
      type: String,
      default: null,
    },
    mediaKind: {
      type: String,
      default: null,
    },
    mediaMime: {
      type: String,
      default: null,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const decoySessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    decoyAccountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DecoyTelegramAccount',
      required: true,
    },
    // The identifier used to find the target on Telegram (phone or @username)
    targetIdentifier: {
      type: String,
      required: true,
      trim: true,
    },
    targetName: {
      type: String,
      trim: true,
      default: '',
    },
    // Resolved Telegram numeric user ID (stored as string to avoid BigInt issues)
    targetTelegramUserId: {
      type: String,
      default: null,
    },
    // Telegram message ID watermark — only messages with ID > this are processed
    lastProcessedMsgId: {
      type: Number,
      default: 0,
    },
    systemPrompt: {
      type: String,
      required: true,
    },
    targetContext: {
      type: String,
      default: '',
    },
    status: {
      type: String,
      enum: ['active', 'paused', 'stopped'],
      default: 'active',
    },
    messages: {
      type: [messageSchema],
      default: [],
    },
    lastPolledAt: {
      type: Date,
      default: null,
    },
    unseenCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

decoySessionSchema.index({ userId: 1, status: 1 });
// Used on server restart to resume active sessions
decoySessionSchema.index({ status: 1 });

export interface IDecoyMessage {
  role: 'ai' | 'target' | 'manual';
  content: string;
  mediaUrl?: string | null;
  mediaKind?: MediaKind | null;
  mediaMime?: string | null;
  timestamp: Date;
}

export interface IDecoySession extends mongoose.Document {
  _id: string;
  userId: mongoose.Types.ObjectId;
  decoyAccountId: mongoose.Types.ObjectId;
  targetIdentifier: string;
  targetName: string;
  targetTelegramUserId: string | null;
  lastProcessedMsgId: number;
  systemPrompt: string;
  targetContext: string;
  status: 'active' | 'paused' | 'stopped';
  messages: IDecoyMessage[];
  lastPolledAt: Date | null;
  unseenCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export default mongoose.model<IDecoySession>('DecoySession', decoySessionSchema);
