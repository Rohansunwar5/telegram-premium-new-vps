import { NotificationRepository, ICreateNotificationParams } from '../repository/notification.repository';
import { NotificationType } from '../models/notification.model';
import { emitToUser } from '../socket/emitter';
import logger from '../utils/logger';

export interface INotifyParams {
  userId: string;
  sessionId: string;
  type: NotificationType;
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export class NotificationService {
  private readonly notificationRepo: NotificationRepository;

  constructor() {
    this.notificationRepo = new NotificationRepository();
  }

  /**
   * Central entry point: persist to DB, count unread, and emit via socket.
   */
  async notify(params: INotifyParams): Promise<void> {
    try {
      const doc = await this.notificationRepo.create(params);
      const unreadCount = await this.notificationRepo.countUnread(params.userId);

      emitToUser(params.userId, 'notification:new', {
        _id: doc._id,
        userId: doc.userId,
        sessionId: doc.sessionId,
        type: doc.type,
        title: doc.title,
        body: doc.body,
        metadata: doc.metadata,
        read: doc.read,
        createdAt: doc.createdAt,
        unreadCount,
      });
    } catch (err: any) {
      // Notification persistence should never crash the calling service.
      // Log and move on — the core action (message delivery, status change) already succeeded.
      logger.error(`[NotificationService] Failed to persist/emit notification: ${err.message}`);
    }
  }

  /**
   * Get the repository instance for direct use by controllers (REST endpoints).
   */
  getRepository(): NotificationRepository {
    return this.notificationRepo;
  }
}

// Singleton — used by both the DecoyBotService (master) and controller REST endpoints.
let instance: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!instance) {
    instance = new NotificationService();
  }
  return instance;
}
