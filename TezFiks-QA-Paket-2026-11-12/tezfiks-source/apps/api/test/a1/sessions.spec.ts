import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { adminToken, createUser, tokenFor } from '../helpers/factories';
import { hashPassword } from '../../src/common/auth/password';
import { TokenService } from '../../src/common/auth/token.service';
import { azPhone, otpLogin } from './helpers';

describe('A1 sessions: refresh, logout, admin login, realtime ticket', () => {
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

  async function createAdmin(data: { email?: string; password?: string; active?: boolean; role?: 'ADMIN' | 'OPERATOR' } = {}) {
    return t.prisma.adminUser.create({
      data: {
        email: data.email ?? 'ops@tezfiks.az',
        passwordHash: await hashPassword(data.password ?? 'Doğru-Parol-123'),
        name: 'Əməliyyat Admini',
        role: data.role ?? 'OPERATOR',
        active: data.active ?? true,
      },
    });
  }

  describe('refresh', () => {
    it('rotates the refresh token over HTTP; reusing the old one revokes the session', async () => {
      const login = await otpLogin(t, azPhone(1));
      const rotated = await t.client().call(api.auth.refresh, { body: { refreshToken: login.tokens.refreshToken, deviceId: 'device-a1-0009' } });
      expect(rotated.refreshToken).not.toBe(login.tokens.refreshToken);
      expect(rotated.accessToken).toBeTruthy();
      expect(new Date(rotated.refreshExpiresAt).getTime()).toBeGreaterThan(t.clock.nowMs() + 29 * 86_400_000);
      await expect(t.client(rotated.accessToken).call(api.me.get)).resolves.toMatchObject({ id: login.me.id });

      // Reuse after the 60 s grace window (inside it, a retry of a lost response rotates again: see refresh-grace.spec.ts).
      t.clock.advance(61_000);
      await expect(t.client().call(api.auth.refresh, { body: { refreshToken: login.tokens.refreshToken } })).rejects.toMatchObject({
        code: 'SESSION_REVOKED',
        status: 401,
      });
      // the whole session is dead: the newest refresh token and the access token no longer work
      await expect(t.client().call(api.auth.refresh, { body: { refreshToken: rotated.refreshToken } })).rejects.toMatchObject({
        code: 'SESSION_REVOKED',
      });
      await expect(t.client(rotated.accessToken).call(api.me.get)).rejects.toMatchObject({ code: 'SESSION_REVOKED', status: 401 });
      const s = await t.prisma.session.findFirstOrThrow({ where: { userId: login.me.id } });
      expect(s.revokeReason).toBe('REFRESH_REUSE');
    });

    it('rejects unknown and expired refresh tokens with REFRESH_INVALID', async () => {
      await expect(t.client().call(api.auth.refresh, { body: { refreshToken: 'not-a-real-refresh-token' } })).rejects.toMatchObject({
        code: 'REFRESH_INVALID',
        status: 401,
      });
      const login = await otpLogin(t, azPhone(2));
      t.clock.advance(31 * 86_400_000);
      await expect(t.client().call(api.auth.refresh, { body: { refreshToken: login.tokens.refreshToken } })).rejects.toMatchObject({
        code: 'REFRESH_INVALID',
      });
    });

    it('refuses refresh for a blocked user', async () => {
      const login = await otpLogin(t, azPhone(3));
      await t.prisma.user.update({ where: { id: login.me.id }, data: { status: 'BLOCKED' } });
      await expect(t.client().call(api.auth.refresh, { body: { refreshToken: login.tokens.refreshToken } })).rejects.toMatchObject({
        code: 'USER_BLOCKED',
      });
    });
  });

  describe('logout', () => {
    it('revokes the caller session; the access token stops working', async () => {
      const login = await otpLogin(t, azPhone(4));
      await expect(t.client(login.tokens.accessToken).call(api.auth.logout, { body: {} })).resolves.toEqual({ ok: true });
      await expect(t.client(login.tokens.accessToken).call(api.me.get)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
      await expect(t.client().call(api.auth.refresh, { body: { refreshToken: login.tokens.refreshToken } })).rejects.toMatchObject({
        code: 'SESSION_REVOKED',
      });
    });

    it('also revokes the session of a given refresh token when it belongs to the caller, never another user', async () => {
      const u = await createUser(t);
      const a = await t.sessions.createUserSession(u.userId, 'CUSTOMER');
      const b = await t.sessions.createUserSession(u.userId, 'PRO');
      const other = await createUser(t);
      const o = await t.sessions.createUserSession(other.userId, 'CUSTOMER');

      await t.client(a.accessToken).call(api.auth.logout, { body: { refreshToken: o.refreshToken } });
      await expect(t.client(o.accessToken).call(api.me.get)).resolves.toMatchObject({ id: other.userId });

      const c = await t.sessions.createUserSession(u.userId, 'CUSTOMER');
      await t.client(c.accessToken).call(api.auth.logout, { body: { refreshToken: b.refreshToken } });
      await expect(t.client(b.accessToken).call(api.me.get)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
      await expect(t.client(c.accessToken).call(api.me.get)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    });

    it("clears the push token of the logged-out device only, so that phone stops receiving the user's pushes", async () => {
      const login = await otpLogin(t, azPhone(5));
      const c = t.client(login.tokens.accessToken);
      const device = { app: 'CUSTOMER' as const, platform: 'android' as const, pushProvider: 'EXPO' as const };
      await c.call(api.me.registerDevice, { body: { ...device, deviceId: 'device-a1-0001', pushToken: 'ExponentPushToken[logout-me]' } });
      await c.call(api.me.registerDevice, { body: { ...device, deviceId: 'device-a1-0002', pushToken: 'ExponentPushToken[keep-me]' } });
      await c.call(api.me.registerDevice, { body: { ...device, app: 'PRO', deviceId: 'device-a1-0001', pushToken: 'ExponentPushToken[pro-app]' } });

      await c.call(api.auth.logout, { body: {} });

      const rows = await t.prisma.device.findMany({ where: { userId: login.me.id }, orderBy: [{ deviceId: 'asc' }, { app: 'asc' }] });
      expect(rows.map((r) => [r.deviceId, r.app, r.pushToken])).toEqual([
        ['device-a1-0001', 'CUSTOMER', null],
        ['device-a1-0001', 'PRO', 'ExponentPushToken[pro-app]'],
        ['device-a1-0002', 'CUSTOMER', 'ExponentPushToken[keep-me]'],
      ]);
    });

    it('works for admins and requires a token', async () => {
      const admin = await adminToken(t);
      await expect(t.client(admin.token).call(api.auth.logout, { body: {} })).resolves.toEqual({ ok: true });
      await expect(t.client().call(api.auth.logout, { body: {} })).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
    });
  });

  describe('admin login', () => {
    it('logs in with a case-insensitive e-mail, updates lastLoginAt and writes an audit row', async () => {
      const admin = await createAdmin({ email: 'ops@tezfiks.az' });
      const out = await t.client().call(api.auth.adminLogin, { body: { email: 'OPS@TezFiks.az', password: 'Doğru-Parol-123' } });
      expect(out.admin).toEqual({ id: admin.id, email: 'ops@tezfiks.az', name: 'Əməliyyat Admini', role: 'OPERATOR' });
      expect(out.tokens.accessToken).toBeTruthy();
      const row = await t.prisma.adminUser.findUniqueOrThrow({ where: { id: admin.id } });
      expect(row.lastLoginAt?.getTime()).toBeGreaterThan(0);
      const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'admin.login' } });
      expect(audit).toMatchObject({ actorType: 'ADMIN', actorId: admin.id, entityType: 'AdminUser', entityId: admin.id });
      const session = await t.prisma.session.findFirstOrThrow({ where: { adminId: admin.id } });
      expect(session.app).toBe('ADMIN');
      // admin sessions rotate through the same refresh endpoint
      const rotated = await t.client().call(api.auth.refresh, { body: { refreshToken: out.tokens.refreshToken } });
      expect(rotated.refreshToken).not.toBe(out.tokens.refreshToken);
      // admin tokens cannot call user endpoints
      await expect(t.client(out.tokens.accessToken).call(api.me.get)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    });

    it('wrong password, unknown e-mail and inactive admin -> INVALID_CREDENTIALS', async () => {
      await createAdmin({ email: 'ops@tezfiks.az' });
      await createAdmin({ email: 'old@tezfiks.az', active: false });
      await expect(t.client().call(api.auth.adminLogin, { body: { email: 'ops@tezfiks.az', password: 'wrong' } })).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
        status: 401,
      });
      await expect(
        t.client().call(api.auth.adminLogin, { body: { email: 'nobody@tezfiks.az', password: 'Doğru-Parol-123' } }),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      await expect(
        t.client().call(api.auth.adminLogin, { body: { email: 'old@tezfiks.az', password: 'Doğru-Parol-123' } }),
      ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      expect(await t.prisma.session.count()).toBe(0);
      expect(await t.prisma.auditLog.count({ where: { action: 'admin.login' } })).toBe(0);
    });

    it('limits attempts to 10 per IP and e-mail per 15 minutes', async () => {
      await createAdmin({ email: 'ops@tezfiks.az' });
      const ip = { 'X-Forwarded-For': '10.2.2.2' };
      for (let i = 0; i < 10; i++) {
        await expect(
          t.client().call(api.auth.adminLogin, { body: { email: 'ops@tezfiks.az', password: `bad-${i}` }, headers: ip }),
        ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
      }
      await expect(
        t.client().call(api.auth.adminLogin, { body: { email: 'ops@tezfiks.az', password: 'Doğru-Parol-123' }, headers: ip }),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      // another IP is not limited
      await expect(
        t.client().call(api.auth.adminLogin, {
          body: { email: 'ops@tezfiks.az', password: 'Doğru-Parol-123' },
          headers: { 'X-Forwarded-For': '10.2.2.3' },
        }),
      ).resolves.toMatchObject({ admin: { email: 'ops@tezfiks.az' } });
    });
  });

  describe('realtime ticket', () => {
    it('issues a 60-second single-use ticket for users and admins', async () => {
      const u = await createUser(t);
      const token = await tokenFor(t, u.userId, 'PANEL');
      const out = await t.client(token).call(api.auth.realtimeTicket);
      expect(new Date(out.expiresAt).getTime() - t.clock.nowMs()).toBeLessThanOrEqual(60_000);
      const tokens = t.app.get(TokenService);
      const p = await tokens.consumeRealtimeTicket(out.ticket);
      expect(p).toMatchObject({ kind: 'user', userId: u.userId, app: 'PANEL' });
      expect(await tokens.consumeRealtimeTicket(out.ticket)).toBeNull();

      const admin = await adminToken(t);
      const at = await t.client(admin.token).call(api.auth.realtimeTicket);
      expect(await tokens.consumeRealtimeTicket(at.ticket)).toMatchObject({ kind: 'admin', adminId: admin.adminId });
      await expect(t.client().call(api.auth.realtimeTicket)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });
  });
});
