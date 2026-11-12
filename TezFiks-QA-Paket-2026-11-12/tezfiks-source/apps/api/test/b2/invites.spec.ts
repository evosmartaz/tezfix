import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { categoryId, createCompany, createSoloHandyman, fund, randomPhone, tokenFor, type CreatedCompany } from '../helpers/factories';
import { onboardSolo, proUser } from './helpers';

describe('B2 company invites: preview and accept', () => {
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

  async function invite(c: CreatedCompany, body: { role?: 'WORKER' | 'MANAGER'; maxUses?: number; expiresInDays?: number } = {}) {
    return t.client(c.manager.token).call(api.company.createInvite, { params: { companyId: c.companyId }, body });
  }

  describe('preview (public)', () => {
    it('shows company, role and validity; reasons for revoked, expired, used up and unapproved companies', async () => {
      const c = await createCompany(t, { name: 'Bakı Elektrik MMC', workers: 0 });
      const inv = await invite(c, { role: 'MANAGER', maxUses: 1, expiresInDays: 1 });
      expect(await t.client().call(api.invites.preview, { params: { token: inv.token } })).toEqual({
        companyName: 'Bakı Elektrik MMC',
        role: 'MANAGER',
        expiresAt: inv.expiresAt,
        valid: true,
        reason: null,
      });

      await t.prisma.companyInvite.update({ where: { id: inv.id }, data: { usedCount: 1 } });
      expect(await t.client().call(api.invites.preview, { params: { token: inv.token } })).toMatchObject({ valid: false, reason: 'USED_UP' });
      await t.prisma.companyInvite.update({ where: { id: inv.id }, data: { usedCount: 0 } });

      await t.prisma.company.update({ where: { id: c.companyId }, data: { status: 'BLOCKED' } });
      expect(await t.client().call(api.invites.preview, { params: { token: inv.token } })).toMatchObject({ valid: false, reason: 'COMPANY_NOT_APPROVED' });
      await t.prisma.company.update({ where: { id: c.companyId }, data: { status: 'APPROVED' } });

      t.clock.advance(86_400_000 + 1000);
      expect(await t.client().call(api.invites.preview, { params: { token: inv.token } })).toMatchObject({ valid: false, reason: 'EXPIRED' });

      await t.prisma.companyInvite.update({ where: { id: inv.id }, data: { revokedAt: t.clock.now() } });
      expect(await t.client().call(api.invites.preview, { params: { token: inv.token } })).toMatchObject({ valid: false, reason: 'REVOKED' });
    });

    it('is rate limited per client IP (30 per minute)', async () => {
      const c = await createCompany(t, { workers: 0 });
      const inv = await invite(c);
      for (let i = 0; i < 30; i++) await t.client().call(api.invites.preview, { params: { token: inv.token } });
      await expect(t.client().call(api.invites.preview, { params: { token: inv.token } })).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    });

    it('NOT_FOUND for unknown tokens', async () => {
      await expect(t.client().call(api.invites.preview, { params: { token: 'abcdefghijklmnopqrstuvwx' } })).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
      });
    });
  });

  describe('accept', () => {
    it('WORKER: a new user gets an APPROVED company-worker profile with the company trades', async () => {
      const c = await createCompany(t, { workers: 0, trades: ['electrical', 'plumbing'], balance: 3000 });
      const inv = await invite(c);
      const u = await proUser(t);
      const res = await t.client(u.token).call(api.invites.accept, { params: { token: inv.token }, body: { firstName: 'Səbuhi', lastName: 'Qasımov' } });
      expect(res.managedCompanies).toEqual([]);
      expect(res.profile).toMatchObject({
        userId: u.userId,
        kind: 'COMPANY_WORKER',
        status: 'APPROVED',
        firstName: 'Səbuhi',
        lastName: 'Qasımov',
        company: { id: c.companyId, name: 'FixPro MMC', finalPriceEntry: 'WORKER' },
        wallet: null,
        kyc: { status: 'APPROVED' },
      });
      expect(res.profile!.trades.map((x) => x.slug).sort()).toEqual(['electrical', 'plumbing']);
      const member = await t.prisma.companyMember.findFirstOrThrow({ where: { companyId: c.companyId, userId: u.userId } });
      expect(member).toMatchObject({ role: 'WORKER', status: 'ACTIVE' });
      expect((await t.prisma.companyInvite.findUniqueOrThrow({ where: { id: inv.id } })).usedCount).toBe(1);
      expect(t.realtime.sentTo(`company:${c.companyId}`, 'company:workers')).toHaveLength(1);
      // the new worker can go online right away (the company is verified)
      expect(await t.client(u.token).call(api.pro.setOnline, { body: { online: true } })).toEqual({ isOnline: true, warnings: [] });

      await expect(t.client(u.token).call(api.invites.accept, { params: { token: inv.token }, body: {} })).rejects.toMatchObject({
        code: 'ALREADY_IN_COMPANY',
        status: 409,
      });
    });

    it('WORKER with a subset of company trades; other trades are refused', async () => {
      const c = await createCompany(t, { workers: 0, trades: ['electrical', 'plumbing'] });
      const inv = await invite(c);
      const u = await proUser(t);
      await expect(
        t.client(u.token).call(api.invites.accept, { params: { token: inv.token }, body: { tradeIds: [await categoryId(t, 'painting')] } }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
      const res = await t.client(u.token).call(api.invites.accept, { params: { token: inv.token }, body: { tradeIds: [await categoryId(t, 'plumbing')] } });
      expect(res.profile!.trades.map((x) => x.slug)).toEqual(['plumbing']);
    });

    it('PROFILE_INCOMPLETE when the user has no name and none is given', async () => {
      const c = await createCompany(t, { workers: 0 });
      const inv = await invite(c);
      const user = await t.prisma.user.create({ data: { phone: randomPhone() } });
      const token = await tokenFor(t, user.id, 'PRO');
      await expect(t.client(token).call(api.invites.accept, { params: { token: inv.token }, body: {} })).rejects.toMatchObject({
        code: 'PROFILE_INCOMPLETE',
        status: 409,
      });
      expect((await t.prisma.companyInvite.findUniqueOrThrow({ where: { id: inv.id } })).usedCount).toBe(0);
    });

    it('MANAGER: membership only, the company shows up in managedCompanies', async () => {
      const c = await createCompany(t, { workers: 0 });
      const inv = await invite(c, { role: 'MANAGER' });
      const u = await proUser(t);
      const res = await t.client(u.token).call(api.invites.accept, { params: { token: inv.token }, body: {} });
      expect(res).toEqual({ profile: null, managedCompanies: [{ id: c.companyId, name: 'FixPro MMC', status: 'APPROVED', role: 'MANAGER' }] });
      expect(await t.prisma.handymanProfile.count({ where: { userId: u.userId } })).toBe(0);
      const view = await t.client(u.token).call(api.company.get, { params: { companyId: c.companyId } });
      expect(view.membersCount).toBe(2);
    });

    it('existing handymen: approved solo -> ALREADY_HANDYMAN; DRAFT solo with an empty wallet is converted; with money it is refused', async () => {
      const c = await createCompany(t, { workers: 0 });
      const inv = await invite(c);
      const solo = await createSoloHandyman(t);
      await expect(t.client(solo.token).call(api.invites.accept, { params: { token: inv.token }, body: {} })).rejects.toMatchObject({
        code: 'ALREADY_HANDYMAN',
        status: 409,
      });

      const draft = await proUser(t);
      const p = await onboardSolo(t, draft);
      const res = await t.client(draft.token).call(api.invites.accept, { params: { token: inv.token }, body: {} });
      expect(res.profile).toMatchObject({ id: p.id, kind: 'COMPANY_WORKER', status: 'APPROVED', company: { id: c.companyId } });
      expect(await t.prisma.handymanServiceCell.count({ where: { handymanId: p.id } })).toBe(0);

      const rich = await proUser(t);
      const rp = await onboardSolo(t, rich);
      await fund(t, rp.wallet!.accountId, 500);
      await expect(t.client(rich.token).call(api.invites.accept, { params: { token: inv.token }, body: {} })).rejects.toMatchObject({
        code: 'ALREADY_HANDYMAN',
        details: { reason: 'WALLET_NOT_EMPTY' },
      });
      expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: rp.id } })).kind).toBe('SOLO');
      expect(await t.ledger.globalSum()).toBe(0);
      expect(await t.ledger.verifyIntegrity()).toEqual([]);
    });

    it('a worker of another company -> ALREADY_IN_COMPANY; once removed there, the worker can join', async () => {
      const a = await createCompany(t, { workers: 1 });
      const b = await createCompany(t, { workers: 0, name: 'Digər Usta MMC' });
      const inv = await invite(b);
      const w = a.workers[0]!;
      await expect(t.client(w.token).call(api.invites.accept, { params: { token: inv.token }, body: {} })).rejects.toMatchObject({
        code: 'ALREADY_IN_COMPANY',
        status: 409,
      });
      await t.client(a.manager.token).call(api.company.removeMember, { params: { companyId: a.companyId, userId: w.userId } });
      const res = await t.client(w.token).call(api.invites.accept, { params: { token: inv.token }, body: {} });
      expect(res.profile).toMatchObject({ id: w.handymanId, status: 'APPROVED', company: { id: b.companyId, name: 'Digər Usta MMC' } });

      // and back to the first company: the old membership row is reactivated
      await t.client(b.manager.token).call(api.company.removeMember, { params: { companyId: b.companyId, userId: w.userId } });
      const back = await invite(a);
      await t.client(w.token).call(api.invites.accept, { params: { token: back.token }, body: {} });
      const rows = await t.prisma.companyMember.findMany({ where: { companyId: a.companyId, userId: w.userId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'ACTIVE', removedAt: null, role: 'WORKER' });
    });

    it('INVITE_INVALID for expired, revoked, used-up and unknown invites; COMPANY_NOT_APPROVED for blocked companies', async () => {
      const c = await createCompany(t, { workers: 0 });
      const u = await proUser(t);
      const call = (token: string) => t.client(u.token).call(api.invites.accept, { params: { token }, body: {} });

      const revoked = await invite(c);
      await t.client(c.manager.token).call(api.company.revokeInvite, { params: { companyId: c.companyId, inviteId: revoked.id } });
      await expect(call(revoked.token)).rejects.toMatchObject({ code: 'INVITE_INVALID', status: 410, details: { reason: 'REVOKED' } });

      const used = await invite(c, { maxUses: 1 });
      await t.prisma.companyInvite.update({ where: { id: used.id }, data: { usedCount: 1 } });
      await expect(call(used.token)).rejects.toMatchObject({ code: 'INVITE_INVALID', details: { reason: 'USED_UP' } });

      await expect(call('zzzzzzzzzzzzzzzzzzzzzzzz')).rejects.toMatchObject({ code: 'INVITE_INVALID', details: { reason: 'NOT_FOUND' } });

      const blockedLater = await invite(c);
      await t.prisma.company.update({ where: { id: c.companyId }, data: { status: 'BLOCKED' } });
      await expect(call(blockedLater.token)).rejects.toMatchObject({ code: 'COMPANY_NOT_APPROVED', status: 403 });
      await t.prisma.company.update({ where: { id: c.companyId }, data: { status: 'APPROVED' } });

      const soon = await invite(c, { expiresInDays: 1 });
      t.clock.advance(86_400_000);
      const fresh = await tokenFor(t, u.userId, 'PRO');
      await expect(t.client(fresh).call(api.invites.accept, { params: { token: soon.token }, body: {} })).rejects.toMatchObject({
        code: 'INVITE_INVALID',
        details: { reason: 'EXPIRED' },
      });
      expect(await t.prisma.companyMember.count({ where: { userId: u.userId } })).toBe(0);
    });

    it('a 1-use invite accepted by two users at once lets exactly one in', async () => {
      const c = await createCompany(t, { workers: 0 });
      const inv = await invite(c, { maxUses: 1 });
      const users = await Promise.all([proUser(t), proUser(t), proUser(t)]);
      const results = await Promise.allSettled(
        users.map((u) => t.client(u.token).call(api.invites.accept, { params: { token: inv.token }, body: {} })),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results.filter((x) => x.status === 'rejected') as PromiseRejectedResult[]) {
        expect(r.reason).toMatchObject({ code: 'INVITE_INVALID', details: { reason: 'USED_UP' } });
      }
      expect((await t.prisma.companyInvite.findUniqueOrThrow({ where: { id: inv.id } })).usedCount).toBe(1);
      expect(await t.prisma.companyMember.count({ where: { companyId: c.companyId, role: 'WORKER' } })).toBe(1);
      expect(await t.prisma.handymanProfile.count({ where: { companyId: c.companyId } })).toBe(1);
    });

    it('one user accepting two WORKER invites of two companies at once joins exactly one (ALREADY_IN_COMPANY, never a 500)', async () => {
      for (let round = 0; round < 3; round++) {
        const a = await createCompany(t, { workers: 0 });
        const b = await createCompany(t, { workers: 0 });
        const [ia, ib] = await Promise.all([invite(a), invite(b)]);
        const u = await proUser(t);
        const results = await Promise.allSettled([
          t.client(u.token).call(api.invites.accept, { params: { token: ia.token }, body: {} }),
          t.client(u.token).call(api.invites.accept, { params: { token: ib.token }, body: {} }),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
        expect(lost.reason).toMatchObject({ code: 'ALREADY_IN_COMPANY', status: 409 });
        expect(await t.prisma.companyMember.count({ where: { userId: u.userId, status: 'ACTIVE' } })).toBe(1);
        expect(await t.prisma.handymanProfile.count({ where: { userId: u.userId } })).toBe(1);
      }
    });

    it('one user accepting two invites of the same company at once joins once', async () => {
      const c = await createCompany(t, { workers: 0 });
      const [i1, i2] = await Promise.all([invite(c), invite(c)]);
      const u = await proUser(t);
      const results = await Promise.allSettled(
        [i1, i2].map((i) => t.client(u.token).call(api.invites.accept, { params: { token: i.token }, body: {} })),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'ALREADY_IN_COMPANY' });
      expect(await t.prisma.companyMember.count({ where: { companyId: c.companyId, userId: u.userId } })).toBe(1);
    });

    it('requires a signed-in user', async () => {
      const c = await createCompany(t, { workers: 0 });
      const inv = await invite(c);
      await expect(t.client().call(api.invites.accept, { params: { token: inv.token }, body: {} })).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
        status: 401,
      });
    });
  });
});
