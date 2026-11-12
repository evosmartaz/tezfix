import { DEFAULT_SETTINGS, encodePolyline } from '@tezfiks/shared';
import {
  applyLocation,
  assignmentHref,
  contactState,
  declineSplit,
  penaltyCompensationOf,
  etaLabelMinutes,
  freeCancelSecondsLeft,
  isActiveAssignment,
  nextCustomerStep,
  remainingRoute,
  routeCoordinates,
  siblingAssignments,
  telUrl,
  trackingPhase,
  trackingSteps,
} from '../src/lib/tracking';
import { IDS, assignment } from './fixtures';
import { M3, ROUTE_POINTS, completed, enRoute, priced } from './fixtures-m3';

const ping = (over: Record<string, unknown> = {}) => ({
  assignmentId: IDS.assignment,
  lat: 40.42,
  lng: 49.88,
  heading: 180,
  at: '2099-01-01T10:00:00.000Z',
  etaSec: 290,
  distanceM: 1800,
  ...over,
});

describe('live location deltas', () => {
  it('moves the marker and lowers the ETA', () => {
    const a = applyLocation(enRoute(), ping());
    expect(a.location).toEqual({ lat: 40.42, lng: 49.88, heading: 180, at: '2099-01-01T10:00:00.000Z' });
    expect(a.etaSec).toBe(290);
    expect(a.distanceM).toBe(1800);
  });

  it('ignores pings of other assignments and out-of-order (older) pings', () => {
    const a = enRoute();
    expect(applyLocation(a, ping({ assignmentId: M3.assignment2 }))).toBe(a);
    const newer = applyLocation(a, ping());
    expect(applyLocation(newer, ping({ at: '2098-12-31T10:00:00.000Z', etaSec: 999 }))).toBe(newer);
  });

  it('keeps the last ETA when a ping has none, and never unlocks the contact by itself', () => {
    const a = applyLocation(enRoute({ etaSec: 400 }), ping({ etaSec: null, distanceM: null }));
    expect(a.etaSec).toBe(400);
    expect(a.contactUnlocked).toBe(false);
    expect(a.providerPhone).toBeNull();
    expect(a.status).toBe('EN_ROUTE');
  });
});

describe('ETA and the free cancellation window', () => {
  it('"12 dəq məsafədə": whole minutes rounded up, at least one', () => {
    expect(etaLabelMinutes(720)).toBe(12);
    expect(etaLabelMinutes(721)).toBe(13);
    expect(etaLabelMinutes(5)).toBe(1);
    expect(etaLabelMinutes(0)).toBe(1);
    expect(etaLabelMinutes(null)).toBeNull();
  });

  it('counts down to freeCancelUntil with the server clock offset, exactly to the 5-minute boundary', () => {
    const now = Date.parse('2026-10-25T10:01:00.000Z');
    const a = { freeCancelUntil: '2026-10-25T10:06:00.000Z' };
    expect(freeCancelSecondsLeft(a, 0, now)).toBe(300);
    expect(freeCancelSecondsLeft(a, 0, now + 299_001)).toBe(1);
    expect(freeCancelSecondsLeft(a, 0, now + 300_000)).toBe(0);
    expect(freeCancelSecondsLeft(a, 0, now + 400_000)).toBe(0);
    // The phone is 10 s behind the server: 10 s less are left.
    expect(freeCancelSecondsLeft(a, 10_000, now)).toBe(290);
  });
});

describe('route geometry', () => {
  it('decodes the stored polyline to map coordinates', () => {
    const pts = routeCoordinates({ polyline: encodePolyline(ROUTE_POINTS), durationSec: 1, distanceM: 1, computedAt: '2026-10-25T10:00:00.000Z', source: 'google' });
    expect(pts).toHaveLength(3);
    expect(pts[0].latitude).toBeCloseTo(40.4293, 4);
    expect(pts[2].longitude).toBeCloseTo(49.8671, 4);
    expect(routeCoordinates(null)).toEqual([]);
  });

  it('draws only the part still ahead of the handyman, starting at his live position', () => {
    const pts = ROUTE_POINTS.map((p) => ({ latitude: p.lat, longitude: p.lng }));
    const live = { latitude: 40.4195, longitude: 49.8772 };
    expect(remainingRoute(pts, live)).toEqual([live, pts[2]]);
    expect(remainingRoute(pts, null)).toBe(pts);
    expect(remainingRoute(pts.slice(0, 1), live)).toEqual(pts.slice(0, 1));
  });
});

