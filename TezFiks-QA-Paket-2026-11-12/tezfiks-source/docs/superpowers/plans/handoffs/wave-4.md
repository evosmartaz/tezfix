# Wave 4 handoff (implemented, reviewed, fixed)

Read the section of every lane whose services or screens you build on. Exported services are the exact signatures the code has now; read the source when in doubt.

## Orchestrator notes for Wave 5+

- **Wave 5 is the orchestrator's integration pass** (no more lanes): full API suite including contract-coverage, local run with the demo seed,
  release APKs on the `tezfiks_pixel` emulator driven by Maestro (flows in `e2e/maestro/`), the panels in a browser, Docker re-verification.
- **Device bugs found and fixed during Wave 5 preparation** (unit tests could not see them):
  1. Release APKs crashed at start: R8 stripped WorkManager's `WorkDatabase_Impl`. Keep rules now come from `expo-build-properties`
     `extraProguardRules` in both `app.config.ts` (commit aaf43cd).
  2. Every photo upload failed on devices: Expo SDK 58 installs `expo/fetch` as the global fetch, and its FormData encoder throws
     `Unsupported FormDataPart implementation` for React Native `{ uri, name, type }` parts. `packages/mobile/src/api/fetch.ts`
     (`createAppFetch`) resends exactly those requests over XMLHttpRequest; tests that stub the global fetch keep working.
- **Demo logins and OTP**: see `docs/demo.md`. Demo phones need both `OTP_BYPASS_PHONES` and `OTP_BYPASS_CODE`.
- **`npm run dev` (tsx watch) cannot run the Nest API**: esbuild emits no decorator metadata. Fixed in Wave 5 (see apps/api/package.json).
- **Bots**: never deleted (ledger history); clear deactivates them. Payouts and admin lists should exclude `isBot` handymen (Wave 5 check).
- Leftover lane scratch databases `tezfiks_b5smoke`, `tezfiks_b6_scratch`, `tezfiks_b6_scratch2` were dropped by the orchestrator.
  `apps/panel/.next` from B5's smoke build points at port 3340: rebuild the panel before running it.

## B5 - Admin API

Final tests: 48 passed / 0 failed, typecheck clean: true, review verdict: pass (fixed)

### Exported services

- AdminModule exports AdminUsersService, AdminRequestsService (imports AssignmentsModule, CategoriesModule, RealtimeModule, RequestsModule, WalletModule)
- AdminUsersService.me(adminId: string): Promise<AdminMe>
- AdminUsersService.requireAdminRole(adminId: string, db?: Db): Promise<AdminUser>
- AdminUsersService.list(): Promise<{ items: AdminUserView[] }>
- AdminUsersService.create(actor: AdminPrincipal, body: EndpointBody<typeof api.admin.createAdmin>, ip: string | null): Promise<AdminUserView>
- AdminUsersService.update(actor: AdminPrincipal, id: string, body: EndpointBody<typeof api.admin.updateAdmin>, ip: string | null): Promise<AdminUserView>
- AdminRequestsService.list(q: EndpointQuery<typeof api.admin.requests>, locale: Locale): Promise<EndpointOutput<typeof api.admin.requests>>
- AdminRequestsService.rows(ids: string[], locale: Locale): Promise<AdminRequestRow[]>
- AdminRequestsService.detail(id: string, locale: Locale): Promise<AdminRequestDetail>
- AdminRequestsService.cancel(adminId: string, requestId: string, body: { reason: string; chargeCustomer: boolean }, ip: string | null, locale: Locale): Promise<AdminRequestDetail>  // also closes open PRICE_DISPUTE cases of the cancelled jobs and cancels their pending JOB_PAYMENT intents
- adminAssignmentRow(a: Assignment & { request: { number; customerAccount: { companyName; owner } }; handyman.user; company }): AdminAssignmentRow  // admin-requests.service.ts
- customerName(acc: { companyName: string | null; owner: { firstName; lastName; phone } }): string  // admin-requests.service.ts
- AdminDashboardService.dashboard(locale: Locale): Promise<AdminDashboard>; AdminDashboardService.liveMap(locale: Locale): Promise<LiveMap>
- AdminCustomersService.list(q): Promise<paginated AdminCustomerRow>; rows(ids: string[]): Promise<AdminCustomerRow[]>; detail(id: string, locale: Locale): Promise<AdminCustomerDetail>
- AdminSettingsService.get(): Promise<{ settings; defaults; demoMode }>; update(adminId: string, patch: Partial<PlatformSettings>, ip: string | null): Promise<{ settings; defaults; demoMode }>  // serialized by advisory lock
- AdminAuditService.list(q: EndpointQuery<typeof api.admin.audit>): Promise<paginated AuditRow>

