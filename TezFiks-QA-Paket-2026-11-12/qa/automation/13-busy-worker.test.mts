// AU-F24 (tam): şirkət qəbulunda MƏŞĞUL işçini göndərmək olmur, hold yaranmır; boş işçi ilə qəbul işləyir.
// Əlavə (Q-03 üçün məlumat): oflayn işçi namizədlər siyahısında görünürmü və onunla qəbul mümkündürmü?
// BUG-004-ə görə işçilər sorğudan ƏVVƏL onlayn edilir.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, waitFor, expectApiError, sleep, CENTER } from './lib.mts';
import { plumbingCategoryId, goOnline, goOffline, createRequest, cancelOpenRequests } from './flows.mts';

const ctx: any = {};

after(async () => {
  if (ctx.leyla) await cancelOpenRequests(ctx.leyla).catch(() => undefined);
  for (const s of [ctx.kamran, ctx.tural]) if (s) await goOffline(s);
});

const companyWallet = async () => (await ctx.rauf.c.call(api.company.wallet, { params: { companyId: ctx.companyId } })) as any;

async function companyOffer(requestId: string, timeoutMs = 60_000) {
  return waitFor(async () => {
    for (const s of ctx.online ?? []) await s.c.call(api.pro.location, { body: { lat: CENTER.lat, lng: CENTER.lng, accuracy: 10 } }).catch(() => undefined);
    const r: any = await ctx.rauf.c.call(api.company.offers, { params: { companyId: ctx.companyId } });
    return r.items.find((o: any) => o.requestId === requestId && o.status === 'SENT') ?? null;
  }, timeoutMs, 1_000);
}

test('setup: FixPro, Kamran və Tural boşdur, Elvin oflayn', async () => {
  ctx.rauf = await login('rauf', 'PRO');
  ctx.kamran = await login('kamran', 'PRO');
  ctx.tural = await login('tural', 'PRO');
  ctx.leyla = await login('leyla', 'CUSTOMER');
  const elvin = await login('elvin', 'PRO');
  await goOffline(elvin);
  await cancelOpenRequests(ctx.leyla);
  const p: any = await ctx.rauf.c.call(api.pro.profile);
  ctx.companyId = p.managedCompanies[0].id;
  const members: any = await ctx.rauf.c.call(api.company.members, { params: { companyId: ctx.companyId } });
  ctx.kamranId = members.items.find((m: any) => m.userId === ctx.kamran.me.id)?.handymanId;
  ctx.turalId = members.items.find((m: any) => m.userId === ctx.tural.me.id)?.handymanId;
  assert.ok(ctx.kamranId && ctx.turalId);
  for (const s of [ctx.kamran, ctx.tural]) {
    const a: any = await s.c.call(api.pro.assignments, { query: { scope: 'active' } } as any).catch(() => ({ items: [] }));
    assert.equal((a.items ?? []).filter((x: any) => ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PRICE_PROPOSED'].includes(x.status)).length, 0, `${s.who} busy`);
  }
  ctx.categoryId = await plumbingCategoryId(elvin);
});

test('AU-F24a Kamran birinci şirkət sifarişinə təyin olunur (məşğul olur)', { timeout: 120_000 }, async () => {
  await goOnline(ctx.kamran); await goOnline(ctx.tural);
  ctx.online = [ctx.kamran, ctx.tural];
  await sleep(3_000);
  const r: any = await createRequest(ctx.leyla, ctx.categoryId, { providerPreference: 'COMPANY' });
  ctx.req1 = r.request ?? r;
  const offer: any = await companyOffer(ctx.req1.id);
  const res: any = await ctx.rauf.c.call(api.company.acceptOffer, { params: { companyId: ctx.companyId, offerId: offer.id }, body: { workerIds: [ctx.kamranId] } } as any);
  assert.equal(res.assignments.length, 1);
  const kv: any = await ctx.kamran.c.call(api.pro.assignment, { params: { id: res.assignments[0].id } });
  assert.equal(kv.status, 'ACCEPTED');
});

test('AU-F24b ikinci sifarişdə Kamran "məşğul" görünür, onunla qəbul rədd olunur, hold yaranmır', { timeout: 120_000 }, async () => {
  const r: any = await createRequest(ctx.leyla, ctx.categoryId, { providerPreference: 'COMPANY' });
  ctx.req2 = r.request ?? r;
  const offer: any = await companyOffer(ctx.req2.id);
  const cands = offer.candidateWorkers ?? [];
  console.log('candidates:', JSON.stringify(cands.map((w: any) => ({ name: w.firstName, busy: w.busy, online: w.online ?? w.isOnline, distanceM: w.distanceM }))));
  const k = cands.find((w: any) => w.handymanId === ctx.kamranId);
  if (k) assert.equal(k.busy, true, 'Kamran must be marked busy');
  const w0 = await companyWallet();
  const e = await expectApiError(() =>
    ctx.rauf.c.call(api.company.acceptOffer, { params: { companyId: ctx.companyId, offerId: offer.id }, body: { workerIds: [ctx.kamranId] } } as any),
  );
  console.log('busy accept ->', e.status, e.code);
  assert.ok(e.status === 409 || e.status === 400 || e.status === 422, `busy worker accepted: ${e.status} ${e.code}`);
  const w1 = await companyWallet();
  assert.equal(w1.held, w0.held, 'no hold for a refused accept');
  ctx.offer2 = offer;
});

test('AU-F24c eyni sifarişi boş işçi (Tural) ilə qəbul etmək olur: 1 hold', { timeout: 120_000 }, async () => {
  const offer: any = await companyOffer(ctx.req2.id).catch(() => null);
  assert.ok(offer, 'offer gone after refused accept (TTL 15 s?)');
  const w0 = await companyWallet();
  const res: any = await ctx.rauf.c.call(api.company.acceptOffer, { params: { companyId: ctx.companyId, offerId: offer.id }, body: { workerIds: [ctx.turalId] } } as any);
  assert.equal(res.assignments.length, 1);
  const w1 = await companyWallet();
  assert.equal(w1.held - w0.held, 1000);
  await cancelOpenRequests(ctx.leyla);
});

test('Q-03 məlumat: oflayn işçi namizəd siyahısında görünürmü, onunla qəbul olurmu?', { timeout: 120_000 }, async () => {
  await goOffline(ctx.tural);
  ctx.online = [ctx.kamran];
  await sleep(3_000);
  const r: any = await createRequest(ctx.leyla, ctx.categoryId, { providerPreference: 'COMPANY' });
  const offer: any = await companyOffer((r.request ?? r).id);
  const t = (offer.candidateWorkers ?? []).find((w: any) => w.handymanId === ctx.turalId);
  console.log('offline Tural candidate:', JSON.stringify(t ?? null));
  const res: any = await ctx.rauf.c.call(api.company.acceptOffer, { params: { companyId: ctx.companyId, offerId: offer.id }, body: { workerIds: [ctx.turalId] } } as any).catch((e: any) => e);
  console.log('offline Tural accept ->', res instanceof Error ? `${(res as any).status} ${(res as any).code}` : `OK assignments=${res.assignments?.length}`);
  await cancelOpenRequests(ctx.leyla);
});
