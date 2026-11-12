import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { etaMinutes, isLiveTracked, shouldUnlockContact, type AssignmentStatus, type LatLng } from '@tezfiks/shared';
import { PrismaService } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { RealtimeService } from '../../infra/realtime.service';
import { RedisService } from '../../infra/redis.service';
import { SettingsService } from '../../common/settings/settings.service';
import { GeoService } from '../geo/geo.service';
import { PresenceService, type LocationEvent } from '../realtime/presence.service';
import { RequestNotifier } from '../requests/request-notifier';
import type { Assignment } from '../../generated/prisma/client';
import { AssignmentAccess, type AssignmentParties } from './assignment-access.service';
import { FALLBACK_SPEED_MPS, OFF_ROUTE_REROUTE_M, REROUTE_MIN_INTERVAL_MS, fullName } from './assignments.constants';

/** Route columns stored on the assignment. */
export interface RouteColumns {
  routePolyline: string;
  routeDurationSec: number;
  routeDistanceM: number;
  routeComputedAt: Date;
  routeSource: string;
}

/** Statuses whose pings can be tracked; isLiveTracked() decides per job (ACCEPTED: NOW/EMERGENCY, or scheduled within an hour). */
const LIVE_STATUSES: AssignmentStatus[] = ['ACCEPTED', 'EN_ROUTE'];

/** Pings of one pro closer together than this (Clock time) are not processed by tracking. */
export const PING_MIN_INTERVAL_MS = 2_000;

/**
 * Takes the per-pro ping slot. KEYS: key. ARGV: nowMs, minIntervalMs, ttlMs. Returns 1 (process) or 0 (too soon). A clock that
 * moved backwards (tests, skew) never blocks pings.
 */
const PING_SLOT = `
local now = tonumber(ARGV[1])
local last = tonumber(redis.call('GET', KEYS[1]))
if last and now >= last and now - last < tonumber(ARGV[2]) then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
return 1
`;

/**
 * Live tracking (spec 4.4, 12; from acceptance since the founder decision of 2026-10-26): every location ping of the pro
 * updates the last position and the ETA (progress along the stored route, re-routing when off the route; the first ping of
 * an ACCEPTED job computes the route), emits `assignment:location` and unlocks the contact once the ETA drops to
 * contactUnlockEtaSec, whether or not the pro pressed "Yola çıxdım". Pings of pros that are not APPROVED or whose user is not ACTIVE are ignored, and only
 * the presence layer's verifiedAssignmentId (an assignment of this very pro) is trusted, never the raw client value.
 */
