/** Contract-valid admin API responses (checked against the shared zod schemas in admin-fixtures.test.ts). */
import { DEFAULT_SETTINGS, type FileKind } from '@tezfiks/shared';

export const AID = {
  request: '0a1b2c3d-1111-4111-8111-000000000001',
  request2: '0a1b2c3d-1111-4111-8111-000000000002',
  handyman: '0a1b2c3d-2222-4222-8222-000000000001',
  handyman2: '0a1b2c3d-2222-4222-8222-000000000002',
  user: '0a1b2c3d-3333-4333-8333-000000000001',
  user2: '0a1b2c3d-3333-4333-8333-000000000002',
  company: '0a1b2c3d-4444-4444-8444-000000000001',
  account: '0a1b2c3d-5555-4555-8555-000000000001',
  assignment: '0a1b2c3d-6666-4666-8666-000000000001',
  file: (n: number) => `0a1b2c3d-7777-4777-8777-${String(n).padStart(12, '0')}`,
  submission: '0a1b2c3d-8888-4888-8888-000000000001',
  category: '0a1b2c3d-9999-4999-8999-000000000001',
  group: '0a1b2c3d-9999-4999-8999-000000000002',
  case: '0a1b2c3d-aaaa-4aaa-8aaa-000000000001',
  admin: '22222222-2222-4222-8222-222222222222',
  admin2: '0a1b2c3d-bbbb-4bbb-8bbb-000000000001',
  wallet: '0a1b2c3d-cccc-4ccc-8ccc-000000000001',
};

const T = '2026-09-01T08:30:00.000Z';

export const requestRow = {
  id: AID.request,
  number: 2847,
  customerName: 'Nizami T.',
  providerName: 'Elvin M.',
  categoryName: 'Santexnik',
  status: 'IN_PROGRESS' as const,
  assignmentStatus: 'EN_ROUTE' as const,
  timing: 'NOW' as const,
  slots: 1,
  fee: 1000,
  createdAt: T,
  isBot: false,
};

export const dashboard = {
  date: '2026-09-01',
  ordersToday: 142,
  ordersYesterday: 127,
  ordersDeltaPct: 12,
  activeHandymen: 87,
  onlineHandymen: 34,
  feeRevenueToday: 142_000,
  feeOrdersToday: 142,
  cancelRate: 0.063,
  cancelRateDelta: -0.011,
  pendingKyc: 9,
  pendingCompanies: 0,
  openCases: 2,
  recentOrders: [
    requestRow,
    {
      ...requestRow,
      id: AID.request2,
      number: 2844,
      customerName: 'Leyla A.',
      providerName: null,
      categoryName: 'Malyar',
      status: 'SEARCHING' as const,
      assignmentStatus: null,
      fee: 0,
    },
  ],
};

export const publicConfig = {
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
  otpChannel: 'dev',
};

export const handymanRow = {
  id: AID.handyman,
  userId: AID.user,
  firstName: 'Elvin',
  lastName: 'Məmmədov',
  phone: '+994501234567',
  kind: 'SOLO' as const,
  companyName: null,
  trades: ['Santexnik'],
  ratingAvg: 4.9,
  completedCount: 348,
  walletBalance: 3400,
  status: 'APPROVED' as const,
  displayStatus: 'ACTIVE' as const,
  isOnline: true,
  strikes: 0,
  isBot: false,
  createdAt: T,
};

export const pendingHandymanRow = {
  ...handymanRow,
  id: AID.handyman2,
  userId: AID.user2,
  firstName: 'Samir',
  lastName: 'Quliyev',
  trades: ['Malyar'],
  ratingAvg: null,
  completedCount: 0,
  walletBalance: 0,
  status: 'PENDING_REVIEW' as const,
  displayStatus: 'PENDING' as const,
  isOnline: false,
};

export const handymenPage = {
  items: [handymanRow, pendingHandymanRow],
  nextCursor: null,
  counts: { all: 312, pending: 9, blocked: 4 },
};

const fileRef = (n: number, kind: FileKind, contentType = 'image/jpeg') => ({
  id: AID.file(n),
  kind,
  url: `http://api.test/tezfix/api/files/${AID.file(n)}?exp=1767225600&sig=sig${n}&a=admin`,
  contentType,
  width: 1200,
  height: 800,
});

