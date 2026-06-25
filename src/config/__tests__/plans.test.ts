import { describe, it, expect } from 'vitest';
import { findPlanByAmount } from '../plans';

describe('findPlanByAmount (server-authoritative credit derivation)', () => {
  it('maps the exact gold INR amount to 50 credits', () => {
    expect(findPlanByAmount(15000, 'INR')).toEqual({ planType: 'gold', credits: 50 });
  });

  it('maps the exact silver USD amount to 20 credits', () => {
    expect(findPlanByAmount(10100, 'USD')).toEqual({ planType: 'silver', credits: 20 });
  });

  it('returns null for an amount that matches no plan (tampered amount)', () => {
    expect(findPlanByAmount(100, 'INR')).toBeNull();
  });

  it('returns null for an unknown currency', () => {
    expect(findPlanByAmount(15000, 'GBP')).toBeNull();
  });
});
