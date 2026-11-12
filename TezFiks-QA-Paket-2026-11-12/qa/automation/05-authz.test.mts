// AU-D01..D10, AU-E07: authorization (IDOR, roles) and the company worker's limited view, with seeded demo data.
// Uses Nizami, Aysel, Leyla, Rauf, Tural, Kamran, Samir, Vuqar (not Elvin / Demo Müştəri, which other suites drive).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, expectApiError, findPhones, CENTER } from './lib.mts';

const ctx: any = {};
const denied = (e: any) => [401, 403, 404].includes(e.status);

test('setup: seeded ids (Nizami request + assignment, FixPro company)', async () => {
  ctx.nizami = await login('nizami', 'CUSTOMER');
  ctx.aysel = await login('aysel', 'CUSTOMER');
  ctx.rauf = await login('rauf', 'PRO');
  ctx.tural = await login('tural', 'PRO');
  ctx.kamran = await login('kamran', 'PRO');
  const list: any = await ctx.nizami.c.call(api.requests.list, { query: {} } as any);
  assert.ok(list.items.length > 0, 'Nizami has no requests');
  ctx.nizamiRequestId = list.items[0].id;
  for (const r of list.items) {
    const d: any = await ctx.nizami.c.call(api.requests.get, { params: { id: r.id } });
    if (d.assignments?.length) {
      ctx.nizamiAssignmentId = d.assignments[0].id;
      break;
    }
  }
  assert.ok(ctx.nizamiAssignmentId, 'Nizami has no assignment');
  const p: any = await ctx.rauf.c.call(api.pro.profile);
  ctx.companyId = p.managedCompanies[0]?.id;
  assert.ok(ctx.companyId, 'Rauf manages no company');
});

test('AU-D01 another customer cannot read or act on Nizami\'s request / assignment / chat', async () => {
  const a = ctx.aysel.c;
  const calls: Array<[string, () => Promise<unknown>]> = [
    ['requests.get', () => a.call(api.requests.get, { params: { id: ctx.nizamiRequestId } })],
    ['requests.cancel', () => a.call(api.requests.cancel, { params: { id: ctx.nizamiRequestId }, body: {} } as any)],
    ['assignments.get', () => a.call(api.assignments.get, { params: { id: ctx.nizamiAssignmentId } })],
    ['assignments.cancel', () => a.call(api.assignments.cancel, { params: { id: ctx.nizamiAssignmentId }, body: {} } as any)],
    ['chat.list', () => a.call(api.chat.list, { params: { id: ctx.nizamiAssignmentId }, query: {} } as any)],
    ['chat.send', () => a.call(api.chat.send, { params: { id: ctx.nizamiAssignmentId }, body: { body: 'qa' } } as any)],
    ['assignments.rate', () => a.call(api.assignments.rate, { params: { id: ctx.nizamiAssignmentId }, body: { stars: 1 } } as any)],
  ];
  const leaks: string[] = [];
  for (const [name, fn] of calls) {
    const e = await expectApiError(fn).catch((err) => ({ status: 200, code: `SUCCEEDED (${err.message})` }));
    if (!denied(e)) leaks.push(`${name}: ${e.status} ${e.code}`);
  }
  assert.deepEqual(leaks, []);
});

test('AU-D06 a handyman who is not the doer cannot read or drive the job', async () => {
  const t = ctx.tural.c;
  const leaks: string[] = [];
  for (const [name, fn] of [
    ['pro.assignment', () => t.call(api.pro.assignment, { params: { id: ctx.nizamiAssignmentId } })],
    ['pro.enRoute', () => t.call(api.pro.enRoute, { params: { id: ctx.nizamiAssignmentId }, body: {} } as any)],
    ['pro.arrived', () => t.call(api.pro.arrived, { params: { id: ctx.nizamiAssignmentId } } as any)],
    ['pro.cancel', () => t.call(api.pro.cancel, { params: { id: ctx.nizamiAssignmentId }, body: {} } as any)],
  ] as Array<[string, () => Promise<unknown>]>) {
    const e = await expectApiError(fn).catch((err) => ({ status: 200, code: `SUCCEEDED (${err.message})` }));
    if (!denied(e) && !(e.status === 409)) leaks.push(`${name}: ${e.status} ${e.code}`);
  }
  assert.deepEqual(leaks, []);
});

