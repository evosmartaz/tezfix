import { Injectable } from '@nestjs/common';
import {
  DEFAULT_LOCALE,
  b2bQuoteFee,
  bakuDayKey,
  formatMoney,
  vatBreakdown,
  type CompleteProjectBodySchema,
  type InvoiceView,
  type Locale,
  type ProviderProjectView,
  type ReportBodySchema,
  type ReportView,
  type SubmitQuoteBodySchema,
} from '@tezfiks/shared';
import type { z } from 'zod';
import { PrismaService, inTx } from '../../infra/prisma.service';
import { Clock } from '../../infra/clock';
import { RealtimeService } from '../../infra/realtime.service';
import { newId } from '../../infra/ids';
import { SettingsService } from '../../common/settings/settings.service';
import { I18nService } from '../../common/i18n/i18n.service';
import { ApiException } from '../../common/http/api-exception';
import { num } from '../../common/mapping';
import { LedgerService } from '../ledger/ledger.service';
import { WalletEventsService } from '../wallet/wallet-events.service';
import { CategoriesService } from '../categories/categories.service';
import { FilesService } from '../files/files.service';
import { lockActiveUser } from '../customer/customer.service';
import { fullName } from '../pro/provider-common';
import { ProjectViews, QUOTE_INCLUDE, customerFullName, providerNameOf, type FullProject } from './project-views.service';
import { ProjectNotifier } from './project-notifier';
import { ProviderActorService, type ProviderActor } from './provider-actor.service';
import { lockLedgerAccounts, lockProjectRow } from './project-locks';
import { EXECUTION_STATUSES, dateOnly, invoiceNumber } from './projects.constants';

export type SubmitQuoteInput = z.output<typeof SubmitQuoteBodySchema>;
export type ReportInput = z.output<typeof ReportBodySchema>;
export type CompleteProjectInput = z.output<typeof CompleteProjectBodySchema>;
type ProviderQuoteView = ProviderProjectView['myQuote'] & object;

/** Awarded-project statuses that still count as "active" work for the provider. */
const AWARDED_ACTIVE = new Set(['AWARDED', 'IN_PROGRESS', 'COMPLETED', 'INVOICED']);

/**
 * Provider side of B2B projects (spec 4.10): open projects matching the provider's trades and service area, quotes (fee hold
 * b2bFeePerWorkerDay x workers x days on the provider WALLET), withdraw, daily reports, completion with the invoice (hesab-faktura).
 * Solo handymen act for themselves; company managers pass companyId and act for the company (its wallet pays the fee).
 */
