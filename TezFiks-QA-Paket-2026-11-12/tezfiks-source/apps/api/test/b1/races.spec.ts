import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@tezfiks/shared';
import { createTestApp, type TestApp } from '../helpers/app';
import { BAKU, createCompany, createCustomer, createSoloHandyman } from '../helpers/factories';
import { OffersService } from '../../src/modules/requests/offers.service';
import { EligibilityService } from '../../src/modules/requests/dispatch/eligibility.service';
import { MeService } from '../../src/modules/users/me.service';
import { advance, cancellations, createRequest, dispatch, expectLedgerSound, goOnline, offersOf, pointInRing, setSettings } from './helpers';

const center = BAKU.center;
const ROUNDS = 5;

/** Every concurrent loser must fail with a domain error, never a 500 (deadlock / write conflict). */
function expectDomainRejections(results: PromiseSettledResult<unknown>[], allowed: string[]): void {
  for (const r of results) {
    if (r.status === 'rejected') {
      const reason = r.reason as { code?: string; status?: number; message?: string };
      expect(reason.status, `unexpected failure: ${reason.code} ${reason.message}`).not.toBe(500);
      expect(allowed).toContain(reason.code);
    }
  }
}

describe('B1 concurrency: accepts on the last slots, cancel/search end racing accept, offers sent during a race', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await setSettings(t, { minCandidates: 0 });
  });

  async function soloOnline(balance = 2000, at = center) {
    const h = await createSoloHandyman(t, { balance });
    await goOnline(t, h.handymanId, at);
    return h;
  }

  async function offerFor(requestId: string, handymanId: string) {
    return t.prisma.offer.findFirstOrThrow({ where: { requestId, handymanId } });
  }

  it('two solo accepts filling the last two slots at once: the request is ASSIGNED, the search stops and the other offers close (TAKEN)', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await t.reset();
      await setSettings(t, { minCandidates: 0 });
      const c = await createCustomer(t);
      const [a, b, third] = [await soloOnline(), await soloOnline(), await soloOnline()];
      const req = await createRequest(t, c, { slots: 2 });
      const [oa, ob, oc] = [await offerFor(req.id, a.handymanId), await offerFor(req.id, b.handymanId), await offerFor(req.id, third.handymanId)];
      const results = await Promise.allSettled([
        t.client(a.token).call(api.pro.acceptOffer, { params: { id: oa.id } }),
        t.client(b.token).call(api.pro.acceptOffer, { params: { id: ob.id } }),
      ]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id }, include: { slots: true } });
      expect(r).toMatchObject({ status: 'ASSIGNED', isSearching: false });
      expect(r.slots.map((s) => s.status).sort()).toEqual(['FILLED', 'FILLED']);
      expect(await t.prisma.offer.findUniqueOrThrow({ where: { id: oc.id } })).toMatchObject({ status: 'CLOSED', closeReason: 'TAKEN' });
      expect((await t.client(third.token).call(api.pro.offers)).items).toEqual([]);
      expect(t.jobs.pending('dispatch.step')).toHaveLength(0);
      expect(t.jobs.pending('dispatch.end')).toHaveLength(0);
      expect(await t.prisma.hold.count({ where: { kind: 'REQUEST_FEE', status: 'ACTIVE' } })).toBe(2);
      await expectLedgerSound(t);
    }
  });

  it('a solo accept and a company accept filling the last two slots at once also stop the search', async () => {
    for (let round = 0; round < 3; round++) {
      await t.reset();
      await setSettings(t, { minCandidates: 0 });
      const c = await createCustomer(t);
      const solo = await soloOnline();
      const third = await soloOnline();
      const co = await createCompany(t, { trades: ['plumbing'], workers: 1, balance: 5000 });
      await goOnline(t, co.workers[0]!.handymanId, center);
      const req = await createRequest(t, c, { slots: 2 });
      const soloOffer = await offerFor(req.id, solo.handymanId);
      const coOffer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, companyId: co.companyId } });
      const thirdOffer = await offerFor(req.id, third.handymanId);
      const results = await Promise.allSettled([
        t.client(solo.token).call(api.pro.acceptOffer, { params: { id: soloOffer.id } }),
        t.client(co.manager.token).call(api.company.acceptOffer, {
          params: { companyId: co.companyId, offerId: coOffer.id },
          body: { workerIds: [co.workers[0]!.handymanId] },
        }),
      ]);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
      expect(await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'ASSIGNED', isSearching: false });
      expect(await t.prisma.offer.findUniqueOrThrow({ where: { id: thirdOffer.id } })).toMatchObject({ status: 'CLOSED', closeReason: 'TAKEN' });
      expect(t.jobs.pending('dispatch.end')).toHaveLength(0);
      await expectLedgerSound(t);
    }
  });

  it('whole-request cancel racing an accept (1 slot): no deadlock / 500; the request always ends CANCELLED with nothing active', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await t.reset();
      await setSettings(t, { minCandidates: 0 });
      const c = await createCustomer(t);
      const h = await soloOnline();
      const req = await createRequest(t, c);
      const o = await offerFor(req.id, h.handymanId);
      const results = await Promise.allSettled([
        t.client(c.token).call(api.requests.cancel, { params: { id: req.id }, body: {} }),
        t.client(h.token).call(api.pro.acceptOffer, { params: { id: o.id } }),
      ]);
      expectDomainRejections(results, ['OFFER_UNAVAILABLE']);
      expect(results[0]!.status).toBe('fulfilled');
      const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } });
      expect(r).toMatchObject({ status: 'CANCELLED', isSearching: false, cancelledBy: 'CUSTOMER' });
      expect(await t.prisma.assignment.count({ where: { requestId: req.id, status: { in: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED'] } } })).toBe(0);
      expect(await t.prisma.hold.count({ where: { status: 'ACTIVE' } })).toBe(0);
      expect(await t.prisma.offer.count({ where: { requestId: req.id, status: 'SENT' } })).toBe(0);
      await expectLedgerSound(t);
    }
  });

  it('whole-request cancel racing an accept of the last open slot (2 slots, one already filled): no deadlock / 500', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await t.reset();
      await setSettings(t, { minCandidates: 0 });
      const c = await createCustomer(t);
      const a = await soloOnline();
      const b = await soloOnline();
      const req = await createRequest(t, c, { slots: 2 });
      await t.client(a.token).call(api.pro.acceptOffer, { params: { id: (await offerFor(req.id, a.handymanId)).id } });
      const ob = await offerFor(req.id, b.handymanId);
      const results = await Promise.allSettled([
        t.client(b.token).call(api.pro.acceptOffer, { params: { id: ob.id } }),
        t.client(c.token).call(api.requests.cancel, { params: { id: req.id }, body: {} }),
      ]);
      expectDomainRejections(results, ['OFFER_UNAVAILABLE']);
      expect(results[1]!.status).toBe('fulfilled');
      const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } });
      expect(r).toMatchObject({ status: 'CANCELLED', isSearching: false });
      expect(await t.prisma.assignment.count({ where: { requestId: req.id, status: { in: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED'] } } })).toBe(0);
      expect(await t.prisma.hold.count({ where: { status: 'ACTIVE' } })).toBe(0);
      await expectLedgerSound(t);
    }
  });

  it('search end (dispatch.end) racing an accept: no deadlock / 500; either the accept wins or the request expires', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      await t.reset();
      await setSettings(t, { minCandidates: 0 });
      const c = await createCustomer(t);
      const h = await soloOnline();
      const req = await createRequest(t, c);
      const o = await offerFor(req.id, h.handymanId);
      await t.prisma.serviceRequest.update({ where: { id: req.id }, data: { searchEndsAt: t.clock.now() } });
      const results = await Promise.allSettled([dispatch(t).end(req.id), t.app.get(OffersService).acceptSolo(h.userId, o.id, 'az')]);
      expectDomainRejections(results, ['OFFER_UNAVAILABLE']);
      expect(results[0]!.status).toBe('fulfilled');
      const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id }, include: { slots: true } });
      expect(r.isSearching).toBe(false);
      if (results[1]!.status === 'fulfilled') {
        expect(r.status).toBe('ASSIGNED');
        expect(r.slots.map((s) => s.status)).toEqual(['FILLED']);
      } else {
        expect(r.status).toBe('EXPIRED');
        expect(r.slots.map((s) => s.status)).toEqual(['UNFILLED']);
        expect(await t.prisma.assignment.count({ where: { requestId: req.id } })).toBe(0);
      }
      await expectLedgerSound(t);
    }
  });

  describe('offers are never sent once the request was cancelled or filled during candidate selection', () => {
    /** Runs `during` while the next ring step is selecting candidates (after the step was claimed). */
    async function duringNextStep(requestId: string, during: () => Promise<unknown>) {
      const elig = t.app.get(EligibilityService);
      const original = elig.filterSolos.bind(elig);
      const spy = vi.spyOn(elig, 'filterSolos').mockImplementationOnce(async (...args: Parameters<EligibilityService['filterSolos']>) => {
        await during();
        return original(...args);
      });
      try {
        await dispatch(t).runStep(requestId, 1); // step 1 run directly (the Clock is not moved, presence and offers stay fresh)
      } finally {
        spy.mockRestore();
      }
    }

    it('cancel during selection: the ring-1 pro gets no offer and no OFFER_NEW', async () => {
      const c = await createCustomer(t);
      await soloOnline();
      const ring1 = await soloOnline(2000, pointInRing(center, 1));
      const req = await createRequest(t, c);
      expect((await offersOf(t, req.id)).some((o) => o.handymanId === ring1.handymanId)).toBe(false);
      await duringNextStep(req.id, () => t.client(c.token).call(api.requests.cancel, { params: { id: req.id }, body: {} }));
      expect((await offersOf(t, req.id)).some((o) => o.handymanId === ring1.handymanId)).toBe(false);
      expect(await t.prisma.notification.count({ where: { userId: ring1.userId, type: 'OFFER_NEW' } })).toBe(0);
      expect(await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'CANCELLED' });
    });

    it('last-slot accept during selection: the ring-1 pro gets no offer', async () => {
      const c = await createCustomer(t);
      const a = await soloOnline();
      const ring1 = await soloOnline(2000, pointInRing(center, 1));
      const req = await createRequest(t, c);
      const oa = await offerFor(req.id, a.handymanId);
      await duringNextStep(req.id, () => t.app.get(OffersService).acceptSolo(a.userId, oa.id, 'az'));
      expect((await offersOf(t, req.id)).some((o) => o.handymanId === ring1.handymanId)).toBe(false);
      expect(await t.prisma.notification.count({ where: { userId: ring1.userId, type: 'OFFER_NEW' } })).toBe(0);
      expect(await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'ASSIGNED', isSearching: false });
    });
  });

  it('company accept racing the assigned worker deleting the account: never an assignment for a deleted worker', async () => {
    for (let round = 0; round < 3; round++) {
      await t.reset();
      await setSettings(t, { minCandidates: 0 });
      const c = await createCustomer(t);
      const co = await createCompany(t, { trades: ['plumbing'], workers: 1, balance: 5000 });
      const w = co.workers[0]!;
      await goOnline(t, w.handymanId, center);
      const req = await createRequest(t, c);
      const coOffer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, companyId: co.companyId } });
      const [accepted, deleted] = await Promise.allSettled([
        t.app.get(OffersService).acceptCompany(co.manager.userId, co.companyId, coOffer.id, [w.handymanId], 'az'),
        t.app.get(MeService).deleteAccount(w.userId),
      ]);
      const user = await t.prisma.user.findUniqueOrThrow({ where: { id: w.userId } });
      const count = await t.prisma.assignment.count({ where: { handymanId: w.handymanId } });
      if (user.status === 'DELETED') {
        expect(deleted.status).toBe('fulfilled');
        expect(accepted.status).toBe('rejected');
        expect((accepted as PromiseRejectedResult).reason).toMatchObject({ code: 'WORKER_UNAVAILABLE', details: { reason: 'USER_INACTIVE' } });
        expect(count).toBe(0);
      } else {
        expect(accepted.status).toBe('fulfilled');
        expect(deleted.status).toBe('rejected');
        expect(count).toBe(1);
      }
      await expectLedgerSound(t);
    }
  });
});

