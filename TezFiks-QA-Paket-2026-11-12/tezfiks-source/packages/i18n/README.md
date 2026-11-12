# @tezfiks/i18n

Translations for TezFiks in Azerbaijani (`az`, default and fallback), Russian (`ru`) and English (`en`).

## Layout

| File | Owner | Used by |
|---|---|---|
| `locales/<lng>/common.json` | shared | every client and the server (errors by code, status labels, buttons) |
| `locales/<lng>/customer.json` | customer app | `apps/customer` |
| `locales/<lng>/pro.json` | pro app | `apps/pro` |
| `locales/<lng>/panel.json` | web panels | `apps/panel` |
| `locales/<lng>/server/*.json` | one file per API module | API only (notification texts, page copy); merged at runtime |

Rules:

- Every key must exist in all three languages (`npm test -w @tezfiks/i18n` checks parity).
- Russian plurals use `_one`, `_few`, `_many`, `_other`; Azerbaijani and English use `_one`, `_other`.
- Interpolation uses i18next syntax: `{{name}}`.
- Never uppercase Azerbaijani text with CSS/`textTransform`; use `upperAz()` from `@tezfiks/shared`.