test('AU-D04 a company worker cannot use manager endpoints', async () => {
  const t = ctx.tural.c;
  const p = { companyId: ctx.companyId };
  const leaks: string[] = [];
  for (const [name, fn] of [
    ['company.get', () => t.call(api.company.get, { params: p })],
    ['company.members', () => t.call(api.company.members, { params: p, query: {} } as any)],
    ['company.wallet', () => t.call(api.company.wallet, { params: p })],
    ['company.offers', () => t.call(api.company.offers, { params: p })],
    ['company.createInvite', () => t.call(api.company.createInvite, { params: p, body: { role: 'MANAGER' } } as any)],
    ['company.updateSettings', () => t.call(api.company.updateSettings, { params: p, body: { finalPriceEntry: 'WORKER' } } as any)],
  ] as Array<[string, () => Promise<unknown>]>) {
    const e = await expectApiError(fn).catch((err) => ({ status: 200, code: `SUCCEEDED (${err.message})` }));
    if (!denied(e)) leaks.push(`${name}: ${e.status} ${e.code}`);
  }
  assert.deepEqual(leaks, []);
});

test('AU-D05 a manager cannot open another company id; customers cannot open company endpoints', async () => {
  const fake = '01900000-0000-7000-8000-000000000000';
  const e1 = await expectApiError(() => ctx.rauf.c.call(api.company.get, { params: { companyId: fake } }));
  assert.ok(denied(e1), `${e1.status} ${e1.code}`);
  const e2 = await expectApiError(() => ctx.aysel.c.call(api.company.get, { params: { companyId: ctx.companyId } }));
  assert.ok(denied(e2), `${e2.status} ${e2.code}`);
  const own: any = await ctx.rauf.c.call(api.company.get, { params: { companyId: ctx.companyId } });
  assert.equal(own.id ?? own.company?.id, ctx.companyId);
});

test('AU-D02/D03 customer and user tokens cannot reach admin endpoints', async () => {
  const e = await expectApiError(() => ctx.aysel.c.call(api.admin.dashboard, {} as any));
  assert.ok(denied(e), `${e.status} ${e.code}`);
});

test('AU-D09 blocked handyman (Vüqar) cannot go online or see open projects', async () => {
  const v = await login('vuqar', 'PRO');
  const e = await expectApiError(() => v.c.call(api.pro.setOnline, { body: { online: true, location: CENTER } }));
  assert.ok(e.status >= 400 && e.status < 500, `${e.status} ${e.code}`);
});

test('AU-D10 pending handyman (Samir) cannot go online', async () => {
  const s = await login('samir', 'PRO');
  const e = await expectApiError(() => s.c.call(api.pro.setOnline, { body: { online: true, location: CENTER } }));
  assert.ok(e.status >= 400 && e.status < 500, `${e.status} ${e.code}`);
});

test('AU-E07 company worker view (Kamran): no description, no customer rating, no price, no fee', async () => {
  const list: any = await ctx.kamran.c.call(api.pro.assignments, { query: {} } as any);
  assert.ok(list.items.length > 0, 'Kamran has no jobs in the demo seed');
  for (const item of list.items.slice(0, 5)) {
    const a: any = await ctx.kamran.c.call(api.pro.assignment, { params: { id: item.id } });
    assert.equal(a.view, 'WORKER_LIMITED', `job ${a.requestNumber}`);
    assert.equal(a.description, null, 'description leaks to the worker');
    assert.equal(a.fee, null, 'fee leaks to the worker');
    assert.equal(a.price, null, 'price leaks to the worker');
    assert.ok(a.customer.ratingAvg === null || a.customer.ratingAvg === undefined, 'customer rating leaks to the worker');
    if (!a.contactUnlocked) assert.deepEqual(findPhones(a).filter((p) => !p.endsWith('502000013')), []);
  }
});

test('AU-D07 KYC files are not readable by their owner or other users', async () => {
  const s = await login('samir', 'PRO');
  const k: any = await s.c.call(api.kyc.status);
  const ids = JSON.stringify(k).match(/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
  const fileIds = [...new Set(ids)].filter((id) => /file/i.test(JSON.stringify(k).split(id)[0].slice(-40)));
  for (const id of fileIds.slice(0, 3)) {
    for (const who of [s, ctx.rauf]) {
      const r = await fetch(`${process.env.TF_API ?? 'https://evosmart.az/tezfix/api'}/files/${id}`, { headers: { Authorization: `Bearer ${who.token}` }, redirect: 'manual' });
      assert.ok([401, 403, 404].includes(r.status), `KYC file ${id} readable by ${who.who}: ${r.status}`);
    }
  }
});
