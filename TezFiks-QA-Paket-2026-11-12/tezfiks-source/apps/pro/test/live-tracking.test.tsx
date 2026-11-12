import { renderRouter, screen, waitFor } from 'expo-router/testing-library';
import path from 'node:path';
import * as Location from 'expo-location';
import { resetApp, clientEmits, UUID } from './pro-helpers';
import { assignment } from './fixtures';
import { installPro } from './m4-helpers';
import { wantsRouteTracking } from '../src/lib/jobs';
import { routeAssignment } from '../src/online/tracking';

const APP_DIR = path.join(__dirname, '..', 'src', 'app');
const JOB = UUID(500);

afterEach(() => resetApp());

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

/**
 * Founder decision (2026-10-26): the customer sees the handyman live from acceptance, and the phone numbers unlock from the
 * live ETA without pressing "Yola çıxdım". The pro app therefore reports its position every 5 s from acceptance.
 */
describe('live tracking from acceptance (pro app)', () => {
  it('wantsRouteTracking: accepted NOW/EMERGENCY jobs and scheduled jobs within the hour; never for managers', () => {
    const now = Date.now();
    expect(wantsRouteTracking(assignment({ status: 'ACCEPTED', timing: 'NOW', scheduledAt: null }), 'solo', now)).toBe(true);
    expect(wantsRouteTracking(assignment({ status: 'ACCEPTED', timing: 'EMERGENCY', scheduledAt: null }), 'worker', now)).toBe(true);
    expect(wantsRouteTracking(assignment({ status: 'ACCEPTED', timing: 'SCHEDULED', scheduledAt: inMinutes(50) }), 'solo', now)).toBe(true);
    expect(wantsRouteTracking(assignment({ status: 'ACCEPTED', timing: 'SCHEDULED', scheduledAt: inMinutes(180) }), 'solo', now)).toBe(false);
    expect(wantsRouteTracking(assignment({ status: 'ACCEPTED', timing: 'NOW', scheduledAt: null }), 'manager', now)).toBe(false);
    expect(wantsRouteTracking(assignment({ status: 'ARRIVED' }), 'solo', now)).toBe(false);
  });

  it('opening an accepted job starts the 5 s reporting with the assignment id and an "Aktiv sifariş" notification', async () => {
    installPro({ assignments: [assignment({ id: JOB, status: 'ACCEPTED', timing: 'NOW', scheduledAt: null })] });
    await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-full')).toBeTruthy());
    await waitFor(() => expect(routeAssignment()).toBe(JOB));
    expect(Location.startLocationUpdatesAsync).toHaveBeenLastCalledWith(
      'tezfiks-pro-online-location',
      expect.objectContaining({
        timeInterval: 5000,
        foregroundService: expect.objectContaining({ notificationTitle: 'Aktiv sifariş', notificationBody: 'Məkanınız müştəriyə göstərilir' }),
      }),
    );
    await waitFor(() => expect(clientEmits('pro:location').length).toBeGreaterThan(0));
    expect(clientEmits('pro:location').at(-1)?.[1]).toMatchObject({ assignmentId: JOB });
  });

  it('a job scheduled for later today is not reported yet', async () => {
    (Location.startLocationUpdatesAsync as jest.Mock).mockClear();
    installPro({ assignments: [assignment({ id: JOB, status: 'ACCEPTED', timing: 'SCHEDULED', scheduledAt: inMinutes(180) })] });
    await renderRouter(APP_DIR, { initialUrl: `/job/${JOB}` });
    await waitFor(() => expect(screen.getByTestId('job-full')).toBeTruthy());
    expect(routeAssignment()).toBeNull();
    // The online presence pings (15 s) may run; the 5 s job reporting must not.
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ timeInterval: 5000 }));
  });
});
