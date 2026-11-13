# Phase 2 — düzəliş hesabatı (BUG-004, 002, 005, 006, 001) və QA tələblərinə cavab

**Tarix:** 13.11.2026. Bu sənəd 12.11.2026 tarixli versiyanı əvəz edir (o versiyada heç bir test işə salınmamışdı; köhnə mətn git tarixçəsində qalır, commit `848d402`).

**Vəziyyət:** düzəlişlər `main` branch-ında commit edilib, **push və deploy edilməyib**. Phase 1-in kodu (BUG-003 üçün release imzası, QA admin skripti) repodadır; onların qalan addımları §11-dədir.

## 1. Qısa nəticə

| Bag | Status | Nə ilə yoxlanıb | QA-dan gözlənilən |
|---|---|---|---|
| BUG-004 | **FIXED AND VERIFIED** (lokal avtomatik testlər) | 24 yeni + 3 əvvəlki test, real Postgres + Redis; tam API dəsti | Deploy-dan sonra `node retest-bugs.mts 004` və `node tools/diag-late-online.mts 30` |
| BUG-002 | **FIXED AND VERIFIED** (kod və testlər) | 4 test, o cümlədən vaxtın keçməsi və dəyişdirilmiş imza | Deploy-dan sonra `node retest-bugs.mts 002`; serverdəki `.env` (bax §4) |
| BUG-005 | **FIXED AND VERIFIED** (ekran səviyyəli testlər) | 5 ekran testi + 2 hook testi | Yeni APK ilə Maestro `o07` |
| BUG-006 | **FIXED — AWAITING QA VALIDATION** | 1 komponent testi + şrift ölçüləri ilə hesablama (real ekranda baxılmayıb) | Yeni APK ilə Maestro `o05b` |
| BUG-001 | **FIXED AND VERIFIED** | iki test 5 dəfə ayrıca, tam customer dəsti 2 dəfə | — |
| BUG-003 | Kod hazırdır, APK yığılmayıb | — | Bax §11 (release açarı və Google Cloud addımı developerdədir) |

## 2. Nə dəyişdi (QA tələbi 2.3)

| Tarix | Commit | Bag | Dəyişiklik |
|---|---|---|---|
| 13.11.2026 | `3ec955e` | BUG-004 | Dispatch: son addımda düzgün istisna + plan bitəndən sonra təkrar yoxlama |
| 13.11.2026 | `3e7c634` | BUG-002 | İmzalı link müddəti üçün testlər |
| 13.11.2026 | `c6c2a6b` | BUG-005 | Dəvət sorğusu da dil dəyişəndə yenilənir; testlər |
| 13.11.2026 | `a4534d5` | BUG-006 | Düymə düzülüşü üçün test |
| 12.11.2026 | `848d402` | BUG-002, 005, 006, 001 | TTL 600 s; `useLocaleRefetch`; alt-alta düymələr; BUG-001 patch-i |

Server: yuxarıdakı commit-lər deploy olunmalıdır (API). Mobil: pro tətbiqinin JS kodu dəyişib, yeni APK lazımdır (versiya 0.1.1, `versionCode` 2; hələ yığılmayıb).

## 3. Test mühiti və nəticələr

Lokal maşın: Windows 11, Node 26.7, Docker (`tezfiks-dev` Postgres 17 + Redis 8). Canlı demoya və real telefona çıxış olmayıb, ona görə `retest-bugs.mts` və Maestro ssenariləri işə salınmayıb.

Əvvəlki hesabatdakı iki maneə aradan qaldırıldı:
- "Docker / Redis yoxdur": Docker var idi, `node_modules` quraşdırılmamışdı.
- "`Cannot find native module 'ExpoCrypto'`": kod xətası deyil. npm workspace keçidlərini (`node_modules/@tezfiks/*`) kiçik disk hərfi ilə (`e:\…`) yaratmışdı, jest isə `E:\…` altında işləyir və mock-ları yolun dəqiq mətninə görə tanıyır. Keçidlər düzgün disk hərfi ilə yenidən yaradıldı (yalnız `node_modules`).

