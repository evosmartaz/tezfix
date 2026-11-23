import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** Monorepo root: standalone output must trace the workspace packages (@tezfiks/shared, @tezfiks/i18n). */
const monorepoRoot = path.join(process.cwd(), '..', '..');

// Every NEXT_PUBLIC_* value ends up in the browser bundle, so only a Mapbox public (pk.) token may be configured.
const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();
if (mapboxToken && !mapboxToken.startsWith('pk.')) {
  throw new Error('NEXT_PUBLIC_MAPBOX_TOKEN must be a Mapbox public token (pk.*), never a secret sk.* token.');
}

const nextConfig: NextConfig = {
  basePath: '/tezfix',
  output: 'standalone',
  images: { unoptimized: true },
  transpilePackages: ['@tezfiks/shared', '@tezfiks/i18n'],
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  poweredByHeader: false,
  // Security review 2026-10-26: no framing (a sibling *.evosmart.az app could otherwise frame the admin panel), no MIME
  // sniffing, no cross-origin referrers, no device APIs. (A script CSP is left out on purpose: the maps load external tiles.)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
