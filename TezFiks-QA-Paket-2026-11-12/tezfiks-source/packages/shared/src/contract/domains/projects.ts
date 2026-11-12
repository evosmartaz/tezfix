import { z } from 'zod';
import { endpoint } from '../define';
import {
  AddressInputSchema,
  AddressViewSchema,
  CategoryRefSchema,
  FileRefSchema,
  Id,
  IdParams,
  IsoDate,
  IsoDateTime,
  Money,
  Ok,
  PageQuery,
  paginated,
} from '../common';
import { CustomerType, InvoiceStatus, ProjectStatus, QuoteStatus, ProviderType } from '../../enums';
import { CaseViewSchema, GuaranteeClaimBodySchema } from './cases';
import { RatingBodySchema } from './assignments';

export const ProjectSummarySchema = z.object({
  id: Id,
  number: z.int(),
  status: ProjectStatus.schema,
  category: CategoryRefSchema,
  title: z.string().nullable(),
  /** e.g. "≈ 450 m² (3 mərtəbə, 12 otaq)" */
  scope: z.string(),
  dateFrom: IsoDate,
  dateTo: IsoDate,
  workersNeeded: z.int(),
  quoteDeadline: IsoDateTime,
  quotesCount: z.int(),
  createdAt: IsoDateTime,
  addressText: z.string(),
});
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;

export const QuoteProviderSchema = z.object({
  type: ProviderType.schema,
  handymanId: Id.nullable(),
  companyId: Id.nullable(),
  name: z.string(),
  photo: FileRefSchema.nullable(),
  ratingAvg: z.number().nullable(),
  ratingCount: z.int(),
  completedCount: z.int(),
  isVatPayer: z.boolean(),
});

export const QuoteViewSchema = z.object({
  id: Id,
  projectId: Id,
  status: QuoteStatus.schema,
  provider: QuoteProviderSchema,
  totalAmount: Money,
  workers: z.int(),
  days: z.int(),
  note: z.string().nullable(),
  createdAt: IsoDateTime,
});
export type QuoteView = z.infer<typeof QuoteViewSchema>;

/** Provider's own quote incl. the platform fee held for it. */
export const ProviderQuoteViewSchema = QuoteViewSchema.extend({ feeHeld: Money, feeCaptured: z.boolean() });

export const ReportViewSchema = z.object({
  id: Id,
  reportDate: IsoDate,
  note: z.string(),
  progressPercent: z.int(),
  photos: z.array(FileRefSchema),
  authorName: z.string(),
  createdAt: IsoDateTime,
});
export type ReportView = z.infer<typeof ReportViewSchema>;

export const InvoiceViewSchema = z.object({
  id: Id,
  number: z.string(),
  projectId: Id,
  projectNumber: z.int(),
  issuer: z.object({ type: ProviderType.schema, name: z.string(), voen: z.string().nullable(), isVatPayer: z.boolean() }),
  customer: z.object({ name: z.string(), voen: z.string().nullable() }),
  subtotal: Money,
  vatRatePercent: z.number(),
  vatAmount: Money,
  total: Money,
  currency: z.string(),
  status: InvoiceStatus.schema,
  issuedAt: IsoDateTime,
  paidAt: IsoDateTime.nullable(),
  lines: z.array(z.object({ description: z.string(), amount: Money })),
});
export type InvoiceView = z.infer<typeof InvoiceViewSchema>;

export const ProjectDetailSchema = ProjectSummarySchema.extend({
  description: z.string(),
  photos: z.array(FileRefSchema),
  address: AddressViewSchema,
  quotes: z.array(QuoteViewSchema),
  awardedQuote: QuoteViewSchema.nullable(),
  reports: z.array(ReportViewSchema),
  invoice: InvoiceViewSchema.nullable(),
  guaranteeUntil: IsoDateTime.nullable(),
  rated: z.boolean(),
  canCancel: z.boolean(),
});
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>;

export const ProviderProjectViewSchema = ProjectSummarySchema.extend({
  description: z.string(),
  photos: z.array(FileRefSchema),
  address: AddressViewSchema,
  customer: z.object({ name: z.string(), type: CustomerType.schema, ratingAvg: z.number().nullable() }),
  myQuote: ProviderQuoteViewSchema.nullable(),
  isAwardedToMe: z.boolean(),
  reports: z.array(ReportViewSchema),
  invoice: InvoiceViewSchema.nullable(),
  /** Platform fee that a quote with these numbers would hold (b2bFeePerWorkerDay x workers x days). */
  feePerWorkerDay: Money,
});
export type ProviderProjectView = z.infer<typeof ProviderProjectViewSchema>;

export const CreateProjectBodySchema = z
  .object({
    categoryId: Id,
    title: z.string().trim().max(120).optional(),
    scope: z.string().trim().min(2).max(300),
    dateFrom: IsoDate,
    dateTo: IsoDate,
    workersNeeded: z.int().min(1).max(100),
    description: z.string().trim().min(3).max(3000),
    photoFileIds: z.array(Id).max(5).default([]),
    address: AddressInputSchema,
  })
  .refine((v) => v.dateTo >= v.dateFrom, { message: 'dateTo must not be before dateFrom', path: ['dateTo'] });

