import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  ACTIVE_ASSIGNMENT_STATUSES,
  type CompanyRole,
  type CompanyView,
  type EndpointBody,
  type InviteView,
  type Locale,
  type MemberView,
  type WorkerLive,
  type api,
} from '@tezfiks/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService, inTx, type Tx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { RealtimeService } from '../../infra/realtime.service';
import { newId } from '../../infra/ids';
import { ApiException } from '../../common/http/api-exception';
import { iso, num } from '../../common/mapping';
import { LedgerService } from '../ledger/ledger.service';
import { WalletAccessService } from '../wallet/wallet-access.service';
import { PresenceService } from '../realtime/presence.service';
import { FilesService } from '../files/files.service';
import { ProviderViewsService } from '../pro/provider-views.service';
import { ProviderLiveService } from '../pro/provider-live.service';
import { INVITE_TOKEN_BYTES, bakuDayRange, cell7Of, serviceCellsFor } from '../pro/provider-common';
import type { Company, CompanyInvite } from '../../generated/prisma/client';

type SettingsBody = EndpointBody<typeof api.company.updateSettings>;
type UpdateMemberBody = EndpointBody<typeof api.company.updateMember>;
type CreateInviteBody = EndpointBody<typeof api.company.createInvite>;

export interface CompanyDashboard {
  jobsToday: number;
  activeJobs: number;
  onlineWorkers: number;
  membersCount: number;
  wallet: CompanyView['wallet'];
  earningsBalance: number;
  feesToday: number;
  revenueToday: number;
}

