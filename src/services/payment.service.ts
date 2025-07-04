import crypto from 'crypto';
import { UserRepository } from '../repository/user.repository';

class PaymentService {
  constructor(private readonly _userRepository: UserRepository) {}

  async verifyAndAddCredits(  userId: string, 
    orderId: string, 
    paymentId: string, 
    signature: string,
    planType: string ) {
    
      const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || '')
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    if (generatedSignature !== signature) {
      return { success: false };
    }

    const creditsToAdd = planType === 'silver' ? 20 : 50;

    // Update user's credits
    const updatedUser = await this._userRepository.updateUserCredits(userId, creditsToAdd);
    
    if (!updatedUser) {
      return { success: false };
    }

    return {
      success: true,
      credits: updatedUser.credits
    };
  }
}

export default new PaymentService(new UserRepository()); 