import OpenAI from 'openai';
import config from '../config';
import logger from '../utils/logger';

export class GptSummarizerService {
    private client: OpenAI;

    constructor() {
        this.client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
    }

    private _getLanguageInstruction(language: string = 'english'): string {
        if (language.toLowerCase() !== 'english') {
            return `\n\nIMPORTANT: Provide the entire analysis in ${language}.`;
        }
        return '';
    }

    private _getComprehensivePromptStructure(): string {
        return `
        Create a unified, comprehensive analysis summary covering (translate if the messages are from language other than English):

        1. Activity Overview: Overall trends, peak activity periods, engagement patterns
        2. Key Topics & Themes: Identify and elaborate on 5-7 main discussion topics
        3. Important Events: Timeline of significant announcements, decisions, or events
        4. User Dynamics: Most influential users, community behaviors, interaction patterns
        5. Textual Pattern Mining
        6. Alias Pivoting (Actor Enumeration)
        7. Human Trafficking / Adult Scam Connections (if any)
        8. Cryptocurrency Indicators (Hidden) if any
        9. User-to-Alias Relationship Map in text
        10. Red Flags: Any concerning patterns, suspicious activities, fraud or content requiring attention
        11. Actionable Insights: Specific recommendations based on the analysis
        12. Executive Summary: 3-5 bullet points with the most critical findings
        `;
    }

    private _createSimpleAnalysisPrompt(
        totalMessages: number,
        userActivity: Record<string, any>,
        userSummary: string,
        messageText: string,
        languageInstruction: string
    ): string {
        return `
        Analyze this Telegram channel based on the last ${totalMessages} messages:

        TOTAL MESSAGES ANALYZED: ${totalMessages}
        TOTAL UNIQUE USERS: ${Object.keys(userActivity).length}

        TOP ACTIVE USERS:
        ${userSummary}

        RECENT MESSAGES:
        ${messageText}

        Please provide a comprehensive analysis covering (translate if the messages are from language other than English):
        1. Channel Overview (detailed summary)
        2. Most active users and their messages and mention
        3. Give me Alias Pivoting (Actor Enumeration)
        4. Textual Pattern Mining
        5. Human Trafficking / Adult Scam Connections (if any)
        6. Cryptocurrency Indicators (Hidden) if any
        7. User-to-Alias Relationship Map in text
        8. Key Insights
        ${languageInstruction}
        `;
    }

    async analyzeTelegramGroup(messagesData: any, responseLanguage: string = 'english', analysisType: 'simple' | 'comprehensive' = 'comprehensive'): Promise<any> {
        try {
            const messages = messagesData.messages || [];
            const topUsers = messagesData.top_active_users || [];
            const userActivity = messagesData.user_activity || {};
            const totalMessages = messagesData.total_messages || 0;
            const top50Users = messagesData.top_50_users || [];

            const messageText = messages.slice(0, 100).map((msg: any) =>
                `[${msg.timestamp}] ${msg.sender}: ${msg.text.substring(0, 300)}`
            ).join('\n\n');

            const userSummary = topUsers.map((u: any) =>
                `- ${u[0]}: ${u[1]} messages (${(u[1] / totalMessages * 100).toFixed(1)}% of total)`
            ).join('\n');

            const topUsersDetailed = top50Users.map((user: any) =>
                `${user.rank}. ${user.display_name} (${user.telegram_handle}) - ${user.message_count} messages`
            ).join('\n');

            const languageInstruction = this._getLanguageInstruction(responseLanguage);

            let prompt: string;
            if (analysisType === 'simple') {
                prompt = this._createSimpleAnalysisPrompt(totalMessages, userActivity, userSummary, messageText, languageInstruction);
            } else {
                prompt = `
            Analyze this Telegram channel based on the last ${totalMessages} messages:

            TOTAL MESSAGES ANALYZED: ${totalMessages}
            TOTAL UNIQUE USERS: ${Object.keys(userActivity).length}

            TOP ACTIVE USERS:
            ${userSummary}

            TOP 50 USERS WITH TELEGRAM HANDLES:
            ${topUsersDetailed}

            RECENT MESSAGES:
            ${messageText}

            ${this._getComprehensivePromptStructure()}
            ${languageInstruction}
            `;
            }

            const response = await this.client.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: 'You are an expert analyst specializing in Telegram channel analysis. You can communicate fluently in multiple languages and provide detailed analysis in the requested language.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 16000,
                temperature: 0.7
            });

            return {
                analysis: response.choices[0].message.content?.trim(),
                statistics: {
                    total_messages: totalMessages,
                    unique_users: Object.keys(userActivity).length,
                    top_users: topUsers,
                    messages_per_user: Object.keys(userActivity).length > 0 ? totalMessages / Object.keys(userActivity).length : 0
                },
                top_50_users_list: top50Users,
                response_language: {
                    code: responseLanguage.toLowerCase(),
                    english_name: responseLanguage,
                    native_name: responseLanguage
                }
            };

        } catch (e: any) {
            logger.error(`Error analyzing group: ${e.message}`);
            throw e;
        }
    }

    async summarizeCombinedMessages(allMessages: any[], channelName: string, responseLanguage: string = 'english'): Promise<string> {
        try {
            logger.info(`Processing ${allMessages.length} messages for channel ${channelName}`);

            const messageText = allMessages.slice(0, 300).map((msg: any) =>
                `[${msg.timestamp}] ${msg.sender}: ${msg.text.substring(0, 200)}`
            ).join('\n\n');

            const languageInstruction = this._getLanguageInstruction(responseLanguage);
            const prompt = `
            Analyze this Telegram channel "${channelName}" with comprehensive analysis:
            
            CHANNEL STATISTICS:
            - Total messages: ${allMessages.length}
            
            RECENT MESSAGES SAMPLE:
            ${messageText}
            
            ${this._getComprehensivePromptStructure()}
            ${languageInstruction}
            `;

            const response = await this.client.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: 'You are an expert analyst specializing in comprehensive Telegram channel analysis.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 4000,
                temperature: 0.7
            });

            return response.choices[0].message.content?.trim() || 'No summary generated.';

        } catch (e: any) {
            logger.error(`Error summarizing combined messages: ${e.message}`);
            throw e;
        }
    }
}
