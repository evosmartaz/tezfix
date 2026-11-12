// QA (T6): Maestro mobil ssenariləri üçün "o biri tərəf" — telefonda customer UI işləyəndə ustanı (Elvin) API ilə idarə edir.
// İşə salmaq: cd qa/automation && node mobile-driver.mts <əmr>
//   prep            — Demo Müştərinin açıq sorğularını bağlayır, Elvini oflayn edir, balansları yoxlayır
//   serve [price]   — Demo Müştərinin yeni SEARCHING sorğusunu gözləyir, Elvini ünvanın yanında onlayn edir, qəbul edir,
//                     yola çıxır, gəlir və qiymət daxil edir (default 35 + 10 AZN). "price" yazılmasa, gəlişdə dayanır.
//   accept-only     — yalnız qəbul edir (ləğv ssenariləri üçün)
//   status          — Demo Müştərinin son sorğusunu və tapşırığını göstərir
//   offline         — Elvini oflayn edir
import { api, login, waitFor, sleep } from './lib.mts';
import { goOnline, goOffline, waitOffer, wallet, topup, cancelOpenRequests, createRequest, plumbingCategoryId, ADDRESS } from './flows.mts';

const cmd = process.argv[2] ?? 'status';
const arg = process.argv[3];
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

const customer = await login('demo', 'CUSTOMER');
const elvin = await login('elvin', 'PRO');

async function latestRequest() {
  const list: any = await customer.c.call(api.requests.list, { query: {} } as any);
  return (list.items ?? [])[0] ?? null;
}

