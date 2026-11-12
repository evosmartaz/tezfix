import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { gridDisk, gridRing } from 'h3-js';
import {
  DEFAULT_LOCALE,
  RING_FAST_FORWARD_SEC,
  asLocale,
  formatDateTime,
  formatDistance,
  ringPlan,
  type Locale,
  type OfferCloseReason,
  type PlatformSettings,
} from '@tezfiks/shared';
import { PrismaService, inTx, type Tx } from '../../../infra/prisma.service';
import { Clock } from '../../../infra/clock';
import { JobsService } from '../../../infra/jobs.service';
import { ReconcilerService } from '../../../infra/reconciler.service';
import { RealtimeService } from '../../../infra/realtime.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { ApiException } from '../../../common/http/api-exception';
import { PresenceService, type PresenceEntry } from '../../realtime/presence.service';
import { CategoriesService } from '../../categories/categories.service';
import { WalletEventsService } from '../../wallet/wallet-events.service';
import { RequestViews } from '../views/request-views.service';
import { RequestStateService, lockRequestRow } from '../request-state.service';
import { RequestNotifier } from '../request-notifier';
import { FeesService } from '../fees.service';
import { JOB, RECONCILER_TASK, TERMINAL_REQUEST_STATUSES, jobId } from '../requests.constants';
import { EligibilityService, type Candidate, type DispatchRequest } from './eligibility.service';
import type { Offer, ServiceRequest } from '../../../generated/prisma/client';

/** Offer.step used for offers outside the ring plan. */
export const PRE_OFFER_STEP = -1;
/** Cap for scheduled pre-offers sent at creation. */
export const MAX_SCHEDULED_PRE_OFFERS = 50;

export interface ClosedOffer {
  offerId: string;
  requestId: string;
  handymanUserId: string | null;
  companyId: string | null;
  reason: OfferCloseReason;
}

/**
 * H3 ring dispatch (spec 5). Each step offers only the new ring (step 0 = centre cell; emergency step 0 = k<=1 disk; the
 * final wide step = ring 5 plus providers whose service area covers the request cell), sorted by distance and capped at
 * maxOffersPerStep. Steps follow ringPlan(); while fewer than minCandidates providers were offered the next step comes
 * after RING_FAST_FORWARD_SEC. Postgres holds every deadline; jobs are the timers and `dispatch.repair` the safety net.
 * Exported: start, reopenSlot, stop, createGuaranteeFixRequest.
 */
