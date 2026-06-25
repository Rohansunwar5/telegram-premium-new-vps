import crypto from 'crypto';
import { UserRepository } from '../repository/user.repository';
import razorpayInstance from '../config/razorpay';
import { findPlanByAmount } from '../config/plans';
import ProcessedPayment from '../models/processedPayment.model';
import { InternalServerError } from '../errors/internal-server.error';

class PaymentService {
  constructor(private readonly _userRepository: UserRepository) {}

  async verifyAndAddCredits(
    userId: string,
    orderId: string,
    paymentId: string,
    signature: string
  ) {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    // Fail closed: never verify a signature against an empty/default secret.
    if (!secret) throw new InternalServerError('Payment secret not configured');

    const generatedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    // Constant-time comparison over equal-length buffers.
    const expected = Buffer.from(generatedSignature, 'hex');
    const provided = Buffer.from(signature || '', 'hex');
    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
      return { success: false };
    }

    // Bind credits to the amount actually paid: fetch the order from Razorpay
    // and derive the plan from its verified amount+currency — never from a
    // client-supplied planType.
    const order = await razorpayInstance.orders.fetch(orderId);
    const plan = findPlanByAmount(Number(order.amount), String(order.currency));
    if (!plan) return { success: false };

    // Idempotency: insert the ledger row first. The unique index on paymentId
    // makes a replay (or a concurrent duplicate) fail here, so credits are
    // granted at most once per payment.
    try {
      await ProcessedPayment.create({
        paymentId,
        userId,
        orderId,
        credits: plan.credits,
      });
    } catch (err: unknown) {
      if ((err as { code?: number })?.code === 11000) {
        return { success: false, alreadyProcessed: true };
      }
      throw err;
    }

    // ponytail: if updateUserCredits fails after the ledger insert, the payment
    // is marked processed but credits aren't added (under-credit, not double-credit).
    // Acceptable for now; a Mongoose transaction (plan 015) closes this gap.
    const updatedUser = await this._userRepository.updateUserCredits(userId, plan.credits);
    if (!updatedUser) return { success: false };

    return { success: true, credits: updatedUser.credits };
  }
}

export default new PaymentService(new UserRepository());
