# TezFiks — QA-nı bitirmək üçün developerdən tələblər

**Tarix:** 12.11.2026
**Layihə:** TezFiks (müştəri tətbiqi, usta tətbiqi, şirkət paneli, admin panel, API)
**Test olunan versiya:** repo commit `00368ff`, `/download/` APK-ları (25.10.2026, versiya 0.1.0), canlı demo `https://evosmart.az/tezfix/api`
**Ətraflı bag hesabatı:** `qa/reports/TezFiks-QA-2026-11-10.pdf`, bag siyahısı `qa/bugs.md`

---

## 1. Hazırkı vəziyyət (qısa)

| Sahə | Nəticə |
|---|---|
| Layihənin öz testləri (shared, i18n, mobile, customer, pro, panel) | 1268/1268 ✅ (2 flaky test bizdə düzəldildi, bax BUG-001) |
| Canlı API automation (QA-nın yazdığı 13 dəst) | 117/118 ✅ (yeganə uğursuz test BUG-002-dir) |
| Real telefonda mobil E2E (Maestro, Samsung A24) | 7/7 ssenari ✅ |
| Test planının əhatəsi | 103/128 (80%) |
| Tapılan baglar | 6: 1 Yüksək, 1 Orta, 4 Aşağı |
| Developerə suallar | 3 |

QA-nın qalan **25 testi** və **yekun təsdiqi (sign-off)** aşağıdakı maddələrdən asılıdır.

---

## 2. Bloklayanlar: bunlar olmadan QA bitə bilməz

### 2.1 QA admin hesabı (canlı demo) — **ƏN VACİB**

- **Nə lazımdır:** demo serverdə QA üçün ayrıca admin hesabı (e-poçt + parol). Parolu təhlükəsiz kanalla göndərin, mesajda açıq yazmayın.
- **Niyə:** ~22 admin testi yalnız bununla işləyir:
  - KYC təsdiqi / rəddi;
  - ustanın bloklanması və strike-ların sıfırlanması;
  - audit jurnalı;
  - tənzimləmələr;
  - demo botları;
  - balans düzəlişi;
  - qiymət mübahisəsi;
  - zəmanət;
  - hesab-faktura "ödənildi";
  - payout `PAID`/`FAILED`;
  - admin panelin brauzer testləri.
- **Siyahı:** `qa/admin-pending.md`.
- **Qeyd:** testlərdən sonra usta **Elvin**-in hesabında 3 strike qalıb. Admin hesabı verilməsə, onları developer sıfırlamalıdır.
- **İlk dəfə istənilib:** 09.11.2026.

### 2.2 BUG-003 düzəlişi və yeni APK — **YÜKSƏK**

- **Problem:** hər iki tətbiqdə xəritə qara qalır (Google Maps "Authorization failure").
- **Səbəb:** APK-lar React Native-in ümumi `debug.keystore`-u ilə imzalanıb (SHA1 `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`), Maps açarı isə bu imzaya icazə vermir. `release` build də `signingConfigs.debug` istifadə edir.
- **Nə lazımdır:**
  1. Öz **release keystore** ilə imzalamaq. Debug keystore hamıya açıqdır, onunla imzalanmış tətbiqin üzərinə istənilən kəs "yeniləmə" quraşdıra bilər. Bu, Play Store-dan əvvəl mütləqdir.
  2. Google Cloud Console-da Maps açarına yeni SHA1 + paket adlarını (`az.tezfiks.usta`, `az.tezfiks.app`) əlavə etmək, "Maps SDK for Android" aktiv olmalıdır.
  3. Yeni APK-ları **versiya nömrəsini artıraraq** `/download/`-a qoymaq.

### 2.3 Hər yeni versiya ilə "nə dəyişdi" qeydi

- **Nə lazımdır:** hər yeni APK və ya server yeniləməsi ilə qısa qeyd: versiya, tarix, hansı bag düzəldilib (BUG-nömrə ilə), commit hash.
- **Niyə:** QA bununla retest edir. Retest paketimiz hazırdır: bir əmrlə bütün testlər + açıq bagların yoxlanması (`qa/RETEST.md`).

### 2.4 Repo-ya oxuma icazəsi (GitHub)

- **Nə lazımdır:** QA/IT üçün `github.com/preklis/tezfiks` reposuna **read-only** giriş.
- **Niyə:** hazırda repo private-dır və QA developerin düzəlişlərini görə bilmir. Hansı versiyanı test etdiyimizi dəqiqləşdirmək üçün lazımdır.

---

## 3. Düzəldilməli baglar

