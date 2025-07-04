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

}