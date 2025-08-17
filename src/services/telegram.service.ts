import axios from 'axios';
import { UserRepository } from '../repository/user.repository';
import { InternalServerError } from '../errors/internal-server.error';
import { NotFoundError } from '../errors/not-found.error';
import { BadRequestError } from '../errors/bad-request.error';
import { UnauthorizedError } from '../errors/unauthorized.error';
import { ForbiddenError } from '../errors/forbidden.error';
import { RequestValidationError } from '../errors/request-validation.error';
import { TooManyRequestsError } from '../errors/too-many-request.error';

class TelegramService {
    private readonly CREDITS_PER_REQUEST = 10;
    constructor(private readonly _userRepository: UserRepository){}

    async searchChannels(searchQuery: string){
        const response = await axios.post(
            'https://4phuyf7tlf.execute-api.us-east-1.amazonaws.com/prod/tg',
            { search_query: searchQuery }, 
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        if(response.status !== 200) {
            throw new InternalServerError('Failed to fetch channels');
        }

        return response.data;
    }

    async additionalChannel(searchQuery: string, channelName: string){
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

    async channelMessages(searchQuery: string, channelName: string){
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
            throw new InternalServerError('Failed to add channel');
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
        const API_KEY = process.env.TG_DEV_API_KEY;
     

        const formData = new URLSearchParams();
        formData.append('query', query);

        const response = await axios.post(API_URL, formData, {
            headers: {
                'Api-Key': API_KEY,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        if (response.status !== 200) {
            throw new InternalServerError('Failed to forward request');
        }

        const sortedData = this.sortResponseData(response.data);

        return sortedData;
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


   async analyzeChannel(channelUsername: string, language?: string) {
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
            return response.data;
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
                } 
                else if (error.request) {
                    throw new InternalServerError('Unable to connect to external API service');
                }
            }
            throw new InternalServerError('Unexpected error occurred while analyzing channel');
        }
    }
}

export default new TelegramService(new UserRepository());