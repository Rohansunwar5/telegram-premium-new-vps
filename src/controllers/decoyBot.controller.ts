import { NextFunction, Request, Response } from 'express';
import { DecoySessionRepository } from '../repository/decoySession.repository';
import { DecoyAccountRepository } from '../repository/decoyAccount.repository';
import { BadRequestError } from '../errors/bad-request.error';
import { NotFoundError } from '../errors/not-found.error';
import { ForbiddenError } from '../errors/forbidden.error';
import { getDecoyBotService } from '../services/decoyBot.singleton';
import { buildSystemPrompt } from '../services/decoyAI.service';
import logger from '../utils/logger';

const sessionRepo = new DecoySessionRepository();
const accountRepo = new DecoyAccountRepository();

// Soft-warning thresholds for the account-picker dropdown.
// 'high' = visible caution; 'overloaded' = strong warning. Tune as needed.
const HIGH_LOAD_THRESHOLD = 5;
const OVERLOAD_THRESHOLD = 10;

const loadWarning = (count: number): 'ok' | 'high' | 'overloaded' => {
  if (count >= OVERLOAD_THRESHOLD) return 'overloaded';
  if (count >= HIGH_LOAD_THRESHOLD) return 'high';
  return 'ok';
};

// Dispatches a decoy action to the bot service.
// In dev: calls the singleton directly (process.send is undefined in non-workers).
// In prod workers: sends IPC to the master which owns the service.
function dispatch(type: 'DECOY_START' | 'DECOY_STOP' | 'DECOY_RESUME', payload: Record<string, unknown>): void {
  const svc = getDecoyBotService();
  if (svc) {
    switch (type) {
      case 'DECOY_START':
        svc.startSession(payload.sessionId as string).catch((err) =>
          logger.error(`[Controller] DECOY_START failed:`, err)
        );
        break;
      case 'DECOY_STOP':
        svc.stopSession(payload.sessionId as string, (payload.stopStatus ?? 'paused') as 'paused' | 'stopped').catch((err) =>
          logger.error(`[Controller] DECOY_STOP failed:`, err)
        );
        break;
      case 'DECOY_RESUME':
        svc.resumeSession(payload.sessionId as string).catch((err) =>
          logger.error(`[Controller] DECOY_RESUME failed:`, err)
        );
        break;
    }
  } else {
    process.send?.({ type, ...payload });
  }
}

export const listAccounts = async (req: Request, res: Response, next: NextFunction) => {
  const accounts = await accountRepo.listOrderedByLoad();
  const items = accounts.map((a) => {
    const activeSessionCount = a.activeSessions?.length ?? 0;
    return {
      _id: a._id.toString(),
      phoneNumber: a.phoneNumber,
      activeSessionCount,
      warning: loadWarning(activeSessionCount),
    };
  });
  next({ accounts: items, statusCode: 200, msg: 'Decoy accounts fetched' });
};

export const createSession = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { targetIdentifier, targetContext, targetName, decoyAccountId } = req.body;

  if (!targetContext || !targetContext.trim()) {
    throw new BadRequestError('targetContext is required');
  }

  if (!targetIdentifier || !targetIdentifier.trim()) {
    throw new BadRequestError('targetIdentifier is required');
  }

  const existing = await sessionRepo.findLiveByUserAndTarget(userId, targetIdentifier);
  if (existing) {
    throw new BadRequestError(
      `A session for "${targetIdentifier}" is already ${existing.status}. ` +
      `Resume or stop the existing session before creating a new one.`
    );
  }

  const systemPrompt = buildSystemPrompt(targetContext.trim());

  const account = decoyAccountId
    ? await accountRepo.findById(decoyAccountId)
    : await accountRepo.findAvailableAccount();
  if (!account) {
    throw new BadRequestError(
      decoyAccountId
        ? 'Selected decoy account not found.'
        : 'No decoy accounts available. Please add a Telegram account first.'
    );
  }

  const session = await sessionRepo.create({
    userId,
    decoyAccountId: account._id.toString(),
    targetIdentifier,
    targetContext: targetContext.trim(),
    systemPrompt,
    targetName,
  });

  await accountRepo.assignToSession(account._id.toString(), session._id.toString());

  dispatch('DECOY_START', { sessionId: session._id.toString() });

  next({ session, statusCode: 201, msg: 'Decoy session created' });
};

export const listSessions = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const sessions = await sessionRepo.findAllByUser(userId);
  next({ sessions, statusCode: 200, msg: 'Sessions fetched' });
};

export const getMessages = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { id } = req.params;

  const session = await sessionRepo.findById(id);
  if (!session) throw new NotFoundError('Session not found');
  if (session.userId.toString() !== userId.toString()) throw new ForbiddenError('Access denied');

  const messages = await sessionRepo.getMessages(id);
  next({ messages, statusCode: 200, msg: 'Messages fetched' });
};

export const pauseSession = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { id } = req.params;

  const session = await sessionRepo.findById(id);
  if (!session) throw new NotFoundError('Session not found');
  if (session.userId.toString() !== userId.toString()) throw new ForbiddenError('Access denied');
  if (session.status === 'paused') throw new BadRequestError('Session is already paused');
  if (session.status === 'stopped') throw new BadRequestError('Session is stopped');

  dispatch('DECOY_STOP', { sessionId: id, stopStatus: 'paused' });

  next({ statusCode: 200, msg: 'Session pause requested' });
};

export const resumeSession = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { id } = req.params;

  const session = await sessionRepo.findById(id);
  if (!session) throw new NotFoundError('Session not found');
  if (session.userId.toString() !== userId.toString()) throw new ForbiddenError('Access denied');
  if (session.status === 'active') throw new BadRequestError('Session is already active');

  dispatch('DECOY_RESUME', { sessionId: id });

  next({ statusCode: 200, msg: 'Session resume requested' });
};

export const manualSend = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { id } = req.params;
  const { message } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    throw new BadRequestError('message is required');
  }

  const session = await sessionRepo.findById(id);
  if (!session) throw new NotFoundError('Session not found');
  if (session.userId.toString() !== userId.toString()) throw new ForbiddenError('Access denied');
  if (session.status === 'stopped') throw new BadRequestError('Cannot send to a stopped session');

  const svc = getDecoyBotService();
  if (!svc) {
    // In production workers, manual send needs to go through the master.
    // For now, forward via IPC with a synchronous workaround is complex,
    // so we reject in pure-worker mode and require the same-process setup.
    throw new BadRequestError('Manual send is not available in this worker configuration');
  }

  const saved = await svc.sendManualMessage(id, message.trim());
  next({ message: saved, statusCode: 200, msg: 'Message sent' });
};
