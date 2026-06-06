import NotificationModel, { INotification, NotificationType } from '../models/notification.model';

const MAX_NOTIFICATIONS_PER_USER = 50;

export interface ICreateNotificationParams {
  userId: string;
  sessionId: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export class NotificationRepository {
  /**
   * Insert one notification and trim older entries beyond the 50-per-user cap.
   */
  async create(params: ICreateNotificationParams): Promise<INotification> {
    const doc = await NotificationModel.create(params);
    // Fire-and-forget trim — don't block the caller
    this.trimToLatest(params.userId, MAX_NOTIFICATIONS_PER_USER).catch(() => {});
    return doc;
  }

  /**
   * Paginated read, sorted newest-first.
   */
  async findByUser(
    userId: string,
    opts: { limit?: number; skip?: number; unreadOnly?: boolean } = {}
  ): Promise<INotification[]> {
    const { limit = 20, skip = 0, unreadOnly = false } = opts;
    const filter: Record<string, unknown> = { userId };
    if (unreadOnly) filter.read = false;
    return NotificationModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<INotification[]>();
  }

  /**
   * Mark a single notification as read with ownership check.
   */
  async markRead(notificationId: string, userId: string): Promise<boolean> {
    const result = await NotificationModel.updateOne(
      { _id: notificationId, userId },
      { read: true }
    );
    return result.modifiedCount > 0;
  }

  /**
   * Bulk mark all notifications for a user as read.
   */
  async markAllRead(userId: string): Promise<number> {
    const result = await NotificationModel.updateMany(
      { userId, read: false },
      { read: true }
    );
    return result.modifiedCount;
  }

  /**
   * Count unread notifications for a user.
   */
  async countUnread(userId: string): Promise<number> {
    return NotificationModel.countDocuments({ userId, read: false });
  }

  /**
   * Keep only the `max` most recent notifications for a user,
   * deleting everything older than the Nth newest.
   */
  async trimToLatest(userId: string, max: number): Promise<void> {
    const boundary = await NotificationModel.find({ userId })
      .sort({ createdAt: -1 })
      .skip(max)
      .limit(1)
      .select('_id')
      .lean();

    if (boundary.length > 0) {
      await NotificationModel.deleteMany({
        userId,
        _id: { $lte: boundary[0]._id },
      });
    }
  }
}
