/* Contract-shaped fixtures for pro app tests. */
import type { Category, OfferView, ProProfile, ProProfileResponse } from '@tezfiks/shared';

export const T0 = Date.parse('2026-10-25T10:00:00.000Z');
export const iso = (ms: number) => new Date(ms).toISOString();

export function offer(over: Partial<OfferView> = {}): OfferView {
  return {
    id: 'o1',
    requestId: 'r1',
    requestNumber: 2847,
    target: 'HANDYMAN',
    companyId: null,
    status: 'SENT',
    sentAt: iso(T0),
    expiresAt: iso(T0 + 30_000),
    timing: 'NOW',
    scheduledAt: null,
    isEmergency: false,
    isGuaranteeFix: false,
    category: { id: '00000000-0000-4000-8000-0000000000c1', slug: 'kran-temiri', name: 'Santexnik — kran təmiri', icon: 'water-pump', vertical: 'HOME' },
    descriptionShort: 'Mətbəxdə kran damcılayır',
    address: { district: 'Nərimanov', street: 'Atatürk pr.', area: 'Atatürk pr. 45, Nərimanov', lat: 40.402, lng: 49.871 },
    distanceM: 2400,
    etaMin: 12,
    customer: { firstName: 'Nizami', lastInitial: 'T', ratingAvg: 4.8, ratingCount: 12, type: 'INDIVIDUAL', companyName: null },
    fee: 1000,
    slotsOpen: 1,
    slotsRequested: 1,
    candidateWorkers: [],
    ...over,
  };
}

export function category(over: Partial<Category> & { id: string }): Category {
  return {
    slug: over.id,
    parentId: null,
    vertical: 'HOME',
    kind: 'SERVICE',
    name: over.id,
    names: { az: over.name ?? over.id, ru: over.name ?? over.id, en: over.name ?? over.id },
    icon: null,
    featured: false,
    flow: 'INSTANT',
    emergencyAllowed: true,
    sortOrder: 0,
    active: true,
    keywords: [],
    ...over,
  };
}

export const CATEGORIES: Category[] = [
  category({ id: '00000000-0000-4000-8000-0000000000a1', kind: 'GROUP', name: 'Santexnika', sortOrder: 1 }),
  category({ id: '00000000-0000-4000-8000-0000000000a2', kind: 'GROUP', name: 'Elektrik', sortOrder: 2 }),
  category({ id: '00000000-0000-4000-8000-0000000000c1', parentId: '00000000-0000-4000-8000-0000000000a1', name: 'Kran təmiri', sortOrder: 1, keywords: ['su', 'kran'] }),
  category({ id: '00000000-0000-4000-8000-0000000000c2', parentId: '00000000-0000-4000-8000-0000000000a1', name: 'Boru dəyişimi', sortOrder: 2 }),
  category({ id: '00000000-0000-4000-8000-0000000000c3', parentId: '00000000-0000-4000-8000-0000000000a2', name: 'Rozetka dəyişimi', sortOrder: 1 }),
  category({ id: '00000000-0000-4000-8000-0000000000c4', parentId: '00000000-0000-4000-8000-0000000000a2', name: 'Köhnə xidmət', active: false }),
];

export function proProfile(over: Partial<ProProfile> = {}): ProProfile {
  return {
    id: 'h1',
    userId: 'u1',
    kind: 'SOLO',
    status: 'APPROVED',
    rejectReason: null,
    firstName: 'Elvin',
    lastName: 'Məmmədov',
    photo: null,
    company: null,
    trades: [{ id: '00000000-0000-4000-8000-0000000000c1', slug: 'kran-temiri', name: 'Santexnik', icon: null, vertical: 'HOME' }],
    serviceRadiusKm: 10,
    base: { lat: 40.4093, lng: 49.8671 },
    isOnline: false,
    ratingAvg: 4.7,
    ratingCount: 20,
    completedCount: 31,
    strikes: 0,
    wallet: { accountId: 'a1', currency: 'AZN', posted: 3400, held: 0, available: 3400, isDebt: false, lowBalance: false },
    earningsBalance: 12000,
    kyc: { status: 'APPROVED', submittedAt: null, reviewedAt: null, rejectReason: null, attemptsLeft24h: 3 },
    ...over,
  };
}

