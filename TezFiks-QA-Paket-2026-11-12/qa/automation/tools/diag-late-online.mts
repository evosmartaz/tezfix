// Sorğu yaradıldıqdan N s sonra ünvanda onlayn olan usta təklif alırmı?
import { api, login, sleep } from '../lib.mts';
import { plumbingCategoryId, goOnline, goOffline, createRequest, waitOffer, cancelOpenRequests, ADDRESS } from '../flows.mts';
const delay = Number(process.argv[2] ?? 2);
const c = await login('demo', 'CUSTOMER'); const e = await login('elvin', 'PRO');
await goOffline(e); await cancelOpenRequests(c);
const cat = await plumbingCategoryId(e);
const r: any = await createRequest(c, cat);
const id = (r.request ?? r).id; const t0 = Date.now();
console.log('request', id, 'created; Elvin online after', delay, 's at the address');
await sleep(delay * 1000);
await goOnline(e, { lat: ADDRESS.lat, lng: ADDRESS.lng });
try { const o: any = await waitOffer(e, id, 100_000, { lat: ADDRESS.lat, lng: ADDRESS.lng }); console.log('OFFER after', ((Date.now() - t0) / 1000).toFixed(0), 's step', o.step, 'ring', o.ring); }
catch { const d: any = await c.c.call(api.requests.get, { params: { id } } as any).catch(() => null); console.log('NO OFFER in 100 s; request status', d?.status ?? d?.request?.status); }
await cancelOpenRequests(c); await goOffline(e); process.exit(0);
