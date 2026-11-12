import type { PaymentIntentView } from '@tezfiks/shared';
import { redirectSystemPath } from '../src/app/+native-intent';
import {
  MAX_PAYMENT_AMOUNT,
  MIN_PAYMENT_AMOUNT,
  PAYMENT_RETURN_URL,
  amountFromPicker,
  completeCheckout,
  isTerminalPayment,
  parseAmountInput,
  parsePaymentReturn,
  suggestedTopUp,
  topUpParam,
  validatePaymentAmount,
  walletTopUpHref,
} from '../src/lib/payments';
import { M3, intent } from './fixtures-m3';

const CHECKOUT = { paymentIntentId: M3.intent, checkoutUrl: 'http://10.0.2.2:3000/tezfix/api/pay/checkout/x?t=abc' };

function deps(statuses: Array<PaymentIntentView['status'] | Error>, browser: { type: string; url?: string } | Error) {
  const seen: string[] = [];
  let i = 0;
  const sleeps: number[] = [];
  return {
    seen,
    sleeps,
    d: {
      openAuthSession: jest.fn(async (url: string, redirect: string) => {
        seen.push(`${url} -> ${redirect}`);
        if (browser instanceof Error) throw browser;
        return browser;
      }),
      getPayment: jest.fn(async (id: string) => {
        const s = statuses[Math.min(i++, statuses.length - 1)];
        if (s instanceof Error) throw s;
        return intent({ id, status: s, checkoutUrl: s === 'CREATED' ? CHECKOUT.checkoutUrl : null });
      }),
      sleep: jest.fn(async (ms: number) => {
        sleeps.push(ms);
      }),
      pollIntervalMs: 1000,
      pollTimeoutMs: 5000,
    },
  };
}

describe('payment return link', () => {
  it('parses the checkout redirect with the intent id and status', () => {
    expect(parsePaymentReturn(`tezfiks://payment?paymentIntentId=${M3.intent}&status=SUCCEEDED`)).toEqual({ paymentIntentId: M3.intent, status: 'SUCCEEDED' });
    expect(parsePaymentReturn(`tezfiks://payment/?paymentIntentId=${M3.intent}&status=failed`)).toEqual({ paymentIntentId: M3.intent, status: 'FAILED' });
    expect(parsePaymentReturn('tezfiks://payment')).toEqual({ paymentIntentId: null, status: null });
    expect(parsePaymentReturn(`tezfiks://payment?paymentIntentId=${M3.intent}&status=HACKED`)).toEqual({ paymentIntentId: M3.intent, status: null });
  });

  it('ignores other links and other apps', () => {
    expect(parsePaymentReturn('tezfiks://request/abc')).toBeNull();
    expect(parsePaymentReturn('tezfiksusta://payment?paymentIntentId=x')).toBeNull();
    expect(parsePaymentReturn('https://evil.example/payment')).toBeNull();
    expect(parsePaymentReturn('')).toBeNull();
    expect(parsePaymentReturn(null)).toBeNull();
  });

  it('the return URL sent to the API is the app scheme the server allows', () => {
    expect(PAYMENT_RETURN_URL).toBe('tezfiks://payment');
  });

  it('native intent: a running app stays where it is; a cold start lands on the payment screen', () => {
    const url = `tezfiks://payment?paymentIntentId=${M3.intent}&status=SUCCEEDED`;
    expect(redirectSystemPath({ path: url, initial: false })).toBeNull();
    expect(redirectSystemPath({ path: url, initial: true })).toBe(`/payment?paymentIntentId=${M3.intent}&status=SUCCEEDED`);
    expect(redirectSystemPath({ path: 'tezfiks://payment', initial: true })).toBe('/');
    expect(redirectSystemPath({ path: 'tezfiks://request/abc', initial: false })).toBe('tezfiks://request/abc');
  });

  it('terminal statuses', () => {
    expect(isTerminalPayment('SUCCEEDED')).toBe(true);
    expect(isTerminalPayment('FAILED')).toBe(true);
    expect(isTerminalPayment('CANCELLED')).toBe(true);
    expect(isTerminalPayment('CREATED')).toBe(false);
    expect(isTerminalPayment(null)).toBe(false);
  });
});

