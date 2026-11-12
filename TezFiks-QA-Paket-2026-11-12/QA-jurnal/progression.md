# İrəliləyiş jurnalı

Ən yeni qeyd yuxarıdadır. Tapşırıq nömrələri `tasks.md` faylındakı nömrələrə uyğundur.

---

## 2026-11-12 (gün ortası) — T19 davam etdi, "saxla" ilə dayandırıldı ⏸ — DAVAM NÖQTƏSİ

- **İstifadəçinin qərarları (cavablandı):**
  1. API dəsti (692): **developerin 692/692 nəticəsi qəbul olunur**, Docker qurulmur. Hesabatda belə yazılacaq.
  2. Rate-limit testləri (2): **işlədiləcək, ən sonda**, ayrıca test nömrəsi ilə (nömrə ~1 saat bloklanır).
  3. Manual siyahı (~90 yoxlama, 9 bölmə): **birlikdə**. Telefonla edilə bilənləri Claude Maestro ilə avtomatlaşdırır (ekran görüntüsü ilə). Yalnız göz tələb edən yoxlamalar istifadəçiyə qısa siyahı kimi verilir.
- **Saxla anında:**
  - `node run-tests.mts all` arxa fonda hələ işləyirdi. `long` qrupuna çatmışdı: 11/11 və `13-busy-worker` 5/5 keçmişdi, `04-cancellations` işləyirdi (Elvinə strike yazır).
  - Kompüter söndürülsə, run yarımçıq qala bilər.
  - Retest (`retest-bugs.mts`) çıxışı log-a düşmədi. `results/retest-latest.md` hələ 10.11 tarixlidir, yəni retest yenidən işlədilməlidir.
- **Qayıdanda ilk iş:**
  1. `results/summary-latest.md` tarixinə bax. 12.11-dirsə, reqressiya bitib, nəticəni oxu. Deyilsə, `node run-tests.mts all`-u yenidən işlət.
  2. `node cleanup-mobile.mts` (yarımçıq run açıq sorğu və onlayn usta qoya bilər).
  3. `node retest-bugs.mts` → `results/retest-latest.md`.
  4. Manual bölgüsü: `qa/manual-checklist.md`-ni Maestro-ya uyğun və göz tələb edən hissələrə ayır. Telefon qoşulmalıdır (Wireless debugging, `adb pair`).
  5. Admin hesabı gəlibsə → `qa/admin-pending.md`.
  6. Rate-limit (ən sonda) → yekun PDF (`qa/reports/`, köhnəni sil) → sign-off.
- **Qeyd:** `qa/` developerin reposunda commit olunmur (untracked), WIP commit edilmədi.

---

## 2026-11-12 — T19: QA-nı tam bağlamaq başladı, dayandırıldı ⏸

- **Məqsəd (istifadəçi):** TezFiks QA tərəfini tam bitirmək. İstifadəçi sonra işi saxlayıb Evo Georgia-ya keçdi.
- **Edilənlər:**
  - vəziyyət xülasəsi verildi;
  - T19 açıldı;
  - `retest-bugs.mts` + `run-tests.mts all` arxa fonda başladıldı.
- **Nəticə yoxdur:** sessiya bağlandı, `results/t19-run.log`-da yalnız başlıq qaldı. Ilişən `retest-bugs` prosesi söndürüldü. `cleanup-mobile.mts` işlədildi: açıq sorğular bağlandı, Elvin/Kamran/Tural oflayndır.
- **Vəziyyət:**
  - telefon qoşulu deyil;
  - admin hesabı (`TF_ADMIN_EMAIL`) yoxdur;
  - repo private-dır, `git ls-remote` giriş olmadan işləmir.
- **Cavabsız qalan 3 sual:**
  1. API dəsti (692): developerin nəticəsini qəbul etmək, yoxsa Docker qurmaq.
  2. Rate-limit testləri (2): ən sonda işlətmək, yoxsa atlamaq.
  3. Manual siyahı (~85): birlikdə (Maestro + qısa əl siyahısı), istifadəçi özü, yoxsa atlamaq.
