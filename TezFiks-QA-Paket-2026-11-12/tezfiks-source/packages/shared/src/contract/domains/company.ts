import { z } from 'zod';
import { endpoint } from '../define';
import { CategoryRefSchema, FileRefSchema, Id, IsoDateTime, LatLngSchema, Money, Ok, PageQuery, PriceInputSchema, paginated } from '../common';
import { CompanyRole, FinalPriceEntry, LegalForm, MemberStatus, VerificationStatus } from '../../enums';
import { WalletSummarySchema, LedgerTxViewSchema, TopupBodySchema, CheckoutResponseSchema } from './wallet';
import { OffersResponseSchema } from './offers';
import { ProAssignmentSchema, EarningsViewSchema, PayoutMethodBodySchema, PayoutMethodViewSchema } from './jobs';
import { KycStatusSchema } from './kyc';
import { CancelBodySchema } from './requests';
import { VoenSchema } from './customer';

export const CompanyParams = z.object({ companyId: Id });
/** Generic so the extra param keys stay in the static type (runtime schema unchanged). */
const CompanyIdParams = <T extends z.ZodRawShape>(extra: T) => z.object({ companyId: Id, ...extra });

export const CompanyViewSchema = z.object({
  id: Id,
  name: z.string(),
  legalForm: LegalForm.schema,
  voen: z.string(),
  status: VerificationStatus.schema,
  rejectReason: z.string().nullable(),
  finalPriceEntry: FinalPriceEntry.schema,
  isVatPayer: z.boolean(),
  trades: z.array(CategoryRefSchema),
  base: LatLngSchema.nullable(),
  baseAddress: z.string().nullable(),
  serviceRadiusKm: z.int(),
  ratingAvg: z.number().nullable(),
  ratingCount: z.int(),
  strikes: z.int(),
  wallet: WalletSummarySchema,
  earningsBalance: Money,
  membersCount: z.int(),
  onlineWorkers: z.int(),
  myRole: CompanyRole.schema,
  kyc: KycStatusSchema,
});
export type CompanyView = z.infer<typeof CompanyViewSchema>;

export const CompanySettingsBodySchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  finalPriceEntry: FinalPriceEntry.schema.optional(),
  isVatPayer: z.boolean().optional(),
  tradeIds: z.array(Id).min(1).max(30).optional(),
  serviceRadiusKm: z.int().min(2).max(50).optional(),
  base: LatLngSchema.optional(),
  baseAddress: z.string().trim().max(300).optional(),
});

export const CompanyRegistrationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  legalForm: LegalForm.schema,
  voen: VoenSchema,
  isVatPayer: z.boolean().default(false),
  tradeIds: z.array(Id).min(1).max(30),
  serviceRadiusKm: z.int().min(2).max(50).default(15),
  base: LatLngSchema,
  baseAddress: z.string().trim().max(300).optional(),
});

export const MemberViewSchema = z.object({
  userId: Id,
  handymanId: Id.nullable(),
  firstName: z.string(),
  lastName: z.string(),
  phone: z.string(),
  photo: FileRefSchema.nullable(),
  role: CompanyRole.schema,
  status: MemberStatus.schema,
  isOnline: z.boolean(),
  busy: z.boolean(),
  ratingAvg: z.number().nullable(),
  completedCount: z.int(),
  trades: z.array(CategoryRefSchema),
  lastSeenAt: IsoDateTime.nullable(),
  joinedAt: IsoDateTime,
});
export type MemberView = z.infer<typeof MemberViewSchema>;

