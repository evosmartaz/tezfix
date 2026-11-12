# Phase 2 — Fix Report (BUG-004, 002, 005, 006, 001)

Tarix: 2026-11-12. Commit edilməyib (working tree-də dəyişikliklərdir). Phase 1 dəyişiklikləri toxunulmayıb.

## Test mühiti məhdudiyyəti (vacib)
- Bu maşında Docker, Redis yoxdur. API testləri (`apps/api`) Postgres:55432 + Redis:56379 tələb edir → **işə salınmayıb**.
- Mobil Jest testləri (`apps/pro`, `apps/customer`) bu Windows mühitində **dəyişikliklərimdən əvvəl də** `Cannot find native module 'ExpoCrypto'` xətası ilə düşür (`git stash` ilə `offers.test.ts` üzərində təsdiqləndi). Yəni yeni testlər də bu mühitdə icra oluna bilmədi.
- Yalnız `tsc` (apps/pro) yoxlanıb: dəyişən fayllarda xəta yoxdur.
- Nəticə: heç bir düzəliş "FIXED AND VERIFIED" deyil. Testləri Linux/CI-də və ya Docker-li maşında işə salın.

## BUG-004 — Dispatch: gec onlayn olan usta təklif almır
- **Kök səbəb (təsdiqləndi, kod oxunması ilə):** `dispatch.service.ts` wide addımında `known = entries.map(...)` diskdəki bütün onlayn ustaları ehtiva edirdi. Usta daxili halqa addımından sonra onlayn olsa, nə yeni halqa süzgəci (`ring.has(cell)`), nə də xidmət-ərazisi keçidi (`!known.has(id)`) ona baxırdı.
- **Düzəliş:** `known` yalnız bu addımda artıq qiymətləndirilmiş ustalardır (`soloEntries` + `workerEntries`). Əvvəl təklif almışlar `sendOffers`-də (sorğu kilidi altında, `offer` cədvəlinə görə) yenə də atlanır → dublikat təklif yoxdur.
- **Dəyişməyənlər:** radius/zamanlama, eligibility filtrləri, busy/balans qaydaları, kilid və idempotentlik, EXPIRED davranışı.
- **Fayllar:** `apps/api/src/modules/requests/dispatch/dispatch.service.ts`; testlər `apps/api/test/b1/dispatch.spec.ts` (3 yeni test: gec onlayn usta wide addımda təklif alır; əvvəl təklif almış təkrar almır + oflayn almır; heç kim yoxdursa EXPIRED).
- **Əhatə edilməyən ssenarilər (A–J-dən):** artıq mövcud `dispatch.spec.ts`/`races.spec.ts` initial/ring/cancel/accept/eynizamanlı hallarını əhatə edir; yeniləri yazılmayıb. Stale Redis (J) üçün ayrıca test yoxdur.
- **Məhdudiyyət:** wide addımdan əvvəlki halqalarda gec onlayn olan usta hələ də yalnız wide addımda təklif alır (spesifikasiyaya uyğun: "k5 plus providers whose declared service area covers the request cell"). Daha tez çatdırma ayrıca məhsul qərarıdır.
- **Status:** FIXED — AWAITING QA VALIDATION (testlər icra olunmayıb).

## BUG-002 — Signed URL TTL
- **Kök səbəb:** `apps/api/src/config/env.ts` `FILE_URL_TTL_SEC` default 3600. Spesifikasiya (`docs/superpowers/specs/2026-10-24-tezfiks-design.md` §12): "Signed URLs (HMAC, 10 minutes)" → 600 düzgündür.
- **Düzəliş:** default 600. `deploy/.env.example`-də bu dəyişən təyin olunmayıb, ona görə deploy-da default işləyir; deploy mühitində `FILE_URL_TTL_SEC` əl ilə qoyulubsa, onu yoxlayın/silin.
- **Qeyd:** URL bucket ilə aşağı yuvarlanır (min(300, TTL/2)), yəni real ömür 300–600 s. Bu əvvəlki dizayndır.
- **Test:** `apps/api/test/a1/hardening.spec.ts` — default 600, etibarlı URL işləyir, dəyişdirilmiş `sig` 403, vaxt keçəndən sonra 403.
- **Status:** FIXED — AWAITING QA VALIDATION.

