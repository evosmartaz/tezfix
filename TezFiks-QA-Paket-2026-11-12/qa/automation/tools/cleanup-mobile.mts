import { api, login } from '../lib.mts';
import { goOffline, cancelOpenRequests } from '../flows.mts';
const leyla = await login('leyla', 'CUSTOMER'); const demo = await login('demo', 'CUSTOMER');
await cancelOpenRequests(leyla); await cancelOpenRequests(demo);
for (const w of ['elvin', 'kamran', 'tural'] as const) { const s = await login(w, 'PRO'); await goOffline(s); }
const k = await login('kamran', 'PRO');
const a: any = await k.c.call(api.pro.assignments, { query: { scope: 'active' } } as any).catch(() => ({ items: [] }));
console.log('Kamran active after cleanup:', (a.items ?? []).map((x: any) => x.status).join(',') || 'none');
process.exit(0);
