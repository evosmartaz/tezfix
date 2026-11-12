import {
  addressDetails,
  canEnterPrice,
  cancelInfo,
  isActiveJob,
  jobVisibility,
  mergeJobPages,
  navigationTargets,
  nextStep,
  proRole,
  redactForRole,
  statusTone,
  timelineSteps,
  wantsRouteTracking,
} from '../src/lib/jobs';
import { todayTiles } from '../src/lib/home';
import { assignment, proProfile } from './fixtures';

describe('job roles and worker-limited rendering rules (spec 4.4, board 04)', () => {
  it('derives the viewer role from the pro endpoint view', () => {
    expect(proRole(assignment())).toBe('solo');
    expect(proRole(assignment({ view: 'WORKER_LIMITED', providerType: 'COMPANY' }))).toBe('worker');
    // a company job in the personal list is always the caller's worker job, even if the server sent FULL
    expect(proRole(assignment({ view: 'FULL', providerType: 'COMPANY' }))).toBe('worker');
  });

  it('a company worker never sees description, price, fee, customer rating, phone or chat', () => {
    const a = assignment({ view: 'WORKER_LIMITED', providerType: 'COMPANY', contactUnlocked: true, chatEnabled: true });
    expect(jobVisibility(a, 'worker')).toEqual({
      description: false,
      customerRating: false,
      price: false,
      fee: false,
      customerPhone: false,
      chat: false,
      worker: false,
    });
  });

  it('solo and manager views show everything, phone and chat only after contact unlock', () => {
    const locked = assignment();
    expect(jobVisibility(locked, 'solo')).toMatchObject({ description: true, customerRating: true, price: true, fee: true, customerPhone: false, chat: false, worker: false });
    const open = assignment({ contactUnlocked: true, chatEnabled: true });
    expect(jobVisibility(open, 'solo')).toMatchObject({ customerPhone: true, chat: true });
    expect(jobVisibility(open, 'manager')).toMatchObject({ customerPhone: true, chat: true, worker: true, price: true, fee: true });
  });

  it('redacts a leaked payload for a worker (defence in depth)', () => {
    const leaked = assignment({
      view: 'WORKER_LIMITED',
      providerType: 'COMPANY',
      description: 'secret description',
      photos: [{ id: 'f1', kind: 'REQUEST_PHOTO', url: 'https://x/f1', contentType: 'image/jpeg', width: 1, height: 1 }],
      price: { labor: 3500, materials: 1000, total: 4500 },
      paymentMethod: 'CARD',
      tipAmount: 500,
      fee: { amount: 1000, captured: true, refunded: false },
      customerPhone: '+994501234567',
      contactUnlocked: true,
      chatEnabled: true,
      worker: { handymanId: 'h', userId: 'u', firstName: 'A', lastName: 'B', photo: null, phone: '+994551112233' },
    });
    const r = redactForRole(leaked, 'worker');
    expect(r.description).toBeNull();
    expect(r.photos).toEqual([]);
    expect(r.price).toBeNull();
    expect(r.paymentMethod).toBeNull();
    expect(r.tipAmount).toBeNull();
    expect(r.fee).toBeNull();
    expect(r.customerPhone).toBeNull();
    expect(r.chatEnabled).toBe(false);
    expect(r.customer.ratingAvg).toBeNull();
    expect(r.customer.ratingCount).toBeNull();
    expect(r.worker.phone).toBeNull();
    // what the worker may see stays
    expect(r.customer.firstName).toBe('Nizami');
    expect(r.address.formatted).toBe('Atatürk pr. 45, Nərimanov');
    expect(r.category.name).toBe('Santexnik — kran təmiri');
  });

  it('keeps the full view for a solo handyman', () => {
    const a = assignment({ price: { labor: 3500, materials: 1000, total: 4500 }, customerPhone: '+994501234567', contactUnlocked: true });
    const r = redactForRole(a, 'solo');
    expect(r.price).toEqual({ labor: 3500, materials: 1000, total: 4500 });
    expect(r.customerPhone).toBe('+994501234567');
    expect(r.description).toBe('Mətbəxdə kran damcılayır');
    expect(r.customer.ratingAvg).toBe(4.8);
  });
});

