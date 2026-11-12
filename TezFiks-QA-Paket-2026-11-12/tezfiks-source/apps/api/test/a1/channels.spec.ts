import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { ENV, loadEnv, type Env } from '../../src/config/env';
import {
  OTP_FETCH,
  WebhookOtpChannel,
  WhatsAppCloudOtpChannel,
  createOtpChannel,
  ConsoleOtpChannel,
  type OtpMessage,
} from '../../src/modules/auth/otp/otp-channel';
import { azPhone } from './helpers';

const WEBHOOK_URL = 'https://bot.tezfiks.test/otp';
const WEBHOOK_SECRET = 'founder-bot-secret';
const APP_SECRET = 'meta-app-secret';
const VERIFY_TOKEN = 'verify-me-please';

const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"ok":true}', { status: 200 }));

function envOverride(): Env {
  return {
    ...loadEnv(),
    OTP_CHANNEL: 'webhook',
    OTP_DEV_ECHO: false,
    OTP_WEBHOOK_URL: WEBHOOK_URL,
    OTP_WEBHOOK_SECRET: WEBHOOK_SECRET,
    OTP_BYPASS_PHONES: ['050 555 99 99', '+994505559998'],
    OTP_BYPASS_CODE: '424242',
    WHATSAPP_APP_SECRET: APP_SECRET,
    WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
  };
}

const msg: OtpMessage = {
  challengeId: '0199f0f0-0000-7000-8000-000000000001',
  phone: '+994505551234',
  code: '123456',
  locale: 'az',
  expiresAt: new Date('2026-10-25T10:05:00.000Z'),
  app: 'CUSTOMER',
  text: 'TezFiks kodu: 123456',
};

describe('A1 OTP channels (unit)', () => {
  it('whatsapp_cloud posts the authentication template with body and URL-button parameters', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 200 }));
    const ch = new WhatsAppCloudOtpChannel(
      { WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_TEMPLATE: 'tezfiks_login', WHATSAPP_GRAPH_VERSION: 'v26.0' },
      f,
    );
    await ch.send({ ...msg, locale: 'ru' });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v26.0/1234567890/messages');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '994505551234',
      type: 'template',
      template: {
        name: 'tezfiks_login',
        language: { code: 'ru' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '123456' }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '123456' }] },
        ],
      },
    });
  });

  it('whatsapp_cloud and webhook throw on a non-2xx response or missing configuration', async () => {
    const failing = vi.fn(async () => new Response('bad', { status: 500 }));
    const wa = new WhatsAppCloudOtpChannel(
      { WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_TEMPLATE: 'tezfiks_login', WHATSAPP_GRAPH_VERSION: 'v26.0' },
      failing,
    );
    await expect(wa.send(msg)).rejects.toThrow(/500/);
    await expect(new WebhookOtpChannel({ OTP_WEBHOOK_URL: WEBHOOK_URL, OTP_WEBHOOK_SECRET: 's' }, failing).send(msg)).rejects.toThrow();
    await expect(new WebhookOtpChannel({ OTP_WEBHOOK_URL: undefined, OTP_WEBHOOK_SECRET: 's' }, failing).send(msg)).rejects.toThrow();
    await expect(
      new WhatsAppCloudOtpChannel(
        { WHATSAPP_TOKEN: undefined, WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_TEMPLATE: 't', WHATSAPP_GRAPH_VERSION: 'v26.0' },
        failing,
      ).send(msg),
    ).rejects.toThrow();
  });

  it('selects the channel from OTP_CHANNEL', () => {
    const env = loadEnv();
    expect(createOtpChannel({ ...env, OTP_CHANNEL: 'console' }, fetchMock)).toBeInstanceOf(ConsoleOtpChannel);
    expect(createOtpChannel({ ...env, OTP_CHANNEL: 'webhook' }, fetchMock)).toBeInstanceOf(WebhookOtpChannel);
    expect(createOtpChannel({ ...env, OTP_CHANNEL: 'whatsapp_cloud' }, fetchMock)).toBeInstanceOf(WhatsAppCloudOtpChannel);
  });
});

