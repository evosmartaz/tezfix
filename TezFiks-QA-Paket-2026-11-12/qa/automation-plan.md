# TezFiks: automation test siyahısı

**Kim:** Claude · **Mühit:** canlı demo (`https://evosmart.az/tezfix/api`, `https://tezfiks.evosmart.az`) · **Versiya:** 1.0 (2026-11-09)

**Alətlər:**
- **API:** Playwright `request` + `@tezfiks/shared` zod kontraktı. Hər cavab kontrakta qarşı yoxlanır.
- **Panel:** Playwright brauzer testləri.
- **Mobil:** Maestro.

**Kod:** `qa/automation/` qovluğunda olacaq. Hər test ID-si aşağıdakı siyahıya uyğun gəlir.

**Qaydalar:**
- Canlı serverə yük testi və ya DoS yoxdur. Ən çox bir neçə sorğu/saniyə göndərilir.
- Rate-limit testləri demo telefonları 1 saat bloklaya bilər. Onlar yalnız istifadəçinin icazəsi ilə, ayrıca run-da işlədilir (🔒 işarəsi).
- Admin tənzimləmələrini dəyişən testlər əvvəlki dəyəri sonda geri yazır.
- Yaradılan məlumat (sorğular, botlar) test sonunda təmizlənir. Ledger append-only olduğu üçün tarixçə qalır.
- Testlər ancaq demo hesablarından və botlardan istifadə edir.

**Lazımdır:** admin panelin email və parolu.

---

## A. Smoke və infrastruktur

| ID | Test | Gözlənilən nəticə |
|---|---|---|
| AU-A01 | `GET /tezfix/api/health` | 200; DB və Redis "ok" |
| AU-A02 | Panel səhifələri: `/tezfix`, `/tezfix/admin/login`, `/tezfix/company/login`, 404 | 200 və ya düzgün yönləndirmə; 404 səhifəsi işləyir |
| AU-A03 | `/download/` səhifəsi və APK linkləri | Fayllar mövcuddur, ölçüləri > 0 |
| AU-A04 | TLS sertifikatı (API və panel) | Etibarlı; 14 gündən çox müddəti qalıb |
| AU-A05 | Socket.IO `/tezfix/api/socket.io` | Bağlantı qurulur |
| AU-A06 | `/tezfix/api/docs` (Swagger) | Production-da bağlıdır |

## B. API kontrakt yoxlaması

