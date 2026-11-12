import { z } from 'zod';
import { endpoint } from '../define';
import { CategoryRefSchema, FileRefSchema, Id, IdParams, IsoDateTime, LatLngSchema, Money, Ok, PageQuery, PriceInputSchema, paginated } from '../common';
import { HandymanKind, VerificationStatus, CompanyRole } from '../../enums';
import { WalletSummarySchema } from './wallet';
import { OffersResponseSchema } from './offers';
import { EarningsViewSchema, PayoutMethodBodySchema, PayoutMethodViewSchema, ProAssignmentSchema } from './jobs';
import { KycStatusSchema } from './kyc';
import { CompanyRegistrationSchema, CompanyViewSchema } from './company';
import { CancelBodySchema } from './requests';
import { RatingBodySchema } from './assignments';

export const ProProfileSchema = z.object({
  id: Id,
  userId: Id,
  kind: HandymanKind.schema,
  status: VerificationStatus.schema,
  rejectReason: z.string().nullable(),
  firstName: z.string(),
  lastName: z.string(),
  photo: FileRefSchema.nullable(),
  company: z.object({ id: Id, name: z.string(), finalPriceEntry: z.enum(['WORKER', 'MANAGER']) }).nullable(),
  trades: z.array(CategoryRefSchema),
  serviceRadiusKm: z.int(),
  base: LatLngSchema.nullable(),
  isOnline: z.boolean(),
  ratingAvg: z.number().nullable(),
  ratingCount: z.int(),
  completedCount: z.int(),
  strikes: z.int(),
  /** Solo handymen only (company workers use the company wallet). */
  wallet: WalletSummarySchema.nullable(),
  earningsBalance: Money.nullable(),
  kyc: KycStatusSchema,
});
export type ProProfile = z.infer<typeof ProProfileSchema>;

export const ProProfileResponseSchema = z.object({
  profile: ProProfileSchema.nullable(),
  /** Companies where the caller is MANAGER (manager mode, board 04). */
  managedCompanies: z.array(
    z.object({ id: Id, name: z.string(), status: VerificationStatus.schema, role: CompanyRole.schema }),
  ),
});
export type ProProfileResponse = z.infer<typeof ProProfileResponseSchema>;

export const OnboardSoloBodySchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  photoFileId: Id.optional(),
  tradeIds: z.array(Id).min(1).max(15),
  serviceRadiusKm: z.int().min(2).max(25).default(10),
  base: LatLngSchema,
});

export const OnboardCompanyBodySchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  company: CompanyRegistrationSchema,
});

export const UpdateProProfileBodySchema = z.object({
  tradeIds: z.array(Id).min(1).max(15).optional(),
  serviceRadiusKm: z.int().min(2).max(25).optional(),
  base: LatLngSchema.optional(),
});

export const SetOnlineBodySchema = z.object({ online: z.boolean(), location: LatLngSchema.optional() });
export const SetOnlineResponseSchema = z.object({
  isOnline: z.boolean(),
  warnings: z.array(z.enum(['LOW_BALANCE', 'NO_TRADES', 'COMPANY_LOW_BALANCE'])),
});

export const LocationBodySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).optional(),
  heading: z.number().optional(),
  speed: z.number().optional(),
  at: IsoDateTime.optional(),
});
export type LocationBody = z.infer<typeof LocationBodySchema>;

export const ProStatsTodaySchema = z.object({
  /** Baku-local date "2026-10-24". */
  date: z.string(),
  jobs: z.int(),
  earnings: Money,
  /** Platform fees clipped today (positive number). */
  fees: Money,
});

