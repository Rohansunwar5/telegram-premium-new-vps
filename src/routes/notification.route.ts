import { Router } from 'express';
import isLoggedIn from '../middlewares/isLoggedIn.middleware';
import { asyncHandler } from '../utils/asynchandler';
import {
  listNotifications,
  markRead,
  markAllRead,
} from '../controllers/notification.controller';

const notificationRouter = Router();

notificationRouter.get('/', isLoggedIn, asyncHandler(listNotifications));
notificationRouter.patch('/read-all', isLoggedIn, asyncHandler(markAllRead));
notificationRouter.patch('/:id/read', isLoggedIn, asyncHandler(markRead));

export default notificationRouter;
