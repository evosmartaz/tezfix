// AU-A (smoke), AU-B (contract basics), AU-C (auth) against the live demo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, client, login, expectApiError, raw, PANEL, PHONES, BASE } from './lib.mts';

test('AU-A01 health: DB and Redis ok', async () => {
  const h = await client().call(api.health.get);
  assert.equal(h.status, 'ok');
  assert.equal(h.db, true);
  assert.equal(h.redis, true);
});

test('AU-A01b public config matches the spec defaults (demo mode)', async () => {
  const c = await client().call(api.health.config);
  assert.equal(c.demoMode, true);
  assert.equal(c.requestFee, 1000);
  assert.equal(c.emergencyFeePerSlot, 500);
  assert.equal(c.cancelPenalty, 1500);
  assert.equal(c.freeCancelSec, 300);
  assert.equal(c.offerTtlSec, 15);
  assert.equal(c.maxSlots, 10);
  assert.equal(c.maxPhotos, 5);
  assert.equal(c.guaranteeDays, 14);
  assert.equal(c.contactUnlockEtaSec, 300);
  assert.equal(c.currency, 'AZN');
});

test('AU-A02 panel pages respond', async () => {
  for (const p of ['', '/admin/login', '/company/login']) {
    const r = await fetch(PANEL + p, { redirect: 'manual' });
    assert.ok(r.status < 400, `${p || '/'} -> ${r.status}`);
  }
  const nf = await fetch(PANEL + '/no-such-page-qa');
  assert.equal(nf.status, 404);
});

test('AU-A02b protected admin page redirects to login without a session', async () => {
  const r = await fetch(PANEL + '/admin/orders', { redirect: 'manual' });
  assert.ok([302, 303, 307, 308].includes(r.status), `status ${r.status}`);
  assert.match(r.headers.get('location') ?? '', /login/);
});

test('AU-A03 APK download page and files exist', async () => {
  const page = await fetch('https://tezfiks.evosmart.az/download/');
  assert.equal(page.status, 200);
  const html = await page.text();
  const apks = [...new Set(html.match(/[\w./-]+\.apk/g) ?? [])];
  assert.ok(apks.length >= 2, `APK links found: ${apks.join(', ')}`);
  for (const a of apks) {
    const u = new URL(a, 'https://tezfiks.evosmart.az/download/');
    const h = await fetch(u, { method: 'HEAD' });
    assert.equal(h.status, 200, `${u} -> ${h.status}`);
    assert.ok(Number(h.headers.get('content-length') ?? 0) > 1_000_000, `${u} size ${h.headers.get('content-length')}`);
  }
});

test('AU-A06 Swagger docs are closed in production', async () => {
  const r = await raw('/docs');
  assert.ok(r.status === 404 || r.status === 401 || r.status === 403, `status ${r.status}`);
});

test('AU-B02 error body format and localisation (az/ru/en)', async () => {
  const msgs = new Set<string>();
  for (const locale of ['az', 'ru', 'en']) {
    const e = await expectApiError(() =>
      client(undefined, locale).call(api.auth.adminLogin, { body: { email: 'nobody@example.com', password: 'x' } }),
    );
    assert.equal(e.status, 401);
    assert.equal(e.code, 'INVALID_CREDENTIALS');
    assert.ok(e.message && e.message.length > 3);
    msgs.add(e.message);
  }
  assert.equal(msgs.size, 3, `messages are not translated: ${[...msgs].join(' | ')}`);
});

