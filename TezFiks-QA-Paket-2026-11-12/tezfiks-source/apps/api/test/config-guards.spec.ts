import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';

/** The apps/api/.env.example value: copied into many .env files, never acceptable in production. */
const EXAMPLE_SECRET = 'dev-only-secret-change-me-dev-only-secret-change-me';
const STRONG = randomBytes(32).toString('hex');

function src(over: Record<string, string>): NodeJS.ProcessEnv {
  return { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db', JWT_SECRET: STRONG, ...over };
}

/**
 * Hardening of config/env.ts: the API refuses to start with demo-only login bypasses outside the demo, with a placeholder or
 * low-entropy JWT secret in production, and with test payments in production outside the demo.
 */
describe('loadEnv startup guards', () => {
  it('refuses OTP_BYPASS_CODE / OTP_BYPASS_PHONES while DEMO_MODE is false', () => {
    expect(() => loadEnv(src({ DEMO_MODE: 'false', OTP_BYPASS_CODE: '424242' }))).toThrow(/OTP_BYPASS/);
    expect(() => loadEnv(src({ DEMO_MODE: 'false', OTP_BYPASS_PHONES: '+994501112233' }))).toThrow(/OTP_BYPASS/);
    // Unset DEMO_MODE means false.
    expect(() => loadEnv(src({ OTP_BYPASS_PHONES: '+994501112233', OTP_BYPASS_CODE: '424242' }))).toThrow(/OTP_BYPASS/);
    // Set but malformed still counts as set: a typo must not slip through silently.
    expect(() => loadEnv(src({ OTP_BYPASS_CODE: '4242' }))).toThrow(/OTP_BYPASS/);
  });

  it('accepts the bypass in the demo and empty values anywhere', () => {
    const demo = loadEnv(src({ DEMO_MODE: 'true', OTP_BYPASS_PHONES: '+994501112233', OTP_BYPASS_CODE: '424242' }));
    expect(demo.OTP_BYPASS_CODE).toBe('424242');
    expect(demo.OTP_BYPASS_PHONES).toEqual(['+994501112233']);
    expect(() => loadEnv(src({ DEMO_MODE: 'false', OTP_BYPASS_PHONES: '', OTP_BYPASS_CODE: '  ' }))).not.toThrow();
  });

  it('refuses NODE_ENV=production with the .env.example JWT secret or an obviously weak one', () => {
    for (const weak of [
      EXAMPLE_SECRET,
      'test-secret-test-secret-test-secret-test-secret',
      'a'.repeat(48),
      '0123456789abcdef0123456789abcdef',
      'change-me-change-me-change-me-change-me-12',
      'abababababababababababababababababababab',
    ]) {
      expect(() => loadEnv(src({ NODE_ENV: 'production', JWT_SECRET: weak })), weak).toThrow(/JWT_SECRET/);
    }
  });

  it('accepts a random production secret (hex or base64) and any secret outside production', () => {
    expect(loadEnv(src({ NODE_ENV: 'production', JWT_SECRET: STRONG })).NODE_ENV).toBe('production');
    expect(() => loadEnv(src({ NODE_ENV: 'production', JWT_SECRET: randomBytes(48).toString('base64') }))).not.toThrow();
    expect(() => loadEnv(src({ NODE_ENV: 'development', JWT_SECRET: EXAMPLE_SECRET }))).not.toThrow();
    expect(() => loadEnv(src({ NODE_ENV: 'test', JWT_SECRET: 'test-secret-test-secret-test-secret-test-secret' }))).not.toThrow();
  });

  it('test payments: on in the demo, opt-in elsewhere, never in production without the demo', () => {
    expect(loadEnv(src({ DEMO_MODE: 'true' })).PAYMENTS_TEST_MODE).toBe(false);
    expect(loadEnv(src({ PAYMENTS_TEST_MODE: 'true' })).PAYMENTS_TEST_MODE).toBe(true);
    expect(() => loadEnv(src({ NODE_ENV: 'production', PAYMENTS_TEST_MODE: 'true' }))).toThrow(/PAYMENTS_TEST_MODE/);
    expect(() => loadEnv(src({ NODE_ENV: 'production', DEMO_MODE: 'true', PAYMENTS_TEST_MODE: 'true' }))).not.toThrow();
  });
});
