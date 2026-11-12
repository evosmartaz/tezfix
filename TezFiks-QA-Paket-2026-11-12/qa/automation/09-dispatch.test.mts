// AU-F10, F14, F15, F16, F20, F24, F25, G01, G04: dispatch with a solo handyman (Elvin) and a company (FixPro: Rauf manager,
// Tural worker), emergency fees, multi-slot requests, concurrent accepts, cash payment.
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { api, login, waitFor, expectApiError, sleep, CENTER } from './lib.mts';
import { ADDRESS, plumbingCategoryId, goOnline, goOffline, createRequest, waitOffer, wallet, topup, cancelOpenRequests } from './flows.mts';

const ctx: any = {};

after(async () => {
  if (ctx.customer) await cancelOpenRequests(ctx.customer).catch(() => undefined);
  if (ctx.leyla) await cancelOpenRequests(ctx.leyla).catch(() => undefined);
  if (ctx.elvin) await goOffline(ctx.elvin);
  if (ctx.tural) await goOffline(ctx.tural);
});

// Demo-customer requests never outlive their test (the company chain F15b..F20 runs on Leyla and is cleaned in after()).
afterEach(async () => {
  if (ctx.customer) await cancelOpenRequests(ctx.customer).catch(() => undefined);
});

const companyWallet = async () => (await ctx.rauf.c.call(api.company.wallet, { params: { companyId: ctx.companyId } })) as any;
const reqGet = async (id: string, who = ctx.customer) => (await who.c.call(api.requests.get, { params: { id } })) as any;

async function companyOffer(requestId: string, timeoutMs = 60_000) {
  return waitFor(async () => {
    await ctx.tural.c.call(api.pro.location, { body: { lat: CENTER.lat, lng: CENTER.lng, accuracy: 10 } }).catch(() => undefined);
    const r: any = await ctx.rauf.c.call(api.company.offers, { params: { companyId: ctx.companyId } });
    return r.items.find((o: any) => o.requestId === requestId && o.status === 'SENT') ?? null;
  }, timeoutMs, 1_500);
}

/** True when the provider sees an offer for this request within ms (used for negative checks). */
async function seesOffer(kind: 'elvin' | 'company', requestId: string, ms = 25_000) {
  try {
    if (kind === 'elvin') await waitOffer(ctx.elvin, requestId, ms);
    else await companyOffer(requestId, ms);
    return true;
  } catch {
    return false;
  }
}

async function cancelRequest(id: string, who = ctx.customer) {
  await who.c.call(api.requests.cancel, { params: { id }, body: { reason: 'QA cleanup' } } as any).catch(() => undefined);
}

