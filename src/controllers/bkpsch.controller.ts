import { Request, Response, NextFunction } from 'express';
import { BkpschAutomation } from '../automation/bkpsch.automation';
import { UserRepository } from '../repository/user.repository';
import { PaymentRequired } from '../errors/payment-required.error';

const userRepository = new UserRepository();

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

export const bkpschNearbyController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { query } = req.body as { query?: string };
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    // Check user credits
    const user = await userRepository.getUserById(userId.toString());
    if (!user || user.credits < 20) {
      // Pass PaymentRequired error to global error handler
      return next(new PaymentRequired('Insufficient credits. This action requires 20 credits.'));
    }

    // Execute automation
    const result = await BkpschAutomation.executeNearbyFlow(query.trim());

    // Deduct credits after successful execution
    await userRepository.updateUserCredits(userId.toString(), -20);
    const updatedUser = await userRepository.getUserById(userId.toString());

    return res.status(200).json({ 
      result, 
      creditsRemaining: updatedUser?.credits 
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'SESSION_EXPIRED') {
      return res.status(500).json({ error: 'Internal automation session expired' });
    }
    return next(error);
  }
};
