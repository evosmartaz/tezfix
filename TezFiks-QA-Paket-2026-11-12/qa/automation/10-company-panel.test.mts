// AU-N07..N12 + AU-M03: company panel in a real browser (playwright-core driving the installed Chrome).
// Login through the UI with Rauf's phone (OTP 123456), then every company page in az / ru / en and at 390 px.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { api, login, PANEL, OTP, waitFor } from './lib.mts';
import { plumbingCategoryId, createRequest, cancelOpenRequests } from './flows.mts';

let browser: Browser;
let bctx: BrowserContext;
let page: Page;
const ctx: any = { consoleErrors: [] as string[], serverErrors: [] as string[] };
const SHOTS = new URL('./results/screens/', import.meta.url);

before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  bctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'az-AZ' });
  page = await bctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') ctx.consoleErrors.push(`${page.url()} :: ${m.text().slice(0, 200)}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 500) ctx.serverErrors.push(`${r.status()} ${r.url()}`);
  });
});

after(async () => {
  if (ctx.customer) await cancelOpenRequests(ctx.customer).catch(() => undefined);
  await browser?.close();
});

async function shot(name: string) {
  const { mkdirSync } = await import('node:fs');
  mkdirSync(SHOTS, { recursive: true });
  const { fileURLToPath } = await import('node:url');
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, SHOTS)), fullPage: true });
}