export const kycView = {
  submissionId: AID.submission,
  status: 'PENDING_REVIEW' as const,
  submittedAt: T,
  files: {
    idFront: fileRef(1, 'KYC_ID_FRONT'),
    idBack: fileRef(2, 'KYC_ID_BACK'),
    selfieFront: fileRef(3, 'KYC_SELFIE'),
    selfieTurn: fileRef(4, 'KYC_SELFIE_TURN'),
    selfieBlink: fileRef(5, 'KYC_SELFIE_BLINK'),
    tradeProofs: [fileRef(6, 'KYC_TRADE_PROOF', 'application/pdf')],
    companyDocs: [],
  },
  selfieChecks: null,
  consent: { policyVersion: '2026-10', locale: 'az', acceptedAt: T },
  extracted: null,
  reviewedAt: null,
  reviewerName: null,
  rejectReason: null,
};

export const wallet = {
  accountId: AID.wallet,
  currency: 'AZN',
  posted: 3400,
  held: 1000,
  available: 2400,
  isDebt: false,
  lowBalance: false,
};

export const assignmentRow = {
  id: AID.assignment,
  requestId: AID.request,
  requestNumber: 2847,
  status: 'EN_ROUTE' as const,
  providerType: 'SOLO' as const,
  providerName: 'Elvin Məmmədov',
  providerPhone: '+994501234567',
  companyName: null,
  customerName: 'Nizami Tağıyev',
  customerPhone: '+994552223344',
  acceptedAt: T,
  completedAt: null,
  cancelledAt: null,
  cancelledBy: null,
  price: null,
  paymentMethod: null,
  fee: { amount: 1000, captured: true, refunded: false },
  contactUnlockedAt: null,
  etaSec: 420,
};

export const handymanDetail = {
  row: { ...pendingHandymanRow, strikes: 1 },
  photo: null,
  base: { lat: 40.4093, lng: 49.8671 },
  serviceRadiusKm: 10,
  rejectReason: null,
  kyc: kycView,
  recentAssignments: [assignmentRow],
  strikes: [
    { id: AID.file(90), reason: 'Gəlmədi', requestNumber: 2801, createdAt: T, clearedAt: null },
  ],
  wallet,
  earningsBalance: 5000,
};

export const settingsResponse = {
  settings: { ...DEFAULT_SETTINGS, requestFee: 1000 },
  defaults: DEFAULT_SETTINGS,
  demoMode: true,
};

export const adminUsers = {
  items: [
    { id: AID.admin, email: 'admin@tezfiks.az', name: 'Aysel Admin', role: 'ADMIN' as const, active: true, createdAt: T, lastLoginAt: T },
    { id: AID.admin2, email: 'op@tezfiks.az', name: 'Operator', role: 'OPERATOR' as const, active: true, createdAt: T, lastLoginAt: null },
  ],
};

export const categories = {
  items: [
    {
      id: AID.group,
      slug: 'ev-temiri',
      parentId: null,
      vertical: 'HOME' as const,
      kind: 'GROUP' as const,
      name: 'Ev təmiri',
      names: { az: 'Ev təmiri', ru: 'Ремонт дома', en: 'Home repair' },
      icon: null,
      featured: false,
      flow: 'INSTANT' as const,
      emergencyAllowed: false,
      sortOrder: 0,
      active: true,
      keywords: [],
    },
    {
      id: AID.category,
      slug: 'santexnik',
      parentId: AID.group,
      vertical: 'HOME' as const,
      kind: 'SERVICE' as const,
      name: 'Santexnik',
      names: { az: 'Santexnik', ru: 'Сантехник', en: 'Plumber' },
      icon: 'water-pump',
      featured: true,
      flow: 'INSTANT' as const,
      emergencyAllowed: true,
      sortOrder: 1,
      active: true,
      keywords: ['kran'],
    },
  ],
};

