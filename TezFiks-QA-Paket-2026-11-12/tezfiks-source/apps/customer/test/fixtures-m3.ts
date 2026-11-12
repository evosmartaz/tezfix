/* Contract-shaped fixtures for lane M3 screens (validated against the shared zod schemas in fixtures-m3.test.ts). */
import type {
  CaseView,
  ChatMessage,
  CustomerAssignment,
  InvoiceView,
  LedgerTxView,
  NotificationView,
  PaymentIntentView,
  ProjectDetail,
  ProjectSummary,
  QuoteView,
  ReportView,
  WalletSummary,
} from '@tezfiks/shared';
import { encodePolyline } from '@tezfiks/shared';
import { ADDRESS, IDS, assignment } from './fixtures';

export const M3 = {
  intent: '90000000-0000-4000-a000-000000000001',
  intent2: '90000000-0000-4000-a000-000000000002',
  assignment2: '50000000-0000-4000-a000-000000000002',
  project: 'a0000000-0000-4000-a000-000000000001',
  quoteSolo: 'b0000000-0000-4000-a000-000000000001',
  quoteCompany: 'b0000000-0000-4000-a000-000000000002',
  quoteThird: 'b0000000-0000-4000-a000-000000000003',
  report: 'c0000000-0000-4000-a000-000000000001',
  invoice: 'd0000000-0000-4000-a000-000000000001',
  company: 'e0000000-0000-4000-a000-000000000001',
  handyman2: '60000000-0000-4000-a000-000000000003',
  case: 'f0000000-0000-4000-a000-000000000001',
  notification: '11000000-0000-4000-a000-000000000001',
  notification2: '11000000-0000-4000-a000-000000000002',
  message: '12000000-0000-4000-a000-000000000001',
  message2: '12000000-0000-4000-a000-000000000002',
  tx: '13000000-0000-4000-a000-000000000001',
  tx2: '13000000-0000-4000-a000-000000000002',
  address: '80000000-0000-4000-a000-000000000002',
  /** Request owner (the signed-in customer of screen-helpers' me()). */
  customerUser: 'u1',
};

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();

/** Route from a point north-east of the address to the address (Baku). */
export const ROUTE_POINTS = [
  { lat: 40.4293, lng: 49.8871 },
  { lat: 40.4193, lng: 49.8771 },
  { lat: 40.4093, lng: 49.8671 },
];

export function enRoute(over: Partial<CustomerAssignment> = {}): CustomerAssignment {
  return assignment({
    status: 'EN_ROUTE',
    acceptedAt: iso(-10 * 60_000),
    freeCancelUntil: iso(-5 * 60_000),
    enRouteAt: iso(-8 * 60_000),
    etaSec: 720,
    distanceM: 4200,
    location: { lat: 40.4293, lng: 49.8871, heading: 200, at: iso(-30_000) },
    route: { polyline: encodePolyline(ROUTE_POINTS), durationSec: 900, distanceM: 5000, computedAt: iso(-8 * 60_000), source: 'fallback' },
    actions: { ...assignment().actions, cancel: true, cancelPenalty: 1500, reportNoShow: false },
    ...over,
  });
}

export function priced(over: Partial<CustomerAssignment> = {}): CustomerAssignment {
  return assignment({
    status: 'PRICE_PROPOSED',
    enRouteAt: iso(-60 * 60_000),
    arrivedAt: iso(-50 * 60_000),
    priceProposedAt: iso(-60_000),
    contactUnlocked: true,
    providerPhone: '+994501112233',
    chatEnabled: true,
    price: { labor: 3500, materials: 1000, total: 4500 },
    actions: { ...assignment().actions, cancel: false, confirmPrice: true, disputePrice: true },
    ...over,
  });
}

export function completed(over: Partial<CustomerAssignment> = {}): CustomerAssignment {
  return priced({
    status: 'COMPLETED',
    completedAt: iso(-30_000),
    paymentMethod: 'CARD',
    payment: { intentId: M3.intent, status: 'SUCCEEDED' },
    guaranteeUntil: '2099-11-08T10:00:00.000Z',
    actions: { ...assignment().actions, cancel: false, confirmPrice: false, disputePrice: false, tip: true, rate: true, guaranteeClaim: true },
    ...over,
  });
}

export function intent(over: Partial<PaymentIntentView> = {}): PaymentIntentView {
  return {
    id: M3.intent,
    purpose: 'JOB_PAYMENT',
    amount: 4500,
    currency: 'AZN',
    status: 'SUCCEEDED',
    provider: 'fake',
    createdAt: '2026-10-25T10:30:00.000Z',
    completedAt: '2026-10-25T10:31:00.000Z',
    failureReason: null,
    checkoutUrl: null,
    ...over,
  };
}

export function wallet(over: Partial<WalletSummary> = {}): WalletSummary {
  return { accountId: IDS.wallet, currency: 'AZN', posted: 2000, held: 500, available: 1500, isDebt: false, lowBalance: false, ...over };
}

export function tx(over: Partial<LedgerTxView> = {}): LedgerTxView {
  return {
    id: M3.tx,
    kind: 'TOPUP',
    amount: 2000,
    balanceAfter: 2000,
    createdAt: '2026-10-25T09:00:00.000Z',
    memo: null,
    requestNumber: null,
    projectNumber: null,
    ...over,
  };
}

