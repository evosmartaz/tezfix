import { countdownSeconds, computeClockOffset } from '@tezfiks/mobile';
import {
  addOffers,
  applyPoll,
  configureOfferTtl,
  createAcceptKeyRegistry,
  currentOffer,
  distanceKm,
  emptyOfferQueue,
  isLiveOffer,
  liveOfferMaxWindowMs,
  markAlerted,
  offerWindowSec,
  openOffers,
  pruneExpired,
  removeOffer,
} from '../src/lib/offers';
import { iso, offer, T0 } from './fixtures';

describe('offer queue', () => {
  it('shows the socket offer and counts the others waiting', () => {
    let s = addOffers(emptyOfferQueue(), [offer({ id: 'a', expiresAt: iso(T0 + 30_000) })]);
    s = addOffers(s, [offer({ id: 'b', expiresAt: iso(T0 + 20_000) })]);
    const cur = currentOffer(s, T0 + 1000);
    expect(cur.offer?.id).toBe('b'); // expires first
    expect(cur.waiting).toBe(1);
  });

  it('puts emergency offers first', () => {
    const s = addOffers(emptyOfferQueue(), [
      offer({ id: 'a', expiresAt: iso(T0 + 10_000) }),
      offer({ id: 'e', isEmergency: true, expiresAt: iso(T0 + 25_000) }),
    ]);
    expect(openOffers(s, T0).map((o) => o.id)).toEqual(['e', 'a']);
  });

  it('removes offers on offer:closed and never re-adds a declined offer from a stale poll', () => {
    let s = addOffers(emptyOfferQueue(), [offer({ id: 'a' }), offer({ id: 'b' })]);
    s = removeOffer(s, 'a');
    expect(openOffers(s, T0).map((o) => o.id)).toEqual(['b']);
    s = removeOffer(s, 'b', { dismiss: true });
    s = applyPoll(s, [offer({ id: 'b' })]);
    expect(openOffers(s, T0)).toEqual([]);
    s = addOffers(s, [offer({ id: 'b' })]);
    expect(openOffers(s, T0)).toEqual([]);
  });

  it('treats a poll as the authoritative open set but keeps offers sent after the poll started', () => {
    let s = addOffers(emptyOfferQueue(), [
      offer({ id: 'old', sentAt: iso(T0) }),
      offer({ id: 'fresh', sentAt: iso(T0 + 6_000), expiresAt: iso(T0 + 36_000) }),
    ]);
    s = applyPoll(s, [offer({ id: 'polled' })], T0 + 5_000);
    expect(Object.keys(s.offers).sort()).toEqual(['fresh', 'polled']);
  });

  it('keeps a socket offer sent in the same millisecond the poll was requested', () => {
    let s = addOffers(emptyOfferQueue(), [offer({ id: 'same-ms', sentAt: iso(T0 + 5_000), expiresAt: iso(T0 + 35_000) })]);
    s = applyPoll(s, [], T0 + 5_000);
    expect(Object.keys(s.offers)).toEqual(['same-ms']);
  });

  it('classifies SCHEDULED offers by the live offer TTL: a pre-offer window is never a live modal offer', () => {
    const sched = (windowMs: number) => offer({ timing: 'SCHEDULED', sentAt: iso(T0), expiresAt: iso(T0 + windowMs) });
    configureOfferTtl(15); // demo settings
    try {
      expect(isLiveOffer(sched(15_000))).toBe(true); // live dispatch of a scheduled request
      expect(isLiveOffer(sched(60_000))).toBe(false); // shortest demo pre-offer (lead 2 min, live dispatch 1 min before)
      expect(isLiveOffer(sched(4 * 60_000))).toBe(false);
    } finally {
      configureOfferTtl(undefined);
    }
    expect(liveOfferMaxWindowMs()).toBe(45_000); // default TTL 30 s + 15 s slack
    expect(isLiveOffer(sched(30_000))).toBe(true);
    expect(isLiveOffer(sched(5 * 60_000))).toBe(false);
  });

  it('expires offers by the server clock, exactly at expiresAt', () => {
    let s = addOffers(emptyOfferQueue(), [offer({ id: 'a', expiresAt: iso(T0 + 30_000) })]);
    expect(currentOffer(s, T0 + 29_999).offer?.id).toBe('a');
    expect(currentOffer(s, T0 + 30_000).offer).toBeNull();
    s = pruneExpired(s, T0 + 30_000);
    expect(s.offers).toEqual({});
  });

  it('ignores offers that are not SENT, company offers and long-lived scheduled offers', () => {
    const s = addOffers(emptyOfferQueue(), [
      offer({ id: 'closed', status: 'CLOSED' }),
      offer({ id: 'company', target: 'COMPANY', companyId: 'co1' }),
      offer({ id: 'sched', timing: 'SCHEDULED', expiresAt: iso(T0 + 3 * 3600_000) }),
      offer({ id: 'sched-live', timing: 'SCHEDULED', expiresAt: iso(T0 + 30_000) }),
    ]);
    expect(Object.keys(s.offers)).toEqual(['sched-live']);
    expect(isLiveOffer(offer({ timing: 'EMERGENCY' }))).toBe(true);
  });

  it('a SENT offer updated to CLOSED over the socket is removed', () => {
    let s = addOffers(emptyOfferQueue(), [offer({ id: 'a' })]);
    s = addOffers(s, [offer({ id: 'a', status: 'CLOSED' })]);
    expect(s.offers).toEqual({});
  });

  it('alerts (vibration + sound) once per offer', () => {
    let s = emptyOfferQueue();
    const first = markAlerted(s, 'a');
    expect(first.isNew).toBe(true);
    s = first.state;
    expect(markAlerted(s, 'a').isNew).toBe(false);
  });

  it('computes the window length and distance in km', () => {
    expect(offerWindowSec(offer({ sentAt: iso(T0), expiresAt: iso(T0 + 15_000) }))).toBe(15);
    expect(distanceKm(2400)).toBe(2.4);
    expect(distanceKm(2449)).toBe(2.4);
    expect(distanceKm(null)).toBeNull();
  });

  it('reuses one idempotency key per offer for retries', () => {
    let n = 0;
    const reg = createAcceptKeyRegistry(() => `k${++n}`);
    expect(reg.keyFor('a')).toBe('k1');
    expect(reg.keyFor('a')).toBe('k1');
    expect(reg.keyFor('b')).toBe('k2');
    reg.forget('a');
    expect(reg.keyFor('a')).toBe('k3');
  });
});

describe('offer countdown with the server clock', () => {
  it('uses serverNow to correct a phone clock that runs 7 s fast', () => {
    const clientNow = T0 + 7_000; // the phone is 7 s ahead
    const offset = computeClockOffset(iso(T0), clientNow)!;
    expect(offset).toBe(-7_000);
    const o = offer({ expiresAt: iso(T0 + 30_000) });
    expect(countdownSeconds(o.expiresAt, offset, clientNow)).toBe(30);
    expect(countdownSeconds(o.expiresAt, 0, clientNow)).toBe(23); // uncorrected would lose 7 s
    expect(countdownSeconds(o.expiresAt, offset, clientNow + 30_000)).toBe(0);
  });
});
