// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import {
  RealtimeProvider,
  rejectedHandshakeDelay,
  useRealtime,
  useSocketEvent,
} from '@/lib/realtime/realtime-provider';

type Listener = (...args: unknown[]) => void;

const sockets: FakeSocket[] = [];
class FakeSocket {
  listeners = new Map<string, Set<Listener>>();
  disconnected = false;
  /** socket.io-client: false after the server refused the handshake (no automatic reconnection). */
  active = true;
  connected = false;
  connectCalls = 0;
  constructor(
    public url: string | undefined,
    public opts: Record<string, unknown>,
  ) {}
  on(event: string, fn: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return this;
  }
  off(event: string, fn: Listener) {
    this.listeners.get(event)?.delete(fn);
    return this;
  }
  emitLocal(event: string, ...args: unknown[]) {
    for (const fn of this.listeners.get(event) ?? []) fn(...args);
  }
  disconnect() {
    this.disconnected = true;
    this.active = false;
  }
  connect() {
    this.connectCalls += 1;
    this.active = true;
    return this;
  }
}

vi.mock('socket.io-client', () => ({
  io: (a: unknown, b?: unknown) => {
    const s =
      typeof a === 'string'
        ? new FakeSocket(a, b as Record<string, unknown>)
        : new FakeSocket(undefined, a as Record<string, unknown>);
    sockets.push(s);
    return s;
  },
}));

function Probe({ onWallet }: { onWallet: (p: unknown) => void }) {
  const { connected, connectionEpoch } = useRealtime();
  useSocketEvent('wallet:updated', onWallet);
  return <span data-testid="state">{`${connected}:${connectionEpoch}`}</span>;
}

