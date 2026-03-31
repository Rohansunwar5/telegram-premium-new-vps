import { NextFunction, Request, Response } from "express";
import telegramService from "../services/telegram.service";
import axios from "axios";
import logger from "../utils/logger";

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
        logger.info(`proxyRequest controller called. userId=${userId}, query=${query ?? ''}`);

        if (!query) {
            logger.warn(`proxyRequest validation failed: missing query. userId=${userId}`);
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        const response = await telegramService.makeProxyRequest(userId.toString(), query);
        logger.info(`proxyRequest controller success. userId=${userId}`);
        res.json(response);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`proxyRequest controller error. userId=${req.user?._id}, error=${message}`);
        next(error);
    }
};

export const analyzeChannel = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { channel_username, language } = req.body;
        
        if (!channel_username) {
            return res.status(400).json({ error: 'Channel username is required' });
        }

        const supportedLanguages = [
            'english', 'hindi', 'bengali', 'telugu', 'marathi', 'tamil',
            'gujarati', 'urdu', 'kannada', 'odia', 'malayalam', 'punjabi',
            'assamese', 'maithili', 'santali', 'konkani', 'sindhi',
            'dogri', 'kashmiri', 'sanskrit', 'nepali', 'chinese'
        ];

        // Normalize language: extract English name from formats like "বাংলা (bengali)"
        const normalizedLanguage = language
            ? (language.match(/\(([^)]+)\)/)?.[1]?.toLowerCase() ?? language.toLowerCase())
            : language;

        if (normalizedLanguage && !supportedLanguages.includes(normalizedLanguage)) {
            return res.status(400).json({
                error: `Unsupported language: ${language}. Supported languages: ${supportedLanguages.join(', ')}`
            });
        }

        const response = await telegramService.analyzeChannel(channel_username, normalizedLanguage);
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
        logger.error(`tgDev proxy error: ${error?.message || String(error)}`);
        res.status(500).json({ error: error.message });
    }

}; 

