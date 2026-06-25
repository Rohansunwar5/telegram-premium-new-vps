// Server-authoritative plan pricing & credits. The client may only choose a
// planType + currency; it can never dictate the amount charged or the credits
// granted. Amounts are in the currency's smallest unit (paise / cents), i.e.
// already multiplied by 100 — they must match the Razorpay order amount exactly.
//
// ponytail: these mirror the current (test) frontend price table. Update here
// when real prices land — this file is the single source of truth.

export type PlanType = 'silver' | 'gold';
export type Currency = 'INR' | 'USD' | 'EUR';

export const PLANS: Record<PlanType, { credits: number; amount: Record<Currency, number> }> = {
  silver: { credits: 20, amount: { INR: 10000, USD: 10100, EUR: 10200 } },
  gold:   { credits: 50, amount: { INR: 15000, USD: 15100, EUR: 15200 } },
};

export const isPlanType = (v: unknown): v is PlanType => v === 'silver' || v === 'gold';
export const isCurrency = (v: unknown): v is Currency => v === 'INR' || v === 'USD' || v === 'EUR';

// Reverse-lookup: given the actually-paid amount + currency from the verified
// Razorpay order, find the matching plan. Returns null if nothing matches
// (e.g. someone created an order with a tampered amount).
export const findPlanByAmount = (
  amount: number,
  currency: string
): { planType: PlanType; credits: number } | null => {
  if (!isCurrency(currency)) return null;
  for (const planType of Object.keys(PLANS) as PlanType[]) {
    if (PLANS[planType].amount[currency] === amount) {
      return { planType, credits: PLANS[planType].credits };
    }
  }
  return null;
};