describe('A1 OTP webhook channel, bypass phones and WhatsApp webhook (e2e)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp((b) => b.overrideProvider(ENV).useValue(envOverride()).overrideProvider(OTP_FETCH).useValue(fetchMock));
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    fetchMock.mockClear();
  });

  it('webhook channel POSTs {phone, code, locale, expiresAt, app} signed with X-TezFiks-Signature', async () => {
    const res = await t.client(null, 'en').call(api.auth.otpRequest, { body: { phone: '0505551234', app: 'PRO' } });
    expect(res.channel).toBe('webhook');
    expect(res.devCode).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(WEBHOOK_URL);
    expect(init.method).toBe('POST');
    const raw = init.body as string;
    const headers = init.headers as Record<string, string>;
    expect(headers['X-TezFiks-Signature']).toBe(`sha256=${createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex')}`);
    const body = JSON.parse(raw) as { phone: string; code: string; locale: string; expiresAt: string; app: string; message: string };
    expect(body).toMatchObject({ phone: '+994505551234', locale: 'en', app: 'PRO', expiresAt: res.expiresAt });
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.message).toContain(body.code);

    const out = await t.client().call(api.auth.otpVerify, {
      body: { challengeId: res.challengeId, code: body.code, deviceId: 'device-a1-0002', app: 'PRO' },
    });
    expect(out.isNewUser).toBe(true);
    expect(out.me.locale).toBe('en');
  });

  it('bypass phones use OTP_BYPASS_CODE, send nothing and skip the per-phone cooldown', async () => {
    const first = await t.client().call(api.auth.otpRequest, { body: { phone: '+994505559999', app: 'CUSTOMER' } });
    const second = await t.client().call(api.auth.otpRequest, { body: { phone: '0505559998', app: 'CUSTOMER' } });
    const again = await t.client().call(api.auth.otpRequest, { body: { phone: '+994505559999', app: 'CUSTOMER' } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(first.devCode).toBeUndefined();
    const row = await t.prisma.otpChallenge.findUniqueOrThrow({ where: { id: first.challengeId } });
    expect(row.channel).toBe('bypass');
    const out = await t.client().call(api.auth.otpVerify, {
      body: { challengeId: again.challengeId, code: '424242', deviceId: 'device-a1-0003', app: 'CUSTOMER' },
    });
    expect(out.me.phone).toBe('+994505559999');
    await expect(
      t.client().call(api.auth.otpVerify, { body: { challengeId: second.challengeId, code: '111111', deviceId: 'device-a1-0003', app: 'CUSTOMER' } }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    // a normal phone still gets a random code through the channel
    await t.client().call(api.auth.otpRequest, { body: { phone: azPhone(12), app: 'CUSTOMER' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('webhook delivery failure -> INTERNAL with reason OTP_DELIVERY_FAILED', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 502 }));
    await expect(t.client().call(api.auth.otpRequest, { body: { phone: azPhone(13), app: 'CUSTOMER' } })).rejects.toMatchObject({
      code: 'INTERNAL',
      details: { reason: 'OTP_DELIVERY_FAILED' },
    });
    expect(await t.prisma.otpChallenge.count()).toBe(0);
  });

  it('GET /webhooks/whatsapp echoes hub.challenge only for the right verify token', async () => {
    const ok = await fetch(`${t.baseUrl}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=987654`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('987654');
    const bad = await fetch(`${t.baseUrl}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1`);
    expect(bad.status).toBe(403);
    const badMode = await fetch(`${t.baseUrl}/webhooks/whatsapp?hub.mode=unsubscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`);
    expect(badMode.status).toBe(403);
  });

  it('POST /webhooks/whatsapp verifies X-Hub-Signature-256 over the raw body', async () => {
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.1', status: 'delivered', recipient_id: '994505551234' }] } }] }],
    });
    const sig = `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;
    const ok = await fetch(`${t.baseUrl}/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
      body: raw,
    });
    expect(ok.status).toBe(200);
    // same JSON, different bytes (whitespace) -> the signature no longer matches
    const tampered = await fetch(`${t.baseUrl}/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
      body: raw.replace('"delivered"', '"read"'),
    });
    expect(tampered.status).toBe(403);
    const missing = await fetch(`${t.baseUrl}/webhooks/whatsapp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw });
    expect(missing.status).toBe(403);
  });
});

describe('A1 WhatsApp webhook without configuration', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  it('refuses verification and events when no verify token / app secret is configured', async () => {
    const get = await fetch(`${t.baseUrl}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=&hub.challenge=1`);
    expect(get.status).toBe(403);
    const raw = '{}';
    const post = await fetch(`${t.baseUrl}/webhooks/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${createHmac('sha256', '').update(raw).digest('hex')}` },
      body: raw,
    });
    expect(post.status).toBe(403);
  });
});
