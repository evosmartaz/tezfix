import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app';
import { createUser } from '../helpers/factories';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PushService } from '../../src/modules/notifications/push/push.service';
import { ExpoPushSender, type ExpoLikeClient, type ExpoMessage, type ExpoTicket } from '../../src/modules/notifications/push/expo.sender';
import { buildFcmMessage, FcmPushSender, type FcmLikeMessaging, type FcmMessage } from '../../src/modules/notifications/push/fcm.sender';
import {
  PUSH_SENDERS,
  toFcmData,
  type PushDelivery,
  type PushMessage,
  type PushSendResult,
  type PushSender,
  type PushSenderName,
} from '../../src/modules/notifications/push/push.types';
import type { Env } from '../../src/config/env';

/** Mock sender: tokens starting with "dead" are reported unregistered, "fail" fails, "boom" makes the sender throw. */
class MockSender implements PushSender {
  readonly calls: Array<{ deliveries: PushDelivery[]; message: PushMessage }> = [];
  constructor(readonly name: PushSenderName) {}
  async send(deliveries: PushDelivery[], message: PushMessage): Promise<PushSendResult[]> {
    this.calls.push({ deliveries, message });
    if (deliveries.some((d) => d.token.startsWith('boom'))) throw new Error('provider exploded');
    return deliveries.map((d) =>
      d.token.startsWith('dead')
        ? { token: d.token, ok: false, unregistered: true, error: 'DeviceNotRegistered' }
        : d.token.startsWith('fail')
          ? { token: d.token, ok: false, unregistered: false, error: 'MessageRateExceeded' }
          : { token: d.token, ok: true, unregistered: false },
    );
  }
}

const message: PushMessage = {
  type: 'OFFER_NEW',
  title: 'Yeni sifariş: Santexnik',
  body: 'Sifariş №1001',
  data: { offerId: 'o1', requestId: 'r1', fee: 1000 },
  priority: 'high',
  ttlSec: 45,
  collapseKey: 'offer',
  channelId: 'offers_v1',
};

const delivery = (token: string, provider: 'EXPO' | 'FCM' | null = null): PushDelivery => ({
  token,
  provider,
  deviceRowId: crypto.randomUUID(),
  userId: crypto.randomUUID(),
  app: 'PRO',
});

describe('push delivery with a mocked sender (token cleanup)', () => {
  let t: TestApp;
  const senders = { log: new MockSender('log'), expo: new MockSender('expo'), fcm: new MockSender('fcm') };
  beforeAll(async () => {
    t = await createTestApp((b) => b.overrideProvider(PUSH_SENDERS).useValue(senders));
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    for (const s of Object.values(senders)) s.calls.length = 0;
  });

  async function device(userId: string, token: string, deviceId = `d-${token}`) {
    return t.prisma.device.create({ data: { userId, deviceId, app: 'PRO', platform: 'android', pushToken: token, pushProvider: 'FCM' } });
  }

  it('removes tokens the provider reports as unregistered and keeps the others', async () => {
    const u = await createUser(t);
    const dead = await device(u.userId, 'dead-token-1');
    const live = await device(u.userId, 'live-token-1');
    const flaky = await device(u.userId, 'fail-token-1');
    const view = await t.app.get(NotificationsService).notify(u.userId, 'KYC_APPROVED', { app: 'PRO' });
    expect(view).not.toBeNull();
    expect(senders.log.calls).toHaveLength(1);
    expect(senders.log.calls[0]!.deliveries.map((d) => d.token).sort()).toEqual(['dead-token-1', 'fail-token-1', 'live-token-1']);
    expect((await t.prisma.device.findUniqueOrThrow({ where: { id: dead.id } })).pushToken).toBeNull();
    expect((await t.prisma.device.findUniqueOrThrow({ where: { id: dead.id } })).pushProvider).toBeNull();
    expect((await t.prisma.device.findUniqueOrThrow({ where: { id: live.id } })).pushToken).toBe('live-token-1');
    expect((await t.prisma.device.findUniqueOrThrow({ where: { id: flaky.id } })).pushToken).toBe('fail-token-1');

    // The removed token is not used again.
    await t.app.get(NotificationsService).notify(u.userId, 'KYC_APPROVED', { app: 'PRO' });
    expect(senders.log.calls[1]!.deliveries.map((d) => d.token).sort()).toEqual(['fail-token-1', 'live-token-1']);
  });

  it('the same dead token registered on several device rows is removed everywhere', async () => {
    const a = await createUser(t);
    const b = await createUser(t);
    await device(a.userId, 'dead-shared');
    await device(b.userId, 'dead-shared');
    const outcome = await t.app.get(PushService).sendToUsers([a.userId], message);
    expect(outcome).toEqual({ attempted: 1, delivered: 0, removedTokens: 2 });
    expect(await t.prisma.device.count({ where: { pushToken: 'dead-shared' } })).toBe(0);
  });

  it('a throwing sender never breaks notify (row and socket event still happen)', async () => {
    const u = await createUser(t);
    await device(u.userId, 'boom-token');
    const view = await t.app.get(NotificationsService).notify(u.userId, 'GENERIC', { vars: { title: 'a', body: 'b' } });
    expect(view).toMatchObject({ title: 'a', body: 'b' });
    expect(await t.prisma.device.count({ where: { pushToken: 'boom-token' } })).toBe(1);
    await expect(t.app.get(PushService).sendToUsers([u.userId], message)).resolves.toEqual({ attempted: 1, delivered: 0, removedTokens: 0 });
  });

  it('users without devices are a no-op', async () => {
    const u = await createUser(t);
    expect(await t.app.get(PushService).sendToUsers([u.userId], message)).toEqual({ attempted: 0, delivered: 0, removedTokens: 0 });
    expect(await t.app.get(PushService).sendToUsers([], message)).toEqual({ attempted: 0, delivered: 0, removedTokens: 0 });
    expect(senders.log.calls).toHaveLength(0);
  });
});

