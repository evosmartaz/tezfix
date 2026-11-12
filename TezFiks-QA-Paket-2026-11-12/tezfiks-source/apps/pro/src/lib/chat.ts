import type { ChatMessage } from '@tezfiks/shared';

/** Newest-first list with a new message merged in once (the socket echo of our own send included). */
export function mergeMessages(list: readonly ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  if (list.some((m) => m.id === incoming.id)) return [...list];
  return [incoming, ...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
