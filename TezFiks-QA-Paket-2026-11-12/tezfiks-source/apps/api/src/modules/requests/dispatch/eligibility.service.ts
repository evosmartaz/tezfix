import { Injectable } from '@nestjs/common';
import { latLngToCell } from 'h3-js';
import { haversineMeters, type OfferCandidateWorker, type ProviderPreference, type RequestTiming } from '@tezfiks/shared';
import { PrismaService, type Db } from '../../../infra/prisma.service';
import { Clock } from '../../../infra/clock';
import { SettingsService } from '../../../common/settings/settings.service';
import { num, ratingAvg } from '../../../common/mapping';
import { PresenceService, type PresenceEntry } from '../../realtime/presence.service';
import { FilesService } from '../../files/files.service';
import { SCHEDULE_CONFLICT_MS } from '../requests.constants';

/** The request fields dispatch eligibility needs. */
export interface DispatchRequest {
  id: string;
  categoryId: string;
  lat: number;
  lng: number;
  cell7: string;
  providerPreference: ProviderPreference;
  isGuaranteeFix: boolean;
  createdByUserId: string;
  timing: RequestTiming;
  scheduledAt: Date | null;
}

/** A located provider (presence entry or, for scheduled pre-offers, the base location). */
export interface Located {
  handymanId: string;
  companyId: string | null;
  lat: number | null;
  lng: number | null;
}

export interface SoloCandidate {
  kind: 'SOLO';
  handymanId: string;
  userId: string;
  distanceM: number | null;
}

export interface CompanyCandidate {
  kind: 'COMPANY';
  companyId: string;
  distanceM: number | null;
  /** Eligible (online, free, with the trade) workers found for this step. */
  workerIds: string[];
}

export type Candidate = SoloCandidate | CompanyCandidate;

const LIVE_BUSY = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED'] as const;

/**
 * Dispatch eligibility (spec 5). Solo: APPROVED SOLO profile, ACTIVE user, the category trade, not busy, wallet available >=
 * request fee (not for guarantee fixes), within the service radius, preference ANY/INDIVIDUAL, never offered this request.
 * Company: APPROVED company with the trade, wallet ok, preference ANY/COMPANY, never offered, and >= 1 eligible worker
 * (ACTIVE member, APPROVED COMPANY_WORKER profile with the trade, ACTIVE user, not busy).
 */
