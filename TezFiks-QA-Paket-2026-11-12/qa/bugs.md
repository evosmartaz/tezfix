# TezFiks: bag siyahısı

Bagları istəsəniz buraya özünüz yazın, istəsəniz çatda mənə deyin, mən əlavə edərəm.
Mənbə: **M** manual (siz) · **A** automation (Claude)
Ciddilik: **Kritik** (pul, təhlükəsizlik, çökmə) · **Yüksək** (əsas axın işləmir) · **Orta** · **Aşağı** (görünüş, mətn)
Status: Yeni · Developerə göndərildi · Düzəldildi · Yoxlanıldı

---

## Şablon (kopyalayın)

Developerin bagı tək başına, sual vermədən təkrarlaya bilməsi üçün hər sahə doldurulur. Bir bag = bir problem.

### BUG-000: [Tətbiq] Qısa başlıq: harada və nə baş verir
(Məsələn: "[customer] Gec ləğvdə 15 AZN əvəzinə 25 AZN tutulur")

| Sahə | Dəyər |
|---|---|
| **Mənbə** | M (manual) / A (automation) — test ID: C-62 / AU-F06 |
| **Ciddilik (severity)** | Kritik / Yüksək / Orta / Aşağı |
| **Prioritet** | P1 dərhal / P2 bu buraxılışda / P3 sonra |
| **Təkrarlanma** | Həmişə / Bəzən (N cəhddən N) / Bir dəfə |
| **Status** | Yeni / Developerə göndərildi / Düzəldildi / Yoxlanıldı / Bağlandı |
| **Komponent** | customer app / pro app / admin panel / şirkət paneli / API |
| **Mühit** | Canlı demo · APK versiyası · cihaz və Android versiyası · brauzer |
| **Hesab** | Telefon və ya rol (məs. +994 55 200 00 24, Demo Müştəri) |
| **Obyekt ID-ləri** | Sorğu #, tapşırıq ID, ödəniş ID (varsa) |
| **Vaxt** | 2026-11-09 14:32 (Bakı) |

**İlkin şərtlər:** (məsələn, pul kisəsində 20 AZN var, 5 bot onlayndır)

**Addımlar:**
1.
2.
3.

**Gözlənilən nəticə:** (spesifikasiyaya istinadla, məs. "§4.1: müştəri −15 AZN")

**Faktiki nəticə:**

**Sübut:** ekran görüntüsü və ya video (`qa/screenshots/BUG-000-*.png`); API üçün sorğu və cavab (token-lər silinmiş)

**Texniki qeyd (Claude):** ehtimal olunan səbəb, fayl:sətir, əlaqəli test

---

**Ciddilik meyarları:**
- **Kritik:** pul səhv tutulur, məlumat sızır (telefon, başqasının məlumatı), tətbiq çökür, əsas axın tam bağlanır.
- **Yüksək:** əsas funksiya işləmir, amma yan yol var.
- **Orta:** ikinci dərəcəli funksiya və ya qeyri-düzgün davranış.
- **Aşağı:** mətn, tərcümə, görünüş.

---

## Baglar

### BUG-001: [customer tests] İki router testi tam run-da 5 s timeout-a düşür (flaky)

| Sahə | Dəyər |
|---|---|
| **Mənbə** | A — AU-Q01 |
| **Ciddilik** | Aşağı |
| **Prioritet** | P3 |
| **Təkrarlanma** | Bəzən: tam run-da 2 dəfədən 1; ayrıca run-da 0 |
| **Status** | Düzəldildi (lokal, commit olunmayıb) — 2026-11-09: 2 ardıcıl tam run, 383/383 |
| **Komponent** | `apps/customer` jest testləri |
| **Mühit** | Lokal, Windows 11, Node 26.13, commit 00368ff |
| **Vaxt** | 2026-11-09 |

**Addımlar:**
1. `npm test -w @tezfiks/customer -- --ci`

**Gözlənilən nəticə:** 383/383 keçir.

**Faktiki nəticə:** 381/383. `test/login-flow.test.tsx` və `test/restore-session.test.tsx` "Exceeded timeout of 5000 ms" xətası ilə sınır. Ardınca "require after the Jest environment has been torn down" xətası gəlir. Ayrıca işə salınanda hər ikisi keçir.

**Texniki qeyd (Claude):** `renderRouter` + `waitFor` ilə tam router render-i paralel jest worker-lərinin yükü altında 5 s-dən çox çəkir. Təklif: bu iki test üçün `it(..., 20000)` və ya `jest.setTimeout`. Assertion-lar dəyişmir.

**Düzəliş (T3):** hər iki testdə ilk router render-i üçün `waitFor(..., { timeout: 10_000 })` və test limiti `30_000` ms. Assertion-lar dəyişdirilmədi.

