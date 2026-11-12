import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { createUser } from '../helpers/factories';
import { OTP_CHANNEL, type OtpChannel, type OtpMessage } from '../../src/modules/auth/otp/otp-channel';
import { azPhone } from './helpers';

const sent: OtpMessage[] = [];
const channel: OtpChannel & { send: ReturnType<typeof vi.fn> } = {
  name: 'whatsapp_cloud',
  send: vi.fn(async (msg: OtpMessage) => {
    sent.push(msg);
  }),
};

describe('A1 OTP login', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp((b) => b.overrideProvider(OTP_CHANNEL).useValue(channel));
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    sent.length = 0;
    channel.send.mockClear();
  });

  const request = (phone: string, headers?: Record<string, string>, app: 'CUSTOMER' | 'PRO' | 'PANEL' = 'CUSTOMER') =>
    t.client().call(api.auth.otpRequest, { body: { phone, app }, headers });
  const verify = (challengeId: string, code: string, app: 'CUSTOMER' | 'PRO' | 'PANEL' = 'CUSTOMER') =>
    t.client().call(api.auth.otpVerify, { body: { challengeId, code, deviceId: 'device-a1-0001', app } });
  const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

  it('sends a 6-digit code to a normalized phone and creates a new user on verify', async () => {
    const res = await t.client('', 'ru').call(api.auth.otpRequest, { body: { phone: '050 555 12 34', app: 'CUSTOMER' } });
    expect(res.phone).toBe('+994505551234');
    expect(res.resendAfterSec).toBe(60);
    expect(res.channel).toBe('whatsapp_cloud');
    expect(res.devCode).toMatch(/^\d{6}$/);
    expect(new Date(res.expiresAt).getTime() - t.clock.nowMs()).toBeGreaterThan(290_000);
    expect(new Date(res.expiresAt).getTime() - t.clock.nowMs()).toBeLessThanOrEqual(300_000);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(sent[0]).toMatchObject({ phone: '+994505551234', code: res.devCode, locale: 'ru', app: 'CUSTOMER', challengeId: res.challengeId });
    expect(sent[0]!.text).toContain(res.devCode!);

    const row = await t.prisma.otpChallenge.findUniqueOrThrow({ where: { id: res.challengeId } });
    expect(row.codeHash).not.toContain(res.devCode!);
    expect(row).toMatchObject({ phone: '+994505551234', app: 'CUSTOMER', locale: 'ru', channel: 'whatsapp_cloud', attempts: 0 });

    const out = await verify(res.challengeId, res.devCode!);
    expect(out.isNewUser).toBe(true);
    expect(out.me).toMatchObject({
      phone: '+994505551234',
      firstName: null,
      lastName: null,
      locale: 'ru',
      status: 'ACTIVE',
      profileComplete: false,
      customer: null,
      handyman: null,
      companies: [],
    });
    const session = await t.prisma.session.findFirstOrThrow({ where: { userId: out.me.id } });
    expect(session).toMatchObject({ app: 'CUSTOMER', deviceId: 'device-a1-0001', revokedAt: null });
    const me = await t.client(out.tokens.accessToken).call(api.me.get);
    expect(me.id).toBe(out.me.id);
  });

  it('logs in a returning user (isNewUser=false) and accepts +994 and 994 formats', async () => {
    const u = await createUser(t, { phone: '+994505550001', firstName: 'Gülnarə', lastName: 'Əliyeva' });
    const res = await request('994505550001', undefined, 'PRO');
    expect(res.phone).toBe('+994505550001');
    const out = await verify(res.challengeId, res.devCode!, 'PRO');
    expect(out.isNewUser).toBe(false);
    expect(out.me).toMatchObject({ id: u.userId, firstName: 'Gülnarə', lastName: 'Əliyeva', profileComplete: true });
    const other = await request('+994 50 555 00 02');
    expect(other.phone).toBe('+994505550002');
  });

  it('rejects invalid and landline numbers with PHONE_INVALID', async () => {
    await expect(request('12345')).rejects.toMatchObject({ code: 'PHONE_INVALID', status: 400 });
    await expect(request('012 498 12 34')).rejects.toMatchObject({ code: 'PHONE_INVALID', status: 400 });
    await expect(request('+7 916 123 45 67')).rejects.toMatchObject({ code: 'PHONE_INVALID', status: 400 });
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('enforces the 60 s resend cooldown per phone', async () => {
    await request(azPhone(1));
    // another phone is not affected by this phone's cooldown
    await expect(request(azPhone(11))).resolves.toMatchObject({ phone: azPhone(11) });
    const err = await request(azPhone(1)).catch((e) => e);
    expect(err).toMatchObject({ code: 'OTP_COOLDOWN', status: 429 });
    expect(err.details.retryAfterSec).toBeGreaterThan(0);
    expect(err.details.retryAfterSec).toBeLessThanOrEqual(60);
    t.clock.advance(30_000);
    const err2 = await request(azPhone(1)).catch((e) => e);
    expect(err2).toMatchObject({ code: 'OTP_COOLDOWN' });
    expect(err2.details.retryAfterSec).toBeLessThanOrEqual(30);
    t.clock.advance(31_000);
    await expect(request(azPhone(1))).resolves.toMatchObject({ phone: azPhone(1) });
    expect(channel.send).toHaveBeenCalledTimes(3);
  });

  it('allows at most 5 codes per phone per hour', async () => {
    for (let i = 0; i < 5; i++) {
      await request(azPhone(7), { 'X-Forwarded-For': `10.0.0.${i + 1}` });
      t.clock.advance(61_000);
    }
    const err = await request(azPhone(7)).catch((e) => e);
    expect(err).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(err.details.retryAfterSec).toBeGreaterThan(0);
    t.clock.advance(60 * 60_000);
    await expect(request(azPhone(7))).resolves.toMatchObject({ phone: azPhone(7) });
  });

  it('allows at most 20 codes per IP per hour', async () => {
    const ip = { 'X-Forwarded-For': '10.9.9.9' };
    for (let i = 0; i < 20; i++) await request(azPhone(100 + i), ip);
    await expect(request(azPhone(200), ip)).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    await expect(request(azPhone(201), { 'X-Forwarded-For': '10.9.9.10' })).resolves.toBeTruthy();
    t.clock.advance(60 * 60_000 + 1000);
    await expect(request(azPhone(200), ip)).resolves.toBeTruthy();
  });

  it('counts wrong codes with attemptsLeft and locks the challenge after 5 failures', async () => {
    const res = await request(azPhone(2));
    const bad = wrong(res.devCode!);
    for (let left = 4; left >= 0; left--) {
      const err = await verify(res.challengeId, bad).catch((e) => e);
      expect(err).toMatchObject({ code: 'OTP_INVALID', status: 400 });
      expect(err.details).toEqual({ attemptsLeft: left });
    }
    // the 6th try is refused even with the correct code
    await expect(verify(res.challengeId, res.devCode!)).rejects.toMatchObject({ code: 'OTP_TOO_MANY_ATTEMPTS', status: 429 });
    expect((await t.prisma.otpChallenge.findUniqueOrThrow({ where: { id: res.challengeId } })).attempts).toBe(5);
    expect(await t.prisma.user.count()).toBe(0);
  });

  it('expires codes after 5 minutes (clock)', async () => {
    const res = await request(azPhone(3));
    t.clock.advance(5 * 60_000 + 1);
    await expect(verify(res.challengeId, res.devCode!)).rejects.toMatchObject({ code: 'OTP_EXPIRED', status: 400 });
  });

  it('accepts a code just before expiry', async () => {
    const res = await request(azPhone(4));
    t.clock.advance(5 * 60_000 - 2000);
    await expect(verify(res.challengeId, res.devCode!)).resolves.toMatchObject({ isNewUser: true });
  });

  it('refuses a consumed challenge, an unknown challenge and a challenge of another app', async () => {
    const res = await request(azPhone(5));
    await verify(res.challengeId, res.devCode!);
    await expect(verify(res.challengeId, res.devCode!)).rejects.toMatchObject({ code: 'OTP_INVALID' });
    await expect(verify('0199f0f0-0000-7000-8000-000000000000', '123456')).rejects.toMatchObject({ code: 'OTP_INVALID' });
    t.clock.advance(61_000);
    const pro = await request(azPhone(5));
    await expect(verify(pro.challengeId, pro.devCode!, 'PRO')).rejects.toMatchObject({ code: 'OTP_INVALID' });
  });

  it('refuses blocked users with USER_BLOCKED and creates no session', async () => {
    const u = await createUser(t, { phone: azPhone(6) });
    await t.prisma.user.update({ where: { id: u.userId }, data: { status: 'BLOCKED', blockedReason: 'fraud' } });
    const res = await request(azPhone(6));
    await expect(verify(res.challengeId, res.devCode!)).rejects.toMatchObject({ code: 'USER_BLOCKED', status: 403 });
    expect(await t.prisma.session.count({ where: { userId: u.userId } })).toBe(0);
  });

  it('only one of two concurrent verifications with the same code succeeds', async () => {
    const res = await request(azPhone(8));
    const results = await Promise.allSettled([verify(res.challengeId, res.devCode!), verify(res.challengeId, res.devCode!)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await t.prisma.user.count({ where: { phone: azPhone(8) } })).toBe(1);
  });

  it('deletes the challenge and reports OTP_DELIVERY_FAILED when the channel fails, without a cooldown', async () => {
    channel.send.mockRejectedValueOnce(new Error('WhatsApp down'));
    const err = await request(azPhone(9)).catch((e) => e);
    expect(err).toMatchObject({ code: 'INTERNAL', status: 500, details: { reason: 'OTP_DELIVERY_FAILED' } });
    expect(await t.prisma.otpChallenge.count()).toBe(0);
    await expect(request(azPhone(9))).resolves.toMatchObject({ phone: azPhone(9) });
  });

  it('localizes the error message', async () => {
    const err = await t
      .client(null, 'en')
      .call(api.auth.otpRequest, { body: { phone: 'abc12', app: 'CUSTOMER' } })
      .catch((e) => e);
    expect(err.code).toBe('PHONE_INVALID');
    expect(typeof err.message).toBe('string');
    expect(err.message.length).toBeGreaterThan(0);
  });
});
