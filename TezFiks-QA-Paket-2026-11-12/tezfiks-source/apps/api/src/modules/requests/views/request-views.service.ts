import { Injectable } from '@nestjs/common';
import { gridDisk } from 'h3-js';
import {
  CUSTOMER_ACTIONS,
  PROVIDER_ACTIONS,
  canDo,
  customerCancelPenaltyNow,
  isContactWindowOpen,
  ringPlan,
  type AddressView,
  type AssignmentStatus,
  type CategoryRef,
  type CustomerAssignment,
  type CustomerPublic,
  type FileRef,
  type Locale,
  type OfferView,
  type PlatformSettings,
  type ProAssignment,
  type ProviderPublic,
  type RequestDetail,
  type RequestSearchState,
  type RequestSummary,
  type RouteDto,
} from '@tezfiks/shared';
import { PrismaService, type Db } from '../../../infra/prisma.service';
import { Clock } from '../../../infra/clock';
import { SettingsService } from '../../../common/settings/settings.service';
import { I18nService } from '../../../common/i18n/i18n.service';
import { ApiException } from '../../../common/http/api-exception';
import { iso, num, numOrNull, ratingAvg } from '../../../common/mapping';
import { FilesService } from '../../files/files.service';
import { CategoriesService } from '../../categories/categories.service';
import { nearestBakuDistrict } from '../../geo/baku-districts';
import { redactPhones } from '../../notifications/privacy';
import { EligibilityService } from '../dispatch/eligibility.service';
import { DESCRIPTION_SHORT_LEN, roundCoord } from '../requests.constants';
import type { Assignment, Offer, ServiceRequest } from '../../../generated/prisma/client';

/** Who looks at a provider-side assignment. */
export type ProViewerMode = 'SOLO' | 'WORKER' | 'MANAGER';

const OPEN_STATUSES = new Set(['SEARCHING', 'ASSIGNED', 'IN_PROGRESS']);
const NOT_CANCELLABLE = new Set(['PRICE_PROPOSED', 'PRICE_DISPUTED']);

/** "Talıbov" -> "T." (empty when there is no last name). */
export function lastInitial(lastName: string | null | undefined): string {
  const l = (lastName ?? '').trim();
  return l ? `${l.charAt(0).toLocaleUpperCase('az')}.` : '';
}

/** Fallback ETA (spec 12: haversine x 1.35 at 25 km/h) in whole minutes, at least 1. */
export function etaMinFromDistance(straightM: number): number {
  const sec = (straightM * 1.35) / (25_000 / 3600);
  return Math.max(1, Math.ceil(sec / 60));
}

export function descriptionShort(description: string): string {
  return description.length > DESCRIPTION_SHORT_LEN ? description.slice(0, DESCRIPTION_SHORT_LEN) : description;
}

export function addressViewOf(r: {
  lat: number;
  lng: number;
  formatted: string;
  placeId: string | null;
  district: string | null;
  street: string | null;
  building: string | null;
  block: string | null;
  entrance: string | null;
  floor: string | null;
  apartment: string | null;
  intercom: string | null;
  note: string | null;
}): AddressView {
  return {
    lat: r.lat,
    lng: r.lng,
    formatted: r.formatted,
    placeId: r.placeId ?? null,
    district: r.district ?? null,
    street: r.street ?? null,
    building: r.building ?? null,
    block: r.block ?? null,
    entrance: r.entrance ?? null,
    floor: r.floor ?? null,
    apartment: r.apartment ?? null,
    intercom: r.intercom ?? null,
    note: r.note ?? null,
  };
}

export function routeOf(a: Pick<Assignment, 'routePolyline' | 'routeDurationSec' | 'routeDistanceM' | 'routeComputedAt' | 'routeSource'>): RouteDto | null {
  if (!a.routePolyline || a.routeDurationSec == null || a.routeDistanceM == null || !a.routeComputedAt) return null;
  return {
    polyline: a.routePolyline,
    durationSec: a.routeDurationSec,
    distanceM: a.routeDistanceM,
    computedAt: a.routeComputedAt.toISOString(),
    source: a.routeSource === 'google' ? 'google' : 'fallback',
  };
}

function priceOf(a: Pick<Assignment, 'laborAmount' | 'materialsAmount' | 'totalAmount'>) {
  if (a.totalAmount == null) return null;
  return { labor: num(a.laborAmount), materials: num(a.materialsAmount), total: num(a.totalAmount) };
}

