import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { TelegramAccountRepository } from "../repository/telegramAccount.repository";
import logger from "../utils/logger";

export class TelegramExtractorService {
    private rotationManager: TelegramAccountRepository;
    private messagesLimit: number;

    constructor(rotationManager: TelegramAccountRepository, messagesLimit: number = 100) {
        this.rotationManager = rotationManager;
        this.messagesLimit = messagesLimit;
    }

    private async _getMessagesAsync(channelUsername: string, account: any, limit: number = this.messagesLimit) {
        const client = new TelegramClient(
            new StringSession(account.sessionString),
            account.apiId,
            account.apiHash,
            { connectionRetries: 5 }
        );

        (client as any).setLogLevel("none");
        await client.connect();

        try {
            const channel = await client.getEntity(channelUsername);
            const messagesList: any[] = [];
            
            let firstMessageTimestamp: Date | null = null;
            let lastMessageTimestamp: Date | null = null;
            
            const detailedUsers: Record<string, any> = {};

            const iterator = client.iterMessages(channel, { limit });
            
            for await (const msg of iterator) {
                if (msg.text) {
                    const msgDate = new Date(msg.date * 1000);
                    if (!firstMessageTimestamp) {
                        firstMessageTimestamp = msgDate;
                    }
                    lastMessageTimestamp = msgDate;

                    let senderName = "Unknown";
                    let username = null;

                    const sender = await msg.getSender();
                    if (sender) {
                        if ((sender as any).username) {
                            username = (sender as any).username;
                            senderName = `@${username}`;
                        } else if ((sender as any).firstName) {
                            senderName = (sender as any).firstName;
                            if ((sender as any).lastName) {
                                senderName += ` ${(sender as any).lastName}`;
                            }
                        }
                    }

                    const userId = msg.senderId ? msg.senderId.toString() : "0";

                    if (!detailedUsers[senderName]) {
                        detailedUsers[senderName] = {
                            username: username,
                            display_name: senderName,
                            user_id: userId,
                            message_count: 0,
                            first_message_time: msgDate,
                            last_message_time: msgDate
                        };
                    }

                    detailedUsers[senderName].message_count += 1;
                    detailedUsers[senderName].last_message_time = msgDate;

                    messagesList.push({
                        timestamp: msgDate.toISOString().replace('T', ' ').split('.')[0], // YYYY-MM-DD HH:mm:ss
                        timestamp_raw: msgDate.toISOString(),
                        text: msg.text,
                        message_id: msg.id,
                        sender: senderName,
                        sender_id: userId,
                        username: username,
                        content: msg.text,
                        author: senderName
                    });
                }
            }

            const sortedUsers = Object.values(detailedUsers).sort((a, b) => b.message_count - a.message_count);
            
            const top50Users = sortedUsers.slice(0, 50).map((userInfo, index) => ({
                rank: index + 1,
                display_name: userInfo.display_name,
                username: userInfo.username || 'No Username',
                telegram_handle: userInfo.username ? `@${userInfo.username}` : 'No Username',
                message_count: userInfo.message_count,
                user_id: userInfo.user_id,
                first_seen: userInfo.first_message_time.toISOString().replace('T', ' ').split('.')[0],
                last_seen: userInfo.last_message_time.toISOString().replace('T', ' ').split('.')[0]
            }));

            const userActivity: Record<string, number> = {};
            Object.keys(detailedUsers).forEach(key => {
                userActivity[key] = detailedUsers[key].message_count;
            });

            return {
                messages: messagesList,
                user_activity: userActivity,
                top_active_users: Object.entries(userActivity).sort((a, b) => b[1] - a[1]).slice(0, 10),
                top_50_users: top50Users,
                account_used: account.index,
                total_messages: messagesList.length,
                unique_users_count: Object.keys(detailedUsers).length,
                first_message_timestamp: firstMessageTimestamp ? firstMessageTimestamp.toISOString() : null,
                last_message_timestamp: lastMessageTimestamp ? lastMessageTimestamp.toISOString() : null,
                channel_info: {
                    username: channelUsername,
                    title: (channel as any).title || channelUsername,
                    id: (channel as any).id ? (channel as any).id.toString() : null
                }
            };

        } finally {
            await client.disconnect();
        }
    }

