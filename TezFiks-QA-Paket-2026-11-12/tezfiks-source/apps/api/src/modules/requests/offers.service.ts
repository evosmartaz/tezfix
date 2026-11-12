import { Injectable, Logger } from '@nestjs/common';
import type { Locale, OfferView, ProAssignment } from '@tezfiks/shared';
import { PrismaService, inTx, type Tx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { JobsService } from '../../infra/jobs.service';
import { DomainEvents } from '../../infra/events';
import { newId } from '../../infra/ids';
import { SettingsService } from '../../common/settings/settings.service';
import { ApiException } from '../../common/http/api-exception';
import { LedgerService } from '../ledger/ledger.service';
import { WalletEventsService } from '../wallet/wallet-events.service';
import { PresenceService } from '../realtime/presence.service';
import { CategoriesService } from '../categories/categories.service';
import { lockActiveUser } from '../customer/customer.service';
import { RequestViews } from './views/request-views.service';
import { RequestStateService, lockRequestRow } from './request-state.service';
import { RequestNotifier } from './request-notifier';
import { FeesService } from './fees.service';
import { DispatchService, type ClosedOffer } from './dispatch/dispatch.service';
import { EligibilityService } from './dispatch/eligibility.service';
import { TERMINAL_REQUEST_STATUSES, jobId } from './requests.constants';
import type { Assignment, Offer, ServiceRequest } from '../../generated/prisma/client';

interface LockedOffer {
  id: string;
  status: string;
  expiresAt: Date;
  requestId: string;
}

interface AcceptResult {
  request: ServiceRequest;
  assignments: Assignment[];
  closed: ClosedOffer[];
  searchStopped: boolean;
  walletAccountId: string | null;
}

/**
 * Offers on the provider side: lists (pro current / scheduled, company), accept (solo and company, one transaction each
 * with FOR UPDATE / SKIP LOCKED slot locking), decline and seen.
 */
@Injectable()
export class OffersService {
  private readonly log = new Logger('Offers');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    private readonly events: DomainEvents,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
    private readonly walletEvents: WalletEventsService,
    private readonly presence: PresenceService,
    private readonly categories: CategoriesService,
    private readonly views: RequestViews,
    private readonly state: RequestStateService,
    private readonly notifier: RequestNotifier,
    private readonly fees: FeesService,
    private readonly dispatch: DispatchService,
    private readonly eligibility: EligibilityService,
  ) {}

  // ------------------------------------------------------------------ lists

  async proOffers(
    userId: string,
    locale: Locale,
    scope: 'current' | 'scheduled',
  ): Promise<{ items: OfferView[]; serverNow: string }> {
    const now = this.clock.now();
    const profile = await this.prisma.handymanProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) return { items: [], serverNow: now.toISOString() };
    const offers = await this.prisma.offer.findMany({
      where: {
        handymanId: profile.id,
        status: 'SENT',
        expiresAt: { gt: now },
        // current = offers that need an answer now (live rings and non-scheduled requests); scheduled = "Planlı sifarişlər".
        ...(scope === 'scheduled'
          ? { request: { timing: 'SCHEDULED' } }
          : { OR: [{ step: { gte: 0 } }, { request: { timing: { not: 'SCHEDULED' } } }] }),
      },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    });
    return { items: await this.views.toOfferViews(offers, locale), serverNow: now.toISOString() };
  }

  async requireManager(
    userId: string,
    companyId: string,
    db: Tx | PrismaService = this.prisma,
  ): Promise<void> {
    const company = await db.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!company) throw new ApiException('NOT_FOUND', { entity: 'company', id: companyId });
    const m = await db.companyMember.findFirst({
      where: { companyId, userId, role: 'MANAGER', status: 'ACTIVE' },
      select: { id: true },
    });
    if (!m) throw new ApiException('NOT_COMPANY_MANAGER');
  }

  async companyOffers(
    userId: string,
    companyId: string,
    locale: Locale,
  ): Promise<{ items: OfferView[]; serverNow: string }> {
    await this.requireManager(userId, companyId);
    const now = this.clock.now();
    const offers = await this.prisma.offer.findMany({
      where: { companyId, status: 'SENT', expiresAt: { gt: now } },
      orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
    });
    return { items: await this.views.toOfferViews(offers, locale), serverNow: now.toISOString() };
  }

  // ----------------------------------------------------------------- helpers

  private async lockOffer(tx: Tx, offerId: string): Promise<LockedOffer> {
    const rows = await tx.$queryRawUnsafe<LockedOffer[]>(
      `SELECT id::text AS id, status::text AS status, "expiresAt", "requestId"::text AS "requestId" FROM offers WHERE id = $1::uuid FOR UPDATE`,
      offerId,
    );
    const o = rows[0];
    if (!o) throw new ApiException('NOT_FOUND', { entity: 'offer', id: offerId });
    if (o.status !== 'SENT')
      throw new ApiException(o.status === 'EXPIRED' ? 'OFFER_EXPIRED' : 'OFFER_UNAVAILABLE', {
        status: o.status,
      });
    if (new Date(o.expiresAt).getTime() <= this.clock.nowMs()) throw new ApiException('OFFER_EXPIRED');
    return o;
  }

  private async lockOpenSlots(tx: Tx, requestId: string, n: number): Promise<string[]> {
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text AS id FROM request_slots WHERE "requestId" = $1::uuid AND status = 'OPEN' ORDER BY index LIMIT $2 FOR UPDATE SKIP LOCKED`,
      requestId,
      n,
    );
    return rows.map((r) => r.id);
  }

  private async openRequest(tx: Tx, requestId: string): Promise<ServiceRequest> {
    const r = await tx.serviceRequest.findUnique({ where: { id: requestId } });
    if (!r || (TERMINAL_REQUEST_STATUSES as readonly string[]).includes(r.status))
      throw new ApiException('OFFER_UNAVAILABLE', { reason: 'REQUEST_CLOSED' });
    return r;
  }

  /** Busy for this request: a pre-booked job within ±2 h (scheduled requests) or an ongoing job (others). */
  private async busyFor(tx: Tx, handymanIds: string[], r: ServiceRequest): Promise<Set<string>> {
    if (r.timing === 'SCHEDULED' && r.scheduledAt) {
      const conflicts = await this.eligibility.scheduleConflicts(handymanIds, r.scheduledAt, r.id, tx);
      const live = await this.eligibility.busyHandymen(handymanIds, tx);
      // An ongoing job only matters when the scheduled job starts within 2 hours.
      const soon = r.scheduledAt.getTime() - this.clock.nowMs() <= 2 * 3600_000;
      return new Set([...conflicts, ...(soon ? live : [])]);
    }
    return this.eligibility.busyHandymen(handymanIds, tx);
  }

  /** Marks the slot filled, the offer accepted and (when no slot is left) stops the search. Shared by both accepts. */
  private async finishAccept(
    tx: Tx,
    r: ServiceRequest,
    offerId: string,
  ): Promise<{ closed: ClosedOffer[]; searchStopped: boolean }> {
    const now = this.clock.now();
    await tx.offer.update({ where: { id: offerId }, data: { status: 'ACCEPTED', respondedAt: now } });
    const remaining = await tx.requestSlot.count({ where: { requestId: r.id, status: 'OPEN' } });
    let closed: ClosedOffer[] = [];
    if (remaining === 0) {
      closed = await this.dispatch.closeSentOffers(r.id, 'TAKEN', tx);
      await tx.serviceRequest.update({ where: { id: r.id }, data: { isSearching: false } });
    }
    await this.state.recompute(r.id, tx);
    return { closed, searchStopped: remaining === 0 };
  }

  private async createAssignment(
    tx: Tx,
    r: ServiceRequest,
    slotId: string,
    data: {
      offerId: string;
      providerType: 'SOLO' | 'COMPANY';
      handymanId: string;
      companyId: string | null;
      acceptedByUserId: string;
      walletAccountId: string | null;
      fee: number;
    },
  ): Promise<Assignment> {
    const now = this.clock.now();
    const s = await this.settings.get();
    const id = newId();
    let feeHoldId: string | null = null;
    if (data.fee > 0) {
      if (!data.walletAccountId) throw new ApiException('NOT_ELIGIBLE', { reason: 'NO_WALLET' });
      const hold = await this.ledger.hold(
        {
          accountId: data.walletAccountId,
          amount: data.fee,
          kind: 'REQUEST_FEE',
          requestId: r.id,
          slotId,
          assignmentId: id,
        },
        tx,
      );
      feeHoldId = hold.id;
    }
    const a = await tx.assignment.create({
      data: {
        id,
        requestId: r.id,
        slotId,
        offerId: data.offerId,
        providerType: data.providerType,
        handymanId: data.handymanId,
        companyId: data.companyId,
        acceptedByUserId: data.acceptedByUserId,
        status: 'ACCEPTED',
        isGuaranteeFix: r.isGuaranteeFix,
        acceptedAt: now,
        freeCancelUntil: new Date(now.getTime() + s.freeCancelSec * 1000),
        feeHoldId,
        feeAmount: BigInt(data.fee),
        createdAt: now,
      },
    });
    const filled = await tx.requestSlot.updateMany({
      where: { id: slotId, status: 'OPEN' },
      data: { status: 'FILLED', currentAssignmentId: a.id },
    });
    if (filled.count === 0) throw new ApiException('OFFER_UNAVAILABLE');
    return a;
  }

  // ------------------------------------------------------------- solo accept

  async acceptSolo(userId: string, offerId: string, locale: Locale): Promise<{ assignment: ProAssignment }> {
    const s = await this.settings.get();
    const profile = await this.prisma.handymanProfile.findUnique({ where: { userId }, select: { id: true } });
    const pre = await this.prisma.offer.findUnique({
      where: { id: offerId },
      select: { handymanId: true, requestId: true },
    });
    if (!profile || !pre || pre.handymanId !== profile.id)
      throw new ApiException('NOT_FOUND', { entity: 'offer', id: offerId });
    const res = await inTx(this.prisma, async (tx): Promise<AcceptResult> => {
      await lockActiveUser(tx, userId);
      // The request row first: accepts of one request run one after the other (the last one sees no OPEN slot and stops
      // the search), and the lock order matches whole-request cancel and search end (request -> offer -> slot).
      await lockRequestRow(tx, pre.requestId);
      const o = await this.lockOffer(tx, offerId);
      await tx.$queryRawUnsafe('SELECT id FROM handyman_profiles WHERE id = $1::uuid FOR UPDATE', profile.id);
      const r = await this.openRequest(tx, o.requestId);
      const p = await tx.handymanProfile.findUniqueOrThrow({
        where: { id: profile.id },
        select: {
          id: true,
          kind: true,
          status: true,
          walletAccountId: true,
          trades: { where: { categoryId: r.categoryId }, select: { categoryId: true } },
        },
      });
      if (p.status !== 'APPROVED') throw new ApiException('NOT_ELIGIBLE', { reason: 'NOT_APPROVED' });
      if (p.kind !== 'SOLO') throw new ApiException('NOT_ELIGIBLE', { reason: 'NOT_SOLO' });
      if (!p.trades.length) throw new ApiException('NOT_ELIGIBLE', { reason: 'NO_TRADE' });
      if ((await this.busyFor(tx, [p.id], r)).has(p.id))
        throw new ApiException('NOT_ELIGIBLE', { reason: 'BUSY' });
      const [slotId] = await this.lockOpenSlots(tx, r.id, 1);
      if (!slotId) throw new ApiException('OFFER_UNAVAILABLE', { reason: 'NO_OPEN_SLOT' });
      const a = await this.createAssignment(tx, r, slotId, {
        offerId,
        providerType: 'SOLO',
        handymanId: p.id,
        companyId: null,
        acceptedByUserId: userId,
        walletAccountId: p.walletAccountId,
        fee: r.isGuaranteeFix ? 0 : s.requestFee,
      });
      const fin = await this.finishAccept(tx, r, offerId);
      return { request: r, assignments: [a], ...fin, walletAccountId: p.walletAccountId };
    });
    await this.afterAccept(res, offerId);
    return { assignment: await this.views.toProAssignment(res.assignments[0]!, userId, locale, 'SOLO') };
  }

  // ---------------------------------------------------------- company accept

  async acceptCompany(
    userId: string,
    companyId: string,
    offerId: string,
    workerIds: string[],
    locale: Locale,
  ): Promise<{ assignments: ProAssignment[] }> {
    const s = await this.settings.get();
    await this.requireManager(userId, companyId);
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { status: true, walletAccountId: true },
    });
    if (company.status !== 'APPROVED') throw new ApiException('COMPANY_NOT_APPROVED');
    const pre = await this.prisma.offer.findUnique({
      where: { id: offerId },
      select: { companyId: true, requestId: true },
    });
    if (!pre || pre.companyId !== companyId)
      throw new ApiException('NOT_FOUND', { entity: 'offer', id: offerId });
    if (new Set(workerIds).size !== workerIds.length)
      throw new ApiException('VALIDATION_FAILED', { field: 'workerIds', reason: 'duplicate_worker' });

    const res = await inTx(this.prisma, async (tx): Promise<AcceptResult> => {
      await lockActiveUser(tx, userId);
      await this.requireManager(userId, companyId, tx);
      await lockRequestRow(tx, pre.requestId); // see acceptSolo
      const o = await this.lockOffer(tx, offerId);
      const r = await this.openRequest(tx, o.requestId);
      const open = await tx.requestSlot.count({ where: { requestId: r.id, status: 'OPEN' } });
      if (open === 0) throw new ApiException('OFFER_UNAVAILABLE', { reason: 'NO_OPEN_SLOT' });
      if (workerIds.length > open)
        throw new ApiException('VALIDATION_FAILED', {
          field: 'workerIds',
          reason: 'too_many_workers',
          slotsOpen: open,
        });

      // Workers may be given as handyman profile ids or as user ids.
      const profiles = await tx.handymanProfile.findMany({
        where: { companyId, OR: [{ id: { in: workerIds } }, { userId: { in: workerIds } }] },
        select: { id: true, userId: true },
      });
      const resolved: string[] = [];
      for (const wid of workerIds) {
        const p = profiles.find((x) => x.id === wid || x.userId === wid);
        if (!p) throw new ApiException('WORKER_UNAVAILABLE', { workerId: wid, reason: 'NOT_A_WORKER' });
        if (resolved.includes(p.id))
          throw new ApiException('VALIDATION_FAILED', { field: 'workerIds', reason: 'duplicate_worker' });
        resolved.push(p.id);
      }
      // Workers' user rows FOR SHARE (before their profiles, the same order as account deletion): a worker whose account
      // is deleted or blocked concurrently is either refused here or blocks the deletion with this assignment.
      const workerUserIds = [
        ...new Set(profiles.filter((p) => resolved.includes(p.id)).map((p) => p.userId)),
      ].sort();
      await tx.$queryRawUnsafe(
        'SELECT id FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR SHARE',
        workerUserIds,
      );
      await tx.$queryRawUnsafe(
        'SELECT id FROM handyman_profiles WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
        [...resolved].sort(),
      );
      const workers = await tx.handymanProfile.findMany({
        where: { id: { in: resolved } },
        select: {
          id: true,
          userId: true,
          kind: true,
          status: true,
          companyId: true,
          user: {
            select: {
              status: true,
              memberships: { where: { companyId, status: 'ACTIVE' }, select: { id: true } },
            },
          },
          trades: { where: { categoryId: r.categoryId }, select: { categoryId: true } },
        },
      });
      const busy = await this.busyFor(tx, resolved, r);
      for (const id of resolved) {
        const w = workers.find((x) => x.id === id)!;
        let reason: string | null = null;
        if (w.kind !== 'COMPANY_WORKER' || w.companyId !== companyId || !w.user.memberships.length)
          reason = 'NOT_A_MEMBER';
        else if (w.status !== 'APPROVED') reason = 'NOT_APPROVED';
        else if (w.user.status !== 'ACTIVE') reason = 'USER_INACTIVE';
        else if (!w.trades.length) reason = 'NO_TRADE';
        else if (busy.has(id)) reason = 'BUSY';
        if (reason) throw new ApiException('WORKER_UNAVAILABLE', { handymanId: id, reason });
      }
      const slots = await this.lockOpenSlots(tx, r.id, resolved.length);
      if (slots.length < resolved.length)
        throw new ApiException('OFFER_UNAVAILABLE', { reason: 'SLOTS_TAKEN', slotsOpen: slots.length });
      const fee = r.isGuaranteeFix ? 0 : s.requestFee;
      const assignments: Assignment[] = [];
      for (let i = 0; i < resolved.length; i++) {
        assignments.push(
          await this.createAssignment(tx, r, slots[i]!, {
            offerId,
            providerType: 'COMPANY',
            handymanId: resolved[i]!,
            companyId,
            acceptedByUserId: userId,
            walletAccountId: company.walletAccountId,
            fee,
          }),
        );
      }
      const fin = await this.finishAccept(tx, r, offerId);
      return { request: r, assignments, ...fin, walletAccountId: company.walletAccountId };
    });
    await this.afterAccept(res, offerId);
    return { assignments: await this.views.toProAssignments(res.assignments, userId, locale, 'MANAGER') };
  }

  /** After commit: presence busy, fee-window timers, closed offers, request:updated and notifications. */
  private async afterAccept(res: AcceptResult, offerId: string): Promise<void> {
    const r = res.request;
    try {
      await this.jobs.cancel(jobId.offerExpire(offerId));
      const busy = await this.eligibility.busyHandymen(res.assignments.map((a) => a.handymanId));
      for (const a of res.assignments) {
        if (busy.has(a.handymanId)) await this.presence.setBusy(a.handymanId, true);
        await this.fees.scheduleWindowClose(a.id, a.freeCancelUntil);
      }
      if (res.searchStopped) await this.dispatch.cancelSearchJobs(r.id);
      await this.dispatch.announceClosed(res.closed);
      await this.state.announce(r.id);
      if (res.walletAccountId) await this.walletEvents.notifyAccount(res.walletAccountId);
      const owner = await this.prisma.customerAccount.findUnique({
        where: { id: r.customerAccountId },
        select: { ownerUserId: true },
      });
      const category = await this.categories.get(r.categoryId);
      for (const a of res.assignments) {
        const h = await this.prisma.handymanProfile.findUnique({
          where: { id: a.handymanId },
          select: { userId: true, user: { select: { firstName: true, lastName: true } } },
        });
        const name = [h?.user.firstName, h?.user.lastName].filter(Boolean).join(' ');
        await this.notifier.send(
          [owner?.ownerUserId],
          'REQUEST_ASSIGNED',
          () => ({ name, number: r.number }),
          {
            app: 'CUSTOMER',
            data: { requestId: r.id, assignmentId: a.id },
          },
        );
        if (a.providerType === 'COMPANY' && h) {
          await this.notifier.send(
            [h.userId],
            'WORKER_ASSIGNED',
            (l) => ({ number: r.number, category: this.categories.name(category, l) }),
            {
              app: 'PRO',
              data: { assignmentId: a.id },
            },
          );
        }
        await this.events.emit('assignment.status', {
          assignmentId: a.id,
          requestId: r.id,
          status: 'ACCEPTED',
        });
      }
    } catch (err) {
      this.log.error(`after-accept for request ${r.id} failed: ${(err as Error).message}`);
    }
  }

  // ----------------------------------------------------------- decline / seen

  private async decline(offer: Offer & { handyman: { userId: string } | null }): Promise<{ ok: true }> {
    const res = await this.prisma.offer.updateMany({
      where: { id: offer.id, status: 'SENT' },
      data: { status: 'DECLINED', closeReason: 'DECLINED', respondedAt: this.clock.now() },
    });
    if (res.count === 0) {
      if (offer.status === 'ACCEPTED') throw new ApiException('OFFER_UNAVAILABLE', { status: offer.status });
      return { ok: true };
    }
    await this.jobs.cancel(jobId.offerExpire(offer.id));
    const payload = { offerId: offer.id, requestId: offer.requestId, reason: 'DECLINED' as const };
    if (offer.handyman) this.dispatchClosedTo(offer.handyman.userId, null, payload);
    if (offer.companyId) this.dispatchClosedTo(null, offer.companyId, payload);
    return { ok: true };
  }

  private dispatchClosedTo(
    userId: string | null,
    companyId: string | null,
    payload: { offerId: string; requestId: string; reason: 'DECLINED' },
  ) {
    // Fire-and-forget after the decline committed: a failure (Redis down) is logged, never an unhandled rejection.
    this.dispatch
      .announceClosed([{ ...payload, handymanUserId: userId, companyId }])
      .catch((err: Error) => this.log.warn(`offer:closed for ${payload.offerId} failed: ${err.message}`));
  }

  private async ownOffer(userId: string, offerId: string) {
    const profile = await this.prisma.handymanProfile.findUnique({ where: { userId }, select: { id: true } });
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: { handyman: { select: { userId: true } } },
    });
    if (!profile || !offer || offer.handymanId !== profile.id)
      throw new ApiException('NOT_FOUND', { entity: 'offer', id: offerId });
    return offer;
  }

  async declineSolo(userId: string, offerId: string): Promise<{ ok: true }> {
    return this.decline(await this.ownOffer(userId, offerId));
  }

  async declineCompany(userId: string, companyId: string, offerId: string): Promise<{ ok: true }> {
    await this.requireManager(userId, companyId);
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      include: { handyman: { select: { userId: true } } },
    });
    if (!offer || offer.companyId !== companyId)
      throw new ApiException('NOT_FOUND', { entity: 'offer', id: offerId });
    return this.decline(offer);
  }

  async seen(userId: string, offerId: string): Promise<{ ok: true }> {
    const offer = await this.ownOffer(userId, offerId);
    const now = this.clock.now();
    await this.prisma.offer.update({
      where: { id: offer.id },
      data: { seenAt: offer.seenAt ?? now, deliveredAt: offer.deliveredAt ?? now },
    });
    return { ok: true };
  }
}
