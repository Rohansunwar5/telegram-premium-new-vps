import { InternalServerError } from '../errors/internal-server.error';
import { BadRequestError } from '../errors/bad-request.error';
import logger from '../utils/logger';
import { TelegramExtractorService } from './telegram-extractor.service';
import { GptSummarizerService } from './gpt-summarizer.service';
import { TelegramAccountRepository } from '../repository/telegramAccount.repository';
import { generateMessageStatistics } from '../utils/telegram-helper.util';

interface IScrapeParams {
    channelName: string;
    limit?: number | null;
    since?: Date | string;
    triggerWords?: string[];
}

export class ChannelService {
    private extractorService: TelegramExtractorService;
    private summarizerService: GptSummarizerService;
    private accountRepository: TelegramAccountRepository;

    private supportedLanguages: Record<string, { english: string; native: string }> = {
        'english': { 'english': 'English', 'native': 'English' },
        'hindi': { 'english': 'Hindi', 'native': 'हिन्दी' },
        'bengali': { 'english': 'Bengali', 'native': 'বাংলা' },
        'telugu': { 'english': 'Telugu', 'native': 'తెలుగు' },
        'marathi': { 'english': 'Marathi', 'native': 'मराठी' },
        'tamil': { 'english': 'Tamil', 'native': 'தமிழ்' },
        'gujarati': { 'english': 'Gujarati', 'native': 'ગુજરાતી' },
        'urdu': { 'english': 'Urdu', 'native': 'اردو' }
    };

    constructor() {
        this.accountRepository = new TelegramAccountRepository();
        this.extractorService = new TelegramExtractorService(this.accountRepository, 100);
        this.summarizerService = new GptSummarizerService();
    }

    async scrapeChannel(params: IScrapeParams | string): Promise<any> {
        try {
            let scrapeParams: IScrapeParams;
            if (typeof params === 'string') {
                scrapeParams = { channelName: params, limit: 100 };
            } else {
                scrapeParams = params;
            }

            const triggerWords = scrapeParams.triggerWords && scrapeParams.triggerWords.length > 0
                ? scrapeParams.triggerWords
                : ['important', 'urgent', 'announcement', 'update'];

            logger.info(`📡 Scraping ${scrapeParams.channelName}`, {
                limit: scrapeParams.limit,
                since: scrapeParams.since ? new Date(scrapeParams.since).toISOString() : 'all',
                triggerWords: triggerWords
            });

            let scrapeResult;
            if (scrapeParams.since) {
                const sinceDate = scrapeParams.since instanceof Date ? scrapeParams.since : new Date(scrapeParams.since);
                scrapeResult = await this.extractorService.getMessagesSince(scrapeParams.channelName, sinceDate, scrapeParams.limit || 100);
            } else {
                scrapeResult = await this.extractorService.getMessages(scrapeParams.channelName, scrapeParams.limit || 100);
            }

            const messages = scrapeResult.messages || [];

            const sortedMessages = messages.sort((a: any, b: any) => {
                const timeA = new Date(a.timestamp_raw || a.timestamp).getTime();
                const timeB = new Date(b.timestamp_raw || b.timestamp).getTime();
                return timeA - timeB;
            });

            let firstMessageTimestamp = new Date();
            let lastMessageTimestamp = new Date();
            let timeDifference = 0;

            if (sortedMessages.length > 0) {
                firstMessageTimestamp = new Date(sortedMessages[0].timestamp_raw || sortedMessages[0].timestamp);
                lastMessageTimestamp = new Date(sortedMessages[sortedMessages.length - 1].timestamp_raw || sortedMessages[sortedMessages.length - 1].timestamp);
                timeDifference = Math.abs(lastMessageTimestamp.getTime() - firstMessageTimestamp.getTime());
            }

            logger.info(`✅ Scraped ${sortedMessages.length} messages from ${scrapeParams.channelName}`);

            let messageAnalysis = null;
            if (sortedMessages.length > 0) {
                try {
                    messageAnalysis = generateMessageStatistics(sortedMessages, triggerWords);
                } catch (e: any) {
                    logger.error(`Error generating message analysis: ${e.message}`);
                }
            }

            return {
                messages: sortedMessages,
                channelInfo: scrapeResult.channel_info,
                firstMessageTimestamp,
                lastMessageTimestamp,
                timeDifference,
                messageCount: sortedMessages.length,
                isIncremental: !!scrapeParams.since,
                analysis: messageAnalysis,
                statistics: {
                    message_count: sortedMessages.length,
                    first_message_timestamp: firstMessageTimestamp,
                    last_message_timestamp: lastMessageTimestamp,
                    time_difference_ms: timeDifference,
                    unique_users_count: scrapeResult.unique_users_count
                },
                usedTriggerWords: triggerWords
            };

        } catch (error: any) {
            logger.error(`Error scraping channel: ${error.message}`);
            throw new InternalServerError(`Failed to scrape channel: ${error.message}`);
        }
    }

