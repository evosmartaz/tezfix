import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { latLngToCell } from 'h3-js';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, categoryId, createCompany, createCustomer, createSoloHandyman, type CreatedCustomer } from '../helpers/factories';
import { PresenceService } from '../../src/modules/realtime/presence.service';
import { onboardSolo, proUser } from './helpers';

/** A finished (or fee-captured) assignment for stats. */
async function assignment(
  t: TestApp,
  customer: CreatedCustomer,
  handymanId: string,
  data: { status: 'COMPLETED' | 'ACCEPTED'; acceptedAt: Date; completedAt?: Date; total?: number; feeCaptured?: boolean; feeRefunded?: boolean; companyId?: string },
): Promise<string> {
  const request = await t.prisma.serviceRequest.create({
    data: {
      customerAccountId: customer.accountId,
      createdByUserId: customer.userId,
      categoryId: await categoryId(t, 'plumbing'),
      vertical: 'HOME',
      description: 'Kran axır',
      timing: 'NOW',
      lat: BAKU.center.lat,
      lng: BAKU.center.lng,
      cell7: latLngToCell(BAKU.center.lat, BAKU.center.lng, 7),
      cell9: latLngToCell(BAKU.center.lat, BAKU.center.lng, 9),
      formatted: 'Nizami küçəsi 10',
      status: data.status === 'COMPLETED' ? 'COMPLETED' : 'ASSIGNED',
      isSearching: false,
    },
  });
  const slot = await t.prisma.requestSlot.create({ data: { requestId: request.id, index: 0, status: data.status === 'COMPLETED' ? 'DONE' : 'FILLED' } });
  const a = await t.prisma.assignment.create({
    data: {
      requestId: request.id,
      slotId: slot.id,
      providerType: data.companyId ? 'COMPANY' : 'SOLO',
      handymanId,
      companyId: data.companyId ?? null,
      acceptedByUserId: customer.userId,
      status: data.status,
      acceptedAt: data.acceptedAt,
      freeCancelUntil: new Date(data.acceptedAt.getTime() + 300_000),
      completedAt: data.completedAt ?? null,
      feeAmount: 1000n,
      feeCaptured: data.feeCaptured ?? false,
      feeRefunded: data.feeRefunded ?? false,
      laborAmount: data.total != null ? BigInt(data.total) : null,
      materialsAmount: data.total != null ? 0n : null,
      totalAmount: data.total != null ? BigInt(data.total) : null,
    },
  });
  return a.id;
}

