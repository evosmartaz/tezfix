import { Injectable } from '@nestjs/common';
import type { HoldKind, LedgerAccountKind, LedgerOwnerType, LedgerTxKind, LedgerTxView, WalletSummary } from '@tezfiks/shared';
import { PrismaService, inTx, type Db, type Tx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { SettingsService } from '../../common/settings/settings.service';
import { ApiException } from '../../common/http/api-exception';
import { num } from '../../common/mapping';
import type { Hold, LedgerAccount } from '../../generated/prisma/client';

/** Owner id used for platform-level accounts (revenue, promo, external...). */
export const PLATFORM_OWNER_ID = '00000000-0000-0000-0000-000000000000';

export interface PostEntry {
  accountId: string;
  /** Signed qəpik: negative = debit (money leaves the account), positive = credit. */
  amount: number;
}

export interface LedgerRefs {
  requestId?: string | null;
  assignmentId?: string | null;
  projectId?: string | null;
  paymentIntentId?: string | null;
  payoutId?: string | null;
  invoiceId?: string | null;
}

export interface LedgerActor {
  type: 'ADMIN' | 'USER' | 'SYSTEM';
  id?: string | null;
}

export interface PostInput {
  kind: LedgerTxKind;
  /** Unique per business event, e.g. "fee-capture:<assignmentId>". Posting twice with the same key is a no-op. */
  idempotencyKey: string;
  entries: PostEntry[];
  memo?: string;
  refs?: LedgerRefs;
  actor?: LedgerActor;
  metadata?: Record<string, unknown>;
  /** Accounts that may go below zero in this posting even when allowNegative=false (e.g. a customer penalty). */
  allowOverdraft?: string[];
}

export interface HoldInput {
  accountId: string;
  amount: number;
  kind: HoldKind;
  requestId?: string | null;
  slotId?: string | null;
  assignmentId?: string | null;
  quoteId?: string | null;
}

export interface CaptureInput {
  kind: LedgerTxKind;
  toAccountId: string;
  idempotencyKey: string;
  memo?: string;
  refs?: LedgerRefs;
  actor?: LedgerActor;
}

interface LockedRow {
  id: string;
  postedBalance: bigint;
  heldBalance: bigint;
  allowNegative: boolean;
  currency: string;
}

/**
 * Double-entry ledger (spec section 7). Every mutation runs in one DB transaction, locks the touched accounts
 * in id order (SELECT ... FOR UPDATE), checks balances and appends entries. Pass `db` (a transaction client) to
 * compose ledger effects atomically with your own state changes.
 */
@Injectable()
export class LedgerService {
  private readonly platformIds = new Map<LedgerAccountKind, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
  ) {}

  async ensureAccount(
    ownerType: LedgerOwnerType,
    ownerId: string,
    kind: LedgerAccountKind,
    opts: { allowNegative?: boolean; currency?: string } = {},
    db: Db = this.prisma,
  ): Promise<LedgerAccount> {
    const currency = opts.currency ?? 'AZN';
    return db.ledgerAccount.upsert({
      where: { ownerType_ownerId_kind_currency: { ownerType, ownerId, kind, currency } },
      create: { ownerType, ownerId, kind, currency, allowNegative: opts.allowNegative ?? false },
      update: {},
    });
  }

  /** Platform account id by kind (REVENUE, PROMO, EXTERNAL, PAYOUTS_IN_TRANSIT, ADJUSTMENTS). */
  async platformAccountId(kind: LedgerAccountKind, db: Db = this.prisma): Promise<string> {
    const cached = this.platformIds.get(kind);
    if (cached) return cached;
    const acc = await this.ensureAccount('PLATFORM', PLATFORM_OWNER_ID, kind, { allowNegative: kind !== 'REVENUE' }, db);
    this.platformIds.set(kind, acc.id);
    return acc.id;
  }

  /** Clears cached platform account ids (tests truncate tables). */
  resetCache(): void {
    this.platformIds.clear();
  }

  private async lock(tx: Tx, ids: string[]): Promise<Map<string, LockedRow>> {
    const sorted = [...new Set(ids)].sort();
    const rows = await tx.$queryRawUnsafe<LockedRow[]>(
      `SELECT id::text AS id, "postedBalance", "heldBalance", "allowNegative", currency
         FROM ledger_accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      sorted,
    );
    const map = new Map(rows.map((r) => [r.id, r]));
    for (const id of sorted) if (!map.has(id)) throw new ApiException('NOT_FOUND', { ledgerAccountId: id });
    return map;
  }

  /** Posts a balanced transaction. Returns the existing transaction when the idempotency key was used before. */
  async post(input: PostInput, db: Db = this.prisma): Promise<{ transactionId: string; replayed: boolean }> {
    if (input.entries.length < 2) throw new Error('A ledger transaction needs at least two entries');
    let sum = 0;
    for (const e of input.entries) {
      if (!Number.isSafeInteger(e.amount) || e.amount === 0) throw new Error(`Invalid ledger amount ${e.amount}`);
      sum += e.amount;
    }
    if (sum !== 0) throw new Error(`Unbalanced ledger transaction (sum=${sum})`);
    return inTx(db, async (tx) => {
      const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (existing) return { transactionId: existing.id, replayed: true };
      const locked = await this.lock(
        tx,
        input.entries.map((e) => e.accountId),
      );
      const currencies = new Set([...locked.values()].map((a) => a.currency));
      if (currencies.size > 1) throw new Error('Cross-currency ledger transaction');
      const running = new Map<string, number>([...locked.values()].map((a) => [a.id, num(a.postedBalance)]));
      const deltas = new Map<string, number>();
      for (const e of input.entries) deltas.set(e.accountId, (deltas.get(e.accountId) ?? 0) + e.amount);
      for (const [id, delta] of deltas) {
        const acc = locked.get(id)!;
        const after = num(acc.postedBalance) + delta;
        const available = after - num(acc.heldBalance);
        if (delta < 0 && available < 0 && !acc.allowNegative && !input.allowOverdraft?.includes(id)) {
          throw new ApiException('INSUFFICIENT_BALANCE', {
            accountId: id,
            available: num(acc.postedBalance) - num(acc.heldBalance),
            required: -delta,
          });
        }
      }
      const now = this.clock.now();
      const txRow = await tx.ledgerTransaction.create({
        data: {
          createdAt: now,
          kind: input.kind,
          idempotencyKey: input.idempotencyKey,
          memo: input.memo ?? null,
          requestId: input.refs?.requestId ?? null,
          assignmentId: input.refs?.assignmentId ?? null,
          projectId: input.refs?.projectId ?? null,
          paymentIntentId: input.refs?.paymentIntentId ?? null,
          payoutId: input.refs?.payoutId ?? null,
          invoiceId: input.refs?.invoiceId ?? null,
          actorType: input.actor?.type ?? 'SYSTEM',
          actorId: input.actor?.id ?? null,
          metadata: (input.metadata ?? undefined) as never,
        },
      });
      for (const e of input.entries) {
        const after = running.get(e.accountId)! + e.amount;
        running.set(e.accountId, after);
        await tx.ledgerEntry.create({
          data: { transactionId: txRow.id, accountId: e.accountId, amount: BigInt(e.amount), balanceAfter: BigInt(after), createdAt: now },
        });
      }
      for (const [id, delta] of deltas) {
        await tx.ledgerAccount.update({
          where: { id },
          data: { postedBalance: { increment: BigInt(delta) }, version: { increment: 1 } },
        });
      }
      return { transactionId: txRow.id, replayed: false };
    });
  }

  /** Reserves money on an account. Fails with INSUFFICIENT_BALANCE when available < amount. */
  async hold(input: HoldInput, db: Db = this.prisma): Promise<Hold> {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error(`Invalid hold amount ${input.amount}`);
    return inTx(db, async (tx) => {
      const acc = (await this.lock(tx, [input.accountId])).get(input.accountId)!;
      const available = num(acc.postedBalance) - num(acc.heldBalance);
      if (available < input.amount) {
        throw new ApiException('INSUFFICIENT_BALANCE', { accountId: acc.id, available, required: input.amount });
      }
      const hold = await tx.hold.create({
        data: {
          createdAt: this.clock.now(),
          accountId: input.accountId,
          amount: BigInt(input.amount),
          kind: input.kind,
          requestId: input.requestId ?? null,
          slotId: input.slotId ?? null,
          assignmentId: input.assignmentId ?? null,
          quoteId: input.quoteId ?? null,
        },
      });
      await tx.ledgerAccount.update({
        where: { id: input.accountId },
        data: { heldBalance: { increment: BigInt(input.amount) }, version: { increment: 1 } },
      });
      return hold;
    });
  }

  /** Releases an active hold (idempotent: already released/captured holds are left as they are). */
  async releaseHold(holdId: string, db: Db = this.prisma): Promise<void> {
    await inTx(db, async (tx) => {
      const hold = await tx.hold.findUnique({ where: { id: holdId } });
      if (!hold || hold.status !== 'ACTIVE') return;
      await this.lock(tx, [hold.accountId]);
      const res = await tx.hold.updateMany({
        where: { id: holdId, status: 'ACTIVE' },
        data: { status: 'RELEASED', resolvedAt: this.clock.now() },
      });
      if (res.count === 0) return;
      await tx.ledgerAccount.update({
        where: { id: hold.accountId },
        data: { heldBalance: { decrement: hold.amount }, version: { increment: 1 } },
      });
    });
  }

  /** Converts an active hold into a posted debit to `toAccountId`. Idempotent; capturing a released hold fails. */
  async captureHold(holdId: string, input: CaptureInput, db: Db = this.prisma): Promise<{ transactionId: string }> {
    return inTx(db, async (tx) => {
      const hold = await tx.hold.findUnique({ where: { id: holdId } });
      if (!hold) throw new ApiException('NOT_FOUND', { holdId });
      if (hold.status === 'CAPTURED' && hold.capturedTxId) return { transactionId: hold.capturedTxId };
      if (hold.status !== 'ACTIVE') throw new ApiException('INVALID_STATE', { holdId, status: hold.status });
      await this.lock(tx, [hold.accountId, input.toAccountId]);
      await tx.ledgerAccount.update({
        where: { id: hold.accountId },
        data: { heldBalance: { decrement: hold.amount }, version: { increment: 1 } },
      });
      const amount = num(hold.amount);
      const { transactionId } = await this.post(
        {
          kind: input.kind,
          idempotencyKey: input.idempotencyKey,
          entries: [
            { accountId: hold.accountId, amount: -amount },
            { accountId: input.toAccountId, amount },
          ],
          memo: input.memo,
          refs: input.refs,
          actor: input.actor,
          allowOverdraft: [hold.accountId],
        },
        tx,
      );
      await tx.hold.update({
        where: { id: holdId },
        data: { status: 'CAPTURED', capturedTxId: transactionId, resolvedAt: this.clock.now() },
      });
      return { transactionId };
    });
  }

  async balance(accountId: string, db: Db = this.prisma): Promise<{ posted: number; held: number; available: number }> {
    const acc = await db.ledgerAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new ApiException('NOT_FOUND', { ledgerAccountId: accountId });
    const posted = num(acc.postedBalance);
    const held = num(acc.heldBalance);
    return { posted, held, available: posted - held };
  }

  async summary(accountId: string, db: Db = this.prisma): Promise<WalletSummary> {
    const acc = await db.ledgerAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new ApiException('NOT_FOUND', { ledgerAccountId: accountId });
    const s = await this.settings.get();
    const posted = num(acc.postedBalance);
    const held = num(acc.heldBalance);
    const available = posted - held;
    return { accountId: acc.id, currency: acc.currency, posted, held, available, isDebt: posted < 0, lowBalance: available < s.lowBalanceThreshold };
  }

  /** Newest first. Cursor = last entry id (UUID v7 is time ordered). */
  async listTransactions(
    accountId: string,
    opts: { cursor?: string; limit?: number },
    db: Db = this.prisma,
  ): Promise<{ items: LedgerTxView[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    const entries = await db.ledgerEntry.findMany({
      where: { accountId, ...(opts.cursor ? { id: { lt: opts.cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: { transaction: true },
    });
    const page = entries.slice(0, limit);
    const requestIds = [...new Set(page.map((e) => e.transaction.requestId).filter((v): v is string => !!v))];
    const projectIds = [...new Set(page.map((e) => e.transaction.projectId).filter((v): v is string => !!v))];
    const [requests, projects] = await Promise.all([
      requestIds.length ? db.serviceRequest.findMany({ where: { id: { in: requestIds } }, select: { id: true, number: true } }) : [],
      projectIds.length ? db.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, number: true } }) : [],
    ]);
    const reqNo = new Map(requests.map((r) => [r.id, r.number]));
    const projNo = new Map(projects.map((p) => [p.id, p.number]));
    return {
      items: page.map((e) => ({
        id: e.id,
        kind: e.transaction.kind,
        amount: num(e.amount),
        balanceAfter: num(e.balanceAfter),
        createdAt: e.createdAt.toISOString(),
        memo: e.transaction.memo,
        requestNumber: e.transaction.requestId ? (reqNo.get(e.transaction.requestId) ?? null) : null,
        projectNumber: e.transaction.projectId ? (projNo.get(e.transaction.projectId) ?? null) : null,
      })),
      nextCursor: entries.length > limit ? page[page.length - 1]!.id : null,
    };
  }

  /** Recomputes balances from entries and holds; returns accounts whose cached balances differ. */
  async verifyIntegrity(db: Db = this.prisma): Promise<Array<{ accountId: string; posted: number; computedPosted: number; held: number; computedHeld: number }>> {
    const rows = await db.$queryRawUnsafe<Array<{ id: string; posted: bigint; computed_posted: bigint; held: bigint; computed_held: bigint }>>(
      `SELECT a.id::text AS id, a."postedBalance" AS posted,
              COALESCE((SELECT SUM(e.amount) FROM ledger_entries e WHERE e."accountId" = a.id), 0)::bigint AS computed_posted,
              a."heldBalance" AS held,
              COALESCE((SELECT SUM(h.amount) FROM holds h WHERE h."accountId" = a.id AND h.status = 'ACTIVE'), 0)::bigint AS computed_held
         FROM ledger_accounts a`,
    );
    return rows
      .filter((r) => r.posted !== r.computed_posted || r.held !== r.computed_held)
      .map((r) => ({ accountId: r.id, posted: num(r.posted), computedPosted: num(r.computed_posted), held: num(r.held), computedHeld: num(r.computed_held) }));
  }

  /** Sum of all posted entries (must always be 0). */
  async globalSum(db: Db = this.prisma): Promise<number> {
    const r = await db.$queryRawUnsafe<Array<{ s: bigint | null }>>(`SELECT SUM(amount)::bigint AS s FROM ledger_entries`);
    return num(r[0]?.s ?? 0n);
  }
}
