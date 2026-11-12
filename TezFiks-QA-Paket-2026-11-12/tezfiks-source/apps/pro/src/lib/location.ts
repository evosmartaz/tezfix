import type { LocationBody } from '@tezfiks/shared';

/** Presence pings: every 15 s while online (spec §5); 5 s while en route (lane M4). */
export const ONLINE_PING_MS = 15_000;
export const EN_ROUTE_PING_MS = 5_000;

export interface LocationFix {
  lat: number;
  lng: number;
  accuracy?: number | null;
  heading?: number | null;
  speed?: number | null;
  /** Client time of the fix (ms). */
  at: number;
}

/** expo-location LocationObject → LocationFix (null for unusable fixes). */
export function fixFromExpo(loc: {
  coords: { latitude: number; longitude: number; accuracy?: number | null; heading?: number | null; speed?: number | null };
  timestamp?: number;
} | null | undefined, now: number = Date.now()): LocationFix | null {
  if (!loc?.coords) return null;
  const { latitude, longitude } = loc.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return {
    lat: latitude,
    lng: longitude,
    accuracy: loc.coords.accuracy ?? null,
    heading: loc.coords.heading ?? null,
    speed: loc.coords.speed ?? null,
    at: typeof loc.timestamp === 'number' && Number.isFinite(loc.timestamp) ? loc.timestamp : now,
  };
}

/** Contract body of a ping (pro:location / POST /pro/location). Negative heading/speed/accuracy mean "unknown" on Android. */
export function toLocationBody(fix: LocationFix, serverOffsetMs = 0): LocationBody {
  const body: LocationBody = { lat: fix.lat, lng: fix.lng, at: new Date(fix.at + serverOffsetMs).toISOString() };
  if (fix.accuracy != null && fix.accuracy >= 0) body.accuracy = fix.accuracy;
  if (fix.heading != null && fix.heading >= 0) body.heading = fix.heading;
  if (fix.speed != null && fix.speed >= 0) body.speed = fix.speed;
  return body;
}

export interface ReporterTransport {
  /** True when the realtime socket is connected (pings then go over `pro:location`). */
  socketConnected(): boolean;
  sendSocket(body: LocationBody): void;
  sendHeartbeat(): void;
  sendRest(body: LocationBody): Promise<void>;
}

export interface LocationReporterOptions {
  intervalMs?: number;
  now?: () => number;
  serverOffsetMs?: () => number;
}

export interface LocationReporter {
  /** New fix from the OS. Sent at once when the interval has elapsed since the last send, otherwise buffered. */
  push(fix: LocationFix): void;
  /** Timer tick (every second or so): flushes a buffered fix that is due, or sends a heartbeat when nothing was sent. */
  tick(): void;
  setInterval(ms: number): void;
  /** Forget everything (going offline). */
  reset(): void;
  readonly lastFix: LocationFix | null;
  readonly lastSentAt: number | null;
  readonly sentCount: number;
}

/**
 * Throttles OS location updates to one ping per interval. Uses the socket when connected and REST otherwise
 * (a REST failure is swallowed: the next ping retries). When the device does not move and the OS sends no fix,
 * a heartbeat keeps the presence entry fresh (or the last fix is re-sent over REST without a socket).
 */
export function createLocationReporter(transport: ReporterTransport, opts: LocationReporterOptions = {}): LocationReporter {
  const now = opts.now ?? (() => Date.now());
  const offset = opts.serverOffsetMs ?? (() => 0);
  let interval = opts.intervalMs ?? ONLINE_PING_MS;
  let lastFix: LocationFix | null = null;
  let pending: LocationFix | null = null;
  let lastSentAt: number | null = null;
  let sentCount = 0;

  const send = (fix: LocationFix) => {
    const body = toLocationBody(fix, offset());
    lastSentAt = now();
    sentCount++;
    pending = null;
    if (transport.socketConnected()) transport.sendSocket(body);
    else void transport.sendRest(body).catch(() => undefined);
  };

  const due = () => lastSentAt === null || now() - lastSentAt >= interval;

  return {
    push(fix) {
      lastFix = fix;
      if (due()) send(fix);
      else pending = fix;
    },
    tick() {
      if (!due()) return;
      if (pending) {
        send(pending);
        return;
      }
      if (lastSentAt === null) return; // nothing known yet
      if (transport.socketConnected()) {
        lastSentAt = now();
        transport.sendHeartbeat();
      } else if (lastFix) {
        send({ ...lastFix, at: lastFix.at });
      }
    },
    setInterval(ms) {
      interval = ms;
    },
    reset() {
      lastFix = null;
      pending = null;
      lastSentAt = null;
      sentCount = 0;
    },
    get lastFix() {
      return lastFix;
    },
    get lastSentAt() {
      return lastSentAt;
    },
    get sentCount() {
      return sentCount;
    },
  };
}