@Injectable()
export class TrackingService implements OnModuleInit {
  private readonly log = new Logger('Tracking');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly redis: RedisService,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    private readonly geo: GeoService,
    private readonly presence: PresenceService,
    private readonly notifier: RequestNotifier,
    private readonly access: AssignmentAccess,
  ) {}

  onModuleInit(): void {
    this.presence.onLocation((e) => this.onLocation(e));
  }

  /** Route from the pro's position to the request address, as assignment columns. */
  async computeRoute(origin: LatLng, destination: LatLng): Promise<RouteColumns> {
    const r = await this.geo.route(origin, destination, { trafficAware: true });
    return {
      routePolyline: r.polyline,
      routeDurationSec: Math.max(0, Math.round(r.durationSec)),
      routeDistanceM: Math.max(0, Math.round(r.distanceM)),
      routeComputedAt: r.computedAt,
      routeSource: r.source,
    };
  }

  async onLocation(e: LocationEvent): Promise<void> {
    // Only an assignment the presence layer verified as this pro's own, or (no id sent) the pro's own live jobs.
    // (Every online ping lands here: the indexed assignment lookup runs first, most pros have no active job.)
    const candidates = await this.prisma.assignment.findMany({
      where: e.verifiedAssignmentId
        ? { id: e.verifiedAssignmentId, handymanId: e.handymanId, status: { in: LIVE_STATUSES } }
        : { handymanId: e.handymanId, status: { in: LIVE_STATUSES } },
      include: { request: { select: { timing: true, scheduledAt: true } } },
    });
    const nowMs = this.clock.now().getTime();
    const rows = candidates.filter((a) => isLiveTracked({ status: a.status, timing: a.request.timing, scheduledAt: a.request.scheduledAt }, nowMs));
    if (!rows.length) return;
    // At most one processed ping per PING_MIN_INTERVAL_MS and pro: each costs DB reads, maybe a re-route and socket fan-out.
    if (!(await this.takePingSlot(e.handymanId, e.receivedAt.getTime()))) return;
    const p = await this.prisma.handymanProfile.findUnique({
      where: { id: e.handymanId },
      select: { status: true, user: { select: { status: true } } },
    });
    if (!p || p.status !== 'APPROVED' || p.user.status !== 'ACTIVE') return;
    for (const a of rows) {
      try {
        await this.track(a, e);
      } catch (err) {
        this.log.warn(`tracking ${a.id} failed: ${(err as Error).message}`);
      }
    }
  }

  /** Clock-based throttle shared through Redis (several API processes agree). True when this ping may be processed. */
  private async takePingSlot(handymanId: string, atMs: number): Promise<boolean> {
    try {
      const ok = await this.redis.client.eval(PING_SLOT, 1, this.redis.key('track', 'ping', handymanId), String(atMs), String(PING_MIN_INTERVAL_MS), '600000');
      return Number(ok) === 1;
    } catch (err) {
      this.log.warn(`ping throttle unavailable: ${(err as Error).message}`);
      return true;
    }
  }

  private async track(a: Assignment, e: LocationEvent): Promise<void> {
    if (a.lastLocationAt && e.at.getTime() < a.lastLocationAt.getTime()) return; // out-of-order ping
    const now = this.clock.now();
    const r = await this.prisma.serviceRequest.findUniqueOrThrow({ where: { id: a.requestId }, select: { lat: true, lng: true } });
    const current = { lat: e.lat, lng: e.lng };
    let route: RouteColumns | null = null;
    let etaSec: number;
    let distanceM: number;
    if (a.routePolyline && a.routeDurationSec != null) {
      const prog = this.geo.progressAlong(a.routePolyline, current, a.routeDurationSec);
      const age = a.routeComputedAt ? now.getTime() - a.routeComputedAt.getTime() : Infinity;
      if (prog.offRouteM > OFF_ROUTE_REROUTE_M && age >= REROUTE_MIN_INTERVAL_MS) {
        route = await this.computeRoute(current, r);
        etaSec = route.routeDurationSec;
        distanceM = route.routeDistanceM;
      } else {
        // Still on (or recently re-routed near) the route: remaining share of the route time plus the detour back to it.
        etaSec = Math.round(prog.remainingSec + prog.offRouteM / FALLBACK_SPEED_MPS);
        distanceM = Math.round(prog.remainingDistanceM + prog.offRouteM);
      }
    } else {
      route = await this.computeRoute(current, r);
      etaSec = route.routeDurationSec;
      distanceM = route.routeDistanceM;
    }
    // Conditional on the stored position not being newer: a ping that read the row before a newer one was written (two
    // requests in flight) can never move the marker backwards.
    const res = await this.prisma.assignment.updateMany({
      where: { id: a.id, status: { in: LIVE_STATUSES }, OR: [{ lastLocationAt: null }, { lastLocationAt: { lte: e.at } }] },
      data: {
        lastLat: e.lat,
        lastLng: e.lng,
        lastHeading: e.heading,
        lastLocationAt: e.at,
        etaSec,
        etaUpdatedAt: now,
        distanceM,
        ...(route ?? {}),
      },
    });
    if (res.count === 0) return;
    const parties = await this.access.parties(a);
    const payload = {
      assignmentId: a.id,
      lat: e.lat,
      lng: e.lng,
      heading: e.heading,
      at: e.at.toISOString(),
      etaSec,
      distanceM,
    };
    this.realtime.toAssignment(a.id, 'assignment:location', payload);
    this.realtime.toUser(parties.customerUserId, 'assignment:location', payload);
    const s = await this.settings.get();
    // A live ETA unlocks like en route, also while still ACCEPTED (the pro need not press "Yola çıxdım").
    if (!a.contactUnlockedAt && shouldUnlockContact({ status: 'EN_ROUTE', etaSec, contactUnlockedAt: null }, s)) {
      await this.unlockNear(a, etaSec, parties);
    }
  }

  /** Sets contactUnlockedAt once (never relocks) while ACCEPTED or EN_ROUTE; emits assignment:contact and ASSIGNMENT_NEAR. */
  async unlockNear(a: Pick<Assignment, 'id' | 'requestId' | 'handymanId' | 'companyId'>, etaSec: number, parties?: AssignmentParties): Promise<boolean> {
    const res = await this.prisma.assignment.updateMany({
      where: { id: a.id, contactUnlockedAt: null, status: { in: LIVE_STATUSES } },
      data: { contactUnlockedAt: this.clock.now() },
    });
    if (res.count === 0) return false;
    const p = parties ?? (await this.access.parties(a));
    this.emitContact(a, p);
    const name = await this.providerName(a.handymanId);
    await this.notifier.send([p.customerUserId], 'ASSIGNMENT_NEAR', () => ({ name, minutes: etaMinutes(etaSec) ?? 1 }), {
      app: 'CUSTOMER',
      data: { assignmentId: a.id, requestId: a.requestId },
    });
    return true;
  }

  /** `assignment:contact` (phones are now in the views; the event itself carries only the id). */
  emitContact(a: Pick<Assignment, 'id' | 'companyId'>, p: AssignmentParties): void {
    const payload = { assignmentId: a.id };
    this.realtime.toAssignment(a.id, 'assignment:contact', payload);
    for (const u of new Set([p.customerUserId, p.providerUserId])) this.realtime.toUser(u, 'assignment:contact', payload);
    if (a.companyId) this.realtime.toCompany(a.companyId, 'assignment:contact', payload);
  }

  async providerName(handymanId: string): Promise<string> {
    const h = await this.prisma.handymanProfile.findUnique({
      where: { id: handymanId },
      select: { user: { select: { firstName: true, lastName: true } } },
    });
    return fullName(h?.user.firstName, h?.user.lastName);
  }
}
