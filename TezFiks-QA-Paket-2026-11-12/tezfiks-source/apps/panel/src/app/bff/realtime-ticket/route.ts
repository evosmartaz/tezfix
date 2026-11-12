import { NextResponse } from 'next/server';
import { api, ApiError } from '@tezfiks/shared';
import { getSession, serverApi } from '@/lib/session/server';

/**
 * Browser socket ticket (BFF). The browser never sees the access token: it asks this handler (cookie-authenticated, same
 * origin) for a 60-second single-use ticket and passes it in the Socket.IO handshake (`auth: { ticket }`).
 * Lives under /tezfix/bff/... because /tezfix/api/... is routed to the API by the reverse proxy.
 */
export async function POST(): Promise<NextResponse> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, { status: 401 });
  }
  try {
    const client = await serverApi(session);
    const ticket = await client.call(api.auth.realtimeTicket);
    return NextResponse.json(ticket, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const status = err instanceof ApiError && err.status >= 400 ? err.status : 502;
    const code = err instanceof ApiError ? String(err.code) : 'INTERNAL';
    return NextResponse.json(
      { error: { code, message: code } },
      { status, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
