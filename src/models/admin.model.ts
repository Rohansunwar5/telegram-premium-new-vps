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

// (email already has a unique index via `unique: true` on the field above —
// a second adminSchema.index({ email: 1 }) here was the source of the
// "Duplicate schema index on {email:1}" warning on every boot.)

export interface IAdmin extends mongoose.Document {
  _id: string;
  email: string;
  password: string;
}

export default mongoose.model<IAdmin>('Admin', adminSchema);