describe('PushService sender routing (PUSH_PROVIDER=expo|fcm)', () => {
  const prismaStub = { device: { updateMany: async () => ({ count: 0 }) } };

  it('routes by the device push provider, inferring it from the token when missing', async () => {
    const senders = { log: new MockSender('log'), expo: new MockSender('expo'), fcm: new MockSender('fcm') };
    const svc = new PushService(prismaStub as never, { PUSH_PROVIDER: 'fcm' } as Env, senders);
    const out = await svc.deliver(
      [delivery('ExponentPushToken[abc]', 'EXPO'), delivery('fcm-1', 'FCM'), delivery('ExponentPushToken[xyz]'), delivery('raw-fcm')],
      message,
    );
    expect(out).toEqual({ attempted: 4, delivered: 4, removedTokens: 0 });
    expect(senders.expo.calls[0]!.deliveries.map((d) => d.token)).toEqual(['ExponentPushToken[abc]', 'ExponentPushToken[xyz]']);
    expect(senders.fcm.calls[0]!.deliveries.map((d) => d.token)).toEqual(['fcm-1', 'raw-fcm']);
    expect(senders.log.calls).toHaveLength(0);
  });

  it('PUSH_PROVIDER=log sends every device to the log sender', async () => {
    const senders = { log: new MockSender('log'), expo: new MockSender('expo'), fcm: new MockSender('fcm') };
    const svc = new PushService(prismaStub as never, { PUSH_PROVIDER: 'log' } as Env, senders);
    await svc.deliver([delivery('ExponentPushToken[abc]', 'EXPO'), delivery('fcm-1', 'FCM')], message);
    expect(senders.log.calls[0]!.deliveries).toHaveLength(2);
    expect(senders.expo.calls).toHaveLength(0);
    expect(senders.fcm.calls).toHaveLength(0);
  });

  it('a cleanup failure is swallowed', async () => {
    const senders = { log: new MockSender('log'), expo: new MockSender('expo'), fcm: new MockSender('fcm') };
    const broken = { device: { updateMany: async () => Promise.reject(new Error('db down')) } };
    const svc = new PushService(broken as never, { PUSH_PROVIDER: 'log' } as Env, senders);
    await expect(svc.deliver([delivery('dead-1')], message)).resolves.toEqual({ attempted: 1, delivered: 0, removedTokens: 0 });
  });
});

