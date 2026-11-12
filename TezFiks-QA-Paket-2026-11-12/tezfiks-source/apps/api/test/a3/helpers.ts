import { io, type Socket } from 'socket.io-client';
import { latLngToCell } from 'h3-js';
import type { ClientToServerEvents, ServerToClientEvents, SocketAck } from '@tezfiks/shared';
import type { TestApp } from '../helpers/app';
import { BAKU, categoryId, type CreatedCustomer } from '../helpers/factories';

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export const SOCKET_PATH = '/tezfix/api/socket.io';

const open: ClientSocket[] = [];

/** Connects a Socket.IO client; resolves on connect, rejects with the server's connect_error message. */
export function connectSocket(t: TestApp, auth: { token?: string; ticket?: string } | undefined): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket: ClientSocket = io(t.origin, {
      path: SOCKET_PATH,
      transports: ['websocket'],
      auth: auth ?? {},
      forceNew: true,
      reconnection: false,
      timeout: 5000,
    });
    open.push(socket);
    const timer = setTimeout(() => reject(new Error('connect timeout')), 8000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });
  });
}

export function closeAllSockets(): void {
  for (const s of open.splice(0)) s.close();
}

/** Emits a client event and resolves with the server's ack. */
export function emitAck<E extends keyof ClientToServerEvents>(socket: ClientSocket, event: E, payload: unknown): Promise<SocketAck> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ack for ${event}`)), 5000);
    (socket.emit as (ev: string, p: unknown, cb: (r: SocketAck) => void) => void)(event, payload, (r: SocketAck) => {
      clearTimeout(timer);
      resolve(r);
    });
  });
}

/** Resolves with the next payload of `event` (rejects after `ms`). */
export function nextEvent<E extends keyof ServerToClientEvents>(
  socket: ClientSocket,
  event: E,
  ms = 3000,
): Promise<Parameters<ServerToClientEvents[E]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event as never, handler as never);
      reject(new Error(`no ${String(event)} within ${ms}ms`));
    }, ms);
    const handler = (p: unknown) => {
      clearTimeout(timer);
      resolve(p as never);
    };
    socket.once(event as never, handler as never);
  });
}

/** Resolves true if `event` arrives within `ms`, false otherwise. */
export function receives<E extends keyof ServerToClientEvents>(socket: ClientSocket, event: E, ms = 400): Promise<boolean> {
  return nextEvent(socket, event, ms).then(
    () => true,
    () => false,
  );
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Minimal searching request (one OPEN slot) for the given customer. */
export async function createRequest(t: TestApp, customer: CreatedCustomer, at = BAKU.center): Promise<{ requestId: string; slotId: string }> {
  const catId = await categoryId(t, 'plumbing');
  const req = await t.prisma.serviceRequest.create({
    data: {
      customerAccountId: customer.accountId,
      createdByUserId: customer.userId,
      categoryId: catId,
      vertical: 'HOME',
      description: 'Mətbəxdə kran axır',
      timing: 'NOW',
      lat: at.lat,
      lng: at.lng,
      cell7: latLngToCell(at.lat, at.lng, 7),
      cell9: latLngToCell(at.lat, at.lng, 9),
      formatted: 'Nizami küç. 10, Bakı',
      slots: { create: [{ index: 0 }] },
    },
    include: { slots: true },
  });
  return { requestId: req.id, slotId: req.slots[0]!.id };
}

/** Assignment row for a request slot (status ACCEPTED by default). */
export async function createAssignment(
  t: TestApp,
  data: { requestId: string; slotId: string; handymanId: string; userId: string; companyId?: string | null; status?: 'ACCEPTED' | 'EN_ROUTE' | 'ARRIVED' | 'COMPLETED' },
): Promise<string> {
  const now = t.clock.now();
  const a = await t.prisma.assignment.create({
    data: {
      requestId: data.requestId,
      slotId: data.slotId,
      providerType: data.companyId ? 'COMPANY' : 'SOLO',
      handymanId: data.handymanId,
      companyId: data.companyId ?? null,
      acceptedByUserId: data.userId,
      status: data.status ?? 'ACCEPTED',
      acceptedAt: now,
      freeCancelUntil: new Date(now.getTime() + 300_000),
    },
  });
  return a.id;
}
