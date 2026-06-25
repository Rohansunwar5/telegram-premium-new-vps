import config from '../config';
import getAuthMiddlewareByJWTSecret from './auth/verify-token.middleware';
import requireAuth from './auth/require-auth.middleware';
import { requireRole } from './auth/require-role.middleware';

const isAdminLoggedIn = [
  getAuthMiddlewareByJWTSecret(config.ADMIN_JWT_SECRET),
  requireAuth,
  requireRole('admin'),
];

export default isAdminLoggedIn;
