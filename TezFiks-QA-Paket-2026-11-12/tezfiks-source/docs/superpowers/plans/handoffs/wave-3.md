# Wave 3 handoff (implemented, reviewed, fixed)

Read the section of every lane whose services or screens you build on. Exported services are the exact signatures the code has now; read the source when in doubt.

## Orchestrator notes for Wave 4+

- **Remaining contract endpoints (contract-coverage.spec.ts is the only failing API test, 565/566):** B5 owns `admin.me`, `admin.dashboard`,
  `admin.requests`, `admin.request`, `admin.cancelRequest`, `admin.customers`, `admin.customer`, `admin.settings`, `admin.updateSettings`,
  `admin.admins`, `admin.createAdmin`, `admin.updateAdmin`, `admin.audit`, `admin.liveMap`. B6 owns `admin.demoState`, `admin.demoSpawnBots`,
  `admin.demoClearBots`, `admin.demoConfig`, `admin.demoCreateRequest`. When both lanes are done, contract-coverage must pass.
- **GET /admin/me** is still missing and every /admin panel page calls it: B5 ships it first.
- **Lock order** (unchanged): lockActiveUser (FOR SHARE) -> lockRequestRow -> offer / profile / slot / assignment. B3 and B4 follow it.
- **Blocking a provider** now force-cancels and redispatches its active jobs (B3 ProviderBlockService, plus the reconciler task
  `assignments.blockedProviders`). B5 admin blocking only has to emit the existing domain events / call B2's services.
- **Admin cancel of a request** (B5 `admin.cancelRequest`): go through CancellationService with actor ADMIN (B1), never update rows directly.
- **Payments after cancel / double card payment** stay in the provider's EARNINGS and are only logged (B3). There is no refund ledger kind;
  an admin wallet adjustment is the manual fix.
- **Socket.IO works**: `GET /tezfix/api/socket.io/?EIO=4&transport=polling` answers and a websocket client gets `UNAUTHORIZED` for a bad
  token (checked by the orchestrator against the compiled API). P2's "no connection" came from the local setup: the Next server does not
  proxy `/tezfix/api/socket.io`, so for local panel runs build the panel with `NEXT_PUBLIC_SOCKET_URL=http://127.0.0.1:<api port>`.
  In production nginx routes both paths on one origin.
- **Invite links** use `PUBLIC_BASE_URL` + `/tezfix/join/<token>`; production `.env.example` already sets `https://evosmart.az`.
  For local panel runs set it to the panel origin.
- **Notifications** from B3 carry `data.assignmentId` / `data.requestId`; M3 routes push taps from those ids.
- **Not run on a device yet (Wave 5):** expo-web-browser checkout return (`tezfiks://payment`, `tezfiksusta://payment`), foreground location
  service 5 s / 15 s switching, tel: links, Waze / Google navigation intents, date picker, tracking map on OSM tiles, push-tap routing shapes.
