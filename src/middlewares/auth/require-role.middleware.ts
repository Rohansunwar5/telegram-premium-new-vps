import { Request, Response, NextFunction } from 'express';
import { ForbiddenError } from '../../errors/forbidden.error';

export const requireRole = (role: 'user' | 'admin') => (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  if (req.user?.role !== role) {
    throw new ForbiddenError('Insufficient privileges');
  }
  next();
};

export default requireRole;