export const liveMap = {
  serverNow: T,
  handymen: [
    {
      id: AID.handyman,
      name: 'Elvin M.',
      lat: 40.41,
      lng: 49.86,
      isOnline: true,
      busy: false,
      cell7: null,
      isBot: false,
      companyName: null,
      lastSeenAt: T,
    },
  ],
  requests: [
    {
      id: AID.request,
      number: 2847,
      lat: 40.4,
      lng: 49.85,
      status: 'SEARCHING' as const,
      isSearching: true,
      timing: 'NOW' as const,
      categoryName: 'Santexnik',
      cells: ['872d1a8c5ffffff'],
    },
  ],
};

export const demoState = {
  enabled: true,
  config: {
    autoAccept: true,
    acceptDelaySec: 5,
    speedKmh: 40,
    autoArrive: true,
    autoPrice: true,
    priceLabor: 3000,
    priceMaterials: 500,
  },
  bots: [
    {
      handymanId: AID.handyman2,
      name: 'Bot Usta 1',
      lat: 40.4,
      lng: 49.86,
      busy: false,
      trades: ['Santexnik'],
      companyName: null,
    },
  ],
};

export const requestDetail = {
  request: {
    id: AID.request,
    number: 2847,
    status: 'SEARCHING' as const,
    timing: 'NOW' as const,
    scheduledAt: null,
    category: { id: AID.category, slug: 'santexnik', name: 'Santexnik', icon: 'water-pump', vertical: 'HOME' as const },
    slotsRequested: 2,
    slotsFilled: 1,
    isSearching: true,
    isGuaranteeFix: false,
    createdAt: T,
    addressText: 'Nizami küç. 10',
    descriptionShort: 'Kran axır',
    description: 'Mətbəxdə kran axır',
    photos: [],
    providerPreference: 'ANY' as const,
    address: {
      lat: 40.4,
      lng: 49.85,
      formatted: 'Nizami küç. 10, Bakı',
      placeId: null,
      district: 'Səbail',
      street: 'Nizami',
      building: '10',
      block: null,
      entrance: '2',
      floor: '5',
      apartment: '21',
      intercom: null,
      note: null,
    },
    slots: [
      { index: 0, status: 'FILLED' as const, assignmentId: AID.assignment },
      { index: 1, status: 'OPEN' as const, assignmentId: null },
    ],
    assignments: [],
    search: {
      step: 2,
      ring: 1,
      wide: false,
      cells: ['872d1a8c5ffffff', 'not-a-cell'],
      startedAt: T,
      endsAt: T,
      offersSent: 3,
    },
    emergencyFee: null,
    cancelledAt: null,
    cancelReason: null,
    canCancel: true,
    cancelPenaltyPreview: 1500,
  },
  customer: {
    accountId: AID.account,
    userId: AID.user2,
    name: 'Nizami Tağıyev',
    phone: '+994552223344',
    type: 'INDIVIDUAL' as const,
    companyName: null,
  },
  assignments: [assignmentRow],
  offers: [
    {
      id: AID.file(50),
      target: 'HANDYMAN' as const,
      handymanName: 'Elvin Məmmədov',
      companyName: null,
      step: 1,
      ring: 0,
      status: 'ACCEPTED' as const,
      sentAt: T,
      respondedAt: T,
      distanceM: 1500,
    },
  ],
  ledger: [
    {
      id: AID.file(60),
      kind: 'REQUEST_FEE_CAPTURE' as const,
      createdAt: T,
      memo: 'fee-capture',
      actor: null,
      requestNumber: 2847,
      entries: [
        { accountId: AID.wallet, ownerType: 'HANDYMAN' as const, ownerId: AID.handyman, ownerName: 'Elvin Məmmədov', accountKind: 'WALLET' as const, amount: -1000, balanceAfter: 2400 },
        { accountId: AID.file(61), ownerType: 'PLATFORM' as const, ownerId: null, ownerName: 'TezFiks', accountKind: 'REVENUE' as const, amount: 1000, balanceAfter: 142000 },
      ],
    },
  ],
  timeline: [
    { at: '2026-09-01T08:31:00.000Z', event: 'accepted', actor: 'Elvin Məmmədov', details: null },
    { at: T, event: 'created', actor: 'Nizami Tağıyev', details: null },
    { at: '2026-09-01T08:32:00.000Z', event: 'custom.unknown_event', actor: null, details: 'x' },
  ],
};

