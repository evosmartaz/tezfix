# Admin hesabı gələndə edilecəklər

Developerdən istənilib (2026-11-09): canlı demo üçün ayrıca QA admin hesabı (e-poçt + parol).

**Necə vermək:** parolu çata yazmayın. Terminalda (PowerShell) bunu yazın:

```powershell
$env:TF_ADMIN_EMAIL = "qa-admin@..."; $env:TF_ADMIN_PASSWORD = "..."
```

Sonra mənə "admin hazırdır" deyin. Testlər `adminLogin()` (`qa/automation/lib.mts`) ilə bu dəyişənləri oxuyur; parol heç bir fayla yazılmır.

## Gözləyən testlər

| ID | Nə yoxlanacaq |
|---|---|
| AU-L02 | **İlk iş:** Elvinin strike-larını sıfırlamaq (testlərdən 3 strike var); blokla / blokdan çıxar; audit jurnalı |
| AU-L01 | KYC rədd → yenidən göndərmə; 24 saatda 4-cü göndərmə rədd olunur (Samir) |
| AU-L03 | Hər admin əməliyyatı audit jurnalında: aktor, öncə / sonra |
| AU-L04 | Tənzimləmə dəyişir və dərhal tətbiq olunur (sonra geri qaytarılır) |
| AU-L05 | Demo botları: yarat / sil; silinən botun işləri ləğv olunur, slot yenidən göndərilir |
| AU-H06 / G05 | Balans düzəlişi: səbəb məcburidir, audit; eyni açarla 2 dəfə = 1 əməliyyat |
| AU-F11 / F12 / F13 | Aşağı balans və borc halları (admin düzəlişi ilə balansı salıb yoxlamaq, sonra bərpa) |
| AU-F18 | Qiymət mübahisəsi → admin qiyməti düzəldir / tamamlayır / ləğv edir |
| AU-F21 | Zəmanət müraciəti → admin yenidən göndərir (Aysel) |
| AU-I08 | Hesab-faktura "ödənildi" → pul qazanca keçir, layihə `PAID` |
| AU-J01 / J02 | Payout: "indi işə sal", `PAID` / `FAILED` (FAILED olanda pul qayıdır) |
| AU-M05 | KYC faylları: `Cache-Control: private, no-store` |
| AU-N01–N06 | Playwright: admin panel (login, menyu, sifarişlər, KYC, müraciətlər, demo səhifəsi) |
| AU-C10 🔒 | Admin login brute-force limiti (yalnız icazə ilə) |
