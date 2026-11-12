import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { azPhone, otpLogin } from './helpers';

/**
 * Hardening of refresh-token rotation: the rotation is one conditional write (a concurrent duplicate can never rotate the
 * same token twice), and a lost refresh response on mobile data must not sign the user out: presenting the just-rotated
 * previous token within 60 s of that rotation rotates again. Older reuse still revokes the whole session.
 */
describe('A1 refresh rotation: atomic, with a 60 s grace window for lost responses', () => {
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

  const refresh = (refreshToken: string) => t.client().call(api.auth.refresh, { body: { refreshToken } });

  it('lost response: the retry with the previous token within 60 s rotates again and the session stays alive', async () => {
    const login = await otpLogin(t, azPhone(201));
    const lost = await refresh(login.tokens.refreshToken); // the app never receives this response
    t.clock.advance(30_000);
    const retry = await refresh(login.tokens.refreshToken);
    expect(retry.refreshToken).not.toBe(login.tokens.refreshToken);
    expect(retry.refreshToken).not.toBe(lost.refreshToken);
    await expect(t.client(retry.accessToken).call(api.me.get)).resolves.toMatchObject({ id: login.me.id });
    // The chain goes on from the retried token.
    const next = await refresh(retry.refreshToken);
    await expect(t.client(next.accessToken).call(api.me.get)).resolves.toMatchObject({ id: login.me.id });
    const sessions = await t.prisma.session.findMany({ where: { userId: login.me.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.revokedAt).toBeNull();
  });

  it('the token of the lost response is dead after the retry, without killing the session', async () => {
    const login = await otpLogin(t, azPhone(202));
    const lost = await refresh(login.tokens.refreshToken);
    const retry = await refresh(login.tokens.refreshToken);
    await expect(refresh(lost.refreshToken)).rejects.toMatchObject({ status: 401 });
    const next = await refresh(retry.refreshToken);
    expect(next.refreshToken).toBeTruthy();
    expect((await t.prisma.session.findFirstOrThrow({ where: { userId: login.me.id } })).revokedAt).toBeNull();
  });

  it('reuse after the window revokes the session (REFRESH_REUSE), including the newest tokens', async () => {
    const login = await otpLogin(t, azPhone(203));
    const rotated = await refresh(login.tokens.refreshToken);
    t.clock.advance(61_000);
    await expect(refresh(login.tokens.refreshToken)).rejects.toMatchObject({ code: 'SESSION_REVOKED', status: 401 });
    await expect(refresh(rotated.refreshToken)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    await expect(t.client(rotated.accessToken).call(api.me.get)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    const s = await t.prisma.session.findFirstOrThrow({ where: { userId: login.me.id } });
    expect(s.revokeReason).toBe('REFRESH_REUSE');
  });

  it('the window counts from the rotation, not from the last retry (it never slides)', async () => {
    const login = await otpLogin(t, azPhone(204));
    await refresh(login.tokens.refreshToken);
    t.clock.advance(40_000);
    await refresh(login.tokens.refreshToken); // retry inside the window
    t.clock.advance(30_000); // 70 s after the rotation
    await expect(refresh(login.tokens.refreshToken)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
  });

  it('two concurrent refreshes with the same token: one success, the other refused without revoking; the winner keeps working', async () => {
    const login = await otpLogin(t, azPhone(205));
    const token = login.tokens.refreshToken;
    const results = await Promise.allSettled([t.sessions.rotate(token), t.sessions.rotate(token)]);
    const ok = results.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<TestApp['sessions']['rotate']>>> => r.status === 'fulfilled');
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(1);
    // Retryable (409), not a session-ending 401: the app keeps the winner's tokens.
    expect(refused[0]!.reason).toMatchObject({ code: 'CONFLICT' });
    const s = await t.prisma.session.findFirstOrThrow({ where: { userId: login.me.id } });
    expect(s.revokedAt).toBeNull();
    const winner = ok[0]!.value;
    await expect(t.client(winner.accessToken).call(api.me.get)).resolves.toMatchObject({ id: login.me.id });
    await expect(refresh(winner.refreshToken)).resolves.toMatchObject({ accessToken: expect.any(String) });
  });

  it('admin sessions get the same grace', async () => {
    const admin = await t.prisma.adminUser.create({
      data: { email: 'grace@tezfiks.az', passwordHash: 'x', name: 'Admin', role: 'ADMIN' },
    });
    const tokens = await t.sessions.createAdminSession(admin.id, 'ADMIN');
    await refresh(tokens.refreshToken);
    const retry = await refresh(tokens.refreshToken);
    expect(retry.refreshToken).toBeTruthy();
    expect((await t.prisma.session.findFirstOrThrow({ where: { adminId: admin.id } })).revokedAt).toBeNull();
  });
});