describe('B1 request status after assignment cancellations and guarantee re-fix edge cases', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await setSettings(t, { minCandidates: 0 });
  });

  async function acceptedJob(slots = 1) {
    const c = await createCustomer(t);
    const h = await createSoloHandyman(t, { balance: 2000 });
    await goOnline(t, h.handymanId, center);
    const req = await createRequest(t, c, { slots });
    const offer = await t.prisma.offer.findFirstOrThrow({ where: { requestId: req.id, handymanId: h.handymanId } });
    const res = await t.client(h.token).call(api.pro.acceptOffer, { params: { id: offer.id } });
    return { c, h, req, assignmentId: res.assignment.id };
  }

  it('cancelling the last assignment through CancellationService records who cancelled the request and why', async () => {
    const { req, assignmentId } = await acceptedJob();
    await cancellations(t).apply(assignmentId, { actor: 'CUSTOMER', kind: 'CANCEL', reason: 'Plan dəyişdi' });
    expect(await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({
      status: 'CANCELLED',
      cancelledBy: 'CUSTOMER',
      cancelReason: 'Plan dəyişdi',
    });
    expect((await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).cancelledAt).not.toBeNull();
  });

  it('a customer-cancelled slot plus an unfilled slot ends CANCELLED (not EXPIRED)', async () => {
    const { req, assignmentId } = await acceptedJob(2);
    await cancellations(t).apply(assignmentId, { actor: 'CUSTOMER', kind: 'CANCEL' });
    expect(await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id } })).toMatchObject({ status: 'SEARCHING', isSearching: true });
    for (let i = 0; i < 12; i++) await advance(t, 20_000);
    const r = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: req.id }, include: { slots: true } });
    expect(r.slots.map((s) => s.status).sort()).toEqual(['CANCELLED', 'UNFILLED']);
    expect(r).toMatchObject({ status: 'CANCELLED', isSearching: false, cancelledBy: 'CUSTOMER' });
  });

  async function completedJob() {
    const { c, h, req, assignmentId } = await acceptedJob();
    await advance(t, 300_000);
    await t.prisma.assignment.update({ where: { id: assignmentId }, data: { status: 'COMPLETED', completedAt: t.clock.now(), endedAt: t.clock.now() } });
    await t.prisma.requestSlot.updateMany({ where: { requestId: req.id }, data: { status: 'DONE' } });
    await t.prisma.serviceRequest.update({ where: { id: req.id }, data: { status: 'COMPLETED' } });
    return { c, h, req, assignmentId };
  }

  it('guarantee re-fix: when the original pro is no longer eligible, normal rings start at once (no waiting period)', async () => {
    const { h, assignmentId } = await completedJob();
    await t.prisma.user.update({ where: { id: h.userId }, data: { status: 'BLOCKED' } });
    const other = await createSoloHandyman(t, { balance: 0 });
    await goOnline(t, other.handymanId, center);
    const fixId = await dispatch(t).createGuaranteeFixRequest(assignmentId);
    const offers = await offersOf(t, fixId);
    expect(offers.map((o) => [o.handymanId, o.step, o.status])).toEqual([[other.handymanId, 0, 'SENT']]);
    expect(t.jobs.pending('dispatch.scheduledLive')).toHaveLength(0);
    const fix = await t.prisma.serviceRequest.findUniqueOrThrow({ where: { id: fixId } });
    expect(fix.searchStartedAt).not.toBeNull();
    const s = await t.settings.get();
    expect(fix.searchEndsAt!.getTime() - fix.searchStartedAt!.getTime()).toBe(s.noMatchAfterSec * 1000);
  });

  it('guarantee re-fix creation is idempotent per origin assignment (concurrent and repeated calls)', async () => {
    const { h, assignmentId } = await completedJob();
    await goOnline(t, h.handymanId, center);
    const ids = await Promise.all([dispatch(t).createGuaranteeFixRequest(assignmentId), dispatch(t).createGuaranteeFixRequest(assignmentId)]);
    expect(ids[0]).toBe(ids[1]);
    expect(await dispatch(t).createGuaranteeFixRequest(assignmentId)).toBe(ids[0]);
    expect(await t.prisma.serviceRequest.count({ where: { originAssignmentId: assignmentId, isGuaranteeFix: true } })).toBe(1);
    expect(await t.prisma.offer.count({ where: { requestId: ids[0] } })).toBe(1);
    // Once that re-fix ended without a match, a new claim may create a new one.
    await t.prisma.serviceRequest.update({ where: { id: ids[0] }, data: { status: 'EXPIRED', isSearching: false } });
    const next = await dispatch(t).createGuaranteeFixRequest(assignmentId);
    expect(next).not.toBe(ids[0]);
  });
});
