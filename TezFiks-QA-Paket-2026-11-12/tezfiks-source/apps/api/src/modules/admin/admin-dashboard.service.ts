import { Injectable } from '@nestjs/common';
import { BUSY_ASSIGNMENT_STATUSES, bakuDayKey, type EndpointOutput, type Locale, type api } from '@tezfiks/shared';
import { PrismaService } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { SettingsService } from '../../common/settings/settings.service';
import { iso } from '../../common/mapping';
import { CategoriesService } from '../categories/categories.service';
import { PresenceService } from '../realtime/presence.service';
import { RequestViews } from '../requests/views/request-views.service';
import { AdminRequestsService } from './admin-requests.service';
import { bakuDay, botRequestSql, fullName, round } from './admin-common';

type Dashboard = EndpointOutput<typeof api.admin.dashboard>;
type LiveMap = EndpointOutput<typeof api.admin.liveMap>;

const RECENT_ORDERS = 10;
const LIVE_MAP_MAX_HANDYMEN = 2000;
const LIVE_MAP_MAX_REQUESTS = 500;

/**
 * Board 05 dashboard KPIs and the live map.
 *
 * KPI definitions (Baku days from the Clock; bot/demo requests and bot handymen are left out):
 * - ordersToday / ordersYesterday: requests created on the Baku day; ordersDeltaPct = (today - yesterday) / yesterday * 100
 *   (percent, one decimal; null when yesterday had none).
 * - activeHandymen: APPROVED handymen (solo and company workers) whose user is ACTIVE; onlineHandymen: those of them online.
 * - feeRevenueToday / feeOrdersToday: platform request fees kept (captured, not refunded) of assignments accepted today.
 * - cancelRate: cancelled / created requests over the last 7 Baku days (today included), a 0..1 ratio (4 decimals);
 *   cancelRateDelta: cancelRate minus the rate of the 7 days before (ratio points), null when that week had no requests.
 * - pendingKyc / pendingCompanies: profiles / companies PENDING_REVIEW; openCases: cases OPEN or IN_REVIEW.
 * - recentOrders: the 10 newest requests (bots included, flagged isBot).
 */