// ------------------------------------------------- Şirkətlər / Müştərilər ---

export const companyRow = {
  id: AID.company,
  name: 'Usta Servis MMC',
  voen: '1234567891',
  legalForm: 'MMC' as const,
  status: 'PENDING_REVIEW' as const,
  ownerName: 'Rəşad Əliyev',
  ownerPhone: '+994507654321',
  membersCount: 6,
  walletBalance: 12_500,
  ratingAvg: 4.7,
  strikes: 0,
  createdAt: T,
};

export const companiesPage = {
  items: [
    companyRow,
    { ...companyRow, id: AID.account, name: 'Təmir Pro ASC', voen: '9876543210', legalForm: 'ASC' as const, status: 'APPROVED' as const },
  ],
  nextCursor: null,
  counts: { all: 21, pending: 3, blocked: 1 },
};

export const customerRow = {
  id: AID.account,
  userId: AID.user2,
  name: 'Nizami Tağıyev',
  phone: '+994552223344',
  type: 'COMPANY' as const,
  companyName: 'Azər Holdinq',
  requestsCount: 17,
  walletBalance: -1500,
  ratingAvg: 4.8,
  userStatus: 'ACTIVE' as const,
  createdAt: T,
};

export const customersPage = {
  items: [
    customerRow,
    {
      ...customerRow,
      id: AID.wallet,
      userId: AID.user,
      name: 'Leyla Əhmədova',
      phone: '+994701112233',
      type: 'INDIVIDUAL' as const,
      companyName: null,
      walletBalance: 0,
    },
  ],
  nextCursor: null,
};

export const customerDetail = {
  row: customerRow,
  wallet: { ...wallet, posted: -1500, held: 0, available: -1500, isDebt: true, lowBalance: true },
  recentRequests: [requestRow],
};

// ---------------------------------------------------------------- Ödənişlər ---

export const ledgerPage = { items: requestDetail.ledger, nextCursor: null };

export const paymentsPage = {
  items: [
    {
      id: AID.file(70),
      purpose: 'JOB_PAYMENT' as const,
      amount: 4500,
      currency: 'AZN',
      status: 'SUCCEEDED' as const,
      provider: 'mock',
      createdAt: T,
      completedAt: T,
      failureReason: null,
      checkoutUrl: null,
      payerName: 'Ödəyən Müştəri',
    },
  ],
  nextCursor: null,
};

export const payoutsPage = {
  items: [
    {
      id: AID.file(80),
      amount: 25_000,
      status: 'PENDING' as const,
      periodStart: '2026-08-24T20:00:00.000Z',
      periodEnd: '2026-08-31T20:00:00.000Z',
      createdAt: T,
      paidAt: null,
      failureReason: null,
      method: { type: 'CARD' as const, maskedNumber: '**** 4242', holderName: 'ELVIN MAMMADOV', updatedAt: T },
      ownerType: 'HANDYMAN' as const,
      ownerId: AID.handyman,
      ownerName: 'Elvin Məmmədov',
    },
    {
      id: AID.file(81),
      amount: 8000,
      status: 'FAILED' as const,
      periodStart: '2026-08-24T20:00:00.000Z',
      periodEnd: '2026-08-31T20:00:00.000Z',
      createdAt: T,
      paidAt: null,
      failureReason: 'Kart bloklanıb',
      method: null,
      ownerType: 'COMPANY' as const,
      ownerId: AID.company,
      ownerName: 'Usta Servis MMC',
    },
  ],
  nextCursor: null,
};

export const invoice = {
  id: AID.file(98),
  number: 'TF-2026-000042',
  projectId: AID.file(91),
  projectNumber: 31,
  issuer: { type: 'COMPANY' as const, name: 'Usta Servis MMC', voen: '1234567891', isVatPayer: true },
  customer: { name: 'Azər Holdinq', voen: '1111111111' },
  subtotal: 100_000,
  vatRatePercent: 18,
  vatAmount: 18_000,
  total: 118_000,
  currency: 'AZN',
  status: 'ISSUED' as const,
  issuedAt: T,
  paidAt: null,
  lines: [{ description: 'Ofis təmiri işləri', amount: 100_000 }],
};

