/* Contract-shaped fixtures for the customer app tests (validated against the shared zod schemas in fixtures.test.ts). */
import type { Category, CustomerAccount, RequestDetail, RequestSummary } from '@tezfiks/shared';

let n = 0;
export function uuid(): string {
  n += 1;
  return `00000000-0000-4000-a000-${String(n).padStart(12, '0')}`;
}

/** Stable ids so tests can reference them. */
export const IDS = {
  homeSystems: '10000000-0000-4000-a000-000000000001',
  finishing: '10000000-0000-4000-a000-000000000002',
  autoGroup: '10000000-0000-4000-a000-000000000003',
  construction: '10000000-0000-4000-a000-000000000004',
  plumbing: '20000000-0000-4000-a000-000000000001',
  electrical: '20000000-0000-4000-a000-000000000002',
  ac: '20000000-0000-4000-a000-000000000003',
  heating: '20000000-0000-4000-a000-000000000004',
  locks: '20000000-0000-4000-a000-000000000005',
  painting: '20000000-0000-4000-a000-000000000006',
  furniture: '20000000-0000-4000-a000-000000000007',
  battery: '20000000-0000-4000-a000-000000000008',
  towing: '20000000-0000-4000-a000-000000000009',
  brigade: '20000000-0000-4000-a000-00000000000a',
  inactive: '20000000-0000-4000-a000-00000000000b',
  account: '30000000-0000-4000-a000-000000000001',
  wallet: '30000000-0000-4000-a000-000000000002',
  request: '40000000-0000-4000-a000-000000000001',
  request2: '40000000-0000-4000-a000-000000000002',
  assignment: '50000000-0000-4000-a000-000000000001',
  handyman: '60000000-0000-4000-a000-000000000001',
  handymanUser: '60000000-0000-4000-a000-000000000002',
  file: '70000000-0000-4000-a000-000000000001',
  address: '80000000-0000-4000-a000-000000000001',
};

type CatInput = Partial<Category> & { id: string; slug: string; az: string; ru: string; en: string };

function cat(c: CatInput): Category {
  const { az, ru, en, ...rest } = c;
  return {
    parentId: null,
    vertical: 'HOME',
    kind: 'SERVICE',
    name: az,
    names: { az, ru, en },
    icon: null,
    featured: false,
    flow: 'INSTANT',
    emergencyAllowed: false,
    sortOrder: 0,
    active: true,
    keywords: [],
    ...rest,
  };
}

export function categories(): Category[] {
  return [
    cat({ id: IDS.homeSystems, slug: 'home-systems', az: 'Ev sistemləri', ru: 'Инженерные системы', en: 'Home systems', kind: 'GROUP', icon: 'home-lightning-bolt', sortOrder: 1 }),
    cat({ id: IDS.finishing, slug: 'finishing', az: 'Tamamlama və dizayn', ru: 'Отделка и дизайн', en: 'Finishing & design', kind: 'GROUP', icon: 'palette', sortOrder: 2 }),
    cat({ id: IDS.construction, slug: 'construction', az: 'Tikinti və təmir', ru: 'Строительство и ремонт', en: 'Construction', kind: 'GROUP', icon: 'hammer', sortOrder: 0 }),
    cat({ id: IDS.autoGroup, slug: 'auto', az: 'Avto xidmətlər', ru: 'Автоуслуги', en: 'Car services', kind: 'GROUP', vertical: 'AUTO', icon: 'car', sortOrder: 1 }),
    cat({
      id: IDS.plumbing,
      slug: 'plumbing',
      parentId: IDS.homeSystems,
      az: 'Santexnik',
      ru: 'Сантехник',
      en: 'Plumber',
      icon: 'pipe-wrench',
      featured: true,
      emergencyAllowed: true,
      sortOrder: 1,
      keywords: ['kran', 'su', 'boru', 'sızma', 'кран', 'течь', 'faucet', 'leak'],
    }),
    cat({ id: IDS.electrical, slug: 'electrical', parentId: IDS.homeSystems, az: 'Elektrik', ru: 'Электрик', en: 'Electrician', icon: 'flash', featured: true, emergencyAllowed: true, sortOrder: 2, keywords: ['rozetka', 'işıq', 'розетка'] }),
    cat({ id: IDS.ac, slug: 'air-conditioning', parentId: IDS.homeSystems, az: 'Kondisioner', ru: 'Кондиционеры', en: 'Air conditioning', icon: 'air-conditioner', featured: true, sortOrder: 3 }),
    cat({ id: IDS.heating, slug: 'heating', parentId: IDS.homeSystems, az: 'Kombi / istilik', ru: 'Котлы и отопление', en: 'Boilers & heating', icon: 'radiator', sortOrder: 4, keywords: ['kombi'] }),
    cat({ id: IDS.locks, slug: 'doors-locks', parentId: IDS.homeSystems, az: 'Qapı-kilid', ru: 'Двери и замки', en: 'Doors & locks', icon: 'not-a-real-icon', featured: true, sortOrder: 5, keywords: ['qapı', 'kilid', 'açar'] }),
    cat({ id: IDS.painting, slug: 'painting', parentId: IDS.finishing, az: 'Malyar', ru: 'Маляр', en: 'Painter', icon: 'format-paint', featured: true, sortOrder: 1, keywords: ['boya', 'rəngləmə', 'divar'] }),
    cat({ id: IDS.furniture, slug: 'furniture', parentId: IDS.finishing, az: 'Mebel ustası', ru: 'Мебельщик', en: 'Furniture', icon: 'sofa', featured: true, sortOrder: 2, keywords: ['mebel', 'şkaf'] }),
    cat({ id: IDS.brigade, slug: 'construction-brigade', parentId: IDS.construction, az: 'Tikinti-təmir briqadası', ru: 'Ремонтная бригада', en: 'Renovation crew', icon: 'account-hard-hat', flow: 'QUOTE', sortOrder: 1 }),
    cat({ id: IDS.inactive, slug: 'old-service', parentId: IDS.homeSystems, az: 'Köhnə xidmət', ru: 'Старая услуга', en: 'Old service', active: false, sortOrder: 9 }),
    cat({ id: IDS.battery, slug: 'battery', parentId: IDS.autoGroup, vertical: 'AUTO', az: 'Akkumulyator', ru: 'Аккумулятор', en: 'Battery', icon: 'car-battery', featured: true, emergencyAllowed: true, sortOrder: 1, keywords: ['akkumulyator', 'аккумулятор'] }),
    cat({ id: IDS.towing, slug: 'towing', parentId: IDS.autoGroup, vertical: 'AUTO', az: 'Təkər / Vulkan', ru: 'Шиномонтаж', en: 'Tyres', icon: 'tire', featured: false, sortOrder: 2, keywords: ['təkər', 'şin'] }),
  ];
}

