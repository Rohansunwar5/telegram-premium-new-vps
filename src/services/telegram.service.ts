import axios from 'axios';
import config from '../config';
import { UserRepository } from '../repository/user.repository';
import { BkpschAutomation } from '../automation/bkpsch.automation';
import { InternalServerError } from '../errors/internal-server.error';
import { NotFoundError } from '../errors/not-found.error';
import { BadRequestError } from '../errors/bad-request.error';
import { UnauthorizedError } from '../errors/unauthorized.error';
import { ForbiddenError } from '../errors/forbidden.error';
import { RequestValidationError } from '../errors/request-validation.error';
import { TooManyRequestsError } from '../errors/too-many-request.error';

interface ApiResponse {
    account_used: number;
    analysis: string;
    channel: string;
    channel_info: {
        id: number;
        title: string;
        username: string;
    };
    message_analysis: {
        frequency_hourly: number[];
        frequency_user: Record<string, number>;
        frequency_weekday: Record<string, number>;
        links: Array<{
            links: string[];
            message_id: number;
        }>;
        trigger_frequency: Record<string, any>;
    };
    processed_at: string;
    response_language: {
        code: string;
        english_name: string;
        native_name: string;
    };
    statistics: {
        messages_per_user: number;
        top_users: Array<[string, number]>;
        total_messages: number;
        unique_users: number;
    };
    success: boolean;
    timestamps: {
        first_message: string;
        last_message: string;
    };
    top_50_users: Array<{
        display_name: string;
        first_seen: string;
        last_seen: string;
        message_count: number;
        rank: number;
        telegram_handle: string;
        user_id: number;
        username: string;
    }>;
}

interface TransformedBookmarkData {
    // Core bookmark fields (matching schema)
    channelName: string;
    channelId: string;
    totalMessages: number;
    uniqueUsersTotal: number;
    frequencyHourly: number[];
    frequencyUser: Record<string, number>;
    frequencyWeekday: Record<string, number>;
    totalLinks: number;
    firstMessageEver: Date | null;
    lastMessageEver: Date | null;
    lastStatisticsUpdate: Date;
    
    // Additional analysis data (preserved from API)
    analysis: string;
    accountUsed: number;
    responseLanguage: {
        code: string;
        englishName: string;
        nativeName: string;
    };
    messagesPerUser: number;
    topUsers: Array<[string, number]>;
    top50Users: Array<{
        displayName: string;
        firstSeen: string;
        lastSeen: string;
        messageCount: number;
        rank: number;
        telegramHandle: string;
        userId: number;
        username: string;
    }>;
    triggerFrequency: Record<string, any>;
    linkDetails: Array<{
        links: string[];
        messageId: number;
    }>;
    success: boolean;
}

function transformChannelAnalysisToBookmarkFormat(apiResponse: ApiResponse): TransformedBookmarkData {
    // Convert frequency_user object to regular object (not Map for JSON serialization)
    const frequencyUser = { ...apiResponse.message_analysis.frequency_user };

    // Convert frequency_weekday object to regular object with default values
    const frequencyWeekday: Record<string, number> = {
        monday: 0,
        tuesday: 0,
        wednesday: 0,
        thursday: 0,
        friday: 0,
        saturday: 0,
        sunday: 0
    };

    // Update with actual data from API response
    Object.entries(apiResponse.message_analysis.frequency_weekday).forEach(([day, count]) => {
        frequencyWeekday[day.toLowerCase()] = count as number;
    });

    // Calculate total links
    const totalLinks = apiResponse.message_analysis.links.reduce((total, linkGroup) => {
        return total + linkGroup.links.length;
    }, 0);

    return {
        channelName: apiResponse.channel_info.title,
        channelId: apiResponse.channel_info.id.toString(),
        totalMessages: apiResponse.statistics.total_messages,
        uniqueUsersTotal: apiResponse.statistics.unique_users,
        frequencyHourly: apiResponse.message_analysis.frequency_hourly,
        frequencyUser: frequencyUser,
        frequencyWeekday: frequencyWeekday,
        totalLinks: totalLinks,
        firstMessageEver: apiResponse.timestamps.first_message ? new Date(apiResponse.timestamps.first_message) : null,
        lastMessageEver: apiResponse.timestamps.last_message ? new Date(apiResponse.timestamps.last_message) : null,
        lastStatisticsUpdate: new Date(apiResponse.processed_at),
        
        // Additional analysis data (preserved from API)
        analysis: apiResponse.analysis,
        accountUsed: apiResponse.account_used,
        responseLanguage: {
            code: apiResponse.response_language.code,
            englishName: apiResponse.response_language.english_name,
            nativeName: apiResponse.response_language.native_name,
        },
        messagesPerUser: apiResponse.statistics.messages_per_user,
        topUsers: apiResponse.statistics.top_users,
        top50Users: apiResponse.top_50_users.map(user => ({
            displayName: user.display_name,
            firstSeen: user.first_seen,
            lastSeen: user.last_seen,
            messageCount: user.message_count,
            rank: user.rank,
            telegramHandle: user.telegram_handle,
            userId: user.user_id,
            username: user.username,
        })),
        triggerFrequency: apiResponse.message_analysis.trigger_frequency,
        linkDetails: apiResponse.message_analysis.links.map(link => ({
            links: link.links,
            messageId: link.message_id
        })),
        success: apiResponse.success,
    };
}

class TelegramService {
    private readonly CREDITS_PER_REQUEST = 1;
    
    constructor(private readonly _userRepository: UserRepository) {}

