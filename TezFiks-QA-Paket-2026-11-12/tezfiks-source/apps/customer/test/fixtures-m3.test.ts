import {
  CaseViewSchema,
  ChatMessageSchema,
  CustomerAssignmentSchema,
  InvoiceViewSchema,
  LedgerTxViewSchema,
  NotificationViewSchema,
  PaymentIntentViewSchema,
  ProjectDetailSchema,
  ProjectSummarySchema,
  WalletSummarySchema,
} from '@tezfiks/shared';
import { caseView, completed, enRoute, intent, invoice, message, notification, priced, project, projectSummary, report, tx, wallet } from './fixtures-m3';

describe('lane M3 fixtures match the contract', () => {
  it.each([
    ['en-route assignment', CustomerAssignmentSchema, enRoute()],
    ['priced assignment', CustomerAssignmentSchema, priced()],
    ['completed assignment', CustomerAssignmentSchema, completed()],
    ['payment intent', PaymentIntentViewSchema, intent()],
    ['wallet', WalletSummarySchema, wallet()],
    ['ledger tx', LedgerTxViewSchema, tx()],
    ['chat message', ChatMessageSchema, message()],
    ['notification', NotificationViewSchema, notification()],
    ['project summary', ProjectSummarySchema, projectSummary()],
    ['project detail', ProjectDetailSchema, project({ reports: [report()], invoice: invoice() })],
    ['invoice', InvoiceViewSchema, invoice()],
    ['case', CaseViewSchema, caseView()],
  ])('%s', (_name, schema, value) => {
    const res = (schema as { safeParse(v: unknown): { success: boolean; error?: unknown } }).safeParse(value);
    expect(res.error ?? null).toBeNull();
    expect(res.success).toBe(true);
  });
});