@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly categories: CategoriesService,
    private readonly presence: PresenceService,
    private readonly views: RequestViews,
    private readonly requests: AdminRequestsService,
  ) {}

  private async countRequests(from: Date, to: Date, status?: 'CANCELLED'): Promise<number> {
    const params: unknown[] = [from, to];
    let statusSql = '';
    if (status) {
      params.push(status);
      statusSql = `AND r.status = $3::"RequestStatus"`;
    }
    const rows = await this.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*)::bigint AS n FROM service_requests r
       WHERE r."createdAt" >= $1::timestamptz AND r."createdAt" < $2::timestamptz ${statusSql} AND NOT ${botRequestSql('r')}`,
      ...params,
    );
    return Number(rows[0]?.n ?? 0);
  }

  async dashboard(locale: Locale): Promise<Dashboard> {
    const now = this.clock.now();
    const today = bakuDay(now);
    const tomorrow = bakuDay(now, 1);
    const yesterday = bakuDay(now, -1);
    const weekStart = bakuDay(now, -6);
    const prevWeekStart = bakuDay(now, -13);

    const [ordersToday, ordersYesterday, weekTotal, weekCancelled, prevTotal, prevCancelled] = await Promise.all([
      this.countRequests(today, tomorrow),
      this.countRequests(yesterday, today),
      this.countRequests(weekStart, tomorrow),
      this.countRequests(weekStart, tomorrow, 'CANCELLED'),
      this.countRequests(prevWeekStart, weekStart),
      this.countRequests(prevWeekStart, weekStart, 'CANCELLED'),
    ]);

    const fees = await this.prisma.$queryRawUnsafe<Array<{ total: bigint | null; n: bigint }>>(
      `SELECT coalesce(sum(a."feeAmount"), 0)::bigint AS total, count(*)::bigint AS n
       FROM assignments a JOIN service_requests r ON r.id = a."requestId" JOIN handyman_profiles h ON h.id = a."handymanId"
       WHERE a."acceptedAt" >= $1::timestamptz AND a."acceptedAt" < $2::timestamptz
         AND a."feeCaptured" AND NOT a."feeRefunded" AND a."feeAmount" > 0
         AND NOT r."isDemo" AND NOT h."isBot"`,
      today,
      tomorrow,
    );

    const activeWhere = { status: 'APPROVED' as const, isBot: false, user: { status: 'ACTIVE' as const } };
    const [activeHandymen, onlineHandymen, pendingKyc, pendingCompanies, openCases, recent] = await Promise.all([
      this.prisma.handymanProfile.count({ where: activeWhere }),
      this.prisma.handymanProfile.count({ where: { ...activeWhere, isOnline: true } }),
      this.prisma.handymanProfile.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.company.count({ where: { status: 'PENDING_REVIEW' } }),
      this.prisma.case.count({ where: { status: { in: ['OPEN', 'IN_REVIEW'] } } }),
      this.prisma.serviceRequest.findMany({ orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: RECENT_ORDERS, select: { id: true } }),
    ]);

    const cancelRate = weekTotal > 0 ? weekCancelled / weekTotal : 0;
    const prevRate = prevTotal > 0 ? prevCancelled / prevTotal : null;
    return {
      date: bakuDayKey(now),
      ordersToday,
      ordersYesterday,
      ordersDeltaPct: ordersYesterday > 0 ? round(((ordersToday - ordersYesterday) / ordersYesterday) * 100, 1) : null,
      activeHandymen,
      onlineHandymen,
      feeRevenueToday: Number(fees[0]?.total ?? 0),
      feeOrdersToday: Number(fees[0]?.n ?? 0),
      cancelRate: round(cancelRate, 4),
      cancelRateDelta: prevRate === null ? null : round(cancelRate - prevRate, 4),
      pendingKyc,
      pendingCompanies,
      openCases,
      recentOrders: await this.requests.rows(
        recent.map((r) => r.id),
        locale,
      ),
    };
  }

  // -------------------------------------------------------------- live map

  /**
   * Handymen that are online or on a job (presence location first, then the last DB location), and open requests with the
   * H3 cells their live search covers so far (empty when not searching or the rings have not started).
   */
  async liveMap(locale: Locale): Promise<LiveMap> {
    const now = this.clock.now();
    const s = await this.settings.get();
    const busyStatuses = [...BUSY_ASSIGNMENT_STATUSES];
    const profiles = await this.prisma.handymanProfile.findMany({
      where: {
        user: { status: 'ACTIVE' },
        OR: [{ isOnline: true }, { assignments: { some: { status: { in: busyStatuses } } } }],
      },
      include: { user: { select: { firstName: true, lastName: true } }, company: { select: { name: true } } },
      orderBy: { id: 'asc' },
      take: LIVE_MAP_MAX_HANDYMEN,
    });
    const busyRows = profiles.length
      ? await this.prisma.assignment.findMany({
          where: { handymanId: { in: profiles.map((p) => p.id) }, status: { in: busyStatuses } },
          select: { handymanId: true },
        })
      : [];
    const busyDb = new Set(busyRows.map((b) => b.handymanId));
    const states = await Promise.all(profiles.map((p) => this.presence.get(p.id)));
    const handymen: LiveMap['handymen'] = [];
    profiles.forEach((p, i) => {
      const st = states[i];
      const lat = st?.lat ?? p.lastLat ?? p.baseLat;
      const lng = st?.lng ?? p.lastLng ?? p.baseLng;
      if (lat == null || lng == null) return;
      const lastSeen = st?.ts ? new Date(Math.max(st.ts, p.lastSeenAt?.getTime() ?? 0)) : p.lastSeenAt;
      handymen.push({
        id: p.id,
        name: fullName(p.user.firstName, p.user.lastName),
        lat,
        lng,
        isOnline: p.isOnline,
        busy: busyDb.has(p.id) || !!st?.busy,
        cell7: st?.cell7 ?? p.lastCell7 ?? null,
        isBot: p.isBot,
        companyName: p.company?.name ?? null,
        lastSeenAt: iso(lastSeen),
      });
    });

    const reqs = await this.prisma.serviceRequest.findMany({
      where: { status: { in: ['SEARCHING', 'ASSIGNED', 'IN_PROGRESS'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIVE_MAP_MAX_REQUESTS,
    });
    const cats = await this.categories.refs(
      reqs.map((r) => r.categoryId),
      locale,
    );
    const requests: LiveMap['requests'] = reqs.map((r) => ({
      id: r.id,
      number: r.number,
      lat: r.lat,
      lng: r.lng,
      status: r.status,
      isSearching: r.isSearching,
      timing: r.timing,
      categoryName: cats.get(r.categoryId)?.name ?? '',
      cells: this.views.searchState(r, 0, s)?.cells ?? [],
    }));
    return { serverNow: now.toISOString(), handymen, requests };
  }
}
