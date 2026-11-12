import { z } from 'zod';
import {
  AddressViewSchema,
  CategoryRefSchema,
  CustomerPublicSchema,
  FileRefSchema,
  Id,
  IsoDateTime,
  Money,
  PriceSchema,
  RouteSchema,
} from '../common';
import { ActorSide, AssignmentStatus, PaymentMethod, PaymentStatus, PayoutMethodType, PayoutStatus, ProviderType, RequestTiming } from '../../enums';

/** Provider-side view of an assignment (solo handyman, company worker, company manager). */
export const ProAssignmentSchema = z.object({
  id: Id,
  requestId: Id,
  requestNumber: z.int(),
  status: AssignmentStatus.schema,
  /** WORKER_LIMITED = company worker view (board 04): location, category, customer name/photo only. */
  view: z.enum(['FULL', 'WORKER_LIMITED']),
  providerType: ProviderType.schema,
  company: z.object({ id: Id, name: z.string() }).nullable(),
  worker: z.object({
    handymanId: Id,
    userId: Id,
    firstName: z.string(),
    lastName: z.string(),
    photo: FileRefSchema.nullable(),
    /** Only in company manager views. */
    phone: z.string().nullable(),
  }),
  timing: RequestTiming.schema,
  scheduledAt: IsoDateTime.nullable(),
  isEmergency: z.boolean(),
  isGuaranteeFix: z.boolean(),
  category: CategoryRefSchema,
  /** null in WORKER_LIMITED view. */
  description: z.string().nullable(),
  photos: z.array(FileRefSchema),
  address: AddressViewSchema,
  customer: CustomerPublicSchema,
  /** Only after contact unlock (ETA <= 5 min or arrived). */
  customerPhone: z.string().nullable(),
  contactUnlocked: z.boolean(),
  chatEnabled: z.boolean(),
  acceptedAt: IsoDateTime,
  freeCancelUntil: IsoDateTime,
  enRouteAt: IsoDateTime.nullable(),
  arrivedAt: IsoDateTime.nullable(),
  priceProposedAt: IsoDateTime.nullable(),
  completedAt: IsoDateTime.nullable(),
  cancelledAt: IsoDateTime.nullable(),
  cancelledBy: ActorSide.schema.nullable(),
  price: PriceSchema.nullable(),
  paymentMethod: PaymentMethod.schema.nullable(),
  paymentStatus: PaymentStatus.schema.nullable(),
  guaranteeUntil: IsoDateTime.nullable(),
  tipAmount: Money.nullable(),
  /** null in WORKER_LIMITED view. */
  fee: z.object({ amount: Money, captured: z.boolean(), refunded: z.boolean() }).nullable(),
  etaSec: z.int().nullable(),
  distanceM: z.int().nullable(),
  route: RouteSchema.nullable(),
  ratedCustomer: z.boolean(),
  actions: z.object({
    enRoute: z.boolean(),
    arrived: z.boolean(),
    enterPrice: z.boolean(),
    cancel: z.boolean(),
    cancelIsFree: z.boolean(),
    rateCustomer: z.boolean(),
  }),
});
export type ProAssignment = z.infer<typeof ProAssignmentSchema>;

export const PayoutMethodViewSchema = z.object({
  type: PayoutMethodType.schema,
  maskedNumber: z.string(),
  holderName: z.string(),
  updatedAt: IsoDateTime,
});
export type PayoutMethodView = z.infer<typeof PayoutMethodViewSchema>;

export const PayoutMethodBodySchema = z.object({
  type: PayoutMethodType.schema,
  /** Card: 16-19 digits. IBAN: AZ + 26 characters. The server stores only a masked copy. */
  number: z.string().trim().min(12).max(40),
  holderName: z.string().trim().min(3).max(100),
});

export const PayoutViewSchema = z.object({
  id: Id,
  amount: Money,
  status: PayoutStatus.schema,
  periodStart: IsoDateTime,
  periodEnd: IsoDateTime,
  createdAt: IsoDateTime,
  paidAt: IsoDateTime.nullable(),
  failureReason: z.string().nullable(),
  method: PayoutMethodViewSchema.nullable(),
});
export type PayoutView = z.infer<typeof PayoutViewSchema>;

export const EarningsViewSchema = z.object({
  /** Card payments and tips not yet paid out. */
  earningsBalance: Money,
  pendingPayouts: Money,
  payouts: z.array(PayoutViewSchema),
  thisWeek: z.object({ cardJobs: z.int(), cardTotal: Money, tips: Money, cashJobs: z.int(), cashTotal: Money }),
  payoutMethod: PayoutMethodViewSchema.nullable(),
});
export type EarningsView = z.infer<typeof EarningsViewSchema>;
