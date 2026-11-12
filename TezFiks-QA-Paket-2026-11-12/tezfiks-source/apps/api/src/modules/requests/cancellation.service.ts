import { Injectable, Logger } from '@nestjs/common';
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  cancellationOutcome,
  isTerminalAssignment,
  type AssignmentStatus,
  type CancelKind,
  type CancellationOutcome,
} from '@tezfiks/shared';
import { PrismaService, inTx, type Tx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { JobsService } from '../../infra/jobs.service';
import { RealtimeService } from '../../infra/realtime.service';
import { DomainEvents } from '../../infra/events';
import { SettingsService } from '../../common/settings/settings.service';
import { ApiException } from '../../common/http/api-exception';
import { LedgerService, type LedgerActor } from '../ledger/ledger.service';
import { WalletEventsService } from '../wallet/wallet-events.service';
import { PresenceService } from '../realtime/presence.service';
import { FeesService } from './fees.service';
import { RequestStateService, lockRequestRow } from './request-state.service';
import { RequestNotifier } from './request-notifier';
import { DispatchService } from './dispatch/dispatch.service';
import { EligibilityService } from './dispatch/eligibility.service';
import { jobId } from './requests.constants';
import type { Assignment } from '../../generated/prisma/client';

export type CancellationActor = 'CUSTOMER' | 'PROVIDER' | 'ADMIN';

export interface CancellationOptions {
  actor: CancellationActor;
  kind: CancelKind;
  reason?: string | null;
  byUserId?: string | null;
  /** ADMIN only: charge the customer as for a late customer cancellation (penalty + compensation, provider fee refunded). */
  chargeCustomer?: boolean;
}

export interface CancellationResult {
  assignment: Assignment;
  outcome: CancellationOutcome;
  /**
   * Side effects that must run after the transaction commits (presence not busy, re-dispatch, notifications, sockets,
   * wallet:updated). apply() runs it itself when it opened the transaction; a caller that passed `tx` must call it after commit.
   */
  afterCommit: () => Promise<void>;
}

/**
 * Cancellations, declines on arrival and no-shows of one assignment (spec 4.1, policy cancellationOutcome) with their ledger
 * effects. Exported for lane B3 (customer/provider/admin actions).
 */
@Injectable()
export class CancellationService {
  private readonly log = new Logger('Cancellation');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    private readonly realtime: RealtimeService,
    private readonly events: DomainEvents,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
    private readonly walletEvents: WalletEventsService,
    private readonly presence: PresenceService,
    private readonly fees: FeesService,
    private readonly state: RequestStateService,
    private readonly notifier: RequestNotifier,
    private readonly dispatch: DispatchService,
    private readonly eligibility: EligibilityService,
  ) {}

  /** ADMIN force-cancel: no fee kept, no penalty, no strike (unless chargeCustomer: treated as a late customer cancel). */
  private adminOutcome(
    feeCaptured: boolean,
    isGuaranteeFix: boolean,
    chargeCustomer: boolean,
    penalty: number,
    compensation: number,
  ): CancellationOutcome {
    const giveBack = isGuaranteeFix ? 'NONE' : feeCaptured ? 'REFUND' : 'RELEASE_HOLD';
    if (chargeCustomer && !isGuaranteeFix) {
      return {
        allowed: true,
        status: 'CANCELLED_BY_CUSTOMER',
        free: false,
        feeAction: giveBack,
        emergencyAction: 'KEEP',
        customerPenalty: penalty,
        providerCompensation: compensation,
        strike: false,
        redispatch: false,
      };
    }
    return {
      allowed: true,
      status: 'CANCELLED_FREE',
      free: true,
      feeAction: giveBack,
      emergencyAction: isGuaranteeFix ? 'NONE' : 'RELEASE',
      customerPenalty: 0,
      providerCompensation: 0,
      strike: false,
      redispatch: false,
    };
  }

  async apply(assignmentId: string, opts: CancellationOptions, tx?: Tx): Promise<CancellationResult> {
    const s = await this.settings.get();
    const result = await inTx(tx ?? this.prisma, async (t) => {
      // Lock order request -> assignment (same as accept / whole-request cancel / search end), so no deadlocks.
      const ref = await t.assignment.findUnique({ where: { id: assignmentId }, select: { requestId: true } });
      if (!ref) throw new ApiException('NOT_FOUND', { entity: 'assignment', id: assignmentId });
      await lockRequestRow(t, ref.requestId);
      await t.$queryRawUnsafe('SELECT id FROM assignments WHERE id = $1::uuid FOR UPDATE', assignmentId);
      const a = await t.assignment.findUnique({
        where: { id: assignmentId },
        include: {
          slot: true,
          request: {
            select: {
              id: true,
              number: true,
              customerAccount: { select: { id: true, ownerUserId: true, walletAccountId: true } },
            },
          },
          handyman: { select: { id: true, userId: true, walletAccountId: true } },
          company: { select: { id: true, walletAccountId: true } },
        },
      });
      if (!a) throw new ApiException('NOT_FOUND', { entity: 'assignment', id: assignmentId });
      const status = a.status as AssignmentStatus;
      if (isTerminalAssignment(status)) throw new ApiException('INVALID_STATE', { status });
      const now = this.clock.now();
      let outcome: CancellationOutcome;
      if (opts.actor === 'ADMIN') {
        if (!(ACTIVE_ASSIGNMENT_STATUSES as readonly string[]).includes(status))
          throw new ApiException('INVALID_STATE', { status });
        outcome = this.adminOutcome(
          a.feeCaptured,
          a.isGuaranteeFix,
          !!opts.chargeCustomer,
          s.cancelPenalty,
          s.penaltyCompensation,
        );
      } else {
        outcome = cancellationOutcome(
          {
            actor: opts.actor,
            kind: opts.kind,
            status,
            freeCancelUntil: a.freeCancelUntil,
            feeCaptured: a.feeCaptured,
            now,
            isGuaranteeFix: a.isGuaranteeFix,
            acceptedAt: a.acceptedAt,
          },
          s,
        );
        if (!outcome.allowed) {
          const tooEarly =
            opts.kind === 'NO_SHOW' &&
            opts.actor === 'CUSTOMER' &&
            (status === 'ACCEPTED' || status === 'EN_ROUTE');
          throw new ApiException(tooEarly ? 'TOO_EARLY' : 'CANCEL_NOT_ALLOWED', { status, kind: opts.kind });
        }
      }

      const providerWallet =
        a.providerType === 'COMPANY' ? (a.company?.walletAccountId ?? null) : a.handyman.walletAccountId;
      const customerWallet = a.request.customerAccount.walletAccountId;
      const revenue = await this.ledger.platformAccountId('REVENUE', t);
      const accounts: string[] = [];
      const number = a.request.number;
      const refs = { requestId: a.requestId, assignmentId: a.id };
      const actor: LedgerActor =
        opts.actor === 'ADMIN'
          ? { type: 'ADMIN', id: opts.byUserId ?? null }
          : opts.byUserId
            ? { type: 'USER', id: opts.byUserId }
            : { type: 'SYSTEM' };
      let feeRefunded = a.feeRefunded;
      let feeCaptured = a.feeCaptured;

      // Provider fee.
      if (outcome.feeAction === 'RELEASE_HOLD' && a.feeHoldId) {
        const hold = await t.hold.findUnique({ where: { id: a.feeHoldId } });
        if (hold?.status === 'ACTIVE') {
          await this.ledger.releaseHold(hold.id, t);
          accounts.push(hold.accountId);
        } else if (hold?.status === 'CAPTURED' && !a.feeRefunded && providerWallet) {
          await this.refundFee(a.id, number, num(a.feeAmount), providerWallet, revenue, refs, actor, t);
          feeRefunded = true;
          accounts.push(providerWallet);
        }
      } else if (outcome.feeAction === 'REFUND' && !a.feeRefunded && providerWallet && a.feeAmount > 0n) {
        await this.refundFee(a.id, number, num(a.feeAmount), providerWallet, revenue, refs, actor, t);
        feeRefunded = true;
        accounts.push(providerWallet);
      } else if (outcome.feeAction === 'KEEP' && a.feeHoldId && !a.feeCaptured) {
        const hold = await t.hold.findUnique({ where: { id: a.feeHoldId } });
        if (hold?.status === 'ACTIVE') {
          await this.ledger.captureHold(
            hold.id,
            {
              kind: 'REQUEST_FEE_CAPTURE',
              toAccountId: revenue,
              idempotencyKey: `fee-capture:${a.id}`,
              memo: this.fees.memo('requestFee', number),
              refs,
            },
            t,
          );
          feeCaptured = true;
          accounts.push(hold.accountId);
        }
      }

      // The slot's emergency fee (customer money).
      if (outcome.emergencyAction === 'RELEASE') {
        const acc = await this.fees.releaseOrRefundEmergency(a.slotId, number, t);
        if (acc) accounts.push(acc);
      } else if (outcome.emergencyAction === 'KEEP' && !outcome.free) {
        const acc = await this.fees.captureEmergency(a.slotId, number, t);
        if (acc) accounts.push(acc);
      }

      // Customer penalty (debt allowed) and the provider's compensation from the promo budget.
      if (outcome.customerPenalty > 0) {
        await this.ledger.post(
          {
            kind: 'CANCEL_PENALTY',
            idempotencyKey: `cancel-penalty:${a.id}`,
            entries: [
              { accountId: customerWallet, amount: -outcome.customerPenalty },
              { accountId: revenue, amount: outcome.customerPenalty },
            ],
            memo: this.fees.memo('cancelPenalty', number),
            refs,
            actor,
            allowOverdraft: [customerWallet],
          },
          t,
        );
        accounts.push(customerWallet);
      }
      if (outcome.providerCompensation > 0 && providerWallet) {
        await this.ledger.post(
          {
            kind: 'PENALTY_COMPENSATION',
            idempotencyKey: `penalty-compensation:${a.id}`,
            entries: [
              {
                accountId: await this.ledger.platformAccountId('PROMO', t),
                amount: -outcome.providerCompensation,
              },
              { accountId: providerWallet, amount: outcome.providerCompensation },
            ],
            memo: this.fees.memo('penaltyCompensation', number),
            refs,
            actor,
          },
          t,
        );
        accounts.push(providerWallet);
      }

      // Strike on the handyman (solo) or the company (company job).
      if (outcome.strike) {
        const reason = opts.kind === 'NO_SHOW' ? 'NO_SHOW' : 'LATE_PROVIDER_CANCEL';
        if (a.providerType === 'COMPANY' && a.companyId) {
          await t.strikeEvent.create({
            data: { companyId: a.companyId, assignmentId: a.id, reason, createdAt: now },
          });
          await t.company.update({ where: { id: a.companyId }, data: { strikes: { increment: 1 } } });
        } else {
          await t.strikeEvent.create({
            data: { handymanId: a.handymanId, assignmentId: a.id, reason, createdAt: now },
          });
          await t.handymanProfile.update({
            where: { id: a.handymanId },
            data: { strikes: { increment: 1 } },
          });
        }
      }

      const updated = await t.assignment.updateMany({
        where: { id: a.id, status },
        data: {
          status: outcome.status!,
          endedAt: now,
          cancelledAt: now,
          cancelledBy: opts.actor,
          cancelReason: opts.reason ?? null,
          feeRefunded,
          feeCaptured,
        },
      });
      if (updated.count === 0) throw new ApiException('CONFLICT', { reason: 'ASSIGNMENT_CHANGED' });

      if (outcome.redispatch) {
        await t.requestSlot.updateMany({
          where: { id: a.slotId, currentAssignmentId: a.id },
          data: { status: 'OPEN', currentAssignmentId: null },
        });
      } else {
        await t.requestSlot.updateMany({
          where: { id: a.slotId, status: { in: ['FILLED', 'OPEN'] } },
          data: { status: 'CANCELLED' },
        });
      }
      await this.state.recompute(a.requestId, t, {
        cancelledBy: opts.actor,
        cancelReason: opts.reason ?? null,
      });
      const fresh = await t.assignment.findUniqueOrThrow({ where: { id: a.id } });
      return {
        assignment: fresh,
        outcome,
        accounts,
        customerUserId: a.request.customerAccount.ownerUserId,
        providerUserId: a.handyman.userId,
        number,
      };
    });

    const afterCommit = async () => {
      try {
        const a = result.assignment;
        await this.jobs.cancel(jobId.feeWindowClose(a.id));
        // Another job of the same pro (e.g. a scheduled one starting soon) may still keep them busy.
        await this.presence.setBusy(a.handymanId, await this.eligibility.isBusy(a.handymanId));
        if (result.outcome.redispatch) await this.dispatch.reopenSlot(a.slotId);
        await this.walletEvents.notifyAccounts(result.accounts);
        const payload = { assignmentId: a.id, requestId: a.requestId, status: a.status as AssignmentStatus };
        this.realtime.toAssignment(a.id, 'assignment:updated', payload);
        this.realtime.toUser(result.customerUserId, 'assignment:updated', payload);
        this.realtime.toUser(result.providerUserId, 'assignment:updated', payload);
        if (a.companyId) this.realtime.toCompany(a.companyId, 'assignment:updated', payload);
        await this.state.announce(a.requestId);
        const data = { assignmentId: a.id, requestId: a.requestId };
        const vars = () => ({ number: result.number });
        const providerSide = [
          result.providerUserId,
          ...(a.companyId ? await this.dispatch.companyManagers(a.companyId) : []),
        ];
        if (opts.actor !== 'PROVIDER')
          await this.notifier.send(providerSide, 'ASSIGNMENT_CANCELLED', vars, { app: 'PRO', data });
        if (opts.actor !== 'CUSTOMER')
          await this.notifier.send([result.customerUserId], 'ASSIGNMENT_CANCELLED', vars, {
            app: 'CUSTOMER',
            data,
          });
        await this.events.emit('assignment.status', {
          assignmentId: a.id,
          requestId: a.requestId,
          status: a.status,
        });
      } catch (err) {
        this.log.error(
          `after-commit of cancellation ${result.assignment.id} failed: ${(err as Error).message}`,
        );
      }
    };
    if (!tx) await afterCommit();
    return {
      assignment: result.assignment,
      outcome: result.outcome,
      afterCommit: tx ? afterCommit : async () => undefined,
    };
  }

  private async refundFee(
    assignmentId: string,
    number: number,
    amount: number,
    providerWallet: string,
    revenue: string,
    refs: { requestId: string; assignmentId: string },
    actor: LedgerActor,
    t: Tx,
  ): Promise<void> {
    if (amount <= 0) return;
    await this.ledger.post(
      {
        kind: 'REQUEST_FEE_REFUND',
        idempotencyKey: `fee-refund:${assignmentId}`,
        entries: [
          { accountId: revenue, amount: -amount },
          { accountId: providerWallet, amount },
        ],
        memo: this.fees.memo('requestFeeRefund', number),
        refs,
        actor,
      },
      t,
    );
  }
}

function num(v: bigint): number {
  return Number(v);
}
