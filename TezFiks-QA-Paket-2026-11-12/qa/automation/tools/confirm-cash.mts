import { api, login } from '../lib.mts';
const id = process.argv[2]; const c = await login('demo', 'CUSTOMER');
const a: any = await c.c.call(api.assignments.get, { params: { id } });
console.log('before', a.status, JSON.stringify(a.price));
const r: any = await c.c.call(api.assignments.confirmPrice, { params: { id }, body: { method: 'CASH' }, idempotencyKey: `qa-cash-${id}` } as any);
console.log('after', r.assignment?.status); process.exit(0);
