import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { createStore } from 'zustand/vanilla';
import { api, type ClientToServerEvents } from '@tezfiks/shared';
import { clockStore, colors } from '@tezfiks/mobile';
import { createLocationReporter, EN_ROUTE_PING_MS, fixFromExpo, ONLINE_PING_MS, type LocationFix } from '../lib/location';
import { runtime } from '../runtime';

/** Background task fed by the location foreground service ("Siz onlaynsınız" notification). */
export const LOCATION_TASK = 'tezfiks-pro-online-location';

interface SocketLike {
  connected: boolean;
  emit<E extends keyof ClientToServerEvents>(event: E, ...args: Parameters<ClientToServerEvents[E]>): unknown;
}

let socket: SocketLike | null = null;
/** Assignment the pro is driving to ("Yola çıxdım"): pings carry it and run every 5 s until arrival. */
let routeAssignmentId: string | null = null;

/** The session socket (pings go over `pro:location` while it is connected, REST otherwise). */
export function attachTrackingSocket(s: SocketLike | null): void {
  socket = s;
}

export const reporter = createLocationReporter(
  {
    socketConnected: () => !!socket?.connected,
    sendSocket: (body) => {
      socket?.emit('pro:location', routeAssignmentId ? { ...body, assignmentId: routeAssignmentId } : body);
    },
    sendHeartbeat: () => {
      socket?.emit('pro:heartbeat', {});
    },
    sendRest: async (body) => {
      await runtime.api.call(api.pro.location, { body });
    },
  },
  { intervalMs: ONLINE_PING_MS, serverOffsetMs: () => clockStore.getState().offsetMs },
);

function onLocations(locations: readonly Location.LocationObject[] | undefined): void {
  for (const l of locations ?? []) {
    const fix = fixFromExpo(l);
    if (fix) reporter.push(fix);
  }
}

// Tasks must be defined at module scope, before the app registers.
try {
  if (!TaskManager.isTaskDefined(LOCATION_TASK)) {
    TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
      if (error) return;
      onLocations(data?.locations);
    });
  }
} catch {
  // TaskManager unavailable (tests, web): tracking falls back to watchPositionAsync
}

export type TrackingMode = 'service' | 'watch' | 'none';

let tickTimer: ReturnType<typeof setInterval> | null = null;
let watchSub: Location.LocationSubscription | null = null;
let mode: TrackingMode = 'none';

/** Observable tracking mode, so app-level guards can react while no home screen is mounted. */
export const trackingStore = createStore<{ mode: TrackingMode; assignmentId: string | null }>(() => ({ mode: 'none', assignmentId: null }));

function setMode(next: TrackingMode): void {
  mode = next;
  if (trackingStore.getState().mode !== next) trackingStore.setState({ mode: next });
}

function setRoute(id: string | null): void {
  routeAssignmentId = id;
  if (trackingStore.getState().assignmentId !== id) trackingStore.setState({ assignmentId: id });
}

/** The assignment whose route is being reported (EN_ROUTE), or null. */
export function routeAssignment(): string | null {
  return routeAssignmentId;
}

export function trackingMode(): TrackingMode {
  return mode;
}

export function isTracking(): boolean {
  return mode !== 'none';
}

/** Feeds a fix obtained outside the subscriptions (the position sent with "Onlayn"). */
export function pushFix(fix: LocationFix): void {
  reporter.push(fix);
}

/**
 * Starts reporting while online: the expo-location foreground service (notification "Siz onlaynsınız"; foreground
 * permission only, no ACCESS_BACKGROUND_LOCATION) with a 15 s interval; falls back to a foreground watch when the
 * service cannot start. A 1 s timer flushes due pings and heartbeats.
 */
export function startOnlineTracking(notification: { title: string; body: string }, intervalMs: number = ONLINE_PING_MS): Promise<TrackingMode> {
  return serial(() => startImpl(notification, intervalMs));
}

/**
 * Start/stop run one at a time: two overlapping starts ("Yola çıxdım" plus the job screen's effect, or "Onlayn" while
 * a route starts) would otherwise both await the stop and then both install a ticker/watch, leaking the first one.
 */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

async function startImpl(notification: { title: string; body: string }, intervalMs: number): Promise<TrackingMode> {
  await stopImpl({ keepReporter: true });
  // while driving to a job the faster en-route interval wins, whoever (re)starts the service
  const effective = routeAssignmentId ? Math.min(intervalMs, EN_ROUTE_PING_MS) : intervalMs;
  reporter.setInterval(effective);
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => reporter.tick(), 1000);
  try {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: effective,
      distanceInterval: 0,
      foregroundService: {
        notificationTitle: notification.title,
        notificationBody: notification.body,
        notificationColor: colors.primary,
        killServiceOnDestroy: true,
      },
    });
    setMode('service');
    return mode;
  } catch {
    // no task manager or the service was refused: foreground watch
  }
  try {
    watchSub?.remove();
    watchSub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: effective, distanceInterval: 0 }, (loc) =>
      onLocations([loc]),
    );
    setMode('watch');
  } catch {
    setMode('none');
  }
  return mode;
}

export function stopOnlineTracking(opts: { keepReporter?: boolean } = {}): Promise<void> {
  return serial(() => stopImpl(opts));
}

async function stopImpl(opts: { keepReporter?: boolean }): Promise<void> {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  watchSub?.remove();
  watchSub = null;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    // not started
  }
  setMode('none');
  if (!opts.keepReporter) {
    reporter.reset();
    setRoute(null);
  }
}

/**
 * "Yola çıxdım" (lane M4): reports the position every 5 s with the assignment id (foreground service with its own
 * notification text), whether or not the pro is online for new offers.
 */
export async function startRouteTracking(assignmentId: string, notification: { title: string; body: string }): Promise<TrackingMode> {
  setRoute(assignmentId);
  return startOnlineTracking(notification, EN_ROUTE_PING_MS);
}

/**
 * Ends route reporting for `assignmentId` (arrived, cancelled, finished). An online pro falls back to the 15 s presence
 * pings; an offline pro stops reporting. Does nothing when another assignment's route is being reported.
 */
export async function stopRouteTracking(
  assignmentId: string | null,
  resume: { online: boolean; notification: { title: string; body: string } },
): Promise<void> {
  if (assignmentId !== null && routeAssignmentId !== assignmentId) return;
  if (routeAssignmentId === null && !isTracking()) return;
  setRoute(null);
  if (resume.online) await startOnlineTracking(resume.notification, ONLINE_PING_MS);
  else await stopOnlineTracking();
}

/** Current position for "Onlayn": a fresh fix within 8 s, else the last known one, else null. */
export async function currentFix(timeoutMs = 8000): Promise<LocationFix | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const fresh = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null), timeout]);
    const fix = fixFromExpo(fresh);
    if (fix) return fix;
  } catch {
    // fall through
  } finally {
    if (timer) clearTimeout(timer);
  }
  try {
    return fixFromExpo(await Location.getLastKnownPositionAsync());
  } catch {
    return null;
  }
}