export const invoicesPage = {
  items: [invoice, { ...invoice, id: AID.file(92), number: 'TF-2026-000041', projectNumber: 30, status: 'PAID' as const, paidAt: T }],
  nextCursor: null,
};

// ---------------------------------------------------------------- Layihələr ---

export const projectRow = {
  id: AID.file(91),
  number: 31,
  status: 'INVOICED' as const,
  customerName: 'Azər Holdinq',
  categoryName: 'Ofis təmiri',
  quotesCount: 2,
  workersNeeded: 4,
  dateFrom: '2026-09-05',
  dateTo: '2026-09-07',
  createdAt: T,
};

export const projectsPage = { items: [projectRow], nextCursor: null };

const quoteProvider = (name: string, type: 'SOLO' | 'COMPANY', completedCount: number) => ({
  type,
  handymanId: type === 'SOLO' ? AID.handyman : null,
  companyId: type === 'COMPANY' ? AID.company : null,
  name,
  photo: null,
  ratingAvg: 4.6,
  ratingCount: 12,
  completedCount,
  isVatPayer: type === 'COMPANY',
});

const awardedQuote = {
  id: AID.file(93),
  projectId: AID.file(91),
  status: 'ACCEPTED' as const,
  provider: quoteProvider('Usta Servis MMC', 'COMPANY', 1),
  totalAmount: 100_000,
  workers: 4,
  days: 3,
  note: 'Material daxil deyil',
  createdAt: T,
};

const rejectedQuote = {
  ...awardedQuote,
  id: AID.file(94),
  status: 'REJECTED' as const,
  provider: quoteProvider('Elvin Məmmədov', 'SOLO', 348),
  totalAmount: 120_000,
  workers: 2,
  note: null,
};

export const projectDetail = {
  project: {
    id: AID.file(91),
    number: 31,
    status: 'INVOICED' as const,
    category: { id: AID.category, slug: 'ofis-temiri', name: 'Ofis təmiri', icon: null, vertical: 'HOME' as const },
    title: 'Ofisin təmiri',
    scope: '≈ 450 m² (3 mərtəbə, 12 otaq)',
    dateFrom: '2026-09-05',
    dateTo: '2026-09-07',
    workersNeeded: 4,
    quoteDeadline: T,
    quotesCount: 2,
    createdAt: T,
    addressText: 'Nizami küç. 10',
    description: 'Divarların rənglənməsi',
    photos: [],
    address: requestDetail.request.address,
    quotes: [awardedQuote, rejectedQuote],
    awardedQuote,
    reports: [
      {
        id: AID.file(95),
        reportDate: '2026-09-05',
        note: 'Birinci mərtəbə hazırdır',
        progressPercent: 40,
        photos: [],
        authorName: 'Rəşad Əliyev',
        createdAt: T,
      },
    ],
    invoice,
    guaranteeUntil: null,
    rated: false,
    canCancel: false,
  },
  customer: { accountId: AID.account, name: 'Azər Holdinq', phone: '+994552223344', voen: '1111111111' },
  quotes: [
    { ...awardedQuote, feeHeld: 4800, feeCaptured: true },
    { ...rejectedQuote, feeHeld: 2400, feeCaptured: false },
  ],
};

// -------------------------------------------------------------------- Audit ---

export const auditPage = {
  items: [
    {
      id: AID.file(96),
      actorType: 'ADMIN' as const,
      actorId: AID.admin,
      actorName: 'Aysel Admin',
      action: 'handyman.approve',
      entityType: 'HandymanProfile',
      entityId: AID.handyman2,
      before: { status: 'PENDING_REVIEW' },
      after: { status: 'APPROVED' },
      ip: '10.0.0.7',
      at: T,
    },
    {
      id: AID.file(97),
      actorType: 'SYSTEM' as const,
      actorId: null,
      actorName: null,
      action: 'payouts.run',
      entityType: 'Payout',
      entityId: null,
      before: null,
      after: null,
      ip: null,
      at: T,
    },
  ],
  nextCursor: null,
};
