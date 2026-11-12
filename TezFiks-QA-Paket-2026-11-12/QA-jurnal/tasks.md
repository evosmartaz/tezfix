# Tapşırıqlar

Status: `[ ]` gözləyir · `[~]` davam edir · `[x]` bitib · `[!]` bloklanıb

## 2026-11-09

- [x] **T1. Mövcud testləri işə salıb QA hesabatı vermək**
  Docker tələb etməyən bütün dəstlər: shared, i18n, mobile, customer, pro, panel və API typecheck.
- [!] **T2. API test dəstini işə salmaq (692 test)**
  Bloklanıb: bu kompüterdə Docker yoxdur. Docker Desktop qurulmalı, sonra `npm run dev:db` işlədilməlidir.
- [x] **T3. Flaky customer testlərini düzəltmək**
  `apps/customer/test/login-flow.test.tsx`, `apps/customer/test/restore-session.test.tsx`: tam run-da 5 s timeout. Assertion-lara toxunmadan timeout-u artırmaq.
- [ ] **T4. QA automation: API testləri (canlı demo sayt)**
  Planın 2-ci mərhələsi. İstifadəçinin təsdiqini gözləyir.
- [~] **T5. QA automation: panel E2E (Playwright, canlı demo sayt)**
  Şirkət paneli bitdi (`10-company-panel`, 8/8). Admin panel admin parolunu gözləyir.
- [x] **T6. QA automation: mobil E2E (Maestro)**
  2026-11-10: Samsung A24 (Wi-Fi debugging). O01–O07 hamısı keçdi. Baglar: BUG-003 (Maps), BUG-004 (dispatch), BUG-005 (pro dil keşi). Telefon ayarları bərpa olundu.
  Alətlər `D:/tools`-dadır (~700 MB). Ssenarilər `qa/maestro/`, Elvin/müştəri driver-i `qa/automation/mobile-driver.mts`.
- [x] **T7. QA iş axınını qurmaq**
  İstifadəçi manual test edir, Claude automation edir, birgə hesabat Word/PDF kimi developerə gedir. Baglar `qa/bugs.md` faylında, hesabatlar `qa/reports/` qovluğunda saxlanır.
- [ ] **T8. Manual test: istifadəçi tətbiqləri əl ilə yoxlayır**
  Siyahı: `qa/manual-checklist.md`. Tapılan baglar `qa/bugs.md` faylına yazılır.
- [x] **T9. Developer üçün ilk QA hesabatı (PDF)**
  Manual və automation nəticələri birlikdə. Hələlik yalnız PDF.
- [x] **T10. Manual və automation test siyahıları, developer formatında bag şablonu, vahid PDF**
  `qa/manual-checklist.md`, `qa/automation-plan.md`, `qa/bugs.md` → `qa/pdf/TezFiks-QA-Test-Plani-2026-11-09.pdf`.
- [~] **T11. Automation siyahısını icra etmək (`qa/automation/`)**
  01–12 faylları: 112/113, plan əhatəsi 96/128. Qalanlar: admin (T12), Maestro (T6), rate-limit (icazə), API dəsti (Docker). 🔒 rate-limit testləri yalnız icazə ilə işlədilir.
- [!] **T12. Admin testləri (`qa/admin-pending.md`)**
  Developerdən QA admin hesabı istənilib (2026-11-09). Gələndə: əvvəlcə Elvinin strike-larını sıfırla.
- [x] **T13. `C:\Users\Dell\Desktop\tezfiks` nüsxəsini silmək**
  C diskində yer azdır. Layihə yalnız `D:\QA manual\tezfiks`-də qalmalıdır. Yoxlandı: commit eyni idi (`00368ff`), `.env`, `uploads`, keystore və APK-lar D-dəki ilə eynidir. Nüsxə silindi, ~29 GB boşaldı.

## 2026-11-10

- [x] **T14. Hesabat №1-i mobil nəticələrlə yeniləmək (PDF)**
  `qa/reports/TezFiks-QA-2026-11-10.pdf` (mənbə `.html`). Maestro O01–O07, BUG-003/004/005, yeni müşahidələr və qalan işlərin siyahısı əlavə olundu. Köhnə 09.11 PDF-i tarixçə üçün saxlanıb.
- [x] **T15. AU-F24 "məşğul işçi" hissəsini bitirmək**
  `qa/automation/13-busy-worker.test.mts` 5/5: məşğul Kamran → `409 WORKER_UNAVAILABLE`, hold yoxdur; Tural ilə qəbul olur. Q-03 (oflayn işçiyə təyin) və BUG-006 (düymə mətni) `bugs.md`-yə yazıldı, PDF-də yoxdur.
- [x] **T16. Köhnə hesabatları silmək, yalnız sonuncunu saxlamaq**
  `qa/reports/`-da yalnız `TezFiks-QA-2026-11-10.html/.pdf` qalır. 09.11 hesabatı və `qa/automation/`-dakı boş HTML silindi. Qayda: yeni hesabat yarananda köhnələr silinir.
- [x] **T17. Hesabata BUG-006 və Q-03 əlavə etmək**
  `qa/reports/TezFiks-QA-2026-11-10.pdf` yeniləndi (eyni fayl, köhnəsinin yerinə): BUG-006 (ekran görüntüsü ilə), Q-03, `13-busy-worker` 5/5, cəmi 117/118, KPI 6 bag + 3 sual.
- [x] **T18. Retest paketi: bir əmrlə testlər + bag retesti**
  `qa/automation/run-tests.mts` (quick/flows/long/all), `qa/automation/retest-bugs.mts` (BUG-002…006), təlimat `qa/RETEST.md`. Yoxlama: quick 65/66 (yalnız BUG-002), flows 37/37, retest: BUG-002 və BUG-004 hələ var, APK-lar dəyişməyib.

## 2026-11-12

- [~] **T19. QA-nı tam bağlamaq (yekun mərhələ)** — ⏸ 2026-11-12 "saxla". Davam nöqtəsi: `progression.md`-nin ən üst qeydi. Qərarlar: API dəsti = developerin 692/692 nəticəsi; rate-limit ən sonda; manual birlikdə.
  Retest + tam reqressiya (`run-tests all`), mobil retest (BUG-003/005/006), admin testləri (hesab gələndə), qalan automation, manual yoxlamalar, yekun PDF hesabat və QA bağlanış sənədi (sign-off).
- [~] **T20. Yeni IT üçün TezFiks paketi + developerdən tələblər hesabatı**
  Masaüstünə zip (mənbə kodu + QA materialları, sirlərsiz) və ayrıca PDF: QA-nı bitirmək üçün developerdən nə lazımdır.
