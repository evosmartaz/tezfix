import { Injectable } from '@nestjs/common';
import {
  tzFold,
  type AdminAssignmentRow,
  type AdminHandymanRow,
  type EndpointOutput,
  type EndpointQuery,
  type FileRef,
  type Locale,
  type api,
} from '@tezfiks/shared';
import { PrismaService } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { ApiException } from '../../common/http/api-exception';
import { SettingsService } from '../../common/settings/settings.service';
import { decodeCursor, encodeCursor, iso, num, numOrNull, ratingAvg } from '../../common/mapping';
import { LedgerService } from '../ledger/ledger.service';
import { FilesService } from '../files/files.service';
import { CategoriesService } from '../categories/categories.service';
import { ProviderViewsService } from '../pro/provider-views.service';
import { fullName, phoneSearchDigits } from '../pro/provider-common';
import type { Prisma, VerificationSubmission } from '../../generated/prisma/client';

type HandymenQuery = EndpointQuery<typeof api.admin.handymen>;
type CompaniesQuery = EndpointQuery<typeof api.admin.companies>;
export type AdminHandymanDetail = EndpointOutput<typeof api.admin.handyman>;
export type AdminCompanyDetail = EndpointOutput<typeof api.admin.company>;
type AdminKycView = NonNullable<AdminHandymanDetail['kyc']>;
type StrikeView = AdminHandymanDetail['strikes'][number];
type AdminCompanyRow = AdminCompanyDetail['row'];

interface Cursor {
  c: string;
  i: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decodes a list cursor; a malformed or crafted one is a VALIDATION_FAILED, never a database error. */
function listCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  const cur = decodeCursor<Partial<Cursor>>(raw);
  const ok =
    !!cur &&
    typeof cur.c === 'string' &&
    typeof cur.i === 'string' &&
    UUID_RE.test(cur.i) &&
    /^\d{4}-\d{2}-\d{2}T/.test(cur.c) &&
    !Number.isNaN(Date.parse(cur.c));
  if (!ok) throw new ApiException('VALIDATION_FAILED', { field: 'cursor' });
  return cur as Cursor;
}

const DEFAULT_LIMIT = 20;
const RECENT_ASSIGNMENTS = 10;

const assignmentInclude = {
  request: { select: { number: true, customerAccount: { select: { owner: { select: { firstName: true, lastName: true, phone: true } } } } } },
  handyman: { select: { user: { select: { firstName: true, lastName: true, phone: true } } } },
  company: { select: { name: true } },
} satisfies Prisma.AssignmentInclude;
type AssignmentWithRefs = Prisma.AssignmentGetPayload<{ include: typeof assignmentInclude }>;

/** Builds a parameterised WHERE clause for raw list queries. */
class SqlWhere {
  readonly params: unknown[] = [];
  readonly conds: string[] = [];
  p(v: unknown): string {
    this.params.push(v);
    return `$${this.params.length}`;
  }
  add(cond: string): void {
    this.conds.push(cond);
  }
  get sql(): string {
    return this.conds.length ? `WHERE ${this.conds.join(' AND ')}` : '';
  }
}