---

### BUG-002: [API] İmzalı fayl linkləri 10 dəqiqə əvəzinə ~1 saat etibarlıdır

| Sahə | Dəyər |
|---|---|
| **Mənbə** | A — AU-D08b (`qa/automation/06-validation.test.mts`) |
| **Ciddilik** | Aşağı |
| **Prioritet** | P3 |
| **Təkrarlanma** | Həmişə |
| **Status** | Yeni |
| **Komponent** | API: files (`apps/api/src/modules/files/files.service.ts`) |
| **Mühit** | Canlı demo, https://evosmart.az/tezfix/api |
| **Hesab** | +994 55 200 00 22 (Aysel) |
| **Vaxt** | 2026-11-09 (Bakı) |

**Addımlar:**
1. `POST /files` ilə `REQUEST_PHOTO` şəkli yükləyin, ya da şəkli olan istifadəçi üçün `GET /me` çağırın.
2. Cavabdakı `url` sahəsində `exp` parametrinə baxın.

**Gözlənilən nəticə:** spesifikasiyanın §12 bəndinə görə "Signed URLs (HMAC, 10 minutes)". 5 dəqiqəlik keş bucket-i ilə ən çox ~10–15 dəqiqə.

**Faktiki nəticə:** `exp` təxminən 57 dəqiqə sonradır. Səbəb: `FILE_URL_TTL_SEC` standart olaraq 3600 saniyədir (`apps/api/src/config/env.ts:42`). KYC faylları ayrıca limitlənib, problem onlara aid deyil.

**Texniki qeyd (Claude):** Production `.env` faylında `FILE_URL_TTL_SEC=600` təyin etmək, ya da standart dəyəri 600 etmək kifayətdir. Əgər 1 saat qəsdən seçilibsə, spesifikasiya yenilənməlidir.

---

### BUG-003: [pro + customer app] Xəritələr yüklənmir: Google Maps "Authorization failure"

| Sahə | Dəyər |
|---|---|
| **Mənbə** | A — AU-O01 (Maestro, real telefon) |
| **Ciddilik** | Yüksək |
| **Prioritet** | P2 |
| **Təkrarlanma** | Həmişə (3 açılışdan 3) |
| **Status** | Yeni |
| **Komponent** | pro app (ana ekran) və customer app (axtarış ekranı, `searching-screen`), 2026-11-10 AU-O02-də təsdiqləndi |
| **Mühit** | Canlı demo · `tezfiks-usta.apk` (`/download/`, 25.10.2026), versiya 0.1.0 · Samsung Galaxy A24 (SM-A245F), Android 16 |
| **Hesab** | +994 50 200 00 01 (Elvin) |
| **Vaxt** | 2026-11-10 10:35 (Bakı) |

**Addımlar:**
1. `https://tezfiks.evosmart.az/download/` səhifəsindən TezFiks Usta APK-nı quraşdırın.
2. Elvin hesabı ilə daxil olun (kod `123456`).
3. Ana ekranda xəritə kartına baxın, 20 saniyə gözləyin.

**Gözlənilən nəticə:** xəritə ustanın yeri ilə görünür.

**Faktiki nəticə:** kart qara qalır, yalnız "Google" loqosu görünür. Customer app-da da eyni: "Yaxınlıqdakı ustalar axtarılır" ekranında xəritə qaradır. Ekran görüntüləri: `qa/maestro/shots/phone/phone-pro-02-home.png`, `qa/maestro/shots/o02/o02-02-searching.png`.

`adb logcat`:
```
E Google Android Maps SDK: Authorization failure.
E Google Android Maps SDK: Ensure that the "Maps SDK for Android" is enabled.
E Google Android Maps SDK: Ensure that the following Android Key exists:
E Google Android Maps SDK:   API Key: AIzaSyC7…vrjEg
E Google Android Maps SDK:   Android Application (<cert_fingerprint>;<package_name>): 5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25;az.tezfiks.usta
```

**Texniki qeyd (Claude):**
- APK-da Maps açarı var, amma Google Cloud-da bu açar `SHA1;paket` cütü üçün icazəli deyil, ya da "Maps SDK for Android" aktiv deyil.
- Göstərilən SHA1 React Native şablonundakı `debug.keystore`-a məxsusdur: `apps/pro/android/app/debug.keystore` və `apps/customer/android/app/debug.keystore`. `build.gradle`-də `release` build da `signingConfigs.debug` ilə imzalanır (sətir 115).
- Tez düzəliş: Cloud Console-da açarın Android məhdudiyyətinə `5E:8F:…:F6:25;az.tezfiks.usta` və `…;az.tezfiks.app` əlavə etmək.
- Düzgün düzəliş (Play-dən əvvəl): öz release keystore-u ilə imzalamaq və həmin SHA1-i açara əlavə etmək. Debug keystore hamıya açıqdır. Onunla imzalanmış APK-nın üzərinə istənilən kəs eyni paket adı ilə "yeniləmə" quraşdıra bilər.