### Deviations from the plan

- New since the first report: admin cancel closes the cancelled jobs' open price-dispute cases as RESOLVED, with the admin's reason as the note. Locks are taken in the order request, then assignment (through CancellationService), then case (FOR UPDATE, ORDER BY id), the same order as B3's case decisions. Each closed case gets an audit row: action case.resolve, after = { status: 'RESOLVED', outcome: 'CANCEL_ASSIGNMENT', note, via: 'request.cancel', requestId }. The request.cancel audit row's after value now has closedCases: string[]. Only PRICE_DISPUTE cases are closed. REPORT and GUARANTEE cases stay open.
- New admin:event type CASE_RESOLVED (entityId = case id), sent when admin cancel closes a dispute case. It matches P1's CASE_* live-refresh prefix. The customer who opened the case gets CASE_UPDATED (customer app, data { caseId, status: 'RESOLVED' }).
- After commit, admin cancel also cancels each cancelled job's CREATED card checkouts (JOB_PAYMENT) through B3's CompletionService.cancelPendingIntents, and drops its auto-completion job (b3JobId.autoComplete). Because of this, AdminModule now imports AssignmentsModule. Nothing imports AdminModule except AppModule, so this creates no import cycle.
- Timeline: when a job was cancelled as part of the request's own cancellation (same cancelledBy, within 5 seconds of the request's cancelledAt), only the request's 'cancelled' event is shown, with the provider's name when the provider cancelled. 'expired' uses searchEndsAt and falls back to updatedAt.
- AdminAssignmentRow.customerName uses the same fallback as the request row: full name, then company name, then phone.
- Admin settings saves hold pg_advisory_xact_lock(hashtext('tezfiks:admin:platform-settings')) while they read, write and log. The audit row is written in that transaction. The foundation's SettingsService.update still writes through its own client and is unchanged.

### Contract additions

- (none)

### Open issues / notes for other lanes

- Full API suite with TEST_DB_NAME=tezfiks_test_b5f TEST_REDIS_DB=50: 642 of 644 pass. test/b1/customer.spec.ts ('getAccount is null before the account-type step') failed once and passed when re-run, so it is flaky. test/b6/demo-simulator.spec.ts ('drives a bot from the offer to the price proposal') fails consistently with 'expected 3238.06 to be less than 3164.78', a distance check in lane B6's in-progress simulator. B6's code does not use the admin module, so this belongs to B6, not B5.
- The settings update still runs in two steps at the foundation level. SettingsService.update commits on its own connection before the advisory-lock transaction, and that transaction holds the audit row. A crash between the two commits would leave a change without an audit row. Concurrent saves through B5 can no longer lose a change. Calls that bypass AdminSettingsService and go straight to SettingsService.update (tests, the demo) do not take the lock.
- If a card payment for a cancelled job succeeds anyway (the checkout was already paid when the cancel committed), B3 still keeps the money in EARNINGS and only logs it. Refunding it is left to an admin, as documented by B3.
- The LAST_ADMIN branch in AdminUsersService.update cannot be reached, because self-demotion and self-deactivation are refused first. It is kept as a guard and has no test.
- Left over from the implementer's smoke test (unchanged): apps/panel/.next is a build that points at 127.0.0.1:3340, so Wave 5 must rebuild the panel. Postgres database tezfiks_b5smoke and some keys in Redis db 10 remain. This fix pass created test database tezfiks_test_b5f and used Redis db 50. It started no servers.

## B6 - Demo simulator and seed

Final tests: 31 passed / 0 failed, typecheck clean: true, review verdict: pass

### Exported services

