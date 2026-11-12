import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CustomerAssignment } from '@tezfiks/shared';
import { newIdempotencyKey, useSocket, useSocketConnected, useSocketEvent } from '@tezfiks/mobile';
import { qk } from '../data/queries';
import { createKeyRegistry, type KeyRegistry } from '../lib/idempotency';
import { applyLocation } from '../lib/tracking';

/**
 * Screens of one assignment share its room (tracking stays mounted under the chat): the socket joins on the first
 * user and leaves only when the last one unmounts, so closing the chat does not drop the tracking screen's events.
 */
const roomUsers = new WeakMap<object, Map<string, number>>();

/** Counts one more user of the room; true when the socket must join it now. */
export function retainRoom(socket: object, id: string): boolean {
  let rooms = roomUsers.get(socket);
  if (!rooms) {
    rooms = new Map();
    roomUsers.set(socket, rooms);
  }
  const n = rooms.get(id) ?? 0;
  rooms.set(id, n + 1);
  return n === 0;
}

/** Counts one user less; true when the last one left and the socket must leave the room. */
export function releaseRoom(socket: object, id: string): boolean {
  const rooms = roomUsers.get(socket);
  const n = rooms?.get(id) ?? 0;
  if (!rooms || n <= 1) {
    rooms?.delete(id);
    return n > 0;
  }
  rooms.set(id, n - 1);
  return false;
}

/**
 * Joins the assignment room (live location, contact unlock, chat) and keeps the cached assignment current:
 * location pings are applied as deltas, status/contact events refetch it (REST is the truth).
 */
export function useAssignmentLive(id: string | undefined, onUpdate?: () => void): void {
  const queryClient = useQueryClient();
  const socket = useSocket();
  const connected = useSocketConnected();

  useEffect(() => {
    if (!socket || !connected || !id) return;
    if (retainRoom(socket, id)) socket.emit('room:join', { room: 'assignment', id });
    return () => {
      // A dropped connection already left every room on the server; nothing to send.
      if (releaseRoom(socket, id) && socket.connected) socket.emit('room:leave', { room: 'assignment', id });
    };
  }, [socket, connected, id]);

  useSocketEvent('assignment:location', (p) => {
    if (!id || p.assignmentId !== id) return;
    queryClient.setQueryData<CustomerAssignment>(qk.assignment(id), (old) => (old ? applyLocation(old, p) : old));
  });
  useSocketEvent('assignment:contact', (p) => {
    if (id && p.assignmentId === id) onUpdate?.();
  });
  useSocketEvent('assignment:updated', (p) => {
    if (id && p.assignmentId === id) onUpdate?.();
  });
}

/** Idempotency keys for this screen's actions (kept across re-renders). */
export function useKeyRegistry(): KeyRegistry {
  const ref = useRef<KeyRegistry | null>(null);
  ref.current ??= createKeyRegistry(newIdempotencyKey);
  return ref.current;
}
