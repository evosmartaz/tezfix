import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { latLngToCell } from 'h3-js';
import {
  DEFAULT_LOCALE,
  bakuDayKey,
  type CaseView,
  type CreateProjectBodySchema,
  type GuaranteeClaimBodySchema,
  type Locale,
  type ProjectDetail,
  type ProjectSummary,
  type CustomerType,
} from '@tezfiks/shared';
import type { z } from 'zod';
import { PrismaService, inTx, type Tx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { JobsService } from '../../infra/jobs.service';
import { ReconcilerService } from '../../infra/reconciler.service';
import { RealtimeService } from '../../infra/realtime.service';
import { SettingsService } from '../../common/settings/settings.service';
import { I18nService } from '../../common/i18n/i18n.service';
import { ApiException } from '../../common/http/api-exception';
import { iso, num } from '../../common/mapping';
import { LedgerService } from '../ledger/ledger.service';
import { WalletEventsService } from '../wallet/wallet-events.service';
import { CategoriesService, type CategoryRow } from '../categories/categories.service';
import { FilesService } from '../files/files.service';
import { CustomerService, lockActiveUser } from '../customer/customer.service';
import { ProjectViews, providerNameOf, type FullProject } from './project-views.service';
import { ProjectNotifier } from './project-notifier';
import { ProviderActorService } from './provider-actor.service';
import { lockLedgerAccounts, lockProjectRow } from './project-locks';
import {
  ACTIVE_PROJECT_STATUSES,
  AWARD_WINDOW_MS,
  HISTORY_PROJECT_STATUSES,
  MAX_PROJECT_DAYS,
  PROJECT_JOB,
  PROJECT_RECONCILER_TASK,
  RATEABLE_STATUSES,
  dateOnly,
  isoDateOf,
  projectJobId,
  workDaysBetween,
} from './projects.constants';
import type { Quote } from '../../generated/prisma/client';

export type CreateProjectInput = z.output<typeof CreateProjectBodySchema>;
export type GuaranteeClaimInput = z.output<typeof GuaranteeClaimBodySchema>;

/** Quote holds released by one transaction, for the after-commit effects. */
interface ReleasedQuotes {
  quotes: Array<Pick<Quote, 'id' | 'providerType' | 'handymanId' | 'companyId'>>;
  accounts: string[];
}

/**
 * Customer side of the B2B quote flow (spec 4.10, 6.6): create a project ("Biznes sifarişi"), list / view it, accept one quote
 * (winner's fee captured, the others released), cancel while OPEN, rate, guarantee claim. Also owns the project timers.
 */
@Injectable()
export class ProjectsService implements OnModuleInit {
  private readonly log = new Logger('Projects');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly jobs: JobsService,
    private readonly reconciler: ReconcilerService,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    private readonly i18n: I18nService,
    private readonly ledger: LedgerService,
    private readonly walletEvents: WalletEventsService,
    private readonly categories: CategoriesService,
    private readonly files: FilesService,
    private readonly customers: CustomerService,
    private readonly views: ProjectViews,
    private readonly notifier: ProjectNotifier,
    private readonly actors: ProviderActorService,
  ) {}

  onModuleInit(): void {
    this.jobs.register(PROJECT_JOB.quoteDeadline, async (data: { projectId: string }) => {
      await this.onQuoteDeadline(data.projectId);
    });
    this.jobs.register(PROJECT_JOB.awardExpiry, async (data: { projectId: string }) => {
      await this.expireIfDue(data.projectId);
    });
    this.reconciler.register(PROJECT_RECONCILER_TASK, async () => {
      await this.repair();
    });
  }

  // ------------------------------------------------------------------ create

  /**
   * Company accounts may order any active service as a B2B project; any customer may for QUOTE-flow categories
   * (spec 4.10). An individual customer choosing an INSTANT category gets CATEGORY_NOT_INSTANT.
   */
  private async requireCategory(type: CustomerType, categoryId: string): Promise<CategoryRow> {
    const c = await this.categories.get(categoryId);
    if (type === 'COMPANY' && c.flow === 'INSTANT') return this.categories.requireInstantService(categoryId);
    return this.categories.requireQuoteService(categoryId);
  }

  async create(userId: string, body: CreateProjectInput, locale: Locale): Promise<ProjectDetail> {
    const s = await this.settings.get();
    const now = this.clock.now();
    const account = await this.customers.requireAccount(userId);
    const wallet = await this.ledger.balance(account.walletAccountId);
    if (wallet.posted < 0) throw new ApiException('CUSTOMER_IN_DEBT', { debt: -wallet.posted });
    const category = await this.requireCategory(account.type, body.categoryId);
    const today = bakuDayKey(now);
    if (body.dateFrom < today) throw new ApiException('VALIDATION_FAILED', { field: 'dateFrom', reason: 'in_past', earliest: today });
    const workDays = workDaysBetween(body.dateFrom, body.dateTo);
    if (workDays > MAX_PROJECT_DAYS) throw new ApiException('VALIDATION_FAILED', { field: 'dateTo', reason: 'too_long', maxDays: MAX_PROJECT_DAYS });
    const photoIds = [...new Set(body.photoFileIds ?? [])];
    if (photoIds.length > s.maxPhotos) throw new ApiException('VALIDATION_FAILED', { field: 'photoFileIds', max: s.maxPhotos });
    await this.files.assertOwned(userId, photoIds, ['REQUEST_PHOTO']);
    const a = body.address;
    const quoteDeadline = new Date(now.getTime() + Math.round(s.quoteWindowHours * 3600_000));
    const project = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      const acc = await tx.ledgerAccount.findUniqueOrThrow({ where: { id: account.walletAccountId }, select: { postedBalance: true } });
      if (num(acc.postedBalance) < 0) throw new ApiException('CUSTOMER_IN_DEBT', { debt: -num(acc.postedBalance) });
      return tx.project.create({
        data: {
          customerAccountId: account.id,
          createdByUserId: userId,
          categoryId: category.id,
          title: body.title?.trim() || null,
          scope: body.scope,
          dateFrom: dateOnly(body.dateFrom),
          dateTo: dateOnly(body.dateTo),
          workDays,
          workersNeeded: body.workersNeeded,
          description: body.description,
          photoFileIds: photoIds,
          lat: a.lat,
          lng: a.lng,
          cell7: latLngToCell(a.lat, a.lng, 7),
          formatted: a.formatted,
          placeId: a.placeId || null,
          district: a.district || null,
          street: a.street || null,
          building: a.building || null,
          block: a.block || null,
          entrance: a.entrance || null,
          floor: a.floor || null,
          apartment: a.apartment || null,
          intercom: a.intercom || null,
          note: a.note || null,
          status: 'OPEN',
          quoteDeadline,
          createdAt: now,
        },
      });
    });
    await this.jobs.schedule(PROJECT_JOB.quoteDeadline, { projectId: project.id }, { at: quoteDeadline, jobId: projectJobId.quoteDeadline(project.id) });
    const recipients = await this.actors.eligibleUserIds(category.id, project.cell7, userId);
    await this.notifier.send(recipients, 'PROJECT_NEW', (l) => ({ number: project.number, category: this.categories.name(category, l) }), {
      data: { projectId: project.id },
      app: 'PRO',
    });
    this.realtime.toAdmins('admin:event', { type: 'PROJECT_CREATED', entityId: project.id });
    return this.detail(project.id, locale);
  }

  // -------------------------------------------------------------- list / get

  private async owned(userId: string, projectId: string): Promise<FullProject> {
    const p = await this.views.load(projectId);
    if (!p || p.customerAccount.ownerUserId !== userId) throw new ApiException('NOT_FOUND', { entity: 'project', id: projectId });
    return p;
  }

  private async detail(projectId: string, locale: Locale): Promise<ProjectDetail> {
    const p = await this.views.load(projectId);
    if (!p) throw new ApiException('NOT_FOUND', { entity: 'project', id: projectId });
    return this.views.customerDetail(p, locale);
  }

  async list(
    userId: string,
    q: { cursor?: string; limit?: number; scope?: 'active' | 'history' },
    locale: Locale,
  ): Promise<{ items: ProjectSummary[]; nextCursor: string | null }> {
    const account = await this.customers.findAccount(userId);
    if (!account) return { items: [], nextCursor: null };
    const limit = q.limit ?? 20;
    const statuses = q.scope === 'active' ? ACTIVE_PROJECT_STATUSES : q.scope === 'history' ? HISTORY_PROJECT_STATUSES : null;
    const cursor = q.cursor && /^[0-9a-f-]{36}$/i.test(q.cursor) ? q.cursor : null;
    if (q.cursor && !cursor) throw new ApiException('VALIDATION_FAILED', { field: 'cursor' });
    const rows = await this.views.loadMany(
      {
        customerAccountId: account.id,
        ...(statuses ? { status: { in: [...statuses] } } : {}),
        ...(cursor ? { id: { lt: cursor } } : {}),
      },
      { take: limit + 1, orderBy: [{ id: 'desc' }] },
    );
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return { items: await this.views.customerSummaries(page, locale), nextCursor: hasMore ? page[page.length - 1]!.id : null };
  }

  async get(userId: string, projectId: string, locale: Locale): Promise<ProjectDetail> {
    return this.views.customerDetail(await this.owned(userId, projectId), locale);
  }

  // ------------------------------------------------------------- accept

  memo(key: 'quoteFee', projectNumber: number): string {
    return this.i18n.t(DEFAULT_LOCALE, `server.projects.memo.${key}`, { number: projectNumber });
  }

  /**
   * Owner accepts one SUBMITTED quote of an OPEN project: the winner's fee hold is captured (B2B_FEE_CAPTURE, key
   * b2b-capture:<quoteId>), every other submitted quote is REJECTED and its hold released, the terms are snapshotted and the
   * project becomes AWARDED. Racing accept / withdraw / cancel calls serialize on the project row; exactly one outcome wins.
   */
  async acceptQuote(userId: string, projectId: string, quoteId: string, locale: Locale): Promise<ProjectDetail> {
    await this.owned(userId, projectId);
    const out = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      await lockProjectRow(tx, projectId);
      const p = await tx.project.findUniqueOrThrow({ where: { id: projectId }, include: { quotes: { include: { handyman: { include: { user: true } }, company: true } } } });
      if (p.status !== 'OPEN') throw new ApiException('INVALID_STATE', { status: p.status });
      const q = p.quotes.find((x) => x.id === quoteId);
      if (!q) throw new ApiException('NOT_FOUND', { entity: 'quote', id: quoteId });
      if (q.status !== 'SUBMITTED') throw new ApiException('INVALID_STATE', { quoteStatus: q.status });
      const now = this.clock.now();
      const others = p.quotes.filter((x) => x.id !== q.id && x.status === 'SUBMITTED');
      const revenue = await this.ledger.platformAccountId('REVENUE', tx);
      const holdIds = [q, ...others].map((x) => x.holdId).filter((v): v is string => !!v);
      const holds = holdIds.length ? await tx.hold.findMany({ where: { id: { in: holdIds } }, select: { id: true, accountId: true } }) : [];
      await lockLedgerAccounts(tx, [...holds.map((h) => h.accountId), revenue]);
      if (q.holdId) {
        await this.ledger.captureHold(
          q.holdId,
          {
            kind: 'B2B_FEE_CAPTURE',
            toAccountId: revenue,
            idempotencyKey: `b2b-capture:${q.id}`,
            memo: this.memo('quoteFee', p.number),
            refs: { projectId: p.id },
            actor: { type: 'USER', id: userId },
          },
          tx,
        );
      }
      for (const o of others) if (o.holdId) await this.ledger.releaseHold(o.holdId, tx);
      if (others.length) {
        await tx.quote.updateMany({ where: { id: { in: others.map((o) => o.id) }, status: 'SUBMITTED' }, data: { status: 'REJECTED' } });
      }
      const terms = {
        quoteId: q.id,
        providerType: q.providerType,
        handymanId: q.handymanId,
        companyId: q.companyId,
        providerName: providerNameOf(q),
        totalAmount: num(q.totalAmount),
        workers: q.workers,
        days: q.days,
        note: q.note,
        fee: num(q.feeAmount),
        projectNumber: p.number,
        scope: p.scope,
        description: p.description,
        dateFrom: isoDateOf(p.dateFrom),
        dateTo: isoDateOf(p.dateTo),
        workersNeeded: p.workersNeeded,
        address: p.formatted,
        acceptedAt: iso(now),
        acceptedByUserId: userId,
      };
      const won = await tx.quote.updateMany({
        where: { id: q.id, status: 'SUBMITTED' },
        data: { status: 'ACCEPTED', feeCaptured: q.holdId != null, terms },
      });
      if (won.count !== 1) throw new ApiException('INVALID_STATE', { quoteStatus: 'CHANGED' });
      await tx.project.update({ where: { id: p.id }, data: { status: 'AWARDED', awardedQuoteId: q.id } });
      return { number: p.number, winner: q, others, accounts: holds.map((h) => h.accountId) };
    });
    await this.cancelTimers(projectId);
    await this.walletEvents.notifyAccounts(out.accounts);
    await this.notifier.send(await this.actors.userIdsOf(out.winner), 'QUOTE_ACCEPTED', () => ({ number: out.number }), {
      data: { projectId, quoteId: out.winner.id },
      app: 'PRO',
    });
    await this.notifyRejected(out.number, projectId, out.others);
    return this.detail(projectId, locale);
  }

  private async notifyRejected(number: number, projectId: string, quotes: ReleasedQuotes['quotes']): Promise<void> {
    for (const o of quotes) {
      await this.notifier.send(await this.actors.userIdsOf(o), 'QUOTE_REJECTED', () => ({ number }), {
        data: { projectId, quoteId: o.id },
        app: 'PRO',
      });
    }
  }

  private async cancelTimers(projectId: string): Promise<void> {
    await this.jobs.cancel(projectJobId.quoteDeadline(projectId));
    await this.jobs.cancel(projectJobId.awardExpiry(projectId));
  }

  /** Releases the holds of the given SUBMITTED quotes and moves them to `status` (inside the caller's transaction, project locked). */
  private async releaseQuotes(tx: Tx, quotes: Quote[], status: 'REJECTED' | 'EXPIRED'): Promise<ReleasedQuotes> {
    const holdIds = quotes.map((q) => q.holdId).filter((v): v is string => !!v);
    const holds = holdIds.length ? await tx.hold.findMany({ where: { id: { in: holdIds } }, select: { id: true, accountId: true } }) : [];
    await lockLedgerAccounts(
      tx,
      holds.map((h) => h.accountId),
    );
    for (const h of holds) await this.ledger.releaseHold(h.id, tx);
    if (quotes.length) await tx.quote.updateMany({ where: { id: { in: quotes.map((q) => q.id) }, status: 'SUBMITTED' }, data: { status } });
    return { quotes, accounts: holds.map((h) => h.accountId) };
  }

  // ------------------------------------------------------------- cancel

  /** Owner cancels an OPEN project (spec 6.6): every submitted quote is REJECTED and its fee hold released. */
  async cancel(userId: string, projectId: string, locale: Locale): Promise<ProjectDetail> {
    await this.owned(userId, projectId);
    const out = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      await lockProjectRow(tx, projectId);
      const p = await tx.project.findUniqueOrThrow({ where: { id: projectId }, include: { quotes: true } });
      if (p.status !== 'OPEN') throw new ApiException('CANCEL_NOT_ALLOWED', { status: p.status });
      const released = await this.releaseQuotes(
        tx,
        p.quotes.filter((q) => q.status === 'SUBMITTED'),
        'REJECTED',
      );
      await tx.project.update({ where: { id: projectId }, data: { status: 'CANCELLED', cancelledAt: this.clock.now() } });
      return { number: p.number, released };
    });
    await this.cancelTimers(projectId);
    await this.walletEvents.notifyAccounts(out.released.accounts);
    await this.notifyRejected(out.number, projectId, out.released.quotes);
    return this.detail(projectId, locale);
  }

  // --------------------------------------------------------------- rating

  /** Customer rates the awarded provider once the work is completed (COMPLETED / INVOICED / PAID). */
  async rate(userId: string, projectId: string, body: { stars: number; comment?: string }): Promise<{ ok: true }> {
    await this.owned(userId, projectId);
    const out = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      await lockProjectRow(tx, projectId);
      const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
      if (!RATEABLE_STATUSES.includes(p.status) || !p.awardedQuoteId) throw new ApiException('INVALID_STATE', { status: p.status });
      const existing = await tx.rating.findFirst({ where: { projectId, direction: 'CUSTOMER_TO_PROVIDER' }, select: { id: true } });
      if (existing) throw new ApiException('ALREADY_RATED');
      const q = await tx.quote.findUniqueOrThrow({ where: { id: p.awardedQuoteId } });
      await tx.rating.create({
        data: {
          projectId,
          direction: 'CUSTOMER_TO_PROVIDER',
          raterUserId: userId,
          handymanId: q.providerType === 'SOLO' ? q.handymanId : null,
          companyId: q.providerType === 'COMPANY' ? q.companyId : null,
          customerAccountId: p.customerAccountId,
          stars: body.stars,
          comment: body.comment?.trim() || null,
          createdAt: this.clock.now(),
        },
      });
      if (q.providerType === 'COMPANY' && q.companyId) {
        await tx.company.update({ where: { id: q.companyId }, data: { ratingSum: { increment: body.stars }, ratingCount: { increment: 1 } } });
      } else if (q.handymanId) {
        await tx.handymanProfile.update({ where: { id: q.handymanId }, data: { ratingSum: { increment: body.stars }, ratingCount: { increment: 1 } } });
      }
      return { number: p.number, quote: q };
    });
    await this.notifier.send(
      await this.actors.userIdsOf(out.quote),
      'GENERIC',
      (l) => ({
        title: this.i18n.t(l, 'server.projects.notify.ratedTitle'),
        body: this.i18n.t(l, 'server.projects.notify.ratedBody', { number: out.number, stars: body.stars }),
      }),
      { data: { projectId, kind: 'PROJECT_RATED' }, app: 'PRO' },
    );
    return { ok: true };
  }

  // ------------------------------------------------------- guarantee claim

  /**
   * Guarantee claim on a PAID project within guaranteeUntil (spec 4.6 / 4.10): opens a GUARANTEE Case (projectId set) that the admin
   * case endpoints handle. Otherwise GUARANTEE_NOT_AVAILABLE; a second claim while one is OPEN / IN_REVIEW gives CONFLICT.
   */
  async guaranteeClaim(userId: string, projectId: string, body: GuaranteeClaimInput): Promise<CaseView> {
    await this.owned(userId, projectId);
    const photoIds = [...new Set(body.photoFileIds ?? [])];
    await this.files.assertOwned(userId, photoIds, ['CASE_PHOTO', 'REQUEST_PHOTO']);
    const c = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      await lockProjectRow(tx, projectId);
      const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
      const now = this.clock.now();
      if (p.status !== 'PAID' || !p.guaranteeUntil || p.guaranteeUntil.getTime() < now.getTime()) {
        throw new ApiException('GUARANTEE_NOT_AVAILABLE', { status: p.status, guaranteeUntil: iso(p.guaranteeUntil) });
      }
      const open = await tx.case.findFirst({ where: { projectId, type: 'GUARANTEE', status: { in: ['OPEN', 'IN_REVIEW'] } }, select: { id: true } });
      if (open) throw new ApiException('CONFLICT', { reason: 'CASE_OPEN', caseId: open.id });
      return tx.case.create({
        data: {
          type: 'GUARANTEE',
          status: 'OPEN',
          projectId,
          assignmentId: null,
          openedByUserId: userId,
          description: body.description,
          photoFileIds: photoIds,
          createdAt: now,
          updatedAt: now,
        },
      });
    });
    this.realtime.toAdmins('admin:event', { type: 'CASE_OPENED', entityId: c.id });
    return this.views.caseView(c);
  }

  // ---------------------------------------------------------------- timers

  /** Quote window closed: no submitted quote -> EXPIRED; otherwise the customer still has AWARD_WINDOW_MS to choose one. */
  async onQuoteDeadline(projectId: string): Promise<void> {
    const status = await this.expireIfDue(projectId);
    if (status !== 'OPEN') return;
    const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { quoteDeadline: true } });
    if (!p) return;
    await this.jobs.schedule(
      PROJECT_JOB.awardExpiry,
      { projectId },
      { at: new Date(p.quoteDeadline.getTime() + AWARD_WINDOW_MS), jobId: projectJobId.awardExpiry(projectId) },
    );
  }

  /**
   * Idempotent expiry check of one project. Returns the status after the check (null for unknown projects).
   * OPEN + window closed + no SUBMITTED quote -> EXPIRED. OPEN + award window over -> EXPIRED, quotes EXPIRED, holds released.
   */
  async expireIfDue(projectId: string): Promise<string | null> {
    const out = await inTx(this.prisma, async (tx) => {
      const row = await tx.project.findUnique({ where: { id: projectId }, select: { id: true } });
      if (!row) return null;
      await lockProjectRow(tx, projectId);
      const p = await tx.project.findUniqueOrThrow({ where: { id: projectId }, include: { quotes: true } });
      if (p.status !== 'OPEN') return { status: p.status as string, expired: null };
      const now = this.clock.nowMs();
      const submitted = p.quotes.filter((q) => q.status === 'SUBMITTED');
      const deadline = p.quoteDeadline.getTime();
      let reason: 'NO_QUOTES' | 'NO_AWARD' | null = null;
      let released: ReleasedQuotes = { quotes: [], accounts: [] };
      if (now >= deadline && submitted.length === 0) reason = 'NO_QUOTES';
      else if (now >= deadline + AWARD_WINDOW_MS) {
        reason = 'NO_AWARD';
        released = await this.releaseQuotes(tx, submitted, 'EXPIRED');
      }
      if (!reason) return { status: 'OPEN', expired: null };
      await tx.project.update({ where: { id: projectId }, data: { status: 'EXPIRED' } });
      return { status: 'EXPIRED', expired: { reason, released, number: p.number, ownerUserId: p.createdByUserId } };
    });
    if (!out) return null;
    if (out.expired) {
      const e = out.expired;
      await this.cancelTimers(projectId);
      await this.walletEvents.notifyAccounts(e.released.accounts);
      await this.notifyRejected(e.number, projectId, e.released.quotes);
      await this.notifier.send(
        [e.ownerUserId],
        'GENERIC',
        (l) => ({
          title: this.i18n.t(l, 'server.projects.notify.expiredTitle', { number: e.number }),
          body: this.i18n.t(l, e.reason === 'NO_QUOTES' ? 'server.projects.notify.expiredNoQuotes' : 'server.projects.notify.expiredNoAward'),
        }),
        { data: { projectId, kind: 'PROJECT_EXPIRED' }, app: 'CUSTOMER' },
      );
    }
    return out.status;
  }

  /** Reconciler: expires overdue OPEN projects whose timers were missed (restart, lost job). */
  async repair(): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.project.findMany({
      where: { status: 'OPEN', quoteDeadline: { lte: now } },
      select: { id: true },
      orderBy: { quoteDeadline: 'asc' },
      take: 200,
    });
    let expired = 0;
    for (const p of due) {
      try {
        if ((await this.expireIfDue(p.id)) === 'EXPIRED') expired++;
      } catch (err) {
        this.log.warn(`project ${p.id} expiry failed: ${(err as Error).message}`);
      }
    }
    return expired;
  }
}
