import { NextFunction, Request, Response } from 'express';
import { DecoyAccountRepository } from '../repository/decoyAccount.repository';
import { NotFoundError } from '../errors/not-found.error';
import { BadRequestError } from '../errors/bad-request.error';
import DecoyTelegramAccountModel from '../models/decoyTelegramAccount.model';

const accountRepo = new DecoyAccountRepository();

export const listAccounts = async (req: Request, res: Response, next: NextFunction) => {
  const accounts = await accountRepo.findAll();
  next({ accounts, statusCode: 200, msg: 'Accounts fetched' });
};

export const addAccount = async (req: Request, res: Response, next: NextFunction) => {
  const { phoneNumber, apiId, apiHash, sessionString } = req.body;

  const existing = await DecoyTelegramAccountModel.findOne({ phoneNumber });
  if (existing) throw new BadRequestError(`Account with phone ${phoneNumber} already exists`);

  const account = await DecoyTelegramAccountModel.create({
    phoneNumber,
    apiId: Number(apiId),
    apiHash,
    sessionString,
  });

  next({ account, statusCode: 201, msg: 'Decoy account added' });
};

export const updateSessionString = async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;
  const { sessionString } = req.body;

  const account = await accountRepo.findById(id);
  if (!account) throw new NotFoundError('Account not found');

  await DecoyTelegramAccountModel.findByIdAndUpdate(id, { sessionString });

  next({ statusCode: 200, msg: 'Session string updated. Resume paused sessions to reconnect.' });
};

export const deleteAccount = async (req: Request, res: Response, next: NextFunction) => {
  const { id } = req.params;

  const account = await accountRepo.findById(id);
  if (!account) throw new NotFoundError('Account not found');
  if (account.activeSessions?.length) throw new BadRequestError(`Account has ${account.activeSessions.length} active session(s) — stop them first`);

  await DecoyTelegramAccountModel.findByIdAndDelete(id);

  next({ data: null, statusCode: 200, msg: 'Account deleted' });
};
