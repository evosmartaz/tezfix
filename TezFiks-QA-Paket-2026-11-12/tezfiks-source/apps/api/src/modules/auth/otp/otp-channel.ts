import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { maskPhone, type AppKind, type Locale } from '@tezfiks/shared';
import type { Env } from '../../../config/env';

/** Injection token of the OtpChannel used by OtpService (tests replace it with a mock). */
export const OTP_CHANNEL = Symbol('OTP_CHANNEL');
/** Injection token of the fetch implementation used by HTTP channels (tests replace it with a mock). */
export const OTP_FETCH = Symbol('OTP_FETCH');

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface OtpMessage {
  challengeId: string;
  /** E.164, e.g. +994501234567 */
  phone: string;
  code: string;
  locale: Locale;
  expiresAt: Date;
  app: AppKind;
  /** Localized human text ("Your TezFiks verification code: ..."). */
  text: string;
}

/** Delivers login codes. Implementations throw when delivery fails. */
export interface OtpChannel {
  readonly name: string;
  send(msg: OtpMessage): Promise<void>;
}

const TIMEOUT_MS = 10_000;

/** Development channel: logs the masked phone and the code. */
export class ConsoleOtpChannel implements OtpChannel {
  readonly name = 'console';
  private readonly log = new Logger('OTP');

  async send(msg: OtpMessage): Promise<void> {
    this.log.log(`login code for ${maskPhone(msg.phone)} (${msg.app}): ${msg.code}`);
  }
}

/** Meta WhatsApp Cloud API: authentication template with a body parameter and a copy-code URL button. */
export class WhatsAppCloudOtpChannel implements OtpChannel {
  readonly name = 'whatsapp_cloud';

  constructor(
    private readonly env: Pick<Env, 'WHATSAPP_TOKEN' | 'WHATSAPP_PHONE_NUMBER_ID' | 'WHATSAPP_TEMPLATE' | 'WHATSAPP_GRAPH_VERSION'>,
    private readonly fetchFn: FetchFn,
  ) {}

  payload(msg: OtpMessage): Record<string, unknown> {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: msg.phone.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: this.env.WHATSAPP_TEMPLATE,
        language: { code: msg.locale },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: msg.code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: msg.code }] },
        ],
      },
    };
  }

  async send(msg: OtpMessage): Promise<void> {
    if (!this.env.WHATSAPP_TOKEN || !this.env.WHATSAPP_PHONE_NUMBER_ID) throw new Error('WhatsApp Cloud API is not configured');
    const url = `https://graph.facebook.com/${this.env.WHATSAPP_GRAPH_VERSION}/${this.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.env.WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(this.payload(msg)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`WhatsApp Cloud API responded ${res.status}: ${text.slice(0, 300)}`);
    }
  }
}

/** HMAC-SHA256 signature header value for the webhook channel: "sha256=<hex>". */
export function signWebhookBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

/** The founder's own WhatsApp bot: POST JSON signed with X-TezFiks-Signature. */
export class WebhookOtpChannel implements OtpChannel {
  readonly name = 'webhook';

  constructor(
    private readonly env: Pick<Env, 'OTP_WEBHOOK_URL' | 'OTP_WEBHOOK_SECRET'>,
    private readonly fetchFn: FetchFn,
  ) {}

  async send(msg: OtpMessage): Promise<void> {
    if (!this.env.OTP_WEBHOOK_URL || !this.env.OTP_WEBHOOK_SECRET) throw new Error('OTP webhook is not configured');
    const body = JSON.stringify({
      phone: msg.phone,
      code: msg.code,
      locale: msg.locale,
      expiresAt: msg.expiresAt.toISOString(),
      app: msg.app,
      message: msg.text,
    });
    const res = await this.fetchFn(this.env.OTP_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-TezFiks-Signature': signWebhookBody(body, this.env.OTP_WEBHOOK_SECRET) },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`OTP webhook responded ${res.status}`);
  }
}

/** Picks the channel configured by OTP_CHANNEL. */
export function createOtpChannel(env: Env, fetchFn: FetchFn): OtpChannel {
  switch (env.OTP_CHANNEL) {
    case 'whatsapp_cloud':
      return new WhatsAppCloudOtpChannel(env, fetchFn);
    case 'webhook':
      return new WebhookOtpChannel(env, fetchFn);
    default:
      return new ConsoleOtpChannel();
  }
}
