import { Logger } from '@nestjs/common';
import type { Env } from '../../../config/env';
import type { PushDelivery, PushMessage, PushSendResult, PushSender } from './push.types';

/** The subset of expo-server-sdk's Expo client this sender uses (lets tests pass a fake). */
export interface ExpoLikeClient {
  chunkPushNotifications(messages: ExpoMessage[]): ExpoMessage[][];
  sendPushNotificationsAsync(messages: ExpoMessage[]): Promise<ExpoTicket[]>;
}

export interface ExpoMessage {
  to: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
  ttl?: number;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
  sound?: string | null;
  collapseId?: string;
}

export type ExpoTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string; expoPushToken?: string } };

export function isExpoToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[.+\]$/.test(token);
}

/** Expo push service sender (Device.pushProvider EXPO). The SDK is loaded lazily (ESM package). */
export class ExpoPushSender implements PushSender {
  readonly name = 'expo' as const;
  private readonly log = new Logger('ExpoPush');
  private clientPromise?: Promise<ExpoLikeClient>;

  constructor(
    private readonly env: Pick<Env, 'EXPO_ACCESS_TOKEN'>,
    client?: ExpoLikeClient,
  ) {
    if (client) this.clientPromise = Promise.resolve(client);
  }

  private client(): Promise<ExpoLikeClient> {
    if (!this.clientPromise) {
      this.clientPromise = import('expo-server-sdk').then(
        (mod) => new mod.Expo({ accessToken: this.env.EXPO_ACCESS_TOKEN }) as unknown as ExpoLikeClient,
      );
    }
    return this.clientPromise;
  }

  async send(deliveries: PushDelivery[], message: PushMessage): Promise<PushSendResult[]> {
    const results = new Map<string, PushSendResult>();
    const valid: PushDelivery[] = [];
    for (const d of deliveries) {
      if (isExpoToken(d.token)) valid.push(d);
      else results.set(d.token, { token: d.token, ok: false, unregistered: true, error: 'InvalidExpoToken' });
    }
    if (valid.length) {
      const client = await this.client();
      const messages: ExpoMessage[] = valid.map((d) => ({
        to: d.token,
        title: message.title,
        body: message.body,
        data: { type: message.type, ...message.data },
        priority: message.priority === 'high' ? 'high' : 'normal',
        channelId: message.channelId,
        sound: message.channelId === 'offers_v1' ? 'default' : null,
        ...(message.ttlSec !== undefined ? { ttl: message.ttlSec } : {}),
        ...(message.collapseKey ? { collapseId: message.collapseKey } : {}),
      }));
      for (const chunk of client.chunkPushNotifications(messages)) {
        let tickets: ExpoTicket[];
        try {
          tickets = await client.sendPushNotificationsAsync(chunk);
        } catch (err) {
          this.log.warn(`expo send failed: ${(err as Error).message}`);
          for (const m of chunk) results.set(m.to, { token: m.to, ok: false, unregistered: false, error: (err as Error).message });
          continue;
        }
        chunk.forEach((m, i) => {
          const ticket = tickets[i];
          if (!ticket) {
            results.set(m.to, { token: m.to, ok: false, unregistered: false, error: 'NoTicket' });
          } else if (ticket.status === 'ok') {
            results.set(m.to, { token: m.to, ok: true, unregistered: false });
          } else {
            const code = ticket.details?.error ?? 'ExpoError';
            results.set(m.to, { token: m.to, ok: false, unregistered: code === 'DeviceNotRegistered', error: code });
          }
        });
      }
    }
    return deliveries.map((d) => results.get(d.token) ?? { token: d.token, ok: false, unregistered: false, error: 'NotSent' });
  }
}
