import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expectRedirect, resetServerMocks, state } from './server-mocks';
import {
  addCaseNoteAction,
  adjustWalletAction,
  approveCompanyAction,
  approveHandymanAction,
  blockHandymanAction,
  blockUserAction,
  cancelRequestAction,
  clearStrikesAction,
  createAdminAction,
  createCategoryAction,
  demoCreateRequestAction,
  demoSpawnBotsAction,
  liveMapAction,
  listHandymenAction,
  listRequestsAction,
  markPayoutFailedAction,
  rejectHandymanAction,
  resolveCaseAction,
  runPayoutsAction,
  unblockUserAction,
  updateAdminAction,
  updateCategoryAction,
  updateSettingsAction,
} from '@/features/admin/actions';
import { adminFixture, apiError, makeJwt, mockApi, type ApiHandler } from './helpers';

const ID = '6f1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b';
const token = () => makeJwt(Math.floor(Date.now() / 1000) + 600);

let accessToken = '';
function adminSession() {
  accessToken = token();
  resetServerMocks({ tf_at: accessToken, tf_rt: 'rt-admin-1234567890', tf_kind: 'admin' });
}

function withAdmin(handlers: Record<string, ApiHandler>) {
  return mockApi({ 'GET /admin/me': () => ({ status: 200, body: adminFixture }), ...handlers });
}

const ok = { status: 200, body: { ok: true } };

describe('admin actions: session', () => {
  beforeEach(() => resetServerMocks());

  it('redirects to the admin login without an admin session and never calls the endpoint', async () => {
    const { calls } = mockApi({});
    expect(await expectRedirect(() => runPayoutsAction())).toBe('/admin/login?expired=1');
    expect(calls).toHaveLength(0);
  });

  it('redirects a company (phone-login) session too', async () => {
    resetServerMocks({ tf_at: token(), tf_rt: 'rt-company-1234567890', tf_kind: 'company' });
    const { calls } = mockApi({});
    expect(await expectRedirect(() => listRequestsAction({}))).toBe('/admin/login?expired=1');
    expect(calls.filter((c) => c.path !== '/admin/me')).toHaveLength(0);
  });
});