/** Admin read side for providers: handyman/company lists (tabs, tz_fold search) and details with the KYC review view. */
@Injectable()
export class AdminProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
    private readonly files: FilesService,
    private readonly categories: CategoriesService,
    private readonly views: ProviderViewsService,
  ) {}

  // ------------------------------------------------------------- handymen

  async listHandymen(q: HandymenQuery, locale: Locale): Promise<EndpointOutput<typeof api.admin.handymen>> {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const w = new SqlWhere();
    if (q.tab === 'pending') w.add(`h.status = 'PENDING_REVIEW'`);
    if (q.tab === 'blocked') w.add(`(h.status = 'BLOCKED' OR u.status = 'BLOCKED')`);
    if (q.q) {
      const f = w.p(tzFold(q.q));
      const ors = [
        `strpos(tz_fold(coalesce(u."firstName", '') || ' ' || coalesce(u."lastName", '')), ${f}) > 0`,
        `strpos(tz_fold(coalesce(c.name, '')), ${f}) > 0`,
      ];
      const digits = phoneSearchDigits(q.q);
      if (digits) ors.push(`strpos(regexp_replace(u.phone, '[^0-9]', '', 'g'), ${w.p(digits)}) > 0`);
      w.add(`(${ors.join(' OR ')})`);
    }
    const cur = listCursor(q.cursor);
    if (cur) w.add(`(h."createdAt", h.id) < (${w.p(cur.c)}::timestamptz, ${w.p(cur.i)}::uuid)`);
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT h.id FROM handyman_profiles h JOIN users u ON u.id = h."userId" LEFT JOIN companies c ON c.id = h."companyId"
       ${w.sql} ORDER BY h."createdAt" DESC, h.id DESC LIMIT ${limit + 1}`,
      ...w.params,
    );
    const hasMore = rows.length > limit;
    const ids = rows.slice(0, limit).map((r) => r.id);
    const items = await this.handymanRows(ids, locale);
    const last = hasMore ? items[items.length - 1] : undefined;
    const [all, pending, blocked] = await Promise.all([
      this.prisma.handymanProfile.count(),
      this.prisma.handymanProfile.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.handymanProfile.count({ where: { OR: [{ status: 'BLOCKED' }, { user: { status: 'BLOCKED' } }] } }),
    ]);
    return {
      items,
      nextCursor: last ? encodeCursor({ c: last.createdAt, i: last.id } satisfies Cursor) : null,
      counts: { all, pending, blocked },
    };
  }

  /** Rows in the order of `ids`. */
  async handymanRows(ids: string[], locale: Locale): Promise<AdminHandymanRow[]> {
    if (!ids.length) return [];
    const profiles = await this.prisma.handymanProfile.findMany({
      where: { id: { in: ids } },
      include: {
        user: { select: { firstName: true, lastName: true, phone: true, status: true } },
        company: { select: { name: true } },
        trades: { include: { category: true } },
        wallet: { select: { postedBalance: true, heldBalance: true } },
      },
    });
    const s = await this.settings.get();
    const byId = new Map(profiles.map((p) => [p.id, p]));
    return ids
      .map((id) => byId.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => {
        const solo = p.kind === 'SOLO';
        const available = solo && p.wallet ? num(p.wallet.postedBalance) - num(p.wallet.heldBalance) : null;
        let displayStatus: AdminHandymanRow['displayStatus'];
        if (p.status === 'BLOCKED' || p.user.status === 'BLOCKED') displayStatus = 'BLOCKED';
        else if (p.status === 'PENDING_REVIEW') displayStatus = 'PENDING';
        else if (p.status === 'REJECTED') displayStatus = 'REJECTED';
        else if (p.status === 'DRAFT') displayStatus = 'DRAFT';
        else displayStatus = solo && (available ?? 0) < s.requestFee ? 'LOW_BALANCE' : 'ACTIVE';
        return {
          id: p.id,
          userId: p.userId,
          firstName: p.user.firstName ?? '',
          lastName: p.user.lastName ?? '',
          phone: p.user.phone,
          kind: p.kind,
          companyName: p.company?.name ?? null,
          trades: p.trades.map((t) => this.categories.name(t.category, locale)),
          ratingAvg: ratingAvg(p.ratingSum, p.ratingCount),
          completedCount: p.completedCount,
          walletBalance: available,
          status: p.status,
          displayStatus,
          isOnline: p.isOnline,
          strikes: p.strikes,
          isBot: p.isBot,
          createdAt: p.createdAt.toISOString(),
        };
      });
  }

  async handymanDetail(id: string, adminId: string, locale: Locale): Promise<AdminHandymanDetail> {
    const p = await this.prisma.handymanProfile.findUnique({ where: { id }, include: { user: { select: { photoFileId: true } } } });
    if (!p) throw new ApiException('NOT_FOUND', { entity: 'HandymanProfile' });
    const [row] = await this.handymanRows([id], locale);
    const solo = p.kind === 'SOLO';
    const latest = await this.prisma.verificationSubmission.findFirst({ where: { handymanId: id }, orderBy: { createdAt: 'desc' } });
    const assignments = await this.prisma.assignment.findMany({
      where: { handymanId: id },
      include: assignmentInclude,
      orderBy: { acceptedAt: 'desc' },
      take: RECENT_ASSIGNMENTS,
    });
    return {
      row: row!,
      photo: await this.views.photoRef(p.user.photoFileId),
      base: p.baseLat != null && p.baseLng != null ? { lat: p.baseLat, lng: p.baseLng } : null,
      serviceRadiusKm: p.serviceRadiusKm,
      rejectReason: p.rejectReason ?? null,
      kyc: latest ? await this.kycView(latest, adminId) : null,
      recentAssignments: assignments.map((a) => this.assignmentRow(a)),
      strikes: await this.strikes({ handymanId: id }),
      wallet: solo && p.walletAccountId ? await this.ledger.summary(p.walletAccountId) : null,
      earningsBalance: solo && p.earningsAccountId ? (await this.ledger.balance(p.earningsAccountId)).posted : null,
    };
  }

  // ------------------------------------------------------------- companies

  async listCompanies(q: CompaniesQuery): Promise<EndpointOutput<typeof api.admin.companies>> {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const w = new SqlWhere();
    if (q.tab === 'pending') w.add(`c.status = 'PENDING_REVIEW'`);
    if (q.tab === 'blocked') w.add(`c.status = 'BLOCKED'`);
    if (q.q) {
      const f = w.p(tzFold(q.q));
      const ors = [
        `strpos(tz_fold(c.name), ${f}) > 0`,
        `strpos(tz_fold(coalesce(u."firstName", '') || ' ' || coalesce(u."lastName", '')), ${f}) > 0`,
      ];
      const digits = q.q.replace(/\s/g, '');
      if (/^\d{3,}$/.test(digits)) ors.push(`strpos(c.voen, ${w.p(digits)}) > 0`);
      const phone = phoneSearchDigits(q.q);
      if (phone) ors.push(`strpos(regexp_replace(u.phone, '[^0-9]', '', 'g'), ${w.p(phone)}) > 0`);
      w.add(`(${ors.join(' OR ')})`);
    }
    const cur = listCursor(q.cursor);
    if (cur) w.add(`(c."createdAt", c.id) < (${w.p(cur.c)}::timestamptz, ${w.p(cur.i)}::uuid)`);
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT c.id FROM companies c JOIN users u ON u.id = c."ownerUserId"
       ${w.sql} ORDER BY c."createdAt" DESC, c.id DESC LIMIT ${limit + 1}`,
      ...w.params,
    );
    const hasMore = rows.length > limit;
    const items = await this.companyRows(rows.slice(0, limit).map((r) => r.id));
    const last = hasMore ? items[items.length - 1] : undefined;
    const [all, pending, blocked] = await Promise.all([
      this.prisma.company.count(),
      this.prisma.company.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.company.count({ where: { status: 'BLOCKED' } }),
    ]);
    return {
      items,
      nextCursor: last ? encodeCursor({ c: last.createdAt, i: last.id } satisfies Cursor) : null,
      counts: { all, pending, blocked },
    };
  }

  async companyRows(ids: string[]): Promise<AdminCompanyRow[]> {
    if (!ids.length) return [];
    const companies = await this.prisma.company.findMany({
      where: { id: { in: ids } },
      include: {
        owner: { select: { firstName: true, lastName: true, phone: true } },
        wallet: { select: { postedBalance: true, heldBalance: true } },
        _count: { select: { members: { where: { status: 'ACTIVE' } } } },
      },
    });
    const byId = new Map(companies.map((c) => [c.id, c]));
    return ids
      .map((id) => byId.get(id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => ({
        id: c.id,
        name: c.name,
        voen: c.voen,
        legalForm: c.legalForm,
        status: c.status,
        ownerName: fullName(c.owner.firstName, c.owner.lastName),
        ownerPhone: c.owner.phone,
        membersCount: c._count.members,
        walletBalance: num(c.wallet.postedBalance) - num(c.wallet.heldBalance),
        ratingAvg: ratingAvg(c.ratingSum, c.ratingCount),
        strikes: c.strikes,
        createdAt: c.createdAt.toISOString(),
      }));
  }

  async companyDetail(id: string, adminId: string, locale: Locale): Promise<AdminCompanyDetail> {
    const c = await this.prisma.company.findUnique({ where: { id }, include: { trades: { include: { category: true } } } });
    if (!c) throw new ApiException('NOT_FOUND', { entity: 'Company' });
    const [row] = await this.companyRows([id]);
    const latest = await this.prisma.verificationSubmission.findFirst({ where: { companyId: id }, orderBy: { createdAt: 'desc' } });
    return {
      row: row!,
      finalPriceEntry: c.finalPriceEntry,
      isVatPayer: c.isVatPayer,
      trades: c.trades.map((t) => this.categories.name(t.category, locale)),
      rejectReason: c.rejectReason ?? null,
      kyc: latest ? await this.kycView(latest, adminId) : null,
      members: await this.views.memberViews(id, locale),
      wallet: await this.ledger.summary(c.walletAccountId),
      earningsBalance: (await this.ledger.balance(c.earningsAccountId)).posted,
      strikes: await this.strikes({ companyId: id }),
    };
  }

  // ------------------------------------------------------------ shared parts

  /**
   * The KYC review view with admin-signed URLs (FilesService.ref(file, { adminId }) semantics: KYC URLs carry the admin
   * id, expire after at most 10 minutes and are logged again on download). Every view writes one kyc_access_logs row per
   * shown (not purged) file. Purged files keep a URL that answers 404.
   */
  async kycView(s: VerificationSubmission, adminId: string): Promise<AdminKycView | null> {
    const ids = [s.idFrontFileId, s.idBackFileId, s.selfieFrontFileId, s.selfieTurnFileId, s.selfieBlinkFileId, ...s.tradeProofFileIds, ...s.companyDocFileIds];
    const rows = await this.prisma.file.findMany({ where: { id: { in: ids } } });
    // Live files go through FilesService.ref(file, { adminId }) (admin-signed KYC URL); purged ones keep a dead URL.
    const refs = new Map<string, FileRef>();
    for (const f of rows) refs.set(f.id, f.deletedAt ? this.files.refOf(f, { adminId }) : await this.files.ref(f, { adminId }));
    const ref = (fileId: string): FileRef | null => refs.get(fileId) ?? null;
    const idFront = ref(s.idFrontFileId);
    const idBack = ref(s.idBackFileId);
    const selfieFront = ref(s.selfieFrontFileId);
    const selfieTurn = ref(s.selfieTurnFileId);
    const selfieBlink = ref(s.selfieBlinkFileId);
    if (!idFront || !idBack || !selfieFront || !selfieTurn || !selfieBlink) return null;
    const shown = rows.filter((r) => !r.deletedAt);
    if (shown.length) {
      const at = this.clock.now();
      await this.prisma.kycAccessLog.createMany({ data: shown.map((f) => ({ adminId, fileId: f.id, at })) });
    }
    const reviewer = s.reviewedByAdminId
      ? await this.prisma.adminUser.findUnique({ where: { id: s.reviewedByAdminId }, select: { name: true } })
      : null;
    const hasExtracted = s.docNumberLast4 != null || s.birthDate != null || s.docExpiry != null;
    return {
      submissionId: s.id,
      status: s.status,
      submittedAt: s.createdAt.toISOString(),
      files: {
        idFront,
        idBack,
        selfieFront,
        selfieTurn,
        selfieBlink,
        tradeProofs: s.tradeProofFileIds.map(ref).filter((r): r is NonNullable<typeof r> => !!r),
        companyDocs: s.companyDocFileIds.map(ref).filter((r): r is NonNullable<typeof r> => !!r),
      },
      selfieChecks: s.selfieChecks ?? null,
      consent: { policyVersion: s.consentPolicyVersion, locale: s.consentLocale, acceptedAt: s.consentAcceptedAt.toISOString() },
      extracted: hasExtracted
        ? {
            docNumberLast4: s.docNumberLast4 ?? null,
            birthDate: s.birthDate ? s.birthDate.toISOString().slice(0, 10) : null,
            expiry: s.docExpiry ? s.docExpiry.toISOString().slice(0, 10) : null,
          }
        : null,
      reviewedAt: iso(s.reviewedAt),
      reviewerName: reviewer?.name ?? null,
      rejectReason: s.rejectReason ?? null,
    };
  }

  async strikes(owner: { handymanId: string } | { companyId: string }): Promise<StrikeView[]> {
    const events = await this.prisma.strikeEvent.findMany({ where: owner, orderBy: { createdAt: 'desc' }, take: 50 });
    const assignmentIds = events.map((e) => e.assignmentId).filter((x): x is string => !!x);
    const numbers = new Map(
      (
        await this.prisma.assignment.findMany({
          where: { id: { in: assignmentIds } },
          select: { id: true, request: { select: { number: true } } },
        })
      ).map((a) => [a.id, a.request.number]),
    );
    return events.map((e) => ({
      id: e.id,
      reason: e.reason,
      requestNumber: e.assignmentId ? (numbers.get(e.assignmentId) ?? null) : null,
      createdAt: e.createdAt.toISOString(),
      clearedAt: iso(e.clearedAt),
    }));
  }

  assignmentRow(a: AssignmentWithRefs): AdminAssignmentRow {
    const owner = a.request.customerAccount.owner;
    const provider = a.handyman.user;
    return {
      id: a.id,
      requestId: a.requestId,
      requestNumber: a.request.number,
      status: a.status,
      providerType: a.providerType,
      providerName: fullName(provider.firstName, provider.lastName),
      providerPhone: provider.phone,
      companyName: a.company?.name ?? null,
      customerName: fullName(owner.firstName, owner.lastName),
      customerPhone: owner.phone,
      acceptedAt: a.acceptedAt.toISOString(),
      completedAt: iso(a.completedAt),
      cancelledAt: iso(a.cancelledAt),
      cancelledBy: a.cancelledBy ?? null,
      price:
        a.totalAmount != null
          ? { labor: num(a.laborAmount), materials: num(a.materialsAmount), total: num(a.totalAmount) }
          : null,
      paymentMethod: a.paymentMethod ?? null,
      fee: a.feeHoldId || a.feeAmount > 0n ? { amount: num(a.feeAmount), captured: a.feeCaptured, refunded: a.feeRefunded } : null,
      contactUnlockedAt: iso(a.contactUnlockedAt),
      etaSec: numOrNull(a.etaSec),
    };
  }
}
