import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { latLngToCell } from 'h3-js';
import type { LatLng } from '@tezfiks/shared';
import { PrismaService } from '../../infra/prisma.service';
import { RedisService } from '../../infra/redis.service';
import { Clock } from '../../infra/clock';
import { ReconcilerService } from '../../infra/reconciler.service';
import { RealtimeService } from '../../infra/realtime.service';

/** A handyman as seen by dispatch (from the Redis presence store). `ts` = last-seen epoch ms (Clock time). */
export interface PresenceEntry {
  handymanId: string;
  userId: string;
  companyId: string | null;
  lat: number;
  lng: number;
  busy: boolean;
  ts: number;
}

/** Full presence state of one handyman (`get`). lat/lng are null when no location was ever reported. */
export interface PresenceState extends Omit<PresenceEntry, 'lat' | 'lng'> {
  lat: number | null;
  lng: number | null;
  cell7: string | null;
  cell9: string | null;
  online: boolean;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  /**
   * When lat/lng were last reported by the pro (Clock ms: a ping or going online with a location); null when they come
   * from the DB fallback. `ts` is not enough: heartbeats refresh it without a position.
   */
  locAt: number | null;
}

export interface LocationInput {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  /** Client timestamp (ISO or Date); informational, freshness uses the server Clock. */
  at?: string | Date;
  assignmentId?: string;
}

/** Passed to onLocation handlers after every location update. */
export interface LocationEvent {
  handymanId: string;
  userId: string;
  companyId: string | null;
  lat: number;
  lng: number;
  heading: number | null;
  speed: number | null;
  accuracy: number | null;
  /** Client-reported time when valid and not in the future, else server receive time. */
  at: Date;
  receivedAt: Date;
  /** The assignment id exactly as the client sent it (UNTRUSTED: it may belong to someone else). */
  assignmentId: string | null;
  /**
   * `assignmentId` when it names an assignment of THIS handyman, else null. ETA/contact logic (B3) must use this field,
   * never the raw `assignmentId`.
   */
  verifiedAssignmentId: string | null;
  cell7: string;
  cell9: string;
  online: boolean;
}

export type LocationHandler = (e: LocationEvent) => Promise<void>;

/** Presence hash lifetime (seconds, real Redis TTL). */
export const PRESENCE_TTL_SEC = 120;
/** DB isOnline flips to false after this long without a ping. */
export const OFFLINE_AFTER_MS = 30 * 60_000;
/** The Postgres location snapshot is written at most this often by the reconciler (spec §8: at most every 60 s). */
export const SNAPSHOT_EVERY_MS = 60_000;
/** Cell ZSET members older than this are pruned on read. */
const PRUNE_AFTER_MS = 60 * 60_000;
const BUSY_STATUSES = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED'] as const;

const SET_BUSY_IF_EXISTS = `if redis.call('HEXISTS', KEYS[1], 'userId') == 1 then redis.call('HSET', KEYS[1], 'busy', ARGV[1]) return 1 end return 0`;

/**
 * Atomic presence upsert. Every write path (setOnline, updateLocation, touch) goes through this script so a concurrent
 * setBusy / setOffline can never be overwritten by a stale read (no read-modify-write in Node).
 *
 * KEYS: 1 hm:<id>, 2 pres:all, 3 hmoff:<id> (offline tombstone)
 * ARGV: 1 handymanId, 2 ts, 3 ttlSec, 4 cell key prefix, 5 mode, 6 userId, 7 companyId, 8 busy, 9 online, 10 locMode, 11.. field/value pairs
 * mode:   'update' = only an existing entry is touched (returns nil when there is none);
 *         'create' = an existing entry is updated (identity/busy/online kept); a missing one is created from ARGV 6-9,
 *                    but never as online while the offline tombstone exists;
 *         'online' = like create, then forces online=1 and clears the tombstone (busy of an existing entry is kept).
 * locMode: 'set' writes the pairs; 'fallback' writes them only when the entry has no location yet; 'none' writes none.
 * Returns the hash (HGETALL) after the write.
 */
