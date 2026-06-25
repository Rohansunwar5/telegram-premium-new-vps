import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const SECRET = vi.hoisted(() => 'test_jwt_secret');

vi.mock('../../config', () => ({
  default: { JWT_SECRET: SECRET, JWT_CACHE_ENCRYPTION_KEY: '00'.repeat(32) },
}));
vi.mock('../crypto.service', () => ({
  encode: vi.fn(async () => ({ iv: 'x', encryptedData: 'y' })),
  encryptionKey: vi.fn(async () => Buffer.alloc(32)),
}));
vi.mock('../cache/entities', () => ({
  encodedJWTCacheManager: { set: vi.fn(async () => undefined) },
  profileCacheManager: {},
}));
vi.mock('../../repository/user.repository', () => ({
  UserRepository: class {},
}));

import authService from '../auth.service';

describe('auth.service.generateJWTToken', () => {
  it("signs a token carrying _id, sessionId and role: 'user'", async () => {
    const token = await authService.generateJWTToken('user123');
    const payload = jwt.verify(token, SECRET) as Record<string, unknown>;

    expect(payload._id).toBe('user123');
    expect(typeof payload.sessionId).toBe('string');
    expect(payload.role).toBe('user');
  });
});
