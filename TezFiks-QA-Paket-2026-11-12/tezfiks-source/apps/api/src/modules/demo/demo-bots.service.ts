import { Injectable, Logger } from '@nestjs/common';
import { BAKU_CENTER, type DemoStateSchema, type LatLng, type Locale } from '@tezfiks/shared';
import type { z } from 'zod';
import { PrismaService, inTx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { newId } from '../../infra/ids';
import { ApiException } from '../../common/http/api-exception';
import { AuditService } from '../../common/audit/audit.service';
import { I18nService } from '../../common/i18n/i18n.service';
import { LedgerService } from '../ledger/ledger.service';
import { WalletEventsService } from '../wallet/wallet-events.service';
import { CategoriesService } from '../categories/categories.service';
import { PresenceService } from '../realtime/presence.service';
import { ProService } from '../pro/pro.service';
import { ProviderViewsService } from '../pro/provider-views.service';
import { cell7Of, serviceCellsFor } from '../pro/provider-common';
import { EligibilityService } from '../requests/dispatch/eligibility.service';
import { OffersService } from '../requests/offers.service';
import { ProviderBlockService } from '../assignments/provider-block.service';
import { DemoConfigService } from './demo-config.service';
import {
  BOT_FIRST_NAMES,
  BOT_LAST_NAMES,
  BOT_PHONE_PREFIX,
  BOT_SERVICE_RADIUS_KM,
  BOT_WALLET_FUNDING,
} from './demo.constants';

export interface SpawnBotsInput {
  count: number;
  center?: LatLng;
  radiusKm?: number;
  tradeIds?: string[];
  companyId?: string;
}

export type DemoState = z.infer<typeof DemoStateSchema>;

/** Statuses a removed bot's job is force-cancelled (and re-dispatched) from; later ones (price proposed) stay payable. */
const CANCELLABLE = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED'] as const;

/** Random point uniformly inside a circle of `radiusKm` around `center`. */
export function randomPointWithin(center: LatLng, radiusKm: number, rnd: () => number = Math.random): LatLng {
  const r = radiusKm * 1000 * Math.sqrt(rnd());
  const theta = 2 * Math.PI * rnd();
  const dLat = (r * Math.cos(theta)) / 111_320;
  const dLng = (r * Math.sin(theta)) / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  return { lat: round6(center.lat + dLat), lng: round6(center.lng + dLng) };
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

/**
 * Demo bots (spec 17): approved solo handymen (isBot) with funded wallets, or workers of an existing company, placed at
 * random inside a circle and put online through the real ProService.setOnline. Removing bots never deletes rows (the
 * ledger is append-only and bots have offers, jobs and postings): their running jobs are force-cancelled through
 * CancellationService (ProviderBlockService, which re-dispatches the slot), open offers are declined, the remaining wallet
 * balance goes back to the platform, and the user is deactivated (status DELETED, offline, removed from its company).
 */
@Injectable()
export class DemoBotsService {
  private readonly log = new Logger('DemoBots');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly i18n: I18nService,
    private readonly ledger: LedgerService,
    private readonly walletEvents: WalletEventsService,
    private readonly categories: CategoriesService,
    private readonly presence: PresenceService,
    private readonly pro: ProService,
    private readonly providerViews: ProviderViewsService,
    private readonly eligibility: EligibilityService,
    private readonly offers: OffersService,
    private readonly providerBlock: ProviderBlockService,
    private readonly config: DemoConfigService,
  ) {}

  // ------------------------------------------------------------------ state

  async state(locale: Locale): Promise<DemoState> {
    const config = await this.config.get();
    const bots = await this.prisma.handymanProfile.findMany({
      where: { isBot: true, user: { status: 'ACTIVE' } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        user: { select: { firstName: true, lastName: true } },
        company: { select: { name: true } },
        trades: { include: { category: true } },
      },
    });
    const busy = await this.eligibility.busyHandymen(bots.map((b) => b.id));
    const items: DemoState['bots'] = [];
    for (const b of bots) {
      const live = await this.presence.get(b.id);
      const lat = live?.lat ?? b.lastLat ?? b.baseLat ?? BAKU_CENTER.lat;
      const lng = live?.lng ?? b.lastLng ?? b.baseLng ?? BAKU_CENTER.lng;
      items.push({
        handymanId: b.id,
        name: [b.user.firstName, b.user.lastName].filter(Boolean).join(' '),
        lat,
        lng,
        busy: busy.has(b.id) || !!live?.busy,
        trades: b.trades.map((t) => this.categories.name(t.category, locale)),
        companyName: b.company?.name ?? null,
      });
    }
    return { enabled: this.config.enabled, config, bots: items };
  }

  // ------------------------------------------------------------------ spawn

  private async uniquePhone(): Promise<string> {
    for (let i = 0; i < 50; i++) {
      const phone = `${BOT_PHONE_PREFIX}${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`;
      if (!(await this.prisma.user.findUnique({ where: { phone }, select: { id: true } }))) return phone;
    }
    throw new ApiException('CONFLICT', { reason: 'BOT_PHONE_SPACE_EXHAUSTED' });
  }

  private async resolveTrades(input: SpawnBotsInput): Promise<{ tradeIds: string[]; company: { id: string } | null }> {
    if (input.companyId) {
      const company = await this.prisma.company.findUnique({ where: { id: input.companyId }, include: { trades: true } });
      if (!company) throw new ApiException('NOT_FOUND', { entity: 'company', id: input.companyId });
      if (company.status !== 'APPROVED') throw new ApiException('COMPANY_NOT_APPROVED', { companyId: company.id, status: company.status });
      const companyTrades = company.trades.map((t) => t.categoryId);
      const tradeIds = input.tradeIds?.length
        ? await this.providerViews.validateTrades(input.tradeIds, { within: companyTrades })
        : companyTrades;
      if (!tradeIds.length) throw new ApiException('VALIDATION_FAILED', { field: 'tradeIds', reason: 'COMPANY_HAS_NO_TRADES' });
      return { tradeIds, company: { id: company.id } };
    }
    if (input.tradeIds?.length) return { tradeIds: await this.providerViews.validateTrades(input.tradeIds), company: null };
    const services = await this.categories.activeServices();
    const featured = services.filter((c) => c.featured && c.flow === 'INSTANT');
    const tradeIds = (featured.length ? featured : services.filter((c) => c.flow === 'INSTANT')).map((c) => c.id);
    if (!tradeIds.length) throw new ApiException('VALIDATION_FAILED', { field: 'tradeIds', reason: 'NO_ACTIVE_SERVICES' });
    return { tradeIds, company: null };
  }

  /** Creates `count` bots and puts them online; returns their handyman ids. */
  async spawn(adminId: string | null, input: SpawnBotsInput, ip: string | null): Promise<string[]> {
    const center = input.center ?? BAKU_CENTER;
    const radiusKm = input.radiusKm ?? 3;
    const { tradeIds, company } = await this.resolveTrades(input);
    const companyRow = company ? await this.prisma.company.findUniqueOrThrow({ where: { id: company.id } }) : null;
    const created: Array<{ handymanId: string; userId: string; at: LatLng; walletAccountId: string | null }> = [];
    for (let i = 0; i < input.count; i++) {
      const at = randomPointWithin(center, radiusKm);
      const phone = await this.uniquePhone();
      const handymanId = newId();
      const now = this.clock.now();
      const out = await inTx(this.prisma, async (tx) => {
        const user = await tx.user.create({
          data: { phone, firstName: pick(BOT_FIRST_NAMES), lastName: pick(BOT_LAST_NAMES), locale: 'az', createdAt: now },
        });
        let walletAccountId: string | null = null;
        let earningsAccountId: string | null = null;
        if (!companyRow) {
          walletAccountId = (await this.ledger.ensureAccount('HANDYMAN', handymanId, 'WALLET', {}, tx)).id;
          earningsAccountId = (await this.ledger.ensureAccount('HANDYMAN', handymanId, 'EARNINGS', {}, tx)).id;
        }
        await tx.handymanProfile.create({
          data: {
            id: handymanId,
            userId: user.id,
            kind: companyRow ? 'COMPANY_WORKER' : 'SOLO',
            companyId: companyRow?.id ?? null,
            status: 'APPROVED',
            approvedAt: now,
            isBot: true,
            serviceRadiusKm: companyRow?.serviceRadiusKm ?? BOT_SERVICE_RADIUS_KM,
            baseLat: at.lat,
            baseLng: at.lng,
            baseCell7: cell7Of(at.lat, at.lng),
            lastLat: at.lat,
            lastLng: at.lng,
            lastCell7: cell7Of(at.lat, at.lng),
            walletAccountId,
            earningsAccountId,
            createdAt: now,
            trades: { create: tradeIds.map((categoryId) => ({ categoryId })) },
            ...(companyRow
              ? {}
              : { serviceCells: { create: serviceCellsFor(at.lat, at.lng, BOT_SERVICE_RADIUS_KM).map((cell7) => ({ cell7 })) } }),
          },
        });
        if (companyRow) {
          await tx.companyMember.create({ data: { companyId: companyRow.id, userId: user.id, role: 'WORKER', joinedAt: now } });
        } else if (walletAccountId) {
          const adjustments = await this.ledger.platformAccountId('ADJUSTMENTS', tx);
          await this.ledger.post(
            {
              kind: 'ADMIN_ADJUSTMENT',
              idempotencyKey: `demo-bot-fund:${handymanId}`,
              entries: [
                { accountId: adjustments, amount: -BOT_WALLET_FUNDING },
                { accountId: walletAccountId, amount: BOT_WALLET_FUNDING },
              ],
              memo: 'demo bot funding',
              actor: adminId ? { type: 'ADMIN', id: adminId } : { type: 'SYSTEM' },
              metadata: { demo: true },
            },
            tx,
          );
        }
        return { userId: user.id, walletAccountId };
      });
      created.push({ handymanId, userId: out.userId, at, walletAccountId: out.walletAccountId });
    }
    for (const b of created) {
      try {
        await this.pro.setOnline(b.userId, { online: true, location: b.at });
      } catch (err) {
        // The simulator's heartbeat retries every tick.
        this.log.warn(`bot ${b.handymanId} could not go online: ${(err as Error).message}`);
      }
    }
    await this.walletEvents.notifyAccounts(created.map((b) => b.walletAccountId));
    await this.audit.log({
      actorType: adminId ? 'ADMIN' : 'SYSTEM',
      actorId: adminId,
      action: 'demo.spawnBots',
      entityType: 'DemoBots',
      entityId: company?.id ?? null,
      after: { count: created.length, center, radiusKm, tradeIds, companyId: company?.id ?? null, handymanIds: created.map((b) => b.handymanId) },
      ip,
    });
    return created.map((b) => b.handymanId);
  }

  // ------------------------------------------------------------------ clear

  /** Deactivates every active bot (see class doc). Returns the number of bots removed. */
  async clear(adminId: string | null, ip: string | null): Promise<number> {
    const bots = await this.prisma.handymanProfile.findMany({
      where: { isBot: true, user: { status: 'ACTIVE' } },
      select: { id: true, userId: true, companyId: true, walletAccountId: true },
    });
    const cancelled: string[] = [];
    for (const b of bots) {
      // 1. Running jobs: ADMIN cancellation through CancellationService, slot re-dispatched (no fee kept, no penalty).
      const jobs = await this.prisma.assignment.findMany({
        where: { handymanId: b.id, status: { in: [...CANCELLABLE] } },
        select: { id: true, request: { select: { customerAccount: { select: { owner: { select: { locale: true } } } } } } },
      });
      for (const j of jobs) {
        try {
          const reason = this.i18n.t(j.request.customerAccount.owner.locale, 'server.demo.botRemoved');
          if (await this.providerBlock.forceCancelAndRedispatch(j.id, reason)) cancelled.push(j.id);
        } catch (err) {
          this.log.error(`cancel of bot job ${j.id} failed: ${(err as Error).message}`);
        }
      }
      // 2. Open offers: the bot declines them (the offer closes as for a human decline).
      const open = await this.prisma.offer.findMany({ where: { handymanId: b.id, status: 'SENT' }, select: { id: true } });
      for (const o of open) {
        try {
          await this.offers.declineSolo(b.userId, o.id);
        } catch (err) {
          this.log.warn(`decline of bot offer ${o.id} failed: ${(err as Error).message}`);
        }
      }
      // 3. Deactivate: offline, out of the company, user DELETED (hidden from demo state, never dispatched again).
      const now = this.clock.now();
      await inTx(this.prisma, async (tx) => {
        await tx.handymanProfile.update({ where: { id: b.id }, data: { isOnline: false } });
        if (b.companyId) {
          await tx.companyMember.updateMany({
            where: { companyId: b.companyId, userId: b.userId, status: 'ACTIVE' },
            data: { status: 'REMOVED', removedAt: now },
          });
        }
        await tx.user.update({ where: { id: b.userId }, data: { status: 'DELETED', deletedAt: now } });
      });
      await this.presence.setOffline(b.id);
      // 4. What is left on the wallet goes back to the platform (holds were released by the cancellations above).
      if (b.walletAccountId) {
        const bal = await this.ledger.balance(b.walletAccountId);
        if (bal.available > 0) {
          const adjustments = await this.ledger.platformAccountId('ADJUSTMENTS');
          await this.ledger.post({
            kind: 'ADMIN_ADJUSTMENT',
            idempotencyKey: `demo-bot-defund:${b.id}`,
            entries: [
              { accountId: b.walletAccountId, amount: -bal.available },
              { accountId: adjustments, amount: bal.available },
            ],
            memo: 'demo bot removed',
            actor: adminId ? { type: 'ADMIN', id: adminId } : { type: 'SYSTEM' },
            metadata: { demo: true },
          });
        }
      }
    }
    await this.audit.log({
      actorType: adminId ? 'ADMIN' : 'SYSTEM',
      actorId: adminId,
      action: 'demo.clearBots',
      entityType: 'DemoBots',
      after: { removed: bots.map((b) => b.id), cancelledAssignments: cancelled },
      ip,
    });
    return bots.length;
  }
}