describe('ExpoPushSender', () => {
  class FakeExpo implements ExpoLikeClient {
    readonly sent: ExpoMessage[][] = [];
    constructor(private readonly tickets: (m: ExpoMessage) => ExpoTicket) {}
    chunkPushNotifications(messages: ExpoMessage[]): ExpoMessage[][] {
      const out: ExpoMessage[][] = [];
      for (let i = 0; i < messages.length; i += 2) out.push(messages.slice(i, i + 2));
      return out;
    }
    async sendPushNotificationsAsync(messages: ExpoMessage[]): Promise<ExpoTicket[]> {
      this.sent.push(messages);
      return messages.map(this.tickets);
    }
  }

  it('maps tickets: ok, DeviceNotRegistered (unregistered), other errors; malformed tokens are dropped as unregistered', async () => {
    const fake = new FakeExpo((m) =>
      m.to.includes('dead')
        ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
        : m.to.includes('rate')
          ? { status: 'error', message: 'slow down', details: { error: 'MessageRateExceeded' } }
          : { status: 'ok', id: 'receipt' },
    );
    const sender = new ExpoPushSender({ EXPO_ACCESS_TOKEN: undefined }, fake);
    const res = await sender.send(
      [delivery('ExponentPushToken[ok1]'), delivery('ExponentPushToken[dead]'), delivery('ExponentPushToken[rate]'), delivery('garbage')],
      message,
    );
    expect(res).toEqual([
      { token: 'ExponentPushToken[ok1]', ok: true, unregistered: false },
      { token: 'ExponentPushToken[dead]', ok: false, unregistered: true, error: 'DeviceNotRegistered' },
      { token: 'ExponentPushToken[rate]', ok: false, unregistered: false, error: 'MessageRateExceeded' },
      { token: 'garbage', ok: false, unregistered: true, error: 'InvalidExpoToken' },
    ]);
    expect(fake.sent.flat()).toHaveLength(3);
    expect(fake.sent[0]![0]).toEqual({
      to: 'ExponentPushToken[ok1]',
      title: message.title,
      body: message.body,
      data: { type: 'OFFER_NEW', offerId: 'o1', requestId: 'r1', fee: 1000 },
      priority: 'high',
      channelId: 'offers_v1',
      sound: 'default',
      ttl: 45,
      collapseId: 'offer',
    });
  });

  it('a transport failure marks the chunk failed without throwing', async () => {
    const fake: ExpoLikeClient = {
      chunkPushNotifications: (m) => [m],
      sendPushNotificationsAsync: async () => {
        throw new Error('network');
      },
    };
    const sender = new ExpoPushSender({ EXPO_ACCESS_TOKEN: undefined }, fake);
    expect(await sender.send([delivery('ExponentPushToken[a]')], message)).toEqual([
      { token: 'ExponentPushToken[a]', ok: false, unregistered: false, error: 'network' },
    ]);
  });
});

describe('FcmPushSender', () => {
  it('builds data messages with android priority, TTL in ms and the collapse key (channel in data)', () => {
    const m = buildFcmMessage('tok', message);
    expect(m).toEqual({
      token: 'tok',
      data: {
        type: 'OFFER_NEW',
        title: message.title,
        message: message.body,
        body: JSON.stringify({ type: 'OFFER_NEW', offerId: 'o1', requestId: 'r1', fee: 1000 }),
        channelId: 'offers_v1',
        priority: 'max',
        sound: 'default',
      },
      android: { priority: 'high', ttl: 45_000, collapseKey: 'offer' },
    });
    expect(Object.values(m.data).every((v) => typeof v === 'string')).toBe(true);
    const normal = buildFcmMessage('tok', { ...message, priority: 'normal', channelId: 'default_v1', ttlSec: undefined, collapseKey: undefined });
    expect(normal.android).toEqual({ priority: 'normal' });
    expect(toFcmData({ ...message, channelId: 'default_v1' }).sound).toBeUndefined();
  });

  it('maps registration-token-not-registered to unregistered', async () => {
    const sent: FcmMessage[][] = [];
    const fake: FcmLikeMessaging = {
      sendEach: async (msgs) => {
        sent.push(msgs);
        return {
          responses: msgs.map((m) =>
            m.token === 'dead'
              ? { success: false, error: { code: 'messaging/registration-token-not-registered' } }
              : m.token === 'quota'
                ? { success: false, error: { code: 'messaging/quota-exceeded' } }
                : { success: true },
          ),
        };
      },
    };
    const sender = new FcmPushSender({ FCM_SERVICE_ACCOUNT: undefined }, fake);
    expect(await sender.send([delivery('ok'), delivery('dead'), delivery('quota')], message)).toEqual([
      { token: 'ok', ok: true, unregistered: false },
      { token: 'dead', ok: false, unregistered: true, error: 'messaging/registration-token-not-registered' },
      { token: 'quota', ok: false, unregistered: false, error: 'messaging/quota-exceeded' },
    ]);
    expect(sent[0]).toHaveLength(3);
  });

  it('without FCM_SERVICE_ACCOUNT nothing is sent and nothing throws', async () => {
    const sender = new FcmPushSender({ FCM_SERVICE_ACCOUNT: undefined });
    expect(await sender.send([delivery('tok')], message)).toEqual([{ token: 'tok', ok: false, unregistered: false, error: 'FcmNotConfigured' }]);
  });

  it('a bad service account is logged, not thrown', async () => {
    const sender = new FcmPushSender({ FCM_SERVICE_ACCOUNT: '{not json' });
    expect(await sender.send([delivery('tok')], message)).toEqual([{ token: 'tok', ok: false, unregistered: false, error: 'FcmNotConfigured' }]);
  });
});
