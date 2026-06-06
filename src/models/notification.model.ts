import mongoose from 'mongoose';

export type NotificationType = 'new_message' | 'status_change' | 'objective_update';

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DecoySession',
      required: true,
    },
    type: {
      type: String,
      enum: ['new_message', 'status_change', 'objective_update'],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    body: {
      type: String,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

// Primary query pattern: fetch user's notifications sorted by newest
notificationSchema.index({ userId: 1, createdAt: -1 });

// TTL index: auto-expire notifications after 30 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export interface INotification extends mongoose.Document {
  _id: string;
  userId: mongoose.Types.ObjectId;
  sessionId: mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  read: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export default mongoose.model<INotification>('Notification', notificationSchema);