describe('price entry side ("Yekun qiyməti kim daxil edir?")', () => {
  const arrived = assignment({ status: 'ARRIVED' });
  it('solo always enters the price once arrived', () => {
    expect(canEnterPrice(arrived, 'solo', null)).toBe(true);
    expect(canEnterPrice(assignment({ status: 'EN_ROUTE' }), 'solo', null)).toBe(false);
  });
  it('company jobs: only the side named by finalPriceEntry', () => {
    expect(canEnterPrice(arrived, 'worker', 'WORKER')).toBe(true);
    expect(canEnterPrice(arrived, 'worker', 'MANAGER')).toBe(false);
    expect(canEnterPrice(arrived, 'manager', 'MANAGER')).toBe(true);
    expect(canEnterPrice(arrived, 'manager', 'WORKER')).toBe(false);
  });
  it('the server action flag can only take the right away', () => {
    const denied = assignment({ status: 'ARRIVED', actions: { enRoute: false, arrived: false, enterPrice: false, cancel: false, cancelIsFree: false, rateCustomer: false } });
    expect(canEnterPrice(denied, 'solo', null)).toBe(false);
    // a partial payload without actions still follows the role rule
    const { actions: _drop, ...noActions } = arrived;
    expect(canEnterPrice(noActions, 'solo', null)).toBe(true);
  });
});

