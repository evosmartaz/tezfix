import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../helpers/app';
import { createUser } from '../helpers/factories';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { LogPushSender } from '../../src/modules/notifications/push/log.sender';
import { REDACTED, redactPhones, sanitizeData } from '../../src/modules/notifications/privacy';
import { FcmPushSender, type FcmLikeMessaging } from '../../src/modules/notifications/push/fcm.sender';
import type { PushDelivery, PushMessage } from '../../src/modules/notifications/push/push.types';

describe('phone redaction (Review Focus #2/#4: local Azerbaijani formats)', () => {
  it.each([
    '50 123 45 67',
    '501234567',
    '(55) 123-45-67',
    '70-123-45-67',
    '99 765 43 21',
    '12 404 00 00',
    '+994 (50) 123-45-67',
    '(050) 123 45 67',
    '0501234567',
    '994501234567',
  ])('redacts %s', (phone) => {
    const out = redactPhones(`Zəng: ${phone}.`);
    expect(out).toBe(`Zəng: ${REDACTED}.`);
    expect(out).not.toMatch(/\d{3}[\s-]?\d{2}[\s-]?\d{2}/);
  });

  it.each([
    'Sifariş №1234567',
    'Məbləğ: 25.00 AZN',
    '50 manat 30 qəpik',
    'TZ-2026-000123',
    '0199a000-0000-7000-8000-501234567890',
    'kod a501234567b',
    '15 dəqiqə, 2.4 km',
  ])('leaves %s intact', (text) => {
    expect(redactPhones(text)).toBe(text);
  });

  it('sanitizeData masks local formats inside nested values', () => {
    expect(sanitizeData({ note: 'nömrə 55 765 43 21', list: ['501234567', 'ok'] })).toEqual({ note: `nömrə ${REDACTED}`, list: [REDACTED, 'ok'] });
  });
});

describe('notifications with local phone formats', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    t.app.get(LogPushSender).clear();
  });

  it('never stores or pushes a phone written without 0/+994', async () => {
    const u = await createUser(t);
    await t.prisma.device.create({ data: { userId: u.userId, deviceId: 'dev-safety', app: 'CUSTOMER', platform: 'android', pushToken: 'tok', pushProvider: 'FCM' } });
    const v = await t.app.get(NotificationsService).notify(u.userId, 'GENERIC', {
      vars: { title: 'Usta', body: 'Nömrə: 50 123 45 67 / 551234567' },
      data: { note: 'zəng 70 111 22 33', assignmentId: 'a1' },
    });
    expect(v!.body).not.toMatch(/123 45 67|551234567/);
    expect(v!.data).toEqual({ note: `zəng ${REDACTED}`, assignmentId: 'a1' });
    const row = await t.prisma.notification.findFirstOrThrow({ where: { userId: u.userId } });
    expect(JSON.stringify(row)).not.toMatch(/123 45 67|551234567|111 22 33/);
    const push = t.app.get(LogPushSender).sentTo(u.userId)[0]!;
    expect(JSON.stringify(push.message)).not.toMatch(/123 45 67|551234567|111 22 33/);
  });
});

describe('FcmPushSender init failure recovery', () => {
  const message: PushMessage = { type: 'GENERIC', title: 't', body: 'b', data: {}, priority: 'normal', channelId: 'default_v1' };
  const delivery = (token: string): PushDelivery => ({ token, provider: 'FCM', deviceRowId: crypto.randomUUID(), userId: crypto.randomUUID(), app: 'PRO' });
  const fake: FcmLikeMessaging = { sendEach: async (msgs) => ({ responses: msgs.map(() => ({ success: true })) }) };

  it('a failed init is retried after the retry delay instead of disabling FCM until restart', async () => {
    let calls = 0;
    const sender = new FcmPushSender({ FCM_SERVICE_ACCOUNT: '/missing/service-account.json' }, undefined, {
      retryAfterMs: 0,
      loader: async () => {
        calls++;
        if (calls === 1) throw new Error('ENOENT: service account file not found');
        return fake;
      },
    });
    expect(await sender.send([delivery('tok')], message)).toEqual([{ token: 'tok', ok: false, unregistered: false, error: 'FcmNotConfigured' }]);
    expect(await sender.send([delivery('tok')], message)).toEqual([{ token: 'tok', ok: true, unregistered: false }]);
    expect(await sender.send([delivery('tok2')], message)).toEqual([{ token: 'tok2', ok: true, unregistered: false }]);
    expect(calls).toBe(2); // a successful init is cached
  });

  it('does not retry before the delay has passed (no init storm on every push)', async () => {
    let calls = 0;
    const sender = new FcmPushSender({ FCM_SERVICE_ACCOUNT: '/missing.json' }, undefined, {
      retryAfterMs: 60_000,
      loader: async () => {
        calls++;
        throw new Error('bad file');
      },
    });
    for (let i = 0; i < 3; i++) {
      expect(await sender.send([delivery('tok')], message)).toEqual([{ token: 'tok', ok: false, unregistered: false, error: 'FcmNotConfigured' }]);
    }
    expect(calls).toBe(1);
  });
});
