// AU-K01..K06, AU-H05, AU-D08: input validation, uploads (size, type, metadata stripping), signed URLs.
// Runs as Leyla (company customer) and Aysel so it does not disturb the Elvin / Demo Müştəri flows.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { api, login, expectApiError, BASE } from './lib.mts';
import { ADDRESS, cancelOpenRequests } from './flows.mts';

const ctx: any = {};
after(async () => {
  if (ctx.leyla) await cancelOpenRequests(ctx.leyla);
});

function crc32(buf: Buffer) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Inserts a tEXt chunk with a marker right after IHDR (stands in for EXIF/GPS metadata). */
function pngWithMarker(png: Buffer, marker: string) {
  const data = Buffer.from(`Comment\0${marker}`, 'latin1');
  const type = Buffer.from('tEXt');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  const ihdrEnd = 8 + 4 + 4 + 13 + 4;
  return Buffer.concat([png.subarray(0, ihdrEnd), len, type, data, crc, png.subarray(ihdrEnd)]);
}
/** A valid but large PNG (random noise compresses badly) of roughly `mb` megabytes. */
function bigPng(mb: number) {
  const w = 2000, h = Math.ceil((mb * 1024 * 1024) / (w * 3));
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let i = 0; i < raw.length; i++) raw[i] = (i % (w * 3 + 1)) === 0 ? 0 : (Math.random() * 256) | 0;
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(t), d])));
    return Buffer.concat([len, Buffer.from(t), d, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))]);
}
async function upload(s: any, bytes: Buffer, name: string, type: string, kind = 'REQUEST_PHOTO') {
  const fd = new FormData();
  fd.append('kind', kind);
  fd.append('file', new Blob([bytes], { type }), name);
  const r = await fetch(`${BASE}/files`, { method: 'POST', headers: { Authorization: `Bearer ${s.token}` }, body: fd });
  return { status: r.status, body: await r.json().catch(() => null) };
}

test('setup', async () => {
  ctx.leyla = await login('leyla', 'CUSTOMER');
  ctx.aysel = await login('aysel', 'CUSTOMER');
  const cats: any = await ctx.leyla.c.call(api.categories.list, { query: {} } as any);
  ctx.instant = cats.items.find((c: any) => c.kind === 'SERVICE' && c.flow === 'INSTANT');
  assert.ok(ctx.instant, 'no INSTANT service category');
  ctx.png = readFileSync(new URL('../../tezfiks-source/apps/customer/assets/splash-icon.png', import.meta.url));
});

const base = () => ({ categoryId: ctx.instant.id, description: 'QA validation test', timing: 'NOW', slots: 1, address: ADDRESS });
async function badRequest(body: any) {
  return expectApiError(() => ctx.leyla.c.call(api.requests.create, { body } as any));
}

test('AU-K01 request validation: description, slots, schedule, location, photos', async () => {
  const cases: Array<[string, any]> = [
    ['empty description', { ...base(), description: '  ' }],
    ['description > 2000', { ...base(), description: 'x'.repeat(2001) }],
    ['11 slots (maxSlots 10)', { ...base(), slots: 11 }],
    ['0 slots', { ...base(), slots: 0 }],
    ['scheduled without date', { ...base(), timing: 'SCHEDULED' }],
    ['scheduled in the past', { ...base(), timing: 'SCHEDULED', scheduledAt: new Date(Date.now() - 3600_000).toISOString() }],
    ['scheduled too soon (< 2 min demo lead)', { ...base(), timing: 'SCHEDULED', scheduledAt: new Date(Date.now() + 30_000).toISOString() }],
    ['6 photos (maxPhotos 5)', { ...base(), photoFileIds: Array.from({ length: 6 }, (_, i) => `0190000${i}-0000-7000-8000-000000000000`) }],
    ['unknown category', { ...base(), categoryId: '01900000-0000-7000-8000-000000000000' }],
  ];
  const accepted: string[] = [];
  for (const [name, body] of cases) {
    const e: any = await badRequest(body).catch((err: any) => ({ status: 201, code: 'CREATED', err }));
    if (e.status === 201 || e.status >= 500) accepted.push(`${name}: ${e.status} ${e.code}`);
  }
  assert.deepEqual(accepted, []);
});

test('AU-K02 chat message length limits', async () => {
  const fake = '01900000-0000-7000-8000-000000000000';
  const e1 = await expectApiError(() => ctx.aysel.c.call(api.chat.send, { params: { id: fake }, body: { body: 'x'.repeat(1001) } } as any));
  assert.equal(e1.status, 400);
  const e2 = await expectApiError(() => ctx.aysel.c.call(api.chat.send, { params: { id: fake }, body: { body: '   ' } } as any));
  assert.equal(e2.status, 400);
});

test('AU-H05 top-up amount validation', async () => {
  for (const amount of [0, -100, 50, 100.5, 100_001]) {
    const e = await expectApiError(() => ctx.aysel.c.call(api.wallet.topup, { body: { amount } } as any));
    assert.equal(e.status, 400, `amount ${amount}: ${e.status} ${e.code}`);
  }
});

