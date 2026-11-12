// Shared helpers for the TezFiks live QA automation (node:test, no extra packages).
// Every call goes through the typed client from @tezfiks/shared with response validation against the zod contract.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const TOKEN_FILE = new URL('./.tokens.json', import.meta.url);
function loadTokens(): Record<string, { refreshToken: string; deviceId: string }> {
  try {
    return existsSync(TOKEN_FILE) ? JSON.parse(readFileSync(TOKEN_FILE, 'utf8')) : {};
  } catch {
    return {};
  }
}
function saveToken(key: string, refreshToken: string, deviceId: string) {
  const all = loadTokens();
  all[key] = { refreshToken, deviceId };
  writeFileSync(TOKEN_FILE, JSON.stringify(all, null, 1));
}

const require = createRequire(import.meta.url);
const shared = require('@tezfiks/shared');
export const { api, createApiClient, ApiError } = shared;

export const BASE = process.env.TF_API ?? 'https://evosmart.az/tezfix/api';
export const PANEL = process.env.TF_PANEL ?? 'https://tezfiks.evosmart.az/tezfix';
export const OTP = process.env.TF_OTP ?? '123456';

export const PHONES = {
  elvin: '+994502000001',
  samir: '+994502000002',
  vuqar: '+994502000003',
  rauf: '+994502000011',
  tural: '+994502000012',
  kamran: '+994502000013',
  nizami: '+994552000021',
  aysel: '+994552000022',
  leyla: '+994552000023',
  demo: '+994552000024',
} as const;
export type Who = keyof typeof PHONES;

/** Fountain Square, Baku (demo centre). */
export const CENTER = { lat: 40.3777, lng: 49.8531 };

export function client(token?: string, locale = 'az') {
  return createApiClient({
    baseUrl: BASE,
    getAccessToken: () => token,
    getLocale: () => locale,
    validateResponses: true,
    timeoutMs: 30_000,
  });
}

/** Client bound to a session: reads its current access token and refreshes it on a 401 (long runs outlive the ~15 min token). */
function sessionClient(s: Omit<Session, 'c' | 'me'> & { key?: string }) {
  return createApiClient({
    baseUrl: BASE,
    getAccessToken: () => s.token,
    getLocale: () => 'az',
    validateResponses: true,
    timeoutMs: 30_000,
    refreshAccessToken: async () => {
      const t = await client().call(api.auth.refresh, { body: { refreshToken: s.refreshToken, deviceId: s.deviceId } });
      s.token = t.accessToken;
      s.refreshToken = t.refreshToken;
      if (s.key) saveToken(s.key, t.refreshToken, s.deviceId);
      return true;
    },
  });
}

const sessions = new Map<string, Session>();
export interface Session {
  who: string;
  token: string;
  refreshToken: string;
  deviceId: string;
  me: any;
  c: ReturnType<typeof client>;
}

/** OTP login with the demo bypass code. Cached per (who, app) for the whole run. */
export async function login(who: Who, app: 'CUSTOMER' | 'PRO' | 'PANEL'): Promise<Session> {
  const key = `${who}:${app}`;
  const cached = sessions.get(key);
  if (cached) return cached;
  const anon = client();
  // Reuse a saved session through refresh: OTP is limited to 5 codes per phone and 20 per IP per hour.
  const saved = loadTokens()[key];
  if (saved && !process.env.TF_FRESH_LOGIN) {
    try {
      const t = await anon.call(api.auth.refresh, { body: { refreshToken: saved.refreshToken, deviceId: saved.deviceId } });
      saveToken(key, t.refreshToken, saved.deviceId);
      const s = { who, key, token: t.accessToken, refreshToken: t.refreshToken, deviceId: saved.deviceId } as any;
      s.c = sessionClient(s);
      s.me = await s.c.call(api.me.get);
      sessions.set(key, s);
      return s as Session;
    } catch {
      // fall through to a fresh OTP login
    }
  }
  const ch = await anon.call(api.auth.otpRequest, { body: { phone: PHONES[who], app } });
  const deviceId = `qa-auto-${who}-${randomUUID().slice(0, 8)}`;
  const v = await anon.call(api.auth.otpVerify, { body: { challengeId: ch.challengeId, code: OTP, deviceId, app } });
  const s = { who, key, token: v.tokens.accessToken, refreshToken: v.tokens.refreshToken, deviceId, me: v.me } as any;
  s.c = sessionClient(s);
  sessions.set(key, s);
  saveToken(key, s.refreshToken, deviceId);
  return s;
}

export async function adminLogin(): Promise<Session | null> {
  const email = process.env.TF_ADMIN_EMAIL;
  const password = process.env.TF_ADMIN_PASSWORD;
  if (!email || !password) return null;
  const r = await client().call(api.auth.adminLogin, { body: { email, password } });
  return { who: 'admin', token: r.tokens.accessToken, refreshToken: r.tokens.refreshToken, deviceId: '', me: r.admin, c: client(r.tokens.accessToken) };
}

/** Runs fn and returns the ApiError it throws (fails when it does not throw). */
export async function expectApiError(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
  } catch (e: any) {
    if (e?.code === 'CONTRACT_MISMATCH') throw e;
    return e;
  }
  throw new Error('Expected an API error, but the call succeeded');
}

/** Raw fetch (for non-contract checks: headers, CORS, garbage tokens). */
export async function raw(path: string, init: RequestInit = {}) {
  return fetch(BASE + path, init);
}

/** Finds any E.164 Azerbaijani phone number inside a JSON payload. */
export function findPhones(value: unknown): string[] {
  const s = JSON.stringify(value) ?? '';
  return s.match(/\+?994\d{9}/g) ?? [];
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls until fn returns a truthy value or the timeout passes. */
export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 30_000, stepMs = 1_000): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v as T;
    } catch (e) {
      last = e;
    }
    await sleep(stepMs);
  }
  throw new Error(`waitFor timed out after ${timeoutMs} ms${last ? `: ${String(last)}` : ''}`);
}
