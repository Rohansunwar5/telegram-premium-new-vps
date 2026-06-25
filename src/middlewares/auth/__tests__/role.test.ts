import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requireRole } from '../require-role.middleware';
import { ForbiddenError } from '../../../errors/forbidden.error';

const run = (user: unknown) => {
  const req = { user } as unknown as Request;
  const next = vi.fn();
  let thrown: unknown = null;
  try {
    requireRole('admin')(req, {} as Response, next);
  } catch (e) {
    thrown = e;
  }
  return { next, thrown };
};

describe("requireRole('admin')", () => {
  it('accepts an admin-role token', () => {
    const { next, thrown } = run({ role: 'admin' });
    expect(thrown).toBeNull();
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects a user-role token with ForbiddenError', () => {
    const { next, thrown } = run({ role: 'user' });
    expect(thrown).toBeInstanceOf(ForbiddenError);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a token with no role', () => {
    const { next, thrown } = run({});
    expect(thrown).toBeInstanceOf(ForbiddenError);
    expect(next).not.toHaveBeenCalled();
  });
});