- One-off flake seen once by B3 (not reproduced; the orchestrator's full run passed): `test/b1/accept.spec.ts` got a 500 on POST /requests.
  Watch for it in Wave 5 full runs.
- B4's note about a `tsc` error in `test/b3/lifecycle.spec.ts` is stale: after the wave, `tsc --noEmit` is clean in api, customer, pro,
  panel and mobile (orchestrator check, commit 1ee2d88).
- Chat send has no idempotency key; a retried send after a lost response can be stored twice (possible contract addition: optional
  `clientMessageId`).

## B3 - Assignment lifecycle, ETA/contact, payment completion, chat, ratings, cases

Final tests: 51 passed / 0 failed, typecheck clean: true, review verdict: fail (fixed)

### Exported services

- AssignmentsModule exports AssignmentAccess, CompletionService, TrackingService, ProviderBlockService; ChatModule exports ChatService; CasesModule exports CaseViews (unchanged from the earlier report)
- ProviderBlockService.repair(): Promise<string[]>  // NEW: sweeps ACCEPTED/EN_ROUTE/ARRIVED jobs of BLOCKED companies, handyman profiles and handyman users; returns the cancelled assignment ids; registered as reconciler task 'assignments.blockedProviders'
- ProviderBlockService.cancelActive(where: Prisma.AssignmentWhereInput, reasonKey: 'providerBlocked'|'companyBlocked'): Promise<string[]>  // reason now written in each customer's locale
- ProviderBlockService.forceCancelAndRedispatch(assignmentId: string, reason: string): Promise<boolean>
- Constants: B3_RECONCILER_TASK = { assignments: 'assignments.repair', blockedProviders: 'assignments.blockedProviders' }

### Deviations from the plan

- List endpoints (pro and company assignment lists) always return customerPhone: null, also inside the contact window and for MANAGER viewers. Phones are only in GET /pro/assignments/:id, GET /company/:companyId/assignments/:id and GET /assignments/:id. In manager views worker.phone (the company's own worker) is still shown, because it is not the other party's phone.
- The block sweep reconciler task cancels at most 200 rows per tick per category (company-blocked, then handyman/user-blocked). Per-row errors are logged and retried on the next tick.
- Blocked-provider cancelReason is stored once, in the locale of the request's customer, because that is who reads it. It is no longer always the default locale.

### Contract additions

- (none)

### Open issues / notes for other lanes

- contract-coverage.spec.ts still fails only on B5/B6 endpoints (admin.me, dashboard, requests, customers, settings, admins, audit, liveMap, demo*).
- One-off flake seen once in the full API run: test/b1/accept.spec.ts 'accept errors ...' got a 500 (PrismaClientKnownRequestError) on POST /requests. It did not happen in two re-runs (the file alone, and b1+b2+b4). It is outside B3 code; the B1 owner may want to check for a unique or serialization conflict in request creation under load.
- A JOB_PAYMENT that succeeds after the assignment was cancelled, or a second card payment on a job already paid by card, stays in the provider's EARNINGS. It is now logged (warn or error) but there is no refund ledger kind or provider refund call. A later lane or an admin wallet adjustment has to handle it.
- The re-route rule still needs both conditions: off route by more than 150 m AND at least 120 s since the last route. While on the route, the ETA comes from progressAlong without a traffic refresh (deviation documented earlier).
- Assignment location updates go to the assignment room and the customer's user room only. The company dispatch board (P2) has to join the assignment room, or use the company worker live feeds, to see a worker moving.

## B4 - B2B projects, quotes, reports, invoices

Final tests: 25 passed / 0 failed, typecheck clean: true, review verdict: pass

### Exported services

- ProjectsModule exports ProjectsService, ProjectViews, ProviderActorService (imports CustomerModule, CategoriesModule, FilesModule, NotificationsModule, WalletModule)
- ProjectsService.create(userId: string, body: CreateProjectInput, locale: Locale): Promise<ProjectDetail>
- ProjectsService.list(userId: string, q: { cursor?: string; limit?: number; scope?: 'active' | 'history' }, locale: Locale): Promise<{ items: ProjectSummary[]; nextCursor: string | null }>
- ProjectsService.get(userId: string, projectId: string, locale: Locale): Promise<ProjectDetail>
- ProjectsService.acceptQuote(userId: string, projectId: string, quoteId: string, locale: Locale): Promise<ProjectDetail>
- ProjectsService.cancel(userId: string, projectId: string, locale: Locale): Promise<ProjectDetail>
- ProjectsService.rate(userId: string, projectId: string, body: { stars: number; comment?: string }): Promise<{ ok: true }>
- ProjectsService.guaranteeClaim(userId: string, projectId: string, body: GuaranteeClaimInput): Promise<CaseView>
- ProjectsService.onQuoteDeadline(projectId: string): Promise<void>; expireIfDue(projectId: string): Promise<string | null>; repair(): Promise<number>
- ProjectViews.load(projectId: string, db?: Db): Promise<FullProject | null>; loadMany(where: Prisma.ProjectWhereInput, opts?: { take?: number; orderBy?: Prisma.ProjectOrderByWithRelationInput[] }): Promise<FullProject[]>
- ProjectViews.caseView(c: Case): Promise<CaseView>; invoiceView(inv: Invoice, projectNumber: number): InvoiceView; invoiceViews(rows: Invoice[]): Promise<InvoiceView[]>; customerDetail(p: FullProject, locale: Locale): Promise<ProjectDetail>; providerViews(projects: FullProject[], actor: ProviderActor, locale: Locale): Promise<ProviderProjectView[]>
- ProviderActorService.resolve(userId: string, companyId?: string | null): Promise<ProviderActor>  // ProviderActor = { type: 'SOLO'|'COMPANY'; userId; handymanId: string|null; companyId: string|null; walletAccountId; earningsAccountId; approved: boolean }
- ProviderActorService.requireApproved(actor: ProviderActor, db?: Db): Promise<void>; isEligible(actor, project: { categoryId; cell7; createdByUserId }, db?): Promise<boolean>; userIdsOf(ref: { providerType; handymanId; companyId }, db?): Promise<string[]>; accountsOf(ref, db?): Promise<{ walletAccountId: string|null; earningsAccountId: string|null }>; eligibleUserIds(categoryId: string, cell7: string, excludeUserId: string): Promise<string[]>
- lockProjectRow(tx: Tx, projectId: string): Promise<{ id: string; status: ProjectStatus }>  // project-locks.ts; lockLedgerAccounts(tx: Tx, accountIds: Array<string | null | undefined>): Promise<void>
- Job names (projects.constants.ts PROJECT_JOB): 'projects.quoteDeadline', 'projects.awardExpiry'; job ids project-deadline-<id>, project-award-expiry-<id>; reconciler task 'projects.repair'; AWARD_WINDOW_MS = 7 days
- Ledger idempotency keys: b2b-capture:<quoteId> (B2B_FEE_CAPTURE to REVENUE, refs.projectId), invoice-payment:<invoiceId> (INVOICE_PAYMENT, EXTERNAL to provider EARNINGS)

### Deviations from the plan

- Company customer accounts may create a project for any active service, including INSTANT ones; individual customers only for QUOTE-flow categories. This follows spec 4.10 and lane M3 ('form for company accounts and any QUOTE category'). The plan only names requireQuoteService. An individual choosing an INSTANT category gets CATEGORY_NOT_INSTANT (the code A4's requireQuoteService throws); a QUOTE category passed to requireInstantService would give CATEGORY_REQUIRES_QUOTE.
- Award window, added because the spec says nothing: when the quote deadline passes with SUBMITTED quotes, the project stays OPEN and the customer can still accept. Seven days after the deadline (AWARD_WINDOW_MS, a constant because the settings contract is frozen), the job projects.awardExpiry sets the project EXPIRED, sets every SUBMITTED quote to EXPIRED and releases its hold. Without this, provider fee holds could stay reserved forever.
- Project creation refuses CUSTOMER_IN_DEBT (spec 4.3, applied as for requests). VALIDATION_FAILED when dateFrom is before today (Baku date) or the span is over 366 days.
- Providers that were not awarded see an area-level address: street, building and district, coordinates rounded to about 100 m, and no entrance/floor/apartment/intercom/note or full formatted text. The awarded provider sees the full address. The customer appears as the company name, or first name plus last-name initial; never a phone.
- Quoting on a project that is no longer OPEN (AWARDED, CANCELLED, EXPIRED) returns QUOTE_WINDOW_CLOSED, the same as after the deadline. A provider outside the trade or service area, or the project's own customer, gets NOT_ELIGIBLE. A second quote by the same provider, even after a withdrawal, gets CONFLICT {reason: ALREADY_QUOTED}.
- Customer cancel (OPEN only, otherwise CANCEL_NOT_ALLOWED) moves the submitted quotes to REJECTED and sends QUOTE_REJECTED.
- ProviderQuoteView.feeHeld is the fee reserved (SUBMITTED) or captured (ACCEPTED, with feeCaptured=true). It is 0 once the hold was released (REJECTED, WITHDRAWN, EXPIRED).
- Completion is allowed from AWARDED or IN_PROGRESS; no report is required. Inside one transaction the project passes COMPLETED and lands on INVOICED, with completedAt set. The provider's completedCount (handyman profile or company) is incremented.
- The project rating notification and the project-expired notification use the GENERIC type with texts from server.projects.notify.*. RATING_RECEIVED says 'Sifariş №' and there is no PROJECT_EXPIRED type.
- Guarantee claim: requires a PAID project with now <= guaranteeUntil (otherwise GUARANTEE_NOT_AVAILABLE). A second claim while a GUARANTEE case for the project is OPEN or IN_REVIEW gets CONFLICT {reason: CASE_OPEN}. Photos must be the caller's CASE_PHOTO or REQUEST_PHOTO files. The admin event is {type: 'CASE_OPENED', entityId: caseId}.
- Photo kinds: project photos are REQUEST_PHOTO; report photos are REPORT_PHOTO owned by the report author.
- INVOICE_PAID goes to the provider (the solo handyman, or the company's active managers) and also to the customer. Admin events are PROJECT_CREATED, INVOICE_ISSUED and INVOICE_PAID.
- Authorization codes: another customer's project gives NOT_FOUND. A quote the caller does not own gives NOT_FOUND on withdraw. Reports or completion by a provider that was not awarded give FORBIDDEN {reason: NOT_AWARDED}. Viewing a project you are not eligible for and have not quoted on gives NOT_FOUND. Reports and completion for a company are done by managers with companyId, not by workers.
- Test note: the 'just before the deadline' check sets the Clock 2 s before quoteDeadline, not 1 ms. The test Clock runs in real time, so 1 ms is consumed by the HTTP round trip. The 'at the deadline' check is exact (QUOTE_WINDOW_CLOSED). Tests also issue fresh tokens after moving the Clock past the 15-minute access-token TTL.

### Contract additions

- (none)

### Open issues / notes for other lanes

- For B3/B5 (admin cases): project guarantee cases have assignmentId=null and projectId set. The admin case list and detail must fill projectNumber, customerName and providerName from Case.projectId (the provider is the project's awarded quote). Redispatch (createGuaranteeFixRequest) does not apply to project cases; an admin should resolve or reject them. ProjectViews.caseView(c: Case) builds a CaseView with projectNumber and can be reused.
- There are no PROJECT_EXPIRED or PROJECT_RATED notification types, so GENERIC is used. Adding dedicated types would be a contract and i18n change for a later lane.
- Provider fee holds can stay reserved for up to quoteWindowHours plus 7 days when the customer never decides. If the founder wants a different award window, it is AWARD_WINDOW_MS in projects.constants.ts; it could become a PlatformSetting later.
- Company workers cannot post daily reports; only managers acting with companyId can. If board D/04 wants workers to report, ProviderActorService.resolve needs a worker mode.
- Invoice payment is a direct admin posting (INVOICE_PAYMENT, EXTERNAL to EARNINGS) as the plan says. The PaymentIntent purpose INVOICE is not used yet.
- Not mine: npx tsc reports one error in test/b3/lifecycle.spec.ts (cannot find module '../../src/modules/payments/payments.service'); it belongs to lane B3. contract-coverage.spec.ts still lists 19 B5/B6 admin endpoints as missing; all B4 endpoints are registered.

## M3 - Customer app: jobs, payments, wallet, B2B, profile

Final tests: 533 passed / 0 failed, typecheck clean: true, review verdict: pass (fixed)

### Exported services

- apps/customer/src/hooks/usePushTaps.ts: usePushTapRouting(enabled: boolean): void
- apps/customer/src/lib/notifications.ts: pushPayload(content: { data?: unknown } | null | undefined): Pick<NotificationView,'type'|'data'> | null; pushTapHref(tap: PushTap | null | undefined): string | null; interface PushTap { actionIdentifier?: string; notification?: { request?: { identifier?: string; content?: { data?: unknown } | null } | null } | null }
- apps/customer/src/hooks/useAssignmentLive.ts: retainRoom(socket: object, id: string): boolean; releaseRoom(socket: object, id: string): boolean; useAssignmentLive(id, onUpdate?): void; useKeyRegistry(): KeyRegistry
- apps/customer/src/lib/chat.ts: unreadIdsFromOthers(list: readonly ChatItem[], myUserId: string | null | undefined): string[]; markReadLocally(list: readonly ChatItem[], ids: readonly string[], at: string): ChatItem[]
- apps/customer/src/lib/payments.ts: SETTLE_POLL_MS = 2000; SETTLE_MAX_MS = 60_000; settlePollMs(status: AssignmentStatus | undefined, expired: boolean, intervalMs?: number): number | false; paymentPollMs(status: PaymentStatus | undefined, expired: boolean, intervalMs?: number): number | false
- apps/customer/src/lib/projects.ts: projectGuaranteeOpen(p: { guaranteeUntil: string | null }, clockOffsetMs?: number, now?: number): boolean
- Unchanged exports from the first M3 pass (payments, tracking, chat, projects, notifications, profile, idempotency, categories, useCheckout, queries) keep their signatures.

### Deviations from the plan

- Push tap routing: a tap that arrives before the user is signed in and onboarded (cold start, session restoring, signed out) is held until the session reaches 'main', then opened. The same push id is never opened twice. A tap does not mark the server notification read, because push data carries no notification id. The app only refreshes the notifications queries.
- Tracking: if PRICE_PROPOSED arrives while another screen (such as the chat) is on top, the pay screen is not pushed over it. It opens once the tracking screen is focused again, and only once.
- The tip screen polls only while the assignment is PRICE_PROPOSED (waiting for payment.succeeded), for at most 60 s. The /payment landing screen polls until the payment is final, also for at most 60 s. After that both show 'pay.checkStopped' and a 'pay.checkAgain' button (testIDs tip-recheck and payment-recheck) that restarts the 60 s window.
- The company-info screen now opens an empty form when GET /customer/account returns account null (before, it stayed on the spinner).
- The project guarantee screen shows guarantee.notAvailable and a back button (testID project-guarantee-unavailable) when guaranteeUntil is not ahead of the server clock.

### Contract additions

- (none)

### Open issues / notes for other lanes

- Wave 5 (not possible here: no Gradle, no emulator in this task): rebuild the debug APK for the new expo-web-browser native module. Then check on the device: the checkout auth session returns to tezfiks://payment and +native-intent does not navigate away; tel: links; the date-only DateTimePickerAndroid with timeZoneName Asia/Baku; the tracking map with route polyline and markers on OSM tiles; the inverted chat list with the keyboard; tapping a real FCM push (cold start and background) opens the referenced screen.
- Push data format: usePushTapRouting reads content.data.type with the ids either at top level or inside a JSON string in data.body or data.dataString. Wave 5 should check that a real FCM data message from the API (toFcmData) reaches expo-notifications in one of these shapes on Android.
- B3/B4 (unchanged): notifications should carry data.assignmentId, data.requestId or data.projectId so taps can open the right screen. A push with no id only opens the app.
- Chat: a retried send after a lost response can still be stored twice, because POST /assignments/:id/messages has no Idempotency-Key in the contract. Fixing this needs a contract addition by the chat owner (B3), for example an optional clientMessageId.
- packages/mobile (M4 owns it): the shared jest mock of expo-notifications has no response API. The customer test setup adds addNotificationResponseReceivedListener, getLastNotificationResponseAsync and clearLastNotificationResponseAsync. The pro app needs the same mocks if it adds push tap routing.

## M4 - Pro app: active jobs, earnings, projects, manager mode

Final tests: 202 passed / 0 failed, typecheck clean: true, review verdict: fail (fixed)

### Exported services

- apps/pro/src/hooks/queries.ts: type JobScope = 'active'|'history'; useJobPages(scope: JobScope, companyId: string|null, opts?: { refetchInterval?: number }): UseInfiniteQueryResult<InfiniteData<Page<ProAssignment>>> (the only reader of qk.assignments(scope) and qk.companyAssignments(companyId, scope))
- apps/pro/src/hooks/useRouteTracking.ts: beginRoute(assignmentId: string, t): Promise<boolean> (concurrent calls for one id share a start; false when location permission is refused)
- apps/pro/src/online/tracking.ts: startOnlineTracking(notification, intervalMs?): Promise<TrackingMode> and stopOnlineTracking(opts?): Promise<void> are now serialized; the other signatures are unchanged
- apps/pro/src/lib/projects.ts: providerPhase(p, serverNowMs) returns 'open' only when there is no own quote at all
- All other M4 exports are unchanged from the M4 implementer report

### Deviations from the plan

- Assertion change, made for correctness and not to get a test passing: two of M4's own tests (written in this lane, never committed) expected a withdrawn quote to reopen the quote form, which the B4 server forbids (CONFLICT ALREADY_QUOTED). company-projects-helpers.test.ts now expects providerPhase(...WITHDRAWN) to be 'closed'. m4-projects.test.tsx 'withdraws a submitted quote' now asserts the withdrawn quote stays visible with the badge 'Geri çəkildi', has no withdraw button, and that the quote form does not come back. These assertions are stricter than before. The spec (Quote: SUBMITTED → … | WITHDRAWN) does not allow re-quoting.
- useJobPages is the only reader of qk.assignments and qk.companyAssignments. Any later code that reads these keys must use it (or useInfiniteQuery with the same shape), never a plain useQuery. JobScope is now defined in hooks/queries.ts and re-exported from components/JobList.tsx.
- startOnlineTracking and stopOnlineTracking are now queued so only one runs at a time (same signatures). beginRoute shares one in-flight start per assignmentId and returns false when location permission is refused; JobScreen then shows job.route.permissionDenied.
- /job/[id]/chat accepts an optional ?companyId=. For a manager, its back fallback goes to /company/<cid>/jobs/<id>.
- New i18n key job.route.permissionDenied in az/ru/en pro.json. The files were re-serialized with 2-space JSON, which matches their existing format (no arrays, no escapes).

### Contract additions

- (none)

### Open issues / notes for other lanes

- Minor, not fixed: en-route reporting is resumed only when the job screen is open. If the app is killed while EN_ROUTE (killServiceOnDestroy: true) and reopened on Home, no 5 s pings with an assignmentId are sent until the pro opens the job (an offline pro sends nothing). A fix would be an app-level resume from the active-jobs list (useJobPages('active', null)) in useRouteTrackingGuard. I did not add it, because it would put a GET /pro/assignments on every screen and change request counts in other lanes' route tests.
- After a quote is withdrawn, MyQuote still shows the fee as '(bloklanıb)'. The server releases the hold, but there is no 'released' fee-state key yet. Cosmetic.
- Not run on an emulator yet (wave 5 needs to check): the expo-location foreground service switching between 5 s and 15 s, the tezfiksusta://payment return, Share.share, tel: links, the Waze and google.navigation intents, and the new permission-denied message at 'Yola çıxdım'.
- Still open for B3 (unchanged): the REST fallback POST /pro/location carries no assignmentId; the manager job screen relies on worker.phone in company views; notifications are linked through data.assignmentId, data.projectId and data.companyId.
- Still open for B4 (unchanged): the provider project calls send companyId in the query or body, as the contract defines; the complete call sends no lines.

## P2 - Company panel and dispatch board

Final tests: 422 passed / 0 failed, typecheck clean: true, review verdict: pass

### Exported services

- src/features/company/dispatch.ts: initialDispatchState(companyId: string, initial?: { items: OfferView[]; serverNow: string } | null, now?: number): DispatchState; dispatchReducer(state: DispatchState, action: DispatchAction): DispatchState  // actions: sync | add | close | tick | accepted | declined | dismissNotice
- src/features/company/dispatch.ts: remainingMs(offer, state, now): number; remainingRatio(offer, state, now): number; countdownText(ms: number): string; serverTime(state, now): number
- src/features/company/dispatch.ts: workerAvailability(w): { selectable: boolean; block: 'BUSY' | 'NO_TRADE' | null; offline: boolean }; sortCandidates(workers): OfferCandidateWorker[]; pickLimit(offer): number; togglePick(selected: readonly string[], handymanId: string, offer): { selected: string[]; error: 'LIMIT' | 'UNAVAILABLE' | null }; prunePicks(selected, offer): string[]; defaultPicks(offer): string[]; canAccept(selected, offer): boolean; acceptFeeTotal(offer, workers: number): number
- src/features/company/dispatch.ts: BOARD_COLUMNS = ['ACCEPTED','EN_ROUTE','ARRIVED','PRICE']; boardColumn(status): BoardColumn | null; groupAssignments(items: readonly ProAssignment[]): Record<BoardColumn, ProAssignment[]>; isForCompany(payload, companyId): boolean; isCompanyWalletEvent(payload, companyId): boolean; workerMapState(w); workerMarkers(items, label): WorkerMarker[]; workerCounts(items)
- src/features/company/mappers.ts: parseMoney(text): number | null; parseCount(text): number | null; topupBody(amountText: string, returnUrl?: string | null); topupReturnUrl(origin: string | null | undefined, companyId: string): string | undefined; priceBody(form: { labor: string; materials: string }); priceTotal(form): number | null; reassignCandidates(members: readonly MemberView[], a: Pick<ProAssignment,'worker'|'category'>): ReassignCandidate[]; memberTradesBody(tradeIds); canEditMember(m, myUserId): boolean; inviteBody(form); inviteActive(i, nowMs): boolean; luhnValid(digits): boolean; payoutMethodBody(form); settingsFormOf(c: CompanyView); settingsBody(current: CompanyView, form: SettingsForm); quoteFeePreview(feePerWorkerDay, workers, days): number | null; projectDays(from, to): number; defaultQuoteForm(p); quoteBody(form, companyId); reportBody(form, companyId); completeBody(lines, companyId); linesSubtotal(lines); quoteWindowOpen(p, nowMs); asScope(v); etaMinutes(sec); customerShortName({ firstName, lastInitial, companyName? }): string; managerCanEnterPrice(a, finalPriceEntry): boolean; feeState(a): 'held' | 'captured' | 'refunded' | 'released' | null; pageVersion(page, sig): string; requestNo(n); personName(p)
- src/features/company/server.ts (server-only): loadCompany<T>(companyId: string, fn: (client: ApiClient, ctx: ManagerContext) => Promise<T>): Promise<{ ctx: ManagerContext; result: Loaded<T> }>; section<T>(promise: Promise<T>, locale: string): Promise<Loaded<T>>; optional<T>(promise: Promise<T>): Promise<T | null>; toLoadError(err, locale): Promise<CompanyLoadError>; isNotFound(err): boolean; COMPANY_LOGIN_EXPIRED = '/company/login?expired=1'
- src/features/company/actions.ts ('use server', all return ActionResult<T>, MANAGER only): companyOffersAction(companyId); acceptOfferAction(companyId, offerId, workerIds: string[], idempotencyKey: string); declineOfferAction(companyId, offerId); activeAssignmentsAction(companyId); workersLiveAction(companyId); listAssignmentsAction(companyId, query: { scope?; cursor?; limit? }); enterPriceAction(companyId, assignmentId, body: { labor; materials }, idempotencyKey); reassignAction(companyId, assignmentId, workerId); cancelAssignmentAction(companyId, assignmentId, reason: string | undefined, idempotencyKey); updateMemberAction(companyId, userId, body: { role?; tradeIds? }); removeMemberAction(companyId, userId); createInviteAction(companyId, body); revokeInviteAction(companyId, inviteId); listTransactionsAction(companyId, query); topupAction(companyId, amount: number, idempotencyKey); setPayoutMethodAction(companyId, body); updateSettingsAction(companyId, body); submitQuoteAction(companyId, projectId, body, idempotencyKey)  // companyId forced to this company; withdrawQuoteAction(companyId, quoteId, projectId); addReportAction(companyId, projectId, body); completeProjectAction(companyId, projectId, body, idempotencyKey)
- Components (client): DispatchBoard(props: DispatchBoardProps), OfferCard, JobsBoard, WorkersMap; AssignmentActions({ companyId, assignment, finalPriceEntry, candidates }), PriceDialog, ReassignDialog, CancelAssignmentButton; OrdersTable({ companyId, scope, initialPage }); MembersTable, InvitesManager, CopyButton; TopupForm, TransactionsTable, PayoutMethodFormView; QuoteFormView, WithdrawQuoteButton, ReportFormView, CompleteProjectForm, InvoiceCard; CompanySettingsForm({ company, tradeOptions }); CompanyLiveRefresh({ companyId, topics, intervalMs?, debounceMs? }); CompanyLoadError({ error })

### Deviations from the plan

- The worker picker lets the manager pick offline workers (flagged 'Oflayn'), because B1's acceptCompany only refuses BUSY, NO_TRADE, NOT_APPROVED and NOT_A_MEMBER. Busy workers and workers without the trade are disabled. A new offer preselects the best free online worker, as on board 04.
- acceptOfferAction and reassignAction send handyman profile ids (OfferCandidateWorker.handymanId / MemberView.handymanId). B1 accepts handyman or user ids, and the E2E run confirmed that B3's reassign accepts the handyman id.
- Members (Ustalar page): the manager cannot change their own role or remove themselves from the panel (canEditMember). Trade editing offers only the company's trades, matching B2's updateMember rule.
- Manager price entry is shown when company.finalPriceEntry = MANAGER and the job is ARRIVED (or actions.enterPrice is true). With WORKER, a note says the worker enters the price. Cancel is shown for ACCEPTED/EN_ROUTE jobs (or when actions.cancel is true), and reassign for ACCEPTED jobs.
- Daily report photos are not uploaded from the panel: the form says photos are added from the TezFiks Usta app. The note, progress and date are sent.
- Top-up returnUrl is built server-side from the request Origin header (falling back to X-Forwarded-Host/Host): <origin>/tezfix/company/<id>/balance?topup=done. The test checkout redirects there, and the E2E run confirmed it.
- The payout card form mirrors the API's own rules (Luhn for cards; AZ + 2 digits + 4-letter bank code + 20 alphanumerics for IBAN). The real API returned 400 for a non-Luhn number during the E2E run, so the client check was added. My own new test's sample card number was changed to a Luhn-valid one; no existing test was changed.
- Translation placeholders use only names from the sample list in P0's existing test/i18n.test.ts ('can format every message'): {{value}}, {{amount}}, {{fee}}, {{name}} and similar. That test was not changed; my messages were renamed to fit it.
- Reused generic UI pieces from P1's src/features/admin/components/ui.tsx (Select, Section, InfoList, Rating, TabLinks, RowLink, PhotoGrid) by importing them; no P1 file was edited.

### Contract additions

- (none)

### Open issues / notes for other lanes

- A3 / wave 5: the API's Socket.IO server does not answer in the E2E run (API compiled with tsc and started with node dist/.../main.js on port 3122). GET /tezfix/api/socket.io/?EIO=4&transport=polling returns Nest's 404, a websocket upgrade gets no response, and a socket.io-client from Node gets 'websocket error'. The panel header therefore shows 'Bağlantı yoxdur' (P1 saw the same thing). The dispatch board still works through polling (offers 10 s, workers 15 s, jobs 30 s, plus router.refresh after accept), but live socket updates were not verified end to end. Someone should check that the gateway attaches to the HTTP server in the production entry point (main.ts / IoAdapter).
- P0 DataTable: initialPage is passed to useQuery as initialData, so after router.refresh() the table keeps its cached rows for the same queryKey. P2 works around this by putting pageVersion(initialPage) into its table query keys. P1's admin tables have the same behaviour.
- B2: MemberView.busy appears false for a worker whose job is PRICE_PROPOSED. 'Busy' seems to cover only ACCEPTED/EN_ROUTE/ARRIVED; this matches dispatch eligibility and is noted only for UI wording.
- Invite URLs come from the API's PUBLIC_BASE_URL (/tezfix/join/<token>). In production this must be the public origin that serves the panel (nginx), or the links point to the API host.
- Leftover E2E resources, kept for reuse in wave 5: Postgres database tezfiks_p2e2e (127.0.0.1:55432) with an approved company, 3 workers, one completed B2B project and invoice; Redis db 14 with prefix p2e2e. Harness scripts are in the scratchpad: C:\Users\prekl\AppData\Local\Temp\claude\C--Users-prekl-tezfiks\834c9570-aa00-4514-a164-2268ef7954ba\scratchpad\p2-e2e\ (seed.mjs, crawl.mjs, request.mjs, pinger.mjs, worker-arrive.mjs, project.mjs, accept-quote.mjs). The E2E admin is p2admin@tezfiks.az / P2-e2e-Passw0rd!. All E2E servers (3120, 3121, 3122) were stopped by exact PID.
- P0's scripts/smoke.mjs still leaves `next start` running on Windows (its taskkill /T does not kill the server). I killed the leftover on 3120 by PID. The script is not P2-owned, so it was not changed.

