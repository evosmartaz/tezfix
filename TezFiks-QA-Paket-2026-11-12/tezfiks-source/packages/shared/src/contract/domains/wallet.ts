import { z } from 'zod';
import { endpoint } from '../define';
import { Id, IsoDateTime, Money, PageQuery, paginated } from '../common';
import { LedgerTxKind } from '../../enums';

export const WalletSummarySchema = z.object({
  accountId: Id,
  currency: z.string(),
  /** Posted balance (can be negative for a customer in debt). */
  posted: Money,
  /** Sum of active holds. */
  held: Money,
  /** posted - held */
  available: Money,
  isDebt: z.boolean(),
  /** available < lowBalanceThreshold (providers cannot accept when available < request fee). */
  lowBalance: z.boolean(),
});
export type WalletSummary = z.infer<typeof WalletSummarySchema>;

export const WalletOwner = z.enum(['customer', 'handyman']);
export const WalletOwnerQuery = z.object({ owner: WalletOwner.optional() });

export const LedgerTxViewSchema = z.object({
  id: Id,
  kind: LedgerTxKind.schema,
  /** Signed amount for this account (+ credit, - debit). */
  amount: Money,
  balanceAfter: Money,
  createdAt: IsoDateTime,
  memo: z.string().nullable(),
  requestNumber: z.int().nullable(),
  projectNumber: z.int().nullable(),
});
export type LedgerTxView = z.infer<typeof LedgerTxViewSchema>;

export const TopupBodySchema = z.object({
  /** qəpik, 1 AZN .. 1000 AZN */
  amount: z.int().min(100).max(100_000),
  owner: WalletOwner.optional(),
  /** Where the test checkout redirects afterwards (app deep link or panel URL). */
  returnUrl: z.string().max(500).optional(),
});

export const CheckoutResponseSchema = z.object({ paymentIntentId: Id, checkoutUrl: z.string() });
export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>;

export const walletEndpoints = {
  get: endpoint({
    method: 'GET',
    path: '/wallet',
    auth: 'user',
    query: WalletOwnerQuery,
    response: WalletSummarySchema,
    summary: 'Own wallet (customer wallet in the customer app, handyman wallet in the pro app unless owner is given)',
  }),
  transactions: endpoint({
    method: 'GET',
    path: '/wallet/transactions',
    auth: 'user',
    query: PageQuery.extend({ owner: WalletOwner.optional() }),
    response: paginated(LedgerTxViewSchema),
  }),
  topup: endpoint({
    method: 'POST',
    path: '/wallet/topup',
    auth: 'user',
    body: TopupBodySchema,
    response: CheckoutResponseSchema,
    idempotent: true,
    summary: 'Creates a test-mode payment intent; open checkoutUrl to pay',
  }),
};
