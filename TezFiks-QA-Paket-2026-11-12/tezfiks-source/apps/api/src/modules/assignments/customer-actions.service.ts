import { Injectable, Logger } from '@nestjs/common';
import type { CancelKind, CheckoutResponse, CustomerAssignment, Locale } from '@tezfiks/shared';
import { PrismaService, inTx, type Tx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { ApiException } from '../../common/http/api-exception';
import { num } from '../../common/mapping';
import { LedgerService } from '../ledger/ledger.service';
import { PaymentsService } from '../payments/payments.service';
import { lockActiveUser } from '../customer/customer.service';
import { CancellationService } from '../requests/cancellation.service';
import { RequestNotifier } from '../requests/request-notifier';
import { RequestViews } from '../requests/views/request-views.service';
import type { Assignment } from '../../generated/prisma/client';
import { AssignmentAccess } from './assignment-access.service';
import { CompletionService, type CompletionResult } from './completion.service';

/** Customer actions on one assigned handyman (spec 6.3 customer side, 4.5 payment, 4.8 ratings). */
@Injectable()
export class CustomerActionsService {
  private readonly log = new Logger('CustomerActions');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentsService,
    private readonly cancellations: CancellationService,
    private readonly notifier: RequestNotifier,
    private readonly views: RequestViews,
    private readonly access: AssignmentAccess,
    private readonly completion: CompletionService,
  ) {}

  async get(userId: string, assignmentId: string, locale: Locale): Promise<CustomerAssignment> {
    const a = await this.access.forCustomer(userId, assignmentId);
    return this.views.toCustomerAssignment(a, locale);
  }

  /** cancel / decline on arrival / report no-show through CancellationService (actor CUSTOMER). */
  async cancelLike(userId: string, assignmentId: string, kind: CancelKind, reason: string | undefined, locale: Locale): Promise<CustomerAssignment> {
    await this.access.forCustomer(userId, assignmentId);
    const res = await inTx(this.prisma, async (tx) => {
      // B1 lock order: acting user (SHARE) -> request -> assignment (apply takes the last two).
      await lockActiveUser(tx, userId);
      return this.cancellations.apply(assignmentId, { actor: 'CUSTOMER', kind, reason: reason ?? null, byUserId: userId }, tx);
    });
    await res.afterCommit();
    return this.views.toCustomerAssignment(res.assignment, locale);
  }

  /** The provider's EARNINGS account (solo handyman, or the company for company jobs): card money goes there (spec 4.5). */
  private async earningsAccount(a: Pick<Assignment, 'companyId' | 'handymanId' | 'providerType'>, tx: Tx): Promise<string> {
    if (a.providerType === 'COMPANY' && a.companyId) {
      const c = await tx.company.findUniqueOrThrow({ where: { id: a.companyId }, select: { earningsAccountId: true } });
      return c.earningsAccountId;
    }
    const h = await tx.handymanProfile.findUniqueOrThrow({ where: { id: a.handymanId }, select: { earningsAccountId: true } });
    if (h.earningsAccountId) return h.earningsAccountId;
    const acc = await this.ledger.ensureAccount('HANDYMAN', a.handymanId, 'EARNINGS', {}, tx);
    await tx.handymanProfile.update({ where: { id: a.handymanId }, data: { earningsAccountId: acc.id } });
    return acc.id;
  }

  /**
   * "Razılaşdırılmış qiymət": CASH completes at once; CARD returns a test checkout (the job completes when the payment
   * succeeds). A zero total (guarantee re-fix) completes as cash: there is nothing to pay.
   */
  async confirmPrice(
    userId: string,
    assignmentId: string,
    body: { method: 'CASH' | 'CARD'; returnUrl?: string },
    locale: Locale,
  ): Promise<{ assignment: CustomerAssignment; payment: CheckoutResponse | null }> {
    await this.access.forCustomer(userId, assignmentId);
    const out = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      const a = await this.access.lockAssignment(tx, assignmentId);
      if (a.status !== 'PRICE_PROPOSED') throw new ApiException('INVALID_STATE', { status: a.status });
      const total = num(a.totalAmount);
      if (body.method === 'CASH' || total <= 0) {
        return { kind: 'done' as const, res: await this.completion.completeInTx(tx, a, 'CASH', null) };
      }
      // Also before re-using an older checkout: it could only be paid on the (closed) test page.
      this.payments.assertCardPaymentsEnabled();
      const existing = await tx.paymentIntent.findFirst({
        where: { assignmentId: a.id, purpose: 'JOB_PAYMENT', status: 'CREATED', payerUserId: userId, amount: BigInt(total) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const reuse = existing ? this.payments.view(existing).checkoutUrl : null;
      if (existing && reuse) {
        await tx.assignment.update({ where: { id: a.id }, data: { paymentIntentId: existing.id } });
        return { kind: 'card' as const, a, payment: { paymentIntentId: existing.id, checkoutUrl: reuse } };
      }
      const { intent, checkoutUrl } = await this.payments.createIntent(
        {
          purpose: 'JOB_PAYMENT',
          amount: total,
          payerUserId: userId,
          creditAccountId: await this.earningsAccount(a, tx),
          assignmentId: a.id,
          companyId: a.companyId,
          returnUrl: body.returnUrl ?? null,
        },
        tx,
      );
      await tx.assignment.update({ where: { id: a.id }, data: { paymentIntentId: intent.id } });
      return { kind: 'card' as const, a, payment: { paymentIntentId: intent.id, checkoutUrl } };
    });
    if (out.kind === 'done') {
      await this.completion.afterComplete(out.res as CompletionResult);
      return { assignment: await this.views.toCustomerAssignment(out.res.assignment.id, locale), payment: null };
    }
    // Older checkouts of another amount are void now.
    await this.completion.cancelPendingIntents(assignmentId, 'JOB_PAYMENT', out.payment.paymentIntentId);
    return { assignment: await this.views.toCustomerAssignment(assignmentId, locale), payment: out.payment };
  }

  /** Tip page: only after a card-paid completion (spec 4.5), once. The provider's earnings are credited when it succeeds. */
  async tip(userId: string, assignmentId: string, body: { amount: number; returnUrl?: string }): Promise<CheckoutResponse> {
    await this.access.forCustomer(userId, assignmentId);
    return inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      const a = await this.access.lockAssignment(tx, assignmentId);
      const paid = a.paymentIntentId ? await tx.paymentIntent.findUnique({ where: { id: a.paymentIntentId }, select: { status: true } }) : null;
      if (a.status !== 'COMPLETED' || a.paymentMethod !== 'CARD' || paid?.status !== 'SUCCEEDED')
        throw new ApiException('INVALID_STATE', { status: a.status, reason: 'CARD_PAYMENT_REQUIRED' });
      if (a.tipAmount != null) throw new ApiException('INVALID_STATE', { reason: 'ALREADY_TIPPED' });
      const { intent, checkoutUrl } = await this.payments.createIntent(
        {
          purpose: 'TIP',
          amount: body.amount,
          payerUserId: userId,
          creditAccountId: await this.earningsAccount(a, tx),
          assignmentId: a.id,
          companyId: a.companyId,
          returnUrl: body.returnUrl ?? null,
        },
        tx,
      );
      return { paymentIntentId: intent.id, checkoutUrl };
    });
  }

  /** The customer rates the provider once (ALREADY_RATED); aggregates on the handyman and, for company jobs, the company. */
  async rate(userId: string, assignmentId: string, body: { stars: number; comment?: string }): Promise<{ ok: true }> {
    await this.access.forCustomer(userId, assignmentId);
    let rated: Assignment;
    try {
      rated = await inTx(this.prisma, async (tx) => {
        await lockActiveUser(tx, userId);
        const a = await this.access.lockAssignment(tx, assignmentId);
        if (a.status !== 'COMPLETED') throw new ApiException('INVALID_STATE', { status: a.status });
        if (a.customerRatedAt) throw new ApiException('ALREADY_RATED');
        const r = await tx.serviceRequest.findUniqueOrThrow({ where: { id: a.requestId }, select: { customerAccountId: true } });
        const now = this.clock.now();
        await tx.rating.create({
          data: {
            assignmentId: a.id,
            direction: 'CUSTOMER_TO_PROVIDER',
            raterUserId: userId,
            handymanId: a.handymanId,
            companyId: a.companyId,
            customerAccountId: r.customerAccountId,
            stars: body.stars,
            comment: body.comment?.trim() || null,
            createdAt: now,
          },
        });
        await tx.handymanProfile.update({
          where: { id: a.handymanId },
          data: { ratingSum: { increment: body.stars }, ratingCount: { increment: 1 } },
        });
        if (a.companyId)
          await tx.company.update({ where: { id: a.companyId }, data: { ratingSum: { increment: body.stars }, ratingCount: { increment: 1 } } });
        return tx.assignment.update({ where: { id: a.id }, data: { customerRatedAt: now } });
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw new ApiException('ALREADY_RATED');
      throw err;
    }
    try {
      const p = await this.access.parties(rated);
      await this.notifier.send([p.providerUserId, ...p.managerUserIds], 'RATING_RECEIVED', () => ({ number: p.requestNumber }), {
        app: 'PRO',
        data: { assignmentId: rated.id, stars: body.stars },
      });
    } catch (err) {
      this.log.warn(`rating notification of ${rated.id} failed: ${(err as Error).message}`);
    }
    return { ok: true };
  }
}
