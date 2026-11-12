import { api, login } from '../lib.mts';
const id = process.argv[2];
const c = await login('demo', 'CUSTOMER'); const e = await login('elvin', 'PRO');
const a: any = await c.c.call(api.assignments.get, { params: { id } });
const p: any = await e.c.call(api.pro.assignment, { params: { id } });
console.log(JSON.stringify({ status: a.status, price: a.price, payment: a.payment ?? a.paymentStatus, tip: a.tip ?? a.tipAmount, rating: a.rating ?? a.myRating, guaranteeUntil: a.guaranteeUntil, proFee: p.fee, proTip: p.tip, proRating: p.customerRating ?? p.rating }, null, 1));
process.exit(0);
