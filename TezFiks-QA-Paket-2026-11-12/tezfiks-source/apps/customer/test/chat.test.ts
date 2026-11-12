import { CHAT_MAX_LENGTH, addPending, canSend, confirmPending, isMine, markFailed, mergeMessages, unreadFromOthers, type ChatItem } from '../src/lib/chat';
import { IDS } from './fixtures';
import { M3, message } from './fixtures-m3';

const mine = (over: Partial<ChatItem> = {}) =>
  message({ id: M3.message2, senderSide: 'CUSTOMER', senderUserId: 'u1', senderName: 'Nizami T.', body: 'Gözləyirəm', createdAt: '2026-10-25T10:21:00.000Z', ...over });

describe('chat list merge', () => {
  it('merges pages and socket events newest first without duplicates', () => {
    const older = message({ id: 'm1', createdAt: '2026-10-25T10:00:00.000Z' });
    const newer = message({ id: 'm2', createdAt: '2026-10-25T10:05:00.000Z' });
    const list = mergeMessages([], [older]);
    const merged = mergeMessages(list, [newer, older]);
    expect(merged.map((m) => m.id)).toEqual(['m2', 'm1']);
  });

  it('a later copy of a known message updates it (read receipts)', () => {
    const m = message({ readAt: null });
    const merged = mergeMessages([m], [{ ...m, readAt: '2026-10-25T10:30:00.000Z' }]);
    expect(merged).toHaveLength(1);
    expect(merged[0].readAt).toBe('2026-10-25T10:30:00.000Z');
  });

  it('same timestamp: stable order by id', () => {
    const a = message({ id: 'a', createdAt: '2026-10-25T10:00:00.000Z' });
    const b = message({ id: 'b', createdAt: '2026-10-25T10:00:00.000Z' });
    expect(mergeMessages([], [a, b]).map((m) => m.id)).toEqual(['b', 'a']);
    expect(mergeMessages([], [b, a]).map((m) => m.id)).toEqual(['b', 'a']);
  });

  it('an optimistic message is replaced by the stored one, also when the socket delivered it first', () => {
    const base = [message()];
    const pending = addPending(base, { tempId: 't1', assignmentId: IDS.assignment, body: 'Gözləyirəm', senderUserId: 'u1', senderName: 'Nizami T.', now: '2026-10-25T10:21:00.000Z' });
    expect(pending[0]).toMatchObject({ tempId: 't1', pending: true, body: 'Gözləyirəm' });
    const saved = mine();
    // socket first
    const viaSocket = mergeMessages(pending, [saved]);
    expect(viaSocket).toHaveLength(3);
    const confirmed = confirmPending(viaSocket, 't1', saved);
    expect(confirmed.map((m) => m.id)).toEqual([M3.message2, M3.message]);
    expect(confirmed.some((m) => m.tempId)).toBe(false);
    // HTTP first, socket afterwards
    const confirmedFirst = mergeMessages(confirmPending(pending, 't1', saved), [saved]);
    expect(confirmedFirst.map((m) => m.id)).toEqual([M3.message2, M3.message]);
  });

  it('unsent messages stay at the bottom of the conversation and can be marked failed', () => {
    const pending = addPending([message({ createdAt: '2099-01-01T00:00:00.000Z' })], { tempId: 't1', assignmentId: IDS.assignment, body: 'x', senderUserId: 'u1', senderName: 'N', now: '2026-01-01T00:00:00.000Z' });
    expect(pending[0].tempId).toBe('t1');
    const failed = markFailed(pending, 't1');
    expect(failed[0]).toMatchObject({ failed: true, pending: false });
  });

  it('counts unread messages from the other side only', () => {
    const list = mergeMessages([], [message({ id: 'a' }), message({ id: 'b', readAt: '2026-10-25T10:30:00.000Z' }), mine()]);
    expect(unreadFromOthers(list, 'u1')).toBe(1);
    expect(isMine(list.find((m) => m.id === M3.message2) as ChatItem, 'u1')).toBe(true);
    expect(isMine(list.find((m) => m.id === 'a') as ChatItem, 'u1')).toBe(false);
  });

  it('send rules: trimmed, 1..1000 characters', () => {
    expect(canSend('  ')).toBe(false);
    expect(canSend(' Salam ')).toBe(true);
    expect(canSend('ə'.repeat(CHAT_MAX_LENGTH))).toBe(true);
    expect(canSend('ə'.repeat(CHAT_MAX_LENGTH + 1))).toBe(false);
  });
});
