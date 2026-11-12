import { createLocationReporter, fixFromExpo, toLocationBody, ONLINE_PING_MS, type LocationFix } from '../src/lib/location';

function setup(connected = true) {
  let now = 1_000_000;
  const socket: unknown[] = [];
  const rest: unknown[] = [];
  let heartbeats = 0;
  const state = { connected };
  const reporter = createLocationReporter(
    {
      socketConnected: () => state.connected,
      sendSocket: (b) => socket.push(b),
      sendHeartbeat: () => heartbeats++,
      sendRest: async (b) => {
        rest.push(b);
      },
    },
    { now: () => now },
  );
  return {
    reporter,
    socket,
    rest,
    state,
    heartbeats: () => heartbeats,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}

const fix = (lat: number, at: number): LocationFix => ({ lat, lng: 49.86, accuracy: 8, heading: -1, speed: -1, at });

describe('online location throttling (15 s pings)', () => {
  it('sends the first fix at once, then at most one per 15 s', () => {
    const t = setup();
    t.reporter.push(fix(40.1, t.now()));
    expect(t.socket).toHaveLength(1);
    t.advance(5_000);
    t.reporter.push(fix(40.2, t.now()));
    t.advance(5_000);
    t.reporter.push(fix(40.3, t.now()));
    expect(t.socket).toHaveLength(1);
    t.advance(4_999);
    t.reporter.tick();
    expect(t.socket).toHaveLength(1);
    t.advance(1);
    t.reporter.tick();
    expect(t.socket).toHaveLength(2);
    expect((t.socket[1] as { lat: number }).lat).toBe(40.3); // latest buffered fix wins
    expect(ONLINE_PING_MS).toBe(15_000);
  });

  it('sends a heartbeat when the phone does not move and no fix arrives', () => {
    const t = setup();
    t.reporter.push(fix(40.1, t.now()));
    t.advance(15_000);
    t.reporter.tick();
    expect(t.heartbeats()).toBe(1);
    expect(t.socket).toHaveLength(1);
    t.advance(10_000);
    t.reporter.tick();
    expect(t.heartbeats()).toBe(1);
  });

  it('falls back to REST when the socket is disconnected (re-sending the last fix as a ping)', () => {
    const t = setup(false);
    t.reporter.push(fix(40.1, t.now()));
    expect(t.rest).toHaveLength(1);
    t.advance(15_000);
    t.reporter.tick();
    expect(t.rest).toHaveLength(2);
    expect(t.heartbeats()).toBe(0);
  });

  it('does nothing before the first fix and forgets everything on reset', () => {
    const t = setup();
    t.reporter.tick();
    expect(t.socket).toHaveLength(0);
    t.reporter.push(fix(40.1, t.now()));
    t.reporter.reset();
    expect(t.reporter.lastFix).toBeNull();
    t.reporter.push(fix(40.2, t.now()));
    expect(t.socket).toHaveLength(2); // sent at once after reset
  });

  it('supports a faster interval (en route, 5 s)', () => {
    const t = setup();
    t.reporter.setInterval(5_000);
    t.reporter.push(fix(40.1, t.now()));
    t.advance(5_000);
    t.reporter.push(fix(40.2, t.now()));
    expect(t.socket).toHaveLength(2);
  });
});

describe('location body', () => {
  it('drops unknown (negative) heading/speed and corrects the timestamp to server time', () => {
    const body = toLocationBody(fix(40.4, Date.parse('2026-10-25T10:00:00.000Z')), -2_000);
    expect(body).toEqual({ lat: 40.4, lng: 49.86, accuracy: 8, at: '2026-10-25T09:59:58.000Z' });
  });

  it('converts expo-location objects and rejects garbage', () => {
    expect(fixFromExpo({ coords: { latitude: 40.4, longitude: 49.8, accuracy: 5, heading: 90, speed: 3 }, timestamp: 42 })).toEqual({
      lat: 40.4,
      lng: 49.8,
      accuracy: 5,
      heading: 90,
      speed: 3,
      at: 42,
    });
    expect(fixFromExpo({ coords: { latitude: Number.NaN, longitude: 49.8 } })).toBeNull();
    expect(fixFromExpo(null)).toBeNull();
  });
});
