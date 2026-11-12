// AU-A04, A05, B03, B04, G02, H02, F26, P01: infrastructure, i18n, pagination, payments idempotency, invites, light latency.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';
import { api, login, client, expectApiError, raw, BASE, PANEL, waitFor } from './lib.mts';
import { wallet, payCheckout } from './flows.mts';

const ctx: any = {};

after(async () => {
  if (ctx.inviteId) await ctx.rauf.c.call(api.company.revokeInvite, { params: { companyId: ctx.companyId, inviteId: ctx.inviteId } } as any).catch(() => undefined);
});

function certDaysLeft(host: string): Promise<{ days: number; authorized: boolean; subject: string }> {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host, port: 443, servername: host }, () => {
      const c = s.getPeerCertificate();
      resolve({ days: (new Date(c.valid_to).getTime() - Date.now()) / 86_400_000, authorized: s.authorized, subject: String(c.subject?.CN ?? '') });
      s.end();
    });
    s.on('error', reject);
  });
}

test('AU-A04 TLS certificates are valid with more than 14 days left (API and panel)', async () => {
  for (const host of [new URL(BASE).host, new URL(PANEL).host]) {
    const c = await certDaysLeft(host);
    assert.equal(c.authorized, true, `${host}: certificate not trusted`);
    assert.ok(c.days > 14, `${host}: only ${c.days.toFixed(1)} days left`);
  }
});

test('AU-A05 Socket.IO handshake answers on /tezfix/api/socket.io', async () => {
  const u = new URL(BASE);
  const res = await fetch(`${u.origin}/tezfix/api/socket.io/?EIO=4&transport=polling`);
  const text = await res.text();
  assert.equal(res.status, 200, `socket.io polling -> ${res.status}: ${text.slice(0, 120)}`);
  assert.match(text, /"sid":"/);
});

test('AU-B03 Accept-Language switches category names (az / ru / en)', async () => {
  const names: Record<string, string[]> = {};
  for (const l of ['az', 'ru', 'en']) {
    const r: any = await client(undefined, l).call(api.categories.list, { query: {} } as any);
    names[l] = r.items.map((c: any) => c.name);
    assert.ok(names[l].length > 0);
  }
  assert.notDeepEqual(names.az, names.ru, 'ru names equal az names');
  assert.notDeepEqual(names.az, names.en, 'en names equal az names');
  assert.ok(names.ru.some((n) => /[А-Яа-я]/.test(n)), 'no Cyrillic in ru names');
  assert.ok(!names.en.some((n) => /[əğıöüşç]/i.test(n)), `Azerbaijani letters in en names: ${names.en.filter((n) => /[əğıöüşç]/i.test(n)).join(', ')}`);
});

test('AU-B04 pagination: { items, nextCursor }, no duplicates across pages', async () => {
  ctx.customer = await login('demo', 'CUSTOMER');
  const seen = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  do {
    const r: any = await ctx.customer.c.call(api.wallet.transactions, { query: { limit: 3, ...(cursor ? { cursor } : {}) } } as any);
    assert.ok(Array.isArray(r.items));
    assert.ok('nextCursor' in r);
    assert.ok(r.items.length <= 3);
    for (const t of r.items) {
      assert.ok(!seen.has(t.id), `duplicate ${t.id} on page ${pages + 1}`);
      seen.add(t.id);
    }
    cursor = r.nextCursor ?? undefined;
    pages++;
  } while (cursor && pages < 6);
  const all: any = await ctx.customer.c.call(api.wallet.transactions, { query: { limit: 18 } } as any);
  const first = all.items.slice(0, seen.size).map((t: any) => t.id);
  assert.deepEqual(first, [...seen], 'paged order differs from one big page');
});

test('AU-G02 two top-ups with the same Idempotency-Key create one payment', { timeout: 90_000 }, async () => {
  const w0 = await wallet(ctx.customer);
  const key = `qa-topup-${randomUUID()}`;
  const a: any = await ctx.customer.c.call(api.wallet.topup, { body: { amount: 300 }, idempotencyKey: key } as any);
  const b: any = await ctx.customer.c.call(api.wallet.topup, { body: { amount: 300 }, idempotencyKey: key } as any);
  assert.equal(b.paymentIntentId, a.paymentIntentId, 'same key, different payment intents');
  await payCheckout(a.checkoutUrl);
  await waitFor(async () => (await wallet(ctx.customer)).posted >= w0.posted + 300, 30_000);
  await payCheckout(b.checkoutUrl).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 3000));
  assert.equal((await wallet(ctx.customer)).posted - w0.posted, 300, 'credited more than once');
});