describe('completeCheckout', () => {
  it('opens the checkout in an auth session that returns to tezfiks://payment and reads the settled intent', async () => {
    const { d, seen } = deps(['SUCCEEDED'], { type: 'success', url: `tezfiks://payment?paymentIntentId=${M3.intent}&status=SUCCEEDED` });
    const out = await completeCheckout(CHECKOUT, d);
    expect(seen).toEqual([`${CHECKOUT.checkoutUrl} -> tezfiks://payment`]);
    expect(out.status).toBe('SUCCEEDED');
    expect(out.returned).toBe(true);
    expect(out.payment?.id).toBe(M3.intent);
  });

  it('the link status is only a hint: the server answer wins', async () => {
    const { d } = deps(['FAILED'], { type: 'success', url: `tezfiks://payment?paymentIntentId=${M3.intent}&status=SUCCEEDED` });
    expect((await completeCheckout(CHECKOUT, d)).status).toBe('FAILED');
  });

  it('polls after the redirect until the intent settles', async () => {
    const { d, sleeps } = deps(['CREATED', 'CREATED', 'SUCCEEDED'], { type: 'success', url: `tezfiks://payment?paymentIntentId=${M3.intent}&status=SUCCEEDED` });
    const out = await completeCheckout(CHECKOUT, d);
    expect(out.status).toBe('SUCCEEDED');
    expect(d.getPayment).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1000, 1000]);
  });

  it('gives up after the timeout with PENDING (the payment can be checked again later)', async () => {
    const { d } = deps(['CREATED'], { type: 'success', url: 'tezfiks://payment' });
    const out = await completeCheckout(CHECKOUT, d);
    expect(out.status).toBe('PENDING');
    expect(d.getPayment).toHaveBeenCalledTimes(6);
  });

  it('closing the browser checks the intent once: still open → PENDING', async () => {
    const { d } = deps(['CREATED'], { type: 'cancel' });
    const out = await completeCheckout(CHECKOUT, d);
    expect(out).toMatchObject({ status: 'PENDING', returned: false });
    expect(d.getPayment).toHaveBeenCalledTimes(1);
    expect(d.sleep).not.toHaveBeenCalled();
  });

  it('closing the browser after paying still reports the success (Android redirect race)', async () => {
    const { d } = deps(['SUCCEEDED'], { type: 'dismiss' });
    expect((await completeCheckout(CHECKOUT, d)).status).toBe('SUCCEEDED');
  });

  it('a declined card and a cancelled checkout are reported as such', async () => {
    expect((await completeCheckout(CHECKOUT, deps(['FAILED'], { type: 'success', url: 'tezfiks://payment?status=FAILED' }).d)).status).toBe('FAILED');
    expect((await completeCheckout(CHECKOUT, deps(['CANCELLED'], { type: 'success', url: 'tezfiks://payment' }).d)).status).toBe('CANCELLED');
  });

  it('network errors while reading the intent never throw', async () => {
    const { d } = deps([new Error('offline'), 'SUCCEEDED'], { type: 'success', url: 'tezfiks://payment' });
    expect((await completeCheckout(CHECKOUT, d)).status).toBe('SUCCEEDED');
    const failing = deps([new Error('offline')], { type: 'cancel' });
    expect(await completeCheckout(CHECKOUT, failing.d)).toEqual({ status: 'PENDING', payment: null, returned: false });
  });

  it('a browser that cannot open counts as closed', async () => {
    const { d } = deps(['CREATED'], new Error('no browser'));
    expect((await completeCheckout(CHECKOUT, d)).status).toBe('PENDING');
  });
});

describe('money amounts', () => {
  it('parses typed manat amounts to qəpik', () => {
    expect(parseAmountInput('12')).toBe(1200);
    expect(parseAmountInput('12,5')).toBe(1250);
    expect(parseAmountInput('12.05')).toBe(1205);
    expect(parseAmountInput(' 7,50 ')).toBe(750);
    expect(parseAmountInput('')).toBeNull();
    expect(parseAmountInput('abc')).toBeNull();
    expect(parseAmountInput('1.234')).toBeNull();
    expect(parseAmountInput('-5')).toBeNull();
  });

  it('validates the API limits (1 ₼ .. 1000 ₼)', () => {
    expect(MIN_PAYMENT_AMOUNT).toBe(100);
    expect(MAX_PAYMENT_AMOUNT).toBe(100_000);
    expect(validatePaymentAmount(null)).toBe('pay.errors.amountInvalid');
    expect(validatePaymentAmount(99)).toBe('pay.errors.amountTooSmall');
    expect(validatePaymentAmount(100)).toBeNull();
    expect(validatePaymentAmount(100_000)).toBeNull();
    expect(validatePaymentAmount(100_001)).toBe('pay.errors.amountTooLarge');
  });

  it('suggests a whole-manat top-up that covers what is missing', () => {
    expect(suggestedTopUp(300)).toBe(300);
    expect(suggestedTopUp(1501)).toBe(1600);
    expect(suggestedTopUp(50)).toBe(100);
    expect(suggestedTopUp(500_000)).toBe(100_000);
    expect(suggestedTopUp(0)).toBeNull();
    expect(suggestedTopUp(-10)).toBeNull();
    expect(suggestedTopUp(null)).toBeNull();
  });

  it('the wallet route carries the suggested amount and keeps the /wallet pathname', () => {
    expect(walletTopUpHref(1500)).toEqual({ pathname: '/wallet', params: { topup: '1500' } });
    expect(walletTopUpHref(null)).toEqual({ pathname: '/wallet', params: { topup: 'open' } });
    expect(topUpParam('1500')).toEqual({ open: true, amount: 1500 });
    expect(topUpParam('open')).toEqual({ open: true, amount: null });
    expect(topUpParam(['20']).amount).toBe(100);
    expect(topUpParam('999999999')).toEqual({ open: true, amount: 100_000 });
    expect(topUpParam(undefined)).toEqual({ open: false, amount: null });
  });

  it('amount picker: a preset chip wins, otherwise the typed amount', () => {
    expect(amountFromPicker({ preset: 500, custom: '' })).toBe(500);
    expect(amountFromPicker({ preset: null, custom: '3,5' })).toBe(350);
    expect(amountFromPicker({ preset: null, custom: '' })).toBeNull();
  });
});
