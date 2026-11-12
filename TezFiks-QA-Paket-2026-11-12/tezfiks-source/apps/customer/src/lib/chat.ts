import type { ChatMessage } from '@tezfiks/shared';

/** A chat row: a server message, or a message being sent (tempId) that may have failed. */
export interface ChatItem extends ChatMessage {
  tempId?: string;
  pending?: boolean;
  failed?: boolean;
}

let tempSeq = 0;
export function newTempId(): string {
  tempSeq += 1;
  return `temp-${Date.now().toString(36)}-${tempSeq}`;
}

function newestFirst(a: ChatItem, b: ChatItem): number {
  // Unsent messages stay at the bottom of the conversation (the top of the inverted list).
  if (!!a.tempId !== !!b.tempId) return a.tempId ? -1 : 1;
  const d = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  if (d !== 0) return d;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Merges pages from GET /assignments/:id/messages and `chat:message` events into one newest-first list without
 * duplicates. A message already known keeps its place but takes the newer copy (readAt may have changed).
 */
export function mergeMessages(list: readonly ChatItem[], incoming: readonly ChatMessage[]): ChatItem[] {
  const byId = new Map<string, ChatItem>();
  for (const m of list) byId.set(m.tempId ?? m.id, m);
  for (const m of incoming) {
    const prev = byId.get(m.id);
    byId.set(m.id, prev ? { ...prev, ...m } : { ...m });
  }
  return [...byId.values()].sort(newestFirst);
}

/** Adds an optimistic message shown as "sending". */
export function addPending(
  list: readonly ChatItem[],
  msg: { tempId: string; assignmentId: string; body: string; senderUserId: string; senderName: string; now: string },
): ChatItem[] {
  const item: ChatItem = {
    id: msg.tempId,
    tempId: msg.tempId,
    pending: true,
    assignmentId: msg.assignmentId,
    senderSide: 'CUSTOMER',
    senderUserId: msg.senderUserId,
    senderName: msg.senderName,
    body: msg.body,
    createdAt: msg.now,
    readAt: null,
  };
  return [item, ...list.filter((m) => m.tempId !== msg.tempId)].sort(newestFirst);
}

/** The server stored the message: the optimistic row is replaced (the socket may have delivered it already). */
export function confirmPending(list: readonly ChatItem[], tempId: string, saved: ChatMessage): ChatItem[] {
  return mergeMessages(
    list.filter((m) => m.tempId !== tempId),
    [saved],
  );
}

export function markFailed(list: readonly ChatItem[], tempId: string): ChatItem[] {
  return list.map((m) => (m.tempId === tempId ? { ...m, pending: false, failed: true } : m));
}

/** Messages from the other side that the customer has not read yet. */
export function unreadFromOthers(list: readonly ChatItem[], myUserId: string | null | undefined): number {
  return list.filter((m) => !m.tempId && m.senderUserId !== myUserId && !m.readAt).length;
}

/** Ids of the unread messages from the other side (what one POST .../messages/read covers right now). */
export function unreadIdsFromOthers(list: readonly ChatItem[], myUserId: string | null | undefined): string[] {
  return list.filter((m) => !m.tempId && m.senderUserId !== myUserId && !m.readAt).map((m) => m.id);
}

/** Marks exactly these messages read (messages that arrived while the request was in flight stay unread). */
export function markReadLocally(list: readonly ChatItem[], ids: readonly string[], at: string): ChatItem[] {
  if (!ids.length) return [...list];
  const set = new Set(ids);
  return list.map((m) => (set.has(m.id) && !m.readAt ? { ...m, readAt: at } : m));
}

export function isMine(m: Pick<ChatItem, 'senderUserId' | 'tempId'>, myUserId: string | null | undefined): boolean {
  return !!m.tempId || (!!myUserId && m.senderUserId === myUserId);
}

/** Message text limits of POST /assignments/:id/messages. */
export const CHAT_MAX_LENGTH = 1000;

export function canSend(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= CHAT_MAX_LENGTH;
}
