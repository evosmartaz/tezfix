import type { DemoConfig } from '@tezfiks/shared';

/** PlatformSetting key holding the simulator configuration (plan lane B6). */
export const DEMO_CONFIG_KEY = 'demo.config';
/** PlatformSetting key holding the demo seed progress / completion marker. */
export const DEMO_SEED_KEY = 'demo.seed';

export const DEFAULT_DEMO_CONFIG: DemoConfig = {
  autoAccept: true,
  acceptDelaySec: 4,
  speedKmh: 40,
  autoArrive: true,
  autoPrice: true,
  priceLabor: 3500,
  priceMaterials: 1000,
};

/** Job + reconciler task names of the simulator. */
export const DEMO_JOB = { tick: 'demo.tick' } as const;
export const DEMO_RECONCILER_TASK = 'demo.simulator';

/** The simulator polls once per second (plan: "poll every second"). */
export const TICK_MS = 1000;
/** Bots send a location every 2 s while driving (plan). */
export const DRIVE_PING_MS = 2000;
/** Idle bots refresh their presence this often (online pros ping every 15 s, spec 5). */
export const HEARTBEAT_MS = 15_000;
/** A bot leaves for a scheduled job this long before scheduledAt. */
export const SCHEDULED_DEPART_LEAD_MS = 30 * 60_000;
/** A tick holds this Redis lock so two processes never act for the same bot at once. */
export const TICK_LOCK_MS = 10_000;

/** Wallet funding of every solo bot (plan: 100 AZN via ADMIN_ADJUSTMENT). */
export const BOT_WALLET_FUNDING = 10_000;
/** Service radius of spawned bots (km). */
export const BOT_SERVICE_RADIUS_KM = 10;
/**
 * Bot phone numbers use the +994 00 prefix: valid E.164 length, but no Azerbaijani operator uses it, so OTP login
 * (mobile numbers only) can never reach a bot account and no real person's number is taken.
 */
export const BOT_PHONE_PREFIX = '+99400';

/** The demo customer used by demoCreateRequest when no customerUserId is given (also seeded by the demo seed). */
export const DEMO_CUSTOMER = { phone: '+994552000024', firstName: 'Demo', lastName: 'Müştəri' } as const;
/** The demo customer's wallet is topped up to at least this much whenever it falls below it. */
export const DEMO_CUSTOMER_MIN_BALANCE = 5_000;
export const DEMO_CUSTOMER_TOPUP = 10_000;

/** Azerbaijani names for bots (first names are male: handymen in the demo boards). */
export const BOT_FIRST_NAMES = [
  'Əli',
  'Rəşad',
  'Elnur',
  'Orxan',
  'Fərid',
  'Ramil',
  'Səbuhi',
  'Nicat',
  'Elşən',
  'Zaur',
  'Anar',
  'Vüsal',
  'İlkin',
  'Cavid',
  'Mübariz',
  'Şahin',
  'Toğrul',
  'Ülvi',
  'Kənan',
  'Emin',
] as const;

export const BOT_LAST_NAMES = [
  'Məmmədli',
  'Həsənov',
  'Quliyev',
  'İsmayılov',
  'Abbasov',
  'Cəfərov',
  'Rzayev',
  'Bağırov',
  'Kərimov',
  'Şükürov',
  'Nəsirov',
  'Əhmədov',
  'Süleymanov',
  'Hüseynli',
  'Vəliyev',
] as const;
