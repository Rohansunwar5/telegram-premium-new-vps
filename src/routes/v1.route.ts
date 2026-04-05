import { Router } from 'express';
import { country, health, helloWorld } from '../controllers/health.controller';
import { asyncHandler } from '../utils/asynchandler';
import authRouter from './auth.route';
import telegramRouter from './telegram.route';
import paymentRouter from './payment.route';
import bookmarkRouter from './bookmark.route';
import bkpschRouter from './bkpsch.route';
import channelRouter from './channel.routes';

const v1Router = Router();

v1Router.get('/', asyncHandler(helloWorld));
v1Router.get('/health', asyncHandler(health));
v1Router.use('/auth', authRouter);
v1Router.use('/telegram', telegramRouter);
v1Router.use('/bookmark', bookmarkRouter);
v1Router.use('/channel', channelRouter);
v1Router.get('/country', asyncHandler(country));
v1Router.use('/payment', paymentRouter);
v1Router.use('/bkpsch', bkpschRouter);

export default v1Router;
