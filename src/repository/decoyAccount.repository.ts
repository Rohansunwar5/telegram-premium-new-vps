import mongoose from 'mongoose';
import DecoyTelegramAccountModel, {
  IDecoyTelegramAccount,
} from '../models/decoyTelegramAccount.model';

export class DecoyAccountRepository {
  /**
   * Return the account with the fewest active sessions, so load is spread
   * evenly when multiple accounts exist. Any account can handle unlimited
   * concurrent sessions — there is no isInUse block.
   */
  async findAvailableAccount(): Promise<IDecoyTelegramAccount | null> {
    const accounts = await DecoyTelegramAccountModel.find().lean();
    if (!accounts.length) return null;
    accounts.sort((a, b) => (a.activeSessions?.length ?? 0) - (b.activeSessions?.length ?? 0));
    return DecoyTelegramAccountModel.findById(accounts[0]._id);
  }

  /**
   * Add a session to an account's active list.
   * $addToSet prevents duplicates on double-start.
   */
  async assignToSession(
    accountId: string,
    sessionId: string
  ): Promise<IDecoyTelegramAccount | null> {
    return DecoyTelegramAccountModel.findByIdAndUpdate(
      accountId,
      { $addToSet: { activeSessions: new mongoose.Types.ObjectId(sessionId) } },
      { new: true }
    );
  }

  /**
   * Remove a specific session from an account's active list.
   * Other sessions on the same account are unaffected.
   */
  async releaseAccount(accountId: string, sessionId: string): Promise<void> {
    await DecoyTelegramAccountModel.findByIdAndUpdate(accountId, {
      $pull: { activeSessions: new mongoose.Types.ObjectId(sessionId) },
    });
  }

  /**
   * Re-add a session when resuming (same as assign — $addToSet is idempotent).
   */
  async lockAccount(accountId: string, sessionId: string): Promise<void> {
    await DecoyTelegramAccountModel.findByIdAndUpdate(accountId, {
      $addToSet: { activeSessions: new mongoose.Types.ObjectId(sessionId) },
    });
  }

  async findById(accountId: string): Promise<IDecoyTelegramAccount | null> {
    return DecoyTelegramAccountModel.findById(accountId);
  }

  async findAll(): Promise<IDecoyTelegramAccount[]> {
    return DecoyTelegramAccountModel.find().sort({ createdAt: 1 });
  }

  /**
   * Return all accounts, sorted by current load (fewest active sessions first).
   * Used to power the account-picker dropdown — least-loaded account appears on top.
   */
  async listOrderedByLoad(): Promise<IDecoyTelegramAccount[]> {
    const accounts = await DecoyTelegramAccountModel.find().lean();
    accounts.sort(
      (a, b) => (a.activeSessions?.length ?? 0) - (b.activeSessions?.length ?? 0)
    );
    return accounts as unknown as IDecoyTelegramAccount[];
  }
}
