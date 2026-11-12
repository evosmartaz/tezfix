# TezFiks: manual test siyahısı (istifadəçi tərəfi)

**Kim:** manual QA (siz) · **Mühit:** canlı demo (`tezfiks.evosmart.az`, APK-lar `/download/` səhifəsində) · **Versiya:** 1.1 (2026-11-09)

**Burada yalnız gözlə görünən hissələr var:** ekranlar, mətnlər, düymələr, axının rahatlığı, cihaz davranışı.
Bunları Claude automation ilə yoxlayır, burada **yoxdur**:
- pul hesablamaları və balanslar;
- OTP və giriş limitləri;
- icazələr: başqasının məlumatına giriş;
- telefonun gizlədilməsi;
- validasiya;
- təkrar basma və idempotentlik;
- API xətaları.

**Nəticə sütunu:** ✅ keçdi · ❌ bag (bag nömrəsini qeyd edin) · ⏭ yoxlanmadı (səbəbini yazın)
Bag tapanda ekran görüntüsü çəkin və mənə deyin, `qa/bugs.md`-ə developer formatında mən yazacam. Öz yoxlamalarınızı hər bölmənin sonundakı **"Əlavə"** sətrinə yazın.

---

## 0. Hazırlıq

| Məlumat | Dəyər |
|---|---|
| Customer APK versiyası | |
| Pro APK versiyası | |
| Cihaz 1 (model, Android versiyası) | |
| Cihaz 2 — mümkünsə kiçik ekranlı | |

**Demo hesablar (OTP kodu: `123456`):**

| Telefon | Tətbiq | Kim |
|---|---|---|
| +994 55 200 00 24 | customer | Demo Müştəri: əsas test hesabı |
| +994 55 200 00 21 | customer | Nizami: davam edən işi var |
| +994 55 200 00 22 | customer | Aysel: zəmanət müraciəti var |
| +994 55 200 00 23 | customer | Leyla (Kontur MMC): biznes müştəri |
| +994 50 200 00 01 | pro | Elvin: solo usta |
| +994 50 200 00 02 | pro | Samir: yoxlamada |
| +994 50 200 00 03 | pro | Vüqar: bloklanıb |
| +994 50 200 00 11 | pro + şirkət paneli | Rauf: FixPro idarəedicisi |
| +994 50 200 00 13 | pro | Kamran: FixPro işçisi |

**İki telefonla rahat test:** birində customer (Demo Müştəri), digərində pro (Elvin). Sorğunu müştəri kimi yaradın və usta kimi qəbul edin.

> ⚠️ Automation da eyni hesablardan istifadə edir. Elvin və Demo Müştəri ilə test etməyə başlamazdan əvvəl mənə xəbər verin ki, eyni anda işləməyək. Demo hesablarında "Hesabı sil" düyməsinə **basmayın**.

---

## 1. Customer: ilk açılış və giriş

| ID | Yoxlama | Gözlənilən nəticə | Nəticə | Qeyd |
|---|---|---|---|---|
| C-01 | Tətbiqin ilk açılışı (splash, loqo, ikon) | Loqo və rənglər düzgündür, ağ ekranda qalmır | | |
| C-02 | Telefon ekranı: +994 prefiksi, rəqəm klaviaturası | Nömrə rahat yazılır, format görünür | | |
| C-03 | OTP ekranı: 6 xana, geri sayma | Kod rahat yazılır; SMS/WhatsApp kodunu avtomatik doldurma varsa işləyir | | |
| C-04 | Yanlış kod yazanda | Xəta mesajı aydındır və öz dilindədir | | |
| C-05 | Profil: ad, soyad, şəkil (kamera və qalereya) | Şəkil düzgün kəsilir, düz görünür (yan dönmür) | | |
| C-06 | Hesab növü: Fərdi / Şirkət | Seçim aydındır; şirkət formasının sahələri başa düşüləndir | | |
| C-07 | Tətbiqi bağlayıb yenidən açmaq | Yenidən giriş istəmir | | |
| C-08 | Əlavə: | | | |

## 2. Customer: ana səhifə və sorğu yaratmaq

