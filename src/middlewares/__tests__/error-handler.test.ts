import { describe, it, expect, vi } from 'vitest';
import type { Request, NextFunction } from 'express';
import { globalHandler } from '../error-handler.middleware';
import { ResponseType } from '../../types/response.type';

const mockRes = () => {
  const res: Record<string, unknown> = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res as unknown as ResponseType & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  };
};

describe('globalHandler (M2: no internal error leak)', () => {
  it('returns a generic message for a plain Error, never the raw error text', async () => {
    const res = mockRes();
    const req = { path: '/secret-route' } as Request;
    const secret = 'mongodb+srv://user:pw@cluster';

    await globalHandler(new Error(secret), req, res, (() => {}) as NextFunction);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(body.message).toBe('Internal server error');
    expect(body.success).toBe(false);
  });
});