describe('RealtimeProvider', () => {
  it('connects over websocket on /tezfix/api/socket.io and authenticates with a fresh BFF ticket', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ticket: 'tkt-1', expiresAt: 'x' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onWallet = vi.fn();
    const view = render(
      <RealtimeProvider url="https://evosmart.az">
        <Probe onWallet={onWallet} />
      </RealtimeProvider>,
    );
    const socket = sockets.at(-1)!;
    expect(socket.url).toBe('https://evosmart.az');
    expect(socket.opts.path).toBe('/tezfix/api/socket.io');
    expect(socket.opts.transports).toEqual(['websocket']);

    const auth = socket.opts.auth as (cb: (d: object) => void) => void;
    const handshake = await new Promise<object>((resolve) => auth(resolve));
    expect(handshake).toEqual({ ticket: 'tkt-1' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/tezfix/bff/realtime-ticket',
      expect.objectContaining({ method: 'POST' }),
    );
    // A reconnect asks for a new single-use ticket.
    await new Promise<object>((resolve) => auth(resolve));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect(view.getByTestId('state').textContent).toBe('false:0');
    act(() => socket.emitLocal('connect'));
    expect(view.getByTestId('state').textContent).toBe('true:1');
    act(() => socket.emitLocal('disconnect'));
    act(() => socket.emitLocal('connect'));
    expect(view.getByTestId('state').textContent).toBe('true:2');

    const payload = { owner: 'company', companyId: null, available: 100, posted: 100 };
    act(() => socket.emitLocal('wallet:updated', payload));
    expect(onWallet).toHaveBeenCalledWith(payload);

    view.unmount();
    expect(socket.disconnected).toBe(true);
    expect(socket.listeners.get('wallet:updated')?.size ?? 0).toBe(0);
  });

  it('hands an empty auth object to the server when the ticket cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    render(
      <RealtimeProvider>
        <span />
      </RealtimeProvider>,
    );
    const socket = sockets.at(-1)!;
    expect(socket.url).toBeUndefined(); // same origin
    const auth = socket.opts.auth as (cb: (d: object) => void) => void;
    expect(await new Promise<object>((resolve) => auth(resolve))).toEqual({});
  });

  it('does not connect when disabled', () => {
    const before = sockets.length;
    render(
      <RealtimeProvider enabled={false}>
        <span />
      </RealtimeProvider>,
    );
    expect(sockets.length).toBe(before);
  });

  describe('recovery after a refused handshake', () => {
    it('reconnects with backoff when the server rejects the ticket, and bumps the epoch once connected', async () => {
      vi.useFakeTimers();
      try {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
        const onWallet = vi.fn();
        const view = render(
          <RealtimeProvider url="https://evosmart.az">
            <Probe onWallet={onWallet} />
          </RealtimeProvider>,
        );
        const socket = sockets.at(-1)!;

        // Server middleware rejects: socket.io-client emits connect_error and stops (active === false).
        socket.active = false;
        act(() => socket.emitLocal('connect_error', new Error('UNAUTHORIZED')));
        expect(socket.connectCalls).toBe(0);
        act(() => vi.advanceTimersByTime(999));
        expect(socket.connectCalls).toBe(0);
        act(() => vi.advanceTimersByTime(1));
        expect(socket.connectCalls).toBe(1);

        // Rejected again: the next attempt waits longer.
        socket.active = false;
        act(() => socket.emitLocal('connect_error', new Error('UNAUTHORIZED')));
        act(() => vi.advanceTimersByTime(1999));
        expect(socket.connectCalls).toBe(1);
        act(() => vi.advanceTimersByTime(1));
        expect(socket.connectCalls).toBe(2);

        // Handshake accepted: pages are told to refetch.
        socket.connected = true;
        act(() => socket.emitLocal('connect'));
        expect(view.getByTestId('state').textContent).toBe('true:1');

        // After a successful connection the backoff starts again from 1 s.
        socket.connected = false;
        socket.active = false;
        act(() => socket.emitLocal('connect_error', new Error('UNAUTHORIZED')));
        act(() => vi.advanceTimersByTime(1000));
        expect(socket.connectCalls).toBe(3);
        view.unmount();
      } finally {
        vi.useRealTimers();
      }
    });

    it('leaves transport errors to the built-in reconnection while the socket is still active', () => {
      vi.useFakeTimers();
      try {
        render(
          <RealtimeProvider url="https://evosmart.az">
            <span />
          </RealtimeProvider>,
        );
        const socket = sockets.at(-1)!;
        socket.active = true;
        act(() => socket.emitLocal('connect_error', new Error('websocket error')));
        act(() => vi.advanceTimersByTime(60_000));
        expect(socket.connectCalls).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('reconnects after the server disconnects the socket itself', () => {
      vi.useFakeTimers();
      try {
        render(
          <RealtimeProvider url="https://evosmart.az">
            <span />
          </RealtimeProvider>,
        );
        const socket = sockets.at(-1)!;
        socket.active = false;
        act(() => socket.emitLocal('disconnect', 'io server disconnect'));
        act(() => vi.advanceTimersByTime(1000));
        expect(socket.connectCalls).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('cancels a pending reconnect on unmount', () => {
      vi.useFakeTimers();
      try {
        const view = render(
          <RealtimeProvider url="https://evosmart.az">
            <span />
          </RealtimeProvider>,
        );
        const socket = sockets.at(-1)!;
        socket.active = false;
        act(() => socket.emitLocal('connect_error', new Error('UNAUTHORIZED')));
        view.unmount();
        vi.advanceTimersByTime(60_000);
        expect(socket.connectCalls).toBe(0);
        expect(socket.disconnected).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('caps the backoff at 30 seconds', () => {
      expect(rejectedHandshakeDelay(1)).toBe(1000);
      expect(rejectedHandshakeDelay(2)).toBe(2000);
      expect(rejectedHandshakeDelay(5)).toBe(16_000);
      expect(rejectedHandshakeDelay(6)).toBe(30_000);
      expect(rejectedHandshakeDelay(50)).toBe(30_000);
    });
  });
});
