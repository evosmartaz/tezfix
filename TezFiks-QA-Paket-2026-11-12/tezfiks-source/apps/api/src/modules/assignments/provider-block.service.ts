import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService, inTx } from '../../infra/prisma.service';
import { DomainEvents } from '../../infra/events';
import { ReconcilerService } from '../../infra/reconciler.service';
import { I18nService } from '../../common/i18n/i18n.service';
import { CancellationService } from '../requests/cancellation.service';
import { RequestStateService, lockRequestRow } from '../requests/request-state.service';
import { DispatchService } from '../requests/dispatch/dispatch.service';
import type { Prisma } from '../../generated/prisma/client';
import { B3_RECONCILER_TASK, BLOCK_CANCELLABLE } from './assignments.constants';

/**
 * When an admin blocks a handyman, a company or a user (B2 domain events `handyman.status` / `company.status` BLOCKED,
 * `user.blocked`), their running jobs that are not done yet (ACCEPTED / EN_ROUTE / ARRIVED) are force-cancelled through
 * CancellationService with actor ADMIN (no fee kept, no penalty, no strike) and the slot is re-dispatched, so the customer is
 * not left waiting. Jobs with a proposed or disputed price stay: the work is done and the customer can still pay or dispute.
 * The post-commit events can be lost (crash between B2's commit and the listener, a failed cancel): the
 * `assignments.blockedProviders` reconciler task sweeps active jobs of BLOCKED profiles, companies and users.
 */
@Injectable()
export class ProviderBlockService implements OnModuleInit {
  private readonly log = new Logger('ProviderBlock');

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    private readonly reconciler: ReconcilerService,
    private readonly i18n: I18nService,
    private readonly cancellations: CancellationService,
    private readonly state: RequestStateService,
    private readonly dispatch: DispatchService,
  ) {}

  onModuleInit(): void {
    this.events.on('handyman.status', async (e) => {
      if (e.status === 'BLOCKED') await this.cancelActive({ handymanId: e.handymanId }, 'providerBlocked');
    });
    this.events.on('company.status', async (e) => {
      if (e.status === 'BLOCKED') await this.cancelActive({ companyId: e.companyId }, 'companyBlocked');
    });
    this.events.on('user.blocked', async (e) => {
      const p = await this.prisma.handymanProfile.findUnique({ where: { userId: e.userId }, select: { id: true } });
      if (p) await this.cancelActive({ handymanId: p.id }, 'providerBlocked');
    });
    this.reconciler.register(B3_RECONCILER_TASK.blockedProviders, async () => {
      await this.repair();
    });
  }

  /** Safety net: force-cancels running jobs whose company, handyman profile or user is BLOCKED (missed / failed listeners). */
  async repair(): Promise<string[]> {
    const companies = await this.cancelActive({ company: { status: 'BLOCKED' } }, 'companyBlocked');
    const pros = await this.cancelActive(
      { OR: [{ handyman: { status: 'BLOCKED' } }, { handyman: { user: { status: 'BLOCKED' } } }] },
      'providerBlocked',
    );
    return [...companies, ...pros];
  }

  /** Force-cancels and re-dispatches every not-yet-done job matching `where`. Returns the cancelled assignment ids. */
  async cancelActive(where: Prisma.AssignmentWhereInput, reasonKey: 'providerBlocked' | 'companyBlocked'): Promise<string[]> {
    const rows = await this.prisma.assignment.findMany({
      where: { AND: [where, { status: { in: [...BLOCK_CANCELLABLE] } }] },
      select: { id: true, request: { select: { customerAccount: { select: { owner: { select: { locale: true } } } } } } },
      orderBy: { id: 'asc' },
      take: 200,
    });
    const done: string[] = [];
    for (const r of rows) {
      try {
        // The stored reason is shown to the customer: written in the customer's language.
        const reason = this.i18n.t(r.request.customerAccount.owner.locale, `server.jobs.cancelReason.${reasonKey}`);
        if (await this.forceCancelAndRedispatch(r.id, reason)) done.push(r.id);
      } catch (err) {
        this.log.error(`force-cancel of ${r.id} failed: ${(err as Error).message}`);
      }
    }
    return done;
  }

  /**
   * ADMIN cancellation (CANCELLED_FREE: fee hold released or refunded, customer's emergency fee given back) of one job, then
   * the slot goes back to OPEN and dispatch restarts. If the cancellation turned the request CANCELLED (its only slot), the
   * request is reopened in the same transaction. Lock order request -> assignment (CancellationService.apply re-locks both).
   */
  async forceCancelAndRedispatch(assignmentId: string, reason: string): Promise<boolean> {
    const out = await inTx(this.prisma, async (tx) => {
      const ref = await tx.assignment.findUnique({ where: { id: assignmentId }, select: { requestId: true } });
      if (!ref) return null;
      await lockRequestRow(tx, ref.requestId);
      await tx.$queryRawUnsafe('SELECT id FROM assignments WHERE id = $1::uuid FOR UPDATE', assignmentId);
      const a = await tx.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
      if (!(BLOCK_CANCELLABLE as readonly string[]).includes(a.status)) return null;
      const before = await tx.serviceRequest.findUniqueOrThrow({ where: { id: a.requestId }, select: { status: true } });
      const res = await this.cancellations.apply(assignmentId, { actor: 'ADMIN', kind: 'CANCEL', reason }, tx);
      const reopened = await tx.requestSlot.updateMany({
        where: { id: a.slotId, status: 'CANCELLED' },
        data: { status: 'OPEN', currentAssignmentId: null },
      });
      if (reopened.count > 0 && before.status !== 'CANCELLED') {
        // The admin cancel made the request CANCELLED: reopen it, then let recompute derive SEARCHING / ASSIGNED.
        await tx.serviceRequest.updateMany({
          where: { id: a.requestId, status: 'CANCELLED' },
          data: { status: 'ASSIGNED', cancelledAt: null, cancelledBy: null, cancelReason: null },
        });
        await this.state.recompute(a.requestId, tx);
      }
      return { res, slotId: a.slotId, reopened: reopened.count > 0 };
    });
    if (!out) return false;
    await out.res.afterCommit();
    if (out.reopened) await this.dispatch.reopenSlot(out.slotId);
    return true;
  }
}