/**
 * Contract views of requests, assignments and offers (exported; lane B3 reuses them).
 * Privacy (spec 4.4): offers carry an area-level address, rounded coordinates and the customer's first name + initial,
 * never a phone; customer views include the provider phone only while the contact window is open; company worker views
 * (WORKER_LIMITED) omit the description, customer rating, money and the customer phone.
 */
@Injectable()
export class RequestViews {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly settings: SettingsService,
    private readonly i18n: I18nService,
    private readonly files: FilesService,
    private readonly categories: CategoriesService,
    private readonly eligibility: EligibilityService,
  ) {}

  // ------------------------------------------------------------------ requests

  async toRequestSummaries(rows: ServiceRequest[], locale: Locale): Promise<RequestSummary[]> {
    if (!rows.length) return [];
    const cats = await this.categories.refs(rows.map((r) => r.categoryId), locale);
    const filled = await this.prisma.requestSlot.groupBy({
      by: ['requestId'],
      where: { requestId: { in: rows.map((r) => r.id) }, status: { in: ['FILLED', 'DONE'] } },
      _count: { _all: true },
    });
    const filledBy = new Map(filled.map((f) => [f.requestId, f._count._all]));
    return rows.map((r) => this.summaryOf(r, cats.get(r.categoryId)!, filledBy.get(r.id) ?? 0));
  }

  async toRequestSummary(r: ServiceRequest, locale: Locale): Promise<RequestSummary> {
    return (await this.toRequestSummaries([r], locale))[0]!;
  }

  private summaryOf(r: ServiceRequest, category: CategoryRef, slotsFilled: number): RequestSummary {
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      timing: r.timing,
      scheduledAt: iso(r.scheduledAt),
      category,
      slotsRequested: r.slotsRequested,
      slotsFilled,
      isSearching: r.isSearching,
      isGuaranteeFix: r.isGuaranteeFix,
      createdAt: iso(r.createdAt),
      addressText: r.formatted,
      descriptionShort: descriptionShort(r.description),
    };
  }

  /** Covered H3 cells and step data of a running search (null when not searching or rings not started). */
  searchState(r: ServiceRequest, offersSent: number, s: PlatformSettings): RequestSearchState | null {
    if (!r.isSearching || r.dispatchStep < 0 || !r.searchStartedAt || !r.searchEndsAt) return null;
    const plan = ringPlan(r.timing === 'EMERGENCY' ? 'EMERGENCY' : 'NOW', s);
    const p = plan[Math.min(r.dispatchStep, plan.length - 1)]!;
    return {
      step: r.dispatchStep,
      ring: p.ring,
      wide: p.wide,
      cells: gridDisk(r.cell7, p.ring),
      startedAt: iso(r.searchStartedAt),
      endsAt: iso(r.searchEndsAt),
      offersSent,
    };
  }

  async toRequestDetail(requestOrId: ServiceRequest | string, locale: Locale): Promise<RequestDetail> {
    const r =
      typeof requestOrId === 'string' ? await this.prisma.serviceRequest.findUnique({ where: { id: requestOrId } }) : requestOrId;
    if (!r) throw new ApiException('NOT_FOUND', { entity: 'request' });
    const s = await this.settings.get();
    const now = this.clock.now();
    const [category, slots, assignments, offersSent, emergencyHolds, photos] = await Promise.all([
      this.categories.get(r.categoryId).then((c) => this.categories.ref(c, locale)),
      this.prisma.requestSlot.findMany({ where: { requestId: r.id }, orderBy: { index: 'asc' } }),
      this.prisma.assignment.findMany({ where: { requestId: r.id }, orderBy: [{ acceptedAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.offer.count({ where: { requestId: r.id } }),
      this.prisma.hold.findMany({ where: { requestId: r.id, kind: 'EMERGENCY_FEE' } }),
      this.files.refs(r.photoFileIds),
    ]);
    const filled = slots.filter((x) => x.status === 'FILLED' || x.status === 'DONE').length;
    let emergencyFee: RequestDetail['emergencyFee'] = null;
    if (r.timing === 'EMERGENCY' && !r.isGuaranteeFix) {
      const perSlot = emergencyHolds.length ? num(emergencyHolds[0]!.amount) : s.emergencyFeePerSlot;
      const refundedSlots = new Set(slots.filter((x) => x.emergencyRefunded).map((x) => x.id));
      const captured = emergencyHolds
        .filter((h) => h.status === 'CAPTURED' && !(h.slotId && refundedSlots.has(h.slotId)))
        .reduce((sum, h) => sum + num(h.amount), 0);
      emergencyFee = { perSlot, total: emergencyHolds.reduce((sum, h) => sum + num(h.amount), 0), captured };
    }
    const views = await this.toCustomerAssignments(assignments, locale);
    const active = assignments.filter((a) => a.status === 'ACCEPTED' || a.status === 'EN_ROUTE' || a.status === 'ARRIVED');
    const canCancel = OPEN_STATUSES.has(r.status) && !assignments.some((a) => NOT_CANCELLABLE.has(a.status));
    const cancelPenaltyPreview = canCancel ? active.reduce((sum, a) => sum + customerCancelPenaltyNow(a, s, now), 0) : 0;
    return {
      ...this.summaryOf(r, category, filled),
      description: r.description,
      photos,
      providerPreference: r.providerPreference,
      address: addressViewOf(r),
      slots: slots.map((x) => ({ index: x.index, status: x.status, assignmentId: x.currentAssignmentId ?? null })),
      assignments: views,
      search: this.searchState(r, offersSent, s),
      emergencyFee,
      cancelledAt: iso(r.cancelledAt),
      cancelReason: r.cancelReason ?? null,
      canCancel,
      cancelPenaltyPreview,
    };
  }

  // ------------------------------------------------------------ assignments

  private async loadContext(rows: Assignment[], db: Db = this.prisma) {
    const handymanIds = [...new Set(rows.map((a) => a.handymanId))];
    const requestIds = [...new Set(rows.map((a) => a.requestId))];
    const intentIds = rows.map((a) => a.paymentIntentId).filter((v): v is string => !!v);
    const slotIds = rows.map((a) => a.slotId);
    const [handymen, requests, intents, slots] = await Promise.all([
      db.handymanProfile.findMany({
        where: { id: { in: handymanIds } },
        include: {
          user: { select: { id: true, firstName: true, lastName: true, phone: true, photoFileId: true } },
          trades: { include: { category: true } },
          company: { select: { id: true, name: true, finalPriceEntry: true } },
        },
      }),
      db.serviceRequest.findMany({
        where: { id: { in: requestIds } },
        include: {
          customerAccount: { include: { owner: { select: { id: true, firstName: true, lastName: true, phone: true, photoFileId: true } } } },
        },
      }),
      intentIds.length ? db.paymentIntent.findMany({ where: { id: { in: intentIds } }, select: { id: true, status: true } }) : [],
      db.requestSlot.findMany({ where: { id: { in: slotIds } }, select: { id: true, index: true } }),
    ]);
    const companyIds = [...new Set(rows.map((a) => a.companyId).filter((v): v is string => !!v))];
    const companies = companyIds.length
      ? await db.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true, finalPriceEntry: true } })
      : [];
    const photoIds = [
      ...handymen.map((h) => h.user.photoFileId),
      ...requests.map((r) => r.customerAccount.owner.photoFileId),
    ].filter((v): v is string => !!v);
    const photos = new Map((await this.files.refs(photoIds)).map((f) => [f.id, f]));
    return {
      handymen: new Map(handymen.map((h) => [h.id, h])),
      requests: new Map(requests.map((r) => [r.id, r])),
      intents: new Map(intents.map((i) => [i.id, i])),
      slots: new Map(slots.map((x) => [x.id, x])),
      companies: new Map(companies.map((c) => [c.id, c])),
      photo: (id: string | null | undefined): FileRef | null => (id ? (photos.get(id) ?? null) : null),
    };
  }

  async toCustomerAssignments(rows: Assignment[], locale: Locale): Promise<CustomerAssignment[]> {
    if (!rows.length) return [];
    const s = await this.settings.get();
    const now = this.clock.now();
    const ctx = await this.loadContext(rows);
    return rows.map((a) => {
      const h = ctx.handymen.get(a.handymanId)!;
      const company = a.companyId ? (ctx.companies.get(a.companyId) ?? null) : null;
      const provider: ProviderPublic = {
        type: a.providerType,
        handymanId: h.id,
        userId: h.userId,
        firstName: h.user.firstName ?? '',
        lastName: h.user.lastName ?? '',
        photo: ctx.photo(h.user.photoFileId),
        ratingAvg: ratingAvg(h.ratingSum, h.ratingCount),
        ratingCount: h.ratingCount,
        completedCount: h.completedCount,
        trades: h.trades.map((t) => this.categories.name(t.category, locale)),
        company: company ? { id: company.id, name: company.name } : null,
      };
      const window = isContactWindowOpen({ contactUnlockedAt: a.contactUnlockedAt, endedAt: a.endedAt }, s, now);
      const intent = a.paymentIntentId ? ctx.intents.get(a.paymentIntentId) : undefined;
      const status = a.status as AssignmentStatus;
      const cancel = canDo(CUSTOMER_ACTIONS, 'cancel', status);
      const declineOnArrival = canDo(CUSTOMER_ACTIONS, 'declineOnArrival', status);
      const noShowAt = a.acceptedAt.getTime() + s.noShowAfterMin * 60_000;
      const completed = status === 'COMPLETED';
      const cardPaid = completed && a.paymentMethod === 'CARD' && intent?.status === 'SUCCEEDED';
      // Live position from acceptance (tracking writes lastLat only for live-tracked jobs, see isLiveTracked).
      const live = (status === 'ACCEPTED' || status === 'EN_ROUTE' || status === 'ARRIVED') && a.lastLat != null && a.lastLng != null && a.lastLocationAt;
      return {
        id: a.id,
        requestId: a.requestId,
        slotIndex: ctx.slots.get(a.slotId)?.index ?? 0,
        status,
        provider,
        acceptedAt: iso(a.acceptedAt),
        freeCancelUntil: iso(a.freeCancelUntil),
        enRouteAt: iso(a.enRouteAt),
        arrivedAt: iso(a.arrivedAt),
        priceProposedAt: iso(a.priceProposedAt),
        completedAt: iso(a.completedAt),
        cancelledAt: iso(a.cancelledAt),
        cancelledBy: a.cancelledBy ?? null,
        etaSec: a.etaSec ?? null,
        distanceM: a.distanceM ?? null,
        location: live ? { lat: a.lastLat!, lng: a.lastLng!, heading: a.lastHeading ?? null, at: iso(a.lastLocationAt!) } : null,
        route: routeOf(a),
        contactUnlocked: a.contactUnlockedAt != null,
        providerPhone: window ? h.user.phone : null,
        chatEnabled: window,
        price: priceOf(a),
        paymentMethod: a.paymentMethod ?? null,
        payment: intent ? { intentId: intent.id, status: intent.status } : null,
        guaranteeUntil: iso(a.guaranteeUntil),
        tipAmount: numOrNull(a.tipAmount),
        rated: a.customerRatedAt != null,
        actions: {
          cancel,
          cancelPenalty: cancel ? customerCancelPenaltyNow(a, s, now) : 0,
          declineOnArrival,
          declinePenalty: declineOnArrival ? customerCancelPenaltyNow(a, s, now) : 0,
          reportNoShow: canDo(CUSTOMER_ACTIONS, 'reportNoShow', status) && now.getTime() >= noShowAt,
          confirmPrice: canDo(CUSTOMER_ACTIONS, 'confirmPrice', status),
          disputePrice: canDo(CUSTOMER_ACTIONS, 'disputePrice', status),
          tip: cardPaid && a.tipAmount == null,
          rate: completed && a.customerRatedAt == null,
          guaranteeClaim: cardPaid && !!a.guaranteeUntil && a.guaranteeUntil.getTime() > now.getTime(),
        },
      };
    });
  }

  async toCustomerAssignment(assignmentOrId: Assignment | string, locale: Locale): Promise<CustomerAssignment> {
    const a =
      typeof assignmentOrId === 'string' ? await this.prisma.assignment.findUnique({ where: { id: assignmentOrId } }) : assignmentOrId;
    if (!a) throw new ApiException('NOT_FOUND', { entity: 'assignment' });
    return (await this.toCustomerAssignments([a], locale))[0]!;
  }

  /** How `viewerUserId` sees the assignment: MANAGER (active manager of its company), SOLO / WORKER (the doer), or null. */
  async proViewerMode(a: Pick<Assignment, 'companyId' | 'handymanId' | 'providerType'>, viewerUserId: string, db: Db = this.prisma): Promise<ProViewerMode | null> {
    if (a.companyId) {
      const m = await db.companyMember.findFirst({
        where: { companyId: a.companyId, userId: viewerUserId, role: 'MANAGER', status: 'ACTIVE' },
        select: { id: true },
      });
      if (m) return 'MANAGER';
    }
    const h = await db.handymanProfile.findUnique({ where: { id: a.handymanId }, select: { userId: true } });
    if (h?.userId === viewerUserId) return a.providerType === 'SOLO' ? 'SOLO' : 'WORKER';
    return null;
  }

  /** Provider views for one viewer. Assignments the viewer may not see are rejected with NOT_FOUND. */
  async toProAssignments(rows: Assignment[], viewerUserId: string, locale: Locale, modeOverride?: ProViewerMode): Promise<ProAssignment[]> {
    if (!rows.length) return [];
    const s = await this.settings.get();
    const now = this.clock.now();
    const ctx = await this.loadContext(rows);
    const out: ProAssignment[] = [];
    for (const a of rows) {
      const mode = modeOverride ?? (await this.proViewerMode(a, viewerUserId));
      if (!mode) throw new ApiException('NOT_FOUND', { entity: 'assignment', id: a.id });
      const h = ctx.handymen.get(a.handymanId)!;
      const r = ctx.requests.get(a.requestId)!;
      const company = a.companyId ? (ctx.companies.get(a.companyId) ?? null) : null;
      const owner = r.customerAccount.owner;
      const limited = mode === 'WORKER';
      const status = a.status as AssignmentStatus;
      const doer = h.userId === viewerUserId;
      const window = isContactWindowOpen({ contactUnlockedAt: a.contactUnlockedAt, endedAt: a.endedAt }, s, now);
      const customer: CustomerPublic = {
        firstName: owner.firstName ?? '',
        lastInitial: lastInitial(owner.lastName),
        photo: ctx.photo(owner.photoFileId),
        ratingAvg: limited ? null : ratingAvg(r.customerAccount.ratingSum, r.customerAccount.ratingCount),
        ratingCount: limited ? null : r.customerAccount.ratingCount,
        type: r.customerAccount.type,
        companyName: r.customerAccount.companyName ?? null,
      };
      const priceEntryByWorker = !company || company.finalPriceEntry === 'WORKER';
      const intent = a.paymentIntentId ? ctx.intents.get(a.paymentIntentId) : undefined;
      const cancel = canDo(PROVIDER_ACTIONS, 'cancel', status);
      out.push({
        id: a.id,
        requestId: a.requestId,
        requestNumber: r.number,
        status,
        view: limited ? 'WORKER_LIMITED' : 'FULL',
        providerType: a.providerType,
        company: company ? { id: company.id, name: company.name } : null,
        worker: {
          handymanId: h.id,
          userId: h.userId,
          firstName: h.user.firstName ?? '',
          lastName: h.user.lastName ?? '',
          photo: ctx.photo(h.user.photoFileId),
          phone: mode === 'MANAGER' ? h.user.phone : null,
        },
        timing: r.timing,
        scheduledAt: iso(r.scheduledAt),
        isEmergency: r.timing === 'EMERGENCY',
        isGuaranteeFix: a.isGuaranteeFix,
        category: this.categories.ref(await this.categories.get(r.categoryId), locale),
        description: limited ? null : r.description,
        photos: limited ? [] : await this.files.refs(r.photoFileIds),
        address: addressViewOf(r),
        customer,
        customerPhone: !limited && window ? owner.phone : null,
        contactUnlocked: a.contactUnlockedAt != null,
        // Company workers do not chat with the customer: they contact their manager (spec 4.4).
        chatEnabled: !limited && window,
        acceptedAt: iso(a.acceptedAt),
        freeCancelUntil: iso(a.freeCancelUntil),
        enRouteAt: iso(a.enRouteAt),
        arrivedAt: iso(a.arrivedAt),
        priceProposedAt: iso(a.priceProposedAt),
        completedAt: iso(a.completedAt),
        cancelledAt: iso(a.cancelledAt),
        cancelledBy: a.cancelledBy ?? null,
        price: limited && !priceEntryByWorker ? null : priceOf(a),
        paymentMethod: a.paymentMethod ?? null,
        paymentStatus: intent?.status ?? null,
        guaranteeUntil: iso(a.guaranteeUntil),
        tipAmount: limited ? null : numOrNull(a.tipAmount),
        fee: limited ? null : { amount: num(a.feeAmount), captured: a.feeCaptured, refunded: a.feeRefunded },
        etaSec: a.etaSec ?? null,
        distanceM: a.distanceM ?? null,
        route: routeOf(a),
        ratedCustomer: a.providerRatedAt != null,
        actions: {
          enRoute: doer && canDo(PROVIDER_ACTIONS, 'enRoute', status),
          arrived: doer && canDo(PROVIDER_ACTIONS, 'arrived', status),
          enterPrice:
            canDo(PROVIDER_ACTIONS, 'price', status) &&
            (mode === 'SOLO' || (priceEntryByWorker ? doer : mode === 'MANAGER')),
          cancel,
          cancelIsFree: cancel && now.getTime() <= a.freeCancelUntil.getTime(),
          rateCustomer: status === 'COMPLETED' && a.providerRatedAt == null && !limited,
        },
      });
    }
    return out;
  }

  async toProAssignment(assignmentOrId: Assignment | string, viewerUserId: string, locale: Locale, modeOverride?: ProViewerMode): Promise<ProAssignment> {
    const a =
      typeof assignmentOrId === 'string' ? await this.prisma.assignment.findUnique({ where: { id: assignmentOrId } }) : assignmentOrId;
    if (!a) throw new ApiException('NOT_FOUND', { entity: 'assignment' });
    return (await this.toProAssignments([a], viewerUserId, locale, modeOverride))[0]!;
  }

  // ------------------------------------------------------------------ offers

  /** Area-level address text without flat details: "Atatürk pr. 45, Nərimanov rayonu". */
  areaText(r: { street: string | null; building: string | null; district: string | null; lat: number; lng: number }, locale: Locale): { area: string; district: string | null } {
    const district = r.district ?? nearestBakuDistrict({ lat: r.lat, lng: r.lng })?.names[locale] ?? null;
    const street = [r.street, r.building].filter((v) => !!v && v.trim()).join(' ').trim();
    const area = [street || null, district].filter(Boolean).join(', ');
    return { area: area || this.i18n.t(locale, 'server.requests.offer.areaFallback'), district };
  }

  async toOfferViews(offers: Offer[], locale: Locale): Promise<OfferView[]> {
    if (!offers.length) return [];
    const s = await this.settings.get();
    const requests = await this.prisma.serviceRequest.findMany({
      where: { id: { in: [...new Set(offers.map((o) => o.requestId))] } },
      include: {
        customerAccount: { select: { type: true, companyName: true, ratingSum: true, ratingCount: true, owner: { select: { firstName: true, lastName: true } } } },
        slots: { select: { status: true } },
      },
    });
    const byId = new Map(requests.map((r) => [r.id, r]));
    const cats = await this.categories.refs(requests.map((r) => r.categoryId), locale);
    const out: OfferView[] = [];
    for (const o of offers) {
      const r = byId.get(o.requestId)!;
      const { area, district } = this.areaText(r, locale);
      const acc = r.customerAccount;
      const fee = r.isGuaranteeFix ? 0 : s.requestFee;
      out.push({
        id: o.id,
        requestId: r.id,
        requestNumber: r.number,
        target: o.targetType,
        companyId: o.companyId ?? null,
        status: o.status,
        sentAt: iso(o.sentAt),
        expiresAt: iso(o.expiresAt),
        timing: r.timing,
        scheduledAt: iso(r.scheduledAt),
        isEmergency: r.timing === 'EMERGENCY',
        isGuaranteeFix: r.isGuaranteeFix,
        category: cats.get(r.categoryId)!,
        // Offers are shown before acceptance: phone-like text typed into the description is masked (spec 4.4).
        descriptionShort: redactPhones(descriptionShort(r.description)),
        address: { district, street: r.street ?? null, area, lat: roundCoord(r.lat), lng: roundCoord(r.lng) },
        distanceM: o.distanceM ?? null,
        etaMin: o.distanceM != null ? etaMinFromDistance(o.distanceM) : null,
        customer: {
          firstName: acc.owner.firstName ?? '',
          lastInitial: lastInitial(acc.owner.lastName),
          ratingAvg: ratingAvg(acc.ratingSum, acc.ratingCount),
          ratingCount: acc.ratingCount,
          type: acc.type,
          companyName: acc.type === 'COMPANY' ? (acc.companyName ?? null) : null,
        },
        fee,
        slotsOpen: r.slots.filter((x) => x.status === 'OPEN').length,
        slotsRequested: r.slotsRequested,
        candidateWorkers: o.targetType === 'COMPANY' && o.companyId ? await this.eligibility.candidateWorkers(o.companyId, r) : [],
      });
    }
    return out;
  }

  async toOfferView(offer: Offer, locale: Locale): Promise<OfferView> {
    return (await this.toOfferViews([offer], locale))[0]!;
  }
}
