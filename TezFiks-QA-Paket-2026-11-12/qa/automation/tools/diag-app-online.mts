import { api, login, waitFor } from '../lib.mts';
import { plumbingCategoryId, createRequest, cancelOpenRequests, ADDRESS } from '../flows.mts';
const c = await login('demo', 'CUSTOMER'); const e = await login('elvin', 'PRO');
const p: any = await e.c.call(api.pro.profile);
console.log('isOnline', p.profile.isOnline, 'base', JSON.stringify(p.profile.base), 'radius', p.profile.serviceRadiusKm, 'strikes', p.profile.strikes);
await cancelOpenRequests(c);
const r: any = await createRequest(c, await plumbingCategoryId(e), { address: { ...ADDRESS, lat: 40.4431617, lng: 49.8607663 } });
const id = (r.request ?? r).id; console.log('request', id);
try { const o: any = await waitFor(async () => { const x: any = await e.c.call(api.pro.offers); return x.items.find((o: any) => o.requestId === id) ?? null; }, 60_000, 1_500); console.log('OFFER', o.status, 'step', o.step, 'ring', o.ring); }
catch { console.log('NO OFFER in 60 s'); }
await cancelOpenRequests(c); process.exit(0);