/** Company administration by its ACTIVE managers: profile/settings, members, invites, live worker map. */
@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly realtime: RealtimeService,
    private readonly ledger: LedgerService,
    private readonly access: WalletAccessService,
    private readonly presence: PresenceService,
    private readonly files: FilesService,
    private readonly views: ProviderViewsService,
    private readonly live: ProviderLiveService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The company when `userId` is one of its ACTIVE managers (NOT_FOUND / NOT_COMPANY_MANAGER). */
  managed(userId: string, companyId: string): Promise<Company> {
    return this.access.managedCompany(userId, companyId);
  }

  inviteUrl(token: string): string {
    return `${this.env.PUBLIC_BASE_URL.replace(/\/+$/, '')}/tezfix/join/${token}`;
  }

  inviteView(i: CompanyInvite): InviteView {
    return {
      id: i.id,
      token: i.token,
      url: this.inviteUrl(i.token),
      role: i.role,
      expiresAt: i.expiresAt.toISOString(),
      maxUses: i.maxUses,
      usedCount: i.usedCount,
      revokedAt: iso(i.revokedAt),
      createdAt: i.createdAt.toISOString(),
    };
  }

  private async lockCompany(tx: Tx, companyId: string): Promise<void> {
    await tx.$queryRawUnsafe('SELECT id FROM companies WHERE id = $1::uuid FOR UPDATE', companyId);
  }

  private notifyWorkersChanged(companyId: string): void {
    this.realtime.toCompany(companyId, 'company:workers', { companyId });
  }

  async get(userId: string, companyId: string, locale: Locale): Promise<CompanyView> {
    await this.managed(userId, companyId);
    return this.views.companyView(companyId, 'MANAGER', locale);
  }

  async dashboard(userId: string, companyId: string): Promise<CompanyDashboard> {
    const c = await this.managed(userId, companyId);
    const { start, end } = bakuDayRange(this.clock.now());
    const [jobsToday, activeJobs, onlineWorkers, membersCount, wallet, earnings, fees, revenue] = await Promise.all([
      this.prisma.assignment.count({ where: { companyId, acceptedAt: { gte: start, lt: end } } }),
      this.prisma.assignment.count({ where: { companyId, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } } }),
      this.views.onlineWorkers(companyId),
      this.prisma.companyMember.count({ where: { companyId, status: 'ACTIVE' } }),
      this.ledger.summary(c.walletAccountId),
      this.ledger.balance(c.earningsAccountId),
      this.prisma.assignment.aggregate({
        where: { companyId, feeCaptured: true, feeRefunded: false, freeCancelUntil: { gte: start, lt: end } },
        _sum: { feeAmount: true },
      }),
      this.prisma.assignment.aggregate({
        where: { companyId, status: 'COMPLETED', completedAt: { gte: start, lt: end } },
        _sum: { totalAmount: true },
      }),
    ]);
    return {
      jobsToday,
      activeJobs,
      onlineWorkers,
      membersCount,
      wallet,
      earningsBalance: earnings.posted,
      feesToday: num(fees._sum.feeAmount),
      revenueToday: num(revenue._sum.totalAmount),
    };
  }

  /** Name, final price entry, VAT, trades, radius, base (service cells recomputed when the area changes). */
  async updateSettings(userId: string, companyId: string, body: SettingsBody, locale: Locale): Promise<CompanyView> {
    const c = await this.managed(userId, companyId);
    const tradeIds = body.tradeIds ? await this.views.validateTrades(body.tradeIds) : undefined;
    const radius = body.serviceRadiusKm ?? c.serviceRadiusKm;
    const base = body.base ?? (c.baseLat != null && c.baseLng != null ? { lat: c.baseLat, lng: c.baseLng } : null);
    const areaChanged = body.serviceRadiusKm !== undefined || body.base !== undefined;
    await inTx(this.prisma, async (tx) => {
      await tx.company.update({
        where: { id: companyId },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.finalPriceEntry !== undefined ? { finalPriceEntry: body.finalPriceEntry } : {}),
          ...(body.isVatPayer !== undefined ? { isVatPayer: body.isVatPayer } : {}),
          ...(body.baseAddress !== undefined ? { baseAddress: body.baseAddress || null } : {}),
          serviceRadiusKm: radius,
          ...(body.base ? { baseLat: body.base.lat, baseLng: body.base.lng, baseCell7: cell7Of(body.base.lat, body.base.lng) } : {}),
        },
      });
      if (tradeIds) {
        await tx.companyTrade.deleteMany({ where: { companyId } });
        await tx.companyTrade.createMany({ data: tradeIds.map((categoryId) => ({ companyId, categoryId })) });
        // workers may only hold company trades: drop the ones the company no longer offers
        await tx.handymanTrade.deleteMany({ where: { handyman: { companyId }, categoryId: { notIn: tradeIds } } });
      }
      if (areaChanged && base) {
        await tx.companyServiceCell.deleteMany({ where: { companyId } });
        await tx.companyServiceCell.createMany({
          data: serviceCellsFor(base.lat, base.lng, radius).map((cell7) => ({ companyId, cell7 })),
        });
      }
    });
    return this.views.companyView(companyId, 'MANAGER', locale);
  }

  async members(userId: string, companyId: string, locale: Locale): Promise<{ items: MemberView[] }> {
    await this.managed(userId, companyId);
    return { items: await this.views.memberViews(companyId, locale) };
  }

  /**
   * Role and/or trades of an ACTIVE member. Demoting the last ACTIVE manager -> INVALID_STATE. A demoted manager without
   * a handyman profile gets an APPROVED worker profile (the company is verified). Trades only for members with a worker
   * profile in this company, and only among the company's trades.
   */
  async updateMember(userId: string, companyId: string, targetUserId: string, body: UpdateMemberBody, locale: Locale): Promise<MemberView> {
    const company = await this.managed(userId, companyId);
    const companyTrades = (await this.prisma.companyTrade.findMany({ where: { companyId }, select: { categoryId: true } })).map(
      (t) => t.categoryId,
    );
    const tradeIds = body.tradeIds ? await this.views.validateTrades(body.tradeIds, { within: companyTrades }) : undefined;
    let roleChanged = false;
    await inTx(this.prisma, async (tx) => {
      await this.lockCompany(tx, companyId);
      const member = await tx.companyMember.findUnique({ where: { companyId_userId: { companyId, userId: targetUserId } } });
      if (!member || member.status !== 'ACTIVE') throw new ApiException('NOT_FOUND', { entity: 'CompanyMember' });
      const role: CompanyRole = body.role ?? member.role;
      if (member.role === 'MANAGER' && role === 'WORKER') {
        const managers = await tx.companyMember.count({ where: { companyId, role: 'MANAGER', status: 'ACTIVE' } });
        if (managers <= 1) throw new ApiException('INVALID_STATE', { reason: 'LAST_MANAGER' });
        await this.ensureWorkerProfile(tx, company, targetUserId, tradeIds ?? companyTrades);
      }
      if (role !== member.role) {
        await tx.companyMember.update({ where: { id: member.id }, data: { role } });
        roleChanged = true;
      }
      if (tradeIds) {
        const profile = await tx.handymanProfile.findUnique({ where: { userId: targetUserId } });
        if (!profile || profile.companyId !== companyId) throw new ApiException('INVALID_STATE', { reason: 'NOT_A_WORKER' });
        await tx.handymanTrade.deleteMany({ where: { handymanId: profile.id } });
        await tx.handymanTrade.createMany({ data: tradeIds.map((categoryId) => ({ handymanId: profile.id, categoryId })) });
      }
    });
    if (roleChanged) await this.live.refreshUsers([targetUserId]);
    this.realtime.toUser(targetUserId, 'profile:updated', { reason: 'MEMBER_UPDATED' });
    this.notifyWorkersChanged(companyId);
    const [view] = await this.views.memberViews(companyId, locale, { userIds: [targetUserId] });
    return view!;
  }

  /** Gives a member an APPROVED worker profile in this company (creating or re-attaching one). */
  private async ensureWorkerProfile(tx: Tx, company: Company, userId: string, tradeIds: string[]): Promise<void> {
    const profile = await tx.handymanProfile.findUnique({ where: { userId } });
    const now = this.clock.now();
    if (profile) {
      if (profile.companyId === company.id) return;
      if (profile.kind === 'SOLO') throw new ApiException('ALREADY_HANDYMAN');
      if (profile.companyId) throw new ApiException('ALREADY_IN_COMPANY', { companyId: profile.companyId });
      await tx.handymanProfile.update({
        where: { id: profile.id },
        data: { companyId: company.id, status: 'APPROVED', approvedAt: now, rejectReason: null, blockedReason: null },
      });
      // the re-attached profile's trades come from this company, never from an earlier one
      await tx.handymanTrade.deleteMany({ where: { handymanId: profile.id } });
      await tx.handymanTrade.createMany({ data: tradeIds.map((categoryId) => ({ handymanId: profile.id, categoryId })) });
      return;
    }
    await tx.handymanProfile.create({
      data: {
        id: newId(),
        userId,
        kind: 'COMPANY_WORKER',
        companyId: company.id,
        status: 'APPROVED',
        approvedAt: now,
        serviceRadiusKm: company.serviceRadiusKm,
        baseLat: company.baseLat,
        baseLng: company.baseLng,
        baseCell7: company.baseCell7,
        createdAt: now,
        trades: { create: tradeIds.map((categoryId) => ({ categoryId })) },
      },
    });
  }

  /**
   * Removes an ACTIVE member. The last ACTIVE manager cannot be removed (also not by themself), nor a worker in the middle
   * of a job. A removed worker's profile leaves the company (companyId=null, DRAFT, offline; kind stays COMPANY_WORKER).
   */
  async removeMember(userId: string, companyId: string, targetUserId: string): Promise<{ ok: true }> {
    await this.managed(userId, companyId);
    let workerProfileId: string | null = null;
    await inTx(this.prisma, async (tx) => {
      await this.lockCompany(tx, companyId);
      const member = await tx.companyMember.findUnique({ where: { companyId_userId: { companyId, userId: targetUserId } } });
      if (!member || member.status !== 'ACTIVE') throw new ApiException('NOT_FOUND', { entity: 'CompanyMember' });
      if (member.role === 'MANAGER') {
        const managers = await tx.companyMember.count({ where: { companyId, role: 'MANAGER', status: 'ACTIVE' } });
        if (managers <= 1) throw new ApiException('INVALID_STATE', { reason: 'LAST_MANAGER' });
      }
      const profile = await tx.handymanProfile.findUnique({ where: { userId: targetUserId } });
      if (profile && profile.companyId === companyId) {
        const active = await tx.assignment.findFirst({
          where: { handymanId: profile.id, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
          select: { id: true },
        });
        if (active) throw new ApiException('INVALID_STATE', { reason: 'ACTIVE_ASSIGNMENT', assignmentId: active.id });
        await tx.handymanProfile.update({
          where: { id: profile.id },
          data: { companyId: null, status: 'DRAFT', approvedAt: null, isOnline: false },
        });
        workerProfileId = profile.id;
      }
      await tx.companyMember.update({ where: { id: member.id }, data: { status: 'REMOVED', removedAt: this.clock.now() } });
    });
    if (workerProfileId) await this.presence.setOffline(workerProfileId);
    await this.live.refreshUsers([targetUserId]);
    this.realtime.toUser(targetUserId, 'profile:updated', { reason: 'REMOVED_FROM_COMPANY' });
    this.notifyWorkersChanged(companyId);
    return { ok: true };
  }

  async invites(userId: string, companyId: string): Promise<{ items: InviteView[] }> {
    await this.managed(userId, companyId);
    const rows = await this.prisma.companyInvite.findMany({ where: { companyId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    return { items: rows.map((i) => this.inviteView(i)) };
  }

  /** Invite link (24 url-safe random characters). Only APPROVED companies invite (COMPANY_NOT_APPROVED). */
  async createInvite(userId: string, companyId: string, body: CreateInviteBody): Promise<InviteView> {
    const c = await this.managed(userId, companyId);
    if (c.status !== 'APPROVED') throw new ApiException('COMPANY_NOT_APPROVED', { status: c.status });
    const now = this.clock.now();
    const invite = await this.prisma.companyInvite.create({
      data: {
        id: newId(),
        companyId,
        token: randomBytes(INVITE_TOKEN_BYTES).toString('base64url'),
        role: body.role,
        maxUses: body.maxUses,
        expiresAt: new Date(now.getTime() + body.expiresInDays * 86_400_000),
        createdByUserId: userId,
        createdAt: now,
      },
    });
    return this.inviteView(invite);
  }

  async revokeInvite(userId: string, companyId: string, inviteId: string): Promise<{ ok: true }> {
    await this.managed(userId, companyId);
    const invite = await this.prisma.companyInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.companyId !== companyId) throw new ApiException('NOT_FOUND', { entity: 'CompanyInvite' });
    await this.prisma.companyInvite.updateMany({ where: { id: inviteId, revokedAt: null }, data: { revokedAt: this.clock.now() } });
    return { ok: true };
  }

  /** Workers on the dispatch map: presence location (fallback: last DB location), online, busy, current assignment. */
  async workersLive(userId: string, companyId: string): Promise<{ items: WorkerLive[] }> {
    await this.managed(userId, companyId);
    const profiles = await this.prisma.handymanProfile.findMany({
      where: { companyId, user: { memberships: { some: { companyId, status: 'ACTIVE' } } } },
      include: { user: { select: { firstName: true, lastName: true, photoFileId: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (!profiles.length) return { items: [] };
    const ids = profiles.map((p) => p.id);
    const busy = await this.views.busyHandymanIds(ids);
    const active = await this.prisma.assignment.findMany({
      where: { handymanId: { in: ids }, status: { in: [...ACTIVE_ASSIGNMENT_STATUSES] } },
      orderBy: { acceptedAt: 'desc' },
      select: { id: true, handymanId: true },
    });
    const current = new Map<string, string>();
    for (const a of active) if (!current.has(a.handymanId)) current.set(a.handymanId, a.id);
    const photos = new Map(
      (await this.files.refs(profiles.map((p) => p.user.photoFileId).filter((x): x is string => !!x))).map((r) => [r.id, r]),
    );
    const items: WorkerLive[] = [];
    for (const p of profiles) {
      const state = await this.presence.get(p.id);
      const lastSeenMs = Math.max(state?.ts ?? 0, p.lastSeenAt?.getTime() ?? 0);
      items.push({
        handymanId: p.id,
        userId: p.userId,
        firstName: p.user.firstName ?? '',
        lastName: p.user.lastName ?? '',
        photo: (p.user.photoFileId && photos.get(p.user.photoFileId)) || null,
        lat: state?.lat ?? p.lastLat ?? null,
        lng: state?.lng ?? p.lastLng ?? null,
        isOnline: p.isOnline,
        busy: busy.has(p.id),
        assignmentId: current.get(p.id) ?? null,
        lastSeenAt: lastSeenMs > 0 ? new Date(lastSeenMs).toISOString() : null,
      });
    }
    return { items };
  }
}
