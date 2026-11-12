# Retest təlimatı

Developer "düzəltdim" deyəndə və ya yeni versiya çıxanda bu ardıcıllıqla işləyin. Bütün əmrlər `qa/automation` qovluğunda işlədilir.

## 1. Bagları yoxlamaq (~2 dəq)

```bash
cd "D:/QA manual/tezfiks/qa/automation"
node retest-bugs.mts              # bütün açıq baglar
node retest-bugs.mts 004          # yalnız BUG-004
```

Hər bag üçün nəticə: ✅ DÜZƏLİB / ❌ HƏLƏ VAR / ⏸ YOXLANMADI. Nəticə `results/retest-latest.md` faylına yazılır.

| Bag | Necə yoxlanır |
|---|---|
| BUG-002 | API: imzalı URL-in `exp` müddəti ≤ 15 dəq |
| BUG-003 | Telefon (adb) lazımdır: usta tətbiqini açır, logcat-da "Authorization failure" axtarır |
| BUG-004 | API: sorğudan 3 s sonra onlayn olan usta 100 s ərzində təklif alırmı |
| BUG-005, BUG-006 | Telefon + Maestro (`qa/maestro/o07-…`, `o05b-…`). Skript `/download/` APK-larının dəyişib-dəyişmədiyini də göstərir |

## 2. Reqressiya: heç nə sınmayıb? (~5–50 dəq)

```bash
node run-tests.mts quick    # ~5 dəq: smoke, kontrakt, icazələr, validasiya, misc, şirkət paneli
node run-tests.mts flows    # ~10 dəq: əsas axın, B2B, dispatch, məşğul işçi
node run-tests.mts long     # ~40 dəq: ləğv/no-show (⚠️ Elvinə STRIKE yazır), avtomatik tamamlanma, B2B expiry
node run-tests.mts all      # hamısı
node run-tests.mts 03 09    # yalnız seçilmiş fayllar
```

Nəticə `results/summary-latest.md` faylına yazılır. "Məlum bag" kimi göstərilənlər hələ düzəlməyib (bax `run-tests.mts`, `KNOWN`). Bag düzələndə onu `KNOWN`-dan silin.

## 3. Mobil (telefon lazımdır)

1. Telefonda **Wireless debugging**-i yandırın. Eyni Wi-Fi-da olmalıdır.
2. Yeni APK varsa, `/download/`-dan yükləyib quraşdırın (`adb install -r --user 0 …`).
3. Ssenarilər: `qa/maestro/*.yaml`. Qarşı tərəf: `node mobile-driver.mts <serve|accept-only|customer|company>`. Ətraflı: `progression.md` (2026-11-10).

## Qaydalar

- OTP limiti: bir nömrəyə saatda 5 kod. Testlər token-ləri `.tokens.json`-da saxlayır, ona görə təkrar girişlər az olur.
- BUG-004 düzələnə qədər usta sorğudan **əvvəl** onlayn olmalıdır, skriptlər bunu nəzərə alır.
- Hesabat: yeni PDF yarananda köhnə hesabat silinir, `qa/reports/`-da yalnız sonuncu qalır.
