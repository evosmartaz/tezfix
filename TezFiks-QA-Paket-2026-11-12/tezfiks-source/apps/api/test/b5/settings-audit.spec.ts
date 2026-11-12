import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, DEFAULT_SETTINGS } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { adminToken, createCustomer } from '../helpers/factories';
import { adminEvents, auditOf } from './helpers';

describe('B5 platform settings and the audit trail', () => {
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

  it('GET /admin/settings returns the effective settings, the defaults and the demo flag (any admin role)', async () => {
    const op = await adminToken(t, { role: 'OPERATOR' });
    await t.settings.update({ requestFee: 1200 }, null);
    const res = await t.client(op.token).call(api.admin.settings);
    expect(res.demoMode).toBe(false);
    expect(res.defaults).toEqual(DEFAULT_SETTINGS);
    expect(res.settings).toEqual({ ...DEFAULT_SETTINGS, requestFee: 1200 });
  });

  it('ADMIN updates settings: takes effect at once, audited with before/after of the changed keys, admin:event sent', async () => {
    const boss = await adminToken(t, { role: 'ADMIN' });
    const res = await t.client(boss.token).call(api.admin.updateSettings, { body: { requestFee: 1500, offerTtlSec: 45, vatRatePercent: 18 } });
    expect(res.settings).toMatchObject({ requestFee: 1500, offerTtlSec: 45, vatRatePercent: 18 });
    expect(res.defaults.requestFee).toBe(DEFAULT_SETTINGS.requestFee);
    t.settings.invalidate();
    expect((await t.settings.get()).requestFee).toBe(1500);
    expect((await t.client(boss.token).call(api.admin.settings)).settings.offerTtlSec).toBe(45);
    // Public config reflects the change too.
    expect((await t.client(null).call(api.health.config)).requestFee).toBe(1500);

    const rows = await auditOf(t, 'PlatformSetting', 'platform');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'settings.update',
      actorType: 'ADMIN',
      actorId: boss.adminId,
      before: { requestFee: 1000, offerTtlSec: 30, vatRatePercent: 18 },
      after: { requestFee: 1500, offerTtlSec: 45, vatRatePercent: 18 },
    });
    expect((await t.prisma.platformSetting.findUniqueOrThrow({ where: { key: 'platform' } })).updatedByAdminId).toBe(boss.adminId);
    expect(adminEvents(t)).toContainEqual({ type: 'SETTINGS_UPDATED', entityId: 'platform' });

    // A second change keeps the first one and records the new before.
    await t.client(boss.token).call(api.admin.updateSettings, { body: { requestFee: 1000 } });
    const again = await auditOf(t, 'PlatformSetting', 'platform');
    expect(again[1]).toMatchObject({ before: { requestFee: 1500 }, after: { requestFee: 1000 } });
    expect((await t.client(boss.token).call(api.admin.settings)).settings).toMatchObject({ requestFee: 1000, offerTtlSec: 45 });
  });

  it('race: two admins saving different keys at the same moment both keep their change; each audit row is exact', async () => {
    for (let round = 0; round < 4; round++) {
      await t.reset();
      const a1 = await adminToken(t, { role: 'ADMIN' });
      const a2 = await adminToken(t, { role: 'ADMIN' });
      const results = await Promise.allSettled([
        t.client(a1.token).call(api.admin.updateSettings, { body: { requestFee: 1200 + round } }),
        t.client(a2.token).call(api.admin.updateSettings, { body: { offerTtlSec: 40 + round } }),
      ]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      t.settings.invalidate();
      expect(await t.settings.get()).toMatchObject({ requestFee: 1200 + round, offerTtlSec: 40 + round });
      const stored = (await t.prisma.platformSetting.findUniqueOrThrow({ where: { key: 'platform' } })).value as Record<string, unknown>;
      expect(stored).toMatchObject({ requestFee: 1200 + round, offerTtlSec: 40 + round });
      const rows = await auditOf(t, 'PlatformSetting', 'platform');
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.actorId === a1.adminId)).toMatchObject({ before: { requestFee: 1000 }, after: { requestFee: 1200 + round } });
      expect(rows.find((r) => r.actorId === a2.adminId)).toMatchObject({ before: { offerTtlSec: 30 }, after: { offerTtlSec: 40 + round } });
    }
  });

  it('OPERATOR cannot change settings (FORBIDDEN, unchanged, not audited)', async () => {
    const op = await adminToken(t, { role: 'OPERATOR' });
    await expect(t.client(op.token).call(api.admin.updateSettings, { body: { requestFee: 1 } })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    t.settings.invalidate();
    expect((await t.settings.get()).requestFee).toBe(DEFAULT_SETTINGS.requestFee);
    expect(await t.prisma.auditLog.count({ where: { action: 'settings.update' } })).toBe(0);
  });

  it('invalid values are VALIDATION_FAILED (PlatformSettingsSchema.partial()); an empty patch changes nothing', async () => {
    const boss = await adminToken(t, { role: 'ADMIN' });
    for (const body of [{ offerTtlSec: 2 }, { requestFee: -5 }, { vatRatePercent: 120 }, { maxSlots: 1.5 }]) {
      await expect(t.client(boss.token).call(api.admin.updateSettings, { body })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    }
    const res = await t.client(boss.token).call(api.admin.updateSettings, { body: {} });
    expect(res.settings).toEqual(DEFAULT_SETTINGS);
    expect(await t.prisma.auditLog.count({ where: { action: 'settings.update' } })).toBe(0);
  });

  it('users cannot read or change settings', async () => {
    const c = await createCustomer(t);
    await expect(t.client(c.token).call(api.admin.settings)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(t.client(c.token).call(api.admin.updateSettings, { body: { requestFee: 1 } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('audit list: newest first, entity filters, actor names, cursor paging, bad cursor rejected', async () => {
    const boss = await adminToken(t, { role: 'ADMIN' });
    await t.prisma.adminUser.update({ where: { id: boss.adminId }, data: { name: 'Rəşad Admin' } });
    for (let i = 0; i < 3; i++) await t.client(boss.token).call(api.admin.updateSettings, { body: { requestFee: 1000 + i } });
    const op = await t.client(boss.token).call(api.admin.createAdmin, { body: { email: 'aud@tezfiks.az', name: 'Audit Op', password: 'Str0ng-Passw0rd!' } });
    const c = await createCustomer(t, { firstName: 'Aysel', lastName: 'Qasımova' });
    await t.prisma.auditLog.create({ data: { actorType: 'USER', actorId: c.userId, action: 'user.something', entityType: 'User', entityId: c.userId } });
    await t.prisma.auditLog.create({ data: { actorType: 'SYSTEM', action: 'system.tick', entityType: 'System' } });

    const all = await t.client(boss.token).call(api.admin.audit, { query: { limit: 100 } });
    expect(all.items).toHaveLength(6);
    expect(all.nextCursor).toBeNull();
    const ats = all.items.map((i) => Date.parse(i.at));
    expect([...ats].sort((a, b) => b - a)).toEqual(ats);
    expect(all.items.find((i) => i.action === 'admin.create')).toMatchObject({ actorName: 'Rəşad Admin', entityId: op.id, before: null });
    expect(all.items.find((i) => i.action === 'user.something')).toMatchObject({ actorType: 'USER', actorName: 'Aysel Qasımova' });
    expect(all.items.find((i) => i.action === 'system.tick')).toMatchObject({ actorType: 'SYSTEM', actorId: null, actorName: null, entityId: null });

    const settings = await t.client(boss.token).call(api.admin.audit, { query: { entityType: 'PlatformSetting', entityId: 'platform' } });
    expect(settings.items.map((i) => i.action)).toEqual(['settings.update', 'settings.update', 'settings.update']);
    expect(settings.items[0]!.after).toEqual({ requestFee: 1002 });

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await t.client(boss.token).call(api.admin.audit, { query: { limit: 4, ...(cursor ? { cursor } : {}) } });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(all.items.map((i) => i.id));

    await expect(t.client(boss.token).call(api.admin.audit, { query: { cursor: 'garbage' } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const op2 = await adminToken(t, { role: 'OPERATOR' });
    expect((await t.client(op2.token).call(api.admin.audit, { query: { limit: 1 } })).items).toHaveLength(1);
  });
});