@Injectable()
export class ProviderProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    private readonly i18n: I18nService,
    private readonly ledger: LedgerService,
    private readonly walletEvents: WalletEventsService,
    private readonly categories: CategoriesService,
    private readonly files: FilesService,
    private readonly views: ProjectViews,
    private readonly notifier: ProjectNotifier,
    private readonly actors: ProviderActorService,
  ) {}

  // ------------------------------------------------------------------ reads

  /** OPEN projects whose quote window is still open, in the provider's trades and service area (approved providers only). */
  async open(userId: string, companyId: string | undefined, locale: Locale): Promise<{ items: ProviderProjectView[] }> {
    const actor = await this.actors.resolve(userId, companyId);
    await this.actors.requireApproved(actor);
    const cov = await this.actors.coverage(actor);
    if (!cov.tradeIds.length || !cov.cells.length) return { items: [] };
    const projects = await this.views.loadMany(
      {
        status: 'OPEN',
        quoteDeadline: { gt: this.clock.now() },
        categoryId: { in: cov.tradeIds },
        cell7: { in: cov.cells },
        createdByUserId: { not: userId },
      },
      { take: 100, orderBy: [{ quoteDeadline: 'asc' }, { id: 'asc' }] },
    );
    return { items: await this.views.providerViews(projects, actor, locale) };
  }

  /**
   * Projects the provider quoted on. active = a SUBMITTED quote on an OPEN project, or the awarded project until it is paid;
   * history = everything else (paid, rejected / withdrawn / expired quotes, cancelled projects).
   */
  async mine(userId: string, q: { companyId?: string; scope?: 'active' | 'history' }, locale: Locale): Promise<{ items: ProviderProjectView[] }> {
    const actor = await this.actors.resolve(userId, q.companyId);
    const quotes = await this.prisma.quote.findMany({ where: this.actors.quoteWhere(actor), select: { id: true, projectId: true } });
    if (!quotes.length) return { items: [] };
    const projects = await this.views.loadMany({ id: { in: quotes.map((x) => x.projectId) } });
    const filtered = projects.filter((p) => {
      if (!q.scope) return true;
      const mine = p.quotes.find((x) => this.actors.owns(actor, x))!;
      const active = (mine.status === 'SUBMITTED' && p.status === 'OPEN') || (p.awardedQuoteId === mine.id && AWARDED_ACTIVE.has(p.status));
      return q.scope === 'active' ? active : !active;
    });
    return { items: await this.views.providerViews(filtered, actor, locale) };
  }

  /** One project: visible when the provider quoted on it, or when it is OPEN and the (approved) provider is eligible. */
  async get(userId: string, projectId: string, companyId: string | undefined, locale: Locale): Promise<ProviderProjectView> {
    const actor = await this.actors.resolve(userId, companyId);
    const p = await this.views.load(projectId);
    if (!p) throw new ApiException('NOT_FOUND', { entity: 'project', id: projectId });
    const quoted = p.quotes.some((x) => this.actors.owns(actor, x));
    if (!quoted && (p.status !== 'OPEN' || !actor.approved || !(await this.actors.isEligible(actor, p)))) {
      throw new ApiException('NOT_FOUND', { entity: 'project', id: projectId });
    }
    return (await this.views.providerViews([p], actor, locale))[0]!;
  }

  private async quoteView(quoteId: string): Promise<ProviderQuoteView> {
    const q = await this.prisma.quote.findUniqueOrThrow({ where: { id: quoteId }, include: QUOTE_INCLUDE });
    const photoId = q.handyman?.user.photoFileId;
    const photos = new Map((photoId ? await this.files.refs([photoId]) : []).map((f) => [f.id, f]));
    return this.views.providerQuoteView(q, photos);
  }

  // ----------------------------------------------------------------- quotes

  /**
   * Submits the provider's single quote while the window is open: holds b2bQuoteFee(workers, days) on the provider WALLET
   * (INSUFFICIENT_BALANCE), one quote per provider and project (CONFLICT), QUOTE_WINDOW_CLOSED when the project no longer
   * takes quotes, NOT_ELIGIBLE outside the provider's trades / service area. Notifies the customer QUOTE_RECEIVED.
   */
  async submitQuote(userId: string, projectId: string, body: SubmitQuoteInput): Promise<ProviderQuoteView> {
    const actor = await this.actors.resolve(userId, body.companyId);
    await this.actors.requireApproved(actor);
    const pre = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!pre) throw new ApiException('NOT_FOUND', { entity: 'project', id: projectId });
    if (!(await this.actors.isEligible(actor, pre))) throw new ApiException('NOT_ELIGIBLE', { reason: 'TRADE_OR_AREA' });
    const s = await this.settings.get();
    const fee = b2bQuoteFee(body.workers, body.days, s);
    const created = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      await lockProjectRow(tx, projectId);
      const p = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
      const now = this.clock.now();
      if (p.status !== 'OPEN' || now.getTime() >= p.quoteDeadline.getTime()) {
        throw new ApiException('QUOTE_WINDOW_CLOSED', { status: p.status, quoteDeadline: p.quoteDeadline.toISOString() });
      }
      await this.actors.requireApproved(actor, tx);
      const existing = await tx.quote.findFirst({ where: { projectId, ...this.actors.quoteWhere(actor) }, select: { id: true } });
      if (existing) throw new ApiException('CONFLICT', { reason: 'ALREADY_QUOTED', quoteId: existing.id });
      const id = newId();
      const hold =
        fee > 0 ? await this.ledger.hold({ accountId: actor.walletAccountId, amount: fee, kind: 'B2B_QUOTE_FEE', quoteId: id }, tx) : null;
      await tx.quote.create({
        data: {
          id,
          projectId,
          providerType: actor.type,
          handymanId: actor.handymanId,
          companyId: actor.companyId,
          submittedByUserId: userId,
          totalAmount: BigInt(body.totalAmount),
          workers: body.workers,
          days: body.days,
          note: body.note?.trim() || null,
          status: 'SUBMITTED',
          holdId: hold?.id ?? null,
          feeAmount: BigInt(fee),
          createdAt: now,
        },
      });
      return { id, project: p };
    });
    await this.walletEvents.notifyAccount(actor.walletAccountId);
    const view = await this.quoteView(created.id);
    await this.notifier.send(
      [created.project.createdByUserId],
      'QUOTE_RECEIVED',
      (l) => ({ company: view.provider.name, number: created.project.number, amount: formatMoney(body.totalAmount, l) }),
      { data: { projectId, quoteId: created.id }, app: 'CUSTOMER' },
    );
    return view;
  }

  /** Withdraws the provider's SUBMITTED quote of an OPEN project and releases its fee hold. */
  async withdrawQuote(userId: string, quoteId: string): Promise<ProviderQuoteView> {
    const pre = await this.prisma.quote.findUnique({ where: { id: quoteId } });
    if (!pre) throw new ApiException('NOT_FOUND', { entity: 'quote', id: quoteId });
    let actor: ProviderActor;
    try {
      actor = await this.actors.resolve(userId, pre.providerType === 'COMPANY' ? pre.companyId : null);
    } catch {
      throw new ApiException('NOT_FOUND', { entity: 'quote', id: quoteId });
    }
    if (!this.actors.owns(actor, pre)) throw new ApiException('NOT_FOUND', { entity: 'quote', id: quoteId });
    const accounts = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      const p = await lockProjectRow(tx, pre.projectId);
      const q = await tx.quote.findUniqueOrThrow({ where: { id: quoteId } });
      if (q.status !== 'SUBMITTED' || p.status !== 'OPEN') throw new ApiException('INVALID_STATE', { quoteStatus: q.status, projectStatus: p.status });
      const hold = q.holdId ? await tx.hold.findUnique({ where: { id: q.holdId }, select: { id: true, accountId: true } }) : null;
      await lockLedgerAccounts(tx, [hold?.accountId]);
      if (hold) await this.ledger.releaseHold(hold.id, tx);
      await tx.quote.update({ where: { id: quoteId }, data: { status: 'WITHDRAWN' } });
      return hold ? [hold.accountId] : [];
    });
    await this.walletEvents.notifyAccounts(accounts);
    return this.quoteView(quoteId);
  }

  // ---------------------------------------------------------------- awarded

  /** The awarded quote when it belongs to the actor, else FORBIDDEN (the project is someone else's work). */
  private awardedTo(actor: ProviderActor, p: { awardedQuoteId: string | null; quotes: FullProject['quotes'] }): FullProject['quotes'][number] {
    const q = p.awardedQuoteId ? p.quotes.find((x) => x.id === p.awardedQuoteId) : undefined;
    if (!q || !this.actors.owns(actor, q)) throw new ApiException('FORBIDDEN', { reason: 'NOT_AWARDED' });
    return q;
  }

  /** Daily status report by the awarded provider; the first one moves the project to IN_PROGRESS. Notifies PROJECT_REPORT. */
  async addReport(userId: string, projectId: string, body: ReportInput): Promise<ReportView> {
    const actor = await this.actors.resolve(userId, body.companyId);
    const photoIds = [...new Set(body.photoFileIds ?? [])];
    const s = await this.settings.get();
    if (photoIds.length > s.maxPhotos) throw new ApiException('VALIDATION_FAILED', { field: 'photoFileIds', max: s.maxPhotos });
    await this.files.assertOwned(userId, photoIds, ['REPORT_PHOTO']);
    const today = bakuDayKey(this.clock.now());
    const reportDate = body.reportDate ?? today;
    if (reportDate > today) throw new ApiException('VALIDATION_FAILED', { field: 'reportDate', reason: 'in_future', latest: today });
    const out = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      await lockProjectRow(tx, projectId);
      const p = await tx.project.findUniqueOrThrow({ where: { id: projectId }, include: { quotes: { include: QUOTE_INCLUDE } } });
      const q = this.awardedTo(actor, p);
      if (!EXECUTION_STATUSES.includes(p.status)) throw new ApiException('INVALID_STATE', { status: p.status });
      const now = this.clock.now();
      const report = await tx.projectReport.create({
        data: {
          projectId,
          authorUserId: userId,
          reportDate: dateOnly(reportDate),
          note: body.note,
          progressPercent: body.progressPercent,
          photoFileIds: photoIds,
          createdAt: now,
        },
      });
      if (p.status === 'AWARDED') await tx.project.update({ where: { id: projectId }, data: { status: 'IN_PROGRESS' } });
      return { report, project: p, providerName: providerNameOf(q) };
    });
    await this.notifier.send(
      [out.project.createdByUserId],
      'PROJECT_REPORT',
      () => ({ company: out.providerName, number: out.project.number }),
      { data: { projectId, reportId: out.report.id }, app: 'CUSTOMER' },
    );
    const author = await this.prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } });
    const photos = new Map((await this.files.refs(photoIds)).map((f) => [f.id, f]));
    return this.views.reportView(out.report, new Map([[userId, fullName(author?.firstName, author?.lastName)]]), photos);
  }

  /**
   * The awarded provider marks the work complete: the invoice TF-<yyyy>-<6-digit seq> is issued with the given lines (default:
   * one line with the quote total), VAT per vatBreakdown(subtotal, vatRatePercent, issuer.isVatPayer) and issuer / customer
   * snapshots (name, VÖEN). The project goes COMPLETED -> INVOICED in the same transaction. Notifies INVOICE_ISSUED.
   */
  async complete(userId: string, projectId: string, body: CompleteProjectInput): Promise<InvoiceView> {
    const actor = await this.actors.resolve(userId, body.companyId);
    const s = await this.settings.get();
    const out = await inTx(this.prisma, async (tx) => {
      await lockActiveUser(tx, userId);
      await lockProjectRow(tx, projectId);
      const p = await tx.project.findUniqueOrThrow({
        where: { id: projectId },
        include: { quotes: { include: QUOTE_INCLUDE }, category: true, customerAccount: { include: { owner: { select: { firstName: true, lastName: true, phone: true } } } } },
      });
      const q = this.awardedTo(actor, p);
      if (!EXECUTION_STATUSES.includes(p.status)) throw new ApiException('INVALID_STATE', { status: p.status });
      const now = this.clock.now();
      const lines =
        body.lines?.map((l) => ({ description: l.description, amount: l.amount })) ??
        [
          {
            description: this.i18n.t(DEFAULT_LOCALE, 'server.projects.invoice.defaultLine', {
              number: p.number,
              category: this.categories.name(p.category, DEFAULT_LOCALE),
            }),
            amount: num(q.totalAmount),
          },
        ];
      const subtotal = lines.reduce((sum, l) => sum + l.amount, 0);
      if (subtotal <= 0) throw new ApiException('VALIDATION_FAILED', { field: 'lines', reason: 'empty_total' });
      const issuer =
        q.providerType === 'COMPANY'
          ? { type: 'COMPANY' as const, name: q.company?.name ?? '', voen: q.company?.voen ?? null, isVatPayer: q.company?.isVatPayer ?? false }
          : { type: 'SOLO' as const, name: providerNameOf(q), voen: null, isVatPayer: false };
      const customer = { name: customerFullName(p.customerAccount), voen: p.customerAccount.voen ?? null };
      const vat = vatBreakdown(subtotal, s.vatRatePercent, issuer.isVatPayer);
      const seq = await tx.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT nextval('invoice_number_seq') AS n`);
      const number = invoiceNumber(Number(bakuDayKey(now).slice(0, 4)), seq[0]!.n);
      const invoice = await tx.invoice.create({
        data: {
          number,
          projectId,
          issuerType: issuer.type,
          handymanId: q.providerType === 'SOLO' ? q.handymanId : null,
          companyId: q.providerType === 'COMPANY' ? q.companyId : null,
          customerAccountId: p.customerAccountId,
          subtotal: BigInt(vat.subtotal),
          vatRatePercent: vat.vatRatePercent,
          vatAmount: BigInt(vat.vatAmount),
          total: BigInt(vat.total),
          status: 'ISSUED',
          issuedAt: now,
          lines,
          issuerSnapshot: issuer,
          customerSnapshot: customer,
          createdAt: now,
        },
      });
      await tx.project.update({ where: { id: projectId }, data: { status: 'INVOICED', completedAt: now } });
      if (q.providerType === 'COMPANY' && q.companyId) await tx.company.update({ where: { id: q.companyId }, data: { completedCount: { increment: 1 } } });
      else if (q.handymanId) await tx.handymanProfile.update({ where: { id: q.handymanId }, data: { completedCount: { increment: 1 } } });
      return { invoice, project: p };
    });
    const view = this.views.invoiceView(out.invoice, out.project.number);
    await this.notifier.send(
      [out.project.createdByUserId],
      'INVOICE_ISSUED',
      (l) => ({ number: view.number, amount: formatMoney(view.total, l) }),
      { data: { projectId, invoiceId: view.id }, app: 'CUSTOMER' },
    );
    this.realtime.toAdmins('admin:event', { type: 'INVOICE_ISSUED', entityId: view.id });
    return view;
  }
}
