import config from '../config';
import getAuthMiddlewareByJWTSecret from './auth/verify-token.middleware';
import requireAuth from './auth/require-auth.middleware';

const isAdminLoggedIn = [
  getAuthMiddlewareByJWTSecret(config.ADMIN_JWT_SECRET),
  requireAuth,
];

export default isAdminLoggedIn;