export const ActingAsQuery = z.object({ companyId: Id.optional() });

export const SubmitQuoteBodySchema = z.object({
  companyId: Id.optional(),
  totalAmount: z.int().min(100).max(1_000_000_00),
  workers: z.int().min(1).max(100),
  days: z.int().min(1).max(365),
  note: z.string().trim().max(1000).optional(),
});

export const ReportBodySchema = z.object({
  companyId: Id.optional(),
  note: z.string().trim().min(1).max(2000),
  progressPercent: z.int().min(0).max(100),
  photoFileIds: z.array(Id).max(5).default([]),
  reportDate: IsoDate.optional(),
});

export const CompleteProjectBodySchema = z.object({
  companyId: Id.optional(),
  /** Defaults to one line with the awarded quote total. */
  lines: z
    .array(z.object({ description: z.string().trim().min(1).max(200), amount: z.int().min(0) }))
    .min(1)
    .max(30)
    .optional(),
});

export const projectsEndpoints = {
  create: endpoint({
    method: 'POST',
    path: '/projects',
    auth: 'user',
    body: CreateProjectBodySchema,
    response: ProjectDetailSchema,
    idempotent: true,
    summary: '"Biznes sifarişi" / "Qiymət təklifi al": providers can quote for quoteWindowHours',
  }),
  list: endpoint({
    method: 'GET',
    path: '/projects',
    auth: 'user',
    query: PageQuery.extend({ scope: z.enum(['active', 'history']).optional() }),
    response: paginated(ProjectSummarySchema),
  }),
  get: endpoint({ method: 'GET', path: '/projects/:id', auth: 'user', params: IdParams, response: ProjectDetailSchema }),
  acceptQuote: endpoint({
    method: 'POST',
    path: '/projects/:id/quotes/:quoteId/accept',
    auth: 'user',
    params: z.object({ id: Id, quoteId: Id }),
    response: ProjectDetailSchema,
    idempotent: true,
  }),
  cancel: endpoint({
    method: 'POST',
    path: '/projects/:id/cancel',
    auth: 'user',
    params: IdParams,
    response: ProjectDetailSchema,
    summary: 'Only before a quote is accepted; all quote fee holds are released',
  }),
  rate: endpoint({
    method: 'POST',
    path: '/projects/:id/rating',
    auth: 'user',
    params: IdParams,
    body: RatingBodySchema,
    response: Ok,
  }),
  guaranteeClaim: endpoint({
    method: 'POST',
    path: '/projects/:id/guarantee-claim',
    auth: 'user',
    params: IdParams,
    body: GuaranteeClaimBodySchema,
    response: CaseViewSchema,
  }),
};

/** Provider side of B2B projects (solo handymen, or company managers with companyId). */
export const providerProjectsEndpoints = {
  open: endpoint({
    method: 'GET',
    path: '/provider/projects/open',
    auth: 'user',
    query: ActingAsQuery,
    response: z.object({ items: z.array(ProviderProjectViewSchema) }),
  }),
  mine: endpoint({
    method: 'GET',
    path: '/provider/projects/mine',
    auth: 'user',
    query: ActingAsQuery.extend({ scope: z.enum(['active', 'history']).optional() }),
    response: z.object({ items: z.array(ProviderProjectViewSchema) }),
  }),
  get: endpoint({
    method: 'GET',
    path: '/provider/projects/:id',
    auth: 'user',
    params: IdParams,
    query: ActingAsQuery,
    response: ProviderProjectViewSchema,
  }),
  submitQuote: endpoint({
    method: 'POST',
    path: '/provider/projects/:id/quotes',
    auth: 'user',
    params: IdParams,
    body: SubmitQuoteBodySchema,
    response: ProviderQuoteViewSchema,
    idempotent: true,
    summary: 'Holds b2bFeePerWorkerDay x workers x days; captured if the quote wins, released otherwise',
  }),
  withdrawQuote: endpoint({
    method: 'POST',
    path: '/provider/quotes/:id/withdraw',
    auth: 'user',
    params: IdParams,
    response: ProviderQuoteViewSchema,
  }),
  addReport: endpoint({
    method: 'POST',
    path: '/provider/projects/:id/reports',
    auth: 'user',
    params: IdParams,
    body: ReportBodySchema,
    response: ReportViewSchema,
  }),
  complete: endpoint({
    method: 'POST',
    path: '/provider/projects/:id/complete',
    auth: 'user',
    params: IdParams,
    body: CompleteProjectBodySchema,
    response: InvoiceViewSchema,
    idempotent: true,
    summary: 'Marks the work complete and issues the invoice (hesab-faktura) with VAT',
  }),
};