- **Davam etmək üçün:**
  1. `cd qa/automation && node retest-bugs.mts && node run-tests.mts all` (~1 saat);
  2. 3 sualın cavabı;
  3. telefon → BUG-003/005/006;
  4. admin hesabı → `qa/admin-pending.md`;
  5. yekun PDF və sign-off.
- **Mənim səhvim (3-cü dəfə):** `node -e` daxilində backtick-lər bash tərəfindən icra olundu. Faylda heç nə dəyişmədi. Dərs: markdown mətnini faylın içinə yalnız Edit/Write ilə yazmaq.

---

## 2026-11-10 — T18: retest paketi hazırdır ✅

- **`run-tests.mts`:** testləri qruplarla işlədir və nəticəni `results/summary-latest.md`-yə yazır. Məlum baglar (`KNOWN`) "yeni uğursuzluq" sayılmır.
  - `quick` ~5 dəq (01, 02, 05, 06, 08, 10);
  - `flows` ~5–10 dəq (03, 07, 09, 13);
  - `long` ~40 dəq (04, 11, 12; 04 Elvinə strike yazır).
- **`retest-bugs.mts`:** hər açıq bag üçün DÜZƏLİB / HƏLƏ VAR / YOXLANMADI, nəticə `results/retest-latest.md`-dədir.
  - BUG-002: imzalı URL müddəti; profildə şəkil yoxdursa PNG yükləyir;
  - BUG-004: gec onlayn olan usta;
  - BUG-003: telefon varsa logcat;
  - BUG-005/006: Maestro-ya yönləndirir.
  - Hamısı üçün `/download/` APK-larının md5 müqayisəsi var.
- **Təlimat:** `qa/RETEST.md`.
- **Bugünkü baza:**
  - quick **65/66** (yalnız BUG-002);
  - flows **37/37**;
  - retest: BUG-002 ❌ (57 dəq), BUG-004 ❌, APK-lar dəyişməyib.
- **Mobil:** telefon qoşulmadı (Wireless debugging sönük idi). Customer dil yoxlaması (BUG-005-in customer variantı) sonraya qaldı.
- **Mənim səhvim (2-ci dəfə):** heredoc-dan əvvəl stdin-siz `cat >` yazdım, əmr ilişdi. Dayandırılıb düzəldildi. Dərs: `cat > fayl` yalnız heredoc ilə.

---


## 2026-11-10 — T17: hesabat BUG-006 və Q-03 ilə yeniləndi ✅

- **Fayl:** `qa/reports/TezFiks-QA-2026-11-10.pdf` (1.2 MB). Eyni ad, köhnəsinin yerinə yazıldı, `qa/reports/`-da yenə tək hesabat var.
- **Əlavələr:**
  - BUG-006 bölməsi (kəsilmiş düymənin ekran görüntüsü ilə);
  - Q-03 sualı;
  - API cədvəlində `13-busy-worker` 5/5 (cəmi **117/118**);
  - KPI: 6 bag (1 Yüksək, 1 Orta, 4 Aşağı) + 3 sual;
  - "Qalanlar" cədvəlindən AU-F24 çıxarıldı, retest əlavə olundu;
  - müşahidələrdən düymə və oflayn işçi bəndləri çıxarıldı, çünki artıq BUG-006 və Q-03-dür.
- **Yoxlama:** Chrome ekran görüntüsü ilə yoxlandı, yeni bölmələr və şəkil yerindədir.
- **Diqqət:** developerə əvvəl göndərilən PDF-də BUG-006 və Q-03 yoxdur. Yeni PDF-i yenidən göndərmək lazımdır.

---


## 2026-11-10 — T16: yalnız sonuncu hesabat saxlanılır ✅

- **İstifadəçinin qaydası:** yeni hesabat əlavə ediləndə əvvəlkilər silinir, çünki qarışır.
- **Silindi:**
  - `qa/reports/TezFiks-QA-2026-11-09.html` və `.pdf`;
  - `qa/automation/TezFiks-QA-2026-11-09.html` (boş fayl, 0 bayt).
- **Qalır:**
  - `qa/reports/TezFiks-QA-2026-11-10.html/.pdf`;
  - test planı `qa/pdf/TezFiks-QA-Test-Plani-2026-11-09.pdf`. Bu, ayrı sənəddir, hesabat deyil.

