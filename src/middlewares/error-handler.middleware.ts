import { NextFunction, Request } from 'express';
import { CustomError } from '../errors/custom.error';
import { ResponseType } from '../types/response.type';
import logger from '../utils/logger';
import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 18);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const globalHandler = async (data: any, req: Request, res: ResponseType, next: NextFunction) => {
  try {
    if (data instanceof CustomError) {
      const errors = data.serializeErrors();
      const errorId = nanoid();
      const message = `route: ${req.path}, errorMsg: ${errors[0].message}, rayId: ${errorId}`;
      logger.error(message);
      return res.status(data.statusCode).send({
        errors,
        error: message,
        statusCode: data.statusCode,
        message: errors[0].message,
        success: false
      });
    }

    if (data instanceof Error) {
      const statusCode = 500;
      const errorId = nanoid();
      // Log the full detail server-side only; never echo data.message to the client.
      logger.error(`route: ${req.path}, errorMsg: ${data.message}, rayId: ${errorId}`);
      return res.status(statusCode).json({
        errors: [
          {
            message: 'Internal server error'
          }
        ],
        statusCode,
        error: `rayId: ${errorId}`,
        message: 'Internal server error',
        success: false
      });
    }

    if (data) {
      const msg = data.msg;
      if (data['msg']) {
        delete data['msg'];
      }
      const statusCode = data.statusCode || 200;
      if (data['statusCode']) {
        delete data['statusCode'];
      }
      return res.status(statusCode).send({
        data,
        statusCode: statusCode,
        message: msg,
        success: true
      });
    } else {
      const errorId = nanoid();
      return res.status(500).json({
        statusCode: 500,
        message: `route: ${req.path}, errorMsg: INTERNAL SERVER ERROR, rayId: ${errorId}`,
        success: false
      });
    }
  } catch (error) {
    logger.error('Unexpected error in globalHandler:', error);
    next(error);
  }
};