const UPSERT = `
local h = KEYS[1]
local id = ARGV[1]
local mode = ARGV[5]
local exists = redis.call('HEXISTS', h, 'userId') == 1
if not exists then
  if mode == 'update' then return false end
  redis.call('DEL', h)
  local online = ARGV[9]
  if mode == 'create' and redis.call('EXISTS', KEYS[3]) == 1 then online = '0' end
  redis.call('HSET', h, 'userId', ARGV[6], 'companyId', ARGV[7], 'busy', ARGV[8], 'online', online)
end
if mode == 'online' then
  redis.call('HSET', h, 'userId', ARGV[6], 'companyId', ARGV[7], 'online', '1')
  redis.call('DEL', KEYS[3])
end
local prevCell = redis.call('HGET', h, 'cell7') or ''
local locMode = ARGV[10]
local writeLoc = locMode == 'set' or (locMode == 'fallback' and redis.call('HEXISTS', h, 'lat') == 0)
redis.call('HSET', h, 'ts', ARGV[2])
if writeLoc and #ARGV > 10 then
  local kv = {}
  for i = 11, #ARGV do kv[#kv + 1] = ARGV[i] end
  redis.call('HSET', h, unpack(kv))
end
redis.call('EXPIRE', h, tonumber(ARGV[3]))
local cell = redis.call('HGET', h, 'cell7') or ''
local online = redis.call('HGET', h, 'online') == '1'
if prevCell ~= '' and (prevCell ~= cell or not online) then redis.call('ZREM', ARGV[4] .. prevCell, id) end
if online then
  if cell ~= '' then redis.call('ZADD', ARGV[4] .. cell, ARGV[2], id) end
  redis.call('ZADD', KEYS[2], ARGV[2], id)
else
  redis.call('ZREM', KEYS[2], id)
end
return redis.call('HGETALL', h)
`;

/** Atomic setOffline: drop cell + index membership and the hash, and leave an offline tombstone. KEYS: hm, all, hmoff. ARGV: id, prefix, ttl */
const OFFLINE = `
local cell = redis.call('HGET', KEYS[1], 'cell7')
if cell and cell ~= '' then redis.call('ZREM', ARGV[2] .. cell, ARGV[1]) end
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('DEL', KEYS[1])
redis.call('SET', KEYS[3], '1', 'EX', tonumber(ARGV[3]))
return 1
`;

/**
 * Conditional removal used by the snapshot task: only when the entry was not refreshed since it was read (ts unchanged).
 * ARGV[4] = 'drop' deletes the entry (stale), 'demote' keeps the hash for tracking but marks it offline (DB says offline).
 * KEYS: hm, all. ARGV: id, prefix, expectedTs, action
 */
const REMOVE_IF_UNCHANGED = `
if redis.call('HGET', KEYS[1], 'ts') ~= ARGV[3] then return 0 end
local cell = redis.call('HGET', KEYS[1], 'cell7')
if cell and cell ~= '' then redis.call('ZREM', ARGV[2] .. cell, ARGV[1]) end
redis.call('ZREM', KEYS[2], ARGV[1])
if ARGV[4] == 'drop' then redis.call('DEL', KEYS[1]) else redis.call('HSET', KEYS[1], 'online', '0') end
return 1
`;

interface Meta {
  userId: string;
  companyId: string | null;
  online: boolean;
  busy: boolean;
  lat: number | null;
  lng: number | null;
}

