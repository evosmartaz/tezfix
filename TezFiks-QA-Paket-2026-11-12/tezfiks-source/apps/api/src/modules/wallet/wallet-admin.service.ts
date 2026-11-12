import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';
import type {
  AdminLedgerTx,
  LedgerAccountKind,
  LedgerOwnerType,
  LedgerTxKind,
  WalletSummary,
} from '@tezfiks/shared';
import { PrismaService, inTx, type Db } from '../../infra/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { AuditService } from '../../common/audit/audit.service';
import { ApiException } from '../../common/http/api-exception';
import { num } from '../../common/mapping';
import { newId } from '../../infra/ids';
import type { Prisma } from '../../generated/prisma/client';
import { WalletEventsService } from './wallet-events.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fullName(first: string | null | undefined, last: string | null | undefined): string {
  const name = [first, last]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
    .join(' ');
  return name || '—';
}

export interface AdjustWalletInput {
  owner: { type: 'CUSTOMER_ACCOUNT' | 'HANDYMAN' | 'COMPANY'; id: string };
  account: 'WALLET' | 'EARNINGS';
  amount: number;
  reason: string;
}

export interface LedgerQuery {
  cursor?: string;
  limit?: number;
  kind?: LedgerTxKind;
  ownerType?: LedgerOwnerType;
  ownerId?: string;
}

type TxWithEntries = Prisma.LedgerTransactionGetPayload<{
  include: { entries: { include: { account: true } } };
}>;

