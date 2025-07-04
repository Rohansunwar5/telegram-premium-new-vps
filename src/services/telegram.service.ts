import axios from 'axios';
import { UserRepository } from '../repository/user.repository';
import { InternalServerError } from '../errors/internal-server.error';
import { NotFoundError } from '../errors/not-found.error';
import { BadRequestError } from '../errors/bad-request.error';

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

    async startFirstService(email: string){
        const response = await axios.post(
            `https://7bz70q53n2.execute-api.us-east-1.amazonaws.com/prod/start-service`,
            {email},
            {
                headers: {
                    'Content-Type': 'application/json',
                }
            }
        )

        if(response.status !== 200) {
            throw new InternalServerError('Failed to start first service');
        }

        return response.data;
    }

    async startSecondService(email: string){
        const response = await axios.post(
            `https://3n9j098tbf.execute-api.us-east-1.amazonaws.com/prod/start-services`,
            {email},
            {
                headers: {
                    'Content-Type': 'application/json',
                }
            }
        )

        if(response.status !== 200) {
            throw new InternalServerError('Failed to start first service');
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

    // Add this to your TelegramService class
async checkPhoneNumber(userId: string, phoneNumber: string) {
    // Check user has enough credits
    await this.checkUserCredits(userId);
    
    // Format phone number (ensure it starts with +)
    const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
    
    // Make the API request
    const response = await axios.post(
        'https://number-name.darkmap.org/check',
        [formattedPhone], // Note the array format
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
    
    // Extract the first key (phone number) from the response
    const phoneKey = Object.keys(data)[0];
    const userData = data[phoneKey];
    
    if (!userData || !userData.id) {
        throw new NotFoundError('No user found for this phone number');
    }

    // Deduct credits only if successful
    // await this.deductCredits(userId, this.CREDITS_PER_REQUEST);
    
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

        return response.data;
    }
}

export default new TelegramService(new UserRepository());