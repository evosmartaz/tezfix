import { z } from 'zod';
import { endpoint } from '../define';
import { FileRefSchema, Id, IdParams, IsoDate, IsoDateTime, LatLngSchema, Money, Ok, PageQuery, PriceInputSchema, PriceSchema, paginated } from '../common';
import {
  ActorSide,
  AdminRole,
  AssignmentStatus,
  CaseStatus,
  CaseType,
  CustomerType,
  FinalPriceEntry,
  HandymanKind,
  LedgerAccountKind,
  LedgerOwnerType,
  LedgerTxKind,
  LegalForm,
  OfferStatus,
  OfferTarget,
  PaymentMethod,
  PaymentPurpose,
  PaymentStatus,
  PayoutOwnerType,
  PayoutStatus,
  ProjectStatus,
  ProviderType,
  RequestStatus,
  RequestTiming,
  UserStatus,
  VerificationStatus,
} from '../../enums';
import { PlatformSettingsSchema } from '../../settings';
import { WalletSummarySchema } from './wallet';
import { RequestDetailSchema } from './requests';
import { CaseViewSchema } from './cases';
import { MemberViewSchema } from './company';
import { PaymentIntentViewSchema } from './payments';
import { PayoutViewSchema } from './jobs';
import { InvoiceViewSchema, ProjectDetailSchema, ProviderQuoteViewSchema } from './projects';
import { AdminMeSchema } from './auth';

// ----------------------------------------------------------------- rows ---

export const AdminRequestRowSchema = z.object({
  id: Id,
  number: z.int(),
  customerName: z.string(),
  providerName: z.string().nullable(),
  categoryName: z.string(),
  status: RequestStatus.schema,
  /** Status of the primary (first) assignment, used for the "Usta yolda / İcradadır" labels on board 05. */
  assignmentStatus: AssignmentStatus.schema.nullable(),
  timing: RequestTiming.schema,
  slots: z.int(),
  /** Captured platform fees for this request. */
  fee: Money,
  createdAt: IsoDateTime,
  isBot: z.boolean(),
});
export type AdminRequestRow = z.infer<typeof AdminRequestRowSchema>;

export const AdminAssignmentRowSchema = z.object({
  id: Id,
  requestId: Id,
  requestNumber: z.int(),
  status: AssignmentStatus.schema,
  providerType: ProviderType.schema,
  providerName: z.string(),
  providerPhone: z.string(),
  companyName: z.string().nullable(),
  customerName: z.string(),
  customerPhone: z.string(),
  acceptedAt: IsoDateTime,
  completedAt: IsoDateTime.nullable(),
  cancelledAt: IsoDateTime.nullable(),
  cancelledBy: ActorSide.schema.nullable(),
  price: PriceSchema.nullable(),
  paymentMethod: PaymentMethod.schema.nullable(),
  fee: z.object({ amount: Money, captured: z.boolean(), refunded: z.boolean() }).nullable(),
  contactUnlockedAt: IsoDateTime.nullable(),
  etaSec: z.int().nullable(),
});
export type AdminAssignmentRow = z.infer<typeof AdminAssignmentRowSchema>;

export const AdminOfferRowSchema = z.object({
  id: Id,
  target: OfferTarget.schema,
  handymanName: z.string().nullable(),
  companyName: z.string().nullable(),
  step: z.int(),
  ring: z.int(),
  status: OfferStatus.schema,
  sentAt: IsoDateTime,
  respondedAt: IsoDateTime.nullable(),
  distanceM: z.int().nullable(),
});

export const AdminLedgerTxSchema = z.object({
  id: Id,
  kind: LedgerTxKind.schema,
  createdAt: IsoDateTime,
  memo: z.string().nullable(),
  actor: z.string().nullable(),
  requestNumber: z.int().nullable(),
  entries: z.array(
    z.object({
      accountId: Id,
      ownerType: LedgerOwnerType.schema,
      ownerId: Id.nullable(),
      ownerName: z.string(),
      accountKind: LedgerAccountKind.schema,
      amount: Money,
      balanceAfter: Money,
    }),
  ),
});
export type AdminLedgerTx = z.infer<typeof AdminLedgerTxSchema>;

