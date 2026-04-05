import TelegramAccountModel, { ITelegramAccount } from '../models/telegramAccount.model';

export class TelegramAccountRepository {
    async getNextAvailableAccount(excludeIndices: number[] = []): Promise<ITelegramAccount> {
        const now = new Date();
        
        // Find accounts that are not in the exclude list and are not rate limited (or rate limit expired)
        const account = await TelegramAccountModel.findOne({
            index: { $nin: excludeIndices },
            $or: [
                { rateLimitedUntil: null },
                { rateLimitedUntil: { $lte: now } }
            ]
        }).sort({ usageCount: 1 }); // Get the one with least usage

        if (!account) {
            if (excludeIndices.length > 0) {
                throw new Error("All remaining accounts failed or are rate limited.");
            }
            throw new Error("All accounts are currently rate limited. Please wait.");
        }

        return account;
    }

    async updateAccountUsage(accountId: string): Promise<void> {
        await TelegramAccountModel.findByIdAndUpdate(accountId, {
            $inc: { usageCount: 1 },
            lastUsed: new Date(),
            // Clear rate limit if it was successfully used
            rateLimitedUntil: null, 
        });
    }

    async markAccountRateLimited(accountId: string, waitSeconds: number = 3600): Promise<void> {
        const rateLimitedUntil = new Date(Date.now() + waitSeconds * 1000);
        await TelegramAccountModel.findByIdAndUpdate(accountId, {
            rateLimitedUntil
        });
    }

    async getAccountsStatus(): Promise<any[]> {
        const accounts = await TelegramAccountModel.find().lean();
        const now = new Date();
        
        return accounts.map(account => {
            let isRateLimited = false;
            
            if (account.rateLimitedUntil) {
                isRateLimited = now <= new Date(account.rateLimitedUntil);
            }
            
            return {
                index: account.index,
                phoneNumber: account.phoneNumber,
                lastUsed: account.lastUsed,
                usageCount: account.usageCount,
                isRateLimited,
                rateLimitedUntil: isRateLimited ? account.rateLimitedUntil : null
            };
        });
    }

    async resetRateLimits(): Promise<void> {
        await TelegramAccountModel.updateMany({}, {
            rateLimitedUntil: null
        });
    }

    async countAccounts(): Promise<number> {
        return TelegramAccountModel.countDocuments();
    }
}
