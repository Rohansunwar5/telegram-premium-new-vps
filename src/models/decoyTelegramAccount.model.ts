import mongoose from 'mongoose';

const decoyTelegramAccountSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
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
    // All sessions currently running on this account.
    // An account can be shared across multiple concurrent sessions.
    activeSessions: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'DecoySession',
      default: [],
    },
  },
  { timestamps: true }
);

decoyTelegramAccountSchema.index({ activeSessions: 1 });

export interface IDecoyTelegramAccount extends mongoose.Document {
  _id: string;
  phoneNumber: string;
  apiId: number;
  apiHash: string;
  sessionString: string;
  activeSessions: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

export default mongoose.model<IDecoyTelegramAccount>(
  'DecoyTelegramAccount',
  decoyTelegramAccountSchema
);
