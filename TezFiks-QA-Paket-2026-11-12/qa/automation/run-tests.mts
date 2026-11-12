// QA retest paketi: canlı automation testlərini qruplarla işlədir və nəticəni bir cədvəldə toplayır.
//
// İşə salmaq (qa/automation qovluğunda):
//   node run-tests.mts quick    — sürətli, demo məlumatını dəyişməyən testlər (~3–5 dəq)
//   node run-tests.mts flows    — pul axınları: sorğu, ödəniş, B2B, dispatch, məşğul işçi (~10 dəq)
//   node run-tests.mts long     — uzun gözləmələr: ləğv/no-show (Elvinə STRIKE yazır!), avtomatik tamamlanma, B2B expiry (~40 dəq)
//   node run-tests.mts all      — hamısı (quick + flows + long)
//   node run-tests.mts 03 09    — yalnız göstərilən fayllar (nömrə ilə)
//
// Nəticə: ekranda cədvəl + results/summary-latest.md (hər run köhnəsinin üzərinə yazır).
import { spawn } from 'node:child_process';
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';

const GROUPS: Record<string, string[]> = {
  quick: ['01', '02', '05', '06', '08', '10'],
  flows: ['03', '07', '09', '13'],
  long: ['04', '11', '12'],
};
GROUPS.all = [...GROUPS.quick, ...GROUPS.flows, ...GROUPS.long];

// Məlum nəticələr: bunlar düzələnə qədər "gözlənilən uğursuzluq" kimi göstərilir, yeni problem sayılmır.
const KNOWN: Record<string, string> = {
  'AU-D08b': 'BUG-002 (imzalı URL ~1 saat)',
};

const args = process.argv.slice(2);
if (!args.length) {
  console.log('İstifadə: node run-tests.mts quick | flows | long | all | <nömrələr...>');
  process.exit(1);
}
const wanted = args.flatMap((a) => GROUPS[a] ?? [a.padStart(2, '0')]);
const files = readdirSync('.').filter((f) => /^\d\d-.*\.test\.mts$/.test(f));
const plan = [...new Set(wanted)].map((n) => files.find((f) => f.startsWith(n + '-'))).filter(Boolean) as string[];
if (!plan.length) throw new Error('heç bir test faylı tapılmadı: ' + wanted.join(','));
if (plan.some((f) => f.startsWith('04-'))) console.log('⚠️  04-cancellations Elvinə strike yazır (admin hesabı ilə sıfırlanmalıdır).');

type Row = { file: string; pass: number; fail: number; sec: number; failures: string[]; known: string[] };
const rows: Row[] = [];

function run(file: string): Promise<Row> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', () => {
      const failures: string[] = [];
      const known: string[] = [];
      let pass = 0;
      let fail = 0;
      for (const line of out.split('\n')) {
        // Yalnız yuxarı səviyyəli testlər (alt-testlər girintili olur).
        const m = line.match(/^(ok|not ok) \d+ - (.*?)(\s+#.*)?$/);
        if (!m) continue;
        if (m[1] === 'ok') { pass++; continue; }
        fail++;
        const id = m[2].match(/AU-[A-Z]\d+[a-z]?/)?.[0];
        if (id && KNOWN[id]) known.push(`${m[2]} → ${KNOWN[id]}`);
        else failures.push(m[2]);
      }
      writeFileSync(`results/${file.replace('.test.mts', '')}.log`, out);
      resolve({ file, pass, fail, sec: Math.round((Date.now() - t0) / 1000), failures, known });
    });
  });
}

mkdirSync('results', { recursive: true });
const started = new Date();
for (const f of plan) {
  process.stdout.write(`▶ ${f} ... `);
  const r = await run(f);
  rows.push(r);
  const tag = r.failures.length ? '❌' : r.known.length ? '⚠️ ' : '✅';
  console.log(`${tag} ${r.pass}/${r.pass + r.fail} (${r.sec} s)`);
  for (const k of r.known) console.log(`     məlum: ${k}`);
  for (const x of r.failures) console.log(`     YENİ UĞURSUZLUQ: ${x}`);
}

const tp = rows.reduce((s, r) => s + r.pass, 0);
const tf = rows.reduce((s, r) => s + r.fail, 0);
const newFails = rows.flatMap((r) => r.failures.map((x) => `${r.file}: ${x}`));
const knownFails = rows.flatMap((r) => r.known.map((x) => `${r.file}: ${x}`));
const md = [
  `# Automation nəticəsi — ${started.toLocaleString('az-AZ', { timeZone: 'Asia/Baku' })} (Bakı)`,
  '',
  `Əmr: \`node run-tests.mts ${args.join(' ')}\` · Cəmi: **${tp}/${tp + tf}**`,
  '',
  '| Fayl | Nəticə | Müddət |',
  '|---|---|---|',
  ...rows.map((r) => `| ${r.file} | ${r.failures.length ? '❌' : r.known.length ? '⚠️' : '✅'} ${r.pass}/${r.pass + r.fail} | ${r.sec} s |`),
  '',
  `## Yeni uğursuzluqlar (${newFails.length})`,
  ...(newFails.length ? newFails.map((x) => `- ${x}`) : ['- yoxdur']),
  '',
  `## Məlum baglar (hələ düzəlməyib) (${knownFails.length})`,
  ...(knownFails.length ? knownFails.map((x) => `- ${x}`) : ['- yoxdur']),
  '',
  'Ətraflı loglar: `results/<fayl>.log`.',
].join('\n');
writeFileSync('results/summary-latest.md', md + '\n');
console.log(`\nCəmi ${tp}/${tp + tf} · yeni uğursuzluq: ${newFails.length} · məlum bag: ${knownFails.length} → results/summary-latest.md`);
process.exit(newFails.length ? 1 : 0);
