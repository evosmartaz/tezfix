import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENV, type Env } from '../../src/config/env';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import {
  adminToken,
  createCompany,
  createCustomer,
  createSoloHandyman,
  createUser,
  tokenFor,
} from '../helpers/factories';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { sanitizeReturnUrl, withPaymentResult } from '../../src/modules/payments/return-url';
import { DomainEvents } from '../../src/infra/events';
import {
  createCompletedAssignment,
  expectLedgerClean,
  localUrl,
  openCheckout,
  payWithCard,
  submitCheckout,
} from './helpers';

const OK_CARD = '4242 4242 4242 4242';
const DECLINED_CARD = '4000 0000 0000 0002';

describe('A2 payments and test checkout', () => {
  let t: TestApp;
  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  beforeAll(async () => {
    t = await createTestApp();
    const events = t.app.get(DomainEvents);
    events.on('payment.succeeded', (e) => {
      succeeded.push(e.paymentIntentId);
    });
    events.on('payment.failed', (e) => {
      failed.push({ id: e.paymentIntentId, reason: e.reason });
    });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    succeeded.length = 0;
    failed.length = 0;
  });
  afterEach(async () => {
    await expectLedgerClean(t);
  });

  it('top-up end to end: checkout page, 4242 card, redirect to the app, balance credited once even if submitted twice', async () => {
    const c = await createCustomer(t, { balance: 0 });
    const client = t.client(c.token);
    const out = await client.call(api.wallet.topup, {
      body: { amount: 2000, returnUrl: 'tezfiks://payment/topup' },
    });
    expect(out.checkoutUrl).toBe(
      `http://127.0.0.1:3000/tezfix/api/pay/checkout/${out.paymentIntentId}?t=${new URL(out.checkoutUrl).searchParams.get('t')}`,
    );

    const pending = await client.call(api.payments.get, { params: { id: out.paymentIntentId } });
    expect(pending).toMatchObject({
      id: out.paymentIntentId,
      purpose: 'WALLET_TOPUP',
      amount: 2000,
      currency: 'AZN',
      status: 'CREATED',
      provider: 'fake',
      completedAt: null,
      failureReason: null,
      checkoutUrl: out.checkoutUrl,
    });

    const page = await openCheckout(t, out.checkoutUrl);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/text\/html/);
    const html = await page.text();
    expect(html).toContain('TEST REJİMİ');
    expect(html).toContain('20,00');
    expect(html).toContain('Balansın artırılması');
    expect(html).toContain('#2F5BFF');
    expect(html).toContain('name="viewport"');

    const res = await submitCheckout(t, out.checkoutUrl, { card: OK_CARD });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      `tezfiks://payment/topup?paymentIntentId=${out.paymentIntentId}&status=SUCCEEDED`,
    );

    const again = await submitCheckout(t, out.checkoutUrl, { card: OK_CARD });
    expect(again.status).toBe(303);
    expect(again.headers.get('location')).toContain('status=SUCCEEDED');

    const wallet = await client.call(api.wallet.get);
    expect(wallet.posted).toBe(2000);
    const tx = await client.call(api.wallet.transactions);
    expect(tx.items).toHaveLength(1);
    expect(tx.items[0]).toMatchObject({ kind: 'TOPUP', amount: 2000, balanceAfter: 2000 });

    const done = await client.call(api.payments.get, { params: { id: out.paymentIntentId } });
    expect(done.status).toBe('SUCCEEDED');
    expect(done.completedAt).not.toBeNull();
    expect(done.checkoutUrl).toBeNull();

    expect(succeeded).toEqual([out.paymentIntentId]);
    expect(t.realtime.sentTo(`user:${c.userId}`, 'payment:updated').map((e) => e.payload)).toEqual([
      { paymentIntentId: out.paymentIntentId, status: 'SUCCEEDED', purpose: 'WALLET_TOPUP' },
    ]);
    expect(t.realtime.sentTo(`user:${c.userId}`, 'wallet:updated').map((e) => e.payload)).toEqual([
      { owner: 'customer', companyId: null, available: 2000, posted: 2000 },
    ]);

    // opening the page again shows the result, not the form
    const result = await openCheckout(t, out.checkoutUrl);
    expect(result.status).toBe(200);
    const resultHtml = await result.text();
    expect(resultHtml).not.toContain('name="card"');
    expect(resultHtml).toContain('data-status="SUCCEEDED"');
  });

  it('concurrent submits of the same checkout credit the wallet exactly once', async () => {
    const c = await createCustomer(t);
    const out = await t.client(c.token).call(api.wallet.topup, { body: { amount: 5000 } });
    const responses = await Promise.all(
      [1, 2, 3, 4].map(() => submitCheckout(t, out.checkoutUrl, { card: OK_CARD })),
    );
    for (const r of responses) expect(r.status).toBe(200);
    expect((await t.ledger.balance(c.walletAccountId)).posted).toBe(5000);
    expect(await t.prisma.ledgerTransaction.count({ where: { paymentIntentId: out.paymentIntentId } })).toBe(
      1,
    );
    expect(succeeded).toEqual([out.paymentIntentId]);
  });

  it('declined card -> FAILED card_declined, nothing credited, payment.failed emitted', async () => {
    const c = await createCustomer(t);
    const out = await t
      .client(c.token)
      .call(api.wallet.topup, { body: { amount: 1500, returnUrl: 'tezfiks://payment/x' } });
    const res = await payWithCard(t, out.checkoutUrl, DECLINED_CARD);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      `tezfiks://payment/x?paymentIntentId=${out.paymentIntentId}&status=FAILED`,
    );
    const view = await t.client(c.token).call(api.payments.get, { params: { id: out.paymentIntentId } });
    expect(view).toMatchObject({ status: 'FAILED', failureReason: 'card_declined', checkoutUrl: null });
    expect((await t.ledger.balance(c.walletAccountId)).posted).toBe(0);
    expect(failed).toEqual([{ id: out.paymentIntentId, reason: 'card_declined' }]);
    expect(succeeded).toEqual([]);
    expect(t.realtime.sentTo(`user:${c.userId}`, 'wallet:updated')).toEqual([]);
    expect(
      t.realtime
        .sentTo(`user:${c.userId}`, 'payment:updated')
        .map((e) => (e.payload as { status: string }).status),
    ).toEqual(['FAILED']);
    // a later 4242 submit cannot revive a failed intent
    await submitCheckout(t, out.checkoutUrl, { card: OK_CARD });
    expect((await t.ledger.balance(c.walletAccountId)).posted).toBe(0);
  });

  it('any other card number -> FAILED unsupported_test_card; result page in the requested language', async () => {
    const c = await createCustomer(t);
    const out = await t.client(c.token).call(api.wallet.topup, { body: { amount: 1000 } });
    const res = await submitCheckout(t, out.checkoutUrl, { card: '5555 5555 5555 4444' }, 'en');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Payment failed');
    expect(html).toContain('This test card is not supported');
    const view = await t.client(c.token).call(api.payments.get, { params: { id: out.paymentIntentId } });
    expect(view).toMatchObject({ status: 'FAILED', failureReason: 'unsupported_test_card' });
  });

  it('cancel -> CANCELLED, nothing credited', async () => {
    const c = await createCustomer(t);
    const out = await t
      .client(c.token)
      .call(api.wallet.topup, { body: { amount: 1000, returnUrl: 'tezfiks://payment/c' } });
    const res = await submitCheckout(t, out.checkoutUrl, { action: 'cancel' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      `tezfiks://payment/c?paymentIntentId=${out.paymentIntentId}&status=CANCELLED`,
    );
    const view = await t.client(c.token).call(api.payments.get, { params: { id: out.paymentIntentId } });
    expect(view).toMatchObject({ status: 'CANCELLED', failureReason: 'cancelled' });
    expect((await t.ledger.balance(c.walletAccountId)).posted).toBe(0);
    expect(failed).toEqual([{ id: out.paymentIntentId, reason: 'cancelled' }]);
  });

  it('a tampered or missing token is refused with a 403 HTML page (GET and POST) and changes nothing', async () => {
    const c = await createCustomer(t);
    const out = await t.client(c.token).call(api.wallet.topup, { body: { amount: 1000 } });
    const u = new URL(localUrl(t, out.checkoutUrl));
    const goodToken = u.searchParams.get('t')!;
    const bad = goodToken.slice(0, -2) + (goodToken.endsWith('AA') ? 'BB' : 'AA');

    const get = await fetch(`${t.origin}${u.pathname}?t=${bad}`, { headers: { 'Accept-Language': 'ru' } });
    expect(get.status).toBe(403);
    expect(get.headers.get('content-type')).toMatch(/text\/html/);
    expect(await get.text()).toContain('Ссылка недействительна');

    // token of another intent
    const other = await t.client(c.token).call(api.wallet.topup, { body: { amount: 1000 } });
    const otherToken = new URL(other.checkoutUrl).searchParams.get('t')!;
    const cross = await fetch(`${t.origin}${u.pathname}?t=${otherToken}`);
    expect(cross.status).toBe(403);

    const post = await submitCheckout(t, out.checkoutUrl, { card: OK_CARD, t: bad });
    expect(post.status).toBe(403);
    const postNoToken = await submitCheckout(t, out.checkoutUrl, { card: OK_CARD, t: '' });
    expect(postNoToken.status).toBe(403);

    // unknown intent id with a syntactically valid token
    const unknown = await fetch(`${t.origin}/tezfix/api/pay/checkout/${crypto.randomUUID()}?t=${goodToken}`);
    expect(unknown.status).toBe(403);

    const view = await t.client(c.token).call(api.payments.get, { params: { id: out.paymentIntentId } });
    expect(view.status).toBe('CREATED');
    expect((await t.ledger.balance(c.walletAccountId)).posted).toBe(0);
  });

  it('a missing token or a malformed intent id gets the 403 HTML page, never a JSON error', async () => {
    const c = await createCustomer(t);
    const out = await t.client(c.token).call(api.wallet.topup, { body: { amount: 1000 } });
    const u = new URL(localUrl(t, out.checkoutUrl));
    const goodToken = u.searchParams.get('t')!;

    const noToken = await fetch(`${t.origin}${u.pathname}`, { headers: { 'Accept-Language': 'en' } });
    expect(noToken.status).toBe(403);
    expect(noToken.headers.get('content-type')).toMatch(/text\/html/);
    expect(noToken.headers.get('cache-control')).toBe('no-store');
    const noTokenHtml = await noToken.text();
    expect(noTokenHtml).not.toContain('"error"');
    expect(noTokenHtml).not.toContain('name="card"');

    const truncated = `${t.origin}/tezfix/api/pay/checkout/${out.paymentIntentId.slice(0, 20)}`;
    const badId = await fetch(`${truncated}?t=${goodToken}`, { headers: { 'Accept-Language': 'ru' } });
    expect(badId.status).toBe(403);
    expect(badId.headers.get('content-type')).toMatch(/text\/html/);
    expect(await badId.text()).toContain('Ссылка недействительна');

    const postBadId = await fetch(truncated, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept-Language': 'ru' },
      body: new URLSearchParams({ t: goodToken, card: OK_CARD, action: 'pay' }).toString(),
      redirect: 'manual',
    });
    expect(postBadId.status).toBe(403);
    expect(postBadId.headers.get('content-type')).toMatch(/text\/html/);
    expect(await postBadId.text()).toContain('Ссылка недействительна');

    // a later supported language in Accept-Language is honoured
    const deRu = await fetch(`${t.origin}${u.pathname}?t=bad`, {
      headers: { 'Accept-Language': 'de-DE,de;q=0.9,ru;q=0.8,en;q=0.5' },
    });
    expect(deRu.status).toBe(403);
    expect(await deRu.text()).toContain('Ссылка недействительна');

    const view = await t.client(c.token).call(api.payments.get, { params: { id: out.paymentIntentId } });
    expect(view.status).toBe('CREATED');
    expect((await t.ledger.balance(c.walletAccountId)).posted).toBe(0);
  });

  it('follows the 303 redirect after paying: the browser lands on the allowed return URL with the result (GET)', async () => {
    const hits: Array<{ method: string; url: string }> = [];
    const landing = http.createServer((req, res) => {
      hits.push({ method: req.method ?? '', url: req.url ?? '' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<p>TezFiks panel</p>');
    });
    await new Promise<void>((resolve) => landing.listen(0, '127.0.0.1', resolve));
    const landingOrigin = `http://127.0.0.1:${(landing.address() as AddressInfo).port}`;
    const env = t.app.get<Env>(ENV);
    const savedOrigins = env.CORS_ORIGINS;
    env.CORS_ORIGINS = [...savedOrigins, landingOrigin];
    try {
      const c = await createCustomer(t, { balance: 0 });
      const out = await t.client(c.token).call(api.wallet.topup, {
        body: { amount: 3500, returnUrl: `${landingOrigin}/tezfix/panel/wallet?tab=topup` },
      });
      const page = await openCheckout(t, out.checkoutUrl);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('name="card"');

      const body = new URLSearchParams({
        t: new URL(out.checkoutUrl).searchParams.get('t')!,
        card: OK_CARD,
        exp: '12/30',
        cvc: '123',
        name: 'Şəhla Əliyeva',
        action: 'pay',
      });
      const final = await fetch(`${t.origin}${new URL(out.checkoutUrl).pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'follow',
      });
      expect(final.redirected).toBe(true);
      expect(final.status).toBe(200);
      expect(final.url).toBe(
        `${landingOrigin}/tezfix/panel/wallet?tab=topup&paymentIntentId=${out.paymentIntentId}&status=SUCCEEDED`,
      );
      expect(await final.text()).toBe('<p>TezFiks panel</p>');
      // 303 turns the form POST into a GET on the return URL
      expect(hits).toEqual([
        {
          method: 'GET',
          url: `/tezfix/panel/wallet?tab=topup&paymentIntentId=${out.paymentIntentId}&status=SUCCEEDED`,
        },
      ]);
      expect((await t.ledger.balance(c.walletAccountId)).posted).toBe(3500);

      // a declined card also lands on the return URL, with status=FAILED, and credits nothing
      const declined = await t.client(c.token).call(api.wallet.topup, {
        body: { amount: 1000, returnUrl: `${landingOrigin}/tezfix/panel/wallet` },
      });
      const failedNav = await fetch(`${t.origin}${new URL(declined.checkoutUrl).pathname}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          t: new URL(declined.checkoutUrl).searchParams.get('t')!,
          card: DECLINED_CARD,
          action: 'pay',
        }).toString(),
      });
      expect(failedNav.status).toBe(200);
      expect(failedNav.url).toBe(
        `${landingOrigin}/tezfix/panel/wallet?paymentIntentId=${declined.paymentIntentId}&status=FAILED`,
      );
      expect((await t.ledger.balance(c.walletAccountId)).posted).toBe(3500);
    } finally {
      env.CORS_ORIGINS = savedOrigins;
      await new Promise<void>((resolve) => landing.close(() => resolve()));
    }
  });

  it('payment intent createdAt is business time (Clock)', async () => {
    t.clock.set('2027-03-03T10:00:00.000Z');
    const c = await createCustomer(t);
    const out = await t.client(c.token).call(api.wallet.topup, { body: { amount: 1000 } });
    const view = await t.client(c.token).call(api.payments.get, { params: { id: out.paymentIntentId } });
    expect(Math.abs(Date.parse(view.createdAt) - Date.parse('2027-03-03T10:00:00.000Z'))).toBeLessThan(5_000);
  });

  describe('open-redirect protection', () => {
    const cases: Array<[string, string | null]> = [
      ['https://evil.example.com/pay', null],
      ['http://127.0.0.1:3000.evil.com/x', null],
      ['//evil.example.com', null],
      ['javascript:alert(1)', null],
      ['https://user:pw@127.0.0.1:3000/x', null],
      ['tezfiksx://payment/1', null],
      ['tezfiks://', null],
      ['http://127.0.0.1:3000/tezfix/panel/wallet?tab=1', 'http://127.0.0.1:3000/tezfix/panel/wallet?tab=1'],
      ['tezfiks://payment/1', 'tezfiks://payment/1'],
      ['tezfiksusta://payment/1', 'tezfiksusta://payment/1'],
      ['exp://192.168.1.5:8081/--/payment/1', 'exp://192.168.1.5:8081/--/payment/1'],
      ['exp+tezfiks://payment/1', 'exp+tezfiks://payment/1'],
      ['exp+tezfiks-usta://payment/1', 'exp+tezfiks-usta://payment/1'],
    ];
    const env = {
      APP_SCHEME_CUSTOMER: 'tezfiks',
      APP_SCHEME_PRO: 'tezfiksusta',
      PUBLIC_BASE_URL: 'http://127.0.0.1:3000',
      CORS_ORIGINS: ['https://evosmart.az'],
    };

    it.each(cases)('sanitizeReturnUrl(%s)', (input, expected) => {
      expect(sanitizeReturnUrl(input, env)).toBe(expected);
    });

    it('allows CORS origins and appends the result before the fragment', () => {
      expect(sanitizeReturnUrl('https://evosmart.az/tezfix/company/wallet', env)).toBe(
        'https://evosmart.az/tezfix/company/wallet',
      );
      expect(withPaymentResult('https://a.b/x?y=1#frag', 'id1', 'SUCCEEDED')).toBe(
        'https://a.b/x?y=1&paymentIntentId=id1&status=SUCCEEDED#frag',
      );
      expect(withPaymentResult('tezfiks://payment/1', 'id1', 'FAILED')).toBe(
        'tezfiks://payment/1?paymentIntentId=id1&status=FAILED',
      );
    });

    it('a foreign returnUrl is dropped: the payment ends on the result page instead of redirecting', async () => {
      const c = await createCustomer(t);
      const out = await t
        .client(c.token)
        .call(api.wallet.topup, { body: { amount: 1000, returnUrl: 'https://evil.example.com/steal' } });
      const stored = await t.prisma.paymentIntent.findUniqueOrThrow({ where: { id: out.paymentIntentId } });
      expect(stored.returnUrl).toBeNull();
      const res = await submitCheckout(t, out.checkoutUrl, { card: OK_CARD });
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
      const html = await res.text();
      expect(html).toContain('data-status="SUCCEEDED"');
      expect(html).not.toContain('evil.example.com');
    });

    it('redirects to an allowed panel URL', async () => {
      const c = await createCustomer(t);
      const out = await t
        .client(c.token)
        .call(api.wallet.topup, {
          body: { amount: 1000, returnUrl: 'http://127.0.0.1:3000/tezfix/panel/wallet' },
        });
      const res = await submitCheckout(t, out.checkoutUrl, { card: OK_CARD });
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(
        `http://127.0.0.1:3000/tezfix/panel/wallet?paymentIntentId=${out.paymentIntentId}&status=SUCCEEDED`,
      );
    });
  });

  it('top-up validation: amount limits from the contract', async () => {
    const c = await createCustomer(t);
    await expect(t.client(c.token).call(api.wallet.topup, { body: { amount: 99 } })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      status: 400,
    });
    await expect(
      t.client(c.token).call(api.wallet.topup, { body: { amount: 100_001 } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const u = await createUser(t);
    const noAccount = await tokenFor(t, u.userId, 'CUSTOMER');
    await expect(
      t.client(noAccount).call(api.wallet.topup, { body: { amount: 1000 } }),
    ).rejects.toMatchObject({ code: 'CUSTOMER_ACCOUNT_REQUIRED' });
  });

  it('top-up is idempotent per Idempotency-Key', async () => {
    const c = await createCustomer(t);
    const client = t.client(c.token);
    const a = await client.call(api.wallet.topup, { body: { amount: 3000 }, idempotencyKey: 'topup-key-1' });
    const b = await client.call(api.wallet.topup, { body: { amount: 3000 }, idempotencyKey: 'topup-key-1' });
    expect(b.paymentIntentId).toBe(a.paymentIntentId);
    expect(await t.prisma.paymentIntent.count()).toBe(1);
    await expect(
      client.call(api.wallet.topup, { body: { amount: 4000 }, idempotencyKey: 'topup-key-1' }),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      status: 409,
    });
  });

  it('pro app top-up credits the solo handyman wallet', async () => {
    const h = await createSoloHandyman(t);
    const out = await t
      .client(h.token)
      .call(api.wallet.topup, { body: { amount: 1000, returnUrl: 'tezfiksusta://payment/1' } });
    const res = await payWithCard(t, out.checkoutUrl, OK_CARD);
    expect(res.headers.get('location')).toBe(
      `tezfiksusta://payment/1?paymentIntentId=${out.paymentIntentId}&status=SUCCEEDED`,
    );
    expect((await t.ledger.balance(h.walletAccountId!)).posted).toBe(1000);
    expect(t.realtime.sentTo(`user:${h.userId}`, 'wallet:updated').map((e) => e.payload)).toEqual([
      { owner: 'handyman', companyId: null, available: 1000, posted: 1000 },
    ]);
    const co = await createCompany(t, { workers: 1 });
    await expect(
      t.client(co.workers[0]!.token).call(api.wallet.topup, { body: { amount: 1000 } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('company top-up: managers only; credits the company wallet and notifies the company room', async () => {
    const co = await createCompany(t, { workers: 1 });
    await expect(
      t
        .client(co.workers[0]!.token)
        .call(api.company.topup, { params: { companyId: co.companyId }, body: { amount: 1000 } }),
    ).rejects.toMatchObject({ code: 'NOT_COMPANY_MANAGER', status: 403 });
    await expect(
      t
        .client(co.manager.token)
        .call(api.company.topup, { params: { companyId: crypto.randomUUID() }, body: { amount: 1000 } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const out = await t
      .client(co.manager.token)
      .call(api.company.topup, { params: { companyId: co.companyId }, body: { amount: 25_000 } });
    await payWithCard(t, out.checkoutUrl, OK_CARD);
    expect((await t.ledger.balance(co.walletAccountId)).posted).toBe(25_000);
    expect(t.realtime.sentTo(`company:${co.companyId}`, 'wallet:updated').map((e) => e.payload)).toEqual([
      { owner: 'company', companyId: co.companyId, available: 25_000, posted: 25_000 },
    ]);
    expect(t.realtime.sentTo(`company:${co.companyId}`, 'payment:updated')).toHaveLength(1);
    // a second manager of the company may read the intent; the worker may not
    const m2 = await createUser(t, { firstName: 'Leyla', lastName: 'Ağayeva' });
    await t.prisma.companyMember.create({
      data: { companyId: co.companyId, userId: m2.userId, role: 'MANAGER' },
    });
    const m2Token = await tokenFor(t, m2.userId, 'PANEL');
    expect(
      (await t.client(m2Token).call(api.payments.get, { params: { id: out.paymentIntentId } })).status,
    ).toBe('SUCCEEDED');
    await expect(
      t.client(co.workers[0]!.token).call(api.payments.get, { params: { id: out.paymentIntentId } }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('payments.get authorization: payer and admins; others get NOT_FOUND', async () => {
    const c = await createCustomer(t);
    const out = await t.client(c.token).call(api.wallet.topup, { body: { amount: 1000 } });
    const stranger = await createCustomer(t);
    await expect(
      t.client(stranger.token).call(api.payments.get, { params: { id: out.paymentIntentId } }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    await expect(
      t.client(c.token).call(api.payments.get, { params: { id: crypto.randomUUID() } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      t.client(null).call(api.payments.get, { params: { id: out.paymentIntentId } }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const admin = await adminToken(t, { role: 'OPERATOR' });
    expect(
      (await t.client(admin.token).call(api.payments.get, { params: { id: out.paymentIntentId } })).id,
    ).toBe(out.paymentIntentId);
  });

  it('PaymentsService: job payment and tip credit the provider EARNINGS with request references; settle is idempotent', async () => {
    const payments = t.app.get(PaymentsService);
    const c = await createCustomer(t);
    const h = await createSoloHandyman(t);
    const a = await createCompletedAssignment(t, {
      customer: c,
      handymanId: h.handymanId,
      acceptedByUserId: h.userId,
      paymentMethod: 'CARD',
      total: 4500,
      completedAt: t.clock.now(),
    });
    const { intent, checkoutUrl } = await payments.createIntent({
      purpose: 'JOB_PAYMENT',
      amount: 4500,
      payerUserId: c.userId,
      creditAccountId: h.earningsAccountId!,
      assignmentId: a.id,
      returnUrl: 'tezfiks://payment/job',
    });
    expect(intent).toMatchObject({
      status: 'CREATED',
      walletAccountId: h.earningsAccountId,
      assignmentId: a.id,
      returnUrl: 'tezfiks://payment/job',
    });
    expect(checkoutUrl).toContain(`/pay/checkout/${intent.id}?t=`);

    // the page labels the purpose
    const html = await (await openCheckout(t, checkoutUrl, 'en')).text();
    expect(html).toContain('Payment for the job');
    expect(html).toContain('₼45.00');

    const s1 = await payments.settle(intent.id, 'SUCCEEDED');
    const s2 = await payments.settle(intent.id, 'SUCCEEDED');
    const s3 = await payments.settle(intent.id, 'FAILED', 'late');
    expect(s1.status).toBe('SUCCEEDED');
    expect(s2.status).toBe('SUCCEEDED');
    expect(s3.status).toBe('SUCCEEDED');
    expect(succeeded).toEqual([intent.id]);
    expect(failed).toEqual([]);
    expect((await t.ledger.balance(h.earningsAccountId!)).posted).toBe(4500);
    expect((await t.ledger.balance(h.walletAccountId!)).posted).toBe(0);
    const txs = await t.prisma.ledgerTransaction.findMany({ where: { paymentIntentId: intent.id } });
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      kind: 'JOB_PAYMENT',
      assignmentId: a.id,
      requestId: a.requestId,
      actorType: 'USER',
      actorId: c.userId,
    });
    // earnings credits do not emit wallet:updated
    expect(t.realtime.sentTo(`user:${h.userId}`, 'wallet:updated')).toEqual([]);

    const tip = await payments.createIntent({
      purpose: 'TIP',
      amount: 500,
      payerUserId: c.userId,
      creditAccountId: h.earningsAccountId!,
      assignmentId: a.id,
    });
    await payments.settle(tip.intent.id, 'SUCCEEDED');
    const tipTx = await t.prisma.ledgerTransaction.findFirstOrThrow({
      where: { paymentIntentId: tip.intent.id },
    });
    expect(tipTx.kind).toBe('TIP');
    expect((await t.ledger.balance(h.earningsAccountId!)).posted).toBe(5000);

    await expect(payments.settle(crypto.randomUUID(), 'SUCCEEDED')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      payments.createIntent({
        purpose: 'TIP',
        amount: 0,
        payerUserId: c.userId,
        creditAccountId: h.earningsAccountId!,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      payments.createIntent({
        purpose: 'TIP',
        amount: 100,
        payerUserId: c.userId,
        creditAccountId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('admin payments list: payer names and filters, admin only', async () => {
    const c = await createCustomer(t, { firstName: 'Günel', lastName: 'Şükürova' });
    const a = await t.client(c.token).call(api.wallet.topup, { body: { amount: 1000 } });
    const b = await t.client(c.token).call(api.wallet.topup, { body: { amount: 2000 } });
    await submitCheckout(t, a.checkoutUrl, { card: OK_CARD });
    const admin = await adminToken(t);
    const all = await t.client(admin.token).call(api.admin.payments);
    expect(all.items.map((i) => i.id)).toEqual([b.paymentIntentId, a.paymentIntentId]);
    expect(all.items[0]).toMatchObject({ payerName: 'Günel Şükürova', status: 'CREATED', amount: 2000 });
    const ok = await t.client(admin.token).call(api.admin.payments, { query: { status: 'SUCCEEDED' } });
    expect(ok.items.map((i) => i.id)).toEqual([a.paymentIntentId]);
    const tips = await t.client(admin.token).call(api.admin.payments, { query: { purpose: 'TIP' } });
    expect(tips.items).toEqual([]);
    const p1 = await t.client(admin.token).call(api.admin.payments, { query: { limit: 1 } });
    expect(p1.items.map((i) => i.id)).toEqual([b.paymentIntentId]);
    const p2 = await t
      .client(admin.token)
      .call(api.admin.payments, { query: { limit: 1, cursor: p1.nextCursor! } });
    expect(p2.items.map((i) => i.id)).toEqual([a.paymentIntentId]);
    expect(p2.nextCursor).toBeNull();
    await expect(t.client(c.token).call(api.admin.payments)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
  });
});