export function profileResponse(over: Partial<ProProfileResponse> = {}): ProProfileResponse {
  return { profile: proProfile(), managedCompanies: [], ...over };
}

export const PUBLIC_CONFIG = {
  demoMode: true,
  requestFee: 1000,
  emergencyFeePerSlot: 500,
  cancelPenalty: 1500,
  freeCancelSec: 300,
  offerTtlSec: 30,
  maxSlots: 10,
  maxPhotos: 5,
  guaranteeDays: 14,
  scheduledMinLeadMin: 30,
  scheduledMaxLeadDays: 30,
  contactUnlockEtaSec: 300,
  lowBalanceThreshold: 1000,
  currency: 'AZN',
  supportPhone: null,
  aiEnabled: false,
  mapsEnabled: false,
  otpChannel: 'console',
};

/* ---- Lane M4 fixtures: assignments, companies, wallets, projects ---- */
import type {
  CompanyView,
  EarningsView,
  LedgerTxView,
  MemberView,
  OfferCandidateWorker,
  ProAssignment,
  ProviderProjectView,
  WalletSummary,
} from '@tezfiks/shared';

export const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function assignment(over: Partial<ProAssignment> = {}): ProAssignment {
  return {
    id: ID(500),
    requestId: ID(600),
    requestNumber: 2847,
    status: 'ACCEPTED',
    view: 'FULL',
    providerType: 'SOLO',
    company: null,
    worker: { handymanId: ID(1), userId: ID(2), firstName: 'Elvin', lastName: 'Məmmədov', photo: null, phone: null },
    timing: 'NOW',
    scheduledAt: null,
    isEmergency: false,
    isGuaranteeFix: false,
    category: { id: ID(700), slug: 'kran', name: 'Santexnik — kran təmiri', icon: null, vertical: 'HOME' },
    description: 'Mətbəxdə kran damcılayır',
    photos: [],
    address: {
      lat: 40.402,
      lng: 49.871,
      formatted: 'Atatürk pr. 45, Nərimanov',
      placeId: null,
      district: 'Nərimanov',
      street: 'Atatürk pr.',
      building: '45',
      block: null,
      entrance: '2',
      floor: '5',
      apartment: '12',
      intercom: null,
      note: null,
    },
    customer: { firstName: 'Nizami', lastInitial: 'T', photo: null, ratingAvg: 4.8, ratingCount: 12, type: 'INDIVIDUAL', companyName: null },
    customerPhone: null,
    contactUnlocked: false,
    chatEnabled: false,
    acceptedAt: '2026-10-25T10:02:00.000Z',
    freeCancelUntil: '2026-10-25T10:07:00.000Z',
    enRouteAt: null,
    arrivedAt: null,
    priceProposedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    price: null,
    paymentMethod: null,
    paymentStatus: null,
    guaranteeUntil: null,
    tipAmount: null,
    fee: { amount: 1000, captured: false, refunded: false },
    etaSec: null,
    distanceM: null,
    route: null,
    ratedCustomer: false,
    actions: actionsFor(over.status ?? 'ACCEPTED', over.ratedCustomer ?? false),
    ...over,
  };
}

/** Server-side `actions` for a solo handyman in each status (spec 6.3). */
export function actionsFor(status: ProAssignment['status'], rated = false): ProAssignment['actions'] {
  return {
    enRoute: status === 'ACCEPTED',
    arrived: status === 'ACCEPTED' || status === 'EN_ROUTE',
    enterPrice: status === 'ARRIVED',
    cancel: status === 'ACCEPTED' || status === 'EN_ROUTE',
    cancelIsFree: status === 'ACCEPTED' || status === 'EN_ROUTE',
    rateCustomer: status === 'COMPLETED' && !rated,
  };
}

export function wallet(available: number, over: Partial<WalletSummary> = {}): WalletSummary {
  return { accountId: ID(900), currency: 'AZN', posted: available, held: 0, available, isDebt: false, lowBalance: available < 1000, ...over };
}

