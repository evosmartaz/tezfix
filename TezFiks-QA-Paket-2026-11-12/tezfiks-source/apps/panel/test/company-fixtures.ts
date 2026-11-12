/** Contract-shaped fixtures for the company panel tests (lane P2). Every object passes the shared zod schemas. */
import type {
  CompanyView,
  EarningsView,
  InviteView,
  InvoiceView,
  LedgerTxView,
  MemberView,
  OfferCandidateWorker,
  OfferView,
  ProAssignment,
  ProviderProjectView,
  WalletSummary,
  WorkerLive,
} from '@tezfiks/shared';

export const CID = '33333333-3333-4333-8333-333333333333';
export const OTHER_CID = '44444444-4444-4444-8444-444444444444';

export const PID = {
  offer1: 'a1111111-1111-4111-8111-111111111111',
  offer2: 'a2222222-2222-4222-8222-222222222222',
  offer3: 'a3333333-3333-4333-8333-333333333333',
  request1: 'b1111111-1111-4111-8111-111111111111',
  request2: 'b2222222-2222-4222-8222-222222222222',
  rauf: 'c1111111-1111-4111-8111-111111111111',
  raufUser: 'c1111111-1111-4111-8111-aaaaaaaaaaaa',
  tural: 'c2222222-2222-4222-8222-222222222222',
  turalUser: 'c2222222-2222-4222-8222-aaaaaaaaaaaa',
  kamran: 'c3333333-3333-4333-8333-333333333333',
  kamranUser: 'c3333333-3333-4333-8333-aaaaaaaaaaaa',
  nijat: 'c4444444-4444-4444-8444-444444444444',
  nijatUser: 'c4444444-4444-4444-8444-aaaaaaaaaaaa',
  managerUser: '11111111-1111-4111-8111-111111111111',
  asg1: 'd1111111-1111-4111-8111-111111111111',
  asg2: 'd2222222-2222-4222-8222-222222222222',
  asg3: 'd3333333-3333-4333-8333-333333333333',
  asg4: 'd4444444-4444-4444-8444-444444444444',
  category: 'e1111111-1111-4111-8111-111111111111',
  category2: 'e2222222-2222-4222-8222-222222222222',
  invite: 'f1111111-1111-4111-8111-111111111111',
  wallet: 'f2222222-2222-4222-8222-222222222222',
  tx: 'f3333333-3333-4333-8333-333333333333',
  project: '91111111-1111-4111-8111-111111111111',
  quote: '92222222-2222-4222-8222-222222222222',
  report: '93333333-3333-4333-8333-333333333333',
  invoice: '94444444-4444-4444-8444-444444444444',
  payout: '95555555-5555-4555-8555-555555555555',
  photo: '96666666-6666-4666-8666-666666666666',
};

export const electric = {
  id: PID.category,
  slug: 'elektrik',
  name: 'Elektrik',
  icon: null,
  vertical: 'HOME' as const,
};
export const plumbing = {
  id: PID.category2,
  slug: 'santexnik',
  name: 'Santexnik',
  icon: null,
  vertical: 'HOME' as const,
};

export function candidate(over: Partial<OfferCandidateWorker> = {}): OfferCandidateWorker {
  return {
    handymanId: PID.rauf,
    userId: PID.raufUser,
    firstName: 'Rauf',
    lastName: 'Hüseynov',
    photo: null,
    ratingAvg: 4.7,
    completedCount: 58,
    distanceM: 1800,
    busy: false,
    online: true,
    hasTrade: true,
    ...over,
  };
}

export const candidates: OfferCandidateWorker[] = [
  candidate(),
  candidate({ handymanId: PID.tural, userId: PID.turalUser, firstName: 'Tural', lastName: 'Əliyev', ratingAvg: 4.5, distanceM: 3200 }),
  candidate({
    handymanId: PID.kamran,
    userId: PID.kamranUser,
    firstName: 'Kamran',
    lastName: 'Səfərov',
    ratingAvg: 4.8,
    distanceM: 5100,
    busy: true,
  }),
];