export const AdminRequestDetailSchema = z.object({
  request: RequestDetailSchema,
  customer: z.object({
    accountId: Id,
    userId: Id,
    name: z.string(),
    phone: z.string(),
    type: CustomerType.schema,
    companyName: z.string().nullable(),
  }),
  assignments: z.array(AdminAssignmentRowSchema),
  offers: z.array(AdminOfferRowSchema),
  ledger: z.array(AdminLedgerTxSchema),
  timeline: z.array(z.object({ at: IsoDateTime, event: z.string(), actor: z.string().nullable(), details: z.string().nullable() })),
});

export const AdminHandymanRowSchema = z.object({
  id: Id,
  userId: Id,
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string(),
  kind: HandymanKind.schema,
  companyName: z.string().nullable(),
  trades: z.array(z.string()),
  ratingAvg: z.number().nullable(),
  completedCount: z.int(),
  /** Solo wallet available balance; null for company workers. */
  walletBalance: Money.nullable(),
  status: VerificationStatus.schema,
  /** Board 05 status column: Aktiv / Balans azdır / Təsdiq gözləyir / Bloklanmış / Rədd edilib / Qaralama */
  displayStatus: z.enum(['ACTIVE', 'LOW_BALANCE', 'PENDING', 'BLOCKED', 'REJECTED', 'DRAFT']),
  isOnline: z.boolean(),
  strikes: z.int(),
  isBot: z.boolean(),
  createdAt: IsoDateTime,
});
export type AdminHandymanRow = z.infer<typeof AdminHandymanRowSchema>;

export const AdminKycViewSchema = z.object({
  submissionId: Id,
  status: VerificationStatus.schema,
  submittedAt: IsoDateTime,
  files: z.object({
    idFront: FileRefSchema,
    idBack: FileRefSchema,
    selfieFront: FileRefSchema,
    selfieTurn: FileRefSchema,
    selfieBlink: FileRefSchema,
    tradeProofs: z.array(FileRefSchema),
    companyDocs: z.array(FileRefSchema),
  }),
  selfieChecks: z.unknown().nullable(),
  consent: z.object({ policyVersion: z.string(), locale: z.string(), acceptedAt: IsoDateTime }),
  extracted: z
    .object({ docNumberLast4: z.string().nullable(), birthDate: IsoDate.nullable(), expiry: IsoDate.nullable() })
    .nullable(),
  reviewedAt: IsoDateTime.nullable(),
  reviewerName: z.string().nullable(),
  rejectReason: z.string().nullable(),
});

export const StrikeViewSchema = z.object({
  id: Id,
  reason: z.string(),
  requestNumber: z.int().nullable(),
  createdAt: IsoDateTime,
  clearedAt: IsoDateTime.nullable(),
});

export const AdminHandymanDetailSchema = z.object({
  row: AdminHandymanRowSchema,
  photo: FileRefSchema.nullable(),
  base: LatLngSchema.nullable(),
  serviceRadiusKm: z.int(),
  rejectReason: z.string().nullable(),
  kyc: AdminKycViewSchema.nullable(),
  recentAssignments: z.array(AdminAssignmentRowSchema),
  strikes: z.array(StrikeViewSchema),
  wallet: WalletSummarySchema.nullable(),
  earningsBalance: Money.nullable(),
});

export const AdminCompanyRowSchema = z.object({
  id: Id,
  name: z.string(),
  voen: z.string(),
  legalForm: LegalForm.schema,
  status: VerificationStatus.schema,
  ownerName: z.string(),
  ownerPhone: z.string(),
  membersCount: z.int(),
  walletBalance: Money,
  ratingAvg: z.number().nullable(),
  strikes: z.int(),
  createdAt: IsoDateTime,
});

