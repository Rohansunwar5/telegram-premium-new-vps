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

export const createSession = async (req: Request, res: Response, next: NextFunction) => {
  const { _id: userId } = req.user;
  const { targetIdentifier, targetContext, targetName } = req.body;

  if (!targetContext || !targetContext.trim()) {
    throw new BadRequestError('targetContext is required');
  }

  const systemPrompt = buildSystemPrompt(targetContext.trim());

  const account = await accountRepo.findAvailableAccount();
  if (!account) throw new BadRequestError('No decoy accounts available. Please add a Telegram account first.');

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
  if (session.status === 'stopped') throw new BadRequestError('Stopped sessions cannot be resumed');

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