function numOrNull(v: string | undefined): number | null {
  if (v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function finiteOrEmpty(v: number | undefined): string {
  return v !== undefined && Number.isFinite(v) ? String(v) : '';
}

function pairsToHash(reply: unknown): Record<string, string> | null {
  if (!Array.isArray(reply)) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i + 1 < reply.length; i += 2) out[String(reply[i])] = String(reply[i + 1]);
  return out.userId ? out : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Redis presence store: a ZSET per H3 res-7 cell `pres:7:<cell>` (member handymanId, score last-seen ms), a hash per
 * handyman `hm:<id>` (lat, lng, cell7, cell9, busy, companyId, userId, ts, online; TTL 120 s), an index ZSET
 * `pres:all` used by the DB snapshot task and a short-lived offline tombstone `hmoff:<id>`. All timestamps come from Clock.
 * Every mutation is a single atomic Lua script, so concurrent pings, setBusy and setOffline never lose updates.
 */
@Injectable()
export class PresenceService implements OnModuleInit {
  private readonly log = new Logger('Presence');
  private readonly handlers: LocationHandler[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly clock: Clock,
    private readonly reconciler: ReconcilerService,
    private readonly realtime: RealtimeService,
  ) {}

  onModuleInit(): void {
    this.reconciler.register('presence.snapshot', async () => {
      await this.snapshot({ force: false });
    });
  }

  private hmKey(handymanId: string): string {
    return this.redis.key('hm', handymanId);
  }

  private offKey(handymanId: string): string {
    return this.redis.key('hmoff', handymanId);
  }

  private cellPrefix(): string {
    return this.redis.key('pres', '7', '');
  }

  private cellKey(cell7: string): string {
    return this.redis.key('pres', '7', cell7);
  }

  private allKey(): string {
    return this.redis.key('pres', 'all');
  }

  /** Registers a handler run after each location update (B3: ETA updater). Returns an unsubscribe function. */
  onLocation(handler: LocationHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  private async readHash(handymanId: string): Promise<Record<string, string> | null> {
    const h = await this.redis.client.hgetall(this.hmKey(handymanId));
    return h && h.userId ? h : null;
  }

  private async metaFromDb(handymanId: string): Promise<Meta | null> {
    if (!UUID_RE.test(handymanId)) return null;
    const p = await this.prisma.handymanProfile.findUnique({
      where: { id: handymanId },
      select: { userId: true, companyId: true, isOnline: true, lastLat: true, lastLng: true, baseLat: true, baseLng: true },
    });
    if (!p) return null;
    const busy = (await this.prisma.assignment.count({ where: { handymanId, status: { in: [...BUSY_STATUSES] } } })) > 0;
    return {
      userId: p.userId,
      companyId: p.companyId,
      online: p.isOnline,
      busy,
      lat: p.lastLat ?? p.baseLat,
      lng: p.lastLng ?? p.baseLng,
    };
  }

  private parse(handymanId: string, h: Record<string, string>): PresenceState {
    return {
      handymanId,
      userId: h.userId!,
      companyId: h.companyId ? h.companyId : null,
      lat: numOrNull(h.lat),
      lng: numOrNull(h.lng),
      cell7: h.cell7 ? h.cell7 : null,
      cell9: h.cell9 ? h.cell9 : null,
      busy: h.busy === '1',
      online: h.online === '1',
      ts: Number(h.ts ?? 0),
      heading: numOrNull(h.heading),
      speed: numOrNull(h.speed),
      accuracy: numOrNull(h.accuracy),
      locAt: numOrNull(h.locAt),
    };
  }

  /** Runs the atomic upsert script (see UPSERT). Returns the hash after the write, or null ('update' on a missing entry). */
  private upsert(
    handymanId: string,
    mode: 'update' | 'create' | 'online',
    meta: Pick<Meta, 'userId' | 'companyId' | 'busy' | 'online'> | null,
    locMode: 'set' | 'fallback' | 'none',
    loc: Record<string, string>,
  ): Promise<Record<string, string> | null> {
    const args: string[] = [
      handymanId,
      String(this.clock.nowMs()),
      String(PRESENCE_TTL_SEC),
      this.cellPrefix(),
      mode,
      meta?.userId ?? '',
      meta?.companyId ?? '',
      meta?.busy ? '1' : '0',
      meta?.online ? '1' : '0',
      locMode,
    ];
    for (const [k, v] of Object.entries(loc)) args.push(k, v);
    return this.redis.client
      .eval(UPSERT, 3, this.hmKey(handymanId), this.allKey(), this.offKey(handymanId), ...args)
      .then(pairsToHash);
  }

  private cells(loc: LatLng): { cell7: string; cell9: string } {
    return { cell7: latLngToCell(loc.lat, loc.lng, 7), cell9: latLngToCell(loc.lat, loc.lng, 9) };
  }

  /** Location fields; `reported` stamps locAt (a position the pro just sent, not the DB fallback, which clears it). */
  private locFields(loc: LatLng, reported: boolean): Record<string, string> {
    return { lat: String(loc.lat), lng: String(loc.lng), ...this.cells(loc), locAt: reported ? String(this.clock.nowMs()) : '' };
  }

  private static validLoc(loc: LatLng | undefined | null): loc is LatLng {
    return !!loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng) && Math.abs(loc.lat) <= 90 && Math.abs(loc.lng) <= 180;
  }

  private static dbLoc(meta: Meta): LatLng | null {
    return meta.lat != null && meta.lng != null ? { lat: meta.lat, lng: meta.lng } : null;
  }

  /**
   * Marks the handyman online in presence (B2 calls this from setOnline AFTER committing the DB flags).
   * Location: `loc`, else the last known presence location, else the DB last/base location.
   * The busy flag of a live entry is kept (setBusy owns it); a new entry computes busy from the DB.
   */
  async setOnline(handymanId: string, loc?: LatLng): Promise<PresenceState | null> {
    const meta = await this.metaFromDb(handymanId);
    if (!meta) return null;
    const dbLoc = PresenceService.dbLoc(meta);
    let h: Record<string, string> | null;
    if (PresenceService.validLoc(loc)) h = await this.upsert(handymanId, 'online', meta, 'set', this.locFields(loc, true));
    else if (dbLoc) h = await this.upsert(handymanId, 'online', meta, 'fallback', this.locFields(dbLoc, false));
    else h = await this.upsert(handymanId, 'online', meta, 'none', {});
    return h ? this.parse(handymanId, h) : null;
  }

  /** Removes the handyman from presence (cells, index and hash) atomically; pings in the next 120 s cannot bring them back online. */
  async setOffline(handymanId: string): Promise<void> {
    await this.redis.client.eval(
      OFFLINE,
      3,
      this.hmKey(handymanId),
      this.allKey(),
      this.offKey(handymanId),
      handymanId,
      this.cellPrefix(),
      String(PRESENCE_TTL_SEC),
    );
  }

  /**
   * Stores a location ping and runs the onLocation handlers (handler errors are logged, never thrown).
   * Only location fields and ts are written; busy and online are never touched by a ping. When the presence hash
   * expired, identity, online and busy state are reloaded from the DB (never online while the offline tombstone exists).
   * Returns null when the handyman does not exist or the location is invalid.
   */
  async updateLocation(handymanId: string, loc: LocationInput): Promise<LocationEvent | null> {
    if (!PresenceService.validLoc(loc)) return null;
    const { cell7, cell9 } = this.cells(loc);
    const fields: Record<string, string> = {
      lat: String(loc.lat),
      lng: String(loc.lng),
      cell7,
      cell9,
      heading: finiteOrEmpty(loc.heading),
      speed: finiteOrEmpty(loc.speed),
      accuracy: finiteOrEmpty(loc.accuracy),
      locAt: String(this.clock.nowMs()),
    };
    let h = await this.upsert(handymanId, 'update', null, 'set', fields);
    if (!h) {
      const meta = await this.metaFromDb(handymanId);
      if (!meta) return null;
      h = await this.upsert(handymanId, 'create', meta, 'set', fields);
      if (!h) return null;
    }
    const state = this.parse(handymanId, h);
    const nowMs = state.ts;
    const receivedAt = new Date(nowMs);
    let at = receivedAt;
    if (loc.at) {
      const client = new Date(loc.at);
      if (!Number.isNaN(client.getTime()) && client.getTime() <= nowMs + 5_000) at = client;
    }
    const assignmentId = loc.assignmentId ?? null;
    let verifiedAssignmentId: string | null = null;
    if (assignmentId && UUID_RE.test(assignmentId)) {
      const own = await this.prisma.assignment.findFirst({ where: { id: assignmentId, handymanId }, select: { id: true } });
      verifiedAssignmentId = own ? own.id : null;
    }
    const event: LocationEvent = {
      handymanId,
      userId: state.userId,
      companyId: state.companyId,
      lat: loc.lat,
      lng: loc.lng,
      heading: numOrNull(fields.heading),
      speed: numOrNull(fields.speed),
      accuracy: numOrNull(fields.accuracy),
      at,
      receivedAt,
      assignmentId,
      verifiedAssignmentId,
      cell7,
      cell9,
      online: state.online,
    };
    for (const handler of [...this.handlers]) {
      try {
        await handler(event);
      } catch (err) {
        this.log.error(`location handler failed: ${(err as Error).message}`, (err as Error).stack);
      }
    }
    return event;
  }

  /** Heartbeat: refreshes last-seen. Recreates an expired entry from the DB when the handyman is online there. */
  async touch(handymanId: string): Promise<boolean> {
    const h = await this.upsert(handymanId, 'update', null, 'none', {});
    if (h) return true;
    const meta = await this.metaFromDb(handymanId);
    if (!meta?.online) return false;
    const dbLoc = PresenceService.dbLoc(meta);
    const created = dbLoc
      ? await this.upsert(handymanId, 'create', meta, 'fallback', this.locFields(dbLoc, false))
      : await this.upsert(handymanId, 'create', meta, 'none', {});
    return created?.online === '1';
  }

  /** Sets the busy flag on a live entry (an expired entry recomputes busy from the DB when it comes back). */
  async setBusy(handymanId: string, busy: boolean): Promise<void> {
    await this.redis.client.eval(SET_BUSY_IF_EXISTS, 1, this.hmKey(handymanId), busy ? '1' : '0');
  }

  async get(handymanId: string): Promise<PresenceState | null> {
    const h = await this.readHash(handymanId);
    return h ? this.parse(handymanId, h) : null;
  }

  /**
   * Online handymen whose current cell is one of `cells` and who were seen within `freshWithinSec` (Clock time).
   * Busy handymen are included (flag `busy`); dispatch decides. Stale cell members are pruned.
   */
  async candidatesInCells(cells: string[], freshWithinSec: number): Promise<PresenceEntry[]> {
    const unique = [...new Set(cells)];
    if (!unique.length) return [];
    const nowMs = this.clock.nowMs();
    const min = nowMs - freshWithinSec * 1000;
    const read = this.redis.client.pipeline();
    for (const cell of unique) {
      read.zremrangebyscore(this.cellKey(cell), '-inf', `(${nowMs - PRUNE_AFTER_MS}`);
      read.zrangebyscore(this.cellKey(cell), min, '+inf');
    }
    const res = (await read.exec()) ?? [];
    const ids = new Set<string>();
    res.forEach(([err, value], i) => {
      if (!err && i % 2 === 1 && Array.isArray(value)) for (const id of value as string[]) ids.add(id);
    });
    if (!ids.size) return [];
    const list = [...ids];
    const hashes = this.redis.client.pipeline();
    for (const id of list) hashes.hgetall(this.hmKey(id));
    const hres = (await hashes.exec()) ?? [];
    const cellSet = new Set(unique);
    const out: PresenceEntry[] = [];
    list.forEach((id, i) => {
      const [err, h] = hres[i] ?? [null, null];
      if (err || !h || typeof h !== 'object') return;
      const rec = h as Record<string, string>;
      if (!rec.userId || rec.online !== '1' || !rec.cell7 || !cellSet.has(rec.cell7)) return;
      const s = this.parse(id, rec);
      if (s.ts < min || s.lat == null || s.lng == null) return;
      out.push({ handymanId: id, userId: s.userId, companyId: s.companyId, lat: s.lat, lng: s.lng, busy: s.busy, ts: s.ts });
    });
    return out;
  }

  private async removeIfUnchanged(handymanId: string, ts: string, action: 'drop' | 'demote'): Promise<boolean> {
    const r = await this.redis.client.eval(
      REMOVE_IF_UNCHANGED,
      2,
      this.hmKey(handymanId),
      this.allKey(),
      handymanId,
      this.cellPrefix(),
      ts,
      action,
    );
    return Number(r) === 1;
  }

  /**
   * Reconciler task `presence.snapshot` (and a direct call for tools/tests):
   * 1. copies presence locations to HandymanProfile (lastLat/lastLng/lastCell7/lastSeenAt), one bulk statement, never moving
   *    lastSeenAt backwards; from the reconciler (`force: false`) at most every 60 s of Clock time (spec §8);
   * 2. Redis entries that are online while the DB says offline are demoted (unless they were refreshed meanwhile);
   * 3. sets isOnline=false for handymen unseen for 30 minutes: the newer of lastSeenAt and onlineSince must be older than the
   *    cutoff and the Redis entry must not be fresh, so a handyman who just went online is never flipped back. Only the rows
   *    this statement actually changed are removed from presence and announced to their company.
   */
  async snapshot(opts: { force?: boolean } = {}): Promise<{ written: number; wentOffline: number }> {
    const force = opts.force ?? true;
    const nowMs = this.clock.nowMs();
    const cutoffMs = nowMs - OFFLINE_AFTER_MS;
    const ids = await this.redis.client.zrange(this.allKey(), 0, -1);
    const live: Array<{ id: string; s: PresenceState; rawTs: string }> = [];
    if (ids.length) {
      const p = this.redis.client.pipeline();
      for (const id of ids) p.hgetall(this.hmKey(id));
      const res = (await p.exec()) ?? [];
      const gone: string[] = [];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!;
        const [err, h] = res[i] ?? [null, null];
        const rec = (!err && h && typeof h === 'object' ? h : {}) as Record<string, string>;
        if (!rec.userId) gone.push(id);
        else live.push({ id, s: this.parse(id, rec), rawTs: rec.ts ?? '' });
      }
      if (gone.length) await this.redis.client.zrem(this.allKey(), ...gone);
    }

    let written = 0;
    if (live.length && (force || (await this.snapshotDue(nowMs)))) {
      const rows = live.map(({ id, s }) => ({
        id,
        lat: s.lat,
        lng: s.lng,
        cell: s.lat != null && s.lng != null ? s.cell7 : null,
        seen: new Date(s.ts).toISOString(),
      }));
      written = await this.prisma.$executeRawUnsafe(
        `UPDATE "handyman_profiles" AS h SET
           "lastLat" = CASE WHEN v.lat IS NULL OR v.lng IS NULL THEN h."lastLat" ELSE v.lat END,
           "lastLng" = CASE WHEN v.lat IS NULL OR v.lng IS NULL THEN h."lastLng" ELSE v.lng END,
           "lastCell7" = CASE WHEN v.lat IS NULL OR v.lng IS NULL THEN h."lastCell7" ELSE v.cell END,
           "lastSeenAt" = v.seen
         FROM jsonb_to_recordset($1::jsonb) AS v(id uuid, lat float8, lng float8, cell text, seen timestamptz)
         WHERE h.id = v.id AND (h."lastSeenAt" IS NULL OR h."lastSeenAt" < v.seen)`,
        JSON.stringify(rows),
      );
    }

    // DB -> Redis: an online Redis entry whose DB flag is off (account deleted, blocked, offline without setOffline...).
    if (live.length) {
      const dbOffline = await this.prisma.handymanProfile.findMany({
        where: { id: { in: live.map((l) => l.id) }, isOnline: false },
        select: { id: true },
      });
      const off = new Set(dbOffline.map((r) => r.id));
      for (const l of live) if (off.has(l.id)) await this.removeIfUnchanged(l.id, l.rawTs, 'demote');
    }

    const fresh = live.filter((l) => l.s.ts >= cutoffMs).map((l) => l.id);
    const stale = await this.prisma.$queryRawUnsafe<Array<{ id: string; companyId: string | null }>>(
      `UPDATE "handyman_profiles" SET "isOnline" = false, "updatedAt" = $3
       WHERE "isOnline" = true
         AND COALESCE(GREATEST("lastSeenAt", "onlineSince"), '-infinity'::timestamptz) < $1
         AND NOT ("id" = ANY($2::uuid[]))
       RETURNING "id", "companyId"`,
      new Date(cutoffMs),
      fresh,
      new Date(nowMs),
    );
    if (stale.length) {
      const companies = new Set<string>();
      const byId = new Map(live.map((l) => [l.id, l.rawTs]));
      for (const s of stale) {
        const ts = byId.get(s.id);
        // Only drop an entry we read as stale; one refreshed since then (new ts) is left alone.
        if (ts !== undefined) await this.removeIfUnchanged(s.id, ts, 'drop');
        else await this.dropIfStale(s.id, cutoffMs);
        if (s.companyId) companies.add(s.companyId);
      }
      for (const companyId of companies) this.realtime.toCompany(companyId, 'company:workers', { companyId });
    }
    return { written, wentOffline: stale.length };
  }

  /** Drops an entry that was not in the index (e.g. offline tracking hash) unless it is fresh. */
  private async dropIfStale(handymanId: string, cutoffMs: number): Promise<void> {
    const h = await this.readHash(handymanId);
    if (!h) return;
    if (Number(h.ts ?? 0) >= cutoffMs) return;
    await this.removeIfUnchanged(handymanId, h.ts ?? '', 'drop');
  }

  /** Clock-based throttle for the reconciler snapshot (shared through Redis so several processes agree). */
  private async snapshotDue(nowMs: number): Promise<boolean> {
    const key = this.redis.key('pres', 'snapAt');
    const last = Number((await this.redis.client.get(key)) ?? 0);
    if (last && nowMs - last < SNAPSHOT_EVERY_MS && nowMs >= last) return false;
    await this.redis.client.set(key, String(nowMs), 'EX', 3600);
    return true;
  }
}
