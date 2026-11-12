import { Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import {
  BAKU_OFFSET_MINUTES,
  isoWeekKey,
  startOfBakuDay,
  type EarningsView,
  type PayoutMethodType,
  type PayoutMethodView,
  type PayoutStatus,
  type PayoutView,
} from '@tezfiks/shared';
import { PrismaService, inTx, type Tx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { JobsService } from '../../infra/jobs.service';
import { ReconcilerService } from '../../infra/reconciler.service';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../../common/audit/audit.service';
import { ApiException } from '../../common/http/api-exception';
import { iso, num } from '../../common/mapping';
import type { LedgerAccount, Payout, PayoutMethod } from '../../generated/prisma/client';
import { fullName } from '../wallet/wallet-admin.service';
import { maskPayoutNumber } from './payout-method';

const DAY_MS = 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Weekly payout job name and its cron (Monday 09:00 Asia/Baku, spec 4.9). */
export const PAYOUTS_WEEKLY_JOB = 'payouts.weekly';
export const PAYOUTS_WEEKLY_CRON = '0 9 * * 1';
/** Hour (Baku) of the weekly run; the catch-up waits for it. */
const PAYOUTS_WEEKLY_HOUR = 9;
/** Reconciler task that runs the week's payouts when the cron did not (API down at 09:00, Redis flushed...). */
export const PAYOUTS_CATCH_UP_TASK = 'payouts.catchUp';
/** Audit trail of every completed run (actor SYSTEM, entity PayoutRun/<ISO week>): the catch-up's durable "already ran". */
const RUN_ACTION = 'payouts.weekly';
const RUN_ENTITY = 'PayoutRun';

/** UTC instant of Monday 00:00 (Baku) of the week containing `at`. */
export function startOfBakuWeek(at: Date): Date {
  const local = new Date(at.getTime() + BAKU_OFFSET_MINUTES * 60_000);
  const dow = local.getUTCDay() || 7; // Monday = 1 ... Sunday = 7
  return new Date(startOfBakuDay(at).getTime() - (dow - 1) * DAY_MS);
}

export type PayoutOwner =
  | { type: 'HANDYMAN'; handymanId: string; earningsAccountId: string }
  | { type: 'COMPANY'; companyId: string; earningsAccountId: string };

export type AdminPayoutRow = PayoutView & {
  ownerType: 'HANDYMAN' | 'COMPANY';
  ownerId: string;
  ownerName: string;
};

function methodView(m: PayoutMethod): PayoutMethodView {
  return {
    type: m.type,
    maskedNumber: m.maskedNumber,
    holderName: m.holderName,
    updatedAt: iso(m.updatedAt),
  };
}

function snapshotView(snapshot: unknown): PayoutMethodView | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const s = snapshot as Record<string, unknown>;
  if (
    (s.type !== 'CARD' && s.type !== 'IBAN') ||
    typeof s.maskedNumber !== 'string' ||
    typeof s.holderName !== 'string' ||
    typeof s.updatedAt !== 'string'
  ) {
    return null;
  }
  return { type: s.type, maskedNumber: s.maskedNumber, holderName: s.holderName, updatedAt: s.updatedAt };
}

export function payoutView(p: Payout): PayoutView {
  return {
    id: p.id,
    amount: num(p.amount),
    status: p.status,
    periodStart: iso(p.periodStart),
    periodEnd: iso(p.periodEnd),
    createdAt: iso(p.createdAt),
    paidAt: iso(p.paidAt),
    failureReason: p.failureReason,
    method: snapshotView(p.methodSnapshot),
  };
}

/**
 * Earnings, payout methods and weekly payouts (spec 4.9). Card payments and tips land on the provider's EARNINGS account;
 * every Monday 09:00 (Baku) a PENDING payout moves the positive balance to PAYOUTS_IN_TRANSIT; an admin marks it PAID
 * (money leaves to EXTERNAL) or FAILED (money returns to EARNINGS).
 */
@Injectable()
export class PayoutsService implements OnModuleInit, OnApplicationBootstrap {
  private readonly log = new Logger('Payouts');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly reconciler: ReconcilerService,
  ) {}

  onModuleInit(): void {
    this.jobs.register(PAYOUTS_WEEKLY_JOB, async () => {
      const r = await this.runPayouts();
      this.log.log(`weekly payouts: created=${r.created} total=${r.total}`);
    });
    // Manual job mode (tests, tools) has no cron that could be missed: tests call catchUpWeekly() themselves.
    this.reconciler.register(PAYOUTS_CATCH_UP_TASK, async () => {
      if (this.jobs.mode === 'manual') return;
      const r = await this.catchUpWeekly();
      if (r.ran) this.log.warn(`weekly payouts caught up: created=${r.created} total=${r.total}`);
    });
  }

  /**
   * Runs this ISO week's payouts when they are due (Monday 09:00 Baku passed) and no run of this week is recorded yet. The
   * run itself is idempotent per owner per week, so a race with the cron at 09:00 creates nothing twice.
   */
  async catchUpWeekly(): Promise<{ ran: boolean; created: number; total: number }> {
    const now = this.clock.now();
    const due = startOfBakuWeek(now).getTime() + PAYOUTS_WEEKLY_HOUR * 3_600_000;
    if (now.getTime() < due) return { ran: false, created: 0, total: 0 };
    const recorded = await this.prisma.auditLog.count({ where: { action: RUN_ACTION, entityType: RUN_ENTITY, entityId: isoWeekKey(now) } });
    if (recorded > 0) return { ran: false, created: 0, total: 0 };
    return { ran: true, ...(await this.runPayouts()) };
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.jobs.repeat(PAYOUTS_WEEKLY_JOB, PAYOUTS_WEEKLY_CRON);
    } catch (err) {
      this.log.error(`could not schedule ${PAYOUTS_WEEKLY_JOB}: ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------------ earnings ---

  async earnings(owner: PayoutOwner): Promise<EarningsView> {
    const now = this.clock.now();
    const weekStart = startOfBakuWeek(now);
    const ownerWhere =
      owner.type === 'HANDYMAN' ? { handymanId: owner.handymanId } : { companyId: owner.companyId };
    const assignmentOwner =
      owner.type === 'HANDYMAN'
        ? { handymanId: owner.handymanId, companyId: null }
        : { companyId: owner.companyId };
    const [earnings, pending, payouts, method, jobs] = await Promise.all([
      this.ledger.balance(owner.earningsAccountId),
      this.prisma.payout.aggregate({ where: { ...ownerWhere, status: 'PENDING' }, _sum: { amount: true } }),
      this.prisma.payout.findMany({ where: ownerWhere, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 }),
      this.prisma.payoutMethod.findUnique({
        where: owner.type === 'HANDYMAN' ? { handymanId: owner.handymanId } : { companyId: owner.companyId },
      }),
      // Business time comes from the Clock: assignments carry Clock-based completedAt (ledger rows use DB timestamps).
      this.prisma.assignment.groupBy({
        by: ['paymentMethod'],
        where: { ...assignmentOwner, status: 'COMPLETED', completedAt: { gte: weekStart, lte: now } },
        _count: { _all: true },
        _sum: { totalAmount: true, tipAmount: true },
      }),
    ]);
    const byMethod = (m: 'CARD' | 'CASH') => jobs.find((j) => j.paymentMethod === m);
    return {
      earningsBalance: earnings.posted,
      pendingPayouts: num(pending._sum.amount),
      payouts: payouts.map(payoutView),
      thisWeek: {
        cardJobs: byMethod('CARD')?._count._all ?? 0,
        cardTotal: num(byMethod('CARD')?._sum.totalAmount),
        tips: jobs.reduce((sum, j) => sum + num(j._sum.tipAmount), 0),
        cashJobs: byMethod('CASH')?._count._all ?? 0,
        cashTotal: num(byMethod('CASH')?._sum.totalAmount),
      },
      payoutMethod: method ? methodView(method) : null,
    };
  }

  // ------------------------------------------------------------ payout method ---

  async getMethod(owner: PayoutOwner): Promise<PayoutMethodView | null> {
    const m = await this.prisma.payoutMethod.findUnique({
      where: owner.type === 'HANDYMAN' ? { handymanId: owner.handymanId } : { companyId: owner.companyId },
    });
    return m ? methodView(m) : null;
  }

  /** Validates the number (Luhn card or AZ IBAN) and stores only the masked copy. */
  async setMethod(
    owner: PayoutOwner,
    body: { type: PayoutMethodType; number: string; holderName: string },
  ): Promise<PayoutMethodView> {
    const masked = maskPayoutNumber(body.type, body.number);
    if (!masked) {
      throw new ApiException('VALIDATION_FAILED', {
        in: 'body',
        issues: [
          {
            path: 'number',
            message: body.type === 'CARD' ? 'invalid card number' : 'invalid IBAN',
            code: 'custom',
          },
        ],
      });
    }
    const data = { type: body.type, maskedNumber: masked, holderName: body.holderName.trim() };
    const m =
      owner.type === 'HANDYMAN'
        ? await this.prisma.payoutMethod.upsert({
            where: { handymanId: owner.handymanId },
            create: { ...data, handymanId: owner.handymanId },
            update: data,
          })
        : await this.prisma.payoutMethod.upsert({
            where: { companyId: owner.companyId },
            create: { ...data, companyId: owner.companyId },
            update: data,
          });
    return methodView(m);
  }

  // ------------------------------------------------------------------- payouts ---

  /**
   * Creates one PENDING payout per HANDYMAN/COMPANY EARNINGS account with a positive balance. Idempotent per owner per
   * ISO week of the run (key `payout:<ownerType>:<ownerId>:<isoWeekKey>`); the period is the previous Baku week.
   * Demo bots are never paid out (their earnings are simulated). Every run is recorded (audit, actor SYSTEM, PayoutRun/<week>).
   */
  async runPayouts(): Promise<{ created: number; total: number }> {
    const now = this.clock.now();
    const weekKey = isoWeekKey(now);
    const weekStart = startOfBakuWeek(now);
    const period = { start: new Date(weekStart.getTime() - 7 * DAY_MS), end: weekStart };
    const bots = await this.prisma.handymanProfile.findMany({ where: { isBot: true }, select: { id: true } });
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: {
        kind: 'EARNINGS',
        ownerType: { in: ['HANDYMAN', 'COMPANY'] },
        postedBalance: { gt: 0 },
        ...(bots.length ? { NOT: { ownerType: 'HANDYMAN', ownerId: { in: bots.map((b) => b.id) } } } : {}),
      },
      orderBy: { id: 'asc' },
    });
    let created = 0;
    let total = 0;
    for (const acc of accounts) {
      try {
        const payout = await this.createPayout(acc, weekKey, period);
        if (payout) {
          created++;
          total += num(payout.amount);
        }
      } catch (err) {
        if ((err as { code?: string })?.code === 'P2002') continue; // a concurrent run created it
        this.log.error(`payout for account ${acc.id} failed: ${(err as Error).message}`);
      }
    }
    await this.audit.log({
      actorType: 'SYSTEM',
      action: RUN_ACTION,
      entityType: RUN_ENTITY,
      entityId: weekKey,
      after: { created, total, at: now.toISOString() },
    });
    return { created, total };
  }

  private async createPayout(
    acc: LedgerAccount,
    weekKey: string,
    period: { start: Date; end: Date },
  ): Promise<Payout | null> {
    const ownerType = acc.ownerType as 'HANDYMAN' | 'COMPANY';
    const idempotencyKey = `payout:${ownerType}:${acc.ownerId}:${weekKey}`;
    return inTx(this.prisma, async (tx) => {
      // Lock EARNINGS and PAYOUTS_IN_TRANSIT together, ordered by id, exactly like LedgerService.post does (spec 7):
      // locking EARNINGS alone first would invert the order against markFailed (TRANSIT -> EARNINGS) and deadlock.
      const transit = await this.ledger.platformAccountId('PAYOUTS_IN_TRANSIT', tx);
      const rows = await tx.$queryRawUnsafe<Array<{ id: string; posted: bigint; held: bigint }>>(
        `SELECT id::text AS id, "postedBalance" AS posted, "heldBalance" AS held
           FROM ledger_accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
        [...new Set([acc.id, transit])].sort(),
      );
      const row = rows.find((r) => r.id === acc.id);
      const amount = num(row?.posted) - num(row?.held);
      if (amount <= 0) return null;
      if (await tx.payout.findUnique({ where: { idempotencyKey } })) return null;
      const owner = ownerType === 'HANDYMAN' ? { handymanId: acc.ownerId } : { companyId: acc.ownerId };
      const method = await tx.payoutMethod.findUnique({ where: owner });
      const payout = await tx.payout.create({
        data: {
          ownerType,
          ...owner,
          amount: BigInt(amount),
          currency: acc.currency,
          periodStart: period.start,
          periodEnd: period.end,
          status: 'PENDING',
          idempotencyKey,
          methodSnapshot: method ? (methodView(method) as never) : undefined,
          createdAt: this.clock.now(),
        },
      });
      await this.ledger.post(
        {
          kind: 'PAYOUT_CREATED',
          idempotencyKey: `payout-created:${payout.id}`,
          entries: [
            { accountId: acc.id, amount: -amount },
            { accountId: transit, amount },
          ],
          refs: { payoutId: payout.id },
          metadata: { weekKey },
        },
        tx,
      );
      return payout;
    });
  }

  private async lockPendingPayout(tx: Tx, payoutId: string): Promise<Payout> {
    if (!UUID_RE.test(payoutId)) throw new ApiException('NOT_FOUND', { entity: 'Payout' });
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id::text AS id FROM payouts WHERE id = $1::uuid FOR UPDATE`,
      payoutId,
    );
    if (!rows.length) throw new ApiException('NOT_FOUND', { entity: 'Payout' });
    const payout = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
    if (payout.status !== 'PENDING') throw new ApiException('INVALID_STATE', { status: payout.status });
    return payout;
  }

  /** PENDING -> PAID: PAYOUTS_IN_TRANSIT -> EXTERNAL. */
  async markPaid(payoutId: string, adminId: string, ip: string | null): Promise<AdminPayoutRow> {
    const payout = await inTx(this.prisma, async (tx) => {
      const p = await this.lockPendingPayout(tx, payoutId);
      const [transit, external] = [
        await this.ledger.platformAccountId('PAYOUTS_IN_TRANSIT', tx),
        await this.ledger.platformAccountId('EXTERNAL', tx),
      ];
      const amount = num(p.amount);
      await this.ledger.post(
        {
          kind: 'PAYOUT_PAID',
          idempotencyKey: `payout-paid:${p.id}`,
          entries: [
            { accountId: transit, amount: -amount },
            { accountId: external, amount },
          ],
          refs: { payoutId: p.id },
          actor: { type: 'ADMIN', id: adminId },
        },
        tx,
      );
      const updated = await tx.payout.update({
        where: { id: p.id },
        data: { status: 'PAID', paidAt: this.clock.now(), markedByAdminId: adminId, failureReason: null },
      });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: adminId,
          action: 'payout.paid',
          entityType: 'Payout',
          entityId: p.id,
          before: { status: p.status },
          after: { status: 'PAID', amount },
          ip,
        },
        tx,
      );
      return updated;
    });
    await this.onPayoutPaid(payout);
    return (await this.adminRows([payout]))[0]!;
  }

  /** PENDING -> FAILED: PAYOUTS_IN_TRANSIT -> back to the owner's EARNINGS. */
  async markFailed(
    payoutId: string,
    adminId: string,
    reason: string,
    ip: string | null,
  ): Promise<AdminPayoutRow> {
    const payout = await inTx(this.prisma, async (tx) => {
      const p = await this.lockPendingPayout(tx, payoutId);
      const ownerId = p.ownerType === 'HANDYMAN' ? p.handymanId! : p.companyId!;
      const transit = await this.ledger.platformAccountId('PAYOUTS_IN_TRANSIT', tx);
      // Plain read (no row lock): the account row is locked only inside ledger.post, in id order with TRANSIT.
      const earnings =
        (await tx.ledgerAccount.findUnique({
          where: {
            ownerType_ownerId_kind_currency: {
              ownerType: p.ownerType,
              ownerId,
              kind: 'EARNINGS',
              currency: p.currency,
            },
          },
        })) ?? (await this.ledger.ensureAccount(p.ownerType, ownerId, 'EARNINGS', {}, tx));
      const amount = num(p.amount);
      await this.ledger.post(
        {
          kind: 'PAYOUT_FAILED',
          idempotencyKey: `payout-failed:${p.id}`,
          entries: [
            { accountId: transit, amount: -amount },
            { accountId: earnings.id, amount },
          ],
          memo: reason,
          refs: { payoutId: p.id },
          actor: { type: 'ADMIN', id: adminId },
        },
        tx,
      );
      const updated = await tx.payout.update({
        where: { id: p.id },
        data: { status: 'FAILED', failureReason: reason, markedByAdminId: adminId },
      });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: adminId,
          action: 'payout.failed',
          entityType: 'Payout',
          entityId: p.id,
          before: { status: p.status },
          after: { status: 'FAILED', amount, reason },
          ip,
        },
        tx,
      );
      return updated;
    });
    await this.onPayoutFailed(payout);
    return (await this.adminRows([payout]))[0]!;
  }

  /**
   * Hook for the integration wave: notify the provider that a payout was paid (push + in-app notification).
   * Intentionally a no-op in lane A2.
   */
  async onPayoutPaid(_payout: Payout): Promise<void> {
    // integration wave: notifications for paid payouts
  }

  /** Hook for the integration wave: notify the provider that a payout failed. Intentionally a no-op in lane A2. */
  async onPayoutFailed(_payout: Payout): Promise<void> {
    // integration wave: notifications for failed payouts
  }

  // --------------------------------------------------------------------- admin ---

  async listAdmin(q: {
    cursor?: string;
    limit?: number;
    status?: PayoutStatus;
  }): Promise<{ items: AdminPayoutRow[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 100);
    if (q.cursor && !UUID_RE.test(q.cursor))
      throw new ApiException('VALIDATION_FAILED', { in: 'query', field: 'cursor' });
    const rows = await this.prisma.payout.findMany({
      where: { ...(q.status ? { status: q.status } : {}), ...(q.cursor ? { id: { lt: q.cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      items: await this.adminRows(page),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
    };
  }

  private async adminRows(rows: Payout[]): Promise<AdminPayoutRow[]> {
    const handymanIds = [...new Set(rows.map((r) => r.handymanId).filter((v): v is string => !!v))];
    const companyIds = [...new Set(rows.map((r) => r.companyId).filter((v): v is string => !!v))];
    const [handymen, companies] = await Promise.all([
      handymanIds.length
        ? this.prisma.handymanProfile.findMany({
            where: { id: { in: handymanIds } },
            select: { id: true, user: { select: { firstName: true, lastName: true } } },
          })
        : [],
      companyIds.length
        ? this.prisma.company.findMany({
            where: { id: { in: companyIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);
    const hName = new Map(handymen.map((h) => [h.id, fullName(h.user.firstName, h.user.lastName)]));
    const cName = new Map(companies.map((c) => [c.id, c.name]));
    return rows.map((r) => {
      const ownerId = r.ownerType === 'HANDYMAN' ? r.handymanId! : r.companyId!;
      return {
        ...payoutView(r),
        ownerType: r.ownerType,
        ownerId,
        ownerName: (r.ownerType === 'HANDYMAN' ? hName.get(ownerId) : cName.get(ownerId)) ?? '—',
      };
    });
  }
}
