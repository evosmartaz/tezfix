import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import { createUser, tokenFor } from './helpers/factories';
import { hashPassword, verifyPassword } from '../src/common/auth/password';

describe('auth core, sessions and jobs', () => {
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

  it('hashes and verifies admin passwords with scrypt', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
  });

  it('rotates refresh tokens and revokes the session on reuse', async () => {
    const u = await createUser(t);
    const first = await t.sessions.createUserSession(u.userId, 'CUSTOMER');
    const second = await t.sessions.rotate(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    // Reuse after the 60 s grace window (inside it a lost-response retry rotates again: a1/refresh-grace.spec.ts).
    t.clock.advance(61_000);
    await expect(t.sessions.rotate(first.refreshToken)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
    await expect(t.sessions.rotate(second.refreshToken)).rejects.toMatchObject({ code: 'SESSION_REVOKED' });
  });

  it('rejects tokens of blocked users with USER_BLOCKED', async () => {
    const u = await createUser(t);
    const token = await tokenFor(t, u.userId);
    await t.prisma.user.update({ where: { id: u.userId }, data: { status: 'BLOCKED' } });
    t.sessions.invalidateCache();
    const res = await fetch(`${t.baseUrl}/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('USER_BLOCKED');
  });

  it('expires access tokens with the clock', async () => {
    const u = await createUser(t);
    const token = await tokenFor(t, u.userId);
    t.clock.advance(16 * 60 * 1000);
    const res = await fetch(`${t.baseUrl}/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it('runs manual jobs when the clock reaches them, replacing jobs with the same id', async () => {
    const ran: string[] = [];
    t.jobs.register(`test-job-${Date.now()}`, () => undefined);
    const name = `probe-${Date.now()}`;
    t.jobs.register(name, (d: { v: string }) => {
      ran.push(d.v);
    });
    await t.jobs.schedule(name, { v: 'a' }, { delayMs: 60_000, jobId: 'same' });
    await t.jobs.schedule(name, { v: 'b' }, { delayMs: 120_000, jobId: 'same' });
    await t.jobs.schedule(name, { v: 'c' }, { delayMs: 30_000 });
    expect(await t.jobs.runDue()).toBe(0);
    t.clock.advance(31_000);
    expect(await t.jobs.runDue()).toBe(1);
    t.clock.advance(100_000);
    expect(await t.jobs.runDue()).toBe(1);
    expect(ran).toEqual(['c', 'b']);
  });
});
