import { NextFunction, Request, Response } from 'express';
import adminAuthService from '../services/adminAuth.service';

export const adminLogin = async (req: Request, res: Response, next: NextFunction) => {
  const { email, password } = req.body;
  const response = await adminAuthService.login({ email, password });
  next(response);
};

export const adminSignup = async (req: Request, res: Response, next: NextFunction) => {
  const { email, password } = req.body;
  const response = await adminAuthService.createAdmin({ email, password });
  next({ ...response, statusCode: 201, msg: 'Admin account created' });
};
