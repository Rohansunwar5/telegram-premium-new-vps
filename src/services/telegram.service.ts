import axios from 'axios';
import { UserRepository } from '../repository/user.repository';
import { InternalServerError } from '../errors/internal-server.error';

class TelegramService {
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

    async proxyRequest(query: string) {
        const API_URL = 'https://api.tgdev.io/tgscan/v1/test/search';
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