export const AdminCompanyDetailSchema = z.object({
  row: AdminCompanyRowSchema,
  finalPriceEntry: FinalPriceEntry.schema,
  isVatPayer: z.boolean(),
  trades: z.array(z.string()),
  rejectReason: z.string().nullable(),
  kyc: AdminKycViewSchema.nullable(),
  members: z.array(MemberViewSchema),
  wallet: WalletSummarySchema,
  earningsBalance: Money,
  strikes: z.array(StrikeViewSchema),
});

export const AdminCustomerRowSchema = z.object({
  id: Id,
  userId: Id,
  name: z.string(),
  phone: z.string(),
  type: CustomerType.schema,
  companyName: z.string().nullable(),
  requestsCount: z.int(),
  walletBalance: Money,
  ratingAvg: z.number().nullable(),
  userStatus: UserStatus.schema,
  createdAt: IsoDateTime,
});

export const AdminCustomerDetailSchema = z.object({
  row: AdminCustomerRowSchema,
  wallet: WalletSummarySchema,
  recentRequests: z.array(AdminRequestRowSchema),
});

export const AdminPaymentRowSchema = PaymentIntentViewSchema.extend({ payerName: z.string().nullable() });
export const AdminPayoutRowSchema = PayoutViewSchema.extend({
  ownerType: PayoutOwnerType.schema,
  ownerId: Id,
  ownerName: z.string(),
});

export const AdminCaseRowSchema = z.object({
  id: Id,
  type: CaseType.schema,
  status: CaseStatus.schema,
  requestNumber: z.int().nullable(),
  projectNumber: z.int().nullable(),
  customerName: z.string(),
  providerName: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});

export const AdminCaseDetailSchema = z.object({
  case: CaseViewSchema,
  row: AdminCaseRowSchema,
  assignment: AdminAssignmentRowSchema.nullable(),
  notes: z.array(z.object({ id: Id, authorName: z.string(), body: z.string(), createdAt: IsoDateTime })),
});

export const AdminProjectRowSchema = z.object({
  id: Id,
  number: z.int(),
  status: ProjectStatus.schema,
  customerName: z.string(),
  categoryName: z.string(),
  quotesCount: z.int(),
  workersNeeded: z.int(),
  dateFrom: IsoDate,
  dateTo: IsoDate,
  createdAt: IsoDateTime,
});

export const AdminProjectDetailSchema = z.object({
  project: ProjectDetailSchema,
  customer: z.object({ accountId: Id, name: z.string(), phone: z.string(), voen: z.string().nullable() }),
  quotes: z.array(ProviderQuoteViewSchema),
});

export const AdminUserViewSchema = z.object({
  id: Id,
  email: z.string(),
  name: z.string(),
  role: AdminRole.schema,
  active: z.boolean(),
  createdAt: IsoDateTime,
  lastLoginAt: IsoDateTime.nullable(),
});

export const AuditRowSchema = z.object({
  id: Id,
  actorType: z.enum(['ADMIN', 'USER', 'SYSTEM']),
  actorId: Id.nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  at: IsoDateTime,
});

export const AdminDashboardSchema = z.object({
  /** Baku-local date. */
  date: IsoDate,
  ordersToday: z.int(),
  ordersYesterday: z.int(),
  ordersDeltaPct: z.number().nullable(),
  activeHandymen: z.int(),
  onlineHandymen: z.int(),
  feeRevenueToday: Money,
  feeOrdersToday: z.int(),
  /** 0..1 over the last 7 days */
  cancelRate: z.number(),
  cancelRateDelta: z.number().nullable(),
  pendingKyc: z.int(),
  pendingCompanies: z.int(),
  openCases: z.int(),
  recentOrders: z.array(AdminRequestRowSchema),
});

