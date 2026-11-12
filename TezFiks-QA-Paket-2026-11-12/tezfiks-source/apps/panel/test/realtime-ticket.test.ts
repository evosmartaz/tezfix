import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetServerMocks } from './server-mocks';
import { POST } from '@/app/bff/realtime-ticket/route';
import { fetchRealtimeTicket, REALTIME_TICKET_PATH } from '@/lib/realtime/ticket';
import { apiError, makeJwt, mockApi } from './helpers';

const freshToken = () => makeJwt(Math.floor(Date.now() / 1000) + 600);

describe('POST /bff/realtime-ticket', () => {
  beforeEach(() => resetServerMocks());

  it('401s without a session and never calls the API', async () => {
    const { calls } = mockApi({});
    const res = await POST();
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('exchanges the cookie session for a single-use ticket (the token stays on the server)', async () => {
    const at = freshToken();
    resetServerMocks({ tf_at: at, tf_rt: 'rt-ticket-123456', tf_kind: 'admin' });
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const { calls } = mockApi({
      'POST /realtime/ticket': () => ({ status: 200, body: { ticket: 'tkt-abc', expiresAt } }),
    });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual({ ticket: 'tkt-abc', expiresAt });
    expect(JSON.stringify(body)).not.toContain(at);
    expect(calls[0].headers.authorization).toBe(`Bearer ${at}`);
  });

  it('passes API rejections through (e.g. revoked session)', async () => {
    resetServerMocks({ tf_at: freshToken(), tf_kind: 'company' });
    mockApi({ 'POST /realtime/ticket': () => apiError(401, 'SESSION_REVOKED') });
    const res = await POST();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('SESSION_REVOKED');
  });
});

describe('fetchRealtimeTicket', () => {
  it('POSTs to the BFF route under the basePath', async () => {
    const f = vi.fn(
      async () => new Response(JSON.stringify({ ticket: 't-1', expiresAt: 'x' }), { status: 200 }),
    );
    expect(await fetchRealtimeTicket(f as unknown as typeof fetch)).toBe('t-1');
    expect(REALTIME_TICKET_PATH).toBe('/tezfix/bff/realtime-ticket');
    expect(f).toHaveBeenCalledWith(
      '/tezfix/bff/realtime-ticket',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' }),
    );
  });

  it('fails on HTTP errors and malformed bodies', async () => {
    await expect(
      fetchRealtimeTicket((async () => new Response('{}', { status: 401 })) as unknown as typeof fetch),
    ).rejects.toThrow('401');
    await expect(
      fetchRealtimeTicket((async () => new Response('{}', { status: 200 })) as unknown as typeof fetch),
    ).rejects.toThrow('malformed');
  });
});
