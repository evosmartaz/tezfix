# TezFiks Build Plan (waves and lanes)

> **For agentic workers:** you are implementing ONE lane of this plan. Read **Global Constraints** and **Conventions** (all of it), then **your lane**.
> The spec is `docs/superpowers/specs/2026-10-24-tezfiks-design.md` (business rules are authoritative there).
> The shared contract is `packages/shared/src/contract/**` (endpoints, request/response shapes) and `packages/shared/src/socket.ts`.
> Business-rule helpers live in `packages/shared/src/policy.ts` and `packages/shared/src/settings.ts`. Design boards: `design/*.png` (read them as images).

**Goal:** a complete, tested TezFiks demo: API (NestJS), customer + pro Android apps (Expo), web panels (Next.js), all against one contract.
**Architecture:** contract-first monorepo (npm workspaces). Foundation (done, committed): root config, `packages/shared` (contract, policies, client),
`packages/i18n`, `apps/api` core (Prisma schema + migrations, ledger, auth core, routing, jobs, test harness).
**Tech stack:** see spec §1.1 and `apps/api/package.json`. Node 26 locally, Postgres 17 + Redis 8 in Docker (`deploy/docker-compose.dev.yml`, already running: Postgres 127.0.0.1:55432 user/pass/db `tezfiks`, Redis 127.0.0.1:56379).
**Spec:** `docs/superpowers/specs/2026-10-24-tezfiks-design.md`

## Global Constraints

- **Tests are the specification. Never weaken, delete or edit an assertion to make it pass. Fix the code.** Only fix a test when it contradicts the spec, and say so in your report.
- Money is integer qəpik; never floats. All balance changes go through `LedgerService` (never update balances directly).
- All business time comes from `Clock` (`this.clock.now()`), never `new Date()` / `Date.now()` in business logic.
- No hard-coded user-facing strings: use `packages/i18n` (az default, ru, en; all three must have the same keys).
- Phones never appear in offers, notifications, push payloads or lists given to the other party (spec §4.4).
- Do not edit files owned by another lane. Do not edit `apps/api/src/app.module.ts`, the foundation core (`apps/api/src/{config,infra,common}/**`,
  `apps/api/src/modules/ledger/**`, `apps/api/test/helpers/**`), `apps/api/prisma/schema.prisma` or migrations, unless your lane says so. If you believe a foundation change is
  required, implement a local workaround in your own files and report the need precisely.
- The contract is frozen. Exception: you may ADD optional response fields or new endpoints in a domain file under `packages/shared/src/contract/domains/` that belongs to your lane's endpoints,
  then rebuild with `node scripts/npm-safe.mjs run build -w @tezfiks/shared`. Never rename or remove anything. Report every addition.
- Install packages only with `node scripts/npm-safe.mjs install -w <workspace> <pkg>@<exact-version> --save-exact` (serializes concurrent npm runs). Prefer existing dependencies. npm 11 blocks
  install scripts: if a new package needs one, run `npm install-scripts ls` and approve only well-known packages.
- Do NOT commit. Leave your work in the working tree; the orchestrator commits per wave.
- Windows machine, Git Bash + PowerShell. Two tooling quirks:
  1. A "Fact-Forcing Gate" hook blocks the first Bash command of a session and the first Write/Edit of each new file until you state facts
     (the request in one sentence, what the command/file is for and who uses it, that no existing file serves the purpose, the user's instruction:
     "Finish the app code, write tests, don't change tests for making them pass ... test all of the functionalities"). State them in text and retry the same call.
  2. Shell heredocs that contain non-ASCII characters (ə, ı, ş, ü, Cyrillic...) get corrupted by a command-rewriting hook. Write such files with the Write tool, never with heredocs.

## Conventions (API lanes)

**Routing.** Controllers use `@Controller()` with NO path. Each handler: `@Route(api.<domain>.<endpoint>)` from `src/common/http/route.decorator`,
input via `@Input() input: RouteInput<typeof api.x.y>` (`src/common/http/input.decorator`) which holds zod-parsed `params`, `query`, `body`
(multipart bodies are not parsed: parse fields yourself after multer). Principals: `@CurrentUser() user: UserPrincipal` (`{userId, sessionId, app}`),
`@CurrentAdmin() admin: AdminPrincipal`, `@CurrentPrincipal()`, `@ReqLocale() locale`, `@ClientIp()`, `@UserAgent()` from `src/common/auth/current.decorators`.
The global `AuthGuard` enforces the endpoint's `auth` kind. The global `IdempotencyInterceptor` handles `idempotent` endpoints automatically.

**Responses.** Return plain objects that match the contract response schema exactly. Tests run with `CONTRACT_VALIDATE_RESPONSES=true`: a mismatch
becomes a 500 with `details.contractMismatch`. Use `num()`, `numOrNull()`, `iso()`, `ratingAvg()`, `pageOf()` from `src/common/mapping.ts`.
Nullable contract fields must be present as `null`, never omitted.

**Errors.** `throw new ApiException('<CODE>', details?)` (`src/common/http/api-exception`). Codes only from `ERROR_CODES` in `packages/shared/src/errors.ts`.
The filter renders `{ error: { code, message (localized), details } }`.

**Database.** `PrismaService` (generated client in `src/generated/prisma/client`; import model types from there). For atomic work use
`inTx(this.prisma, async (tx) => { ... })` from `src/infra/prisma.service` and pass `tx` to every ledger call inside. Row locks with
`tx.$queryRawUnsafe('SELECT ... FOR UPDATE', ...)`. Conditional state transitions as `updateMany({ where: { id, status: 'X' } })` and check `count`.
H3: `h3-js` 4.5 (`latLngToCell(lat, lng, 7)`, `gridDisk`, `gridRing`, `cellToLatLng`, `greatCircleDistance`); cells stored as 15-char hex strings.

**Ledger** (`src/modules/ledger/ledger.service.ts`, global): `ensureAccount(ownerType, ownerId, kind, opts?, db?)`, `platformAccountId(kind, db?)`,
`post({kind, idempotencyKey, entries:[{accountId, amount}], memo?, refs?, actor?, allowOverdraft?}, db?)`, `hold({accountId, amount, kind, requestId?, slotId?, assignmentId?, quoteId?}, db?)`,
`releaseHold(holdId, db?)`, `captureHold(holdId, {kind, toAccountId, idempotencyKey, memo?, refs?, actor?}, db?)`, `balance(id)`, `summary(id)` (WalletSummary),
`listTransactions(id, {cursor, limit})`, `verifyIntegrity()`, `globalSum()`. Owner types: CUSTOMER_ACCOUNT (ownerId = customer account id), HANDYMAN (handyman profile id),
COMPANY (company id), PLATFORM. Idempotency keys look like `<purpose>:<entity id>`, e.g. `fee-capture:<assignmentId>`.
Account layout: customer account → WALLET (allowNegative=false; penalties use `allowOverdraft`); solo handyman → WALLET + EARNINGS;
company → WALLET + EARNINGS; company workers have NO accounts (the company pays). Platform: REVENUE, PROMO, EXTERNAL, PAYOUTS_IN_TRANSIT, ADJUSTMENTS.

**Timers.** `JobsService` (global): `register(name, handler)` in `onModuleInit`; `schedule(name, data, { at?: Date, delayMs?, jobId? })`
(same jobId replaces the pending job); `cancel(jobId)`; `runNow(name, data)`. Tests run with `JOBS_MODE=manual`: move time with `t.clock.advance(ms)`
then `await t.jobs.runDue()`. Every handler must be idempotent: re-read state, do nothing if it already moved on. Postgres stores every deadline.
Also register a repair task with `ReconcilerService.register(name, async () => {...})` that finds overdue rows (deadline < clock.now()) and processes them;
tests call `t.reconciler.tickAll()`.

