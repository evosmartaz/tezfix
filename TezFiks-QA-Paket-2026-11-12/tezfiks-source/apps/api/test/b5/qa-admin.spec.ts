import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { adminToken, createCustomer, createSoloHandyman } from '../helpers/factories';
import { provisionQaAdmin, QA_ADMIN_SOURCE, QaAdminError, validateQaAdminOptions } from '../../prisma/seed/qa-admin';

const EMAIL = 'qa-admin@tezfiks.az';
const PASSWORD = 'Qa-Str0ng-Passw0rd!';

describe('QA admin provisioning (prisma/seed/qa-admin.ts)', () => {
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

  const login = (password: string, email = EMAIL) => t.client(null).call(api.auth.adminLogin, { body: { email, password } });

  it('refuses outside demo mode, for a non-QA e-mail and for a short password, and creates nothing', async () => {
    await expect(provisionQaAdmin(t.prisma, { email: EMAIL, password: PASSWORD, demoMode: false })).rejects.toBeInstanceOf(QaAdminError);
    expect(() => validateQaAdminOptions({ email: 'boss@tezfiks.az', password: PASSWORD, demoMode: true })).toThrow(/QA-specific/);
    expect(() => validateQaAdminOptions({ email: 'not-an-email', password: PASSWORD, demoMode: true })).toThrow(/valid e-mail/);
    expect(() => validateQaAdminOptions({ email: EMAIL, password: 'short', demoMode: true })).toThrow(/at least 10/);
    expect(await t.prisma.adminUser.count({ where: { email: EMAIL } })).toBe(0);
  });

  it('creates an active ADMIN with a scrypt hash who logs in through the normal admin login; a wrong password is rejected', async () => {
    const r = await provisionQaAdmin(t.prisma, { email: 'QA-Admin@TezFiks.az', password: PASSWORD, demoMode: true });
    expect(r.status).toBe('created');
    const row = await t.prisma.adminUser.findUniqueOrThrow({ where: { id: r.id } });
    expect(row).toMatchObject({ email: EMAIL, role: 'ADMIN', active: true });
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(row.passwordHash).not.toContain(PASSWORD);

    const ok = await login(PASSWORD);
    expect(ok.admin).toEqual({ id: r.id, email: EMAIL, name: 'QA Admin', role: 'ADMIN' });
    await expect(login('Wrong-Passw0rd!')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });

    const audit = await t.prisma.auditLog.findMany({ where: { entityId: r.id, action: 'admin.create' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorType: 'SYSTEM', after: expect.objectContaining({ source: QA_ADMIN_SOURCE, role: 'ADMIN' }) });
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
  });

  it('is idempotent: a second run changes nothing and creates no duplicate', async () => {
    const first = await provisionQaAdmin(t.prisma, { email: EMAIL, password: PASSWORD, demoMode: true });
    const hash = (await t.prisma.adminUser.findUniqueOrThrow({ where: { id: first.id } })).passwordHash;
    const second = await provisionQaAdmin(t.prisma, { email: EMAIL.toUpperCase(), password: 'Another-Passw0rd!', demoMode: true });
    expect(second).toEqual({ status: 'unchanged', id: first.id });
    expect(await t.prisma.adminUser.count({ where: { email: { equals: EMAIL, mode: 'insensitive' } } })).toBe(1);
    expect((await t.prisma.adminUser.findUniqueOrThrow({ where: { id: first.id } })).passwordHash).toBe(hash);
    await login(PASSWORD);
  });

  it('concurrent runs still produce exactly one account', async () => {
    const results = await Promise.all([1, 2, 3].map(() => provisionQaAdmin(t.prisma, { email: EMAIL, password: PASSWORD, demoMode: true })));
    expect(results.filter((r) => r.status === 'created')).toHaveLength(1);
    expect(await t.prisma.adminUser.count({ where: { email: EMAIL } })).toBe(1);
  });

  it('--rotate-password sets a new password, ends the old sessions and leaves other admins untouched', async () => {
    const boss = await adminToken(t, { email: 'boss@tezfiks.az', role: 'ADMIN' });
    const bossBefore = await t.prisma.adminUser.findUniqueOrThrow({ where: { id: boss.adminId } });
    const created = await provisionQaAdmin(t.prisma, { email: EMAIL, password: PASSWORD, demoMode: true });
    const old = await login(PASSWORD);

    const NEW = 'Rotated-Passw0rd!';
    expect(await provisionQaAdmin(t.prisma, { email: EMAIL, password: NEW, demoMode: true, rotatePassword: true })).toEqual({
      status: 'password-rotated',
      id: created.id,
    });
    await expect(login(PASSWORD)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await login(NEW);
    t.sessions.invalidateCache();
    await expect(t.client(old.tokens.accessToken).call(api.admin.me)).rejects.toMatchObject({ status: 401 });

    expect(await t.prisma.adminUser.findUniqueOrThrow({ where: { id: boss.adminId } })).toEqual(bossBefore);
    expect(await t.client(boss.token).call(api.admin.me)).toMatchObject({ id: boss.adminId });
  });

  it('the QA admin can run the pending QA admin operations (settings is ADMIN-only, clear strikes); a customer cannot', async () => {
    await provisionQaAdmin(t.prisma, { email: EMAIL, password: PASSWORD, demoMode: true });
    const { tokens } = await login(PASSWORD);
    const qa = t.client(tokens.accessToken);

    const settings = await qa.call(api.admin.settings);
    expect(settings).toBeTruthy();

    const h = await createSoloHandyman(t);
    const other = await createSoloHandyman(t);
    await t.prisma.handymanProfile.update({ where: { id: h.handymanId }, data: { strikes: 3 } });
    await t.prisma.handymanProfile.update({ where: { id: other.handymanId }, data: { strikes: 2 } });
    const cleared = await qa.call(api.admin.clearStrikes, { params: { id: h.handymanId } });
    expect(cleared.strikes).toEqual([]);
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: h.handymanId } })).strikes).toBe(0);
    expect((await t.prisma.handymanProfile.findUniqueOrThrow({ where: { id: other.handymanId } })).strikes).toBe(2);
    expect(await t.prisma.auditLog.count({ where: { action: 'handyman.clearStrikes', entityId: h.handymanId } })).toBe(1);

    const c = await createCustomer(t);
    await expect(t.client(c.token).call(api.admin.clearStrikes, { params: { id: h.handymanId } })).rejects.toMatchObject({ status: 403 });
    await expect(t.client(null).call(api.admin.settings)).rejects.toMatchObject({ status: 401 });
  });
});
