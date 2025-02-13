import mongoose from 'mongoose';

const PASSWORD_MIN_LENGTH = 8;

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
      maxLength: 40,
    },
    lastName: {
      type: String,
      trim: true,
      maxLength: 40,
    },
    email: {
      type: String,
      required: true,
      minLength: 2,
    },
   
    password: {
      type: String,
      minLength: PASSWORD_MIN_LENGTH,
    },
    credits: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 });

export interface IUser extends mongoose.Schema {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  credits: number;
}

export default mongoose.model<IUser>('User', userSchema);
