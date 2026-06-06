import { NextFunction, Request, Response } from 'express';
import { getNotificationService } from '../services/notification.service';

const notificationService = getNotificationService();
const repo = notificationService.getRepository();

/**
 * GET /notifications
 * Returns paginated notification list + unreadCount for the logged-in user.
 * Query: limit (default 20), skip (default 0), unreadOnly (boolean).
 */
export const listNotifications = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 50);
  const skip = parseInt(req.query.skip as string, 10) || 0;
  const unreadOnly = req.query.unreadOnly === 'true';

  const [notifications, unreadCount] = await Promise.all([
    repo.findByUser(userId, { limit, skip, unreadOnly }),
    repo.countUnread(userId),
  ]);

  next({ notifications, unreadCount, statusCode: 200, msg: 'Notifications fetched' });
};

/**
 * PATCH /notifications/:id/read
 * Mark a single notification as read (with ownership check).
 */
export const markRead = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { id } = req.params;

  await repo.markRead(id, userId);
  next({ data: null, statusCode: 200, msg: 'Notification marked as read' });
};

/**
 * PATCH /notifications/read-all
 * Mark all notifications as read for the logged-in user.
 */
export const markAllRead = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;

  const count = await repo.markAllRead(userId);
  next({ markedCount: count, statusCode: 200, msg: 'All notifications marked as read' });
};