/** Admin money tools: manual wallet adjustments and the ledger explorer (board 05 "Maliyyə"). */
@Injectable()
export class WalletAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly walletEvents: WalletEventsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Posts ADMIN_ADJUSTMENT between the platform ADJUSTMENTS account and the target account.
   * Negative amounts may not overdraw an account that does not allow negative balances (INSUFFICIENT_BALANCE).
   * Demo only (spec: "Demo only: admins can top up balances"): DEMO_DISABLED unless the API runs with DEMO_MODE=true.
   */
  async adjust(
    adminId: string,
    input: AdjustWalletInput,
    ip: string | null,
  ): Promise<{ wallet: WalletSummary; transactionId: string }> {
    if (!this.env.DEMO_MODE) throw new ApiException('DEMO_DISABLED', { reason: 'ADMIN_ADJUSTMENTS_ARE_DEMO_ONLY' });
    const acc = await this.prisma.ledgerAccount.findUnique({
      where: {
        ownerType_ownerId_kind_currency: {
          ownerType: input.owner.type,
          ownerId: input.owner.id,
          kind: input.account,
          currency: 'AZN',
        },
      },
    });
    if (!acc)
      throw new ApiException('NOT_FOUND', {
        entity: 'LedgerAccount',
        owner: input.owner,
        account: input.account,
      });
    const adjustments = await this.ledger.platformAccountId('ADJUSTMENTS');
    const { transactionId } = await inTx(this.prisma, async (tx) => {
      const before = await this.ledger.balance(acc.id, tx);
      const res = await this.ledger.post(
        {
          kind: 'ADMIN_ADJUSTMENT',
          idempotencyKey: `admin-adjust:${newId()}`,
          entries: [
            { accountId: adjustments, amount: -input.amount },
            { accountId: acc.id, amount: input.amount },
          ],
          memo: input.reason,
          actor: { type: 'ADMIN', id: adminId },
          metadata: { reason: input.reason },
        },
        tx,
      );
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: adminId,
          action: 'wallet.adjust',
          entityType: 'LedgerAccount',
          entityId: acc.id,
          before: {
            ownerType: acc.ownerType,
            ownerId: acc.ownerId,
            kind: acc.kind,
            posted: before.posted,
            held: before.held,
          },
          after: {
            posted: before.posted + input.amount,
            amount: input.amount,
            reason: input.reason,
            transactionId: res.transactionId,
          },
          ip,
        },
        tx,
      );
      return res;
    });
    await this.walletEvents.notifyAccount(acc.id);
    return { wallet: await this.ledger.summary(acc.id), transactionId };
  }

  /** Newest first, cursor = transaction id. Filters by kind and/or by the owner of any entry's account. */
  async listTransactions(q: LedgerQuery): Promise<{ items: AdminLedgerTx[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 100);
    if (q.cursor && !UUID_RE.test(q.cursor))
      throw new ApiException('VALIDATION_FAILED', { in: 'query', field: 'cursor' });
    const accountFilter: Prisma.LedgerAccountWhereInput = {
      ...(q.ownerType ? { ownerType: q.ownerType } : {}),
      ...(q.ownerId ? { ownerId: q.ownerId } : {}),
    };
    const where: Prisma.LedgerTransactionWhereInput = {
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.ownerType || q.ownerId ? { entries: { some: { account: accountFilter } } } : {}),
      ...(q.cursor ? { id: { lt: q.cursor } } : {}),
    };
    const rows = await this.prisma.ledgerTransaction.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: { entries: { include: { account: true }, orderBy: { id: 'asc' } } },
    });
    const page = rows.slice(0, limit);
    return {
      items: await this.mapTransactions(page),
      nextCursor: rows.length > limit ? page[page.length - 1]!.id : null,
    };
  }

  /** Every ledger transaction that references a request (admin request detail), oldest first. */
  async forRequest(requestId: string, db: Db = this.prisma): Promise<AdminLedgerTx[]> {
    const rows = await db.ledgerTransaction.findMany({
      where: { requestId },
      orderBy: { id: 'asc' },
      include: { entries: { include: { account: true }, orderBy: { id: 'asc' } } },
    });
    return this.mapTransactions(rows, db);
  }

  /** Owner display names for ledger accounts: users' full names, company names, "TezFiks: <KIND>" for platform accounts. */
  async ownerNames(
    accounts: Array<{ ownerType: LedgerOwnerType; ownerId: string; kind: LedgerAccountKind }>,
    db: Db = this.prisma,
  ): Promise<(a: { ownerType: LedgerOwnerType; ownerId: string; kind: LedgerAccountKind }) => string> {
    const ids = (t: LedgerOwnerType) => [
      ...new Set(accounts.filter((a) => a.ownerType === t).map((a) => a.ownerId)),
    ];
    const [customers, handymen, companies] = await Promise.all([
      ids('CUSTOMER_ACCOUNT').length
        ? db.customerAccount.findMany({
            where: { id: { in: ids('CUSTOMER_ACCOUNT') } },
            select: { id: true, owner: { select: { firstName: true, lastName: true } } },
          })
        : [],
      ids('HANDYMAN').length
        ? db.handymanProfile.findMany({
            where: { id: { in: ids('HANDYMAN') } },
            select: { id: true, user: { select: { firstName: true, lastName: true } } },
          })
        : [],
      ids('COMPANY').length
        ? db.company.findMany({ where: { id: { in: ids('COMPANY') } }, select: { id: true, name: true } })
        : [],
    ]);
    const names = new Map<string, string>();
    for (const c of customers)
      names.set(`CUSTOMER_ACCOUNT:${c.id}`, fullName(c.owner.firstName, c.owner.lastName));
    for (const h of handymen) names.set(`HANDYMAN:${h.id}`, fullName(h.user.firstName, h.user.lastName));
    for (const c of companies) names.set(`COMPANY:${c.id}`, c.name);
    return (a) =>
      a.ownerType === 'PLATFORM' ? `TezFiks: ${a.kind}` : (names.get(`${a.ownerType}:${a.ownerId}`) ?? '—');
  }

  private async mapTransactions(rows: TxWithEntries[], db: Db = this.prisma): Promise<AdminLedgerTx[]> {
    const accounts = rows.flatMap((r) => r.entries.map((e) => e.account));
    const nameOf = await this.ownerNames(accounts, db);
    const requestIds = [...new Set(rows.map((r) => r.requestId).filter((v): v is string => !!v))];
    const adminIds = [
      ...new Set(rows.filter((r) => r.actorType === 'ADMIN' && r.actorId).map((r) => r.actorId!)),
    ];
    const userIds = [
      ...new Set(rows.filter((r) => r.actorType === 'USER' && r.actorId).map((r) => r.actorId!)),
    ];
    const [requests, admins, users] = await Promise.all([
      requestIds.length
        ? db.serviceRequest.findMany({
            where: { id: { in: requestIds } },
            select: { id: true, number: true },
          })
        : [],
      adminIds.length
        ? db.adminUser.findMany({
            where: { id: { in: adminIds } },
            select: { id: true, name: true, email: true },
          })
        : [],
      userIds.length
        ? db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [],
    ]);
    const reqNo = new Map(requests.map((r) => [r.id, r.number]));
    const adminName = new Map(admins.map((a) => [a.id, a.name || a.email]));
    const userName = new Map(users.map((u) => [u.id, fullName(u.firstName, u.lastName)]));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      createdAt: r.createdAt.toISOString(),
      memo: r.memo,
      actor:
        r.actorType === 'ADMIN' && r.actorId
          ? (adminName.get(r.actorId) ?? 'admin')
          : r.actorType === 'USER' && r.actorId
            ? (userName.get(r.actorId) ?? null)
            : null,
      requestNumber: r.requestId ? (reqNo.get(r.requestId) ?? null) : null,
      entries: r.entries.map((e) => ({
        accountId: e.accountId,
        ownerType: e.account.ownerType,
        ownerId: e.account.ownerType === 'PLATFORM' ? null : e.account.ownerId,
        ownerName: nameOf(e.account),
        accountKind: e.account.kind,
        amount: num(e.amount),
        balanceAfter: num(e.balanceAfter),
      })),
    }));
  }
}