export function offer(over: Partial<OfferView> = {}): OfferView {
  return {
    id: PID.offer1,
    requestId: PID.request1,
    requestNumber: 2851,
    target: 'COMPANY',
    companyId: CID,
    status: 'SENT',
    sentAt: '2026-10-25T10:00:00.000Z',
    expiresAt: '2026-10-25T10:00:30.000Z',
    timing: 'NOW',
    scheduledAt: null,
    isEmergency: false,
    isGuaranteeFix: false,
    category: electric,
    descriptionShort: 'Rozetka dəyişimi',
    address: { district: 'Xətai', street: 'M.Hadi küç.', area: 'M.Hadi küç. 12, Xətai', lat: 40.38, lng: 49.87 },
    distanceM: 1800,
    etaMin: 7,
    customer: {
      firstName: 'Aysel',
      lastInitial: 'Q',
      ratingAvg: 4.8,
      ratingCount: 12,
      type: 'INDIVIDUAL',
      companyName: null,
    },
    fee: 1000,
    slotsOpen: 1,
    slotsRequested: 1,
    candidateWorkers: candidates,
    ...over,
  };
}

const address = {
  lat: 40.38,
  lng: 49.87,
  formatted: 'Xətai r., Məhəmməd Hadi küç. 12',
  placeId: null,
  district: 'Xətai',
  street: 'Məhəmməd Hadi küç.',
  building: '12',
  block: null,
  entrance: '2',
  floor: '5',
  apartment: '21',
  intercom: null,
  note: null,
};

export function assignment(over: Partial<ProAssignment> = {}): ProAssignment {
  return {
    id: PID.asg1,
    requestId: PID.request1,
    requestNumber: 2851,
    status: 'ACCEPTED',
    view: 'FULL',
    providerType: 'COMPANY',
    company: { id: CID, name: 'FixPro MMC' },
    worker: {
      handymanId: PID.rauf,
      userId: PID.raufUser,
      firstName: 'Rauf',
      lastName: 'Hüseynov',
      photo: null,
      phone: '+994501112233',
    },
    timing: 'NOW',
    scheduledAt: null,
    isEmergency: false,
    isGuaranteeFix: false,
    category: electric,
    description: 'Mətbəxdə rozetka yanıb, dəyişmək lazımdır',
    photos: [],
    address,
    customer: {
      firstName: 'Aysel',
      lastInitial: 'Q',
      photo: null,
      ratingAvg: 4.8,
      ratingCount: 12,
      type: 'INDIVIDUAL',
      companyName: null,
    },
    customerPhone: null,
    contactUnlocked: false,
    chatEnabled: false,
    acceptedAt: '2026-10-25T10:00:10.000Z',
    freeCancelUntil: '2026-10-25T10:05:10.000Z',
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
    distanceM: 1800,
    route: null,
    ratedCustomer: false,
    actions: { enRoute: true, arrived: true, enterPrice: false, cancel: true, cancelIsFree: true, rateCustomer: false },
    ...over,
  };
}

export const wallet: WalletSummary = {
  accountId: PID.wallet,
  currency: 'AZN',
  posted: 24000,
  held: 1000,
  available: 23000,
  isDebt: false,
  lowBalance: false,
};

export function companyView(over: Partial<CompanyView> = {}): CompanyView {
  return {
    id: CID,
    name: 'FixPro MMC',
    legalForm: 'MMC',
    voen: '1234567891',
    status: 'APPROVED',
    rejectReason: null,
    finalPriceEntry: 'MANAGER',
    isVatPayer: true,
    trades: [electric],
    base: { lat: 40.4093, lng: 49.8671 },
    baseAddress: 'Nizami küç. 10, Bakı',
    serviceRadiusKm: 15,
    ratingAvg: 4.6,
    ratingCount: 40,
    strikes: 0,
    wallet,
    earningsBalance: 56000,
    membersCount: 4,
    onlineWorkers: 2,
    myRole: 'MANAGER',
    kyc: { status: 'APPROVED', submittedAt: '2026-10-01T08:00:00.000Z', reviewedAt: '2026-10-02T08:00:00.000Z', rejectReason: null, attemptsLeft24h: 3 },
    ...over,
  };
}

export const dashboard = {
  jobsToday: 7,
  activeJobs: 3,
  onlineWorkers: 2,
  membersCount: 4,
  wallet,
  earningsBalance: 56000,
  feesToday: 7000,
  revenueToday: 42000,
};

export function member(over: Partial<MemberView> = {}): MemberView {
  return {
    userId: PID.raufUser,
    handymanId: PID.rauf,
    firstName: 'Rauf',
    lastName: 'Hüseynov',
    phone: '+994501112233',
    photo: null,
    role: 'WORKER',
    status: 'ACTIVE',
    isOnline: true,
    busy: false,
    ratingAvg: 4.7,
    completedCount: 58,
    trades: [electric],
    lastSeenAt: '2026-10-25T09:59:00.000Z',
    joinedAt: '2026-09-01T08:00:00.000Z',
    ...over,
  };
}