---


## 2026-11-10 — T15: AU-F24 tam yoxlandı; BUG-006 və Q-03 əlavə olundu ✅

- **Fayl:** `qa/automation/13-busy-worker.test.mts`, **5/5**, log `results/13-busy-worker.log`. Əvvəl F24 şərti idi: məşğul işçi yox idi.
- **Nəticələr:**
  - Kamran 1-ci şirkət sifarişinə təyin olundu;
  - 2-ci sifarişdə namizədlər: Tural `busy:false`, Kamran `busy:true` (hər ikisi 268 m);
  - Kamran ilə qəbul → `409 WORKER_UNAVAILABLE`, şirkətin hold-u dəyişmədi;
  - Tural ilə qəbul → 1 assignment, +10 AZN hold.
- **Q-03 (sual):** oflayn Tural siyahıda `online:false, busy:false` görünür və onunla qəbul **uğurludur**. `offers.service.ts:378–386` onlayn olmanı yoxlamır. Spesifikasiya bu barədə susur.
- **BUG-006 (Aşağı):** şirkət təklif kartında "Qəbul et və.." düyməsinin mətni kəsilir (O05-də görülmüşdü).
- **Qeyd:** BUG-006 və Q-03 10.11 PDF-ində yoxdur (PDF artıq developerə göndərilib). Növbəti hesabata düşəcək.
- **Qeyd:** test vaxtı internet bir müddət kəsildi (DNS xətası), qayıdandan sonra təkrar işlədildi.
- **Plan əhatəsi:** F24 artıq sayılmışdı, 103/128 dəyişmir.
- **Automation-da qalanlar (hamısı xarici asılılıq):**
  - admin ~22 (hesab);
  - rate-limit 2 (icazə);
  - API dəsti (Docker);
  - retest (developer düzəlişləri).

---


## 2026-11-10 — T14: Hesabat №1 yeniləndi (PDF) ✅

- **Fayl:** `qa/reports/TezFiks-QA-2026-11-10.pdf` (1.2 MB, mənbə `.html` eyni qovluqda). 09.11 versiyası dəyişdirilmədi.
- **Əlavə olunanlar:**
  - KPI-lar: mobil 7/7, plan əhatəsi **103/128 (80%)**, 5 bag;
  - mobil E2E bölməsi: O01–O07 cədvəli və 4 ekran görüntüsü;
  - BUG-003 (logcat və 2 ekran), BUG-004, BUG-005;
  - yeni müşahidələr: düymə mətni kəsilir, oflayn işçi "Boşdur", ünvan koordinatla görünür, Google Pay avto-doldurma;
  - qalan işlər cədvəli.
- **Yoxlama:** HTML Chrome ilə ekran görüntüsü kimi yoxlandı, şəkillər və cədvəllər yerindədir. PDF Chrome headless ilə çap olundu.
- **Automation-u tam bitirmək üçün qalanlar:**
  - admin testləri ~22 (admin hesabı);
  - rate-limit 2 (icazə);
  - API inteqrasiya dəsti (Docker);
  - AU-F24 "məşğul işçi" (indi edilə bilər);
  - BUG-001 commit qərarı (developer);
  - düzəlişlərdən sonra retest.

---


## 2026-11-10 — T6 (Maestro) bitdi: AU-O01…O07 keçdi, BUG-005 tapıldı ✅

- **AU-O03 ✅** (ləğvlər):
  - pulsuz ləğv: `CANCELLED_FREE`, heç nə tutulmur;
  - gec ləğv (5 dəq sonra): xəbərdarlıqda "15,00 ₼ cərimə", müştəri −15, Elvin haqqı geri + 10 kompensasiya.
