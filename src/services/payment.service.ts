import crypto from 'crypto';
import { UserRepository } from '../repository/user.repository';

class PaymentService {
  constructor(private readonly _userRepository: UserRepository) {}

  async verifyAndAddCredits(userId: string, orderId: string, razorpayPaymentId: string, razorpaySignature: string) {
    
    const secret = process.env.RAZORPAY_KEY_SECRET || "xyz" 
    const shasum = crypto.createHmac('sha256', secret);
    shasum.update(`${orderId}|${razorpayPaymentId}`);
    const digest = shasum.digest('hex');


    if (digest === razorpaySignature) {
      const user = await this._userRepository.getUserById(userId);
      if (user) {
        user.credits += 100; 
        await user.save();
        return { success: true, credits: user.credits };
      }
    }
    return { success: false };
  }
}

export default new PaymentService(new UserRepository()); 