export const InviteViewSchema = z.object({
  id: Id,
  token: z.string(),
  /** https://<host>/tezfix/join/<token> */
  url: z.string(),
  role: CompanyRole.schema,
  expiresAt: IsoDateTime,
  maxUses: z.int(),
  usedCount: z.int(),
  revokedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type InviteView = z.infer<typeof InviteViewSchema>;

export const CreateInviteBodySchema = z.object({
  role: CompanyRole.schema.default('WORKER'),
  maxUses: z.int().min(1).max(100).default(10),
  expiresInDays: z.int().min(1).max(30).default(7),
});

export const WorkerLiveSchema = z.object({
  handymanId: Id,
  userId: Id,
  firstName: z.string(),
  lastName: z.string(),
  photo: FileRefSchema.nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  isOnline: z.boolean(),
  busy: z.boolean(),
  assignmentId: Id.nullable(),
  lastSeenAt: IsoDateTime.nullable(),
});
export type WorkerLive = z.infer<typeof WorkerLiveSchema>;

export const CompanyDashboardSchema = z.object({
  jobsToday: z.int(),
  activeJobs: z.int(),
  onlineWorkers: z.int(),
  membersCount: z.int(),
  wallet: WalletSummarySchema,
  earningsBalance: Money,
  feesToday: Money,
  /** Sum of final prices of jobs completed today. */
  revenueToday: Money,
});

export const companyEndpoints = {
  get: endpoint({ method: 'GET', path: '/company/:companyId', auth: 'user', params: CompanyParams, response: CompanyViewSchema }),
  dashboard: endpoint({
    method: 'GET',
    path: '/company/:companyId/dashboard',
    auth: 'user',
    params: CompanyParams,
    response: CompanyDashboardSchema,
  }),
  updateSettings: endpoint({
    method: 'PATCH',
    path: '/company/:companyId/settings',
    auth: 'user',
    params: CompanyParams,
    body: CompanySettingsBodySchema,
    response: CompanyViewSchema,
  }),
  members: endpoint({
    method: 'GET',
    path: '/company/:companyId/members',
    auth: 'user',
    params: CompanyParams,
    response: z.object({ items: z.array(MemberViewSchema) }),
  }),
  updateMember: endpoint({
    method: 'PATCH',
    path: '/company/:companyId/members/:userId',
    auth: 'user',
    params: CompanyIdParams({ userId: Id }),
    body: z.object({ role: CompanyRole.schema.optional(), tradeIds: z.array(Id).min(1).max(15).optional() }),
    response: MemberViewSchema,
  }),
  removeMember: endpoint({
    method: 'DELETE',
    path: '/company/:companyId/members/:userId',
    auth: 'user',
    params: CompanyIdParams({ userId: Id }),
    response: Ok,
  }),
  invites: endpoint({
    method: 'GET',
    path: '/company/:companyId/invites',
    auth: 'user',
    params: CompanyParams,
    response: z.object({ items: z.array(InviteViewSchema) }),
  }),
  createInvite: endpoint({
    method: 'POST',
    path: '/company/:companyId/invites',
    auth: 'user',
    params: CompanyParams,
    body: CreateInviteBodySchema,
    response: InviteViewSchema,
  }),
  revokeInvite: endpoint({
    method: 'DELETE',
    path: '/company/:companyId/invites/:inviteId',
    auth: 'user',
    params: CompanyIdParams({ inviteId: Id }),
    response: Ok,
  }),
  offers: endpoint({
    method: 'GET',
    path: '/company/:companyId/offers/current',
    auth: 'user',
    params: CompanyParams,
    response: OffersResponseSchema,
  }),
  acceptOffer: endpoint({
    method: 'POST',
    path: '/company/:companyId/offers/:offerId/accept',
    auth: 'user',
    params: CompanyIdParams({ offerId: Id }),
    body: z.object({ workerIds: z.array(Id).min(1).max(50) }),
    response: z.object({ assignments: z.array(ProAssignmentSchema) }),
    idempotent: true,
    summary: '"Qəbul et və göndər": holds 10 AZN per worker on the company wallet',
  }),
  declineOffer: endpoint({
    method: 'POST',
    path: '/company/:companyId/offers/:offerId/decline',
    auth: 'user',
    params: CompanyIdParams({ offerId: Id }),
    response: Ok,
  }),
  assignments: endpoint({
    method: 'GET',
    path: '/company/:companyId/assignments',
    auth: 'user',
    params: CompanyParams,
    query: PageQuery.extend({ scope: z.enum(['active', 'history']).optional() }),
    response: paginated(ProAssignmentSchema),
  }),
  assignment: endpoint({
    method: 'GET',
    path: '/company/:companyId/assignments/:id',
    auth: 'user',
    params: CompanyIdParams({ id: Id }),
    response: ProAssignmentSchema,
  }),
  enterPrice: endpoint({
    method: 'POST',
    path: '/company/:companyId/assignments/:id/price',
    auth: 'user',
    params: CompanyIdParams({ id: Id }),
    body: PriceInputSchema,
    response: ProAssignmentSchema,
    idempotent: true,
    summary: 'Only when the company setting finalPriceEntry = MANAGER',
  }),
  reassign: endpoint({
    method: 'POST',
    path: '/company/:companyId/assignments/:id/reassign',
    auth: 'user',
    params: CompanyIdParams({ id: Id }),
    body: z.object({ workerId: Id }),
    response: ProAssignmentSchema,
  }),
  cancelAssignment: endpoint({
    method: 'POST',
    path: '/company/:companyId/assignments/:id/cancel',
    auth: 'user',
    params: CompanyIdParams({ id: Id }),
    body: CancelBodySchema,
    response: ProAssignmentSchema,
    idempotent: true,
  }),
  workersLive: endpoint({
    method: 'GET',
    path: '/company/:companyId/workers/live',
    auth: 'user',
    params: CompanyParams,
    response: z.object({ items: z.array(WorkerLiveSchema) }),
  }),
  wallet: endpoint({
    method: 'GET',
    path: '/company/:companyId/wallet',
    auth: 'user',
    params: CompanyParams,
    response: WalletSummarySchema,
  }),
  walletTransactions: endpoint({
    method: 'GET',
    path: '/company/:companyId/wallet/transactions',
    auth: 'user',
    params: CompanyParams,
    query: PageQuery,
    response: paginated(LedgerTxViewSchema),
  }),
  topup: endpoint({
    method: 'POST',
    path: '/company/:companyId/wallet/topup',
    auth: 'user',
    params: CompanyParams,
    body: TopupBodySchema.omit({ owner: true }),
    response: CheckoutResponseSchema,
    idempotent: true,
  }),
  earnings: endpoint({
    method: 'GET',
    path: '/company/:companyId/earnings',
    auth: 'user',
    params: CompanyParams,
    response: EarningsViewSchema,
  }),
  getPayoutMethod: endpoint({
    method: 'GET',
    path: '/company/:companyId/payout-method',
    auth: 'user',
    params: CompanyParams,
    response: z.object({ method: PayoutMethodViewSchema.nullable() }),
  }),
  setPayoutMethod: endpoint({
    method: 'PUT',
    path: '/company/:companyId/payout-method',
    auth: 'user',
    params: CompanyParams,
    body: PayoutMethodBodySchema,
    response: PayoutMethodViewSchema,
  }),
};

export { PriceInputSchema };