describe('contact unlock (spec 4.4)', () => {
  it('call and chat stay locked before the unlock, even if a phone were present', () => {
    expect(contactState({ contactUnlocked: false, providerPhone: null, chatEnabled: false })).toEqual({ canCall: false, canChat: false, locked: true });
    expect(contactState({ contactUnlocked: false, providerPhone: '+994501112233', chatEnabled: false }).canCall).toBe(false);
  });

  it('after the unlock the dialer and chat open; after the chat window only the history remains', () => {
    expect(contactState({ contactUnlocked: true, providerPhone: '+994501112233', chatEnabled: true })).toEqual({ canCall: true, canChat: true, locked: false });
    expect(contactState({ contactUnlocked: true, providerPhone: null, chatEnabled: false })).toEqual({ canCall: false, canChat: false, locked: false });
  });

  it('tel: links contain only dialable characters', () => {
    expect(telUrl('+994 (50) 111-22-33')).toBe('tel:+994501112233');
  });
});

describe('phases, steps and next screen', () => {
  it('maps every assignment status to a tracking phase', () => {
    expect(trackingPhase('ACCEPTED')).toBe('accepted');
    expect(trackingPhase('EN_ROUTE')).toBe('enRoute');
    expect(trackingPhase('ARRIVED')).toBe('arrived');
    expect(trackingPhase('PRICE_PROPOSED')).toBe('price');
    expect(trackingPhase('PRICE_DISPUTED')).toBe('disputed');
    expect(trackingPhase('COMPLETED')).toBe('completed');
    for (const s of ['CANCELLED_FREE', 'CANCELLED_BY_PROVIDER', 'CANCELLED_BY_CUSTOMER', 'DECLINED_ON_ARRIVAL', 'NO_SHOW'] as const) {
      expect(trackingPhase(s)).toBe('cancelled');
      expect(isActiveAssignment(s)).toBe(false);
    }
    expect(isActiveAssignment('PRICE_DISPUTED')).toBe(true);
  });

  it('timeline: done steps with Baku times, the next one current, nothing current once ended', () => {
    const steps = trackingSteps(enRoute({ acceptedAt: '2026-10-25T10:02:00.000Z', enRouteAt: '2026-10-25T10:05:00.000Z' }));
    expect(steps.map((s) => [s.key, s.state, s.time])).toEqual([
      ['accepted', 'done', '14:02'],
      ['enRoute', 'done', '14:05'],
      ['arrived', 'current', null],
      ['completed', 'pending', null],
    ]);
    const done = trackingSteps(completed({ completedAt: '2026-10-25T11:00:00.000Z' }));
    expect(done[3]).toEqual({ key: 'completed', state: 'done', time: '15:00' });
    const cancelled = trackingSteps(assignment({ status: 'CANCELLED_FREE' }));
    expect(cancelled.filter((s) => s.state === 'current')).toHaveLength(0);
  });

  it('other handymen of the same request: active first, then by slot', () => {
    const list = [
      assignment(),
      assignment({ id: M3.assignment2, slotIndex: 2, status: 'COMPLETED' }),
      assignment({ id: '50000000-0000-4000-a000-000000000003', slotIndex: 1, status: 'EN_ROUTE' }),
    ];
    expect(siblingAssignments(list, IDS.assignment).map((a) => a.slotIndex)).toEqual([1, 2]);
  });

  it('the price goes to the payment screen, a completed unrated job to the rating', () => {
    expect(nextCustomerStep(priced())).toBe('pay');
    expect(nextCustomerStep(completed())).toBe('rate');
    expect(nextCustomerStep(completed({ actions: { ...completed().actions, rate: false } }))).toBeNull();
    expect(nextCustomerStep(enRoute())).toBeNull();
    expect(assignmentHref({ id: 'x' })).toBe('/assignment/x');
  });

  it('declineSplit: the server charge split into the handyman trip compensation and the platform share (spec: 10 + 5 AZN)', () => {
    // Without a configured value the platform defaults apply (penaltyCompensation 10 AZN of cancelPenalty 15 AZN).
    expect(declineSplit(DEFAULT_SETTINGS.cancelPenalty)).toEqual({ amount: 1500, comp: 1000, fee: 500 });
    // A configured compensation (GET /config/public) wins over the defaults.
    expect(declineSplit(2000, 1200)).toEqual({ amount: 2000, comp: 1200, fee: 800 });
    // Never a negative platform share or a compensation above the charge; a guarantee re-fix declines for free.
    expect(declineSplit(800)).toEqual({ amount: 800, comp: 800, fee: 0 });
    expect(declineSplit(0)).toEqual({ amount: 0, comp: 0, fee: 0 });
    // Garbage from the network falls back to the defaults.
    expect(declineSplit(1500, Number.NaN)).toEqual({ amount: 1500, comp: 1000, fee: 500 });
    expect(declineSplit(1500, -5)).toEqual({ amount: 1500, comp: 1000, fee: 500 });
    expect(penaltyCompensationOf({ penaltyCompensation: 900 })).toBe(900);
    expect(penaltyCompensationOf({ cancelPenalty: 1500 })).toBeNull();
    expect(penaltyCompensationOf(undefined)).toBeNull();
  });
});
