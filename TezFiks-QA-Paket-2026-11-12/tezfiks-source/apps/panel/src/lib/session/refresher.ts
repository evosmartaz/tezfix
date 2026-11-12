import type { AuthTokens } from '@tezfiks/shared';

/**
 * Deduplicates refresh-token rotation. The API revokes the whole session when an already-rotated refresh token is presented
 * again, and a browser fires several requests at once (RSC payloads, prefetches, server actions) carrying the same old cookie.
 * Every caller presenting the same refresh token within `ttlMs` gets the result of the single rotation.
 */
export type RefreshOutcome = { ok: true; tokens: AuthTokens } | { ok: false; code: string };

export interface Refresher {
  refresh(refreshToken: string): Promise<RefreshOutcome>;
  /** Number of remembered rotations (tests). */
  size(): number;
}

export function createRefresher(
  rotate: (refreshToken: string) => Promise<AuthTokens>,
  opts: { ttlMs?: number; now?: () => number } = {},
): Refresher {
  const ttlMs = opts.ttlMs ?? 60_000;
  const now = opts.now ?? (() => Date.now());
  const entries = new Map<string, { promise: Promise<RefreshOutcome>; at: number }>();

  function prune(): void {
    const t = now();
    for (const [key, entry] of entries) if (t - entry.at > ttlMs) entries.delete(key);
  }

  return {
    refresh(refreshToken: string): Promise<RefreshOutcome> {
      prune();
      const existing = entries.get(refreshToken);
      if (existing) return existing.promise;
      const promise = rotate(refreshToken).then(
        (tokens): RefreshOutcome => ({ ok: true, tokens }),
        (err: unknown): RefreshOutcome => {
          const code =
            typeof err === 'object' && err && 'code' in err
              ? String((err as { code: unknown }).code)
              : 'NETWORK';
          // Network failures are not remembered: the next request may retry with the same (still valid) refresh token.
          if (code === 'NETWORK' || code === 'TIMEOUT' || code.startsWith('HTTP_5'))
            entries.delete(refreshToken);
          return { ok: false, code };
        },
      );
      entries.set(refreshToken, { promise, at: now() });
      return promise;
    },
    size: () => entries.size,
  };
}