| ID | Yoxlama | Gözlənilən nəticə | Nəticə | Qeyd |
|---|---|---|---|---|
| C-10 | Ana səhifə: salamlama, yer, axtarış, Ev/Avto, kateqoriyalar | Dizayn lövhəsinə (`design/02`) uyğundur, ikonlar yerindədir | | |
| C-11 | Yer icazəsi: icazə ver / rədd et | Hər iki halda tətbiq işləyir; rədd edəndə ünvanı əl ilə seçmək olur | | |
| C-12 | Kateqoriya axtarışı ("santexnik", "isiq", "kondisioner") | Nəticələr məntiqlidir | | |
| C-13 | "Şəkil ilə tap": kran şəkli, sonra əlaqəsiz şəkil | Birincidə düzgün kateqoriya çıxır, ikincidə əl ilə seçim təklif olunur | | |
| C-14 | Xəritədə pin: sürüşdür, təsdiqlə | Pin rahat hərəkət edir; ünvan düzgün dolur | | |
| C-15 | Ünvan sahələri: giriş, mərtəbə, mənzil, domofon, qeyd | Klaviatura sahələri örtmür | | |
| C-16 | Şəkil əlavə etmək (5 ədəd) və silmək | Önizləmələr düzgündür; silmək rahatdır | | |
| C-17 | İndi / Planla / Təcili seçimi | Fərq aydındır; təcilidə "+5 AZN" xəbərdarlığı görünür | | |
| C-18 | Planla: tarix və saat seçimi | Seçici rahatdır; Bakı vaxtı göstərilir | | |
| C-19 | Usta sayı seçimi | Rahatdır; məbləğ xəbərdarlıqları aydındır | | |
| C-20 | "Göndər" → axtarış ekranı | Halqa animasiyası səlisdir; "Ləğv et" düyməsi görünür | | |
| C-21 | Usta tapılmayanda | Mesaj aydındır və növbəti addım təklif olunur | | |
| C-22 | Əlavə: | | | |

## 3. Customer: izləmə, əlaqə, iş prosesi

| ID | Yoxlama | Gözlənilən nəticə | Nəticə | Qeyd |
|---|---|---|---|---|
| C-30 | Usta qəbul edəndə | Bildiriş gəlir; usta kartı (ad, şəkil, reytinq, peşə) gözəl görünür | | |
| C-31 | İzləmə xəritəsi: marker, marşrut, "N dəq məsafədə" | Marker səlis hərəkət edir; dəqiqə yenilənir | | |
| C-32 | Zəng və mesaj düymələri kilidli olanda | Niyə kilidli olduğu başa düşülür ("5 dəq qalanda açılacaq") | | |
| C-33 | Kilid açılanda | Bildiriş və ya görünən dəyişiklik var; zəng düyməsi telefonu açır | | |
| C-34 | Çat: mesaj yazmaq, gəlmək, uzun mətn, emoji | Mesajlar dərhal görünür; sıralama düzgündür; klaviatura mesajı örtmür | | |
| C-35 | Ləğv düyməsi: 5 dəqiqədən əvvəl və sonra | Xəbərdarlıq mətni aydındır ("pulsuz" / "15 AZN tutulacaq") | | |
| C-36 | Usta gəldi → "İmtina et" | 15 AZN xəbərdarlığı aydındır | | |
| C-37 | Tətbiqi izləmə vaxtı bağlayıb açmaq | Eyni ekrana qayıdır | | |
| C-38 | Əlavə: | | | |

## 4. Customer: ödəniş, bəxşiş, reytinq, zəmanət

| ID | Yoxlama | Gözlənilən nəticə | Nəticə | Qeyd |
|---|---|---|---|---|
| C-40 | Qiymət ekranı: iş haqqı, material, cəm | Oxunaqlıdır; "Razılaşdırılmış qiymət" aydındır | | |
| C-41 | Nağd / Kart seçimi və zəmanət izahı | Kartla ödənişdə zəmanət olduğu aydın yazılıb | | |
| C-42 | Test ödəniş səhifəsi (kart 4242 4242 4242 4242) | Səhifə mobil ekrana uyğundur; ödənişdən sonra tətbiqə qayıdır | | |
| C-43 | Rədd olunan kart (4000 0000 0000 0002) | Xəta aydındır; yenidən cəhd etmək rahatdır | | |
| C-44 | Bəxşiş səhifəsi | Məbləğ seçimi rahatdır; "Keç" düyməsi var | | |
| C-45 | Reytinq: ulduzlar və şərh | Rahatdır; göndərəndən sonra təşəkkür mesajı | | |
| C-46 | Zəmanət müraciəti: mətn və şəkil | Forma aydındır; göndərdikdən sonra status görünür | | |
| C-47 | Qiyməti mübahisələndirmək | Forma aydındır; nəticə görünür | | |
| C-48 | Əlavə: | | | |