@Injectable()
export class DispatchService implements OnModuleInit {
  private readonly log = new Logger('Dispatch');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    private readonly reconciler: ReconcilerService,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    private readonly presence: PresenceService,
    private readonly categories: CategoriesService,
    private readonly walletEvents: WalletEventsService,
    private readonly views: RequestViews,
    private readonly state: RequestStateService,
    private readonly notifier: RequestNotifier,
    private readonly fees: FeesService,
    private readonly eligibility: EligibilityService,
  ) {}

  onModuleInit(): void {
    this.jobs.register(JOB.dispatchStep, (d: { requestId: string; step: number }) =>
      this.runStep(d.requestId, d.step),
    );
    this.jobs.register(JOB.dispatchEnd, (d: { requestId: string }) => this.end(d.requestId));
    this.jobs.register(JOB.offerExpire, (d: { offerId: string }) => this.expireOffer(d.offerId));
    this.jobs.register(JOB.scheduledLive, (d: { requestId: string }) => this.startLive(d.requestId));
    this.jobs.register(JOB.scheduledUnfilled, (d: { requestId: string }) => this.end(d.requestId));
    this.jobs.register(JOB.scheduledReminder, (d: { requestId: string; kind: '24h' | '1h' }) =>
      this.remind(d.requestId, d.kind),
    );
    this.reconciler.register(RECONCILER_TASK.dispatch, async () => {
      await this.repair();
    });
  }

  private static dispatchRequest(r: ServiceRequest): DispatchRequest {
    return {
      id: r.id,
      categoryId: r.categoryId,
      lat: r.lat,
      lng: r.lng,
      cell7: r.cell7,
      providerPreference: r.providerPreference,
      isGuaranteeFix: r.isGuaranteeFix,
      createdByUserId: r.createdByUserId,
      timing: r.timing,
      scheduledAt: r.scheduledAt,
    };
  }

  // ------------------------------------------------------------------ start

  /** Starts dispatch for a freshly created request (NOW / EMERGENCY rings, SCHEDULED pre-offers, guarantee preferred offer). */
  async start(requestId: string): Promise<void> {
    const r = await this.prisma.serviceRequest.findUnique({ where: { id: requestId } });
    if (!r || !r.isSearching) return;
    const s = await this.settings.get();
    const now = this.clock.now();
    if (r.timing === 'SCHEDULED' && r.scheduledAt) {
      await this.startScheduled(r, s, now);
      return;
    }
    // Guarantee re-fix: the original provider first, unless it is no longer eligible (then normal rings start at once).
    const preferred =
      r.isGuaranteeFix &&
      (r.preferredHandymanId || r.preferredCompanyId) &&
      s.guaranteeOriginalProviderMin > 0
        ? await this.preferredCandidates(r)
        : [];
    if (preferred.length) {
      const liveAt = new Date(now.getTime() + s.guaranteeOriginalProviderMin * 60_000);
      const endsAt = new Date(liveAt.getTime() + s.noMatchAfterSec * 1000);
      await this.prisma.serviceRequest.update({
        where: { id: r.id },
        data: { liveDispatchAt: liveAt, searchEndsAt: endsAt },
      });
      await this.jobs.schedule(
        JOB.dispatchEnd,
        { requestId: r.id },
        { at: endsAt, jobId: jobId.dispatchEnd(r.id) },
      );
      await this.jobs.schedule(
        JOB.scheduledLive,
        { requestId: r.id },
        { at: liveAt, jobId: jobId.scheduledLive(r.id) },
      );
      await this.sendOffers(r, preferred, PRE_OFFER_STEP, 0, liveAt, now);
      return;
    }
    const endsAt = new Date(now.getTime() + s.noMatchAfterSec * 1000);
    await this.prisma.serviceRequest.update({ where: { id: r.id }, data: { searchEndsAt: endsAt } });
    await this.jobs.schedule(
      JOB.dispatchEnd,
      { requestId: r.id },
      { at: endsAt, jobId: jobId.dispatchEnd(r.id) },
    );
    await this.startLive(r.id, now);
  }

  /** Scheduled request: reminders, the unfilled deadline, pre-offers to providers covering the cell, then live rings at liveDispatchAt. */
  private async startScheduled(r: ServiceRequest, s: PlatformSettings, now: Date): Promise<void> {
    const scheduledAt = r.scheduledAt!;
    const liveAt = new Date(scheduledAt.getTime() - s.scheduledLiveDispatchLeadMin * 60_000);
    const endsAt = new Date(scheduledAt.getTime() - s.scheduledUnfilledLeadMin * 60_000);
    await this.prisma.serviceRequest.update({
      where: { id: r.id },
      data: { liveDispatchAt: liveAt, searchEndsAt: endsAt },
    });
    await this.jobs.schedule(
      JOB.scheduledUnfilled,
      { requestId: r.id },
      { at: endsAt, jobId: jobId.scheduledUnfilled(r.id) },
    );
    for (const [kind, ms] of [
      ['24h', 24 * 3600_000],
      ['1h', 3600_000],
    ] as const) {
      const at = new Date(scheduledAt.getTime() - ms);
      if (at.getTime() > now.getTime()) {
        await this.jobs.schedule(
          JOB.scheduledReminder,
          { requestId: r.id, kind },
          { at, jobId: jobId.scheduledReminder(r.id, kind) },
        );
      }
    }
    if (liveAt.getTime() <= now.getTime()) {
      await this.startLive(r.id);
      return;
    }
    await this.jobs.schedule(
      JOB.scheduledLive,
      { requestId: r.id },
      { at: liveAt, jobId: jobId.scheduledLive(r.id) },
    );
    const req = DispatchService.dispatchRequest(r);
    const fee = r.isGuaranteeFix ? 0 : s.requestFee;
    const handymen = await this.prisma.handymanServiceCell.findMany({
      where: { cell7: r.cell7 },
      select: { handymanId: true },
    });
    const profiles = handymen.length
      ? await this.prisma.handymanProfile.findMany({
          where: { id: { in: handymen.map((h) => h.handymanId) } },
          select: { id: true, companyId: true, baseLat: true, baseLng: true },
        })
      : [];
    const solos = await this.eligibility.filterSolos(
      req,
      profiles.map((p) => ({ handymanId: p.id, companyId: p.companyId, lat: p.baseLat, lng: p.baseLng })),
      { checkRadius: false, checkBusy: false, scheduledAt, fee },
    );
    const companyCells = await this.prisma.companyServiceCell.findMany({
      where: { cell7: r.cell7 },
      select: { companyId: true },
    });
    const companies = await this.eligibility.filterCompanies(
      req,
      companyCells.map((c) => c.companyId),
      null,
      { checkBusy: false, scheduledAt, fee },
    );
    const cands = this.rank([...solos, ...companies]).slice(0, MAX_SCHEDULED_PRE_OFFERS);
    await this.sendOffers(r, cands, PRE_OFFER_STEP, -1, liveAt, now);
  }

  /** Guarantee re-fix: the original provider when still eligible (gets a single offer, valid until the normal rings start). */
  private async preferredCandidates(r: ServiceRequest): Promise<Candidate[]> {
    const req = DispatchService.dispatchRequest(r);
    const cands: Candidate[] = [];
    if (r.preferredCompanyId) {
      const companies = await this.eligibility.filterCompanies(req, [r.preferredCompanyId], null, {
        checkBusy: false,
        scheduledAt: null,
        fee: 0,
      });
      cands.push(...companies);
    } else if (r.preferredHandymanId) {
      const p = await this.prisma.handymanProfile.findUnique({
        where: { id: r.preferredHandymanId },
        select: { id: true, companyId: true, lastLat: true, lastLng: true, baseLat: true, baseLng: true },
      });
      if (p) {
        const solos = await this.eligibility.filterSolos(
          req,
          [
            {
              handymanId: p.id,
              companyId: p.companyId,
              lat: p.lastLat ?? p.baseLat,
              lng: p.lastLng ?? p.baseLng,
            },
          ],
          { checkRadius: false, checkBusy: false, scheduledAt: null, fee: 0 },
        );
        cands.push(...solos);
      }
    }
    return cands;
  }

  /** Starts the live ring plan (step 0) unless it already started. */
  async startLive(requestId: string, startAt?: Date): Promise<void> {
    const now = startAt ?? this.clock.now();
    const s = await this.settings.get();
    const r = await this.prisma.serviceRequest.findUnique({ where: { id: requestId } });
    if (!r || !r.isSearching || r.dispatchStep >= 0) return;
    if ((TERMINAL_REQUEST_STATUSES as readonly string[]).includes(r.status)) return;
    const endsAt = r.searchEndsAt ?? new Date(now.getTime() + s.noMatchAfterSec * 1000);
    if (endsAt.getTime() <= now.getTime()) {
      await this.end(requestId);
      return;
    }
    const res = await this.prisma.serviceRequest.updateMany({
      where: { id: requestId, isSearching: true, dispatchStep: -1 },
      data: { searchStartedAt: now, searchEndsAt: endsAt },
    });
    if (res.count === 0) return;
    if (!r.searchEndsAt)
      await this.jobs.schedule(
        JOB.dispatchEnd,
        { requestId },
        { at: endsAt, jobId: jobId.dispatchEnd(requestId) },
      );
    await this.runStep(requestId, 0);
  }

  // ------------------------------------------------------------------- steps

  private stepCells(r: ServiceRequest, step: number, s: PlatformSettings) {
    const plan = ringPlan(r.timing === 'EMERGENCY' ? 'EMERGENCY' : 'NOW', s);
    const p = plan[step]!;
    const emergencyFirst = r.timing === 'EMERGENCY' && step === 0;
    const newCells = emergencyFirst
      ? gridDisk(r.cell7, 1)
      : p.ring === 0
        ? [r.cell7]
        : gridRing(r.cell7, p.ring);
    return { plan, p, newCells, disk: gridDisk(r.cell7, p.ring) };
  }

  /** Runs ring step `step` (idempotent: a step runs once; later calls for older steps do nothing). */
  async runStep(requestId: string, step: number): Promise<void> {
    const s = await this.settings.get();
    const now = this.clock.now();
    const r = await this.prisma.serviceRequest.findUnique({ where: { id: requestId } });
    if (!r || !r.isSearching || step < 0 || r.dispatchStep >= step || !r.searchStartedAt) return;
    if ((TERMINAL_REQUEST_STATUSES as readonly string[]).includes(r.status)) return;
    if (r.searchEndsAt && r.searchEndsAt.getTime() <= now.getTime()) {
      await this.end(requestId);
      return;
    }
    const plan = ringPlan(r.timing === 'EMERGENCY' ? 'EMERGENCY' : 'NOW', s);
    if (step >= plan.length) return;
    const open = await this.prisma.requestSlot.count({ where: { requestId, status: 'OPEN' } });
    if (!open) return;
    const claimed = await this.prisma.serviceRequest.updateMany({
      where: { id: requestId, isSearching: true, dispatchStep: { lt: step } },
      data: { dispatchStep: step },
    });
    if (claimed.count === 0) return;
    r.dispatchStep = step;

    const { p, newCells, disk } = this.stepCells(r, step, s);
    const req = DispatchService.dispatchRequest(r);
    const fee = r.isGuaranteeFix ? 0 : s.requestFee;
    const entries = await this.presence.candidatesInCells(disk, s.onlineStaleSec);
    const ring = new Set(newCells);
    const soloEntries = entries.filter((e) => !e.companyId && ring.has(EligibilityService.cellOf(e)));
    const workerEntries: PresenceEntry[] = entries.filter((e) => !!e.companyId);
    const cands: Candidate[] = [];
    cands.push(
      ...(await this.eligibility.filterSolos(req, soloEntries, {
        checkRadius: true,
        checkBusy: true,
        scheduledAt: r.scheduledAt,
        fee,
      })),
    );
    if (p.wide) {
      const covering = await this.prisma.handymanServiceCell.findMany({
        where: { cell7: r.cell7 },
        select: { handymanId: true },
      });
      // BUG-004: only providers already evaluated in THIS step are skipped. Solo providers that are online inside the
      // disk but outside the new ring (e.g. they went online after an inner step ran) were never evaluated, so the
      // service-area pass must still consider them. Providers offered earlier are skipped by sendOffers.
      const known = new Set([...soloEntries, ...workerEntries].map((e) => e.handymanId));
      const area = (
        await this.eligibility.freshPresence(covering.map((c) => c.handymanId).filter((id) => !known.has(id)))
      ).filter((e) => !e.companyId);
      cands.push(
        ...(await this.eligibility.filterSolos(req, area, {
          checkRadius: false,
          checkBusy: true,
          scheduledAt: r.scheduledAt,
          fee,
        })),
      );
      const companyCells = await this.prisma.companyServiceCell.findMany({
        where: { cell7: r.cell7 },
        select: { companyId: true },
      });
      if (companyCells.length) {
        const workers = await this.prisma.handymanProfile.findMany({
          where: { companyId: { in: companyCells.map((c) => c.companyId) }, kind: 'COMPANY_WORKER' },
          select: { id: true },
        });
        const extra = await this.eligibility.freshPresence(
          workers.map((w) => w.id).filter((id) => !known.has(id)),
        );
        workerEntries.push(...extra.filter((e) => !!e.companyId));
      }
    }
    const companyIds = [...new Set(workerEntries.map((e) => e.companyId!))];
    cands.push(
      ...(await this.eligibility.filterCompanies(req, companyIds, workerEntries, {
        checkBusy: true,
        scheduledAt: r.scheduledAt,
        fee,
      })),
    );
    const chosen = this.rank(cands).slice(0, s.maxOffersPerStep);
    const expiresAt = new Date(now.getTime() + s.offerTtlSec * 1000);
    await this.sendOffers(r, chosen, step, p.ring, expiresAt, now);

    const offersSent = await this.prisma.offer.count({ where: { requestId } });
    const search = this.views.searchState(r, offersSent, s);
    if (search) {
      const payload = { requestId, ...search };
      this.realtime.toRequest(requestId, 'request:search', payload);
      const owner = await this.customerUserId(requestId);
      if (owner) this.realtime.toUser(owner, 'request:search', payload);
    }

    if (step + 1 < plan.length) {
      const natural = r.searchStartedAt.getTime() + plan[step + 1]!.atSec * 1000;
      const at =
        offersSent < s.minCandidates
          ? Math.min(natural, now.getTime() + RING_FAST_FORWARD_SEC * 1000)
          : natural;
      if (!r.searchEndsAt || at < r.searchEndsAt.getTime()) {
        await this.jobs.schedule(
          JOB.dispatchStep,
          { requestId, step: step + 1 },
          { at: new Date(at), jobId: jobId.dispatchStep(requestId) },
        );
      }
    }
  }

  /** Distance ascending (unknown distances last), solo before company on ties. */
  private rank(cands: Candidate[]): Candidate[] {
    return [...cands].sort(
      (a, b) =>
        (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) ||
        (a.kind === b.kind ? 0 : a.kind === 'SOLO' ? -1 : 1),
    );
  }

  private async customerUserId(requestId: string): Promise<string | null> {
    const r = await this.prisma.serviceRequest.findUnique({
      where: { id: requestId },
      select: { customerAccount: { select: { ownerUserId: true } } },
    });
    return r?.customerAccount.ownerUserId ?? null;
  }

  /**
   * Creates SENT offers (skipping providers offered before), schedules their expiry and notifies the targets. The offers
   * are created under the request row lock and only while the request is still searching with an OPEN slot, so a cancel
   * or a last-slot accept that commits during candidate selection never gets fresh offers afterwards.
   */
  private async sendOffers(
    r: ServiceRequest,
    cands: Candidate[],
    step: number,
    ring: number,
    expiresAt: Date,
    sentAt?: Date,
  ): Promise<Offer[]> {
    const now = sentAt ?? this.clock.now();
    if (!cands.length) return [];
    const created = await inTx(this.prisma, async (tx) => {
      await lockRequestRow(tx, r.id);
      const cur = await tx.serviceRequest.findUnique({
        where: { id: r.id },
        select: { isSearching: true, status: true },
      });
      if (!cur || !cur.isSearching || (TERMINAL_REQUEST_STATUSES as readonly string[]).includes(cur.status))
        return [];
      if (!(await tx.requestSlot.count({ where: { requestId: r.id, status: 'OPEN' } }))) return [];
      // Offers of a request are only created here, under the request lock: the pre-check is exact (no unique violations).
      const prior = await tx.offer.findMany({
        where: { requestId: r.id },
        select: { handymanId: true, companyId: true },
      });
      const offeredHandymen = new Set(prior.map((o) => o.handymanId).filter(Boolean));
      const offeredCompanies = new Set(prior.map((o) => o.companyId).filter(Boolean));
      const out: Offer[] = [];
      for (const c of cands) {
        if (c.kind === 'SOLO' ? offeredHandymen.has(c.handymanId) : offeredCompanies.has(c.companyId))
          continue;
        if (c.kind === 'SOLO') offeredHandymen.add(c.handymanId);
        else offeredCompanies.add(c.companyId);
        const offer = await tx.offer.create({
          data: {
            requestId: r.id,
            targetType: c.kind === 'SOLO' ? 'HANDYMAN' : 'COMPANY',
            handymanId: c.kind === 'SOLO' ? c.handymanId : null,
            companyId: c.kind === 'COMPANY' ? c.companyId : null,
            step,
            ring,
            status: 'SENT',
            sentAt: now,
            expiresAt,
            distanceM: c.distanceM,
            candidateWorkers: c.kind === 'COMPANY' ? (c.workerIds as never) : undefined,
          },
        });
        out.push(offer);
      }
      return out;
    });
    for (const o of created) {
      await this.jobs.schedule(
        JOB.offerExpire,
        { offerId: o.id },
        { at: o.expiresAt, jobId: jobId.offerExpire(o.id) },
      );
      await this.announceOffer(o, r);
    }
    return created;
  }

  /** offer:new (socket) + OFFER_NEW push to the solo handyman or to every active manager of the company. */
  private async announceOffer(o: Offer, r: ServiceRequest): Promise<void> {
    try {
      const category = await this.categories.get(r.categoryId);
      const ttlSec = Math.max(1, Math.round((o.expiresAt.getTime() - this.clock.nowMs()) / 1000));
      const data = { offerId: o.id, requestId: r.id, expiresAt: o.expiresAt.toISOString() };
      const vars = (l: Locale) => ({
        category: this.categories.name(category, l),
        number: r.number,
        distance: o.distanceM != null ? formatDistance(o.distanceM, l) : '',
      });
      const opts = {
        app: 'PRO' as const,
        priority: 'high' as const,
        ttlSec,
        collapseKey: 'offer',
        channelId: 'offers_v1' as const,
        data,
      };
      if (o.targetType === 'HANDYMAN' && o.handymanId) {
        const h = await this.prisma.handymanProfile.findUnique({
          where: { id: o.handymanId },
          select: { userId: true, user: { select: { locale: true } } },
        });
        if (!h) return;
        this.realtime.toUser(h.userId, 'offer:new', await this.views.toOfferView(o, asLocale(h.user.locale)));
        await this.notifier.send([h.userId], 'OFFER_NEW', vars, opts);
      } else if (o.companyId) {
        this.realtime.toCompany(o.companyId, 'offer:new', await this.views.toOfferView(o, DEFAULT_LOCALE));
        const managers = await this.companyManagers(o.companyId);
        await this.notifier.send(managers, 'OFFER_NEW', vars, opts);
      }
    } catch (err) {
      this.log.warn(`announce offer ${o.id} failed: ${(err as Error).message}`);
    }
  }

  async companyManagers(companyId: string): Promise<string[]> {
    const rows = await this.prisma.companyMember.findMany({
      where: { companyId, role: 'MANAGER', status: 'ACTIVE', user: { status: 'ACTIVE' } },
      select: { userId: true },
    });
    return rows.map((m) => m.userId);
  }

  // ------------------------------------------------------- closing / ending

  /** Closes every SENT offer of a request inside `tx`; returns what to announce after commit. */
  async closeSentOffers(
    requestId: string,
    reason: OfferCloseReason,
    tx: Tx,
    exceptOfferId?: string,
  ): Promise<ClosedOffer[]> {
    const offers = await tx.offer.findMany({
      where: { requestId, status: 'SENT', ...(exceptOfferId ? { id: { not: exceptOfferId } } : {}) },
      select: { id: true, handymanId: true, companyId: true, handyman: { select: { userId: true } } },
    });
    if (!offers.length) return [];
    const now = this.clock.now();
    await tx.offer.updateMany({
      where: { id: { in: offers.map((o) => o.id) }, status: 'SENT' },
      data: { status: 'CLOSED', closeReason: reason, respondedAt: now },
    });
    return offers.map((o) => ({
      offerId: o.id,
      requestId,
      handymanUserId: o.handyman?.userId ?? null,
      companyId: o.companyId,
      reason,
    }));
  }

  /** offer:closed to the targets of closed offers and removal of their expiry jobs. */
  async announceClosed(closed: ClosedOffer[]): Promise<void> {
    for (const c of closed) {
      const payload = { offerId: c.offerId, requestId: c.requestId, reason: c.reason };
      if (c.handymanUserId) this.realtime.toUser(c.handymanUserId, 'offer:closed', payload);
      if (c.companyId) this.realtime.toCompany(c.companyId, 'offer:closed', payload);
      await this.jobs.cancel(jobId.offerExpire(c.offerId));
    }
  }

  /** Cancels the pending timers of a request's search. */
  async cancelSearchJobs(requestId: string): Promise<void> {
    await this.jobs.cancel(jobId.dispatchStep(requestId));
    await this.jobs.cancel(jobId.dispatchEnd(requestId));
    await this.jobs.cancel(jobId.scheduledLive(requestId));
    await this.jobs.cancel(jobId.scheduledUnfilled(requestId));
  }

  /** Stops the search: closes SENT offers with `reason`, isSearching=false, timers cancelled. Open slots stay as they are. */
  async stop(requestId: string, reason: OfferCloseReason): Promise<void> {
    const closed = await inTx(this.prisma, async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM service_requests WHERE id = $1::uuid FOR UPDATE', requestId);
      const c = await this.closeSentOffers(requestId, reason, tx);
      await tx.serviceRequest.update({ where: { id: requestId }, data: { isSearching: false } });
      return c;
    });
    await this.cancelSearchJobs(requestId);
    await this.announceClosed(closed);
  }

  /**
   * Search end (`dispatch.end` at searchEndsAt, `dispatch.scheduledUnfilled` for scheduled requests): closes SENT offers
   * (SEARCH_ENDED), OPEN slots become UNFILLED and give back their emergency fee, the request becomes EXPIRED when
   * nothing was filled (otherwise only isSearching=false); notifies REQUEST_EXPIRED / SCHEDULED_UNFILLED.
   */
  async end(requestId: string): Promise<void> {
    const now = this.clock.now();
    const r = await this.prisma.serviceRequest.findUnique({ where: { id: requestId } });
    if (!r || !r.isSearching) return;
    if (r.searchEndsAt && r.searchEndsAt.getTime() > now.getTime() + 1000) return;
    const out = await inTx(this.prisma, async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM service_requests WHERE id = $1::uuid FOR UPDATE', requestId);
      const cur = await tx.serviceRequest.findUnique({ where: { id: requestId } });
      if (!cur?.isSearching) return null;
      const closed = await this.closeSentOffers(requestId, 'SEARCH_ENDED', tx);
      const open = await tx.requestSlot.findMany({
        where: { requestId, status: 'OPEN' },
        select: { id: true },
      });
      const accounts: string[] = [];
      for (const slot of open) {
        await tx.requestSlot.update({ where: { id: slot.id }, data: { status: 'UNFILLED' } });
        const acc = await this.fees.releaseOrRefundEmergency(slot.id, cur.number, tx);
        if (acc) accounts.push(acc);
      }
      await tx.serviceRequest.update({ where: { id: requestId }, data: { isSearching: false } });
      const st = await this.state.recompute(requestId, tx);
      return {
        closed,
        unfilled: open.length,
        accounts,
        status: st.after,
        number: cur.number,
        timing: cur.timing,
        scheduledAt: cur.scheduledAt,
      };
    });
    if (!out) return;
    await this.cancelSearchJobs(requestId);
    await this.announceClosed(out.closed);
    await this.walletEvents.notifyAccounts(out.accounts);
    await this.state.announce(requestId);
    const owner = await this.customerUserId(requestId);
    if (out.timing === 'SCHEDULED' && out.unfilled > 0) {
      await this.notifier.send(
        [owner],
        'SCHEDULED_UNFILLED',
        () => ({ number: out.number, date: out.scheduledAt ? formatDateTime(out.scheduledAt) : '' }),
        {
          app: 'CUSTOMER',
          data: { requestId },
        },
      );
    } else if (out.status === 'EXPIRED') {
      await this.notifier.send([owner], 'REQUEST_EXPIRED', () => ({ number: out.number }), {
        app: 'CUSTOMER',
        data: { requestId },
      });
    }
  }

  /** `offer.expire`: SENT offer past expiresAt -> EXPIRED + offer:closed. */
  async expireOffer(offerId: string): Promise<void> {
    const now = this.clock.now();
    const o = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: { handyman: { select: { userId: true } } },
    });
    if (!o || o.status !== 'SENT' || o.expiresAt.getTime() > now.getTime() + 1000) return;
    const res = await this.prisma.offer.updateMany({
      where: { id: offerId, status: 'SENT' },
      data: { status: 'EXPIRED', closeReason: 'EXPIRED' },
    });
    if (res.count === 0) return;
    const payload = { offerId, requestId: o.requestId, reason: 'EXPIRED' as const };
    if (o.handyman) this.realtime.toUser(o.handyman.userId, 'offer:closed', payload);
    if (o.companyId) this.realtime.toCompany(o.companyId, 'offer:closed', payload);
  }

  // ------------------------------------------------------------ re-dispatch

  /**
   * A slot went back to OPEN (provider cancel / no-show): when the request is no longer searching, the search restarts
   * from step 0 for its open slots. Providers offered before (including the previous one) are never offered again.
   */
  async reopenSlot(slotId: string): Promise<void> {
    const slot = await this.prisma.requestSlot.findUnique({
      where: { id: slotId },
      include: { request: true },
    });
    if (!slot || slot.status !== 'OPEN') return;
    const r = slot.request;
    if ((TERMINAL_REQUEST_STATUSES as readonly string[]).includes(r.status) || r.isSearching) return;
    const s = await this.settings.get();
    const now = this.clock.now();
    let endsAt = new Date(now.getTime() + s.noMatchAfterSec * 1000);
    if (r.timing === 'SCHEDULED' && r.scheduledAt) {
      const scheduledEnd = r.scheduledAt.getTime() - s.scheduledUnfilledLeadMin * 60_000;
      if (scheduledEnd > endsAt.getTime()) endsAt = new Date(scheduledEnd);
    }
    const res = await this.prisma.serviceRequest.updateMany({
      where: { id: r.id, isSearching: false, status: { notIn: [...TERMINAL_REQUEST_STATUSES] } },
      data: {
        isSearching: true,
        dispatchStep: -1,
        searchStartedAt: null,
        searchEndsAt: endsAt,
        liveDispatchAt: null,
      },
    });
    if (res.count === 0) return;
    await this.state.recompute(r.id);
    await this.jobs.schedule(
      r.timing === 'SCHEDULED' ? JOB.scheduledUnfilled : JOB.dispatchEnd,
      { requestId: r.id },
      {
        at: endsAt,
        jobId: r.timing === 'SCHEDULED' ? jobId.scheduledUnfilled(r.id) : jobId.dispatchEnd(r.id),
      },
    );
    await this.startLive(r.id, now);
    await this.state.announce(r.id);
  }

  /**
   * Guarantee re-fix (lane B3): a new fee-free NOW request with the same category, address, description and photos,
   * offered first to the original provider (handyman or company) for guaranteeOriginalProviderMin, then normal rings.
   */
  async createGuaranteeFixRequest(originAssignmentId: string): Promise<string> {
    const out = await inTx(this.prisma, async (tx) => {
      // Idempotent per origin assignment (double click, retried job): the origin row lock serializes concurrent calls, and
      // an existing re-fix that is not CANCELLED/EXPIRED is returned instead of creating a second one.
      await tx.$queryRawUnsafe(
        'SELECT id FROM assignments WHERE id = $1::uuid FOR UPDATE',
        originAssignmentId,
      );
      const a = await tx.assignment.findUnique({
        where: { id: originAssignmentId },
        include: { request: true },
      });
      if (!a) throw new ApiException('NOT_FOUND', { entity: 'assignment', id: originAssignmentId });
      const existing = await tx.serviceRequest.findFirst({
        where: {
          originAssignmentId: a.id,
          isGuaranteeFix: true,
          status: { notIn: ['CANCELLED', 'EXPIRED'] },
        },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) return { id: existing.id, created: false };
      const o = a.request;
      const created = await tx.serviceRequest.create({
        data: {
          customerAccountId: o.customerAccountId,
          createdByUserId: o.createdByUserId,
          categoryId: o.categoryId,
          vertical: o.vertical,
          description: o.description,
          timing: 'NOW',
          slotsRequested: 1,
          providerPreference: 'ANY',
          lat: o.lat,
          lng: o.lng,
          cell7: o.cell7,
          cell9: o.cell9,
          formatted: o.formatted,
          placeId: o.placeId,
          district: o.district,
          street: o.street,
          building: o.building,
          block: o.block,
          entrance: o.entrance,
          floor: o.floor,
          apartment: o.apartment,
          intercom: o.intercom,
          note: o.note,
          photoFileIds: o.photoFileIds,
          isGuaranteeFix: true,
          originAssignmentId: a.id,
          preferredHandymanId: a.providerType === 'SOLO' ? a.handymanId : null,
          preferredCompanyId: a.providerType === 'COMPANY' ? a.companyId : null,
          isDemo: o.isDemo,
          createdAt: this.clock.now(),
          slots: { create: [{ index: 0 }] },
        },
      });
      return { id: created.id, created: true };
    });
    if (!out.created) return out.id;
    await this.start(out.id);
    await this.state.announce(out.id);
    return out.id;
  }

  // ------------------------------------------------------------- reminders

  async remind(requestId: string, _kind: '24h' | '1h'): Promise<void> {
    const r = await this.prisma.serviceRequest.findUnique({
      where: { id: requestId },
      include: {
        customerAccount: { select: { ownerUserId: true } },
        assignments: { include: { handyman: { select: { userId: true } } } },
      },
    });
    if (!r || !r.scheduledAt || (TERMINAL_REQUEST_STATUSES as readonly string[]).includes(r.status)) return;
    if (r.scheduledAt.getTime() <= this.clock.nowMs()) return;
    const vars = () => ({ number: r.number, date: formatDateTime(r.scheduledAt!) });
    await this.notifier.send([r.customerAccount.ownerUserId], 'SCHEDULED_REMINDER', vars, {
      app: 'CUSTOMER',
      data: { requestId },
    });
    const providers = r.assignments
      .filter((a) => ['ACCEPTED', 'EN_ROUTE', 'ARRIVED'].includes(a.status))
      .map((a) => a.handyman.userId);
    await this.notifier.send(providers, 'SCHEDULED_REMINDER', vars, { app: 'PRO', data: { requestId } });
  }

  // ---------------------------------------------------------------- repair

  /** Reconciler `dispatch.repair`: expires overdue offers, ends overdue searches, starts overdue live dispatch and runs overdue steps. */
  async repair(): Promise<void> {
    const now = this.clock.now();
    const s = await this.settings.get();
    const offers = await this.prisma.offer.findMany({
      where: { status: 'SENT', expiresAt: { lt: now } },
      select: { id: true },
      take: 500,
    });
    for (const o of offers) await this.expireOffer(o.id);
    const ended = await this.prisma.serviceRequest.findMany({
      where: { isSearching: true, searchEndsAt: { lt: now } },
      select: { id: true },
      take: 200,
    });
    for (const r of ended) await this.end(r.id);
    const grace = new Date(now.getTime() - 5000);
    const notStarted = await this.prisma.serviceRequest.findMany({
      where: {
        isSearching: true,
        dispatchStep: -1,
        OR: [
          { liveDispatchAt: { lt: now } },
          { liveDispatchAt: null, timing: { not: 'SCHEDULED' }, createdAt: { lt: grace } },
        ],
      },
      select: { id: true },
      take: 200,
    });
    for (const r of notStarted) await this.startLive(r.id);
    const running = await this.prisma.serviceRequest.findMany({
      where: { isSearching: true, dispatchStep: { gte: 0 }, searchStartedAt: { not: null } },
      select: { id: true, timing: true, dispatchStep: true, searchStartedAt: true },
      take: 500,
    });
    for (const r of running) {
      const plan = ringPlan(r.timing === 'EMERGENCY' ? 'EMERGENCY' : 'NOW', s);
      const next = plan[r.dispatchStep + 1];
      if (next && r.searchStartedAt!.getTime() + next.atSec * 1000 < now.getTime())
        await this.runStep(r.id, next.step);
    }
  }
}