    async summarizeMessages(messages: any[], channelName: string): Promise<string> {
        try {
            if (messages.length === 0) {
                return 'No messages to summarize.';
            }

            logger.info(`📝 Summarizing ${messages.length} messages for ${channelName}`);

            const summary = await this.summarizerService.summarizeCombinedMessages(messages, channelName, 'english');
            return summary || 'No summary available';

        } catch (error: any) {
            logger.error(`Error summarizing messages: ${error.message}`);
            throw new InternalServerError(`Summarization failed: ${error.message}`);
        }
    }

    async analyzeChannel(channelUsername: string, language: string = 'english', analysisType: 'simple' | 'comprehensive' = 'comprehensive'): Promise<any> {
        try {
            const triggerWords = ['important', 'urgent', 'announcement', 'update'];
            const scrapeResult = await this.extractorService.getMessages(channelUsername);

            if (!scrapeResult.messages || scrapeResult.messages.length === 0) {
                throw new BadRequestError('No messages found for analysis');
            }

            const analysisResult = await this.summarizerService.analyzeTelegramGroup(scrapeResult, language, analysisType);
            const messageAnalysis = generateMessageStatistics(scrapeResult.messages, triggerWords);

            return {
                analysis: analysisResult.analysis,
                statistics: analysisResult.statistics,
                top50Users: analysisResult.top_50_users_list,
                channelInfo: scrapeResult.channel_info,
                responseLanguage: analysisResult.response_language,
                timestamps: {
                    first_message: scrapeResult.first_message_timestamp,
                    last_message: scrapeResult.last_message_timestamp
                },
                message_analysis: messageAnalysis
            };

        } catch (error: any) {
            logger.error(`Error analyzing channel: ${error.message}`);
            throw new InternalServerError(`Failed to analyze channel: ${error.message}`);
        }
    }

    async getChannelInfo(channelName: string): Promise<any> {
        try {
            const result = await this.extractorService.getMessages(channelName, 1);
            return result.channel_info;
        } catch (error: any) {
            logger.error(`Error getting channel info: ${error.message}`);
            throw new BadRequestError('Channel not found or unavailable');
        }
    }

    async searchChannels(query: string): Promise<any[]> {
        logger.info('Channel search not yet implemented natively - returning empty');
        return [];
    }

    async getAccountsStatus(): Promise<any> {
        try {
            const statuses = await this.accountRepository.getAccountsStatus();
            return {
                success: true,
                total_accounts: statuses.length,
                accounts: statuses
            };
        } catch (error: any) {
            logger.error(`Error getting accounts status: ${error.message}`);
            throw new InternalServerError(`Failed to get accounts status: ${error.message}`);
        }
    }

    async resetAccountLimits(): Promise<any> {
        try {
            await this.accountRepository.resetRateLimits();
            return {
                success: true,
                message: 'Rate limits reset for all accounts'
            };
        } catch (error: any) {
            logger.error(`Error resetting account limits: ${error.message}`);
            throw new InternalServerError(`Failed to reset account limits: ${error.message}`);
        }
    }

    async getSupportedLanguages(): Promise<any[]> {
        return Object.keys(this.supportedLanguages).map(code => ({
            code,
            english_name: this.supportedLanguages[code].english,
            native_name: this.supportedLanguages[code].native
        }));
    }

    formatMessagesForStorage(messages: any[]): any[] {
        return messages.map(msg => ({
            timestamp: msg.timestamp,
            timestamp_raw: msg.timestamp_raw,
            text: msg.text,
            content: msg.content || msg.text,
            author: msg.author || msg.sender,
            sender: msg.sender,
            sender_id: msg.sender_id,
            username: msg.username,
            message_id: msg.message_id
        }));
    }

    validateChannelName(channelName: string): boolean {
        const validPattern = /^[a-zA-Z0-9_]{5,32}$/;
        return validPattern.test(channelName);
    }
}