# TezFiks — QA paketi (IT üçün)

**Tarix:** 12.11.2026

Bu paketdə TezFiks layihəsinin mənbə kodu və bu günə qədər görülmüş bütün QA işi var.

## İçindəkilər

| Qovluq / fayl | Nədir |
|---|---|
| `DEVELOPERDEN-TELEBLER.md` | **Əvvəlcə bunu oxuyun:** QA-nı bitirmək üçün developerdən nə lazımdır (PDF versiyası ayrıca göndərilir) |
| `tezfiks-source/` | Layihənin mənbə kodu (git commit `00368ff`). `node_modules`, `.env`, keystore və APK yoxdur |
| `qa/reports/TezFiks-QA-2026-11-10.pdf` | Developerə göndərilmiş sonuncu QA hesabatı (baglar, sübutlar, nəticələr) |
| `qa/bugs.md` | Bütün baglar (BUG-001…006) və suallar (Q-01…03), developer formatında |
| `qa/pdf/TezFiks-QA-Test-Plani-2026-11-09.pdf` | Test planı: ~185 manual yoxlama, ~130 automation testi |
| `qa/manual-checklist.md`, `qa/automation-plan.md` | Test siyahıları (mənbə) |
| `qa/automation/` | Canlı demoya qarşı API/panel testləri (Node test runner + Playwright) və retest skriptləri |
| `qa/automation/tools/` | Birdəfəlik diaqnostika və təmizləmə skriptləri (`diag-*`, `check-*`, `cleanup-mobile`, `confirm-cash`). İşə salmaq: `cd qa/automation && node tools/<fayl>.mts` |
| `qa/maestro/` | Real telefon üçün mobil ssenarilər (Maestro) və ekran görüntüləri (`shots/`) |
| `qa/RETEST.md` | Developer "düzəltdim" deyəndə testləri təkrarlamaq təlimatı |
| `qa/admin-pending.md` | Admin hesabı gələndə işlədiləcək testlər |
| `patches/BUG-001-customer-tests-timeout.patch` | QA-nın düzəltdiyi flaky test (developer commit etməlidir) |
| `QA-jurnal/progression.md`, `tasks.md` | QA-nın gün-gün iş jurnalı və tapşırıq siyahısı |

## Testləri işə salmaq (qısa)

```bash
cd qa/automation
npm install            # node_modules paketə daxil edilməyib
node run-tests.mts quick
node retest-bugs.mts
```

- Node.js 22+ tələb olunur.
- İlk girişdə testlər demo hesablarına OTP ilə daxil olur (demo kodu `123456`). Token-lər `.tokens.json`-a yazılır.
- Paketə köhnə token-lər qoyulmayıb.
- OTP limiti: bir nömrəyə saatda 5 kod.

## Paketə daxil edilməyənlər (qəsdən)

- `.env` faylları, parollar, sessiya token-ləri (`.tokens.json`), imza açarları (keystore, o cümlədən `debug.keystore`).
- `node_modules`, build nəticələri (`dist`, `.next`, `.expo`), APK-lar, test zamanı yüklənmiş fayllar (`uploads/`, KYC şəkilləri). APK-lar `https://tezfiks.evosmart.az/download/`-dadır.
- Maestro-nun debug artefaktları (~140 MB). Yekun ekran görüntüləri `qa/maestro/shots/`-dadır.
