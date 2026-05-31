import developmentLogger from './development';
import config from '../../config';
import { Request } from 'express-validator/src/base';

export interface LogDataJSON {
  ip: string;
  userId: string;
  path: string;
  body: string;
  params: string;
  query: string;
  method: string;
  PID: number;
}

export const getLogDataFromReqObject = (req: Request): string => {
  try {
    if (!req) return '(request object data Not Found)';

    const ip = req.headers?.['x-forwarded-for'] || req.ip || req.socket['remoteAddress'];
    const userId = req.user?._id;
    const path = req.path;
    const params = JSON.stringify(req.params);
    const query = JSON.stringify(req.query);
    const body = { ...req.body };

    // Remove sensitive data from logs
    delete body?.password;
    delete body?.secretKey;
    delete body?.confirmPassword;
    delete body?.token;
    delete body?.penpencilToken;
    delete body?.authProviderToken;
    delete body['g-recaptcha-response'];

    return `IP - ${ip}, UserId - ${userId}, Path - ${path}, Body - ${JSON.stringify(body)}, Params - ${params}, Query - ${query}, PID - ${process.pid}`;
  } catch (error) {
    logger.error(`getLogDataFromReqObject function error - ${error}, PID - ${process.pid}`);
    return '(request object data Not Found)';
  }
};

export const getLogDataInJSONFromReqObject = (req: Request): LogDataJSON => {
  try {
    const ip = req.headers?.['x-forwarded-for'] || req.ip || req.socket['remoteAddress'];
    const userId = req.user?._id;
    const path = req.path;
    const params = JSON.stringify(req.params);
    const query = JSON.stringify(req.query);
    const method = JSON.stringify(req.method);
    const body = { ...req.body };

    // Remove sensitive data from logs
    delete body?.password;
    delete body?.confirmPassword;
    delete body?.token;
    delete body['g-recaptcha-response'];

    return {
      ip,
      userId,
      path,
      body: JSON.stringify(body),
      params,
      query,
      method,
      PID: process.pid
    };
  } catch (error) {
    logger.error(`getLogDataInJSONFromReqObject function error - ${error}, PID - ${process.pid}`);
    throw new Error(`getLogDataFromReqObject function error - ${error}`);
  }
};

// Use development logger by default
const logger = developmentLogger;
export default logger;