// AU-F01..F03, AU-E01..E05, AU-H01, AU-F22, AU-G03: the main money flow on the live demo, driven through the API
// with two real demo accounts (Demo Müştəri as the customer, Elvin as the solo handyman).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, waitFor, expectApiError, findPhones, PHONES, CENTER } from './lib.mts';
import { ADDRESS, plumbingCategoryId, goOnline, goOffline, createRequest, waitOffer, payCheckout, wallet, topup, cancelOpenRequests } from './flows.mts';

const ctx: any = {};

after(async () => {
  if (ctx.elvin) await goOffline(ctx.elvin);
});

test('setup: accounts, balances, no leftovers', async () => {
  ctx.customer = await login('demo', 'CUSTOMER');
  ctx.elvin = await login('elvin', 'PRO');
  await cancelOpenRequests(ctx.customer);
  const active: any = await ctx.elvin.c.call(api.pro.assignments, { query: { scope: 'active' } } as any).catch(() => ({ items: [] }));
  const busy = (active.items ?? []).filter((a: any) => ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PRICE_PROPOSED'].includes(a.status));
  assert.equal(busy.length, 0, `Elvin already has an active job: ${busy.map((a: any) => a.id).join(',')}`);
  if ((await wallet(ctx.elvin)).available < 2000) await topup(ctx.elvin, 2000);
  if ((await wallet(ctx.customer)).available < 1000) await topup(ctx.customer, 2000);
  ctx.categoryId = await plumbingCategoryId(ctx.elvin);
  ctx.elvinWallet0 = await wallet(ctx.elvin);
  ctx.earnings0 = (await ctx.elvin.c.call(api.pro.earnings)).earningsBalance;
});

test('AU-F01a Elvin goes online, customer posts a NOW request', async () => {
  const on: any = await goOnline(ctx.elvin);
  assert.equal(on.isOnline, true);
  const r: any = await createRequest(ctx.customer, ctx.categoryId);
  ctx.request = r.request ?? r;
  assert.equal(ctx.request.status, 'SEARCHING');
});

test('AU-E01 the offer carries no phone, no photo, no flat details', { timeout: 90_000 }, async () => {
  const offer: any = await waitOffer(ctx.elvin, ctx.request.id);
  ctx.offer = offer;
  assert.deepEqual(findPhones(offer), []);
  const text = JSON.stringify(offer);
  for (const secret of [ADDRESS.apartment === '17' ? '"17"' : '', 'intercom', 'apartment', 'entrance', '"floor"', 'photo']) {
    if (secret) assert.ok(!text.includes(secret), `offer leaks ${secret}`);
  }
  assert.equal(offer.customer.lastInitial.replace('.', '').length, 1);
  assert.equal(offer.fee, 1000);
  assert.ok(new Date(offer.expiresAt).getTime() - new Date(offer.sentAt).getTime() <= 16_000, 'offer TTL > 15 s in demo');
});

test('AU-F02a accept holds the 10 AZN fee; a repeated accept with the same key does not double it (AU-G03)', async () => {
  const key = `qa-accept-${ctx.offer.id}`;
  const r: any = await ctx.elvin.c.call(api.pro.acceptOffer, { params: { id: ctx.offer.id }, idempotencyKey: key } as any);
  ctx.assignmentId = r.assignment.id;
  const again: any = await ctx.elvin.c.call(api.pro.acceptOffer, { params: { id: ctx.offer.id }, idempotencyKey: key } as any).catch((e: any) => e);
  if (!(again instanceof Error)) assert.equal(again.assignment.id, ctx.assignmentId);
  const w = await wallet(ctx.elvin);
  assert.equal(w.held - ctx.elvinWallet0.held, 1000, 'held must grow by exactly 1000');
  assert.equal(w.posted, ctx.elvinWallet0.posted, 'nothing captured yet inside the free window');
});

test('AU-E02/E05 before unlock: no phones on either side, chat refused', async () => {
  const ca: any = await ctx.customer.c.call(api.assignments.get, { params: { id: ctx.assignmentId } });
  const pa: any = await ctx.elvin.c.call(api.pro.assignment, { params: { id: ctx.assignmentId } });
  ctx.unlockedEarly = ca.contactUnlocked;
  if (!ca.contactUnlocked) {
    assert.equal(ca.providerPhone, null);
    assert.equal(pa.customerPhone, null);
    assert.deepEqual(findPhones(ca), []);
    assert.deepEqual(findPhones(pa).filter((p) => !p.endsWith(PHONES.elvin.slice(-9))), []);
    const e = await expectApiError(() => ctx.customer.c.call(api.chat.send, { params: { id: ctx.assignmentId }, body: { body: 'salam' } } as any));
    assert.ok(e.status >= 400 && e.status < 500, `chat before unlock: ${e.status} ${e.code}`);
  }
  // Pro sees the full address after acceptance (spec 4.4).
  assert.equal(pa.view, 'FULL');
  assert.equal(pa.address.apartment, ADDRESS.apartment);
  assert.ok(pa.description.includes('QA automation'));
});

test('AU-E03 en route close to the address unlocks phones and chat', { timeout: 120_000 }, async () => {
  await ctx.elvin.c.call(api.pro.enRoute, { params: { id: ctx.assignmentId }, body: { location: CENTER } } as any);
  const ca: any = await waitFor(async () => {
    await ctx.elvin.c.call(api.pro.location, { body: { lat: ADDRESS.lat - 0.001, lng: ADDRESS.lng, accuracy: 5 } });
    const a: any = await ctx.customer.c.call(api.assignments.get, { params: { id: ctx.assignmentId } });
    return a.contactUnlocked ? a : null;
  }, 90_000, 3_000);
  assert.equal(ca.providerPhone?.replace(/\D/g, '').slice(-9), PHONES.elvin.slice(-9));
  assert.equal(ca.chatEnabled, true);
  const pa: any = await ctx.elvin.c.call(api.pro.assignment, { params: { id: ctx.assignmentId } });
  assert.equal(pa.customerPhone?.replace(/\D/g, '').slice(-9), PHONES.demo.slice(-9));
  await ctx.customer.c.call(api.chat.send, { params: { id: ctx.assignmentId }, body: { body: 'QA: salam, gözləyirəm' } } as any);
});

test('AU-E04 contact never relocks when the handyman moves away', async () => {
  await ctx.elvin.c.call(api.pro.location, { body: { lat: CENTER.lat - 0.05, lng: CENTER.lng - 0.05, accuracy: 5 } });
  const ca: any = await ctx.customer.c.call(api.assignments.get, { params: { id: ctx.assignmentId } });
  assert.equal(ca.contactUnlocked, true);
});

test('AU-F23 out-of-order actions are refused (price before arrival, decline before arrival)', async () => {
  const e1 = await expectApiError(() => ctx.elvin.c.call(api.pro.enterPrice, { params: { id: ctx.assignmentId }, body: { labor: 1000, materials: 0 } } as any));
  assert.ok(e1.status === 409 || e1.status === 400, `${e1.status} ${e1.code}`);
  const e2 = await expectApiError(() => ctx.customer.c.call(api.assignments.declineOnArrival, { params: { id: ctx.assignmentId }, body: {} } as any));
  assert.ok(e2.status === 409 || e2.status === 400, `${e2.status} ${e2.code}`);
});

test('AU-F01b arrive, enter 35 + 10 AZN, customer sees 45 AZN', async () => {
  await ctx.elvin.c.call(api.pro.location, { body: { lat: ADDRESS.lat, lng: ADDRESS.lng, accuracy: 5 } });
  await ctx.elvin.c.call(api.pro.arrived, { params: { id: ctx.assignmentId } } as any);
  const neg = await expectApiError(() => ctx.elvin.c.call(api.pro.enterPrice, { params: { id: ctx.assignmentId }, body: { labor: -100, materials: 0 } } as any));
  assert.equal(neg.status, 400);
  await ctx.elvin.c.call(api.pro.enterPrice, { params: { id: ctx.assignmentId }, body: { labor: 3500, materials: 1000 } } as any);
  const ca: any = await ctx.customer.c.call(api.assignments.get, { params: { id: ctx.assignmentId } });
  assert.equal(ca.status, 'PRICE_PROPOSED');
  assert.equal(ca.price.total ?? ca.price.labor + ca.price.materials, 4500);
  assert.equal(ca.actions.confirmPrice, true);
});

test('AU-F01c card payment 4242 completes the job, guarantee = completedAt + 14 days, fee captured (AU-F03)', { timeout: 90_000 }, async () => {
  const r: any = await ctx.customer.c.call(api.assignments.confirmPrice, { params: { id: ctx.assignmentId }, body: { method: 'CARD' } } as any);
  assert.ok(r.payment?.checkoutUrl, 'CARD must return a checkout URL');
  // AU-H03: a tampered token is refused.
  const bad = new URL(r.payment.checkoutUrl);
  bad.searchParams.set('t', 'tampered');
  assert.equal((await fetch(bad)).status, 403);
  await payCheckout(r.payment.checkoutUrl);
  const ca: any = await waitFor(async () => {
    const a: any = await ctx.customer.c.call(api.assignments.get, { params: { id: ctx.assignmentId } });
    return a.status === 'COMPLETED' ? a : null;
  }, 60_000, 2_000);
  const pa: any = await ctx.elvin.c.call(api.pro.assignment, { params: { id: ctx.assignmentId } });
  const days = (new Date(pa.guaranteeUntil).getTime() - new Date(pa.completedAt).getTime()) / 86_400_000;
  assert.ok(Math.abs(days - 14) < 0.01, `guarantee ${days} days`);
  assert.equal(pa.fee.captured, true);
  const w = await wallet(ctx.elvin);
  assert.equal(w.held, ctx.elvinWallet0.held, 'hold released after capture');
  assert.equal(ctx.elvinWallet0.posted - w.posted, 1000, 'exactly 10 AZN clipped');
  const earn: any = await ctx.elvin.c.call(api.pro.earnings);
  assert.equal(earn.earningsBalance - ctx.earnings0, 4500, 'card money (100%) goes to earnings');
  ctx.earnings1 = earn.earningsBalance;
  assert.equal(ca.actions.tip, true);
});

test('AU-F01d tip 5 AZN reaches the handyman earnings', { timeout: 90_000 }, async () => {
  const r: any = await ctx.customer.c.call(api.assignments.tip, { params: { id: ctx.assignmentId }, body: { amount: 500 } } as any);
  await payCheckout(r.checkoutUrl ?? r.payment?.checkoutUrl);
  await waitFor(async () => (await ctx.elvin.c.call(api.pro.earnings)).earningsBalance - ctx.earnings1 === 500, 60_000, 2_000);
});

test('AU-F22 ratings: 1-5 only, once per side', async () => {
  const bad = await expectApiError(() => ctx.customer.c.call(api.assignments.rate, { params: { id: ctx.assignmentId }, body: { stars: 6 } } as any));
  assert.equal(bad.status, 400);
  await ctx.customer.c.call(api.assignments.rate, { params: { id: ctx.assignmentId }, body: { stars: 5, comment: 'QA automation' } } as any);
  const twice = await expectApiError(() => ctx.customer.c.call(api.assignments.rate, { params: { id: ctx.assignmentId }, body: { stars: 4 } } as any));
  assert.ok(twice.status === 409 || twice.status === 400, `${twice.status} ${twice.code}`);
  await ctx.elvin.c.call(api.pro.rateCustomer, { params: { id: ctx.assignmentId }, body: { stars: 5 } } as any);
});

test('AU-H04 wallet history shows the fee capture as one -10 AZN line', async () => {
  const tx: any = await ctx.elvin.c.call(api.wallet.transactions, { query: {} } as any);
  const fee = (tx.items ?? []).find((t: any) => t.kind === "REQUEST_FEE_CAPTURE" && t.requestNumber === ctx.offer.requestNumber);
  assert.ok(fee, 'no REQUEST_FEE_CAPTURE transaction');
  assert.equal(Math.abs(fee.amount), 1000);
});
