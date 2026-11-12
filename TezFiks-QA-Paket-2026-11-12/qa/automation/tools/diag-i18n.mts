import { api, login, client } from '../lib.mts';
const e = await login('elvin', 'PRO');
for (const loc of ['az', 'ru', 'en']) {
  const c = client(e.token, loc);
  const p: any = await c.call(api.pro.profile);
  const cats: any = await c.call(api.categories.list).catch((x: any) => ({ err: x.code }));
  const plumb = JSON.stringify(cats).match(/"slug":"plumbing"[^}]*"name":"([^"]+)"|"name":"([^"]+)"[^}]*"slug":"plumbing"/);
  console.log(loc, 'profile trades:', p.profile.trades.map((t: any) => t.name).join(', '), '| categories plumbing:', plumb?.[1] ?? plumb?.[2]);
}
process.exit(0);
