import DecoySessionModel, {
  IDecoySession,
  IDecoyMessage,
} from '../models/decoySession.model';

// Minimal projection used by the poll loop — avoids loading the full messages
// array. MongoDB $slice returns only the last N entries server-side.
export interface IPollingSnapshot {
  _id: string;
  status: 'active' | 'paused' | 'stopped';
  systemPrompt: string;
  lastProcessedMsgId: number;
  messages: IDecoyMessage[];
  standingObjective: string;
  pendingNudge: string;
  unseenCount?: number;
}

export interface ICreateDecoySessionParams {
  userId: string;
  decoyAccountId: string;
  targetIdentifier: string;
  targetName?: string;
  systemPrompt: string;
  targetContext?: string;
}

export interface IPollingStateUpdate {
  lastPolledAt: Date;
  lastProcessedMsgId: number;
}

export class DecoySessionRepository {
  async create(params: ICreateDecoySessionParams): Promise<IDecoySession> {
    return DecoySessionModel.create(params);
  }

  async findById(sessionId: string): Promise<IDecoySession | null> {
    return DecoySessionModel.findById(sessionId);
  }

  async deleteById(sessionId: string): Promise<void> {
    await DecoySessionModel.findByIdAndDelete(sessionId);
  }

  async incrementUnseenCount(sessionId: string, count: number = 1): Promise<void> {
    await DecoySessionModel.findByIdAndUpdate(sessionId, { $inc: { unseenCount: count } });
  }

  async resetUnseenCount(sessionId: string): Promise<void> {
    await DecoySessionModel.findByIdAndUpdate(sessionId, { unseenCount: 0 });
  }

  async findAllByUser(userId: string): Promise<IDecoySession[]> {
    return DecoySessionModel.find({ userId })
      .select('-messages') // Exclude messages from list view — fetched separately
      .sort({ createdAt: -1 });
  }

  /**
   * Fetch only the message history for a session (used by the dashboard and
   * the AI context builder — kept as a separate query to avoid loading the
   * full document on every poll tick).
   */
  async getMessages(sessionId: string): Promise<IDecoyMessage[]> {
    const session = await DecoySessionModel.findById(sessionId).select('messages');
    return session?.messages ?? [];
  }

  /**
   * Push one or more messages onto the conversation history.
   * Using $push with $each avoids loading and re-saving the full document.
   */
  async appendMessages(
    sessionId: string,
    messages: IDecoyMessage[]
  ): Promise<void> {
    await DecoySessionModel.findByIdAndUpdate(sessionId, {
      $push: { messages: { $each: messages } },
    });
  }

  async updateStatus(
    sessionId: string,
    status: IDecoySession['status']
  ): Promise<void> {
    await DecoySessionModel.findByIdAndUpdate(sessionId, { status });
  }

  /**
   * Update the polling watermark after each successful poll tick.
   * Combining both fields into one write keeps them in sync.
   */
  async updatePollingState(
    sessionId: string,
    state: IPollingStateUpdate
  ): Promise<void> {
    await DecoySessionModel.findByIdAndUpdate(sessionId, {
      lastPolledAt: state.lastPolledAt,
      lastProcessedMsgId: state.lastProcessedMsgId,
    });
  }

  /**
   * Store the resolved Telegram numeric user ID so subsequent session restarts
   * don't need to re-resolve the entity from a phone/username.
   */
  async updateTargetUserId(
    sessionId: string,
    targetTelegramUserId: string
  ): Promise<void> {
    await DecoySessionModel.findByIdAndUpdate(sessionId, { targetTelegramUserId });
  }

  /**
   * Lightweight read for the poll loop.
   * Uses a server-side $slice so MongoDB returns only the last 50 messages
   * regardless of how long the conversation has grown, keeping every poll
   * tick cheap even for sessions with hundreds of messages.
   */
  async findForPolling(sessionId: string): Promise<IPollingSnapshot | null> {
    return DecoySessionModel.findById(
      sessionId,
      {
        status: 1,
        systemPrompt: 1,
        lastProcessedMsgId: 1,
        standingObjective: 1,
        pendingNudge: 1,
        unseenCount: 1,
        messages: { $slice: -50 },
      }
    ).lean<IPollingSnapshot>();
  }

  /**
   * Returns all sessions the master should resume polling for on startup.
   */
  async findActiveSessions(): Promise<IDecoySession[]> {
    return DecoySessionModel.find({ status: 'active' });
  }

  async findStatus(sessionId: string): Promise<{ status: string } | null> {
    return DecoySessionModel.findById(sessionId, { status: 1 }).lean();
  }

  // Find a non-stopped session this user already has running against the same
  // target. Match is case-insensitive and ignores an optional leading '@' on
  // either side so '@Rohan_Codes' and 'rohan_codes' resolve to the same target.
  async findLiveByUserAndTarget(
    userId: string,
    targetIdentifier: string
  ): Promise<IDecoySession | null> {
    const bare = targetIdentifier.trim().replace(/^@/, '');
    const escaped = bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return DecoySessionModel.findOne({
      userId,
      status: { $in: ['active', 'paused'] },
      targetIdentifier: { $regex: `^@?${escaped}$`, $options: 'i' },
    });
  }

  async setObjective(sessionId: string, objective: string): Promise<void> {
    await DecoySessionModel.findByIdAndUpdate(sessionId, { standingObjective: objective });
  }

  async clearObjective(sessionId: string): Promise<void> {
    await DecoySessionModel.findByIdAndUpdate(sessionId, { standingObjective: '' });
  }

  async setNudge(sessionId: string, nudge: string): Promise<void> {
    await DecoySessionModel.findByIdAndUpdate(sessionId, { pendingNudge: nudge });
  }

  async clearNudge(sessionId: string): Promise<void> {
    await DecoySessionModel.findByIdAndUpdate(sessionId, { pendingNudge: '' });
  }
}
