import { Injectable } from '@nestjs/common';
import type {
  AddressView,
  CaseView,
  FileRef,
  InvoiceView,
  Locale,
  ProjectDetail,
  ProjectSummary,
  ProviderProjectView,
  QuoteView,
  ReportView,
} from '@tezfiks/shared';
import { PrismaService, type Db } from '../../infra/prisma.service';
import { I18nService } from '../../common/i18n/i18n.service';
import { SettingsService } from '../../common/settings/settings.service';
import { iso, num, ratingAvg } from '../../common/mapping';
import { FilesService } from '../files/files.service';
import { CategoriesService } from '../categories/categories.service';
import { nearestBakuDistrict } from '../geo/baku-districts';
import { addressViewOf, lastInitial } from '../requests/views/request-views.service';
import { fullName } from '../pro/provider-common';
import type { Case, Invoice, Prisma } from '../../generated/prisma/client';
import { isoDateOf } from './projects.constants';
import type { ProviderActor } from './provider-actor.service';

export const QUOTE_INCLUDE = {
  handyman: {
    select: {
      id: true,
      ratingSum: true,
      ratingCount: true,
      completedCount: true,
      user: { select: { firstName: true, lastName: true, photoFileId: true } },
    },
  },
  company: { select: { id: true, name: true, voen: true, ratingSum: true, ratingCount: true, completedCount: true, isVatPayer: true } },
} satisfies Prisma.QuoteInclude;

export const PROJECT_INCLUDE = {
  category: true,
  customerAccount: { include: { owner: { select: { firstName: true, lastName: true, phone: true } } } },
  quotes: { include: QUOTE_INCLUDE, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  reports: { orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] },
  invoice: true,
} satisfies Prisma.ProjectInclude;

export type FullProject = Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>;
export type FullQuote = Prisma.QuoteGetPayload<{ include: typeof QUOTE_INCLUDE }>;
type CustomerWithOwner = FullProject['customerAccount'];

/** Quotes that count for the customer (a withdrawn quote is gone from the comparison). */
export function visibleQuotes(p: { quotes: FullQuote[] }): FullQuote[] {
  return p.quotes.filter((q) => q.status !== 'WITHDRAWN');
}

/** Provider display name: the solo handyman's full name or the company name. */
export function providerNameOf(q: Pick<FullQuote, 'providerType' | 'handyman' | 'company'>): string {
  if (q.providerType === 'COMPANY') return q.company?.name ?? '';
  return fullName(q.handyman?.user.firstName, q.handyman?.user.lastName);
}

/** Name the provider side sees: company name, or first name + last-name initial (spec 4.4). */
export function customerPublicName(acc: CustomerWithOwner): string {
  if (acc.type === 'COMPANY' && acc.companyName) return acc.companyName;
  return [acc.owner.firstName?.trim() ?? '', lastInitial(acc.owner.lastName)].filter(Boolean).join(' ');
}

/** Legal / admin name of the customer: company name, or the full name. */
export function customerFullName(acc: CustomerWithOwner): string {
  if (acc.type === 'COMPANY' && acc.companyName) return acc.companyName;
  return fullName(acc.owner.firstName, acc.owner.lastName);
}

