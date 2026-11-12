import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { gridDisk, latLngToCell } from 'h3-js';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, categoryId, createCompany, createSoloHandyman } from '../helpers/factories';
import { onboardCompany, onboardSolo, proUser, uniqueVoen, upload } from './helpers';

describe('B2 onboarding and pro profile', () => {
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

  describe('GET /pro/profile', () => {
    it('returns profile null and no companies for a user without a handyman profile', async () => {
      const u = await proUser(t);
      const res = await t.client(u.token).call(api.pro.profile);
      expect(res).toEqual({ profile: null, managedCompanies: [] });
    });

    it('requires a user token', async () => {
      await expect(t.client().call(api.pro.profile)).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    });
  });

  describe('solo onboarding', () => {
    it('creates a DRAFT solo profile with trades, service cells, wallet + earnings and Azerbaijani names intact', async () => {
      const u = await proUser(t);
      const profile = await onboardSolo(t, u, { trades: ['plumbing', 'electrical'], radiusKm: 10, firstName: 'İsmayıl', lastName: 'Şükürov' });
      expect(profile).toMatchObject({
        userId: u.userId,
        kind: 'SOLO',
        status: 'DRAFT',
        firstName: 'İsmayıl',
        lastName: 'Şükürov',
        company: null,
        serviceRadiusKm: 10,
        base: BAKU.center,
        isOnline: false,
        strikes: 0,
        earningsBalance: 0,
        kyc: { status: 'NONE', submittedAt: null, reviewedAt: null, rejectReason: null, attemptsLeft24h: 3 },
      });
      expect(profile.trades.map((x) => x.slug).sort()).toEqual(['electrical', 'plumbing']);
      expect(profile.wallet).toMatchObject({ posted: 0, held: 0, available: 0, lowBalance: true });

      const user = await t.prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
      expect([user.firstName, user.lastName]).toEqual(['İsmayıl', 'Şükürov']);

      const row = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: profile.id }, include: { serviceCells: true } });
      const expected = gridDisk(latLngToCell(BAKU.center.lat, BAKU.center.lng, 7), Math.ceil(10 / 2.44));
      expect(row.serviceCells.map((c) => c.cell7).sort()).toEqual([...expected].sort());
      expect(row.baseCell7).toBe(latLngToCell(BAKU.center.lat, BAKU.center.lng, 7));
      const accounts = await t.prisma.ledgerAccount.findMany({ where: { ownerType: 'HANDYMAN', ownerId: profile.id } });
      expect(accounts.map((a) => a.kind).sort()).toEqual(['EARNINGS', 'WALLET']);
      expect(row.walletAccountId).toBe(accounts.find((a) => a.kind === 'WALLET')!.id);

      const again = await t.client(u.token).call(api.pro.profile);
      expect(again.profile?.id).toBe(profile.id);
    });

    it('sets the profile photo when the caller owns a PROFILE_PHOTO', async () => {
      const u = await proUser(t);
      const photo = await upload(t, u.token, 'PROFILE_PHOTO');
      const profile = await t.client(u.token).call(api.pro.onboardSolo, {
        body: { firstName: 'Elvin', lastName: 'Məmmədov', photoFileId: photo.id, tradeIds: [await categoryId(t, 'plumbing')], base: BAKU.center },
      });
      expect(profile.photo?.id).toBe(photo.id);
      expect(profile.serviceRadiusKm).toBe(10);
    });

    it("refuses someone else's photo or a file of another kind with FILE_NOT_OWNED", async () => {
      const u = await proUser(t);
      const other = await proUser(t);
      const foreign = await upload(t, other.token, 'PROFILE_PHOTO');
      const kyc = await upload(t, u.token, 'KYC_SELFIE');
      const tradeIds = [await categoryId(t, 'plumbing')];
      for (const photoFileId of [foreign.id, kyc.id]) {
        await expect(
          t.client(u.token).call(api.pro.onboardSolo, { body: { firstName: 'A', lastName: 'B', photoFileId, tradeIds, base: BAKU.center } }),
        ).rejects.toMatchObject({ code: 'FILE_NOT_OWNED', status: 403 });
      }
      expect(await t.prisma.handymanProfile.count()).toBe(0);
    });

    it('ALREADY_HANDYMAN for a second profile, also when two onboardings race', async () => {
      const u = await proUser(t);
      const results = await Promise.allSettled([onboardSolo(t, u), onboardSolo(t, u)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(rejected.reason).toMatchObject({ code: 'ALREADY_HANDYMAN', status: 409 });
      await expect(onboardSolo(t, u)).rejects.toMatchObject({ code: 'ALREADY_HANDYMAN', status: 409 });
      expect(await t.prisma.handymanProfile.count({ where: { userId: u.userId } })).toBe(1);
    });

    it('ALREADY_IN_COMPANY for an active company member', async () => {
      const company = await createCompany(t, { workers: 0 });
      await expect(onboardSolo(t, { ...company.manager })).rejects.toMatchObject({ code: 'ALREADY_IN_COMPANY', status: 409 });
    });

    it('VALIDATION_FAILED for unknown, group or inactive trades', async () => {
      const u = await proUser(t);
      const group = await t.prisma.category.findFirstOrThrow({ where: { kind: 'GROUP' } });
      const inactive = await t.prisma.category.update({ where: { slug: 'gardening' }, data: { active: false } });
      for (const bad of [crypto.randomUUID(), group.id, inactive.id]) {
        await expect(
          t.client(u.token).call(api.pro.onboardSolo, { body: { firstName: 'A', lastName: 'B', tradeIds: [bad], base: BAKU.center } }),
        ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400, details: { field: 'tradeIds', invalid: [bad] } });
      }
      expect(await t.prisma.handymanProfile.count()).toBe(0);
    });

    it('validates the body against the contract (radius bounds)', async () => {
      const u = await proUser(t);
      await expect(
        t.client(u.token).call(api.pro.onboardSolo, {
          body: { firstName: 'A', lastName: 'B', tradeIds: [await categoryId(t, 'plumbing')], serviceRadiusKm: 40, base: BAKU.center },
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    });
  });

  describe('company onboarding', () => {
    it('registers a DRAFT company with the caller as MANAGER, wallets, trades and service cells', async () => {
      const u = await proUser(t);
      const voen = uniqueVoen();
      const company = await onboardCompany(t, u, { name: 'Əliyev Təmir MMC', voen });
      expect(company).toMatchObject({
        name: 'Əliyev Təmir MMC',
        legalForm: 'MMC',
        voen,
        status: 'DRAFT',
        rejectReason: null,
        finalPriceEntry: 'WORKER',
        isVatPayer: false,
        base: BAKU.center,
        baseAddress: 'Nizami küçəsi 10, Bakı',
        serviceRadiusKm: 15,
        membersCount: 1,
        onlineWorkers: 0,
        myRole: 'MANAGER',
        earningsBalance: 0,
        kyc: { status: 'NONE', attemptsLeft24h: 3 },
      });
      expect(company.wallet).toMatchObject({ posted: 0, available: 0 });
      expect(company.trades.map((x) => x.slug).sort()).toEqual(['electrical', 'plumbing']);
      const member = await t.prisma.companyMember.findFirstOrThrow({ where: { companyId: company.id } });
      expect(member).toMatchObject({ userId: u.userId, role: 'MANAGER', status: 'ACTIVE' });
      const cells = await t.prisma.companyServiceCell.count({ where: { companyId: company.id } });
      expect(cells).toBe(gridDisk(latLngToCell(BAKU.center.lat, BAKU.center.lng, 7), Math.ceil(15 / 2.44)).length);
      const accounts = await t.prisma.ledgerAccount.findMany({ where: { ownerType: 'COMPANY', ownerId: company.id } });
      expect(accounts.map((a) => a.kind).sort()).toEqual(['EARNINGS', 'WALLET']);

      const res = await t.client(u.token).call(api.pro.profile);
      expect(res).toEqual({ profile: null, managedCompanies: [{ id: company.id, name: 'Əliyev Təmir MMC', status: 'DRAFT', role: 'MANAGER' }] });
      const user = await t.prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
      expect([user.firstName, user.lastName]).toEqual(['Fuad', 'İdarəçi']);
    });

    it('CONFLICT for a VÖEN that is already registered (also under a race)', async () => {
      const a = await proUser(t);
      const b = await proUser(t);
      const voen = uniqueVoen();
      const results = await Promise.allSettled([onboardCompany(t, a, { voen }), onboardCompany(t, b, { voen })]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT', status: 409 });
      await expect(onboardCompany(t, a, { voen })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
      expect(await t.prisma.company.count()).toBe(1);
    });

    it('a VÖEN must be 10 digits', async () => {
      const u = await proUser(t);
      await expect(onboardCompany(t, u, { voen: '12345' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    });
  });

  describe('PATCH /pro/profile', () => {
    it('replaces trades and recomputes the service cells when radius or base change', async () => {
      const u = await proUser(t);
      const p = await onboardSolo(t, u, { radiusKm: 5 });
      const before = await t.prisma.handymanServiceCell.count({ where: { handymanId: p.id } });
      expect(before).toBe(gridDisk(latLngToCell(BAKU.center.lat, BAKU.center.lng, 7), 3).length);

      const updated = await t.client(u.token).call(api.pro.updateProfile, {
        body: { tradeIds: [await categoryId(t, 'air-conditioning')], serviceRadiusKm: 2, base: BAKU.ahmadli },
      });
      expect(updated.trades.map((x) => x.slug)).toEqual(['air-conditioning']);
      expect(updated.serviceRadiusKm).toBe(2);
      expect(updated.base).toEqual(BAKU.ahmadli);
      const cells = await t.prisma.handymanServiceCell.findMany({ where: { handymanId: p.id } });
      const expected = gridDisk(latLngToCell(BAKU.ahmadli.lat, BAKU.ahmadli.lng, 7), 1);
      expect(cells.map((c) => c.cell7).sort()).toEqual([...expected].sort());
      const row = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: p.id } });
      expect(row.baseCell7).toBe(latLngToCell(BAKU.ahmadli.lat, BAKU.ahmadli.lng, 7));

      const radiusOnly = await t.client(u.token).call(api.pro.updateProfile, { body: { serviceRadiusKm: 10 } });
      expect(radiusOnly.base).toEqual(BAKU.ahmadli);
      expect(await t.prisma.handymanServiceCell.count({ where: { handymanId: p.id } })).toBe(
        gridDisk(latLngToCell(BAKU.ahmadli.lat, BAKU.ahmadli.lng, 7), 5).length,
      );
    });

    it('NOT_FOUND without a handyman profile', async () => {
      const u = await proUser(t);
      await expect(t.client(u.token).call(api.pro.updateProfile, { body: { serviceRadiusKm: 5 } })).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });

    it('company workers may only choose trades of their company', async () => {
      const company = await createCompany(t, { trades: ['electrical', 'plumbing'], workers: 1 });
      const w = company.workers[0]!;
      const ok = await t.client(w.token).call(api.pro.updateProfile, { body: { tradeIds: [await categoryId(t, 'plumbing')] } });
      expect(ok.trades.map((x) => x.slug)).toEqual(['plumbing']);
      expect(ok.company).toMatchObject({ id: company.companyId, finalPriceEntry: 'WORKER' });
      expect(ok.wallet).toBeNull();
      expect(ok.earningsBalance).toBeNull();
      expect(ok.kyc.status).toBe('APPROVED');
      await expect(
        t.client(w.token).call(api.pro.updateProfile, { body: { tradeIds: [await categoryId(t, 'painting')] } }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    });

    it('shows the solo wallet and earnings of an approved handyman', async () => {
      const h = await createSoloHandyman(t, { balance: 2500 });
      const res = await t.client(h.token).call(api.pro.profile);
      expect(res.profile).toMatchObject({ status: 'APPROVED', wallet: { posted: 2500, available: 2500, lowBalance: false }, earningsBalance: 0 });
      expect(res.profile?.kyc.status).toBe('APPROVED');
    });
  });
});