describe('admin actions: API calls', () => {
  beforeEach(() => {
    adminSession();
    // These tests check the requests the BFF sends; response contract validation is covered separately below.
    process.env.PANEL_VALIDATE_RESPONSES = 'false';
  });
  afterEach(() => {
    delete process.env.PANEL_VALIDATE_RESPONSES;
  });

  it('lists with validated filters and the admin bearer token (server side only)', async () => {
    const page = { items: [], nextCursor: null };
    const { calls } = withAdmin({ 'GET /admin/requests': () => ({ status: 200, body: page }) });
    const out = await listRequestsAction({ status: 'SEARCHING', q: 'İsmayıl', cursor: 'c-1', limit: 20 });
    expect(out).toEqual({ ok: true, data: page });
    const call = calls.find((c) => c.path === '/admin/requests')!;
    expect(call.headers.authorization).toBe(`Bearer ${accessToken}`);
    expect(call.method).toBe('GET');
  });

  it('rejects invalid list filters without calling the API', async () => {
    const { calls } = withAdmin({});
    const out = await listHandymenAction({ tab: 'deleted' as never });
    expect(out).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(calls.some((c) => c.path === '/admin/handymen')).toBe(false);
  });

  it('turns an endpoint that is not deployed yet (404) into an action error instead of throwing', async () => {
    withAdmin({});
    const out = await listHandymenAction({ tab: 'pending' });
    expect(out).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('force-cancels a request with the charge flag and revalidates the order pages', async () => {
    const { calls } = withAdmin({ [`POST /admin/requests/${ID}/cancel`]: () => ({ status: 200, body: { request: {} } }) });
    const out = await cancelRequestAction(ID, { reason: 'Müştəri xahiş etdi', chargeCustomer: true });
    expect(out.ok).toBe(true);
    expect(calls.find((c) => c.path.endsWith('/cancel'))!.body).toEqual({ reason: 'Müştəri xahiş etdi', chargeCustomer: true });
    expect(state.revalidated).toEqual([`/admin/orders/${ID}`, '/admin/orders', '/admin']);
  });

  it('validates reasons (3..500 chars) and ids before calling the API', async () => {
    const { calls } = withAdmin({});
    expect(await rejectHandymanAction(ID, { reason: 'no' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await blockHandymanAction('not-a-uuid', { reason: 'Saxta sənəd' })).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(calls.filter((c) => c.path !== '/admin/me')).toHaveLength(0);
  });

  it('approves a handyman with the extracted KYC fields', async () => {
    const { calls } = withAdmin({ [`POST /admin/handymen/${ID}/approve`]: () => ({ status: 200, body: { row: {} } }) });
    const out = await approveHandymanAction(ID, { extracted: { docNumberLast4: 'AB12', birthDate: '1990-05-01' } });
    expect(out.ok).toBe(true);
    expect(calls.find((c) => c.path.endsWith('/approve'))!.body).toEqual({
      extracted: { docNumberLast4: 'AB12', birthDate: '1990-05-01' },
    });
    expect(state.revalidated).toContain(`/admin/handymen/${ID}`);
  });

  it('returns the localized API error for an invalid state', async () => {
    withAdmin({
      [`POST /admin/handymen/${ID}/approve`]: () => apiError(409, 'INVALID_STATE', 'Əməliyyat bu vəziyyətdə mümkün deyil'),
    });
    expect(await approveHandymanAction(ID, {})).toEqual({
      ok: false,
      code: 'INVALID_STATE',
      message: 'Əməliyyat bu vəziyyətdə mümkün deyil',
      details: undefined,
    });
  });

  it('clears strikes, approves companies and posts without a body where the contract has none', async () => {
    const { calls } = withAdmin({
      [`POST /admin/handymen/${ID}/clear-strikes`]: () => ({ status: 200, body: {} }),
      [`POST /admin/companies/${ID}/approve`]: () => ({ status: 200, body: {} }),
    });
    expect((await clearStrikesAction(ID)).ok).toBe(true);
    expect((await approveCompanyAction(ID)).ok).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(
      expect.arrayContaining([`POST /admin/handymen/${ID}/clear-strikes`, `POST /admin/companies/${ID}/approve`]),
    );
  });

  it('blocks and unblocks a user and revalidates only admin pages', async () => {
    const { calls } = withAdmin({
      [`POST /admin/users/${ID}/block`]: () => ok,
      [`POST /admin/users/${ID}/unblock`]: () => ok,
    });
    expect(await blockUserAction(ID, { reason: 'Fırıldaqçılıq' }, `/admin/customers/${ID}`)).toEqual({ ok: true, data: { ok: true } });
    expect(state.revalidated).toEqual(['/admin/customers', `/admin/customers/${ID}`]);
    state.revalidated = [];
    await unblockUserAction(ID, 'https://evil.example');
    expect(state.revalidated).toEqual(['/admin/customers']);
    expect(calls.find((c) => c.path.endsWith('/block'))!.body).toEqual({ reason: 'Fırıldaqçılıq' });
  });

  it('adjusts a wallet with a stable idempotency key', async () => {
    const result = { wallet: {}, transactionId: ID };
    const { calls } = withAdmin({ 'POST /admin/wallets/adjust': () => ({ status: 200, body: result }) });
    const body = { owner: { type: 'HANDYMAN' as const, id: ID }, account: 'WALLET' as const, amount: -500, reason: 'Düzəliş' };
    expect(await adjustWalletAction(body, 'adj-key-12345')).toEqual({ ok: true, data: result });
    expect(await adjustWalletAction(body, 'adj-key-12345')).toEqual({ ok: true, data: result });
    const posts = calls.filter((c) => c.path === '/admin/wallets/adjust');
    expect(posts.map((c) => c.headers['idempotency-key'])).toEqual(['adj-key-12345', 'adj-key-12345']);
    expect(posts[0].body).toEqual(body);
  });

  it('rejects a zero adjustment or a missing idempotency key', async () => {
    const { calls } = withAdmin({});
    const body = { owner: { type: 'COMPANY' as const, id: ID }, amount: 0, reason: 'Düzəliş' };
    expect(await adjustWalletAction(body, 'adj-key-12345')).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await adjustWalletAction({ ...body, amount: 100 }, '')).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(calls.some((c) => c.path === '/admin/wallets/adjust')).toBe(false);
  });

  it('marks a payout failed with a reason', async () => {
    const { calls } = withAdmin({ [`POST /admin/payouts/${ID}/mark-failed`]: () => ({ status: 200, body: {} }) });
    expect((await markPayoutFailedAction(ID, { reason: 'Kart bağlıdır' })).ok).toBe(true);
    expect(calls.at(-1)!.body).toEqual({ reason: 'Kart bağlıdır' });
    expect(state.revalidated).toEqual(['/admin/payments']);
  });

  it('resolves a price dispute with a new price and refuses REPROPOSE_PRICE without one', async () => {
    const { calls } = withAdmin({ [`POST /admin/cases/${ID}/resolve`]: () => ({ status: 200, body: {} }) });
    expect(await resolveCaseAction(ID, { note: 'Yeni qiymət', outcome: 'REPROPOSE_PRICE' })).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    const out = await resolveCaseAction(ID, {
      note: 'Yeni qiymət',
      outcome: 'REPROPOSE_PRICE',
      price: { labor: 4000, materials: 1250 },
    });
    expect(out.ok).toBe(true);
    expect(calls.filter((c) => c.path.endsWith('/resolve'))).toHaveLength(1);
  });

  it('adds case notes', async () => {
    const { calls } = withAdmin({ [`POST /admin/cases/${ID}/notes`]: () => ({ status: 200, body: {} }) });
    expect((await addCaseNoteAction(ID, { body: 'Usta ilə danışıldı' })).ok).toBe(true);
    expect(calls.at(-1)!.body).toEqual({ body: 'Usta ilə danışıldı' });
    expect(await addCaseNoteAction(ID, { body: '' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });

  it('creates and updates categories with the contract body', async () => {
    const { calls } = withAdmin({
      'POST /admin/categories': () => ({ status: 200, body: {} }),
      [`PATCH /admin/categories/${ID}`]: () => ({ status: 200, body: {} }),
    });
    const body = {
      slug: 'santexnik',
      vertical: 'HOME' as const,
      kind: 'SERVICE' as const,
      names: { az: 'Santexnik', ru: 'Сантехник', en: 'Plumber' },
    };
    expect((await createCategoryAction(body)).ok).toBe(true);
    expect((await updateCategoryAction(ID, { active: false })).ok).toBe(true);
    expect(await createCategoryAction({ ...body, slug: 'Bad Slug!' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ active: false });
    expect(state.revalidated).toContain('/admin/categories');
  });

  it('updates settings with a partial body and refuses an empty patch', async () => {
    const { calls } = withAdmin({ 'PATCH /admin/settings': () => ({ status: 200, body: {} }) });
    expect((await updateSettingsAction({ requestFee: 1200 })).ok).toBe(true);
    expect(calls.at(-1)!.body).toEqual({ requestFee: 1200 });
    expect(await updateSettingsAction({})).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await updateSettingsAction({ offerTtlSec: 1 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });

  it('creates admins (password >= 10 chars) and forwards FORBIDDEN for operators', async () => {
    withAdmin({
      'POST /admin/admins': () => apiError(403, 'FORBIDDEN', 'İcazə yoxdur'),
      [`PATCH /admin/admins/${ID}`]: () => ({ status: 200, body: {} }),
    });
    expect(await createAdminAction({ email: 'op@tezfiks.az', name: 'Operator', password: 'short' })).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
    expect(
      await createAdminAction({ email: 'op@tezfiks.az', name: 'Operator', password: 'long-enough-pass', role: 'OPERATOR' }),
    ).toMatchObject({ ok: false, code: 'FORBIDDEN', message: 'İcazə yoxdur' });
    expect((await updateAdminAction(ID, { active: false })).ok).toBe(true);
  });

  it('loads the live map and drives the demo endpoints', async () => {
    const liveMap = { serverNow: new Date().toISOString(), handymen: [], requests: [] };
    const { calls } = withAdmin({
      'GET /admin/live-map': () => ({ status: 200, body: liveMap }),
      'POST /admin/demo/bots': () => ({ status: 200, body: { enabled: true } }),
      'POST /admin/demo/requests': () => apiError(403, 'DEMO_DISABLED', 'Demo rejimi söndürülüb'),
    });
    expect(await liveMapAction()).toEqual({ ok: true, data: liveMap });
    expect((await demoSpawnBotsAction({ count: 5, center: { lat: 40.4, lng: 49.86 }, radiusKm: 3 })).ok).toBe(true);
    expect(calls.find((c) => c.path === '/admin/demo/bots')!.body).toEqual({
      count: 5,
      center: { lat: 40.4, lng: 49.86 },
      radiusKm: 3,
    });
    expect(await demoSpawnBotsAction({ count: 0 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(
      await demoCreateRequestAction({ categoryId: ID, lat: 40.4, lng: 49.86, timing: 'NOW', slots: 1 }),
    ).toMatchObject({ ok: false, code: 'DEMO_DISABLED' });
  });

  it('sends the user to the login when the API rejects the token mid-action', async () => {
    withAdmin({ 'POST /admin/payouts/run': () => apiError(401, 'UNAUTHORIZED') });
    expect(await expectRedirect(() => runPayoutsAction())).toBe('/admin/login?expired=1');
  });
});

describe('admin actions: response contract', () => {
  beforeEach(() => adminSession());

  it('reports a response that does not match the contract as an error (development validation)', async () => {
    withAdmin({ 'GET /admin/live-map': () => ({ status: 200, body: { handymen: 'nope' } }) });
    expect(await liveMapAction()).toMatchObject({ ok: false, code: 'CONTRACT_MISMATCH' });
  });
});
