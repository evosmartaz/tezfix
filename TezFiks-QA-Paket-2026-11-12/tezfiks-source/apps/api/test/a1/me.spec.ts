import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { createCompany, createCustomer, createSoloHandyman, createUser, tokenFor } from '../helpers/factories';
import { MeService } from '../../src/modules/users/me.service';
import { azPhone, createAssignment, otpLogin, upload } from './helpers';

describe('A1 /me: profile, devices, account deletion', () => {
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

  describe('get', () => {
    it('returns customer, handyman and active company memberships with company status', async () => {
      const company = await createCompany(t, { name: 'Usta Şirkəti MMC', workers: 1 });
      const managerMe = await t.client(company.manager.token).call(api.me.get);
      expect(managerMe).toMatchObject({
        id: company.manager.userId,
        firstName: 'Fuad',
        lastName: 'İdarəçi',
        profileComplete: true,
        customer: null,
        handyman: null,
        companies: [{ companyId: company.companyId, companyName: 'Usta Şirkəti MMC', role: 'MANAGER', companyStatus: 'APPROVED' }],
      });
      const worker = company.workers[0]!;
      const workerMe = await t.client(worker.token).call(api.me.get);
      expect(workerMe.handyman).toEqual({
        id: worker.handymanId,
        kind: 'COMPANY_WORKER',
        status: 'APPROVED',
        companyId: company.companyId,
        isOnline: false,
      });
      expect(workerMe.companies).toEqual([
        { companyId: company.companyId, companyName: 'Usta Şirkəti MMC', role: 'WORKER', companyStatus: 'APPROVED' },
      ]);
      // removed memberships are not listed
      await t.prisma.companyMember.updateMany({ where: { userId: worker.userId }, data: { status: 'REMOVED' } });
      expect((await t.client(worker.token).call(api.me.get)).companies).toEqual([]);

      const customer = await createCustomer(t, { type: 'COMPANY', companyName: 'Kontur MMC' });
      const cm = await t.client(customer.token).call(api.me.get);
      expect(cm.customer).toEqual({ id: customer.accountId, type: 'COMPANY', companyName: 'Kontur MMC' });
      expect(cm.photo).toBeNull();

      const solo = await createSoloHandyman(t, { online: true });
      const sm = await t.app.get(MeService).getMe(solo.userId);
      expect(sm.handyman).toMatchObject({ id: solo.handymanId, kind: 'SOLO', companyId: null, isOnline: true });
    });
  });

  describe('update', () => {
    it('round-trips Azerbaijani names (ə ı İ ş ç ğ ö ü) and changes the locale', async () => {
      const login = await otpLogin(t, azPhone(1));
      expect(login.me.profileComplete).toBe(false);
      const c = t.client(login.tokens.accessToken);
      const out = await c.call(api.me.update, { body: { firstName: '  İlqar ', lastName: 'Qəhrəmanlı-Şükürov' } });
      expect(out).toMatchObject({ firstName: 'İlqar', lastName: 'Qəhrəmanlı-Şükürov', profileComplete: true });
      const out2 = await c.call(api.me.update, { body: { firstName: 'Gülçöhrə', locale: 'en' } });
      expect(out2).toMatchObject({ firstName: 'Gülçöhrə', lastName: 'Qəhrəmanlı-Şükürov', locale: 'en' });
      const row = await t.prisma.user.findUniqueOrThrow({ where: { id: login.me.id } });
      expect(row.firstName).toBe('Gülçöhrə');
      expect(row.lastName).toBe('Qəhrəmanlı-Şükürov');
      await expect(c.call(api.me.update, { body: { firstName: '   ' } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
      await expect(c.call(api.me.update, { body: { locale: 'tr' as never } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('sets the profile photo only from the caller own PROFILE_PHOTO files; null removes it', async () => {
      const u = await createUser(t);
      const token = await tokenFor(t, u.userId);
      const photo = await upload(t, token, 'PROFILE_PHOTO');
      const me = await t.client(token).call(api.me.update, { body: { photoFileId: photo.id } });
      expect(me.photo).toMatchObject({ id: photo.id, kind: 'PROFILE_PHOTO', contentType: 'image/jpeg' });
      expect(me.photo!.url).toContain(`/files/${photo.id}?exp=`);

      const requestPhoto = await upload(t, token, 'REQUEST_PHOTO');
      await expect(t.client(token).call(api.me.update, { body: { photoFileId: requestPhoto.id } })).rejects.toMatchObject({
        code: 'FILE_NOT_OWNED',
        status: 403,
      });
      const other = await createUser(t);
      const otherToken = await tokenFor(t, other.userId);
      const foreign = await upload(t, otherToken, 'PROFILE_PHOTO');
      await expect(t.client(token).call(api.me.update, { body: { photoFileId: foreign.id } })).rejects.toMatchObject({ code: 'FILE_NOT_OWNED' });
      await expect(
        t.client(token).call(api.me.update, { body: { photoFileId: '0199f0f0-0000-7000-8000-00000000abcd' } }),
      ).rejects.toMatchObject({ code: 'FILE_NOT_OWNED' });

      // replacing the photo schedules the previous one for purge
      const second = await upload(t, token, 'PROFILE_PHOTO');
      await t.client(token).call(api.me.update, { body: { photoFileId: second.id } });
      expect((await t.prisma.file.findUniqueOrThrow({ where: { id: photo.id } })).purgeAfter).not.toBeNull();

      const cleared = await t.client(token).call(api.me.update, { body: { photoFileId: null } });
      expect(cleared.photo).toBeNull();
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: u.userId } })).photoFileId).toBeNull();
    });
  });

  describe('devices', () => {
    it('upserts by (user, device, app) and moves a push token to its new owner', async () => {
      const u = await createUser(t);
      const token = await tokenFor(t, u.userId);
      const c = t.client(token);
      const body = { deviceId: 'android-device-1', app: 'CUSTOMER' as const, platform: 'android' as const, pushToken: 'ExponentPushToken[aaa]', pushProvider: 'EXPO' as const };
      await expect(c.call(api.me.registerDevice, { body })).resolves.toEqual({ ok: true });
      await c.call(api.me.registerDevice, { body: { ...body, pushToken: 'ExponentPushToken[bbb]', appVersion: '1.0.3' } });
      const rows = await t.prisma.device.findMany({ where: { userId: u.userId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ pushToken: 'ExponentPushToken[bbb]', appVersion: '1.0.3', platform: 'android', pushProvider: 'EXPO' });

      await c.call(api.me.registerDevice, { body: { ...body, app: 'PRO', pushToken: 'ExponentPushToken[ccc]' } });
      expect(await t.prisma.device.count({ where: { userId: u.userId } })).toBe(2);

      // the same phone now signed in by another user: the token follows the new user
      const other = await createUser(t);
      const otherToken = await tokenFor(t, other.userId);
      await t.client(otherToken).call(api.me.registerDevice, { body: { ...body, pushToken: 'ExponentPushToken[bbb]' } });
      const old = await t.prisma.device.findFirstOrThrow({ where: { userId: u.userId, app: 'CUSTOMER' } });
      expect(old.pushToken).toBeNull();
      const moved = await t.prisma.device.findFirstOrThrow({ where: { userId: other.userId } });
      expect(moved.pushToken).toBe('ExponentPushToken[bbb]');

      await expect(c.call(api.me.registerDevice, { body: { ...body, deviceId: 'short' } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('delete account', () => {
    it('anonymizes the user, kills tokens, deletes devices, schedules files, and lets the phone register again', async () => {
      const phone = azPhone(5);
      const login = await otpLogin(t, phone);
      const c = t.client(login.tokens.accessToken);
      await c.call(api.me.update, { body: { firstName: 'Səbinə', lastName: 'Hüseynova' } });
      const photo = await upload(t, login.tokens.accessToken, 'PROFILE_PHOTO');
      await c.call(api.me.update, { body: { photoFileId: photo.id } });
      await c.call(api.me.registerDevice, {
        body: { deviceId: 'android-device-9', app: 'CUSTOMER', platform: 'android', pushToken: 'tok', pushProvider: 'FCM' },
      });

      await expect(c.call(api.me.deleteAccount)).resolves.toEqual({ ok: true });

      const row = await t.prisma.user.findUniqueOrThrow({ where: { id: login.me.id } });
      expect(row).toMatchObject({ phone: `deleted:${login.me.id}`, firstName: null, lastName: null, photoFileId: null, status: 'DELETED' });
      expect(row.deletedAt).not.toBeNull();
      expect(await t.prisma.device.count({ where: { userId: login.me.id } })).toBe(0);
      expect(await t.prisma.session.count({ where: { userId: login.me.id, revokedAt: null } })).toBe(0);
      const file = await t.prisma.file.findUniqueOrThrow({ where: { id: photo.id } });
      expect(file.purgeAfter!.getTime()).toBeLessThanOrEqual(t.clock.nowMs());

      await expect(c.call(api.me.get)).rejects.toMatchObject({ status: 401 });
      await expect(t.client().call(api.auth.refresh, { body: { refreshToken: login.tokens.refreshToken } })).rejects.toMatchObject({
        status: 401,
      });

      t.clock.advance(61_000); // past the per-phone resend cooldown
      const again = await otpLogin(t, phone);
      expect(again.isNewUser).toBe(true);
      expect(again.me.id).not.toBe(login.me.id);
      expect(again.me.firstName).toBeNull();
    });

    it('takes a handyman offline', async () => {
      const h = await createSoloHandyman(t, { online: true });
      await t.client(h.token).call(api.me.deleteAccount);
      const p = await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: h.handymanId } });
      expect(p.isOnline).toBe(false);
    });

    it('is refused with INVALID_STATE while the user has an active job as customer or as handyman, or an open request', async () => {
      const customer = await createCustomer(t);
      const handyman = await createSoloHandyman(t);
      const { requestId, assignmentId } = await createAssignment(t, customer, handyman, 'EN_ROUTE');
      await expect(t.client(customer.token).call(api.me.deleteAccount)).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 });
      await expect(t.client(handyman.token).call(api.me.deleteAccount)).rejects.toMatchObject({ code: 'INVALID_STATE' });
      for (const status of ['ACCEPTED', 'ARRIVED', 'PRICE_PROPOSED', 'PRICE_DISPUTED'] as const) {
        await t.prisma.assignment.update({ where: { id: assignmentId }, data: { status } });
        await expect(t.client(handyman.token).call(api.me.deleteAccount)).rejects.toMatchObject({ code: 'INVALID_STATE' });
      }

      // job finished but the request is still open (e.g. another slot searching)
      await t.prisma.assignment.update({ where: { id: assignmentId }, data: { status: 'COMPLETED' } });
      await t.prisma.serviceRequest.update({ where: { id: requestId }, data: { status: 'ASSIGNED' } });
      await expect(t.client(handyman.token).call(api.me.deleteAccount)).resolves.toEqual({ ok: true });
      await expect(t.client(customer.token).call(api.me.deleteAccount)).rejects.toMatchObject({
        code: 'INVALID_STATE',
        details: { reason: 'OPEN_REQUEST' },
      });
      await t.prisma.serviceRequest.update({ where: { id: requestId }, data: { status: 'COMPLETED' } });
      await expect(t.client(customer.token).call(api.me.deleteAccount)).resolves.toEqual({ ok: true });
      expect((await t.prisma.user.findUniqueOrThrow({ where: { id: customer.userId } })).status).toBe('DELETED');
    });

    it('completed jobs do not block deletion', async () => {
      const customer = await createCustomer(t);
      const handyman = await createSoloHandyman(t);
      await createAssignment(t, customer, handyman, 'COMPLETED');
      await expect(t.client(customer.token).call(api.me.deleteAccount)).resolves.toEqual({ ok: true });
      await expect(t.client(handyman.token).call(api.me.deleteAccount)).resolves.toEqual({ ok: true });
    });
  });
});
