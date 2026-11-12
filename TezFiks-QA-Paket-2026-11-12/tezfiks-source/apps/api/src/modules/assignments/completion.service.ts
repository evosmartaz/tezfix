import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { formatMoney, type AssignmentStatus } from '@tezfiks/shared';
import { PrismaService, inTx, type Tx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { JobsService } from '../../infra/jobs.service';
import { ReconcilerService } from '../../infra/reconciler.service';
import { DomainEvents, type PaymentSettledEvent } from '../../infra/events';
import { SettingsService } from '../../common/settings/settings.service';
import { ApiException } from '../../common/http/api-exception';
import { num } from '../../common/mapping';
import { WalletEventsService } from '../wallet/wallet-events.service';
import { PresenceService } from '../realtime/presence.service';
import { PaymentsService } from '../payments/payments.service';
import { FeesService } from '../requests/fees.service';
import { RequestStateService } from '../requests/request-state.service';
import { RequestNotifier } from '../requests/request-notifier';
import { EligibilityService } from '../requests/dispatch/eligibility.service';
import { jobId as b1JobId } from '../requests/requests.constants';
import type { Assignment } from '../../generated/prisma/client';
import { AssignmentAccess } from './assignment-access.service';
import { B3_JOB, B3_RECONCILER_TASK, b3JobId } from './assignments.constants';

export interface CompletionResult {
  assignment: Assignment;
  method: 'CASH' | 'CARD';
  /** Ledger accounts whose balance changed (fee capture) for wallet:updated. */
  accounts: string[];
}

/**
 * Completion of an assignment (spec 4.5): CASH (customer confirms, auto-complete, admin resolution) or CARD (the job payment
 * intent succeeded). Captures a still-held request fee, marks the slot DONE, counts the job, recomputes the request.
 * Also owns the `assignment.autoComplete` job, the payment listeners (JOB_PAYMENT, TIP) and the `assignments.repair` reconciler.
 */
@Injectable()
export class CompletionService implements OnModuleInit {
  private readonly log = new Logger('Completion');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    private readonly reconciler: ReconcilerService,
    private readonly events: DomainEvents,
    private readonly settings: SettingsService,
    private readonly walletEvents: WalletEventsService,
    private readonly presence: PresenceService,
    private readonly payments: PaymentsService,
    private readonly fees: FeesService,
    private readonly state: RequestStateService,
    private readonly notifier: RequestNotifier,
    private readonly eligibility: EligibilityService,
    private readonly access: AssignmentAccess,
  ) {}

  onModuleInit(): void {
    this.jobs.register(B3_JOB.autoComplete, async (data: { assignmentId: string }) => {
      await this.autoComplete(data.assignmentId);
    });
    this.reconciler.register(B3_RECONCILER_TASK.assignments, async () => {
      await this.repair();
    });
    this.events.on('payment.succeeded', async (e) => {
      if (!e.assignmentId) return;
      if (e.purpose === 'JOB_PAYMENT') await this.applyJobPayment(e.paymentIntentId);
      else if (e.purpose === 'TIP') await this.applyTip(e.assignmentId, e);
    });
  }

  // --------------------------------------------------------------- complete

  /**
   * Completes a locked assignment (caller holds request -> assignment locks) that is PRICE_PROPOSED or PRICE_DISPUTED.
   * CARD sets guaranteeUntil = completedAt + guaranteeDays. Run `afterComplete(result)` once the transaction committed.
   */
  async completeInTx(tx: Tx, a: Assignment, method: 'CASH' | 'CARD', intentId: string | null): Promise<CompletionResult> {
    const s = await this.settings.get();
    const now = this.clock.now();
    const done = await tx.assignment.updateMany({
      where: { id: a.id, status: { in: ['PRICE_PROPOSED', 'PRICE_DISPUTED'] } },
      data: {
        status: 'COMPLETED',
        completedAt: now,
        endedAt: now,
        paymentMethod: method,
        paymentIntentId: method === 'CARD' ? intentId : null,
        guaranteeUntil: method === 'CARD' ? new Date(now.getTime() + s.guaranteeDays * 86_400_000) : null,
        contactUnlockedAt: a.contactUnlockedAt ?? now,
      },
    });
    if (done.count === 0) throw new ApiException('INVALID_STATE', { status: a.status });
    // "Completion before the window closes captures the fee immediately" (spec 4.1).
    const fee = await this.fees.captureForAssignment(a.id, tx);
    await tx.requestSlot.updateMany({ where: { id: a.slotId, currentAssignmentId: a.id }, data: { status: 'DONE' } });
    await tx.handymanProfile.update({ where: { id: a.handymanId }, data: { completedCount: { increment: 1 } } });
    if (a.companyId) await tx.company.update({ where: { id: a.companyId }, data: { completedCount: { increment: 1 } } });
    await this.state.recompute(a.requestId, tx);
    const fresh = await tx.assignment.findUniqueOrThrow({ where: { id: a.id } });
    return { assignment: fresh, method, accounts: fee.accounts };
  }

  /** After-commit side effects of a completion. Never throws. */
  async afterComplete(res: CompletionResult): Promise<void> {
    const a = res.assignment;
    try {
      await this.jobs.cancel(b3JobId.autoComplete(a.id));
      await this.jobs.cancel(b1JobId.feeWindowClose(a.id));
      await this.presence.setBusy(a.handymanId, await this.eligibility.isBusy(a.handymanId));
      await this.walletEvents.notifyAccounts(res.accounts);
      await this.access.announce(a);
      const p = await this.access.parties(a);
      const data = { assignmentId: a.id, requestId: a.requestId };
      const vars = () => ({ number: p.requestNumber });
      await this.notifier.send([p.customerUserId], 'ASSIGNMENT_COMPLETED', vars, { app: 'CUSTOMER', data });
      await this.notifier.send([p.providerUserId, ...p.managerUserIds], 'ASSIGNMENT_COMPLETED', vars, { app: 'PRO', data });
      if (res.method === 'CASH') await this.cancelPendingIntents(a.id, 'JOB_PAYMENT');
      await this.events.emit('assignment.status', { assignmentId: a.id, requestId: a.requestId, status: a.status });
    } catch (err) {
      this.log.error(`after-complete of ${a.id} failed: ${(err as Error).message}`);
    }
  }

  /** Cancels CREATED intents of the assignment (a customer switching to cash, a dispute, a new price). */
  async cancelPendingIntents(assignmentId: string, purpose: 'JOB_PAYMENT' | 'TIP', exceptIntentId?: string | null): Promise<void> {
    const pending = await this.prisma.paymentIntent.findMany({
      where: { assignmentId, purpose, status: 'CREATED', ...(exceptIntentId ? { id: { not: exceptIntentId } } : {}) },
      select: { id: true },
    });
    for (const p of pending) {
      try {
        await this.payments.settle(p.id, 'CANCELLED', 'superseded');
      } catch (err) {
        this.log.warn(`cancel intent ${p.id} failed: ${(err as Error).message}`);
      }
    }
  }

  // ---------------------------------------------------------- auto-complete

  async scheduleAutoComplete(assignmentId: string, priceProposedAt: Date): Promise<void> {
    const s = await this.settings.get();
    await this.jobs.schedule(
      B3_JOB.autoComplete,
      { assignmentId },
      { at: new Date(priceProposedAt.getTime() + s.autoCompleteAfterMin * 60_000), jobId: b3JobId.autoComplete(assignmentId) },
    );
  }

  /** PRICE_PROPOSED for autoCompleteAfterMin with no customer answer -> COMPLETED as CASH (spec 4.5). Idempotent. */
  async autoComplete(assignmentId: string): Promise<boolean> {
    const s = await this.settings.get();
    const out = await inTx(this.prisma, async (tx) => {
      const ref = await tx.assignment.findUnique({ where: { id: assignmentId }, select: { id: true } });
      if (!ref) return { kind: 'none' as const };
      const a = await this.access.lockAssignment(tx, assignmentId);
      if (a.status !== 'PRICE_PROPOSED' || !a.priceProposedAt) return { kind: 'none' as const };
      const due = new Date(a.priceProposedAt.getTime() + s.autoCompleteAfterMin * 60_000);
      if (due.getTime() > this.clock.nowMs()) return { kind: 'later' as const, at: a.priceProposedAt };
      return { kind: 'done' as const, res: await this.completeInTx(tx, a, 'CASH', null) };
    });
    if (out.kind === 'later') await this.scheduleAutoComplete(assignmentId, out.at);
    if (out.kind !== 'done') return false;
    await this.afterComplete(out.res);
    return true;
  }

  // --------------------------------------------------------------- payments

  /**
   * A JOB_PAYMENT intent succeeded: PRICE_PROPOSED / PRICE_DISPUTED -> COMPLETED as CARD with the guarantee. When the
   * job was already completed as cash meanwhile (auto-complete raced the checkout), the card payment is what the customer
   * actually paid: the assignment switches to CARD and gets the guarantee. Idempotent.
   */
  async applyJobPayment(intentId: string): Promise<boolean> {
    const s = await this.settings.get();
    const intent = await this.prisma.paymentIntent.findUnique({ where: { id: intentId } });
    if (!intent?.assignmentId || intent.purpose !== 'JOB_PAYMENT' || intent.status !== 'SUCCEEDED') return false;
    const assignmentId = intent.assignmentId;
    const out = await inTx(this.prisma, async (tx) => {
      const a = await this.access.lockAssignment(tx, assignmentId);
      const status = a.status as AssignmentStatus;
      if (status === 'PRICE_PROPOSED' || status === 'PRICE_DISPUTED') {
        return { kind: 'completed' as const, res: await this.completeInTx(tx, a, 'CARD', intent.id) };
      }
      if (status === 'COMPLETED' && a.paymentMethod !== 'CARD' && a.completedAt) {
        await tx.assignment.update({
          where: { id: a.id },
          data: {
            paymentMethod: 'CARD',
            paymentIntentId: intent.id,
            guaranteeUntil: new Date(a.completedAt.getTime() + s.guaranteeDays * 86_400_000),
          },
        });
        return { kind: 'switched' as const, a: await tx.assignment.findUniqueOrThrow({ where: { id: a.id } }) };
      }
      if (status !== 'COMPLETED')
        this.log.warn(`job payment ${intent.id} succeeded for assignment ${a.id} in status ${status}; left for an admin`);
      else if (a.paymentIntentId !== intent.id)
        // A second card payment for a job already paid by card (double charge): kept in EARNINGS, flagged for an admin.
        this.log.error(`job payment ${intent.id} succeeded for assignment ${a.id} already paid by ${a.paymentIntentId}; refund by an admin`);
      return { kind: 'none' as const };
    });
    if (out.kind === 'completed') await this.afterComplete(out.res);
    else if (out.kind === 'switched') {
      try {
        await this.access.announce(out.a);
      } catch (err) {
        this.log.warn(`announce ${out.a.id} failed: ${(err as Error).message}`);
      }
    }
    return out.kind !== 'none';
  }

  /** TIP succeeded: tipAmount = sum of the assignment's succeeded TIP intents (idempotent), TIP_RECEIVED to the provider side. */
  async applyTip(assignmentId: string, e?: Pick<PaymentSettledEvent, 'amount'>): Promise<boolean> {
    const out = await inTx(this.prisma, async (tx) => {
      const a = await this.access.lockAssignment(tx, assignmentId);
      const agg = await tx.paymentIntent.aggregate({
        where: { assignmentId, purpose: 'TIP', status: 'SUCCEEDED' },
        _sum: { amount: true },
      });
      const sum = agg._sum.amount ?? 0n;
      if (sum === 0n || (a.tipAmount ?? 0n) === sum) return null;
      const fresh = await tx.assignment.update({ where: { id: a.id }, data: { tipAmount: sum } });
      return { a: fresh, added: num(sum) - num(a.tipAmount) };
    });
    if (!out) return false;
    try {
      const p = await this.access.parties(out.a);
      // Tips of company jobs go to the company: managers are told, workers never see company money (spec 4.4).
      const recipients = out.a.companyId ? p.managerUserIds : [p.providerUserId];
      const amount = e?.amount ?? out.added;
      await this.notifier.send(recipients, 'TIP_RECEIVED', (l) => ({ amount: formatMoney(amount, l) }), {
        app: 'PRO',
        data: { assignmentId: out.a.id, amount },
      });
      await this.access.announce(out.a);
    } catch (err) {
      this.log.warn(`tip after-commit for ${out.a.id} failed: ${(err as Error).message}`);
    }
    return true;
  }

  // -------------------------------------------------------------- reconciler

  /** Overdue auto-completions, succeeded job payments not applied, tips not counted (missed jobs, crashed listeners). */
  async repair(): Promise<void> {
    const s = await this.settings.get();
    const cutoff = new Date(this.clock.nowMs() - s.autoCompleteAfterMin * 60_000);
    const overdue = await this.prisma.assignment.findMany({
      where: { status: 'PRICE_PROPOSED', priceProposedAt: { lte: cutoff } },
      select: { id: true },
      take: 200,
    });
    for (const a of overdue) {
      try {
        await this.autoComplete(a.id);
      } catch (err) {
        this.log.warn(`auto-complete repair ${a.id} failed: ${(err as Error).message}`);
      }
    }
    const paid = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT p.id::text AS id FROM payment_intents p JOIN assignments a ON a.id = p."assignmentId"
        WHERE p.purpose = 'JOB_PAYMENT' AND p.status = 'SUCCEEDED'
          AND (a.status IN ('PRICE_PROPOSED', 'PRICE_DISPUTED') OR (a.status = 'COMPLETED' AND a."paymentMethod" IS DISTINCT FROM 'CARD'))
        LIMIT 200`,
    );
    for (const p of paid) {
      try {
        await this.applyJobPayment(p.id);
      } catch (err) {
        this.log.warn(`job payment repair ${p.id} failed: ${(err as Error).message}`);
      }
    }
    const tips = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT a.id::text AS id FROM assignments a
         JOIN (SELECT "assignmentId", SUM(amount) AS s FROM payment_intents
                WHERE purpose = 'TIP' AND status = 'SUCCEEDED' AND "assignmentId" IS NOT NULL GROUP BY "assignmentId") t
           ON t."assignmentId" = a.id
        WHERE a."tipAmount" IS DISTINCT FROM t.s
        LIMIT 200`,
    );
    for (const a of tips) {
      try {
        await this.applyTip(a.id);
      } catch (err) {
        this.log.warn(`tip repair ${a.id} failed: ${(err as Error).message}`);
      }
    }
  }
}
