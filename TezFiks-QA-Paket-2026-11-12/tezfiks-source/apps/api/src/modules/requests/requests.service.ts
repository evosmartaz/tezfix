import { Injectable, Logger } from '@nestjs/common';
import { latLngToCell } from 'h3-js';
import type { ClassifyPhotoResponse, CreateRequestBodySchema, Locale, RequestDetail, RequestSummary, Vertical } from '@tezfiks/shared';
import type { z } from 'zod';
import { PrismaService, inTx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { RateLimiter } from '../../infra/rate-limiter';
import { SettingsService } from '../../common/settings/settings.service';
import { ApiException } from '../../common/http/api-exception';
import { num } from '../../common/mapping';
import { LedgerService } from '../ledger/ledger.service';
import { WalletEventsService } from '../wallet/wallet-events.service';
import { CategoriesService } from '../categories/categories.service';
import { FilesService } from '../files/files.service';
import { AiService } from '../ai/ai.service';
import { CustomerService, lockActiveUser } from '../customer/customer.service';
import { RequestViews } from './views/request-views.service';
import { RequestStateService } from './request-state.service';
import { DispatchService, type ClosedOffer } from './dispatch/dispatch.service';
import { CancellationService, type CancellationResult } from './cancellation.service';
import { FeesService } from './fees.service';
import { OPEN_REQUEST_STATUSES } from './requests.constants';
import type { ServiceRequest } from '../../generated/prisma/client';

export type CreateRequestInput = z.output<typeof CreateRequestBodySchema>;

/** classify-photo limit (plan: 20 per hour per user), on top of AiService's own per-user limit. */
export const CLASSIFY_LIMIT = 20;
export const CLASSIFY_WINDOW_SEC = 3600;

/** Customer requests: create (spec 4, 5), list, get, cancel, and the "Şəkil ilə tap" classifier. */
@Injectable()
export class RequestsService {
  private readonly log = new Logger('Requests');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly limiter: RateLimiter,
    private readonly settings: SettingsService,
    private readonly ledger: LedgerService,
    private readonly walletEvents: WalletEventsService,
    private readonly categories: CategoriesService,
    private readonly files: FilesService,
    private readonly ai: AiService,
    private readonly customers: CustomerService,
    private readonly views: RequestViews,
    private readonly state: RequestStateService,
    private readonly dispatch: DispatchService,
    private readonly cancellations: CancellationService,
    private readonly fees: FeesService,
  ) {}

  // ------------------------------------------------------------ classify

  async classifyPhoto(userId: string, body: { fileId: string; note?: string; vertical?: Vertical }, locale: Locale): Promise<ClassifyPhotoResponse> {
    await this.files.assertOwned(userId, [body.fileId], ['REQUEST_PHOTO']);
    await this.limiter.enforce(`classify:${userId}`, CLASSIFY_LIMIT, CLASSIFY_WINDOW_SEC);
    const { buffer } = await this.files.read(body.fileId);
    return this.ai.classify({ userId, fileId: body.fileId, image: buffer, note: body.note ?? null, vertical: body.vertical ?? null, locale });
  }

  // -------------------------------------------------------------- create

  async create(userId: string, body: CreateRequestInput, locale: Locale): Promise<RequestDetail> {
    const s = await this.settings.get();
    const now = this.clock.now();
    const account = await this.customers.requireAccount(userId);
    const wallet = await this.ledger.balance(account.walletAccountId);
    if (wallet.posted < 0) throw new ApiException('CUSTOMER_IN_DEBT', { debt: -wallet.posted });
    const category = await this.categories.requireInstantService(body.categoryId);
    const photoIds = [...new Set(body.photoFileIds ?? [])];
    if (photoIds.length > s.maxPhotos) throw new ApiException('VALIDATION_FAILED', { field: 'photoFileIds', max: s.maxPhotos });
    await this.files.assertOwned(userId, photoIds, ['REQUEST_PHOTO']);
    if (body.slots > s.maxSlots) throw new ApiException('VALIDATION_FAILED', { field: 'slots', max: s.maxSlots });
    const preference = account.type === 'COMPANY' ? body.providerPreference : 'ANY';
    if (body.timing === 'EMERGENCY' && !category.emergencyAllowed) throw new ApiException('EMERGENCY_NOT_ALLOWED', { categoryId: category.id });
    let scheduledAt: Date | null = null;
    if (body.timing === 'SCHEDULED') {
      scheduledAt = new Date(body.scheduledAt!);
      const min = now.getTime() + s.scheduledMinLeadMin * 60_000;
      const max = now.getTime() + s.scheduledMaxLeadDays * 86_400_000;
      if (scheduledAt.getTime() < min) throw new ApiException('SCHEDULE_TOO_SOON', { earliest: new Date(min).toISOString() });
      if (scheduledAt.getTime() > max) throw new ApiException('SCHEDULE_TOO_FAR', { latest: new Date(max).toISOString() });
    }
    const a = body.address;
    const created = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      const acc = await tx.ledgerAccount.findUniqueOrThrow({ where: { id: account.walletAccountId }, select: { postedBalance: true } });
      if (num(acc.postedBalance) < 0) throw new ApiException('CUSTOMER_IN_DEBT', { debt: -num(acc.postedBalance) });
      const req = await tx.serviceRequest.create({
        data: {
          customerAccountId: account.id,
          createdByUserId: userId,
          categoryId: category.id,
          vertical: category.vertical,
          description: body.description,
          timing: body.timing,
          scheduledAt,
          slotsRequested: body.slots,
          providerPreference: preference,
          lat: a.lat,
          lng: a.lng,
          cell7: latLngToCell(a.lat, a.lng, 7),
          cell9: latLngToCell(a.lat, a.lng, 9),
          formatted: a.formatted,
          placeId: a.placeId ?? null,
          district: a.district || null,
          street: a.street || null,
          building: a.building || null,
          block: a.block || null,
          entrance: a.entrance || null,
          floor: a.floor || null,
          apartment: a.apartment || null,
          intercom: a.intercom || null,
          note: a.note || null,
          photoFileIds: photoIds,
          status: 'SEARCHING',
          isSearching: true,
          createdAt: now,
          slots: { create: Array.from({ length: body.slots }, (_, index) => ({ index })) },
        },
        include: { slots: true },
      });
      if (body.timing === 'EMERGENCY' && s.emergencyFeePerSlot > 0) {
        for (const slot of req.slots) {
          const hold = await this.ledger.hold(
            { accountId: account.walletAccountId, amount: s.emergencyFeePerSlot, kind: 'EMERGENCY_FEE', requestId: req.id, slotId: slot.id },
            tx,
          );
          await tx.requestSlot.update({ where: { id: slot.id }, data: { emergencyHoldId: hold.id } });
        }
      }
      if (body.saveAddressLabel) {
        await this.customers.createAddress(account.id, { ...a, label: body.saveAddressLabel }, tx);
      }
      return req;
    });

    for (const fileId of photoIds) {
      try {
        await this.ai.recordFinalCategory(userId, fileId, category.id);
      } catch (err) {
        this.log.warn(`recordFinalCategory failed: ${(err as Error).message}`);
      }
    }
    if (body.timing === 'EMERGENCY') await this.walletEvents.notifyAccount(account.walletAccountId);
    try {
      await this.dispatch.start(created.id);
    } catch (err) {
      // The reconciler (dispatch.repair) starts searches that did not start here.
      this.log.error(`dispatch start for ${created.id} failed: ${(err as Error).message}`);
    }
    return this.views.toRequestDetail(created.id, locale);
  }

  // ---------------------------------------------------------- list / get

  private async owned(userId: string, requestId: string): Promise<ServiceRequest> {
    const r = await this.prisma.serviceRequest.findUnique({ where: { id: requestId }, include: { customerAccount: { select: { ownerUserId: true } } } });
    if (!r || r.customerAccount.ownerUserId !== userId) throw new ApiException('NOT_FOUND', { entity: 'request', id: requestId });
    return r;
  }

  async list(userId: string, q: { cursor?: string; limit?: number; scope?: 'active' | 'history' }, locale: Locale): Promise<{ items: RequestSummary[]; nextCursor: string | null }> {
    const account = await this.customers.findAccount(userId);
    if (!account) return { items: [], nextCursor: null };
    const limit = q.limit ?? 20;
    const statusFilter =
      q.scope === 'active'
        ? { status: { in: [...OPEN_REQUEST_STATUSES] } }
        : q.scope === 'history'
          ? { status: { notIn: [...OPEN_REQUEST_STATUSES] } }
          : {};
    const cursor = q.cursor && /^[0-9a-f-]{36}$/i.test(q.cursor) ? q.cursor : null;
    const rows = await this.prisma.serviceRequest.findMany({
      where: { customerAccountId: account.id, ...statusFilter, ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: await this.views.toRequestSummaries(page, locale), nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  async get(userId: string, requestId: string, locale: Locale): Promise<RequestDetail> {
    const r = await this.owned(userId, requestId);
    return this.views.toRequestDetail(r.id, locale);
  }

  // -------------------------------------------------------------- cancel

  /**
   * Cancels the whole request (owner only). Searching without assignments: CANCELLED, offers closed, emergency holds
   * released. With assignments: every ACCEPTED/EN_ROUTE one is cancelled and every ARRIVED one declined through
   * CancellationService (actor CUSTOMER, penalties per assignment); open slots are cancelled. Terminal requests and
   * requests with a proposed/disputed price cannot be cancelled.
   */
  async cancel(userId: string, requestId: string, reason: string | undefined, locale: Locale): Promise<RequestDetail> {
    await this.owned(userId, requestId);
    const out = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      await tx.$queryRawUnsafe('SELECT id FROM service_requests WHERE id = $1::uuid FOR UPDATE', requestId);
      const r = await tx.serviceRequest.findUniqueOrThrow({ where: { id: requestId }, include: { assignments: true } });
      if (!(OPEN_REQUEST_STATUSES as readonly string[]).includes(r.status)) throw new ApiException('INVALID_STATE', { status: r.status });
      if (r.assignments.some((a) => a.status === 'PRICE_PROPOSED' || a.status === 'PRICE_DISPUTED')) {
        throw new ApiException('CANCEL_NOT_ALLOWED', { reason: 'PRICE_PROPOSED' });
      }
      const results: CancellationResult[] = [];
      for (const a of r.assignments) {
        if (a.status === 'ACCEPTED' || a.status === 'EN_ROUTE') {
          results.push(await this.cancellations.apply(a.id, { actor: 'CUSTOMER', kind: 'CANCEL', reason: reason ?? null, byUserId: userId }, tx));
        } else if (a.status === 'ARRIVED') {
          results.push(
            await this.cancellations.apply(a.id, { actor: 'CUSTOMER', kind: 'DECLINE_ON_ARRIVAL', reason: reason ?? null, byUserId: userId }, tx),
          );
        }
      }
      const closed: ClosedOffer[] = await this.dispatch.closeSentOffers(requestId, 'CANCELLED', tx);
      const open = await tx.requestSlot.findMany({ where: { requestId, status: 'OPEN' }, select: { id: true } });
      const accounts: string[] = [];
      for (const slot of open) {
        await tx.requestSlot.update({ where: { id: slot.id }, data: { status: 'CANCELLED' } });
        const acc = await this.fees.releaseOrRefundEmergency(slot.id, r.number, tx);
        if (acc) accounts.push(acc);
      }
      const now = this.clock.now();
      const completed = await tx.assignment.count({ where: { requestId, status: 'COMPLETED' } });
      await tx.serviceRequest.update({
        where: { id: requestId },
        data: {
          status: completed > 0 ? 'COMPLETED' : 'CANCELLED',
          isSearching: false,
          cancelledAt: completed > 0 ? null : now,
          cancelledBy: completed > 0 ? null : 'CUSTOMER',
          cancelReason: completed > 0 ? null : (reason ?? null),
        },
      });
      return { results, closed, accounts };
    });
    await this.dispatch.cancelSearchJobs(requestId);
    await this.dispatch.announceClosed(out.closed);
    for (const r of out.results) await r.afterCommit();
    await this.walletEvents.notifyAccounts(out.accounts);
    await this.state.announce(requestId);
    return this.views.toRequestDetail(requestId, locale);
  }
}
