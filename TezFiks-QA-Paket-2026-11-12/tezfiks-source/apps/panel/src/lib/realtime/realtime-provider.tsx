'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { DEFAULT_SOCKET_PATH, type ClientToServerEvents, type ServerToClientEvents } from '@tezfiks/shared';
import { fetchRealtimeTicket } from './ticket';

export type PanelSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface RealtimeContextValue {
  socket: PanelSocket | null;
  connected: boolean;
  /** Increments on every (re)connect: clients refetch state when it changes (spec §10). */
  connectionEpoch: number;
}

const RealtimeContext = createContext<RealtimeContextValue>({
  socket: null,
  connected: false,
  connectionEpoch: 0,
});

/** Backoff before reconnecting after the server refused the handshake (attempt 1, 2, ...). */
export function rejectedHandshakeDelay(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
}

/**
 * One Socket.IO connection per panel shell. Every handshake (including reconnects) fetches a new single-use ticket
 * from the BFF, so no token ever reaches the browser.
 *
 * When the server refuses the handshake (missing or rejected ticket, transient Redis/DB failure) Socket.IO does not
 * reconnect on its own (`socket.active === false` after `connect_error`), so the provider schedules `connect()` with
 * exponential backoff. Every attempt fetches a new ticket.
 */
export function RealtimeProvider({
  children,
  url,
  enabled = true,
}: {
  children: ReactNode;
  url?: string;
  enabled?: boolean;
}) {
  const [socket, setSocket] = useState<PanelSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectionEpoch, setEpoch] = useState(0);
  const origin = url ?? process.env.NEXT_PUBLIC_SOCKET_URL ?? '';

  useEffect(() => {
    if (!enabled) return;
    const opts = {
      path: DEFAULT_SOCKET_PATH,
      transports: ['websocket'],
      auth: (cb: (data: object) => void) => {
        fetchRealtimeTicket()
          .then((ticket) => cb({ ticket }))
          .catch(() => cb({}));
      },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    };
    const s: PanelSocket = origin ? io(origin, opts) : io(opts);
    let rejected = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const clearRetry = () => {
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
    };
    const onConnect = () => {
      rejected = 0;
      clearRetry();
      setConnected(true);
      setEpoch((n) => n + 1);
    };
    const onDisconnect = (reason?: string) => {
      setConnected(false);
      // 'io server disconnect' (e.g. session revoked server-side) also stops automatic reconnection.
      if (reason === 'io server disconnect') scheduleRetry();
    };
    const onConnectError = () => {
      setConnected(false);
      // While active, the Manager retries by itself (transport errors). Otherwise the server refused the handshake.
      if (!s.active) scheduleRetry();
    };
    function scheduleRetry() {
      if (retryTimer !== null) return;
      rejected += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        if (!s.connected) s.connect();
      }, rejectedHandshakeDelay(rejected));
    }
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', onConnectError);
    setSocket(s);
    return () => {
      clearRetry();
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('connect_error', onConnectError);
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [origin, enabled]);

  return (
    <RealtimeContext.Provider value={{ socket, connected, connectionEpoch }}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}

/** Subscribes to a typed server event for the lifetime of the component. The latest handler is always used. */
export function useSocketEvent<E extends keyof ServerToClientEvents>(
  event: E,
  handler: ServerToClientEvents[E],
): void {
  const { socket } = useRealtime();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!socket) return;
    const listener = ((...args: Parameters<ServerToClientEvents[E]>) =>
      (ref.current as (...a: Parameters<ServerToClientEvents[E]>) => void)(...args)) as never;
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [socket, event]);
}
