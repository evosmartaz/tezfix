/** View types of the admin contract (inferred from the shared zod schemas; the contract exports only some of them). */
import type { z } from 'zod';
import type {
  AdminCaseDetailSchema,
  AdminCaseRowSchema,
  AdminCompanyDetailSchema,
  AdminCompanyRowSchema,
  AdminCustomerDetailSchema,
  AdminCustomerRowSchema,
  AdminDashboardSchema,
  AdminHandymanDetailSchema,
  AdminKycViewSchema,
  AdminOfferRowSchema,
  AdminPaymentRowSchema,
  AdminPayoutRowSchema,
  AdminProjectDetailSchema,
  AdminProjectRowSchema,
  AdminRequestDetailSchema,
  AdminUserViewSchema,
  AuditRowSchema,
  DemoStateSchema,
  LiveMapSchema,
  StrikeViewSchema,
} from '@tezfiks/shared';

export type AdminDashboard = z.infer<typeof AdminDashboardSchema>;
export type AdminRequestDetail = z.infer<typeof AdminRequestDetailSchema>;
export type AdminOfferRow = z.infer<typeof AdminOfferRowSchema>;
export type AdminKycView = z.infer<typeof AdminKycViewSchema>;
export type AdminStrike = z.infer<typeof StrikeViewSchema>;
export type AdminHandymanDetail = z.infer<typeof AdminHandymanDetailSchema>;
export type AdminCompanyRow = z.infer<typeof AdminCompanyRowSchema>;
export type AdminCompanyDetail = z.infer<typeof AdminCompanyDetailSchema>;
export type AdminCustomerRow = z.infer<typeof AdminCustomerRowSchema>;
export type AdminCustomerDetail = z.infer<typeof AdminCustomerDetailSchema>;
export type AdminPaymentRow = z.infer<typeof AdminPaymentRowSchema>;
export type AdminPayoutRow = z.infer<typeof AdminPayoutRowSchema>;
export type AdminCaseRow = z.infer<typeof AdminCaseRowSchema>;
export type AdminCaseDetail = z.infer<typeof AdminCaseDetailSchema>;
export type AdminProjectRow = z.infer<typeof AdminProjectRowSchema>;
export type AdminProjectDetail = z.infer<typeof AdminProjectDetailSchema>;
export type AdminUserView = z.infer<typeof AdminUserViewSchema>;
export type AuditRow = z.infer<typeof AuditRowSchema>;
export type LiveMap = z.infer<typeof LiveMapSchema>;
export type DemoState = z.infer<typeof DemoStateSchema>;
