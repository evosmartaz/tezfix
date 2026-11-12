import type { AppKind, NotificationType } from '@tezfiks/shared';

export type PushChannelId = 'offers_v1' | 'default_v1';
export type PushPriority = 'high' | 'normal';
export type PushSenderName = 'log' | 'expo' | 'fcm';

/** What a push carries. `data` holds ids and amounts only (never phone numbers or addresses). */
export interface PushMessage {
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  priority: PushPriority;
  ttlSec?: number;
  collapseKey?: string;
  channelId: PushChannelId;
}

/** One device that should receive the message. */
export interface PushDelivery {
  token: string;
  provider: 'EXPO' | 'FCM' | null;
  deviceRowId: string;
  userId: string;
  app: AppKind;
}

export interface PushSendResult {
  token: string;
  ok: boolean;
  /** The provider reported the token as no longer registered: the token is removed from the device row. */
  unregistered: boolean;
  error?: string;
}

/** A push transport. Implementations must return one result per delivery and must not throw for per-token errors. */
export interface PushSender {
  readonly name: PushSenderName;
  send(deliveries: PushDelivery[], message: PushMessage): Promise<PushSendResult[]>;
}

export type PushSenders = Record<PushSenderName, PushSender>;

/** Injection token for the sender map (tests override it with mocks). */
export const PUSH_SENDERS = Symbol('PUSH_SENDERS');

/** Flat string map used for FCM data messages (expo-notifications compatible: title, message, body = JSON data, channelId). */
export function toFcmData(message: PushMessage): Record<string, string> {
  const data = { type: message.type, ...message.data };
  const out: Record<string, string> = {
    type: message.type,
    title: message.title,
    message: message.body,
    body: JSON.stringify(data),
    channelId: message.channelId,
    priority: message.priority === 'high' ? 'max' : 'default',
  };
  if (message.channelId === 'offers_v1') out.sound = 'default';
  return out;
}
