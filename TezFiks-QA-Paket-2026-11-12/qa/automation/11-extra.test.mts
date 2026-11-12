// AU-J03, E06, F17, F19: payout method masking, chat closed after a finished job, scheduled requests, cash auto-completion.
// Demo timers (spec 4 / settings.ts demo column): scheduledMinLeadMin 2, live dispatch 1 min before, unfilled at the time,
// autoCompleteAfterMin 10.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, waitFor, expectApiError, sleep, CENTER } from './lib.mts';
import { ADDRESS, plumbingCategoryId, goOnline, goOffline, createRequest, waitOffer, wallet, topup, cancelOpenRequests } from './flows.mts';

const ctx: any = {};
const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

after(async () => {
  if (ctx.customer) await cancelOpenRequests(ctx.customer).catch(() => undefined);
  if (ctx.elvin) await goOffline(ctx.elvin);
});
afterEach(async () => {
  if (ctx.customer) await cancelOpenRequests(ctx.customer).catch(() => undefined);
});

test('setup', async () => {
  ctx.customer = await login('demo', 'CUSTOMER');
  ctx.elvin = await login('elvin', 'PRO');
  const a: any = await ctx.elvin.c.call(api.pro.assignments, { query: { scope: 'active' } } as any);
  assert.equal((a.items ?? []).filter((x: any) => ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PRICE_PROPOSED'].includes(x.status)).length, 0, 'Elvin is busy');
  if ((await wallet(ctx.elvin)).available < 3000) await topup(ctx.elvin, 3000);
  ctx.categoryId = await plumbingCategoryId(ctx.elvin);
});

test('AU-J03 payout card: stored masked, the full number never comes back', async () => {
  const before: any = await ctx.elvin.c.call(api.pro.getPayoutMethod);
  console.log('previous payout method:', JSON.stringify(before.method));
  // A card number failing the Luhn checksum is refused.
  const luhn = await expectApiError(() => ctx.elvin.c.call(api.pro.setPayoutMethod, { body: { type: 'CARD', number: '4169738812345678', holderName: 'ELVIN MAMMADOV' } } as any));
  assert.equal(luhn.status, 400);
  const number = '4242424242424242';
  const put: any = await ctx.elvin.c.call(api.pro.setPayoutMethod, { body: { type: 'CARD', number, holderName: 'ELVIN MAMMADOV' } } as any);
  const get: any = await ctx.elvin.c.call(api.pro.getPayoutMethod);
  for (const v of [put, get.method]) {
    assert.ok(!JSON.stringify(v).includes(number), 'full card number returned');
    assert.ok(!JSON.stringify(v).includes(number.slice(0, 12)), 'first 12 digits returned');
    assert.match(v.maskedNumber, /4242$/);
  }
  const bad = await expectApiError(() => ctx.elvin.c.call(api.pro.setPayoutMethod, { body: { type: 'CARD', number: 'abc', holderName: 'X' } } as any));
  assert.equal(bad.status, 400);
});

test('AU-E06 chat is closed on a job finished more than 2 hours ago', async () => {
  const h: any = await ctx.elvin.c.call(api.pro.assignments, { query: { scope: 'history', limit: 50 } } as any);
  const old = (h.items ?? []).find((a: any) => a.status === 'COMPLETED' && a.completedAt && Date.now() - new Date(a.completedAt).getTime() > 2.2 * 3_600_000);
  assert.ok(old, 'no job of Elvin completed more than 2 h ago');
  const e = await expectApiError(() => ctx.elvin.c.call(api.chat.send, { params: { id: old.id }, body: { body: 'QA: köhnə işə mesaj' } } as any));
  assert.ok(e.status >= 400 && e.status < 500, `chat on an old job: ${e.status} ${e.code}`);
});

test('AU-F17a a scheduled time closer than the minimum lead (2 min in demo) is refused', async () => {
  const e = await expectApiError(() => createRequest(ctx.customer, ctx.categoryId, { timing: 'SCHEDULED', scheduledAt: inMin(1) }));
  assert.equal(e.status, 400, `${e.status} ${e.code}`);
});

test('AU-F17b scheduled request: long-lived offer in "Planlı sifarişlər", live dispatch near the time, slot UNFILLED when nobody takes it', { timeout: 480_000 }, async () => {
  await goOnline(ctx.elvin);
  const at = inMin(4);
  const r: any = await createRequest(ctx.customer, ctx.categoryId, { timing: 'SCHEDULED', scheduledAt: at });
  assert.equal(r.timing, 'SCHEDULED');
  assert.equal(r.status, 'SEARCHING');
  const sched: any = await waitFor(async () => {
    await ctx.elvin.c.call(api.pro.location, { body: { ...CENTER, accuracy: 10 } });
    const x: any = await ctx.elvin.c.call(api.pro.scheduledOffers);
    return x.items.find((o: any) => o.requestId === r.id) ?? null;
  }, 90_000, 3_000);
  assert.equal(sched.timing, 'SCHEDULED');
  assert.equal(new Date(sched.scheduledAt).getTime(), new Date(at).getTime());
  assert.ok(new Date(sched.expiresAt).getTime() - new Date(sched.sentAt).getTime() > 20_000, 'scheduled offer is as short as a live one');
  // Nobody accepts: after the scheduled time the slot must end UNFILLED and the request stop searching.
  const done: any = await waitFor(async () => {
    await ctx.elvin.c.call(api.pro.location, { body: { ...CENTER, accuracy: 10 } });
    const x: any = await ctx.customer.c.call(api.requests.get, { params: { id: r.id } });
    return !x.isSearching ? x : null;
  }, 360_000, 10_000);
  assert.ok(['EXPIRED', 'CANCELLED'].includes(done.status) || done.slots.every((s: any) => s.status === 'UNFILLED'), `status ${done.status}, slots ${done.slots.map((s: any) => s.status)}`);
  assert.ok(done.slots.every((s: any) => s.status === 'UNFILLED'), `slots ${done.slots.map((s: any) => s.status)}`);
});

test('AU-F19 cash auto-completion: price proposed and nothing happens for 10 min -> COMPLETED as cash, no guarantee', { timeout: 1_080_000 }, async () => {
  await goOnline(ctx.elvin);
  const w0 = await wallet(ctx.elvin);
  const r: any = await createRequest(ctx.customer, ctx.categoryId);
  const offer: any = await waitOffer(ctx.elvin, r.id, 60_000);
  const acc: any = await ctx.elvin.c.call(api.pro.acceptOffer, { params: { id: offer.id } } as any);
  const id = acc.assignment.id;
  await ctx.elvin.c.call(api.pro.enRoute, { params: { id }, body: { location: CENTER } } as any);
  await ctx.elvin.c.call(api.pro.location, { body: { lat: ADDRESS.lat, lng: ADDRESS.lng, accuracy: 5 } });
  await ctx.elvin.c.call(api.pro.arrived, { params: { id } } as any);
  const priced: any = await ctx.elvin.c.call(api.pro.enterPrice, { params: { id }, body: { labor: 2000, materials: 0 } } as any);
  const t0 = Date.now();
  assert.equal(priced.status, 'PRICE_PROPOSED');
  await sleep(9 * 60_000);
  const early: any = await ctx.customer.c.call(api.assignments.get, { params: { id } });
  assert.equal(early.status, 'PRICE_PROPOSED', 'completed before 10 min');
  const done: any = await waitFor(async () => {
    const x: any = await ctx.customer.c.call(api.assignments.get, { params: { id } });
    return x.status === 'COMPLETED' ? x : null;
  }, 6 * 60_000, 10_000);
  console.log(`auto-completed after ${((Date.now() - t0) / 60_000).toFixed(1)} min`);
  assert.equal(done.paymentMethod ?? 'CASH', 'CASH');
  assert.equal(done.guaranteeUntil ?? null, null, 'auto-completed cash job must have no guarantee');
  const w1 = await wallet(ctx.elvin);
  assert.equal(w0.posted - w1.posted, 1000, 'fee captured');
  assert.equal(w1.held, w0.held, 'hold released');
});
