import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { latLngToCell } from 'h3-js';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { adminToken, BAKU, categoryId, createCompany, createCustomer, createSoloHandyman, createUser, tokenFor } from '../helpers/factories';
import { loadEnv } from '../../src/config/env';
import { FilesService, FILES_PURGE_JOB, KYC_URL_MAX_TTL_SEC } from '../../src/modules/files/files.service';
import { hashPassword } from '../../src/common/auth/password';
import { azPhone, createAssignment, localUrl, otpLogin, pngBuffer, upload } from './helpers';

// Review fixes for lane A1: HEIC decoding, URL lifetimes, Clock-based timestamps, photo re-selection vs purge,
// account deletion edge cases and the admin-login rate-limit window.
describe('A1 hardening', () => {
  let t: TestApp;
  let files: FilesService;
  beforeAll(async () => {
    t = await createTestApp();
    files = t.app.get(FilesService);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });

  async function user() {
    const u = await createUser(t);
    return { ...u, token: await tokenFor(t, u.userId) };
  }

  describe('HEIC/HEIF uploads', () => {
    // 96x64 HEIC (HEVC, as written by iPhones) generated with libheif/x265: left half red, right half blue.
    const heic = readFileSync(join(__dirname, 'fixtures', 'sample.heic'));

    it('the fixture is a real HEVC HEIC that prebuilt sharp cannot decode by itself', async () => {
      const meta = await sharp(heic).metadata();
      expect(meta).toMatchObject({ format: 'heif', compression: 'hevc', width: 96, height: 64 });
      await expect(sharp(heic).jpeg().toBuffer()).rejects.toThrow();
    });

    it('accepts an iPhone HEIC (image/heic and image/heif) and re-encodes it to JPEG with the right pixels', async () => {
      const u = await user();
      for (const type of ['image/heic', 'image/heif']) {
        const ref = await upload(t, u.token, 'REQUEST_PHOTO', { buffer: heic, type, name: 'IMG_0001.HEIC' });
        expect(ref).toMatchObject({ kind: 'REQUEST_PHOTO', contentType: 'image/jpeg', width: 96, height: 64 });
        const res = await fetch(localUrl(t, ref.url));
        expect(res.status).toBe(200);
        const bytes = Buffer.from(await res.arrayBuffer());
        expect((await sharp(bytes).metadata()).format).toBe('jpeg');
        const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
        const px = (x: number, y: number) => {
          const i = (y * info.width + x) * info.channels;
          return [data[i]!, data[i + 1]!, data[i + 2]!];
        };
        const [lr, , lb] = px(10, 32);
        const [rr, , rb] = px(86, 32);
        expect(lr).toBeGreaterThan(180);
        expect(lb).toBeLessThan(80);
        expect(rb).toBeGreaterThan(180);
        expect(rr).toBeLessThan(80);
      }
      expect(await t.prisma.file.count({ where: { ownerUserId: u.userId } })).toBe(2);
    });

    it('accepts AVIF-coded HEIF through sharp directly', async () => {
      const u = await user();
      const avif = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#00A971' } }).heif({ compression: 'av1' }).toBuffer();
      await expect(upload(t, u.token, 'CASE_PHOTO', { buffer: avif, type: 'image/heif', name: 'a.heif' })).resolves.toMatchObject({
        contentType: 'image/jpeg',
        width: 32,
        height: 24,
      });
    });

    it('rejects a corrupted HEIC with FILE_TYPE_NOT_ALLOWED and stores nothing', async () => {
      const u = await user();
      const broken = Buffer.concat([heic.subarray(0, 200), Buffer.alloc(200, 7)]);
      await expect(upload(t, u.token, 'REQUEST_PHOTO', { buffer: broken, type: 'image/heic', name: 'x.heic' })).rejects.toMatchObject({
        code: 'FILE_TYPE_NOT_ALLOWED',
        status: 415,
      });
      expect(await t.prisma.file.count()).toBe(0);
    });
  });

  describe('signed URL lifetime', () => {
    it('never exceeds FILE_URL_TTL_SEC for normal files and lasts at least half of it', async () => {
      const ttl = loadEnv().FILE_URL_TTL_SEC;
      const u = await user();
      const before = Math.floor(t.clock.nowMs() / 1000);
      const ref = await upload(t, u.token, 'REQUEST_PHOTO');
      const after = Math.ceil(t.clock.nowMs() / 1000);
      const exp = Number(new URL(ref.url).searchParams.get('exp'));
      expect(exp).toBeLessThanOrEqual(after + ttl);
      expect(exp).toBeGreaterThanOrEqual(before + Math.floor(ttl / 2));
      // stable for caching: a second ref right away gives the same URL
      expect((await files.ref(ref.id)).url).toBe(ref.url);
    });

    it('KYC admin URLs last at most 10 minutes', async () => {
      const u = await user();
      const ref = await upload(t, u.token, 'KYC_SELFIE');
      const admin = await adminToken(t);
      const before = Math.floor(t.clock.nowMs() / 1000);
      const adminRef = await files.ref(ref.id, { adminId: admin.adminId });
      const exp = Number(new URL(adminRef.url).searchParams.get('exp'));
      expect(exp - before).toBeLessThanOrEqual(KYC_URL_MAX_TTL_SEC + 1);
      expect(exp - before).toBeGreaterThanOrEqual(KYC_URL_MAX_TTL_SEC - 1);
      expect(KYC_URL_MAX_TTL_SEC).toBe(600);
      expect((await fetch(localUrl(t, adminRef.url))).status).toBe(200);
      t.clock.advance((KYC_URL_MAX_TTL_SEC + 2) * 1000);
      const res = await fetch(localUrl(t, adminRef.url));
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error: { details: { reason: string } } }).error.details.reason).toBe('EXPIRED');
      expect(await t.prisma.kycAccessLog.count()).toBe(1);
    });
  });

  describe('timestamps come from the Clock', () => {
    it('new users and uploaded files get createdAt from Clock.now()', async () => {
      t.clock.advance(10 * 86_400_000);
      const before = t.clock.nowMs();
      const login = await otpLogin(t, azPhone(4242));
      const afterLogin = t.clock.nowMs();
      expect(login.isNewUser).toBe(true);
      const created = Date.parse(login.me.createdAt);
      expect(created).toBeGreaterThanOrEqual(before);
      expect(created).toBeLessThanOrEqual(afterLogin);

      const ref = await upload(t, login.tokens.accessToken, 'REQUEST_PHOTO');
      const row = await t.prisma.file.findUniqueOrThrow({ where: { id: ref.id } });
      expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(afterLogin);
      expect(row.createdAt.getTime()).toBeLessThanOrEqual(t.clock.nowMs());
    });
  });

  describe('profile photo re-selection', () => {
    it('choosing a previously replaced photo again cancels its purge', async () => {
      const u = await user();
      const c = t.client(u.token);
      const a = await upload(t, u.token, 'PROFILE_PHOTO');
      const b = await upload(t, u.token, 'PROFILE_PHOTO');
      await c.call(api.me.update, { body: { photoFileId: a.id } });
      await c.call(api.me.update, { body: { photoFileId: b.id } });
      expect((await t.prisma.file.findUniqueOrThrow({ where: { id: a.id } })).purgeAfter).not.toBeNull();

      const me = await c.call(api.me.update, { body: { photoFileId: a.id } });
      expect(me.photo?.id).toBe(a.id);
      expect((await t.prisma.file.findUniqueOrThrow({ where: { id: a.id } })).purgeAfter).toBeNull();
      // b is now the replaced one
      expect((await t.prisma.file.findUniqueOrThrow({ where: { id: b.id } })).purgeAfter).not.toBeNull();

      t.clock.advance(1000);
      await t.jobs.runNow(FILES_PURGE_JOB, {});
      await t.reconciler.tickAll();
      const userRow = await t.prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
      expect(userRow.photoFileId).toBe(a.id);
      expect((await t.prisma.file.findUniqueOrThrow({ where: { id: a.id } })).deletedAt).toBeNull();
      expect((await t.prisma.file.findUniqueOrThrow({ where: { id: b.id } })).deletedAt).not.toBeNull();
      const again = await c.call(api.me.get);
      expect(again.photo?.id).toBe(a.id);
      expect((await fetch(localUrl(t, again.photo!.url))).status).toBe(200);
    });
  });

  describe('account deletion', () => {
    it('is refused while a request is SEARCHING or IN_PROGRESS', async () => {
      const customer = await createCustomer(t);
      const handyman = await createSoloHandyman(t);
      const { requestId, assignmentId } = await createAssignment(t, customer, handyman, 'COMPLETED');
      await t.prisma.assignment.update({ where: { id: assignmentId }, data: { status: 'COMPLETED' } });
      for (const status of ['SEARCHING', 'IN_PROGRESS', 'ASSIGNED'] as const) {
        await t.prisma.serviceRequest.update({ where: { id: requestId }, data: { status } });
        await expect(t.client(customer.token).call(api.me.deleteAccount)).rejects.toMatchObject({
          code: 'INVALID_STATE',
          status: 409,
          details: { reason: 'OPEN_REQUEST', requestId },
        });
      }
      const row = await t.prisma.user.findUniqueOrThrow({ where: { id: customer.userId } });
      expect(row.status).toBe('ACTIVE');
      expect(row.phone).toBe(customer.phone);
      for (const status of ['COMPLETED', 'CANCELLED'] as const) {
        await t.prisma.serviceRequest.update({ where: { id: requestId }, data: { status } });
      }
      await expect(t.client(customer.token).call(api.me.deleteAccount)).resolves.toEqual({ ok: true });
    });

    it('refuses the last active manager of a company with an active job; allowed with another manager or no active job', async () => {
      const company = await createCompany(t, { workers: 1 });
      const customer = await createCustomer(t);
      const worker = company.workers[0]!;
      const now = t.clock.now();
      const request = await t.prisma.serviceRequest.create({
        data: {
          customerAccountId: customer.accountId,
          createdByUserId: customer.userId,
          categoryId: await categoryId(t, 'electrical'),
          vertical: 'HOME',
          description: 'İşıq yoxdur',
          timing: 'NOW',
          lat: BAKU.center.lat,
          lng: BAKU.center.lng,
          cell7: latLngToCell(BAKU.center.lat, BAKU.center.lng, 7),
          cell9: latLngToCell(BAKU.center.lat, BAKU.center.lng, 9),
          formatted: 'Füzuli küçəsi 5, Bakı',
          status: 'ASSIGNED',
          isSearching: false,
        },
      });
      const slot = await t.prisma.requestSlot.create({ data: { requestId: request.id, index: 0, status: 'FILLED' } });
      const assignment = await t.prisma.assignment.create({
        data: {
          requestId: request.id,
          slotId: slot.id,
          providerType: 'COMPANY',
          companyId: company.companyId,
          handymanId: worker.handymanId,
          acceptedByUserId: worker.userId,
          status: 'EN_ROUTE',
          acceptedAt: now,
          freeCancelUntil: new Date(now.getTime() + 300_000),
        },
      });

      await expect(t.client(company.manager.token).call(api.me.deleteAccount)).rejects.toMatchObject({
        code: 'INVALID_STATE',
        details: { reason: 'COMPANY_ACTIVE_ASSIGNMENT', companyId: company.companyId, assignmentId: assignment.id },
      });
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: company.manager.userId } })).status).toBe('ACTIVE');

      // a second active manager takes over: the first one may leave
      const second = await createUser(t, { firstName: 'Günay', lastName: 'Məmmədova' });
      await t.prisma.companyMember.create({ data: { companyId: company.companyId, userId: second.userId, role: 'MANAGER' } });
      await expect(t.client(company.manager.token).call(api.me.deleteAccount)).resolves.toEqual({ ok: true });

      // the now-last manager is refused until the job ends
      const secondToken = await tokenFor(t, second.userId, 'PRO');
      await expect(t.client(secondToken).call(api.me.deleteAccount)).rejects.toMatchObject({
        code: 'INVALID_STATE',
        details: { reason: 'COMPANY_ACTIVE_ASSIGNMENT' },
      });
      await t.prisma.assignment.update({ where: { id: assignment.id }, data: { status: 'COMPLETED' } });
      await t.prisma.serviceRequest.update({ where: { id: request.id }, data: { status: 'COMPLETED' } });
      await expect(t.client(secondToken).call(api.me.deleteAccount)).resolves.toEqual({ ok: true });
    });

    it('purges personal files at once but keeps photos that belong to other parties’ records', async () => {
      const u = await user();
      const personal = [
        await upload(t, u.token, 'PROFILE_PHOTO'),
        await upload(t, u.token, 'REQUEST_PHOTO'),
        await upload(t, u.token, 'KYC_ID_FRONT'),
        await upload(t, u.token, 'KYC_SELFIE'),
      ];
      const kept = [
        await upload(t, u.token, 'REPORT_PHOTO'),
        await upload(t, u.token, 'CASE_PHOTO'),
        await upload(t, u.token, 'COMPANY_DOC', { buffer: await pngBuffer(8, 8) }),
      ];
      await t.client(u.token).call(api.me.deleteAccount);
      t.clock.advance(1000);
      await t.jobs.runNow(FILES_PURGE_JOB, {});
      for (const f of personal) {
        expect((await t.prisma.file.findUniqueOrThrow({ where: { id: f.id } })).deletedAt).not.toBeNull();
      }
      for (const f of kept) {
        const row = await t.prisma.file.findUniqueOrThrow({ where: { id: f.id } });
        expect(row.deletedAt).toBeNull();
        expect(row.purgeAfter).toBeNull();
        await expect(files.read(f.id)).resolves.toMatchObject({ contentType: 'image/jpeg' });
      }
    });

    it('two simultaneous deletions of the same account both end in one consistent DELETED state', async () => {
      const u = await user();
      const c = t.client(u.token);
      const results = await Promise.allSettled([c.call(api.me.deleteAccount), c.call(api.me.deleteAccount)]);
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
      const row = await t.prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
      expect(row).toMatchObject({ status: 'DELETED', phone: `deleted:${u.userId}` });
      expect(await t.prisma.session.count({ where: { userId: u.userId, revokedAt: null } })).toBe(0);
    });
  });

  describe('admin login rate-limit window', () => {
    it('reports retryAfterSec within the 15-minute window and lets the admin in once the window has passed', async () => {
      await t.prisma.adminUser.create({
        data: { email: 'win@tezfiks.az', passwordHash: await hashPassword('Doğru-Parol-123'), name: 'Pəncərə', role: 'ADMIN' },
      });
      const ip = { 'X-Forwarded-For': '10.7.7.7' };
      for (let i = 0; i < 10; i++) {
        await expect(
          t.client().call(api.auth.adminLogin, { body: { email: 'win@tezfiks.az', password: `bad-${i}` }, headers: ip }),
        ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      }
      const limited = t.client().call(api.auth.adminLogin, { body: { email: 'win@tezfiks.az', password: 'Doğru-Parol-123' }, headers: ip });
      await expect(limited).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      const err = (await limited.catch((e: unknown) => e)) as { details: { retryAfterSec: number } };
      expect(err.details.retryAfterSec).toBeGreaterThan(0);
      expect(err.details.retryAfterSec).toBeLessThanOrEqual(15 * 60);

      // the counter lives in Redis with a 15-minute TTL; let the window elapse
      const keys = await t.redis.client.keys('*admin-login*');
      expect(keys).toHaveLength(1);
      const ttl = await t.redis.client.ttl(keys[0]!);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(15 * 60);
      await t.redis.client.pexpire(keys[0]!, 1);
      await new Promise((r) => setTimeout(r, 20));
      await expect(
        t.client().call(api.auth.adminLogin, { body: { email: 'win@tezfiks.az', password: 'Doğru-Parol-123' }, headers: ip }),
      ).resolves.toMatchObject({ admin: { email: 'win@tezfiks.az' } });
    });
  });
});