## 5. Customer: digər ekranlar

| ID | Yoxlama | Gözlənilən nəticə | Nəticə | Qeyd |
|---|---|---|---|---|
| C-50 | Sifarişlər: aktiv və tarixçə | Kartlar oxunaqlıdır; statuslar başa düşülür | | |
| C-51 | Pul kisəsi: balans, tarixçə, "Balansı artır" | Mətnlər aydındır; borc olanda qırmızı banner | | |
| C-52 | Ünvanlar: əlavə et, redaktə et, sil | Rahatdır | | |
| C-53 | Bildirişlər | Kliklə uyğun ekran açılır | | |
| C-54 | Profil: dil az / ru / en | Bütün ekranlar dəyişir; kəsilmiş və ya tərcüməsiz mətn yoxdur | | |
| C-55 | Leyla: biznes sifarişi, təkliflərin müqayisəsi, hesab-faktura | Cədvəllər oxunaqlıdır; ƏDV sətri görünür | | |
| C-56 | Əlavə: | | | |

---

## 6. Pro tətbiqi: usta (Elvin)

| ID | Yoxlama | Gözlənilən nəticə | Nəticə | Qeyd |
|---|---|---|---|---|
| P-01 | Giriş → ana səhifə: xəritə, ad, ONLAYN düyməsi, "Bu gün" | Dizayn lövhəsinə (`design/03`) uyğundur | | |
| P-02 | ONLAYN düyməsi | Yer icazəsi istənir; bildiriş panelində "onlayn" bildirişi görünür | | |
| P-03 | Təklif pəncərəsi: səs, vibrasiya, geri sayma | Ekran kilidli olanda da diqqət çəkir; geri sayma səlisdir | | |
| P-04 | Təklif məlumatları: xidmət, ünvan sahəsi, məsafə, müştəri | Oxunaqlıdır; "TƏCİLİ" nişanı seçilir | | |
| P-05 | Qəbul et → iş ekranı: zaman xətti, müştəri kartı, ünvan | Mənzil, domofon və qeyd görünür | | |
| P-06 | "Naviqasiyanı aç" → Google Maps / Waze / Paylaş | Düzgün yer açılır | | |
| P-07 | Yola çıxdım → Gəldim → İşi tamamla | Düymələr məntiqli ardıcıllıqla görünür | | |
| P-08 | Qiymət klaviaturası: iş haqqı + material | Rahatdır; cəm dərhal yenilənir | | |
| P-09 | Balans ekranı: aşağı balans xəbərdarlığı, "+ Balansı artır", tarixçə | Mətnlər aydındır | | |
| P-10 | Qazanc və ödəniş kartı | Kart nömrəsi maskalanıb | | |
| P-11 | Planlı sifarişlər, Layihələr (təklif formu) | Rahatdır | | |
| P-12 | Cihaz quraşdırması: bildiriş, batareya tövsiyələri, test təklifi | Test təklifi həqiqətən gəlir | | |
| P-13 | Tətbiq fonda / ekran kilidli olanda yeni təklif | Push bildiriş gəlir (konfiqurasiya olunubsa) | | |
| P-14 | Əlavə: | | | |

## 7. Pro tətbiqi: digər rollar

