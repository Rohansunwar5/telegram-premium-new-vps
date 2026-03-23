import { Request, Response } from 'express';
import { BkpschAutomation } from '../automation/bkpsch.automation';

export const bkpschSearchController = async (req: Request, res: Response) => {
  try {
    const { query } = req.body as { query?: string };

    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const result = await BkpschAutomation.executeChatFlow(query.trim());
    return res.status(200).json({ result });
  } catch (error) {
    return res.status(500).json({ error: 'Internal server error' });
  }
};