| Dəst | Nəticə |
|---|---|
| API (vitest, real Postgres + Redis) | **729 / 729**, 77 fayl (son commit-in kodu ilə) |
| customer (jest) | **384 / 384**, 36 fayl, ardıcıl 2 tam run |
| pro (jest) | **231 / 231**, 27 fayl |
| mobile paketi (jest) | **208 / 208**, 19 fayl |
| shared | **34 / 34** |
| i18n | **5 / 5** |
| panel (vitest) | **423 / 423**, 26 fayl |
| TypeScript: api, pro, customer | xətasız |

Sınan və ya atlanan test yoxdur. Mobil, shared, i18n və panel dəstləri son dispatch dəyişikliyindən əvvəl işə salınıb; o dəyişiklik yalnız API kodundadır. Yeni testlər: API-də 27 (bu fazada) + 4 (12.11), pro-da 6 (bu fazada) + 2 (12.11; onlar heç vaxt işləməmişdi, düzəldildi). QA hesabatındakı "1 268 / 1 268" rəqəminin tərkibi göstərilmədiyi üçün dəst-dəst müqayisə etmək mümkün olmadı; customer dəstində 383 əvəzinə 384 test sayılır, səbəbi araşdırılmayıb.

İşə salınmayanlar: `qa/automation` (canlı demo), Maestro / real telefon, panel `next build`, Android APK yığımı.

**QA təsdiqi 5.1** ("API inteqrasiya dəsti son commit-də keçir"): 729 / 729, commit `a4534d5`, 13.11.2026.

## 4. BUG-004 — axtarış zamanı onlayn olan usta təklif almır

**Problem.** Sorğu yaranandan sonra ünvanda onlayn olan usta heç vaxt təklif almırdı, sorğu `EXPIRED` olurdu.

**Təsdiqlənmiş kök səbəb** (`dispatch.service.ts`, `runStep`), iki hissədən ibarətdir:
1. Hər addım solo ustaları yalnız **yeni halqada** axtarır, bərpa yolu isə yalnız son ("wide") addımdakı xidmət ərazisi keçidi idi. Orada `known = entries.map(...)` diskdə Redis-in gördüyü **bütün** onlayn ustaları keçiddən çıxarırdı, o cümlədən bu sorğu üzrə heç vaxt təklif almamış olanları. QA-nın fərziyyəsi düzgün çıxdı.
2. Son addımdan sonra heç bir addım yox idi. Yaxınlıqda başqa usta olmayanda sürətləndirmə (fast-forward) bütün 6 addımı ~15 saniyəyə bitirir, axtarış isə 180 s (demo: 90 s) davam edir. Ölçülüb: sorğudan 20 s sonra onlayn olan usta 0 təklif alırdı.

Orijinal kodla ilk 17 ssenaridən 8-i sınırdı (o cümlədən QA-nın 3 saniyəlik təkrarlaması); 12.11 tarixli düzəlişlə hələ 2-si sınırdı.

**Düzəliş:**
- Son addım solo ustalar üçün **bütün diski** yoxlayır (əvvəlki addımlar əvvəlki kimi yalnız yeni halqanı), xidmət ərazisi keçidi isə yalnız həmin addımda artıq seçilmiş ustaları atlayır.
- **Plan bitəndən sonra** son addım axtarış bitənə qədər hər halqa addımında (`ringStepSec`: 30 s, demoda 10 s; təcili sorğuda 20 s / 8 s) təkrarlanır. Təkrar yalnız yeni uyğun usta varsa təklif göndərir.
- Ustanın sorğudan çıxarılması yalnız sorğunun öz təklif tarixçəsinə əsaslanır: `filterSolos` əvvəl təklif almışları atır, `sendOffers` sorğu sətrinin kilidi altında bir daha yoxlayır, bazada `unique(requestId, handymanId)` var. Heç kim eyni sorğu üçün iki dəfə təklif almır.