@Injectable()
export class EligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly presence: PresenceService,
    private readonly files: FilesService,
  ) {}

  distance(req: { lat: number; lng: number }, p: { lat: number | null; lng: number | null }): number | null {
    if (p.lat == null || p.lng == null) return null;
    return Math.round(haversineMeters({ lat: req.lat, lng: req.lng }, { lat: p.lat, lng: p.lng }));
  }

  static cellOf(p: { lat: number; lng: number }): string {
    return latLngToCell(p.lat, p.lng, 7);
  }

  /**
   * Handymen that count as busy: an assignment in ACCEPTED/EN_ROUTE/ARRIVED, except an ACCEPTED scheduled job that is
   * more than 2 hours away (a pre-booked job does not block live work until shortly before it starts).
   */
  async busyHandymen(ids: string[], db: Db = this.prisma): Promise<Set<string>> {
    const out = new Set<string>();
    if (!ids.length) return out;
    const now = this.clock.nowMs();
    const rows = await db.assignment.findMany({
      where: { handymanId: { in: [...new Set(ids)] }, status: { in: [...LIVE_BUSY] } },
      select: { handymanId: true, status: true, request: { select: { timing: true, scheduledAt: true } } },
    });
    for (const r of rows) {
      const farScheduled =
        r.status === 'ACCEPTED' && r.request.timing === 'SCHEDULED' && r.request.scheduledAt && r.request.scheduledAt.getTime() - now > SCHEDULE_CONFLICT_MS;
      if (!farScheduled) out.add(r.handymanId);
    }
    return out;
  }

  /** True when this one handyman is busy (see busyHandymen). */
  async isBusy(handymanId: string, db: Db = this.prisma): Promise<boolean> {
    return (await this.busyHandymen([handymanId], db)).has(handymanId);
  }

  /** Handymen with an active assignment whose job time (scheduledAt, else acceptedAt) is within ±2 h of `at`. */
  async scheduleConflicts(ids: string[], at: Date, excludeRequestId: string | null, db: Db = this.prisma): Promise<Set<string>> {
    const out = new Set<string>();
    if (!ids.length) return out;
    const rows = await db.assignment.findMany({
      where: {
        handymanId: { in: [...new Set(ids)] },
        status: { in: ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PRICE_PROPOSED', 'PRICE_DISPUTED'] },
        ...(excludeRequestId ? { requestId: { not: excludeRequestId } } : {}),
      },
      select: { handymanId: true, acceptedAt: true, request: { select: { scheduledAt: true } } },
    });
    for (const r of rows) {
      const t = (r.request.scheduledAt ?? r.acceptedAt).getTime();
      if (Math.abs(t - at.getTime()) <= SCHEDULE_CONFLICT_MS) out.add(r.handymanId);
    }
    return out;
  }

  private async available(accountIds: string[], db: Db): Promise<Map<string, number>> {
    const rows = accountIds.length
      ? await db.ledgerAccount.findMany({ where: { id: { in: [...new Set(accountIds)] } }, select: { id: true, postedBalance: true, heldBalance: true } })
      : [];
    return new Map(rows.map((r) => [r.id, num(r.postedBalance) - num(r.heldBalance)]));
  }

  /** Converts fresh presence states to entries (used for service-area matches that are outside the ring cells). */
  async freshPresence(handymanIds: string[]): Promise<PresenceEntry[]> {
    const s = await this.settings.get();
    const minTs = this.clock.nowMs() - s.onlineStaleSec * 1000;
    const out: PresenceEntry[] = [];
    for (const id of [...new Set(handymanIds)]) {
      const p = await this.presence.get(id);
      if (!p || !p.online || p.ts < minTs || p.lat == null || p.lng == null) continue;
      out.push({ handymanId: id, userId: p.userId, companyId: p.companyId, lat: p.lat, lng: p.lng, busy: p.busy, ts: p.ts });
    }
    return out;
  }

  /**
   * Eligible solo handymen among `located`. `checkRadius` compares the distance with the handyman's serviceRadiusKm;
   * `scheduledAt` adds the ±2 h conflict rule; `checkBusy` excludes busy handymen.
   */
  async filterSolos(
    req: DispatchRequest,
    located: Located[],
    opts: { checkRadius: boolean; checkBusy: boolean; scheduledAt: Date | null; fee: number },
    db: Db = this.prisma,
  ): Promise<SoloCandidate[]> {
    if (req.providerPreference === 'COMPANY') return [];
    const ids = [...new Set(located.filter((l) => !l.companyId).map((l) => l.handymanId))];
    if (!ids.length) return [];
    const profiles = await db.handymanProfile.findMany({
      where: {
        id: { in: ids },
        kind: 'SOLO',
        status: 'APPROVED',
        user: { status: 'ACTIVE' },
        trades: { some: { categoryId: req.categoryId } },
      },
      select: { id: true, userId: true, serviceRadiusKm: true, walletAccountId: true },
    });
    if (!profiles.length) return [];
    const pids = profiles.map((p) => p.id);
    const offered = new Set(
      (await db.offer.findMany({ where: { requestId: req.id, handymanId: { in: pids } }, select: { handymanId: true } })).map((o) => o.handymanId!),
    );
    const busy = opts.checkBusy ? await this.busyHandymen(pids, db) : new Set<string>();
    const conflicts = opts.scheduledAt ? await this.scheduleConflicts(pids, opts.scheduledAt, req.id, db) : new Set<string>();
    const balances = await this.available(profiles.map((p) => p.walletAccountId).filter((v): v is string => !!v), db);
    const byId = new Map(located.map((l) => [l.handymanId, l]));
    const out: SoloCandidate[] = [];
    for (const p of profiles) {
      if (p.userId === req.createdByUserId) continue;
      if (offered.has(p.id) || busy.has(p.id) || conflicts.has(p.id)) continue;
      if (opts.fee > 0 && (!p.walletAccountId || (balances.get(p.walletAccountId) ?? 0) < opts.fee)) continue;
      const d = this.distance(req, byId.get(p.id)!);
      if (opts.checkRadius && (d == null || d > p.serviceRadiusKm * 1000)) continue;
      out.push({ kind: 'SOLO', handymanId: p.id, userId: p.userId, distanceM: d });
    }
    return out;
  }

  /**
   * Eligible companies. `workers` are located company workers (presence entries); with `workers = null` (scheduled
   * pre-offers) no presence is required and every eligible worker counts.
   */
  async filterCompanies(
    req: DispatchRequest,
    companyIds: string[],
    workers: Located[] | null,
    opts: { checkBusy: boolean; scheduledAt: Date | null; fee: number },
    db: Db = this.prisma,
  ): Promise<CompanyCandidate[]> {
    if (req.providerPreference === 'INDIVIDUAL') return [];
    const ids = [...new Set(companyIds)];
    if (!ids.length) return [];
    const companies = await db.company.findMany({
      where: { id: { in: ids }, status: 'APPROVED', trades: { some: { categoryId: req.categoryId } } },
      select: { id: true, walletAccountId: true },
    });
    if (!companies.length) return [];
    const cids = companies.map((c) => c.id);
    const offered = new Set(
      (await db.offer.findMany({ where: { requestId: req.id, companyId: { in: cids } }, select: { companyId: true } })).map((o) => o.companyId!),
    );
    const balances = await this.available(companies.map((c) => c.walletAccountId), db);
    const eligibleWorkers = await this.eligibleWorkers(req, cids, workers ? workers.map((w) => w.handymanId) : null, opts, db);
    const located = new Map((workers ?? []).map((w) => [w.handymanId, w]));
    const out: CompanyCandidate[] = [];
    for (const c of companies) {
      if (offered.has(c.id)) continue;
      if (opts.fee > 0 && (balances.get(c.walletAccountId) ?? 0) < opts.fee) continue;
      const ws = eligibleWorkers.filter((w) => w.companyId === c.id);
      if (!ws.length) continue;
      let best: number | null = null;
      for (const w of ws) {
        const d = this.distance(req, located.get(w.id) ?? { lat: w.baseLat, lng: w.baseLng });
        if (d != null && (best == null || d < best)) best = d;
      }
      out.push({ kind: 'COMPANY', companyId: c.id, distanceM: best, workerIds: ws.map((w) => w.id) });
    }
    return out;
  }

  /** Workers of the given companies who may take this request now (optionally restricted to `onlyIds`). */
  private async eligibleWorkers(
    req: DispatchRequest,
    companyIds: string[],
    onlyIds: string[] | null,
    opts: { checkBusy: boolean; scheduledAt: Date | null },
    db: Db,
  ) {
    if (onlyIds && !onlyIds.length) return [];
    const rows = await db.handymanProfile.findMany({
      where: {
        companyId: { in: companyIds },
        ...(onlyIds ? { id: { in: onlyIds } } : {}),
        kind: 'COMPANY_WORKER',
        status: 'APPROVED',
        user: { status: 'ACTIVE', memberships: { some: { status: 'ACTIVE' } } },
        trades: { some: { categoryId: req.categoryId } },
      },
      select: { id: true, userId: true, companyId: true, baseLat: true, baseLng: true, user: { select: { memberships: { where: { status: 'ACTIVE' }, select: { companyId: true } } } } },
    });
    const members = rows.filter((r) => r.user.memberships.some((m) => m.companyId === r.companyId) && r.userId !== req.createdByUserId);
    const ids = members.map((r) => r.id);
    const busy = opts.checkBusy ? await this.busyHandymen(ids, db) : new Set<string>();
    const conflicts = opts.scheduledAt ? await this.scheduleConflicts(ids, opts.scheduledAt, req.id, db) : new Set<string>();
    return members.filter((r) => !busy.has(r.id) && !conflicts.has(r.id));
  }

  /** Every ACTIVE worker of a company as shown in the manager's "Ustanı seçin" list (live presence, busy, trade). */
  async candidateWorkers(companyId: string, req: { lat: number; lng: number; categoryId: string }): Promise<OfferCandidateWorker[]> {
    const s = await this.settings.get();
    const minTs = this.clock.nowMs() - s.onlineStaleSec * 1000;
    const rows = await this.prisma.handymanProfile.findMany({
      where: {
        companyId,
        kind: 'COMPANY_WORKER',
        status: 'APPROVED',
        user: { status: 'ACTIVE', memberships: { some: { companyId, status: 'ACTIVE' } } },
      },
      select: {
        id: true,
        userId: true,
        ratingSum: true,
        ratingCount: true,
        completedCount: true,
        user: { select: { firstName: true, lastName: true, photoFileId: true } },
        trades: { where: { categoryId: req.categoryId }, select: { categoryId: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!rows.length) return [];
    const busy = await this.busyHandymen(rows.map((r) => r.id));
    const photos = new Map(
      (await this.files.refs(rows.map((r) => r.user.photoFileId).filter((v): v is string => !!v))).map((f) => [f.id, f]),
    );
    const out: OfferCandidateWorker[] = [];
    for (const r of rows) {
      const p = await this.presence.get(r.id);
      const online = !!p && p.online && p.ts >= minTs;
      out.push({
        handymanId: r.id,
        userId: r.userId,
        firstName: r.user.firstName ?? '',
        lastName: r.user.lastName ?? '',
        photo: r.user.photoFileId ? (photos.get(r.user.photoFileId) ?? null) : null,
        ratingAvg: ratingAvg(r.ratingSum, r.ratingCount),
        completedCount: r.completedCount,
        distanceM: online && p ? this.distance(req, p) : null,
        busy: busy.has(r.id),
        online,
        hasTrade: r.trades.length > 0,
      });
    }
    out.sort((a, b) => Number(a.busy) - Number(b.busy) || (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
    return out;
  }
}
