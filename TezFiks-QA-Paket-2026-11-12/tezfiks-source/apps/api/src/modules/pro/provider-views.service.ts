import { Injectable } from '@nestjs/common';
import {
  BUSY_ASSIGNMENT_STATUSES,
  type CategoryRef,
  type CompanyRole,
  type CompanyView,
  type FileRef,
  type KycStatus,
  type Locale,
  type MemberView,
  type ProProfile,
  type ProProfileResponse,
  type VerificationStatus,
} from '@tezfiks/shared';
import { PrismaService, type Db } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { ApiException } from '../../common/http/api-exception';
import { iso, num, ratingAvg } from '../../common/mapping';
import { LedgerService } from '../ledger/ledger.service';
import { FilesService } from '../files/files.service';
import { CategoriesService } from '../categories/categories.service';
import { KYC_MAX_SUBMISSIONS, KYC_WINDOW_MS } from './provider-common';

export type KycSubjectRef = { handymanId: string } | { companyId: string };

/**
 * Read models shared by the provider modules (pro, company, invites, kyc/admin): ProProfile, CompanyView, MemberView,
 * KycStatus, plus trade validation. Exported by ProModule.
 */
@Injectable()
export class ProviderViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly ledger: LedgerService,
    private readonly files: FilesService,
    private readonly categories: CategoriesService,
  ) {}

  /**
   * De-duplicated trade ids, each an active SERVICE category (VALIDATION_FAILED with details.invalid otherwise).
   * `within`: the trades must also be a subset of these ids (company workers get only company trades).
   */
  async validateTrades(ids: string[], opts: { within?: string[] } = {}, db: Db = this.prisma): Promise<string[]> {
    const unique = [...new Set(ids)];
    const active = new Set((await this.categories.activeServices(undefined, db)).map((c) => c.id));
    const allowed = opts.within ? new Set(opts.within) : null;
    const invalid = unique.filter((id) => !active.has(id) || (allowed && !allowed.has(id)));
    if (invalid.length) throw new ApiException('VALIDATION_FAILED', { field: 'tradeIds', invalid });
    return unique;
  }

  async tradeRefs(ids: string[], locale: Locale, db: Db = this.prisma): Promise<CategoryRef[]> {
    const refs = await this.categories.refs(ids, locale, db);
    return ids.map((id) => refs.get(id)).filter((r): r is CategoryRef => !!r);
  }

  async photoRef(fileId: string | null | undefined): Promise<FileRef | null> {
    if (!fileId) return null;
    const [ref] = await this.files.refs([fileId]);
    return ref ?? null;
  }

  /** Submissions of the subject within the last 24 h (Clock time). */
  async recentSubmissions(subject: KycSubjectRef, db: Db = this.prisma): Promise<number> {
    const since = new Date(this.clock.nowMs() - KYC_WINDOW_MS);
    return db.verificationSubmission.count({ where: { ...subject, createdAt: { gte: since } } });
  }

  /** KycStatus for a handyman profile or company in its current verification state. */
  async kycStatus(
    subject: KycSubjectRef,
    current: { status: VerificationStatus; rejectReason: string | null },
    db: Db = this.prisma,
  ): Promise<KycStatus> {
    const latest = await db.verificationSubmission.findFirst({ where: subject, orderBy: { createdAt: 'desc' } });
    const recent = await this.recentSubmissions(subject, db);
    return {
      status: !latest && current.status === 'DRAFT' ? 'NONE' : current.status,
      submittedAt: iso(latest?.createdAt ?? null),
      reviewedAt: iso(latest?.reviewedAt ?? null),
      rejectReason: current.status === 'REJECTED' ? (current.rejectReason ?? latest?.rejectReason ?? null) : null,
      attemptsLeft24h: Math.max(0, KYC_MAX_SUBMISSIONS - recent),
    };
  }

  /** KycStatus of a user without a handyman profile. */
  async noneKycStatus(): Promise<KycStatus> {
    return { status: 'NONE', submittedAt: null, reviewedAt: null, rejectReason: null, attemptsLeft24h: KYC_MAX_SUBMISSIONS };
  }

  async proProfile(profileId: string, locale: Locale): Promise<ProProfile> {
    const p = await this.prisma.handymanProfile.findUnique({
      where: { id: profileId },
      include: {
        user: { select: { firstName: true, lastName: true, photoFileId: true } },
        company: { select: { id: true, name: true, finalPriceEntry: true } },
        trades: { select: { categoryId: true } },
      },
    });
    if (!p) throw new ApiException('NOT_FOUND', { entity: 'HandymanProfile' });
    const solo = p.kind === 'SOLO';
    const wallet = solo && p.walletAccountId ? await this.ledger.summary(p.walletAccountId) : null;
    const earnings = solo && p.earningsAccountId ? await this.ledger.balance(p.earningsAccountId) : null;
    return {
      id: p.id,
      userId: p.userId,
      kind: p.kind,
      status: p.status,
      rejectReason: p.rejectReason ?? null,
      firstName: p.user.firstName ?? '',
      lastName: p.user.lastName ?? '',
      photo: await this.photoRef(p.user.photoFileId),
      company: p.company ? { id: p.company.id, name: p.company.name, finalPriceEntry: p.company.finalPriceEntry } : null,
      trades: await this.tradeRefs(
        p.trades.map((t) => t.categoryId),
        locale,
      ),
      serviceRadiusKm: p.serviceRadiusKm,
      base: p.baseLat != null && p.baseLng != null ? { lat: p.baseLat, lng: p.baseLng } : null,
      isOnline: p.isOnline,
      ratingAvg: ratingAvg(p.ratingSum, p.ratingCount),
      ratingCount: p.ratingCount,
      completedCount: p.completedCount,
      strikes: p.strikes,
      wallet,
      earningsBalance: earnings ? earnings.posted : null,
      kyc: await this.kycStatus({ handymanId: p.id }, { status: p.status, rejectReason: p.rejectReason ?? null }),
    };
  }

  /** Companies where the user is an ACTIVE MANAGER. */
  async managedCompanies(userId: string): Promise<ProProfileResponse['managedCompanies']> {
    const rows = await this.prisma.companyMember.findMany({
      where: { userId, role: 'MANAGER', status: 'ACTIVE' },
      include: { company: { select: { id: true, name: true, status: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map((m) => ({ id: m.company.id, name: m.company.name, status: m.company.status, role: m.role }));
  }

  async profileResponse(userId: string, locale: Locale): Promise<ProProfileResponse> {
    const p = await this.prisma.handymanProfile.findUnique({ where: { userId }, select: { id: true } });
    return {
      profile: p ? await this.proProfile(p.id, locale) : null,
      managedCompanies: await this.managedCompanies(userId),
    };
  }

  async companyView(companyId: string, myRole: CompanyRole, locale: Locale): Promise<CompanyView> {
    const c = await this.prisma.company.findUnique({ where: { id: companyId }, include: { trades: { select: { categoryId: true } } } });
    if (!c) throw new ApiException('NOT_FOUND', { entity: 'Company' });
    const [membersCount, onlineWorkers, wallet, earnings] = await Promise.all([
      this.prisma.companyMember.count({ where: { companyId, status: 'ACTIVE' } }),
      this.onlineWorkers(companyId),
      this.ledger.summary(c.walletAccountId),
      this.ledger.balance(c.earningsAccountId),
    ]);
    return {
      id: c.id,
      name: c.name,
      legalForm: c.legalForm,
      voen: c.voen,
      status: c.status,
      rejectReason: c.rejectReason ?? null,
      finalPriceEntry: c.finalPriceEntry,
      isVatPayer: c.isVatPayer,
      trades: await this.tradeRefs(
        c.trades.map((t) => t.categoryId),
        locale,
      ),
      base: c.baseLat != null && c.baseLng != null ? { lat: c.baseLat, lng: c.baseLng } : null,
      baseAddress: c.baseAddress ?? null,
      serviceRadiusKm: c.serviceRadiusKm,
      ratingAvg: ratingAvg(c.ratingSum, c.ratingCount),
      ratingCount: c.ratingCount,
      strikes: c.strikes,
      wallet,
      earningsBalance: earnings.posted,
      membersCount,
      onlineWorkers,
      myRole,
      kyc: await this.kycStatus({ companyId: c.id }, { status: c.status, rejectReason: c.rejectReason ?? null }),
    };
  }

  /** Workers of the company (ACTIVE members with a worker profile in it) whose DB flag isOnline is set. */
  async onlineWorkers(companyId: string): Promise<number> {
    return this.prisma.handymanProfile.count({
      where: { companyId, isOnline: true, user: { memberships: { some: { companyId, status: 'ACTIVE' } } } },
    });
  }

  /** Handyman ids (of `ids`) with an assignment in a busy status. */
  async busyHandymanIds(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.prisma.assignment.findMany({
      where: { handymanId: { in: ids }, status: { in: [...BUSY_ASSIGNMENT_STATUSES] } },
      select: { handymanId: true },
    });
    return new Set(rows.map((r) => r.handymanId));
  }

  /** ACTIVE members (managers first, then by join time). Includes phones: the company employs them (spec 4.4). */
  async memberViews(companyId: string, locale: Locale, opts: { userIds?: string[] } = {}): Promise<MemberView[]> {
    const members = await this.prisma.companyMember.findMany({
      where: { companyId, status: 'ACTIVE', ...(opts.userIds ? { userId: { in: opts.userIds } } : {}) },
      include: { user: { select: { id: true, phone: true, firstName: true, lastName: true, photoFileId: true } } },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
    return this.toMemberViews(companyId, members, locale);
  }

  async toMemberViews(
    companyId: string,
    members: Array<{
      userId: string;
      role: CompanyRole;
      status: 'ACTIVE' | 'REMOVED';
      joinedAt: Date;
      user: { id: string; phone: string; firstName: string | null; lastName: string | null; photoFileId: string | null };
    }>,
    locale: Locale,
  ): Promise<MemberView[]> {
    if (!members.length) return [];
    const profiles = await this.prisma.handymanProfile.findMany({
      where: { userId: { in: members.map((m) => m.userId) }, companyId },
      include: { trades: { select: { categoryId: true } } },
    });
    const byUser = new Map(profiles.map((p) => [p.userId, p]));
    const busy = await this.busyHandymanIds(profiles.map((p) => p.id));
    const allTrades = await this.categories.refs(
      profiles.flatMap((p) => p.trades.map((t) => t.categoryId)),
      locale,
    );
    const photos = new Map(
      (await this.files.refs(members.map((m) => m.user.photoFileId).filter((x): x is string => !!x))).map((r) => [r.id, r]),
    );
    return members.map((m) => {
      const p = byUser.get(m.userId);
      return {
        userId: m.userId,
        handymanId: p?.id ?? null,
        firstName: m.user.firstName ?? '',
        lastName: m.user.lastName ?? '',
        phone: m.user.phone,
        photo: (m.user.photoFileId && photos.get(m.user.photoFileId)) || null,
        role: m.role,
        status: m.status,
        isOnline: p?.isOnline ?? false,
        busy: p ? busy.has(p.id) : false,
        ratingAvg: p ? ratingAvg(p.ratingSum, p.ratingCount) : null,
        completedCount: p?.completedCount ?? 0,
        trades: p ? p.trades.map((t) => allTrades.get(t.categoryId)).filter((r): r is CategoryRef => !!r) : [],
        lastSeenAt: iso(p?.lastSeenAt ?? null),
        joinedAt: m.joinedAt.toISOString(),
      };
    });
  }

  /** Posted balance of a ledger account as a number (0 when the account is missing). */
  async posted(accountId: string | null | undefined): Promise<number> {
    if (!accountId) return 0;
    const acc = await this.prisma.ledgerAccount.findUnique({ where: { id: accountId }, select: { postedBalance: true } });
    return num(acc?.postedBalance ?? 0n);
  }
}