**Dəyişməyənlər:** plan addımlarının halqaları və vaxtları, sürətləndirmə, radius, ixtisas, balans, məşğulluq və status süzgəcləri, `maxOffersPerStep`, şirkət məntiqi, `EXPIRED` davranışı, kilidlər. Müştəri tətbiqi axtarış vəziyyətini əvvəlki kimi görür (son plan addımı; təklif sayı yenilənir).

**Bilərəkdən dəyişən davranış** (spesifikasiya §5-ə iki cümlə əlavə olunmalıdır; spesifikasiya faylına toxunulmayıb):
- Son addımda və təkrarlarda əvvəllər `maxOffersPerStep` limitinə görə kənarda qalmış və ya o vaxt məşğul / köhnəlmiş (stale) olub sonradan uyğunlaşan ustalar da təklif alır (ən yaxın birinci).
- Plan bitəndən sonra axtarış "boş gözləmir", hər halqa addımında yenidən yoxlayır.

**Vəziyyətin uyğunluğu.** Əlavə infrastruktur və baza dəyişikliyi yoxdur. Hər addım (təkrarlar da) `updateMany … dispatchStep < step` ilə bir dəfə götürülür; təkliflər sorğu kilidi altında, sorğu hələ axtarışdadırsa və açıq slot varsa yaradılır; ləğv və qəbul gözləyən təkrarı silir; itmiş taymeri reconciler bərpa edir.

**Testlər:** `apps/api/test/b1/dispatch-widening.spec.ts` (yeni, 24 test) və `dispatch.spec.ts`-dəki 3 əvvəlki test. Hamısı keçir.

| Ssenari | Test |
|---|---|
| A ilkin dispatch | "A: an eligible online pro inside the initial radius…" |
| B genişlənmə | "B: a pro outside the initial radius…" |
| C artıq təklif almış | "C: … is not offered the same request again"; "sweeps never offer the same pro twice…" |
| D uyğun usta yoxdur | "D: with only ineligible pros online the request still expires" |
| E oflayn | "E: a pro who goes offline during the search gets no offer" |
| F sonradan onlayn | 3 test (öz halqasından əvvəl; halqası keçəndən sonra; baza ərazisi əhatə etməyən yaxın usta) + "late arrival: … offered at the next sweep" |
| G eyni vaxtda worker-lər | "G: the last step run by several workers at once … one offer per pro" |
| H qəbul edilib | "H: after the request is accepted the widening stops" |
| I ləğv edilib | "I: after the customer cancels…"; "cancelling after the plan ended removes the pending sweep" |
| J Redis uyğunluğu | 2 test (köhnəlmiş presence; itmiş presence hash-i) |
| QA təkrarlamaları | "QA repro … 3 s after the request"; "QA diag-late-online 30 (demo timers)" |
| Əlavə | limitdən artıq qalanlar; 5-ci halqadakı əhatə edən usta; gec onlayn olan şirkət işçisi; reconciler itmiş təkrarı bərpa edir; təcili sorğu; sürətləndirmə olmayanda təkrar yoxdur |

**Qalan məhdudiyyətlər:**
- Gec gələn usta ən çox bir halqa addımı (30 s, demoda 10 s) gözləyir.
- Sürətləndirmə olmayanda (3 və daha çox usta təklif alıbsa) production-da plan axtarış pəncərəsini doldurur: son addım 150-ci saniyədə, axtarış 180-də bitir, təkrar olmur. Son 30 saniyədə onlayn olan usta təklif almır.
- Yük: hər təkrar diskdəki presence-i və ünvanı əhatə edən ustaları yenidən oxuyur (ardıcıl Redis sorğuları). Hazırkı miqyasda əhəmiyyətsizdir; usta sayı çox artanda bu oxunuş toplu (pipeline) edilməlidir. Planlı sorğularda canlı axtarış T−90 dəq-dən T−15 dəq-yə qədər davam edir, yəni təkrarlar da.

