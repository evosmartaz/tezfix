// AU-I09: a B2B project with no quotes expires when the quote window closes (demo: quoteWindowHours 0.1 = 6 min).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, waitFor } from './lib.mts';
import { ADDRESS } from './flows.mts';

const ctx: any = {};
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

after(async () => {
  if (ctx.projectId) await ctx.leyla.c.call(api.projects.cancel, { params: { id: ctx.projectId }, body: {} } as any).catch(() => undefined);
});

test('AU-I09 project without quotes -> EXPIRED after the quote window', { timeout: 900_000 }, async () => {
  ctx.leyla = await login('leyla', 'CUSTOMER');
  const cats: any = await ctx.leyla.c.call(api.categories.list, { query: {} } as any);
  // A QUOTE category FixPro does not serve, so no real provider quotes during the window.
  const rauf = await login('rauf', 'PRO');
  const p: any = await rauf.c.call(api.pro.profile);
  const company: any = await rauf.c.call(api.company.get, { params: { companyId: p.managedCompanies[0].id } });
  const served = new Set(company.trades.map((t: any) => t.id));
  const quoteCats = cats.items.filter((c: any) => c.flow === 'QUOTE' && c.kind === 'SERVICE');
  const cat = quoteCats.find((c: any) => !served.has(c.id)) ?? quoteCats[0];
  const r: any = await ctx.leyla.c.call(api.projects.create, {
    body: {
      categoryId: cat.id,
      title: 'QA müddət bitmə testi',
      scope: '≈ 50 m²',
      dateFrom: day(2),
      dateTo: day(3),
      workersNeeded: 1,
      description: 'QA automation: təklif gəlməyəcək, layihə EXPIRED olmalıdır.',
      address: ADDRESS,
    },
  } as any);
  const proj = r.project ?? r;
  ctx.projectId = proj.id;
  const windowMin = (new Date(proj.quoteDeadline).getTime() - Date.now()) / 60_000;
  console.log(`category ${cat.slug}, quote window ${windowMin.toFixed(1)} min`);
  assert.ok(windowMin > 0 && windowMin < 10, `quote window ${windowMin.toFixed(1)} min (demo expects ~6)`);
  const done: any = await waitFor(async () => {
    const d: any = await ctx.leyla.c.call(api.projects.get, { params: { id: proj.id } });
    return d.status !== 'OPEN' ? d : null;
  }, (windowMin + 5) * 60_000, 15_000);
  assert.equal(done.status, 'EXPIRED');
  ctx.projectId = null;
});
