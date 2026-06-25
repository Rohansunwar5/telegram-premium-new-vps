import mongoose from 'mongoose';

// Idempotency ledger: one row per successfully-processed Razorpay payment.
// The unique index on paymentId is what stops a valid {orderId, paymentId,
// signature} from being replayed to add credits more than once.
const processedPaymentSchema = new mongoose.Schema(
  {
    paymentId: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    orderId: { type: String, required: true },
    credits: { type: Number, required: true },
  },
  { timestamps: true }
);

export interface IProcessedPayment extends mongoose.Document {
  paymentId: string;
  userId: string;
  orderId: string;
  credits: number;
}

export default mongoose.model<IProcessedPayment>('ProcessedPayment', processedPaymentSchema);
