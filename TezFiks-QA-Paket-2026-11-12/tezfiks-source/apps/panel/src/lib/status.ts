/**
 * StatusBadge mapping: every status enum of the contract -> translation key + colour tone.
 * Families labelled in `common.json` use `common.<family>.<VALUE>`; the rest live in `panel.status.<family>.<VALUE>`.
 */
import {
  AssignmentStatus,
  CaseStatus,
  HoldStatus,
  InvoiceStatus,
  MemberStatus,
  OfferStatus,
  PaymentStatus,
  PayoutStatus,
  ProjectStatus,
  QuoteStatus,
  RequestStatus,
  SlotStatus,
  UserStatus,
  VerificationStatus,
} from '@tezfiks/shared';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'progress' | 'neutral';

export const STATUS_FAMILIES = {
  requestStatus: RequestStatus.values,
  assignmentStatus: AssignmentStatus.values,
  verificationStatus: VerificationStatus.values,
  paymentStatus: PaymentStatus.values,
  payoutStatus: PayoutStatus.values,
  caseStatus: CaseStatus.values,
  projectStatus: ProjectStatus.values,
  quoteStatus: QuoteStatus.values,
  invoiceStatus: InvoiceStatus.values,
  offerStatus: OfferStatus.values,
  slotStatus: SlotStatus.values,
  userStatus: UserStatus.values,
  holdStatus: HoldStatus.values,
  memberStatus: MemberStatus.values,
} as const;

export type StatusFamily = keyof typeof STATUS_FAMILIES;
export type StatusOf<F extends StatusFamily> = (typeof STATUS_FAMILIES)[F][number];

/** Families whose labels are in common.json (shared with the mobile apps). */
const COMMON_FAMILIES: ReadonlySet<StatusFamily> = new Set<StatusFamily>([
  'requestStatus',
  'assignmentStatus',
  'verificationStatus',
  'paymentStatus',
  'payoutStatus',
  'caseStatus',
  'projectStatus',
  'quoteStatus',
  'invoiceStatus',
]);

const TONES: { [F in StatusFamily]: Record<StatusOf<F>, StatusTone> } = {
  requestStatus: {
    SEARCHING: 'warning',
    ASSIGNED: 'info',
    IN_PROGRESS: 'progress',
    COMPLETED: 'success',
    CANCELLED: 'danger',
    EXPIRED: 'neutral',
  },
  assignmentStatus: {
    ACCEPTED: 'info',
    EN_ROUTE: 'progress',
    ARRIVED: 'progress',
    PRICE_PROPOSED: 'warning',
    PRICE_DISPUTED: 'danger',
    COMPLETED: 'success',
    CANCELLED_FREE: 'neutral',
    CANCELLED_BY_PROVIDER: 'danger',
    CANCELLED_BY_CUSTOMER: 'danger',
    DECLINED_ON_ARRIVAL: 'danger',
    NO_SHOW: 'danger',
  },
  verificationStatus: {
    DRAFT: 'neutral',
    PENDING_REVIEW: 'warning',
    APPROVED: 'success',
    REJECTED: 'danger',
    BLOCKED: 'danger',
  },
  paymentStatus: { CREATED: 'warning', SUCCEEDED: 'success', FAILED: 'danger', CANCELLED: 'neutral' },
  payoutStatus: { PENDING: 'warning', PAID: 'success', FAILED: 'danger' },
  caseStatus: {
    OPEN: 'warning',
    IN_REVIEW: 'info',
    REDISPATCHED: 'progress',
    RESOLVED: 'success',
    REJECTED: 'neutral',
  },
  projectStatus: {
    OPEN: 'warning',
    AWARDED: 'info',
    IN_PROGRESS: 'progress',
    COMPLETED: 'success',
    INVOICED: 'info',
    PAID: 'success',
    CANCELLED: 'danger',
    EXPIRED: 'neutral',
  },
  quoteStatus: {
    SUBMITTED: 'info',
    ACCEPTED: 'success',
    REJECTED: 'danger',
    WITHDRAWN: 'neutral',
    EXPIRED: 'neutral',
  },
  invoiceStatus: { ISSUED: 'warning', PAID: 'success', VOID: 'neutral' },
  offerStatus: {
    SENT: 'warning',
    ACCEPTED: 'success',
    DECLINED: 'danger',
    EXPIRED: 'neutral',
    CLOSED: 'neutral',
  },
  slotStatus: { OPEN: 'warning', FILLED: 'info', DONE: 'success', CANCELLED: 'danger', UNFILLED: 'neutral' },
  userStatus: { ACTIVE: 'success', BLOCKED: 'danger', DELETED: 'neutral' },
  holdStatus: { ACTIVE: 'warning', CAPTURED: 'success', RELEASED: 'neutral' },
  memberStatus: { ACTIVE: 'success', REMOVED: 'neutral' },
};

export interface StatusPresentation {
  /** Full translation key, e.g. "common.requestStatus.SEARCHING" or "panel.status.offerStatus.SENT". */
  labelKey: string;
  tone: StatusTone;
}

export function statusPresentation<F extends StatusFamily>(
  family: F,
  status: StatusOf<F> | (string & {}),
): StatusPresentation {
  const tones = TONES[family] as Record<string, StatusTone>;
  const known = Object.prototype.hasOwnProperty.call(tones, status);
  const ns = COMMON_FAMILIES.has(family) ? `common.${family}` : `panel.status.${family}`;
  return {
    labelKey: known ? `${ns}.${status}` : 'panel.status.unknown',
    tone: known ? tones[status] : 'neutral',
  };
}

/** Tailwind classes per tone (board 05 palette: primary #00A971, accent #F59E0B, danger #E5484D). */
export const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'bg-primary/10 text-primary-strong ring-primary/25',
  warning: 'bg-accent/12 text-accent-strong ring-accent/30',
  danger: 'bg-danger/10 text-danger ring-danger/25',
  info: 'bg-info/10 text-info ring-info/25',
  progress: 'bg-ink/8 text-ink ring-ink/20',
  neutral: 'bg-muted text-muted-foreground ring-border',
};
