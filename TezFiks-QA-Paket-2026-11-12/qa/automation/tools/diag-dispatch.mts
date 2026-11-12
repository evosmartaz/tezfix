import { api, login } from '../lib.mts';
import { plumbingCategoryId, goOnline, goOffline, createRequest, waitOffer, cancelOpenRequests, ADDRESS } from '../flows.mts';
const c = await login('demo', 'CUSTOMER'); const e = await login('elvin', 'PRO');
const prof: any = await e.c.call(api.pro.profile);
console.log('elvin', JSON.stringify(prof).slice(0, 600));
const lat = Number(process.argv[2] ?? ADDRESS.lat), lng = Number(process.argv[3] ?? ADDRESS.lng);
await goOnline(e, { lat: lat + 0.004, lng });
const r: any = await createRequest(c, await plumbingCategoryId(e), { address: { ...ADDRESS, lat, lng } });
const id = (r.request ?? r).id; console.log('request', id, lat, lng);
try { const o: any = await waitOffer(e, id, 40_000, { lat: lat + 0.004, lng }); console.log('OFFER OK', o.id); }
catch { console.log('NO OFFER'); }
await cancelOpenRequests(c); await goOffline(e); process.exit(0);
