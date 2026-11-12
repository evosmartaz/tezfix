import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { adminToken, createCompany, createCustomer } from '../helpers/factories';
import { ENV, loadEnv, type Env } from '../../src/config/env';
import { FakePaymentProvider } from '../../src/modules/payments/payment-provider';
import { sanitizeReturnUrl } from '../../src/modules/payments/return-url';
import { assignmentRow, setSettings, soloJob, toPriceProposed } from '../b3/helpers';
import { expectLedgerClean, openCheckout, submitCheckout } from './helpers';

const OK_CARD = '4242 4242 4242 4242';

/**
 * Hardening: the fake provider and its hosted TEST checkout are demo tooling. Without DEMO_MODE (and without the explicit
 * PAYMENTS_TEST_MODE opt-in that only non-production environments may set) no card payment intent, top-up or tip can be
 * created and the checkout page never books money. Cash keeps working. Admin balance adjustments are demo-only (spec:
 * "Demo only: admins can top up balances").
 */
describe('production guards: no test payments and no admin top-ups without DEMO_MODE', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp((b) =>
      b.overrideProvider(ENV).useValue({ ...loadEnv(), DEMO_MODE: false, PAYMENTS_TEST_MODE: false } satisfies Env),
    );
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await setSettings(t, { minCandidates: 0 });
  });

  it('the public config tells the apps to offer cash only', async () => {
    expect(await t.client().call(api.health.config)).toMatchObject({ demoMode: false, cardPayments: false });
  });

  it('wallet and company top-ups answer PAYMENTS_UNAVAILABLE (translated) and create no intent', async () => {
    const c = await createCustomer(t);
    await expect(t.client(c.token).call(api.wallet.topup, { body: { amount: 2000 } })).rejects.toMatchObject({
      code: 'PAYMENTS_UNAVAILABLE',
      status: 503,
    });
    const err = await t
      .client(c.token, 'en')
      .call(api.wallet.topup, { body: { amount: 2000 } })
      .catch((e: unknown) => e as { message: string });
    expect((err as { message: string }).message).toBe('Card payments are not available right now');
    const co = await createCompany(t);
    await expect(
      t.client(co.manager.token).call(api.company.topup, { params: { companyId: co.companyId }, body: { amount: 5000 } }),
    ).rejects.toMatchObject({ code: 'PAYMENTS_UNAVAILABLE' });
    expect(await t.prisma.paymentIntent.count()).toBe(0);
  });

  it('card payment of a job is refused (the job stays PRICE_PROPOSED), cash completes it', async () => {
    const job = await soloJob(t);
    await toPriceProposed(t, job, 4000, 1000);
    const C = t.client(job.c.token);
    await expect(C.call(api.assignments.confirmPrice, { params: { id: job.assignmentId }, body: { method: 'CARD' } })).rejects.toMatchObject({
      code: 'PAYMENTS_UNAVAILABLE',
    });
    expect(await assignmentRow(t, job.assignmentId)).toMatchObject({ status: 'PRICE_PROPOSED', paymentIntentId: null });
    expect(await t.prisma.paymentIntent.count()).toBe(0);
    const done = await C.call(api.assignments.confirmPrice, { params: { id: job.assignmentId }, body: { method: 'CASH' } });
    expect(done.assignment).toMatchObject({ status: 'COMPLETED' });
    await expectLedgerClean(t);
  });

  it('tips are refused', async () => {
    const job = await soloJob(t);
    await toPriceProposed(t, job, 4000, 0);
    // A card-paid completion from an earlier demo period (written directly: card payments cannot be made here).
    const intent = await t.prisma.paymentIntent.create({
      data: {
        purpose: 'JOB_PAYMENT',
        amount: 4000n,
        currency: 'AZN',
        status: 'SUCCEEDED',
        provider: 'fake',
        payerUserId: job.c.userId,
        walletAccountId: job.h.earningsAccountId,
        assignmentId: job.assignmentId,
        createdAt: t.clock.now(),
        completedAt: t.clock.now(),
      },
    });
    await t.prisma.assignment.update({
      where: { id: job.assignmentId },
      data: { status: 'COMPLETED', paymentMethod: 'CARD', paymentIntentId: intent.id, completedAt: t.clock.now(), endedAt: t.clock.now() },
    });
    await expect(
      t.client(job.c.token).call(api.assignments.tip, { params: { id: job.assignmentId }, body: { amount: 500 } }),
    ).rejects.toMatchObject({ code: 'PAYMENTS_UNAVAILABLE' });
    expect(await t.prisma.paymentIntent.count({ where: { purpose: 'TIP' } })).toBe(0);
  });

  it('an existing test checkout link can neither be opened nor paid: no money is booked', async () => {
    const c = await createCustomer(t);
    const intent = await t.prisma.paymentIntent.create({
      data: {
        purpose: 'WALLET_TOPUP',
        amount: 2000n,
        currency: 'AZN',
        status: 'CREATED',
        provider: 'fake',
        payerUserId: c.userId,
        walletAccountId: c.walletAccountId,
        createdAt: t.clock.now(),
      },
    });
    const url = t.app.get(FakePaymentProvider).checkoutUrl(intent);
    const page = await openCheckout(t, url);
    expect(page.status).toBe(403);
    expect(await page.text()).not.toContain('name="card"');
    const paid = await submitCheckout(t, url, { card: OK_CARD });
    expect(paid.status).toBe(403);
    expect((await t.prisma.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } })).status).toBe('CREATED');
    expect((await t.ledger.balance(c.walletAccountId)).posted).toBe(0);
    await expectLedgerClean(t);
  });

  it('admin wallet adjustments answer DEMO_DISABLED and post nothing', async () => {
    const c = await createCustomer(t);
    const admin = await adminToken(t);
    await expect(
      t.client(admin.token).call(api.admin.adjustWallet, {
        body: { owner: { type: 'CUSTOMER_ACCOUNT', id: c.accountId }, amount: 2500, reason: 'Kompensasiya' },
      }),
    ).rejects.toMatchObject({ code: 'DEMO_DISABLED', status: 403 });
    expect((await t.ledger.balance(c.walletAccountId)).posted).toBe(0);
    expect(await t.prisma.ledgerTransaction.count({ where: { kind: 'ADMIN_ADJUSTMENT' } })).toBe(0);
    expect(await t.prisma.auditLog.count({ where: { action: { startsWith: 'wallet.' } } })).toBe(0);
  });
});

