import React, { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { useStore } from 'zustand';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@tezfiks/shared';
import { socketEndpoint } from './config';
import { useRuntime } from './runtime';

export type TezSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type SocketEventName = keyof ServerToClientEvents;
export type SocketEventPayload<E extends SocketEventName> = Parameters<ServerToClientEvents[E]>[0];

export interface CreateSocketOptions {
  apiUrl: string;
  /** Read at every (re)connect attempt so a refreshed access token is used. */
  getToken: () => string | null;
  ioFactory?: typeof io;
}

/** Socket.IO options per spec §10: same origin as the API, path `<api path>/socket.io`, websocket only, `auth.token`. */
export function socketOptions(opts: CreateSocketOptions) {
  const { url, path } = socketEndpoint(opts.apiUrl);
  return {
    url,
    options: {
      path,
      transports: ['websocket'] as string[],
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
      auth: (cb: (data: object) => void) => cb({ token: opts.getToken() }),
    },
  };
}

export function createSocket(opts: CreateSocketOptions): TezSocket {
  const { url, options } = socketOptions(opts);
  return (opts.ioFactory ?? io)(url, options) as TezSocket;
}

/** connect_error messages that mean "token rejected" (refresh, then reconnect). */
export function isAuthConnectError(err: { message?: string } | undefined): boolean {
  return /unauth|token|jwt|expired|forbidden|401/i.test(err?.message ?? '');
}

interface SocketContextValue {
  socket: TezSocket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, connected: false });

export interface SocketProviderProps {
  children: ReactNode;
  /** Injected for tests. */
  ioFactory?: typeof io;
}

/**
 * Keeps one socket per signed-in session: connects after sign-in, disconnects on sign-out, reconnects when the app
 * returns to the foreground, refreshes the token on auth errors, and invalidates queries on every (re)connect
 * (the server is authoritative; clients refetch state).
 */
export function SocketProvider({ children, ioFactory }: SocketProviderProps) {
  const runtime = useRuntime();
  const signedIn = useStore(runtime.auth, (s) => s.status === 'signedIn' && !!s.accessToken);
  const [value, setValue] = useState<SocketContextValue>({ socket: null, connected: false });
  const socketRef = useRef<TezSocket | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    const socket = createSocket({
      apiUrl: runtime.apiUrl,
      getToken: () => runtime.auth.getState().accessToken,
      ioFactory,
    });
    socketRef.current = socket;
    setValue({ socket, connected: false });

    const onConnect = () => {
      setValue({ socket, connected: true });
      void runtime.queryClient.invalidateQueries();
    };
    const onDisconnect = () => setValue({ socket, connected: false });
    // False once this session's socket is torn down (sign-out, unmount): a refresh that resolves later must not
    // reopen a socket that was deliberately closed.
    let alive = true;
    let refreshing = false;
    const onConnectError = async (err: Error) => {
      if (!isAuthConnectError(err) || refreshing) return;
      refreshing = true;
      const ok = await runtime.auth.getState().refreshAccessToken().catch(() => false);
      refreshing = false;
      if (alive && ok && !socket.connected) socket.connect();
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.connect();

    const appStateSub = AppState.addEventListener('change', (status) => {
      if (alive && status === 'active' && !socket.connected) socket.connect();
    });

    return () => {
      alive = false;
      appStateSub.remove();
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.disconnect();
      socketRef.current = null;
      setValue({ socket: null, connected: false });
    };
  }, [signedIn, runtime, ioFactory]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

/** The session socket (null while signed out or before the first connect attempt). */
export function useSocket(): TezSocket | null {
  return useContext(SocketContext).socket;
}

export function useSocketConnected(): boolean {
  return useContext(SocketContext).connected;
}

/** Subscribes to a typed server event; the latest handler is always called (no resubscribe on re-render). */
export function useSocketEvent<E extends SocketEventName>(event: E, handler: (payload: SocketEventPayload<E>) => void): void {
  const socket = useSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!socket) return;
    const listener = (payload: SocketEventPayload<E>) => handlerRef.current(payload);
    (socket as unknown as { on(e: string, l: (p: unknown) => void): void }).on(event, listener as (p: unknown) => void);
    return () => {
      (socket as unknown as { off(e: string, l: (p: unknown) => void): void }).off(event, listener as (p: unknown) => void);
    };
  }, [socket, event]);
}
