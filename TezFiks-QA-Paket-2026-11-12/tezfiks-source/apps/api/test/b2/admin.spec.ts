import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { adminToken, BAKU, categoryId, createCompany, createCustomer, createSoloHandyman, tokenFor } from '../helpers/factories';
import { PresenceService } from '../../src/modules/realtime/presence.service';
import { DomainEvents, type DomainEventMap } from '../../src/infra/events';
import { onboardCompany, onboardSolo, proUser } from './helpers';

describe('B2 admin: provider lists, details, block / unblock, strikes, user blocking', () => {
  let t: TestApp;
  let admin: { adminId: string; token: string };
  const blockedEvents: Array<DomainEventMap['user.blocked']> = [];
  beforeAll(async () => {
    t = await createTestApp();
    t.app.get(DomainEvents).on('user.blocked', (e) => {
      blockedEvents.push(e);
    });
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    admin = await adminToken(t);
    blockedEvents.length = 0;
  });

  const A = () => t.client(admin.token);

  describe('handymen list', () => {
    it('tabs with counts, displayStatus, wallet balance only for solos', async () => {
      const active = await createSoloHandyman(t, { balance: 5000, firstName: 'Aktiv' });
      const low = await createSoloHandyman(t, { balance: 300, firstName: 'Kasıb' });
      const pending = await createSoloHandyman(t, { status: 'PENDING_REVIEW', firstName: 'Gözləyən' });
      const blocked = await createSoloHandyman(t, { status: 'BLOCKED', firstName: 'Vüqar', lastName: 'Nəbiyev' });
      const rejected = await createSoloHandyman(t, { status: 'REJECTED' });
      const draft = await createSoloHandyman(t, { status: 'DRAFT' });
      const userBlocked = await createSoloHandyman(t, { balance: 5000 });
      await t.prisma.user.update({ where: { id: userBlocked.userId }, data: { status: 'BLOCKED' } });
      const c = await createCompany(t, { workers: 1, name: 'Kontur Servis' });

      const all = await A().call(api.admin.handymen, { query: {} });
      expect(all.counts).toEqual({ all: 8, pending: 1, blocked: 2 });
      expect(all.items).toHaveLength(8);
      expect(all.nextCursor).toBeNull();
      const by = (id: string) => all.items.find((r) => r.id === id)!;
      expect(by(active.handymanId)).toMatchObject({ displayStatus: 'ACTIVE', walletBalance: 5000, kind: 'SOLO', trades: ['Santexnik'], companyName: null, phone: active.phone });
      expect(by(low.handymanId)).toMatchObject({ displayStatus: 'LOW_BALANCE', walletBalance: 300 });
      expect(by(pending.handymanId).displayStatus).toBe('PENDING');
      expect(by(blocked.handymanId)).toMatchObject({ displayStatus: 'BLOCKED', firstName: 'Vüqar', lastName: 'Nəbiyev' });
      expect(by(rejected.handymanId).displayStatus).toBe('REJECTED');
      expect(by(draft.handymanId).displayStatus).toBe('DRAFT');
      expect(by(userBlocked.handymanId).displayStatus).toBe('BLOCKED');
      expect(by(c.workers[0]!.handymanId)).toMatchObject({ kind: 'COMPANY_WORKER', companyName: 'Kontur Servis', walletBalance: null, displayStatus: 'ACTIVE' });

      const pend = await A().call(api.admin.handymen, { query: { tab: 'pending' } });
      expect(pend.items.map((r) => r.id)).toEqual([pending.handymanId]);
      const blk = await A().call(api.admin.handymen, { query: { tab: 'blocked' } });
      expect(blk.items.map((r) => r.id).sort()).toEqual([blocked.handymanId, userBlocked.handymanId].sort());

      // trade names follow the admin's language
      const en = await t.client(admin.token, 'en').call(api.admin.handymen, { query: { q: 'Aktiv' } });
      expect(en.items[0]!.trades).toEqual(['Plumber']);
    });

    it('search folds Azerbaijani letters ("ismayil" finds "İsmayıl"), phone digits in any format, company names', async () => {
      const ism = await createSoloHandyman(t, { firstName: 'İsmayıl', lastName: 'Şükürov' });
      await createSoloHandyman(t, { firstName: 'Elvin', lastName: 'Məmmədov' });
      const c = await createCompany(t, { workers: 1, name: 'Günəş Təmir' });
      const ids = async (q: string) => (await A().call(api.admin.handymen, { query: { q } })).items.map((r) => r.id);
      expect(await ids('ismayil')).toEqual([ism.handymanId]);
      expect(await ids('ISMAYIL ŞÜKÜR')).toEqual([ism.handymanId]);
      expect(await ids('sukurov')).toEqual([ism.handymanId]);
      expect(await ids('gunes')).toEqual([c.workers[0]!.handymanId]);
      const local = `0${ism.phone.slice(4, 6)} ${ism.phone.slice(6, 9)} ${ism.phone.slice(9, 11)} ${ism.phone.slice(11)}`; // 050 123 45 67
      expect(await ids(local)).toEqual([ism.handymanId]);
      expect(await ids(ism.phone)).toEqual([ism.handymanId]);
      expect(await ids('%')).toEqual([]);
      expect(await ids("x' OR 1=1 --")).toEqual([]);
    });

    it('paginates newest first with a cursor', async () => {
      const made: string[] = [];
      for (let i = 0; i < 5; i++) {
        made.push((await createSoloHandyman(t)).handymanId);
        t.clock.advance(1000);
      }
      // createdAt comes from the DB default for factory rows; order by the actual rows
      const rows = await t.prisma.handymanProfile.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } });
      const p1 = await A().call(api.admin.handymen, { query: { limit: 2 } });
      const p2 = await A().call(api.admin.handymen, { query: { limit: 2, cursor: p1.nextCursor! } });
      const p3 = await A().call(api.admin.handymen, { query: { limit: 2, cursor: p2.nextCursor! } });
      expect([...p1.items, ...p2.items, ...p3.items].map((r) => r.id)).toEqual(rows.map((r) => r.id));
      expect(p3.nextCursor).toBeNull();
      expect(made.sort()).toEqual(rows.map((r) => r.id).sort());
    });

    it('a malformed or crafted cursor is VALIDATION_FAILED, never a server error', async () => {
      await createSoloHandyman(t);
      await createCompany(t, { workers: 0 });
      const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
      const bad = ['%%%not-base64%%%', b64({ c: 'yesterday', i: crypto.randomUUID() }), b64({ c: new Date().toISOString(), i: "1' OR 1=1" }), b64([1, 2]), b64('x')];
      for (const cursor of bad) {
        await expect(A().call(api.admin.handymen, { query: { cursor } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
        await expect(A().call(api.admin.companies, { query: { cursor } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
      }
    });
  });

  describe('handyman detail, block / unblock, strikes', () => {
    it('detail shows recent assignments (with phones for admins), strikes, wallet; clearStrikes resets them', async () => {
      const h = await createSoloHandyman(t, { balance: 4000 });
      const customer = await createCustomer(t, { firstName: 'Nizami', lastName: 'Talıbov' });
      const req = await t.prisma.serviceRequest.create({
        data: {
          customerAccountId: customer.accountId,
          createdByUserId: customer.userId,
          categoryId: await categoryId(t, 'plumbing'),
          vertical: 'HOME',
          description: 'Kran',
          timing: 'NOW',
          lat: BAKU.center.lat,
          lng: BAKU.center.lng,
          cell7: latLngToCell(BAKU.center.lat, BAKU.center.lng, 7),
          cell9: latLngToCell(BAKU.center.lat, BAKU.center.lng, 9),
          formatted: 'Nizami küçəsi 10',
          status: 'CANCELLED',
          isSearching: false,
        },
      });
      const slot = await t.prisma.requestSlot.create({ data: { requestId: req.id, index: 0, status: 'CANCELLED' } });
      const now = t.clock.now();
      const a = await t.prisma.assignment.create({
        data: {
          requestId: req.id,
          slotId: slot.id,
          providerType: 'SOLO',
          handymanId: h.handymanId,
          acceptedByUserId: h.userId,
          status: 'CANCELLED_BY_PROVIDER',
          acceptedAt: now,
          freeCancelUntil: now,
          cancelledAt: now,
          cancelledBy: 'PROVIDER',
          feeAmount: 1000n,
          feeCaptured: true,
        },
      });
      await t.prisma.strikeEvent.create({ data: { handymanId: h.handymanId, assignmentId: a.id, reason: 'LATE_PROVIDER_CANCEL' } });
      await t.prisma.handymanProfile.update({ where: { id: h.handymanId }, data: { strikes: 1 } });

      const d = await A().call(api.admin.handyman, { params: { id: h.handymanId } });
      expect(d).toMatchObject({ serviceRadiusKm: 10, base: BAKU.center, kyc: null, wallet: { posted: 4000 }, earningsBalance: 0, row: { strikes: 1 } });
      expect(d.recentAssignments).toEqual([
        expect.objectContaining({
          id: a.id,
          requestNumber: req.number,
          status: 'CANCELLED_BY_PROVIDER',
          providerPhone: h.phone,
          customerName: 'Nizami Talıbov',
          customerPhone: customer.phone,
          fee: { amount: 1000, captured: true, refunded: false },
          price: null,
        }),
      ]);
      expect(d.strikes).toEqual([expect.objectContaining({ reason: 'LATE_PROVIDER_CANCEL', requestNumber: req.number, clearedAt: null })]);

      const cleared = await A().call(api.admin.clearStrikes, { params: { id: h.handymanId } });
      expect(cleared.row.strikes).toBe(0);
      expect(cleared.strikes[0]!.clearedAt).not.toBeNull();
      const ev = await t.prisma.strikeEvent.findFirstOrThrow({ where: { handymanId: h.handymanId } });
      expect(ev.clearedByAdminId).toBe(admin.adminId);
      expect(await t.prisma.auditLog.count({ where: { action: 'handyman.clearStrikes', entityId: h.handymanId } })).toBe(1);
    });

    it('block (any state) takes the handyman offline and notifies; unblock restores APPROVED or DRAFT', async () => {
      const h = await createSoloHandyman(t, { balance: 5000 });
      await t.client(h.token).call(api.pro.setOnline, { body: { online: true, location: BAKU.center } });
      const presence = t.app.get(PresenceService);
      expect((await presence.get(h.handymanId))?.online).toBe(true);

      const d = await A().call(api.admin.blockHandyman, { params: { id: h.handymanId }, body: { reason: 'Saxta sənəd' } });
      expect(d.row).toMatchObject({ status: 'BLOCKED', displayStatus: 'BLOCKED', isOnline: false });
      expect((await presence.get(h.handymanId))?.online ?? false).toBe(false);
      const note = await t.prisma.notification.findFirstOrThrow({ where: { userId: h.userId, type: 'ACCOUNT_BLOCKED' } });
      expect(note.body).toContain('Saxta sənəd');
      expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: h.handymanId } })).blockedReason).toBe('Saxta sənəd');
      await expect(A().call(api.admin.blockHandyman, { params: { id: h.handymanId }, body: { reason: 'yenə' } })).rejects.toMatchObject({
        code: 'INVALID_STATE',
        status: 409,
      });
      // the blocked pro's PRO session is revoked
      await expect(t.client(h.token).call(api.pro.profile)).rejects.toMatchObject({ code: 'SESSION_REVOKED', status: 401 });

      const un = await A().call(api.admin.unblockHandyman, { params: { id: h.handymanId } });
      expect(un.row.status).toBe('APPROVED');
      await expect(A().call(api.admin.unblockHandyman, { params: { id: h.handymanId } })).rejects.toMatchObject({ code: 'INVALID_STATE' });

      const u = await proUser(t);
      const draft = await onboardSolo(t, u);
      await A().call(api.admin.blockHandyman, { params: { id: draft.id }, body: { reason: 'Spam hesab' } });
      expect((await A().call(api.admin.unblockHandyman, { params: { id: draft.id } })).row.status).toBe('DRAFT');

      const actions = (await t.prisma.auditLog.findMany({ where: { actorId: admin.adminId }, orderBy: { at: 'asc' } })).map((x) => x.action);
      expect(actions).toEqual(['handyman.block', 'handyman.unblock', 'handyman.block', 'handyman.unblock']);
    });
  });

  describe('companies', () => {
    it('list with tabs, counts and search by name (folded), VÖEN and owner', async () => {
      const a = await createCompany(t, { name: 'Şirin Su MMC', voen: '1402345678', workers: 2, balance: 2500 });
      const b = await createCompany(t, { name: 'Kontur MMC', voen: '1502345678', workers: 0, status: 'BLOCKED' });
      const m = await proUser(t);
      const pendingCo = await onboardCompany(t, m, { name: 'Yeni Usta' });
      await t.prisma.company.update({ where: { id: pendingCo.id }, data: { status: 'PENDING_REVIEW' } });

      const all = await A().call(api.admin.companies, { query: {} });
      expect(all.counts).toEqual({ all: 3, pending: 1, blocked: 1 });
      const rowA = all.items.find((r) => r.id === a.companyId)!;
      expect(rowA).toMatchObject({ name: 'Şirin Su MMC', voen: '1402345678', legalForm: 'MMC', status: 'APPROVED', ownerName: 'Fuad İdarəçi', ownerPhone: a.manager.phone, membersCount: 3, walletBalance: 2500 });
      const ids = async (q?: string, tab?: 'all' | 'pending' | 'blocked') =>
        (await A().call(api.admin.companies, { query: { ...(q ? { q } : {}), ...(tab ? { tab } : {}) } })).items.map((r) => r.id);
      expect(await ids('sirin su')).toEqual([a.companyId]);
      expect(await ids('150234')).toEqual([b.companyId]);
      expect(await ids(undefined, 'pending')).toEqual([pendingCo.id]);
      expect(await ids(undefined, 'blocked')).toEqual([b.companyId]);
      expect(await ids('idareci')).toHaveLength(3);

      const d = await A().call(api.admin.company, { params: { id: a.companyId } });
      expect(d).toMatchObject({ finalPriceEntry: 'WORKER', isVatPayer: false, trades: ['Elektrik'], kyc: null, wallet: { posted: 2500 }, earningsBalance: 0, strikes: [] });
      expect(d.members).toHaveLength(3);
      expect(d.members.map((x) => x.phone)).toContain(a.workers[0]!.phone);
    });

    it('block company: workers offline, members notified; unblock -> APPROVED (or DRAFT if never approved)', async () => {
      const c = await createCompany(t, { workers: 2, balance: 5000 });
      await t.client(c.workers[0]!.token).call(api.pro.setOnline, { body: { online: true } });
      const d = await A().call(api.admin.blockCompany, { params: { id: c.companyId }, body: { reason: 'Şikayətlər' } });
      expect(d.row.status).toBe('BLOCKED');
      expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: c.workers[0]!.handymanId } })).isOnline).toBe(false);
      expect((await t.app.get(PresenceService).get(c.workers[0]!.handymanId))?.online ?? false).toBe(false);
      expect(await t.prisma.notification.count({ where: { type: 'ACCOUNT_BLOCKED', data: { path: ['companyId'], equals: c.companyId } } })).toBe(3);
      await expect(A().call(api.admin.blockCompany, { params: { id: c.companyId }, body: { reason: 'yenə' } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
      const fresh = await tokenFor(t, c.workers[1]!.userId, 'PRO');
      await expect(t.client(fresh).call(api.pro.setOnline, { body: { online: true } })).rejects.toMatchObject({ code: 'COMPANY_NOT_APPROVED' });

      expect((await A().call(api.admin.unblockCompany, { params: { id: c.companyId } })).row.status).toBe('APPROVED');
      await expect(A().call(api.admin.unblockCompany, { params: { id: c.companyId } })).rejects.toMatchObject({ code: 'INVALID_STATE' });

      const m = await proUser(t);
      const draft = await onboardCompany(t, m);
      await A().call(api.admin.blockCompany, { params: { id: draft.id }, body: { reason: 'Saxta VÖEN' } });
      expect((await A().call(api.admin.unblockCompany, { params: { id: draft.id } })).row.status).toBe('DRAFT');
      expect(await t.prisma.auditLog.count({ where: { entityType: 'Company' } })).toBe(4);
    });
  });

  describe('user blocking', () => {
    it('blockUser revokes every session (refresh too), takes the pro offline; unblockUser lets them log in again', async () => {
      const h = await createSoloHandyman(t, { balance: 5000 });
      const refresh = await t.sessions.createUserSession(h.userId, 'CUSTOMER', { deviceId: 'device-b2-0001' });
      await t.client(h.token).call(api.pro.setOnline, { body: { online: true } });

      expect(await A().call(api.admin.blockUser, { params: { id: h.userId }, body: { reason: 'Fırıldaqçılıq' } })).toEqual({ ok: true });
      const user = await t.prisma.user.findUniqueOrThrow({ where: { id: h.userId } });
      expect(user).toMatchObject({ status: 'BLOCKED', blockedReason: 'Fırıldaqçılıq' });
      expect(await t.prisma.session.count({ where: { userId: h.userId, revokedAt: null } })).toBe(0);
      await expect(t.client(h.token).call(api.pro.profile)).rejects.toMatchObject({ status: 401 });
      await expect(t.client().call(api.auth.refresh, { body: { refreshToken: refresh.refreshToken } })).rejects.toMatchObject({ status: 401 });
      expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: h.handymanId } })).isOnline).toBe(false);
      expect((await t.app.get(PresenceService).get(h.handymanId))?.online ?? false).toBe(false);
      await expect(A().call(api.admin.blockUser, { params: { id: h.userId }, body: { reason: 'yenə' } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
      // a new session for a blocked user is refused at once
      const blockedToken = await tokenFor(t, h.userId, 'PRO');
      await expect(t.client(blockedToken).call(api.pro.profile)).rejects.toMatchObject({ code: 'USER_BLOCKED', status: 403 });

      expect(await A().call(api.admin.unblockUser, { params: { id: h.userId } })).toEqual({ ok: true });
      await expect(A().call(api.admin.unblockUser, { params: { id: h.userId } })).rejects.toMatchObject({ code: 'INVALID_STATE' });
      t.sessions.invalidateCache();
      const again = await tokenFor(t, h.userId, 'PRO');
      expect((await t.client(again).call(api.pro.profile)).profile?.id).toBe(h.handymanId);
      const audit = await t.prisma.auditLog.findMany({ where: { entityType: 'User', entityId: h.userId }, orderBy: { at: 'asc' } });
      expect(audit.map((x) => x.action)).toEqual(['user.block', 'user.unblock']);
      // the domain event other modules (and the realtime gateway) listen to was emitted exactly once, for the block
      expect(blockedEvents).toEqual([{ userId: h.userId, reason: 'Fırıldaqçılıq' }]);
    });

    it('OPERATOR admins may review too; users never', async () => {
      const op = await adminToken(t, { role: 'OPERATOR' });
      const h = await createSoloHandyman(t, { status: 'PENDING_REVIEW' });
      const d = await t.client(op.token).call(api.admin.approveHandyman, { params: { id: h.handymanId }, body: {} });
      expect(d.row.status).toBe('APPROVED');
      const c = await createCustomer(t);
      await expect(t.client(c.token).call(api.admin.blockUser, { params: { id: h.userId }, body: { reason: 'test' } })).rejects.toMatchObject({
        code: 'FORBIDDEN',
        status: 403,
      });
    });
  });
});