test('setup: accounts, balances, nobody busy', async () => {
  ctx.customer = await login('demo', 'CUSTOMER');
  ctx.elvin = await login('elvin', 'PRO');
  ctx.rauf = await login('rauf', 'PRO');
  ctx.tural = await login('tural', 'PRO');
  ctx.leyla = await login('leyla', 'CUSTOMER');
  const p: any = await ctx.rauf.c.call(api.pro.profile);
  ctx.companyId = p.managedCompanies[0].id;
  ctx.company = await ctx.rauf.c.call(api.company.get, { params: { companyId: ctx.companyId } });
  await cancelOpenRequests(ctx.customer);
  await cancelOpenRequests(ctx.leyla);
  const members: any = await ctx.rauf.c.call(api.company.members, { params: { companyId: ctx.companyId } });
  ctx.turalHandymanId = members.items.find((m: any) => m.userId === ctx.tural.me.id)?.handymanId;
  assert.ok(ctx.turalHandymanId, 'Tural is not a FixPro member');
  for (const s of [ctx.elvin, ctx.tural]) {
    const a: any = await s.c.call(api.pro.assignments, { query: { scope: 'active' } } as any);
    const busy = (a.items ?? []).filter((x: any) => ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PRICE_PROPOSED'].includes(x.status));
    assert.equal(busy.length, 0, `${s.who} has an active job`);
  }
  if ((await wallet(ctx.elvin)).available < 3000) await topup(ctx.elvin, 3000);
  if ((await wallet(ctx.customer)).available < 5000) await topup(ctx.customer, 5000);
  ctx.categoryId = await plumbingCategoryId(ctx.elvin);
  const tradeIds = ctx.company.trades.map((t: any) => t.id);
  assert.ok(tradeIds.includes(ctx.categoryId), 'FixPro does not serve the plumbing category');
  await goOnline(ctx.elvin);
  await goOnline(ctx.tural);
});

test('AU-F15a providerPreference INDIVIDUAL: Elvin gets the offer, the company does not', { timeout: 120_000 }, async () => {
  // The preference is honoured only for company customers (spec: "provider preference for company accounts"), so Leyla posts.
  const r: any = await createRequest(ctx.leyla, ctx.categoryId, { providerPreference: 'INDIVIDUAL' });
  try {
    assert.equal(r.providerPreference, 'INDIVIDUAL');
    assert.equal(await seesOffer('elvin', r.id, 60_000), true, 'Elvin got no offer');
    assert.equal(await seesOffer('company', r.id, 25_000), false, 'company got an INDIVIDUAL-only request');
  } finally {
    await cancelRequest(r.id, ctx.leyla);
  }
});

test('AU-F15c an individual customer\'s preference is stored as ANY (preference is for company accounts only)', async () => {
  const r: any = await createRequest(ctx.customer, ctx.categoryId, { providerPreference: 'COMPANY' });
  await cancelRequest(r.id);
  assert.equal(r.providerPreference, 'ANY');
});

test('AU-F15b providerPreference COMPANY: the company gets the offer, Elvin does not', { timeout: 120_000 }, async () => {
  const r: any = await createRequest(ctx.leyla, ctx.categoryId, { providerPreference: 'COMPANY' });
  ctx.companyRequest = r;
  assert.equal(r.providerPreference, 'COMPANY');
  ctx.companyOffer = await companyOffer(r.id, 60_000).catch(() => null);
  assert.ok(ctx.companyOffer, 'company got no offer');
  assert.equal(ctx.companyOffer.target, 'COMPANY');
  assert.equal(await seesOffer('elvin', r.id, 20_000), false, 'Elvin got a COMPANY-only request');
  ctx.companyRequest = r;
});

test('AU-F24 company accept: a busy worker cannot be sent; one free worker -> one 10 AZN hold on the company wallet', { timeout: 120_000 }, async () => {
  // Fresh request: demo offers live 15 s, so the one from F15b has expired by now.
  if (ctx.companyRequest) await cancelRequest(ctx.companyRequest.id, ctx.leyla);
  ctx.companyRequest = await createRequest(ctx.leyla, ctx.categoryId, { providerPreference: 'COMPANY' });
  let offer: any = await companyOffer(ctx.companyRequest.id, 60_000);
  const cands = offer.candidateWorkers;
  const tural = cands.find((w: any) => w.userId === ctx.tural.me.id || w.firstName.startsWith('Tural'));
  assert.ok(tural, `Tural is not a candidate: ${cands.map((w: any) => w.firstName).join(', ')}`);
  const busy = cands.find((w: any) => w.busy);
  if (busy) {
    const e = await expectApiError(() =>
      ctx.rauf.c.call(api.company.acceptOffer, { params: { companyId: ctx.companyId, offerId: offer.id }, body: { workerIds: [busy.handymanId] } } as any),
    );
    assert.ok(e.status === 409 || e.status === 400, `busy worker accepted: ${e.status} ${e.code}`);
    offer = await companyOffer(ctx.companyRequest.id, 60_000);
  }
  const w0 = await companyWallet();
  const res: any = await ctx.rauf.c.call(api.company.acceptOffer, {
    params: { companyId: ctx.companyId, offerId: offer.id },
    body: { workerIds: [tural.handymanId] },
  } as any);
  assert.equal(res.assignments.length, 1);
  ctx.companyAssignmentId = res.assignments[0].id;
  const w1 = await companyWallet();
  assert.equal(w1.held - w0.held, 1000, 'company hold must grow by 1000');
  ctx.companyW0 = w0;
  const turalView: any = await ctx.tural.c.call(api.pro.assignment, { params: { id: ctx.companyAssignmentId } });
  assert.equal(turalView.status, 'ACCEPTED');
});

test('AU-F25 final price: only the side allowed by finalPriceEntry can enter it', { timeout: 120_000 }, async () => {
  assert.ok(ctx.companyAssignmentId, 'needs F24');
  const id = ctx.companyAssignmentId;
  await ctx.tural.c.call(api.pro.enRoute, { params: { id }, body: { location: CENTER } } as any);
  await ctx.tural.c.call(api.pro.location, { body: { lat: ADDRESS.lat, lng: ADDRESS.lng, accuracy: 5 } });
  await ctx.tural.c.call(api.pro.arrived, { params: { id } } as any);
  const price = { labor: 2000, materials: 500 };
  const mode = ctx.company.finalPriceEntry;
  if (mode === 'WORKER') {
    const e = await expectApiError(() => ctx.rauf.c.call(api.company.enterPrice, { params: { companyId: ctx.companyId, id }, body: price } as any));
    assert.ok(e.status === 403 || e.status === 409, `manager entered the price in WORKER mode: ${e.status} ${e.code}`);
    await ctx.tural.c.call(api.pro.enterPrice, { params: { id }, body: price } as any);
  } else {
    const e = await expectApiError(() => ctx.tural.c.call(api.pro.enterPrice, { params: { id }, body: price } as any));
    assert.ok(e.status === 403 || e.status === 409, `worker entered the price in MANAGER mode: ${e.status} ${e.code}`);
    await ctx.rauf.c.call(api.company.enterPrice, { params: { companyId: ctx.companyId, id }, body: price } as any);
  }
  const ca: any = await ctx.leyla.c.call(api.assignments.get, { params: { id } });
  assert.equal(ca.status, 'PRICE_PROPOSED');
});

test('AU-F20 + G04 cash payment: confirm twice = one completion; no tip, no guarantee; company fee captured', { timeout: 120_000 }, async () => {
  assert.ok(ctx.companyAssignmentId, 'needs F25');
  const id = ctx.companyAssignmentId;
  const key = `qa-confirm-${randomUUID()}`;
  const a: any = await ctx.leyla.c.call(api.assignments.confirmPrice, { params: { id }, body: { method: 'CASH' }, idempotencyKey: key } as any);
  assert.equal(a.payment, null, 'cash must not open a checkout');
  const b: any = await ctx.leyla.c.call(api.assignments.confirmPrice, { params: { id }, body: { method: 'CASH' }, idempotencyKey: key } as any).catch((e: any) => e);
  if (!(b instanceof Error)) assert.equal(b.assignment.id, id);
  const c = await expectApiError(() => ctx.leyla.c.call(api.assignments.confirmPrice, { params: { id }, body: { method: 'CASH' } } as any));
  assert.ok(c.status === 409 || c.status === 400, `second confirm with a new key: ${c.status} ${c.code}`);
  const ca: any = await waitFor(async () => {
    const x: any = await ctx.leyla.c.call(api.assignments.get, { params: { id } });
    return x.status === 'COMPLETED' ? x : null;
  }, 30_000, 2_000);
  assert.equal(ca.guaranteeUntil ?? null, null, 'cash job must have no guarantee');
  assert.equal(ca.actions.tip, false, 'tip offered after cash');
  const tip = await expectApiError(() => ctx.leyla.c.call(api.assignments.tip, { params: { id }, body: { amount: 500 } } as any));
  assert.ok(tip.status >= 400 && tip.status < 500, `tip after cash: ${tip.status}`);
  const g = await expectApiError(() => ctx.leyla.c.call(api.assignments.guaranteeClaim, { params: { id }, body: { description: 'QA: yenə axır, zəmanət' } } as any));
  assert.ok(g.status >= 400 && g.status < 500, `guarantee after cash: ${g.status}`);
  const w = await companyWallet();
  assert.equal(w.held, ctx.companyW0.held, 'company hold released');
  assert.equal(ctx.companyW0.posted - w.posted, 1000, 'company fee captured at completion');
  await ctx.leyla.c.call(api.assignments.rate, { params: { id }, body: { stars: 5, comment: 'QA nağd' } } as any).catch(() => undefined);
});

test('AU-G01 one slot, Elvin and the company accept at the same moment: exactly one wins, one hold', { timeout: 150_000 }, async (t) => {
  const r: any = await createRequest(ctx.customer, ctx.categoryId);
  const [eo, co] = await Promise.all([waitOffer(ctx.elvin, r.id, 60_000).catch(() => null), companyOffer(r.id, 60_000).catch(() => null)]);
  if (!eo || !co) {
    await cancelRequest(r.id);
    t.skip(`both offers were not open at the same time (elvin=${!!eo}, company=${!!co})`);
    return;
  }
  const ew0 = await wallet(ctx.elvin);
  const cw0 = await companyWallet();
  const results = await Promise.allSettled([
    ctx.elvin.c.call(api.pro.acceptOffer, { params: { id: eo.id } } as any),
    ctx.rauf.c.call(api.company.acceptOffer, { params: { companyId: ctx.companyId, offerId: co.id }, body: { workerIds: [ctx.turalHandymanId] } } as any),
  ]);
  const ok = results.filter((x) => x.status === 'fulfilled');
  const bad = results.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
  assert.equal(ok.length, 1, `winners: ${ok.length}`);
  assert.equal(bad.length, 1);
  assert.ok([409, 410].includes(bad[0].reason.status), `loser got ${bad[0].reason.status} ${bad[0].reason.code}`);
  const ew1 = await wallet(ctx.elvin);
  const cw1 = await companyWallet();
  assert.equal(ew1.held - ew0.held + (cw1.held - cw0.held), 1000, 'exactly one 10 AZN hold in total');
  const req = await reqGet(r.id);
  assert.equal(req.slotsFilled, 1);
  await cancelRequest(r.id);
});

test('AU-F14 two slots filled by Elvin and the company: request ASSIGNED, other offers closed', { timeout: 150_000 }, async () => {
  const r: any = await createRequest(ctx.customer, ctx.categoryId, { slots: 2 });
  const eo: any = await waitOffer(ctx.elvin, r.id, 60_000);
  await ctx.elvin.c.call(api.pro.acceptOffer, { params: { id: eo.id } } as any);
  const co: any = await companyOffer(r.id, 60_000);
  assert.equal(co.slotsOpen, 1);
  await ctx.rauf.c.call(api.company.acceptOffer, { params: { companyId: ctx.companyId, offerId: co.id }, body: { workerIds: [ctx.turalHandymanId] } } as any);
  const req = await waitFor(async () => {
    const x = await reqGet(r.id);
    return x.status === 'ASSIGNED' ? x : null;
  }, 20_000, 2_000);
  assert.equal(req.slotsFilled, 2);
  assert.equal(req.isSearching, false);
  const left: any = await ctx.rauf.c.call(api.company.offers, { params: { companyId: ctx.companyId } });
  assert.ok(!left.items.some((o: any) => o.requestId === r.id && o.status === 'SENT'), 'an offer is still open for a full request');
  await cancelRequest(r.id);
  const after = await reqGet(r.id);
  assert.equal(after.status, 'CANCELLED');
});

test('AU-F10 + F16 emergency, 2 slots: 2 x 5 AZN held; filled slot keeps its hold, unfilled slot is released when the search ends', { timeout: 300_000 }, async () => {
  await goOffline(ctx.tural);
  const w0 = await wallet(ctx.customer);
  const r: any = await createRequest(ctx.customer, ctx.categoryId, { timing: 'EMERGENCY', slots: 2, providerPreference: 'INDIVIDUAL' });
  assert.equal(r.emergencyFee?.perSlot, 500);
  assert.equal(r.emergencyFee?.total, 1000);
  const w1 = await wallet(ctx.customer);
  assert.equal(w1.held - w0.held, 1000, 'two emergency holds');
  const eo: any = await waitOffer(ctx.elvin, r.id, 60_000);
  assert.equal(eo.isEmergency, true);
  await ctx.elvin.c.call(api.pro.acceptOffer, { params: { id: eo.id } } as any);
  const done = await waitFor(async () => {
    const x = await reqGet(r.id);
    return !x.isSearching ? x : null;
  }, 150_000, 5_000);
  assert.ok(done.slots.some((s: any) => s.status === 'UNFILLED'), `slots: ${done.slots.map((s: any) => s.status).join(',')}`);
  const w2 = await wallet(ctx.customer);
  assert.equal(w2.held - w0.held, 500, 'only the filled slot keeps its 5 AZN hold');
  assert.equal(w2.posted, w0.posted, 'nothing charged yet');
  await cancelRequest(r.id);
  const w3 = await wallet(ctx.customer);
  assert.equal(w3.held, w0.held, 'free cancel releases the last emergency hold');
  assert.equal(w3.posted, w0.posted);
});

test('AU-F16b no provider at all: the search ends, request EXPIRED, emergency hold released', { timeout: 300_000 }, async () => {
  await goOffline(ctx.elvin);
  await goOffline(ctx.tural);
  const w0 = await wallet(ctx.customer);
  const r: any = await createRequest(ctx.customer, ctx.categoryId, { timing: 'EMERGENCY', slots: 1, providerPreference: 'INDIVIDUAL' });
  const done = await waitFor(async () => {
    const x = await reqGet(r.id);
    return x.status !== 'SEARCHING' ? x : null;
  }, 180_000, 5_000);
  if (done.status === 'ASSIGNED') {
    await cancelRequest(r.id);
    assert.fail('someone else (a bot?) accepted the request; cannot check EXPIRED');
  }
  assert.equal(done.status, 'EXPIRED');
  const w1 = await wallet(ctx.customer);
  assert.equal(w1.held, w0.held, 'emergency hold released');
  assert.equal(w1.posted, w0.posted, 'nothing charged');
});
