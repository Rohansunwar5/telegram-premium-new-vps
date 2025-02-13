import { Router } from 'express';
import { asyncHandler } from '../utils/asynchandler';
import { verifyPayment, createOrder } from '../controllers/payment.controller';
import isLoggedIn from '../middlewares/isLoggedIn.middleware';

const paymentRouter = Router();

paymentRouter.post('/verify', isLoggedIn, asyncHandler(verifyPayment));
paymentRouter.post('/create-order', isLoggedIn, asyncHandler(createOrder));

export default paymentRouter; 