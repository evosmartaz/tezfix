import { z } from 'zod';
import { endpoint } from '../define';
import { Id, IdParams, IsoDateTime, Money } from '../common';
import { PaymentPurpose, PaymentStatus } from '../../enums';

export const PaymentIntentViewSchema = z.object({
  id: Id,
  purpose: PaymentPurpose.schema,
  amount: Money,
  currency: z.string(),
  status: PaymentStatus.schema,
  provider: z.string(),
  createdAt: IsoDateTime,
  completedAt: IsoDateTime.nullable(),
  failureReason: z.string().nullable(),
  checkoutUrl: z.string().nullable(),
});
export type PaymentIntentView = z.infer<typeof PaymentIntentViewSchema>;

export const paymentsEndpoints = {
  get: endpoint({
    method: 'GET',
    path: '/payments/:id',
    auth: 'any',
    params: IdParams,
    response: PaymentIntentViewSchema,
  }),
  checkoutPage: endpoint({
    method: 'GET',
    path: '/pay/checkout/:id',
    auth: 'none',
    params: IdParams,
    query: z.object({ t: z.string() }),
    response: z.unknown(),
    raw: 'html',
    summary: 'Hosted TEST checkout page (fake provider). 4242 4242 4242 4242 succeeds, 4000 0000 0000 0002 declines.',
  }),
  checkoutSubmit: endpoint({
    method: 'POST',
    path: '/pay/checkout/:id',
    auth: 'none',
    params: IdParams,
    response: z.unknown(),
    raw: 'redirect',
    summary: 'Form post from the test checkout page; redirects to the returnUrl',
  }),
};
