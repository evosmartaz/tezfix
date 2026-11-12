/*
 * Online session lifecycle beyond the toggle: tracking stops when the profile leaves APPROVED (block, worker removed),
 * also while the home screen is not mounted; tracking resumes after a restart and stops when the server turns the pro
 * offline; offers arrive and close over the socket; personal offers keep showing in company mode.
 */
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import type { ProProfile } from '@tezfiks/shared';
import { installFakeApi, me, route } from './helpers';
import { clientEmits, emitServerEvent, resetApp, routeRe, signedIn, UUID } from './pro-helpers';
import { offer, profileResponse, proProfile } from './fixtures';
import { startOnlineTracking, trackingMode, trackingStore } from '../src/online/tracking';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const COMPANY_ID = UUID(9);

afterEach(() => resetApp());

function liveOffer(id: string, over: Record<string, unknown> = {}) {
  const now = Date.now();
  return offer({ id, sentAt: new Date(now).toISOString(), expiresAt: new Date(now + 30_000).toISOString(), ...over });
}

interface ServerState {
  profile: ProProfile;
  online: boolean;
  offers: ReturnType<typeof offer>[];
  managedCompanies?: Array<{ id: string; name: string; status: 'APPROVED'; role: 'MANAGER' }>;
}

function setup(state: ServerState) {
  const current = () =>
    me({
      firstName: 'Elvin',
      lastName: 'Məmmədov',
      handyman: { id: UUID(1), kind: state.profile.kind, status: state.profile.status, companyId: state.profile.company?.id ?? null, isOnline: state.online },
      companies: (state.managedCompanies ?? []).map((c) => ({ companyId: c.id, companyName: c.name, role: 'MANAGER', companyStatus: 'APPROVED' })),
    });
  const calls = installFakeApi([
    ...signedIn(current),
    route('GET', '/pro/profile', () => ({
      status: 200,
      body: profileResponse({ profile: { ...state.profile, isOnline: state.online }, managedCompanies: state.managedCompanies ?? [] }),
    })),
    route('GET', '/pro/stats/today', () => ({ status: 200, body: { date: '2026-10-25', jobs: 0, earnings: 0, fees: 0 } })),
    route('POST', '/pro/online', (c) => {
      state.online = (c.body as { online: boolean }).online;
      return { status: 200, body: { isOnline: state.online, warnings: [] } };
    }),
    route('POST', '/pro/location', () => ({ status: 200, body: { ok: true } })),
    route('GET', '/pro/offers/current', () => ({ status: 200, body: { items: state.offers, serverNow: new Date().toISOString() } })),
    routeRe('POST', /^\/pro\/offers\/([^/]+)\/seen$/, () => ({ status: 200, body: { ok: true } })),
    routeRe('POST', /^\/pro\/offers\/([^/]+)\/decline$/, () => ({ status: 200, body: { ok: true } })),
    route('GET', `/company/${COMPANY_ID}`, () => ({ status: 200, body: companyView() })),
  ]);
  return { calls };
}

function companyView() {
  return {
    id: COMPANY_ID,
    name: 'FixPro MMC',
    legalForm: 'MMC',
    voen: '1234567890',
    status: 'APPROVED',
    rejectReason: null,
    finalPriceEntry: 'MANAGER',
    isVatPayer: false,
    trades: [],
    base: null,
    baseAddress: null,
    serviceRadiusKm: 15,
    ratingAvg: null,
    ratingCount: 0,
    strikes: 0,
    wallet: { accountId: UUID(10), currency: 'AZN', posted: 24000, held: 0, available: 24000, isDebt: false, lowBalance: false },
    earningsBalance: 0,
    membersCount: 3,
    onlineWorkers: 2,
    myRole: 'MANAGER',
    kyc: { status: 'APPROVED', submittedAt: null, reviewedAt: null, rejectReason: null, attemptsLeft24h: 3 },
  };
}