export const LiveMapSchema = z.object({
  serverNow: IsoDateTime,
  handymen: z.array(
    z.object({
      id: Id,
      name: z.string(),
      lat: z.number(),
      lng: z.number(),
      isOnline: z.boolean(),
      busy: z.boolean(),
      cell7: z.string().nullable(),
      isBot: z.boolean(),
      companyName: z.string().nullable(),
      lastSeenAt: IsoDateTime.nullable(),
    }),
  ),
  requests: z.array(
    z.object({
      id: Id,
      number: z.int(),
      lat: z.number(),
      lng: z.number(),
      status: RequestStatus.schema,
      isSearching: z.boolean(),
      timing: RequestTiming.schema,
      categoryName: z.string(),
      cells: z.array(z.string()),
    }),
  ),
});

export const DemoConfigSchema = z.object({
  autoAccept: z.boolean(),
  acceptDelaySec: z.int().min(1).max(120),
  speedKmh: z.int().min(5).max(300),
  autoArrive: z.boolean(),
  autoPrice: z.boolean(),
  priceLabor: Money,
  priceMaterials: Money,
});
export type DemoConfig = z.infer<typeof DemoConfigSchema>;

export const DemoStateSchema = z.object({
  enabled: z.boolean(),
  config: DemoConfigSchema,
  bots: z.array(
    z.object({
      handymanId: Id,
      name: z.string(),
      lat: z.number(),
      lng: z.number(),
      busy: z.boolean(),
      trades: z.array(z.string()),
      companyName: z.string().nullable(),
    }),
  ),
});

const ReasonBody = z.object({ reason: z.string().trim().min(3).max(500) });
const ListQuery = PageQuery.extend({ q: z.string().trim().max(100).optional() });
const SettingsResponse = z.object({ settings: PlatformSettingsSchema, defaults: PlatformSettingsSchema, demoMode: z.boolean() });

