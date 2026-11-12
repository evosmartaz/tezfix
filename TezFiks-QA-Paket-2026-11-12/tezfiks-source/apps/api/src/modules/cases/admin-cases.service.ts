import { Injectable, Logger } from '@nestjs/common';
import { formatMoney, type CaseStatus, type CaseType } from '@tezfiks/shared';
import { PrismaService, inTx, type Tx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { AuditService } from '../../common/audit/audit.service';
import { ApiException } from '../../common/http/api-exception';
import { iso } from '../../common/mapping';
import { CancellationService, type CancellationResult } from '../requests/cancellation.service';
import { RequestStateService } from '../requests/request-state.service';
import { RequestNotifier } from '../requests/request-notifier';
import { DispatchService } from '../requests/dispatch/dispatch.service';
import { AssignmentAccess } from '../assignments/assignment-access.service';
import { CompletionService, type CompletionResult } from '../assignments/completion.service';
import { TrackingService } from '../assignments/tracking.service';
import { isUuid } from '../assignments/assignments.constants';
import type { Assignment, Case } from '../../generated/prisma/client';
import { CaseViews } from './case-views.service';

type ResolveOutcome = 'RESOLVED' | 'COMPLETE_CASH' | 'REPROPOSE_PRICE' | 'CANCEL_ASSIGNMENT';
const OPEN_CASE: readonly CaseStatus[] = ['OPEN', 'IN_REVIEW'];

/** What happened to the assignment while a case was decided (side effects run after commit). */
type AssignmentEffect =
  | { kind: 'none' }
  | { kind: 'completed'; res: CompletionResult }
  | { kind: 'cancelled'; res: CancellationResult }
  | { kind: 'reproposed'; a: Assignment; oldTotal: bigint | null };

/**
 * Admin "Müraciətlər" (spec 4.6, 6.3): list/detail/notes; guarantee re-dispatch (fee-free re-fix request offered first to the
 * original provider); price-dispute resolutions (complete as cash, propose a corrected price, cancel without fees); reject.
 * Every mutation is audited and the case opener is notified (CASE_UPDATED). Locks: request -> assignment -> case.
 */
@Injectable()
export class AdminCasesService {
  private readonly log = new Logger('AdminCases');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly cancellations: CancellationService,
    private readonly state: RequestStateService,
    private readonly notifier: RequestNotifier,
    private readonly dispatch: DispatchService,
    private readonly access: AssignmentAccess,
    private readonly completion: CompletionService,
    private readonly tracking: TrackingService,
    private readonly views: CaseViews,
  ) {}

  private async find(id: string): Promise<Case> {
    const c = isUuid(id) ? await this.prisma.case.findUnique({ where: { id } }) : null;
    if (!c) throw new ApiException('NOT_FOUND', { entity: 'case', id });
    return c;
  }

  async list(q: { cursor?: string; limit?: number; status?: CaseStatus; type?: CaseType }) {
    if (q.cursor !== undefined && !isUuid(q.cursor)) throw new ApiException('VALIDATION_FAILED', { in: 'query', field: 'cursor' });
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 100);
    const rows = await this.prisma.case.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.type ? { type: q.type } : {}),
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    return { items: await this.views.toRows(slice), nextCursor: hasMore ? slice[slice.length - 1]!.id : null };
  }

  async detail(id: string) {
    const c = await this.find(id);
    const [view, rows, assignment, notes] = await Promise.all([
      this.views.toView(c),
      this.views.toRows([c]),
      this.views.assignmentRow(c.assignmentId),
      this.prisma.caseNote.findMany({ where: { caseId: c.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    ]);
    return {
      case: view,
      row: rows[0]!,
      assignment,
      notes: notes.map((n) => ({ id: n.id, authorName: n.authorName, body: n.body, createdAt: iso(n.createdAt) })),
    };
  }

  private async adminName(adminId: string): Promise<string> {
    const a = await this.prisma.adminUser.findUnique({ where: { id: adminId }, select: { name: true, email: true } });
    return a?.name?.trim() || a?.email || 'admin';
  }

  private async addNoteTx(tx: Tx, caseId: string, adminId: string, body: string): Promise<void> {
    await tx.caseNote.create({
      data: { caseId, adminId, authorName: await this.adminName(adminId), body: body.trim(), createdAt: this.clock.now() },
    });
  }

  /** The case's request (or project) number for the CASE_UPDATED text. */
  private async notifyOpener(c: Case): Promise<void> {
    try {
      let number = 0;
      if (c.assignmentId) {
        const a = await this.prisma.assignment.findUnique({ where: { id: c.assignmentId }, select: { request: { select: { number: true } } } });
        number = a?.request.number ?? 0;
      } else if (c.projectId) {
        const p = await this.prisma.project.findUnique({ where: { id: c.projectId }, select: { number: true } });
        number = p?.number ?? 0;
      }
      await this.notifier.send([c.openedByUserId], 'CASE_UPDATED', () => ({ number }), {
        app: 'CUSTOMER',
        data: { caseId: c.id, status: c.status },
      });
    } catch (err) {
      this.log.warn(`case notification ${c.id} failed: ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ notes

  async addNote(adminId: string, id: string, body: string, ip: string | null) {
    const before = await this.find(id);
    await inTx(this.prisma, async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM cases WHERE id = $1::uuid FOR UPDATE', before.id);
      await this.addNoteTx(tx, before.id, adminId, body);
      // An admin looking at a new case takes it into review.
      await tx.case.updateMany({ where: { id: before.id, status: 'OPEN' }, data: { status: 'IN_REVIEW', updatedAt: this.clock.now() } });
    });
    await this.audit.log({
      actorType: 'ADMIN',
      actorId: adminId,
      action: 'case.note',
      entityType: 'Case',
      entityId: before.id,
      before: { status: before.status },
      after: { body: body.trim() },
      ip,
    });
    return this.detail(id);
  }

  // ------------------------------------------------------------- redispatch

  async redispatch(adminId: string, id: string, note: string | undefined, ip: string | null) {
    const c = await this.find(id);
    if (c.type !== 'GUARANTEE' || !c.assignmentId) throw new ApiException('INVALID_STATE', { type: c.type, reason: 'NOT_A_GUARANTEE_CLAIM' });
    if (!OPEN_CASE.includes(c.status)) throw new ApiException('INVALID_STATE', { status: c.status });
    // Idempotent per origin assignment: a repeated call returns the same re-fix request.
    const followUpRequestId = await this.dispatch.createGuaranteeFixRequest(c.assignmentId);
    const after = await inTx(this.prisma, async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM cases WHERE id = $1::uuid FOR UPDATE', c.id);
      const fresh = await tx.case.findUniqueOrThrow({ where: { id: c.id } });
      if (!OPEN_CASE.includes(fresh.status)) throw new ApiException('INVALID_STATE', { status: fresh.status });
      if (note?.trim()) await this.addNoteTx(tx, c.id, adminId, note);
      return tx.case.update({
        where: { id: c.id },
        data: {
          status: 'REDISPATCHED',
          followUpRequestId,
          resolvedByAdminId: adminId,
          resolutionNote: note?.trim() || null,
          updatedAt: this.clock.now(),
        },
      });
    });
    await this.audit.log({
      actorType: 'ADMIN',
      actorId: adminId,
      action: 'case.redispatch',
      entityType: 'Case',
      entityId: c.id,
      before: { status: c.status },
      after: { status: after.status, followUpRequestId },
      ip,
    });
    await this.notifyOpener(after);
    return this.detail(id);
  }

  // ---------------------------------------------------------------- resolve

  async resolve(adminId: string, id: string, body: { note: string; outcome?: ResolveOutcome; price?: { labor: number; materials: number } }, ip: string | null) {
    const c = await this.find(id);
    const outcome: ResolveOutcome = body.outcome ?? 'RESOLVED';
    if (!OPEN_CASE.includes(c.status)) throw new ApiException('INVALID_STATE', { status: c.status });
    const dispute = c.type === 'PRICE_DISPUTE' && !!c.assignmentId;
    if (!dispute && outcome !== 'RESOLVED') throw new ApiException('VALIDATION_FAILED', { field: 'outcome', reason: 'PRICE_DISPUTES_ONLY' });
    if (outcome === 'REPROPOSE_PRICE' && !body.price) throw new ApiException('VALIDATION_FAILED', { field: 'price', reason: 'required' });
    const { after, effect } = await this.decide(c, adminId, 'RESOLVED', body.note, async (tx, a) => {
      if (!a) return { kind: 'none' };
      return this.applyOutcome(tx, a, outcome, adminId, body.note, body.price);
    });
    await this.afterEffect(effect);
    await this.audit.log({
      actorType: 'ADMIN',
      actorId: adminId,
      action: 'case.resolve',
      entityType: 'Case',
      entityId: c.id,
      before: { status: c.status },
      after: { status: after.status, outcome, note: body.note.trim(), price: body.price ?? null },
      ip,
    });
    await this.notifyOpener(after);
    return this.detail(id);
  }

  async reject(adminId: string, id: string, note: string, ip: string | null) {
    const c = await this.find(id);
    if (!OPEN_CASE.includes(c.status)) throw new ApiException('INVALID_STATE', { status: c.status });
    const { after, effect } = await this.decide(c, adminId, 'REJECTED', note, async (tx, a) => {
      // A rejected price dispute: the proposed price stands and the customer can pay it again.
      if (a && c.type === 'PRICE_DISPUTE' && a.status === 'PRICE_DISPUTED') return this.repropose(tx, a, null);
      return { kind: 'none' };
    });
    await this.afterEffect(effect);
    await this.audit.log({
      actorType: 'ADMIN',
      actorId: adminId,
      action: 'case.reject',
      entityType: 'Case',
      entityId: c.id,
      before: { status: c.status },
      after: { status: after.status, note: note.trim() },
      ip,
    });
    await this.notifyOpener(after);
    return this.detail(id);
  }

  /** One transaction: request -> assignment -> case locks, the assignment effect, then the case decision. */
  private async decide(
    c: Case,
    adminId: string,
    status: 'RESOLVED' | 'REJECTED',
    note: string,
    effectFn: (tx: Tx, a: Assignment | null) => Promise<AssignmentEffect>,
  ): Promise<{ after: Case; effect: AssignmentEffect }> {
    return inTx(this.prisma, async (tx) => {
      const a = c.assignmentId ? await this.access.lockAssignment(tx, c.assignmentId) : null;
      await tx.$queryRawUnsafe('SELECT id FROM cases WHERE id = $1::uuid FOR UPDATE', c.id);
      const fresh = await tx.case.findUniqueOrThrow({ where: { id: c.id } });
      if (!OPEN_CASE.includes(fresh.status)) throw new ApiException('INVALID_STATE', { status: fresh.status });
      const effect = await effectFn(tx, a);
      const after = await tx.case.update({
        where: { id: c.id },
        data: { status, resolutionNote: note.trim(), resolvedByAdminId: adminId, updatedAt: this.clock.now() },
      });
      return { after, effect };
    });
  }

  private async applyOutcome(
    tx: Tx,
    a: Assignment,
    outcome: ResolveOutcome,
    adminId: string,
    note: string,
    price?: { labor: number; materials: number },
  ): Promise<AssignmentEffect> {
    const disputed = a.status === 'PRICE_DISPUTED' || a.status === 'PRICE_PROPOSED';
    switch (outcome) {
      case 'COMPLETE_CASH':
        if (!disputed) throw new ApiException('INVALID_STATE', { status: a.status });
        return { kind: 'completed', res: await this.completion.completeInTx(tx, a, 'CASH', null) };
      case 'REPROPOSE_PRICE':
        if (!disputed) throw new ApiException('INVALID_STATE', { status: a.status });
        return this.repropose(tx, a, price!);
      case 'CANCEL_ASSIGNMENT':
        // ADMIN actor: CANCELLED_FREE, the provider fee is released or refunded, no penalty, no strike.
        return { kind: 'cancelled', res: await this.cancellations.apply(a.id, { actor: 'ADMIN', kind: 'CANCEL', reason: note.trim(), byUserId: adminId }, tx) };
      case 'RESOLVED':
      default:
        // Resolved without another decision: the job must not stay disputed forever, so the proposed price stands again.
        return a.status === 'PRICE_DISPUTED' ? this.repropose(tx, a, null) : { kind: 'none' };
    }
  }

  /** Back to PRICE_PROPOSED (a corrected price, or the same one); the customer answers again and auto-completion restarts. */
  private async repropose(tx: Tx, a: Assignment, price: { labor: number; materials: number } | null): Promise<AssignmentEffect> {
    const labor = a.isGuaranteeFix ? 0 : price ? price.labor : Number(a.laborAmount ?? 0n);
    const materials = a.isGuaranteeFix ? 0 : price ? price.materials : Number(a.materialsAmount ?? 0n);
    const fresh = await tx.assignment.update({
      where: { id: a.id },
      data: {
        status: 'PRICE_PROPOSED',
        laborAmount: BigInt(labor),
        materialsAmount: BigInt(materials),
        totalAmount: BigInt(labor + materials),
        priceProposedAt: this.clock.now(),
      },
    });
    await this.state.recompute(a.requestId, tx);
    return { kind: 'reproposed', a: fresh, oldTotal: a.totalAmount };
  }

  private async afterEffect(effect: AssignmentEffect): Promise<void> {
    try {
      if (effect.kind === 'completed') await this.completion.afterComplete(effect.res);
      else if (effect.kind === 'cancelled') await effect.res.afterCommit();
      else if (effect.kind === 'reproposed') {
        const a = effect.a;
        await this.completion.scheduleAutoComplete(a.id, a.priceProposedAt!);
        await this.completion.cancelPendingIntents(a.id, 'JOB_PAYMENT');
        await this.access.announce(a);
        const p = await this.access.parties(a);
        const name = await this.tracking.providerName(a.handymanId);
        const total = Number(a.totalAmount ?? 0n);
        await this.notifier.send([p.customerUserId], 'PRICE_PROPOSED', (l) => ({ name, amount: formatMoney(total, l) }), {
          app: 'CUSTOMER',
          data: { assignmentId: a.id, requestId: a.requestId, amount: total },
        });
      }
    } catch (err) {
      this.log.warn(`case effect after-commit failed: ${(err as Error).message}`);
    }
  }
}