    private async _getMessagesSinceAsync(channelUsername: string, account: any, since: Date, limit?: number) {
        const client = new TelegramClient(
            new StringSession(account.sessionString),
            account.apiId,
            account.apiHash,
            { connectionRetries: 5 }
        );

        (client as any).setLogLevel("none");
        await client.connect();

        try {
            const channel = await client.getEntity(channelUsername);
            const messagesList: any[] = [];
            
            let firstMessageTimestamp: Date | null = null;
            let lastMessageTimestamp: Date | null = null;
            
            const detailedUsers: Record<string, any> = {};

            const iterator = client.iterMessages(channel, { limit });
            
            for await (const msg of iterator) {
                const msgDate = new Date(msg.date * 1000);
                
                if (msgDate <= since) {
                    logger.info(`Reached messages older than ${since}, stopping`);
                    break;
                }

                if (msg.text) {
                    if (!firstMessageTimestamp) {
                        firstMessageTimestamp = msgDate;
                    }
                    lastMessageTimestamp = msgDate;

                    let senderName = "Unknown";
                    let username = null;

                    const sender = await msg.getSender();
                    if (sender) {
                        if ((sender as any).username) {
                            username = (sender as any).username;
                            senderName = `@${username}`;
                        } else if ((sender as any).firstName) {
                            senderName = (sender as any).firstName;
                            if ((sender as any).lastName) {
                                senderName += ` ${(sender as any).lastName}`;
                            }
                        }
                    }

                    const userId = msg.senderId ? msg.senderId.toString() : "0";

                    if (!detailedUsers[senderName]) {
                        detailedUsers[senderName] = {
                            username: username,
                            display_name: senderName,
                            user_id: userId,
                            message_count: 0,
                            first_message_time: msgDate,
                            last_message_time: msgDate
                        };
                    }

                    detailedUsers[senderName].message_count += 1;
                    detailedUsers[senderName].last_message_time = msgDate;

                    messagesList.push({
                        timestamp: msgDate.toISOString().replace('T', ' ').split('.')[0], 
                        timestamp_raw: msgDate.toISOString(),
                        text: msg.text,
                        message_id: msg.id,
                        sender: senderName,
                        sender_id: userId,
                        username: username,
                        content: msg.text,
                        author: senderName
                    });
                }
            }

            messagesList.sort((a, b) => new Date(a.timestamp_raw).getTime() - new Date(b.timestamp_raw).getTime());

            const sortedUsers = Object.values(detailedUsers).sort((a, b) => b.message_count - a.message_count);
            
            const top50Users = sortedUsers.slice(0, 50).map((userInfo, index) => ({
                rank: index + 1,
                display_name: userInfo.display_name,
                username: userInfo.username || 'No Username',
                telegram_handle: userInfo.username ? `@${userInfo.username}` : 'No Username',
                message_count: userInfo.message_count,
                user_id: userInfo.user_id,
                first_seen: userInfo.first_message_time.toISOString().replace('T', ' ').split('.')[0],
                last_seen: userInfo.last_message_time.toISOString().replace('T', ' ').split('.')[0]
            }));

            const userActivity: Record<string, number> = {};
            Object.keys(detailedUsers).forEach(key => {
                userActivity[key] = detailedUsers[key].message_count;
            });

            return {
                messages: messagesList,
                user_activity: userActivity,
                top_active_users: Object.entries(userActivity).sort((a, b) => b[1] - a[1]).slice(0, 10),
                top_50_users: top50Users,
                account_used: account.index,
                total_messages: messagesList.length,
                unique_users_count: Object.keys(detailedUsers).length,
                first_message_timestamp: firstMessageTimestamp ? firstMessageTimestamp.toISOString() : null,
                last_message_timestamp: lastMessageTimestamp ? lastMessageTimestamp.toISOString() : null,
                channel_info: {
                    username: channelUsername,
                    title: (channel as any).title || channelUsername,
                    id: (channel as any).id ? (channel as any).id.toString() : null
                }
            };

        } finally {
            await client.disconnect();
        }
    }

