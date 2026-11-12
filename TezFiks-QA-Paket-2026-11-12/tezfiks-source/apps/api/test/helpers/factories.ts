import { latLngToCell, gridDisk } from 'h3-js';
import { normalizeAzMobile, type AppKind, type LatLng } from '@tezfiks/shared';
import type { TestApp } from './app';

let phoneSeq = 0;
/** Unique valid Azerbaijani mobile number per call (+99450xxxxxxx). */
export function randomPhone(): string {
  phoneSeq += 1;
  const n = (Date.now() % 1_000_000) * 10 + (phoneSeq % 10);
  const phone = `+99450${String(n % 10_000_000).padStart(7, '0')}`;
  return normalizeAzMobile(phone) ?? `+994501${String(phoneSeq).padStart(6, '0')}`;
}

export const BAKU = {
  center: { lat: 40.3777, lng: 49.8531 },
  /** ~2.4 km north-east of the centre (Nərimanov). */
  narimanov: { lat: 40.4026, lng: 49.8712 },
  /** ~9 km away (Əhmədli). */
  ahmadli: { lat: 40.3846, lng: 49.9604 },
};

export async function categoryId(t: TestApp, slug: string): Promise<string> {
  const c = await t.prisma.category.findUniqueOrThrow({ where: { slug } });
  return c.id;
}

export interface CreatedUser {
  userId: string;
  phone: string;
}

export async function createUser(t: TestApp, data: { phone?: string; firstName?: string; lastName?: string } = {}): Promise<CreatedUser> {
  const phone = data.phone ?? randomPhone();
  const u = await t.prisma.user.create({
    data: { phone, firstName: data.firstName ?? 'Test', lastName: data.lastName ?? 'İstifadəçi' },
  });
  return { userId: u.id, phone };
}

/** Issues tokens for an existing user without going through OTP. */
export async function tokenFor(t: TestApp, userId: string, app: AppKind = 'CUSTOMER'): Promise<string> {
  const tokens = await t.sessions.createUserSession(userId, app, { deviceId: 'test-device-0001' });
  return tokens.accessToken;
}

export async function adminToken(t: TestApp, data: { email?: string; role?: 'ADMIN' | 'OPERATOR' } = {}): Promise<{ adminId: string; token: string }> {
  const admin = await t.prisma.adminUser.create({
    data: {
      email: data.email ?? `admin${Date.now()}${Math.floor(Math.random() * 1000)}@tezfiks.test`,
      passwordHash: 'x',
      name: 'Test Admin',
      role: data.role ?? 'ADMIN',
    },
  });
  const tokens = await t.sessions.createAdminSession(admin.id, admin.role);
  return { adminId: admin.id, token: tokens.accessToken };
}

/** Credits a ledger account from the platform EXTERNAL account (a test top-up). */
export async function fund(t: TestApp, accountId: string, amount: number): Promise<void> {
  const external = await t.ledger.platformAccountId('EXTERNAL');
  await t.ledger.post({
    kind: 'TOPUP',
    idempotencyKey: `test-fund:${accountId}:${Date.now()}:${Math.random()}`,
    entries: [
      { accountId: external, amount: -amount },
      { accountId, amount },
    ],
    memo: 'test funding',
  });
}

export interface CreatedCustomer extends CreatedUser {
  accountId: string;
  walletAccountId: string;
  token: string;
}

export async function createCustomer(
  t: TestApp,
  data: { type?: 'INDIVIDUAL' | 'COMPANY'; companyName?: string; voen?: string; balance?: number; firstName?: string; lastName?: string } = {},
): Promise<CreatedCustomer> {
  const user = await createUser(t, { firstName: data.firstName ?? 'Nizami', lastName: data.lastName ?? 'Talıbov' });
  const accountId = crypto.randomUUID();
  const wallet = await t.ledger.ensureAccount('CUSTOMER_ACCOUNT', accountId, 'WALLET', { allowNegative: false });
  await t.prisma.customerAccount.create({
    data: {
      id: accountId,
      ownerUserId: user.userId,
      type: data.type ?? 'INDIVIDUAL',
      companyName: data.type === 'COMPANY' ? (data.companyName ?? 'Kontur MMC') : null,
      voen: data.type === 'COMPANY' ? (data.voen ?? '1234567890') : null,
      legalForm: data.type === 'COMPANY' ? 'MMC' : null,
      walletAccountId: wallet.id,
    },
  });
  if (data.balance) await fund(t, wallet.id, data.balance);
  return { ...user, accountId, walletAccountId: wallet.id, token: await tokenFor(t, user.userId, 'CUSTOMER') };
}

function serviceCells(base: LatLng, radiusKm: number): string[] {
  return gridDisk(latLngToCell(base.lat, base.lng, 7), Math.ceil(radiusKm / 2.44));
}

export interface CreatedHandyman extends CreatedUser {
  handymanId: string;
  walletAccountId: string | null;
  earningsAccountId: string | null;
  token: string;
}

