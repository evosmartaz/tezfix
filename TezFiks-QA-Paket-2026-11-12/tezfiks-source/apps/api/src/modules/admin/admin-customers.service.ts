import { Injectable } from '@nestjs/common';
import { tzFold, type EndpointOutput, type EndpointQuery, type Locale, type api } from '@tezfiks/shared';
import { PrismaService } from '../../infra/prisma.service';
import { ApiException } from '../../common/http/api-exception';
import { num, ratingAvg } from '../../common/mapping';
import { LedgerService } from '../ledger/ledger.service';
import { AdminRequestsService, customerName } from './admin-requests.service';
import { DEFAULT_LIMIT, SqlWhere, decodeTimeCursor, encodeTimeCursor, phoneSearchDigits } from './admin-common';

type CustomersQuery = EndpointQuery<typeof api.admin.customers>;
type CustomersPage = EndpointOutput<typeof api.admin.customers>;
type CustomerDetail = EndpointOutput<typeof api.admin.customer>;
type CustomerRow = CustomerDetail['row'];

const RECENT_REQUESTS = 10;

/** Admin customers (Müştərilər): list with type filter and tz_fold / phone / VÖEN search, detail with wallet and recent requests. */
@Injectable()
export class AdminCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly requests: AdminRequestsService,
  ) {}

  async list(q: CustomersQuery): Promise<CustomersPage> {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const w = new SqlWhere();
    if (q.type) w.add(`ca.type = ${w.p(q.type)}::"CustomerType"`);
    if (q.q) {
      const f = w.p(tzFold(q.q));
      const ors = [
        `strpos(tz_fold(coalesce(u."firstName", '') || ' ' || coalesce(u."lastName", '')), ${f}) > 0`,
        `strpos(tz_fold(coalesce(ca."companyName", '')), ${f}) > 0`,
      ];
      const compact = q.q.replace(/\s/g, '');
      if (/^\d{3,}$/.test(compact)) ors.push(`strpos(coalesce(ca.voen, ''), ${w.p(compact)}) > 0`);
      const digits = phoneSearchDigits(q.q);
      if (digits) ors.push(`strpos(regexp_replace(u.phone, '[^0-9]', '', 'g'), ${w.p(digits)}) > 0`);
      w.add(`(${ors.join(' OR ')})`);
    }
    const cur = decodeTimeCursor(q.cursor);
    if (cur) w.add(`(ca."createdAt", ca.id) < (${w.p(cur.c)}::timestamptz, ${w.p(cur.i)}::uuid)`);
    const found = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT ca.id FROM customer_accounts ca JOIN users u ON u.id = ca."ownerUserId"
       ${w.sql} ORDER BY ca."createdAt" DESC, ca.id DESC LIMIT ${limit + 1}`,
      ...w.params,
    );
    const hasMore = found.length > limit;
    const items = await this.rows(found.slice(0, limit).map((r) => r.id));
    const last = hasMore ? items[items.length - 1] : undefined;
    return { items, nextCursor: last ? encodeTimeCursor(last.createdAt, last.id) : null };
  }

  /** Rows in the order of `ids`. walletBalance is the available balance (negative while the customer owes a penalty). */
  async rows(ids: string[]): Promise<CustomerRow[]> {
    if (!ids.length) return [];
    const [accounts, counts] = await Promise.all([
      this.prisma.customerAccount.findMany({
        where: { id: { in: ids } },
        include: {
          owner: { select: { firstName: true, lastName: true, phone: true, status: true } },
          wallet: { select: { postedBalance: true, heldBalance: true } },
        },
      }),
      this.prisma.serviceRequest.groupBy({ by: ['customerAccountId'], where: { customerAccountId: { in: ids } }, _count: { _all: true } }),
    ]);
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const countOf = new Map(counts.map((c) => [c.customerAccountId, c._count._all]));
    return ids
      .map((id) => byId.get(id))
      .filter((a): a is NonNullable<typeof a> => !!a)
      .map((a) => ({
        id: a.id,
        userId: a.ownerUserId,
        name: customerName(a),
        phone: a.owner.phone,
        type: a.type,
        companyName: a.companyName ?? null,
        requestsCount: countOf.get(a.id) ?? 0,
        walletBalance: num(a.wallet.postedBalance) - num(a.wallet.heldBalance),
        ratingAvg: ratingAvg(a.ratingSum, a.ratingCount),
        userStatus: a.owner.status,
        createdAt: a.createdAt.toISOString(),
      }));
  }

  async detail(id: string, locale: Locale): Promise<CustomerDetail> {
    const acc = await this.prisma.customerAccount.findUnique({ where: { id }, select: { id: true, walletAccountId: true } });
    if (!acc) throw new ApiException('NOT_FOUND', { entity: 'CustomerAccount' });
    const [[row], wallet, recent] = await Promise.all([
      this.rows([id]),
      this.ledger.summary(acc.walletAccountId),
      this.prisma.serviceRequest.findMany({
        where: { customerAccountId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: RECENT_REQUESTS,
        select: { id: true },
      }),
    ]);
    return {
      row: row!,
      wallet,
      recentRequests: await this.requests.rows(
        recent.map((r) => r.id),
        locale,
      ),
    };
  }
}