---

### BUG-004: [API] Axtarış başlayandan sonra müştərinin yanında onlayn olan usta təklifi heç vaxt almır

| Sahə | Dəyər |
|---|---|
| **Mənbə** | A — AU-O02 (Maestro) zamanı tapıldı, API ilə təkrarlandı (`qa/automation/tools/diag-late-online.mts`) |
| **Ciddilik** | Orta |
| **Prioritet** | P2 |
| **Təkrarlanma** | Həmişə (4 cəhddən 4: 1 dəfə telefonda, 1 dəfə Binəqədidə, 2 dəfə API ilə). Kontrol: usta əvvəlcədən onlayn olanda 2 cəhddən 2-də təklif gəlir |
| **Status** | Yeni |
| **Komponent** | API: dispatch (`apps/api/src/modules/requests/dispatch/dispatch.service.ts`) |
| **Mühit** | Canlı demo, https://evosmart.az/tezfix/api (demo taymerləri: ring 10 s, axtarış 90 s) |
| **Hesab** | Müştəri +994 55 200 00 24 (Demo Müştəri), usta +994 50 200 00 01 (Elvin, santexnik, radius 10 km) |
| **Obyekt ID-ləri** | Sorğular #1048 (`01a1c44a-…`), `01a1c45d-7cd4-…`, `01a1c469-57a0-…` |
| **Vaxt** | 2026-11-10 11:10–11:45 (Bakı) |

**İlkin şərtlər:** Elvin oflayndır, başqa boş santexnik yoxdur.

**Addımlar:**
1. Demo Müştəri ilə "İndi" santexnik sorğusu yaradın.
2. 2–5 saniyə sonra Elvini **sorğunun ünvanında** onlayn edin (`POST /pro/online` + `/pro/location`).
3. 100 saniyə gözləyin.

**Gözlənilən nəticə:** Elvin təklifi alır. Spesifikasiya §dispatch: son "wide" addımında "k5 plus providers whose declared service area covers the request cell". Elvin ünvana 0 m məsafədədir və ərazisi ünvanı əhatə edir.

**Faktiki nəticə:** Elvinə təklif gəlmir, sorğu `EXPIRED` olur. Müştəri "usta tapılmadı" görür, halbuki usta onun yanında onlayndır.

**Texniki qeyd (Claude):**
- Hər addım yalnız yeni halqadakı ustalara təklif göndərir (`soloEntries … ring.has(cell)`). Usta daxili halqa (k0/k1) keçəndən sonra onlayn olsa, həmin halqaya bir daha baxılmır.
- `wide` addımında (`dispatch.service.ts:333–346`) xidmət ərazisi üzrə namizədlər `known` siyahısı ilə süzülür: `known = entries.map(e => e.handymanId)`, yəni diskdəki **bütün** onlayn ustalar, o cümlədən heç vaxt təklif almamış olanlar. Ona görə yaxındakı usta wide addımda da çıxarılır.
- Təklif: `known` yalnız bu sorğuya artıq təklif almış ustalar olsun. Təkrar təklif onsuz da qadağandır. Ya da wide addımda bütün disk yenidən yoxlansın.
- Production taymerlərində (ring 30 s, daha uzun axtarış) pəncərə daha böyükdür: axtarış vaxtı tətbiqi açan usta yaxındakı sifarişi görmür.

---

### BUG-005: [pro app] Dil dəyişəndə ixtisas adları köhnə dildə qalır (profil yenidən yüklənmir)

| Sahə | Dəyər |
|---|---|
| **Mənbə** | A — AU-O07 (Maestro, real telefon) |
| **Ciddilik** | Aşağı |
| **Prioritet** | P3 |
| **Təkrarlanma** | Həmişə (RU və EN, 2/2) |
| **Status** | Yeni |
| **Komponent** | pro app: Profil → İş profili (profil sorğusunun keşi) |
| **Mühit** | Canlı demo · `tezfiks-usta.apk` 0.1.0 · Samsung Galaxy A24, Android 16 |
| **Hesab** | +994 50 200 00 01 (Elvin) |
| **Vaxt** | 2026-11-10 13:07 (Bakı) |

**Addımlar:**
1. Elvin ilə daxil olun (dil AZ).
2. Profil → Dil → **Русский** seçin. Sonra **English** seçin.
3. "İş profili" kartında ixtisaslara baxın.