## 5. BUG-002 — imzalı fayl linkləri ~1 saat etibarlıdır

**Kök səbəb.** `apps/api/src/config/env.ts`: `FILE_URL_TTL_SEC` standart dəyəri 3600 idi. Spesifikasiya §12: "Signed URLs (HMAC, 10 minutes)". Bir saat qəsdən seçilməyib, səhv standart dəyər idi.

**Düzəliş.** Standart dəyər 600. Linkin ömrü 5 dəqiqəlik keş intervalına aşağı yuvarlanır, yəni faktiki ömür 5–10 dəqiqədir, heç vaxt 10 dəqiqədən çox deyil. KYC linkləri dəyişməyib (dəqiq, ən çox 10 dəqiqə).

**Testlər** (`apps/api/test/a1/hardening.spec.ts`): standart dəyər 600; mühitdən verilən dəyər (900, 120) qəbul olunur, 60-dan kiçik dəyər rədd edilir; TTL=120 ilə işləyən tətbiqdə link müddət daxilində 200, bitəndən sonra 403 `EXPIRED` qaytarır, yeni alınan link yenə işləyir; dəyişdirilmiş imza və irəli çəkilmiş `exp` 403 `BAD_SIGNATURE`.

**Deploy qeydi.** `deploy/.env.example` və `docker-compose.yml` bu dəyişəni təyin etmir, yəni standart dəyər işləyəcək. Serverdəki real `.env`-də `FILE_URL_TTL_SEC=3600` əl ilə yazılıbsa, silinməlidir (serverə çıxış olmadığı üçün yoxlanmayıb).

**Uyğunluq.** Mobil tətbiqlər məlumatı 15 saniyədən sonra köhnəlmiş sayır və ekrana qayıdanda yeniləyir, ona görə linklər adətən təzə olur. Risk: 5–10 dəqiqədən çox açıq qalan və məlumatı yeniləməyən ekranda **ilk dəfə** yüklənən şəkil 403 ala bilər. Real cihazda yoxlanmayıb.

`qa/automation/run-tests.mts`-dəki `KNOWN` siyahısından `AU-D08b` deploy-dan sonra silinməlidir (QA faylıdır, toxunulmayıb).

## 6. BUG-005 — dil dəyişəndə ixtisas adları köhnə dildə qalır

**Kök səbəb.** İxtisas adlarını server `Accept-Language` başlığına görə qaytarır (`GET /pro/profile`), tətbiqin keş açarlarında isə dil yoxdur. Dil dəyişəndə keşdəki köhnə cavab ekranda qalırdı.

**Düzəliş.** `useLocaleRefetch()` (`apps/pro/src/hooks/queries.ts`, `_layout.tsx`-də qoşulub): interfeys dili dəyişəndə yalnız serverin lokallaşdırdığı sorğular yenilənir (profil, kateqoriyalar, sifarişlər, təkliflər, şirkət, layihələr, dəvət, bildirişlər). Pul kisəsi, çat və s. toxunulmur; ümumi `invalidateQueries()` yoxdur.

**12.11 testi haqqında.** `locale-refetch.test.tsx` işə salınanda sınırdı: `renderHook` bu kitabxana versiyasında asinxrondur və gözlənilmirdi, hook heç qoşulmurdu. Test düzəldildi (assertion-lar zəiflədilməyib, əlavə olunub).

**Ekran testi** (`apps/pro/test/locale-labels.test.tsx`): real profil ekranı, cavabı `Accept-Language`-ə görə verən saxta API.

| Yoxlama | Nəticə |
|---|---|
| AZ → EN → RU → AZ, hər keçiddə adlar yeni dildə, kartın qalan hissəsi yerində | keçir |
| Sürətli ardıcıl dəyişmə: sonuncu seçilən dil qalır | keçir |
| Profil ekranından çıxıb qayıtmaq | keçir |
| Yenidən başlatma: saxlanmış dil ilk sorğuda istifadə olunur | keçir |
| Server əlçatmazdır: köhnə adlar qalır, tətbiq çökmür; əlaqə qayıdanda yenilənir | keçir |