## BUG-005 — Dil dəyişəndə ixtisas adları köhnə qalır
- **Kök səbəb:** server `Accept-Language`-ə görə lokallaşdırılmış data qaytarır, amma query key-lərdə dil yoxdur → keş köhnə mətni saxlayır.
- **Düzəliş:** `useLocaleRefetch()` (`apps/pro/src/hooks/queries.ts`, `_layout.tsx`-də qoşulub). UI dili dəyişəndə yalnız lokallaşdırılmış sorğular invalidate olunur: profil, kateqoriyalar, pro assignments/offers, company, projects, notifications. Wallet/chat toxunulmur. Ümumi `invalidateQueries()` istifadə olunmayıb.
- **Test:** `apps/pro/test/locale-refetch.test.tsx` (AZ→EN→RU→AZ, eyni dil təkrarı). İcra olunmayıb (mühit).
- **Əhatə xaricində:** customer app-da eyni davranış yoxlanmayıb (QA qeydi də bunu deyir). Oflayn/tərcümə çatışmazlığı testləri yazılmayıb.
- **Status:** FIXED — AWAITING QA VALIDATION (real cihazda AU-O07 təkrarlanmalıdır).

## BUG-006 — "Qəbul et və göndər" düyməsi kəsilir
- **Kök səbəb:** `Button` etiketi `numberOfLines={1}`, iki düymə `flexDirection: 'row'`-da yarı enə sıxılır.
- **Düzəliş:** `apps/pro/src/components/CompanyHome.tsx` — düymələr şaquli, tam en (Qəbul et üstdə, Rədd et altda). testID-lər, handler-lər dəyişməyib. Paylaşılan `Button` komponentinə toxunulmayıb.
- **Test:** yeni test yazılmayıb; mövcud `m4-company.test.tsx` testID-lərə güvənir (dəyişməyib), amma icra olunmayıb. Kiçik ekran/böyük şrift yoxlanmayıb.
- **Status:** FIXED — AWAITING QA VALIDATION (Maestro/real cihazda AU-O05).

## BUG-001 — Customer test timeout
- Patch yoxlanıldı: yalnız `waitFor` timeout 10 s və testə 30 s timeout əlavə edir, assertion-lar dəyişmir.
- `git apply` yalnız `login-flow.test.tsx`-i tətbiq etdi; `restore-session.test.tsx` eyni dəyişiklik ilə əl ilə tətbiq olundu (patch-dəki hunk-ın nəticəsi eynidir). Patch iki dəfə tətbiq olunmayıb.
- Test təkrar icra olunmayıb (mühit xətası yuxarıda).
- **Status:** FIXED — AWAITING QA VALIDATION.

## Dəyişən fayllar
- apps/api/src/modules/requests/dispatch/dispatch.service.ts
- apps/api/src/config/env.ts
- apps/api/test/b1/dispatch.spec.ts
- apps/api/test/a1/hardening.spec.ts
- apps/pro/src/hooks/queries.ts, apps/pro/src/app/_layout.tsx
- apps/pro/test/locale-refetch.test.tsx (yeni)
- apps/pro/src/components/CompanyHome.tsx
- apps/customer/test/login-flow.test.tsx, apps/customer/test/restore-session.test.tsx

## Təklif olunan commit-lər
`fix(dispatch): correct technician exclusion during widening` · `fix(api): align signed file URL expiration` · `fix(pro): refresh specialization labels on locale change` · `fix(pro): prevent company action button truncation` · `test(customer): stabilize timeout-sensitive tests`

## Növbəti addım
Docker/Redis olan maşında: `cd apps/api && npx vitest run test/b1/dispatch.spec.ts test/a1/hardening.spec.ts`, sonra `npm test -w @tezfiks/pro` və `-w @tezfiks/customer`.
