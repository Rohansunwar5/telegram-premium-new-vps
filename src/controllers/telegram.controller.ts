import { NextFunction, Request, Response } from "express";
import telegramService from "../services/telegram.service";

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

export const startFirstServices = async (req: Request, res: Response, next: NextFunction) => {
    const { email } = req.body;
    const response = await telegramService.startFirstService(email);

    next(response);
} 

export const startSecondServices = async (req: Request, res: Response, next: NextFunction) => {
    const { email } = req.body;
    const response = await telegramService.startSecondService(email);

    next(response);
} 

export const proxyRequest = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { query } = req.body;

        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        const response = await telegramService.proxyRequest(query);
        res.json(response);
    } catch (error) {
        next(error);
    }
}; 