export const members: MemberView[] = [
  member({ userId: PID.managerUser, handymanId: null, firstName: 'Elvin', lastName: 'Məmmədov', phone: '+994501234567', role: 'MANAGER', trades: [], isOnline: false }),
  member(),
  member({ userId: PID.turalUser, handymanId: PID.tural, firstName: 'Tural', lastName: 'Əliyev', phone: '+994552223344' }),
  member({ userId: PID.kamranUser, handymanId: PID.kamran, firstName: 'Kamran', lastName: 'Səfərov', phone: '+994703334455', busy: true }),
  member({ userId: PID.nijatUser, handymanId: PID.nijat, firstName: 'Nicat', lastName: 'Quliyev', phone: '+994774445566', trades: [plumbing] }),
];

export const invite: InviteView = {
  id: PID.invite,
  token: 'tok_abcdefghijklmnop',
  url: 'https://tezfiks.az/tezfix/join/tok_abcdefghijklmnop',
  role: 'WORKER',
  expiresAt: '2026-11-01T10:00:00.000Z',
  maxUses: 10,
  usedCount: 2,
  revokedAt: null,
  createdAt: '2026-10-25T10:00:00.000Z',
};

export function workerLive(over: Partial<WorkerLive> = {}): WorkerLive {
  return {
    handymanId: PID.rauf,
    userId: PID.raufUser,
    firstName: 'Rauf',
    lastName: 'Hüseynov',
    photo: null,
    lat: 40.4,
    lng: 49.86,
    isOnline: true,
    busy: false,
    assignmentId: null,
    lastSeenAt: '2026-10-25T09:59:50.000Z',
    ...over,
  };
}

export const transactions: { items: LedgerTxView[]; nextCursor: string | null } = {
  items: [
    {
      id: PID.tx,
      kind: 'REQUEST_FEE_CAPTURE',
      amount: -1000,
      balanceAfter: 24000,
      createdAt: '2026-10-25T09:00:00.000Z',
      memo: null,
      requestNumber: 2840,
      projectNumber: null,
    },
  ],
  nextCursor: null,
};

export const earnings: EarningsView = {
  earningsBalance: 56000,
  pendingPayouts: 12000,
  payouts: [
    {
      id: PID.payout,
      amount: 12000,
      status: 'PENDING',
      periodStart: '2026-10-13T00:00:00.000Z',
      periodEnd: '2026-10-20T00:00:00.000Z',
      createdAt: '2026-10-20T05:00:00.000Z',
      paidAt: null,
      failureReason: null,
      method: null,
    },
  ],
  thisWeek: { cardJobs: 3, cardTotal: 30000, tips: 1500, cashJobs: 4, cashTotal: 26000 },
  payoutMethod: { type: 'CARD', maskedNumber: '**** 4242', holderName: 'FIXPRO MMC', updatedAt: '2026-10-01T08:00:00.000Z' },
};

export const invoice: InvoiceView = {
  id: PID.invoice,
  number: 'TF-2026-000012',
  projectId: PID.project,
  projectNumber: 120,
  issuer: { type: 'COMPANY', name: 'FixPro MMC', voen: '1234567891', isVatPayer: true },
  customer: { name: 'Bina Servis MMC', voen: '9876543210' },
  subtotal: 500000,
  vatRatePercent: 18,
  vatAmount: 90000,
  total: 590000,
  currency: 'AZN',
  status: 'ISSUED',
  issuedAt: '2026-10-25T10:00:00.000Z',
  paidAt: null,
  lines: [{ description: 'Təmir işləri', amount: 500000 }],
};

export function providerProject(over: Partial<ProviderProjectView> = {}): ProviderProjectView {
  return {
    id: PID.project,
    number: 120,
    status: 'OPEN',
    category: electric,
    title: 'Ofis elektrik xətti',
    scope: '≈ 450 m² (3 mərtəbə, 12 otaq)',
    dateFrom: '2026-11-01',
    dateTo: '2026-11-05',
    workersNeeded: 3,
    quoteDeadline: '2026-10-26T10:00:00.000Z',
    quotesCount: 2,
    createdAt: '2026-10-25T08:00:00.000Z',
    addressText: 'Nərimanov r., Atatürk pr. 45',
    description: 'Ofisdə elektrik xəttinin tam yenilənməsi',
    photos: [],
    address,
    customer: { name: 'Bina Servis MMC', type: 'COMPANY', ratingAvg: 4.9 },
    myQuote: null,
    isAwardedToMe: false,
    reports: [],
    invoice: null,
    feePerWorkerDay: 1000,
    ...over,
  };
}
