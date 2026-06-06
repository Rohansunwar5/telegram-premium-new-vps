import { Router } from 'express';
import { country, health, helloWorld } from '../controllers/health.controller';
import { asyncHandler } from '../utils/asynchandler';
import authRouter from './auth.route';
import telegramRouter from './telegram.route';
import paymentRouter from './payment.route';
import bookmarkRouter from './bookmark.route';
import bkpschRouter from './bkpsch.route';
import channelRouter from './channel.routes';
import decoyBotRouter from './decoyBot.route';
import decoyAdminRouter from './decoyAdmin.route';
import notificationRouter from './notification.route';

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
v1Router.use('/ai-chatbot', decoyBotRouter);
v1Router.use('/admin', decoyAdminRouter);
v1Router.use('/notifications', notificationRouter);

export default v1Router;