- **AU-O04 ✅** (Elvin pro app-da): onlayn → təklif pəncərəsi → qəbul → yola çıxdım → gəldim → klaviatura ilə 35 + 10 → təsdiq; müştəri nağd (API) → "Tamamlandı", 45 ₼, haqq 10 ₼.
- **AU-O05 ✅** (Rauf, şirkət rejimi): təklif kartı (15 s), tək onlayn işçi Kamran avtomatik seçilir → "Qəbul et" → işə Kamran təyin olunur.
- **AU-O06 ✅** (Kamran): `job-limited` görünüş; təsvir, qiymət və məbləğ yoxdur; ünvan, kateqoriya, müştəri adı və şirkət var.
- **AU-O07 ✅:**
  - dil keçidi RU/EN/AZ;
  - Samir: "Yoxlama prosesi" kartı, onlayn düyməsi yoxdur;
  - Vüqar: "Hesab bloklanıb", onlayn düyməsi yoxdur.
- **BUG-005 (Aşağı):** pro app-da dil dəyişəndə ixtisas adları AZ-da qalır. API düzgün lokallaşdırır, tətbiq profili yenidən yükləmir.
- **Müşahidələr (bag kimi yazılmayıb, manual testdə baxmaq olar):**
  - şirkət təklif kartında "Qəbul et və.." düyməsinin mətni kəsilir;
  - oflayn olan Tural da "Boşdur" nişanı ilə siyahıda görünür;
  - usta ünvana çox yaxın olanda müştəri telefonu dərhal açılır (ETA ≤ 5 dəq qaydası, gözləniləndir).
- **Ssenari dərsləri:**
  - xəritə ekranın ortasındakı swipe-ı tutur, ona görə aşağıdan swipe lazımdır;
  - şirkət təklifi TTL 15 s olduğu üçün addımlar minimum olmalıdır;
  - `pro-login.yaml`-ın öz `env`-i ötürülən PHONE-u üstələyir, ona görə `sub-pro-login.yaml` yaradıldı;
  - BUG-004-ə görə usta sorğudan əvvəl onlayn olmalıdır, tətbiqdən onlayn olanda isə ~25 s gözləmək lazımdır.
- **Yığışdırma:**
  - açıq sorğular bağlandı, Elvin/Kamran/Tural oflayndır;
  - telefonda ekranın sönmə vaxtı 30 s-ə, məkan isə "sönük"-ə qaytarıldı; ekran ölçüsü və şrift orijinaldır.
- **Telefonda qalanlar:** TezFiks, TezFiks Usta və Maestro köməkçi tətbiqləri, həmçinin Wireless debugging yanılıdır (istifadəçi söndürə bilər).

---


## 2026-11-10 — T6 (Maestro): AU-O01 və AU-O02 keçdi, BUG-004 tapıldı 🔄

- **AU-O01 ✅:** 4 ssenari 5 ekran ölçüsündə (small, standard, large-font 1.3x, tall-hd, short-wide), **12/12**. Ekranlar `qa/maestro/shots/<ölçü>/`-dədir. Kiçik ekranda və böyük şriftdə yerləşmə problemi görünmədi. Skript: `qa/maestro/run-sizes.sh`. Sonda telefonun ekranı bərpa olundu: 1080x2340, 450 dpi, şrift 1.0.
- **AU-O02 ✅** (Demo Müştəri, telefonda Maestro + Elvin API ilə, `qa/automation/mobile-driver.mts`):
  - sorğu → Elvin qəbul edir → yola çıxır → gəlir → 35 + 10 AZN;
  - ödəniş ekranı 45 AZN göstərir → checkout-da test kartı 4242 → 5 AZN bəxşiş (ikinci checkout) → 5 ulduz;
  - API təsdiqi: `COMPLETED`, ödəniş `SUCCEEDED`, bəxşiş 500, zəmanət 24.11.2026-yə qədər (14 gün), Elvindən 10 AZN haqq tutulub;
  - ssenarilər: `qa/maestro/o02a/b/c-*.yaml`, ekranlar `qa/maestro/shots/o02/`-dədir.
- **BUG-004 (Orta, API dispatch):** axtarış başlayandan sonra müştərinin yanında onlayn olan usta təklifi heç vaxt almır, sorğu `EXPIRED` olur.
  - 4/4 təkrarlandı, kontrol (usta əvvəlcədən onlayn) 2/2 keçdi.
  - Səbəb: `dispatch.service.ts:333–346`, wide addımında `known` = diskdəki bütün onlayn ustalar.
  - Təkrar skripti: `qa/automation/diag-late-online.mts`.