test('AU-N07a company panel OTP login through the UI lands on the company dashboard', { timeout: 90_000 }, async () => {
  const rauf = await login('rauf', 'PRO');
  ctx.companyId = ((await rauf.c.call(api.pro.profile)) as any).managedCompanies[0].id;
  await page.goto(`${PANEL}/company/login`);
  await page.fill('#phone', '50 200 00 11');
  await page.locator('form button[type=submit]').click();
  await page.waitForSelector('#otp', { timeout: 20_000 });
  await page.fill('#otp', OTP);
  await page.waitForURL((u) => u.pathname.includes(`/company/${ctx.companyId}`), { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  await shot('N07-dashboard');
});

test('AU-M03 panel session cookies are httpOnly, Secure and scoped to /tezfix', async () => {
  const cookies = await bctx.cookies();
  for (const name of ['tf_at', 'tf_rt', 'tf_kind']) {
    const c = cookies.find((x) => x.name === name);
    assert.ok(c, `cookie ${name} missing`);
    assert.equal(c.httpOnly, true, `${name} not httpOnly`);
    assert.equal(c.secure, true, `${name} not Secure`);
    assert.equal(c.path, '/tezfix', `${name} path ${c.path}`);
  }
  const tokenInJs = await page.evaluate(() => document.cookie);
  assert.ok(!/tf_at|tf_rt/.test(tokenInJs), 'tokens readable from JavaScript');
});

const PAGES = ['', '/dispatch', '/orders', '/workers', '/balance', '/projects', '/settings'];

test('AU-N08 every company page loads without 5xx or console errors', { timeout: 180_000 }, async () => {
  const bad: string[] = [];
  for (const p of PAGES) {
    const before = ctx.consoleErrors.length;
    const r = await page.goto(`${PANEL}/company/${ctx.companyId}${p}`);
    await page.waitForLoadState('networkidle');
    if (!r || r.status() >= 400) bad.push(`${p || '/'} -> ${r?.status()}`);
    const body = await page.locator('body').innerText();
    if (/Application error|Internal Server Error|Something went wrong/i.test(body)) bad.push(`${p || '/'}: error page`);
    if (ctx.consoleErrors.length > before) bad.push(`${p || '/'}: console ${ctx.consoleErrors.slice(before).join(' | ')}`);
    await shot(`N08${p.replace('/', '-') || '-home'}`);
  }
  assert.deepEqual(ctx.serverErrors, [], '5xx responses');
  assert.deepEqual(bad, []);
});

test('AU-N07b a COMPANY request appears on the dispatch board in real time', { timeout: 150_000 }, async () => {
  ctx.customer = await login('demo', 'CUSTOMER');
  const elvin = await login('elvin', 'PRO');
  const tural = await login('tural', 'PRO');
  await tural.c.call(api.pro.setOnline, { body: { online: true, location: { lat: 40.3777, lng: 49.8531 } } });
  await page.goto(`${PANEL}/company/${ctx.companyId}/dispatch`);
  await page.waitForLoadState('networkidle');
  const cat = await plumbingCategoryId(elvin);
  const r: any = await createRequest(ctx.customer, cat, { providerPreference: 'COMPANY' });
  const number = String(r.number);
  await waitFor(async () => (await page.locator('body').innerText()).includes(number), 60_000, 1_000).catch(async () => {
    await shot('N07b-dispatch-missing');
    throw new Error(`request #${number} did not appear on the dispatch board without a reload`);
  });
  await shot('N07b-dispatch-offer');
  await ctx.customer.c.call(api.requests.cancel, { params: { id: r.id }, body: { reason: 'QA cleanup' } } as any);
  await tural.c.call(api.pro.setOnline, { body: { online: false } });
});

test('AU-N09 another company id in the URL is refused', async () => {
  const fake = '01a00000-0000-7000-8000-000000000000';
  const r = await page.goto(`${PANEL}/company/${fake}`);
  await page.waitForLoadState('networkidle');
  const body = await page.locator('body').innerText();
  const url = new URL(page.url());
  const refused = (r?.status() ?? 200) >= 400 || !url.pathname.includes(fake) || /tapılmadı|not found|icazə|forbidden|404|403/i.test(body);
  await shot('N09-foreign-company');
  assert.ok(refused, `foreign company page rendered: ${url.pathname}`);
  assert.ok(!body.includes('FixPro') || !url.pathname.includes(fake), 'FixPro data shown under a foreign id');
});

test('AU-N10 language switch az / ru / en: no raw translation keys on any page', { timeout: 240_000 }, async () => {
  const bad: string[] = [];
  const host = new URL(PANEL).hostname;
  for (const locale of ['ru', 'en', 'az']) {
    await bctx.addCookies([{ name: 'locale', value: locale, domain: host, path: '/tezfix' }]);
    for (const p of PAGES) {
      await page.goto(`${PANEL}/company/${ctx.companyId}${p}`);
      await page.waitForLoadState('networkidle');
      const text = await page.locator('body').innerText();
      const keys = text.match(/\b(panel|common|errors|fields)\.[a-zA-Z]+(\.[a-zA-Z]+)*\b/g);
      if (keys) bad.push(`${locale} ${p || '/'}: ${[...new Set(keys)].join(', ')}`);
      if (locale === 'ru' && !/[А-Яа-я]/.test(text)) bad.push(`ru ${p || '/'}: no Cyrillic text`);
      if (locale === 'en' && /\b(Sifarişlər|Balans artır|Ustalar|Tənzimləmələr)\b/.test(text)) bad.push(`en ${p || '/'}: Azerbaijani menu text`);
    }
    await shot(`N10-${locale}`);
  }
  assert.deepEqual(bad, []);
});

test('AU-N11 mobile width 390 px: no horizontal scroll, menu opens', { timeout: 180_000 }, async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  const bad: string[] = [];
  for (const p of PAGES) {
    await page.goto(`${PANEL}/company/${ctx.companyId}${p}`);
    await page.waitForLoadState('networkidle');
    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    if (sw > iw + 1) bad.push(`${p || '/'}: scrollWidth ${sw} > ${iw}`);
    await shot(`N11-mobile${p.replace('/', '-') || '-home'}`);
  }
  const menu = page.locator('button[aria-label*="enyu" i], button[aria-label*="menu" i], button[aria-label*="меню" i]').first();
  if (await menu.count()) {
    await menu.click();
    await page.waitForTimeout(500);
    await shot('N11-mobile-menu-open');
    assert.ok(await page.locator('nav a, [role=dialog] a').count() > 3, 'mobile menu shows no links');
  } else {
    bad.push('no menu button found at 390 px');
  }
  await page.setViewportSize({ width: 1366, height: 860 });
  assert.deepEqual(bad, []);
});

/** Socket.IO (EIO 4) handshake over long-polling with a ticket; resolves 'ok' or the server's error message. */
async function socketConnect(ticket: string): Promise<string> {
  const base = `${new URL(PANEL).origin}/tezfix/api/socket.io/?EIO=4&transport=polling`;
  const open = await (await fetch(`${base}&t=${Date.now()}`)).text();
  const sid = JSON.parse(open.slice(1)).sid;
  await fetch(`${base}&sid=${sid}`, { method: 'POST', body: `40${JSON.stringify({ ticket })}`, headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });
  const reply = await (await fetch(`${base}&sid=${sid}&t=${Date.now()}`)).text();
  if (reply.includes('40{"sid"')) return 'ok';
  return reply.slice(0, 160);
}

test('AU-M06 panel socket ticket: works once, refused when reused or older than 60 s, needs the session cookie', { timeout: 150_000 }, async () => {
  const url = `${PANEL}/bff/realtime-ticket`;
  const anon = await fetch(url, { method: 'POST' });
  assert.equal(anon.status, 401, `ticket without a session -> ${anon.status}`);
  const t1 = await (await page.request.post(url)).json();
  assert.ok(t1.ticket, `no ticket: ${JSON.stringify(t1)}`);
  assert.equal(await socketConnect(t1.ticket), 'ok', 'fresh ticket refused');
  const reuse = await socketConnect(t1.ticket);
  assert.notEqual(reuse, 'ok', 'a ticket could be used twice');
  const t2 = await (await page.request.post(url)).json();
  await new Promise((r) => setTimeout(r, 65_000));
  const late = await socketConnect(t2.ticket);
  assert.notEqual(late, 'ok', 'a 65-second-old ticket was accepted');
  console.log(`reuse -> ${reuse}\nlate -> ${late}`);
});

test('AU-P02 company pages load fast: DOMContentLoaded < 2.5 s, load < 4 s, transfer < 3 MB', { timeout: 180_000 }, async () => {
  const rows: string[] = [];
  const bad: string[] = [];
  for (const p of PAGES) {
    await page.goto(`${PANEL}/company/${ctx.companyId}${p}`, { waitUntil: 'load' });
    const m = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      const bytes = performance.getEntriesByType('resource').reduce((s, r: any) => s + (r.transferSize || 0), n.transferSize || 0);
      return { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, bytes };
    });
    rows.push(`${p || '/'}: DCL ${m.dcl.toFixed(0)} ms, load ${m.load.toFixed(0)} ms, ${(m.bytes / 1024).toFixed(0)} KB`);
    if (m.dcl > 2500 || m.load > 4000 || m.bytes > 3 * 1024 * 1024) bad.push(rows.at(-1)!);
  }
  console.log(rows.join('\n'));
  assert.deepEqual(bad, []);
});

test('AU-N12 join page in the browser: invalid token shows a clear message, not an error page', { timeout: 60_000 }, async () => {
  const r = await page.goto(`${PANEL}/join/qa-no-such-token-0000`);
  await page.waitForLoadState('networkidle');
  const body = await page.locator('body').innerText();
  await shot('N12-join-invalid');
  assert.ok((r?.status() ?? 0) < 500, `status ${r?.status()}`);
  assert.ok(!/Application error|Internal Server Error/i.test(body), 'error page');
  assert.ok(body.trim().length > 20, 'empty page');
});
