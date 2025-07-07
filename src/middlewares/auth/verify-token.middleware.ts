import JWT from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { BadRequestError } from '../../errors/bad-request.error';
import { encodedJWTCacheManager } from '../../services/cache/entities';
import { UnauthorizedError } from '../../errors/unauthorized.error';
import { decode, encode, encryptionKey } from '../../services/crypto.service';
import config from '../../config';

interface IJWTVerifyPayload {
  _id: string;
  sessionId: string;
}

const getAuthMiddlewareByJWTSecret = (jwtSecret: string) => async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      throw new BadRequestError('Authorization header is missing');
    }

    const token = authHeader.split(' ')[1];
    if (!token) throw new BadRequestError('Token is missing or invalid');
    const { _id, sessionId } = JWT.verify(token, jwtSecret) as IJWTVerifyPayload;

    const key = await encryptionKey(config.JWT_CACHE_ENCRYPTION_KEY);
    const cachedJWT = await encodedJWTCacheManager.get({ userId: _id, sessionId });

    if (!cachedJWT) {
      const encryptedData = await encode(token, key);
      await encodedJWTCacheManager.set({ userId: _id, sessionId }, encryptedData);
    } else if (cachedJWT) {
      const decodedJWT = await decode(cachedJWT, key);
      if (decodedJWT !== token) {
        throw new UnauthorizedError('Session Expired!');
      }
    }

    req.user = {
      _id,
      sessionId
    };
    next();
  } catch (error) {
    next();
  }
};
export default getAuthMiddlewareByJWTSecret;