    async getMessages(channelUsername: string, limit?: number): Promise<any> {
        const maxRetries = 3;
        let retryCount = 0;
        const failedAccounts: number[] = [];

        while (retryCount < maxRetries) {
            let account;
            try {
                account = await this.rotationManager.getNextAvailableAccount(failedAccounts);
                logger.info(`Using account ${account.index} for ${channelUsername}`);

                const result = await this._getMessagesAsync(channelUsername, account, limit);
                await this.rotationManager.updateAccountUsage(account.id);
                return result;

            } catch (e: any) {
                const errorMsg = String(e);

                if (account && errorMsg.includes('FloodWaitError')) {
                    logger.warn(`Rate limit hit on account ${account.index}: ${e}`);
                    const secondsMatch = errorMsg.match(/A wait of (\d+) seconds is required/i);
                    const seconds = secondsMatch ? parseInt(secondsMatch[1]) : 3600;
                    await this.rotationManager.markAccountRateLimited(account.id, seconds);
                    failedAccounts.push(account.index);
                    retryCount++;
                    await new Promise(res => setTimeout(res, 2000));
                } else {
                    if (errorMsg.includes("not found") || errorMsg.toLowerCase().includes("username")) {
                        logger.error(`Username not found: ${channelUsername}`);
                        throw new Error(`Telegram channel '${channelUsername}' not found.`);
                    }

                    if (errorMsg.includes("All remaining accounts")) {
                        throw e;
                    }

                    if (account) {
                        logger.error(`Error on attempt ${retryCount + 1} (account ${account.index}): ${errorMsg}`);
                        failedAccounts.push(account.index);
                    } else {
                        logger.error(`Error getting account: ${errorMsg}`);
                    }
                    
                    retryCount++;
                    if (retryCount < maxRetries) {
                        await new Promise(res => setTimeout(res, 2000));
                    } else {
                        throw new Error(`Failed after ${maxRetries} attempts: ${errorMsg}`);
                    }
                }
            }
        }
        throw new Error(`Failed to extract messages after all retries`);
    }

    async getMessagesSince(channelUsername: string, since: Date, limit?: number): Promise<any> {
        const maxRetries = 3;
        let retryCount = 0;
        const failedAccounts: number[] = [];

        while (retryCount < maxRetries) {
            let account;
            try {
                account = await this.rotationManager.getNextAvailableAccount(failedAccounts);
                logger.info(`Using account ${account.index} for incremental scrape of ${channelUsername} since ${since}`);

                const result = await this._getMessagesSinceAsync(channelUsername, account, since, limit);
                await this.rotationManager.updateAccountUsage(account.id);
                return result;

            } catch (e: any) {
                const errorMsg = String(e);

                if (account && errorMsg.includes('FloodWaitError')) {
                    logger.warn(`Rate limit hit on account ${account.index}: ${e}`);
                    const secondsMatch = errorMsg.match(/A wait of (\d+) seconds is required/i);
                    const seconds = secondsMatch ? parseInt(secondsMatch[1]) : 3600;
                    await this.rotationManager.markAccountRateLimited(account.id, seconds);
                    failedAccounts.push(account.index);
                    retryCount++;
                    await new Promise(res => setTimeout(res, 2000));
                } else {
                    if (errorMsg.includes("not found") || errorMsg.toLowerCase().includes("username")) {
                        logger.error(`Username not found: ${channelUsername}`);
                        throw new Error(`Telegram channel '${channelUsername}' not found.`);
                    }

                    if (errorMsg.includes("All remaining accounts")) {
                        throw e;
                    }

                    if (account) {
                        logger.error(`Error on attempt ${retryCount + 1} (account ${account.index}): ${errorMsg}`);
                        failedAccounts.push(account.index);
                    } else {
                        logger.error(`Error getting account: ${errorMsg}`);
                    }
                    
                    retryCount++;
                    if (retryCount < maxRetries) {
                        await new Promise(res => setTimeout(res, 2000));
                    } else {
                        throw new Error(`Failed after ${maxRetries} attempts: ${errorMsg}`);
                    }
                }
            }
        }
        throw new Error(`Failed to extract messages after all retries`);
    }
}
