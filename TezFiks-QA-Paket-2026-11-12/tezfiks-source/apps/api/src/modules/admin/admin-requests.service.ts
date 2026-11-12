import { Injectable, Logger } from '@nestjs/common';
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  formatMoney,
  isTerminalAssignment,
  tzFold,
  type ActorSide,
  type AdminAssignmentRow,
  type AdminLedgerTx,
  type AdminRequestRow,
  type AssignmentStatus,
  type EndpointBody,
  type EndpointOutput,
  type EndpointQuery,
  type Locale,
  type api,
} from '@tezfiks/shared';
import { PrismaService, inTx } from '../../infra/prisma.service';
import { RealtimeService } from '../../infra/realtime.service';
import { Clock } from '../../infra/clock';
import { ApiException } from '../../common/http/api-exception';
import { AuditService } from '../../common/audit/audit.service';
import { I18nService } from '../../common/i18n/i18n.service';
import { iso, num, numOrNull } from '../../common/mapping';
import { JobsService } from '../../infra/jobs.service';
import { CompletionService } from '../assignments/completion.service';
import { b3JobId } from '../assignments/assignments.constants';
import { CategoriesService } from '../categories/categories.service';
import { WalletAdminService } from '../wallet/wallet-admin.service';
import { WalletEventsService } from '../wallet/wallet-events.service';
import { CancellationService, type CancellationResult } from '../requests/cancellation.service';
import { DispatchService, type ClosedOffer } from '../requests/dispatch/dispatch.service';
import { FeesService } from '../requests/fees.service';
import { RequestStateService, lockRequestRow } from '../requests/request-state.service';
import { RequestNotifier } from '../requests/request-notifier';
import { RequestViews } from '../requests/views/request-views.service';
import type { Prisma } from '../../generated/prisma/client';
import {
  DEFAULT_LIMIT,
  SqlWhere,
  decodeTimeCursor,
  encodeTimeCursor,
  fullName,
  numberQuery,
  phoneSearchDigits,
} from './admin-common';

type RequestsQuery = EndpointQuery<typeof api.admin.requests>;
type RequestsPage = EndpointOutput<typeof api.admin.requests>;
export type AdminRequestDetail = EndpointOutput<typeof api.admin.request>;
type CancelBody = EndpointBody<typeof api.admin.cancelRequest>;
type TimelineItem = AdminRequestDetail['timeline'][number];
type AdminOfferRow = AdminRequestDetail['offers'][number];

const OPEN_REQUEST_STATUSES = new Set(['SEARCHING', 'ASSIGNED', 'IN_PROGRESS']);