**Realtime.** `RealtimeService` (global): `toUser(userId, event, payload)`, `toCompany`, `toAssignment`, `toRequest`, `toAdmins` with typed payloads from
`ServerToClientEvents` (`packages/shared/src/socket.ts`). In tests every emit is recorded: `t.realtime.sentTo('user:<id>', 'offer:new')`.
**Domain events:** `DomainEvents` (global): `on('payment.succeeded', handler)`, `emit(...)` (see `src/infra/events.ts`).
**Settings:** `await this.settings.get()` (`PlatformSettings`, demo overrides applied). Tests change settings with `await t.settings.update({...}, null)`.
**Audit:** every admin mutation calls `AuditService.log({ actorType: 'ADMIN', actorId, action, entityType, entityId, before, after, ip })`.
**Rate limits:** `RateLimiter.enforce(key, limit, windowSec, code?)`.
**Translations:** server texts live in `packages/i18n/locales/{az,ru,en}/server/<your-module>.json` (create your own file; never edit another lane's).
Translate with `I18nService.t(locale, 'server.<module>.<key>', vars)`. `npm test -w @tezfiks/i18n` must stay green.
**Module wiring:** fill your module class (`src/modules/<name>/<name>.module.ts`): controllers, providers, `exports` for services other lanes use,
`imports` of modules whose exported services you inject. Global (inject anywhere): PrismaService, RedisService, Clock, JobsService, ReconcilerService,
DomainEvents, RateLimiter, RealtimeService, TokenService, SessionsService, I18nService, SettingsService, AuditService, LedgerService, `ENV` (`@Inject(ENV) env: Env`).
Avoid circular module imports; when two modules need each other, use `DomainEvents` or a registration callback instead.

**Tests.** Vitest e2e in `apps/api/test/<lane>/*.spec.ts`. Pattern:
```ts
let t: TestApp;
beforeAll(async () => { t = await createTestApp(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => { await t.reset(); });
it('...', async () => {
  const c = await createCustomer(t, { balance: 5000 });
  const out = await t.client(c.token).call(api.requests.create, { body: {...} });
});
```
Helpers: `test/helpers/app.ts` (`createTestApp`, `TestApp` with prisma, redis, clock, jobs, reconciler, realtime, settings, sessions, ledger, `client(token, locale)`, `origin`, `baseUrl`),
`test/helpers/factories.ts` (`randomPhone`, `BAKU`, `categoryId`, `createUser`, `tokenFor`, `adminToken`, `fund`, `createCustomer`, `createSoloHandyman`, `createCompany`).
You may add helpers in `test/<lane>/helpers.ts`; don't edit the shared helpers (report needed changes).
Expect API errors with `await expect(call).rejects.toMatchObject({ code: 'X', status: 409 })` (the client throws `ApiError`).
Run ONLY with your lane's isolated database and Redis DB:
`cd apps/api && TEST_DB_NAME=tezfiks_test_<lane> TEST_REDIS_DB=<n> npx vitest run test/<lane>`
(Redis DB numbers: a1=2, a2=3, a3=4, a4=5, b1=6, b2=7, b3=8, b4=9, b5=10, b6=11, integration=12; reviewers use n+20; fixers use n+40.)
Typecheck: `cd apps/api && npx tsc -p tsconfig.json --noEmit`. Other lanes work in parallel in the same tree: errors in THEIR files are not yours;
your files must have zero errors. If the test app fails to boot because of another lane's half-written file, wait 1-2 minutes and retry; never edit their files.
Write each new file in one go (complete and compilable) so you never break other lanes' test runs.

**Definition of done (every lane):** all endpoints of the lane implemented exactly per contract and spec; tests cover happy paths, every error code the lane can raise,
authorization (wrong user / wrong role / other company), idempotency where marked, timers via manual jobs, and the Review Focus items below; lane tests green;
zero type errors in your files; i18n tests green; a final report listing files, endpoints, exported services (exact signatures), test counts, deviations and contract additions.

## Review Focus (whole system)

1. **Race conditions on money and slots**: two handymen accepting the last slot at once; double-submitted accept/cancel/topup (idempotency); a hold never captured twice.
2. **Privacy leaks**: phone numbers or exact addresses in offers, lists, push payloads or before contact unlock; company workers seeing customer description/price/company money.
3. **Timer edge cases**: actions exactly at the 5-minute boundary; jobs firing after state already moved on; scheduled requests booked inside the lead time; server restarts (reconciler).
4. **Azerbaijani input**: names/addresses with ə ı İ ş ç ğ ö ü round-trip intact; search folds dotted/dotless i; phone formats (`050 123 45 67`, `+994...`) normalize.
5. **Money invariants**: ledger global sum is always 0 and `verifyIntegrity()` returns [] after every multi-step test; no negative wallet except customer penalty debt.

---

## Wave 1 (parallel): A1 identity, A2 money, A3 realtime, A4 catalog, M0 mobile foundation, P0 panel foundation

### Lane A1 — Identity, sessions, files (`a1`, Redis 2)

**Owns:** `apps/api/src/modules/{auth,users,files}/**`, `apps/api/test/a1/**`, `packages/i18n/locales/*/server/auth.json` (optional; `server/core.json` already holds the OTP message).
**Endpoints:** `api.auth.*` (otpRequest, otpVerify, refresh, logout, adminLogin, realtimeTicket), `api.me.*` (get, update, registerDevice, deleteAccount),
`api.files.*` (upload, download). Plus non-contract routes `GET/POST /webhooks/whatsapp` (plain `@Get('webhooks/whatsapp')`, global prefix applies).

**OTP request** (`POST /auth/otp/request`): `normalizeAzMobile(phone)` else `PHONE_INVALID`. Limits: 60 s resend cooldown per phone → `OTP_COOLDOWN` with
`details.retryAfterSec`; max 5 codes per phone per hour and 20 per IP per hour → `RATE_LIMITED`. Code = 6 random digits (`crypto.randomInt`); if the phone is in
`OTP_BYPASS_PHONES` and `OTP_BYPASS_CODE` is set, use that code and do not send. Store `HMAC-SHA256(JWT_SECRET, challengeId:code)` in `OtpChallenge`
(expires +5 min, `app`, `locale`, `ip`, `channel`). Deliver through an `OtpChannel` port: `console` (log masked phone + code), `whatsapp_cloud`
(POST `https://graph.facebook.com/{WHATSAPP_GRAPH_VERSION}/{WHATSAPP_PHONE_NUMBER_ID}/messages`, Bearer `WHATSAPP_TOKEN`, authentication template
`WHATSAPP_TEMPLATE`, language az/ru/en, body parameter = code and URL button parameter = code), `webhook` (POST JSON `{phone, code, locale, expiresAt, app}` to
`OTP_WEBHOOK_URL` with header `X-TezFiks-Signature: sha256=<hex HMAC of raw body with OTP_WEBHOOK_SECRET>`; this is the founder's own WhatsApp bot). Delivery failure:
delete the challenge and throw `INTERNAL` with `details.reason='OTP_DELIVERY_FAILED'`. Response includes `devCode` only when `OTP_DEV_ECHO=true`.
The channel implementation must be injectable/mocked in tests (provider token).
**OTP verify:** unknown/consumed challenge → `OTP_INVALID`; expired → `OTP_EXPIRED`; 5 failed attempts → `OTP_TOO_MANY_ATTEMPTS` (the 6th try is refused even if correct);
wrong code → increment attempts, `OTP_INVALID` with `details.attemptsLeft`. Success: mark consumed; find user by phone or create (locale from the challenge);
`BLOCKED` → `USER_BLOCKED`. Create a session (`SessionsService.createUserSession(userId, app, {deviceId, ip, userAgent})`). Return `{ tokens, me, isNewUser }`.
**MeService** (export): `getMe(userId): Promise<Me>` (customer brief, handyman brief, ACTIVE memberships with company status; `photo` as FileRef; `profileComplete` = both names set).
**Refresh:** `SessionsService.rotate`. **Logout:** revoke the caller's session; if `refreshToken` given, also revoke that session if it belongs to the caller.
**Admin login:** email lower-cased, `verifyPassword` (`src/common/auth/password.ts`), inactive admin → `INVALID_CREDENTIALS`; limit 10 attempts per IP+email per 15 min → `RATE_LIMITED`;
update `lastLoginAt`; audit `admin.login`. **Realtime ticket:** `TokenService.issueRealtimeTicket(principal)`.
**me.update:** names, locale, `photoFileId` (must be the caller's `PROFILE_PHOTO`, else `FILE_NOT_OWNED`; null removes). **registerDevice:** upsert by (userId, deviceId, app).
**deleteAccount:** refuse with `INVALID_STATE` if the user has an assignment in ACCEPTED/EN_ROUTE/ARRIVED/PRICE_PROPOSED/PRICE_DISPUTED (as customer or handyman) or an
open request; otherwise set phone to `deleted:<userId>`, names null, photo null, status DELETED, deletedAt; revoke all sessions; delete devices; set handyman offline;
set `purgeAfter = now` on the user's files. The phone can register again as a new user.
**Files:** `StorageDriver` port (`put(key, buf, contentType)`, `get(key)`, `delete(key)`) with `local` (STORAGE_LOCAL_DIR) and `s3` (install `@aws-sdk/client-s3`,
forcePathStyle, S3_* env) implementations. Upload: multer memory storage (`FileInterceptor('file')`), 8 MB limit → `FILE_TOO_LARGE`; only jpeg/png/webp/heic/heif →
`FILE_TYPE_NOT_ALLOWED`; parse `kind` with `UploadFileFieldsSchema`; sharp `.rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 })`
(strips EXIF); key `<kind>/<yyyy>/<mm>/<uuid>.jpg`; `File` row with sha256, width, height. Rate limit 60 uploads per user per hour.
**FilesService** (export): `ref(file: File | string, opts?: { adminId?: string }): Promise<FileRef>` (signed URL `${env.publicApiUrl}/files/<id>?exp=<unix>&sig=<sig>`,
TTL `FILE_URL_TTL_SEC`), `refs(ids: string[], opts?)` (keeps order, skips missing), `assertOwned(userId, fileIds, kinds?)` (throws `FILE_NOT_OWNED`),
`read(fileId): Promise<{ buffer, contentType }>`, `markPurge(fileIds, at)`; daily purge job deleting objects past `purgeAfter`.
KYC kinds (`isKycFileKind`) are only signed for admins: `sig = <adminId>.<hmac(id:exp:adminId)>`; a non-admin signature for a KYC file → `FORBIDDEN`;
every KYC download writes `KycAccessLog`. Download: bad/tampered signature or expired → `FORBIDDEN`; headers `Content-Type`, `X-Content-Type-Options: nosniff`,
`Cache-Control: private, max-age=300` (KYC: `private, no-store`).
**WhatsApp webhook:** GET verification (`hub.mode=subscribe`, `hub.verify_token == WHATSAPP_VERIFY_TOKEN` → echo `hub.challenge`, else 403); POST verifies
`X-Hub-Signature-256` against `req.rawBody` with `WHATSAPP_APP_SECRET` (403 on mismatch), logs statuses, returns 200.
**Tests (at least):** OTP happy path (new and returning user, `isNewUser`), bypass phones, invalid phone, cooldown, hourly limits, wrong code + attemptsLeft, 5-attempt lockout,
expiry via clock, blocked user, consumed challenge reuse, webhook channel signs the body (mock fetch), refresh rotation + reuse revocation over HTTP, logout,
admin login ok / wrong password / inactive / rate limit, realtime ticket single use, me get/update (az names with ə/ı round-trip), photo ownership, device upsert,
delete account (phone reusable, tokens dead, refused with an active job), upload (generate a PNG with sharp), wrong type/size, signed URL download + tampered + expired,
KYC file admin-only + access log, WhatsApp webhook verify/signature. The foundation tests `test/health.e2e.spec.ts` and `test/common.spec.ts` call `GET /me`; they must pass once you are done.

### Lane A2 — Wallets, payments, payouts (`a2`, Redis 3)

**Owns:** `apps/api/src/modules/{wallet,payments,payouts}/**`, `apps/api/test/a2/**`, `packages/i18n/locales/*/server/payments.json`.
**Endpoints:** `api.wallet.*`, `api.payments.*` (get, checkoutPage, checkoutSubmit), `api.pro.earnings`, `api.pro.getPayoutMethod`, `api.pro.setPayoutMethod`,
`api.company.{wallet, walletTransactions, topup, earnings, getPayoutMethod, setPayoutMethod}`, `api.admin.{adjustWallet, ledger, payments, payouts, runPayouts, markPayoutPaid, markPayoutFailed}`.

**Wallet resolution (self):** `owner` query/body, else by session app: CUSTOMER/PANEL → the caller's customer account wallet (`CUSTOMER_ACCOUNT_REQUIRED` if none);
PRO → the caller's SOLO handyman wallet (company worker → `FORBIDDEN`, no profile → `NOT_FOUND`). Company endpoints: caller must be an ACTIVE MANAGER of
the company (`NOT_COMPANY_MANAGER`; unknown company → `NOT_FOUND`) — check `CompanyMember` directly.
**PaymentsService** (export): `createIntent({ purpose, amount, payerUserId, creditAccountId, assignmentId?, invoiceId?, companyId?, returnUrl? }, db?) → { intent, checkoutUrl }`
— `creditAccountId` is stored in `PaymentIntent.walletAccountId` and is the ledger account credited on success (wallet for top-ups, provider EARNINGS for job payments,
tips and invoices). `settle(intentId, 'SUCCEEDED' | 'FAILED' | 'CANCELLED', reason?)`: idempotent; SUCCEEDED posts EXTERNAL → creditAccount with kind TOPUP / JOB_PAYMENT / TIP /
INVOICE_PAYMENT (idempotency `payment:<intentId>`), then emits `payment.succeeded` (after commit); FAILED emits `payment.failed`. Emit `payment:updated` to the payer and
`wallet:updated` for wallet top-ups. A `PaymentProvider` port with the `fake` provider (future Payriff/Epoint plug in here).
**Checkout URL:** `${env.publicApiUrl}/pay/checkout/<id>?t=<HMAC(id)>`. **Checkout page (GET)**: verify `t` (else 403 HTML); CREATED → HTML form (TEST MODE banner, amount
formatted with `formatMoney`, purpose label, card number / MM/YY / CVC / name, Pay and Cancel buttons; az/ru/en by Accept-Language; inline CSS with brand colours #00A971,
#0B1B2B, Inter/system font; mobile friendly); already settled → result page. **Submit (POST, urlencoded `t`, `card`, `action`)**: `4242 4242 4242 4242` → SUCCEEDED,
`4000 0000 0000 0002` → FAILED `card_declined`, any other number → FAILED `unsupported_test_card`, `action=cancel` → CANCELLED. Then 303 redirect to `returnUrl` with
`paymentIntentId` and `status` query params appended, or a result page when there is no returnUrl. Allowed return URLs: schemes `APP_SCHEME_CUSTOMER://`, `APP_SCHEME_PRO://`,
`exp://`, `exp+tezfiks://`, `exp+tezfiks-usta://`, and http(s) URLs whose origin is PUBLIC_BASE_URL or in CORS_ORIGINS; anything else is dropped (no open redirect).
**payments.get:** payer, a manager of `intent.companyId`, or any admin; others `NOT_FOUND`.
**Top-up:** 1–1000 AZN (contract), creates WALLET_TOPUP intent. **WalletEventsService** (export): `notifyAccount(accountId)` resolves the owner (customer account owner,
solo handyman user, company → company room) and emits `wallet:updated`. Other lanes call it after fee postings.
**Earnings** (`EarningsView`): EARNINGS posted balance; pending payouts; last 20 payouts; this Baku week's completed assignments split by payment method (card jobs/total,
cash jobs/total) and tips; payout method. **Payout method:** card = Luhn-valid 16–19 digits → `maskedNumber` "•••• 4242"; IBAN = `^AZ\d{2}[A-Z]{4}[A-Z0-9]{20}$` →
"AZ21 •••• 1234"; otherwise `VALIDATION_FAILED`. Store only the masked form.
**Payouts:** BullMQ repeat `payouts.weekly` cron `0 9 * * 1` (Asia/Baku) + `admin.runPayouts`: for each HANDYMAN/COMPANY EARNINGS account with posted > 0 create a
PENDING Payout (idempotency `payout:<ownerType>:<ownerId>:<isoWeekKey>`, skip if it exists), post PAYOUT_CREATED earnings → PAYOUTS_IN_TRANSIT, snapshot the payout method,
period = previous Baku week. `markPayoutPaid` (PENDING only): PAYOUTS_IN_TRANSIT → EXTERNAL, PAID; `markPayoutFailed`: back to EARNINGS, FAILED with reason. Notifications for payouts are added later
by the integration wave (leave a clearly named hook method `onPayoutPaid`).
**Admin:** `adjustWallet` posts ADMIN_ADJUSTMENT between ADJUSTMENTS and the target account (negative amounts may not overdraw a non-negative account → `INSUFFICIENT_BALANCE`),
audit `wallet.adjust`; returns the new WalletSummary. `ledger` lists transactions with entries (ownerName: customer/handyman = user full name, company = company name,
platform = `TezFiks: <KIND>`), filters kind/ownerType/ownerId. `payments`, `payouts` lists with payer/owner names.
Nightly reconciler task `ledger.integrity`: logs mismatches from `verifyIntegrity()`.
**Tests:** wallet by app and owner, debt flag, transactions paging; top-up end-to-end through the HTML page (GET then POST form, follow redirect, balance credited once even if
submitted twice); declined card; cancel; tampered `t`; open-redirect protection; payments.get authorization; company wallet manager-only; earnings numbers; payout method validation
and masking; weekly payout idempotency per week, paid/failed flows with balances; adjustWallet + audit row; ledger listing names; `globalSum()==0` and `verifyIntegrity()==[]` at the end of money tests.

### Lane A3 — Realtime gateway, presence, notifications, push (`a3`, Redis 4)

**Owns:** `apps/api/src/modules/{realtime,notifications}/**`, `apps/api/test/a3/**`, `packages/i18n/locales/*/server/notifications.json`.
**Endpoints:** `api.notifications.*`. **Gateway** (`@WebSocketGateway({ path: process.env.SOCKET_PATH ?? DEFAULT_SOCKET_PATH, cors: { origin: true }, transports: ['websocket', 'polling'] })`):
in `afterInit(server)` call `realtime.attach(server)` and install `server.use` auth middleware: `handshake.auth.token` (JWT access token, verified with `TokenService` + `SessionsService.validate`)
or `handshake.auth.ticket` (`TokenService.consumeRealtimeTicket`, single use). Reject with an Error whose message is `UNAUTHORIZED`. On connect join `user:<userId>`,
`company:<id>` for every ACTIVE MANAGER membership, `admins` for admins. Events: `room:join`/`room:leave` (request → its customer or admin; assignment → its customer, its handyman,
managers of its company, or admin; company → active manager or admin; ack `{ok:true}` / `{ok:false, error:'FORBIDDEN'}`), `pro:location` (caller must have a handyman profile;
`PresenceService.updateLocation`), `pro:heartbeat` (`touch`).
**PresenceService** (export): Redis ZSET per res-7 cell `pres:7:<cell>` (member handymanId, score last-seen ms) and hash `hm:<handymanId>` (lat, lng, cell7, cell9, busy, companyId, userId, ts; TTL 120 s),
keys via `RedisService.key()`. Methods: `setOnline(handymanId, loc?: LatLng)`, `setOffline(handymanId)`, `updateLocation(handymanId, loc: {lat,lng,heading?,speed?,accuracy?,at?,assignmentId?})`,
`touch(handymanId)`, `setBusy(handymanId, busy)`, `get(handymanId)`, `candidatesInCells(cells: string[], freshWithinSec: number): Promise<PresenceEntry[]>` (skips stale entries; PresenceEntry = `{handymanId, userId, companyId, lat, lng, busy, ts}`),
`onLocation(handler: (e: LocationEvent) => Promise<void>)` (handlers run after each location update; lane B3 registers the ETA updater),
DB snapshot reconciler task (every tick: write `lastLat/lastLng/lastCell7/lastSeenAt` from Redis to `HandymanProfile`; set `isOnline=false` when unseen for 30 min).
Presence freshness and timestamps use `Clock` (tests move the clock).
**NotificationsService** (export): `notify(userId, type: NotificationType, opts: { vars?: Record<string,string|number>, data?: Record<string, unknown>, app?: 'CUSTOMER'|'PRO'|'PANEL', push?: boolean (default true), priority?: 'high'|'normal', ttlSec?: number, collapseKey?: string, channelId?: 'offers_v1'|'default_v1' })`
→ creates the `Notification` row with title/body translated into the user's locale from `server.notifications.<TYPE>.title|body` with `vars`, emits `notification:new`,
and pushes to the user's devices (filtered by `app` when given). `notifyMany(userIds, ...)`. `notifications.json` must define title + body for EVERY `NotificationType` in az, ru, en;
document the expected `vars` per type in `apps/api/src/modules/notifications/README.md` (later lanes rely on it). Keep vars generic: `number` (request number), `category`, `name`,
`amount` (pre-formatted money string), `minutes`, `distance`, `company`, `reason`, `date`.
**PushService** with senders `log` (records sends in memory + logs; tests inspect it), `expo` (`expo-server-sdk`, Device.pushProvider EXPO), `fcm` (`firebase-admin`,
`FCM_SERVICE_ACCOUNT` path or inline JSON; data messages with android priority high/normal, ttl ms, collapseKey, channel). Payload: `{ type, title, body, data }` (ids and amounts only).
Remove device tokens reported unregistered (`DeviceNotRegistered` / `messaging/registration-token-not-registered`). Push must never throw into callers.
**Tests:** socket connect with token (receives `toUser` emits), bad token rejected, ticket single use, manager joins company room, room:join authorization (customer vs stranger vs admin),
pro:location updates presence and calls registered handlers, presence freshness and cells, setBusy, snapshot task, notify (row + localized title per user locale + socket event + log push to the
right app's devices), notifyMany, list/unreadCount/markRead (ids and all, other user's ids ignored), invalid token cleanup with a mocked sender. Use `socket.io-client` against `t.origin`
with `path: '/tezfix/api/socket.io'`.

### Lane A4 — Categories, geo, AI (`a4`, Redis 5)

**Owns:** `apps/api/src/modules/{categories,geo,ai}/**`, `apps/api/test/a4/**`, `packages/i18n/locales/*/server/catalog.json` (if needed).
**Endpoints:** `api.categories.list`, `api.adminCategories.*`, `api.geo.*` (reverse, autocomplete, place). (The classify-photo ENDPOINT belongs to B1; you build the classifier service.)
**Categories:** list returns active categories (groups + services), `name` by Accept-Language, `names`, keywords; optional `vertical` filter. Admin list includes inactive; create/update
validate: SERVICE needs an active GROUP parent of the same vertical, GROUP has no parent, slug unique → `CONFLICT`; audit `category.create|update`.
**CategoriesService** (export): `get(id)`, `getBySlug(slug)`, `requireInstantService(id)` (missing → `NOT_FOUND`, inactive → `CATEGORY_INACTIVE`, GROUP → `VALIDATION_FAILED`,
flow QUOTE → `CATEGORY_REQUIRES_QUOTE`), `requireQuoteService(id)` (flow INSTANT → `CATEGORY_NOT_INSTANT`), `ref(category, locale): CategoryRef`, `refs(ids, locale)`,
`name(category, locale)`, `activeServices(vertical?)`.
**GeoService** (export): `reverse(lat, lng, locale)` (Google Geocoding with `GOOGLE_MAPS_SERVER_KEY` and `language`; on missing key or error: `formatted = "40.37770, 49.85310"`, district from
the nearest Baku district centroid table you include for the 12 raions with az/ru/en names, `source:'fallback'`), `autocomplete(q, sessionToken, bias?, locale)` (Places API New
`places:autocomplete` with `includedRegionCodes:['az']`, location bias circle 30 km; fallback returns `{items:[], source:'fallback'}`), `place(placeId, sessionToken, locale)` (Place Details New,
field mask `id,location,formattedAddress,addressComponents`), `route(origin, destination, { trafficAware })` → `{ polyline, durationSec, distanceM, source, computedAt }` (Routes API computeRoutes,
field mask `routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline`; fallback = straight polyline via `encodePolyline` + `fallbackRoute()`),
`progressAlong(polyline, current: LatLng, totalDurationSec)` → `{ remainingDistanceM, remainingSec, offRouteM }` (snap to the closest segment; remaining time scaled by remaining distance),
H3 helpers `cell7(lat,lng)`, `cell9(lat,lng)`. All HTTP via an injectable fetch (provider token) with a 5 s timeout. Rate limit geo endpoints 60 per user per minute.
**AiService** (export): `classify({ userId, fileId, image: Buffer, note?, vertical?, locale }): Promise<ClassifyPhotoResponse>`. **Load the `claude-api` skill with the Skill tool before writing
Anthropic code**, and follow it. Model `ANTHROPIC_MODEL` (default `claude-haiku-5-5`), `@anthropic-ai/sdk` 1.3.0 (already installed), server-side only; image re-encoded with sharp to
1280 px JPEG q80; system prompt (cached) lists active SERVICE categories (slug + az/ru/en names + keywords) with decision rules; structured output: `category` (enum of slugs + `other` + `unsure`),
`confidence` (high/medium/low), `candidates` (≤3 slugs). Mapping: high/medium with a known slug → `status:'ok'`; low/unsure/other → `status:'unsure'` with candidates;
no key, timeout (10 s, 1 retry), refusal, parse failure or API error → `status:'unavailable'`. Log every call in `AiClassification` (model, slug, confidence, candidates, latency, tokens, error).
The Anthropic client must be injectable so tests use a fake. KYC images must never be sent (refuse KYC file kinds).
**Tests:** categories localized names (az/ru/en), vertical filter, inactive hidden, admin CRUD rules + audit + non-admin forbidden; geo fallbacks without key; Google paths with a mocked fetch
(request URL/headers/field masks, language); route fallback math; progressAlong on a known polyline; AI: unavailable without key, ok/unsure mapping, candidates, refusal/timeout → unavailable,
logging row, request shape sent to the fake client (model id, image block, cache_control, output format).

### Lane M0 — Mobile foundation (`m0`)

**Owns:** `packages/mobile/**`, `apps/customer/**`, `apps/pro/**`, `packages/i18n/locales/*/{customer,pro}.json` (bootstrap keys; M1–M4 extend them later). Mobile UI keys shared by both apps go under a `mobile` section of `customer.json`/`pro.json` as needed, or ask nothing: put shared auth-screen keys into BOTH files.
Build two Expo SDK 58 apps in the npm workspace (React **19.3.0** is pinned by root `overrides`; use `npx expo install` to align every Expo/RN dependency with SDK 58):
- **apps/customer** "TezFiks": package `az.tezfiks.app`, scheme `tezfiks`. **apps/pro** "TezFiks Usta": package `az.tezfiks.usta`, scheme `tezfiksusta`.
- `app.config.ts` per app: expo-router; `extra.apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000/tezfix/api'` (Android emulator → host);
  `android.config.googleMaps.apiKey` from `GOOGLE_MAPS_ANDROID_KEY` (optional); plugins: expo-router, expo-location (foreground service enabled, background location DISABLED —
  no `ACCESS_BACKGROUND_LOCATION`), expo-camera (no audio), expo-image-picker, expo-notifications (channels `offers_v1`, `default_v1`), react-native-maps,
  expo-build-properties (Android targetSdk 36, minSdk 24), expo-font. Cleartext HTTP allowed for the dev API (http://10.0.2.2).
- **packages/mobile** (TypeScript source, `main: src/index.ts`, consumed by Metro; no build step): design tokens from `design/01-brand-colors-typography.png`
  (primary #00A971, dark #0B1B2B, accent #F59E0B, background #F6F8FA, danger #E5484D; Inter Bold/SemiBold/Regular via `@expo-google-fonts/inter`), UI kit
  (Screen, Header, Button variants, Card, TextField, PhoneInput (+994 chip, `formatPhoneAsYouType`), OtpInput (6 boxes, paste), Badge/StatusPill, Avatar (initials fallback),
  Stars, Money (uses `formatMoney`), Countdown (server-clock corrected), Timeline (board 03 "Aktiv sifariş"), Keypad (board 03 "İşi tamamla"), Segmented, ListItem, EmptyState,
  ErrorState with retry, Toast/snackbar, BottomSheet-style modal, MapView wrapper (react-native-maps; when no Google key at build time render `mapType="none"` + OpenStreetMap `UrlTile` so maps work in the
  emulator without a key) with marker/polyline/hexagon overlays (hexagons from H3 cells via `h3-js` `cellToBoundary`)),
  API layer (`createApiClient` from `@tezfiks/shared` with base URL from config; zustand auth store; refresh token in `expo-secure-store`; access token in memory; `refreshAccessToken` via
  `api.auth.refresh`; logout on auth failure), TanStack Query provider with `onlineManager` (expo-network) and `focusManager` (AppState), Socket.IO client hook (`useSocket`) with
  `path` = `new URL(apiUrl).pathname + '/socket.io'`, transports `['websocket']`, `auth: { token }`, reconnect on AppState active, typed events (`ServerToClientEvents`), and a
  `useSocketEvent(event, handler)` hook; i18n init (i18next + react-i18next + `intl-pluralrules` imported first + `@tezfiks/i18n` resources; language picker persisted in SecureStore;
  default from `expo-localization`, fallback az; set `Accept-Language` on API calls); permissions helpers (location foreground, notifications, camera); push registration
  (`expo-notifications` device token → `api.me.registerDevice`; failures are non-fatal (no Firebase config in dev)); deep-link helper; error-to-message mapper (`common.errors.<code>`).
- **Shared auth flow screens** (in packages/mobile, used by both apps; board 02 A1–A2): Welcome/phone entry ("Telefon nömrəsi ilə daxil olun", +994 chip, Davam et) → OTP (6 digits,
  resend timer, "Kodu yenidən göndər", auto-submit; in dev show the `devCode` as a hint banner) → Profile (first/last name, optional photo) when `profileComplete` is false.
  After login the customer app goes to account type (A3) if `me.customer` is null; the pro app goes to "Usta kimi qoşulun".
- Navigation skeletons with expo-router: customer tabs **Əsas, Sifarişlər, Pul kisəsi, Profil**; pro tabs **Əsas, Sifarişlər, Balans, Profil**; simple placeholder screens that later lanes replace.
- Tests: Jest (`jest-expo` preset) unit tests for the auth store (refresh, logout), API wiring (mock fetch), formatting helpers, OtpInput, PhoneInput, Countdown math. `npx tsc --noEmit` clean for both apps.
- Build verification: `npx expo export --platform android` succeeds for both apps. Then `npx expo prebuild --platform android --clean` for **apps/customer** and run
  `./gradlew assembleDebug` in `apps/customer/android` (JDK 17 is installed; Android SDK at `%LOCALAPPDATA%\Android\Sdk`, set `ANDROID_HOME`; platforms 35/36/37, build-tools 36/37 and NDK 27.1
  are installed) to prove the native toolchain works; fix config until it builds. Report the APK path. `android/` and `ios/` are gitignored (CNG). Only one Gradle build at a time on this machine.
- Do not implement feature screens beyond auth and skeletons (lanes M1–M4 do that).

### Lane P0 — Web panel foundation (`p0`)

**Owns:** `apps/panel/**`, `packages/i18n/locales/*/panel.json`.
Next.js **16.4.3** App Router, React 19.3.0, TypeScript strict, Tailwind **4.3.3**, shadcn/ui (Base UI primitives) components copied into `src/components/ui`, `next-intl` 4.14.9 (no locale in URL;
`locale` cookie; az default; `timeZone: 'Asia/Baku'`), `@tanstack/react-table` 9.3.1, `react-hook-form` 7.91.0 + `@hookform/resolvers` 6.0.0 + zod 4, `@tanstack/react-query` 5.104.5 (client lists),
`socket.io-client` 4.8.4, `@vis.gl/react-google-maps` 1.10.1 (fallback to an OpenStreetMap-tile map — e.g. `leaflet` + `react-leaflet` — when `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` is missing),
`lucide-react` icons. `next.config.ts`: `basePath: '/tezfix'`, `output: 'standalone'`, `images.unoptimized: true`, `transpilePackages: ['@tezfiks/shared', '@tezfiks/i18n']`, no cacheComponents.
**Routes:** `/admin/login` (email + password → `api.auth.adminLogin`), `/admin/*` shell (dark sidebar per `design/05-admin-panel.png`: Dashboard, Sifarişlər, Ustalar, Şirkətlər, Müştərilər, Ödənişlər,
Müraciətlər, Layihələr, Kateqoriyalar, Xəritə, Tənzimləmələr, Audit, Demo), `/company/login` (phone + OTP via `api.auth.otpRequest/otpVerify` with app `PANEL`; then choose a managed company
from `me.companies` where role MANAGER), `/company/[companyId]/*` shell (Dashboard, Dispatch, Sifarişlər, Ustalar, Balans, Layihələr, Tənzimləmələr), `/join/[token]` (public invite preview via
`api.invites.preview` with "open the TezFiks Usta app" deep link `tezfiksusta://join/<token>` and a Play Store placeholder). Placeholder pages for every nav item (P1/P2 fill them).
**Auth (BFF):** Server Actions call the API server-to-server at `API_INTERNAL_URL` (default `http://127.0.0.1:3000/tezfix/api`) with the shared `createApiClient`; tokens in httpOnly cookies
`tf_at` / `tf_rt` (+ `tf_kind` = admin|company), `path: '/tezfix'`, `SameSite=Lax`, `Secure` in production; silent refresh in `proxy.ts` (Next 16 name of middleware; check the Next 16 docs in
`node_modules/next/dist/docs` or the web if unsure) when the access cookie is missing/expired and a refresh cookie exists; server-only `getSession()`/`requireAdmin()`/`requireManager(companyId)` helpers
used in pages and actions; logout action. Realtime: route handler `/api/realtime-ticket` returns a ticket (`api.auth.realtimeTicket`) for the browser socket (`NEXT_PUBLIC_SOCKET_URL`, path
`/tezfix/api/socket.io`, `auth: { ticket }`). Browser never sees access/refresh tokens.
**UI kit:** DataTable (TanStack v9, server pagination via `nextCursor`), StatCard (board 05 KPIs), StatusBadge (all statuses with `common.*` labels and colours), Money, DateTime (Baku),
PageHeader, ConfirmDialog, FormField wrappers, EmptyState, ErrorState, Toaster, Tabs, Drawer/Sheet, language switcher (az/ru/en) in the header.
**Tests:** Vitest unit tests for cookie/session helpers, money/date rendering, StatusBadge mapping; `npm run build -w @tezfiks/panel` must succeed; a smoke script that starts `next start`
on port 3100 and fetches `/tezfix/admin/login` (200).

---

## Wave 2 (parallel): B1 requests & dispatch, B2 providers & verification, M1 customer core, M2 pro core, P1 admin panel

### Lane B1 — Customer account, requests, dispatch engine, offers (`b1`, Redis 6)

**Owns:** `apps/api/src/modules/{customer,requests}/**` (put the dispatch engine in `src/modules/requests/dispatch/`), `apps/api/test/b1/**`, `packages/i18n/locales/*/server/requests.json`.
**Endpoints:** `api.customer.*`; `api.requests.*` (classifyPhoto, create, list, get, cancel); `api.pro.{offers, scheduledOffers, acceptOffer, declineOffer, seenOffer}`;
`api.company.{offers, acceptOffer, declineOffer}`.
**Customer account:** upsert creates the `CustomerAccount` + WALLET ledger account on first call; COMPANY needs companyName + voen; switching type keeps the wallet. Addresses CRUD (soft delete),
cell7/cell9 computed. `CustomerService` (export) `requireAccount(userId)` → `CUSTOMER_ACCOUNT_REQUIRED`.
**Create request** (spec §4, §5): requires customer account; `CUSTOMER_IN_DEBT` if wallet posted < 0; `CategoriesService.requireInstantService`; photos via `FilesService.assertOwned(userId, ids, ['REQUEST_PHOTO'])`
(≤ settings.maxPhotos); slots ≤ settings.maxSlots; INDIVIDUAL customers are forced to `providerPreference: 'ANY'`; EMERGENCY requires `category.emergencyAllowed` (`EMERGENCY_NOT_ALLOWED`) and holds
`emergencyFeePerSlot` per slot on the customer wallet (one Hold per slot, `slotId` set; `INSUFFICIENT_BALANCE` when short — nothing is created then); SCHEDULED requires
`scheduledAt` ≥ now + scheduledMinLeadMin (`SCHEDULE_TOO_SOON`) and ≤ now + scheduledMaxLeadDays (`SCHEDULE_TOO_FAR`). Address snapshot + cell7/cell9; optional address-book save. Create slots. Start dispatch.
**Dispatch engine** (H3 res 7; spec §5 exactly; use `ringPlan`, `RING_FAST_FORWARD_SEC` from shared): each step offers only the new ring (`gridRing`, step 0 = center cell; emergency step 0 = k≤1 disk;
wide step = ring 5 + providers whose `HandymanServiceCell`/`CompanyServiceCell` covers the request cell), candidates from `PresenceService.candidatesInCells(cells, onlineStaleSec)` joined with DB eligibility:
solo — APPROVED, user ACTIVE, `kind SOLO`, has the category trade, not busy (no assignment in ACCEPTED/EN_ROUTE/ARRIVED), wallet available ≥ requestFee, distance (haversine from presence location) ≤ serviceRadiusKm,
preference ANY/INDIVIDUAL, never offered this request before; company — APPROVED company with the trade, wallet available ≥ requestFee, ≥1 fresh online free worker with the trade inside the disk,
preference ANY/COMPANY, never offered before. Sort by distance, cap `maxOffersPerStep`. Offer TTL `offerTtlSec`; `distanceM`, `candidateWorkers` (company). Notify: `offer:new` socket (user or company room),
`NotificationsService.notify(..., 'OFFER_NEW', { app:'PRO', priority:'high', ttlSec, collapseKey:'offer', channelId:'offers_v1', data:{offerId, requestId, expiresAt} })` (company: all managers);
`request:search` to the request room and the customer's user room with the covered cells. Fast-forward when fewer than `minCandidates` were offered so far (floor `RING_FAST_FORWARD_SEC`).
Jobs: `dispatch.step` (jobId `dispatch-step-<requestId>`), `offer.expire` (`offer-expire-<offerId>` → EXPIRED + `offer:closed`), `dispatch.end` at `searchEndsAt` (`noMatchAfterSec`): close SENT offers
(SEARCH_ENDED), OPEN slots → UNFILLED, release their emergency holds, request EXPIRED when nothing filled (else `isSearching=false`), notify REQUEST_EXPIRED / SCHEDULED_UNFILLED.
Reconciler task repairs overdue offers/steps/ends. Guarantee re-fix requests (`isGuaranteeFix` with `preferredHandymanId`/`preferredCompanyId`): first a single offer to the preferred provider for
`guaranteeOriginalProviderMin`, then normal rings; no fees at all.
**Scheduled** (spec §5): at creation offer (long TTL until `liveDispatchAt = scheduledAt − scheduledLiveDispatchLeadMin`) to eligible providers whose service area covers the cell and who have no accepted job within ±2 h
(no presence requirement); they appear in `pro.scheduledOffers` / company offers. Job `dispatch.scheduledLive` at liveDispatchAt runs live rings for open slots; job `dispatch.scheduledUnfilled` at
`scheduledAt − scheduledUnfilledLeadMin` ends the search. Reminder jobs at T−24 h and T−1 h → `SCHEDULED_REMINDER` to customer and providers (skip if in the past).
**Accept (solo)** — one transaction: lock offer (SENT, not expired → else `OFFER_EXPIRED`/`OFFER_UNAVAILABLE`), lock an OPEN slot `FOR UPDATE SKIP LOCKED` (none → `OFFER_UNAVAILABLE`),
`ledger.hold(handyman wallet, requestFee, REQUEST_FEE)` (`INSUFFICIENT_BALANCE`; skipped for guarantee fixes), create the Assignment (`freeCancelUntil = now + freeCancelSec`, `feeAmount`,
`feeHoldId`, `isGuaranteeFix`), slot FILLED + `currentAssignmentId`, offer ACCEPTED; when no OPEN slot remains → request ASSIGNED, close remaining SENT offers (TAKEN, `offer:closed`), stop the search;
otherwise keep searching. After commit: `PresenceService.setBusy`, notify customer REQUEST_ASSIGNED, `request:updated`, schedule `assignment.feeWindowClose` at freeCancelUntil.
The provider must still be eligible (approved, not busy, has trade) at accept time → `NOT_ELIGIBLE`. **Company accept** (`workerIds` 1..open slots): caller ACTIVE MANAGER (`NOT_COMPANY_MANAGER`),
company APPROVED, each worker an ACTIVE member with the trade, APPROVED, not busy (`WORKER_UNAVAILABLE`), one hold per worker on the COMPANY wallet, one assignment per worker (providerType COMPANY,
`acceptedByUserId` = manager); notify each worker `WORKER_ASSIGNED` (PRO app). Decline → DECLINED; seen → `seenAt`.
**Fee window close** job `assignment.feeWindowClose`: if the assignment's fee hold is still ACTIVE and the assignment is not cancelled-free → capture to REVENUE (REQUEST_FEE_CAPTURE, `fee-capture:<assignmentId>`),
mark `feeCaptured`; capture the slot's emergency hold (EMERGENCY_FEE_CAPTURE, `emergency-capture:<slotId>`); `WalletEventsService.notifyAccount`. Export `FeesService.captureForAssignment(assignmentId, tx?)` (also used at completion).
**CancellationService** (export, used by B3): `apply(assignmentId, { actor: 'CUSTOMER'|'PROVIDER'|'ADMIN', kind: 'CANCEL'|'DECLINE_ON_ARRIVAL'|'NO_SHOW', reason?, byUserId?, chargeCustomer? }, tx?)` implements
`cancellationOutcome()` from shared with ledger effects: RELEASE_HOLD (release fee hold), REFUND (REQUEST_FEE_REFUND revenue → provider wallet, `fee-refund:<assignmentId>`), KEEP; emergency RELEASE (release
or, if captured, EMERGENCY_FEE_REFUND); customer penalty CANCEL_PENALTY customer wallet → REVENUE with `allowOverdraft` (debt allowed), compensation PENALTY_COMPENSATION PROMO → provider wallet;
strike (StrikeEvent + counter on handyman or company); assignment status/endedAt/cancelledBy; slot back to OPEN + `DispatchService.reopenSlot` when `redispatch`, else slot CANCELLED; recompute request
status; presence not busy; notifications ASSIGNMENT_CANCELLED to the other side; `assignment:updated`. ADMIN actor: no fees kept, no penalty, no strike (force-cancel: release/refund the provider fee) unless `chargeCustomer`.
**DispatchService** (export): `start(requestId)`, `reopenSlot(slotId)` (restart rings from step 0 for that request if not searching; the previous provider is never re-offered), `stop(requestId, reason)`.
Expose `createGuaranteeFixRequest(originAssignmentId)` for B3 (same category/address, `preferredHandymanId`/`preferredCompanyId`, fee-free).
**RequestStateService** (export): `recompute(requestId, tx?)` per spec §6.1.
**Request cancel** (whole request): only the owner; SEARCHING without assignments → CANCELLED, close offers (CANCELLED), release all emergency holds, stop search; with active assignments → apply
`CancellationService` (actor CUSTOMER) to each active one (penalties per assignment), cancel open slots. Already terminal → `INVALID_STATE`. Response RequestDetail.
**Views** (export, B3 reuses them): `src/modules/requests/views/` with `toRequestSummary`, `toRequestDetail`, `toCustomerAssignment` (provider public, ETA, live location, route, contact unlock via
`isContactWindowOpen`, phone only when unlocked, actions + penalties via `customerCancelPenaltyNow`/`cancellationOutcome`), `toProAssignment` (FULL vs WORKER_LIMITED per spec §4.4; manager views include worker phone;
`actions` per `PROVIDER_ACTIONS` and company `finalPriceEntry`), `toOfferView` (area-level address, coordinates rounded to 3 decimals, customer first name + initial, no phone).
**classifyPhoto:** owner's REQUEST_PHOTO (`FilesService.read`) → `AiService.classify`; rate limit 20/hour/user.
**Tests (at least):** account create/switch; addresses; create validation errors (each code), INDIVIDUAL preference forced, emergency holds per slot + insufficient balance creates nothing; scheduled bounds;
dispatch ring order and timing with manual jobs (provider in ring 2 is offered only after step 2; minCandidates fast-forward); eligibility filters (unapproved, busy, no trade, low balance, out of radius,
preference, offline/stale, already offered); company offers with candidateWorkers; offer expiry; search end → EXPIRED + emergency holds released; **two handymen accepting the last slot concurrently → exactly one wins,
one hold**; multi-slot request filled by solo + company; company accept validation; idempotent accept replay; fee capture at window close (and not after a free cancel); cancellation matrix through `CancellationService`
(free window either side, late provider + strike + redispatch, late customer 15 AZN with debt allowed and provider compensated, decline on arrival) with balances asserted; whole-request cancel;
scheduled pre-offers + live dispatch + unfilled; guarantee fix flow without fees; offer privacy (no phone/apartment in offer payloads or push data); `globalSum()==0`, `verifyIntegrity()==[]`.

### Lane B2 — Providers: onboarding, presence endpoints, KYC, companies, invites, admin review (`b2`, Redis 7)

**Owns:** `apps/api/src/modules/{pro,kyc,company,invites}/**`, `apps/api/test/b2/**`, `packages/i18n/locales/*/server/providers.json`.
**Endpoints:** `api.pro.{profile, onboardSolo, onboardCompany, updateProfile, setOnline, location, statsToday}`, `api.kyc.*`, `api.invites.*`,
`api.company.{get, dashboard, updateSettings, members, updateMember, removeMember, invites, createInvite, revokeInvite, workersLive}`,
`api.admin.{handymen, handyman, approveHandyman, rejectHandyman, blockHandyman, unblockHandyman, clearStrikes, companies, company, approveCompany, rejectCompany, blockCompany, unblockCompany, blockUser, unblockUser}`.
**Onboarding solo:** user must not already have a handyman profile (`ALREADY_HANDYMAN`) nor be an active company member (`ALREADY_IN_COMPANY`); sets user names/photo; profile DRAFT, trades (active SERVICE categories),
radius, base + baseCell7, service cells (`gridDisk(baseCell7, ceil(radius/2.44))`), WALLET + EARNINGS accounts. **Company:** VÖEN unique (`CONFLICT`), company DRAFT, WALLET + EARNINGS, owner MANAGER member,
trades, service cells; returns CompanyView. **profile:** `{ profile | null, managedCompanies }`. **updateProfile** recomputes service cells.
**setOnline:** only APPROVED (`HANDYMAN_NOT_APPROVED`), user ACTIVE; `PresenceService.setOnline/setOffline`, `isOnline`, `onlineSince`; warnings `LOW_BALANCE` (solo wallet available < requestFee),
`COMPANY_LOW_BALANCE` (worker's company), `NO_TRADES`. **location:** `PresenceService.updateLocation`. **statsToday:** Baku day: completed jobs, earnings (sum of totals of completed jobs), captured fees.
**KYC submit:** subject HANDYMAN (caller's profile in DRAFT/REJECTED; PENDING → `KYC_ALREADY_PENDING`; APPROVED → `INVALID_STATE`) or COMPANY (caller manages it); files owned with the right kinds
(`KYC_ID_FRONT`, `KYC_ID_BACK`, `KYC_SELFIE`, `KYC_SELFIE_TURN`, `KYC_SELFIE_BLINK`, `KYC_TRADE_PROOF`, `COMPANY_DOC`); max 3 submissions per 24 h (`KYC_RESUBMIT_LIMIT`); consent stored
(policy version, locale, sha256 of the consent text from `server.providers.consentText`, time, ip); profile/company → PENDING_REVIEW; notify admins (`admin:event`). **status** returns KycStatus with attemptsLeft24h.
**Admin review:** approve (PENDING_REVIEW only) → APPROVED, `approvedAt`, submission APPROVED + extracted fields + reviewer, files `purgeAfter = now + 30 days`, notify KYC_APPROVED / COMPANY_APPROVED,
`profile:updated` socket, domain event `handyman.status` / `company.status`; reject (reason) → REJECTED + KYC_REJECTED; block (any state, reason) → BLOCKED + offline + `ACCOUNT_BLOCKED`; unblock → APPROVED if previously
approved else DRAFT; clearStrikes → strikes 0 + `clearedAt`. Admin lists: tabs all/pending/blocked with counts, search `q` (tz_fold on names / phone digits / company name / VÖEN), `displayStatus`
(LOW_BALANCE = approved solo with wallet available < requestFee); details with KYC view (signed admin URLs via `FilesService.ref(file, { adminId })`), recent assignments, strikes, wallet. Every admin action audited.
**blockUser/unblockUser:** user BLOCKED + `SessionsService.revokeAllForUser` + offline + domain event `user.blocked`.
**Company:** get/dashboard (manager only), settings (finalPriceEntry, VAT, trades, radius, base → service cells), members (incl. workers' phones — the company employs them), updateMember (role/trades;
cannot demote the last manager → `INVALID_STATE`), removeMember (worker profile removed from company: `companyId=null`, kind stays COMPANY_WORKER, status DRAFT; cannot remove self if last manager),
invites (token = 24 random url-safe chars, url `${PUBLIC_BASE_URL}/tezfix/join/<token>`), revoke, workersLive (presence + busy + current assignment).
**Invites:** preview (public; valid flag + reason), accept: caller without a handyman profile or with a DRAFT company-less one; company APPROVED; not expired/revoked/used up (`INVITE_INVALID`);
WORKER → HandymanProfile COMPANY_WORKER APPROVED (company is verified) with the company's trades or given `tradeIds`, member WORKER; MANAGER → member MANAGER only; usedCount++ atomically.
**Tests:** every endpoint, every error code, KYC end-to-end (upload files via `api.files.upload`, submit, admin approve/reject, resubmit limit), presence on/offline with warnings, admin lists with
tz_fold search ("ismayil" finds "İsmayıl"), invites (expiry via clock, max uses race: two accepts on a 1-use invite → one wins), company member rules, block user kills sessions.

### Lane M1 — Customer app core (`m1`)

**Owns:** `apps/customer/**` (you may add customer-specific components under `apps/customer/src`), `packages/i18n/locales/*/customer.json`.
Implement against the contract (read `apps/api/src/**` and the spec to understand behaviour). Screens per `design/02-customer-app-flows.png`:
account type (A3: Fərdi hesab / Şirkət hesabı with company fields, `api.customer.upsertAccount`); Home (B1/B2: dark header "Salam, <name>", location line, search, Ev ustaları / Avto ustaları toggle,
featured category tiles (6 per vertical, icons from `@expo/vector-icons` MaterialCommunityIcons by `category.icon`, fallback icon), "Bütün kateqoriyalar" link, a "Şəkil ilə tap" (find by photo) entry,
active request banner); All categories (grouped, searchable with `tzFold`); Create request (B3: address picker — map pin with current location (expo-location) + reverse geocode + structured fields
(district, street, building, block, entrance, floor, apartment, intercom, note) + saved addresses; description; up to 5 photos (expo-image-picker + expo-image-manipulator resize 1600 px → `api.files.upload`
REQUEST_PHOTO); timing İndi / Planla / Təcili (emergency shows the 5 AZN per handyman fee and wallet check); date-time picker for Planla (`@react-native-community/datetimepicker`, Baku time, min lead from
`/config/public`); number of handymen stepper; provider preference for company accounts; "Usta çağır"); Find by photo flow (pick/take photo → upload → `api.requests.classifyPhoto` → preselect category or show
candidates/picker); Searching screen (B4: dark screen, pulsing hexagon rings drawn from `request:search` cells over the map, "Yaxınlıqdakı ustalar axtarılır...", cancel); Orders tab (active/history lists, request detail
with slots/assignments summary). Handle all API errors with localized messages (`CUSTOMER_IN_DEBT` → wallet top-up CTA). All strings via i18n (az/ru/en).
Tests: Jest unit tests for form validation, request payload builder, category search, hexagon geometry helper, timing rules; `tsc --noEmit` clean; `npx expo export --platform android` succeeds.

### Lane M2 — Pro app core (`m2`)

**Owns:** `apps/pro/**`, `packages/i18n/locales/*/pro.json`. Screens per `design/03-handyman-app-flow.png` and `design/04-company-park-flow.png`:
"Usta kimi qoşulun" (Fərdi usta / Usta şirkəti / "Dəvət linki ilə qoşul" with token entry and `tezfiksusta://join/<token>` deep link → `api.invites.preview/accept`); solo onboarding (names, photo, trades multi-select,
radius slider 2–25 km, base location on map) → `api.pro.onboardSolo`; company registration (name, legal form, VÖEN, VAT payer, trades, base address, radius) → `api.pro.onboardCompany`; KYC (consent screen with text from i18n,
ID front, ID back with `expo-camera` card overlay, guided selfie: 3 prompts look/turn head/blink captured with the front camera, optional on-device face check if a library builds cleanly — otherwise send `selfieChecks: null`;
upload each via `api.files.upload` with KYC kinds; `api.kyc.submit`); pending / rejected screens ("Yoxlama prosesi ... adətən 24 saat ərzində", reason + resubmit); Home (B1: map with own position, name + trade header,
ONLAYN/OFLAYN toggle → `api.pro.setOnline` + location watch while online sending `pro:location` over the socket every 15 s (foreground) and starting the expo-location foreground service (notification "Siz onlaynsınız");
"Bu gün" card from `api.pro.statsToday`; low balance banner); Incoming offer modal (B2: countdown from `expiresAt` corrected by `serverNow`, service, address area, distance/ETA, customer name + rating, TƏCİLİ badge,
"Sifarişi qəbul etdikdə balansınızdan 10 AZN platforma haqqı tutulacaq", İmtina et / Qəbul et → `api.pro.acceptOffer`; driven by socket `offer:new`/`offer:closed` plus polling `api.pro.offers` every 5 s while online
and on app focus; vibration + sound); Planlı sifarişlər list (`api.pro.scheduledOffers`) with accept; device setup screen (notification permission, location permission, battery optimization guidance per manufacturer
via `expo-device`). Manager mode entry point (if `managedCompanies` not empty: switch between personal and company mode; the company screens themselves are lane M4).
Tests: Jest for countdown/offer queue logic, onboarding validation, KYC step machine, online/location throttling; `tsc --noEmit` clean; `npx expo export --platform android` succeeds.

### Lane P1 — Admin panel pages (`p1`)

**Owns:** `apps/panel/src/app/admin/**` (except the shell/login from P0 — extend them only if needed), `apps/panel/src/features/admin/**`, `packages/i18n/locales/*/panel.json` keys under `admin.*`.
Every admin page backed by its contract endpoint (server components + server actions; client tables with TanStack): Dashboard (board 05: Bugünkü sifarişlər with delta, Aktiv ustalar + onlayn, Bugünkü gəlir (fee) "N sifariş × 10 ₼",
Ləğv nisbəti, Son sifarişlər), Sifarişlər (filters, detail with timeline/assignments/offers/ledger + force-cancel), Ustalar (tabs Hamısı/Təsdiq gözləyən/Bloklanmış with counts and the board's columns; detail with KYC review
side-by-side images, approve with extracted fields, reject with reason, block/unblock, clear strikes, wallet adjust), Şirkətlər (same pattern + members), Müştərilər (list/detail, block user), Ödənişlər (tabs: ledger,
payment intents, payouts with run/mark paid/failed, invoices with mark paid), Müraciətlər (cases list/detail with notes, redispatch, resolve outcomes, reject), Layihələr (list/detail with quotes), Kateqoriyalar (tree, create/edit,
activate), Xəritə (live map: handymen markers online/busy/bot, searching requests with hexagons from cells, auto-refresh 10 s + socket `admin:event`), Tənzimləmələr (platform settings form with defaults and demo badge; admins list/create/
update), Audit (paged), Demo (bots spawn/clear, config toggles, create a test request by clicking the map; only shown when `demoMode`). Money via `formatMoney`, dates in Baku time, statuses via `common.*`.
Tests: Vitest for data mappers/formatters/forms; `npm run build -w @tezfiks/panel` succeeds.

---

## Wave 3 (parallel): B3 jobs lifecycle, B4 B2B projects, M3 customer jobs, M4 pro jobs + manager, P2 company panel

### Lane B3 — Assignment lifecycle, ETA/contact, payment completion, chat, ratings, cases (`b3`, Redis 8)

**Owns:** `apps/api/src/modules/{assignments,chat,cases}/**`, `apps/api/test/b3/**`, `packages/i18n/locales/*/server/jobs.json`.
**Endpoints:** `api.assignments.*`; `api.pro.{assignments, assignment, enRoute, arrived, enterPrice, cancel, rateCustomer}`;
`api.company.{assignments, assignment, enterPrice, reassign, cancelAssignment}`; `api.chat.*`; `api.cases.list`;
`api.admin.{cases, case, addCaseNote, redispatchCase, resolveCase, rejectCase}`.
Use B1's views, `CancellationService`, `FeesService`, `DispatchService`, `RequestStateService`; A3's `PresenceService.onLocation`, `NotificationsService`; A2's `PaymentsService`; A4's `GeoService`.
**Provider actions** (solo handyman = the assignment's handyman; company = the assigned worker or a manager of the company; spec §6.3): en-route (computes the route once with `GeoService.route(location, request)`, stores
polyline/duration/distance, `etaSec`, notify ASSIGNMENT_EN_ROUTE), arrived (contact unlock, notify ASSIGNMENT_ARRIVED), enterPrice (`labor + materials`, ARRIVED only; for company jobs only the side named by
`finalPriceEntry` — the other gets `FORBIDDEN`; → PRICE_PROPOSED, notify PRICE_PROPOSED with amount; schedule `assignment.autoComplete` after `autoCompleteAfterMin`), cancel (`CancellationService` actor PROVIDER),
rateCustomer (once; `ALREADY_RATED`; updates customer account rating). Company: reassign (ACCEPTED only, worker ACTIVE member, free, has trade), cancelAssignment, manager enterPrice.
**Location/ETA:** register `PresenceService.onLocation`: for the handyman's EN_ROUTE assignment update `lastLat/lastLng/lastHeading/lastLocationAt`, `etaSec` via `GeoService.progressAlong` (re-route at most every
120 s or when off-route > 150 m), emit `assignment:location` to the assignment room and the customer's user room; when `shouldUnlockContact` → set `contactUnlockedAt` once, emit `assignment:contact`,
notify ASSIGNMENT_NEAR to the customer.
**Customer actions:** cancel / decline-on-arrival / report-no-show via `CancellationService`; confirmPrice CASH → COMPLETED (capture fee if still held via `FeesService`, completedCount, request recompute,
notify ASSIGNMENT_COMPLETED); CARD → `PaymentsService.createIntent(JOB_PAYMENT, total, creditAccountId = provider EARNINGS (solo) or company EARNINGS)` and return checkout; on `payment.succeeded` (JOB_PAYMENT) → COMPLETED,
paymentMethod CARD, `guaranteeUntil = completedAt + guaranteeDays`; TIP intents (only after a CARD-completed job) → `tipAmount` += amount, notify TIP_RECEIVED. Reconciler: completed card intents whose assignment is not completed.
disputePrice → PRICE_DISPUTED + Case PRICE_DISPUTE; rate (once; provider/company rating aggregates; notify RATING_RECEIVED); guaranteeClaim (card-paid, within guaranteeUntil → Case GUARANTEE; else `GUARANTEE_NOT_AVAILABLE`).
**autoComplete** job: PRICE_PROPOSED older than autoCompleteAfterMin → COMPLETED as CASH.
**Chat:** participants = customer, the assigned handyman, managers of the company; send requires `isContactWindowOpen` (`CHAT_LOCKED`); emits `chat:message` to the assignment room + other party's user room; notify CHAT_MESSAGE (push, no body text in push data).
**Admin cases:** list/detail/notes; redispatch (GUARANTEE): `DispatchService.createGuaranteeFixRequest`, case REDISPATCHED with `followUpRequestId`; resolve outcomes for PRICE_DISPUTE: COMPLETE_CASH, REPROPOSE_PRICE (sets price, back to PRICE_PROPOSED),
CANCEL_ASSIGNMENT (admin cancel, no fees), RESOLVED; reject. Audit each. Notify CASE_UPDATED.
**Views:** pro/company assignment lists (scope active/history) with FULL vs WORKER_LIMITED rules (workers never see description, customer rating, price or fee; company job price is hidden from the worker when
finalPriceEntry = MANAGER until completion).
**Tests:** the full happy path solo (accept → en-route → location pings lowering ETA → contact unlock exactly at ≤ 300 s → arrived → price → card payment via checkout page → completed + guarantee → tip → ratings both ways),
cash path, auto-complete, company path with manager price entry and worker-limited views, reassign, every cancellation entry point over HTTP with balances, chat locked/unlocked/closed 2 h after end,
privacy (no phone before unlock; worker views), disputes and admin resolution, guarantee claim + redispatch creating a fee-free request offered first to the original provider, ledger invariants.

### Lane B4 — B2B projects, quotes, reports, invoices (`b4`, Redis 9)

**Owns:** `apps/api/src/modules/projects/**`, `apps/api/test/b4/**`, `packages/i18n/locales/*/server/projects.json`.
**Endpoints:** `api.projects.*`, `api.providerProjects.*`, `api.admin.{projects, project, invoices, markInvoicePaid}`. Spec §4.10 and §6.6.
Create: customer account (any type; flow QUOTE categories — `CategoriesService.requireQuoteService`), `quoteDeadline = now + quoteWindowHours`, workDays = inclusive date span, cell7; notify eligible providers PROJECT_NEW
(solo approved with the trade whose service cells cover the cell; managers of approved companies with the trade covering it). Quote (solo or company manager with `companyId`): one per provider (`CONFLICT`),
window open (`QUOTE_WINDOW_CLOSED`), hold `b2bQuoteFee(workers, days)` on the provider WALLET (`INSUFFICIENT_BALANCE`); notify QUOTE_RECEIVED. Withdraw → release. Accept quote (owner, OPEN, quote SUBMITTED): capture the winner's hold
(B2B_FEE_CAPTURE), release the others (REJECTED, notify QUOTE_REJECTED), terms snapshot, project AWARDED, notify QUOTE_ACCEPTED. Deadline job: no quotes → EXPIRED. Reports (awarded provider; project → IN_PROGRESS on first report;
notify PROJECT_REPORT). Complete → invoice `TF-<yyyy>-<6-digit nextval('invoice_number_seq')>`, lines (default one line = quote total), `vatBreakdown(subtotal, vatRatePercent, issuer.isVatPayer)`,
issuer/customer snapshots (name, VÖEN), project INVOICED, notify INVOICE_ISSUED. Admin markInvoicePaid → direct posting INVOICE_PAYMENT EXTERNAL → provider EARNINGS (total), project PAID,
`guaranteeUntil`, notify INVOICE_PAID; audit. Cancel (OPEN only) releases holds. Rating once; guarantee claim → Case. Provider views include `feePerWorkerDay`, myQuote with fee.
**Tests:** full flow with two competing quotes (one solo, one company), fee holds/captures/releases with balances, window close by clock, eligibility, VAT math (payer and non-payer), invoice numbering,
admin mark paid → earnings, authorization (other providers can't see others' fees; customers can't see fees), cancellation, ledger invariants.

### Lane M3 — Customer app: jobs, payments, wallet, B2B, profile (`m3`)

**Owns:** `apps/customer/**`, `packages/i18n/locales/*/customer.json`.
Tracking (B5: map with route polyline and live marker from `assignment:location`, ETA "12 dəq məsafədə", provider card with photo/name/rating/jobs, Zəng et / Mesaj yaz locked until contact unlock with the explanation text,
then dialer (`Linking.openURL('tel:...')`) and chat; multi-handyman requests show each assignment), arrived (decline with the 15 AZN warning from `actions.declinePenalty`), cancel with penalty preview, no-show report,
payment (C1: Razılaşdırılmış qiymət, Nağd / Kartla, TezFiks Zəmanəti explainer; card opens the checkout URL with `expo-web-browser` `openAuthSessionAsync(checkoutUrl, 'tezfiks://payment')` and polls `api.payments.get`),
tip page after card payment, rating (C2 stars + comment), price dispute, guarantee claim, chat screen (socket `chat:message`), Orders detail, Wallet tab (balance, debt banner, top-up via checkout, transactions),
saved addresses, notifications list (+ unread badge), B2B (D: "Biznes sifarişi" form for company accounts and any QUOTE category, project list/detail with quotes comparison/accept, daily reports, invoice view), profile
(name/photo edit, company info, language switch, logout, delete account with confirmation). Tests: Jest for ETA/countdown/money helpers, payment return handling, chat list merge; `tsc` clean; `expo export` succeeds.

### Lane M4 — Pro app: active jobs, earnings, projects, manager mode (`m4`)

**Owns:** `apps/pro/**`, `packages/i18n/locales/*/pro.json`.
Active job (B3: timeline Sifariş qəbul edildi / Yola çıxdım / Ünvana çatdım / İş tamamlandı with times, customer card, "Naviqasiyanı aç" with Google Maps / Waze / Paylaş deep links, en-route starts location updates
(foreground service, 5 s while en route), arrived, cancel with free-window info, phone/chat once unlocked); Complete (B4 keypad: İş haqqı + Material xərci = Yekun məbləğ, warning text, "Qiyməti təsdiqlə və işi bitir");
waiting for customer confirmation / payment state; rate customer; Orders (active/history); Balance (B5: Cari balans, low balance warning, "+ Balansı artır" via checkout, Əməliyyat tarixçəsi); Earnings & payouts + payout card form;
Projects (open requests list, detail, quote form with fee preview, my quotes, awarded: daily report with photos, complete → invoice); notifications; profile (trades, radius, base, language, logout, delete).
**Company worker mode** (board 04): limited job screen (location card, Google Maps / Waze / Paylaş, "Yola çıxdım"; no customer details beyond name/photo; price screen only if finalPriceEntry = WORKER).
**Manager mode** (board 04): company home with "Balans: 240 ₼" chip; incoming order cards with countdown, fee note "Qəbulda şirkət balansından 10 AZN tutulacaq", "Ustanı seçin" list (Boşdur/Sifarişdədir, rating, distance),
İmtina et / Qəbul et və göndər (`api.company.acceptOffer` with selected workers); company jobs list + manager price entry; members & invite link sharing (`Share.share`); settings "Yekun qiyməti kim daxil edir?";
company balance/top-up/earnings. Tests: Jest for keypad math, job state machine UI helpers, navigation link builders, worker-limited rendering rules; `tsc` clean; `expo export` succeeds.

### Lane P2 — Company panel and dispatch board (`p2`)

**Owns:** `apps/panel/src/app/company/**` (except shell/login), `apps/panel/src/features/company/**`, `packages/i18n/locales/*/panel.json` keys under `company.*`.
Dashboard (`api.company.dashboard`), **Dispatch** (live list of incoming offers with countdowns and the worker picker → `api.company.acceptOffer`; decline; active jobs board grouped by status with live updates
via socket `offer:new`, `offer:closed`, `assignment:updated`, `company:workers`; live map of workers (`api.company.workersLive`) refreshed by socket/15 s polling), Sifarişlər (list/detail, manager price entry when
finalPriceEntry = MANAGER, reassign, cancel), Ustalar (members, roles, trades, remove; invites create/revoke with copyable links), Balans (wallet, top-up via checkout in a new tab, transactions, earnings, payouts,
payout method), Layihələr (open projects, quote form with fee preview, my quotes, awarded projects with daily reports, complete → invoice view), Tənzimləmələr (final price entry, VAT payer, trades, radius, base address).
Tests: Vitest for dispatch state reducer (offers add/expire/close), worker picker rules (≤ open slots, busy disabled); `npm run build -w @tezfiks/panel` succeeds.

---

## Wave 4 (parallel): B5 admin API remainder, B6 demo simulator + seed

### Lane B5 — Admin API remainder (`b5`, Redis 10)

**Owns:** `apps/api/src/modules/admin/**`, `apps/api/test/b5/**`, `packages/i18n/locales/*/server/admin.json`.
**Endpoints:** `api.admin.{me, dashboard, requests, request, cancelRequest, customers, customer, settings, updateSettings, admins, createAdmin, updateAdmin, audit, liveMap}`.
Dashboard KPIs per contract (Baku day; bots excluded; deltas vs yesterday / previous week). Requests list with filters + `q` (request number or customer/provider name via tz_fold), detail with assignments (phones visible to admins),
offers, ledger transactions of the request, timeline (created, offers sent, accepted, en-route, arrived, price, completed/cancelled, payments). cancelRequest: admin cancel via `CancellationService` actor ADMIN
(`chargeCustomer` → apply customer penalty), audit. Customers list/detail. Settings get/update (validates with `PlatformSettingsSchema.partial()`, audit before/after). Admins CRUD (scrypt password, cannot deactivate yourself,
OPERATOR cannot manage admins → `FORBIDDEN`). Audit list. Live map from presence + searching requests with their covered cells.
Tests for every endpoint, filters, KPI math on seeded data, role rules, audit rows.

### Lane B6 — Demo simulator and demo seed (`b6`, Redis 11)

**Owns:** `apps/api/src/modules/demo/**`, `apps/api/prisma/seed/demo.ts`, `apps/api/test/b6/**`, `packages/i18n/locales/*/server/demo.json`.
**Endpoints:** `api.admin.{demoState, demoSpawnBots, demoClearBots, demoConfig, demoCreateRequest}` (all → `DEMO_DISABLED` unless `DEMO_MODE=true`).
Bots: approved solo handymen (`isBot=true`) with funded wallets (100 AZN via ADMIN_ADJUSTMENT), names from an az name list, trades (given or all featured), placed randomly within `radiusKm` of `center` (default Baku centre),
online in presence; or workers of an existing company (`companyId`). Config stored in `PlatformSetting` key `demo.config` (defaults: autoAccept true, acceptDelaySec 4, speedKmh 40, autoArrive true, autoPrice true,
priceLabor 3500, priceMaterials 1000). Simulator (runs inside the API process when DEMO_MODE): finds SENT offers for bot handymen (poll every second) → accept after `acceptDelaySec` through the same service as the real endpoint;
drives en-route along the route polyline at `speedKmh` (location updates every 2 s via `PresenceService.updateLocation` so ETA/contact unlock happen live); arrives; proposes price. All bot actions use the real services
(no shortcuts) so ledger/notifications behave exactly as for humans. `demoCreateRequest` creates a request as a demo customer (`demo customer` user with funded wallet, or `customerUserId`). **Demo seed**
(`npm run seed:demo -w @tezfiks/api`): FixPro MMC (approved, members Rauf Hüseynov, Tural Əliyev, Kamran Səfərov; balance 240 AZN), solo Elvin Məmmədov (santexnik, approved, 34 AZN), Samir Quliyev (pending KYC with
placeholder images), Vüqar Nəbiyev (blocked), customers Nizami Talıbov, Aysel Qasımova, Kontur MMC (company, VÖEN 1234567890), a demo customer; historical requests in every status (completed cash, completed card with
guarantee and tip, cancelled free, cancelled late with penalty, expired, one in progress) created through services so the ledger balances; a B2B project with two quotes; an open guarantee case. Idempotent (skip if already
seeded). Prints the demo logins (phones; OTP codes come from the console channel / devCode).
Tests: bots spawn/clear, full bot flow from request to price proposal with manual jobs/clock, `DEMO_DISABLED`, seed idempotency, ledger invariants after the seed.

---

## Wave 5: integration, Android end-to-end, deployment

- **API:** whole suite green incl. `contract-coverage.spec.ts`; full-repo `tsc` clean; fix cross-lane defects (tests are the spec).
- **Run locally:** Docker DB, `npm run migrate:deploy && npm run seed && npm run seed:demo -w @tezfiks/api`, API on :3000 with `DEMO_MODE=true`.
- **Android:** build debug APKs of both apps with `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000/tezfix/api`, boot the `tezfiks_pixel` AVD, install, and drive every flow (adb + uiautomator, or Maestro flows committed under
  `e2e/maestro/`): customer login → request → bot accepts → tracking → contact unlock → arrived → card payment → tip → rating; emergency; scheduled; cancellations; wallet top-up; B2B project; pro login → onboarding → KYC →
  admin approves (API) → online → real offer → accept → en-route (emulator geo fix) → price; manager mode accept with worker. Screenshots of every step under `e2e/screenshots/`. Fix every defect found.
- **Panel:** build, run against the API, exercise admin and company flows in a browser.
- **Deployment:** `deploy/docker-compose.yml` (postgres, redis, migrate, api, panel), `deploy/nginx/tezfiks.conf` (+ Apache notes), `deploy/.env.example`, `docs/deploy.md` (first deploy, update, backups, Supabase move,
  rebuilding the apps with the production API URL), root `README.md`.