| ID | Test | Gözlənilən nəticə |
|---|---|---|
| AU-B01 | Hər GET endpoint (me, categories, requests, wallet, notifications, pro/*, company/*, admin/*) | Cavab `packages/shared` zod sxeminə tam uyğundur; nullable sahələr `null` kimi gəlir |
| AU-B02 | Xəta formatı | `{ error: { code, message, details? } }`; kod `errors.ts` siyahısındandır |
| AU-B03 | `Accept-Language: az/ru/en` | Xəta mesajları və kateqoriya adları uyğun dildədir |
| AU-B04 | Pagination | `{ items, nextCursor }` formatı; dublikat və buraxılmış element yoxdur |

## C. Autentifikasiya və sessiya

| ID | Test | Gözlənilən nəticə |
|---|---|---|
| AU-C01 | Hər demo telefon üçün OTP request + verify (`123456`) | Access və refresh token alınır |
| AU-C02 | Yanlış OTP kodu | Xəta; token verilmir |
| AU-C03 | Telefon formatı səhvdir | Validasiya xətası |
| AU-C04 | Refresh token rotasiyası | Yeni cüt token verilir; köhnə refresh token ikinci dəfə istifadə olunanda **bütün sessiya ləğv olunur** |
| AU-C05 | Logout | Refresh token artıq işləmir |
| AU-C06 | Token olmadan qorunan endpoint | 401 |
| AU-C07 | Saxta və ya korlanmış JWT | 401 |
| AU-C08 | Admin login: yanlış və düzgün parol | 401, sonra 200 |
| AU-C09 🔒 | OTP limiti: 5 yanlış cəhd, 60 s yenidən göndərmə gözləməsi, saatda 5 kod | Limit xətaları |
| AU-C10 🔒 | Admin login brute-force limiti | Rate limit işləyir |

## D. Avtorizasiya (IDOR və rollar)

| ID | Test | Gözlənilən nəticə |
|---|---|---|
| AU-D01 | Müştəri A müştəri B-nin sorğusunu, tapşırığını (assignment), çatını və ödənişini oxuyur | 403 və ya 404 |
| AU-D02 | Müştəri token-i ilə `/pro/*` və `/admin/*` | 403 |
| AU-D03 | İstifadəçi token-i ilə `/admin/*` | 401 və ya 403 |
| AU-D04 | Şirkət işçisi (Tural) `/company/:id/*` idarəedici endpoint-lərinə | 403 |
| AU-D05 | FixPro idarəedicisi başqa `companyId` ilə | 403 |
| AU-D06 | Usta başqa ustanın tapşırığına əməliyyat edir (en-route, price) | 403 və ya 404 |
| AU-D07 | KYC faylları: sahibi, başqa istifadəçi, şirkət idarəedicisi | Yalnız admin oxuya bilir; baxış jurnala yazılır |
| AU-D08 | Fayl üçün imzalı URL | 10 dəqiqədən sonra etibarsız olur; imza dəyişdiriləndə 403 |
| AU-D09 | Bloklanmış istifadəçi (Vüqar) | Əməliyyatlar rədd olunur |
| AU-D10 | Gözləmədə olan usta (Samir) onlayn olur və ya təklif qəbul edir | Rədd olunur |

## E. Məxfilik (spesifikasiya §4.4)

| ID | Test | Gözlənilən nəticə |
|---|---|---|
| AU-E01 | Təklif payload-u (REST və socket `offer:new`) | Telefon və şəkil yoxdur; ad + soyadın baş hərfi; mənzil detalları yoxdur |
| AU-E02 | Tapşırıq görünüşü əlaqə açılmamışdan əvvəl (müştəri və usta) | Telefon sahəsi **ümumiyyətlə yoxdur** |
| AU-E03 | ETA ≤ 300 s və ya "arrived" statusu | `contactUnlockedAt` təyin olunur; telefon görünür; `assignment:contact` hadisəsi gəlir |
| AU-E04 | Əlaqə açıldıqdan sonra ETA artır | Əlaqə yenidən bağlanmır |
| AU-E05 | Əlaqə açılmamışdan əvvəl çat (GET və POST) | Rədd olunur |
| AU-E06 | Tapşırıq bitdikdən 2 saat sonra çat | Rədd olunur |
| AU-E07 | İşçi görünüşü (Kamran) | Təsvir, müştəri reytinqi, qiymət və şirkət pulu yoxdur |
| AU-E08 | Siyahılar, bildirişlər, admin olmayan cavablar | Heç bir telefon nömrəsi yoxdur (regex ilə hər cavab yoxlanır) |

## F. Biznes axınları (botlarla, end-to-end API)

| ID | Test | Gözlənilən nəticə |
|---|---|---|
| AU-F01 | Əsas axın: İndi → bot qəbul edir → yola çıxır → gəlir → 45 AZN → kart 4242 → bəxşiş → reytinq | Bütün statuslar ardıcıl dəyişir; usta qazancı = 45 + bəxşiş; zəmanət = tamamlanma + 14 gün |
| AU-F02 | Haqq: qəbul anında bloklanır, 5 dəq sonra tutulur | Bloklanmış balans +1000 → tutulandan sonra mövcud balans −1000 |
| AU-F03 | 5 dəqiqədən tez tamamlanma | Haqq dərhal tutulur |
| AU-F04 | Müştəri pulsuz pəncərədə ləğv edir | Haqq və təcili haqq azad olunur; cərimə yoxdur |
| AU-F05 | Usta pulsuz pəncərədə ləğv edir | Haqq azad olunur; slot yenidən göndərilir |
| AU-F06 | Müştəri gec ləğv edir | Müştəri −15, usta +10 (geri qaytarma + kompensasiya), platforma +5 |
| AU-F07 | Gəldikdən sonra imtina | F06 ilə eyni pul hərəkəti |
| AU-F08 | Usta gec ləğv edir | Haqq tutulub qalır; strike +1; slot yenidən göndərilir; müştəridən əlavə ödəniş alınmır |
| AU-F09 | No-show (5 dəqiqədən əvvəl → rədd; sonra → qəbul) | Strike; yenidən göndərmə; slot doldurulmasa təcili haqq geri qaytarılır |
| AU-F10 | Təcili: 2 slot → 2 × 500 bloklanır; doldurulmayan slot azad olunur | Düzgün məbləğlər |
| AU-F11 | Təcili, balans < 500 | `INSUFFICIENT_BALANCE` |
| AU-F12 | Borclu müştəri sorğu yaradır | `CUSTOMER_IN_DEBT` |
| AU-F13 | Usta balansı < 10 AZN olanda qəbul | 402 `INSUFFICIENT_BALANCE` |
| AU-F14 | Çox slotlu sorğu: hamısı dolanda | Sorğu `ASSIGNED`; qalan təkliflər `CLOSED` |
| AU-F15 | Provider preference COMPANY / INDIVIDUAL | Təkliflər yalnız uyğun tipə gedir |
| AU-F16 | Usta tapılmır (botsuz), 90 s | Sorğu `EXPIRED`; təcili haqq geri qaytarılır |
| AU-F17 | Planlı sorğu: minimum vaxt fərqi (demo 2 dəq), uzunmüddətli təkliflər, canlı dispatch, `UNFILLED` | Düzgün statuslar və bildirişlər |
| AU-F18 | Qiymət mübahisəsi → admin qiyməti düzəldir / tamamlayır / ləğv edir | Statuslar və pul hərəkəti düzgün |
| AU-F19 | Avtomatik tamamlanma: qiymət yazılıb, 10 dəq heç nə edilmir | Nağd kimi `COMPLETED` |
| AU-F20 | Nağd ödəniş | Zəmanət yoxdur; bəxşiş rədd olunur; zəmanət müraciəti rədd olunur |
| AU-F21 | Zəmanət müraciəti → admin yenidən göndərir | Yeni sorğu: `isGuaranteeFix`; 10 dəq əvvəlcə orijinal ustaya gedir; haqq 0, qiymət 0 |
| AU-F22 | Reytinq: 1–5 aralığı; eyni istiqamətdə ikinci reytinq | 0 və 6 rədd olunur; ikinci reytinq rədd olunur |
| AU-F23 | Statusa uyğun olmayan əməliyyatlar (məs. gəlməmişdən qiymət yazmaq, `COMPLETED`-də ləğv) | Hamısı rədd olunur |
| AU-F24 | Şirkət qəbulu: 2 işçi | 2 haqq bloku; məşğul işçi seçilə bilmir |
| AU-F25 | `finalPriceEntry` = MANAGER / WORKER | Qiyməti yalnız icazəli tərəf yaza bilir |
| AU-F26 | Dəvət linki: önizləmə, qəbul, müddəti bitmiş, ləğv edilmiş, `maxUses` keçilib | Düzgün cavablar |

## G. Eyni anda əməliyyatlar və idempotentlik

| ID | Test | Gözlənilən nəticə |
|---|---|---|
| AU-G01 | 1 slota 2 usta eyni anda qəbul edir | Biri qalib gəlir, digəri `OFFER_UNAVAILABLE` alır; yalnız 1 haqq bloku |
| AU-G02 | Eyni `Idempotency-Key` ilə 2 top-up | 1 əməliyyat |
| AU-G03 | Eyni açarla 2 qəbul | 1 tapşırıq |
| AU-G04 | `confirm-price` 2 dəfə | 1 ödəniş |
| AU-G05 | Admin balans düzəlişi 2 dəfə (eyni açar) | 1 əməliyyat |

## H. Pul kisəsi, ödəniş, ledger

| ID | Test | Gözlənilən nəticə |
|---|---|---|
| AU-H01 | Top-up, kart 4242 | `SUCCEEDED`; balans artır; ledger-də TOPUP |
| AU-H02 | Kart 4000…0002 | `FAILED`; ledger-də yazı yoxdur |
| AU-H03 | Checkout imzası (`?t=`) dəyişdirilib | Rədd olunur |
| AU-H04 | Hər axından sonra admin ledger | Hər əməliyyatın yazılarının cəmi 0; mövcud balans = posted − held |
| AU-H05 | Mənfi və ya sıfır məbləğ, kəsr qəpik | Validasiya xətası |
| AU-H06 | Admin düzəlişi | Səbəb məcburidir; audit jurnalına yazılır |

## I. B2B layihələr

| ID | Test | Gözlənilən nəticə |
|---|---|---|
| AU-I01 | Layihə yaratmaq (Kontur), QUOTE kateqoriyasına yönləndirmə | `OPEN` |
| AU-I02 | Təklif: 1000 × işçi × gün bloklanır | Düzgün məbləğ |
| AU-I03 | Eyni layihəyə ikinci təklif | Rədd olunur |
| AU-I04 | Təklifi geri çəkmək | Blok azad olunur |
| AU-I05 | Qalibi seçmək | Qalibin haqqı tutulur, digərlərininki azad olunur; şərtlər qeydə alınır |
| AU-I06 | Gündəlik hesabatlar (0–100%) | Saxlanır; aralıqdan kənar dəyər rədd olunur |
| AU-I07 | Tamamlanma → hesab-faktura | Nömrə `TF-YYYY-NNNNNN`; ƏDV 18% (ödəyici deyilsə 0) |
| AU-I08 | Admin hesab-fakturanı ödənildi kimi qeyd edir | Pul qazanca keçir; layihə `PAID` |
| AU-I09 | Təklif müddəti bitir, təklif yoxdur | Layihə `EXPIRED` |

## J. Payout-lar

| ID | Test | Gözlənilən nəticə |
|---|---|---|
| AU-J01 | Admin "indi işə sal" | Qazancı müsbət olan hər hesab üçün `PENDING` payout |
| AU-J02 | `PAID` / `FAILED` | `FAILED` olanda pul qazanca qayıdır |
| AU-J03 | Payout kartı PUT / GET | Nömrə maskalanmış qayıdır |

## K. Validasiya (mənfi testlər)

| ID | Test | Gözlənilən nəticə |
|---|---|---|
| AU-K01 | Sorğu: boş və çox uzun təsvir, 6 şəkil, 11 slot, keçmiş tarix, Azərbaycandan kənar koordinatlar | 400 və aydın xəta kodu |
| AU-K02 | Çat mesajı > 1000 simvol, boş mesaj | 400 |
| AU-K03 | Fayl > 8 MB, şəkil olmayan fayl (PDF, `.exe` uzantılı fayl) | Rədd olunur |
| AU-K04 | Yüklənmiş şəkil | EXIF təmizlənib (GPS yoxdur) |
| AU-K05 | Profil: VÖEN formatı, ad uzunluğu, XSS sətiri (`<script>`) | Validasiya xətası və ya escape olunmuş saxlanma; panel onu icra etmir |
| AU-K06 | SQL injection sətirləri axtarışda (admin search) | Xəta yoxdur, məlumat sızmır |

## L. Admin əməliyyatları

| ID | Test | Gözlənilən nəticə |
|---|---|---|
| AU-L01 | KYC rədd etmək (səbəblə) → yenidən göndərmək; 24 saatda 3-dən çox göndərmə | 4-cü göndərmə rədd olunur |
| AU-L02 | Blokla / blokdan çıxar / strike-ları sıfırla | Düzgün; audit jurnalına yazılır |
| AU-L03 | Hər admin əməliyyatı | Audit jurnalında: aktor, öncə və sonra |
| AU-L04 | Tənzimləmə dəyişdikdə (geri qaytarılır) | Dəyər dərhal tətbiq olunur |
| AU-L05 | Demo: botlar yarat / sil | Silinən botun bitməmiş işləri ləğv olunur, slot yenidən göndərilir |

## M. Təhlükəsizlik konfiqurasiyası

| ID | Test | Gözlənilən nəticə |
|---|---|---|
| AU-M01 | HTTP başlıqları (helmet): HSTS, X-Content-Type-Options, frame options | Mövcuddur |
| AU-M02 | CORS: başqa origin | Rədd olunur; yalnız panel origin-ə icazə var |
| AU-M03 | Panel cookie-ləri | `httpOnly`, `Secure`, path `/tezfix` |
| AU-M04 | Xəta cavabları | Stack trace və ya daxili yol yoxdur |
| AU-M05 | KYC fayllarının başlığı | `Cache-Control: private, no-store` |
| AU-M06 | Panel socket bileti | 60 s sonra etibarsız olur |

## N. Panel E2E (Playwright)

| ID | Test | Gözlənilən nəticə |
|---|---|---|
| AU-N01 | Admin login / logout; girişsiz URL | Yönləndirmə |
| AU-N02 | Admin menyusunun bütün səhifələri | Yüklənir; konsolda xəta yoxdur; 500 yoxdur |
| AU-N03 | Sifarişlər: axtarış "Memmedov" → Məmmədov tapılır; filtrlər, səhifələmə | Düzgün nəticə |
| AU-N04 | Usta detalı: KYC baxışı, təsdiq / rədd formaları, balans düzəlişi forması (validasiya) | İşləyir |
| AU-N05 | Müraciətlər: qeyd əlavə et, həll et | İşləyir |
| AU-N06 | Demo səhifəsi: bot yarat → sorğu → xəritədə görünür | İşləyir |
| AU-N07 | Şirkət paneli: OTP girişi, Dispatch-də təklifi işçi seçərək qəbul etmək (sorğu Demo-dan yaradılır) | Tapşırıq yaranır |
| AU-N08 | Şirkət paneli: dəvət yarat / ləğv et; balans; tənzimləmələr | İşləyir |
| AU-N09 | Başqa `companyId` URL-i | Qadağandır |
| AU-N10 | Dil keçidi az / ru / en, bütün səhifələr | Tərcümə açarı görünmür |
| AU-N11 | Mobil en (390 px) | Üfüqi sürüşmə yoxdur; menyu işləyir |
| AU-N12 | `/tezfix/join/<token>`: etibarlı və etibarsız token | Düzgün səhifə |

## O. Mobil E2E (Maestro, emulyator)

| ID | Test | Gözlənilən nəticə |
|---|---|---|
| AU-O01 | Mövcud 4 ssenari (`e2e/maestro`), 5 ekran ölçüsündə | Keçir |
| AU-O02 | Customer: sorğu → bot → izləmə → kart → bəxşiş → reytinq | Keçir |
| AU-O03 | Customer: pulsuz ləğv; gec ləğv (15 AZN xəbərdarlığı) | Keçir |
| AU-O04 | Pro (Elvin): onlayn → təklif → qəbul → yola çıxdım → gəldim → qiymət | Keçir |
| AU-O05 | Pro (Rauf): idarəedici qəbulu, işçi seçimi | Keçir |
| AU-O06 | Pro (Kamran): işçinin məhdud görünüşü | Təsvir və qiymət yoxdur |
| AU-O07 | Dil keçidi; Samirin gözləmə ekranı; Vüqarın bloklanma ekranı | Keçir |

## P. Performans (yüngül, canlı serverə uyğun)

| ID | Test | Gözlənilən nəticə |
|---|---|---|
| AU-P01 | Əsas GET endpoint-ləri, hər birinə 20 sorğu ardıcıl | p95 < 800 ms; 5xx yoxdur |
| AU-P02 | Panel səhifələrinin yüklənməsi (Lighthouse kimi ölçü) | Böyük problem yoxdur |

## Q. Regression (mövcud dəstlər)

| ID | Test | Gözlənilən nəticə |
|---|---|---|
| AU-Q01 | shared, i18n, mobile, customer, pro, panel, API typecheck | Hamısı keçir (09.11 run-ı: 1268/1268, BUG-001 flaky) |
| AU-Q02 | API inteqrasiya dəsti (692) | Docker qurulandan sonra |
| AU-Q03 | `next build` (panel) | Uğurlu |
