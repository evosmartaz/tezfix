import type { NotificationView } from '@tezfiks/shared';

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Where a tap on a notification leads (data carries ids only, never phones). Null = nothing to open. */
export function notificationHref(n: Pick<NotificationView, 'type' | 'data'>): string | null {
  const assignmentId = str(n.data.assignmentId);
  const requestId = str(n.data.requestId);
  const projectId = str(n.data.projectId);
  switch (n.type) {
    case 'CHAT_MESSAGE':
      return assignmentId ? `/assignment/${assignmentId}/chat` : null;
    case 'PRICE_PROPOSED':
      return assignmentId ? `/assignment/${assignmentId}/pay` : null;
    case 'WALLET_LOW':
    case 'WALLET_TOPUP':
      return '/wallet';
    case 'CASE_UPDATED':
      return '/cases';
    default:
      break;
  }
  if (assignmentId) return `/assignment/${assignmentId}`;
  if (projectId) return `/project/${projectId}`;
  if (requestId) return `/request/${requestId}`;
  if (n.type === 'PAYMENT_SUCCEEDED') return '/wallet';
  return null;
}

/** Badge text: "9+" above nine, nothing for zero. */
export function badgeText(count: number | null | undefined): string | null {
  if (!count || count <= 0) return null;
  return count > 9 ? '9+' : String(count);
}

/** Notification icon by type (Ionicons). */
export function notificationIcon(type: NotificationView['type']): string {
  if (type.startsWith('PROJECT') || type.startsWith('QUOTE') || type.startsWith('INVOICE')) return 'briefcase-outline';
  if (type.startsWith('WALLET') || type.startsWith('PAYMENT') || type === 'TIP_RECEIVED') return 'wallet-outline';
  if (type === 'CHAT_MESSAGE') return 'chatbubble-outline';
  if (type === 'CASE_UPDATED') return 'shield-checkmark-outline';
  return 'notifications-outline';
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseJsonObject(v: unknown): Record<string, unknown> | null {
  if (typeof v !== 'string' || !v.trim().startsWith('{')) return null;
  try {
    return asObject(JSON.parse(v));
  } catch {
    return null;
  }
}

/** FCM transport fields (API `toFcmData`), not notification data. */
const TRANSPORT_KEYS = new Set(['type', 'body', 'dataString', 'title', 'message', 'channelId', 'priority', 'sound']);

/**
 * The `{ type, data }` of a push as the device receives it. Expo pushes carry `data = { type, ...ids }`; FCM data
 * messages (API `toFcmData`) carry `type` plus `body` = the same object as JSON, which expo-notifications may leave as
 * a string. Null when the push is not a TezFiks notification.
 */
export function pushPayload(content: { data?: unknown } | null | undefined): Pick<NotificationView, 'type' | 'data'> | null {
  const raw = asObject(content?.data);
  if (!raw) return null;
  const merged: Record<string, unknown> = { ...raw, ...(parseJsonObject(raw.body) ?? {}), ...(parseJsonObject(raw.dataString) ?? {}) };
  const type = str(merged.type);
  if (!type) return null;
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(merged)) if (!TRANSPORT_KEYS.has(k)) data[k] = v;
  return { type: type as NotificationView['type'], data };
}

/** Minimal shape of an expo-notifications `NotificationResponse` (a tap on a push). */
export interface PushTap {
  actionIdentifier?: string;
  notification?: { request?: { identifier?: string; content?: { data?: unknown } | null } | null } | null;
}

/** Where a tap on a push leads: the same screen as a tap in the in-app list (null = just open the app). */
export function pushTapHref(tap: PushTap | null | undefined): string | null {
  const payload = pushPayload(tap?.notification?.request?.content);
  return payload ? notificationHref(payload) : null;
}
