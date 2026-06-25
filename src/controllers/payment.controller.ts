import { Request, Response, NextFunction } from 'express';
import paymentService from '../services/payment.service';
import razorpayInstance from '../config/razorpay';
import { PLANS, isPlanType, isCurrency } from '../config/plans';
import { BadRequestError } from '../errors/bad-request.error';

export const verifyPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId, razorpayPaymentId, razorpaySignature } = req.body;
    const userId = req.user._id;

    // planType is intentionally ignored: credits are derived server-side from
    // the verified order amount inside the service.
    const result = await paymentService.verifyAndAddCredits(
      userId,
      orderId,
      razorpayPaymentId,
      razorpaySignature
    );

    if (result.success) {
      res.json({ status: 'success', credits: result.credits });
    } else {
      res.status(400).json({ status: 'failure' });
    }
  } catch (error) {
    next(error);
  }
};

export const createOrder = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { planType, currency } = req.body;
    const cur = currency || 'INR';

    // Server is authoritative about price: the client only picks plan + currency.
    if (!isPlanType(planType)) throw new BadRequestError('Invalid plan type');
    if (!isCurrency(cur)) throw new BadRequestError('Invalid currency');

    const options = {
      amount: PLANS[planType].amount[cur],
      currency: cur,
      receipt: `receipt_order_${Date.now()}`,
    };

    const order = await razorpayInstance.orders.create(options);
    res.json(order);
  } catch (error) {
    next(error);
  }
};