- **BUG-003 genişləndi:** customer app-da da xəritə qaradır (axtarış ekranı).
- **⚠️ Təhlükəsizlik qeydi:** checkout səhifəsində Chrome/Google Pay avto-doldurma pəncərəsi telefon sahibinin **real kartını** təklif edir. Ssenari onu həmişə "back" ilə bağlayır, heç vaxt seçmir. Bu, TezFiks bagı deyil.
- **Səhv (mənim):** ilk diaqnostika skripti boş `cat` əmrində ilişdi (stdin gözlədi). Dayandırıldı və düzəldildi.
- **Qalır:** O03 (ləğvlər), O04 (Elvin pro axını), O05 (Rauf), O06 (Kamran), O07 (dil, Samir, Vüqar).

---


## 2026-11-10 — T6 (Maestro): real telefonda ilk run, BUG-003 tapıldı 🔄

- **Cihaz:** Samsung Galaxy A24 (SM-A245F), Android 16. Telefonun USB portu şarj etmir, ona görə **Wi-Fi debugging** ilə qoşulduq (`adb pair` + mDNS).
- **Quraşdırma (`D:\tools`, ~700 MB):**
  - adb, Java 17 (Temurin), Maestro 2.12.1;
  - APK-lar `/download/`-dan götürüldü: `D:\tools\apk`.
- **Telefonda müvəqqəti dəyişikliklər (sonda geri qaytarılacaq):**
  - ekranın sönmə vaxtı 30 s → 30 dəq (orijinal dəyər `D:\tools\screen_off_timeout.orig`-dədir);
  - məkan yandırıldı (əvvəl sönük idi, `D:\tools\location.orig`).
- **Problemlər və həll yolları:**
  - Maestro öz driver tətbiqini Samsung-un əlavə profilinə ("user 150") görə quraşdıra bilmir. Driver əl ilə `--user 0` ilə quraşdırıldı, testlər `--no-reinstall-driver` ilə işlədilir.
  - Telefon Azərbaycan dilindədir, icazə düymələri ingiliscə axtarılırdı. `qa/maestro/` qovluğunda dildən asılı olmayan nüsxələr yaradıldı. Developer-in `e2e/maestro` fayllarına toxunulmadı.
- **Nəticə:** mövcud 4 ssenari (customer-login, customer-screens, pro-login, pro-screens) **4/4 keçdi**. 14 ekran görüntüsü `qa/maestro/shots/phone/`-dadır.
- **BUG-003 (Yüksək):** Pro ana ekranında xəritə qara qalır, logda Google Maps "Authorization failure" var. Release APK-lar RN `debug.keystore` ilə imzalanıb (SHA1 `5E:8F:…:F6:25`), Maps açarı bu imzaya icazə vermir. Debug keystore ilə imzalanma Play üçün də risklidir. Ətraflı: `qa/bugs.md`.
- **Qeyd:** customer-də ünvan koordinat kimi görünür (`40.44325, 49.86070`). Bu, `GOOGLE_MAPS_SERVER_KEY` olmayanda spesifikasiyaya görə gözlənilən davranışdır, bag deyil.
- **Qalır:** 5 ekran ölçüsü (AU-O01), O02–O07 ssenariləri.

---


## 2026-11-09 — T13: Desktop-dakı TezFiks nüsxəsi silindi ✅

- **Nəticə:** layihə artıq yalnız `D:\QA manual\tezfiks`-dədir. C diskində boş yer 11.5 GB-dan **49.2 GB**-a qalxdı.
- **Silinməzdən əvvəl yoxlandı:**
  - Desktop nüsxəsi eyni commit-də idi (`00368ff`).
  - Yeganə dəyişiklik avtomatik yaranan `apps/panel/next-env.d.ts` idi.
  - `apps/api/.env`, `apps/api/uploads/`, `debug.keystore` faylları, `local.properties`, `gradle.properties` və release APK-lar D-dəki ilə bayt-bayt eynidir.
