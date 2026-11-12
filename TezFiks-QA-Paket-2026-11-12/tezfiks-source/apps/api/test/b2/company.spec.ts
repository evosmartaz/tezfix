import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { gridDisk, latLngToCell } from 'h3-js';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, categoryId, createCompany, createCustomer, createSoloHandyman, createUser, tokenFor, type CreatedCompany } from '../helpers/factories';
import { PresenceService } from '../../src/modules/realtime/presence.service';
import { onboardCompany, proUser } from './helpers';

/** An assignment of a company worker (request + slot) in the given status. */
async function companyJob(
  t: TestApp,
  c: CreatedCompany,
  workerIdx: number,
  data: { status: 'ACCEPTED' | 'EN_ROUTE' | 'COMPLETED'; total?: number; feeCaptured?: boolean },
): Promise<string> {
  const customer = await createCustomer(t);
  const request = await t.prisma.serviceRequest.create({
    data: {
      customerAccountId: customer.accountId,
      createdByUserId: customer.userId,
      categoryId: await categoryId(t, 'electrical'),
      vertical: 'HOME',
      description: 'İşıq yanmır',
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
  const now = t.clock.now();
  const a = await t.prisma.assignment.create({
    data: {
      requestId: request.id,
      slotId: slot.id,
      providerType: 'COMPANY',
      handymanId: c.workers[workerIdx]!.handymanId,
      companyId: c.companyId,
      acceptedByUserId: c.manager.userId,
      status: data.status,
      acceptedAt: now,
      freeCancelUntil: new Date(now.getTime() - 1000),
      completedAt: data.status === 'COMPLETED' ? now : null,
      feeAmount: 1000n,
      feeCaptured: data.feeCaptured ?? false,
      totalAmount: data.total != null ? BigInt(data.total) : null,
      laborAmount: data.total != null ? BigInt(data.total) : null,
      materialsAmount: data.total != null ? 0n : null,
    },
  });
  return a.id;
}

describe('B2 company administration', () => {
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

  describe('authorization', () => {
    it('only ACTIVE managers: workers and other managers get NOT_COMPANY_MANAGER, unknown companies NOT_FOUND', async () => {
      const a = await createCompany(t, { workers: 1 });
      const b = await createCompany(t, { workers: 0 });
      const companyId = a.companyId;
      const worker = t.client(a.workers[0]!.token);
      const otherManager = t.client(b.manager.token);
      const calls = [
        (c: ReturnType<TestApp['client']>) => c.call(api.company.get, { params: { companyId } }),
        (c: ReturnType<TestApp['client']>) => c.call(api.company.dashboard, { params: { companyId } }),
        (c: ReturnType<TestApp['client']>) => c.call(api.company.updateSettings, { params: { companyId }, body: { isVatPayer: true } }),
        (c: ReturnType<TestApp['client']>) => c.call(api.company.members, { params: { companyId } }),
        (c: ReturnType<TestApp['client']>) =>
          c.call(api.company.updateMember, { params: { companyId, userId: a.workers[0]!.userId }, body: { role: 'MANAGER' } }),
        (c: ReturnType<TestApp['client']>) => c.call(api.company.removeMember, { params: { companyId, userId: a.workers[0]!.userId } }),
        (c: ReturnType<TestApp['client']>) => c.call(api.company.invites, { params: { companyId } }),
        (c: ReturnType<TestApp['client']>) => c.call(api.company.createInvite, { params: { companyId }, body: {} }),
        (c: ReturnType<TestApp['client']>) => c.call(api.company.revokeInvite, { params: { companyId, inviteId: crypto.randomUUID() } }),
        (c: ReturnType<TestApp['client']>) => c.call(api.company.workersLive, { params: { companyId } }),
      ];
      for (const call of calls) {
        await expect(call(worker)).rejects.toMatchObject({ code: 'NOT_COMPANY_MANAGER', status: 403 });
        await expect(call(otherManager)).rejects.toMatchObject({ code: 'NOT_COMPANY_MANAGER', status: 403 });
      }
      await expect(t.client(a.manager.token).call(api.company.get, { params: { companyId: crypto.randomUUID() } })).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
      expect((await t.prisma.companyMember.findFirstOrThrow({ where: { userId: a.workers[0]!.userId } })).role).toBe('WORKER');
    });
  });

  it('get + dashboard: members, online workers, wallet, today jobs/fees/revenue', async () => {
    const c = await createCompany(t, { workers: 2, balance: 7000, workersOnline: true });
    await companyJob(t, c, 0, { status: 'COMPLETED', total: 12000, feeCaptured: true });
    await companyJob(t, c, 1, { status: 'EN_ROUTE', feeCaptured: true });
    const view = await t.client(c.manager.token).call(api.company.get, { params: { companyId: c.companyId } });
    expect(view).toMatchObject({ id: c.companyId, status: 'APPROVED', membersCount: 3, onlineWorkers: 2, myRole: 'MANAGER', kyc: { status: 'APPROVED' } });
    expect(view.wallet).toMatchObject({ posted: 7000, available: 7000 });
    const dash = await t.client(c.manager.token).call(api.company.dashboard, { params: { companyId: c.companyId } });
    expect(dash).toMatchObject({ jobsToday: 2, activeJobs: 1, onlineWorkers: 2, membersCount: 3, earningsBalance: 0, feesToday: 2000, revenueToday: 12000 });
    expect(dash.wallet.available).toBe(7000);
  });

  it('updateSettings: name, final price entry, VAT, trades and service area (cells recomputed)', async () => {
    const c = await createCompany(t, { workers: 0 });
    const res = await t.client(c.manager.token).call(api.company.updateSettings, {
      params: { companyId: c.companyId },
      body: {
        name: 'Şəhər Ustaları MMC',
        finalPriceEntry: 'MANAGER',
        isVatPayer: true,
        tradeIds: [await categoryId(t, 'heating'), await categoryId(t, 'plumbing')],
        serviceRadiusKm: 5,
        base: BAKU.ahmadli,
        baseAddress: 'Əhmədli, Bakı',
      },
    });
    expect(res).toMatchObject({ name: 'Şəhər Ustaları MMC', finalPriceEntry: 'MANAGER', isVatPayer: true, serviceRadiusKm: 5, base: BAKU.ahmadli, baseAddress: 'Əhmədli, Bakı' });
    expect(res.trades.map((x) => x.slug).sort()).toEqual(['heating', 'plumbing']);
    const cells = await t.prisma.companyServiceCell.findMany({ where: { companyId: c.companyId } });
    expect(cells.map((x) => x.cell7).sort()).toEqual([...gridDisk(latLngToCell(BAKU.ahmadli.lat, BAKU.ahmadli.lng, 7), 3)].sort());
    await expect(
      t.client(c.manager.token).call(api.company.updateSettings, { params: { companyId: c.companyId }, body: { tradeIds: [crypto.randomUUID()] } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
  });

  it('updateSettings drops worker trades the company no longer offers; other companies are untouched', async () => {
    const c = await createCompany(t, { workers: 1, trades: ['electrical', 'plumbing'] });
    const other = await createCompany(t, { workers: 1, trades: ['electrical', 'plumbing'] });
    const slugs = async (handymanId: string) =>
      (await t.prisma.handymanTrade.findMany({ where: { handymanId }, include: { category: { select: { slug: true } } } })).map((x) => x.category.slug).sort();
    expect(await slugs(c.workers[0]!.handymanId)).toEqual(['electrical', 'plumbing']);
    await t.client(c.manager.token).call(api.company.updateSettings, {
      params: { companyId: c.companyId },
      body: { tradeIds: [await categoryId(t, 'plumbing'), await categoryId(t, 'heating')] },
    });
    expect(await slugs(c.workers[0]!.handymanId)).toEqual(['plumbing']);
    expect(await slugs(other.workers[0]!.handymanId)).toEqual(['electrical', 'plumbing']);
  });

  it('members list shows phones (the company employs them), roles, trades, online and busy flags', async () => {
    const c = await createCompany(t, { workers: 2, workersOnline: true });
    await companyJob(t, c, 1, { status: 'ACCEPTED' });
    const { items } = await t.client(c.manager.token).call(api.company.members, { params: { companyId: c.companyId } });
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ userId: c.manager.userId, role: 'MANAGER', handymanId: null, phone: c.manager.phone, trades: [], busy: false });
    const w0 = items.find((m) => m.userId === c.workers[0]!.userId)!;
    const w1 = items.find((m) => m.userId === c.workers[1]!.userId)!;
    expect(w0).toMatchObject({ role: 'WORKER', handymanId: c.workers[0]!.handymanId, phone: c.workers[0]!.phone, isOnline: true, busy: false, status: 'ACTIVE' });
    expect(w0.trades.map((x) => x.slug)).toEqual(['electrical']);
    expect(w1.busy).toBe(true);
    expect(w0.firstName).toBe('Rauf');
    expect(w0.lastName).toBe('Hüseynov');
  });

  describe('updateMember', () => {
    it('promotes a worker, then demotes them back; the last manager cannot be demoted', async () => {
      const c = await createCompany(t, { workers: 1 });
      const w = c.workers[0]!;
      const m = t.client(c.manager.token);
      await expect(
        m.call(api.company.updateMember, { params: { companyId: c.companyId, userId: c.manager.userId }, body: { role: 'WORKER' } }),
      ).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409, details: { reason: 'LAST_MANAGER' } });
      const promoted = await m.call(api.company.updateMember, { params: { companyId: c.companyId, userId: w.userId }, body: { role: 'MANAGER' } });
      expect(promoted).toMatchObject({ userId: w.userId, role: 'MANAGER', handymanId: w.handymanId });
      // the promoted manager now administers the company
      expect((await t.client(w.token).call(api.pro.profile)).managedCompanies).toEqual([
        { id: c.companyId, name: 'FixPro MMC', status: 'APPROVED', role: 'MANAGER' },
      ]);
      const demoted = await t.client(w.token).call(api.company.updateMember, {
        params: { companyId: c.companyId, userId: c.manager.userId },
        body: { role: 'WORKER' },
      });
      // a manager without a handyman profile gets an APPROVED worker profile with the company trades
      expect(demoted).toMatchObject({ role: 'WORKER', trades: [expect.objectContaining({ slug: 'electrical' })] });
      const profile = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { userId: c.manager.userId } });
      expect(profile).toMatchObject({ kind: 'COMPANY_WORKER', companyId: c.companyId, status: 'APPROVED' });
      await expect(t.client(c.manager.token).call(api.company.members, { params: { companyId: c.companyId } })).rejects.toMatchObject({
        code: 'NOT_COMPANY_MANAGER',
      });
    });

    it('sets worker trades among company trades only', async () => {
      const c = await createCompany(t, { workers: 1, trades: ['electrical', 'plumbing'] });
      const w = c.workers[0]!;
      const m = t.client(c.manager.token);
      const res = await m.call(api.company.updateMember, {
        params: { companyId: c.companyId, userId: w.userId },
        body: { tradeIds: [await categoryId(t, 'plumbing')] },
      });
      expect(res.trades.map((x) => x.slug)).toEqual(['plumbing']);
      await expect(
        m.call(api.company.updateMember, { params: { companyId: c.companyId, userId: w.userId }, body: { tradeIds: [await categoryId(t, 'painting')] } }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
      await expect(
        m.call(api.company.updateMember, { params: { companyId: c.companyId, userId: c.manager.userId }, body: { tradeIds: [await categoryId(t, 'plumbing')] } }),
      ).rejects.toMatchObject({ code: 'INVALID_STATE', details: { reason: 'NOT_A_WORKER' } });
    });

    it("demoting a manager whose worker profile came from another company resets its trades to this company's", async () => {
      const old = await createCompany(t, { workers: 1, trades: ['painting'] });
      const w = old.workers[0]!;
      await t.client(old.manager.token).call(api.company.removeMember, { params: { companyId: old.companyId, userId: w.userId } });
      const c = await createCompany(t, { workers: 0, trades: ['electrical', 'plumbing'] });
      await t.prisma.companyMember.create({ data: { companyId: c.companyId, userId: w.userId, role: 'MANAGER' } });
      const res = await t.client(c.manager.token).call(api.company.updateMember, {
        params: { companyId: c.companyId, userId: w.userId },
        body: { role: 'WORKER' },
      });
      expect(res.trades.map((x) => x.slug).sort()).toEqual(['electrical', 'plumbing']);
      const profile = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: w.handymanId }, include: { trades: true } });
      expect(profile).toMatchObject({ companyId: c.companyId, status: 'APPROVED' });
      expect(profile.trades).toHaveLength(2);
    });

    it('NOT_FOUND for non-members; ALREADY_HANDYMAN when demoting a manager who is a solo handyman', async () => {
      const c = await createCompany(t, { workers: 0 });
      const m = t.client(c.manager.token);
      const stranger = await createUser(t);
      await expect(
        m.call(api.company.updateMember, { params: { companyId: c.companyId, userId: stranger.userId }, body: { role: 'MANAGER' } }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
      const solo = await createSoloHandyman(t);
      await t.prisma.companyMember.create({ data: { companyId: c.companyId, userId: solo.userId, role: 'MANAGER' } });
      await expect(
        m.call(api.company.updateMember, { params: { companyId: c.companyId, userId: solo.userId }, body: { role: 'WORKER' } }),
      ).rejects.toMatchObject({ code: 'ALREADY_HANDYMAN', status: 409 });
      expect((await t.prisma.companyMember.findFirstOrThrow({ where: { userId: solo.userId } })).role).toBe('MANAGER');
    });
  });

  describe('removeMember', () => {
    it('detaches the worker profile (company-less DRAFT, offline) and drops the membership', async () => {
      const c = await createCompany(t, { workers: 2, balance: 5000 });
      const w = c.workers[0]!;
      await t.client(w.token).call(api.pro.setOnline, { body: { online: true, location: BAKU.center } });
      const presence = t.app.get(PresenceService);
      expect((await presence.get(w.handymanId))?.online).toBe(true);
      expect(
        await t.client(c.manager.token).call(api.company.removeMember, { params: { companyId: c.companyId, userId: w.userId } }),
      ).toEqual({ ok: true });
      const profile = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: w.handymanId } });
      expect(profile).toMatchObject({ kind: 'COMPANY_WORKER', companyId: null, status: 'DRAFT', isOnline: false, approvedAt: null });
      expect((await presence.get(w.handymanId))?.online ?? false).toBe(false);
      const member = await t.prisma.companyMember.findFirstOrThrow({ where: { userId: w.userId } });
      expect(member.status).toBe('REMOVED');
      expect(member.removedAt).not.toBeNull();
      const { items } = await t.client(c.manager.token).call(api.company.members, { params: { companyId: c.companyId } });
      expect(items.map((x) => x.userId)).not.toContain(w.userId);
      await expect(t.client(w.token).call(api.pro.setOnline, { body: { online: true } })).rejects.toMatchObject({ code: 'HANDYMAN_NOT_APPROVED' });
      expect(t.realtime.sentTo(`user:${w.userId}`, 'profile:updated').map((e) => e.payload)).toContainEqual({ reason: 'REMOVED_FROM_COMPANY' });
      await expect(
        t.client(c.manager.token).call(api.company.removeMember, { params: { companyId: c.companyId, userId: w.userId } }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    });

    it('the last manager cannot remove themself; a worker in the middle of a job cannot be removed', async () => {
      const c = await createCompany(t, { workers: 1 });
      await expect(
        t.client(c.manager.token).call(api.company.removeMember, { params: { companyId: c.companyId, userId: c.manager.userId } }),
      ).rejects.toMatchObject({ code: 'INVALID_STATE', details: { reason: 'LAST_MANAGER' } });
      await companyJob(t, c, 0, { status: 'EN_ROUTE' });
      await expect(
        t.client(c.manager.token).call(api.company.removeMember, { params: { companyId: c.companyId, userId: c.workers[0]!.userId } }),
      ).rejects.toMatchObject({ code: 'INVALID_STATE', details: { reason: 'ACTIVE_ASSIGNMENT' } });

      // with a second manager the first one may leave
      const second = await createUser(t);
      await t.prisma.companyMember.create({ data: { companyId: c.companyId, userId: second.userId, role: 'MANAGER' } });
      expect(
        await t.client(await tokenFor(t, second.userId, 'PANEL')).call(api.company.removeMember, {
          params: { companyId: c.companyId, userId: c.manager.userId },
        }),
      ).toEqual({ ok: true });
    });
  });

  describe('invites', () => {
    it('creates 24-character url-safe tokens with the join URL, lists and revokes them', async () => {
      const c = await createCompany(t, { workers: 0 });
      const m = t.client(c.manager.token);
      const inv = await m.call(api.company.createInvite, { params: { companyId: c.companyId }, body: { role: 'WORKER', maxUses: 3, expiresInDays: 2 } });
      expect(inv.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(inv.url).toBe(`http://127.0.0.1:3000/tezfix/join/${inv.token}`);
      expect(inv).toMatchObject({ role: 'WORKER', maxUses: 3, usedCount: 0, revokedAt: null });
      expect(new Date(inv.expiresAt).getTime() - t.clock.nowMs()).toBeGreaterThan(2 * 86_400_000 - 5_000);
      const defaults = await m.call(api.company.createInvite, { params: { companyId: c.companyId }, body: {} });
      expect(defaults).toMatchObject({ role: 'WORKER', maxUses: 10 });
      expect(defaults.token).not.toBe(inv.token);

      const list = await m.call(api.company.invites, { params: { companyId: c.companyId } });
      expect(list.items.map((i) => i.id).sort()).toEqual([inv.id, defaults.id].sort());

      expect(await m.call(api.company.revokeInvite, { params: { companyId: c.companyId, inviteId: inv.id } })).toEqual({ ok: true });
      expect(await m.call(api.company.revokeInvite, { params: { companyId: c.companyId, inviteId: inv.id } })).toEqual({ ok: true });
      const after = await m.call(api.company.invites, { params: { companyId: c.companyId } });
      expect(after.items.find((i) => i.id === inv.id)!.revokedAt).not.toBeNull();

      const other = await createCompany(t, { workers: 0 });
      await expect(
        t.client(other.manager.token).call(api.company.revokeInvite, { params: { companyId: other.companyId, inviteId: inv.id } }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    });

    it('COMPANY_NOT_APPROVED: a company still in review cannot invite', async () => {
      const u = await proUser(t);
      const company = await onboardCompany(t, u);
      await expect(t.client(u.token).call(api.company.createInvite, { params: { companyId: company.id }, body: {} })).rejects.toMatchObject({
        code: 'COMPANY_NOT_APPROVED',
        status: 403,
      });
    });
  });

  it('workersLive: presence location, online, busy and the current assignment', async () => {
    const c = await createCompany(t, { workers: 2, balance: 5000 });
    await t.client(c.workers[0]!.token).call(api.pro.setOnline, { body: { online: true, location: BAKU.narimanov } });
    const jobId = await companyJob(t, c, 1, { status: 'EN_ROUTE' });
    const { items } = await t.client(c.manager.token).call(api.company.workersLive, { params: { companyId: c.companyId } });
    expect(items).toHaveLength(2);
    const w0 = items.find((x) => x.handymanId === c.workers[0]!.handymanId)!;
    const w1 = items.find((x) => x.handymanId === c.workers[1]!.handymanId)!;
    expect(w0).toMatchObject({ userId: c.workers[0]!.userId, firstName: 'Rauf', isOnline: true, busy: false, assignmentId: null, lat: BAKU.narimanov.lat, lng: BAKU.narimanov.lng });
    expect(w0.lastSeenAt).not.toBeNull();
    expect(w1).toMatchObject({ isOnline: false, busy: true, assignmentId: jobId, lat: BAKU.center.lat });
  });
});
