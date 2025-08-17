import { NextFunction, Request, Response } from "express";
import telegramService from "../services/telegram.service";
import axios from "axios";

export const searchChannels = async (req: Request, res: Response, next: NextFunction) => {
    const { search_query } = req.body;
    const response = await telegramService.searchChannels(search_query as string);
    
    next(response);
}

export const additionalChannel = async (req: Request, res: Response, next: NextFunction) => {
    const { search_query, channel_name } = req.body;
    const response = await telegramService.additionalChannel(search_query, channel_name);

    next(response);
} 
export const channelMessages = async (req: Request, res: Response, next: NextFunction) => {
    const { search_query, channel_name } = req.body;
    const response = await telegramService.channelMessages(search_query, channel_name);

    next(response);
} 


export const proxyRequest = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { query } = req.body;
        const userId = req.user?._id;

        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        const response = await telegramService.makeProxyRequest(userId.toString(), query);
        res.json(response);
    } catch (error) {
        next(error);
    }
};

export const analyzeChannel = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { channel_username, language } = req.body;
        
        if (!channel_username) {
            return res.status(400).json({ error: 'Channel username is required' });
        }

        // Optional: Validate language parameter on your server side
        const supportedLanguages = [
            'english', 'hindi', 'bengali', 'telugu', 'marathi', 'tamil', 
            'gujarati', 'urdu', 'kannada', 'odia', 'malayalam', 'punjabi', 
            'assamese', 'maithili', 'santali', 'konkani', 'sindhi', 
            'dogri', 'kashmiri', 'sanskrit', 'nepali'
        ];

        if (language && !supportedLanguages.includes(language.toLowerCase())) {
            return res.status(400).json({ 
                error: `Unsupported language: ${language}. Supported languages: ${supportedLanguages.join(', ')}` 
            });
        }

        const response = await telegramService.analyzeChannel(channel_username, language);
        res.json(response);
    } catch (error) {
        next(error);
    }
};

// Add this to your existing controllers
export const checkPhoneNumber = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { phoneNumber } = req.body;
        const userId = req.user?._id;
        
        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        const response = await telegramService.checkPhoneNumber(userId.toString(), phoneNumber);
        res.json(response);
    } catch (error) {
        next(error);
    }
};

export const tgDev = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { channel_name, user_id } = req.body;
        
        const response = await axios.post('https://msgchan.darkmap.org/fetch_messages/', 
            new URLSearchParams({ channel_name, user_id }), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
        res.json(response.data);
    } catch (error:any) {
        console.error('Proxy error:', error);
        res.status(500).json({ error: error.message });
    }

}; 

