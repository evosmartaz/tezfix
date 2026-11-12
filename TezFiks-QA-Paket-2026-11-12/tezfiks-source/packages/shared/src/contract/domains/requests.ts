import { z } from 'zod';
import { endpoint } from '../define';
import {
  AddressInputSchema,
  AddressViewSchema,
  CategoryRefSchema,
  FileRefSchema,
  Id,
  IdParams,
  IsoDateTime,
  LiveLocationSchema,
  Money,
  PageQuery,
  PriceSchema,
  RouteSchema,
  paginated,
} from '../common';
import {
  ActorSide,
  AiConfidence,
  AssignmentStatus,
  PaymentMethod,
  PaymentStatus,
  ProviderPreference,
  ProviderType,
  RequestStatus,
  RequestTiming,
  SlotStatus,
  Vertical,
} from '../../enums';

export const ClassifyPhotoBodySchema = z.object({
  fileId: Id,
  note: z.string().trim().max(300).optional(),
  vertical: Vertical.schema.optional(),
});

export const ClassifyPhotoResponseSchema = z.object({
  /** ok = confident pick; unsure = show the picker with candidates; unavailable = AI not configured or failed. */
  status: z.enum(['ok', 'unsure', 'unavailable']),
  categoryId: Id.nullable(),
  slug: z.string().nullable(),
  confidence: AiConfidence.schema.nullable(),
  candidates: z.array(z.object({ categoryId: Id, slug: z.string(), name: z.string() })),
});
export type ClassifyPhotoResponse = z.infer<typeof ClassifyPhotoResponseSchema>;

export const CreateRequestBodySchema = z
  .object({
    categoryId: Id,
    description: z.string().trim().min(3).max(2000),
    photoFileIds: z.array(Id).max(10).default([]),
    timing: RequestTiming.schema,
    /** Required for SCHEDULED. */
    scheduledAt: IsoDateTime.optional(),
    /** Number of handymen requested. */
    slots: z.int().min(1).max(50).default(1),
    /** Only company customers may choose INDIVIDUAL or COMPANY; others are forced to ANY. */
    providerPreference: ProviderPreference.schema.default('ANY'),
    address: AddressInputSchema,
    /** Save the address to the address book under this label. */
    saveAddressLabel: z.string().trim().max(60).optional(),
  })
  .refine((v) => v.timing !== 'SCHEDULED' || !!v.scheduledAt, {
    message: 'scheduledAt is required for scheduled requests',
    path: ['scheduledAt'],
  });
export type CreateRequestBody = z.input<typeof CreateRequestBodySchema>;

export const RequestSearchStateSchema = z.object({
  step: z.int(),
  ring: z.int(),
  wide: z.boolean(),
  /** H3 resolution-7 cells covered so far (for the pulsing hexagon animation). */
  cells: z.array(z.string()),
  startedAt: IsoDateTime,
  endsAt: IsoDateTime,
  offersSent: z.int(),
});
export type RequestSearchState = z.infer<typeof RequestSearchStateSchema>;

export const ProviderPublicSchema = z.object({
  type: ProviderType.schema,
  handymanId: Id,
  userId: Id,
  firstName: z.string(),
  lastName: z.string(),
  photo: FileRefSchema.nullable(),
  ratingAvg: z.number().nullable(),
  ratingCount: z.int(),
  completedCount: z.int(),
  trades: z.array(z.string()),
  company: z.object({ id: Id, name: z.string() }).nullable(),
});
export type ProviderPublic = z.infer<typeof ProviderPublicSchema>;