export function account(over: Partial<CustomerAccount> = {}): CustomerAccount {
  return {
    id: IDS.account,
    type: 'INDIVIDUAL',
    companyName: null,
    voen: null,
    legalForm: null,
    contactPerson: null,
    ratingAvg: null,
    ratingCount: 0,
    wallet: { accountId: IDS.wallet, currency: 'AZN', posted: 2000, held: 0, available: 2000, isDebt: false, lowBalance: false },
    ...over,
  };
}

export function summary(over: Partial<RequestSummary> = {}): RequestSummary {
  return {
    id: IDS.request,
    number: 1042,
    status: 'SEARCHING',
    timing: 'NOW',
    scheduledAt: null,
    category: { id: IDS.plumbing, slug: 'plumbing', name: 'Santexnik', icon: 'pipe-wrench', vertical: 'HOME' },
    slotsRequested: 1,
    slotsFilled: 0,
    isSearching: true,
    isGuaranteeFix: false,
    createdAt: '2026-10-25T10:00:00.000Z',
    addressText: 'Atatürk pr. 45, Nərimanov',
    descriptionShort: 'Mətbəxdə kran damcılayır',
    ...over,
  };
}

export const ADDRESS = {
  lat: 40.4093,
  lng: 49.8671,
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
};

export function detail(over: Partial<RequestDetail> = {}): RequestDetail {
  const s = summary(over);
  return {
    ...s,
    description: 'Mətbəxdə kran damcılayır, sifon da yoxlanmalıdır',
    photos: [],
    providerPreference: 'ANY',
    address: ADDRESS,
    slots: [{ index: 0, status: 'OPEN', assignmentId: null }],
    assignments: [],
    search: {
      step: 1,
      ring: 1,
      wide: false,
      cells: [],
      startedAt: '2026-10-25T10:00:00.000Z',
      endsAt: '2099-01-01T00:00:00.000Z',
      offersSent: 3,
    },
    emergencyFee: null,
    cancelledAt: null,
    cancelReason: null,
    canCancel: true,
    cancelPenaltyPreview: 0,
    ...over,
  };
}

export function assignment(over: Partial<RequestDetail['assignments'][number]> = {}): RequestDetail['assignments'][number] {
  return {
    id: IDS.assignment,
    requestId: IDS.request,
    slotIndex: 0,
    status: 'ACCEPTED',
    provider: {
      type: 'SOLO',
      handymanId: IDS.handyman,
      userId: IDS.handymanUser,
      firstName: 'Elvin',
      lastName: 'Məmmədov',
      photo: null,
      ratingAvg: 4.9,
      ratingCount: 120,
      completedCount: 348,
      trades: ['Santexnik'],
      company: null,
    },
    acceptedAt: '2026-10-25T10:01:00.000Z',
    freeCancelUntil: '2026-10-25T10:06:00.000Z',
    enRouteAt: null,
    arrivedAt: null,
    priceProposedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelledBy: null,
    etaSec: null,
    distanceM: null,
    location: null,
    route: null,
    contactUnlocked: false,
    providerPhone: null,
    chatEnabled: false,
    price: null,
    paymentMethod: null,
    payment: null,
    guaranteeUntil: null,
    tipAmount: null,
    rated: false,
    actions: {
      cancel: true,
      cancelPenalty: 0,
      declineOnArrival: false,
      declinePenalty: 1500,
      reportNoShow: false,
      confirmPrice: false,
      disputePrice: false,
      tip: false,
      rate: false,
      guaranteeClaim: false,
    },
    ...over,
  };
}

export const PUBLIC_CONFIG = {
  demoMode: false,
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
  aiEnabled: true,
  mapsEnabled: false,
  otpChannel: 'console',
};
