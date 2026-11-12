import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import { Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { installFakeApi, me, route } from './helpers';
import { header, resetApp, routeRe, signedIn, UUID } from './pro-helpers';
import { offer, profileResponse, proProfile } from './fixtures';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const SOLO = { id: UUID(1), kind: 'SOLO', status: 'APPROVED', companyId: null, isOnline: false };

afterEach(() => resetApp());

describe('device setup', () => {
  it('shows permission states and Samsung battery guidance, and asks for missing permissions', async () => {
    let granted = false;
    const perm = () => ({ granted, status: granted ? 'granted' : 'undetermined', canAskAgain: true });
    (Notifications.getPermissionsAsync as jest.Mock).mockImplementation(async () => perm());
    (Notifications.requestPermissionsAsync as jest.Mock).mockImplementation(async () => {
      granted = true;
      return perm();
    });
    const current = me({ handyman: SOLO });
    installFakeApi([...signedIn(() => current)]);
    const sendIntent = jest.spyOn(Linking, 'sendIntent').mockResolvedValue(undefined as never);
    await renderRouter(APP_DIR, { initialUrl: '/device-setup' });
    await waitFor(() => expect(screen.getByTestId('device-setup-screen')).toBeTruthy());
    expect(screen.getByText(/^samsung Galaxy A54 batareyaya/)).toBeTruthy();
    expect(screen.getByTestId('device-battery-guide').props.children).toMatch(/Heç vaxt yatmayan tətbiqlər/);
    await waitFor(() => expect(screen.getByTestId('device-notif-state')).toBeTruthy());
    expect(screen.getAllByText('İcazə yoxdur')).toHaveLength(2); // notifications and location not granted yet
    await fireEvent.press(screen.getByTestId('device-notif-allow'));
    await waitFor(() => expect(Notifications.requestPermissionsAsync).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText('İcazə yoxdur')).toHaveLength(1));
    expect(screen.getByText('Aktivdir')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('device-battery-open'));
    await waitFor(() => expect(sendIntent).toHaveBeenCalledWith('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS'));
    sendIntent.mockRestore();
    granted = true;
  });
});

describe('device setup: test offer (spec §7)', () => {
  it('plays the same vibration and offers_v1 sound as a real incoming offer', async () => {
    const { Vibration } = require('react-native') as typeof import('react-native');
    const current = me({ handyman: SOLO });
    installFakeApi([...signedIn(() => current)]);
    await renderRouter(APP_DIR, { initialUrl: '/device-setup' });
    await waitFor(() => expect(screen.getByTestId('device-test-offer')).toBeTruthy());
    expect(screen.getByText('Test sifariş')).toBeTruthy();
    expect(screen.queryByTestId('device-test-sent')).toBeNull();
    const vibrations = (Vibration.vibrate as jest.Mock).mock.calls.length;
    const scheduled = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.length;
    await fireEvent.press(screen.getByTestId('device-test-offer'));
    await waitFor(() => expect(screen.getByTestId('device-test-sent')).toBeTruthy());
    expect((Vibration.vibrate as jest.Mock).mock.calls.length).toBe(vibrations + 1);
    const calls = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls;
    expect(calls.length).toBe(scheduled + 1);
    expect(calls[calls.length - 1][0]).toEqual(
      expect.objectContaining({
        content: expect.objectContaining({ title: 'Yeni sifariş!', sound: 'default', data: expect.objectContaining({ kind: 'offer-alert' }) }),
        trigger: { channelId: 'offers_v1' },
      }),
    );
  });
});

describe('Planlı sifarişlər', () => {
  it('lists scheduled offers and accepts one with an idempotency key', async () => {
    const current = me({ handyman: SOLO });
    const scheduledAt = '2026-10-28T06:00:00.000Z';
    const o = offer({ id: UUID(300), timing: 'SCHEDULED', scheduledAt, expiresAt: new Date(Date.now() + 3 * 86400_000).toISOString() });
    const calls = installFakeApi([
      ...signedIn(() => current),
      route('GET', '/pro/scheduled', () => ({ status: 200, body: { items: [o], serverNow: new Date().toISOString() } })),
      routeRe('POST', /^\/pro\/offers\/[^/]+\/accept$/, () => ({ status: 409, body: { error: { code: 'OFFER_UNAVAILABLE', message: 'x', details: null } } })),
    ]);
    await renderRouter(APP_DIR, { initialUrl: '/scheduled' });
    await waitFor(() => expect(screen.getByTestId(`scheduled-${o.id}`)).toBeTruthy());
    expect(screen.getByText('28.10.2026, 10:00')).toBeTruthy(); // Baku time
    expect(screen.getByText('Nizami T. • ★ 4.8')).toBeTruthy();
    await fireEvent.press(screen.getByTestId(`scheduled-accept-${o.id}`));
    await waitFor(() => expect(screen.getByText('Bu sifariş artıq başqa usta tərəfindən qəbul edilib')).toBeTruthy());
    const accept = calls.find((c) => c.path === `/pro/offers/${o.id}/accept`)!;
    expect(header(accept, 'Idempotency-Key')).toBeTruthy();
  });

  it('shows an empty state', async () => {
    const current = me({ handyman: SOLO });
    installFakeApi([...signedIn(() => current), route('GET', '/pro/scheduled', () => ({ status: 200, body: { items: [], serverNow: new Date().toISOString() } }))]);
    await renderRouter(APP_DIR, { initialUrl: '/scheduled' });
    await waitFor(() => expect(screen.getByText('Hazırda planlı sifariş yoxdur')).toBeTruthy());
  });
});

