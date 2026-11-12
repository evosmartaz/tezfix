import { toMinor, type AssignmentStatus, type CheckoutResponse, type PaymentIntentView, type PaymentStatus } from '@tezfiks/shared';
import { parseDeepLink } from '@tezfiks/mobile';

/**
 * Test-mode card payments (spec 7.1): the API returns a hosted checkout URL; the app opens it in an auth session
 * (expo-web-browser) that ends when the checkout redirects to this deep link. The server settles the intent before it
 * redirects, so the app always asks GET /payments/:id for the truth afterwards.
 */
export const PAYMENT_RETURN_URL = 'tezfiks://payment';

/** Amount limits of POST /wallet/topup and POST /assignments/:id/tip (qəpik). */
export const MIN_PAYMENT_AMOUNT = 100;
export const MAX_PAYMENT_AMOUNT = 100_000;

export const TOPUP_PRESETS = [1000, 2000, 5000, 10000] as const;
export const TIP_PRESETS = [200, 500, 1000] as const;

export interface PaymentReturn {
  paymentIntentId: string | null;
  status: PaymentStatus | null;
}

const STATUSES: readonly PaymentStatus[] = ['CREATED', 'SUCCEEDED', 'FAILED', 'CANCELLED'];

/** `tezfiks://payment?paymentIntentId=...&status=SUCCEEDED` → its parts; null for any other link. */
export function parsePaymentReturn(url: string | null | undefined): PaymentReturn | null {
  if (!url) return null;
  const link = parseDeepLink(url);
  if (!link || link.scheme !== 'tezfiks' || link.segments[0] !== 'payment') return null;
  const status = (link.query.status ?? '').toUpperCase();
  return {
    paymentIntentId: link.query.paymentIntentId || null,
    status: (STATUSES as readonly string[]).includes(status) ? (status as PaymentStatus) : null,
  };
}

export function isTerminalPayment(status: PaymentStatus | null | undefined): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELLED';
}

export type CheckoutResultStatus = 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'PENDING';

export interface CheckoutOutcome {
  status: CheckoutResultStatus;
  payment: PaymentIntentView | null;
  /** True when the checkout redirected back (the browser was not just closed). */
  returned: boolean;
}

export interface CheckoutDeps {
  /** expo-web-browser openAuthSessionAsync(url, redirectUrl). */
  openAuthSession(url: string, redirectUrl: string): Promise<{ type: string; url?: string }>;
  getPayment(id: string): Promise<PaymentIntentView>;
  sleep?(ms: number): Promise<void>;
  pollIntervalMs?: number;
  /** How long to wait for a settled intent after the checkout redirected back. */
  pollTimeoutMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function outcomeOf(p: PaymentIntentView | null, returned: boolean): CheckoutOutcome {
  if (!p) return { status: 'PENDING', payment: null, returned };
  if (p.status === 'CREATED') return { status: 'PENDING', payment: p, returned };
  return { status: p.status, payment: p, returned };
}

/**
 * Opens the checkout and resolves with the settled payment. After a redirect back the intent is polled until it is
 * terminal (or the timeout passes → PENDING); when the user simply closed the browser it is checked once.
 * Connectivity errors while polling never throw: the caller shows PENDING and the payment can be checked again.
 */
export async function completeCheckout(checkout: CheckoutResponse, deps: CheckoutDeps): Promise<CheckoutOutcome> {
  const sleep = deps.sleep ?? defaultSleep;
  const interval = deps.pollIntervalMs ?? 1000;
  const timeout = deps.pollTimeoutMs ?? 15_000;
  let result: { type: string; url?: string };
  try {
    result = await deps.openAuthSession(checkout.checkoutUrl, PAYMENT_RETURN_URL);
  } catch {
    result = { type: 'dismiss' };
  }
  const back = result.type === 'success' ? parsePaymentReturn(result.url) : null;
  const returned = !!back;
  let last: PaymentIntentView | null = null;
  const read = async () => {
    try {
      last = await deps.getPayment(checkout.paymentIntentId);
    } catch {
      // keep the last known state
    }
    return last;
  };
  await read();
  if (!returned) return outcomeOf(last, false);
  let waited = 0;
  while (!isTerminalPayment((last as PaymentIntentView | null)?.status) && waited < timeout) {
    await sleep(interval);
    waited += interval;
    await read();
  }
  return outcomeOf(last, true);
}

/** "12,50" / "12.5" / "12" → qəpik; null when the text is not a money amount. */
export function parseAmountInput(text: string): number | null {
  const clean = (text ?? '').trim();
  if (!clean) return null;
  try {
    const minor = toMinor(clean);
    return minor >= 0 ? minor : null;
  } catch {
    return null;
  }
}

/** i18n key of the amount problem, or null when it can be paid. */
export function validatePaymentAmount(minor: number | null, min = MIN_PAYMENT_AMOUNT, max = MAX_PAYMENT_AMOUNT): string | null {
  if (minor === null) return 'pay.errors.amountInvalid';
  if (minor < min) return 'pay.errors.amountTooSmall';
  if (minor > max) return 'pay.errors.amountTooLarge';
  return null;
}

/** Top-up that covers `needed` qəpik, rounded up to whole manats and kept inside the payment limits. */
export function suggestedTopUp(needed: number | null | undefined): number | null {
  if (!needed || needed <= 0) return null;
  const whole = Math.ceil(needed / 100) * 100;
  return Math.min(MAX_PAYMENT_AMOUNT, Math.max(MIN_PAYMENT_AMOUNT, whole));
}

/** Reads the `topup` route param of /wallet (qəpik as a string); anything else means "open the sheet without an amount". */
export function topUpParam(value: string | string[] | undefined): { open: boolean; amount: number | null } {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined) return { open: false, amount: null };
  const n = Number(raw);
  return { open: true, amount: Number.isInteger(n) && n > 0 ? Math.min(MAX_PAYMENT_AMOUNT, Math.max(MIN_PAYMENT_AMOUNT, n)) : null };
}

/** Route of the wallet with the top-up sheet open (pathname stays /wallet). */
export function walletTopUpHref(amount?: number | null): { pathname: '/wallet'; params: { topup: string } } {
  const suggested = suggestedTopUp(amount ?? null);
  return { pathname: '/wallet', params: { topup: suggested ? String(suggested) : 'open' } };
}

/** Amount chosen in the AmountPicker: a preset chip, or the typed amount. */
export function amountFromPicker(v: { preset: number | null; custom: string }): number | null {
  return v.preset ?? parseAmountInput(v.custom);
}

/** Waiting for a card payment to settle (webhook → payment.succeeded): poll every 2 s, give up after a minute. */
export const SETTLE_POLL_MS = 2000;
export const SETTLE_MAX_MS = 60_000;

/**
 * Poll interval of the tip page while the paid job settles: only while the job still waits for its payment
 * (PRICE_PROPOSED) and the time budget is not spent. A completed, disputed or cancelled job never settles by polling.
 */
export function settlePollMs(status: AssignmentStatus | undefined, expired: boolean, intervalMs: number = SETTLE_POLL_MS): number | false {
  if (expired) return false;
  return status === undefined || status === 'PRICE_PROPOSED' ? intervalMs : false;
}

/** Poll interval of the payment landing screen: until the intent is final or the time budget is spent. */
export function paymentPollMs(status: PaymentStatus | undefined, expired: boolean, intervalMs = 1500): number | false {
  return expired || isTerminalPayment(status) ? false : intervalMs;
}
