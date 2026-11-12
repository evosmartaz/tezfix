/**
 * Company panel Server Actions (BFF, lane P2): manager-only, validated input, bearer token server-side only,
 * idempotency keys forwarded, API errors as serializable results, revoked session -> login.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { expectNotFound, expectRedirect, resetServerMocks, state } from './server-mocks';
import {
  acceptOfferAction,
  activeAssignmentsAction,
  addReportAction,
  cancelAssignmentAction,
  companyOffersAction,
  completeProjectAction,
  createInviteAction,
  declineOfferAction,
  enterPriceAction,
  listAssignmentsAction,
  listTransactionsAction,
  reassignAction,
  removeMemberAction,
  revokeInviteAction,
  setPayoutMethodAction,
  submitQuoteAction,
  topupAction,
  updateMemberAction,
  updateSettingsAction,
  withdrawQuoteAction,
  workersLiveAction,
} from '@/features/company/actions';
import { apiError, makeJwt, meFixture, membership, mockApi, type ApiHandler } from './helpers';
import {
  CID,
  OTHER_CID,
  PID,
  assignment,
  companyView,
  invite,
  invoice,
  member,
  offer,
  providerProject,
  transactions,
  workerLive,
} from './company-fixtures';

const KEY = 'key-0123456789';
let accessToken = '';

function companySession(headers: Record<string, string> = {}) {
  accessToken = makeJwt(Math.floor(Date.now() / 1000) + 600);
  resetServerMocks({ tf_at: accessToken, tf_rt: 'rt-company-1234567890', tf_kind: 'company' }, headers);
}

const managerMe = meFixture([membership(CID, 'MANAGER', 'FixPro MMC'), membership(OTHER_CID, 'WORKER', 'Başqa MMC')]);

function asManager(handlers: Record<string, ApiHandler>) {
  return mockApi({ 'GET /me': () => ({ status: 200, body: managerMe }), ...handlers });
}

const ok = { status: 200, body: { ok: true } };
const base = `/company/${CID}`;

describe('company actions: session and authorization', () => {
  beforeEach(() => resetServerMocks());

  it('redirects to the company login without a session and never calls the API', async () => {
    const { calls } = mockApi({});
    expect(await expectRedirect(() => companyOffersAction(CID))).toBe('/company/login?expired=1');
    expect(calls).toHaveLength(0);
  });

  it('an admin session is not a company session', async () => {
    resetServerMocks({ tf_at: makeJwt(Math.floor(Date.now() / 1000) + 600), tf_rt: 'rt-admin-1234567890', tf_kind: 'admin' });
    const { calls } = mockApi({});
    expect(await expectRedirect(() => declineOfferAction(CID, PID.offer1))).toBe('/company/login?expired=1');
    expect(calls).toHaveLength(0);
  });

  it('404 for a company the user does not manage (worker membership or none); no company endpoint is called', async () => {
    companySession();
    const { calls } = asManager({});
    await expectNotFound(() => companyOffersAction(OTHER_CID));
    await expectNotFound(() => acceptOfferAction('55555555-5555-4555-8555-555555555555', PID.offer1, [PID.rauf], KEY));
    expect(calls.every((c) => c.path === '/me')).toBe(true);
  });

  it('rejects a malformed company id before touching the API', async () => {
    companySession();
    const { calls } = asManager({});
    const out = await companyOffersAction('not-a-uuid');
    expect(out).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(calls).toHaveLength(0);
  });

  it('a revoked session while calling the API goes to the login', async () => {
    companySession();
    asManager({ [`GET ${base}/offers/current`]: () => apiError(401, 'SESSION_REVOKED') });
    expect(await expectRedirect(() => companyOffersAction(CID))).toBe('/company/login?expired=1');
  });
});

describe('company actions: dispatch', () => {
  beforeEach(() => companySession());

  it('polls the current offers with the manager bearer token', async () => {
    const body = { items: [offer()], serverNow: '2026-10-25T10:00:00.000Z' };
    const { calls } = asManager({ [`GET ${base}/offers/current`]: () => ({ status: 200, body }) });
    const out = await companyOffersAction(CID);
    expect(out).toEqual({ ok: true, data: body });
    const call = calls.find((c) => c.path === `${base}/offers/current`)!;
    expect(call.headers.authorization).toBe(`Bearer ${accessToken}`);
  });

  it('accepts an offer with the chosen workers and the same idempotency key on a retry', async () => {
    const body = { assignments: [assignment()] };
    const { calls } = asManager({ [`POST ${base}/offers/${PID.offer1}/accept`]: () => ({ status: 200, body }) });
    const first = await acceptOfferAction(CID, PID.offer1, [PID.rauf, PID.tural], KEY);
    const retry = await acceptOfferAction(CID, PID.offer1, [PID.rauf, PID.tural], KEY);
    expect(first).toEqual({ ok: true, data: body });
    expect(retry.ok).toBe(true);
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    for (const p of posts) {
      expect(p.body).toEqual({ workerIds: [PID.rauf, PID.tural] });
      expect(p.headers['idempotency-key']).toBe(KEY);
      expect(p.headers.authorization).toBe(`Bearer ${accessToken}`);
    }
    expect(state.revalidated).toEqual(expect.arrayContaining([`${base}/dispatch`, `${base}/orders`, base]));
  });

  it('validates the accept input without calling the API', async () => {
    const { calls } = asManager({});
    expect(await acceptOfferAction(CID, PID.offer1, [], KEY)).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await acceptOfferAction(CID, PID.offer1, [PID.rauf, PID.rauf], KEY)).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await acceptOfferAction(CID, 'x', [PID.rauf], KEY)).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await acceptOfferAction(CID, PID.offer1, ['nope'], KEY)).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await acceptOfferAction(CID, PID.offer1, [PID.rauf], 'short')).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(calls.filter((c) => c.path !== '/me')).toHaveLength(0);
  });

  it('returns the API error code and localized message (insufficient balance, offer gone, worker busy)', async () => {
    asManager({
      [`POST ${base}/offers/${PID.offer1}/accept`]: () => apiError(402, 'INSUFFICIENT_BALANCE', 'Balans kifayət deyil'),
      [`POST ${base}/offers/${PID.offer2}/accept`]: () => apiError(409, 'OFFER_UNAVAILABLE', 'Sifariş artıq götürülüb'),
      [`POST ${base}/offers/${PID.offer3}/accept`]: () => apiError(409, 'WORKER_UNAVAILABLE', 'Usta məşğuldur'),
    });
    expect(await acceptOfferAction(CID, PID.offer1, [PID.rauf], KEY)).toMatchObject({
      ok: false,
      code: 'INSUFFICIENT_BALANCE',
      message: 'Balans kifayət deyil',
    });
    expect(await acceptOfferAction(CID, PID.offer2, [PID.rauf], KEY)).toMatchObject({ ok: false, code: 'OFFER_UNAVAILABLE' });
    expect(await acceptOfferAction(CID, PID.offer3, [PID.kamran], KEY)).toMatchObject({ ok: false, code: 'WORKER_UNAVAILABLE' });
  });

  it('declines an offer', async () => {
    const { calls } = asManager({ [`POST ${base}/offers/${PID.offer1}/decline`]: () => ok });
    expect(await declineOfferAction(CID, PID.offer1)).toEqual({ ok: true, data: { ok: true } });
    expect(calls.some((c) => c.method === 'POST' && c.path === `${base}/offers/${PID.offer1}/decline`)).toBe(true);
  });

  it('loads active jobs and live worker positions', async () => {
    const page = { items: [assignment()], nextCursor: null };
    const { fetchMock } = asManager({
      [`GET ${base}/assignments`]: () => ({ status: 200, body: page }),
      [`GET ${base}/workers/live`]: () => ({ status: 200, body: { items: [workerLive()] } }),
    });
    expect(await activeAssignmentsAction(CID)).toEqual({ ok: true, data: page });
    expect(await workersLiveAction(CID)).toEqual({ ok: true, data: { items: [workerLive()] } });
    const url = fetchMock.mock.calls
      .map(([u]) => new URL(String(u)))
      .find((u) => u.pathname.endsWith(`${base}/assignments`))!;
    expect(url.searchParams.get('scope')).toBe('active');
    expect(url.searchParams.get('limit')).toBe('100');
  });

  it('an endpoint that is not deployed yet (lane B3) gives NOT_FOUND, not a crash', async () => {
    asManager({});
    expect(await activeAssignmentsAction(CID)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('company actions: orders', () => {
  beforeEach(() => companySession());

  it('lists assignments with scope and cursor', async () => {
    const page = { items: [assignment()], nextCursor: 'c-2' };
    const { fetchMock } = asManager({ [`GET ${base}/assignments`]: () => ({ status: 200, body: page }) });
    expect(await listAssignmentsAction(CID, { scope: 'history', cursor: 'c-1', limit: 20 })).toEqual({ ok: true, data: page });
    const url = new URL(String(fetchMock.mock.calls.find(([u]) => String(u).includes('/assignments'))![0]));
    expect(url.searchParams.get('scope')).toBe('history');
    expect(url.searchParams.get('cursor')).toBe('c-1');
    expect(await listAssignmentsAction(CID, { scope: 'bogus' as never })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });

  it('manager price entry posts labor + materials with an idempotency key', async () => {
    const out = assignment({ status: 'PRICE_PROPOSED', price: { labor: 4000, materials: 1550, total: 5550 } });
    const { calls } = asManager({ [`POST ${base}/assignments/${PID.asg1}/price`]: () => ({ status: 200, body: out }) });
    expect(await enterPriceAction(CID, PID.asg1, { labor: 4000, materials: 1550 }, KEY)).toEqual({ ok: true, data: out });
    const call = calls.find((c) => c.method === 'POST')!;
    expect(call.body).toEqual({ labor: 4000, materials: 1550 });
    expect(call.headers['idempotency-key']).toBe(KEY);
    expect(state.revalidated).toContain(`${base}/orders/${PID.asg1}`);
    expect(await enterPriceAction(CID, PID.asg1, { labor: -1, materials: 0 }, KEY)).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('price entry refused by the API when the setting is WORKER (FORBIDDEN) is reported', async () => {
    asManager({ [`POST ${base}/assignments/${PID.asg1}/price`]: () => apiError(403, 'FORBIDDEN', 'İcazə yoxdur') });
    expect(await enterPriceAction(CID, PID.asg1, { labor: 100, materials: 0 }, KEY)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('reassigns to another worker', async () => {
    const out = assignment({ worker: { ...assignment().worker, handymanId: PID.tural, firstName: 'Tural', lastName: 'Əliyev' } });
    const { calls } = asManager({ [`POST ${base}/assignments/${PID.asg1}/reassign`]: () => ({ status: 200, body: out }) });
    expect(await reassignAction(CID, PID.asg1, PID.tural)).toMatchObject({ ok: true });
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ workerId: PID.tural });
    expect(await reassignAction(CID, PID.asg1, 'x')).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('cancels with an optional trimmed reason', async () => {
    const out = assignment({ status: 'CANCELLED_FREE', cancelledAt: '2026-10-25T10:01:00.000Z', cancelledBy: 'PROVIDER' });
    const { calls } = asManager({ [`POST ${base}/assignments/${PID.asg1}/cancel`]: () => ({ status: 200, body: out }) });
    await cancelAssignmentAction(CID, PID.asg1, '  Usta xəstələndi  ', KEY);
    await cancelAssignmentAction(CID, PID.asg1, '   ', 'key-9876543210');
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts[0]!.body).toEqual({ reason: 'Usta xəstələndi' });
    expect(posts[1]!.body).toEqual({});
    expect(posts[0]!.headers['idempotency-key']).toBe(KEY);
  });
});

describe('company actions: members, invites, settings', () => {
  beforeEach(() => companySession());

  it('updates a member role / trades and removes a member', async () => {
    const { calls } = asManager({
      [`PATCH ${base}/members/${PID.raufUser}`]: () => ({ status: 200, body: member({ role: 'MANAGER' }) }),
      [`DELETE ${base}/members/${PID.raufUser}`]: () => ok,
    });
    expect(await updateMemberAction(CID, PID.raufUser, { role: 'MANAGER' })).toMatchObject({ ok: true });
    expect(await updateMemberAction(CID, PID.raufUser, {})).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await updateMemberAction(CID, PID.raufUser, { tradeIds: [] })).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await removeMemberAction(CID, PID.raufUser)).toEqual({ ok: true, data: { ok: true } });
    expect(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.path}`)).toEqual([
      `PATCH ${base}/members/${PID.raufUser}`,
      `DELETE ${base}/members/${PID.raufUser}`,
    ]);
    expect(state.revalidated).toContain(`${base}/workers`);
  });

  it('the last manager cannot be demoted: the API error is passed through', async () => {
    asManager({ [`PATCH ${base}/members/${PID.managerUser}`]: () => apiError(409, 'INVALID_STATE', 'Son idarəedici') });
    expect(await updateMemberAction(CID, PID.managerUser, { role: 'WORKER' })).toMatchObject({ ok: false, code: 'INVALID_STATE' });
  });

  it('creates and revokes invites', async () => {
    const { calls } = asManager({
      [`POST ${base}/invites`]: () => ({ status: 200, body: invite }),
      [`DELETE ${base}/invites/${PID.invite}`]: () => ok,
    });
    expect(await createInviteAction(CID, { role: 'WORKER', maxUses: 10, expiresInDays: 7 })).toEqual({ ok: true, data: invite });
    expect(await createInviteAction(CID, { role: 'WORKER', maxUses: 0, expiresInDays: 7 })).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await revokeInviteAction(CID, PID.invite)).toMatchObject({ ok: true });
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ role: 'WORKER', maxUses: 10, expiresInDays: 7 });
  });

  it('updates the settings with a PATCH of the changed fields', async () => {
    const updated = companyView({ finalPriceEntry: 'WORKER' });
    const { calls } = asManager({ [`PATCH ${base}/settings`]: () => ({ status: 200, body: updated }) });
    expect(await updateSettingsAction(CID, { finalPriceEntry: 'WORKER', baseAddress: 'İçərişəhər, Qüllə küç. 3' })).toEqual({
      ok: true,
      data: updated,
    });
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      finalPriceEntry: 'WORKER',
      baseAddress: 'İçərişəhər, Qüllə küç. 3',
    });
    expect(await updateSettingsAction(CID, { serviceRadiusKm: 99 })).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('company actions: balance', () => {
  it('top-up creates a checkout returning to the Balans page of this panel', async () => {
    companySession({ origin: 'https://tezfiks.az' });
    const checkout = { paymentIntentId: PID.tx, checkoutUrl: 'https://tezfiks.az/tezfix/api/payments/checkout/x' };
    const { calls } = asManager({ [`POST ${base}/wallet/topup`]: () => ({ status: 200, body: checkout }) });
    expect(await topupAction(CID, 5000, KEY)).toEqual({ ok: true, data: checkout });
    const call = calls.find((c) => c.method === 'POST')!;
    expect(call.body).toEqual({ amount: 5000, returnUrl: `https://tezfiks.az/tezfix/company/${CID}/balance?topup=done` });
    expect(call.headers['idempotency-key']).toBe(KEY);
  });

  it('top-up uses the forwarded host without an Origin header and validates the amount', async () => {
    companySession({ host: '127.0.0.1:3120', 'x-forwarded-proto': 'http' });
    const { calls } = asManager({
      [`POST ${base}/wallet/topup`]: () => ({ status: 200, body: { paymentIntentId: PID.tx, checkoutUrl: 'http://x/checkout' } }),
    });
    await topupAction(CID, 100, KEY);
    expect((calls.find((c) => c.method === 'POST')!.body as { returnUrl: string }).returnUrl).toBe(
      `http://127.0.0.1:3120/tezfix/company/${CID}/balance?topup=done`,
    );
    expect(await topupAction(CID, 99, KEY)).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await topupAction(CID, 100_001, KEY)).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('lists transactions and saves the payout card', async () => {
    companySession();
    const saved = { type: 'CARD', maskedNumber: '**** 5678', holderName: 'Elvin Məmmədov', updatedAt: '2026-10-25T10:00:00.000Z' };
    const { calls } = asManager({
      [`GET ${base}/wallet/transactions`]: () => ({ status: 200, body: transactions }),
      [`PUT ${base}/payout-method`]: () => ({ status: 200, body: saved }),
    });
    expect(await listTransactionsAction(CID, { limit: 20 })).toEqual({ ok: true, data: transactions });
    expect(await setPayoutMethodAction(CID, { type: 'CARD', number: '4169738812345678', holderName: 'Elvin Məmmədov' })).toEqual({
      ok: true,
      data: saved,
    });
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({
      type: 'CARD',
      number: '4169738812345678',
      holderName: 'Elvin Məmmədov',
    });
    expect(await setPayoutMethodAction(CID, { type: 'CARD', number: '1', holderName: 'Elvin' })).toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('company actions: B2B projects', () => {
  beforeEach(() => companySession());

  it('quotes always act as this company (companyId forced), with an idempotency key', async () => {
    const quote = {
      id: PID.quote,
      projectId: PID.project,
      status: 'SUBMITTED',
      provider: {
        type: 'COMPANY',
        handymanId: null,
        companyId: CID,
        name: 'FixPro MMC',
        photo: null,
        ratingAvg: 4.6,
        ratingCount: 40,
        completedCount: 120,
        isVatPayer: true,
      },
      totalAmount: 500000,
      workers: 3,
      days: 5,
      note: null,
      createdAt: '2026-10-25T10:00:00.000Z',
      feeHeld: 15000,
      feeCaptured: false,
    };
    const { calls } = asManager({ [`POST /provider/projects/${PID.project}/quotes`]: () => ({ status: 200, body: quote }) });
    const out = await submitQuoteAction(
      CID,
      PID.project,
      { companyId: OTHER_CID, totalAmount: 500000, workers: 3, days: 5 },
      KEY,
    );
    expect(out).toEqual({ ok: true, data: quote });
    const call = calls.find((c) => c.method === 'POST')!;
    expect(call.body).toEqual({ companyId: CID, totalAmount: 500000, workers: 3, days: 5 });
    expect(call.headers['idempotency-key']).toBe(KEY);
  });

  it('quote window closed is reported', async () => {
    asManager({ [`POST /provider/projects/${PID.project}/quotes`]: () => apiError(409, 'QUOTE_WINDOW_CLOSED', 'Bağlanıb') });
    expect(await submitQuoteAction(CID, PID.project, { totalAmount: 500000, workers: 3, days: 5 }, KEY)).toMatchObject({
      ok: false,
      code: 'QUOTE_WINDOW_CLOSED',
    });
  });

  it('withdraws a quote, adds a report and completes the project', async () => {
    const report = {
      id: PID.report,
      reportDate: '2026-11-02',
      note: 'Kabel çəkildi',
      progressPercent: 40,
      photos: [],
      authorName: 'Elvin Məmmədov',
      createdAt: '2026-11-02T15:00:00.000Z',
    };
    const myQuote = {
      id: PID.quote,
      projectId: PID.project,
      status: 'WITHDRAWN',
      provider: {
        type: 'COMPANY',
        handymanId: null,
        companyId: CID,
        name: 'FixPro MMC',
        photo: null,
        ratingAvg: null,
        ratingCount: 0,
        completedCount: 0,
        isVatPayer: true,
      },
      totalAmount: 500000,
      workers: 3,
      days: 5,
      note: null,
      createdAt: '2026-10-25T10:00:00.000Z',
      feeHeld: 15000,
      feeCaptured: false,
    };
    const { calls } = asManager({
      [`POST /provider/quotes/${PID.quote}/withdraw`]: () => ({ status: 200, body: myQuote }),
      [`POST /provider/projects/${PID.project}/reports`]: () => ({ status: 200, body: report }),
      [`POST /provider/projects/${PID.project}/complete`]: () => ({ status: 200, body: invoice }),
    });
    expect(await withdrawQuoteAction(CID, PID.quote, PID.project)).toMatchObject({ ok: true });
    expect(await addReportAction(CID, PID.project, { note: 'Kabel çəkildi', progressPercent: 40, reportDate: '2026-11-02' })).toEqual({
      ok: true,
      data: report,
    });
    expect(await completeProjectAction(CID, PID.project, {}, KEY)).toEqual({ ok: true, data: invoice });
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts[1]!.body).toEqual({ companyId: CID, note: 'Kabel çəkildi', progressPercent: 40, reportDate: '2026-11-02', photoFileIds: [] });
    expect(posts[2]!.body).toEqual({ companyId: CID });
    expect(posts[2]!.headers['idempotency-key']).toBe(KEY);
    expect(state.revalidated).toContain(`${base}/projects/${PID.project}`);
    expect(providerProject().id).toBe(PID.project);
  });
});