export const proEndpoints = {
  profile: endpoint({ method: 'GET', path: '/pro/profile', auth: 'user', response: ProProfileResponseSchema }),
  onboardSolo: endpoint({
    method: 'POST',
    path: '/pro/onboarding/solo',
    auth: 'user',
    body: OnboardSoloBodySchema,
    response: ProProfileSchema,
    summary: '"Fərdi usta": creates the handyman profile in DRAFT; KYC submission moves it to PENDING_REVIEW',
  }),
  onboardCompany: endpoint({
    method: 'POST',
    path: '/pro/onboarding/company',
    auth: 'user',
    body: OnboardCompanyBodySchema,
    response: CompanyViewSchema,
    summary: '"Usta şirkəti": registers a provider company with the caller as MANAGER',
  }),
  updateProfile: endpoint({
    method: 'PATCH',
    path: '/pro/profile',
    auth: 'user',
    body: UpdateProProfileBodySchema,
    response: ProProfileSchema,
  }),
  setOnline: endpoint({
    method: 'POST',
    path: '/pro/online',
    auth: 'user',
    body: SetOnlineBodySchema,
    response: SetOnlineResponseSchema,
  }),
  location: endpoint({
    method: 'POST',
    path: '/pro/location',
    auth: 'user',
    body: LocationBodySchema,
    response: Ok,
    summary: 'Location ping (the socket event pro:location is preferred while connected)',
  }),
  statsToday: endpoint({ method: 'GET', path: '/pro/stats/today', auth: 'user', response: ProStatsTodaySchema }),
  offers: endpoint({ method: 'GET', path: '/pro/offers/current', auth: 'user', response: OffersResponseSchema }),
  scheduledOffers: endpoint({
    method: 'GET',
    path: '/pro/scheduled',
    auth: 'user',
    response: OffersResponseSchema,
    summary: '"Planlı sifarişlər": open offers for scheduled requests',
  }),
  acceptOffer: endpoint({
    method: 'POST',
    path: '/pro/offers/:id/accept',
    auth: 'user',
    params: IdParams,
    response: z.object({ assignment: ProAssignmentSchema }),
    idempotent: true,
    summary: 'Holds 10 AZN on the handyman wallet; captured when the 5-minute free-cancel window closes',
  }),
  declineOffer: endpoint({
    method: 'POST',
    path: '/pro/offers/:id/decline',
    auth: 'user',
    params: IdParams,
    response: Ok,
  }),
  seenOffer: endpoint({ method: 'POST', path: '/pro/offers/:id/seen', auth: 'user', params: IdParams, response: Ok }),
  assignments: endpoint({
    method: 'GET',
    path: '/pro/assignments',
    auth: 'user',
    query: PageQuery.extend({ scope: z.enum(['active', 'history']).optional() }),
    response: paginated(ProAssignmentSchema),
  }),
  assignment: endpoint({ method: 'GET', path: '/pro/assignments/:id', auth: 'user', params: IdParams, response: ProAssignmentSchema }),
  enRoute: endpoint({
    method: 'POST',
    path: '/pro/assignments/:id/en-route',
    auth: 'user',
    params: IdParams,
    body: z.object({ location: LatLngSchema.optional() }),
    response: ProAssignmentSchema,
    summary: '"Yola çıxdım": starts live tracking and computes the route',
  }),
  arrived: endpoint({ method: 'POST', path: '/pro/assignments/:id/arrived', auth: 'user', params: IdParams, response: ProAssignmentSchema }),
  enterPrice: endpoint({
    method: 'POST',
    path: '/pro/assignments/:id/price',
    auth: 'user',
    params: IdParams,
    body: PriceInputSchema,
    response: ProAssignmentSchema,
    idempotent: true,
    summary: '"Qiyməti təsdiqlə və işi bitir"',
  }),
  cancel: endpoint({
    method: 'POST',
    path: '/pro/assignments/:id/cancel',
    auth: 'user',
    params: IdParams,
    body: CancelBodySchema,
    response: ProAssignmentSchema,
    idempotent: true,
  }),
  rateCustomer: endpoint({
    method: 'POST',
    path: '/pro/assignments/:id/rate-customer',
    auth: 'user',
    params: IdParams,
    body: RatingBodySchema,
    response: Ok,
  }),
  earnings: endpoint({ method: 'GET', path: '/pro/earnings', auth: 'user', response: EarningsViewSchema }),
  getPayoutMethod: endpoint({
    method: 'GET',
    path: '/pro/payout-method',
    auth: 'user',
    response: z.object({ method: PayoutMethodViewSchema.nullable() }),
  }),
  setPayoutMethod: endpoint({
    method: 'PUT',
    path: '/pro/payout-method',
    auth: 'user',
    body: PayoutMethodBodySchema,
    response: PayoutMethodViewSchema,
  }),
};