**Gözlənilən nəticə:** RU-da "Сантехник, Котлы и отопление, Ремонтная бригада", EN-də "Plumber, Boilers & heating, Renovation crew". API bunları düzgün qaytarır: `GET /pro/profile`, `Accept-Language: ru/en`.

**Faktiki nəticə:** interfeys dili dəyişir ("Специальности:", "Trades:"), amma adlar Azərbaycan dilində qalır: "Santexnik, Kombi / istilik, Tikinti-təmir briqadası". Tab dəyişəndə də yenilənmir. Ekran görüntüləri: `qa/maestro/shots/o07/o07-01-ru.png`, `o07-03-en.png`.

**Texniki qeyd (Claude):** dil dəyişəndə serverdən gələn lokallaşdırılmış sorğular yenidən yüklənməlidir (profil, kateqoriyalar, bildirişlər). Məsələn `queryClient.invalidateQueries()` və ya query key-ə `locale` əlavə etmək. Customer app-da eyni davranış ayrıca yoxlanmayıb.

---

### BUG-006: [pro app] Şirkət təklif kartında "Qəbul et və…" düyməsinin mətni kəsilir

| Sahə | Dəyər |
|---|---|
| **Mənbə** | A — AU-O05 (Maestro, real telefon) |
| **Ciddilik** | Aşağı |
| **Prioritet** | P3 |
| **Təkrarlanma** | Həmişə (2/2) |
| **Status** | Yeni |
| **Komponent** | pro app: `components/CompanyHome.tsx`, `company-offer-accept-<id>` düyməsi |
| **Mühit** | Canlı demo · `tezfiks-usta.apk` 0.1.0 · Samsung Galaxy A24 (1080×2340, 450 dpi, şrift 1.0) |
| **Hesab** | +994 50 200 00 11 (Rauf, FixPro idarəedici) |
| **Vaxt** | 2026-11-10 13:19 (Bakı) |

**Addımlar:**
1. Rauf ilə daxil olun, şirkət rejimi.
2. FixPro-ya şirkət sifarişi gəlsin (Leyla, `providerPreference: COMPANY`).
3. Təklif kartının altındakı düymələrə baxın.

**Gözlənilən nəticə:** düymənin mətni tam oxunur.

**Faktiki nəticə:** "İmtina et" yanındakı yaşıl düymədə "✓ Qəbul et və.." görünür, mətnin sonu kəsilib. Ekran görüntüsü: `qa/maestro/shots/o05/o05-02-offer.png`.

**Texniki qeyd (Claude):** iki düymə yan-yana sıxışır. Mətni qısaltmaq ("Qəbul et"), düymələri alt-alta qoymaq və ya `adjustsFontSizeToFit` istifadə etmək olar. Böyük şriftdə (1.3x) daha pis ola bilər.

---

## Developerə suallar (bag deyil, spesifikasiyada aydın deyil)

### Q-01: Azərbaycandan kənar ünvanla sorğu qəbul olunur
`POST /requests` London koordinatları (51.5, -0.12) ilə 201 qaytarır və sorğu `SEARCHING` statusuna keçir. Orada usta olmadığı üçün sorğu sonda `EXPIRED` olacaq. Bu xidmət zonası yoxlaması lazımdırmı, yoxsa qəsdəndir ("sonra bütün dünya")? (AU-K01b)

### Q-02: "Gəldikdən sonra imtina" 5 dəqiqəlik pulsuz pəncərədə də 15 AZN cərimə tutur
`policy.ts` → `cancellationOutcome`: `DECLINE_ON_ARRIVAL` pəncərəni yoxlamır. Spesifikasiyanın §4.1 bəndi bu halı "After the window" altında sadalayır, qərar 9 isə şərtsiz "15 AZN" deyir. Usta 5 dəqiqədən tez gəlsə və müştəri imtina etsə, cərimə nəzərdə tutulubmu? (AU-F07)

### Q-03: Şirkət oflayn işçini sifarişə təyin edə bilir
Şirkət təklifinin işçi siyahısında oflayn Tural `online: false, busy: false` ilə görünür ("Oflayn · Boşdur"), `api.company.acceptOffer` (`{ workerIds: [Tural] }`) uğurla qəbul edir (assignment yaranır). Qəbul yoxlaması (`offers.service.ts:378–386`) üzvlük, status, ixtisas və məşğulluğu yoxlayır, onlayn olmanı yoxlamır. Spesifikasiya şirkətin təklif alması üçün "ən azı bir onlayn və boş işçi" tələb edir, amma seçim barədə susur. Oflayn işçiyə təyin etmək qəsdəndirmi (menecer zəng edib çağırır), yoxsa qadağan olmalıdır / xəbərdarlıq göstərilməlidir? Sübut: `qa/automation/13-busy-worker.test.mts` (Q-03 testi), 2026-11-10.