Düzəliş çıxarılanda bu testlərdən 4-ü sınır (bag təkrarlanır).

**Məhdudiyyətlər.** "Çatışmayan tərcümə" halı tətbiq tərəfində yaranmır: kateqoriyanın üç dildə adı bazada məcburidir. Customer tətbiqində oxşar keş davranışı ola bilər (QA da yoxlamayıb); bu faza yalnız pro tətbiqini əhatə edir.

## 7. BUG-006 — "Qəbul et və…" düyməsinin mətni kəsilir

**Kök səbəb.** `CompanyHome.tsx`: iki düymə bir sətirdə, hər biri kartın yarısı. Ölçülüb (Inter SemiBold 16): Galaxy A24-də (384 dp) mətn üçün 118 dp yer qalırdı, "✓ Qəbul et və göndər" isə 164,5 dp tutur. Yan-yana düzülüşdə mətn hər üç dildə və bütün ekran enlərində kəsilirdi.

**Düzəliş.** Düymələr alt-alta, tam enli: üstdə "Qəbul et və göndər", altda "İmtina et". Mətn, `testID`-lər, hadisələr və ümumi `Button` komponenti dəyişməyib. Hər düymə 48 dp hündürlükdədir.

**Yoxlama.** `m4-company.test.tsx`-də test: düymələr bir sütundadır, tam enlidir, tam mətn AZ / RU / EN dillərində görünür (köhnə düzülüşdə sınır). Şrift ölçüləri ilə hesablama (yeni düzülüş):

| Ekran eni | Şrift miqyası 1.0 | 1.15 | 1.3 | 1.5 | 2.0 |
|---|---|---|---|---|---|
| 320 dp | sığır | sığır | RU kəsilir | kəsilir | kəsilir |
| 360 dp | sığır | sığır | sığır | RU kəsilir | kəsilir |
| 384 dp (A24) | sığır | sığır | sığır | sığır | kəsilir |
| 411 dp | sığır | sığır | sığır | sığır | AZ, RU kəsilir |

**Məhdudiyyət.** Çox böyük sistem şriftində mətn yenə qısala bilər, çünki ümumi `Button` tək sətirlidir və bütün ekranlarda istifadə olunur; onu dəyişmək bu bagın çərçivəsindən kənardır. Ekran oxuyucusu tam mətni alır (`accessibilityLabel`).

## 8. BUG-001 — customer testlərində timeout

Patch (`patches/BUG-001-customer-tests-timeout.patch`) yoxlanıldı: yalnız ilk router render-i üçün `waitFor` müddəti 10 s və iki testə 30 s limit, assertion-lar dəyişmir. Patch `848d402` commit-ində **tam tətbiq olunub**; əks istiqamətdə yoxlama boşluq fərqləri nəzərə alınmayanda keçir. Adi `git apply`-ın alınmamasının səbəbi patch faylının CRLF, mənbənin LF sətir sonluqları ilə olmasıdır.

Nəticə: `login-flow` və `restore-session` ayrıca 5 / 5 keçir; tam customer dəsti ardıcıl 2 dəfə 384 / 384.

## 9. QA suallarına cavab (Q-01, Q-02, Q-03)

Developerin qərarı (13.11.2026): **üçü də qəsdəndir, bag deyil.** Kod dəyişməyib.

| # | Cavab |
|---|---|
| Q-01 | Qəsdəndir. Xidmət zonası yoxlaması yoxdur; zonadan kənar sorğu usta tapılmadığı üçün `EXPIRED` olur. |
| Q-02 | Qəsdəndir. "Gəldikdən sonra imtina" 5 dəqiqəlik pəncərədən asılı olmayaraq 15 AZN-dir (spesifikasiya, qərar 9): usta artıq ünvana gəlib. Pulsuz pəncərə yalnız adi ləğvə aiddir. |
| Q-03 | Qəsdəndir. Menecer oflayn işçini təyin edə bilər (zəng edib çağırır); siyahıda işçi "Oflayn" kimi göstərilir. |