if (cmd === 'prep') {
  await cancelOpenRequests(customer);
  await goOffline(elvin);
  const active: any = await elvin.c.call(api.pro.assignments, { query: { scope: 'active' } } as any).catch(() => ({ items: [] }));
  const busy = (active.items ?? []).filter((a: any) => ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'PRICE_PROPOSED'].includes(a.status));
  if (busy.length) throw new Error(`Elvinin aktiv işi var: ${busy.map((a: any) => `${a.id}:${a.status}`).join(', ')}`);
  if ((await wallet(elvin)).available < 2000) await topup(elvin, 2000);
  if ((await wallet(customer)).available < 2000) await topup(customer, 3000);
  log('prep OK', 'elvin', await wallet(elvin), 'customer', await wallet(customer));
} else if (cmd === 'offline') {
  await goOffline(elvin);
  log('Elvin oflayn');
} else if (cmd === 'status') {
  const r = await latestRequest();
  log(JSON.stringify(r, null, 1).slice(0, 1500));
} else if (cmd === 'serve' || cmd === 'accept-only') {
  const since = Date.now() - 5_000;
  // BUG-004: usta sorğudan ƏVVƏL onlayn olmalıdır. Default: telefonun GPS yeri (Binəqədi), TF_AT="lat,lng" ilə dəyişmək olar.
  const [plat, plng] = (process.env.TF_AT ?? '40.4432538,49.8606999').split(',').map(Number);
  const pre = { lat: plat + 0.004, lng: plng };
  await goOnline(elvin, pre);
  log('Elvin onlayn', pre, '— Demo Müştərinin yeni sorğusu gözlənilir (telefonda "Usta çağır")...');
  const req: any = await waitFor(async () => {
    await elvin.c.call(api.pro.location, { body: { ...pre, accuracy: 10 } }).catch(() => undefined);
    const r = await latestRequest();
    return r && r.status === 'SEARCHING' && new Date(r.createdAt).getTime() >= since ? r : null;
  }, 600_000, 2_000);
  const detail: any = await customer.c.call(api.requests.get, { params: { id: req.id } } as any);
  const addr = detail.address ?? detail.request?.address;
  const at = { lat: addr.lat + 0.004, lng: addr.lng };
  log('sorğu', req.id, 'ünvan', addr.lat, addr.lng, addr.formatted);
  const offer: any = await waitOffer(elvin, req.id, 90_000, at);
  log('təklif', offer.id, 'fee', offer.fee);
  const acc: any = await elvin.c.call(api.pro.acceptOffer, { params: { id: offer.id }, idempotencyKey: `qa-mob-${offer.id}` } as any);
  const id = acc.assignment.id;
  log('qəbul edildi, assignment', id);
  if (cmd === 'serve') {
    await sleep(8_000);
    await elvin.c.call(api.pro.enRoute, { params: { id }, body: { location: at } } as any);
    log('yola çıxdı');
    // ~450 m-dən ünvana doğru 10 addım, hər 3 s (müştəri xəritədə hərəkəti görsün).
    for (let i = 1; i <= 10; i++) {
      const k = 1 - i / 10;
      await elvin.c.call(api.pro.location, { body: { lat: addr.lat + 0.004 * k, lng: addr.lng, accuracy: 5 } });
      await sleep(3_000);
    }
    await elvin.c.call(api.pro.arrived, { params: { id } } as any);
    log('gəldi');
    if (arg === 'price' || arg === undefined) {
      await sleep(5_000);
      await elvin.c.call(api.pro.enterPrice, { params: { id }, body: { labor: 3500, materials: 1000 } } as any);
      log('qiymət: 35 + 10 = 45 AZN');
    }
  }
  console.log(`ASSIGNMENT=${id}`);
} else if (cmd === 'customer') {
  // O04: Elvin telefonda (pro app) onlayn olur; müştəri API ilə telefonun yerində sorğu yaradır, qiymət gələndə nağd təsdiqləyir.
  const [plat, plng] = (process.env.TF_AT ?? '40.4431617,49.8607663').split(',').map(Number);
  log('Elvinin tətbiqdə onlayn olması gözlənilir (telefonda "Oflayn" düyməsi)...');
  await waitFor(async () => {
    const st: any = await elvin.c.call(api.pro.status ?? api.pro.profile).catch(() => null);
    const on = st?.isOnline ?? st?.online ?? st?.profile?.isOnline;
    return on ? st : null;
  }, 300_000, 2_000);
  log('Elvin onlayn. 25 s sonra sorğu yaradılır (tətbiqin ilk yer yeniləməsi üçün, bax BUG-004)', plat, plng);
  await sleep(25_000);
  const cat = await plumbingCategoryId(elvin);
  const r: any = await createRequest(customer, cat, { address: { ...ADDRESS, lat: plat, lng: plng, formatted: 'QA Maestro O04 ünvanı' }, description: 'QA Maestro O04: usta tətbiqi testi, kran axır.' });
  const reqId = (r.request ?? r).id; log('sorğu', reqId);
  const asg: any = await waitFor(async () => {
    const d: any = await customer.c.call(api.requests.get, { params: { id: reqId } } as any);
    const a = (d.assignments ?? d.request?.assignments ?? [])[0];
    return a?.id ? a : null;
  }, 180_000, 2_000);
  log('qəbul edildi, assignment', asg.id);
  const priced: any = await waitFor(async () => {
    const a: any = await customer.c.call(api.assignments.get, { params: { id: asg.id } });
    return a.status === 'PRICE_PROPOSED' ? a : ['CANCELLED_FREE', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_PROVIDER', 'COMPLETED'].includes(a.status) ? (() => { throw new Error('status ' + a.status); })() : null;
  }, 600_000, 3_000);
  log('qiymət gəldi', JSON.stringify(priced.price));
  await sleep(3_000);
  const c: any = await customer.c.call(api.assignments.confirmPrice, { params: { id: asg.id }, body: { method: 'CASH' }, idempotencyKey: `qa-o04-${asg.id}` } as any);
  log('müştəri nağd təsdiqlədi, status', c.assignment?.status);
  console.log(`ASSIGNMENT=${asg.id}`);
} else if (cmd === 'company-info' || cmd === 'company') {
  // O05/O06: FixPro. Rauf telefonda (menecer), Kamran API ilə onlayn, Leyla (şirkət müştərisi) providerPreference=COMPANY sorğu yaradır.
  const rauf = await login('rauf', 'PRO'); const kamran = await login('kamran', 'PRO'); const leyla = await login('leyla', 'CUSTOMER');
  const p: any = await rauf.c.call(api.pro.profile);
  const companyId = p.managedCompanies[0].id;
  const members: any = await rauf.c.call(api.company.members, { params: { companyId } });
  const km = members.items.find((m: any) => m.userId === kamran.me.id);
  const ka: any = await kamran.c.call(api.pro.assignments, { query: { scope: 'active' } } as any).catch(() => ({ items: [] }));
  console.log(`COMPANY_ID=${companyId}`); console.log(`KAMRAN_ID=${km?.handymanId}`);
  log('Kamran aktiv işləri:', (ka.items ?? []).map((a: any) => `${a.id}:${a.status}`).join(', ') || 'yoxdur');
  if (cmd === 'company') {
    await goOffline(elvin);
    await cancelOpenRequests(leyla);
    const [plat, plng] = (process.env.TF_AT ?? '40.4431617,49.8607663').split(',').map(Number);
    const at = { lat: plat + 0.002, lng: plng };
    await goOnline(kamran, at);
    log('Kamran onlayn', at, '— 30 s sonra Leyla sorğu yaradır');
    for (let i = 0; i < 10; i++) { await kamran.c.call(api.pro.location, { body: { ...at, accuracy: 10 } }).catch(() => undefined); await sleep(3_000); }
    const cat = await plumbingCategoryId(elvin);
    const r: any = await createRequest(leyla, cat, { providerPreference: 'COMPANY', address: { ...ADDRESS, lat: plat, lng: plng, formatted: 'QA Maestro O05 ünvanı' }, description: 'QA Maestro O05: şirkət sifarişi, kran axır.' });
    const reqId = (r.request ?? r).id; log('sorğu', reqId);
    const asg: any = await waitFor(async () => {
      await kamran.c.call(api.pro.location, { body: { ...at, accuracy: 10 } }).catch(() => undefined);
      const d: any = await leyla.c.call(api.requests.get, { params: { id: reqId } } as any);
      const a = (d.assignments ?? [])[0];
      if (!a?.id && d.status === 'EXPIRED') throw new Error('EXPIRED');
      return a?.id ? a : null;
    }, 180_000, 3_000);
    log('şirkət qəbul etdi, assignment', asg.id);
    console.log(`ASSIGNMENT=${asg.id}`);
  }
} else {
  throw new Error(`naməlum əmr: ${cmd}`);
}
process.exit(0);
