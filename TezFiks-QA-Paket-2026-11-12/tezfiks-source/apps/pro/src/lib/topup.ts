import type { PaymentStatus } from '@tezfiks/shared';
import { buildDeepLink } from '@tezfiks/mobile';

/** TopupBodySchema: 1 AZN .. 1000 AZN. */
export const TOPUP_MIN = 100;
export const TOPUP_MAX = 100_000;
/** Quick amounts on the "+ Balansı artır" sheet (AZN). */
export const TOPUP_PRESETS = [10, 20, 50, 100] as const;

/** Return link of the test checkout (tezfiksusta://payment). */
export const PAYMENT_RETURN_URL = buildDeepLink('PRO', 'payment');

/** Typed AZN amount ("25", "12,50", "12.5") → qəpik, or an error key. */
export function parseTopupAmount(text: string): { amount: number | null; error: 'invalid' | 'tooSmall' | 'tooLarge' | null } {
  const clean = (text ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return { amount: null, error: 'invalid' };
  const [i, f = ''] = clean.split('.');
  const amount = Number(i) * 100 + Number((f + '00').slice(0, 2));
  if (amount < TOPUP_MIN) return { amount: null, error: 'tooSmall' };
  if (amount > TOPUP_MAX) return { amount: null, error: 'tooLarge' };
  return { amount, error: null };
}

/** How long the app keeps polling a checkout that was opened (the browser may never come back). */
export const PAYMENT_POLL_MS = 3_000;
export const PAYMENT_POLL_MAX_MS = 10 * 60_000;

export type CheckoutOutcome = 'pending' | 'succeeded' | 'failed';

/** Checkout result from the payment intent status (CREATED keeps polling). */
export function checkoutOutcome(status: PaymentStatus | null | undefined): CheckoutOutcome {
  if (status === 'SUCCEEDED') return 'succeeded';
  if (status === 'FAILED' || status === 'CANCELLED') return 'failed';
  return 'pending';
}

/** True while a started checkout should still be polled. */
export function shouldPollPayment(startedAtMs: number | null, status: PaymentStatus | null | undefined, now: number = Date.now()): boolean {
  if (startedAtMs === null) return false;
  if (checkoutOutcome(status) !== 'pending') return false;
  return now - startedAtMs < PAYMENT_POLL_MAX_MS;
}
