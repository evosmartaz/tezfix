# Wave 1 handoff (implemented, reviewed, fixed; commit 2eefc4a)

Read the section of every lane whose services you use. Exported services are the exact signatures the code has now; prefer reading the source when in doubt.

## A1 - Identity, sessions, files

Final tests: 82 passed / 0 failed, typecheck clean: true

### Exported services

- FilesModule exports FilesService and STORAGE_DRIVER; UsersModule exports MeService; AuthModule exports OtpService and AdminAuthService (unchanged)
- FilesService: ref(file: File | string, opts?: { adminId?: string }): Promise<FileRef>; refs(ids: string[], opts?): Promise<FileRef[]>; refOf(file: File, opts?): FileRef; signedUrl(file: Pick<File,'id'|'kind'>, opts?): string
- FilesService: assertOwned(userId: string, fileIds: string[], kinds?: readonly FileKind[]): Promise<void> (FILE_NOT_OWNED, details.fileIds)
- FilesService: read(fileId: string): Promise<{ buffer: Buffer; contentType: string }>; markPurge(fileIds: string[], at: Date): Promise<void>; purgeDue(limit?: number): Promise<number>
- FilesService: upload(userId: string, kind: FileKind, input: { buffer: Buffer; mimetype: string; size: number }): Promise<FileRef>; download(fileId: string, exp: string, sig: string): Promise<{ buffer: Buffer; contentType: string; cacheControl: string }>
- Constants (files.service.ts): FILES_PURGE_JOB = 'files.purge' (job handler + reconciler task + BullMQ job scheduler id), FILES_PURGE_CRON = '15 4 * * *' (Asia/Baku), KYC_URL_MAX_TTL_SEC = 600, MAX_HEIC_PIXELS = 40_000_000
- StorageDriver port: token STORAGE_DRIVER; put(key, body, contentType): Promise<void>; get(key): Promise<Buffer | null>; delete(key): Promise<void>; createStorageDriver(env: Env): StorageDriver (files.module.ts)
- MeService: getMe(userId: string): Promise<Me>; update(userId, { firstName?, lastName?, locale?, photoFileId?: string | null }): Promise<Me>; registerDevice(userId, RegisterDeviceInput): Promise<void>; deleteAccount(userId): Promise<void>
- me.service.ts constants: OPEN_REQUEST_STATUSES = ['SEARCHING','ASSIGNED','IN_PROGRESS']; FILE_KINDS_KEPT_ON_ACCOUNT_DELETION = ['REPORT_PHOTO','CASE_PHOTO','COMPANY_DOC']
- OtpService: request(input: { phone; app; locale }, meta: { ip }): Promise<OtpRequestResult>; verify(input: { challengeId; code; deviceId; app }, meta: { ip; userAgent }): Promise<{ tokens: IssuedTokens; me: Me; isNewUser: boolean }>
- AdminAuthService: login(input: { email; password }, meta: { ip; userAgent }): Promise<{ tokens: IssuedTokens; admin: AdminMe }>
- OTP channel port (auth/otp/otp-channel.ts): OTP_CHANNEL, OTP_FETCH, ConsoleOtpChannel, WhatsAppCloudOtpChannel, WebhookOtpChannel, createOtpChannel(env, fetchFn), signWebhookBody(rawBody, secret)

### Deviations from the plan

- The daily purge now runs as a real BullMQ job scheduler ('files.purge', 04:15 Asia/Baku), registered from FilesService.onApplicationBootstrap. The earlier 'reconciler only' deviation is withdrawn. The reconciler task with the same name is kept as a safety net, for example after downtime. In JOBS_MODE=manual the cron is a no-op, so tests drive the purge with runNow or the reconciler.
- HEVC-coded HEIC is decoded in WebAssembly by heic-decode 2.1.0 (libheif-js 1.23.5, LGPL-3.0, loaded lazily with a dynamic import), because prebuilt sharp has no HEVC decoder. The decode is synchronous wasm on the main thread, roughly 1-2 s of event-loop time for a 12 MP iPhone photo. Inputs over 40 MP get FILE_TOO_LARGE with details.maxPixels before decoding.
- Signed URL expiry is rounded DOWN to a bucket of min(300 s, TTL/2), so a URL never lives longer than FILE_URL_TTL_SEC and always lives at least TTL/2. KYC (admin-only) URLs last exactly min(FILE_URL_TTL_SEC, 600 s), following spec §12, and are not rounded.
- Product decision: account deletion purges personal files (PROFILE_PHOTO, REQUEST_PHOTO, all KYC_* kinds) at once. It keeps REPORT_PHOTO, CASE_PHOTO and COMPANY_DOC, because they belong to other parties' records (delivered B2B reports, dispute evidence, company documents). The plan said 'the user's files'. These files stay attached to the anonymized user and are left to those records' own retention.
- deleteAccount also refuses with INVALID_STATE (details.reason='COMPANY_ACTIVE_ASSIGNMENT', companyId, assignmentId) when the user is the last ACTIVE MANAGER of a company with an assignment in an active status. The plan does not cover this case.
- deleteAccount runs its checks and the anonymization in one transaction after SELECT ... FOR UPDATE on the users row. Other lanes' request or assignment creation does not take this lock, so the race is narrowed but not fully closed. Closing it would need B1/B3 to re-check that users.status is ACTIVE inside their own transactions.
- Unchanged from the first pass: bypass phones skip the per-phone cooldown and the hourly limit, but the per-IP limit still applies. This lets several demo testers share one phone, and the reviewer accepted it. Also unchanged: otpVerify gives OTP_INVALID when the app differs from the challenge's app; the webhook payload has an extra 'message' field; only codes that were actually delivered count against the limits.