## 10. Production taymerləri və limitləri (QA təsdiqi 5.3)

| Parametr | Production | Demo |
|---|---|---|
| Təklifin ömrü (`offerTtlSec`) | 30 s | 15 s |
| Halqa addımı (`ringStepSec`) / təcili | 30 s / 20 s | 10 s / 8 s |
| Axtarış müddəti (`noMatchAfterSec`) | 180 s | 90 s |
| Sürətləndirmə həddi (`minCandidates`), addım | 3 usta, 3 s | eyni |
| Bir addımda ən çox təklif (`maxOffersPerStep`) | 10 | 10 |
| Pulsuz ləğv pəncərəsi (`freeCancelSec`) | 300 s | 300 s |
| No-show (`noShowAfterMin`) | 45 dəq | 5 dəq |
| Planlı sorğu: canlı axtarış / "tapılmadı" | T−90 dəq / T−15 dəq | T−1 dəq / T |
| Zəmanət: əvvəlki ustaya üstünlük | 10 dəq | 10 dəq |
| Presence köhnəlməsi (`onlineStaleSec`) | 90 s | 90 s |
| OTP: uzunluq, etibarlılıq | 6 rəqəm, 5 dəq | eyni |
| OTP: təkrar göndərmə fasiləsi | 60 s | eyni |
| OTP: bir nömrəyə / bir IP-yə saatda | 5 / 20 kod | eyni |
| OTP: səhv cəhd limiti | 5 | eyni |
| İmzalı fayl linki | 5–10 dəq | eyni |

## 11. Developerdə qalan addımlar (QA yoxlama siyahısı üzrə)

| QA maddəsi | Vəziyyət |
|---|---|
| BUG-004, 002, 005, 006 düzəlişləri; BUG-001 patch-i | Hazırdır, `main`-də commit olunub. Push + deploy lazımdır |
| Q-01, Q-02, Q-03 cavabları | §9 |
| "Nə dəyişdi" qeydi | §2 |
| API testlərinin təsdiqi (5.1), production taymerləri (5.3) | §3, §10 |
| QA admin hesabı (2.1) | Skript repodadır. Deploy-dan sonra serverdə: `docker compose -f deploy/docker-compose.yml exec -e QA_ADMIN_EMAIL=<qa e-poçtu> api node dist/prisma/seed/qa-admin.js`. Parol konteynerdə fayla yazılır (ekrana çıxmır), QA-ya təhlükəsiz kanalla verilməlidir. Elvinin strike-larını QA bu hesabla sıfırlayır (AU-L02) |
| Release keystore + Maps açarı → yeni APK-lar (BUG-003) | Kod hazırdır (`docs/android-release-signing.md`). Qalır: açarın yaradılması, SHA-1-in Google Cloud-da Maps açarına əlavə olunması, 0.1.1 APK-larının yığılıb `/download/`-a qoyulması |
| Repo-ya read-only giriş (2.4) | Developerin GitHub-da edəcəyi addım |
| Rate-limit testi üçün ayrıca demo nömrəsi (5.2) | Developer təyin etməlidir |

## 12. QA üçün retest

1. API deploy olunandan sonra: `node retest-bugs.mts 002 004`, sonra `node run-tests.mts flows`.
2. BUG-004 üçün əlavə: `node tools/diag-late-online.mts 3` və `node tools/diag-late-online.mts 30`. Hər ikisində təklif gəlməlidir (ikincidə ən gec ~10 s sonra).
3. BUG-005 və BUG-006 üçün pro tətbiqinin **yeni APK-sı** lazımdır: Maestro `o07` və `o05b`. 0.1.1 başqa açarla imzalandığı üçün əvvəlcə 0.1.0 silinməlidir.
