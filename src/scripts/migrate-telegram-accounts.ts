import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import TelegramAccountModel from '../models/telegramAccount.model';
import logger from '../utils/logger';

// Load environment variables manually for script
dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    logger.error('Missing MONGO_URI in environment variables');
    process.exit(1);
}

const ACCOUNTS_FILE_PATH = path.resolve(process.cwd(), '../teleton gpt summerizer', 'telegram_accounts.json');

async function migrateAccounts() {
    try {
        await mongoose.connect(MONGO_URI as string);
        logger.info('Connected to MongoDB');

        const fileContent = JSON.stringify({
  'accounts': [
    {
      'api_id': 27923329,
      'api_hash': 'e1a56ea6bafedd14a78afacabfa1a4da',
      'session_string': '1AZWarzkBu3A_9k1qNE7yfMYRgRNnyp3B-yJTB-Rx94wCUClR3ZbL2Vcut_nctPe3HLPryE4hA9REQauPP-WuuXjm6axqyqnGmcCzFp8sPsjvQJIasmwshZLukYCaVLiWqTJoh05SLYnZFlb1FPjBAcAuZDzcJOrQgZJagB7cMQFAyAm1v-thR0wsWEG5zb7MRlxAY2ltAdK171iQHaOwOMCGiYczm1EmsCe3Nk95dnMC_L21du2_UdIGbquyvpIRGplj8HbsPG9uIMCKPtxIuiRqYpOZ5nJrFvZTlzDCp9zO_QPbuBwwfake7S-tIurOskKBKp75LODy70_5yY0X7EYtpG88FAw=',
      'phone_number': '+19897248017',
      'last_used': '2026-03-26T05:45:58.908956',
      'rate_limited_until': '',
      'usage_count': 46,
      'index': 0
    },
    {
      'api_id': 23526332,
      'api_hash': 'af1a47e91dfdaccce056f8a567e88f85',
      'session_string': '1AZWarzcBuz9zUJ0zyUwmY2BZPd0MMlJY8gR2DKH1TYf4a4PfW6rABAbWUZy1TOlXMQrm3YtmzEM6iZR5JDZzpkmLMqHA07jfuIcMTutJs17QTyJEKsenJdWs4mBHO36QgGLdKyhKXIG-ZeQL04c7H8b3d2OVwvLZB957grjkQGCZpeaQNTK9IPDEymsPYwhpJMwxs1X9i4h_VypFe7r0cHsRxVhY-dhPL_tHLereaxmRsrIaet_kOG9byKX7Mj36j07oXk2GHxcIdm6thSqUrTb7sBfk_c7et-s9YgVUk_2AjX8UVCMxWh0gqU_Vyze60qraAL1qsPxeqVUaOS8lnqTGdHnQn8I=',
      'phone_number': '+17737038467',
      'last_used': '2026-03-26T04:29:47.937098',
      'rate_limited_until': '',
      'usage_count': 45,
      'index': 1
    },
    {
      'api_id': 23594991,
      'api_hash': '4be96a83e4a7cf10d9a9b78d870dbc31',
      'session_string': '1AZWarzcBuyJbJ8DXtJadUV4pYAbcfu1JDR0GIT29DwWRZLOOetegdPzmqSUEGfC1XVrs_d5poblswvuSV5a2q6ECTJpGhvVr2x96ulEunw9PA0xfc8NxbWNJCzjsiV0X0OhqP8bLJmWldfkImW6gLqKISUI1ZM8rqp2dBuBFsZHXba6UoZ2eemhcCIfrEE6jUfM8fy7w65cMAeQJE06KYoF4PQmLs5cN9HIFV9jvKtWV1uMT2YlPRyFHYgk2wdlg2mbtRQPsQMSkGCS06xR2VqoBK8eu7gV0HxcMCryVX9IYcr9hpMpMLX1QJs0aXyGgpB_jUD1TzR_GVeV1O9_XqpCmkxtlhiM=',
      'phone_number': '+19802862688',
      'last_used': '2026-03-26T04:32:51.445425',
      'rate_limited_until': '',
      'usage_count': 45,
      'index': 2
    }
  ]
});
        const data = JSON.parse(fileContent);

        if (!data.accounts || !Array.isArray(data.accounts)) {
            logger.error('Invalid telegram_accounts.json format. Missing accounts array.');
            process.exit(1);
        }

        // Delete existing imported accounts to avoid duplicates during test
        await TelegramAccountModel.deleteMany({});
        logger.info('Cleared existing Telegram accounts from DB.');

        let importedCount = 0;

        for (const account of data.accounts) {
            const lastUsedDate = account.last_used ? new Date(account.last_used) : null;
            const rateLimitedUntilDate = account.rate_limited_until ? new Date(account.rate_limited_until) : null;

            await TelegramAccountModel.create({
                apiId: account.api_id,
                apiHash: account.api_hash,
                sessionString: account.session_string,
                phoneNumber: account.phone_number,
                lastUsed: lastUsedDate,
                rateLimitedUntil: rateLimitedUntilDate,
                usageCount: account.usage_count || 0,
                index: account.index
            });

            importedCount++;
            logger.info(`Imported account index ${account.index} (${account.phone_number})`);
        }

        logger.info(`✅ Migration completed successfully. Imported ${importedCount} accounts.`);
        process.exit(0);

    } catch (error) {
        logger.error('Error migrating accounts:', error);
        process.exit(1);
    }
}

migrateAccounts();