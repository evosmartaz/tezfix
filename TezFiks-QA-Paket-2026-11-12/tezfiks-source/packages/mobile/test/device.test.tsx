import React, { useState } from 'react';
import { AppState, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { latLngToCell } from 'h3-js';
import * as Notifications from 'expo-notifications';
import * as Location from 'expo-location';
import { createMobileRuntime, RuntimeProvider } from '../src/runtime';
import { createMemoryStorage } from '../src/storage';
import { NOTIFICATION_CHANNELS, registerForPush } from '../src/push';
import { ensureCameraPermission, ensureLocationPermission, ensureNotificationPermission, toPermissionResult } from '../src/permissions';
import { buildDeepLink, googleNavigationUrl, inviteTokenFromUrl, parseDeepLink, wazeUrl } from '../src/linking';
import { cellCenter, hexagonCoordinates, regionForPoints, BAKU_REGION } from '../src/map/geo';
import { H3Hexagons, TfMapView } from '../src/map/TfMapView';
import { Keypad } from '../src/ui/Keypad';
import { Avatar } from '../src/ui/Avatar';
import { Money } from '../src/ui/Money';
import { Stars, starIcons } from '../src/ui/Stars';
import { Timeline } from '../src/ui/Timeline';
import { SocketProvider, useSocketEvent, useSocketConnected } from '../src/socket';
import { initI18n } from '../src/i18n';
import { makeMe } from './fixtures';

const BASE = 'http://10.0.2.2:3000/tezfix/api';

beforeAll(async () => {
  await initI18n({ appNamespace: 'pro', storage: createMemoryStorage(), language: 'az' });
});

describe('push registration', () => {
  it('registers the device with a null token when Firebase is not configured (non-fatal)', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchFn = jest.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const rt = createMobileRuntime({ app: 'PRO', apiUrl: BASE, storage: createMemoryStorage(), fetch: fetchFn, getLocale: () => 'az' });
    await rt.auth.getState().signIn({ accessToken: 'a', refreshToken: 'r', accessExpiresAt: 'x', refreshExpiresAt: 'y' }, makeMe());
    const res = await registerForPush({ api: rt.api, app: 'PRO', deviceId: 'device-123456', channelNames: { offers: 'Yeni sifarişlər', default: 'Bildirişlər' } });
    expect(res.registered).toBe(true);
    expect(res.pushToken).toBeNull();
    expect(res.error).toMatch(/Firebase/);
    expect(calls[0].url).toBe(`${BASE}/me/devices`);
    expect(calls[0].body).toEqual({
      deviceId: 'device-123456',
      app: 'PRO',
      platform: 'android',
      pushToken: null,
      pushProvider: null,
      appVersion: '0.1.0',
    });
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(NOTIFICATION_CHANNELS.offers, expect.objectContaining({ importance: 7, name: 'Yeni sifarişlər' }));
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(NOTIFICATION_CHANNELS.default, expect.objectContaining({ name: 'Bildirişlər' }));
  });

  it('sends the FCM token when available and never throws when the API fails', async () => {
    (Notifications.getDevicePushTokenAsync as jest.Mock).mockResolvedValueOnce({ type: 'android', data: 'fcm-token-1' });
    const bodies: unknown[] = [];
    const fetchFn = jest.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'x' } }), { status: 500 });
    }) as unknown as typeof fetch;
    const rt = createMobileRuntime({ app: 'CUSTOMER', apiUrl: BASE, storage: createMemoryStorage(), fetch: fetchFn, getLocale: () => 'az' });
    const res = await registerForPush({ api: rt.api, app: 'CUSTOMER', deviceId: 'device-abcdefgh', channelNames: { offers: 'a', default: 'b' } });
    expect(res.registered).toBe(false);
    expect(res.pushToken).toBe('fcm-token-1');
    expect(bodies[0]).toMatchObject({ pushToken: 'fcm-token-1', pushProvider: 'FCM', app: 'CUSTOMER' });
  });
});

