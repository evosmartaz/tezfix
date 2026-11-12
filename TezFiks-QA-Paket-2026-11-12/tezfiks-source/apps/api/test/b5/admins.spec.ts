import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { adminToken, createCustomer } from '../helpers/factories';
import { adminEvents, auditOf } from './helpers';

const PASSWORD = 'Str0ng-Passw0rd!';

describe('B5 admin me, admins CRUD and role rules', () => {
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

  it('GET /admin/me returns the calling admin (any role); users and anonymous callers are refused', async () => {
    const a = await adminToken(t, { email: 'boss@tezfiks.az', role: 'ADMIN' });
    const op = await adminToken(t, { email: 'op@tezfiks.az', role: 'OPERATOR' });
    expect(await t.client(a.token).call(api.admin.me)).toEqual({ id: a.adminId, email: 'boss@tezfiks.az', name: 'Test Admin', role: 'ADMIN' });
    expect(await t.client(op.token).call(api.admin.me)).toMatchObject({ id: op.adminId, role: 'OPERATOR' });
    const c = await createCustomer(t);
    await expect(t.client(c.token).call(api.admin.me)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(t.client(null).call(api.admin.me)).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('a deactivated admin can no longer call /admin/me', async () => {
    const boss = await adminToken(t, { role: 'ADMIN' });
    const other = await adminToken(t, { role: 'OPERATOR' });
    await t.client(other.token).call(api.admin.me);
    await t.client(boss.token).call(api.admin.updateAdmin, { params: { id: other.adminId }, body: { active: false } });
    await expect(t.client(other.token).call(api.admin.me)).rejects.toMatchObject({ status: 401 });
  });

  it('ADMIN creates an admin (scrypt password, audited, no hash in the response) who can then log in', async () => {
    const boss = await adminToken(t, { role: 'ADMIN' });
    const created = await t.client(boss.token).call(api.admin.createAdmin, {
      body: { email: 'Leyla@TezFiks.az', name: 'Leyla Əliyeva', password: PASSWORD },
    });
    expect(created).toMatchObject({ email: 'leyla@tezfiks.az', name: 'Leyla Əliyeva', role: 'OPERATOR', active: true, lastLoginAt: null });
    expect(JSON.stringify(created)).not.toContain('scrypt');
    const row = await t.prisma.adminUser.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.passwordHash).toMatch(/^scrypt\$/);
    expect(row.passwordHash).not.toContain(PASSWORD);

    const login = await t.client(null).call(api.auth.adminLogin, { body: { email: 'leyla@tezfiks.az', password: PASSWORD } });
    expect(login.admin).toMatchObject({ id: created.id, role: 'OPERATOR' });
    expect(await t.client(login.tokens.accessToken).call(api.admin.me)).toMatchObject({ id: created.id, name: 'Leyla Əliyeva' });

    const audit = await auditOf(t, 'AdminUser', created.id);
    const create = audit.find((r) => r.action === 'admin.create')!;
    expect(create).toMatchObject({ actorType: 'ADMIN', actorId: boss.adminId, before: null });
    expect(create.after).toEqual({ email: 'leyla@tezfiks.az', name: 'Leyla Əliyeva', role: 'OPERATOR', active: true });
    expect(JSON.stringify(audit)).not.toContain('scrypt');
    expect(adminEvents(t)).toContainEqual({ type: 'ADMIN_CREATED', entityId: created.id });

    const list = await t.client(boss.token).call(api.admin.admins);
    expect(list.items.map((a) => a.email)).toEqual(expect.arrayContaining([created.email]));
    expect(list.items.find((a) => a.id === created.id)?.lastLoginAt).not.toBeNull();
  });

  it('duplicate e-mails (any case) are a CONFLICT; body validation is VALIDATION_FAILED', async () => {
    const boss = await adminToken(t, { role: 'ADMIN' });
    await t.client(boss.token).call(api.admin.createAdmin, { body: { email: 'dup@tezfiks.az', name: 'Dup One', password: PASSWORD } });
    await expect(
      t.client(boss.token).call(api.admin.createAdmin, { body: { email: 'DUP@tezfiks.az', name: 'Dup Two', password: PASSWORD } }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    await expect(
      t.client(boss.token).call(api.admin.createAdmin, { body: { email: 'short@tezfiks.az', name: 'Short', password: 'short' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    expect(await t.prisma.adminUser.count({ where: { email: { startsWith: 'dup' } } })).toBe(1);
  });

  it('OPERATOR can read admins but cannot create or update them (FORBIDDEN), nothing changes and nothing is audited', async () => {
    const boss = await adminToken(t, { role: 'ADMIN' });
    const op = await adminToken(t, { role: 'OPERATOR' });
    const list = await t.client(op.token).call(api.admin.admins);
    expect(list.items.map((a) => a.id).sort()).toEqual([boss.adminId, op.adminId].sort());
    await expect(
      t.client(op.token).call(api.admin.createAdmin, { body: { email: 'x@tezfiks.az', name: 'Xx Yy', password: PASSWORD, role: 'ADMIN' } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(t.client(op.token).call(api.admin.updateAdmin, { params: { id: boss.adminId }, body: { active: false } })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    // Promoting oneself is admin management too.
    await expect(t.client(op.token).call(api.admin.updateAdmin, { params: { id: op.adminId }, body: { role: 'ADMIN' } })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await t.prisma.adminUser.count()).toBe(2);
    expect((await t.prisma.adminUser.findUniqueOrThrow({ where: { id: op.adminId } })).role).toBe('OPERATOR');
    expect(await t.prisma.auditLog.count({ where: { action: { startsWith: 'admin.' } } })).toBe(0);
  });

  it('role checks use the current database role, not the token claim', async () => {
    const boss = await adminToken(t, { role: 'ADMIN' });
    // Demoted directly in the database while the token still says ADMIN.
    await t.prisma.adminUser.update({ where: { id: boss.adminId }, data: { role: 'OPERATOR' } });
    await expect(
      t.client(boss.token).call(api.admin.createAdmin, { body: { email: 'y@tezfiks.az', name: 'Yy Zz', password: PASSWORD } }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('an admin cannot deactivate or demote themselves', async () => {
    const boss = await adminToken(t, { role: 'ADMIN' });
    await adminToken(t, { role: 'ADMIN' });
    await expect(t.client(boss.token).call(api.admin.updateAdmin, { params: { id: boss.adminId }, body: { active: false } })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    await expect(t.client(boss.token).call(api.admin.updateAdmin, { params: { id: boss.adminId }, body: { role: 'OPERATOR' } })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await t.prisma.adminUser.findUniqueOrThrow({ where: { id: boss.adminId } })).toMatchObject({ active: true, role: 'ADMIN' });
    // Renaming oneself is fine.
    const me = await t.client(boss.token).call(api.admin.updateAdmin, { params: { id: boss.adminId }, body: { name: 'Baş Admin' } });
    expect(me).toMatchObject({ name: 'Baş Admin', role: 'ADMIN', active: true });
  });

  it('updates name, role, active and password with before/after audit; role/active/password changes end that admin’s sessions', async () => {
    const boss = await adminToken(t, { role: 'ADMIN' });
    const target = await t.client(boss.token).call(api.admin.createAdmin, { body: { email: 'op2@tezfiks.az', name: 'Operator Two', password: PASSWORD } });
    const login = await t.client(null).call(api.auth.adminLogin, { body: { email: 'op2@tezfiks.az', password: PASSWORD } });
    await t.client(login.tokens.accessToken).call(api.admin.me);

    const renamed = await t.client(boss.token).call(api.admin.updateAdmin, { params: { id: target.id }, body: { name: 'Operator İki' } });
    expect(renamed.name).toBe('Operator İki');
    // A rename keeps sessions.
    await t.client(login.tokens.accessToken).call(api.admin.me);

    const promoted = await t.client(boss.token).call(api.admin.updateAdmin, { params: { id: target.id }, body: { role: 'ADMIN' } });
    expect(promoted.role).toBe('ADMIN');
    await expect(t.client(login.tokens.accessToken).call(api.admin.me)).rejects.toMatchObject({ status: 401 });

    const NEW = 'An0ther-Passw0rd!';
    await t.client(boss.token).call(api.admin.updateAdmin, { params: { id: target.id }, body: { password: NEW } });
    await expect(t.client(null).call(api.auth.adminLogin, { body: { email: 'op2@tezfiks.az', password: PASSWORD } })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    const relogin = await t.client(null).call(api.auth.adminLogin, { body: { email: 'op2@tezfiks.az', password: NEW } });
    expect(relogin.admin.role).toBe('ADMIN');

    const off = await t.client(boss.token).call(api.admin.updateAdmin, { params: { id: target.id }, body: { active: false } });
    expect(off.active).toBe(false);
    await expect(t.client(relogin.tokens.accessToken).call(api.admin.me)).rejects.toMatchObject({ status: 401 });
    await expect(t.client(null).call(api.auth.adminLogin, { body: { email: 'op2@tezfiks.az', password: NEW } })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });

    const updates = (await auditOf(t, 'AdminUser', target.id)).filter((r) => r.action === 'admin.update');
    expect(updates.map((u) => [u.before, u.after])).toEqual([
      [
        { name: 'Operator Two', role: 'OPERATOR', active: true },
        { name: 'Operator İki', role: 'OPERATOR', active: true },
      ],
      [
        { name: 'Operator İki', role: 'OPERATOR', active: true },
        { name: 'Operator İki', role: 'ADMIN', active: true },
      ],
      [
        { name: 'Operator İki', role: 'ADMIN', active: true },
        { name: 'Operator İki', role: 'ADMIN', active: true, passwordChanged: true },
      ],
      [
        { name: 'Operator İki', role: 'ADMIN', active: true },
        { name: 'Operator İki', role: 'ADMIN', active: false },
      ],
    ]);
    expect(updates.every((u) => u.actorId === boss.adminId && u.actorType === 'ADMIN')).toBe(true);
    expect(JSON.stringify(updates)).not.toContain(NEW);
  });

  it('changing one’s own password keeps the current session and ends the others', async () => {
    await adminToken(t, { role: 'ADMIN' });
    const boss = await adminToken(t, { role: 'ADMIN' });
    const second = await t.sessions.createAdminSession(boss.adminId, 'ADMIN');
    await t.client(boss.token).call(api.admin.updateAdmin, { params: { id: boss.adminId }, body: { password: 'Brand-New-Passw0rd' } });
    await t.client(boss.token).call(api.admin.me);
    await expect(t.client(second.accessToken).call(api.admin.me)).rejects.toMatchObject({ status: 401 });
  });

  it('unknown admin id is NOT_FOUND', async () => {
    const boss = await adminToken(t, { role: 'ADMIN' });
    await expect(
      t.client(boss.token).call(api.admin.updateAdmin, { params: { id: '0192f000-0000-7000-8000-000000000000' }, body: { name: 'Nobody Here' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('two admins demoting each other at the same time never leave the platform without an active ADMIN', async () => {
    for (let round = 0; round < 4; round++) {
      await t.reset();
      const a = await adminToken(t, { role: 'ADMIN' });
      const b = await adminToken(t, { role: 'ADMIN' });
      const results = await Promise.allSettled([
        t.client(a.token).call(api.admin.updateAdmin, { params: { id: b.adminId }, body: { role: 'OPERATOR' } }),
        t.client(b.token).call(api.admin.updateAdmin, { params: { id: a.adminId }, body: { role: 'OPERATOR' } }),
      ]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      expect(ok).toHaveLength(1);
      for (const r of results) {
        if (r.status === 'rejected') {
          const e = r.reason as { code: string; status: number };
          expect(e.status).not.toBe(500);
          expect(['FORBIDDEN', 'UNAUTHORIZED', 'SESSION_REVOKED']).toContain(e.code);
        }
      }
      expect(await t.prisma.adminUser.count({ where: { role: 'ADMIN', active: true } })).toBe(1);
    }
  });
});
