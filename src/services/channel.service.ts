import axios from 'axios';
import { InternalServerError } from '../errors/internal-server.error';
import { BadRequestError } from '../errors/bad-request.error';
import config from '../config';
import logger from '../utils/logger';

interface IScrapeParams {
    channelName: string;
    limit?: number | null;
    since?: Date | string;  
    triggerWords?: string[]; 
}

export class ChannelService {
    private openApiUrl: string;

    constructor() {
        this.openApiUrl = config.OPEN_API_URL;
    }

    async scrapeChannel(params: IScrapeParams | string): Promise<any> {
        try {
            let scrapeParams: IScrapeParams;
            
            if (typeof params === 'string') {
                scrapeParams = {
                    channelName: params,
                    limit: 100
                };
            } else {
                scrapeParams = params;
            }

            logger.info(`📡 Scraping ${scrapeParams.channelName}`, {
                limit: scrapeParams.limit,
                since: scrapeParams.since ? new Date(scrapeParams.since).toISOString() : 'all',
                triggerWords: scrapeParams.triggerWords || 'none'
            });

            // Build request body for your Flask API
            const requestBody: any = {
                channelName: scrapeParams.channelName
            };

            // Add optional parameters
            if (scrapeParams.limit !== undefined && scrapeParams.limit !== null) {
                requestBody.limit = scrapeParams.limit;
            }

            if (scrapeParams.since) {
                // Convert date to ISO string or timestamp as needed by your API
                requestBody.since = scrapeParams.since instanceof Date 
                    ? scrapeParams.since.toISOString() 
                    : scrapeParams.since;
            }

            // Add triggerWords if provided
            if (scrapeParams.triggerWords && scrapeParams.triggerWords.length > 0) {
                requestBody.triggerWords = scrapeParams.triggerWords;
                logger.info(`🎯 Sending trigger words to API: ${scrapeParams.triggerWords.join(', ')}`);
            }

            // Call your Flask API
            const response = await axios.post(
                `${this.openApiUrl}/scrape`,
                requestBody,
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 1200000 // 30 second timeout for scraping
                }
            );

            if (!response.data.success) {
                throw new BadRequestError(response.data.error || 'Scraping failed');
            }

            const messages = response.data.messages || [];
            
            // Sort messages by timestamp to ensure correct order
            const sortedMessages = messages.sort((a: any, b: any) => {
                const timeA = new Date(a.timestamp_raw || a.timestamp).getTime();
                const timeB = new Date(b.timestamp_raw || b.timestamp).getTime();
                return timeA - timeB;
            });

            // Calculate statistics
            let firstMessageTimestamp = new Date();
            let lastMessageTimestamp = new Date();
            let timeDifference = 0;

            if (sortedMessages.length > 0) {
                firstMessageTimestamp = new Date(sortedMessages[0].timestamp_raw || sortedMessages[0].timestamp);
                lastMessageTimestamp = new Date(sortedMessages[sortedMessages.length - 1].timestamp_raw || sortedMessages[sortedMessages.length - 1].timestamp);
                timeDifference = Math.abs(lastMessageTimestamp.getTime() - firstMessageTimestamp.getTime());
            }

            logger.info(`✅ Scraped ${sortedMessages.length} messages from ${scrapeParams.channelName}`, {
                firstMessage: firstMessageTimestamp.toISOString(),
                lastMessage: lastMessageTimestamp.toISOString(),
                timeSpan: this.formatDuration(timeDifference),
                withTriggerWords: !!(scrapeParams.triggerWords && scrapeParams.triggerWords.length > 0)
            });

            // FIXED: Include analysis and statistics from API response
            const result = {
                messages: sortedMessages,
                channelInfo: response.data.channelInfo,
                firstMessageTimestamp,
                lastMessageTimestamp,
                timeDifference,
                messageCount: sortedMessages.length,
                isIncremental: !!scrapeParams.since,
                // NEW: Include the analysis and statistics data from API
                analysis: response.data.analysis,
                statistics: response.data.statistics,
                // Include trigger words info in result
                usedTriggerWords: scrapeParams.triggerWords || []
            };

            // Log what analysis/statistics data we received
            if (response.data.analysis) {
                logger.info(`📊 Received analysis data:`, {
                    frequency_hourly_length: response.data.analysis.frequency_hourly?.length || 0,
                    frequency_user_count: Object.keys(response.data.analysis.frequency_user || {}).length,
                    frequency_weekday_count: Object.keys(response.data.analysis.frequency_weekday || {}).length,
                    links_count: response.data.analysis.links?.length || 0,
                    has_trigger_frequency: !!response.data.analysis.trigger_frequency
                });
            }

            if (response.data.statistics) {
                logger.info(`📈 Received statistics data:`, {
                    unique_users_count: response.data.statistics.unique_users_count,
                    message_count: response.data.statistics.message_count,
                    time_difference_ms: response.data.statistics.time_difference_ms
                });
            }

            return result;
            
        } catch (error: any) {
            logger.error('Error scraping channel:', error);
            
            if (error.response) {
                const errorMsg = error.response.data?.error || error.response.statusText || 'Unknown error';
                throw new BadRequestError(`Scraping failed: ${errorMsg}`);
            }
            
            if (error.code === 'ECONNABORTED') {
                throw new InternalServerError('Scraping timeout - channel may have too many messages');
            }
            
            throw new InternalServerError('Failed to scrape channel');
        }
    }

        private formatDuration(ms: number): string {
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            const days = Math.floor(hours / 24);

            if (days > 0) return `${days}d ${hours % 24}h`;
            if (hours > 0) return `${hours}h ${minutes % 60}m`;
            if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
            return `${seconds}s`;
        }

        async summarizeMessages(messages: any[], channelName: string): Promise<string> {
        try {
            if (messages.length === 0) {
                return 'No messages to summarize.';
            }

            logger.info(`📝 Summarizing ${messages.length} messages for ${channelName}`);

            // Call Flask API for summarization
            const response = await axios.post(
                `${this.openApiUrl}/summarize-messages`,
                {
                    messages,
                    channelName,
                    language: 'english',
                    triggerWords: ['important', 'urgent', 'announcement', 'update'], // Add trigger words
                    // Add message count for better context
                    context: {
                        totalMessages: messages.length,
                        timeRange: this.getTimeRange(messages)
                    }
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 1200000 // 60 second timeout for GPT summarization
                }
            );

            if (!response.data.success) {
                throw new InternalServerError('Summarization failed');
            }

            logger.info('✅ Summary generated successfully');

            // Add this after the API call for debugging
            console.log('API Response Keys:', Object.keys(response.data));
            console.log('Analysis field exists:', !!response.data.analysis);
            console.log('Analysis content preview:', response.data.analysis?.substring(0, 100));
                    
            // FIXED: Use 'analysis' instead of 'summary'
            return response.data.analysis || 'No summary available';
            
        } catch (error: any) {
            logger.error('Error summarizing messages:', error);
            
            if (error.response) {
                // Log the actual response for debugging
                logger.error('API Response:', error.response.data);
                throw new InternalServerError(`Summarization failed: ${error.response.data?.error || 'Unknown error'}`);
            }
            
            throw new InternalServerError('Failed to summarize messages');
        }
    }

    private getTimeRange(messages: any[]): string {
        if (messages.length === 0) return 'No messages';
        
        const timestamps = messages.map(m => new Date(m.timestamp_raw || m.timestamp).getTime());
        const earliest = new Date(Math.min(...timestamps));
        const latest = new Date(Math.max(...timestamps));
        
        return `${earliest.toISOString()} to ${latest.toISOString()}`;
    }

    async analyzeChannel(channelUsername: string, language: string = 'english'): Promise <any> {
        try {
        // Call Flask API for full channel analysis (existing feature)
        const response = await axios.post(
            `${this.openApiUrl}/analyze-channel`,
            {
            channel_username: channelUsername,
            language
            },
            {
            headers: {
                'Content-Type': 'application/json'
            },
            }
        );

        if (!response.data.success) {
            throw new BadRequestError(response.data.error || 'Analysis failed');
        }

        return {
            analysis: response.data.analysis,
            statistics: response.data.statistics,
            top50Users: response.data.top_50_users,
            channelInfo: response.data.channel_info,
            responseLanguage: response.data.response_language,
            timestamps: response.data.timestamps
        };
        } catch (error: any) {
        console.error('Error analyzing channel:', error);
        if (error.response) {
            if (error.response.status === 404) {
            throw new BadRequestError('Channel not found');
            }
            throw new BadRequestError(`Analysis failed: ${error.response.data.error || 'Unknown error'}`);
        }
        throw new InternalServerError('Failed to analyze channel');
        }
    }

    async getChannelInfo(channelName: string): Promise<any> {
        try {
            const response = await axios.get(
                `${this.openApiUrl}/channel-info/${channelName}`,
                {
                timeout: 10000
                }
            );

            if (!response.data.success) {
                throw new BadRequestError('Channel not found');
            }

            return response.data.channel_info;
        } catch (error: any) {
            console.error('Error getting channel info:', error);
            if (error.response && error.response.status === 404) {
                throw new BadRequestError('Channel not found');
            }
            throw new InternalServerError('Failed to get channel information');
        }
    }

    async searchChannels(query: string): Promise<any[]> {
        try {
            // This endpoint would need to be added to Flask API if channel search is needed
            // For now, returning empty array as placeholder
            console.log('Channel search not yet implemented in Flask API');
            return [];
        } catch (error: any) {
            console.error('Error searching channels:', error);
            throw new InternalServerError('Failed to search channels');
        }
    }

    async getAccountsStatus(): Promise<any> {
        try {
            const response = await axios.get(
                `${this.openApiUrl}/accounts/status`,
                {
                timeout: 5000
                }
            );

            if (!response.data.success) {
                throw new InternalServerError('Failed to get accounts status');
            }

            return response.data;
        } catch (error: any) {
            console.error('Error getting accounts status:', error);
            throw new InternalServerError('Failed to get accounts status');
        }
    }

    async resetAccountLimits(): Promise<any> {
        try {
            const response = await axios.post(
                `${this.openApiUrl}/accounts/reset-limits`,
                {},
                {
                timeout: 5000
                }
            );

            if (!response.data.success) {
                throw new InternalServerError('Failed to reset account limits');
            }

            return response.data;
        } catch (error: any) {
            console.error('Error resetting account limits:', error);
            throw new InternalServerError('Failed to reset account limits');
        }
    }

    async getSupportedLanguages(): Promise<any[]> {
        try {
            const response = await axios.get(
                `${this.openApiUrl}/supported-languages`,
                {
                timeout: 5000
                }
            );

            if (!response.data.success) {
                throw new InternalServerError('Failed to get supported languages');
            }

            return response.data.supported_languages;
        } catch (error: any) {
            console.error('Error getting supported languages:', error);
            throw new InternalServerError('Failed to get supported languages');
        }
    }

  // Helper method to format messages for consistency
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

  // Helper method to validate channel name format
    validateChannelName(channelName: string): boolean {
        // Basic validation - can be enhanced based on Telegram rules
        const validPattern = /^[a-zA-Z0-9_]{5,32}$/;
        return validPattern.test(channelName);
    }
}