describe('permissions', () => {
  it('maps permission responses', () => {
    expect(toPermissionResult({ granted: true })).toBe('granted');
    expect(toPermissionResult({ status: 'granted' })).toBe('granted');
    expect(toPermissionResult({ granted: false, canAskAgain: true })).toBe('denied');
    expect(toPermissionResult({ granted: false, canAskAgain: false })).toBe('blocked');
    expect(toPermissionResult(null)).toBe('denied');
  });

  it('asks for foreground location when not yet granted', async () => {
    await expect(ensureLocationPermission()).resolves.toBe('granted');
    expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
  });

  it('does not ask again when the camera is blocked', async () => {
    await expect(ensureCameraPermission()).resolves.toBe('blocked');
  });

  it('returns granted for notifications without prompting again', async () => {
    (Notifications.requestPermissionsAsync as jest.Mock).mockClear();
    await expect(ensureNotificationPermission()).resolves.toBe('granted');
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('deep links', () => {
  it('builds and parses app links', () => {
    expect(buildDeepLink('PRO', '/join/abc123')).toBe('tezfiksusta://join/abc123');
    expect(buildDeepLink('CUSTOMER', 'requests/r1', { tab: 'chat', empty: '' })).toBe('tezfiks://requests/r1?tab=chat');
    expect(parseDeepLink('tezfiks://requests/r1?tab=chat&x=a%20b')).toEqual({ scheme: 'tezfiks', segments: ['requests', 'r1'], query: { tab: 'chat', x: 'a b' } });
    expect(parseDeepLink('not a link')).toBeNull();
    expect(parseDeepLink('https://example.com/join/x')).toBeNull();
  });

  it('extracts company invite tokens', () => {
    expect(inviteTokenFromUrl('tezfiksusta://join/tok_42')).toBe('tok_42');
    expect(inviteTokenFromUrl('tezfiksusta:///join/tok_42')).toBe('tok_42');
    expect(inviteTokenFromUrl('https://evosmart.az/tezfix/join/tok_42')).toBe('tok_42');
    expect(inviteTokenFromUrl('tezfiks://join/tok_42')).toBeNull();
    expect(inviteTokenFromUrl('tezfiksusta://join')).toBeNull();
  });

  it('builds navigation links', () => {
    expect(googleNavigationUrl(40.4093, 49.8671)).toBe('google.navigation:q=40.4093,49.8671');
    expect(wazeUrl(40.4093, 49.8671)).toBe('https://waze.com/ul?ll=40.4093,49.8671&navigate=yes');
  });
});

describe('map helpers', () => {
  const cell = latLngToCell(40.4093, 49.8671, 7);

  it('turns an H3 cell into 6 polygon vertices around its centre', () => {
    const coords = hexagonCoordinates(cell);
    expect(coords).toHaveLength(6);
    const c = cellCenter(cell);
    for (const p of coords) {
      expect(Math.abs(p.latitude - c.latitude)).toBeLessThan(0.05);
      expect(Math.abs(p.longitude - c.longitude)).toBeLessThan(0.05);
    }
  });

  it('fits a region around points', () => {
    expect(regionForPoints([])).toEqual(BAKU_REGION);
    const r = regionForPoints([
      { latitude: 40.4, longitude: 49.8 },
      { latitude: 40.5, longitude: 49.9 },
    ]);
    expect(r.latitude).toBeCloseTo(40.45);
    expect(r.longitude).toBeCloseTo(49.85);
    expect(r.latitudeDelta).toBeCloseTo(0.14);
  });

  it('renders OpenStreetMap tiles when there is no Google key and hexagon polygons', async () => {
    await render(
      <TfMapView useGoogleTiles={false}>
        <H3Hexagons cells={[cell]} />
      </TfMapView>,
    );
    expect(screen.getByTestId('tf-map').props.mapType).toBe('none');
    expect(screen.getByTestId('UrlTile').props.urlTemplate).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(screen.getByTestId('Polygon').props.coordinates).toHaveLength(6);
  });

  it('uses Google tiles when the build has a key', async () => {
    await render(<TfMapView useGoogleTiles />);
    expect(screen.getByTestId('tf-map').props.mapType).toBe('standard');
    expect(screen.queryByTestId('UrlTile')).toBeNull();
  });
});

describe('UI kit pieces', () => {
  it('Keypad edits an amount', async () => {
    function Harness() {
      const [v, setV] = useState('');
      return (
        <>
          <Keypad value={v} onChange={setV} />
          <Text testID="value">{v}</Text>
        </>
      );
    }
    await render(<Harness />);
    for (const k of ['4', '5', '.', '5', 'back', '7']) await fireEvent.press(screen.getByTestId(`keypad-${k}`));
    expect(screen.getByTestId('value').props.children).toBe('45.7');
  });

  it('Avatar falls back to Azerbaijani initials', async () => {
    await render(<Avatar firstName="ilkin" lastName="əliyev" />);
    expect(screen.getByText('İƏ')).toBeTruthy();
  });

  it('Money formats with the current UI language', async () => {
    await render(<Money minor={4500} testID="m" />);
    expect(screen.getByTestId('m').props.children).toBe('45,00 ₼');
  });

  it('Stars show halves and accept taps', async () => {
    expect(starIcons(4.5)).toEqual(['star', 'star', 'star', 'star', 'star-half']);
    expect(starIcons(0)).toEqual(['star-outline', 'star-outline', 'star-outline', 'star-outline', 'star-outline']);
    const onChange = jest.fn();
    await render(<Stars value={0} onChange={onChange} />);
    await fireEvent.press(screen.getByTestId('stars-4'));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('Timeline shows times and dashes', async () => {
    await render(
      <Timeline
        steps={[
          { key: 'accepted', label: 'Sifariş qəbul edildi', time: '14:02', state: 'done' },
          { key: 'enroute', label: 'Yola çıxdım', time: '14:05', state: 'current' },
          { key: 'arrived', label: 'Ünvana çatdım', state: 'pending' },
        ]}
      />,
    );
    expect(screen.getByText('14:02')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });
});

describe('SocketProvider', () => {
  function fakeIo() {
    const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
    const socket = {
      connected: false,
      on: jest.fn((e: string, h: (...a: unknown[]) => void) => {
        if (!handlers.has(e)) handlers.set(e, new Set());
        handlers.get(e)!.add(h);
      }),
      off: jest.fn((e: string, h: (...a: unknown[]) => void) => handlers.get(e)?.delete(h)),
      connect: jest.fn(() => {
        socket.connected = true;
      }),
      disconnect: jest.fn(() => {
        socket.connected = false;
      }),
      emitLocal: (e: string, ...a: unknown[]) => handlers.get(e)?.forEach((h) => h(...a)),
    };
    const io = jest.fn(() => socket);
    return { io, socket };
  }

  it('connects after sign-in, delivers typed events, refetches on connect, and disconnects on sign-out', async () => {
    const { io, socket } = fakeIo();
    const rt = createMobileRuntime({ app: 'PRO', apiUrl: BASE, storage: createMemoryStorage(), fetch: jest.fn() as never, getLocale: () => 'az' });
    const invalidate = jest.spyOn(rt.queryClient, 'invalidateQueries');
    const seen: unknown[] = [];
    function Listener() {
      useSocketEvent('offer:closed', (p) => seen.push(p.offerId));
      const connected = useSocketConnected();
      return <Text testID="connected">{connected ? 'yes' : 'no'}</Text>;
    }
    await render(
      <RuntimeProvider runtime={rt}>
        <SocketProvider ioFactory={io as never}>
          <Listener />
        </SocketProvider>
      </RuntimeProvider>,
    );
    expect(io).not.toHaveBeenCalled();

    await act(async () => {
      await rt.auth.getState().signIn({ accessToken: 'acc', refreshToken: 'ref', accessExpiresAt: 'x', refreshExpiresAt: 'y' }, makeMe());
    });
    expect(io).toHaveBeenCalledTimes(1);
    expect((io.mock.calls[0] as unknown[])[0]).toBe('http://10.0.2.2:3000');
    expect(socket.connect).toHaveBeenCalled();

    await act(async () => {
      socket.emitLocal('connect');
    });
    expect(screen.getByTestId('connected').props.children).toBe('yes');
    expect(invalidate).toHaveBeenCalled();

    await act(async () => {
      socket.emitLocal('offer:closed', { offerId: 'of1', requestId: 'r1', reason: 'TAKEN' });
    });
    expect(seen).toEqual(['of1']);

    await act(async () => {
      await rt.auth.getState().logout({ remote: false });
    });
    expect(socket.disconnect).toHaveBeenCalled();
    expect(screen.getByTestId('connected').props.children).toBe('no');
  });

  function refreshingRuntime(gate?: Promise<void>) {
    const refreshCalls: unknown[] = [];
    const fetchFn = jest.fn(async (url: string, init: RequestInit) => {
      if (String(url).endsWith('/auth/refresh')) {
        refreshCalls.push(JSON.parse(String(init.body)));
        if (gate) await gate;
        return new Response(
          JSON.stringify({ accessToken: 'acc-2', refreshToken: 'ref-2', accessExpiresAt: 'x2', refreshExpiresAt: 'y2' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'x' } }), { status: 404 });
    }) as unknown as typeof fetch;
    const rt = createMobileRuntime({ app: 'PRO', apiUrl: BASE, storage: createMemoryStorage(), fetch: fetchFn, getLocale: () => 'az' });
    return { rt, refreshCalls };
  }

  function handshakeToken(io: jest.Mock): unknown {
    const opts = (io.mock.calls[0] as unknown[])[1] as { auth: (cb: (d: { token: unknown }) => void) => void };
    let token: unknown;
    opts.auth((d) => (token = d.token));
    return token;
  }

  it('on an auth connect_error refreshes the access token and reconnects with the new token', async () => {
    const { io, socket } = fakeIo();
    const { rt, refreshCalls } = refreshingRuntime();
    await render(
      <RuntimeProvider runtime={rt}>
        <SocketProvider ioFactory={io as never}>
          <Text>child</Text>
        </SocketProvider>
      </RuntimeProvider>,
    );
    await act(async () => {
      await rt.auth.getState().signIn({ accessToken: 'acc-1', refreshToken: 'ref-1', accessExpiresAt: 'x', refreshExpiresAt: 'y' }, makeMe());
    });
    expect(handshakeToken(io)).toBe('acc-1');
    expect(socket.connect).toHaveBeenCalledTimes(1);

    // The server rejects the expired token during the handshake.
    socket.connected = false;
    await act(async () => {
      socket.emitLocal('connect_error', new Error('UNAUTHORIZED'));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(refreshCalls).toHaveLength(1);
    expect(refreshCalls[0]).toMatchObject({ refreshToken: 'ref-1' });
    expect(rt.auth.getState().accessToken).toBe('acc-2');
    expect(socket.connect).toHaveBeenCalledTimes(2);
    expect(handshakeToken(io)).toBe('acc-2');
    expect(io).toHaveBeenCalledTimes(1); // same socket instance, no duplicate connections

    // Transport errors are left to Socket.IO's own reconnection (no refresh).
    socket.connected = false;
    await act(async () => {
      socket.emitLocal('connect_error', new Error('websocket error'));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(refreshCalls).toHaveLength(1);
    expect(socket.connect).toHaveBeenCalledTimes(2);
  });

  it('does not reopen the socket when a refresh resolves after unmount', async () => {
    const { io, socket } = fakeIo();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { rt, refreshCalls } = refreshingRuntime(gate);
    const view = await render(
      <RuntimeProvider runtime={rt}>
        <SocketProvider ioFactory={io as never}>
          <Text>child</Text>
        </SocketProvider>
      </RuntimeProvider>,
    );
    await act(async () => {
      await rt.auth.getState().signIn({ accessToken: 'acc-1', refreshToken: 'ref-1', accessExpiresAt: 'x', refreshExpiresAt: 'y' }, makeMe());
    });
    socket.connected = false;
    await act(async () => {
      socket.emitLocal('connect_error', new Error('jwt expired'));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(refreshCalls).toHaveLength(1);
    await act(async () => {
      view.unmount();
    });
    expect(socket.disconnect).toHaveBeenCalled();
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(socket.connect).toHaveBeenCalledTimes(1);
    expect(socket.connected).toBe(false);
  });

  it('reconnects when the app returns to the foreground, and not after sign-out', async () => {
    const listeners: Array<(s: string) => void> = [];
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, l: (s: string) => void) => {
      listeners.push(l);
      return { remove: jest.fn(() => listeners.splice(listeners.indexOf(l), 1)) };
    }) as never);
    try {
      const { io, socket } = fakeIo();
      const rt = createMobileRuntime({ app: 'PRO', apiUrl: BASE, storage: createMemoryStorage(), fetch: jest.fn() as never, getLocale: () => 'az' });
      await render(
        <RuntimeProvider runtime={rt}>
          <SocketProvider ioFactory={io as never}>
            <Text>child</Text>
          </SocketProvider>
        </RuntimeProvider>,
      );
      await act(async () => {
        await rt.auth.getState().signIn({ accessToken: 'acc', refreshToken: 'ref', accessExpiresAt: 'x', refreshExpiresAt: 'y' }, makeMe());
      });
      expect(socket.connect).toHaveBeenCalledTimes(1);
      expect(listeners).toHaveLength(1);

      // Android killed the connection in the background.
      socket.connected = false;
      await act(async () => {
        listeners.forEach((l) => l('background'));
      });
      expect(socket.connect).toHaveBeenCalledTimes(1);
      await act(async () => {
        listeners.forEach((l) => l('active'));
      });
      expect(socket.connect).toHaveBeenCalledTimes(2);

      // Already connected: foregrounding again does nothing.
      await act(async () => {
        listeners.forEach((l) => l('active'));
      });
      expect(socket.connect).toHaveBeenCalledTimes(2);

      await act(async () => {
        await rt.auth.getState().logout({ remote: false });
      });
      expect(listeners).toHaveLength(0);
      expect(socket.connected).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