/** Customer-side view of one assigned handyman (board 02 B5/C1). */
export const CustomerAssignmentSchema = z.object({
  id: Id,
  requestId: Id,
  slotIndex: z.int(),
  status: AssignmentStatus.schema,
  provider: ProviderPublicSchema,
  acceptedAt: IsoDateTime,
  freeCancelUntil: IsoDateTime,
  enRouteAt: IsoDateTime.nullable(),
  arrivedAt: IsoDateTime.nullable(),
  priceProposedAt: IsoDateTime.nullable(),
  completedAt: IsoDateTime.nullable(),
  cancelledAt: IsoDateTime.nullable(),
  cancelledBy: ActorSide.schema.nullable(),
  etaSec: z.int().nullable(),
  distanceM: z.int().nullable(),
  location: LiveLocationSchema.nullable(),
  route: RouteSchema.nullable(),
  contactUnlocked: z.boolean(),
  /** Only after contact unlock. */
  providerPhone: z.string().nullable(),
  chatEnabled: z.boolean(),
  price: PriceSchema.nullable(),
  paymentMethod: PaymentMethod.schema.nullable(),
  payment: z.object({ intentId: Id, status: PaymentStatus.schema }).nullable(),
  guaranteeUntil: IsoDateTime.nullable(),
  tipAmount: Money.nullable(),
  rated: z.boolean(),
  actions: z.object({
    cancel: z.boolean(),
    /** What cancelling now would cost (0 inside the free window). */
    cancelPenalty: Money,
    declineOnArrival: z.boolean(),
    declinePenalty: Money,
    reportNoShow: z.boolean(),
    confirmPrice: z.boolean(),
    disputePrice: z.boolean(),
    tip: z.boolean(),
    rate: z.boolean(),
    guaranteeClaim: z.boolean(),
  }),
});
export type CustomerAssignment = z.infer<typeof CustomerAssignmentSchema>;

export const SlotViewSchema = z.object({ index: z.int(), status: SlotStatus.schema, assignmentId: Id.nullable() });

export const RequestSummarySchema = z.object({
  id: Id,
  number: z.int(),
  status: RequestStatus.schema,
  timing: RequestTiming.schema,
  scheduledAt: IsoDateTime.nullable(),
  category: CategoryRefSchema,
  slotsRequested: z.int(),
  slotsFilled: z.int(),
  isSearching: z.boolean(),
  isGuaranteeFix: z.boolean(),
  createdAt: IsoDateTime,
  addressText: z.string(),
  descriptionShort: z.string(),
});
export type RequestSummary = z.infer<typeof RequestSummarySchema>;

export const RequestDetailSchema = RequestSummarySchema.extend({
  description: z.string(),
  photos: z.array(FileRefSchema),
  providerPreference: ProviderPreference.schema,
  address: AddressViewSchema,
  slots: z.array(SlotViewSchema),
  assignments: z.array(CustomerAssignmentSchema),
  search: RequestSearchStateSchema.nullable(),
  emergencyFee: z.object({ perSlot: Money, total: Money, captured: Money }).nullable(),
  cancelledAt: IsoDateTime.nullable(),
  cancelReason: z.string().nullable(),
  canCancel: z.boolean(),
  /** Total the customer would pay if the whole request were cancelled now. */
  cancelPenaltyPreview: Money,
});
export type RequestDetail = z.infer<typeof RequestDetailSchema>;

export const CancelBodySchema = z.object({ reason: z.string().trim().max(300).optional() });

export const requestsEndpoints = {
  classifyPhoto: endpoint({
    method: 'POST',
    path: '/requests/classify-photo',
    auth: 'user',
    body: ClassifyPhotoBodySchema,
    response: ClassifyPhotoResponseSchema,
    summary: '"Şəkil ilə tap": Claude Haiku picks the category from an uploaded REQUEST_PHOTO',
  }),
  create: endpoint({
    method: 'POST',
    path: '/requests',
    auth: 'user',
    body: CreateRequestBodySchema,
    response: RequestDetailSchema,
    idempotent: true,
    summary: 'Creates a request and starts dispatch. EMERGENCY holds 5 AZN per slot on the customer wallet.',
  }),
  list: endpoint({
    method: 'GET',
    path: '/requests',
    auth: 'user',
    query: PageQuery.extend({ scope: z.enum(['active', 'history']).optional() }),
    response: paginated(RequestSummarySchema),
  }),
  get: endpoint({ method: 'GET', path: '/requests/:id', auth: 'user', params: IdParams, response: RequestDetailSchema }),
  cancel: endpoint({
    method: 'POST',
    path: '/requests/:id/cancel',
    auth: 'user',
    params: IdParams,
    body: CancelBodySchema,
    response: RequestDetailSchema,
    idempotent: true,
    summary: 'Cancels the whole request; each active assignment follows the cancellation rules',
  }),
};
