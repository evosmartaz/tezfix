import { Injectable } from '@nestjs/common';
import {
  bakuDayKey,
  type CompanyView,
  type EndpointBody,
  type Locale,
  type ProProfile,
  type api,
  type LocationBody,
} from '@tezfiks/shared';
import { PrismaService, inTx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { RealtimeService } from '../../infra/realtime.service';
import { newId } from '../../infra/ids';
import { ApiException } from '../../common/http/api-exception';
import { SettingsService } from '../../common/settings/settings.service';
import { num } from '../../common/mapping';
import { LedgerService } from '../ledger/ledger.service';
import { FilesService } from '../files/files.service';
import { PresenceService } from '../realtime/presence.service';
import { ProviderViewsService } from './provider-views.service';
import { ProviderLiveService } from './provider-live.service';
import { bakuDayRange, cell7Of, serviceCellsFor } from './provider-common';

type OnboardSoloBody = EndpointBody<typeof api.pro.onboardSolo>;
type OnboardCompanyBody = EndpointBody<typeof api.pro.onboardCompany>;
type UpdateProfileBody = EndpointBody<typeof api.pro.updateProfile>;
type SetOnlineBody = EndpointBody<typeof api.pro.setOnline>;
export type OnlineWarning = 'LOW_BALANCE' | 'NO_TRADES' | 'COMPANY_LOW_BALANCE';

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

/** Handyman onboarding (solo / company registration), profile edits, online switch, location pings, today's stats. */
@Injectable()
export class ProService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
    private readonly files: FilesService,
    private readonly presence: PresenceService,
    private readonly views: ProviderViewsService,
    private readonly live: ProviderLiveService,
  ) {}

  private async requireProfile(userId: string) {
    const p = await this.prisma.handymanProfile.findUnique({ where: { userId } });
    if (!p) throw new ApiException('NOT_FOUND', { entity: 'HandymanProfile' });
    return p;
  }

  /** "Fərdi usta": DRAFT solo profile with trades, service area and WALLET + EARNINGS accounts. */
  async onboardSolo(userId: string, body: OnboardSoloBody, locale: Locale): Promise<ProProfile> {
    if (await this.prisma.handymanProfile.findUnique({ where: { userId }, select: { id: true } })) {
      throw new ApiException('ALREADY_HANDYMAN');
    }
    const membership = await this.prisma.companyMember.findFirst({ where: { userId, status: 'ACTIVE' }, select: { companyId: true } });
    if (membership) throw new ApiException('ALREADY_IN_COMPANY', { companyId: membership.companyId });
    if (body.photoFileId) await this.files.assertOwned(userId, [body.photoFileId], ['PROFILE_PHOTO']);
    const tradeIds = await this.views.validateTrades(body.tradeIds);
    const id = newId();
    const now = this.clock.now();
    const { lat, lng } = body.base;
    try {
      await inTx(this.prisma, async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { firstName: body.firstName, lastName: body.lastName, ...(body.photoFileId ? { photoFileId: body.photoFileId } : {}) },
        });
        const wallet = await this.ledger.ensureAccount('HANDYMAN', id, 'WALLET', {}, tx);
        const earnings = await this.ledger.ensureAccount('HANDYMAN', id, 'EARNINGS', {}, tx);
        await tx.handymanProfile.create({
          data: {
            id,
            userId,
            kind: 'SOLO',
            status: 'DRAFT',
            serviceRadiusKm: body.serviceRadiusKm,
            baseLat: lat,
            baseLng: lng,
            baseCell7: cell7Of(lat, lng),
            walletAccountId: wallet.id,
            earningsAccountId: earnings.id,
            createdAt: now,
            trades: { create: tradeIds.map((categoryId) => ({ categoryId })) },
            serviceCells: { create: serviceCellsFor(lat, lng, body.serviceRadiusKm).map((cell7) => ({ cell7 })) },
          },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiException('ALREADY_HANDYMAN');
      throw err;
    }
    return this.views.proProfile(id, locale);
  }

  /** "Usta şirkəti": DRAFT company (unique VÖEN) with the caller as MANAGER, WALLET + EARNINGS, trades and service area. */
  async onboardCompany(userId: string, body: OnboardCompanyBody, locale: Locale): Promise<CompanyView> {
    const c = body.company;
    if (await this.prisma.company.findUnique({ where: { voen: c.voen }, select: { id: true } })) {
      throw new ApiException('CONFLICT', { field: 'voen' });
    }
    const tradeIds = await this.views.validateTrades(c.tradeIds);
    const companyId = newId();
    const now = this.clock.now();
    try {
      await inTx(this.prisma, async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { firstName: body.firstName, lastName: body.lastName } });
        const wallet = await this.ledger.ensureAccount('COMPANY', companyId, 'WALLET', {}, tx);
        const earnings = await this.ledger.ensureAccount('COMPANY', companyId, 'EARNINGS', {}, tx);
        await tx.company.create({
          data: {
            id: companyId,
            name: c.name,
            legalForm: c.legalForm,
            voen: c.voen,
            status: 'DRAFT',
            ownerUserId: userId,
            isVatPayer: c.isVatPayer,
            baseLat: c.base.lat,
            baseLng: c.base.lng,
            baseCell7: cell7Of(c.base.lat, c.base.lng),
            baseAddress: c.baseAddress ?? null,
            serviceRadiusKm: c.serviceRadiusKm,
            walletAccountId: wallet.id,
            earningsAccountId: earnings.id,
            createdAt: now,
            members: { create: [{ userId, role: 'MANAGER', joinedAt: now }] },
            trades: { create: tradeIds.map((categoryId) => ({ categoryId })) },
            serviceCells: { create: serviceCellsFor(c.base.lat, c.base.lng, c.serviceRadiusKm).map((cell7) => ({ cell7 })) },
          },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ApiException('CONFLICT', { field: 'voen' });
      throw err;
    }
    await this.live.refreshUsers([userId]);
    return this.views.companyView(companyId, 'MANAGER', locale);
  }

  /** Trades / radius / base. Solo service cells are recomputed; company workers may only pick company trades. */
  async updateProfile(userId: string, body: UpdateProfileBody, locale: Locale): Promise<ProProfile> {
    const p = await this.requireProfile(userId);
    let tradeIds: string[] | undefined;
    if (body.tradeIds) {
      let within: string[] | undefined;
      if (p.kind === 'COMPANY_WORKER') {
        within = p.companyId
          ? (await this.prisma.companyTrade.findMany({ where: { companyId: p.companyId }, select: { categoryId: true } })).map((t) => t.categoryId)
          : [];
      }
      tradeIds = await this.views.validateTrades(body.tradeIds, { within });
    }
    const radius = body.serviceRadiusKm ?? p.serviceRadiusKm;
    const base = body.base ?? (p.baseLat != null && p.baseLng != null ? { lat: p.baseLat, lng: p.baseLng } : null);
    const areaChanged = body.serviceRadiusKm !== undefined || body.base !== undefined;
    await inTx(this.prisma, async (tx) => {
      await tx.handymanProfile.update({
        where: { id: p.id },
        data: {
          serviceRadiusKm: radius,
          ...(body.base ? { baseLat: body.base.lat, baseLng: body.base.lng, baseCell7: cell7Of(body.base.lat, body.base.lng) } : {}),
        },
      });
      if (tradeIds) {
        await tx.handymanTrade.deleteMany({ where: { handymanId: p.id } });
        await tx.handymanTrade.createMany({ data: tradeIds.map((categoryId) => ({ handymanId: p.id, categoryId })) });
      }
      if (areaChanged && base && p.kind === 'SOLO') {
        await tx.handymanServiceCell.deleteMany({ where: { handymanId: p.id } });
        await tx.handymanServiceCell.createMany({
          data: serviceCellsFor(base.lat, base.lng, radius).map((cell7) => ({ handymanId: p.id, cell7 })),
        });
      }
    });
    return this.views.proProfile(p.id, locale);
  }

  /**
   * Online switch. Going online requires an APPROVED profile, an ACTIVE user and (company workers) an APPROVED company.
   * The DB flags are committed BEFORE the presence store is touched (lane A3 contract).
   */
  async setOnline(userId: string, body: SetOnlineBody): Promise<{ isOnline: boolean; warnings: OnlineWarning[] }> {
    const profileInclude = {
      user: { select: { status: true } },
      company: { select: { id: true, status: true, walletAccountId: true } },
      _count: { select: { trades: true } },
    } as const;
    const p = await this.prisma.handymanProfile.findUnique({ where: { userId }, include: profileInclude });
    if (!p) throw new ApiException('NOT_FOUND', { entity: 'HandymanProfile' });
    if (!body.online) {
      await this.prisma.handymanProfile.update({ where: { id: p.id }, data: { isOnline: false } });
      await this.presence.setOffline(p.id);
      if (p.companyId) this.realtime.toCompany(p.companyId, 'company:workers', { companyId: p.companyId });
      return { isOnline: false, warnings: [] };
    }
    const assertCanGoOnline = (x: typeof p) => {
      if (x.status !== 'APPROVED') throw new ApiException('HANDYMAN_NOT_APPROVED', { status: x.status });
      if (x.user.status !== 'ACTIVE') throw new ApiException('USER_BLOCKED');
      if (x.kind === 'COMPANY_WORKER' && (!x.company || x.company.status !== 'APPROVED')) {
        throw new ApiException('COMPANY_NOT_APPROVED', { companyId: x.companyId });
      }
    };
    assertCanGoOnline(p);
    const now = this.clock.now();
    const loc = body.location;
    // The eligibility checks are repeated in the UPDATE itself, so an admin block / member removal committed after the
    // read above can never leave a BLOCKED or company-less profile flagged online.
    const eligible = {
      id: p.id,
      status: 'APPROVED' as const,
      user: { status: 'ACTIVE' as const },
      ...(p.kind === 'COMPANY_WORKER' ? { companyId: p.companyId, company: { status: 'APPROVED' as const } } : {}),
    };
    const r = await this.prisma.handymanProfile.updateMany({
      where: eligible,
      data: {
        isOnline: true,
        onlineSince: p.isOnline && p.onlineSince ? p.onlineSince : now,
        lastSeenAt: now,
        ...(loc ? { lastLat: loc.lat, lastLng: loc.lng, lastCell7: cell7Of(loc.lat, loc.lng) } : {}),
      },
    });
    /** Re-reads the profile and throws the error that now applies (eligibility changed concurrently). */
    const refuse = async (): Promise<never> => {
      const fresh = await this.prisma.handymanProfile.findUniqueOrThrow({ where: { id: p.id }, include: profileInclude });
      assertCanGoOnline(fresh);
      throw new ApiException('INVALID_STATE', { status: fresh.status, isOnline: fresh.isOnline });
    };
    if (!r.count) await refuse();
    await this.presence.setOnline(p.id, loc);
    // A block that committed between the UPDATE and the presence write has already run its forceOffline; undo our
    // presence entry so the store matches the DB again.
    if (!(await this.prisma.handymanProfile.count({ where: { ...eligible, isOnline: true } }))) {
      await this.presence.setOffline(p.id);
      await refuse();
    }

    const s = await this.settings.get();
    const warnings: OnlineWarning[] = [];
    if (p._count.trades === 0) warnings.push('NO_TRADES');
    if (p.kind === 'SOLO' && p.walletAccountId) {
      if ((await this.ledger.balance(p.walletAccountId)).available < s.requestFee) warnings.push('LOW_BALANCE');
    }
    if (p.company) {
      if ((await this.ledger.balance(p.company.walletAccountId)).available < s.requestFee) warnings.push('COMPANY_LOW_BALANCE');
      this.realtime.toCompany(p.company.id, 'company:workers', { companyId: p.company.id });
    }
    return { isOnline: true, warnings };
  }

  async location(userId: string, body: LocationBody): Promise<{ ok: true }> {
    const p = await this.requireProfile(userId);
    await this.presence.updateLocation(p.id, body);
    return { ok: true };
  }

  /**
   * Today (Baku day): completed jobs, their totals, and platform fees captured on jobs whose fee window closed today.
   * Company workers never see company money or prices they are not shown (spec §4.4): the company's captured fees are
   * never included, and the totals of company jobs count only when the company lets the worker enter the final price
   * (finalPriceEntry = WORKER, the same rule as the assignment views).
   */
  async statsToday(userId: string): Promise<{ date: string; jobs: number; earnings: number; fees: number }> {
    const p = await this.requireProfile(userId);
    const now = this.clock.now();
    const { start, end } = bakuDayRange(now);
    const completedToday = { handymanId: p.id, status: 'COMPLETED' as const, completedAt: { gte: start, lt: end } };
    const [jobs, done, fees] = await Promise.all([
      this.prisma.assignment.count({ where: completedToday }),
      this.prisma.assignment.aggregate({
        where: { ...completedToday, OR: [{ providerType: 'SOLO' }, { company: { finalPriceEntry: 'WORKER' } }] },
        _sum: { totalAmount: true },
      }),
      this.prisma.assignment.aggregate({
        where: { handymanId: p.id, providerType: 'SOLO', feeCaptured: true, feeRefunded: false, freeCancelUntil: { gte: start, lt: end } },
        _sum: { feeAmount: true },
      }),
    ]);
    return { date: bakuDayKey(now), jobs, earnings: num(done._sum.totalAmount), fees: num(fees._sum.feeAmount) };
  }
}
