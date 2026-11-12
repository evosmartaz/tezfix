import { Injectable, Logger } from '@nestjs/common';
import {
  PROVIDER_ACTIONS,
  canDo,
  etaMinutes,
  formatMoney,
  haversineMeters,
  shouldUnlockContact,
  type AssignmentStatus,
  type LatLng,
  type Locale,
  type ProAssignment,
} from '@tezfiks/shared';
import { PrismaService, inTx, type Tx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { DomainEvents } from '../../infra/events';
import { SettingsService } from '../../common/settings/settings.service';
import { ApiException } from '../../common/http/api-exception';
import { PresenceService } from '../realtime/presence.service';
import { RoomAccessService } from '../realtime/room-access.service';
import { CategoriesService } from '../categories/categories.service';
import { lockActiveUser } from '../customer/customer.service';
import { CancellationService } from '../requests/cancellation.service';
import { RequestStateService, lockRequestRow } from '../requests/request-state.service';
import { RequestNotifier } from '../requests/request-notifier';
import { RequestViews, type ProViewerMode } from '../requests/views/request-views.service';
import { EligibilityService } from '../requests/dispatch/eligibility.service';
import type { Assignment, Prisma } from '../../generated/prisma/client';
import { AssignmentAccess } from './assignment-access.service';
import { CompletionService } from './completion.service';
import { TrackingService, type RouteColumns } from './tracking.service';
import { ACTIVE_STATUSES, TERMINAL_STATUSES, isUuid } from './assignments.constants';

/** A server-side position older than this does not count for "arrived" or as the en-route origin. */
const FRESH_POSITION_MS = 5 * 60_000;

/** Assignment columns written by live tracking (TrackingService) and the contact unlock, cleared on a reassign. */
const RESET_TRACKING = {
  lastLat: null,
  lastLng: null,
  lastHeading: null,
  lastLocationAt: null,
  etaSec: null,
  etaUpdatedAt: null,
  distanceM: null,
  routePolyline: null,
  routeDurationSec: null,
  routeDistanceM: null,
  routeComputedAt: null,
  routeSource: null,
  contactUnlockedAt: null,
} satisfies Prisma.AssignmentUpdateInput;

export interface ListQuery {
  scope?: 'active' | 'history';
  cursor?: string;
  limit?: number;
}

/** Provider-side lists and actions (solo handyman, company worker, company manager; spec 6.3). */
@Injectable()
export class ProviderActionsService {
  private readonly log = new Logger('ProviderActions');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly events: DomainEvents,
    private readonly settings: SettingsService,
    private readonly presence: PresenceService,
    private readonly rooms: RoomAccessService,
    private readonly categories: CategoriesService,
    private readonly cancellations: CancellationService,
    private readonly state: RequestStateService,
    private readonly notifier: RequestNotifier,
    private readonly views: RequestViews,
    private readonly eligibility: EligibilityService,
    private readonly access: AssignmentAccess,
    private readonly completion: CompletionService,
    private readonly tracking: TrackingService,
  ) {}

  // ------------------------------------------------------------------ lists

  private async page(
    where: Prisma.AssignmentWhereInput,
    q: ListQuery,
    viewerUserId: string,
    locale: Locale,
    mode?: ProViewerMode,
  ): Promise<{ items: ProAssignment[]; nextCursor: string | null }> {
    if (q.cursor !== undefined && !isUuid(q.cursor)) throw new ApiException('VALIDATION_FAILED', { in: 'query', field: 'cursor' });
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 100);
    const statusFilter =
      q.scope === 'active' ? { status: { in: [...ACTIVE_STATUSES] } } : q.scope === 'history' ? { status: { in: [...TERMINAL_STATUSES] } } : {};
    const rows = await this.prisma.assignment.findMany({
      where: { ...where, ...statusFilter, ...(q.cursor ? { id: { lt: q.cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    // Phones never appear in lists given to the other party (spec 4.4, Global Constraints): the customer phone is only in
    // the single-assignment view while the contact window is open.
    const items = (await this.views.toProAssignments(slice, viewerUserId, locale, mode)).map((x) => ({ ...x, customerPhone: null }));
    return {
      items,
      nextCursor: hasMore ? slice[slice.length - 1]!.id : null,
    };
  }

  /** The caller's own jobs as the doer (solo handyman or company worker). */
  async listMine(userId: string, q: ListQuery, locale: Locale) {
    const profile = await this.prisma.handymanProfile.findUnique({ where: { userId }, select: { id: true } });
    if (!profile) {
      if (q.cursor !== undefined && !isUuid(q.cursor)) throw new ApiException('VALIDATION_FAILED', { in: 'query', field: 'cursor' });
      return { items: [], nextCursor: null };
    }
    return this.page({ handymanId: profile.id }, q, userId, locale);
  }

  async listCompany(userId: string, companyId: string, q: ListQuery, locale: Locale) {
    await this.access.requireManager(userId, companyId);
    return this.page({ companyId }, q, userId, locale, 'MANAGER');
  }

  async get(userId: string, assignmentId: string, locale: Locale): Promise<ProAssignment> {
    const { a, mode } = await this.access.forProvider(userId, assignmentId);
    return this.views.toProAssignment(a, userId, locale, mode);
  }

  async getCompany(userId: string, companyId: string, assignmentId: string, locale: Locale): Promise<ProAssignment> {
    const a = await this.access.forCompany(userId, companyId, assignmentId);
    return this.views.toProAssignment(a, userId, locale, 'MANAGER');
  }

  // ---------------------------------------------------------------- helpers

  /** The doer's handyman profile id when `userId` is the assignment's doer, else FORBIDDEN. */
  private async requireDoer(userId: string, a: Pick<Assignment, 'handymanId'>): Promise<void> {
    const h = await this.prisma.handymanProfile.findUnique({ where: { id: a.handymanId }, select: { userId: true } });
    if (h?.userId !== userId) throw new ApiException('FORBIDDEN', { reason: 'NOT_THE_ASSIGNED_HANDYMAN' });
  }

  private async afterStatus(a: Assignment): Promise<void> {
    try {
      await this.access.announce(a);
      await this.events.emit('assignment.status', { assignmentId: a.id, requestId: a.requestId, status: a.status });
    } catch (err) {
      this.log.warn(`after-status of ${a.id} failed: ${(err as Error).message}`);
    }
  }

  /**
   * The pro's server-side position: what the presence layer last received from the pro's own location stream (pings, going
   * online), when reported within FRESH_POSITION_MS. Never a request body. Null when unknown or stale.
   */
  private async freshPosition(handymanId: string): Promise<(LatLng & { at: Date }) | null> {
    const live = await this.presence.get(handymanId);
    if (!live || live.lat == null || live.lng == null || live.locAt == null) return null;
    return this.clock.nowMs() - live.locAt <= FRESH_POSITION_MS ? { lat: live.lat, lng: live.lng, at: new Date(live.locAt) } : null;
  }

  /**
   * Outside the demo "arrived" (which unlocks the phones and enables the customer's paid decline) needs the pro's fresh
   * server-side position within arrivalMaxDistanceM of the request address: NOT_NEAR_ADDRESS otherwise.
   */
  private assertNearAddress(pos: LatLng | null, address: LatLng, maxDistanceM: number): void {
    if (this.settings.demoMode) return; // demo phones are not at the address
    const distanceM = pos ? Math.round(haversineMeters(pos, address)) : null;
    if (distanceM == null || distanceM > maxDistanceM) {
      throw new ApiException('NOT_NEAR_ADDRESS', { distanceM, maxDistanceM, positionKnown: pos != null });
    }
  }

  /** Route origin: outside the demo the fresh server-side position wins over the client-supplied one. */
  private async origin(handymanId: string, given?: LatLng): Promise<LatLng | null> {
    if (!this.settings.demoMode) {
      const server = await this.freshPosition(handymanId);
      if (server) return { lat: server.lat, lng: server.lng };
    }
    if (given) return given;
    const live = await this.presence.get(handymanId);
    if (live?.lat != null && live.lng != null) return { lat: live.lat, lng: live.lng };
    const p = await this.prisma.handymanProfile.findUnique({ where: { id: handymanId }, select: { lastLat: true, lastLng: true } });
    return p?.lastLat != null && p.lastLng != null ? { lat: p.lastLat, lng: p.lastLng } : null;
  }

  // --------------------------------------------------------------- en route

  /** "Yola çıxdım": ACCEPTED -> EN_ROUTE, computes the route once, notifies the customer (ASSIGNMENT_EN_ROUTE). */
  async enRoute(userId: string, assignmentId: string, location: LatLng | undefined, locale: Locale): Promise<ProAssignment> {
    const { a: pre, mode } = await this.access.forProvider(userId, assignmentId);
    await this.requireDoer(userId, pre);
    if (!canDo(PROVIDER_ACTIONS, 'enRoute', pre.status as AssignmentStatus)) throw new ApiException('INVALID_STATE', { status: pre.status });
    const r = await this.prisma.serviceRequest.findUniqueOrThrow({ where: { id: pre.requestId }, select: { lat: true, lng: true } });
    const from = await this.origin(pre.handymanId, location);
    // The route is computed before the transaction (network call); stored only if the transition wins.
    const route: RouteColumns | null = from ? await this.tracking.computeRoute(from, r) : null;
    const now = this.clock.now();
    const a = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      const a = await this.access.lockAssignment(tx, assignmentId);
      if (a.handymanId !== pre.handymanId) throw new ApiException('FORBIDDEN', { reason: 'NOT_THE_ASSIGNED_HANDYMAN' });
      if (!canDo(PROVIDER_ACTIONS, 'enRoute', a.status as AssignmentStatus)) throw new ApiException('INVALID_STATE', { status: a.status });
      await tx.assignment.update({
        where: { id: a.id },
        data: {
          status: 'EN_ROUTE',
          enRouteAt: now,
          ...(route
            ? { ...route, etaSec: route.routeDurationSec, etaUpdatedAt: now, distanceM: route.routeDistanceM }
            : {}),
          ...(from ? { lastLat: from.lat, lastLng: from.lng, lastLocationAt: now } : {}),
        },
      });
      await this.state.recompute(a.requestId, tx);
      return tx.assignment.findUniqueOrThrow({ where: { id: a.id } });
    });
    await this.afterStatus(a);
    try {
      const p = await this.access.parties(a);
      const name = await this.tracking.providerName(a.handymanId);
      await this.notifier.send([p.customerUserId], 'ASSIGNMENT_EN_ROUTE', () => ({ name, minutes: etaMinutes(a.etaSec) ?? '—' }), {
        app: 'CUSTOMER',
        data: { assignmentId: a.id, requestId: a.requestId },
      });
      const s = await this.settings.get();
      if (a.etaSec != null && shouldUnlockContact({ status: 'EN_ROUTE', etaSec: a.etaSec, contactUnlockedAt: a.contactUnlockedAt }, s)) {
        await this.tracking.unlockNear(a, a.etaSec, p);
      }
    } catch (err) {
      this.log.warn(`en-route notifications of ${a.id} failed: ${(err as Error).message}`);
    }
    return this.views.toProAssignment(a.id, userId, locale, mode);
  }

  // ---------------------------------------------------------------- arrived

  /** ACCEPTED|EN_ROUTE -> ARRIVED; unlocks the contact (spec 4.4) and notifies ASSIGNMENT_ARRIVED. */
  async arrived(userId: string, assignmentId: string, locale: Locale): Promise<ProAssignment> {
    const { a: pre, mode } = await this.access.forProvider(userId, assignmentId);
    await this.requireDoer(userId, pre);
    if (!canDo(PROVIDER_ACTIONS, 'arrived', pre.status as AssignmentStatus)) throw new ApiException('INVALID_STATE', { status: pre.status });
    const address = await this.prisma.serviceRequest.findUniqueOrThrow({ where: { id: pre.requestId }, select: { lat: true, lng: true } });
    const pos = await this.freshPosition(pre.handymanId);
    this.assertNearAddress(pos, address, (await this.settings.get()).arrivalMaxDistanceM);
    const now = this.clock.now();
    const { a, unlocked } = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      const a = await this.access.lockAssignment(tx, assignmentId);
      if (a.handymanId !== pre.handymanId) throw new ApiException('FORBIDDEN', { reason: 'NOT_THE_ASSIGNED_HANDYMAN' });
      if (!canDo(PROVIDER_ACTIONS, 'arrived', a.status as AssignmentStatus)) throw new ApiException('INVALID_STATE', { status: a.status });
      // The arrival point (the fresh server-side position) becomes the last position the customer sees, unless newer.
      const arrivalPoint = pos && (!a.lastLocationAt || a.lastLocationAt.getTime() <= pos.at.getTime()) ? pos : null;
      await tx.assignment.update({
        where: { id: a.id },
        data: {
          status: 'ARRIVED',
          arrivedAt: now,
          enRouteAt: a.enRouteAt ?? now,
          etaSec: 0,
          etaUpdatedAt: now,
          distanceM: 0,
          contactUnlockedAt: a.contactUnlockedAt ?? now,
          ...(arrivalPoint ? { lastLat: arrivalPoint.lat, lastLng: arrivalPoint.lng, lastLocationAt: arrivalPoint.at } : {}),
        },
      });
      await this.state.recompute(a.requestId, tx);
      return { a: await tx.assignment.findUniqueOrThrow({ where: { id: a.id } }), unlocked: !a.contactUnlockedAt };
    });
    await this.afterStatus(a);
    try {
      const p = await this.access.parties(a);
      if (unlocked) this.tracking.emitContact(a, p);
      const name = await this.tracking.providerName(a.handymanId);
      await this.notifier.send([p.customerUserId], 'ASSIGNMENT_ARRIVED', () => ({ name }), {
        app: 'CUSTOMER',
        data: { assignmentId: a.id, requestId: a.requestId },
      });
    } catch (err) {
      this.log.warn(`arrived notifications of ${a.id} failed: ${(err as Error).message}`);
    }
    return this.views.toProAssignment(a.id, userId, locale, mode);
  }

  // ------------------------------------------------------------------ price

  /**
   * "Qiyməti təsdiqlə və işi bitir": ARRIVED -> PRICE_PROPOSED with labour + materials. Solo: the handyman. Company jobs:
   * only the side named by finalPriceEntry (the worker, or a manager); the other side gets FORBIDDEN. Guarantee re-fixes are
   * free (spec 4.6: price fixed at 0). Schedules the cash auto-completion.
   */
  async enterPrice(
    userId: string,
    assignmentId: string,
    body: { labor: number; materials: number },
    locale: Locale,
    via: { companyId: string } | null,
  ): Promise<ProAssignment> {
    let mode: ProViewerMode;
    if (via) {
      await this.access.forCompany(userId, via.companyId, assignmentId);
      mode = 'MANAGER';
    } else {
      mode = (await this.access.forProvider(userId, assignmentId)).mode;
    }
    const a = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      const a = await this.access.lockAssignment(tx, assignmentId);
      await this.assertPriceSide(tx, a, userId, mode, !!via);
      if (!canDo(PROVIDER_ACTIONS, 'price', a.status as AssignmentStatus)) throw new ApiException('INVALID_STATE', { status: a.status });
      const labor = a.isGuaranteeFix ? 0 : body.labor;
      const materials = a.isGuaranteeFix ? 0 : body.materials;
      await tx.assignment.update({
        where: { id: a.id },
        data: {
          status: 'PRICE_PROPOSED',
          laborAmount: BigInt(labor),
          materialsAmount: BigInt(materials),
          totalAmount: BigInt(labor + materials),
          priceEnteredByUserId: userId,
          priceProposedAt: this.clock.now(),
        },
      });
      await this.state.recompute(a.requestId, tx);
      return tx.assignment.findUniqueOrThrow({ where: { id: a.id } });
    });
    await this.completion.scheduleAutoComplete(a.id, a.priceProposedAt!);
    await this.afterStatus(a);
    try {
      const p = await this.access.parties(a);
      const name = await this.tracking.providerName(a.handymanId);
      const total = Number(a.totalAmount ?? 0n);
      await this.notifier.send([p.customerUserId], 'PRICE_PROPOSED', (l) => ({ name, amount: formatMoney(total, l) }), {
        app: 'CUSTOMER',
        data: { assignmentId: a.id, requestId: a.requestId, amount: total },
      });
    } catch (err) {
      this.log.warn(`price notifications of ${a.id} failed: ${(err as Error).message}`);
    }
    return this.views.toProAssignment(a.id, userId, locale, mode);
  }

  private async assertPriceSide(tx: Tx, a: Assignment, userId: string, mode: ProViewerMode, viaCompany: boolean): Promise<void> {
    if (a.providerType === 'SOLO' || !a.companyId) {
      if (viaCompany) throw new ApiException('NOT_FOUND', { entity: 'assignment', id: a.id });
      if (mode !== 'SOLO') throw new ApiException('FORBIDDEN', { reason: 'NOT_THE_ASSIGNED_HANDYMAN' });
      return;
    }
    const company = await tx.company.findUniqueOrThrow({ where: { id: a.companyId }, select: { finalPriceEntry: true } });
    if (company.finalPriceEntry === 'MANAGER') {
      if (mode !== 'MANAGER') throw new ApiException('FORBIDDEN', { reason: 'PRICE_ENTERED_BY_MANAGER' });
      return;
    }
    // finalPriceEntry = WORKER: only the assigned worker (also when that worker happens to be a manager).
    const h = await tx.handymanProfile.findUniqueOrThrow({ where: { id: a.handymanId }, select: { userId: true } });
    if (viaCompany || h.userId !== userId) throw new ApiException('FORBIDDEN', { reason: 'PRICE_ENTERED_BY_WORKER' });
  }

  // ----------------------------------------------------------------- cancel

  /** Provider cancel through CancellationService (actor PROVIDER): free inside the window, else strike + re-dispatch. */
  async cancel(userId: string, assignmentId: string, reason: string | undefined, locale: Locale, via: { companyId: string } | null): Promise<ProAssignment> {
    let mode: ProViewerMode;
    if (via) {
      await this.access.forCompany(userId, via.companyId, assignmentId);
      mode = 'MANAGER';
    } else {
      mode = (await this.access.forProvider(userId, assignmentId)).mode;
    }
    const res = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      return this.cancellations.apply(assignmentId, { actor: 'PROVIDER', kind: 'CANCEL', reason: reason ?? null, byUserId: userId }, tx);
    });
    await res.afterCommit();
    return this.views.toProAssignment(res.assignment, userId, locale, mode);
  }

  // ------------------------------------------------------------ rate customer

  /** The provider rates the customer once (ALREADY_RATED); workers of a company see no customer rating (spec 4.4). */
  async rateCustomer(userId: string, assignmentId: string, body: { stars: number; comment?: string }): Promise<{ ok: true }> {
    const { mode } = await this.access.forProvider(userId, assignmentId);
    if (mode === 'WORKER') throw new ApiException('FORBIDDEN', { reason: 'MANAGER_RATES_COMPANY_JOBS' });
    try {
      await inTx(this.prisma, async (tx) => {
        await lockActiveUser(tx, userId);
        const a = await this.access.lockAssignment(tx, assignmentId);
        if (a.status !== 'COMPLETED') throw new ApiException('INVALID_STATE', { status: a.status });
        if (a.providerRatedAt) throw new ApiException('ALREADY_RATED');
        const r = await tx.serviceRequest.findUniqueOrThrow({ where: { id: a.requestId }, select: { customerAccountId: true } });
        await tx.rating.create({
          data: {
            assignmentId: a.id,
            direction: 'PROVIDER_TO_CUSTOMER',
            raterUserId: userId,
            handymanId: a.handymanId,
            companyId: a.companyId,
            customerAccountId: r.customerAccountId,
            stars: body.stars,
            comment: body.comment?.trim() || null,
            createdAt: this.clock.now(),
          },
        });
        await tx.assignment.update({ where: { id: a.id }, data: { providerRatedAt: this.clock.now() } });
        await tx.customerAccount.update({
          where: { id: r.customerAccountId },
          data: { ratingSum: { increment: body.stars }, ratingCount: { increment: 1 } },
        });
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new ApiException('ALREADY_RATED');
      throw err;
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------- reassign

  /** Company manager: hand an ACCEPTED job to another ACTIVE, approved, free worker with the trade. */
  async reassign(userId: string, companyId: string, assignmentId: string, workerId: string, locale: Locale): Promise<ProAssignment> {
    const pre = await this.access.forCompany(userId, companyId, assignmentId);
    const target = await this.prisma.handymanProfile.findFirst({
      where: { companyId, OR: [...(isUuid(workerId) ? [{ id: workerId }, { userId: workerId }] : [])] },
      select: { id: true, userId: true },
    });
    if (!target) throw new ApiException('WORKER_UNAVAILABLE', { workerId, reason: 'NOT_A_WORKER' });
    const out = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      await this.access.requireManager(userId, companyId, tx);
      // B1 lock order: acting user -> request -> worker user (SHARE) -> worker profile -> assignment.
      await lockRequestRow(tx, pre.requestId);
      await tx.$queryRawUnsafe('SELECT id FROM users WHERE id = $1::uuid FOR SHARE', target.userId);
      await tx.$queryRawUnsafe('SELECT id FROM handyman_profiles WHERE id = $1::uuid FOR UPDATE', target.id);
      await tx.$queryRawUnsafe('SELECT id FROM assignments WHERE id = $1::uuid FOR UPDATE', assignmentId);
      const a = await tx.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
      if (a.companyId !== companyId) throw new ApiException('NOT_FOUND', { entity: 'assignment', id: assignmentId });
      if (a.status !== 'ACCEPTED') throw new ApiException('INVALID_STATE', { status: a.status });
      if (a.handymanId === target.id) return { a, previousHandymanId: null as string | null };
      const r = await tx.serviceRequest.findUniqueOrThrow({ where: { id: a.requestId } });
      const w = await tx.handymanProfile.findUniqueOrThrow({
        where: { id: target.id },
        select: {
          kind: true,
          status: true,
          companyId: true,
          user: { select: { status: true, memberships: { where: { companyId, status: 'ACTIVE' }, select: { id: true } } } },
          trades: { where: { categoryId: r.categoryId }, select: { categoryId: true } },
        },
      });
      let reason: string | null = null;
      if (w.kind !== 'COMPANY_WORKER' || w.companyId !== companyId || !w.user.memberships.length) reason = 'NOT_A_MEMBER';
      else if (w.status !== 'APPROVED') reason = 'NOT_APPROVED';
      else if (w.user.status !== 'ACTIVE') reason = 'USER_INACTIVE';
      else if (!w.trades.length) reason = 'NO_TRADE';
      else if (await this.busyFor(tx, target.id, r)) reason = 'BUSY';
      if (reason) throw new ApiException('WORKER_UNAVAILABLE', { handymanId: target.id, reason });
      // Live tracking runs from acceptance: the previous worker's position, ETA, route and contact unlock belong to that
      // worker. The new worker starts locked (no stale marker for the customer, no phone exposed because A was near).
      await tx.assignment.update({ where: { id: a.id }, data: { handymanId: target.id, ...RESET_TRACKING } });
      return { a: await tx.assignment.findUniqueOrThrow({ where: { id: a.id } }), previousHandymanId: a.handymanId };
    });
    if (out.previousHandymanId) await this.afterReassign(out.a, out.previousHandymanId);
    return this.views.toProAssignment(out.a.id, userId, locale, 'MANAGER');
  }

  /** Busy for this job: an ongoing job, or (scheduled jobs) another booked job within ±2 h. Mirrors B1's accept rule. */
  private async busyFor(tx: Tx, handymanId: string, r: { id: string; timing: string; scheduledAt: Date | null }): Promise<boolean> {
    if (r.timing === 'SCHEDULED' && r.scheduledAt) {
      const conflicts = await this.eligibility.scheduleConflicts([handymanId], r.scheduledAt, r.id, tx);
      if (conflicts.has(handymanId)) return true;
      const soon = r.scheduledAt.getTime() - this.clock.nowMs() <= 2 * 3600_000;
      return soon && (await this.eligibility.isBusy(handymanId, tx));
    }
    return this.eligibility.isBusy(handymanId, tx);
  }

  private async afterReassign(a: Assignment, previousHandymanId: string): Promise<void> {
    try {
      await this.presence.setBusy(previousHandymanId, await this.eligibility.isBusy(previousHandymanId));
      await this.presence.setBusy(a.handymanId, await this.eligibility.isBusy(a.handymanId));
      const prev = await this.prisma.handymanProfile.findUniqueOrThrow({ where: { id: previousHandymanId }, select: { userId: true } });
      const p = await this.access.parties(a);
      const r = await this.prisma.serviceRequest.findUniqueOrThrow({ where: { id: a.requestId }, select: { categoryId: true } });
      const category = await this.categories.get(r.categoryId);
      await this.notifier.send([p.providerUserId], 'WORKER_ASSIGNED', (l) => ({ number: p.requestNumber, category: this.categories.name(category, l) }), {
        app: 'PRO',
        data: { assignmentId: a.id },
      });
      await this.notifier.send([prev.userId], 'ASSIGNMENT_CANCELLED', () => ({ number: p.requestNumber }), {
        app: 'PRO',
        data: { assignmentId: a.id, requestId: a.requestId },
      });
      await this.access.announce(a, [prev.userId]);
      // The previous worker leaves the assignment room at once.
      await this.rooms.refreshUser(prev.userId);
    } catch (err) {
      this.log.warn(`after-reassign of ${a.id} failed: ${(err as Error).message}`);
    }
  }
}
