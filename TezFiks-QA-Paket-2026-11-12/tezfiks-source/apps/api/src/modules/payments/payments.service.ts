import { Inject, Injectable, Logger } from '@nestjs/common';
import type { LedgerTxKind, PaymentIntentView, PaymentPurpose, PaymentStatus } from '@tezfiks/shared';
import { PrismaService, inTx, type Db } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { DomainEvents, type PaymentSettledEvent } from '../../infra/events';
import { RealtimeService } from '../../infra/realtime.service';
import { LedgerService } from '../ledger/ledger.service';
import { ApiException } from '../../common/http/api-exception';
import { iso, num } from '../../common/mapping';
import { ENV, type Env } from '../../config/env';
import type { PaymentIntent, Prisma } from '../../generated/prisma/client';
import { WalletEventsService } from '../wallet/wallet-events.service';
import { fullName } from '../wallet/wallet-admin.service';
import { FAKE_PROVIDER_NAME, PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider';
import { sanitizeReturnUrl } from './return-url';

export interface CreateIntentInput {
  purpose: PaymentPurpose;
  /** qəpik, > 0 */
  amount: number;
  payerUserId: string;
  /**
   * Ledger account credited when the payment succeeds (stored in PaymentIntent.walletAccountId):
   * the wallet for top-ups, the provider's EARNINGS account for job payments, tips and invoices.
   */
  creditAccountId: string;
  assignmentId?: string | null;
  invoiceId?: string | null;
  companyId?: string | null;
  /** Dropped unless allowed (app schemes, Expo schemes, PUBLIC_BASE_URL / CORS origins). */
  returnUrl?: string | null;
}

export type SettleStatus = 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

const LEDGER_KIND: Record<PaymentPurpose, LedgerTxKind> = {
  WALLET_TOPUP: 'TOPUP',
  JOB_PAYMENT: 'JOB_PAYMENT',
  TIP: 'TIP',
  INVOICE: 'INVOICE_PAYMENT',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Payment intents (spec 7.1). The ledger posts only from a settled intent: SUCCEEDED credits `walletAccountId`
 * from the platform EXTERNAL account exactly once (idempotency key `payment:<intentId>`).
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger('Payments');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly events: DomainEvents,
    private readonly realtime: RealtimeService,
    private readonly ledger: LedgerService,
    private readonly walletEvents: WalletEventsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Card payments, top-ups and tips need a payment provider. The only one wired today is the fake test-mode provider, which
   * runs in the demo (DEMO_MODE) or with the explicit PAYMENTS_TEST_MODE opt-in (refused in production). Cash is unaffected.
   */
  get cardPaymentsEnabled(): boolean {
    return this.provider.name !== FAKE_PROVIDER_NAME || this.env.DEMO_MODE || this.env.PAYMENTS_TEST_MODE;
  }

  /** PAYMENTS_UNAVAILABLE unless card payments are enabled (see cardPaymentsEnabled). */
  assertCardPaymentsEnabled(): void {
    if (!this.cardPaymentsEnabled) throw new ApiException('PAYMENTS_UNAVAILABLE', { provider: this.provider.name });
  }

  async createIntent(
    input: CreateIntentInput,
    db: Db = this.prisma,
  ): Promise<{ intent: PaymentIntent; checkoutUrl: string }> {
    this.assertCardPaymentsEnabled();
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
      throw new ApiException('VALIDATION_FAILED', { field: 'amount', amount: input.amount });
    }
    const credit = await db.ledgerAccount.findUnique({
      where: { id: input.creditAccountId },
      select: { id: true, currency: true },
    });
    if (!credit) throw new ApiException('NOT_FOUND', { ledgerAccountId: input.creditAccountId });
    let intent = await db.paymentIntent.create({
      data: {
        purpose: input.purpose,
        amount: BigInt(input.amount),
        currency: credit.currency,
        status: 'CREATED',
        provider: this.provider.name,
        payerUserId: input.payerUserId,
        walletAccountId: input.creditAccountId,
        assignmentId: input.assignmentId ?? null,
        invoiceId: input.invoiceId ?? null,
        companyId: input.companyId ?? null,
        returnUrl: sanitizeReturnUrl(input.returnUrl, this.env),
        createdAt: this.clock.now(),
      },
    });
    const { providerRef } = await this.provider.createCheckout(intent);
    if (providerRef)
      intent = await db.paymentIntent.update({ where: { id: intent.id }, data: { providerRef } });
    const checkoutUrl = this.provider.checkoutUrl(intent);
    if (!checkoutUrl) throw new ApiException('INTERNAL', { reason: 'NO_CHECKOUT_URL' });
    return { intent, checkoutUrl };
  }

  async find(intentId: string, db: Db = this.prisma): Promise<PaymentIntent | null> {
    if (!UUID_RE.test(intentId)) return null;
    return db.paymentIntent.findUnique({ where: { id: intentId } });
  }

  /**
   * Moves a CREATED intent to its final status. Idempotent: an intent that already left CREATED is returned unchanged.
   * SUCCEEDED posts EXTERNAL -> credit account; afterwards (post-commit) emits payment.succeeded / payment.failed,
   * `payment:updated` to the payer and `wallet:updated` for wallet top-ups.
   */
  async settle(intentId: string, status: SettleStatus, reason?: string | null): Promise<PaymentIntent> {
    const { intent, changed } = await inTx(this.prisma, async (tx) => {
      const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id FROM payment_intents WHERE id = $1::uuid FOR UPDATE`,
        intentId,
      );
      if (!locked.length) throw new ApiException('NOT_FOUND', { entity: 'PaymentIntent' });
      const current = await tx.paymentIntent.findUniqueOrThrow({ where: { id: intentId } });
      if (current.status !== 'CREATED') return { intent: current, changed: false };
      const now = this.clock.now();
      const failureReason =
        status === 'SUCCEEDED' ? null : (reason ?? (status === 'CANCELLED' ? 'cancelled' : 'failed'));
      const updated = await tx.paymentIntent.update({
        where: { id: intentId },
        data: { status, failureReason, completedAt: now },
      });
      if (status === 'SUCCEEDED') await this.postSuccess(updated, tx);
      return { intent: updated, changed: true };
    });
    if (changed) await this.afterSettle(intent);
    return intent;
  }

  private async postSuccess(intent: PaymentIntent, tx: Prisma.TransactionClient): Promise<void> {
    if (!intent.walletAccountId)
      throw new ApiException('INTERNAL', {
        reason: 'PAYMENT_WITHOUT_CREDIT_ACCOUNT',
        paymentIntentId: intent.id,
      });
    const external = await this.ledger.platformAccountId('EXTERNAL', tx);
    let requestId: string | null = null;
    let projectId: string | null = null;
    if (intent.assignmentId) {
      const a = await tx.assignment.findUnique({
        where: { id: intent.assignmentId },
        select: { requestId: true },
      });
      requestId = a?.requestId ?? null;
    }
    if (intent.invoiceId) {
      const inv = await tx.invoice.findUnique({
        where: { id: intent.invoiceId },
        select: { projectId: true },
      });
      projectId = inv?.projectId ?? null;
    }
    const amount = num(intent.amount);
    await this.ledger.post(
      {
        kind: LEDGER_KIND[intent.purpose],
        idempotencyKey: `payment:${intent.id}`,
        entries: [
          { accountId: external, amount: -amount },
          { accountId: intent.walletAccountId, amount },
        ],
        refs: {
          paymentIntentId: intent.id,
          assignmentId: intent.assignmentId,
          invoiceId: intent.invoiceId,
          requestId,
          projectId,
        },
        actor: intent.payerUserId ? { type: 'USER', id: intent.payerUserId } : { type: 'SYSTEM' },
        metadata: { provider: intent.provider, providerRef: intent.providerRef },
      },
      tx,
    );
  }

  private async afterSettle(intent: PaymentIntent): Promise<void> {
    if (intent.payerUserId) {
      this.realtime.toUser(intent.payerUserId, 'payment:updated', {
        paymentIntentId: intent.id,
        status: intent.status,
        purpose: intent.purpose,
      });
    }
    if (intent.companyId) {
      this.realtime.toCompany(intent.companyId, 'payment:updated', {
        paymentIntentId: intent.id,
        status: intent.status,
        purpose: intent.purpose,
      });
    }
    if (intent.status === 'SUCCEEDED' && intent.purpose === 'WALLET_TOPUP' && intent.walletAccountId) {
      await this.walletEvents.notifyAccount(intent.walletAccountId);
    }
    const event: PaymentSettledEvent = {
      paymentIntentId: intent.id,
      purpose: intent.purpose,
      amount: num(intent.amount),
      payerUserId: intent.payerUserId,
      assignmentId: intent.assignmentId,
      invoiceId: intent.invoiceId,
      walletAccountId: intent.walletAccountId,
      companyId: intent.companyId,
    };
    try {
      if (intent.status === 'SUCCEEDED') await this.events.emit('payment.succeeded', event);
      else
        await this.events.emit('payment.failed', {
          ...event,
          reason: intent.failureReason ?? intent.status.toLowerCase(),
        });
    } catch (err) {
      // The payment itself is settled and booked; listeners must be idempotent and repair through their reconcilers.
      this.log.error(`payment ${intent.id} listeners failed: ${(err as Error).message}`);
    }
  }

  view(intent: PaymentIntent): PaymentIntentView {
    return {
      id: intent.id,
      purpose: intent.purpose,
      amount: num(intent.amount),
      currency: intent.currency,
      status: intent.status as PaymentStatus,
      provider: intent.provider,
      createdAt: iso(intent.createdAt),
      completedAt: iso(intent.completedAt),
      failureReason: intent.failureReason,
      checkoutUrl: intent.status === 'CREATED' ? this.provider.checkoutUrl(intent) : null,
    };
  }

  /** Admin list (board 05), newest first, cursor = intent id. */
  async listAdmin(q: { cursor?: string; limit?: number; status?: PaymentStatus; purpose?: PaymentPurpose }) {
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 100);
    if (q.cursor && !UUID_RE.test(q.cursor))
      throw new ApiException('VALIDATION_FAILED', { in: 'query', field: 'cursor' });
    const rows = await this.prisma.paymentIntent.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.purpose ? { purpose: q.purpose } : {}),
        ...(q.cursor ? { id: { lt: q.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const payerIds = [...new Set(page.map((r) => r.payerUserId).filter((v): v is string => !!v))];
    const users = payerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: payerIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, fullName(u.firstName, u.lastName)]));
    return {
      items: page.map((r) => ({
        ...this.view(r),
        payerName: r.payerUserId ? (names.get(r.payerUserId) ?? null) : null,
      })),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
    };
  }
}