- **Silinmə:** robocopy /MIR üsulu ilə, çünki yollar çox uzun idi. Nüsxə ~29 GB idi, bunun ~18 GB-ı `node_modules` içindəki Android build qalıqları idi.
- **Qalıq:** boş `Desktop\tezfiks` qovluğu Claude sessiyası tərəfindən tutulduğu üçün silinmədi. Sessiya bağlanandan sonra əl ilə silmək olar. Qovluq 0 bayt tutur.
- **Əlavə:** C diskində Temp, npm, NuGet və brauzer keşləri təmizləndi (~6.8 GB).

---

## 2026-11-09 — T6 (Maestro): sonraya saxlanıldı ⏸

- **Yoxlama:** bu kompüterdə Android SDK, emulyator, Java və Maestro yoxdur. Hypervisor aktivdir. C diskində 11.5 GB, D diskində 72.8 GB boş yer var.
- **Qərar:** istifadəçi Maestro testlərini ayrıca günə saxladı.
- **Növbəti dəfə:**
  - **Real telefon (tövsiyə olunur):** USB debugging, adb + Java + Maestro D diskinə, təxminən 0.5 GB.
  - **Emulyator:** təxminən 8–10 GB, D diskinə.
  - Hər iki halda APK-lar `/download/` səhifəsindən götürülür və canlı API ilə işləyir.
- **Docker və API dəsti:** istifadəçiyə başqa kompüterdə işlətmək üçün prompt verildi. Developer bu dəsti `7edfbd8`-də artıq 692/692 işlədib; `00368ff` yalnız sənədləri dəyişib.

---

## 2026-11-09 — T11: J03, M06, P02 əlavə olundu; Hesabat №1 yeniləndi ✅

- **AU-J03 ✅:** payout kartı maskalanır, Luhn-dan keçməyən nömrə rədd olunur. İstifadəçinin icazəsi ilə Elvinə test kartı yazıldı: `4242…4242`, əvvəl kart yox idi.
- **AU-M06 ✅:** panel socket bileti bir dəfəlikdir. Təkrar istifadədə və 65 s sonra `UNAUTHORIZED` qaytarır, sessiyasız 401 verir.
- **AU-P02 ✅:** şirkət paneli səhifələri 0.3–0.4 s-də yüklənir, ölçüsü 24–44 KB.
- **Cəmi:** canlı automation **112/113**, yeganə uğursuz test BUG-002-dir. Plan əhatəsi **96/128 (75%)**.
- PDF yeniləndi: `qa/reports/TezFiks-QA-2026-11-09.pdf`.
- **Qalanlar:**
  - admin testləri ~22 (T12);
  - Maestro 7 (T6);
  - rate-limit testləri 2 (icazə);
  - API inteqrasiya dəsti (Docker).

---

## 2026-11-09 — T3, T9, T11: automation genişləndirildi, Hesabat №1 hazırdır ✅

**Nəticə:**
- Canlı automation: 12 fayl, **109/111** keçdi.
- Plan əhatəsi **93/128 (73%)**.
- Yeni bag tapılmadı.
- PDF: `qa/reports/TezFiks-QA-2026-11-09.pdf` (mənbə `.html`, eyni qovluqda).

| Fayl | Nəticə |
|---|---|
| 04-cancellations | 7/7. AU-F08 token yeniləmə düzəlişindən sonra təkrar keçdi |
| 07-b2b | 8/8 |
| 08-misc: TLS, socket, dillər, səhifələmə, idempotentlik, rədd olunan kart, dəvətlər, gecikmə | 9/9 |
| 09-dispatch: provider seçimi, şirkət qəbulu, finalPriceEntry, nağd, eyni anda qəbul, 2 slot, təcili, EXPIRED | 11/11 |
| 10-company-panel (Playwright + Chrome): giriş, cookie-lər, səhifələr, real vaxt, 404, dillər, 390 px | 8/8 |
| 11-extra: planlı sorğu, avtomatik tamamlanma (10.1 dəq), köhnə işdə çat | 5/6. J03 istifadəçinin qərarı ilə atlandı: test nömrəsi Luhn-dan keçmirdi |
| 12-b2b-expiry | 1/1 |
| Panel `next build` (Q03) | ✅ |

