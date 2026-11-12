import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import { router } from 'expo-router';
import path from 'node:path';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Vibration } from 'react-native';
import { installFakeApi, me, route } from './helpers';
import { header, resetApp, routeRe, signedIn, UUID } from './pro-helpers';
import { offer, profileResponse, proProfile } from './fixtures';
import { reporter, trackingMode } from '../src/online/tracking';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const HANDYMAN = { id: UUID(1), kind: 'SOLO', status: 'APPROVED', companyId: null, isOnline: false };

afterEach(() => resetApp());

function liveOffer(id: string, over: Record<string, unknown> = {}) {
  const now = Date.now();
  return offer({ id, sentAt: new Date(now).toISOString(), expiresAt: new Date(now + 30_000).toISOString(), ...over });
}

function setup(opts: { profile?: ReturnType<typeof proProfile>; offers?: () => unknown[]; online?: { isOnline: boolean; warnings: string[] } } = {}) {
  const current = me({ firstName: 'Elvin', lastName: 'Məmmədov', handyman: HANDYMAN });
  let online = false;
  const profile = opts.profile ?? proProfile();
  const calls = installFakeApi([
    ...signedIn(() => current),
    route('GET', '/pro/profile', () => ({ status: 200, body: profileResponse({ profile: { ...profile, isOnline: online } }) })),
    route('GET', '/pro/stats/today', () => ({ status: 200, body: { date: '2026-10-25', jobs: 5, earnings: 12000, fees: 5000 } })),
    route('POST', '/pro/online', (c) => {
      const res = opts.online ?? { isOnline: (c.body as { online: boolean }).online, warnings: [] };
      online = res.isOnline;
      return { status: 200, body: res };
    }),
    route('POST', '/pro/location', () => ({ status: 200, body: { ok: true } })),
    route('GET', '/pro/offers/current', () => ({ status: 200, body: { items: opts.offers?.() ?? [], serverNow: new Date().toISOString() } })),
    routeRe('POST', /^\/pro\/offers\/([^/]+)\/seen$/, () => ({ status: 200, body: { ok: true } })),
    routeRe('POST', /^\/pro\/offers\/([^/]+)\/decline$/, () => ({ status: 200, body: { ok: true } })),
  ]);
  return { calls };
}

describe('pro home (board 03 B1)', () => {
  it('shows the identity pill, the "Bu gün" stats and goes online with the location foreground service', async () => {
    const { calls } = setup();
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('home-approved')).toBeTruthy());
    expect(screen.getByText('Salam, Elvin')).toBeTruthy();
    expect(screen.getByTestId('home-identity').props.children).toBe('Elvin M. • Santexnik');
    await waitFor(() => expect(screen.getByTestId('stat-jobs')).toBeTruthy());
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText(/^120\s₼$/)).toBeTruthy();
    expect(screen.getByText(/^-50\s₼$/)).toBeTruthy();
    expect(screen.getByText('OFLAYN')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('online-toggle'));
    await waitFor(() => expect(screen.getByText('ONLAYN')).toBeTruthy());
    const post = calls.find((c) => c.method === 'POST' && c.path === '/pro/online');
    expect(post?.body).toEqual({ online: true, location: { lat: 40.4093, lng: 49.8671 } });
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      'tezfiks-pro-online-location',
      expect.objectContaining({
        timeInterval: 15000,
        foregroundService: expect.objectContaining({ notificationTitle: 'Siz onlaynsınız' }),
      }),
    );
    expect(trackingMode()).toBe('service');
    // the first fix is reported at once over the connected socket (pro:location)
    await waitFor(() => expect(reporter.sentCount).toBeGreaterThan(0));
    const sockets = (require('socket.io-client').io as jest.Mock).mock.results.map((x) => x.value as { emit: jest.Mock });
    const pings = sockets.flatMap((sk) => sk.emit.mock.calls.filter((c) => c[0] === 'pro:location'));
    expect(pings[0]?.[1]).toMatchObject({ lat: 40.4093, lng: 49.8671 });
    expect(calls.some((c) => c.path === '/pro/location')).toBe(false);

    await fireEvent.press(screen.getByTestId('online-toggle'));
    await waitFor(() => expect(screen.getByText('OFLAYN')).toBeTruthy());
    expect(calls.filter((c) => c.path === '/pro/online').map((c) => c.body)).toEqual([
      { online: true, location: { lat: 40.4093, lng: 49.8671 } },
      { online: false },
    ]);
    expect(trackingMode()).toBe('none');
  });

  it('does not go online without the location permission', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ granted: false, status: 'denied', canAskAgain: true });
    const { calls } = setup();
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('online-toggle')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('online-toggle'));
    await waitFor(() => expect(screen.getByText('Onlayn olmaq üçün məkan icazəsi lazımdır')).toBeTruthy());
    expect(calls.some((c) => c.path === '/pro/online')).toBe(false);
  });

  it('shows the low balance banner and the warnings returned by "Onlayn"', async () => {
    setup({
      profile: proProfile({ wallet: { accountId: UUID(5), currency: 'AZN', posted: 400, held: 0, available: 400, isDebt: false, lowBalance: true } }),
      online: { isOnline: true, warnings: ['LOW_BALANCE', 'NO_TRADES'] },
    });
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('home-low-balance')).toBeTruthy());
    expect(screen.getByText(/^Balans 10\s₼-dən az olduqda yeni sifariş qəbul edə bilməzsiniz$/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('online-toggle'));
    await waitFor(() => expect(screen.getByTestId('home-warning-NO_TRADES')).toBeTruthy());
    expect(screen.queryByTestId('home-warning-LOW_BALANCE')).toBeNull(); // already shown as the balance banner
  });
});

