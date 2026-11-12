import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { decodePolyline, haversineMeters, pathLengthMeters, pointAlong, type DemoConfig, type LatLng } from '@tezfiks/shared';
import { ENV, type Env } from '../../config/env';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { Clock } from '../../infra/clock';
import { JobsService } from '../../infra/jobs.service';
import { ReconcilerService } from '../../infra/reconciler.service';
import { newId } from '../../infra/ids';
import { PresenceService } from '../realtime/presence.service';
import { ProService } from '../pro/pro.service';
import { OffersService } from '../requests/offers.service';
import { ProviderActionsService } from '../assignments/provider-actions.service';
import { DemoConfigService } from './demo-config.service';
import {
  DEMO_JOB,
  DEMO_RECONCILER_TASK,
  DRIVE_PING_MS,
  HEARTBEAT_MS,
  SCHEDULED_DEPART_LEAD_MS,
  TICK_LOCK_MS,
  TICK_MS,
} from './demo.constants';

/** What one tick did (tests and logs). */
export interface TickReport {
  ran: boolean;
  heartbeats: number;
  accepted: number;
  declined: number;
  enRoute: number;
  moved: number;
  arrived: number;
  priced: number;
  errors: number;
}

const EMPTY: TickReport = { ran: false, heartbeats: 0, accepted: 0, declined: 0, enRoute: 0, moved: 0, arrived: 0, priced: 0, errors: 0 };

/** Accept errors after which the bot declines the offer instead of retrying every second. */
const DECLINE_ON = new Set(['INSUFFICIENT_BALANCE', 'NOT_ELIGIBLE', 'HANDYMAN_BUSY', 'FORBIDDEN', 'HANDYMAN_NOT_APPROVED', 'USER_BLOCKED']);

