import { z } from 'zod';
import { endpoint } from '../define';
import { Id, IdParams, Ok } from '../common';
import { PaymentMethod } from '../../enums';
import { CustomerAssignmentSchema, CancelBodySchema } from './requests';
import { CaseViewSchema, GuaranteeClaimBodySchema } from './cases';
import { CheckoutResponseSchema } from './wallet';

export const ConfirmPriceBodySchema = z.object({
  method: PaymentMethod.schema,
  returnUrl: z.string().max(500).optional(),
});

export const ConfirmPriceResponseSchema = z.object({
  assignment: CustomerAssignmentSchema,
  /** Present for CARD: open checkoutUrl; the assignment completes when the payment succeeds. */
  payment: CheckoutResponseSchema.nullable(),
});

export const RatingBodySchema = z.object({
  stars: z.int().min(1).max(5),
  comment: z.string().trim().max(500).optional(),
});

export const TipBodySchema = z.object({
  amount: z.int().min(100).max(100_000),
  returnUrl: z.string().max(500).optional(),
});

/** Customer actions on one assigned handyman. */
export const assignmentsEndpoints = {
  get: endpoint({
    method: 'GET',
    path: '/assignments/:id',
    auth: 'user',
    params: IdParams,
    response: CustomerAssignmentSchema,
  }),
  cancel: endpoint({
    method: 'POST',
    path: '/assignments/:id/cancel',
    auth: 'user',
    params: IdParams,
    body: CancelBodySchema,
    response: CustomerAssignmentSchema,
    idempotent: true,
    summary: 'Free within 5 minutes of acceptance; afterwards 15 AZN (handyman refunded and compensated)',
  }),
  declineOnArrival: endpoint({
    method: 'POST',
    path: '/assignments/:id/decline-on-arrival',
    auth: 'user',
    params: IdParams,
    body: CancelBodySchema,
    response: CustomerAssignmentSchema,
    idempotent: true,
  }),
  reportNoShow: endpoint({
    method: 'POST',
    path: '/assignments/:id/report-no-show',
    auth: 'user',
    params: IdParams,
    response: CustomerAssignmentSchema,
    idempotent: true,
  }),
  confirmPrice: endpoint({
    method: 'POST',
    path: '/assignments/:id/confirm-price',
    auth: 'user',
    params: IdParams,
    body: ConfirmPriceBodySchema,
    response: ConfirmPriceResponseSchema,
    idempotent: true,
  }),
  disputePrice: endpoint({
    method: 'POST',
    path: '/assignments/:id/dispute-price',
    auth: 'user',
    params: IdParams,
    body: z.object({ reason: z.string().trim().min(3).max(1000) }),
    response: CustomerAssignmentSchema,
  }),
  tip: endpoint({
    method: 'POST',
    path: '/assignments/:id/tip',
    auth: 'user',
    params: IdParams,
    body: TipBodySchema,
    response: CheckoutResponseSchema,
    idempotent: true,
    summary: 'Only after an in-app (card) payment',
  }),
  rate: endpoint({
    method: 'POST',
    path: '/assignments/:id/rating',
    auth: 'user',
    params: IdParams,
    body: RatingBodySchema,
    response: Ok,
  }),
  guaranteeClaim: endpoint({
    method: 'POST',
    path: '/assignments/:id/guarantee-claim',
    auth: 'user',
    params: IdParams,
    body: GuaranteeClaimBodySchema,
    response: CaseViewSchema,
    summary: 'Card-paid jobs only, within the guarantee period',
  }),
};

export { Id };