/** The foreground service reports as started while it runs (so stopping it is observable). */
function serviceRunningMock() {
  let running = false;
  (Location.startLocationUpdatesAsync as jest.Mock).mockImplementation(async () => {
    running = true;
  });
  (Location.stopLocationUpdatesAsync as jest.Mock).mockImplementation(async () => {
    running = false;
  });
  (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockImplementation(async () => running);
  return { running: () => running };
}

afterEach(() => {
  (Location.startLocationUpdatesAsync as jest.Mock).mockImplementation(async () => undefined);
  (Location.stopLocationUpdatesAsync as jest.Mock).mockImplementation(async () => undefined);
  (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockImplementation(async () => false);
});

/** renderRouter installs Jest fake timers: move the clock (timers, Date) forward inside act. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function pushProfileUpdated() {
  await act(async () => {
    expect(emitServerEvent('profile:updated', { reason: 'test' })).toBeGreaterThan(0);
  });
}

async function goOnline() {
  await waitFor(() => expect(screen.getByTestId('online-toggle')).toBeTruthy());
  await fireEvent.press(screen.getByTestId('online-toggle'));
  await waitFor(() => expect(screen.getByText('ONLAYN')).toBeTruthy());
  await waitFor(() => expect(trackingMode()).toBe('service'));
}

describe('tracking stops when the profile leaves APPROVED', () => {
  it('an admin blocks a pro who is online: the foreground service, the timer and the pings stop', async () => {
    const service = serviceRunningMock();
    const state: ServerState = { profile: proProfile(), online: false, offers: [] };
    const { calls } = setup(state);
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await goOnline();
    expect(service.running()).toBe(true);

    // the server blocks the profile and sets it offline (it does not revoke the session: the socket stays up)
    state.profile = proProfile({ status: 'BLOCKED', kyc: { status: 'BLOCKED', submittedAt: null, reviewedAt: null, rejectReason: null, attemptsLeft24h: 0 } });
    state.online = false;
    await pushProfileUpdated();
    await waitFor(() => expect(screen.getByTestId('home-unverified')).toBeTruthy());
    await waitFor(() => expect(trackingMode()).toBe('none'));
    expect(service.running()).toBe(false);
    expect(Location.stopLocationUpdatesAsync).toHaveBeenCalledWith('tezfiks-pro-online-location');

    // nothing is reported any more: no socket pings or heartbeats, no REST pings
    const before = clientEmits('pro:location').length + clientEmits('pro:heartbeat').length;
    const restPings = calls.filter((c) => c.path === '/pro/location').length;
    await advance(20_000); // longer than the 15 s ping interval: a running reporter would ping or heartbeat
    expect(clientEmits('pro:location').length + clientEmits('pro:heartbeat').length).toBe(before);
    expect(calls.filter((c) => c.path === '/pro/location')).toHaveLength(restPings);
  });

  it('a company removes a worker while the home screen is not mounted: the app-level guard stops tracking', async () => {
    const service = serviceRunningMock();
    const company = { id: COMPANY_ID, name: 'FixPro MMC', finalPriceEntry: 'MANAGER' as const };
    const state: ServerState = { profile: proProfile({ kind: 'COMPANY_WORKER', wallet: null, company }), online: true, offers: [] };
    setup(state);
    await renderRouter(APP_DIR, { initialUrl: '/device-setup' });
    await waitFor(() => expect(screen.getByTestId('device-setup-screen')).toBeTruthy());
    expect(screen.queryByTestId('home-screen')).toBeNull();
    // tracking is running (the worker went online earlier) while only device setup is mounted
    await act(async () => {
      await startOnlineTracking({ title: 'Siz onlaynsınız', body: '' });
    });
    expect(trackingStore.getState().mode).toBe('service');
    // let the guard load the profile (still APPROVED and online): tracking keeps running
    await advance(300);
    expect(trackingMode()).toBe('service');

    // removed from the company: the profile goes back to DRAFT without a company, offline
    state.profile = proProfile({ kind: 'COMPANY_WORKER', status: 'DRAFT', wallet: null, company: null });
    state.online = false;
    await pushProfileUpdated();
    await waitFor(() => expect(trackingMode()).toBe('none'));
    expect(service.running()).toBe(false);
    expect(screen.getByTestId('device-setup-screen')).toBeTruthy();
  });
});

describe('server-driven online state', () => {
  it('resumes tracking after an app restart when the server still has the pro online, and stops when the server turns it offline', async () => {
    serviceRunningMock();
    const state: ServerState = { profile: proProfile(), online: true, offers: [] };
    const { calls } = setup(state);
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText('ONLAYN')).toBeTruthy());
    await waitFor(() => expect(trackingMode()).toBe('service'));
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      'tezfiks-pro-online-location',
      expect.objectContaining({ foregroundService: expect.objectContaining({ notificationTitle: 'Siz onlaynsınız' }) }),
    );
    expect(calls.some((c) => c.method === 'POST' && c.path === '/pro/online')).toBe(false); // no toggle needed

    // presence sweep / offline elsewhere
    state.online = false;
    await pushProfileUpdated();
    await waitFor(() => expect(screen.getByText('OFLAYN')).toBeTruthy());
    await waitFor(() => expect(trackingMode()).toBe('none'));
  });
});

describe('offers over the socket', () => {
  it('offer:new opens the modal with one alert; offer:closed removes it and clears the alert', async () => {
    const state: ServerState = { profile: proProfile(), online: false, offers: [] };
    const { calls } = setup(state);
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await goOnline();
    await waitFor(() => expect(calls.some((c) => c.path === '/pro/offers/current')).toBe(true));
    expect(screen.queryByTestId('offer-modal')).toBeNull();

    const o = liveOffer(UUID(301), { requestNumber: 4100 });
    const vibrations = (require('react-native').Vibration.vibrate as jest.Mock).mock.calls.length;
    state.offers = [o];
    await act(async () => {
      expect(emitServerEvent('offer:new', o)).toBeGreaterThan(0);
    });
    await waitFor(() => expect(screen.getByTestId('offer-modal')).toBeTruthy());
    expect(screen.getByText(/Sifariş #4100/)).toBeTruthy();
    expect((require('react-native').Vibration.vibrate as jest.Mock).mock.calls.length).toBe(vibrations + 1);
    await waitFor(() => expect(calls.some((c) => c.path === `/pro/offers/${o.id}/seen`)).toBe(true));

    // a duplicate offer:new (socket + poll) does not alert twice
    await act(async () => {
      emitServerEvent('offer:new', o);
    });
    expect((require('react-native').Vibration.vibrate as jest.Mock).mock.calls.length).toBe(vibrations + 1);

    state.offers = [];
    await act(async () => {
      expect(emitServerEvent('offer:closed', { offerId: o.id, requestId: o.requestId, reason: 'TAKEN' })).toBeGreaterThan(0);
    });
    await waitFor(() => expect(screen.queryByTestId('offer-modal')).toBeNull());
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalled();
  });

  it('a scheduled pre-offer (window much longer than the offer TTL) only refreshes "Planlı sifarişlər", never the modal', async () => {
    const state: ServerState = { profile: proProfile(), online: false, offers: [] };
    setup(state);
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await goOnline();
    const now = Date.now();
    // demo settings: scheduled 4 minutes ahead, live dispatch 1 minute before → a 3 minute pre-offer
    const pre = offer({
      id: UUID(302),
      timing: 'SCHEDULED',
      scheduledAt: new Date(now + 4 * 60_000).toISOString(),
      sentAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 3 * 60_000).toISOString(),
    });
    const vibrations = (require('react-native').Vibration.vibrate as jest.Mock).mock.calls.length;
    await act(async () => {
      emitServerEvent('offer:new', pre);
    });
    await advance(200);
    expect(screen.queryByTestId('offer-modal')).toBeNull();
    expect((require('react-native').Vibration.vibrate as jest.Mock).mock.calls.length).toBe(vibrations);
  });
});

describe('company mode while online', () => {
  it('a handyman who switches to company mode while online still gets personal offers', async () => {
    const state: ServerState = {
      profile: proProfile(),
      online: false,
      offers: [],
      managedCompanies: [{ id: COMPANY_ID, name: 'FixPro MMC', status: 'APPROVED', role: 'MANAGER' }],
    };
    setup(state);
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await goOnline();
    await fireEvent.press(screen.getByTestId(`mode-${COMPANY_ID}`));
    await waitFor(() => expect(screen.getByTestId('home-company-mode')).toBeTruthy());
    expect(trackingMode()).toBe('service');

    state.offers = [liveOffer(UUID(303), { requestNumber: 5200 })];
    await waitFor(() => expect(screen.getByTestId('offer-modal')).toBeTruthy(), { timeout: 8000 });
    expect(screen.getByText(/Sifariş #5200/)).toBeTruthy();
    expect(screen.getByTestId('home-company-mode')).toBeTruthy();
  });
});
