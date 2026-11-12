import { createHash } from 'node:crypto';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : v === 'true' || v === '1' || v === 'yes'));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const optStr = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  ROLE: z.enum(['all', 'api', 'worker']).default('all'),
  API_PREFIX: z.string().default('tezfix/api'),
  SOCKET_PATH: z.string().default('/tezfix/api/socket.io'),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  PUBLIC_API_URL: optStr,
  CORS_ORIGINS: csv,
  TRUST_PROXY: z.string().default('loopback'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379/0'),
  REDIS_PREFIX: z.string().default('tz'),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SEC: z.coerce.number().int().min(60).default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  FILE_URL_SECRET: optStr,
  FILE_URL_TTL_SEC: z.coerce.number().int().min(60).default(3600),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./uploads'),
  S3_ENDPOINT: optStr,
  S3_REGION: optStr,
  S3_BUCKET: optStr,
  S3_ACCESS_KEY_ID: optStr,
  S3_SECRET_ACCESS_KEY: optStr,
  DEMO_MODE: bool(false),
  /**
   * The fake payment provider and its hosted TEST checkout run when DEMO_MODE=true. Outside the demo they are off unless this
   * explicit opt-in is set, which is refused in production (local development and the test suite only).
   */
  PAYMENTS_TEST_MODE: bool(false),
  OTP_CHANNEL: z.enum(['console', 'whatsapp_cloud', 'webhook']).default('console'),
  OTP_DEV_ECHO: bool(false),
  OTP_BYPASS_PHONES: csv,
  OTP_BYPASS_CODE: z
    .string()
    .optional()
    .transform((v) => (v && /^\d{6}$/.test(v) ? v : undefined)),
  WHATSAPP_TOKEN: optStr,
  WHATSAPP_PHONE_NUMBER_ID: optStr,
  WHATSAPP_TEMPLATE: z.string().default('tezfiks_login'),
  WHATSAPP_GRAPH_VERSION: z.string().default('v26.0'),
  WHATSAPP_APP_SECRET: optStr,
  WHATSAPP_VERIFY_TOKEN: optStr,
  OTP_WEBHOOK_URL: optStr,
  OTP_WEBHOOK_SECRET: optStr,
  GOOGLE_MAPS_SERVER_KEY: optStr,
  ANTHROPIC_API_KEY: optStr,
  ANTHROPIC_MODEL: z.string().default('claude-haiku-5-5'),
  PUSH_PROVIDER: z.enum(['log', 'expo', 'fcm']).default('log'),
  FCM_SERVICE_ACCOUNT: optStr,
  EXPO_ACCESS_TOKEN: optStr,
  ADMIN_BOOTSTRAP_EMAIL: optStr,
  ADMIN_BOOTSTRAP_PASSWORD: optStr,
  ADMIN_BOOTSTRAP_NAME: z.string().default('TezFiks Admin'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CONTRACT_VALIDATE_RESPONSES: bool(false),
  JOBS_MODE: z.enum(['bullmq', 'manual']).default('bullmq'),
  RECONCILER_INTERVAL_SEC: z.coerce.number().int().min(1).default(30),
  /** A reconciler task running longer than this is abandoned for the tick (and skipped until it settles). */
  RECONCILER_TASK_TIMEOUT_SEC: z.coerce.number().int().min(1).default(120),
  SUPPORT_PHONE: optStr,
  APP_SCHEME_CUSTOMER: z.string().default('tezfiks'),
  APP_SCHEME_PRO: z.string().default('tezfiksusta'),
});

export type Env = z.infer<typeof EnvSchema> & {
  /** Absolute public API base, e.g. https://evosmart.az/tezfix/api */
  publicApiUrl: string;
  fileUrlSecret: string;
};

export const ENV = Symbol('ENV');

/** Secrets that ship in examples and docs (apps/api/.env.example, the test harness). Never valid in production. */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'dev-only-secret-change-me-dev-only-secret-change-me',
  'test-secret-test-secret-test-secret-test-secret',
]);

/**
 * Obviously guessable secrets: a known placeholder, placeholder words, one short block repeated, too few distinct characters
 * or too little Shannon entropy in total. Random hex (`openssl rand -hex 32`) and base64 secrets pass.
 */
export function isWeakSecret(secret: string): boolean {
  const s = secret.trim();
  if (KNOWN_PLACEHOLDER_SECRETS.has(s)) return true;
  if (/change[-_ ]?me|changeme|dev[-_]?only|placeholder|example|your[-_]?secret/i.test(s)) return true;
  if (/^(.{1,24}?)\1+$/s.test(s)) return true;
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  if (counts.size < 10) return true;
  let bitsPerChar = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    bitsPerChar -= p * Math.log2(p);
  }
  return bitsPerChar * s.length < 128;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production' && e.OTP_DEV_ECHO) {
    throw new Error('OTP_DEV_ECHO must not be enabled in production');
  }
  // Login bypasses are demo tooling: a fixed code for listed phones must never reach a real deployment. A malformed (thus
  // ignored) value still counts as set, so a typo cannot slip through unnoticed.
  const bypassSet = !!source.OTP_BYPASS_CODE?.trim() || e.OTP_BYPASS_PHONES.length > 0;
  if (bypassSet && !e.DEMO_MODE) {
    throw new Error('OTP_BYPASS_CODE / OTP_BYPASS_PHONES are demo-only: unset them or run with DEMO_MODE=true');
  }
  if (e.NODE_ENV === 'production' && isWeakSecret(e.JWT_SECRET)) {
    throw new Error('JWT_SECRET is a placeholder or too weak for production: use at least 32 random bytes (openssl rand -hex 32)');
  }
  if (e.NODE_ENV === 'production' && e.PAYMENTS_TEST_MODE && !e.DEMO_MODE) {
    throw new Error('PAYMENTS_TEST_MODE (fake card payments) must not be enabled in production outside the demo');
  }
  const prefix = e.API_PREFIX.replace(/^\/+|\/+$/g, '');
  const publicApiUrl = (e.PUBLIC_API_URL ?? `${e.PUBLIC_BASE_URL.replace(/\/+$/, '')}/${prefix}`).replace(/\/+$/, '');
  const fileUrlSecret = e.FILE_URL_SECRET ?? createHash('sha256').update(`files:${e.JWT_SECRET}`).digest('hex');
  return { ...e, API_PREFIX: prefix, publicApiUrl, fileUrlSecret };
}