describe('job state machine UI', () => {
  it('maps every status to the next step for each role', () => {
    expect(nextStep(assignment({ status: 'ACCEPTED' }), 'solo', null)).toBe('enRoute');
    expect(nextStep(assignment({ status: 'ACCEPTED' }), 'worker', 'MANAGER')).toBe('enRoute');
    expect(nextStep(assignment({ status: 'ACCEPTED' }), 'manager', 'MANAGER')).toBe('followWorker');
    expect(nextStep(assignment({ status: 'EN_ROUTE' }), 'solo', null)).toBe('arrived');
    expect(nextStep(assignment({ status: 'EN_ROUTE' }), 'manager', 'MANAGER')).toBe('followWorker');
    expect(nextStep(assignment({ status: 'ARRIVED' }), 'solo', null)).toBe('enterPrice');
    expect(nextStep(assignment({ status: 'ARRIVED' }), 'worker', 'MANAGER')).toBe('awaitingPriceEntry');
    expect(nextStep(assignment({ status: 'ARRIVED' }), 'worker', 'WORKER')).toBe('enterPrice');
    expect(nextStep(assignment({ status: 'ARRIVED' }), 'manager', 'MANAGER')).toBe('enterPrice');
    expect(nextStep(assignment({ status: 'PRICE_PROPOSED' }), 'solo', null)).toBe('awaitingCustomer');
    expect(nextStep(assignment({ status: 'PRICE_DISPUTED' }), 'solo', null)).toBe('disputed');
    expect(nextStep(assignment({ status: 'COMPLETED', ratedCustomer: false }), 'solo', null)).toBe('rateCustomer');
    expect(nextStep(assignment({ status: 'COMPLETED', ratedCustomer: true }), 'solo', null)).toBe('done');
    expect(nextStep(assignment({ status: 'COMPLETED', ratedCustomer: false }), 'manager', 'MANAGER')).toBe('done');
    for (const s of ['CANCELLED_FREE', 'CANCELLED_BY_PROVIDER', 'CANCELLED_BY_CUSTOMER', 'DECLINED_ON_ARRIVAL', 'NO_SHOW'] as const) {
      expect(nextStep(assignment({ status: s }), 'solo', null)).toBe('cancelled');
    }
  });

  it('active statuses', () => {
    expect(isActiveJob('ACCEPTED')).toBe(true);
    expect(isActiveJob('PRICE_DISPUTED')).toBe(true);
    expect(isActiveJob('COMPLETED')).toBe(false);
    expect(isActiveJob('NO_SHOW')).toBe(false);
  });

  it('builds the board 03 timeline with Baku times', () => {
    const steps = timelineSteps(assignment({ status: 'EN_ROUTE', acceptedAt: '2026-10-25T10:02:00.000Z', enRouteAt: '2026-10-25T10:05:00.000Z' }));
    expect(steps).toEqual([
      { key: 'accepted', time: '14:02', state: 'done' },
      { key: 'enRoute', time: '14:05', state: 'done' },
      { key: 'arrived', time: null, state: 'current' },
      { key: 'completed', time: null, state: 'pending' },
    ]);
    const cancelled = timelineSteps(assignment({ status: 'CANCELLED_BY_CUSTOMER' }));
    expect(cancelled.map((s) => s.state)).toEqual(['done', 'pending', 'pending', 'pending']);
    const done = timelineSteps(
      assignment({ status: 'COMPLETED', enRouteAt: '2026-10-25T10:05:00Z', arrivedAt: '2026-10-25T10:20:00Z', completedAt: '2026-10-25T11:00:00Z' }),
    );
    expect(done.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done']);
    expect(done[3]!.time).toBe('15:00');
  });

  it('cancel info: free inside the window, exactly at the boundary, and paid after it', () => {
    const a = assignment({ status: 'ACCEPTED', freeCancelUntil: '2026-10-25T10:07:00.000Z' });
    const until = Date.parse('2026-10-25T10:07:00.000Z');
    expect(cancelInfo(a, until - 61_000)).toEqual({ allowed: true, free: true, freeSecondsLeft: 61 });
    expect(cancelInfo(a, until - 1)).toEqual({ allowed: true, free: true, freeSecondsLeft: 1 });
    expect(cancelInfo(a, until)).toEqual({ allowed: true, free: false, freeSecondsLeft: 0 });
    expect(cancelInfo(a, until + 5_000)).toEqual({ allowed: true, free: false, freeSecondsLeft: 0 });
    expect(cancelInfo(assignment({ status: 'ARRIVED' }), until - 60_000).allowed).toBe(false);
    expect(cancelInfo(assignment({ status: 'EN_ROUTE' }), until - 60_000).allowed).toBe(true);
  });

  it('route tracking only while EN_ROUTE and never for the manager', () => {
    expect(wantsRouteTracking(assignment({ status: 'EN_ROUTE' }), 'solo')).toBe(true);
    expect(wantsRouteTracking(assignment({ status: 'EN_ROUTE' }), 'worker')).toBe(true);
    expect(wantsRouteTracking(assignment({ status: 'EN_ROUTE' }), 'manager')).toBe(false);
    expect(wantsRouteTracking(assignment({ status: 'ARRIVED' }), 'solo')).toBe(false);
    expect(wantsRouteTracking(null, 'solo')).toBe(false);
  });

  it('status tones and page merging', () => {
    expect(statusTone('COMPLETED')).toBe('success');
    expect(statusTone('PRICE_DISPUTED')).toBe('danger');
    expect(statusTone('NO_SHOW')).toBe('neutral');
    expect(mergeJobPages([{ items: [{ id: 'a' }, { id: 'b' }] }, { items: [{ id: 'b' }, { id: 'c' }] }]).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('navigation link builders (Google Maps / Waze / Paylaş)', () => {
  it('builds the deep links and a share text without customer data', () => {
    const n = navigationTargets({ lat: 40.402, lng: 49.871, formatted: 'Xətai rayonu, Məhəmməd Hadi küç. 12' }, 'Sifariş #2851');
    expect(n.google).toBe('google.navigation:q=40.402,49.871');
    expect(n.waze).toBe('https://waze.com/ul?ll=40.402,49.871&navigate=yes');
    expect(n.web).toBe('https://www.google.com/maps/dir/?api=1&destination=40.402,49.871');
    expect(n.shareMessage).toBe('Sifariş #2851\nXətai rayonu, Məhəmməd Hadi küç. 12\nhttps://www.google.com/maps/dir/?api=1&destination=40.402,49.871');
    expect(n.shareMessage).not.toMatch(/\+994/);
  });

  it('formats flat details', () => {
    const labels = { block: 'Blok', entrance: 'Giriş', floor: 'Mərtəbə', apartment: 'Mənzil', intercom: 'Domofon' };
    expect(addressDetails({ block: null, entrance: '2', floor: '5', apartment: '12', intercom: null }, labels)).toBe('Giriş 2, Mərtəbə 5, Mənzil 12');
    expect(addressDetails({ block: null, entrance: null, floor: null, apartment: null, intercom: null }, labels)).toBe('');
  });
});

describe('home "Bu gün" tiles', () => {
  it('solo: jobs, earnings, fees', () => {
    expect(todayTiles(proProfile())).toEqual({ jobs: true, earnings: true, fees: true });
  });
  it('company worker of a MANAGER-priced company: no earnings tile (always 0) and no fees', () => {
    const p = proProfile({ kind: 'COMPANY_WORKER', company: { id: 'c', name: 'FixPro MMC', finalPriceEntry: 'MANAGER' }, wallet: null });
    expect(todayTiles(p)).toEqual({ jobs: true, earnings: false, fees: false });
  });
  it('company worker of a WORKER-priced company keeps the earnings tile', () => {
    const p = proProfile({ kind: 'COMPANY_WORKER', company: { id: 'c', name: 'FixPro MMC', finalPriceEntry: 'WORKER' }, wallet: null });
    expect(todayTiles(p)).toEqual({ jobs: true, earnings: true, fees: false });
  });
});
