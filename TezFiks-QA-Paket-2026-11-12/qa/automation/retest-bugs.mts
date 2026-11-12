// QA: açıq bagların retesti. Developer "düzəltdim" deyəndə işlədilir: hər bag üçün DÜZƏLİB / HƏLƏ VAR / YOXLANMADI.
//
// İşə salmaq (qa/automation):  node retest-bugs.mts            — hamısı
//                              node retest-bugs.mts 002 004    — seçilmişlər
// Telefon (adb) qoşulubsa mobil bagları da yoxlayır (BUG-003 logcat). Yoxdursa "telefon lazımdır" yazır.
// Nəticə: ekranda + results/retest-latest.md (köhnəsinin üzərinə).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { api, login, sleep, BASE } from './lib.mts';
import { plumbingCategoryId, goOnline, goOffline, createRequest, waitOffer, cancelOpenRequests, ADDRESS } from './flows.mts';

const ADB = process.env.ADB ?? 'D:/tools/platform-tools/adb.exe';
const DOWNLOAD = 'https://tezfiks.evosmart.az/download/';
// 25.10.2026 APK-larının md5-i (10.11-də yoxlanılıb). Dəyişibsə, developer yeni APK yükləyib.
const APK_MD5: Record<string, string> = {
  'tezfiks.apk': 'acdbc309ce44c3637ddc3a793f3726b0',
  'tezfiks-usta.apk': '26108892be1338457e7ae1cc16722351',
};

type Verdict = 'DÜZƏLİB' | 'HƏLƏ VAR' | 'YOXLANMADI';
const results: { bug: string; verdict: Verdict; note: string }[] = [];
const only = process.argv.slice(2).map((a) => a.replace(/\D/g, '').padStart(3, '0'));
const want = (n: string) => !only.length || only.includes(n);
const log = (...a: unknown[]) => console.log(...a);

function adbDevice(): boolean {
  if (!existsSync(ADB)) return false;
  try {
    return /\tdevice\b/.test(execFileSync(ADB, ['devices'], { encoding: 'utf8' }));
  } catch {
    return false;
  }
}

async function apkChanged(): Promise<string> {
  const parts: string[] = [];
  for (const [name, md5] of Object.entries(APK_MD5)) {
    const head = await fetch(DOWNLOAD + name, { method: 'HEAD' }).catch(() => null);
    const lm = head?.headers.get('last-modified') ?? '?';
    const buf = Buffer.from(await (await fetch(DOWNLOAD + name)).arrayBuffer());
    const now = createHash('md5').update(buf).digest('hex');
    parts.push(`${name}: ${now === md5 ? 'dəyişməyib' : 'YENİ (' + lm + ')'}`);
  }
  return parts.join('; ');
}

// BUG-002: imzalı fayl URL-i ~10 dəqiqə olmalıdır.
if (want('002')) {
  const aysel = await login('aysel', 'CUSTOMER');
  const me: any = await aysel.c.call(api.me.get);
  let m = JSON.stringify(me).match(/files\/[0-9a-f-]+\?exp=(\d+)/);
  if (!m) {
    // Profildə şəkil yoxdursa, kiçik PNG yükləyib onun imzalı URL-inə baxırıq (06-validation-dakı kimi).
    const png = readFileSync(new URL('../../apps/customer/assets/splash-icon.png', import.meta.url));
    const fd = new FormData();
    fd.append('kind', 'REQUEST_PHOTO');
    fd.append('file', new Blob([png], { type: 'image/png' }), 'retest.png');
    const up = await fetch(`${BASE}/files`, { method: 'POST', headers: { Authorization: `Bearer ${(aysel as any).token}` }, body: fd });
    const body: any = await up.json().catch(() => null);
    m = String(body?.url ?? '').match(/exp=(\d+)/);
  }
  if (!m) results.push({ bug: 'BUG-002', verdict: 'YOXLANMADI', note: 'Ayselin cavabında imzalı URL yoxdur' });
  else {
    const min = (Number(m[1]) * 1000 - Date.now()) / 60000;
    results.push({ bug: 'BUG-002', verdict: min <= 15 ? 'DÜZƏLİB' : 'HƏLƏ VAR', note: `URL ${min.toFixed(0)} dəq etibarlıdır (gözlənilən ≤ 15)` });
  }
}