| ID | Yoxlama | Gözlənilən nəticə | Nəticə | Qeyd |
|---|---|---|---|---|
| P-20 | Samir: gözləmə ekranı | Mətn aydındır ("adətən 24 saat ərzində") | | |
| P-21 | Vüqar: bloklanıb ekranı | Nə etmək lazım olduğu aydındır (dəstək) | | |
| P-22 | Rauf: idarəedici rejimi, şirkət balansı | Dizayn lövhəsinə (`design/04`) uyğundur | | |
| P-23 | Rauf: gələn sifariş, "Ustanı seçin" (Boşdur / Sifarişdədir) | Seçim rahatdır; 10 AZN xəbərdarlığı görünür | | |
| P-24 | Rauf: üzvlər, dəvət linkini paylaşmaq | Paylaşma menyusu açılır; link işləyir | | |
| P-25 | Kamran: işçi görünüşü | Ünvan, xəritə düymələri, "Yola çıxdım" var; təsvir və qiymət yoxdur | | |
| P-26 | Yeni qeydiyyat: Fərdi usta / Şirkət / Dəvət, KYC kamerası (selfi addımları) | Təlimatlar aydındır, kamera düzgün işləyir (WhatsApp OTP lazımdır) | | |
| P-27 | Əlavə: | | | |

---

## 8. Web panellər (brauzer: kompüter və telefon)

| ID | Yoxlama | Gözlənilən nəticə | Nəticə | Qeyd |
|---|---|---|---|---|
| W-01 | Admin: login səhifəsi, menyu, dashboard | Dizayn lövhəsinə (`design/05`) uyğundur; rəqəmlər oxunaqlıdır | | |
| W-02 | Admin: Sifarişlər → detal (zaman xətti, xəritə) | Məlumat aydın düzülüb | | |
| W-03 | Admin: Ustalar → KYC baxışı (sənədlər yan-yana) | Şəkillər böyüdülə bilir; təsdiq və rədd düymələri aydındır | | |
| W-04 | Admin: Xəritə (canlı ustalar, altıbucaqlar) | Səlis işləyir | | |
| W-05 | Admin: Demo səhifəsi | Botları yaratmaq və silmək rahatdır | | |
| W-06 | Şirkət paneli: Dispatch (geri sayma, işçi seçimi, canlı xəritə) | Real vaxtda yenilənir | | |
| W-07 | Şirkət paneli: Balans, Ustalar, Layihələr, Tənzimləmələr | Səhifələr oxunaqlıdır | | |
| W-08 | Panellər telefon brauzerində | Menyu açılır; cədvəllər sürüşür; səhifə ekrandan kənara çıxmır | | |
| W-09 | Dəvət linki səhifəsi (`/tezfix/join/...`) | "Tətbiqi aç / yüklə" düymələri işləyir | | |
| W-10 | Əlavə: | | | |

---

## 9. Ümumi görünüş və cihaz davranışı

| ID | Yoxlama | Gözlənilən nəticə | Nəticə | Qeyd |
|---|---|---|---|---|
| X-01 | Rənglər, Inter şrifti, düymələr, kartlar | `design/01` lövhəsinə uyğundur | | |
| X-02 | Üç dildə mətnlər | Kəsilmə, üst-üstə düşmə, yarımçıq tərcümə yoxdur | | |
| X-03 | Kiçik ekran və böyük şrift (Android parametrləri) | Heç nə kəsilmir, düymələr görünür | | |
| X-04 | Klaviatura açıq olanda bütün formalar | Sahələr və düymələr görünür | | |
| X-05 | Android "geri" düyməsi hər ekranda | Məntiqli davranır; ödəniş zamanı problem yaratmır | | |
| X-06 | Təyyarə rejimi və zəif internet | Oflayn ekranı görünür; internet qayıdanda tətbiq bərpa olunur | | |
| X-07 | Boş ekranlar (sifariş yox, bildiriş yox) | Aydın mətn və ikon var | | |
| X-08 | Yüklənmə göstəriciləri | Uzun gözləmələrdə göstərici var; ekran donmur | | |
| X-09 | Telefon nömrəsi təkliflərdə, siyahılarda və bildirişlərdə | Heç yerdə görünmür (gözlə yoxlayın) | | |
| X-10 | Tətbiq uzun müddət fonda qaldıqdan sonra | Düzgün vəziyyətdə açılır | | |
| X-11 | Ekranı çevirmək (portret ↔ albom) | Dizayn pozulmur və ya portretdə kilidlənir | | |
| X-12 | Əlavə: | | | |
