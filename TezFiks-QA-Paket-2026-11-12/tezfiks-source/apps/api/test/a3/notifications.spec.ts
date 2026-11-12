import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, NotificationType, rooms } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { adminToken, createCustomer, createSoloHandyman, createUser, tokenFor } from '../helpers/factories';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { LogPushSender } from '../../src/modules/notifications/push/log.sender';
import { I18nService } from '../../src/common/i18n/i18n.service';
import { closeAllSockets, connectSocket, nextEvent } from './helpers';

describe('notifications', () => {
  let t: TestApp;
  let notifications: NotificationsService;
  let pushLog: LogPushSender;

  async function device(userId: string, app: 'CUSTOMER' | 'PRO' | 'PANEL', token: string | null, provider: 'EXPO' | 'FCM' | null = 'FCM') {
    return t.prisma.device.create({
      data: { userId, deviceId: `dev-${app}-${Math.random().toString(36).slice(2, 10)}`, app, platform: 'android', pushToken: token, pushProvider: token ? provider : null },
    });
  }

  beforeAll(async () => {
    t = await createTestApp();
    notifications = t.app.get(NotificationsService);
    pushLog = t.app.get(LogPushSender);
  });
  afterAll(async () => {
    closeAllSockets();
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    pushLog.clear();
  });
  afterEach(() => closeAllSockets());

  describe('translations', () => {
    it('every NotificationType has a title and body in az, ru and en', () => {
      const i18n = t.app.get(I18nService);
      for (const type of NotificationType.values) {
        for (const locale of ['az', 'ru', 'en'] as const) {
          for (const part of ['title', 'body']) {
            const key = `server.notifications.${type}.${part}`;
            const text = i18n.t(locale, key, { title: 'x', body: 'y' });
            expect(text, `${locale} ${key}`).not.toBe(key);
            expect(text.trim().length, `${locale} ${key}`).toBeGreaterThan(0);
          }
        }
      }
      // Languages really differ (not az fallbacks).
      expect(i18n.t('ru', 'server.notifications.REQUEST_ASSIGNED.title')).not.toBe(i18n.t('az', 'server.notifications.REQUEST_ASSIGNED.title'));
      expect(i18n.t('en', 'server.notifications.REQUEST_ASSIGNED.title')).not.toBe(i18n.t('az', 'server.notifications.REQUEST_ASSIGNED.title'));
    });
  });

  describe('notify', () => {
    it('creates the row in the user’s locale, emits notification:new and pushes to the user’s devices', async () => {
      const u = await createUser(t);
      await t.prisma.user.update({ where: { id: u.userId }, data: { locale: 'ru' } });
      await device(u.userId, 'CUSTOMER', 'fcm-token-1');
      await device(u.userId, 'CUSTOMER', null); // no token: skipped

      const view = await notifications.notify(u.userId, 'REQUEST_ASSIGNED', {
        vars: { name: 'Elvin M.', number: 1001 },
        data: { requestId: 'r1', assignmentId: 'a1' },
      });
      expect(view).toMatchObject({ type: 'REQUEST_ASSIGNED', title: 'Мастер найден', body: 'Elvin M. принял(а) заказ №1001.', readAt: null, data: { requestId: 'r1', assignmentId: 'a1' } });

      const row = await t.prisma.notification.findUniqueOrThrow({ where: { id: view!.id } });
      expect(row).toMatchObject({ userId: u.userId, type: 'REQUEST_ASSIGNED', title: 'Мастер найден' });

      const sent = t.realtime.sentTo(rooms.user(u.userId), 'notification:new');
      expect(sent).toHaveLength(1);
      expect(sent[0]!.payload).toEqual(view);

      const pushes = pushLog.sentTo(u.userId);
      expect(pushes).toHaveLength(1);
      expect(pushes[0]!.delivery.token).toBe('fcm-token-1');
      expect(pushes[0]!.message).toEqual({
        type: 'REQUEST_ASSIGNED',
        title: 'Мастер найден',
        body: 'Elvin M. принял(а) заказ №1001.',
        data: { requestId: 'r1', assignmentId: 'a1' },
        priority: 'normal',
        channelId: 'default_v1',
      });
    });

    it('localizes per recipient: az (default), en; Azerbaijani letters survive', async () => {
      const az = await createUser(t);
      const en = await createUser(t);
      await t.prisma.user.update({ where: { id: en.userId }, data: { locale: 'en' } });
      const a = await notifications.notify(az.userId, 'ASSIGNMENT_ARRIVED', { vars: { name: 'Əli Şükürov' } });
      const e = await notifications.notify(en.userId, 'ASSIGNMENT_ARRIVED', { vars: { name: 'Əli Şükürov' } });
      expect(a).toMatchObject({ title: 'Usta gəldi', body: 'Əli Şükürov ünvana çatdı.' });
      expect(e).toMatchObject({ title: 'Your pro has arrived', body: 'Əli Şükürov has arrived at the address.' });
    });

    it('pushes only to devices of the requested app', async () => {
      const pro = await createSoloHandyman(t);
      await device(pro.userId, 'PRO', 'pro-token');
      await device(pro.userId, 'CUSTOMER', 'customer-token');
      await notifications.notify(pro.userId, 'OFFER_NEW', {
        app: 'PRO',
        vars: { category: 'Santexnik', number: 1002, distance: '2,4 km' },
        data: { offerId: 'o1', requestId: 'r1', expiresAt: '2026-10-25T10:00:00.000Z' },
        ttlSec: 45,
        collapseKey: 'offer',
      });
      const pushes = pushLog.sentTo(pro.userId, 'OFFER_NEW');
      expect(pushes.map((p) => p.delivery.token)).toEqual(['pro-token']);
      expect(pushes[0]!.delivery.app).toBe('PRO');
      // OFFER_NEW defaults: high priority on the offers channel; ttl and collapse key passed through.
      expect(pushes[0]!.message).toMatchObject({ priority: 'high', channelId: 'offers_v1', ttlSec: 45, collapseKey: 'offer' });
      expect(pushes[0]!.message.title).toBe('Yeni sifariş: Santexnik');
    });

    it('explicit priority/channel override the defaults; push:false skips devices but keeps row and socket event', async () => {
      const u = await createUser(t);
      await device(u.userId, 'CUSTOMER', 'tok');
      await notifications.notify(u.userId, 'ASSIGNMENT_NEAR', { vars: { name: 'X', minutes: 3 }, priority: 'high', channelId: 'offers_v1' });
      expect(pushLog.sentTo(u.userId)[0]!.message).toMatchObject({ priority: 'high', channelId: 'offers_v1' });
      pushLog.clear();
      const v = await notifications.notify(u.userId, 'WALLET_TOPUP', { vars: { amount: '10,00 ₼' }, push: false });
      expect(v?.body).toBe('Balansınıza 10,00 ₼ əlavə olundu.');
      expect(pushLog.sent).toHaveLength(0);
      expect(t.realtime.sentTo(rooms.user(u.userId), 'notification:new')).toHaveLength(2);
      expect(await t.prisma.notification.count({ where: { userId: u.userId } })).toBe(2);
    });

    it('never leaks phone numbers or addresses into rows or pushes', async () => {
      const u = await createUser(t);
      await device(u.userId, 'CUSTOMER', 'tok');
      const v = await notifications.notify(u.userId, 'GENERIC', {
        vars: { title: 'Zəng edin', body: 'Ustanın nömrəsi +994 50 123 45 67 və ya 055 765 43 21' },
        data: {
          assignmentId: 'a1',
          phone: '+994501234567',
          customerPhone: '0501234567',
          nested: { contactPhone: '+994551112233', note: 'call 050-111-22-33' },
          address: 'Nizami küç. 10',
          addressId: 'addr-1',
          amount: 2500,
        },
      });
      expect(v!.body).not.toMatch(/\d{3}\s?\d{2}\s?\d{2}/);
      expect(v!.body).toContain('•••');
      expect(v!.data).toEqual({ assignmentId: 'a1', nested: { note: 'call •••' }, addressId: 'addr-1', amount: 2500 });
      const push = pushLog.sentTo(u.userId)[0]!;
      const serialized = JSON.stringify(push.message);
      expect(serialized).not.toMatch(/994|050|055|Nizami/);
    });

    it('GENERIC uses the caller’s text and falls back to the app name for an empty title', async () => {
      const u = await createUser(t);
      const v = await notifications.notify(u.userId, 'GENERIC', { vars: { body: 'Salam' } });
      expect(v).toMatchObject({ title: 'TezFiks', body: 'Salam' });
    });

    it('skips unknown and deleted users', async () => {
      expect(await notifications.notify(crypto.randomUUID(), 'GENERIC', { vars: { title: 'a', body: 'b' } })).toBeNull();
      const u = await createUser(t);
      await t.prisma.user.update({ where: { id: u.userId }, data: { status: 'DELETED' } });
      expect(await notifications.notify(u.userId, 'GENERIC', { vars: { title: 'a', body: 'b' } })).toBeNull();
      expect(await t.prisma.notification.count()).toBe(0);
    });

    it('still notifies blocked users (ACCOUNT_BLOCKED must reach them)', async () => {
      const u = await createUser(t);
      await t.prisma.user.update({ where: { id: u.userId }, data: { status: 'BLOCKED' } });
      expect(await notifications.notify(u.userId, 'ACCOUNT_BLOCKED', { vars: { reason: 'Saxta sifarişlər' } })).toMatchObject({
        body: 'Səbəb: Saxta sifarişlər. Dəstək xidməti ilə əlaqə saxlayın.',
      });
    });

    it('notifyMany: one row per distinct user, each in their locale, one push per device', async () => {
      const a = await createUser(t);
      const b = await createUser(t);
      const c = await createUser(t);
      await t.prisma.user.update({ where: { id: b.userId }, data: { locale: 'ru' } });
      await t.prisma.user.update({ where: { id: c.userId }, data: { locale: 'en' } });
      await device(a.userId, 'PRO', 'ta');
      await device(b.userId, 'PRO', 'tb');
      await device(c.userId, 'PRO', 'tc');
      const views = await notifications.notifyMany([a.userId, b.userId, c.userId, a.userId, crypto.randomUUID()], 'OFFER_CLOSED', {
        vars: { number: 1005 },
        data: { requestId: 'r' },
        app: 'PRO',
      });
      expect(views).toHaveLength(3);
      const byUser = Object.fromEntries(
        (await t.prisma.notification.findMany({ where: { type: 'OFFER_CLOSED' } })).map((n) => [n.userId, n.title]),
      );
      expect(byUser).toEqual({
        [a.userId]: 'Sifariş artıq aktual deyil',
        [b.userId]: 'Заказ больше не актуален',
        [c.userId]: 'Job no longer available',
      });
      for (const u of [a, b, c]) expect(t.realtime.sentTo(rooms.user(u.userId), 'notification:new')).toHaveLength(1);
      expect(pushLog.sent.map((p) => p.delivery.token).sort()).toEqual(['ta', 'tb', 'tc']);
      expect(pushLog.sentTo(b.userId)[0]!.message.title).toBe('Заказ больше не актуален');
      expect(await notifications.notifyMany([], 'GENERIC')).toEqual([]);
    });

    it('delivers notification:new live over the socket', async () => {
      const c = await createCustomer(t);
      const s = await connectSocket(t, { token: c.token });
      const got = nextEvent(s, 'notification:new');
      const v = await notifications.notify(c.userId, 'PAYMENT_SUCCEEDED', { vars: { amount: '25,00 ₼' } });
      expect(await got).toEqual(v);
    });
  });

  describe('endpoints', () => {
    it('list pages newest first with a cursor and shows only the caller’s notifications', async () => {
      const u = await createUser(t);
      const other = await createUser(t);
      for (let i = 0; i < 25; i++) {
        await notifications.notify(u.userId, 'GENERIC', { vars: { title: `n${i}`, body: 'b' }, push: false });
        t.clock.advance(1000);
      }
      await notifications.notify(other.userId, 'GENERIC', { vars: { title: 'foreign', body: 'b' }, push: false });
      const client = t.client(await tokenFor(t, u.userId));
      const p1 = await client.call(api.notifications.list, { query: { limit: 10 } });
      expect(p1.items.map((n) => n.title)).toEqual(Array.from({ length: 10 }, (_, i) => `n${24 - i}`));
      expect(p1.nextCursor).not.toBeNull();
      const p2 = await client.call(api.notifications.list, { query: { limit: 10, cursor: p1.nextCursor! } });
      expect(p2.items.map((n) => n.title)).toEqual(Array.from({ length: 10 }, (_, i) => `n${14 - i}`));
      const p3 = await client.call(api.notifications.list, { query: { limit: 10, cursor: p2.nextCursor! } });
      expect(p3.items.map((n) => n.title)).toEqual(['n4', 'n3', 'n2', 'n1', 'n0']);
      expect(p3.nextCursor).toBeNull();
      const all = await client.call(api.notifications.list, {});
      expect(all.items).toHaveLength(20);
      expect(all.items.every((n) => n.title !== 'foreign')).toBe(true);
    });

    it('list keeps a stable order for notifications created in the same millisecond (notifyMany)', async () => {
      const u = await createUser(t);
      for (let i = 0; i < 3; i++) await notifications.notify(u.userId, 'GENERIC', { vars: { title: `n${i}`, body: 'b' }, push: false });
      const client = t.client(await tokenFor(t, u.userId));
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.call(api.notifications.list, { query: { limit: 1, ...(cursor ? { cursor } : {}) } });
        seen.push(...page.items.map((n) => n.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(new Set(seen).size).toBe(3);
    });

    it('unreadCount and markRead by ids (other users’ ids ignored) and all', async () => {
      const u = await createUser(t);
      const other = await createUser(t);
      const mine = [];
      for (let i = 0; i < 4; i++) mine.push((await notifications.notify(u.userId, 'GENERIC', { vars: { title: `t${i}`, body: 'b' }, push: false }))!);
      const foreign = (await notifications.notify(other.userId, 'GENERIC', { vars: { title: 'x', body: 'b' }, push: false }))!;
      const client = t.client(await tokenFor(t, u.userId));
      expect(await client.call(api.notifications.unreadCount)).toEqual({ count: 4 });

      expect(await client.call(api.notifications.markRead, { body: { ids: [mine[0]!.id, mine[1]!.id, foreign.id] } })).toEqual({ ok: true });
      expect(await client.call(api.notifications.unreadCount)).toEqual({ count: 2 });
      expect((await t.prisma.notification.findUniqueOrThrow({ where: { id: foreign.id } })).readAt).toBeNull();
      const list = await client.call(api.notifications.list, {});
      expect(list.items.filter((n) => n.readAt !== null).map((n) => n.id).sort()).toEqual([mine[0]!.id, mine[1]!.id].sort());

      // Marking again does not move readAt.
      const firstReadAt = (await t.prisma.notification.findUniqueOrThrow({ where: { id: mine[0]!.id } })).readAt;
      t.clock.advance(60_000);
      await client.call(api.notifications.markRead, { body: { ids: [mine[0]!.id] } });
      expect((await t.prisma.notification.findUniqueOrThrow({ where: { id: mine[0]!.id } })).readAt).toEqual(firstReadAt);

      expect(await client.call(api.notifications.markRead, { body: {} })).toEqual({ ok: true });
      expect(await client.call(api.notifications.unreadCount)).toEqual({ count: 2 });

      await client.call(api.notifications.markRead, { body: { all: true } });
      expect(await client.call(api.notifications.unreadCount)).toEqual({ count: 0 });
      expect((await t.prisma.notification.findUniqueOrThrow({ where: { id: foreign.id } })).readAt).toBeNull();
      const otherClient = t.client(await tokenFor(t, other.userId));
      expect(await otherClient.call(api.notifications.unreadCount)).toEqual({ count: 1 });
    });

    it('requires a user token (401 without, admin tokens refused) and validates input', async () => {
      await expect(t.client().call(api.notifications.list, {})).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
      await expect(t.client().call(api.notifications.unreadCount)).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
      await expect(t.client().call(api.notifications.markRead, { body: { all: true } })).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
      const admin = await adminToken(t);
      await expect(t.client(admin.token).call(api.notifications.list, {})).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      const u = await createUser(t);
      const res = await fetch(`${t.baseUrl}/notifications/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await tokenFor(t, u.userId)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ['not-a-uuid'] }),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
    });
  });
});