- DemoModule exports DemoConfigService, DemoBotsService, DemoRequestsService, DemoSimulatorService, DemoSeedService
- DemoConfigService.enabled: boolean (getter); assertEnabled(): void  // throws DEMO_DISABLED; get(): Promise<DemoConfig>; update(patch: Partial<DemoConfig>, adminId: string | null): Promise<{ before: DemoConfig; after: DemoConfig }>
- DemoBotsService.state(locale: Locale): Promise<DemoState>; spawn(adminId: string | null, input: { count: number; center?: LatLng; radiusKm?: number; tradeIds?: string[]; companyId?: string }, ip: string | null): Promise<string[] /* handymanIds */>; clear(adminId: string | null, ip: string | null): Promise<number>
- DemoRequestsService.ensureDemoCustomer(): Promise<{ userId: string; accountId: string; walletAccountId: string }>; create(adminId: string | null, body: { customerUserId?: string; categoryId: string; lat: number; lng: number; timing?: RequestTiming; slots?: number; scheduledAt?: string; description?: string }, ip: string | null): Promise<{ requestId: string; number: number }>
- DemoSimulatorService.arm(): Promise<void>; tick(): Promise<TickReport>  // TickReport = { ran; heartbeats; accepted; declined; enRoute; moved; arrived; priced; errors }
- botPosition(path: LatLng[], speedKmh: number, elapsedMs: number): { at: LatLng; heading: number; done: boolean }  // demo-simulator.service.ts
- randomPointWithin(center: LatLng, radiusKm: number, rnd?: () => number): LatLng  // demo-bots.service.ts
- DemoSeedService.run(opts?: { log?: (line: string) => void }): Promise<{ skipped: boolean; logins: DemoLogin[]; marker: SeedMarker }>  // requires JobsService mode 'manual'; marker(): Promise<SeedMarker | null>; logins(): DemoLogin[]
- Constants (demo.constants.ts): DEMO_CONFIG_KEY='demo.config', DEMO_SEED_KEY='demo.seed', DEFAULT_DEMO_CONFIG, DEMO_JOB.tick='demo.tick', DEMO_RECONCILER_TASK='demo.simulator', BOT_PHONE_PREFIX='+99400', DEMO_CUSTOMER={ phone: '+994552000024', firstName: 'Demo', lastName: 'Müştəri' }; demo-seed.data.ts: SEED_PEOPLE, DEMO_LOGINS, FIXPRO, KONTUR
- Ledger idempotency keys: demo-bot-fund:<handymanId>, demo-bot-defund:<handymanId>, demo-customer-topup:<walletAccountId>:<entryCount>, demo-seed:topup:<who>, demo-seed:final-balance:<accountId>
- Demo logins (all accept OTP_BYPASS_CODE when listed in OTP_BYPASS_PHONES): +994502000001 Elvin (pro), +994502000002 Samir, +994502000003 Vüqar, +994502000011 Rauf (FixPro manager), +994502000012 Tural, +994502000013 Kamran, +994552000021 Nizami, +994552000022 Aysel, +994552000023 Kontur MMC (Leyla Rzayeva), +994552000024 Demo Müştəri

### Deviations from the plan

