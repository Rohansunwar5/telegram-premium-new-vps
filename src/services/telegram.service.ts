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
import logger from '../utils/logger';

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
            const sortedPayload = sortedData as {
                result?: {
                    groups?: unknown;
                    username_history?: unknown;
                };
            };
            const groupsCount = Array.isArray(sortedPayload.result?.groups)
                ? sortedPayload.result.groups.length
                : 0;
            const usernameHistoryCount = Array.isArray(sortedPayload.result?.username_history)
                ? sortedPayload.result.username_history.length
                : 0;

            // eslint-disable-next-line no-console
            console.log(`[ProxyService] Primary response received for query="${query}" groups=${groupsCount} username_history=${usernameHistoryCount}`);

            if (this.isBlankProxyResponse(sortedData)) {
                // eslint-disable-next-line no-console
                console.log(`[ProxyService] Primary response considered blank for query="${query}". Triggering fallback.`);
                logger.warn(`proxyRequest primary provider returned empty result set, invoking fallback. query=${query}`);
                throw new Error('Primary API returned blank proxy data');
            }

            return this.withSource(sortedData, 'primary');
        } catch (primaryError) {
            const primaryErrorMessage =
                primaryError instanceof Error
                    ? primaryError.message
                    : 'Primary API request failed';

            // eslint-disable-next-line no-console
            console.log(`[ProxyService] Primary failed for query="${query}". Triggering fallback. Error=${primaryErrorMessage}`);
            logger.warn(`proxyRequest primary provider failed, invoking fallback. query=${query}, error=${primaryErrorMessage}`);
            try {
                const fallbackResponse = await this.callBkpschFallback(query);
                // eslint-disable-next-line no-console
                console.log(`[ProxyService] Fallback succeeded for query="${query}".`);
                logger.info(`proxyRequest fallback provider succeeded. query=${query}`);
                return this.withSource(fallbackResponse, 'fallback');
            } catch (fallbackError) {
                const fallbackErrorMessage =
                    fallbackError instanceof Error
                        ? fallbackError.message
                        : 'Fallback API request failed';

                // eslint-disable-next-line no-console
                console.error(`[ProxyService] Fallback failed for query="${query}". primaryError=${primaryErrorMessage} fallbackError=${fallbackErrorMessage}`);
                logger.error(
                    `proxyRequest fallback provider failed. query=${query}, primaryError=${primaryErrorMessage}, fallbackError=${fallbackErrorMessage}`,
                );

                throw new InternalServerError(
                    `Failed to forward request via primary and fallback providers. Primary error: ${primaryErrorMessage}`,
                );
            }
        }
    }

    private withSource(data: unknown, source: 'primary' | 'fallback') {
        if (!data || typeof data !== 'object') {
            return { source, result: data };
        }

        return {
            ...(data as Record<string, unknown>),
            source,
        };
    }

    private isBlankProxyResponse(data: unknown): boolean {
        if (!data || typeof data !== 'object') {
            return true;
        }

        const payload = data as {
            result?: {
                groups?: unknown;
                username_history?: unknown;
                user?: {
                    id?: number;
                    username?: string;
                    first_name?: string;
                };
            };
        };

        const result = payload.result;
        if (!result || typeof result !== 'object') {
            return true;
        }

        const groups = Array.isArray(result.groups) ? result.groups : [];
        const usernameHistory = Array.isArray(result.username_history) ? result.username_history : [];
        return groups.length === 0 && usernameHistory.length === 0;
    }

    private splitCsvLine(line: string): string[] {
        const cells: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];

            if (ch === '"') {
                const next = line[i + 1];
                if (inQuotes && next === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
                continue;
            }

            if (ch === ',' && !inQuotes) {
                cells.push(current.trim());
                current = '';
                continue;
            }

            current += ch;
        }

        cells.push(current.trim());
        return cells.map((cell) => cell.replace(/(^"|"$)/g, '').trim());
    }

    private normalizeDate(value: string, fallbackTimestamp: string): string {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString();
        }

        return fallbackTimestamp;
    }

    private findHeaderIndex(header: string[], keys: string[]): number {
        for (const key of keys) {
            const idx = header.findIndex((col) => col === key);
            if (idx >= 0) return idx;
        }
        return -1;
    }

    private normalizeTelegramUsername(value: string | null | undefined): string | null {
        if (!value) return null;
        const match = String(value).trim().match(/^@?([a-zA-Z0-9_]{3,})$/);
        return match?.[1] || null;
    }

    private parseCsvGroups(csvData: string | null, fallbackTimestamp: string): Array<{ title: string; id: string | number; date_updated: string; username?: string }> {
        const groups: Array<{ title: string; id: string | number; date_updated: string; username?: string }> = [];
        
        if (!csvData) return groups;

        const lines = csvData
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        if (lines.length === 0) return groups;

        const parsedRows = lines.map((line) => this.splitCsvLine(line));
        const header = parsedRows[0].map((col) => col.toLowerCase());
        const hasHeader = header.some((col) => /group|title|name|date|updated|id/.test(col));
        const rows = hasHeader ? parsedRows.slice(1) : parsedRows;

        const titleIdx = hasHeader
            ? this.findHeaderIndex(header, ['title', 'group', 'group_name', 'person.name', 'name', 'affiliation.alias'])
            : 0;
        const usernameIdx = hasHeader
            ? this.findHeaderIndex(header, ['username', 'group_username', 'telegram_handle', 'handle', 'channel_username', 'affiliation.alias'])
            : -1;
        const entityIdIdx = hasHeader
            ? this.findHeaderIndex(header, ['entityid', 'entity_id'])
            : -1;
        const uidIdx = hasHeader
            ? this.findHeaderIndex(header, ['affiliation.uid', 'uid', 'id', 'group_id', 'chat_id', 'targetentityid', 'sourceentityid'])
            : 1;
        const dateIdx = hasHeader
            ? this.findHeaderIndex(header, ['date_updated', 'updated_at', 'date', 'last_seen', 'time'])
            : 2;

        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const row = rows[rowIndex];
            if (!row.length) continue;

            const rawTitle = (titleIdx >= 0 ? row[titleIdx] : row[0]) || '';
            const rawUsername = usernameIdx >= 0 ? (row[usernameIdx] || '') : '';
            const rawEntityId = entityIdIdx >= 0 ? (row[entityIdIdx] || '') : '';
            const rawUid = uidIdx >= 0 ? (row[uidIdx] || '') : '';
            const rawDate = (dateIdx >= 0 ? row[dateIdx] : row[2]) || fallbackTimestamp;
            const normalizedUsername = this.normalizeTelegramUsername(rawUsername);

            // Preserve opaque tgdb/maltego IDs (e.g. 69c7dabcba434) exactly as strings.
            const rawId = rawEntityId || rawUid;
            if (!rawTitle && !rawId && !normalizedUsername) {
                continue;
            }

            const parsedId = /^\d+$/.test(rawId) ? Number(rawId) : (rawId || 'unknown');

            groups.push({
                title: rawTitle || (normalizedUsername || ''),
                id: parsedId,
                date_updated: this.normalizeDate(rawDate, fallbackTimestamp),
                username: normalizedUsername || undefined,
            });
        }

        return groups;
    }

    private extractFallbackGroupMentions(rawText: string): Array<{ title: string; username: string; id?: string }> {
        const mentions = Array.from(
            rawText.matchAll(/👥\s*([^\n]+)(?:.|\r|\n){0,220}?@([a-zA-Z0-9_]+)(?:\s*\n\s*#IDS([a-zA-Z0-9_]+))?/g),
        );

        return mentions.map((match) => ({
            title: (match[1] || '').trim(),
            username: (match[2] || '').trim(),
            id: match[3] ? match[3].trim() : undefined,
        }));
    }

    private normalizeFallbackGroups(
        rawText: string,
        csvData: string | null,
        fallbackTimestamp: string,
        userUsername: string,
    ): Array<{ title: string; id: string | number; date_updated: string; username: string }> {
        const csvGroups = this.parseCsvGroups(csvData, fallbackTimestamp);
        const mentionGroups = this.extractFallbackGroupMentions(rawText);
        const userHandle = this.normalizeTelegramUsername(userUsername);

        const csvByUsername = new Map<string, { title: string; id: string | number; date_updated: string; username?: string }>();
        for (const row of csvGroups) {
            const uname = this.normalizeTelegramUsername(row.username);
            if (uname && !csvByUsername.has(uname.toLowerCase())) {
                csvByUsername.set(uname.toLowerCase(), row);
            }
        }

        const sourceRows = mentionGroups.length > 0
            ? mentionGroups.map((item) => ({
                title: item.title,
                username: item.username,
                id: item.id || 'unknown',
                date_updated: fallbackTimestamp,
            }))
            : csvGroups;

        const normalized: Array<{ title: string; id: string | number; date_updated: string; username: string }> = [];
        const seen = new Set<string>();

        for (const row of sourceRows) {
            const username = this.normalizeTelegramUsername(row.username);
            if (!username) continue;
            if (userHandle && username.toLowerCase() === userHandle.toLowerCase()) continue;

            const lowerUsername = username.toLowerCase();
            if (seen.has(lowerUsername)) continue;

            const csvMatch = csvByUsername.get(lowerUsername);
            const titleCandidate = String(row.title || csvMatch?.title || '').trim();
            if (!titleCandidate || /^group\s+\d+$/i.test(titleCandidate)) {
                continue;
            }

            normalized.push({
                title: titleCandidate,
                username,
                id: row.id || csvMatch?.id || 'unknown',
                date_updated: this.normalizeDate(String(row.date_updated || csvMatch?.date_updated || fallbackTimestamp), fallbackTimestamp),
            });
            seen.add(lowerUsername);
        }

        return normalized;
    }

    private async callBkpschFallback(query: string) {
        try {
            const { result, csvData, timestamp, profileText } = await BkpschAutomation.executeChatFlow(query.trim());
            const userInfoText = [profileText, result].filter((part): part is string => Boolean(part)).join('\n');
            
            // 1. Extract user info safely
            const titleMatch = userInfoText ? userInfoText.match(/title:\s*([^\n]+)/i) : null;
            const nameMatch = userInfoText
                ? (userInfoText.match(/first name:\s*([^\n]+)/i) || userInfoText.match(/name:\s*([^\n]+)/i) || titleMatch)
                : null;
            const usernameLineMatches = userInfoText
                ? Array.from(userInfoText.matchAll(/username:\s*([^\n]+)/gi)).map((match) => match[1])
                : [];
            const idLineMatch = userInfoText ? userInfoText.match(/id:\s*([^\n]+)/i) : null;
            const numericIdFromLine = idLineMatch?.[1]?.match(/\d{5,}/)?.[0];

            const usernamesFromLine = usernameLineMatches.flatMap((line) =>
                (line.match(/@[a-zA-Z0-9_]+|[a-zA-Z0-9_]+/g) || []).map((entry) =>
                    entry.startsWith('@') ? entry : `@${entry}`,
                ),
            );

            const usernames = Array.from(
                new Set(
                    usernamesFromLine
                        .map((entry) => entry.trim())
                        .filter((entry) => entry.length > 1),
                ),
            );

            const user = {
                first_name: nameMatch ? nameMatch[1].trim() : 'Unknown',
                title: titleMatch ? titleMatch[1].trim() : (nameMatch ? nameMatch[1].trim() : 'Unknown'),
                username: usernames.length > 0 ? usernames[0] : query,
                usernames,
                id: numericIdFromLine ? Number(numericIdFromLine) : null,
            };

            // 2. Normalize fallback groups so title/username pairs are consistent for frontend links.
            const groupsWithUsernames = this.normalizeFallbackGroups(
                userInfoText || result || '',
                csvData,
                timestamp,
                user.username,
            );

            // 3. Assemble frontend-friendly payload
            const parsedData = {
                status: "ok",
                user: user,
                meta: {
                    num_groups: groupsWithUsernames.length
                },
                groups: groupsWithUsernames,
                username_history: [] // Fallback doesn't provide history natively
            };

            // Return matching the primary wrapper's expectation (`data.result`)
            // The frontend (`Navbar.jsx`) expects `telegramResponse.data.success` logic, 
            // but the `makeProxyRequest` returns `sortedData` directly which unwraps to just the object.
            return {
                status: "ok",
                result: parsedData
            };
            
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