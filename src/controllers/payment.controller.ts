import { Request, Response, NextFunction } from 'express';
import paymentService from '../services/payment.service';
import Razorpay from 'razorpay';

const razorpayInstance = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'default_key_id',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'default_key_secret',
});

export const verifyPayment = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orderId, razorpayPaymentId, razorpaySignature } = req.body;
    const userId = req.user._id; 
    const result = await paymentService.verifyAndAddCredits(userId, orderId, razorpayPaymentId, razorpaySignature);

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
    const { amount, currency } = req.body;
    const options = {
      amount: amount * 100, // amount in the smallest currency unit
      currency: currency || 'INR',
      receipt: `receipt_order_${Date.now()}`,
    };

    const order = await razorpayInstance.orders.create(options);
    res.json(order);
  } catch (error) {
    next(error);
  }
}; 