export const adminEndpoints = {
  me: endpoint({ method: 'GET', path: '/admin/me', auth: 'admin', response: AdminMeSchema }),
  dashboard: endpoint({ method: 'GET', path: '/admin/dashboard', auth: 'admin', response: AdminDashboardSchema }),

  requests: endpoint({
    method: 'GET',
    path: '/admin/requests',
    auth: 'admin',
    query: ListQuery.extend({
      status: RequestStatus.schema.optional(),
      from: IsoDateTime.optional(),
      to: IsoDateTime.optional(),
    }),
    response: paginated(AdminRequestRowSchema),
  }),
  request: endpoint({ method: 'GET', path: '/admin/requests/:id', auth: 'admin', params: IdParams, response: AdminRequestDetailSchema }),
  cancelRequest: endpoint({
    method: 'POST',
    path: '/admin/requests/:id/cancel',
    auth: 'admin',
    params: IdParams,
    body: z.object({ reason: z.string().trim().min(3).max(500), chargeCustomer: z.boolean().default(false) }),
    response: AdminRequestDetailSchema,
  }),

  handymen: endpoint({
    method: 'GET',
    path: '/admin/handymen',
    auth: 'admin',
    query: ListQuery.extend({ tab: z.enum(['all', 'pending', 'blocked']).optional() }),
    response: paginated(AdminHandymanRowSchema).extend({
      counts: z.object({ all: z.int(), pending: z.int(), blocked: z.int() }),
    }),
  }),
  handyman: endpoint({ method: 'GET', path: '/admin/handymen/:id', auth: 'admin', params: IdParams, response: AdminHandymanDetailSchema }),
  approveHandyman: endpoint({
    method: 'POST',
    path: '/admin/handymen/:id/approve',
    auth: 'admin',
    params: IdParams,
    body: z.object({
      extracted: z
        .object({
          docNumberLast4: z.string().regex(/^[0-9A-Z]{4}$/).optional(),
          birthDate: IsoDate.optional(),
          expiry: IsoDate.optional(),
        })
        .optional(),
    }),
    response: AdminHandymanDetailSchema,
  }),
  rejectHandyman: endpoint({
    method: 'POST',
    path: '/admin/handymen/:id/reject',
    auth: 'admin',
    params: IdParams,
    body: ReasonBody,
    response: AdminHandymanDetailSchema,
  }),
  blockHandyman: endpoint({
    method: 'POST',
    path: '/admin/handymen/:id/block',
    auth: 'admin',
    params: IdParams,
    body: ReasonBody,
    response: AdminHandymanDetailSchema,
  }),
  unblockHandyman: endpoint({
    method: 'POST',
    path: '/admin/handymen/:id/unblock',
    auth: 'admin',
    params: IdParams,
    response: AdminHandymanDetailSchema,
  }),
  clearStrikes: endpoint({
    method: 'POST',
    path: '/admin/handymen/:id/clear-strikes',
    auth: 'admin',
    params: IdParams,
    response: AdminHandymanDetailSchema,
  }),

  companies: endpoint({
    method: 'GET',
    path: '/admin/companies',
    auth: 'admin',
    query: ListQuery.extend({ tab: z.enum(['all', 'pending', 'blocked']).optional() }),
    response: paginated(AdminCompanyRowSchema).extend({
      counts: z.object({ all: z.int(), pending: z.int(), blocked: z.int() }),
    }),
  }),
  company: endpoint({ method: 'GET', path: '/admin/companies/:id', auth: 'admin', params: IdParams, response: AdminCompanyDetailSchema }),
  approveCompany: endpoint({
    method: 'POST',
    path: '/admin/companies/:id/approve',
    auth: 'admin',
    params: IdParams,
    response: AdminCompanyDetailSchema,
  }),
  rejectCompany: endpoint({
    method: 'POST',
    path: '/admin/companies/:id/reject',
    auth: 'admin',
    params: IdParams,
    body: ReasonBody,
    response: AdminCompanyDetailSchema,
  }),
  blockCompany: endpoint({
    method: 'POST',
    path: '/admin/companies/:id/block',
    auth: 'admin',
    params: IdParams,
    body: ReasonBody,
    response: AdminCompanyDetailSchema,
  }),
  unblockCompany: endpoint({
    method: 'POST',
    path: '/admin/companies/:id/unblock',
    auth: 'admin',
    params: IdParams,
    response: AdminCompanyDetailSchema,
  }),

  customers: endpoint({
    method: 'GET',
    path: '/admin/customers',
    auth: 'admin',
    query: ListQuery.extend({ type: CustomerType.schema.optional() }),
    response: paginated(AdminCustomerRowSchema),
  }),
  customer: endpoint({ method: 'GET', path: '/admin/customers/:id', auth: 'admin', params: IdParams, response: AdminCustomerDetailSchema }),
  blockUser: endpoint({
    method: 'POST',
    path: '/admin/users/:id/block',
    auth: 'admin',
    params: IdParams,
    body: ReasonBody,
    response: Ok,
  }),
  unblockUser: endpoint({ method: 'POST', path: '/admin/users/:id/unblock', auth: 'admin', params: IdParams, response: Ok }),

  adjustWallet: endpoint({
    method: 'POST',
    path: '/admin/wallets/adjust',
    auth: 'admin',
    body: z.object({
      owner: z.object({ type: z.enum(['CUSTOMER_ACCOUNT', 'HANDYMAN', 'COMPANY']), id: Id }),
      account: z.enum(['WALLET', 'EARNINGS']).default('WALLET'),
      /** Signed qəpik. Positive = add balance ("Balans artır"). */
      amount: z
        .int()
        .min(-10_000_000)
        .max(10_000_000)
        .refine((v) => v !== 0, 'amount must not be zero'),
      reason: z.string().trim().min(3).max(300),
    }),
    response: z.object({ wallet: WalletSummarySchema, transactionId: Id }),
    idempotent: true,
  }),
  ledger: endpoint({
    method: 'GET',
    path: '/admin/ledger/transactions',
    auth: 'admin',
    query: PageQuery.extend({
      kind: LedgerTxKind.schema.optional(),
      ownerType: LedgerOwnerType.schema.optional(),
      ownerId: Id.optional(),
    }),
    response: paginated(AdminLedgerTxSchema),
  }),
  payments: endpoint({
    method: 'GET',
    path: '/admin/payments',
    auth: 'admin',
    query: PageQuery.extend({ status: PaymentStatus.schema.optional(), purpose: PaymentPurpose.schema.optional() }),
    response: paginated(AdminPaymentRowSchema),
  }),
  payouts: endpoint({
    method: 'GET',
    path: '/admin/payouts',
    auth: 'admin',
    query: PageQuery.extend({ status: PayoutStatus.schema.optional() }),
    response: paginated(AdminPayoutRowSchema),
  }),
  runPayouts: endpoint({
    method: 'POST',
    path: '/admin/payouts/run',
    auth: 'admin',
    response: z.object({ created: z.int(), total: Money }),
    summary: 'Runs the weekly payout job now (idempotent per owner per ISO week)',
  }),
  markPayoutPaid: endpoint({
    method: 'POST',
    path: '/admin/payouts/:id/mark-paid',
    auth: 'admin',
    params: IdParams,
    response: AdminPayoutRowSchema,
  }),
  markPayoutFailed: endpoint({
    method: 'POST',
    path: '/admin/payouts/:id/mark-failed',
    auth: 'admin',
    params: IdParams,
    body: ReasonBody,
    response: AdminPayoutRowSchema,
  }),
  invoices: endpoint({
    method: 'GET',
    path: '/admin/invoices',
    auth: 'admin',
    query: PageQuery,
    response: paginated(InvoiceViewSchema),
  }),
  markInvoicePaid: endpoint({
    method: 'POST',
    path: '/admin/invoices/:id/mark-paid',
    auth: 'admin',
    params: IdParams,
    response: InvoiceViewSchema,
    summary: 'Bank transfer received (demo): credits the provider earnings',
  }),

  cases: endpoint({
    method: 'GET',
    path: '/admin/cases',
    auth: 'admin',
    query: PageQuery.extend({ status: CaseStatus.schema.optional(), type: CaseType.schema.optional() }),
    response: paginated(AdminCaseRowSchema),
  }),
  case: endpoint({ method: 'GET', path: '/admin/cases/:id', auth: 'admin', params: IdParams, response: AdminCaseDetailSchema }),
  addCaseNote: endpoint({
    method: 'POST',
    path: '/admin/cases/:id/notes',
    auth: 'admin',
    params: IdParams,
    body: z.object({ body: z.string().trim().min(1).max(2000) }),
    response: AdminCaseDetailSchema,
  }),
  redispatchCase: endpoint({
    method: 'POST',
    path: '/admin/cases/:id/redispatch',
    auth: 'admin',
    params: IdParams,
    body: z.object({ note: z.string().trim().max(2000).optional() }),
    response: AdminCaseDetailSchema,
    summary: 'Guarantee re-fix: new fee-free request offered first to the original provider',
  }),
  resolveCase: endpoint({
    method: 'POST',
    path: '/admin/cases/:id/resolve',
    auth: 'admin',
    params: IdParams,
    body: z.object({
      note: z.string().trim().min(1).max(2000),
      /** Price disputes: COMPLETE_CASH completes as cash; REPROPOSE_PRICE sets `price` and returns to PRICE_PROPOSED; CANCEL_ASSIGNMENT cancels without fees. */
      outcome: z.enum(['RESOLVED', 'COMPLETE_CASH', 'REPROPOSE_PRICE', 'CANCEL_ASSIGNMENT']).default('RESOLVED'),
      price: PriceInputSchema.optional(),
    }),
    response: AdminCaseDetailSchema,
  }),
  rejectCase: endpoint({
    method: 'POST',
    path: '/admin/cases/:id/reject',
    auth: 'admin',
    params: IdParams,
    body: z.object({ note: z.string().trim().min(1).max(2000) }),
    response: AdminCaseDetailSchema,
  }),

  projects: endpoint({
    method: 'GET',
    path: '/admin/projects',
    auth: 'admin',
    query: PageQuery.extend({ status: ProjectStatus.schema.optional() }),
    response: paginated(AdminProjectRowSchema),
  }),
  project: endpoint({ method: 'GET', path: '/admin/projects/:id', auth: 'admin', params: IdParams, response: AdminProjectDetailSchema }),

  settings: endpoint({ method: 'GET', path: '/admin/settings', auth: 'admin', response: SettingsResponse }),
  updateSettings: endpoint({
    method: 'PATCH',
    path: '/admin/settings',
    auth: 'admin',
    body: PlatformSettingsSchema.partial(),
    response: SettingsResponse,
  }),
  admins: endpoint({
    method: 'GET',
    path: '/admin/admins',
    auth: 'admin',
    response: z.object({ items: z.array(AdminUserViewSchema) }),
  }),
  createAdmin: endpoint({
    method: 'POST',
    path: '/admin/admins',
    auth: 'admin',
    body: z.object({
      email: z.email().max(200),
      name: z.string().trim().min(2).max(100),
      password: z.string().min(10).max(200),
      role: AdminRole.schema.default('OPERATOR'),
    }),
    response: AdminUserViewSchema,
  }),
  updateAdmin: endpoint({
    method: 'PATCH',
    path: '/admin/admins/:id',
    auth: 'admin',
    params: IdParams,
    body: z.object({
      name: z.string().trim().min(2).max(100).optional(),
      role: AdminRole.schema.optional(),
      active: z.boolean().optional(),
      password: z.string().min(10).max(200).optional(),
    }),
    response: AdminUserViewSchema,
  }),
  audit: endpoint({
    method: 'GET',
    path: '/admin/audit',
    auth: 'admin',
    query: PageQuery.extend({ entityType: z.string().max(60).optional(), entityId: z.string().max(60).optional() }),
    response: paginated(AuditRowSchema),
  }),
  liveMap: endpoint({ method: 'GET', path: '/admin/live-map', auth: 'admin', response: LiveMapSchema }),

  demoState: endpoint({ method: 'GET', path: '/admin/demo', auth: 'admin', response: DemoStateSchema }),
  demoSpawnBots: endpoint({
    method: 'POST',
    path: '/admin/demo/bots',
    auth: 'admin',
    body: z.object({
      count: z.int().min(1).max(50),
      center: LatLngSchema.optional(),
      radiusKm: z.number().min(0.3).max(20).default(3),
      tradeIds: z.array(Id).max(20).optional(),
      companyId: Id.optional(),
    }),
    response: DemoStateSchema,
    summary: 'DEMO_MODE only: approved, online bot handymen with funded wallets',
  }),
  demoClearBots: endpoint({ method: 'DELETE', path: '/admin/demo/bots', auth: 'admin', response: DemoStateSchema }),
  demoConfig: endpoint({
    method: 'PATCH',
    path: '/admin/demo/config',
    auth: 'admin',
    body: DemoConfigSchema.partial(),
    response: DemoStateSchema,
  }),
  demoCreateRequest: endpoint({
    method: 'POST',
    path: '/admin/demo/requests',
    auth: 'admin',
    body: z.object({
      customerUserId: Id.optional(),
      categoryId: Id,
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      timing: RequestTiming.schema.default('NOW'),
      slots: z.int().min(1).max(10).default(1),
      scheduledAt: IsoDateTime.optional(),
      description: z.string().trim().max(2000).optional(),
    }),
    response: z.object({ requestId: Id, number: z.int() }),
    summary: 'Creates a test request at a point (as a demo customer) so the pro app can be tried alone',
  }),
};
