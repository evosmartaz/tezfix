import { BASE_PATH } from '../env';

export const REALTIME_TICKET_PATH = `${BASE_PATH}/bff/realtime-ticket`;

/** Fetches a fresh single-use socket ticket from the panel BFF (same origin, cookie-authenticated). */
export async function fetchRealtimeTicket(fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(REALTIME_TICKET_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`realtime ticket: HTTP ${res.status}`);
  const body = (await res.json()) as { ticket?: unknown };
  if (typeof body.ticket !== 'string' || !body.ticket) throw new Error('realtime ticket: malformed response');
  return body.ticket;
}
