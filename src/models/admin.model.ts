import mongoose from 'mongoose';

const adminSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
      minLength: 8,
    },
  },
  { timestamps: true }
);

adminSchema.index({ email: 1 });

export interface IAdmin extends mongoose.Document {
  _id: string;
  email: string;
  password: string;
}

export default mongoose.model<IAdmin>('Admin', adminSchema);
