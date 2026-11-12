import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import type { Env } from '../../../config/env';
import { toFcmData, type PushDelivery, type PushMessage, type PushSendResult, type PushSender } from './push.types';

/** The subset of firebase-admin Messaging this sender uses (lets tests pass a fake). */
export interface FcmLikeMessaging {
  sendEach(messages: FcmMessage[]): Promise<{ responses: Array<{ success: boolean; error?: { code?: string; message?: string } }> }>;
}

export interface FcmMessage {
  token: string;
  data: Record<string, string>;
  android: { priority: 'high' | 'normal'; ttl?: number; collapseKey?: string };
}

const UNREGISTERED_CODES = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);
const FCM_BATCH = 500;

/** Builds the FCM data message for one token (Android priority, TTL in ms, collapse key; channel is in the data). */
export function buildFcmMessage(token: string, message: PushMessage): FcmMessage {
  const android: FcmMessage['android'] = { priority: message.priority === 'high' ? 'high' : 'normal' };
  if (message.ttlSec !== undefined) android.ttl = Math.max(0, Math.round(message.ttlSec * 1000));
  if (message.collapseKey) android.collapseKey = message.collapseKey;
  return { token, data: toFcmData(message), android };
}

/** Firebase Cloud Messaging sender (Device.pushProvider FCM). firebase-admin is loaded lazily. */
export class FcmPushSender implements PushSender {
  readonly name = 'fcm' as const;
  private readonly log = new Logger('FcmPush');
  private messagingPromise?: Promise<FcmLikeMessaging | null>;
  /** Wall-clock ms of the last failed init (infrastructure retry timer, not business time). */
  private failedAt: number | null = null;
  private readonly retryAfterMs: number;
  private readonly loader: () => Promise<FcmLikeMessaging | null>;

  /**
   * @param messaging a ready Messaging (tests)
   * @param opts.loader replaces the firebase-admin initialisation (tests); opts.retryAfterMs: a failed init (bad or missing
   *   service-account file, invalid JSON) is retried on the next send after this delay instead of disabling FCM until restart.
   */
  constructor(
    private readonly env: Pick<Env, 'FCM_SERVICE_ACCOUNT'>,
    messaging?: FcmLikeMessaging,
    opts: { loader?: () => Promise<FcmLikeMessaging | null>; retryAfterMs?: number } = {},
  ) {
    if (messaging) this.messagingPromise = Promise.resolve(messaging);
    this.loader = opts.loader ?? (() => this.init());
    this.retryAfterMs = opts.retryAfterMs ?? 60_000;
  }

  private messaging(): Promise<FcmLikeMessaging | null> {
    if (this.messagingPromise && this.failedAt !== null && Date.now() - this.failedAt >= this.retryAfterMs) {
      this.messagingPromise = undefined;
    }
    if (!this.messagingPromise) {
      this.failedAt = null;
      this.messagingPromise = this.loader().catch((err) => {
        this.log.error(`FCM init failed: ${(err as Error).message}`);
        this.failedAt = Date.now();
        return null;
      });
    }
    return this.messagingPromise;
  }

  private async init(): Promise<FcmLikeMessaging | null> {
    const raw = this.env.FCM_SERVICE_ACCOUNT;
    if (!raw) {
      this.log.warn('FCM_SERVICE_ACCOUNT is not set: FCM pushes are skipped');
      return null;
    }
    const json = raw.trim().startsWith('{') ? raw : readFileSync(raw, 'utf8');
    const account = JSON.parse(json) as Record<string, unknown>;
    const appMod = await import('firebase-admin/app');
    const msgMod = await import('firebase-admin/messaging');
    const name = 'tezfiks-push';
    const existing = appMod.getApps().find((a) => a.name === name);
    const app = existing ?? appMod.initializeApp({ credential: appMod.cert(account as never) }, name);
    return msgMod.getMessaging(app) as unknown as FcmLikeMessaging;
  }

  async send(deliveries: PushDelivery[], message: PushMessage): Promise<PushSendResult[]> {
    const messaging = await this.messaging();
    if (!messaging) return deliveries.map((d) => ({ token: d.token, ok: false, unregistered: false, error: 'FcmNotConfigured' }));
    const results: PushSendResult[] = [];
    for (let i = 0; i < deliveries.length; i += FCM_BATCH) {
      const batch = deliveries.slice(i, i + FCM_BATCH);
      try {
        const res = await messaging.sendEach(batch.map((d) => buildFcmMessage(d.token, message)));
        batch.forEach((d, j) => {
          const r = res.responses[j];
          if (r?.success) results.push({ token: d.token, ok: true, unregistered: false });
          else {
            const code = r?.error?.code ?? 'messaging/unknown';
            results.push({ token: d.token, ok: false, unregistered: UNREGISTERED_CODES.has(code), error: code });
          }
        });
      } catch (err) {
        this.log.warn(`fcm send failed: ${(err as Error).message}`);
        for (const d of batch) results.push({ token: d.token, ok: false, unregistered: false, error: (err as Error).message });
      }
    }
    return results;
  }
}
