import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@tezfiks/shared';
import { createRefresher } from '@/lib/session/refresher';
import { makeTokens } from './helpers';

describe('refresh token rotation dedupe', () => {
  it('rotates once for concurrent requests carrying the same refresh token', async () => {
    const tokens = makeTokens();
    let release!: () => void;
    const rotate = vi.fn(() => new Promise<typeof tokens>((resolve) => (release = () => resolve(tokens))));
    const refresher = createRefresher(rotate);
    const all = Promise.all([
      refresher.refresh('rt-old-123456'),
      refresher.refresh('rt-old-123456'),
      refresher.refresh('rt-old-123456'),
    ]);
    release();
    const results = await all;
    expect(rotate).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r).toEqual({ ok: true, tokens });
  });

  it('serves late duplicates within the TTL from the remembered rotation', async () => {
    let now = 0;
    const rotate = vi.fn(async (rt: string) => makeTokens(Date.now(), rt.slice(-3)));
    const refresher = createRefresher(rotate, { ttlMs: 60_000, now: () => now });
    const first = await refresher.refresh('rt-aaa-111');
    now = 59_000;
    const second = await refresher.refresh('rt-aaa-111');
    expect(second).toEqual(first);
    expect(rotate).toHaveBeenCalledTimes(1);
    now = 121_000;
    await refresher.refresh('rt-aaa-111');
    expect(rotate).toHaveBeenCalledTimes(2);
  });

  it('rotates different refresh tokens independently', async () => {
    const rotate = vi.fn(async (rt: string) => makeTokens(Date.now(), rt));
    const refresher = createRefresher(rotate);
    await Promise.all([refresher.refresh('rt-user-a-1'), refresher.refresh('rt-user-b-1')]);
    expect(rotate).toHaveBeenCalledTimes(2);
    expect(refresher.size()).toBe(2);
  });

  it('reports API rejections with their code and remembers them (no retry storm with a revoked token)', async () => {
    const rotate = vi.fn(async () => {
      throw new ApiError(401, 'REFRESH_INVALID', 'invalid');
    });
    const refresher = createRefresher(rotate);
    expect(await refresher.refresh('rt-bad-123456')).toEqual({ ok: false, code: 'REFRESH_INVALID' });
    expect(await refresher.refresh('rt-bad-123456')).toEqual({ ok: false, code: 'REFRESH_INVALID' });
    expect(rotate).toHaveBeenCalledTimes(1);
  });

  it('does not remember network failures so the next request can retry', async () => {
    const rotate = vi
      .fn<(rt: string) => Promise<ReturnType<typeof makeTokens>>>()
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK', 'down'))
      .mockResolvedValueOnce(makeTokens());
    const refresher = createRefresher(rotate);
    expect(await refresher.refresh('rt-net-123456')).toEqual({ ok: false, code: 'NETWORK' });
    expect((await refresher.refresh('rt-net-123456')).ok).toBe(true);
    expect(rotate).toHaveBeenCalledTimes(2);
  });
});