export function message(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: M3.message,
    assignmentId: IDS.assignment,
    senderSide: 'PROVIDER',
    senderUserId: IDS.handymanUser,
    senderName: 'Elvin Məmmədov',
    body: 'Salam, 5 dəqiqəyə çatıram',
    createdAt: '2026-10-25T10:20:00.000Z',
    readAt: null,
    ...over,
  };
}

export function notification(over: Partial<NotificationView> = {}): NotificationView {
  return {
    id: M3.notification,
    type: 'ASSIGNMENT_EN_ROUTE',
    title: 'Usta yoldadır',
    body: 'Elvin M. sizə tərəf yola çıxdı',
    data: { assignmentId: IDS.assignment, requestId: IDS.request },
    readAt: null,
    createdAt: '2026-10-25T10:10:00.000Z',
    ...over,
  };
}

export function quote(over: Partial<QuoteView> = {}): QuoteView {
  return {
    id: M3.quoteSolo,
    projectId: M3.project,
    status: 'SUBMITTED',
    provider: {
      type: 'SOLO',
      handymanId: IDS.handyman,
      companyId: null,
      name: 'Elvin Məmmədov',
      photo: null,
      ratingAvg: 4.9,
      ratingCount: 120,
      completedCount: 348,
      isVatPayer: false,
    },
    totalAmount: 450000,
    workers: 3,
    days: 5,
    note: 'Materiallar daxil deyil',
    createdAt: '2026-10-25T11:00:00.000Z',
    ...over,
  };
}

export function companyQuote(over: Partial<QuoteView> = {}): QuoteView {
  return quote({
    id: M3.quoteCompany,
    provider: {
      type: 'COMPANY',
      handymanId: null,
      companyId: M3.company,
      name: 'FixPro MMC',
      photo: null,
      ratingAvg: 4.6,
      ratingCount: 40,
      completedCount: 90,
      isVatPayer: true,
    },
    totalAmount: 390000,
    workers: 4,
    days: 4,
    note: null,
    createdAt: '2026-10-25T11:30:00.000Z',
    ...over,
  });
}

export function report(over: Partial<ReportView> = {}): ReportView {
  return {
    id: M3.report,
    reportDate: '2099-10-16',
    note: 'Divarların hazırlığı bitdi',
    progressPercent: 40,
    photos: [],
    authorName: 'FixPro MMC',
    createdAt: '2099-10-16T15:00:00.000Z',
    ...over,
  };
}

export function invoice(over: Partial<InvoiceView> = {}): InvoiceView {
  return {
    id: M3.invoice,
    number: 'TF-2099-000001',
    projectId: M3.project,
    projectNumber: 501,
    issuer: { type: 'COMPANY', name: 'FixPro MMC', voen: '1400000001', isVatPayer: true },
    customer: { name: 'Kontur MMC', voen: '1234567890' },
    subtotal: 390000,
    vatRatePercent: 18,
    vatAmount: 70200,
    total: 460200,
    currency: 'AZN',
    status: 'ISSUED',
    issuedAt: '2099-10-20T10:00:00.000Z',
    paidAt: null,
    lines: [{ description: 'Ofis divarlarının rənglənməsi', amount: 390000 }],
    ...over,
  };
}

export function projectSummary(over: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    id: M3.project,
    number: 501,
    status: 'OPEN',
    category: { id: IDS.brigade, slug: 'construction-brigade', name: 'Tikinti-təmir briqadası', icon: 'account-hard-hat', vertical: 'HOME' },
    title: 'Ofisin təmiri',
    scope: '≈ 450 m² (3 mərtəbə, 12 otaq)',
    dateFrom: '2099-10-15',
    dateTo: '2099-10-19',
    workersNeeded: 3,
    quoteDeadline: '2099-10-14T10:00:00.000Z',
    quotesCount: 2,
    createdAt: '2099-10-13T10:00:00.000Z',
    addressText: 'Nizami küç. 203, Mərkəzi ofis',
    ...over,
  };
}

export function project(over: Partial<ProjectDetail> = {}): ProjectDetail {
  const s = projectSummary(over);
  return {
    ...s,
    description: 'Ofis divarlarının rənglənməsi, İçərişəhər yaxınlığı',
    photos: [],
    address: { ...ADDRESS, formatted: 'Nizami küç. 203, Mərkəzi ofis' },
    quotes: [quote(), companyQuote()],
    awardedQuote: null,
    reports: [],
    invoice: null,
    guaranteeUntil: null,
    rated: false,
    canCancel: true,
    ...over,
  };
}

export function caseView(over: Partial<CaseView> = {}): CaseView {
  return {
    id: M3.case,
    type: 'GUARANTEE',
    status: 'OPEN',
    assignmentId: IDS.assignment,
    projectId: null,
    requestNumber: 1042,
    projectNumber: null,
    description: 'Kran yenidən damcılayır',
    photos: [],
    resolutionNote: null,
    followUpRequestId: null,
    createdAt: '2026-10-26T10:00:00.000Z',
    updatedAt: '2026-10-26T10:00:00.000Z',
    ...over,
  };
}