// BUG-004: sorğudan 3 s sonra ünvanda onlayn olan usta təklif almalıdır.
if (want('004')) {
  const c = await login('demo', 'CUSTOMER');
  const e = await login('elvin', 'PRO');
  await goOffline(e);
  await cancelOpenRequests(c);
  const r: any = await createRequest(c, await plumbingCategoryId(e));
  const id = (r.request ?? r).id;
  await sleep(3_000);
  await goOnline(e, { lat: ADDRESS.lat, lng: ADDRESS.lng });
  const got = await waitOffer(e, id, 100_000, { lat: ADDRESS.lat, lng: ADDRESS.lng }).then(() => true).catch(() => false);
  await cancelOpenRequests(c);
  await goOffline(e);
  results.push({ bug: 'BUG-004', verdict: got ? 'DÜZƏLİB' : 'HƏLƏ VAR', note: got ? 'gec onlayn olan usta təklif aldı' : '100 s ərzində təklif gəlmədi (EXPIRED)' });
}

// Mobil baglar: APK dəyişibmi + telefon varsa BUG-003 logcat yoxlaması.
const needMobile = ['003', '005', '006'].some(want);
if (needMobile) {
  const apk = await apkChanged().catch((x) => 'yoxlanmadı: ' + x);
  log('APK-lar:', apk);
  const phone = adbDevice();
  if (want('003')) {
    if (!phone) results.push({ bug: 'BUG-003', verdict: 'YOXLANMADI', note: `telefon lazımdır (Wireless debugging). APK: ${apk}. Qeyd: açar Cloud Console-da düzəlsə, köhnə APK-da da işləməlidir` });
    else {
      execFileSync(ADB, ['shell', 'am', 'force-stop', 'az.tezfiks.usta']);
      execFileSync(ADB, ['logcat', '-c']);
      execFileSync(ADB, ['shell', 'monkey', '-p', 'az.tezfiks.usta', '-c', 'android.intent.category.LAUNCHER', '1']);
      await sleep(20_000);
      const lc = execFileSync(ADB, ['logcat', '-d'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const fail = /Google Android Maps SDK: Authorization failure/.test(lc);
      const loaded = /Google Android Maps SDK/.test(lc);
      results.push({
        bug: 'BUG-003',
        verdict: !loaded ? 'YOXLANMADI' : fail ? 'HƏLƏ VAR' : 'DÜZƏLİB',
        note: !loaded ? 'xəritə SDK-sı yüklənmədi (ana ekranda daxil olmuş usta lazımdır)' : fail ? 'logcat: "Authorization failure"' : 'logcat-da Authorization failure yoxdur',
      });
    }
  }
  if (want('005')) results.push({ bug: 'BUG-005', verdict: 'YOXLANMADI', note: `Maestro: qa/maestro/o07-pro-lang-status.yaml (RU-da "Сантехник" görünməlidir). APK: ${apk}` });
  if (want('006')) results.push({ bug: 'BUG-006', verdict: 'YOXLANMADI', note: `vizual: O05 ekran görüntüsü (qa/maestro/o05b-company-accept.yaml). APK: ${apk}` });
}

const icon: Record<Verdict, string> = { 'DÜZƏLİB': '✅', 'HƏLƏ VAR': '❌', 'YOXLANMADI': '⏸' };
log('');
for (const r of results) log(`${icon[r.verdict]} ${r.bug}: ${r.verdict} — ${r.note}`);
const md = [
  `# Bag retesti — ${new Date().toLocaleString('az-AZ', { timeZone: 'Asia/Baku' })} (Bakı)`,
  '',
  '| Bag | Nəticə | Qeyd |',
  '|---|---|---|',
  ...results.map((r) => `| ${r.bug} | ${icon[r.verdict]} ${r.verdict} | ${r.note.replace(/\|/g, '/')} |`),
  '',
  'DÜZƏLİB olanların statusunu `qa/bugs.md`-də "Yoxlanıldı" edin.',
].join('\n');
writeFileSync('results/retest-latest.md', md + '\n');
process.exit(0);