describe('B2 online switch, location and today stats', () => {
  let t: TestApp;
  let presence: PresenceService;
  beforeAll(async () => {
    t = await createTestApp();
    presence = t.app.get(PresenceService);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    vi.restoreAllMocks();
  });

  it('an approved solo handyman goes online: DB flags committed before presence, then dispatchable', async () => {
    const h = await createSoloHandyman(t, { balance: 5000 });
    const seenByPresence: Array<{ isOnline: boolean; onlineSince: Date | null }> = [];
    const original = presence.setOnline.bind(presence);
    vi.spyOn(presence, 'setOnline').mockImplementation(async (id, loc) => {
      const row = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id } });
      seenByPresence.push({ isOnline: row.isOnline, onlineSince: row.onlineSince });
      return original(id, loc);
    });
    const now = t.clock.now();
    const res = await t.client(h.token).call(api.pro.setOnline, { body: { online: true, location: BAKU.narimanov } });
    expect(res).toEqual({ isOnline: true, warnings: [] });
    expect(seenByPresence).toHaveLength(1);
    expect(seenByPresence[0]!.isOnline).toBe(true);
    expect(seenByPresence[0]!.onlineSince!.getTime()).toBeGreaterThanOrEqual(now.getTime() - 5);

    const state = await presence.get(h.handymanId);
    expect(state).toMatchObject({ online: true, lat: BAKU.narimanov.lat, lng: BAKU.narimanov.lng });
    const cands = await presence.candidatesInCells([latLngToCell(BAKU.narimanov.lat, BAKU.narimanov.lng, 7)], 90);
    expect(cands.map((c) => c.handymanId)).toContain(h.handymanId);
    const profile = await t.client(h.token).call(api.pro.profile);
    expect(profile.profile?.isOnline).toBe(true);
  });

  it('going online again keeps onlineSince; going offline commits the DB flag before presence and removes the entry', async () => {
    const h = await createSoloHandyman(t, { balance: 5000 });
    await t.client(h.token).call(api.pro.setOnline, { body: { online: true } });
    const first = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: h.handymanId } });
    t.clock.advance(60_000);
    await t.client(h.token).call(api.pro.setOnline, { body: { online: true } });
    const second = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: h.handymanId } });
    expect(second.onlineSince!.getTime()).toBe(first.onlineSince!.getTime());

    const seen: boolean[] = [];
    const original = presence.setOffline.bind(presence);
    vi.spyOn(presence, 'setOffline').mockImplementation(async (id) => {
      seen.push((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id } })).isOnline);
      return original(id);
    });
    const res = await t.client(h.token).call(api.pro.setOnline, { body: { online: false } });
    expect(res).toEqual({ isOnline: false, warnings: [] });
    expect(seen).toEqual([false]);
    expect((await presence.get(h.handymanId))?.online ?? false).toBe(false);
    const cands = await presence.candidatesInCells([latLngToCell(BAKU.center.lat, BAKU.center.lng, 7)], 90);
    expect(cands.map((c) => c.handymanId)).not.toContain(h.handymanId);
  });

  it('warns LOW_BALANCE when the solo wallet cannot cover the request fee', async () => {
    const h = await createSoloHandyman(t, { balance: 999 });
    const res = await t.client(h.token).call(api.pro.setOnline, { body: { online: true } });
    expect(res).toEqual({ isOnline: true, warnings: ['LOW_BALANCE'] });
  });

  it('warns NO_TRADES when the profile has no trades', async () => {
    const h = await createSoloHandyman(t, { balance: 5000 });
    await t.prisma.handymanTrade.deleteMany({ where: { handymanId: h.handymanId } });
    const res = await t.client(h.token).call(api.pro.setOnline, { body: { online: true } });
    expect(res.warnings).toEqual(['NO_TRADES']);
  });

  it("company workers get COMPANY_LOW_BALANCE from the company's wallet and the dispatch board is told", async () => {
    const poor = await createCompany(t, { workers: 1, balance: 500 });
    const res = await t.client(poor.workers[0]!.token).call(api.pro.setOnline, { body: { online: true } });
    expect(res).toEqual({ isOnline: true, warnings: ['COMPANY_LOW_BALANCE'] });
    expect(t.realtime.sentTo(`company:${poor.companyId}`, 'company:workers')).toHaveLength(1);

    const rich = await createCompany(t, { workers: 1, balance: 5000 });
    const ok = await t.client(rich.workers[0]!.token).call(api.pro.setOnline, { body: { online: true } });
    expect(ok).toEqual({ isOnline: true, warnings: [] });
  });

  it('HANDYMAN_NOT_APPROVED unless APPROVED; going offline is always allowed', async () => {
    for (const status of ['DRAFT', 'PENDING_REVIEW', 'REJECTED', 'BLOCKED'] as const) {
      const h = await createSoloHandyman(t, { status, balance: 5000 });
      await expect(t.client(h.token).call(api.pro.setOnline, { body: { online: true } })).rejects.toMatchObject({
        code: 'HANDYMAN_NOT_APPROVED',
        status: 403,
      });
      expect(await t.client(h.token).call(api.pro.setOnline, { body: { online: false } })).toEqual({ isOnline: false, warnings: [] });
      expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: h.handymanId } })).isOnline).toBe(false);
    }
    const u = await proUser(t);
    await onboardSolo(t, u);
    await expect(t.client(u.token).call(api.pro.setOnline, { body: { online: true } })).rejects.toMatchObject({ code: 'HANDYMAN_NOT_APPROVED' });
  });

  it('COMPANY_NOT_APPROVED for workers of a blocked company', async () => {
    const c = await createCompany(t, { workers: 1, balance: 5000 });
    await t.prisma.company.update({ where: { id: c.companyId }, data: { status: 'BLOCKED' } });
    await expect(t.client(c.workers[0]!.token).call(api.pro.setOnline, { body: { online: true } })).rejects.toMatchObject({
      code: 'COMPANY_NOT_APPROVED',
      status: 403,
    });
  });

  it('NOT_FOUND without a handyman profile (online, location, stats)', async () => {
    const u = await proUser(t);
    const c = t.client(u.token);
    await expect(c.call(api.pro.setOnline, { body: { online: true } })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(c.call(api.pro.location, { body: BAKU.center })).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(c.call(api.pro.statsToday)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('location pings update the presence store', async () => {
    const h = await createSoloHandyman(t, { balance: 5000 });
    await t.client(h.token).call(api.pro.setOnline, { body: { online: true, location: BAKU.center } });
    expect(await t.client(h.token).call(api.pro.location, { body: { ...BAKU.ahmadli, heading: 90, accuracy: 8 } })).toEqual({ ok: true });
    expect(await presence.get(h.handymanId)).toMatchObject({ online: true, lat: BAKU.ahmadli.lat, lng: BAKU.ahmadli.lng, heading: 90 });
    await expect(t.client(h.token).call(api.pro.location, { body: { lat: 120, lng: 49 } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('statsToday counts the Baku day: completed jobs, their totals and captured fees', async () => {
    t.clock.set('2026-10-25T08:00:00.000Z'); // 12:00 in Baku
    const h = await createSoloHandyman(t, { balance: 5000 });
    const other = await createSoloHandyman(t, { balance: 5000 });
    const c = await createCustomer(t);
    const at = (s: string) => new Date(s);
    // 00:30 Baku today
    await assignment(t, c, h.handymanId, { status: 'COMPLETED', acceptedAt: at('2026-10-24T20:00:00Z'), completedAt: at('2026-10-24T20:30:00Z'), total: 4000, feeCaptured: true });
    // 11:00 Baku today
    await assignment(t, c, h.handymanId, { status: 'COMPLETED', acceptedAt: at('2026-10-25T06:00:00Z'), completedAt: at('2026-10-25T07:00:00Z'), total: 2500, feeCaptured: true });
    // 23:30 Baku yesterday
    await assignment(t, c, h.handymanId, { status: 'COMPLETED', acceptedAt: at('2026-10-24T19:00:00Z'), completedAt: at('2026-10-24T19:30:00Z'), total: 9900, feeCaptured: true });
    // accepted today, fee captured but refunded later -> not a fee
    await assignment(t, c, h.handymanId, { status: 'ACCEPTED', acceptedAt: at('2026-10-25T07:30:00Z'), feeCaptured: true, feeRefunded: true });
    // still active, fee captured today
    await assignment(t, c, h.handymanId, { status: 'ACCEPTED', acceptedAt: at('2026-10-25T07:40:00Z'), feeCaptured: true });
    // someone else's job
    await assignment(t, c, other.handymanId, { status: 'COMPLETED', acceptedAt: at('2026-10-25T06:00:00Z'), completedAt: at('2026-10-25T07:00:00Z'), total: 7000, feeCaptured: true });

    const stats = await t.client(h.token).call(api.pro.statsToday);
    expect(stats).toEqual({ date: '2026-10-25', jobs: 2, earnings: 6500, fees: 3000 });
  });
  it('statsToday never shows company workers company money: no company fees, prices only when the worker enters them', async () => {
    t.clock.set('2026-10-25T08:00:00.000Z'); // 12:00 in Baku
    const c = await createCustomer(t);
    const at = (s: string) => new Date(s);
    const jobs = async (companyId: string, handymanId: string) => {
      await assignment(t, c, handymanId, { status: 'COMPLETED', acceptedAt: at('2026-10-25T06:00:00Z'), completedAt: at('2026-10-25T07:00:00Z'), total: 4000, feeCaptured: true, companyId });
      await assignment(t, c, handymanId, { status: 'COMPLETED', acceptedAt: at('2026-10-25T06:10:00Z'), completedAt: at('2026-10-25T07:10:00Z'), total: 2500, feeCaptured: true, companyId });
      await assignment(t, c, handymanId, { status: 'ACCEPTED', acceptedAt: at('2026-10-25T07:40:00Z'), feeCaptured: true, companyId });
    };

    // the manager enters the final price: the worker never sees prices nor the company's captured fees
    const managerPriced = await createCompany(t, { workers: 1, balance: 5000, finalPriceEntry: 'MANAGER' });
    const mw = managerPriced.workers[0]!;
    await jobs(managerPriced.companyId, mw.handymanId);
    expect(await t.client(mw.token).call(api.pro.statsToday)).toEqual({ date: '2026-10-25', jobs: 2, earnings: 0, fees: 0 });

    // the worker enters the final price: their own job totals are shown, the company's fees still are not
    const workerPriced = await createCompany(t, { workers: 1, balance: 5000, finalPriceEntry: 'WORKER' });
    const ww = workerPriced.workers[0]!;
    await jobs(workerPriced.companyId, ww.handymanId);
    expect(await t.client(ww.token).call(api.pro.statsToday)).toEqual({ date: '2026-10-25', jobs: 2, earnings: 6500, fees: 0 });

    // switching the company setting to MANAGER hides the totals again
    await t.prisma.company.update({ where: { id: workerPriced.companyId }, data: { finalPriceEntry: 'MANAGER' } });
    expect(await t.client(ww.token).call(api.pro.statsToday)).toEqual({ date: '2026-10-25', jobs: 2, earnings: 0, fees: 0 });
  });

  it('a block committed while going online never leaves the handyman online in the DB or the presence store', async () => {
    const h = await createSoloHandyman(t, { balance: 5000 });
    const original = presence.setOnline.bind(presence);
    vi.spyOn(presence, 'setOnline').mockImplementationOnce(async (id, loc) => {
      // an admin block commits (and runs its forceOffline) between the DB update and the presence write
      await t.prisma.handymanProfile.update({ where: { id }, data: { status: 'BLOCKED', isOnline: false } });
      await presence.setOffline(id);
      return original(id, loc);
    });
    await expect(t.client(h.token).call(api.pro.setOnline, { body: { online: true, location: BAKU.center } })).rejects.toMatchObject({
      code: 'HANDYMAN_NOT_APPROVED',
      status: 403,
    });
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: h.handymanId } })).isOnline).toBe(false);
    expect((await presence.get(h.handymanId))?.online ?? false).toBe(false);
    const cands = await presence.candidatesInCells([latLngToCell(BAKU.center.lat, BAKU.center.lng, 7)], 90);
    expect(cands.map((x) => x.handymanId)).not.toContain(h.handymanId);
  });

  it('a worker removed from the company while going online is refused and stays offline', async () => {
    const co = await createCompany(t, { workers: 1, balance: 5000 });
    const w = co.workers[0]!;
    const original = presence.setOnline.bind(presence);
    vi.spyOn(presence, 'setOnline').mockImplementationOnce(async (id, loc) => {
      await t.prisma.handymanProfile.update({ where: { id }, data: { companyId: null, status: 'DRAFT', isOnline: false } });
      await presence.setOffline(id);
      return original(id, loc);
    });
    await expect(t.client(w.token).call(api.pro.setOnline, { body: { online: true } })).rejects.toMatchObject({ status: 403 });
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: w.handymanId } })).isOnline).toBe(false);
    expect((await presence.get(w.handymanId))?.online ?? false).toBe(false);
  });
});
