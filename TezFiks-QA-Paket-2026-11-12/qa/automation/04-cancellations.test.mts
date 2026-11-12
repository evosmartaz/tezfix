// AU-F02, F04..F09, AU-E02 (strict): cancellation and penalty matrix (spec 4.1, policy.ts cancellationOutcome).
// Elvin accepts from ~3 km away so the contact is still locked (ETA > 5 min).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, waitFor, expectApiError, findPhones, sleep, PHONES } from './lib.mts';
import { ADDRESS, plumbingCategoryId, goOnline, goOffline, createRequest, waitOffer, wallet, topup, cancelOpenRequests } from './flows.mts';

const FAR = { lat: ADDRESS.lat + 0.027, lng: ADDRESS.lng }; // ~3 km north
const WINDOW_MS = 5 * 60_000 + 20_000;
const ctx: any = {};

after(async () => {
  if (ctx.elvin) await goOffline(ctx.elvin);
  if (ctx.customer) await cancelOpenRequests(ctx.customer);
});

async function txByRequest(s: any, requestNumber: number) {
  const tx: any = await s.c.call(api.wallet.transactions, { query: { limit: 50 } } as any);
  return (tx.items ?? []).filter((t: any) => t.requestNumber === requestNumber).map((t: any) => `${t.kind}:${t.amount}`).sort();
}

/** New request + Elvin accepts it from FAR. Returns { request, offer, assignmentId }. */
async function acceptedJob() {
  await cancelOpenRequests(ctx.customer);
  await goOnline(ctx.elvin, FAR);
  const r: any = await createRequest(ctx.customer, ctx.categoryId);
  const request = r.request ?? r;
  const offer: any = await waitOffer(ctx.elvin, request.id, 90_000, FAR).catch(async (e) => {
    throw new Error(`no offer for Elvin at ~3 km: ${e.message}`);
  });
  const a: any = await ctx.elvin.c.call(api.pro.acceptOffer, { params: { id: offer.id } } as any);
  await ctx.elvin.c.call(api.pro.location, { body: { ...FAR, accuracy: 10 } });
  return { request, offer, assignmentId: a.assignment.id as string, number: offer.requestNumber as number };
}

const custA = (id: string) => ctx.customer.c.call(api.assignments.get, { params: { id } });
const proA = (id: string) => ctx.elvin.c.call(api.pro.assignment, { params: { id } });
async function strikes() {
  const p: any = await ctx.elvin.c.call(api.pro.profile);
  return p.profile?.strikes ?? null;
}

test('setup', async () => {
  ctx.customer = await login('demo', 'CUSTOMER');
  ctx.elvin = await login('elvin', 'PRO');
  if ((await wallet(ctx.elvin)).available < 3000) await topup(ctx.elvin, 3000);
  if ((await wallet(ctx.customer)).available < 5000) await topup(ctx.customer, 5000);
  ctx.categoryId = await plumbingCategoryId(ctx.elvin);
});

test('AU-E02 strict + AU-F04: locked contact at 3 km, then free customer cancel releases the hold', { timeout: 180_000 }, async () => {
  const w0 = await wallet(ctx.elvin);
  const job = await acceptedJob();
  const ca: any = await custA(job.assignmentId);
  const pa: any = await proA(job.assignmentId);
  assert.equal(ca.contactUnlocked, false, `contact already unlocked at ~3 km (etaSec=${ca.etaSec})`);
  assert.equal(ca.providerPhone, null);
  assert.equal(pa.customerPhone, null);
  assert.deepEqual(findPhones(ca), []);
  assert.deepEqual(findPhones(pa).filter((p) => !p.endsWith(PHONES.elvin.slice(-9))), []);
  const chat = await expectApiError(() => ctx.customer.c.call(api.chat.send, { params: { id: job.assignmentId }, body: { body: 'salam' } } as any));
  assert.ok(chat.status >= 400 && chat.status < 500);
  assert.equal(ca.actions.cancelPenalty, 0, 'UI must show 0 penalty inside the free window');
  await ctx.customer.c.call(api.assignments.cancel, { params: { id: job.assignmentId }, body: { reason: 'QA free cancel' } } as any);
  assert.equal((await proA(job.assignmentId)).status, 'CANCELLED_FREE');
  const w1 = await wallet(ctx.elvin);
  assert.equal(w1.held, w0.held, 'hold released');
  assert.equal(w1.posted, w0.posted, 'nothing charged');
  assert.deepEqual(await txByRequest(ctx.customer, job.number), [], 'customer pays nothing');
});

test('AU-F05: free provider cancel releases the hold, slot is re-dispatched, never re-offered to Elvin', { timeout: 180_000 }, async () => {
  const w0 = await wallet(ctx.elvin);
  const job = await acceptedJob();
  await ctx.elvin.c.call(api.pro.cancel, { params: { id: job.assignmentId }, body: { reason: 'QA provider free cancel' } } as any);
  assert.equal((await proA(job.assignmentId)).status, 'CANCELLED_FREE');
  const w1 = await wallet(ctx.elvin);
  assert.equal(w1.held, w0.held);
  assert.equal(w1.posted, w0.posted);
  const req: any = await ctx.customer.c.call(api.requests.get, { params: { id: job.request.id } });
  assert.ok(req.status === 'SEARCHING' || req.isSearching === true, `request after provider cancel: ${req.status}`);
  await sleep(12_000);
  const offers: any = await ctx.elvin.c.call(api.pro.offers);
  assert.ok(!offers.items.some((o: any) => o.requestId === job.request.id && o.status === 'SENT'), 'same request offered to Elvin twice');
  await ctx.customer.c.call(api.requests.cancel, { params: { id: job.request.id }, body: { reason: 'QA cleanup' } } as any);
});