**Görülən işlər:**
- **T3:** customer testlərində ilk `waitFor` üçün 10 s, test limiti 30 s. Assertion-lar dəyişdirilmədi. 2 ardıcıl run-da 383/383. Commit olunmayıb.
- **Harness düzəlişləri:**
  - `lib.mts`: 401 alanda token yenilənir;
  - `flows.mts`: `waitOffer` usta yerini parametr kimi alır, `cancelOpenRequests` ASSIGNED sorğuları da bağlayır;
  - `playwright-core@1.55.0` yalnız `qa/automation` qovluğuna quraşdırıldı, quraşdırılmış Chrome ilə işləyir.
- `qa/admin-pending.md`: admin hesabı gələndə ediləcəklərin siyahısı. Developerə admin hesabı, OTP limiti və icazələr barədə mesaj göndərildi.

**Tapıntılar:**
- `providerPreference` yalnız şirkət müştəriləri üçündür: `requests.service.ts:76` və spesifikasiyaya uyğundur. Bag deyil.
- OTP limitləri kodda sabitdir. Hesabatda tövsiyə kimi verildi.
- Elvinin hesabına testlərdən 3 strike yazılıb. Admin hesabı gələndə sıfırlanacaq.
- AU-F24-ün "məşğul işçi" hissəsi yoxlanmadı, çünki məşğul işçi yox idi.
- Kənar qovluq yarandı: `D:\QA%20manual` (ekran görüntüsü yolunda URL kodlaşdırması səhvi). Fayllar köçürüldü, boş qovluğu silmək hook tərəfindən bloklandı. Əl ilə silinə bilər.

**Bloklananlar:** admin testləri (T12), Maestro (T6), rate-limit testləri (icazə), API inteqrasiya dəsti (Docker).

---

## 2026-11-09 — T11: automation icrası (davam edir) 🔄

**Harness:** `qa/automation/` qovluğunda Node test runner və `@tezfiks/shared` zod kontraktı istifadə olunur. Hər cavab kontrakta qarşı yoxlanır.
- İşə salmaq: `cd qa/automation && node --test --test-concurrency=1 *.test.mts`.
- Token-lər `.tokens.json` faylında saxlanır, çünki OTP limiti var: telefona saatda 5, IP-yə saatda 20 kod.

| Fayl | Mövzu | Nəticə |
|---|---|---|
| 01-smoke-auth | Smoke, giriş, sessiya, başlıqlar, CORS | 18/18 ✅ |
| 02-contract-sweep | 10 rol × 22 GET, kontrakt, telefon sızması | 11/11 ✅ |
| 03-happy-path | Sorğu → qəbul → əlaqənin açılması → qiymət → kart → bəxşiş → reytinq, ledger | 13/13 ✅ |
| 04-cancellations | Pulsuz və gec ləğv, imtina, no-show, strike | işləyir |
| 05-authz | IDOR, rollar, işçi görünüşü | 10/10 ✅ |
| 06-validation | Validasiya, fayl yükləmə, EXIF, imzalı URL | 8/9 — BUG-002 |
| 07-b2b | Layihə, təklif, hesab-faktura | OTP limitinə görə gözləyir |

**Tapıntılar:**
- BUG-002: imzalı URL 1 saat etibarlıdır, spesifikasiyada 10 dəq yazılıb.
- Q-01: London ünvanı ilə sorğu qəbul olunur.
- Q-02: gəldikdən sonra imtina pulsuz pəncərədə də 15 AZN cərimə tutur.
- AU-C04: refresh token üçün 60 saniyəlik "grace" müddəti qəsdən edilib, bag deyil.

**Bloklananlar:**
- Canlı admin parolu repo-da yoxdur. `.env.example` faylındakı nümunə parol canlı serverdə işləmir. Admin testləri (KYC, payout, hesab-fakturanın ödənilməsi, audit, demo botları) parol olmadan işlədilə bilmir.
- Manual siyahı istifadəçi tərəfinə qədər qısaldıldı (v1.1, təxminən 85 yoxlama).

---

## 2026-11-09 — T10: test siyahıları və QA planı (PDF) ✅