const rowInclude = {
  customerAccount: { include: { owner: { select: { firstName: true, lastName: true, phone: true } } } },
  category: true,
  assignments: {
    include: {
      handyman: { select: { isBot: true, user: { select: { firstName: true, lastName: true } } } },
      company: { select: { name: true } },
    },
    orderBy: [{ acceptedAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.ServiceRequestInclude;
type RequestWithRefs = Prisma.ServiceRequestGetPayload<{ include: typeof rowInclude }>;

const assignmentInclude = {
  request: {
    select: {
      number: true,
      customerAccount: { select: { companyName: true, owner: { select: { firstName: true, lastName: true, phone: true } } } },
    },
  },
  handyman: { select: { user: { select: { firstName: true, lastName: true, phone: true } } } },
  company: { select: { name: true } },
} satisfies Prisma.AssignmentInclude;
type AssignmentWithRefs = Prisma.AssignmentGetPayload<{ include: typeof assignmentInclude }>;

/** Customer display name in admin views: the owner's full name, else the company name, else the phone (admins only). */
export function customerName(acc: { companyName: string | null; owner: { firstName: string | null; lastName: string | null; phone: string } }): string {
  return fullName(acc.owner.firstName, acc.owner.lastName) || acc.companyName || acc.owner.phone;
}

/** Admin view of one assignment, phones included (admin-only endpoints). */
export function adminAssignmentRow(a: AssignmentWithRefs): AdminAssignmentRow {
  const owner = a.request.customerAccount.owner;
  const provider = a.handyman.user;
  return {
    id: a.id,
    requestId: a.requestId,
    requestNumber: a.request.number,
    status: a.status,
    providerType: a.providerType,
    providerName: fullName(provider.firstName, provider.lastName),
    providerPhone: provider.phone,
    companyName: a.company?.name ?? null,
    customerName: customerName(a.request.customerAccount),
    customerPhone: owner.phone,
    acceptedAt: a.acceptedAt.toISOString(),
    completedAt: iso(a.completedAt),
    cancelledAt: iso(a.cancelledAt),
    cancelledBy: a.cancelledBy ?? null,
    price: a.totalAmount != null ? { labor: num(a.laborAmount), materials: num(a.materialsAmount), total: num(a.totalAmount) } : null,
    paymentMethod: a.paymentMethod ?? null,
    fee: a.feeHoldId || a.feeAmount > 0n ? { amount: num(a.feeAmount), captured: a.feeCaptured, refunded: a.feeRefunded } : null,
    contactUnlockedAt: iso(a.contactUnlockedAt),
    etaSec: numOrNull(a.etaSec),
  };
}

/**
 * Admin requests (Sifarişlər): list with filters and tz_fold search, detail with assignments (phones), offers, ledger and a
 * timeline, and the admin force-cancel through B1's CancellationService (actor ADMIN).
 */
@Injectable()
export class AdminRequestsService {
  private readonly log = new Logger('AdminRequests');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
    private readonly i18n: I18nService,
    private readonly categories: CategoriesService,
    private readonly walletAdmin: WalletAdminService,
    private readonly walletEvents: WalletEventsService,
    private readonly cancellations: CancellationService,
    private readonly dispatch: DispatchService,
    private readonly fees: FeesService,
    private readonly state: RequestStateService,
    private readonly notifier: RequestNotifier,
    private readonly views: RequestViews,
    private readonly completion: CompletionService,
    private readonly jobs: JobsService,
  ) {}

  // ------------------------------------------------------------------ list

  async list(q: RequestsQuery, locale: Locale): Promise<RequestsPage> {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const w = new SqlWhere();
    if (q.status) w.add(`r.status = ${w.p(q.status)}::"RequestStatus"`);
    if (q.from) w.add(`r."createdAt" >= ${w.p(q.from)}::timestamptz`);
    if (q.to) w.add(`r."createdAt" <= ${w.p(q.to)}::timestamptz`);
    if (q.q) {
      const f = w.p(tzFold(q.q));
      const ors = [
        `strpos(tz_fold(coalesce(cu."firstName", '') || ' ' || coalesce(cu."lastName", '')), ${f}) > 0`,
        `strpos(tz_fold(coalesce(ca."companyName", '')), ${f}) > 0`,
        `EXISTS (SELECT 1 FROM assignments qa JOIN handyman_profiles qh ON qh.id = qa."handymanId" JOIN users qu ON qu.id = qh."userId"
                 LEFT JOIN companies qc ON qc.id = qa."companyId"
                 WHERE qa."requestId" = r.id AND (strpos(tz_fold(coalesce(qu."firstName", '') || ' ' || coalesce(qu."lastName", '')), ${f}) > 0
                   OR strpos(tz_fold(coalesce(qc.name, '')), ${f}) > 0))`,
      ];
      const n = numberQuery(q.q);
      if (n !== null) ors.push(`r.number = ${w.p(n)}::int`);
      const digits = phoneSearchDigits(q.q);
      if (digits && digits.length >= 5) {
        const d = w.p(digits);
        ors.push(`strpos(regexp_replace(cu.phone, '[^0-9]', '', 'g'), ${d}) > 0`);
        ors.push(`EXISTS (SELECT 1 FROM assignments pa JOIN handyman_profiles ph ON ph.id = pa."handymanId" JOIN users pu ON pu.id = ph."userId"
                  WHERE pa."requestId" = r.id AND strpos(regexp_replace(pu.phone, '[^0-9]', '', 'g'), ${d}) > 0)`);
      }
      w.add(`(${ors.join(' OR ')})`);
    }
    const cur = decodeTimeCursor(q.cursor);
    if (cur) w.add(`(r."createdAt", r.id) < (${w.p(cur.c)}::timestamptz, ${w.p(cur.i)}::uuid)`);
    const found = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT r.id FROM service_requests r
       JOIN customer_accounts ca ON ca.id = r."customerAccountId"
       JOIN users cu ON cu.id = ca."ownerUserId"
       ${w.sql} ORDER BY r."createdAt" DESC, r.id DESC LIMIT ${limit + 1}`,
      ...w.params,
    );
    const hasMore = found.length > limit;
    const items = await this.rows(found.slice(0, limit).map((r) => r.id), locale);
    const last = hasMore ? items[items.length - 1] : undefined;
    return { items, nextCursor: last ? encodeTimeCursor(last.createdAt, last.id) : null };
  }

  /** Admin rows in the order of `ids`. */
  async rows(ids: string[], locale: Locale): Promise<AdminRequestRow[]> {
    if (!ids.length) return [];
    const reqs = await this.prisma.serviceRequest.findMany({ where: { id: { in: ids } }, include: rowInclude });
    const byId = new Map(reqs.map((r) => [r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is RequestWithRefs => !!r)
      .map((r) => this.rowOf(r, locale));
  }

  private rowOf(r: RequestWithRefs, locale: Locale): AdminRequestRow {
    // Primary assignment: the first one still working on the job, else the most recent one.
    const live = r.assignments.find((a) => !isTerminalAssignment(a.status as AssignmentStatus));
    const primary = live ?? r.assignments[r.assignments.length - 1] ?? null;
    let providerName: string | null = null;
    if (primary) {
      const name = fullName(primary.handyman.user.firstName, primary.handyman.user.lastName);
      providerName = primary.company ? (name ? `${name} (${primary.company.name})` : primary.company.name) : name || null;
    }
    const fee = r.assignments.filter((a) => a.feeCaptured && !a.feeRefunded).reduce((sum, a) => sum + num(a.feeAmount), 0);
    return {
      id: r.id,
      number: r.number,
      customerName: customerName(r.customerAccount),
      providerName,
      categoryName: this.categories.name(r.category, locale),
      status: r.status,
      assignmentStatus: primary?.status ?? null,
      timing: r.timing,
      slots: r.slotsRequested,
      fee,
      createdAt: r.createdAt.toISOString(),
      isBot: r.isDemo || r.assignments.some((a) => a.handyman.isBot),
    };
  }

  // ---------------------------------------------------------------- detail

  async detail(id: string, locale: Locale): Promise<AdminRequestDetail> {
    const r = await this.prisma.serviceRequest.findUnique({
      where: { id },
      include: { customerAccount: { include: { owner: { select: { id: true, firstName: true, lastName: true, phone: true } } } }, category: true },
    });
    if (!r) throw new ApiException('NOT_FOUND', { entity: 'request' });
    const { customerAccount: acc, category, ...plain } = r;
    const [request, assignments, offers, ledger] = await Promise.all([
      this.views.toRequestDetail(plain, locale),
      this.prisma.assignment.findMany({ where: { requestId: id }, include: assignmentInclude, orderBy: [{ acceptedAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.offer.findMany({
        where: { requestId: id },
        include: { handyman: { select: { user: { select: { firstName: true, lastName: true } } } }, company: { select: { name: true } } },
        orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
      }),
      this.walletAdmin.forRequest(id),
    ]);
    const assignmentIds = assignments.map((a) => a.id);
    const [disputes, intents] = await Promise.all([
      assignmentIds.length
        ? this.prisma.case.findMany({ where: { assignmentId: { in: assignmentIds }, type: 'PRICE_DISPUTE' }, orderBy: { createdAt: 'asc' } })
        : [],
      assignmentIds.length
        ? this.prisma.paymentIntent.findMany({ where: { assignmentId: { in: assignmentIds } }, orderBy: { createdAt: 'asc' } })
        : [],
    ]);
    const offerRows: AdminOfferRow[] = offers.map((o) => ({
      id: o.id,
      target: o.targetType,
      handymanName: o.handyman ? fullName(o.handyman.user.firstName, o.handyman.user.lastName) || null : null,
      companyName: o.company?.name ?? null,
      step: o.step,
      ring: o.ring,
      status: o.status,
      sentAt: o.sentAt.toISOString(),
      respondedAt: iso(o.respondedAt),
      distanceM: o.distanceM ?? null,
    }));
    const cName = customerName(acc);
    const timeline = this.timeline({
      r: plain,
      categoryName: this.categories.name(category, locale),
      customerName: cName,
      assignments,
      offers: offerRows,
      ledger,
      disputes,
      intents,
      locale,
    });
    return {
      request,
      customer: {
        accountId: acc.id,
        userId: acc.owner.id,
        name: cName,
        phone: acc.owner.phone,
        type: acc.type,
        companyName: acc.companyName ?? null,
      },
      assignments: assignments.map(adminAssignmentRow),
      offers: offerRows,
      ledger,
      timeline,
    };
  }

  /**
   * Request timeline. Event keys match the admin panel's `panel.admin.timeline.*` labels after "." -> "_":
   * request.created, search.started, offers.sent, assignment.accepted, en_route, contact_unlocked, arrived, price_proposed,
   * price_disputed, completed, cancelled, expired, payment.succeeded, payment.failed, fee.captured, fee.refunded, penalty.
   */
  private timeline(input: {
    r: { createdAt: Date; status: string; slotsRequested: number; searchStartedAt: Date | null; searchEndsAt: Date | null; updatedAt: Date; cancelledAt: Date | null; cancelledBy: ActorSide | null; cancelReason: string | null };
    categoryName: string;
    customerName: string;
    assignments: AssignmentWithRefs[];
    offers: AdminOfferRow[];
    ledger: AdminLedgerTx[];
    disputes: Array<{ createdAt: Date; assignmentId: string | null; description: string }>;
    intents: Array<{ status: string; purpose: string; amount: bigint; completedAt: Date | null; updatedAt: Date }>;
    locale: Locale;
  }): TimelineItem[] {
    const { r, locale } = input;
    const t = (key: string, vars?: Record<string, string | number>) => this.i18n.t(locale, `server.admin.${key}`, vars);
    const money = (v: number) => formatMoney(v, locale);
    const items: TimelineItem[] = [];
    const push = (at: Date | string | null | undefined, event: string, actor: string | null, details: string | null) => {
      if (!at) return;
      items.push({ at: typeof at === 'string' ? at : at.toISOString(), event, actor, details });
    };
    const providerOf = new Map(
      input.assignments.map((a) => {
        const n = fullName(a.handyman.user.firstName, a.handyman.user.lastName);
        return [a.id, a.company ? (n ? `${n} (${a.company.name})` : a.company.name) : n] as const;
      }),
    );
    const sideName = (side: ActorSide | null, providerName: string | null): string | null => {
      if (!side) return null;
      if (side === 'CUSTOMER') return input.customerName;
      if (side === 'PROVIDER') return providerName || t('actor.PROVIDER');
      return t(`actor.${side}`);
    };

    // An assignment cancelled as part of the request's own cancellation (same side, same moment) is shown once, as the
    // request's "cancelled" event.
    const reqCancelAt = r.status === 'CANCELLED' ? r.cancelledAt : null;
    const partOfRequestCancel = (a: AssignmentWithRefs): boolean =>
      !!reqCancelAt &&
      !!a.cancelledAt &&
      (a.cancelledBy ?? null) === (r.cancelledBy ?? null) &&
      Math.abs(a.cancelledAt.getTime() - reqCancelAt.getTime()) <= 5_000;
    let requestCancelProvider: string | null = null;

    push(r.createdAt, 'request.created', input.customerName, t('timeline.created', { category: input.categoryName, slots: r.slotsRequested }));
    push(r.searchStartedAt, 'search.started', t('actor.SYSTEM'), null);

    const steps = new Map<number, { at: string; ring: number; n: number }>();
    for (const o of input.offers) {
      const s = steps.get(o.step);
      if (!s) steps.set(o.step, { at: o.sentAt, ring: o.ring, n: 1 });
      else {
        s.n += 1;
        if (o.sentAt < s.at) s.at = o.sentAt;
      }
    }
    for (const [step, s] of [...steps.entries()].sort((a, b) => a[0] - b[0])) {
      push(s.at, 'offers.sent', t('actor.SYSTEM'), t('timeline.offersSent', { step, ring: s.ring, n: s.n }));
    }

    for (const a of input.assignments) {
      const pn = providerOf.get(a.id) ?? null;
      push(a.acceptedAt, 'assignment.accepted', pn, a.isGuaranteeFix ? t('timeline.guaranteeFix') : null);
      push(a.enRouteAt, 'en_route', pn, null);
      push(a.contactUnlockedAt, 'contact_unlocked', t('actor.SYSTEM'), null);
      push(a.arrivedAt, 'arrived', pn, null);
      if (a.priceProposedAt && a.totalAmount != null) {
        push(
          a.priceProposedAt,
          'price_proposed',
          pn,
          t('timeline.price', { labor: money(num(a.laborAmount)), materials: money(num(a.materialsAmount)), total: money(num(a.totalAmount)) }),
        );
      }
      if (a.completedAt) {
        push(a.completedAt, 'completed', input.customerName, a.paymentMethod === 'CARD' ? t('timeline.paidCard') : a.paymentMethod === 'CASH' ? t('timeline.paidCash') : null);
      }
      if (a.cancelledAt) {
        if (partOfRequestCancel(a)) requestCancelProvider ??= pn;
        else push(a.cancelledAt, 'cancelled', sideName(a.cancelledBy ?? null, pn), a.cancelReason ?? null);
      }
    }
    for (const d of input.disputes) push(d.createdAt, 'price_disputed', input.customerName, d.description);
    for (const p of input.intents) {
      const details = t('timeline.payment', { purpose: t(`purpose.${p.purpose}`), amount: money(num(p.amount)) });
      if (p.status === 'SUCCEEDED') push(p.completedAt ?? p.updatedAt, 'payment.succeeded', input.customerName, details);
      else if (p.status === 'FAILED') push(p.completedAt ?? p.updatedAt, 'payment.failed', input.customerName, details);
    }
    for (const tx of input.ledger) {
      const event =
        tx.kind === 'REQUEST_FEE_CAPTURE' ? 'fee.captured' : tx.kind === 'REQUEST_FEE_REFUND' ? 'fee.refunded' : tx.kind === 'CANCEL_PENALTY' ? 'penalty' : null;
      if (!event) continue;
      const amount = tx.entries.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
      push(tx.createdAt, event, tx.actor ?? t('actor.SYSTEM'), t('timeline.amount', { amount: money(amount) }));
    }

    if (r.status === 'CANCELLED') {
      const side = r.cancelledBy ?? null;
      const onlyAdmin = side === 'ADMIN' && r.cancelReason ? t('timeline.adminCancel', { reason: r.cancelReason }) : (r.cancelReason ?? null);
      push(r.cancelledAt ?? r.updatedAt, 'cancelled', sideName(side, requestCancelProvider), onlyAdmin);
    } else if (r.status === 'EXPIRED') {
      // searchEndsAt is business (Clock) time; updatedAt is stamped by Prisma with wall time and is only a fallback.
      push(r.searchEndsAt ?? r.updatedAt, 'expired', t('actor.SYSTEM'), null);
    }
    return items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  // ---------------------------------------------------------------- cancel

  /**
   * Admin force-cancel of a whole request. Lock order for the admin actor (there is no acting user row): request row first,
   * then CancellationService (actor ADMIN) per active assignment, which re-locks the request (no-op) and locks the assignment.
   * No fee is kept and no strike is given; `chargeCustomer` applies the late-cancel penalty to the customer (debt allowed)
   * with the provider compensated. Open slots are cancelled (emergency fees released), SENT offers closed, search stopped.
   * Open PRICE_DISPUTE cases of the cancelled jobs are closed as RESOLVED (audited, opener notified), and after commit the
   * jobs' open card checkouts (JOB_PAYMENT intents) are cancelled and their cash auto-completion jobs dropped.
   */
  async cancel(adminId: string, requestId: string, body: CancelBody, ip: string | null, locale: Locale): Promise<AdminRequestDetail> {
    const exists = await this.prisma.serviceRequest.findUnique({ where: { id: requestId }, select: { id: true } });
    if (!exists) throw new ApiException('NOT_FOUND', { entity: 'request' });
    const reason = body.reason.trim();
    const chargeCustomer = body.chargeCustomer ?? false;
    const out = await inTx(this.prisma, async (tx) => {
      await lockRequestRow(tx, requestId);
      const r = await tx.serviceRequest.findUniqueOrThrow({ where: { id: requestId }, include: { assignments: { orderBy: [{ acceptedAt: 'asc' }, { id: 'asc' }] } } });
      if (!OPEN_REQUEST_STATUSES.has(r.status)) throw new ApiException('INVALID_STATE', { status: r.status });
      const before = {
        status: r.status,
        isSearching: r.isSearching,
        assignments: r.assignments.map((a) => ({ id: a.id, status: a.status })),
      };
      const results: CancellationResult[] = [];
      for (const a of r.assignments) {
        if ((ACTIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(a.status)) {
          results.push(
            await this.cancellations.apply(a.id, { actor: 'ADMIN', kind: 'CANCEL', reason, byUserId: adminId, chargeCustomer }, tx),
          );
        }
      }
      const now = this.clock.now();
      // Price disputes of the cancelled jobs are moot now: close them as RESOLVED with the admin's reason (lock order
      // request -> assignment -> case, as in B3's case decisions, so a concurrent case decision waits and then sees it closed).
      const cancelledIds = results.map((x) => x.assignment.id);
      const closedCases: Array<{ id: string; openedByUserId: string }> = [];
      if (cancelledIds.length) {
        const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM cases WHERE "assignmentId" = ANY($1::uuid[]) AND type = 'PRICE_DISPUTE' AND status IN ('OPEN', 'IN_REVIEW')
           ORDER BY id FOR UPDATE`,
          cancelledIds,
        );
        for (const { id } of locked) {
          const c = await tx.case.findUniqueOrThrow({ where: { id } });
          await tx.case.update({
            where: { id },
            data: { status: 'RESOLVED', resolutionNote: reason, resolvedByAdminId: adminId, updatedAt: now },
          });
          await this.audit.log(
            {
              actorType: 'ADMIN',
              actorId: adminId,
              action: 'case.resolve',
              entityType: 'Case',
              entityId: id,
              before: { status: c.status },
              after: { status: 'RESOLVED', outcome: 'CANCEL_ASSIGNMENT', note: reason, via: 'request.cancel', requestId },
              ip,
            },
            tx,
          );
          closedCases.push({ id, openedByUserId: c.openedByUserId });
        }
      }
      const closed: ClosedOffer[] = await this.dispatch.closeSentOffers(requestId, 'CANCELLED', tx);
      const open = await tx.requestSlot.findMany({ where: { requestId, status: 'OPEN' }, select: { id: true } });
      const accounts: string[] = [];
      for (const slot of open) {
        await tx.requestSlot.update({ where: { id: slot.id }, data: { status: 'CANCELLED' } });
        const acc = await this.fees.releaseOrRefundEmergency(slot.id, r.number, tx);
        if (acc) accounts.push(acc);
      }
      const completed = await tx.assignment.count({ where: { requestId, status: 'COMPLETED' } });
      const updated = await tx.serviceRequest.update({
        where: { id: requestId },
        data: {
          status: completed > 0 ? 'COMPLETED' : 'CANCELLED',
          isSearching: false,
          cancelledAt: completed > 0 ? null : now,
          cancelledBy: completed > 0 ? null : 'ADMIN',
          cancelReason: completed > 0 ? null : reason,
        },
        include: { assignments: { select: { id: true, status: true } } },
      });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: adminId,
          action: 'request.cancel',
          entityType: 'ServiceRequest',
          entityId: requestId,
          before,
          after: {
            status: updated.status,
            isSearching: updated.isSearching,
            assignments: updated.assignments.map((a) => ({ id: a.id, status: a.status })),
            reason,
            chargeCustomer,
            customerPenalty: results.reduce((s, x) => s + x.outcome.customerPenalty, 0),
            closedCases: closedCases.map((c) => c.id),
          },
          ip,
        },
        tx,
      );
      return { results, closed, accounts, number: r.number, closedCases };
    });

    try {
      await this.dispatch.cancelSearchJobs(requestId);
      await this.dispatch.announceClosed(out.closed);
    } catch (err) {
      this.log.warn(`after-commit (search stop) of admin cancel ${requestId} failed: ${(err as Error).message}`);
    }
    for (const r of out.results) await r.afterCommit();
    for (const r of out.results) {
      // A cancelled job takes no more payment: open card checkouts are cancelled and the cash auto-completion is dropped.
      try {
        await this.jobs.cancel(b3JobId.autoComplete(r.assignment.id));
        await this.completion.cancelPendingIntents(r.assignment.id, 'JOB_PAYMENT');
      } catch (err) {
        this.log.warn(`after-commit (payments) of admin cancel ${r.assignment.id} failed: ${(err as Error).message}`);
      }
    }
    for (const c of out.closedCases) {
      try {
        await this.notifier.send([c.openedByUserId], 'CASE_UPDATED', () => ({ number: out.number }), {
          app: 'CUSTOMER',
          data: { caseId: c.id, status: 'RESOLVED' },
        });
        this.realtime.toAdmins('admin:event', { type: 'CASE_RESOLVED', entityId: c.id });
      } catch (err) {
        this.log.warn(`after-commit (case) of admin cancel ${c.id} failed: ${(err as Error).message}`);
      }
    }
    try {
      await this.walletEvents.notifyAccounts(out.accounts);
      await this.state.announce(requestId);
      if (out.results.length === 0) {
        // Nobody was assigned: the customer only learns about it from this notification (assignment cancellations notify themselves).
        const owner = await this.prisma.serviceRequest.findUnique({
          where: { id: requestId },
          select: { customerAccount: { select: { ownerUserId: true } } },
        });
        await this.notifier.send([owner?.customerAccount.ownerUserId], 'REQUEST_CANCELLED', () => ({ number: out.number }), {
          app: 'CUSTOMER',
          data: { requestId },
        });
      }
      this.realtime.toAdmins('admin:event', { type: 'REQUEST_CANCELLED', entityId: requestId });
    } catch (err) {
      this.log.warn(`after-commit of admin cancel ${requestId} failed: ${(err as Error).message}`);
    }
    return this.detail(requestId, locale);
  }
}