test('AU-F07: decline on arrival = customer -15, Elvin fee back +10 compensation (even inside the window)', { timeout: 180_000 }, async () => {
  const w0 = await wallet(ctx.elvin);
  const job = await acceptedJob();
  await ctx.elvin.c.call(api.pro.location, { body: { lat: ADDRESS.lat, lng: ADDRESS.lng, accuracy: 5 } });
  await ctx.elvin.c.call(api.pro.arrived, { params: { id: job.assignmentId } } as any);
  const ca: any = await custA(job.assignmentId);
  assert.equal(ca.actions.declinePenalty, 1500, 'UI must warn about 15 AZN');
  await ctx.customer.c.call(api.assignments.declineOnArrival, { params: { id: job.assignmentId }, body: {} } as any);
  assert.equal((await proA(job.assignmentId)).status, 'DECLINED_ON_ARRIVAL');
  const w1 = await wallet(ctx.elvin);
  assert.equal(w1.held, w0.held, 'hold released');
  assert.equal(w1.posted - w0.posted, 1000, 'provider +10 AZN compensation');
  assert.deepEqual(await txByRequest(ctx.customer, job.number), ['CANCEL_PENALTY:-1500']);
});

test('AU-F02b + F06: fee captured when the window closes; late customer cancel = -15 / +10 / refund', { timeout: 600_000 }, async () => {
  const w0 = await wallet(ctx.elvin);
  const job = await acceptedJob();
  await sleep(WINDOW_MS);
  const pa: any = await waitFor(async () => {
    const a: any = await proA(job.assignmentId);
    return a.fee?.captured ? a : null;
  }, 90_000, 5_000);
  assert.equal(pa.fee.captured, true);
  const wc = await wallet(ctx.elvin);
  assert.equal(w0.posted - wc.posted, 1000, 'fee captured after the free window');
  assert.equal(wc.held, w0.held);
  const ca: any = await custA(job.assignmentId);
  assert.equal(ca.actions.cancelPenalty, 1500, 'UI must warn about 15 AZN after the window');
  await ctx.customer.c.call(api.assignments.cancel, { params: { id: job.assignmentId }, body: { reason: 'QA late cancel' } } as any);
  assert.equal((await proA(job.assignmentId)).status, 'CANCELLED_BY_CUSTOMER');
  const w1 = await wallet(ctx.elvin);
  assert.equal(w1.posted - w0.posted, 1000, 'net for provider: +10 AZN (fee refunded + 10 compensation)');
  assert.deepEqual(await txByRequest(ctx.customer, job.number), ['CANCEL_PENALTY:-1500']);
});

test('AU-F09 + F08: no-show refused early, allowed after 5 min: fee kept, strike, slot re-dispatched', { timeout: 600_000 }, async () => {
  const s0 = await strikes();
  const w0 = await wallet(ctx.elvin);
  const job = await acceptedJob();
  const early = await expectApiError(() => ctx.customer.c.call(api.assignments.reportNoShow, { params: { id: job.assignmentId }, body: {} } as any));
  assert.ok(early.status === 409 || early.status === 400 || early.status === 403, `${early.status} ${early.code}`);
  await sleep(WINDOW_MS);
  await ctx.customer.c.call(api.assignments.reportNoShow, { params: { id: job.assignmentId }, body: {} } as any);
  assert.equal((await proA(job.assignmentId)).status, 'NO_SHOW');
  const w1 = await wallet(ctx.elvin);
  assert.equal(w0.posted - w1.posted, 1000, 'fee kept');
  if (s0 !== null) assert.equal((await strikes()) - s0, 1, 'one strike');
  const req: any = await ctx.customer.c.call(api.requests.get, { params: { id: job.request.id } });
  assert.ok(req.status === 'SEARCHING' || req.isSearching === true, `request after no-show: ${req.status}`);
  assert.deepEqual(await txByRequest(ctx.customer, job.number), [], 'customer pays nothing for a no-show');
  await ctx.customer.c.call(api.requests.cancel, { params: { id: job.request.id }, body: { reason: 'QA cleanup' } } as any).catch(() => undefined);
});

test('AU-F08: late provider cancel keeps the fee and adds a strike', { timeout: 600_000 }, async () => {
  const s0 = await strikes();
  const w0 = await wallet(ctx.elvin);
  const job = await acceptedJob();
  await sleep(WINDOW_MS);
  await ctx.elvin.c.call(api.pro.cancel, { params: { id: job.assignmentId }, body: { reason: 'QA late provider cancel' } } as any);
  assert.equal((await proA(job.assignmentId)).status, 'CANCELLED_BY_PROVIDER');
  const w1 = await wallet(ctx.elvin);
  assert.equal(w0.posted - w1.posted, 1000, 'fee kept');
  if (s0 !== null) assert.equal((await strikes()) - s0, 1, 'one strike');
  assert.deepEqual(await txByRequest(ctx.customer, job.number), [], 'customer pays nothing');
  await ctx.customer.c.call(api.requests.cancel, { params: { id: job.request.id }, body: { reason: 'QA cleanup' } } as any).catch(() => undefined);
});