| # | Ciddilik | Problem | Harada | Təklif olunan həll (qısa) |
|---|---|---|---|---|
| **BUG-003** | **Yüksək** | Xəritələr yüklənmir | pro + customer app | Bax 2.2 |
| **BUG-004** | Orta | Axtarış başlayandan sonra onlayn olan yaxın usta təklif almır, sorğu `EXPIRED` olur | API `dispatch.service.ts:333–346` | `wide` addımında `known` yalnız bu sorğuya artıq təklif almış ustalar olsun, diskdəki bütün onlayn ustalar yox |
| BUG-002 | Aşağı | İmzalı fayl linkləri spesifikasiyadakı 10 dəq əvəzinə ~1 saat etibarlıdır | API `config/env.ts:42` | Production-da `FILE_URL_TTL_SEC=600`. Və ya 1 saat qəsdəndirsə, spesifikasiyanı yeniləyin |
| BUG-005 | Aşağı | Usta tətbiqində dil dəyişəndə ixtisas adları köhnə dildə qalır | pro app, profil keşi | Dil dəyişəndə `queryClient.invalidateQueries()` və ya query key-ə `locale` |
| BUG-006 | Aşağı | Şirkət kartında "Qəbul et və…" düyməsinin mətni kəsilir | pro app `CompanyHome.tsx` | Mətni qısaltmaq və ya düymələri alt-alta qoymaq |
| BUG-001 | Aşağı | 2 customer testi tam run-da timeout-a düşür (flaky) | `apps/customer/test/` | **QA düzəldib.** Patch: `patches/BUG-001-customer-tests-timeout.patch`. Yalnız commit etmək lazımdır |

Hər bagın addımları, sübutu (ekran görüntüsü, log, obyekt ID-ləri) və texniki təhlili `qa/bugs.md`-də və PDF hesabatdadır.

---

## 4. Cavab gözləyən suallar (spesifikasiyada aydın deyil)

| # | Sual | Bizə lazım olan |
|---|---|---|
| Q-01 | Azərbaycandan kənar ünvanla (məs. London) sorğu qəbul olunur və axtarışa düşür | Xidmət zonası yoxlaması lazımdır, yoxsa qəsdəndir? |
| Q-02 | Usta 5 dəqiqəlik pulsuz pəncərədə gəlsə və müştəri "gəldikdən sonra imtina" etsə, yenə 15 AZN cərimə tutulur (`policy.ts`) | Bu, nəzərdə tutulubmu? |
| Q-03 | Şirkət **oflayn** işçini sifarişə təyin edə bilir (`offers.service.ts:378–386`) | Qəsdəndir (menecer zəng edir), yoxsa qadağan olunmalı / xəbərdarlıq göstərilməlidir? |

Hər cavab ya "bag deyil, bağlayırıq", ya da yeni bag kimi qeyd olunacaq.

---

## 5. Təsdiqlər

| # | Nə | Niyə |
|---|---|---|
| 5.1 | API inteqrasiya dəstinin (692 test) **son commit-də** keçdiyini göstərən CI nəticəsi və ya ekran görüntüsü | QA bu dəsti işlətmir, çünki Docker tələb edir. Developerin nəticəsi qəbul olunub, amma son versiya üçün təsdiq lazımdır |
| 5.2 | Rate-limit testləri üçün **bir demo telefon nömrəsi** (OTP limiti: saatda 5 kod) | Bu test həmin nömrəni ~1 saat bloklayır. Digər demo istifadəçilərinə təsir etməməsi üçün ayrıca nömrə lazımdır |
| 5.3 | Production taymerləri və limitləri (ring, axtarış müddəti, OTP limitləri) | Demo taymerləri qısadır. Yekun hesabatda production dəyərləri ilə müqayisə üçün |

---

## 6. Developer bunları verəndən sonra QA nə edəcək

1. **Retest:** bütün açıq baglar və tam reqressiya, ~1–1.5 saat (`qa/RETEST.md`).
2. **Admin testləri:** ~22 test, ~2 saat.
3. **Mobil retest:** yeni APK ilə xəritə, dil və düymə yoxlaması, manual siyahının telefon hissəsi.
4. **Rate-limit testləri:** ən sonda, ayrıca nömrə ilə.
5. **Yekun QA hesabatı (PDF) və sign-off:** hansı baglar bağlandı, nə qalıb, buraxılışa hazırlıq qərarı.

**Təxmini müddət:** bütün maddələr gələndən sonra 1–2 iş günü.

---

## 7. Xülasə — developerə yoxlama siyahısı

- [ ] QA admin hesabı (demo) + Elvinin strike-larının sıfırlanması
- [ ] Release keystore + Maps açarı → yeni APK-lar (BUG-003)
- [ ] BUG-004 düzəlişi (dispatch)
- [ ] BUG-002, BUG-005, BUG-006 düzəlişləri
- [ ] BUG-001 patch-inin commit edilməsi
- [ ] Q-01, Q-02, Q-03 cavabları
- [ ] Hər yeni versiya üçün qısa "nə dəyişdi" qeydi
- [ ] Repo-ya read-only giriş (QA/IT)
- [ ] 692 API testinin son commit-də keçdiyinin təsdiqi
- [ ] Rate-limit testi üçün ayrıca demo nömrəsi
