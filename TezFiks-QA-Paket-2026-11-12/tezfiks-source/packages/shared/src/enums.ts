import { z } from 'zod';

/** Builds a zod enum plus a frozen tuple from a list of string literals. */
function e<const T extends readonly [string, ...string[]]>(values: T) {
  return { values, schema: z.enum(values) } as const;
}

export const LOCALES = ['az', 'ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const LocaleSchema = z.enum(LOCALES);
export const DEFAULT_LOCALE: Locale = 'az';

export function asLocale(value: string | null | undefined): Locale {
  const v = (value ?? '').slice(0, 2).toLowerCase();
  return (LOCALES as readonly string[]).includes(v) ? (v as Locale) : DEFAULT_LOCALE;
}

export const UserStatus = e(['ACTIVE', 'BLOCKED', 'DELETED']);
export type UserStatus = (typeof UserStatus.values)[number];

/** Which client a session belongs to. PANEL = company web panel (phone login), ADMIN = TezFiks admin panel. */
export const AppKind = e(['CUSTOMER', 'PRO', 'PANEL', 'ADMIN']);
export type AppKind = (typeof AppKind.values)[number];

export const CustomerType = e(['INDIVIDUAL', 'COMPANY']);
export type CustomerType = (typeof CustomerType.values)[number];

export const Vertical = e(['HOME', 'AUTO']);
export type Vertical = (typeof Vertical.values)[number];

export const CategoryKind = e(['GROUP', 'SERVICE']);
export type CategoryKind = (typeof CategoryKind.values)[number];

/** INSTANT = normal request/dispatch flow; QUOTE = B2B project with quotes (board D). */
export const CategoryFlow = e(['INSTANT', 'QUOTE']);
export type CategoryFlow = (typeof CategoryFlow.values)[number];

export const HandymanKind = e(['SOLO', 'COMPANY_WORKER']);
export type HandymanKind = (typeof HandymanKind.values)[number];

export const VerificationStatus = e(['DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'BLOCKED']);
export type VerificationStatus = (typeof VerificationStatus.values)[number];

export const CompanyRole = e(['MANAGER', 'WORKER']);
export type CompanyRole = (typeof CompanyRole.values)[number];

export const MemberStatus = e(['ACTIVE', 'REMOVED']);
export type MemberStatus = (typeof MemberStatus.values)[number];

/** Company setting "Yekun qiyməti kim daxil edir?" (who enters the final price). */
export const FinalPriceEntry = e(['WORKER', 'MANAGER']);
export type FinalPriceEntry = (typeof FinalPriceEntry.values)[number];

/** Azerbaijani legal forms: MMC (LLC), ASC (OJSC), QSC (CJSC), FS (individual entrepreneur), OTHER. */
export const LegalForm = e(['MMC', 'ASC', 'QSC', 'FS', 'OTHER']);
export type LegalForm = (typeof LegalForm.values)[number];

export const RequestTiming = e(['NOW', 'SCHEDULED', 'EMERGENCY']);
export type RequestTiming = (typeof RequestTiming.values)[number];

export const ProviderPreference = e(['ANY', 'INDIVIDUAL', 'COMPANY']);
export type ProviderPreference = (typeof ProviderPreference.values)[number];

export const RequestStatus = e(['SEARCHING', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED']);
export type RequestStatus = (typeof RequestStatus.values)[number];

export const SlotStatus = e(['OPEN', 'FILLED', 'DONE', 'CANCELLED', 'UNFILLED']);
export type SlotStatus = (typeof SlotStatus.values)[number];

export const OfferStatus = e(['SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CLOSED']);
export type OfferStatus = (typeof OfferStatus.values)[number];

export const OfferTarget = e(['HANDYMAN', 'COMPANY']);
export type OfferTarget = (typeof OfferTarget.values)[number];

export const OfferCloseReason = e(['TAKEN', 'EXPIRED', 'CANCELLED', 'SEARCH_ENDED', 'DECLINED']);
export type OfferCloseReason = (typeof OfferCloseReason.values)[number];

export const ProviderType = e(['SOLO', 'COMPANY']);
export type ProviderType = (typeof ProviderType.values)[number];

export const AssignmentStatus = e([
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'PRICE_PROPOSED',
  'PRICE_DISPUTED',
  'COMPLETED',
  'CANCELLED_FREE',
  'CANCELLED_BY_PROVIDER',
  'CANCELLED_BY_CUSTOMER',
  'DECLINED_ON_ARRIVAL',
  'NO_SHOW',
]);
export type AssignmentStatus = (typeof AssignmentStatus.values)[number];

/** Assignment states in which the provider is still working on the job. */
export const ACTIVE_ASSIGNMENT_STATUSES = [
  'ACCEPTED',
  'EN_ROUTE',
  'ARRIVED',
  'PRICE_PROPOSED',
  'PRICE_DISPUTED',
] as const satisfies readonly AssignmentStatus[];

/** States in which a provider counts as busy for dispatch (cannot receive new live offers). */
export const BUSY_ASSIGNMENT_STATUSES = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED'] as const satisfies readonly AssignmentStatus[];

export const TERMINAL_ASSIGNMENT_STATUSES = [
  'COMPLETED',
  'CANCELLED_FREE',
  'CANCELLED_BY_PROVIDER',
  'CANCELLED_BY_CUSTOMER',
  'DECLINED_ON_ARRIVAL',
  'NO_SHOW',
] as const satisfies readonly AssignmentStatus[];

export function isTerminalAssignment(status: AssignmentStatus): boolean {
  return (TERMINAL_ASSIGNMENT_STATUSES as readonly string[]).includes(status);
}

export const ActorSide = e(['CUSTOMER', 'PROVIDER', 'ADMIN', 'SYSTEM']);
export type ActorSide = (typeof ActorSide.values)[number];

export const PaymentMethod = e(['CASH', 'CARD']);
export type PaymentMethod = (typeof PaymentMethod.values)[number];

export const RatingDirection = e(['CUSTOMER_TO_PROVIDER', 'PROVIDER_TO_CUSTOMER']);
export type RatingDirection = (typeof RatingDirection.values)[number];

export const CaseType = e(['GUARANTEE', 'PRICE_DISPUTE', 'REPORT']);
export type CaseType = (typeof CaseType.values)[number];

export const CaseStatus = e(['OPEN', 'IN_REVIEW', 'REDISPATCHED', 'RESOLVED', 'REJECTED']);
export type CaseStatus = (typeof CaseStatus.values)[number];

export const ProjectStatus = e([
  'OPEN',
  'AWARDED',
  'IN_PROGRESS',
  'COMPLETED',
  'INVOICED',
  'PAID',
  'CANCELLED',
  'EXPIRED',
]);
export type ProjectStatus = (typeof ProjectStatus.values)[number];

export const QuoteStatus = e(['SUBMITTED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED']);
export type QuoteStatus = (typeof QuoteStatus.values)[number];

export const InvoiceStatus = e(['ISSUED', 'PAID', 'VOID']);
export type InvoiceStatus = (typeof InvoiceStatus.values)[number];

export const LedgerOwnerType = e(['CUSTOMER_ACCOUNT', 'HANDYMAN', 'COMPANY', 'PLATFORM']);
export type LedgerOwnerType = (typeof LedgerOwnerType.values)[number];

export const LedgerAccountKind = e([
  'WALLET',
  'EARNINGS',
  'REVENUE',
  'PROMO',
  'EXTERNAL',
  'PAYOUTS_IN_TRANSIT',
  'ADJUSTMENTS',
]);
export type LedgerAccountKind = (typeof LedgerAccountKind.values)[number];

export const LedgerTxKind = e([
  'TOPUP',
  'ADMIN_ADJUSTMENT',
  'REQUEST_FEE_CAPTURE',
  'REQUEST_FEE_REFUND',
  'EMERGENCY_FEE_CAPTURE',
  'EMERGENCY_FEE_REFUND',
  'CANCEL_PENALTY',
  'PENALTY_COMPENSATION',
  'JOB_PAYMENT',
  'TIP',
  'B2B_FEE_CAPTURE',
  'INVOICE_PAYMENT',
  'PAYOUT_CREATED',
  'PAYOUT_PAID',
  'PAYOUT_FAILED',
]);
export type LedgerTxKind = (typeof LedgerTxKind.values)[number];

export const HoldKind = e(['REQUEST_FEE', 'EMERGENCY_FEE', 'B2B_QUOTE_FEE']);
export type HoldKind = (typeof HoldKind.values)[number];

export const HoldStatus = e(['ACTIVE', 'CAPTURED', 'RELEASED']);
export type HoldStatus = (typeof HoldStatus.values)[number];

export const PaymentPurpose = e(['WALLET_TOPUP', 'JOB_PAYMENT', 'TIP', 'INVOICE']);
export type PaymentPurpose = (typeof PaymentPurpose.values)[number];

export const PaymentStatus = e(['CREATED', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
export type PaymentStatus = (typeof PaymentStatus.values)[number];

export const PayoutStatus = e(['PENDING', 'PAID', 'FAILED']);
export type PayoutStatus = (typeof PayoutStatus.values)[number];

export const PayoutOwnerType = e(['HANDYMAN', 'COMPANY']);
export type PayoutOwnerType = (typeof PayoutOwnerType.values)[number];

export const PayoutMethodType = e(['CARD', 'IBAN']);
export type PayoutMethodType = (typeof PayoutMethodType.values)[number];

export const FileKind = e([
  'PROFILE_PHOTO',
  'REQUEST_PHOTO',
  'KYC_ID_FRONT',
  'KYC_ID_BACK',
  'KYC_SELFIE',
  'KYC_SELFIE_TURN',
  'KYC_SELFIE_BLINK',
  'KYC_TRADE_PROOF',
  'COMPANY_DOC',
  'REPORT_PHOTO',
  'CASE_PHOTO',
]);
export type FileKind = (typeof FileKind.values)[number];

export const KYC_FILE_KINDS = [
  'KYC_ID_FRONT',
  'KYC_ID_BACK',
  'KYC_SELFIE',
  'KYC_SELFIE_TURN',
  'KYC_SELFIE_BLINK',
  'KYC_TRADE_PROOF',
  'COMPANY_DOC',
] as const satisfies readonly FileKind[];

export function isKycFileKind(kind: FileKind): boolean {
  return (KYC_FILE_KINDS as readonly string[]).includes(kind);
}

export const NotificationType = e([
  'OFFER_NEW',
  'OFFER_CLOSED',
  'REQUEST_ASSIGNED',
  'REQUEST_EXPIRED',
  'REQUEST_CANCELLED',
  'ASSIGNMENT_EN_ROUTE',
  'ASSIGNMENT_NEAR',
  'ASSIGNMENT_ARRIVED',
  'ASSIGNMENT_CANCELLED',
  'PRICE_PROPOSED',
  'ASSIGNMENT_COMPLETED',
  'PAYMENT_SUCCEEDED',
  'TIP_RECEIVED',
  'RATING_RECEIVED',
  'CHAT_MESSAGE',
  'WORKER_ASSIGNED',
  'KYC_APPROVED',
  'KYC_REJECTED',
  'COMPANY_APPROVED',
  'COMPANY_REJECTED',
  'ACCOUNT_BLOCKED',
  'SCHEDULED_REMINDER',
  'SCHEDULED_UNFILLED',
  'WALLET_LOW',
  'WALLET_TOPUP',
  'PAYOUT_PAID',
  'PROJECT_NEW',
  'QUOTE_RECEIVED',
  'QUOTE_ACCEPTED',
  'QUOTE_REJECTED',
  'PROJECT_REPORT',
  'INVOICE_ISSUED',
  'INVOICE_PAID',
  'CASE_UPDATED',
  'GENERIC',
]);
export type NotificationType = (typeof NotificationType.values)[number];

export const AdminRole = e(['ADMIN', 'OPERATOR']);
export type AdminRole = (typeof AdminRole.values)[number];

export const AiConfidence = e(['high', 'medium', 'low']);
export type AiConfidence = (typeof AiConfidence.values)[number];

export const DevicePlatform = e(['android', 'ios', 'web']);
export type DevicePlatform = (typeof DevicePlatform.values)[number];

export const PushProvider = e(['EXPO', 'FCM']);
export type PushProvider = (typeof PushProvider.values)[number];
