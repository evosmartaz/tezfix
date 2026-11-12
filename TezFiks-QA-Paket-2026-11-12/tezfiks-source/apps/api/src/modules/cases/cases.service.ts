import { Injectable, Logger } from '@nestjs/common';
import type { CaseView, CustomerAssignment, Locale } from '@tezfiks/shared';
import { PrismaService, inTx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { JobsService } from '../../infra/jobs.service';
import { RealtimeService } from '../../infra/realtime.service';
import { ApiException } from '../../common/http/api-exception';
import { FilesService } from '../files/files.service';
import { lockActiveUser } from '../customer/customer.service';
import { RequestStateService } from '../requests/request-state.service';
import { RequestNotifier } from '../requests/request-notifier';
import { RequestViews } from '../requests/views/request-views.service';
import { AssignmentAccess } from '../assignments/assignment-access.service';
import { CompletionService } from '../assignments/completion.service';
import { b3JobId, isUuid } from '../assignments/assignments.constants';
import { CaseViews } from './case-views.service';

/** Customer side of cases: price disputes, guarantee claims, "my cases". */
@Injectable()
export class CasesService {
  private readonly log = new Logger('Cases');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    private readonly realtime: RealtimeService,
    private readonly files: FilesService,
    private readonly state: RequestStateService,
    private readonly notifier: RequestNotifier,
    private readonly views: RequestViews,
    private readonly access: AssignmentAccess,
    private readonly completion: CompletionService,
    private readonly caseViews: CaseViews,
  ) {}

  async listMine(userId: string, q: { cursor?: string; limit?: number }): Promise<{ items: CaseView[]; nextCursor: string | null }> {
    if (q.cursor !== undefined && !isUuid(q.cursor)) throw new ApiException('VALIDATION_FAILED', { in: 'query', field: 'cursor' });
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 100);
    const rows = await this.prisma.case.findMany({
      where: { openedByUserId: userId, ...(q.cursor ? { id: { lt: q.cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    return { items: await this.caseViews.toViews(slice), nextCursor: hasMore ? slice[slice.length - 1]!.id : null };
  }

  /** PRICE_PROPOSED -> PRICE_DISPUTED and a PRICE_DISPUTE case for an admin; the cash auto-completion stops. */
  async disputePrice(userId: string, assignmentId: string, reason: string, locale: Locale): Promise<CustomerAssignment> {
    await this.access.forCustomer(userId, assignmentId);
    const now = this.clock.now();
    const { a, caseId } = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      const a = await this.access.lockAssignment(tx, assignmentId);
      if (a.status !== 'PRICE_PROPOSED') throw new ApiException('INVALID_STATE', { status: a.status });
      await tx.assignment.update({ where: { id: a.id }, data: { status: 'PRICE_DISPUTED' } });
      const c = await tx.case.create({
        data: {
          type: 'PRICE_DISPUTE',
          status: 'OPEN',
          assignmentId: a.id,
          openedByUserId: userId,
          description: reason.trim(),
          createdAt: now,
          updatedAt: now,
        },
      });
      await this.state.recompute(a.requestId, tx);
      return { a: await tx.assignment.findUniqueOrThrow({ where: { id: a.id } }), caseId: c.id };
    });
    try {
      await this.jobs.cancel(b3JobId.autoComplete(a.id));
      await this.completion.cancelPendingIntents(a.id, 'JOB_PAYMENT');
      this.realtime.toAdmins('admin:event', { type: 'CASE_OPENED', entityId: caseId });
      await this.access.announce(a);
      const p = await this.access.parties(a);
      await this.notifier.send([p.providerUserId, ...p.managerUserIds], 'CASE_UPDATED', () => ({ number: p.requestNumber }), {
        app: 'PRO',
        data: { caseId, assignmentId: a.id },
      });
    } catch (err) {
      this.log.warn(`dispute after-commit of ${a.id} failed: ${(err as Error).message}`);
    }
    return this.views.toCustomerAssignment(a.id, locale);
  }

  /** Card-paid job within guaranteeUntil -> GUARANTEE case (spec 4.6); otherwise GUARANTEE_NOT_AVAILABLE. */
  async guaranteeClaim(userId: string, assignmentId: string, body: { description: string; photoFileIds: string[] }): Promise<CaseView> {
    await this.access.forCustomer(userId, assignmentId);
    await this.files.assertOwned(userId, body.photoFileIds, ['CASE_PHOTO', 'REQUEST_PHOTO']);
    const now = this.clock.now();
    const c = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      const a = await this.access.lockAssignment(tx, assignmentId);
      const paid = a.paymentIntentId ? await tx.paymentIntent.findUnique({ where: { id: a.paymentIntentId }, select: { status: true } }) : null;
      if (
        a.status !== 'COMPLETED' ||
        a.paymentMethod !== 'CARD' ||
        paid?.status !== 'SUCCEEDED' ||
        !a.guaranteeUntil ||
        a.guaranteeUntil.getTime() < now.getTime()
      )
        throw new ApiException('GUARANTEE_NOT_AVAILABLE', {
          status: a.status,
          paymentMethod: a.paymentMethod ?? null,
          guaranteeUntil: a.guaranteeUntil?.toISOString() ?? null,
        });
      const open = await tx.case.findFirst({
        where: { assignmentId: a.id, type: 'GUARANTEE', status: { in: ['OPEN', 'IN_REVIEW'] } },
        select: { id: true },
      });
      if (open) throw new ApiException('CONFLICT', { reason: 'CASE_ALREADY_OPEN', caseId: open.id });
      return tx.case.create({
        data: {
          type: 'GUARANTEE',
          status: 'OPEN',
          assignmentId: a.id,
          openedByUserId: userId,
          description: body.description.trim(),
          photoFileIds: [...new Set(body.photoFileIds)],
          createdAt: now,
          updatedAt: now,
        },
      });
    });
    this.realtime.toAdmins('admin:event', { type: 'CASE_OPENED', entityId: c.id });
    return this.caseViews.toView(c);
  }
}
