import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config';

/**
 * Security review (2026-10-26): the panel answered with HSTS only, so a sibling *.evosmart.az app could frame the admin
 * panel and drive it with the admin's cookies. Every panel response now forbids framing, MIME sniffing and cross-origin
 * referrers.
 */
describe('panel security headers', () => {
  it('applies anti-framing, nosniff, referrer and permissions headers to every route', async () => {
    expect(typeof nextConfig.headers).toBe('function');
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === '/:path*');
    expect(all).toBeDefined();
    const h = Object.fromEntries(all!.headers.map((x) => [x.key.toLowerCase(), x.value]));
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('same-origin');
    expect(h['permissions-policy']).toContain('camera=()');
  });
});