describe('company worker and manager mode', () => {
  it('a company worker goes online but never polls offers (the company dispatches)', async () => {
    const current = me({ handyman: { ...SOLO, kind: 'COMPANY_WORKER', companyId: UUID(9) } });
    let online = false;
    const calls = installFakeApi([
      ...signedIn(() => current),
      route('GET', '/pro/profile', () => ({
        status: 200,
        body: profileResponse({ profile: proProfile({ kind: 'COMPANY_WORKER', wallet: null, isOnline: online, company: { id: UUID(9), name: 'FixPro MMC', finalPriceEntry: 'MANAGER' } }) }),
      })),
      route('GET', '/pro/stats/today', () => ({ status: 200, body: { date: '2026-10-25', jobs: 1, earnings: 4500, fees: 0 } })),
      route('POST', '/pro/online', () => {
        online = true;
        return { status: 200, body: { isOnline: true, warnings: ['COMPANY_LOW_BALANCE'] } };
      }),
    ]);
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('online-toggle')).toBeTruthy());
    expect(screen.queryByTestId('stat-fees')).toBeNull(); // company money is not the worker's
    expect(screen.queryByTestId('home-scheduled')).toBeNull();
    await fireEvent.press(screen.getByTestId('online-toggle'));
    await waitFor(() => expect(screen.getByTestId('home-warning-COMPANY_LOW_BALANCE')).toBeTruthy());
    expect(screen.getByText('Onlaynsınız. Şirkətiniz sizə sifariş təyin edə bilər')).toBeTruthy();
    expect(calls.some((c) => c.path === '/pro/offers/current')).toBe(false);
  });

  it('a handyman who manages a company switches between personal and company mode', async () => {
    const current = me({ handyman: SOLO, companies: [{ companyId: UUID(9), companyName: 'FixPro MMC', role: 'MANAGER', companyStatus: 'APPROVED' }] });
    installFakeApi([
      ...signedIn(() => current),
      route('GET', '/pro/profile', () => ({
        status: 200,
        body: profileResponse({ managedCompanies: [{ id: UUID(9), name: 'FixPro MMC', status: 'APPROVED', role: 'MANAGER' }] }),
      })),
      route('GET', '/pro/stats/today', () => ({ status: 200, body: { date: '2026-10-25', jobs: 0, earnings: 0, fees: 0 } })),
      route('GET', `/company/${UUID(9)}`, () => ({
        status: 200,
        body: {
          id: UUID(9),
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
        },
      })),
    ]);
    await renderRouter(APP_DIR, { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('home-approved')).toBeTruthy());
    await fireEvent.press(screen.getByTestId(`mode-${UUID(9)}`));
    await waitFor(() => expect(screen.getByTestId('home-company-mode')).toBeTruthy());
    expect(screen.getByText('Ustalar: 3 • Onlayn: 2')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('mode-personal'));
    await waitFor(() => expect(screen.getByTestId('home-approved')).toBeTruthy());
  });
});

describe('profile tab', () => {
  it('shows the work profile and links to device setup', async () => {
    const current = me({ handyman: SOLO });
    installFakeApi([...signedIn(() => current), route('GET', '/pro/profile', () => ({ status: 200, body: profileResponse() }))]);
    const r = await renderRouter(APP_DIR, { initialUrl: '/profile' });
    await waitFor(() => expect(screen.getByTestId('profile-work')).toBeTruthy());
    expect(screen.getByText('Xidmət radiusu: 10 km')).toBeTruthy();
    expect(screen.getByText('İxtisaslar: Santexnik')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('profile-device-setup'));
    await waitFor(() => expect(r.getPathname()).toBe('/device-setup'));
  });
});