- **Mənbə:** spesifikasiya (`docs/superpowers/specs/2026-10-24-tezfiks-design.md`), `docs/demo.md` və tətbiq ekranlarının siyahısı.
- **`qa/manual-checklist.md`:** 15 bölmə, təxminən 185 yoxlama.
  - customer: C-01…C-106;
  - pro: P-01…P-51;
  - admin: A-01…A-20;
  - şirkət paneli: B-01…B-10;
  - ümumi: X-01…X-13.
  Hər bölmənin sonunda istifadəçinin öz yoxlamaları üçün "Əlavə" sətri var.
- **`qa/automation-plan.md`:** 17 bölmə, təxminən 130 test.
  - smoke, kontrakt (zod), autentifikasiya, IDOR, məxfilik;
  - biznes axınları (botlarla), eyni anda əməliyyatlar (concurrency), ledger, B2B, payout;
  - validasiya, admin, təhlükəsizlik başlıqları;
  - Playwright panel testləri, Maestro, yüngül performans, regression.
  Rate-limit testləri 🔒 işarəlidir: demo telefonları bloklaya bilər, yalnız icazə ilə işlədilir.
- **`qa/bugs.md`:** şablon developerin istədiyi formata salındı: ciddilik, prioritet, təkrarlanma, mühit, obyekt ID-ləri, ilkin şərtlər, addımlar, spesifikasiyaya istinadla gözlənilən nəticə, sübut və texniki qeyd. BUG-001 yeni formata keçirildi.
- **Vahid PDF:** `qa/pdf/TezFiks-QA-Test-Plani-2026-11-09.pdf` (A4 albom formatı, 23 səhifə: titul, manual, automation, bag şablonu).
- **Çatdırma qərarı:** hələlik yalnız PDF.

---

## 2026-11-09 — T7: QA iş axını quruldu ✅

- **Rollar:** istifadəçi manual test edir. Claude automation testlərini yazır, bagları formata salır və kodda səbəbini axtarır.
- **Çatdırma:** developerə (`github.com/preklis/tezfiks`) Word/PDF hesabat göndərilir.
- **Yaradılan fayl:** `qa/bugs.md` — bag şablonu və siyahısı. BUG-001 (flaky customer testləri) ora köçürüldü.
- **Hesabatlar `qa/reports/` qovluğunda saxlanacaq:** `TezFiks-QA-<tarix>.docx` və `.pdf`.

---

## 2026-11-09 — İş qaydası təyin olundu ✅

- Hər tapşırıqdan sonra bu fayl yenilənəcək. Yeni sessiya bu faylı oxumaqla başlayacaq, sonra `tasks.md` oxunacaq.
- Qayda `C:\Users\Dell\.claude\CLAUDE.md` faylına yazıldı. Bu fayl hər sessiyada avtomatik yüklənir.

---

## 2026-11-09 — T1: mövcud testlərin hesabatı ✅

**Nəticə:** işə salınan 1268 testin hamısı keçdi. 2 customer testi flaky-dir. API typecheck təmizdir. API dəsti (692 test) Docker olmadığı üçün işə salınmadı.

| Dəst | Testlər | Nəticə |
|---|---|---|
| shared | 34/34 | ✅ |
| i18n | 5/5 | ✅ |
| mobile | 201/201 | ✅ |
| customer | 381/383 (2-si ayrıca run-da keçdi) | ⚠️ flaky |
| pro | 222/222 | ✅ |
| panel | 423/423 | ✅ |
| API `tsc --noEmit` | 0 xəta | ✅ |
| API testləri | 692 | ⛔ Docker yoxdur |

**Görülən işlər:**
- `packages/` və `scripts/` əvvəlcə diskdə yox idi. İstifadəçi onları bərpa etdi.
- `node_modules/@tezfiks/*` içindəki 7 workspace linki boş qovluqlara çevrilmişdi. Onları junction olaraq yenidən yaratdım. Bundan əvvəl təxminən 135 test "Cannot find module '@tezfiks/shared'" xətası ilə sınırdı.

**Tapıntılar:**
1. Flaky: `login-flow.test.tsx` və `restore-session.test.tsx` tam run-da 5 s timeout-a düşür, ayrıca işə salınanda keçir. Bax: T3.
2. Docker yoxdur, ona görə API dəsti bloklanıb. Bax: T2.
3. Commit olunmamış dəyişiklik: `apps/panel/next-env.d.ts` (Next.js avtomatik yaradır).
