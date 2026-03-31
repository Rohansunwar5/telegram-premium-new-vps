import userModel, { IUser } from '../models/user.model';
import { sha1 } from '../utils/hash.util';

export interface IOnBoardUserParams {
  firstName: string;
  lastName: string;
  email: string;
  password?: string;
}

export class UserRepository {
  private _model = userModel;

  async getUserByEmailId(email: string): Promise<IUser | null> {
    return this._model.findOne({ email });
  }

  async onBoardUser(params: IOnBoardUserParams): Promise<IUser> {
    const {
      firstName, lastName, email,
      password,
    } = params;

    return this._model.create({ firstName, lastName, email, password });
  }

 
 async updateUserCredits(userId: string, creditDelta: number) {
    return this._model.findByIdAndUpdate(
        userId,
        { $inc: { credits: creditDelta } },
        { new: true }
    );
}

  async getUserById(id: string) {
    return this._model.findById(id).select('img _id firstName lastName email credits phoneNumber verified createdAt updatedAt __v');
  }

  async updateUser(params: {
    firstName: string, lastName: string, isdCode?: string, phoneNumber?: string, _id: string, bio?: string, location?: string, company?: { name?: string, url?: string }, socials?: {
      twitter?: string,
      github?: string,
      facebook?: string,
      instagram?: string,
      linkedin?: string,
    }
  }) {
    const { firstName, lastName, isdCode, phoneNumber, _id, bio, location, company, socials } = params;

    return this._model.findByIdAndUpdate(_id, { firstName, lastName, isdCode, phoneNumber, bio, location, company, socials }, { new: true });
  }
  
  async verifyUserId(userId: string) {
    return this._model.findByIdAndUpdate(userId, {
      verified: true
    }, { new: true });
  }

  async getMonthlyClickCountStatus(userId: string): Promise<{ count: number; triesLeft: number }> {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const MONTHLY_LIMIT = 15;

    const user = await this._model.findById(userId);
    if (!user || !user.clickCount) {
      return { count: 0, triesLeft: MONTHLY_LIMIT };
    }

    const monthlyRecord = user.clickCount.find(
      (record: any) => record.year === currentYear && record.month === currentMonth
    );

    if (!monthlyRecord) {
      return { count: 0, triesLeft: MONTHLY_LIMIT };
    }

    const count = monthlyRecord.count || 0;
    const triesLeft = Math.max(0, MONTHLY_LIMIT - count);
    return { count, triesLeft };
  }

  async incrementMonthlyClickCount(userId: string): Promise<void> {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const resetDate = new Date(currentYear, currentMonth, 0); // Last day of current month

    const user = await this._model.findById(userId);
    if (!user) return;

    let monthlyRecord = user.clickCount?.find(
      (record: any) => record.year === currentYear && record.month === currentMonth
    );

    if (!monthlyRecord) {
      // Create new monthly record
      if (!user.clickCount) {
        user.clickCount = [];
      }
      monthlyRecord = {
        year: currentYear,
        month: currentMonth,
        count: 1,
        resetAt: resetDate,
      };
      user.clickCount.push(monthlyRecord);
    } else {
      monthlyRecord.count = (monthlyRecord.count || 0) + 1;
    }

    await user.save();
  }
}