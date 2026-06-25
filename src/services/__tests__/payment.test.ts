import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const { fetchMock, createMock, updateMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock('../../config/razorpay', () => ({
  default: { orders: { fetch: fetchMock } },
}));
vi.mock('../../models/processedPayment.model', () => ({
  default: { create: createMock },
}));
vi.mock('../../repository/user.repository', () => ({
  UserRepository: class {
    updateUserCredits = updateMock;
  },
}));

import paymentService from '../payment.service';

const SECRET = 'test_secret';
const sign = (orderId: string, paymentId: string) =>
  crypto.createHmac('sha256', SECRET).update(`${orderId}|${paymentId}`).digest('hex');

beforeEach(() => {
  process.env.RAZORPAY_KEY_SECRET = SECRET;
  fetchMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
});

describe('payment.verifyAndAddCredits', () => {
  it('valid signature + gold amount → grants 50 credits and records the payment', async () => {
    fetchMock.mockResolvedValue({ amount: 15000, currency: 'INR' });
    createMock.mockResolvedValue({});
    updateMock.mockResolvedValue({ credits: 150 });

    const res = await paymentService.verifyAndAddCredits('u1', 'order_1', 'pay_1', sign('order_1', 'pay_1'));

    expect(res).toEqual({ success: true, credits: 150 });
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ paymentId: 'pay_1', credits: 50 }));
    expect(updateMock).toHaveBeenCalledWith('u1', 50);
  });

  it('replaying the same paymentId grants no further credits', async () => {
    fetchMock.mockResolvedValue({ amount: 15000, currency: 'INR' });
    createMock.mockRejectedValue({ code: 11000 }); // duplicate-key error

    const res = await paymentService.verifyAndAddCredits('u1', 'order_1', 'pay_1', sign('order_1', 'pay_1'));

    expect(res).toEqual({ success: false, alreadyProcessed: true });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('rejects when the paid amount matches no plan (pay-₹1-claim-top-plan)', async () => {
    fetchMock.mockResolvedValue({ amount: 1, currency: 'INR' });

    const res = await paymentService.verifyAndAddCredits('u1', 'order_1', 'pay_1', sign('order_1', 'pay_1'));

    expect(res).toEqual({ success: false });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects a wrong (same-length) signature without fetching the order', async () => {
    const wrong = sign('different_order', 'different_pay'); // valid HMAC length, wrong value
    const res = await paymentService.verifyAndAddCredits('u1', 'order_1', 'pay_1', wrong);

    expect(res).toEqual({ success: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
