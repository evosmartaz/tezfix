import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { adminToken, createCompany, createCustomer, createSoloHandyman } from '../helpers/factories';
import { seedAssignment, seedRequest } from './helpers';

/** Baku local time (UTC+4) -> Date. */
const baku = (local: string) => new Date(`${local}+04:00`);

describe('B5 admin dashboard KPIs (Baku days, bots excluded)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });

  it('computes every KPI from seeded data', async () => {
    t.clock.set(baku('2026-10-25T10:00:00.000'));
    const c = await createCustomer(t);
    const pro1 = await createSoloHandyman(t, { firstName: 'Elvin', online: true });
    await createSoloHandyman(t, { firstName: 'Samir' }); // approved, offline
    await createSoloHandyman(t, { firstName: 'Kamal', status: 'PENDING_REVIEW' });
    const blocked = await createSoloHandyman(t, { firstName: 'Vüqar', online: true });
    await t.prisma.user.update({ where: { id: blocked.userId }, data: { status: 'BLOCKED' } });
    const bot = await createSoloHandyman(t, { firstName: 'Bot', online: true });
    await t.prisma.handymanProfile.update({ where: { id: bot.handymanId }, data: { isBot: true } });
    await createCompany(t, { status: 'PENDING_REVIEW', workers: 0 });
    await createCompany(t, { status: 'APPROVED', workers: 0, name: 'Approved MMC' });

    // Today (Baku 2026-10-25).
    const t1 = await seedRequest(t, c, { createdAt: baku('2026-10-25T00:00:00.000'), status: 'COMPLETED' });
    const t2 = await seedRequest(t, c, { createdAt: baku('2026-10-25T09:00:00.000'), status: 'CANCELLED' });
    const t3 = await seedRequest(t, c, { createdAt: baku('2026-10-25T09:30:00.000'), status: 'COMPLETED', isDemo: true });
    const t4 = await seedRequest(t, c, { createdAt: baku('2026-10-25T09:40:00.000'), status: 'COMPLETED' });
    const t5 = await seedRequest(t, c, { createdAt: baku('2026-10-25T08:00:00.000'), status: 'SEARCHING' });
    const t6 = await seedRequest(t, c, { createdAt: baku('2026-10-25T09:50:00.000'), status: 'COMPLETED' });
    // Yesterday.
    const y1 = await seedRequest(t, c, { createdAt: baku('2026-10-24T23:59:59.999'), status: 'COMPLETED' });
    const y2 = await seedRequest(t, c, { createdAt: baku('2026-10-24T12:00:00.000'), status: 'EXPIRED' });
    // Rest of this 7-day window (from 2026-10-19 00:00 Baku) and the 7 days before it.
    const w = await seedRequest(t, c, { createdAt: baku('2026-10-19T00:00:00.000'), status: 'CANCELLED' });
    const pw1 = await seedRequest(t, c, { createdAt: baku('2026-10-18T23:59:00.000'), status: 'CANCELLED' });
    await seedRequest(t, c, { createdAt: baku('2026-10-12T00:00:00.000'), status: 'COMPLETED' });
    await seedRequest(t, c, { createdAt: baku('2026-10-11T23:00:00.000'), status: 'CANCELLED' });

    // Fees: kept fees of assignments accepted today count; refunded, still-held, bot and yesterday's do not.
    await seedAssignment(t, t1.id, { handymanId: pro1.handymanId, userId: pro1.userId, acceptedAt: baku('2026-10-25T00:10:00.000'), feeAmount: 1000 });
    await seedAssignment(t, t6.id, { handymanId: pro1.handymanId, userId: pro1.userId, acceptedAt: baku('2026-10-25T09:55:00.000'), feeAmount: 1500 });
    await seedAssignment(t, t2.id, {
      handymanId: pro1.handymanId,
      userId: pro1.userId,
      acceptedAt: baku('2026-10-25T09:01:00.000'),
      status: 'CANCELLED_FREE',
      feeRefunded: true,
    });
    await seedAssignment(t, t4.id, { handymanId: bot.handymanId, userId: bot.userId, acceptedAt: baku('2026-10-25T09:41:00.000') });
    await seedAssignment(t, t5.id, {
      handymanId: pro1.handymanId,
      userId: pro1.userId,
      acceptedAt: baku('2026-10-25T09:58:00.000'),
      status: 'ACCEPTED',
      feeCaptured: false,
    });
    await seedAssignment(t, y1.id, { handymanId: pro1.handymanId, userId: pro1.userId, acceptedAt: baku('2026-10-24T23:59:59.999') });

    for (const status of ['OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED'] as const) {
      await t.prisma.case.create({ data: { type: 'GUARANTEE', status, openedByUserId: c.userId, description: 'Kran yenə axır' } });
    }

    const op = await adminToken(t, { role: 'OPERATOR' });
    const d = await t.client(op.token).call(api.admin.dashboard);
    expect(d).toMatchObject({
      date: '2026-10-25',
      ordersToday: 4, // t1, t2, t5, t6 (t3 demo and t4 bot-served are left out)
      ordersYesterday: 2,
      ordersDeltaPct: 100,
      activeHandymen: 2, // Elvin + Samir (pending, blocked user and bot left out)
      onlineHandymen: 1,
      feeRevenueToday: 2500,
      feeOrdersToday: 2,
      // last 7 days: t1 t2 t5 t6 y1 y2 w = 7, cancelled t2 w = 2; previous 7 days: pw1 + 12th = 2, cancelled 1
      cancelRate: 0.2857,
      cancelRateDelta: -0.2143,
      pendingKyc: 1,
      pendingCompanies: 1,
      openCases: 2,
    });
    expect(d.recentOrders.map((r) => r.id)).toEqual([t6.id, t4.id, t3.id, t2.id, t5.id, t1.id, y1.id, y2.id, w.id, pw1.id]);
    expect(d.recentOrders.find((r) => r.id === t3.id)!.isBot).toBe(true);
    expect(d.recentOrders.find((r) => r.id === t4.id)!.isBot).toBe(true);
    expect(d.recentOrders.find((r) => r.id === t6.id)).toMatchObject({ fee: 1500, providerName: 'Elvin Məmmədov', isBot: false });
  });

  it('an empty platform: zero counts, null deltas, 0 cancel rate', async () => {
    const { token } = await adminToken(t);
    const d = await t.client(token).call(api.admin.dashboard);
    expect(d).toMatchObject({
      ordersToday: 0,
      ordersYesterday: 0,
      ordersDeltaPct: null,
      activeHandymen: 0,
      onlineHandymen: 0,
      feeRevenueToday: 0,
      feeOrdersToday: 0,
      cancelRate: 0,
      cancelRateDelta: null,
      pendingKyc: 0,
      pendingCompanies: 0,
      openCases: 0,
      recentOrders: [],
    });
  });

  it('the Baku day turns at 00:00 +04:00, and a drop in orders gives a negative percentage', async () => {
    const c = await createCustomer(t);
    t.clock.set(baku('2026-10-25T00:00:00.500'));
    await seedRequest(t, c, { createdAt: baku('2026-10-24T20:00:00.000') });
    await seedRequest(t, c, { createdAt: baku('2026-10-24T21:00:00.000') });
    await seedRequest(t, c, { createdAt: baku('2026-10-24T22:00:00.000') });
    await seedRequest(t, c, { createdAt: baku('2026-10-25T00:00:00.100') });
    const { token } = await adminToken(t);
    const d = await t.client(token).call(api.admin.dashboard);
    expect(d).toMatchObject({ date: '2026-10-25', ordersToday: 1, ordersYesterday: 3, ordersDeltaPct: -66.7, cancelRateDelta: null });
  });

  it('users cannot read the dashboard', async () => {
    const c = await createCustomer(t);
    await expect(t.client(c.token).call(api.admin.dashboard)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });
});