describe('incoming offer (board 03 B2)', () => {
  it('polls while online, shows the offer without phone or flat details, vibrates once and accepts with an idempotency key', async () => {
    const o = liveOffer(UUID(77), { isEmergency: true });
    let open = true;
    const { calls } = setup({ offers: () => (open ? [o] : []) });
    const assignmentId = UUID(500);
    installFakeApiExtra(calls, assignmentId, () => {
      open = false;
    });
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('online-toggle')).toBeTruthy());
    expect(calls.some((c) => c.path === '/pro/offers/current')).toBe(false); // offline: no polling
    await fireEvent.press(screen.getByTestId('online-toggle'));
    await waitFor(() => expect(screen.getByTestId('offer-modal')).toBeTruthy());

    expect(screen.getByText('Yeni sifariş!')).toBeTruthy();
    expect(screen.getByTestId('offer-service').props.children).toBe('Santexnik — kran təmiri — Mətbəxdə kran damcılayır');
    expect(screen.getByTestId('offer-address').props.children).toBe('Atatürk pr. 45, Nərimanov');
    expect(screen.getByTestId('offer-distance').props.children).toBe('2,4 km • ~12 dəq');
    expect(screen.getByTestId('offer-customer').props.children).toBe('Nizami T. • ★ 4.8');
    expect(screen.getByText('TƏCİLİ')).toBeTruthy();
    expect(screen.getByText('Sifarişi qəbul etdikdə balansınızdan 10 AZN platforma haqqı tutulacaq')).toBeTruthy();
    expect(screen.getByText(/Qəbul üçün (29|30) saniyə/)).toBeTruthy();
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: { channelId: 'offers_v1' } }),
    );
    await waitFor(() => expect(calls.some((c) => c.path === `/pro/offers/${o.id}/seen`)).toBe(true));

    await fireEvent.press(screen.getByTestId('offer-accept'));
    await waitFor(() => expect(r.getPathname()).toBe(`/job/${assignmentId}`));
    const accept = calls.find((c) => c.path === `/pro/offers/${o.id}/accept`)!;
    expect(header(accept, 'Idempotency-Key')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('job-screen')).toBeTruthy());
  });

  it('declining removes the offer and tells the server; a taken offer shows the "already taken" message', async () => {
    const a = liveOffer(UUID(81));
    const b = liveOffer(UUID(82), { expiresAt: new Date(Date.now() + 25_000).toISOString(), requestNumber: 3001 });
    const { calls } = setup({ offers: () => [a, b] });
    const extra = installFakeApiTaken(calls);
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('online-toggle')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('online-toggle'));
    await waitFor(() => expect(screen.getByTestId('offer-modal')).toBeTruthy());
    // b expires first → shown first, a waits
    expect(screen.getByText(/Sifariş #3001/)).toBeTruthy();
    expect(screen.getByText(/daha 1 sifariş gözləyir/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('offer-decline'));
    await waitFor(() => expect(calls.some((c) => c.path === `/pro/offers/${b.id}/decline`)).toBe(true));
    await waitFor(() => expect(screen.getByText(/Sifariş #2847/)).toBeTruthy());
    await fireEvent.press(screen.getByTestId('offer-accept'));
    await waitFor(() => expect(screen.getByText('Bu sifariş artıq başqa usta tərəfindən qəbul edilib')).toBeTruthy());
    await waitFor(() => expect(screen.queryByTestId('offer-modal')).toBeNull());
    expect(extra.acceptCalls()).toBe(1);
  });

  it('insufficient balance keeps the offer and offers a top-up', async () => {
    const a = liveOffer(UUID(91));
    const { calls } = setup({ offers: () => [a] });
    installFakeApiError(calls, 402, 'INSUFFICIENT_BALANCE');
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('online-toggle')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('online-toggle'));
    await waitFor(() => expect(screen.getByTestId('offer-modal')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('offer-accept'));
    await waitFor(() => expect(screen.getByText('Balansınız platforma haqqı üçün kifayət deyil')).toBeTruthy());
    expect(screen.getByTestId('offer-modal')).toBeTruthy();
    // a retry of the same offer reuses the idempotency key
    await act(async () => undefined);
    await fireEvent.press(screen.getByTestId('offer-accept'));
    await waitFor(() => expect(calls.filter((c) => c.path === `/pro/offers/${a.id}/accept`)).toHaveLength(2));
    const keys = calls.filter((c) => c.path === `/pro/offers/${a.id}/accept`).map((c) => header(c, 'Idempotency-Key'));
    expect(keys[0]).toBe(keys[1]);
  });

  // The offer modal is drawn above the toast host: a failure must be visible inside the modal itself.
  it('insufficient balance is shown inside the offer modal; its top-up action moves the offer aside and opens Balans', async () => {
    const a = liveOffer(UUID(93));
    const { calls } = setup({ offers: () => [a] });
    installFakeApiError(calls, 402, 'INSUFFICIENT_BALANCE');
    const r = await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('online-toggle')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('online-toggle'));
    await waitFor(() => expect(screen.getByTestId('offer-modal')).toBeTruthy());
    expect(screen.queryByTestId('offer-error')).toBeNull();

    await fireEvent.press(screen.getByTestId('offer-accept'));
    await waitFor(() => expect(within(screen.getByTestId('offer-modal')).getByTestId('offer-error')).toBeTruthy());
    const modal = within(screen.getByTestId('offer-modal'));
    expect(modal.getByText('Balansınız platforma haqqı üçün kifayət deyil')).toBeTruthy();
    expect(modal.getByTestId('offer-topup')).toBeTruthy();
    expect(screen.getAllByText('Balansınız platforma haqqı üçün kifayət deyil')).toHaveLength(1); // no hidden duplicate toast

    await fireEvent.press(modal.getByTestId('offer-topup'));
    await waitFor(() => expect(r.getPathname()).toBe('/balance'));
    // the modal no longer covers the balance screen, and the offer was not declined
    expect(screen.queryByTestId('offer-modal')).toBeNull();
    expect(calls.some((c) => c.path === `/pro/offers/${a.id}/decline`)).toBe(false);

    // back on home the still-open offer returns, without the stale error
    await act(async () => {
      router.navigate('/');
    });
    await waitFor(() => expect(screen.getByTestId('offer-modal')).toBeTruthy());
    expect(screen.queryByTestId('offer-error')).toBeNull();
  });

  it('an offer taken by someone else while another one waits: the "already taken" message is visible over the next offer', async () => {
    const a = liveOffer(UUID(95));
    const b = liveOffer(UUID(96), { expiresAt: new Date(Date.now() + 25_000).toISOString(), requestNumber: 3002 });
    const { calls } = setup({ offers: () => [a, b] });
    installFakeApiTaken(calls);
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('online-toggle')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('online-toggle'));
    await waitFor(() => expect(screen.getByText(/Sifariş #3002/)).toBeTruthy());
    await fireEvent.press(screen.getByTestId('offer-accept'));
    await waitFor(() => expect(screen.getByText(/Sifariş #2847/)).toBeTruthy());
    expect(within(screen.getByTestId('offer-modal')).getByText('Bu sifariş artıq başqa usta tərəfindən qəbul edilib')).toBeTruthy();
    expect(screen.getAllByText('Bu sifariş artıq başqa usta tərəfindən qəbul edilib')).toHaveLength(1);
  });

  it('a network failure on accept is shown inside the offer modal (no top-up action) and keeps the offer', async () => {
    const a = liveOffer(UUID(94));
    const { calls } = setup({ offers: () => [a] });
    installFakeApiError(calls, 503, 'INTERNAL');
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('online-toggle')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('online-toggle'));
    await waitFor(() => expect(screen.getByTestId('offer-modal')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('offer-accept'));
    await waitFor(() => expect(within(screen.getByTestId('offer-modal')).getByTestId('offer-error')).toBeTruthy());
    expect(screen.queryByTestId('offer-topup')).toBeNull();
    expect(screen.getByTestId('offer-accept')).toBeTruthy();
    expect(screen.getByTestId('offer-decline')).toBeTruthy();
  });
});

/* Extra routes appended to the fake API (installFakeApi replaced global.fetch; wrap it). */
function wrapFetch(extra: (path: string, method: string) => { status: number; body?: unknown } | undefined, calls: { method: string; path: string }[]) {
  const inner = global.fetch;
  global.fetch = jest.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const p = url.replace('http://10.0.2.2:3000/tezfix/api', '');
    const res = extra(p, String(init.method ?? 'GET'));
    if (res) {
      calls.push({ method: String(init.method ?? 'GET'), path: p, headers: (init.headers ?? {}) as Record<string, string>, body: undefined } as never);
      return new Response(res.body === undefined ? null : JSON.stringify(res.body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
    }
    return inner(input, init);
  }) as unknown as typeof fetch;
}

function installFakeApiExtra(calls: { method: string; path: string }[], assignmentId: string, onAccept: () => void) {
  const assignment = {
    id: assignmentId,
    requestId: UUID(600),
    requestNumber: 2847,
    status: 'ACCEPTED',
    view: 'FULL',
    providerType: 'HANDYMAN',
    company: null,
    worker: { handymanId: UUID(1), userId: 'u1', firstName: 'Elvin', lastName: 'Məmmədov', photo: null, phone: null },
    timing: 'NOW',
    scheduledAt: null,
    isEmergency: true,
    isGuaranteeFix: false,
    category: { id: UUID(700), slug: 'kran', name: 'Santexnik — kran təmiri', icon: null, vertical: 'HOME' },
    description: 'Mətbəxdə kran damcılayır',
    photos: [],
    address: {
      lat: 40.402,
      lng: 49.871,
      formatted: 'Atatürk pr. 45, mənzil 12',
      placeId: null,
      district: 'Nərimanov',
      street: 'Atatürk pr.',
      building: '45',
      block: null,
      entrance: '2',
      floor: '5',
      apartment: '12',
      intercom: null,
      note: null,
    },
    customer: { firstName: 'Nizami', lastInitial: 'T', photo: null, ratingAvg: 4.8, ratingCount: 12, type: 'INDIVIDUAL', companyName: null },
    customerPhone: null,
    contactUnlocked: false,
    chatEnabled: false,
    acceptedAt: new Date().toISOString(),
    freeCancelUntil: new Date(Date.now() + 300_000).toISOString(),
    enRouteAt: null,
    arrivedAt: null,
    priceProposedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    price: null,
  };
  wrapFetch((p, method) => {
    if (method === 'POST' && /^\/pro\/offers\/[^/]+\/accept$/.test(p)) {
      onAccept();
      return { status: 200, body: { assignment } };
    }
    if (method === 'GET' && p === `/pro/assignments/${assignmentId}`) return { status: 200, body: assignment };
    return undefined;
  }, calls);
}

function installFakeApiTaken(calls: { method: string; path: string }[]) {
  let n = 0;
  wrapFetch((p, method) => {
    if (method === 'POST' && /^\/pro\/offers\/[^/]+\/accept$/.test(p)) {
      n++;
      return { status: 409, body: { error: { code: 'OFFER_UNAVAILABLE', message: 'taken', details: null } } };
    }
    return undefined;
  }, calls);
  return { acceptCalls: () => n };
}

function installFakeApiError(calls: { method: string; path: string }[], status: number, code: string) {
  wrapFetch((p, method) => {
    if (method === 'POST' && /^\/pro\/offers\/[^/]+\/accept$/.test(p)) return { status, body: { error: { code, message: code, details: null } } };
    return undefined;
  }, calls);
}
