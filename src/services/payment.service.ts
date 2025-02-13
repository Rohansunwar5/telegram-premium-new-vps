import crypto from 'crypto';
import { UserRepository } from '../repository/user.repository';

class PaymentService {
  constructor(private readonly _userRepository: UserRepository) {}

  async verifyAndAddCredits(userId: string, orderId: string, razorpayPaymentId: string, razorpaySignature: string) {
    const secret = 'xyz'; // Use environment variable in production
    const shasum = crypto.createHmac('sha256', secret);
    shasum.update(`${orderId}|${razorpayPaymentId}`);
    const digest = shasum.digest('hex');

    if (digest === razorpaySignature) {
      const user = await this._userRepository.getUserById(userId);
      if (user) {
        user.credits += 100; // Add credits, adjust the amount as needed
        await user.save();
        return { success: true, credits: user.credits };
      }
    }
    return { success: false };
  }
}

export default new PaymentService(new UserRepository()); 