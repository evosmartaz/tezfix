// AU-I01..I07: B2B quote flow (spec 4.10) with Leyla (Kontur MMC) as the customer and FixPro MMC (Rauf) as the provider.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, expectApiError, findPhones } from './lib.mts';
import { ADDRESS } from './flows.mts';

const ctx: any = {};
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

after(async () => {
  for (const id of [ctx.projectId2].filter(Boolean)) {
    await ctx.leyla.c.call(api.projects.cancel, { params: { id }, body: {} } as any).catch(() => undefined);
  }
});

async function companyWallet() {
  return (await ctx.rauf.c.call(api.company.wallet, { params: { companyId: ctx.companyId } })) as any;
}

test('setup', async () => {
  ctx.leyla = await login('leyla', 'CUSTOMER');
  ctx.rauf = await login('rauf', 'PRO');
  const p: any = await ctx.rauf.c.call(api.pro.profile);
  ctx.companyId = p.managedCompanies[0].id;
  const cats: any = await ctx.leyla.c.call(api.categories.list, { query: {} } as any);
  const quoteCats = cats.items.filter((c: any) => c.flow === 'QUOTE' && c.kind === 'SERVICE');
  ctx.category = quoteCats.find((c: any) => /temir|təmir|renov|brigad/i.test(`${c.slug} ${c.name}`)) ?? quoteCats[0];
  assert.ok(ctx.category, 'no QUOTE category');
});

async function newProject(title: string) {
  const r: any = await ctx.leyla.c.call(api.projects.create, {
    body: {
      categoryId: ctx.category.id,
      title,
      scope: '≈ 120 m² (1 mərtəbə, 4 otaq)',
      dateFrom: day(2),
      dateTo: day(3),
      workersNeeded: 2,
      description: 'QA automation: ofis təmiri, divarların rənglənməsi.',
      address: ADDRESS,
    },
  } as any);
  return r.project ?? r;
}

test('AU-I01 company customer creates a project; FixPro sees it in open projects', async () => {
  const p = await newProject('QA B2B test layihəsi');
  ctx.projectId = p.id;
  assert.equal(p.status, 'OPEN');
  const open: any = await ctx.rauf.c.call(api.providerProjects.open, { query: { companyId: ctx.companyId } } as any);
  const seen = open.items.find((x: any) => x.id === ctx.projectId);
  assert.ok(seen, 'FixPro does not see the new project');
  assert.deepEqual(findPhones(seen), [], 'customer phone in the open project list');
});

test('AU-I02/I03 quote holds 10 AZN x workers x days; a second quote is refused', async () => {
  const w0 = await companyWallet();
  const q: any = await ctx.rauf.c.call(api.providerProjects.submitQuote, {
    params: { id: ctx.projectId },
    body: { companyId: ctx.companyId, totalAmount: 120_000, workers: 2, days: 2, note: 'QA təklifi' },
  } as any);
  ctx.quoteId = q.id;
  assert.equal(q.feeHeld, 4000);
  const w1 = await companyWallet();
  assert.equal(w1.held - w0.held, 4000);
  const dup = await expectApiError(() =>
    ctx.rauf.c.call(api.providerProjects.submitQuote, { params: { id: ctx.projectId }, body: { companyId: ctx.companyId, totalAmount: 100_000, workers: 1, days: 1 } } as any),
  );
  assert.ok(dup.status === 409 || dup.status === 400, `${dup.status} ${dup.code}`);
  ctx.w1 = w1;
});

test('AU-I04 withdrawing a quote releases its hold', async () => {
  const p2 = await newProject('QA B2B geri çəkmə testi');
  ctx.projectId2 = p2.id;
  const w0 = await companyWallet();
  const q: any = await ctx.rauf.c.call(api.providerProjects.submitQuote, {
    params: { id: p2.id },
    body: { companyId: ctx.companyId, totalAmount: 50_000, workers: 1, days: 1 },
  } as any);
  assert.equal((await companyWallet()).held - w0.held, 1000);
  await ctx.rauf.c.call(api.providerProjects.withdrawQuote, { params: { id: q.id }, body: { companyId: ctx.companyId } } as any);
  const w2 = await companyWallet();
  assert.equal(w2.held, w0.held);
  assert.equal(w2.posted, w0.posted);
});

test('AU-I05 customer accepts the quote: fee captured, project AWARDED', async () => {
  const d: any = await ctx.leyla.c.call(api.projects.get, { params: { id: ctx.projectId } });
  assert.ok(d.quotes.some((q: any) => q.id === ctx.quoteId), 'customer does not see the quote');
  await ctx.leyla.c.call(api.projects.acceptQuote, { params: { id: ctx.projectId, quoteId: ctx.quoteId } } as any);
  const after: any = await ctx.leyla.c.call(api.projects.get, { params: { id: ctx.projectId } });
  assert.ok(['AWARDED', 'IN_PROGRESS'].includes(after.status), after.status);
  assert.equal(after.awardedQuote.id, ctx.quoteId);
  const w = await companyWallet();
  assert.equal(ctx.w1.held - w.held, 4000, 'hold released after capture');
  assert.equal(ctx.w1.posted - w.posted, 4000, '40 AZN captured');
});

test('AU-I06 daily reports: 0..100 %, visible to the customer', async () => {
  const bad = await expectApiError(() =>
    ctx.rauf.c.call(api.providerProjects.addReport, { params: { id: ctx.projectId }, body: { companyId: ctx.companyId, note: 'x', progressPercent: 101 } } as any),
  );
  assert.equal(bad.status, 400);
  await ctx.rauf.c.call(api.providerProjects.addReport, { params: { id: ctx.projectId }, body: { companyId: ctx.companyId, note: 'QA: 1-ci gün, divarlar hazırlandı', progressPercent: 50 } } as any);
  const d: any = await ctx.leyla.c.call(api.projects.get, { params: { id: ctx.projectId } });
  assert.ok(d.reports.some((r: any) => r.progressPercent === 50));
});

test('AU-I07 completion issues an invoice: number TF-YYYY-NNNNNN, VAT 18 % only for VAT payers', async () => {
  await ctx.rauf.c.call(api.providerProjects.complete, { params: { id: ctx.projectId }, body: { companyId: ctx.companyId } } as any);
  const d: any = await ctx.leyla.c.call(api.projects.get, { params: { id: ctx.projectId } });
  const inv = d.invoice;
  assert.ok(inv, 'no invoice after completion');
  assert.match(inv.number, /^TF-\d{4}-\d{6}$/);
  assert.equal(inv.subtotal, 120_000);
  const expectedVat = inv.issuer.isVatPayer ? Math.round(120_000 * 0.18) : 0;
  assert.equal(inv.vatAmount, expectedVat);
  assert.equal(inv.total, inv.subtotal + inv.vatAmount);
  assert.equal(inv.status, 'ISSUED');
  ctx.invoice = inv;
});

test('AU-I05b project rating once', async () => {
  await ctx.leyla.c.call(api.projects.rate, { params: { id: ctx.projectId }, body: { stars: 5, comment: 'QA' } } as any);
  const twice = await expectApiError(() => ctx.leyla.c.call(api.projects.rate, { params: { id: ctx.projectId }, body: { stars: 4 } } as any));
  assert.ok(twice.status === 409 || twice.status === 400, `${twice.status} ${twice.code}`);
});