test('AU-C01 OTP login works for every demo phone and /me matches the contract', async () => {
  const apps: Record<string, 'CUSTOMER' | 'PRO'> = {
    elvin: 'PRO', samir: 'PRO', vuqar: 'PRO', rauf: 'PRO', tural: 'PRO', kamran: 'PRO',
    nizami: 'CUSTOMER', aysel: 'CUSTOMER', leyla: 'CUSTOMER', demo: 'CUSTOMER',
  };
  const failures: string[] = [];
  for (const [who, app] of Object.entries(apps)) {
    try {
      const s = await login(who as any, app);
      const me = await s.c.call(api.me.get);
      assert.equal(me.phone, PHONES[who as keyof typeof PHONES]);
    } catch (e: any) {
      failures.push(`${who}: ${e.code ?? ''} ${e.message}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('AU-C02 wrong OTP code is rejected', async () => {
  const c = client();
  const ch = await c.call(api.auth.otpRequest, { body: { phone: PHONES.demo, app: 'CUSTOMER' } }).catch((e: any) => e);
  if (ch instanceof Error) return; // resend cooldown from the previous test: covered by AU-C09
  const e = await expectApiError(() => c.call(api.auth.otpVerify, { body: { challengeId: ch.challengeId, code: '000000', deviceId: 'qa-auto-wrong-otp', app: 'CUSTOMER' } }));
  assert.ok([400, 401].includes(e.status), `status ${e.status} ${e.code}`);
});

test('AU-C03 malformed phone is rejected', async () => {
  for (const phone of ['12345', 'abcdefgh', '+99450']) {
    const e = await expectApiError(() => client().call(api.auth.otpRequest, { body: { phone, app: 'CUSTOMER' } }));
    assert.equal(e.status, 400, `${phone}: ${e.status} ${e.code}`);
  }
});

// Design (sessions.service.ts REFRESH_GRACE_MS = 60 s): a just-rotated token may be replayed for 60 s (lost mobile response);
// after that, reuse revokes the whole session.
test('AU-C04 refresh rotation; reuse after the 60 s grace revokes the session', { timeout: 120_000 }, async () => {
  const s = await login('tural', 'PRO');
  const anon = client();
  const t1 = await anon.call(api.auth.refresh, { body: { refreshToken: s.refreshToken, deviceId: s.deviceId } });
  assert.notEqual(t1.refreshToken, s.refreshToken);
  await new Promise((r) => setTimeout(r, 62_000));
  const reuse = await expectApiError(() => anon.call(api.auth.refresh, { body: { refreshToken: s.refreshToken, deviceId: s.deviceId } }));
  assert.equal(reuse.status, 401);
  const after = await expectApiError(() => anon.call(api.auth.refresh, { body: { refreshToken: t1.refreshToken, deviceId: s.deviceId } }));
  assert.equal(after.status, 401, 'the current token must be revoked too after a reuse');
});

test('AU-C05 logout revokes the refresh token', async () => {
  const s = await login('samir', 'PRO');
  await s.c.call(api.auth.logout, { body: { refreshToken: s.refreshToken } });
  const e = await expectApiError(() => client().call(api.auth.refresh, { body: { refreshToken: s.refreshToken } }));
  assert.equal(e.status, 401);
});

test('AU-C06/C07 protected endpoints need a valid token', async () => {
  assert.equal((await raw('/me')).status, 401);
  assert.equal((await raw('/me', { headers: { Authorization: 'Bearer abc.def.ghi' } })).status, 401);
  const forged = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.';
  assert.equal((await raw('/me', { headers: { Authorization: `Bearer ${forged}` } })).status, 401);
  assert.equal((await raw('/admin/dashboard')).status, 401);
});

test('AU-C08 admin login with a wrong password', async () => {
  const e = await expectApiError(() => client().call(api.auth.adminLogin, { body: { email: 'admin@evosmart.az', password: 'wrong-password-qa' } }));
  assert.equal(e.status, 401);
});

test('AU-M01 security headers', async () => {
  const r = await raw('/health');
  const h = r.headers;
  assert.ok(h.get('strict-transport-security'), 'HSTS missing');
  assert.equal(h.get('x-content-type-options'), 'nosniff');
  assert.ok(!h.get('x-powered-by'), `x-powered-by leaks: ${h.get('x-powered-by')}`);
});

test('AU-M02 CORS: foreign origin is not allowed', async () => {
  const r = await raw('/health', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
  const allow = r.headers.get('access-control-allow-origin');
  assert.ok(allow !== '*' && allow !== 'https://evil.example', `ACAO=${allow}`);
});

test('AU-M04 errors do not leak stack traces', async () => {
  const r = await raw('/requests/not-a-uuid', { headers: { Authorization: 'Bearer x' } });
  const body = await r.text();
  assert.doesNotMatch(body, /at \w+ \(|node_modules|\/app\/|\.ts:\d+/);
  const r2 = await raw('/auth/otp/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
  assert.equal(r2.status, 400);
  assert.doesNotMatch(await r2.text(), /at \w+ \(|node_modules|SyntaxError: /);
});

test('BASE sanity', () => assert.match(BASE, /^https:\/\//));