describe('production guards: DEMO_MODE=true keeps test payments', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp((b) =>
      b.overrideProvider(ENV).useValue({ ...loadEnv(), DEMO_MODE: true, PAYMENTS_TEST_MODE: false } satisfies Env),
    );
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });

  it('top-up through the test checkout works in the demo', async () => {
    expect(await t.client().call(api.health.config)).toMatchObject({ demoMode: true, cardPayments: true });
    const c = await createCustomer(t);
    const out = await t.client(c.token).call(api.wallet.topup, { body: { amount: 2000 } });
    const res = await submitCheckout(t, out.checkoutUrl, { card: OK_CARD });
    expect(res.status).toBe(200);
    expect((await t.ledger.balance(c.walletAccountId)).posted).toBe(2000);
    await expectLedgerClean(t);
  });
});

describe('return URLs: Expo development schemes only outside production', () => {
  const base = {
    APP_SCHEME_CUSTOMER: 'tezfiks',
    APP_SCHEME_PRO: 'tezfiksusta',
    PUBLIC_BASE_URL: 'https://evosmart.az',
    CORS_ORIGINS: ['https://tezfiks.evosmart.az'],
  };
  const expo = ['exp://192.168.1.5:8081/--/payment/1', 'exps://u.expo.dev/x/--/payment/1', 'exp+tezfiks://payment/1', 'exp+tezfiks-usta://payment/1'];

  it('production drops exp:// and exps:// (and the Expo dev-client schemes); the app schemes and allowed origins stay', () => {
    const env = { ...base, NODE_ENV: 'production' as const };
    for (const url of expo) expect(sanitizeReturnUrl(url, env), url).toBeNull();
    expect(sanitizeReturnUrl('tezfiks://payment/1', env)).toBe('tezfiks://payment/1');
    expect(sanitizeReturnUrl('tezfiksusta://payment/1', env)).toBe('tezfiksusta://payment/1');
    expect(sanitizeReturnUrl('https://tezfiks.evosmart.az/tezfix/company/wallet', env)).toBe('https://tezfiks.evosmart.az/tezfix/company/wallet');
  });

  it('development and test accept them', () => {
    for (const NODE_ENV of ['development', 'test'] as const) {
      for (const url of expo) expect(sanitizeReturnUrl(url, { ...base, NODE_ENV }), url).toBe(url);
    }
  });
});