test('AU-K05 profile: XSS text is stored as plain text, length limits enforced', async () => {
  const me0: any = await ctx.aysel.c.call(api.me.get);
  const xss = '<img src=x onerror=alert(1)>';
  try {
    const r: any = await ctx.aysel.c.call(api.me.update, { body: { lastName: xss } } as any).catch((e: any) => e);
    if (!(r instanceof Error)) assert.equal(r.lastName, xss, 'stored verbatim (the UI must escape it)');
    const e = await expectApiError(() => ctx.aysel.c.call(api.me.update, { body: { firstName: 'x'.repeat(61) } } as any));
    assert.equal(e.status, 400);
  } finally {
    await ctx.aysel.c.call(api.me.update, { body: { firstName: me0.firstName, lastName: me0.lastName } } as any);
  }
});

test('AU-K06 search inputs with SQL meta characters do not break the API', async () => {
  for (const q of ["' OR 1=1 --", '%', '"; DROP TABLE x;']) {
    const r = await fetch(`${BASE}/geo/autocomplete?q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${ctx.aysel.token}` } });
    assert.ok(r.status < 500, `geo autocomplete "${q}" -> ${r.status}`);
  }
  const r2 = await fetch(`${BASE}/requests?cursor=${encodeURIComponent("' OR 1=1 --")}`, { headers: { Authorization: `Bearer ${ctx.aysel.token}` } });
  assert.ok(r2.status < 500, `requests cursor -> ${r2.status}`);
});

test('AU-K03/K04 uploads: valid image ok and re-encoded without metadata; > 8 MB and non-images refused', { timeout: 120_000 }, async () => {
  const marker = 'QAMETAMARKER-GPS-40.3777-49.8531';
  const ok = await upload(ctx.aysel, pngWithMarker(ctx.png, marker), 'qa.png', 'image/png');
  assert.ok(ok.status === 200 || ok.status === 201, `valid PNG -> ${ok.status} ${JSON.stringify(ok.body)}`);
  const url = new URL(ok.body.url, BASE);
  const img = Buffer.from(await (await fetch(url)).arrayBuffer());
  assert.ok(img.length > 0, 'signed URL returns the file');
  assert.ok(!img.toString('latin1').includes('QAMETAMARKER'), 'metadata was not stripped');
  // AU-D08: a tampered signature is refused.
  const bad = new URL(url);
  bad.searchParams.set('sig', 'tampered');
  assert.ok([401, 403].includes((await fetch(bad)).status), 'tampered signed URL accepted');
  const pdf = await upload(ctx.aysel, Buffer.from('%PDF-1.4\n%QA\n'), 'qa.jpg', 'image/jpeg');
  assert.ok(pdf.status === 400 || pdf.status === 415, `PDF disguised as JPEG -> ${pdf.status}`);
  const exe = await upload(ctx.aysel, Buffer.from('MZ\x90\x00QA'), 'qa.exe', 'application/octet-stream');
  assert.ok(exe.status === 400 || exe.status === 415, `exe -> ${exe.status}`);
  const big = await upload(ctx.aysel, bigPng(9), 'big.png', 'image/png');
  assert.ok(big.status === 413 || big.status === 400, `9 MB PNG -> ${big.status}`);
  const kyc = await upload(ctx.aysel, ctx.png, 'kyc.png', 'image/png', 'KYC_ID_FRONT');
  if (kyc.status === 200 || kyc.status === 201) {
    const r = await fetch(new URL(kyc.body.url ?? '', BASE));
    assert.ok([401, 403, 404].includes(r.status) || !kyc.body.url, 'KYC file readable through its own signed URL by a customer');
  }
});

// Spec 12: "Signed URLs (HMAC, 10 minutes)". Non-KYC URLs may be rounded to a 5-minute bucket for caching.
test('AU-D08b signed file URLs expire within ~10 minutes (spec 12)', async () => {
  const r: any = await ctx.aysel.c.call(api.me.get);
  const url = JSON.stringify(r).match(/files\/[0-9a-f-]+\?exp=(\d+)/);
  const ok = url ?? (await upload(ctx.aysel, ctx.png, 'ttl.png', 'image/png')).body.url.match(/exp=(\d+)/);
  const minutes = (Number(ok[1]) * 1000 - Date.now()) / 60000;
  assert.ok(minutes <= 15, `signed URL valid for ${minutes.toFixed(0)} min, spec says 10`);
});

// Not in the spec: the market is Baku -> Azerbaijan -> world. Recorded as a question for the developer, not a failure.
test('AU-K01b (question) a request far outside Azerbaijan is accepted', async (t) => {
  const r: any = await ctx.leyla.c.call(api.requests.create, { body: { ...base(), address: { ...ADDRESS, lat: 51.5, lng: -0.12 } } } as any).catch((e: any) => e);
  const created = !(r instanceof Error);
  t.diagnostic(created ? 'QUESTION: London request was accepted (status ' + (r.request ?? r).status + ')' : 'refused: ' + r.code);
  if (created) await ctx.leyla.c.call(api.requests.cancel, { params: { id: (r.request ?? r).id }, body: { reason: 'QA cleanup' } } as any);
});