export function companyView(over: Partial<CompanyView> = {}): CompanyView {
  return {
    id: ID(9),
    name: 'FixPro MMC',
    legalForm: 'MMC',
    voen: '1234567890',
    status: 'APPROVED',
    rejectReason: null,
    finalPriceEntry: 'MANAGER',
    isVatPayer: false,
    trades: [],
    base: { lat: 40.4093, lng: 49.8671 },
    baseAddress: 'Xətai r., M.Hadi küç. 12',
    serviceRadiusKm: 15,
    ratingAvg: 4.6,
    ratingCount: 10,
    strikes: 0,
    wallet: wallet(24000),
    earningsBalance: 50000,
    membersCount: 3,
    onlineWorkers: 2,
    myRole: 'MANAGER',
    kyc: { status: 'APPROVED', submittedAt: null, reviewedAt: null, rejectReason: null, attemptsLeft24h: 3 },
    ...over,
  };
}

export function candidate(n: number, over: Partial<OfferCandidateWorker> = {}): OfferCandidateWorker {
  return {
    handymanId: ID(100 + n),
    userId: ID(200 + n),
    firstName: `Usta${n}`,
    lastName: 'Əliyev',
    photo: null,
    ratingAvg: 4.5,
    completedCount: 10,
    distanceM: 1000 * n,
    busy: false,
    online: true,
    hasTrade: true,
    ...over,
  };
}

export function member(n: number, over: Partial<MemberView> = {}): MemberView {
  return {
    userId: ID(200 + n),
    handymanId: ID(100 + n),
    firstName: `Usta${n}`,
    lastName: 'Əliyev',
    phone: '+994501112233',
    photo: null,
    role: 'WORKER',
    status: 'ACTIVE',
    isOnline: true,
    busy: false,
    ratingAvg: 4.5,
    completedCount: 10,
    trades: [],
    lastSeenAt: null,
    joinedAt: '2026-10-01T10:00:00.000Z',
    ...over,
  };
}

export function ledgerTx(n: number, over: Partial<LedgerTxView> = {}): LedgerTxView {
  return {
    id: ID(1000 + n),
    kind: 'REQUEST_FEE_CAPTURE',
    amount: -1000,
    balanceAfter: 3400,
    createdAt: '2026-10-25T10:02:00.000Z',
    memo: null,
    requestNumber: 2847,
    projectNumber: null,
    ...over,
  };
}

export function earnings(over: Partial<EarningsView> = {}): EarningsView {
  return {
    earningsBalance: 12000,
    pendingPayouts: 0,
    payouts: [],
    thisWeek: { cardJobs: 2, cardTotal: 9000, tips: 500, cashJobs: 3, cashTotal: 15000 },
    payoutMethod: null,
    ...over,
  };
}

export function providerProject(over: Partial<ProviderProjectView> = {}): ProviderProjectView {
  return {
    id: ID(3000),
    number: 105,
    status: 'OPEN',
    category: { id: ID(3100), slug: 'temir-briqadasi', name: 'Tikinti-təmir briqadası', icon: null, vertical: 'HOME' },
    title: 'Ofis təmiri',
    scope: '≈ 450 m² (3 mərtəbə, 12 otaq)',
    dateFrom: '2026-11-01',
    dateTo: '2026-11-03',
    workersNeeded: 4,
    quoteDeadline: '2099-01-01T00:00:00.000Z',
    quotesCount: 1,
    createdAt: '2026-10-25T09:00:00.000Z',
    addressText: 'Nəsimi r., Bakı',
    description: 'Üç mərtəbəli ofisin daxili təmiri',
    photos: [],
    address: {
      lat: 40.38,
      lng: 49.83,
      formatted: 'Nəsimi r., Bakı',
      placeId: null,
      district: 'Nəsimi',
      street: null,
      building: null,
      block: null,
      entrance: null,
      floor: null,
      apartment: null,
      intercom: null,
      note: null,
    },
    customer: { name: 'Azər Holdinq', type: 'COMPANY', ratingAvg: null },
    myQuote: null,
    isAwardedToMe: false,
    reports: [],
    invoice: null,
    feePerWorkerDay: 1000,
    ...over,
  };
}