### Open issues / notes for other lanes

- Patents and licensing: decoding HEVC on the server uses libde265 inside libheif-js (LGPL-3.0). It is only loaded as a separate module, but the founder should know that HEVC decoding is patent-encumbered. If that is a concern, mobile apps can still convert to JPEG before upload, and the server would never need the HEVC path.
- Foundation suggestion: JobsService.repeat() silently does nothing when the queue is missing. It works for feature modules today only because Nest bootstraps global modules first. Having it throw, or log a warning, would make a misconfiguration visible.
- B1/B3 may want to re-check that users.status is ACTIVE (not DELETED) inside their request-creation and accept transactions, to fully close the race in account deletion.
- The S3 driver is tested against a local S3-compatible HTTP server (path-style, SigV4), not against real Supabase Storage, R2 or MinIO.

## A2 - Wallets, payments, payouts

Final tests: 65 passed / 0 failed, typecheck clean: true

### Exported services

- WalletModule exports WalletAccessService, WalletEventsService, WalletAdminService, LedgerIntegrityService (import WalletModule to inject them)
- WalletAccessService.static defaultOwner(app: AppKind): 'customer' | 'handyman'
- WalletAccessService.resolveSelf(user: { userId: string; app: AppKind }, owner?: 'customer' | 'handyman' | null): Promise<{ owner: 'customer' | 'handyman'; accountId: string; customerAccountId: string | null; handymanId: string | null }>
- WalletAccessService.customerWallet(userId: string, db?: Db): Promise<{ customerAccountId: string; walletAccountId: string }>  // throws CUSTOMER_ACCOUNT_REQUIRED
- WalletAccessService.soloHandyman(userId: string): Promise<{ profile: HandymanProfile; walletAccountId: string; earningsAccountId: string }>
- WalletAccessService.managedCompany(userId: string, companyId: string): Promise<Company>  // NOT_FOUND / NOT_COMPANY_MANAGER
- WalletAccessService.isCompanyManager(userId: string, companyId: string): Promise<boolean>
- WalletEventsService.notifyAccount(accountId: string): Promise<void>
- WalletEventsService.notifyAccounts(accountIds: Array<string | null | undefined>): Promise<void>
- WalletAdminService.adjust(adminId: string, input: { owner: { type: 'CUSTOMER_ACCOUNT' | 'HANDYMAN' | 'COMPANY'; id: string }; account: 'WALLET' | 'EARNINGS'; amount: number; reason: string }, ip: string | null): Promise<{ wallet: WalletSummary; transactionId: string }>
- WalletAdminService.listTransactions(q: { cursor?: string; limit?: number; kind?: LedgerTxKind; ownerType?: LedgerOwnerType; ownerId?: string }): Promise<{ items: AdminLedgerTx[]; nextCursor: string | null }>
- WalletAdminService.forRequest(requestId: string, db?: Db): Promise<AdminLedgerTx[]>
- fullName(first: string | null | undefined, last: string | null | undefined): string  // wallet-admin.service.ts
- LedgerIntegrityService.checkNow(): Promise<Array<{ accountId: string; posted: number; computedPosted: number; held: number; computedHeld: number }>>
- LedgerIntegrityService.runDaily(): Promise<IntegrityMismatch[] | null>
- PaymentsModule exports PaymentsService and PAYMENT_PROVIDER
- PaymentsService.createIntent(input: { purpose: PaymentPurpose; amount: number; payerUserId: string; creditAccountId: string; assignmentId?: string | null; invoiceId?: string | null; companyId?: string | null; returnUrl?: string | null }, db?: Db): Promise<{ intent: PaymentIntent; checkoutUrl: string }>
- PaymentsService.settle(intentId: string, status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED', reason?: string | null): Promise<PaymentIntent>  // idempotent; key payment:<intentId>
- PaymentsService.find(intentId: string, db?: Db): Promise<PaymentIntent | null>
- PaymentsService.view(intent: PaymentIntent): PaymentIntentView
- interface PaymentProvider { name: string; createCheckout(intent: PaymentIntent): Promise<{ providerRef: string | null }>; checkoutUrl(intent): string | null }  // token PAYMENT_PROVIDER, default FakePaymentProvider
- checkoutLocale(header: string | string[] | undefined): Locale; class CheckoutLinkFilter (payments/checkout-link.filter.ts)
- PayoutsModule exports PayoutsService
- PayoutsService.earnings(owner: PayoutOwner): Promise<EarningsView>
- PayoutsService.getMethod(owner: PayoutOwner): Promise<PayoutMethodView | null>
- PayoutsService.setMethod(owner: PayoutOwner, body: { type: PayoutMethodType; number: string; holderName: string }): Promise<PayoutMethodView>
- PayoutsService.runPayouts(): Promise<{ created: number; total: number }>
- PayoutsService.markPaid(payoutId: string, adminId: string, ip: string | null): Promise<AdminPayoutRow>
- PayoutsService.markFailed(payoutId: string, adminId: string, reason: string, ip: string | null): Promise<AdminPayoutRow>
- PayoutsService.onPayoutPaid(payout: Payout): Promise<void>  // integration-wave hook (no-op)
- PayoutsService.onPayoutFailed(payout: Payout): Promise<void>  // integration-wave hook (no-op)
- startOfBakuWeek(at: Date): Date, payoutView(p: Payout): PayoutView, PAYOUTS_WEEKLY_JOB = 'payouts.weekly', PAYOUTS_WEEKLY_CRON = '0 9 * * 1' (payouts.service.ts)
- maskPayoutNumber(type: PayoutMethodType, raw: string): string | null, luhnValid(digits: string): boolean (payout-method.ts)
- sanitizeReturnUrl(raw, env): string | null, withPaymentResult(url, paymentIntentId, status): string (payments/return-url.ts)

### Deviations from the plan

- The checkout GET/POST answer contract-schema failures (a missing t, or a malformed intent id) with the 403 HTML invalid-link page, not the generic 400 JSON error. This is done with a route-scoped CheckoutLinkFilter. Other errors on these routes still render as JSON through the global ErrorFilter.
- payment.failed is also emitted for CANCELLED intents, with reason 'cancelled'. The plan only names FAILED; listeners should treat both as 'not paid'.
- payment:updated is also sent to the company room for company intents, in addition to the payer.
- Domain-event listener failures inside settle() are caught and logged instead of thrown, because the payment is already committed. Listeners must be idempotent and repair through their own reconcilers.
- thisWeek.tips is summed from Assignment.tipAmount of assignments completed this Baku week, using Clock-based completedAt, not by when the tip was paid. Ledger entry timestamps come from the database clock, not the business Clock.
- Nightly ledger.integrity is a reconciler task, gated by a Redis marker to run once per Baku day from 03:00 Baku. LedgerIntegrityService.checkNow() runs it on demand.
- markPayoutPaid/markPayoutFailed on a payout that is not PENDING returns INVALID_STATE (409); an unknown payout returns NOT_FOUND.
- WalletAccessService.soloHandyman creates missing WALLET/EARNINGS ledger accounts for a SOLO profile on first use (a robustness fallback).
- wallet:updated is emitted only for WALLET accounts, because the payload has no account kind. EARNINGS credits do not emit it.
- PaymentIntentView.checkoutUrl is returned only while the intent is CREATED, otherwise null. An admin-ledger actor is the admin's name (falls back to email), the user's full name for USER actors, and null for SYSTEM.
- A returnUrl that is not allowed is dropped (stored as null) when the intent is created; it is checked again before redirecting.
- PaymentIntent.createdAt and Payout.createdAt are set from the Clock explicitly. The earnings payouts list is ordered by createdAt desc, then id desc.

### Open issues / notes for other lanes

- Foundation: LedgerTransaction and LedgerEntry createdAt use the database default now(), not the business Clock, and LedgerService.releaseHold/captureHold set resolvedAt with new Date(). Weekly or daily figures built from ledger timestamps will disagree with the Clock in tests and the demo. Suggested fix: pass clock.now() into ledger writes (foundation-owned).
- The weekly payout cron is registered through JobsService.repeat, which does nothing when JOBS_MODE=manual (tests). It was not exercised end-to-end with BullMQ, and nothing re-runs a missed weekly payout apart from admin runPayouts.
- CREATED payment intents never expire; there is no reconciler to cancel abandoned checkouts. Lane B3 can call settle(id, 'CANCELLED', 'superseded') when a customer switches to cash.
- PayoutsService.onPayoutPaid/onPayoutFailed are no-op hooks; payout notifications are left for the integration wave as planned.
- Minor, not fixed: tips are attributed to the week of the assignment's completedAt, not the week the tip was paid. Some fallback strings stay hard-coded: the 'admin' actor fallback, the '—' owner name, and 'invalid card number'/'invalid IBAN' in VALIDATION_FAILED details.
- The tests for the 303 redirect and for Accept-Language temporarily add the landing server's origin to the injected ENV.CORS_ORIGINS and restore it in finally. No production code reads a changed env.
- The contract-coverage test (test/contract-coverage.spec.ts) will keep failing until every lane is finished. All A2 endpoints are registered.

## A3 - Realtime gateway, presence, notifications, push

Final tests: 106 passed / 0 failed, typecheck clean: true

### Exported services

- RealtimeModule exports PresenceService, RoomAccessService
- PresenceService.setOnline(handymanId: string, loc?: LatLng): Promise<PresenceState | null>  // call after committing DB isOnline/onlineSince; keeps busy of a live entry; clears the offline marker
- PresenceService.setOffline(handymanId: string): Promise<void>  // atomic; leaves a 120 s offline marker
- PresenceService.updateLocation(handymanId: string, loc: { lat: number; lng: number; heading?: number; speed?: number; accuracy?: number; at?: string | Date; assignmentId?: string }): Promise<LocationEvent | null>  // never changes busy/online
- PresenceService.touch(handymanId: string): Promise<boolean>
- PresenceService.setBusy(handymanId: string, busy: boolean): Promise<void>
- PresenceService.get(handymanId: string): Promise<PresenceState | null>
- PresenceService.candidatesInCells(cells: string[], freshWithinSec: number): Promise<PresenceEntry[]>  // PresenceEntry = { handymanId; userId; companyId: string|null; lat; lng; busy; ts }
- PresenceService.onLocation(handler: (e: LocationEvent) => Promise<void>): () => void  // LocationEvent = { handymanId; userId; companyId: string|null; lat; lng; heading: number|null; speed: number|null; accuracy: number|null; at: Date; receivedAt: Date; assignmentId: string|null /* raw, untrusted */; verifiedAssignmentId: string|null /* own assignment only */; cell7; cell9; online: boolean }
- PresenceService.snapshot(opts?: { force?: boolean }): Promise<{ written: number; wentOffline: number }>  // reconciler task 'presence.snapshot' uses force:false
- RoomAccessService.initialRooms(p: Principal): Promise<string[]>; canJoin(p: Principal, target: RoomJoin): Promise<boolean>; roomName(target: RoomJoin): string
- RoomAccessService.refreshUser(userId: string): Promise<{ left: number; joined: number }>  // re-syncs a user's live sockets after a membership change; never throws
- RealtimeGateway.sweep(): Promise<{ disconnected: number; left: number; joined: number }>  // reconciler task 'realtime.sweep'
- NotificationsModule exports NotificationsService, PushService, LogPushSender
- NotificationsService.notify(userId: string, type: NotificationType, opts?: NotifyOptions): Promise<NotificationView | null>
- NotificationsService.notifyMany(userIds: string[], type: NotificationType, opts?: NotifyOptions): Promise<NotificationView[]>
- NotifyOptions = { vars?: Record<string, string|number>; data?: Record<string, unknown>; app?: 'CUSTOMER'|'PRO'|'PANEL'; push?: boolean; priority?: 'high'|'normal'; ttlSec?: number; collapseKey?: string; channelId?: 'offers_v1'|'default_v1' }
- NotificationsService.list(userId: string, cursor: string | undefined, limit?: number): Promise<{ items: NotificationView[]; nextCursor: string | null }>; unreadCount(userId: string): Promise<number>; markRead(userId: string, input: { ids?: string[]; all?: boolean }): Promise<number>
- PushService.sendToUsers(userIds: string[], message: PushMessage, filter?: { app?: AppKind }): Promise<{ attempted: number; delivered: number; removedTokens: number }>  // never throws
- PushService.deliver(deliveries: PushDelivery[], message: PushMessage): Promise<PushOutcome>
- new FcmPushSender(env: Pick<Env,'FCM_SERVICE_ACCOUNT'>, messaging?: FcmLikeMessaging, opts?: { loader?: () => Promise<FcmLikeMessaging | null>; retryAfterMs?: number })
- LogPushSender.sent; sentTo(userId: string, type?: string); clear()
- PUSH_SENDERS injection token (Record<'log'|'expo'|'fcm', PushSender>)

### Deviations from the plan

- The gateway registers its socket handlers itself (inside afterInit) instead of using @SubscribeMessage. Unchanged from the first pass.
- Presence uses a fourth Redis key, hmoff:<id>: a 120 s offline marker written by setOffline and cleared by setOnline. While it exists, a rebuild of an expired entry never comes back online. Pings still keep an offline tracking entry, as before.
- setOnline keeps the busy flag of an entry that already exists, because setBusy owns busy. A new entry still computes busy from the database.
- LocationEvent has a new field, verifiedAssignmentId: string | null. It equals assignmentId only when the assignment belongs to the pinging handyman. assignmentId stays the raw client value, because an existing test asserts it is passed through unchanged.
- snapshot(opts?: { force?: boolean }). A direct call defaults to force=true and always writes. The reconciler task calls force=false, which writes the database location snapshot at most every 60 s of Clock time (shared through Redis key pres:snapAt). The offline sweep and the Redis-to-database check run on every tick.
- The offline sweep is a raw UPDATE ... RETURNING on handyman_profiles. It sets isOnline=false and updatedAt=Clock now, only when COALESCE(GREATEST(lastSeenAt, onlineSince), -infinity) is older than the cutoff and the pro's Redis entry is not fresh. The location write is one bulk UPDATE built from a JSON list of rows.
- New reconciler task, realtime.sweep, owned by the gateway. It disconnects sockets whose session was revoked or whose user is blocked, and calls RoomAccessService.refreshUser for each connected user. Every room:join, room:leave, pro:location and pro:heartbeat also re-checks the session (cached by SessionsService); on failure it acks {ok:false, error:'UNAUTHORIZED'} and disconnects.
- Expired access tokens on sockets that are already connected are not disconnected; only a revoked session or blocked user is. Reconnecting needs a valid token.
- FcmPushSender's constructor takes a third, optional argument, opts { loader?, retryAfterMs? (default 60000) }. A failed init is retried after that delay, measured in wall-clock time (infrastructure, not business time).
- Phone redaction also masks numbers without a 0 or 994 prefix that start with an AZ operator or landline code (10, 12, 50, 51, 55, 60, 70, 77, 99), matched only at word boundaries.

### Open issues / notes for other lanes

- Rare remaining window: if the accept transaction commits while the presence hash is expired (the pro sent no ping for over 120 s) and a rebuild read the database before the commit, the rebuilt entry has busy=false until the next setBusy. setBusy does nothing on a missing entry by design.
- Being in a company room does not depend on company status (a blocked or rejected company's managers stay in the room). That matches canJoin's rules from the plan; change it if company blocking should also silence the dispatch board.
- B2 must commit isOnline (and onlineSince=now when going online) before calling PresenceService.setOnline/setOffline, and must call RoomAccessService.refreshUser(userId) after removing, demoting or promoting a member. The realtime.sweep reconciler task is the safety net (one tick, default 30 s).
- B3's ETA and contact-unlock updater must use LocationEvent.verifiedAssignmentId, never assignmentId.
- Unchanged from the first pass: Expo receipts are not polled, there is no Socket.IO Redis adapter (fine for ROLE=all), socket events are not rate-limited, and the notifications list is not filtered by app.
- Scratch scripts that reproduce the old race (not part of the repo): C:\Users\prekl\AppData\Local\Temp\claude\C--Users-prekl-tezfiks\834c9570-aa00-4514-a164-2268ef7954ba\scratchpad\race3\race.spec.ts

## A4 - Categories, geo, AI

Final tests: 58 passed / 0 failed, typecheck clean: true

### Exported services

- CategoriesModule exports CategoriesService (src/modules/categories/categories.service.ts); type CategoryRow = Prisma Category
- CategoriesService.get(id: string, db?: Db): Promise<CategoryRow>  // NOT_FOUND
- CategoriesService.find(id: string, db?: Db): Promise<CategoryRow | null>
- CategoriesService.getBySlug(slug: string, db?: Db): Promise<CategoryRow>  // NOT_FOUND
- CategoriesService.requireInstantService(id: string, db?: Db): Promise<CategoryRow>  // NOT_FOUND | CATEGORY_INACTIVE | VALIDATION_FAILED (group) | CATEGORY_REQUIRES_QUOTE
- CategoriesService.requireQuoteService(id: string, db?: Db): Promise<CategoryRow>  // NOT_FOUND | CATEGORY_INACTIVE | VALIDATION_FAILED | CATEGORY_NOT_INSTANT
- CategoriesService.name(category: Pick<CategoryRow,'nameAz'|'nameRu'|'nameEn'>, locale: Locale): string
- CategoriesService.ref(category: CategoryRow, locale: Locale): CategoryRef
- CategoriesService.refs(ids: Iterable<string>, locale: Locale, db?: Db): Promise<Map<string, CategoryRef>>
- CategoriesService.view(category: CategoryRow, locale: Locale): Category (contract CategorySchema)
- CategoriesService.activeCategories(vertical?: Vertical, db?: Db): Promise<CategoryRow[]>
- CategoriesService.activeServices(vertical?: Vertical, db?: Db): Promise<CategoryRow[]>
- CategoriesService.all(db?: Db): Promise<CategoryRow[]>
- GeoModule exports GeoService (src/modules/geo/geo.service.ts); injection token GEO_FETCH: (input: string, init?: RequestInit) => Promise<Response>
- GeoService.mapsEnabled: boolean (getter)
- GeoService.reverse(lat: number, lng: number, locale: Locale): Promise<GeoAddress>
- GeoService.autocomplete(q: string, sessionToken: string, bias: LatLng | null | undefined, locale: Locale): Promise<{ items: { placeId: string; primary: string; secondary: string | null }[]; source: 'google' | 'fallback' }>
- GeoService.place(placeId: string, sessionToken: string | null | undefined, locale: Locale): Promise<GeoAddress>  // NOT_FOUND when unresolvable
- GeoService.route(origin: LatLng, destination: LatLng, opts?: { trafficAware?: boolean }): Promise<RouteResult>  // RouteResult = { polyline: string; durationSec: number; distanceM: number; source: 'google' | 'fallback'; computedAt: Date }
- GeoService.fallbackRouteResult(origin: LatLng, destination: LatLng): RouteResult
- GeoService.progressAlong(polyline: string, current: LatLng, totalDurationSec: number): { remainingDistanceM: number; remainingSec: number; offRouteM: number }
- GeoService.cell7(lat: number, lng: number): string; GeoService.cell9(lat: number, lng: number): string
- baku-districts.ts: nearestBakuDistrict(point: LatLng): BakuDistrict | null; BAKU_DISTRICTS
- AiModule exports AiService (src/modules/ai/ai.service.ts); injection token ANTHROPIC_CLIENT: AnthropicMessagesClient | null ({ messages: Pick<Anthropic['messages'], 'parse'> })
- AiService.classify(input: { userId: string; fileId: string; image: Buffer; note?: string | null; vertical?: Vertical | null; locale: Locale }): Promise<ClassifyPhotoResponse>  // throws NOT_FOUND | FILE_TYPE_NOT_ALLOWED (KYC) | FILE_NOT_OWNED | RATE_LIMITED; every other failure -> status 'unavailable'
- AiService.recordFinalCategory(userId: string, fileId: string, categoryId: string): Promise<void>
- AiService.enabled: boolean; AiService.model: string (getters)

### Deviations from the plan

- Structured output: SDK 1.3.0's zodOutputFormat() turns JSON-schema `enum` into description text, so the category would not actually be limited to the catalogue slugs. The API does support `enum`. AiService therefore sends an explicit JSON schema with real enums (category = active service slugs + other + unsure; confidence = high|medium|low; candidates items = service slugs) via jsonSchemaOutputFormat(schema, { transform: false }). It still calls messages.parse and re-checks the output with zod; anything that fails the check is logged as parse_error and returns status unavailable.
- AiService.classify also checks the file itself: unknown or deleted file -> NOT_FOUND; KYC kinds (KYC_* and COMPANY_DOC, via isKycFileKind) -> FILE_TYPE_NOT_ALLOWED, with Claude never called and nothing logged; a file owned by another user -> FILE_NOT_OWNED. It also enforces a per-user limit of 20 classifications per 600 s (RATE_LIMITED), as spec §15 asks for per-user AI rate limits. B1 can rely on these or repeat its own checks.
- AI request settings: max_tokens 1024 (room for Haiku 5.5's default thinking), output_config.effort 'low', no sampling parameters. The system prompt is one text block with cache_control ephemeral. It contains only catalogue data and the decision rules, so it stays byte-identical between calls and can be cached. The customer note goes in the user turn and is marked as untrusted.
- AI response mapping: candidates list the chosen slug first, then the model's candidates, de-duplicated, catalogue slugs only, at most 3, names localized. status 'ok' only for a catalogue slug with high or medium confidence. low confidence, 'unsure' or 'other' give status 'unsure' with categoryId/slug null and the model's confidence. All failures (no key 'not_configured', unreadable image 'image_invalid', refusal, timeout, connection or API error, parse error) give status 'unavailable' and are logged with an error string.
- The no-key case also writes an AiClassification row (error 'not_configured'), because the plan says to log every call.
- GeoService.place without a key, on a provider error, or with no location in the response throws NOT_FOUND (details.reason 'maps_unavailable' where it applies). The contract has no maps-unavailable error code, and fallback autocomplete never returns place ids.
- When Google gives no address component for the district, reverse/place fill it from the nearest Baku district centroid. A point more than 25 km from every centroid gets district null, so places outside Baku are not given a Baku raion.
- Autocomplete with no lat/lng sends a 30 km bias circle around BAKU_CENTER.
- Public categories.list and requireInstantService/requireQuoteService treat a service under an inactive GROUP as inactive (hidden / CATEGORY_INACTIVE).
- Extra admin validation beyond the plan: a GROUP with children cannot become a SERVICE or change vertical; a service cannot be its own parent. Keywords are trimmed, de-duplicated, and empty ones are dropped. OPERATOR admins may manage categories.
- GeoService.route returns computedAt as a Date (from Clock) rather than an ISO string, which is convenient for B3 to store; convert with iso() for RouteSchema.
- No server i18n file was needed: everything user-facing comes from DB names or the district table. packages/i18n/locales/*/server/catalog.json was not created.

### Open issues / notes for other lanes

- B1 owns POST /requests/classify-photo. It should load the REQUEST_PHOTO bytes through the files service and call AiService.classify({ userId, fileId, image, note, vertical, locale }). Once the request is created, it should call AiService.recordFinalCategory(userId, fileId, categoryId).
- /config/public aiEnabled/mapsEnabled are owned by the foundation health controller. AiService.enabled and GeoService.mapsEnabled are available if the owner wants to use them.
- @anthropic-ai/sdk 1.3.0's zodOutputFormat drops enum constraints (see deviations). If other lanes use structured outputs, they should use jsonSchemaOutputFormat with transform:false for enums.
- No real Google or Anthropic calls were made: no keys are configured. The request shapes are checked against a mocked fetch and a fake Anthropic client.

## M0 - Mobile foundation

Final tests: 184 passed / 0 failed, typecheck clean: true

### Exported services

- createAuthStore(deps: { storage: KeyValueStorage; refresh(refreshToken: string, deviceId: string): Promise<AuthTokens>; fetchMe(): Promise<Me>; logoutRemote?(accessToken: string, refreshToken: string | null): Promise<void>; onSignedOut?(): void }): AuthStore  // restore(): only session-ending errors sign out, all others -> 'offline'; logout(): waits for an in-flight refresh, retries once after refresh on 401
- EntryGate { segment: string; href: string; allow?: readonly string[] }; EntryRoutes { auth, profile, onboarding, offline: EntryGate; main: { href: string } }; entryRedirect(target, firstSegment, routes): string | null
- PickedImage { uri: string; mimeType?: string | null; fileName?: string | null; width?: number | null; height?: number | null }
- prepareImageForUpload(image: PickedImage, opts?: { maxSide?: number; quality?: number }): Promise<PickedImage>  // longest side <= 1600 px, JPEG 0.8; never throws
- uploadImage(client: ApiClient, image: PickedImage, kind: FileKind, opts?: { resize?: boolean | { maxSide?: number; quality?: number } }): Promise<FileRef>  // now exported from src/images.ts via the index
- fitWithin(width: number, height: number, maxSide: number): { width: number } | { height: number } | null; UPLOAD_MAX_SIDE = 1600; UPLOAD_JPEG_QUALITY = 0.8
- usePushRegistration(channelNames: { offers: string; default: string }): RegisterPushResult | null  // waits for non-empty names, renames channels on language change, registers again per session
- openNavigation(lat, lng): Promise<void>  // openURL google.navigation, falls back to web directions on rejection
- Config plugin '@tezfiks/mobile/plugins/with-dev-cleartext' with options { apiUrl } (exports urlHost, cleartextHosts, networkSecurityXml, debugNetworkSecurityXml, applyToManifest, DEV_HOST_ALIASES)
- Config plugin '@tezfiks/mobile/plugins/with-navigation-queries' (exports addNavigationQueries, NAVIGATION_SCHEMES)

### Deviations from the plan

- Test change, because the old assertion contradicted the plan. In apps/customer and apps/pro test/app-config.test.ts, the assertion that expo-build-properties sets `usesCleartextTraffic: true` encoded the reviewed defect (cleartext HTTP to every host). The plan says cleartext is allowed only 'for the dev API (http://10.0.2.2)'. I replaced it with stricter checks: usesCleartextTraffic is not true; the with-dev-cleartext plugin is configured with the API URL; that config allows 10.0.2.2 for the dev URL and nothing for an https production URL; and the with-navigation-queries plugin is registered and resolvable. All other assertions are unchanged.
- Debug and debugOptimized builds allow cleartext to any host through a debug-only network security config. This is needed so the app can load its JS bundle from Metro over http, including from a LAN IP on a physical device, and is the same as React Native's default debug manifest. Release builds allow cleartext only for the dev API host and the emulator/loopback aliases, and only when the API URL itself is http.
- Logout does not check access-token expiry against the device clock. It tries the current token, and on a 401 refreshes once and retries. The test fixtures' fixed expiry (2026-10-25T10:15Z) is already in the past on the real clock, and a clock check would also misbehave on phones with a wrong clock.
- Logout does not clear the device's push token (no registerDevice with pushToken:null). The existing runtime test asserts that logout makes exactly one HTTP call, and clearing the token on logout is better done on the server (see openIssues).
- Test setup now installs React Native's FormData globally (react-native/Libraries/Network/FormData), matching what runs on the device. Node's FormData would turn `{ uri, name, type }` file parts into strings.
- Added the dev dependency expo-image-manipulator@58.0.15 to @tezfiks/mobile (via scripts/npm-safe.mjs, same version as the apps and already hoisted) and a peerDependency "*".

### Open issues / notes for other lanes

- For lane A1 (server): POST /auth/logout should null the pushToken on the logged-out session's device rows. Otherwise a logged-out phone keeps receiving that user's pushes until another user signs in on it. The client cannot do this reliably, because the session may already be revoked or expired.
- Still not verified on an emulator (wave 5): MapView with the placeholder Google key plus OSM UrlTile and mapType none, h3-js polygons on Hermes, and real cleartext behaviour against http://10.0.2.2:3000 with the new network security config. The debug APK has no embedded JS bundle and needs Metro (npx expo start) or a release build.
- For M2: to keep the invite link tezfiksusta://join/<token> open for pro users who still have to onboard, add `allow: ['join']` to the onboarding gate in apps/pro/src/routes.ts. Signed-out users are still sent to login, so the join screen or a +native-intent handler should stash the token until after OTP.
- A release build pointing at a LAN IP must set EXPO_PUBLIC_API_URL to that http URL at prebuild time, so the IP is added to the cleartext allow-list.
- Push: without google-services.json, devices still register with pushToken null (non-fatal by design).

## P0 - Web panel foundation

Final tests: 137 passed / 0 failed, typecheck clean: true

### Exported services

- src/lib/session/server.ts: getSession(): Promise<PanelSession | null>  // PanelSession = { kind: 'admin' | 'company'; accessToken: string }
- src/lib/session/server.ts: requireAdmin(): Promise<AdminContext>  // { session, admin: AdminMe, api: ApiClient, locale: Locale }; redirects to /admin/login?expired=1; throws SessionRefreshUnavailableError when the API was unreachable for the refresh
- src/lib/session/server.ts: requireCompanyUser(): Promise<{ session: PanelSession; me: Me; api: ApiClient; locale: Locale }>
- src/lib/session/server.ts: requireManager(companyId: string): Promise<ManagerContext>  // { session, me, company: Me['companies'][number], api, locale }; notFound() when not MANAGER
- src/lib/session/server.ts: class SessionRefreshUnavailableError extends Error { code: 'NETWORK' }
- src/lib/session/server.ts: getAdmin(): Promise<AdminMe | null>; getCompanyUser(): Promise<Me | null>; managedCompanies(me: Me): ManagedCompany[]; serverApi(session?: PanelSession | null): Promise<ApiClient>; getRequestLocale(): Promise<Locale>; setSessionCookies(tokens: AuthTokens, kind: SessionKind): Promise<void>; clearSessionCookies(): Promise<void>; ensureDeviceId(): Promise<string>
- src/lib/actions/auth.ts ('use server'): adminLoginAction(input: { email: string; password: string; next?: string }): Promise<ActionResult>; companyOtpRequestAction(input: { phone: string }): Promise<ActionResult<OtpChallenge>>; companyOtpVerifyAction(input: { challengeId: string; code: string; next?: string }): Promise<ActionResult>; logoutAction(): Promise<void>; setLocaleAction(locale: Locale): Promise<ActionResult>
- src/lib/errors.ts: type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; code: string; message: string; details?: unknown }; toActionError(err, translate); errorMessageKey(code); isNavigationError(err)
- src/lib/api/create.ts: createServerApi(opts?: { accessToken?: string | null; locale?: Locale; forwardedFor?: string | null; userAgent?: string | null }): ApiClient
- src/components/data-table.tsx: DataTable<T extends RowData>(props: { columns: DataTableColumn<T>[]; queryKey: readonly unknown[]; fetchPage: (cursor: string | null) => Promise<CursorPage<T> | ActionResult<CursorPage<T>>>; initialPage?: CursorPage<T>; getRowId?; rowHref?; onRowClick?; emptyTitle?; emptyDescription?; className? })  // changing queryKey resets to page 1; initialPage is only used for the key it arrived with; dataTableColumns<T>(); dataTableFeatures; type CursorPage<T> = { items: T[]; nextCursor: string | null }
- src/components/status-badge.tsx: StatusBadge<F extends StatusFamily>({ family: F; status: StatusOf<F> | string; className? })
- src/lib/status.ts: statusPresentation(family, status): { labelKey: string; tone }; STATUS_FAMILIES; TONE_CLASSES
- src/components/money.tsx: Money({ minor; colored?; className?; ...FormatMoneyOptions }); src/components/date-time.tsx: DateTime({ value; mode?; className? }); src/lib/format.ts: moneyText, dateTimeText, percentText
- src/components/stat-card.tsx: StatCard({ label; value; hint?; tone?; icon?; className? }); src/components/page-header.tsx: PageHeader({ title; description?; actions?; breadcrumb?; className? })
- src/components/confirm-dialog.tsx: ConfirmDialog({ trigger; title?; description?; confirmLabel?; cancelLabel?; destructive?; children?; onConfirm })
- src/components/form-field.tsx: FormField, TextField<T extends FieldValues>, FormError; src/components/states.tsx: EmptyState, ErrorState; src/components/toaster.tsx: Toaster, toast
- src/components/ui/: Button/buttonVariants, Input, Textarea, Label, Card*, Badge, Table*, Skeleton, Dialog*, Sheet*, Tabs*
- src/components/map/panel-map.tsx: PanelMap({ center?; zoom?; markers?; polygons?; onMarkerClick?; className? }); BAKU_CENTER
- src/lib/realtime/realtime-provider.tsx: RealtimeProvider({ children; url?; enabled? }) (reconnects with backoff after a refused handshake); useRealtime(): { socket; connected; connectionEpoch }; useSocketEvent<E extends keyof ServerToClientEvents>(event: E, handler): void; rejectedHandshakeDelay(attempt: number): number
- src/lib/nav.ts: ADMIN_NAV, companyNav(companyId), isNavActive(item, pathname), proInviteDeepLink(token)
- src/components/shell/app-shell.tsx: AppShell({ subtitle; nav; navNamespace; userName; sidebarFooter?; children }); src/components/placeholder-page.tsx: PlaceholderPage({ titleKey })
- src/lib/utils.ts: cn(...), withBase(className, ...base)

### Deviations from the plan

- The socket-ticket route handler is at /tezfix/bff/realtime-ticket, not /api/realtime-ticket. With basePath /tezfix the plan's path would be /tezfix/api/..., which nginx sends to the NestJS API, so the panel handler would never be reached.
- @hookform/resolvers 6.0.0 was installed with --force because of a conflict between its optional peer dependencies (effect). Only the zod resolver is used. All panel dependency versions are pinned exactly as the plan lists them.
- Navigation URLs use English path names (src/lib/nav.ts); the sidebar labels are in Azerbaijani as on board 05. Lanes P1 and P2 fill these exact paths.
- The company chooser is at /company. A user who manages exactly one company goes straight to /company/<id> after login.
- No webfont is downloaded: Inter comes first in the font stack with system fonts as fallback, so the build needs no network.
- Added a tf_did device-id cookie (httpOnly, path /tezfix) because api.auth.otpVerify requires a deviceId.
- StatusBadge labels: 9 status families use common.* as the plan says. The other 5 (offerStatus, slotStatus, userStatus, holdStatus, memberStatus) use panel.status.*, because common.json is not owned by P0 and has no keys for them. Lanes that own common.json can move them later; only src/lib/status.ts would change.
- Refresh deduplication in refresher.ts caches the result of a refresh for 60 s per old refresh token, because parallel requests or prefetches from one browser would otherwise trip the API's reuse detection and revoke the whole session. The trade-off: within that window, anyone holding the just-rotated old refresh token (it lives only in an httpOnly cookie) gets the new tokens instead of revoking the session (spec §15 reuse detection). Outside the window, reuse detection works normally.
- If the API was unreachable when the proxy tried to refresh (the refresh cookie is kept), the guards throw SessionRefreshUnavailableError and the route error page is shown, not a '?expired=1' login redirect.
- Logging into the admin or company panel first revokes, as best effort, any session the browser already holds (api.auth.logout with the old access and refresh tokens). This happens only after the new login succeeds.

### Open issues / notes for other lanes

- Login was not tested end to end against a real API. Lane A1's auth endpoints were still in progress, and port 3000 is taken by an unrelated app. API_INTERNAL_URL defaults to http://127.0.0.1:3000/tezfix/api, so the integration wave must run the API there or set API_INTERNAL_URL.
- Wave 5 (deploy), client IPs: the panel BFF forwards the browser's X-Forwarded-For to the API unchanged (src/lib/api/create.ts). The API's TRUST_PROXY must match the real hops (nginx -> panel -> API, e.g. trust exactly those container or loopback addresses or a hop count of 2). With the default TRUST_PROXY=loopback and separate Compose containers, req.ip becomes the panel container IP, so every panel user shares one per-IP OTP/login rate limit. With TRUST_PROXY=true, the leftmost entry can be spoofed. nginx should also overwrite X-Forwarded-For (proxy_add_x_forwarded_for on a cleared header) for the panel location.
- Wave 5 (deploy): the nginx `location ^~ /tezfix/` block for the panel must also cover /tezfix/bff/. It does if only /tezfix/api/ goes to the API.
- Local development: the panel (port 3100) and the API (port 3000) are on different origins, so NEXT_PUBLIC_SOCKET_URL must be set at build time (see apps/panel/.env.example), and the API's Socket.IO must accept auth.ticket from the panel origin.
- Pages and Server Actions under /admin and /company must call requireAdmin() / requireManager(companyId) themselves. The proxy refreshes tokens but is not the authorization layer.
- Refresh deduplication is held in memory in one process. Several panel replicas would need sticky sessions or a shared store.
- @parcel/watcher 2.6.0 (pulled in by next-intl) has an install script that was not approved. Its prebuilt Windows binary works for the build.