- Bots are never deleted, including bots with no jobs, because every bot already has a ledger posting (its funding). demoClearBots force-cancels ACCEPTED/EN_ROUTE/ARRIVED jobs through ProviderBlockService.forceCancelAndRedispatch (CancellationService, actor ADMIN: no fee kept, no penalty; the slot is re-opened and re-dispatched). It declines the bots' SENT offers (OffersService.declineSolo) and returns the remaining available wallet balance to the platform (ADMIN_ADJUSTMENT, key demo-bot-defund:<id>). It then sets the user to status DELETED (with deletedAt), sets isOnline=false, calls presence setOffline and marks company membership REMOVED. Jobs that are PRICE_PROPOSED or PRICE_DISPUTED stay payable.
- Bots auto-accept only offers sent to themselves (targetType HANDYMAN). Company offers stay with the company's managers, because accepting them would mean acting as a non-bot manager; a manager can choose a bot worker on the dispatch board.
- The plan has no separate pause settings, so the pause before leaving (after acceptedAt) and the pause before the price (after arrivedAt) both reuse acceptDelaySec. Scheduled jobs leave 30 minutes before scheduledAt (SCHEDULED_DEPART_LEAD_MS). Bots price company jobs only when company.finalPriceEntry is WORKER.
- PATCH /admin/demo/config rejects a negative priceLabor or priceMaterials with VALIDATION_FAILED, because the contract Money type allows negative values but a proposed price cannot be negative.
- Bot phones use the +99400xxxxxxx prefix. It is not a valid AZ mobile (normalizeAzMobile returns null), so nobody can log into a bot and no real number is taken. Bot trades default to all featured INSTANT services. Solo bots get a 10 km service radius.
- Seed: Rauf Hüseynov is the FixPro MMC MANAGER who registered the company (no worker profile, as the B2 services model it); Tural and Kamran joined as WORKERs through real invite links. Elvin's trades are plumbing (primary), heating and renovation-crew, so he can also quote on the B2B project. 34 AZN and 240 AZN are the AVAILABLE balances, set at the end by one ADMIN_ADJUSTMENT per account (key demo-seed:final-balance:<accountId>). FixPro also has held quote fees on top.
- Seed: all seeded pros are left offline; they go online from the app. If the database has no active ADMIN, review decisions are recorded under an inactive admin demo-seed@tezfiks.invalid with a random password.
- The seed CLI refuses to run unless DEMO_MODE=true is set or --force is passed. It runs seedCategories only when the categories table is empty, so admin edits are kept; seedPlatformAccounts is an idempotent upsert. Under tsx, which emits no decorator metadata, it compiles with tsc -p tsconfig.build.json into apps/api/node_modules/.cache/tezfiks-seed-demo and re-runs the compiled demo.js. Seed progress is stored in PlatformSetting 'demo.seed'.
- demoState also answers DEMO_DISABLED when DEMO_MODE=false, as the plan says ('all → DEMO_DISABLED'). P1's demo page will show its error state in that case.
- Non-exported services (RequestsService, ProviderActionsService, CustomerActionsService, CasesService, ProviderProjectsService, KycService and others used by the seed) are obtained with ModuleRef.get(X, { strict: false }). No other lane's module was edited.

### Contract additions

- (none)

### Open issues / notes for other lanes

- P1 contract check (requirement 5): no mismatch. DemoConsole's body { count, radiusKm, center, tradeIds?, companyId? } matches the contract, and the test uses exactly that body.
- Foundation or package.json owner: `npm run dev` (tsx watch src/main.ts) cannot run the Nest API. A probe confirmed that tsx (esbuild) emits no decorator metadata, so constructor injection gets undefined. The demo seed works around this by compiling first; the dev script needs a similar fix (for example tsc -w plus node, or an swc register).
- B2/B5 (admin lists): deactivated bots still exist as handyman profiles with isBot=true and user status DELETED, so they may still appear in GET /admin/handymen. A2 (payouts): PayoutsService.runPayouts will also create payouts for bots' EARNINGS (card payments to bots). Excluding isBot there is suggested. The spec's 'bots excluded from KPIs' is B5's dashboard.
- The seeded people's phones (+99450200000x, +99455200002x) are valid AZ mobiles. If a real person owns one, they could log into that demo account in a production demo through WhatsApp OTP. This is acceptable for the demo phase; choose different numbers before a real launch.
- Run the demo seed before spawning bots. Bots that are already online could receive the seed's requests while it plays the history; this is documented in docs/demo.md.
- BullMQ keeps the last 1000 completed jobs (removeOnComplete: 1000, set in JobsService), so up to 1000 finished demo.tick entries stay in Redis. This is bounded and harmless.
- Leftover scratch resources from the verification: Postgres databases tezfiks_b6_scratch and tezfiks_b6_scratch2 (both fully seeded; scratch2 also has the base seed and admin admin@tezfiks.test / Scratch-Passw0rd!), Redis DBs 31 (prefix b6s) and 32 (prefix b6v), upload folders $TEMP/b6-scratch-uploads*, the compile cache apps/api/node_modules/.cache/tezfiks-seed-demo, and the smoke script C:\Users\prekl\AppData\Local\Temp\claude\C--Users-prekl-tezfiks\834c9570-aa00-4514-a164-2268ef7954ba\scratchpad\b6\smoke.mjs. The scratch API process (port 3361, PID 18680) was stopped.
- apps/api/uploads/ (empty kind subfolders, gitignored) appeared at 23:12 while tests were running. It was not written by the B6 code paths, which use STORAGE_LOCAL_DIR; I left it alone.

