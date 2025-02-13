import { Router } from 'express';
import { country, health, helloWorld } from '../controllers/health.controller';
import { asyncHandler } from '../utils/asynchandler';
import authRouter from './auth.route';
import telegramRouter from './telegram.route';
import paymentRouter from './payment.route';

const v1Router = Router();

v1Router.get('/', asyncHandler(helloWorld));
v1Router.get('/health', asyncHandler(health));
v1Router.use('/auth', authRouter);
v1Router.use('/telegram', telegramRouter);
v1Router.get('/country', asyncHandler(country));
v1Router.use('/payment', paymentRouter);

export default v1Router;