test('AU-H02 declined test card 4000 0000 0000 0002: FAILED, no ledger entry', { timeout: 90_000 }, async () => {
  const w0 = await wallet(ctx.customer);
  const tx0: any = await ctx.customer.c.call(api.wallet.transactions, { query: { limit: 1 } } as any);
  const co: any = await ctx.customer.c.call(api.wallet.topup, { body: { amount: 200 } });
  await payCheckout(co.checkoutUrl, '4000 0000 0000 0002');
  const p: any = await waitFor(async () => {
    const x: any = await ctx.customer.c.call(api.payments.get, { params: { id: co.paymentIntentId } });
    return x.status !== 'PENDING' && x.status !== 'CREATED' ? x : null;
  }, 30_000, 2_000);
  assert.equal(p.status, 'FAILED');
  const w1 = await wallet(ctx.customer);
  assert.equal(w1.posted, w0.posted);
  const tx1: any = await ctx.customer.c.call(api.wallet.transactions, { query: { limit: 1 } } as any);
  assert.equal(tx1.items[0]?.id, tx0.items[0]?.id, 'a ledger entry was written for a declined card');
});

test('AU-F26 invite links: preview valid, revoked, unknown token; workers cannot create invites', async () => {
  ctx.rauf = await login('rauf', 'PRO');
  const p: any = await ctx.rauf.c.call(api.pro.profile);
  ctx.companyId = p.managedCompanies[0].id;
  const inv: any = await ctx.rauf.c.call(api.company.createInvite, { params: { companyId: ctx.companyId }, body: { role: 'WORKER', maxUses: 1, expiresInDays: 1 } } as any);
  ctx.inviteId = inv.id;
  assert.match(inv.url, /\/tezfix\/join\//);
  const anon = client();
  const ok: any = await anon.call(api.invites.preview, { params: { token: inv.token } });
  assert.equal(ok.valid, true);
  assert.equal(ok.reason, null);
  assert.ok(ok.companyName.length > 0);
  // Public join page renders (AU-N12 at HTTP level).
  const page = await fetch(inv.url);
  assert.equal(page.status, 200, `join page -> ${page.status}`);
  await ctx.rauf.c.call(api.company.revokeInvite, { params: { companyId: ctx.companyId, inviteId: inv.id } } as any);
  ctx.inviteId = null;
  const rev: any = await anon.call(api.invites.preview, { params: { token: inv.token } });
  assert.equal(rev.valid, false);
  assert.equal(rev.reason, 'REVOKED');
  const unknown = await expectApiError(() => anon.call(api.invites.preview, { params: { token: 'qa-no-such-token-0000' } }));
  assert.equal(unknown.status, 404, `${unknown.status} ${unknown.code}`);
  const badPage = await fetch(inv.url.replace(inv.token, 'qa-no-such-token-0000'));
  assert.ok(badPage.status < 500, `join page with a bad token -> ${badPage.status}`);
  const kamran = await login('kamran', 'PRO');
  const denied = await expectApiError(() => kamran.c.call(api.company.createInvite, { params: { companyId: ctx.companyId }, body: {} } as any));
  assert.equal(denied.status, 403, `${denied.status} ${denied.code}`);
});

test('AU-P01 light latency: 20 sequential calls per endpoint, p95 < 800 ms, no 5xx', { timeout: 300_000 }, async () => {
  const report: string[] = [];
  const calls: [string, () => Promise<unknown>][] = [
    ['GET /health', () => raw('/health')],
    ['GET /config/public', () => raw('/config/public')],
    ['GET /categories', () => client().call(api.categories.list, { query: {} } as any)],
    ['GET /me', () => ctx.customer.c.call(api.me.get)],
    ['GET /requests', () => ctx.customer.c.call(api.requests.list, { query: {} } as any)],
    ['GET /wallet', () => ctx.customer.c.call(api.wallet.get)],
  ];
  for (const [name, fn] of calls) {
    const t: number[] = [];
    for (let i = 0; i < 20; i++) {
      const s = performance.now();
      const r: any = await fn();
      t.push(performance.now() - s);
      if (r instanceof Response) assert.ok(r.status < 500, `${name} -> ${r.status}`);
    }
    t.sort((a, b) => a - b);
    const p50 = t[9], p95 = t[18];
    report.push(`${name}: p50 ${p50.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms`);
    assert.ok(p95 < 800, `${name}: p95 ${p95.toFixed(0)} ms`);
  }
  console.log(report.join('\n'));
});
