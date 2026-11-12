// Reusable end-to-end steps for business-flow tests: customer request -> provider offer -> accept -> job -> payment.
import assert from 'node:assert/strict';
import { api, login, waitFor, CENTER, type Session } from './lib.mts';

/** A point ~250 m from the centre (customer address). */
export const ADDRESS = {
  lat: 40.3795,
  lng: 49.8510,
  formatted: 'QA avtomat test ünvanı, Nizami küç. 1, Səbail',
  district: 'Səbail',
  street: 'Nizami küç.',
  building: '1',
  entrance: '2',
  floor: '4',
  apartment: '17',
  intercom: '17',
  note: 'QA automation - test sorğusu',
};

let plumbingId: string | null = null;
/** A service category that Elvin (santexnik) serves. */
export async function plumbingCategoryId(elvin: Session): Promise<string> {
  if (plumbingId) return plumbingId;
  const profile: any = await elvin.c.call(api.pro.profile);
  const trades: any[] = profile.profile?.trades ?? profile.trades ?? [];
  const tree: any = await elvin.c.call(api.categories.list);
  const flat: any[] = [];
  const walk = (n: any) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === 'object') {
      if (n.id && n.slug) flat.push(n);
      for (const v of Object.values(n)) if (v && typeof v === 'object') walk(v);
    }
  };
  walk(tree);
  const tradeIds = new Set(trades.map((t: any) => (typeof t === 'string' ? t : t.id ?? t.categoryId)));
  const pick =
    flat.find((c) => tradeIds.has(c.id) && /santex|plumb/i.test(c.slug)) ??
    flat.find((c) => tradeIds.has(c.id) && c.kind !== 'GROUP' && c.flow !== 'QUOTE');
  assert.ok(pick, `no plumbing category among Elvin's trades (${[...tradeIds].join(',')})`);
  plumbingId = pick.id;
  return pick.id;
}

/** Puts a solo handyman online at the centre and keeps pinging presence. */
export async function goOnline(pro: Session, at = CENTER) {
  const r = await pro.c.call(api.pro.setOnline, { body: { online: true, location: at } });
  await pro.c.call(api.pro.location, { body: { lat: at.lat, lng: at.lng, accuracy: 10 } });
  return r;
}

export async function goOffline(pro: Session) {
  await pro.c.call(api.pro.setOnline, { body: { online: false } }).catch(() => undefined);
}

export async function createRequest(customer: Session, categoryId: string, extra: Record<string, unknown> = {}) {
  return customer.c.call(api.requests.create, {
    body: {
      categoryId,
      description: 'QA automation: mətbəxdə kran axır, dəyişmək lazımdır.',
      timing: 'NOW',
      slots: 1,
      address: ADDRESS,
      ...extra,
    } as any,
  });
}

/** Waits for this provider's offer on the given request. */
export async function waitOffer(pro: Session, requestId: string, timeoutMs = 60_000, at: { lat: number; lng: number } = CENTER) {
  return waitFor(async () => {
    await pro.c.call(api.pro.location, { body: { lat: at.lat, lng: at.lng, accuracy: 10 } }).catch(() => undefined);
    const r: any = await pro.c.call(api.pro.offers);
    return r.items.find((o: any) => o.requestId === requestId && o.status === 'SENT') ?? null;
  }, timeoutMs, 1_500);
}

/** Submits the fake provider's hosted checkout form. Returns the final intent status. */
export async function payCheckout(checkoutUrl: string, card = '4242 4242 4242 4242') {
  const u = new URL(checkoutUrl);
  const t = u.searchParams.get('t') ?? '';
  u.search = '';
  const res = await fetch(u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ t, card, action: 'pay' }),
    redirect: 'manual',
  });
  assert.ok(res.status < 400, `checkout POST -> ${res.status}`);
  return res;
}

export async function wallet(s: Session) {
  return (await s.c.call(api.wallet.get)) as any;
}

/** Tops up a wallet with the test card; resolves when the money is available. */
export async function topup(s: Session, amount: number) {
  const before = await wallet(s);
  const co: any = await s.c.call(api.wallet.topup, { body: { amount } });
  await payCheckout(co.checkoutUrl);
  await waitFor(async () => (await wallet(s)).posted >= before.posted + amount, 20_000);
}

/** Cancels every open request of a customer (cleanup after a test). */
export async function cancelOpenRequests(customer: Session) {
  const list: any = await customer.c.call(api.requests.list, { query: {} } as any);
  for (const r of list.items ?? []) {
    if (['SEARCHING', 'ASSIGNED', 'IN_PROGRESS'].includes(r.status)) await customer.c.call(api.requests.cancel, { params: { id: r.id }, body: { reason: 'QA cleanup' } }).catch(() => undefined);
  }
}

export { login };