/** Read models of the B2B flow (contract: domains/projects.ts, admin project/invoice rows). */
@Injectable()
export class ProjectViews {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly categories: CategoriesService,
    private readonly settings: SettingsService,
    private readonly i18n: I18nService,
  ) {}

  async load(projectId: string, db: Db = this.prisma): Promise<FullProject | null> {
    return db.project.findUnique({ where: { id: projectId }, include: PROJECT_INCLUDE });
  }

  async loadMany(where: Prisma.ProjectWhereInput, opts: { take?: number; orderBy?: Prisma.ProjectOrderByWithRelationInput[] } = {}): Promise<FullProject[]> {
    return this.prisma.project.findMany({
      where,
      include: PROJECT_INCLUDE,
      orderBy: opts.orderBy ?? [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(opts.take ? { take: opts.take } : {}),
    });
  }

  // ------------------------------------------------------------------ pieces

  private async photoMap(projects: FullProject[], extraIds: string[] = []): Promise<Map<string, FileRef>> {
    const ids = new Set<string>(extraIds);
    for (const p of projects) {
      for (const id of p.photoFileIds) ids.add(id);
      for (const r of p.reports) for (const id of r.photoFileIds) ids.add(id);
      for (const q of p.quotes) if (q.handyman?.user.photoFileId) ids.add(q.handyman.user.photoFileId);
    }
    const refs = await this.files.refs([...ids]);
    return new Map(refs.map((f) => [f.id, f]));
  }

  private photos(ids: string[], map: Map<string, FileRef>): FileRef[] {
    return ids.map((id) => map.get(id)).filter((f): f is FileRef => !!f);
  }

  private async authorNames(projects: FullProject[]): Promise<Map<string, string>> {
    const ids = [...new Set(projects.flatMap((p) => p.reports.map((r) => r.authorUserId)))];
    if (!ids.length) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } });
    return new Map(users.map((u) => [u.id, fullName(u.firstName, u.lastName)]));
  }

  summary(p: FullProject, locale: Locale, addressText?: string): ProjectSummary {
    return {
      id: p.id,
      number: p.number,
      status: p.status,
      category: this.categories.ref(p.category, locale),
      title: p.title ?? null,
      scope: p.scope,
      dateFrom: isoDateOf(p.dateFrom),
      dateTo: isoDateOf(p.dateTo),
      workersNeeded: p.workersNeeded,
      quoteDeadline: iso(p.quoteDeadline),
      quotesCount: visibleQuotes(p).length,
      createdAt: iso(p.createdAt),
      addressText: addressText ?? p.formatted,
    };
  }

  quoteView(q: FullQuote, photos: Map<string, FileRef>): QuoteView {
    const isCompany = q.providerType === 'COMPANY';
    const photoId = isCompany ? null : (q.handyman?.user.photoFileId ?? null);
    return {
      id: q.id,
      projectId: q.projectId,
      status: q.status,
      provider: {
        type: q.providerType,
        handymanId: q.handymanId ?? null,
        companyId: q.companyId ?? null,
        name: providerNameOf(q),
        photo: photoId ? (photos.get(photoId) ?? null) : null,
        ratingAvg: isCompany ? ratingAvg(q.company?.ratingSum ?? 0, q.company?.ratingCount ?? 0) : ratingAvg(q.handyman?.ratingSum ?? 0, q.handyman?.ratingCount ?? 0),
        ratingCount: (isCompany ? q.company?.ratingCount : q.handyman?.ratingCount) ?? 0,
        completedCount: (isCompany ? q.company?.completedCount : q.handyman?.completedCount) ?? 0,
        isVatPayer: isCompany ? (q.company?.isVatPayer ?? false) : false,
      },
      totalAmount: num(q.totalAmount),
      workers: q.workers,
      days: q.days,
      note: q.note ?? null,
      createdAt: iso(q.createdAt),
    };
  }

  /**
   * The provider's own quote with its platform fee. feeHeld is the fee reserved (SUBMITTED) or taken (ACCEPTED, then feeCaptured);
   * it is 0 once the hold was released (REJECTED, WITHDRAWN, EXPIRED).
   */
  providerQuoteView(q: FullQuote, photos: Map<string, FileRef>): QuoteView & { feeHeld: number; feeCaptured: boolean } {
    const released = q.status === 'REJECTED' || q.status === 'WITHDRAWN' || q.status === 'EXPIRED';
    return { ...this.quoteView(q, photos), feeHeld: released ? 0 : num(q.feeAmount), feeCaptured: q.feeCaptured };
  }

  reportView(r: FullProject['reports'][number], authors: Map<string, string>, photos: Map<string, FileRef>): ReportView {
    return {
      id: r.id,
      reportDate: isoDateOf(r.reportDate),
      note: r.note,
      progressPercent: r.progressPercent,
      photos: this.photos(r.photoFileIds, photos),
      authorName: authors.get(r.authorUserId) ?? '',
      createdAt: iso(r.createdAt),
    };
  }

  invoiceView(inv: Invoice, projectNumber: number): InvoiceView {
    const issuer = (inv.issuerSnapshot ?? {}) as { name?: string; voen?: string | null; isVatPayer?: boolean };
    const customer = (inv.customerSnapshot ?? {}) as { name?: string; voen?: string | null };
    const lines = (Array.isArray(inv.lines) ? inv.lines : []) as Array<{ description: string; amount: number }>;
    return {
      id: inv.id,
      number: inv.number,
      projectId: inv.projectId,
      projectNumber,
      issuer: { type: inv.issuerType, name: issuer.name ?? '', voen: issuer.voen ?? null, isVatPayer: issuer.isVatPayer ?? false },
      customer: { name: customer.name ?? '', voen: customer.voen ?? null },
      subtotal: num(inv.subtotal),
      vatRatePercent: inv.vatRatePercent,
      vatAmount: num(inv.vatAmount),
      total: num(inv.total),
      currency: inv.currency,
      status: inv.status,
      issuedAt: iso(inv.issuedAt),
      paidAt: iso(inv.paidAt),
      lines: lines.map((l) => ({ description: String(l.description), amount: Number(l.amount) })),
    };
  }

  async invoiceViews(rows: Invoice[]): Promise<InvoiceView[]> {
    if (!rows.length) return [];
    const projects = await this.prisma.project.findMany({ where: { id: { in: rows.map((r) => r.projectId) } }, select: { id: true, number: true } });
    const numbers = new Map(projects.map((p) => [p.id, p.number]));
    return rows.map((r) => this.invoiceView(r, numbers.get(r.projectId) ?? 0));
  }

  async caseView(c: Case): Promise<CaseView> {
    const project = c.projectId ? await this.prisma.project.findUnique({ where: { id: c.projectId }, select: { number: true } }) : null;
    return {
      id: c.id,
      type: c.type,
      status: c.status,
      assignmentId: c.assignmentId ?? null,
      projectId: c.projectId ?? null,
      requestNumber: null,
      projectNumber: project?.number ?? null,
      description: c.description,
      photos: await this.files.refs(c.photoFileIds),
      resolutionNote: c.resolutionNote ?? null,
      followUpRequestId: c.followUpRequestId ?? null,
      createdAt: iso(c.createdAt),
      updatedAt: iso(c.updatedAt),
    };
  }

  /** Area-level address (street + building, district; coordinates rounded to ~100 m) for providers that were not awarded. */
  limitedAddress(p: FullProject, locale: Locale): AddressView {
    const district = p.district ?? nearestBakuDistrict({ lat: p.lat, lng: p.lng })?.names[locale] ?? null;
    const street = [p.street, p.building].filter((v) => !!v && v.trim()).join(' ').trim();
    const area = [street || null, district].filter(Boolean).join(', ') || this.i18n.t(locale, 'server.projects.areaFallback');
    const round = (v: number) => Math.round(v * 1000) / 1000;
    return {
      lat: round(p.lat),
      lng: round(p.lng),
      formatted: area,
      placeId: null,
      district,
      street: p.street ?? null,
      building: p.building ?? null,
      block: null,
      entrance: null,
      floor: null,
      apartment: null,
      intercom: null,
      note: null,
    };
  }

  // ------------------------------------------------------------- customer

  async customerSummaries(projects: FullProject[], locale: Locale): Promise<ProjectSummary[]> {
    return projects.map((p) => this.summary(p, locale));
  }

  async customerDetail(p: FullProject, locale: Locale): Promise<ProjectDetail> {
    const [photos, authors, rating] = await Promise.all([
      this.photoMap([p]),
      this.authorNames([p]),
      this.prisma.rating.findUnique({ where: { projectId_direction: { projectId: p.id, direction: 'CUSTOMER_TO_PROVIDER' } }, select: { id: true } }),
    ]);
    const awarded = p.awardedQuoteId ? p.quotes.find((q) => q.id === p.awardedQuoteId) : undefined;
    return {
      ...this.summary(p, locale),
      description: p.description,
      photos: this.photos(p.photoFileIds, photos),
      address: addressViewOf(p),
      quotes: visibleQuotes(p).map((q) => this.quoteView(q, photos)),
      awardedQuote: awarded ? this.quoteView(awarded, photos) : null,
      reports: p.reports.map((r) => this.reportView(r, authors, photos)),
      invoice: p.invoice ? this.invoiceView(p.invoice, p.number) : null,
      guaranteeUntil: iso(p.guaranteeUntil),
      rated: !!rating,
      canCancel: p.status === 'OPEN',
    };
  }

  // ------------------------------------------------------------- provider

  async providerViews(projects: FullProject[], actor: ProviderActor, locale: Locale): Promise<ProviderProjectView[]> {
    if (!projects.length) return [];
    const s = await this.settings.get();
    const [photos, authors] = await Promise.all([this.photoMap(projects), this.authorNames(projects)]);
    return projects.map((p) => {
      const mine = p.quotes.find((q) => (actor.type === 'COMPANY' ? q.companyId === actor.companyId : q.handymanId === actor.handymanId));
      const awardedToMe = !!mine && p.awardedQuoteId === mine.id;
      const acc = p.customerAccount;
      return {
        ...this.summary(p, locale, awardedToMe ? p.formatted : this.limitedAddress(p, locale).formatted),
        description: p.description,
        photos: this.photos(p.photoFileIds, photos),
        address: awardedToMe ? addressViewOf(p) : this.limitedAddress(p, locale),
        customer: { name: customerPublicName(acc), type: acc.type, ratingAvg: ratingAvg(acc.ratingSum, acc.ratingCount) },
        myQuote: mine ? this.providerQuoteView(mine, photos) : null,
        isAwardedToMe: awardedToMe,
        reports: awardedToMe ? p.reports.map((r) => this.reportView(r, authors, photos)) : [],
        invoice: awardedToMe && p.invoice ? this.invoiceView(p.invoice, p.number) : null,
        feePerWorkerDay: s.b2bFeePerWorkerDay,
      };
    });
  }

  // ---------------------------------------------------------------- admin

  adminRow(p: FullProject, locale: Locale) {
    return {
      id: p.id,
      number: p.number,
      status: p.status,
      customerName: customerFullName(p.customerAccount),
      categoryName: this.categories.name(p.category, locale),
      quotesCount: visibleQuotes(p).length,
      workersNeeded: p.workersNeeded,
      dateFrom: isoDateOf(p.dateFrom),
      dateTo: isoDateOf(p.dateTo),
      createdAt: iso(p.createdAt),
    };
  }

  async adminDetail(p: FullProject, locale: Locale) {
    const photos = await this.photoMap([p]);
    return {
      project: await this.customerDetail(p, locale),
      customer: {
        accountId: p.customerAccountId,
        name: customerFullName(p.customerAccount),
        phone: p.customerAccount.owner.phone,
        voen: p.customerAccount.voen ?? null,
      },
      quotes: p.quotes.map((q) => this.providerQuoteView(q, photos)),
    };
  }
}
