import { Injectable, OnModuleInit } from '@nestjs/common';
import { DEFAULT_LOCALE } from '@tezfiks/shared';
import { PrismaService, inTx, isRootClient, type Db, type Tx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { JobsService } from '../../infra/jobs.service';
import { ReconcilerService } from '../../infra/reconciler.service';
import { I18nService } from '../../common/i18n/i18n.service';
import { num } from '../../common/mapping';
import { LedgerService } from '../ledger/ledger.service';
import { WalletEventsService } from '../wallet/wallet-events.service';
import { JOB, RECONCILER_TASK, jobId } from './requests.constants';

export interface FeeCaptureResult {
  feeCaptured: boolean;
  emergencyCaptured: boolean;
  /** Ledger accounts whose balance changed (for wallet:updated). */
  accounts: string[];
}

/**
 * Platform fee money of an assignment: capture of the provider's request-fee hold and of the slot's emergency hold when
 * the free-cancel window closes (job `assignment.feeWindowClose`, reconciler `fees.repair`) or at completion (lane B3),
 * plus the emergency release/refund helpers shared with dispatch and cancellations.
 */
@Injectable()
export class FeesService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    private readonly reconciler: ReconcilerService,
    private readonly ledger: LedgerService,
    private readonly walletEvents: WalletEventsService,
    private readonly i18n: I18nService,
  ) {}

  onModuleInit(): void {
    this.jobs.register(JOB.feeWindowClose, async (data: { assignmentId: string }) => {
      await this.captureForAssignment(data.assignmentId);
    });
    this.reconciler.register(RECONCILER_TASK.fees, async () => {
      await this.repair();
    });
  }

  memo(key: string, requestNumber: number): string {
    return this.i18n.t(DEFAULT_LOCALE, `server.requests.memo.${key}`, { number: requestNumber });
  }

  /** Schedules the capture at the end of the free-cancel window. */
  async scheduleWindowClose(assignmentId: string, at: Date): Promise<void> {
    await this.jobs.schedule(JOB.feeWindowClose, { assignmentId }, { at, jobId: jobId.feeWindowClose(assignmentId) });
  }

  /**
   * Captures the assignment's request-fee hold (REQUEST_FEE_CAPTURE, key `fee-capture:<assignmentId>`) and the slot's
   * emergency hold (EMERGENCY_FEE_CAPTURE, key `emergency-capture:<slotId>`) to platform REVENUE. Idempotent; does nothing
   * for a free cancellation (CANCELLED_FREE) or when the holds are no longer active. With `tx` the caller commits and
   * should call WalletEventsService.notifyAccounts(result.accounts) afterwards.
   */
  async captureForAssignment(assignmentId: string, tx?: Tx): Promise<FeeCaptureResult> {
    const db: Db = tx ?? this.prisma;
    const result = await inTx(db, async (t) => {
      await t.$queryRawUnsafe('SELECT id FROM assignments WHERE id = $1::uuid FOR UPDATE', assignmentId);
      const a = await t.assignment.findUnique({
        where: { id: assignmentId },
        include: { slot: true, request: { select: { id: true, number: true } } },
      });
      const out: FeeCaptureResult = { feeCaptured: false, emergencyCaptured: false, accounts: [] };
      if (!a || a.status === 'CANCELLED_FREE') return out;
      const revenue = await this.ledger.platformAccountId('REVENUE', t);
      if (a.feeHoldId && !a.feeCaptured) {
        const hold = await t.hold.findUnique({ where: { id: a.feeHoldId } });
        if (hold?.status === 'ACTIVE') {
          await this.ledger.captureHold(
            hold.id,
            {
              kind: 'REQUEST_FEE_CAPTURE',
              toAccountId: revenue,
              idempotencyKey: `fee-capture:${a.id}`,
              memo: this.memo('requestFee', a.request.number),
              refs: { requestId: a.requestId, assignmentId: a.id },
            },
            t,
          );
          await t.assignment.update({ where: { id: a.id }, data: { feeCaptured: true } });
          out.feeCaptured = true;
          out.accounts.push(hold.accountId);
        }
      }
      const emergency = await this.captureEmergency(a.slotId, a.request.number, t);
      if (emergency) {
        out.emergencyCaptured = true;
        out.accounts.push(emergency);
      }
      return out;
    });
    if (!tx || isRootClient(db)) await this.walletEvents.notifyAccounts(result.accounts);
    return result;
  }

  /** Captures the slot's ACTIVE emergency hold to REVENUE. Returns the customer wallet account id when it captured. */
  async captureEmergency(slotId: string, requestNumber: number, tx: Tx): Promise<string | null> {
    const slot = await tx.requestSlot.findUnique({ where: { id: slotId } });
    if (!slot?.emergencyHoldId || slot.emergencyCaptured) return null;
    const hold = await tx.hold.findUnique({ where: { id: slot.emergencyHoldId } });
    if (hold?.status !== 'ACTIVE') return null;
    await this.ledger.captureHold(
      hold.id,
      {
        kind: 'EMERGENCY_FEE_CAPTURE',
        toAccountId: await this.ledger.platformAccountId('REVENUE', tx),
        idempotencyKey: `emergency-capture:${slot.id}`,
        memo: this.memo('emergencyFee', requestNumber),
        refs: { requestId: slot.requestId, assignmentId: slot.currentAssignmentId },
      },
      tx,
    );
    await tx.requestSlot.update({ where: { id: slot.id }, data: { emergencyCaptured: true } });
    return hold.accountId;
  }

  /**
   * Gives the slot's emergency fee back to the customer: releases an ACTIVE hold, or refunds a captured one
   * (EMERGENCY_FEE_REFUND revenue -> customer wallet, key `emergency-refund:<slotId>`). Returns the customer wallet id when money moved.
   */
  async releaseOrRefundEmergency(slotId: string, requestNumber: number, tx: Tx): Promise<string | null> {
    const slot = await tx.requestSlot.findUnique({ where: { id: slotId } });
    if (!slot?.emergencyHoldId) return null;
    const hold = await tx.hold.findUnique({ where: { id: slot.emergencyHoldId } });
    if (!hold) return null;
    if (hold.status === 'ACTIVE') {
      await this.ledger.releaseHold(hold.id, tx);
      return hold.accountId;
    }
    if (hold.status === 'CAPTURED' && slot.emergencyCaptured && !slot.emergencyRefunded) {
      const amount = num(hold.amount);
      await this.ledger.post(
        {
          kind: 'EMERGENCY_FEE_REFUND',
          idempotencyKey: `emergency-refund:${slot.id}`,
          entries: [
            { accountId: await this.ledger.platformAccountId('REVENUE', tx), amount: -amount },
            { accountId: hold.accountId, amount },
          ],
          memo: this.memo('emergencyFeeRefund', requestNumber),
          refs: { requestId: slot.requestId },
        },
        tx,
      );
      await tx.requestSlot.update({ where: { id: slot.id }, data: { emergencyRefunded: true } });
      return hold.accountId;
    }
    return null;
  }

  /** Reconciler: captures fee holds whose free-cancel window is over (missed or lost timer jobs). */
  async repair(): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.assignment.findMany({
      where: {
        feeCaptured: false,
        feeHoldId: { not: null },
        freeCancelUntil: { lt: now },
        status: { notIn: ['CANCELLED_FREE'] },
      },
      select: { id: true, feeHoldId: true },
      take: 200,
    });
    let n = 0;
    for (const a of due) {
      const hold = await this.prisma.hold.findUnique({ where: { id: a.feeHoldId! }, select: { status: true } });
      if (hold?.status !== 'ACTIVE') continue;
      const r = await this.captureForAssignment(a.id);
      if (r.feeCaptured) n++;
    }
    return n;
  }
}
