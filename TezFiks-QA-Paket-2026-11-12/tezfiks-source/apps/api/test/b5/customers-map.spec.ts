import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, adminToken, createCompany, createCustomer, createSoloHandyman } from '../helpers/factories';
import { advance, createRequest, goOnline, seedRequest, setSettings } from './helpers';

describe('B5 admin customers and live map', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await setSettings(t, { minCandidates: 0 });
  });

  it('customers: list (newest first), type filter, tz_fold / phone / VÖEN search, paging; rows carry phone, counts and wallet', async () => {
    const nizami = await createCustomer(t, { firstName: 'Nizami', lastName: 'Talıbov', balance: 5000 });
    const ismayil = await createCustomer(t, { firstName: 'İsmayıl', lastName: 'Şükürov' });
    const kontur = await createCustomer(t, { type: 'COMPANY', companyName: 'Kontur MMC', voen: '9876543210', firstName: 'Aysel', lastName: 'Qasımova' });
    const day = Date.parse('2026-10-01T08:00:00.000Z');
    for (const [i, c] of [nizami, ismayil, kontur].entries()) {
      await t.prisma.customerAccount.update({ where: { id: c.accountId }, data: { createdAt: new Date(day + i * 60_000) } });
    }
    await t.prisma.user.update({ where: { id: ismayil.userId }, data: { status: 'BLOCKED' } });
    await seedRequest(t, nizami, { createdAt: new Date(day + 3_600_000) });
    await seedRequest(t, nizami, { createdAt: new Date(day + 7_200_000), status: 'CANCELLED' });
    const { token } = await adminToken(t, { role: 'OPERATOR' });
    const A = t.client(token);
    const ids = async (query: Record<string, unknown>) => (await A.call(api.admin.customers, { query })).items.map((i) => i.id);

    const all = await A.call(api.admin.customers);
    expect(all.items.map((i) => i.id)).toEqual([kontur.accountId, ismayil.accountId, nizami.accountId]);
    expect(all.items.find((i) => i.id === nizami.accountId)).toEqual({
      id: nizami.accountId,
      userId: nizami.userId,
      name: 'Nizami Talıbov',
      phone: nizami.phone,
      type: 'INDIVIDUAL',
      companyName: null,
      requestsCount: 2,
      walletBalance: 5000,
      ratingAvg: null,
      userStatus: 'ACTIVE',
      createdAt: new Date(day).toISOString(),
    });
    expect(all.items.find((i) => i.id === ismayil.accountId)).toMatchObject({ userStatus: 'BLOCKED', requestsCount: 0 });
    expect(all.items.find((i) => i.id === kontur.accountId)).toMatchObject({ type: 'COMPANY', companyName: 'Kontur MMC', name: 'Aysel Qasımova' });

    expect(await ids({ type: 'COMPANY' })).toEqual([kontur.accountId]);
    expect(await ids({ type: 'INDIVIDUAL' })).toEqual([ismayil.accountId, nizami.accountId]);
    expect(await ids({ q: 'ismayil sukurov' })).toEqual([ismayil.accountId]);
    expect(await ids({ q: 'TALIBOV' })).toEqual([nizami.accountId]);
    expect(await ids({ q: 'kontur' })).toEqual([kontur.accountId]);
    expect(await ids({ q: '98765432' })).toEqual([kontur.accountId]);
    const local = `0${nizami.phone.slice(4, 6)} ${nizami.phone.slice(6, 9)} ${nizami.phone.slice(9, 11)} ${nizami.phone.slice(11)}`;
    expect(await ids({ q: local })).toEqual([nizami.accountId]);
    expect(await ids({ q: 'qasimova', type: 'INDIVIDUAL' })).toEqual([]);

    const p1 = await A.call(api.admin.customers, { query: { limit: 2 } });
    expect(p1.items).toHaveLength(2);
    const p2 = await A.call(api.admin.customers, { query: { limit: 2, cursor: p1.nextCursor! } });
    expect(p2.items.map((i) => i.id)).toEqual([nizami.accountId]);
    expect(p2.nextCursor).toBeNull();
    await expect(A.call(api.admin.customers, { query: { cursor: 'eyJjIjoiMSJ9' } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('customer detail: row, wallet summary (debt shows), recent requests newest first; unknown id NOT_FOUND', async () => {
    const c = await createCustomer(t, { balance: 3000 });
    const r1 = await seedRequest(t, c, { createdAt: new Date(Date.parse('2026-10-02T08:00:00.000Z')) });
    const r2 = await seedRequest(t, c, { createdAt: new Date(Date.parse('2026-10-03T08:00:00.000Z')), status: 'EXPIRED' });
    const { token } = await adminToken(t);
    const d = await t.client(token).call(api.admin.customer, { params: { id: c.accountId } });
    expect(d.row).toMatchObject({ id: c.accountId, phone: c.phone, requestsCount: 2, walletBalance: 3000 });
    expect(d.wallet).toMatchObject({ accountId: c.walletAccountId, posted: 3000, held: 0, available: 3000, isDebt: false });
    expect(d.recentRequests.map((r) => r.id)).toEqual([r2.id, r1.id]);
    expect(d.recentRequests[0]).toMatchObject({ status: 'EXPIRED', customerName: 'Nizami Talıbov' });
    await expect(t.client(token).call(api.admin.customer, { params: { id: '0192f000-0000-7000-8000-000000000003' } })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    const user = await createCustomer(t);
    await expect(t.client(user.token).call(api.admin.customers)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('live map: online and busy handymen with presence positions, bots and companies flagged; searching requests with their cells', async () => {
    await setSettings(t, { minCandidates: 0, offerTtlSec: 300 });
    const h1 = await createSoloHandyman(t, { balance: 2000, firstName: 'Elvin' });
    const h2 = await createSoloHandyman(t, { balance: 2000, firstName: 'Samir', lastName: 'Quliyev' });
    const off = await createSoloHandyman(t, { balance: 2000, firstName: 'Oflayn' });
    const bot = await createSoloHandyman(t, { balance: 2000, firstName: 'Bot', base: BAKU.ahmadli, radiusKm: 2 });
    await t.prisma.handymanProfile.update({ where: { id: bot.handymanId }, data: { isBot: true } });
    const co = await createCompany(t, { workers: 1, trades: ['electrical'] });
    await goOnline(t, h1.handymanId, BAKU.narimanov);
    await goOnline(t, h2.handymanId, BAKU.center);
    await goOnline(t, bot.handymanId, BAKU.ahmadli);
    await goOnline(t, co.workers[0]!.handymanId, BAKU.center);
    const c = await createCustomer(t);
    const req = await createRequest(t, c);
    const { token } = await adminToken(t, { role: 'OPERATOR' });
    const A = t.client(token);

    let map = await A.call(api.admin.liveMap);
    expect(Date.parse(map.serverNow)).toBeGreaterThan(0);
    expect(map.handymen.map((h) => h.id).sort()).toEqual([h1.handymanId, h2.handymanId, bot.handymanId, co.workers[0]!.handymanId].sort());
    expect(map.handymen.find((h) => h.id === off.handymanId)).toBeUndefined();
    expect(map.handymen.find((h) => h.id === h1.handymanId)).toMatchObject({
      name: 'Elvin Məmmədov',
      lat: BAKU.narimanov.lat,
      lng: BAKU.narimanov.lng,
      isOnline: true,
      busy: false,
      isBot: false,
      companyName: null,
      cell7: latLngToCell(BAKU.narimanov.lat, BAKU.narimanov.lng, 7),
    });
    expect(map.handymen.find((h) => h.id === h1.handymanId)!.lastSeenAt).not.toBeNull();
    expect(map.handymen.find((h) => h.id === bot.handymanId)).toMatchObject({ isBot: true });
    expect(map.handymen.find((h) => h.id === co.workers[0]!.handymanId)).toMatchObject({ companyName: 'FixPro MMC' });
    // No phones on the map.
    expect(JSON.stringify(map)).not.toContain(h1.phone);

    const cell = latLngToCell(BAKU.center.lat, BAKU.center.lng, 7);
    let mr = map.requests.find((r) => r.id === req.id)!;
    expect(mr).toMatchObject({ number: req.number, status: 'SEARCHING', isSearching: true, timing: 'NOW', lat: BAKU.center.lat, lng: BAKU.center.lng });
    expect(mr.categoryName.length).toBeGreaterThan(0);
    expect(mr.cells).toContain(cell);
    const step0 = mr.cells.length;

    await advance(t, 31_000); // next ring
    map = await A.call(api.admin.liveMap);
    mr = map.requests.find((r) => r.id === req.id)!;
    expect(mr.cells.length).toBeGreaterThan(step0);
    expect(mr.cells).toContain(cell);

    // The pro accepts: busy on the map, the request is no longer searching (no cells).
    const offer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, handymanId: h2.handymanId } });
    await t.client(h2.token).call(api.pro.acceptOffer, { params: { id: offer.id } });
    map = await A.call(api.admin.liveMap);
    expect(map.handymen.find((h) => h.id === h2.handymanId)).toMatchObject({ busy: true });
    expect(map.handymen.find((h) => h.id === h1.handymanId)).toMatchObject({ busy: false });
    mr = map.requests.find((r) => r.id === req.id)!;
    expect(mr).toMatchObject({ status: 'ASSIGNED', isSearching: false, cells: [] });

    // Going offline while busy keeps the pro on the map (on a job).
    await t.prisma.handymanProfile.update({ where: { id: h2.handymanId }, data: { isOnline: false } });
    map = await A.call(api.admin.liveMap);
    expect(map.handymen.find((h) => h.id === h2.handymanId)).toMatchObject({ isOnline: false, busy: true });
  });
});
