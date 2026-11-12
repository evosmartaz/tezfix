import { Injectable } from '@nestjs/common';
import type { RequestStatus } from '@tezfiks/shared';
import { PrismaService, type Db, type Tx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { RealtimeService } from '../../infra/realtime.service';
import { TERMINAL_REQUEST_STATUSES } from './requests.constants';

const IN_PROGRESS_STATUSES = new Set(['EN_ROUTE', 'ARRIVED', 'PRICE_PROPOSED', 'PRICE_DISPUTED']);

/**
 * Locks the request row (FOR UPDATE). Every transaction that changes a request's offers, slots or assignments takes this
 * lock first (accept, whole-request cancel, search end/stop, sending offers, assignment cancellation), so they run one
 * after the other per request and always lock rows in the same order (request -> offer/slot/assignment): no deadlocks.
 */
export async function lockRequestRow(tx: Tx, requestId: string): Promise<void> {
  await tx.$queryRawUnsafe('SELECT id FROM service_requests WHERE id = $1::uuid FOR UPDATE', requestId);
}

/** Who/why to record when a recompute turns the request CANCELLED (set only when the request has no cancelledBy yet). */
export interface RecomputeCancelContext {
  cancelledBy?: 'CUSTOMER' | 'PROVIDER' | 'ADMIN' | 'SYSTEM' | null;
  cancelReason?: string | null;
}

export interface RecomputeResult {
  requestId: string;
  before: RequestStatus;
  after: RequestStatus;
  changed: boolean;
}

/**
 * Request status from its slots and assignments (spec 6.1):
 * IN_PROGRESS when any assignment is EN_ROUTE/ARRIVED/PRICE_PROPOSED/PRICE_DISPUTED; ASSIGNED when any is ACCEPTED (or a slot
 * is done while others are still searched); SEARCHING while open slots are searched; otherwise COMPLETED (≥1 completed),
 * CANCELLED (no slot open or completed and at least one cancelled) or EXPIRED (search ended with nothing filled). Terminal requests never change. Exported for lane B3.
 */
@Injectable()
export class RequestStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly realtime: RealtimeService,
  ) {}

  async recompute(
    requestId: string,
    db: Db = this.prisma,
    cancel?: RecomputeCancelContext,
  ): Promise<RecomputeResult> {
    const req = await db.serviceRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        isSearching: true,
        cancelledAt: true,
        cancelledBy: true,
        slots: { select: { status: true } },
        assignments: { select: { status: true } },
      },
    });
    if (!req) throw new Error(`request ${requestId} not found`);
    const before = req.status as RequestStatus;
    if ((TERMINAL_REQUEST_STATUSES as readonly string[]).includes(before))
      return { requestId, before, after: before, changed: false };

    const statuses = req.assignments.map((a) => a.status as string);
    const completed = statuses.includes('COMPLETED');
    const open = req.slots.filter((s) => s.status === 'OPEN').length;
    let after: RequestStatus;
    if (statuses.some((s) => IN_PROGRESS_STATUSES.has(s))) after = 'IN_PROGRESS';
    else if (statuses.includes('ACCEPTED')) after = 'ASSIGNED';
    else if (open > 0) after = completed ? 'ASSIGNED' : 'SEARCHING';
    else if (completed) after = 'COMPLETED';
    else if (req.slots.some((s) => s.status === 'CANCELLED')) after = 'CANCELLED';
    else after = 'EXPIRED';

    if (after === before) return { requestId, before, after, changed: false };
    // Who cancelled: the caller's context, else the most recent cancelled assignment (B3 paths, search end after a cancel).
    let cancelCtx: RecomputeCancelContext | null = null;
    if (after === 'CANCELLED' && !req.cancelledBy) {
      if (cancel?.cancelledBy) cancelCtx = cancel;
      else {
        const last = await db.assignment.findFirst({
          where: { requestId, cancelledBy: { not: null } },
          orderBy: [{ cancelledAt: 'desc' }, { id: 'desc' }],
          select: { cancelledBy: true, cancelReason: true },
        });
        if (last) cancelCtx = { cancelledBy: last.cancelledBy, cancelReason: last.cancelReason };
      }
    }
    const terminal = (TERMINAL_REQUEST_STATUSES as readonly string[]).includes(after);
    const res = await db.serviceRequest.updateMany({
      where: { id: requestId, status: before },
      data: {
        status: after,
        ...(terminal ? { isSearching: false } : {}),
        ...(after === 'CANCELLED' && !req.cancelledAt ? { cancelledAt: this.clock.now() } : {}),
        ...(cancelCtx?.cancelledBy
          ? { cancelledBy: cancelCtx.cancelledBy, cancelReason: cancelCtx.cancelReason ?? null }
          : {}),
      },
    });
    return { requestId, before, after, changed: res.count > 0 };
  }

  /** Emits request:updated (request room + the customer's user room) with the current status. Call after commit. */
  async announce(requestId: string): Promise<void> {
    const req = await this.prisma.serviceRequest.findUnique({
      where: { id: requestId },
      select: { status: true, customerAccount: { select: { ownerUserId: true } } },
    });
    if (!req) return;
    const payload = { requestId, status: req.status as RequestStatus };
    this.realtime.toRequest(requestId, 'request:updated', payload);
    this.realtime.toUser(req.customerAccount.ownerUserId, 'request:updated', payload);
  }
}