/** Approved solo handyman with trades, wallet, earnings and service cells. Optionally online at `at`. */
export async function createSoloHandyman(
  t: TestApp,
  data: {
    trades?: string[];
    base?: LatLng;
    radiusKm?: number;
    balance?: number;
    status?: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'BLOCKED';
    firstName?: string;
    lastName?: string;
    online?: boolean;
  } = {},
): Promise<CreatedHandyman> {
  const user = await createUser(t, { firstName: data.firstName ?? 'Elvin', lastName: data.lastName ?? 'Məmmədov' });
  const base = data.base ?? BAKU.center;
  const radiusKm = data.radiusKm ?? 10;
  const handymanId = crypto.randomUUID();
  const wallet = await t.ledger.ensureAccount('HANDYMAN', handymanId, 'WALLET');
  const earnings = await t.ledger.ensureAccount('HANDYMAN', handymanId, 'EARNINGS');
  const tradeSlugs = data.trades ?? ['plumbing'];
  const tradeIds = await Promise.all(tradeSlugs.map((s) => categoryId(t, s)));
  const now = t.clock.now();
  await t.prisma.handymanProfile.create({
    data: {
      id: handymanId,
      userId: user.userId,
      kind: 'SOLO',
      status: data.status ?? 'APPROVED',
      approvedAt: (data.status ?? 'APPROVED') === 'APPROVED' ? now : null,
      serviceRadiusKm: radiusKm,
      baseLat: base.lat,
      baseLng: base.lng,
      baseCell7: latLngToCell(base.lat, base.lng, 7),
      walletAccountId: wallet.id,
      earningsAccountId: earnings.id,
      isOnline: data.online ?? false,
      lastLat: base.lat,
      lastLng: base.lng,
      lastCell7: latLngToCell(base.lat, base.lng, 7),
      lastSeenAt: data.online ? now : null,
      trades: { create: tradeIds.map((categoryId) => ({ categoryId })) },
      serviceCells: { create: serviceCells(base, radiusKm).map((cell7) => ({ cell7 })) },
    },
  });
  if (data.balance) await fund(t, wallet.id, data.balance);
  return { ...user, handymanId, walletAccountId: wallet.id, earningsAccountId: earnings.id, token: await tokenFor(t, user.userId, 'PRO') };
}

export interface CreatedCompany {
  companyId: string;
  walletAccountId: string;
  earningsAccountId: string;
  manager: CreatedUser & { token: string };
  workers: Array<CreatedUser & { handymanId: string; token: string }>;
}

/** Approved provider company with a manager and N approved workers (all trades given). */
export async function createCompany(
  t: TestApp,
  data: {
    name?: string;
    voen?: string;
    trades?: string[];
    base?: LatLng;
    radiusKm?: number;
    workers?: number;
    balance?: number;
    finalPriceEntry?: 'WORKER' | 'MANAGER';
    status?: 'DRAFT' | 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'BLOCKED';
    workersOnline?: boolean;
  } = {},
): Promise<CreatedCompany> {
  const manager = await createUser(t, { firstName: 'Fuad', lastName: 'İdarəçi' });
  const companyId = crypto.randomUUID();
  const base = data.base ?? BAKU.center;
  const radiusKm = data.radiusKm ?? 15;
  const wallet = await t.ledger.ensureAccount('COMPANY', companyId, 'WALLET');
  const earnings = await t.ledger.ensureAccount('COMPANY', companyId, 'EARNINGS');
  const tradeSlugs = data.trades ?? ['electrical'];
  const tradeIds = await Promise.all(tradeSlugs.map((s) => categoryId(t, s)));
  await t.prisma.company.create({
    data: {
      id: companyId,
      name: data.name ?? 'FixPro MMC',
      legalForm: 'MMC',
      voen: data.voen ?? String(1000000000 + Math.floor(Math.random() * 8999999999)).slice(0, 10),
      status: data.status ?? 'APPROVED',
      approvedAt: (data.status ?? 'APPROVED') === 'APPROVED' ? t.clock.now() : null,
      ownerUserId: manager.userId,
      finalPriceEntry: data.finalPriceEntry ?? 'WORKER',
      baseLat: base.lat,
      baseLng: base.lng,
      baseCell7: latLngToCell(base.lat, base.lng, 7),
      serviceRadiusKm: radiusKm,
      walletAccountId: wallet.id,
      earningsAccountId: earnings.id,
      trades: { create: tradeIds.map((categoryId) => ({ categoryId })) },
      serviceCells: { create: serviceCells(base, radiusKm).map((cell7) => ({ cell7 })) },
      members: { create: [{ userId: manager.userId, role: 'MANAGER' }] },
    },
  });
  const workers: CreatedCompany['workers'] = [];
  const names = [
    ['Rauf', 'Hüseynov'],
    ['Tural', 'Əliyev'],
    ['Kamran', 'Səfərov'],
    ['Orxan', 'Vəliyev'],
  ];
  for (let i = 0; i < (data.workers ?? 2); i++) {
    const [fn, ln] = names[i % names.length]!;
    const w = await createUser(t, { firstName: fn, lastName: ln });
    const handymanId = crypto.randomUUID();
    const now = t.clock.now();
    await t.prisma.handymanProfile.create({
      data: {
        id: handymanId,
        userId: w.userId,
        kind: 'COMPANY_WORKER',
        companyId,
        status: 'APPROVED',
        approvedAt: now,
        serviceRadiusKm: radiusKm,
        baseLat: base.lat,
        baseLng: base.lng,
        baseCell7: latLngToCell(base.lat, base.lng, 7),
        isOnline: data.workersOnline ?? false,
        lastLat: base.lat,
        lastLng: base.lng,
        lastCell7: latLngToCell(base.lat, base.lng, 7),
        lastSeenAt: data.workersOnline ? now : null,
        trades: { create: tradeIds.map((categoryId) => ({ categoryId })) },
      },
    });
    await t.prisma.companyMember.create({ data: { companyId, userId: w.userId, role: 'WORKER' } });
    workers.push({ ...w, handymanId, token: await tokenFor(t, w.userId, 'PRO') });
  }
  if (data.balance) await fund(t, wallet.id, data.balance);
  return {
    companyId,
    walletAccountId: wallet.id,
    earningsAccountId: earnings.id,
    manager: { ...manager, token: await tokenFor(t, manager.userId, 'PRO') },
    workers,
  };
}