    async searchChannels(searchQuery: string) {
        const response = await axios.post(
            'https://4phuyf7tlf.execute-api.us-east-1.amazonaws.com/prod/tg',
            { search_query: searchQuery }, 
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        if (response.status !== 200) {
            throw new InternalServerError('Failed to fetch channels');
        }

        return response.data;
    }

    async additionalChannel(searchQuery: string, channelName: string) {
        const response = await axios.post(
            'https://4phuyf7tlf.execute-api.us-east-1.amazonaws.com/prod/add-ch',
            { search_query: searchQuery, channel_name: channelName },
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        if (response.status !== 200) {
            throw new InternalServerError('Failed to add channel');
        }
        
        return response.data;
    }

    async channelMessages(searchQuery: string, channelName: string) {
        const response = await axios.post(
            'https://4phuyf7tlf.execute-api.us-east-1.amazonaws.com/prod/get_tg_msg',
            { search_query: searchQuery, channel_name: channelName },
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        if (response.status !== 200) {
            throw new InternalServerError('Failed to get channel messages');
        }

        return response.data;
    }

    async checkUserCredits(userId: string) {
        const user = await this._userRepository.getUserById(userId);
        if (!user) {
            throw new NotFoundError('User not found');
        }
        if (user.credits <= 0) {
            throw new BadRequestError('You do not have enough credits. Please recharge to use this service.');
        }
        return user;
    }

    async deductCredits(userId: string, amount: number) {
        await this._userRepository.updateUserCredits(userId, -amount);
    }

    async makeProxyRequest(userId: string, query: string) {
        await this.checkUserCredits(userId);
        const response = await this.proxyRequest(query);
        
        if (this.isSuccessfulResponse(response)) {
            await this.deductCredits(userId, this.CREDITS_PER_REQUEST);
        }
        
        return response;
    }

    private isSuccessfulResponse(response: any): boolean {
        if (response?.status === 'error') {
            return false;
        }
        return true;
    }

    async checkPhoneNumber(userId: string, phoneNumber: string) {
        await this.checkUserCredits(userId);
        const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

        const response = await axios.post(
            'https://number-name.darkmap.org/check',
            [formattedPhone],
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        if (response.status !== 200) {
            throw new InternalServerError('Failed to check phone number');
        }

        const data = response.data;
        const phoneKey = Object.keys(data)[0];
        const userData = data[phoneKey];
        
        if (!userData || !userData.id) {
            throw new NotFoundError('No user found for this phone number');
        }
        
        return {
            success: true,
            userId: userData.id,
            username: userData.username,
            firstName: userData.first_name,
            lastName: userData.last_name,
            phone: userData.phone,
            verified: userData.verified,
            premium: userData.premium,
            status: userData.status
        };
    }

    async proxyRequest(query: string) {
        const API_URL = 'https://api.tgdev.io/tgscan/v1/search';
        const API_KEY = config.TG_DEV_API_KEY;

        const formData = new URLSearchParams();
        formData.append('query', query);

        try {
            const response = await axios.post(API_URL, formData, {
                headers: {
                    'Api-Key': API_KEY,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: 30000, // 30 second timeout — prevents silent hang causing 504 CORS error
            });

            if (response.status !== 200) {
                throw new InternalServerError("Failed to forward request");
            }

            const sortedData = this.sortResponseData(response.data);
            return sortedData;
        } catch (primaryError) {
            try {
                return await this.callBkpschFallback(query);
            } catch (fallbackError) {
                const message =
                    primaryError instanceof Error
                        ? primaryError.message
                        : 'Primary API request failed';

                throw new InternalServerError(
                    `Failed to forward request via primary and fallback providers. Primary error: ${message}`,
                );
            }
        }
    }

    private async callBkpschFallback(query: string) {
        try {
            const result = await BkpschAutomation.executeChatFlow(query.trim());
            return { result };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Fallback failed: ${errorMessage}`);
        }
    }

    private sortResponseData(data: any): any {
        if (!data?.result) return data;

        if (data.result.username_history) {
            data.result.username_history.sort((a: any, b: any) => {
                return new Date(b.date).getTime() - new Date(a.date).getTime();
            });
        }

        if (data.result.groups) {
            data.result.groups.sort((a: any, b: any) => {
                return new Date(b.date_updated).getTime() - new Date(a.date_updated).getTime();
            });
        }

        return data;
    }

    public async analyzeChannel(channelUsername: string, language?: string): Promise<TransformedBookmarkData> {
        const requestBody: { channel_username: string; language?: string } = {
            channel_username: channelUsername
        };
        
        if (language) {
            requestBody.language = language;
        }

        try {
            const response = await axios.post(
                'https://analyze.darkmap.org/analyze-channel',
                requestBody,
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                }
            );

            // Transform the API response to match bookmark schema format
            return transformChannelAnalysisToBookmarkFormat(response.data);

        } catch (error) {
            if (axios.isAxiosError(error)) {
                if (error.response) {
                    const status = error.response.status;
                    const errorMessage = error.response.data?.error || error.response.data?.message || error.response.statusText || 'Unknown error from external API';
                    
                    switch (status) {
                        case 400:
                            throw new BadRequestError(errorMessage);
                        case 404:
                            throw new NotFoundError(errorMessage);
                        case 401:
                            throw new UnauthorizedError(errorMessage);
                        case 403:
                            throw new ForbiddenError(errorMessage);
                        case 422:
                            throw new RequestValidationError(errorMessage);
                        case 429:
                            throw new TooManyRequestsError();
                        default:
                            throw new BadRequestError(errorMessage);
                    }
                } else if (error.request) {
                    throw new InternalServerError('Unable to connect to external API service');
                }
            }
            throw new InternalServerError('Unexpected error occurred while analyzing channel');
        }
    }
}

export default new TelegramService(new UserRepository());