/** Initial bearing from a to b in degrees (0 = north). */
function bearing(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

/**
 * Where a bot is on its route `elapsedMs` after leaving, driving at `speedKmh` along `path` (a pure function of the stored
 * route and the Clock, so a restarted API continues exactly where the bot was).
 */
export function botPosition(path: LatLng[], speedKmh: number, elapsedMs: number): { at: LatLng; heading: number; done: boolean } {
  const total = pathLengthMeters(path);
  const travelled = Math.max(0, (speedKmh / 3.6) * (elapsedMs / 1000));
  if (total <= 1 || travelled >= total) {
    const end = path[path.length - 1]!;
    const prev = path.length > 1 ? path[path.length - 2]! : end;
    return { at: end, heading: bearing(prev, end), done: true };
  }
  const f = travelled / total;
  const at = pointAlong(path, f);
  const ahead = pointAlong(path, Math.min(1, f + 0.02));
  return { at, heading: bearing(at, ahead), done: false };
}

/**
 * The demo simulator (spec 17, plan lane B6). Runs inside the API when DEMO_MODE=true as a self-rescheduling JobsService job
 * (`demo.tick`, once per second, deduplicated per second) plus a reconciler task that re-arms it after a restart. Each tick
 * derives every step from Postgres state and the Clock, so it is idempotent and survives restarts mid-route:
 *  - idle bots keep their presence fresh (ProService.setOnline / PresenceService.updateLocation);
 *  - SENT offers to bots are accepted acceptDelaySec after they were sent (OffersService.acceptSolo, the real endpoint's service);
 *  - ACCEPTED bot jobs go en route acceptDelaySec later (scheduled jobs: 30 min before scheduledAt) (ProviderActionsService.enRoute);
 *  - EN_ROUTE bots move along the stored route at speedKmh with a location every 2 s (PresenceService.updateLocation, so B3's
 *    ETA / contact unlock run live) and mark ARRIVED at the end (autoArrive);
 *  - ARRIVED bots propose priceLabor + priceMaterials acceptDelaySec later (autoPrice; only where the worker enters the price).
 * Only handymen with isBot=true and an ACTIVE user are ever touched.
 */
@Injectable()
export class DemoSimulatorService implements OnModuleInit, OnApplicationBootstrap {
  private readonly log = new Logger('DemoSimulator');
  /** Last time (wall clock, logging only) a failure message was logged, so a failing bot does not log every second. */
  private readonly warned = new Map<string, number>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly moduleRef: ModuleRef,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    private readonly reconciler: ReconcilerService,
    private readonly presence: PresenceService,
    private readonly pro: ProService,
    private readonly offers: OffersService,
    private readonly config: DemoConfigService,
  ) {}

  /** ProviderActionsService is not exported by AssignmentsModule; it is stateless, so the app-wide instance is used. */
  private get actions(): ProviderActionsService {
    return this.moduleRef.get(ProviderActionsService, { strict: false });
  }

  onModuleInit(): void {
    this.jobs.register(DEMO_JOB.tick, async () => {
      await this.onTickJob();
    });
    this.reconciler.register(DEMO_RECONCILER_TASK, async () => {
      if (this.env.DEMO_MODE) await this.arm();
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.env.DEMO_MODE) return;
    try {
      await this.arm();
    } catch (err) {
      // The reconciler task arms the simulator on its next run.
      this.log.warn(`simulator not armed at startup: ${(err as Error).message}`);
    }
  }

  /** Schedules the next tick at the next whole second (one job per second, whoever schedules it). */
  async arm(): Promise<void> {
    const nextSec = Math.floor(this.clock.nowMs() / TICK_MS) + 1;
    await this.jobs.schedule(DEMO_JOB.tick, {}, { at: new Date(nextSec * TICK_MS), jobId: `demo-tick-${nextSec}`, attempts: 1 });
  }

  private async onTickJob(): Promise<void> {
    if (!this.env.DEMO_MODE) return;
    try {
      await this.tick();
    } catch (err) {
      this.log.error(`tick failed: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      await this.arm().catch((err: Error) => this.log.warn(`re-arm failed: ${err.message}`));
    }
  }

  /** One simulator pass. Holds a Redis lock so concurrent ticks (several processes) never act twice. */
  async tick(): Promise<TickReport> {
    if (!this.env.DEMO_MODE) return { ...EMPTY };
    const lockKey = this.redis.key('demo', 'tick');
    const token = newId();
    const got = await this.redis.client.set(lockKey, token, 'PX', TICK_LOCK_MS, 'NX');
    if (!got) return { ...EMPTY };
    try {
      return await this.run();
    } finally {
      const cur = await this.redis.client.get(lockKey);
      if (cur === token) await this.redis.client.del(lockKey);
    }
  }

  private async run(): Promise<TickReport> {
    const report: TickReport = { ...EMPTY, ran: true };
    const bots = await this.prisma.handymanProfile.findMany({
      where: { isBot: true, status: 'APPROVED', user: { status: 'ACTIVE' } },
      select: { id: true, userId: true, isOnline: true, lastLat: true, lastLng: true, baseLat: true, baseLng: true },
    });
    if (!bots.length) return report;
    const cfg = await this.config.get();
    const step = async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (err) {
        report.errors++;
        this.warnThrottled(`bot step failed: ${(err as Error).message}`);
      }
    };
    const enRouteIds = new Set(
      (
        await this.prisma.assignment.findMany({
          where: { status: 'EN_ROUTE', handyman: { isBot: true } },
          select: { handymanId: true },
        })
      ).map((a) => a.handymanId),
    );
    for (const b of bots) {
      if (enRouteIds.has(b.id)) continue; // driving bots ping every 2 s anyway
      await step(async () => {
        if (await this.heartbeat(b)) report.heartbeats++;
      });
    }
    if (cfg.autoAccept) await this.acceptOffers(cfg, report, step);
    await this.startRoutes(cfg, report, step);
    await this.drive(cfg, report, step);
    await this.proposePrices(cfg, report, step);
    return report;
  }

  private warnThrottled(message: string): void {
    const now = Date.now();
    if ((this.warned.get(message) ?? 0) > now - 60_000) return;
    if (this.warned.size > 500) this.warned.clear();
    this.warned.set(message, now);
    this.log.warn(message);
  }

  // ---------------------------------------------------------------- presence

  private async heartbeat(b: {
    id: string;
    userId: string;
    isOnline: boolean;
    lastLat: number | null;
    lastLng: number | null;
    baseLat: number | null;
    baseLng: number | null;
  }): Promise<boolean> {
    const live = await this.presence.get(b.id);
    const nowMs = this.clock.nowMs();
    if (live?.online && b.isOnline && nowMs - live.ts < HEARTBEAT_MS) return false;
    const lat = live?.lat ?? b.lastLat ?? b.baseLat;
    const lng = live?.lng ?? b.lastLng ?? b.baseLng;
    const loc = lat != null && lng != null ? { lat, lng } : undefined;
    if (!b.isOnline || !live?.online) {
      await this.pro.setOnline(b.userId, { online: true, ...(loc ? { location: loc } : {}) });
      return true;
    }
    if (loc) await this.presence.updateLocation(b.id, { ...loc, at: this.clock.now() });
    else await this.presence.touch(b.id);
    return true;
  }

  // ------------------------------------------------------------------ offers

  private async acceptOffers(cfg: DemoConfig, report: TickReport, step: (fn: () => Promise<void>) => Promise<void>): Promise<void> {
    const now = this.clock.now();
    const offers = await this.prisma.offer.findMany({
      where: {
        status: 'SENT',
        targetType: 'HANDYMAN',
        expiresAt: { gt: now },
        handyman: { isBot: true, status: 'APPROVED', user: { status: 'ACTIVE' } },
      },
      select: { id: true, sentAt: true, expiresAt: true, handyman: { select: { userId: true } } },
      orderBy: [{ sentAt: 'asc' }, { id: 'asc' }],
    });
    for (const o of offers) {
      const userId = o.handyman?.userId;
      if (!userId) continue;
      const dueMs = Math.min(o.sentAt.getTime() + cfg.acceptDelaySec * 1000, o.expiresAt.getTime() - 1000);
      if (now.getTime() < dueMs) continue;
      await step(async () => {
        try {
          await this.offers.acceptSolo(userId, o.id, 'az');
          report.accepted++;
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code && DECLINE_ON.has(code)) {
            await this.offers.declineSolo(userId, o.id);
            report.declined++;
            return;
          }
          if (code === 'OFFER_UNAVAILABLE' || code === 'OFFER_EXPIRED') return; // taken / gone meanwhile
          throw err;
        }
      });
    }
  }

  // ------------------------------------------------------------------ routes

  private async botLocation(handymanId: string): Promise<LatLng | undefined> {
    const live = await this.presence.get(handymanId);
    if (live?.lat != null && live.lng != null) return { lat: live.lat, lng: live.lng };
    const p = await this.prisma.handymanProfile.findUnique({
      where: { id: handymanId },
      select: { lastLat: true, lastLng: true, baseLat: true, baseLng: true },
    });
    const lat = p?.lastLat ?? p?.baseLat;
    const lng = p?.lastLng ?? p?.baseLng;
    return lat != null && lng != null ? { lat, lng } : undefined;
  }

  private async startRoutes(cfg: DemoConfig, report: TickReport, step: (fn: () => Promise<void>) => Promise<void>): Promise<void> {
    const nowMs = this.clock.nowMs();
    const rows = await this.prisma.assignment.findMany({
      where: { status: 'ACCEPTED', handyman: { isBot: true, user: { status: 'ACTIVE' } } },
      select: {
        id: true,
        handymanId: true,
        acceptedAt: true,
        handyman: { select: { userId: true } },
        request: { select: { timing: true, scheduledAt: true } },
      },
    });
    for (const a of rows) {
      let dueMs = a.acceptedAt.getTime() + cfg.acceptDelaySec * 1000;
      if (a.request.timing === 'SCHEDULED' && a.request.scheduledAt) {
        dueMs = Math.max(dueMs, a.request.scheduledAt.getTime() - SCHEDULED_DEPART_LEAD_MS);
      }
      if (nowMs < dueMs) continue;
      await step(async () => {
        const from = await this.botLocation(a.handymanId);
        await this.actions.enRoute(a.handyman.userId, a.id, from, 'az');
        report.enRoute++;
      });
    }
  }

  private async drive(cfg: DemoConfig, report: TickReport, step: (fn: () => Promise<void>) => Promise<void>): Promise<void> {
    const now = this.clock.now();
    const rows = await this.prisma.assignment.findMany({
      where: { status: 'EN_ROUTE', handyman: { isBot: true, user: { status: 'ACTIVE' } } },
      select: {
        id: true,
        handymanId: true,
        enRouteAt: true,
        acceptedAt: true,
        routePolyline: true,
        routeComputedAt: true,
        lastLat: true,
        lastLng: true,
        lastLocationAt: true,
        handyman: { select: { userId: true } },
        request: { select: { lat: true, lng: true } },
      },
    });
    for (const a of rows) {
      await step(async () => {
        const dest = { lat: a.request.lat, lng: a.request.lng };
        let path = a.routePolyline ? decodePolyline(a.routePolyline) : [];
        if (!path.length) {
          const from = a.lastLat != null && a.lastLng != null ? { lat: a.lastLat, lng: a.lastLng } : await this.botLocation(a.handymanId);
          path = from ? [from] : [];
        }
        if (!path.length || haversineMeters(path[path.length - 1]!, dest) > 5) path.push(dest);
        // A re-route (B3 tracking) stores a new polyline starting where the bot was at routeComputedAt.
        const leftAt = (a.enRouteAt ?? a.acceptedAt).getTime();
        const startedAt = a.routeComputedAt && a.routeComputedAt.getTime() > leftAt ? a.routeComputedAt.getTime() : leftAt;
        const pos = botPosition(path, cfg.speedKmh, now.getTime() - startedAt);
        const last = a.lastLat != null && a.lastLng != null ? { lat: a.lastLat, lng: a.lastLng } : null;
        const atDest = !!last && haversineMeters(last, dest) <= 5;
        // Waiting at the door (autoArrive off): only a heartbeat ping now and then keeps the presence fresh.
        const every = pos.done && atDest ? HEARTBEAT_MS : DRIVE_PING_MS;
        const pingDue = !a.lastLocationAt || now.getTime() - a.lastLocationAt.getTime() >= every;
        if (pingDue || (pos.done && !atDest)) {
          await this.presence.updateLocation(a.handymanId, {
            lat: pos.at.lat,
            lng: pos.at.lng,
            heading: pos.heading,
            speed: pos.done ? 0 : Math.round((cfg.speedKmh / 3.6) * 10) / 10,
            accuracy: 5,
            at: now,
            assignmentId: a.id,
          });
          report.moved++;
        }
        if (pos.done && cfg.autoArrive) {
          await this.actions.arrived(a.handyman.userId, a.id, 'az');
          report.arrived++;
        }
      });
    }
  }

  // ------------------------------------------------------------------- price

  private async proposePrices(cfg: DemoConfig, report: TickReport, step: (fn: () => Promise<void>) => Promise<void>): Promise<void> {
    if (!cfg.autoPrice) return;
    const nowMs = this.clock.nowMs();
    const rows = await this.prisma.assignment.findMany({
      where: {
        status: 'ARRIVED',
        handyman: { isBot: true, user: { status: 'ACTIVE' } },
        // Company jobs whose manager enters the final price are left to the manager.
        OR: [{ providerType: 'SOLO' }, { company: { finalPriceEntry: 'WORKER' } }],
      },
      select: { id: true, arrivedAt: true, handyman: { select: { userId: true } } },
    });
    for (const a of rows) {
      if (a.arrivedAt && nowMs < a.arrivedAt.getTime() + cfg.acceptDelaySec * 1000) continue;
      await step(async () => {
        await this.actions.enterPrice(a.handyman.userId, a.id, { labor: cfg.priceLabor, materials: cfg.priceMaterials }, 'az', null);
        report.priced++;
      });
    }
  }
}
