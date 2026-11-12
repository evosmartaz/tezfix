# TezFiks — Design Spec (demo build, launch-ready architecture)

Date: 2026-10-24. Status: approved for build by the founder ("DO EVERYTHING AS WE AGREED").
Sources: the founder's answers in the kickoff conversation (2026-10-24), the six design boards in `design/`,
and the verified stack research (versions confirmed on npm and vendor pages on 2026-10-24).

## 1. What TezFiks is

TezFiks ("Ustaların Uberi — lazım olan anda usta sifarişi") is a marketplace for **requesting handymen**:
Baku first, then all of Azerbaijan, then other countries. UI languages: Azerbaijani (default), Russian, English.

The platform **never prices the work**. A customer posts a request, nearby handymen compete to accept it,
and the handyman writes the final price into the app when the work is done. The platform earns a flat
**10 AZN per accepted request**, clipped from the handyman's prepaid in-app balance.

Phase: **demo**. All payments run in **test mode** (no real money). Admins can top up any balance.
The architecture must not block a real launch: real payment provider, real KYC vendor, iOS, other regions.

### 1.1 Deliverables

| Deliverable | Path | Tech |
|---|---|---|
| Customer Android app "TezFiks" | `apps/customer` | Expo SDK 58, React Native 0.88, expo-router |
| Handyman Android app "TezFiks Usta" (solo handymen, company workers, company managers) | `apps/pro` | Expo SDK 58 |
| Backend API + realtime + workers, in Docker | `apps/api` | NestJS 12.2 (Express adapter), Prisma 7.10.1, PostgreSQL 17, Redis 8, BullMQ 6, Socket.IO 4.8 |
| Web panels: TezFiks admin, company admin, company dispatch | `apps/panel` | Next.js 16.4 (App Router), Tailwind 4, shadcn/ui |
| Shared contract (zod schemas, enums, API + socket contract, utils) | `packages/shared` | TypeScript, zod 4 |
| Translations az/ru/en | `packages/i18n` | JSON |
| Shared React Native code (theme, UI kit, API client, auth, socket, i18n) | `packages/mobile` | TypeScript/TSX |
| Deployment (Compose, nginx snippet, env template, runbook) | `deploy/`, `docs/deploy.md` | Docker Compose v5 |

iOS is out of scope now; no code may assume Android-only APIs without a platform guard.

### 1.2 Out of scope for the demo
Real card acquiring and real payouts, automated face matching and real liveness, SMS fallback, iOS builds,
multi-currency pricing (the model carries currency, only AZN is seeded), fiscal receipts, in-app voice calls,
video attachments (photos only, up to 5).

## 2. Decisions log (founder, 2026-10-24)

1. Market: Baku → Azerbaijan → world. Languages az, ru, en.
2. Two ways to work: **solo handyman** or **member of a provider company** ("park" model, like taxi parks).
   The company admin accepts requests and assigns its workers. Workers see the job location, not the customer's number.
3. Revenue: **10 AZN per accepted request**, paid by the handyman (or the company for company jobs) from a prepaid
   in-app balance. A provider with less than 10 AZN available cannot accept.
4. No platform pricing of work. The handyman enters the final price (labour + materials) at completion; payment follows.
5. Payment of the work: cash or in-app. **Only in-app payment carries the TezFiks guarantee** (free re-fix).
6. Solo handymen register with ID photos and a face check on the phone, then wait in **pending** until a TezFiks
   admin approves. Approved companies add members by **invite link**.
7. Customers: households, companies, car owners — anyone. Any customer may request **more than one handyman**.
   A **company customer** may choose **company providers, individual providers, or either**.
8. The guarantee applies only when paid through the app.
9. If the handyman arrives and the customer declines, the handyman's 10 AZN is refunded and the customer is charged **15 AZN**.
   Split (default accepted by the founder): the handyman receives a 10 AZN fee credit, the platform keeps 5 AZN.
10. Dispatch uses **Uber-style H3 hexagons**, expanding ring by ring. Companies additionally get a **list-style** dispatch board.
11. **Emergency** requests cost the customer **5 AZN per handyman requested**.
12. Categories: the design taxonomy plus business/facility services, car services and **IT support**.
13. Problem input is text. A customer unsure of the category uploads a **photo; Claude Haiku picks the category** on the server.
14. **No phone numbers and no chat until the handyman is about 5 minutes away** (ETA ≤ 300 s, or arrived); then both
    phone numbers and in-app messaging unlock. **Names and faces are always visible** to both sides.
15. Live tracking of the handyman: yes, **from acceptance** (founder decision 2026-10-26), not only after "Yola çıxdım".
    NOW/EMERGENCY jobs are tracked from acceptance, scheduled jobs from 1 hour before their time; the live ETA unlocks the
    contact by itself, without anyone pressing a button.
16. Ratings both ways. After an in-app payment a **tip page** opens.
17. Handyman side as proposed (online toggle, service radius, trades, earnings). Individual accounts only; teams are companies.
18. Payouts **weekly**.
19. Login codes are delivered through a **WhatsApp bot** (no SMS provider). Codes are 6 digits.
20. **Android first**; iOS later.
21. Stack: React Native (Expo) for mobile, NestJS for the backend, Next.js panels — accepted.
22. Backend in a **container on the founder's server**; own Postgres now, **portable to Supabase** later.
    Public API URL `https://evosmart.az/tezfix/api` (the founder deploys it).
23. **Google Maps**.
24. Admin panels needed at launch: TezFiks admin; company admins get their **own panel** and a **dispatch panel**.
25. The boards in `design/` are the visual source of truth.
26. Demo only for now.
29. In-app payments are **test-only**; admins can **add balance** to any user.

Follow-up decisions in the same conversation:
- **Cancellations**: either side may cancel **free within 5 minutes of acceptance** (fee released to the provider).
  After 5 minutes: provider cancel or no-show ⇒ fee kept + strike; customer cancel ⇒ treated like decline on arrival (15 AZN).
- **Scheduling is in the demo** (now / scheduled / emergency).
- In-app **messaging unlocks at the 5-minute mark**, together with phone numbers.
- The **corporate quote flow of board D is built as designed**: multi-day projects, quotes within 24 h, award, daily reports,
  invoice with VAT. Big construction categories route any customer into this flow.
- Company managers accept on the **phone** (pro app manager mode, as drawn) **and** on the web dispatch panel.
- Customers have a **wallet** (emergency fees and penalties); a negative balance is a debt that blocks new requests.
- Final price entry for company jobs follows the company setting **"Yekun qiyməti kim daxil edir?"** (worker or manager).

## 3. Actors and roles

| Actor | App | Authentication |
|---|---|---|
| Customer (individual or company account) | customer app | phone + WhatsApp OTP |
| Solo handyman | pro app | phone + OTP; KYC; admin approval |
| Company manager ("İdarəedici") | pro app (manager mode) + web `/tezfix/company` | phone + OTP |
| Company worker | pro app (limited mode) | phone + OTP; joins by invite link |
| TezFiks admin | web `/tezfix/admin` | email + password (argon2) |

One phone number = one `User`. A user may be a customer and a handyman at the same time (different apps).
A company worker cannot take solo jobs while a member of a company.

## 4. Business rules (authoritative)

All money is **integer minor units** (qəpik; 10 AZN = 1000) with an explicit currency (`AZN`).
All amounts and timers are **platform settings** editable by admins; the values below are defaults.

| Setting | Default | Demo mode |
|---|---|---|
| requestFee (per accepted slot, provider pays) | 1000 | same |
| emergencyFeePerSlot (customer pays) | 500 | same |
| cancelPenalty (customer pays) | 1500 | same |
| penaltyCompensation (credited to provider wallet) | 1000 | same |
| b2bFeePerWorkerDay | 1000 | same |
| freeCancelSec | 300 | 300 |
| offerTtlSec | 30 | 15 |
| ringStepSec / emergencyRingStepSec | 30 / 20 | 10 / 8 |
| noMatchAfterSec (search length for now/emergency) | 180 | 90 |
| minCandidates (fast-forward rings below this) | 3 | 3 |
| maxOffersPerStep | 10 | 10 |
| contactUnlockEtaSec | 300 | 300 |
| scheduledMinLeadMin / scheduledLiveDispatchLeadMin | 30 / 90 | 2 / 1 |
| autoCompleteAfterMin (price proposed, customer silent ⇒ cash) | 1440 | 10 |
| noShowAfterMin (customer may report no-show) | 45 | 5 |
| guaranteeDays | 14 | 14 |
| quoteWindowHours (B2B) | 24 | 0.1 |
| vatRatePercent (B2B invoices) | 18 | 18 |
| maxSlots / maxPhotos | 10 / 5 | same |

### 4.1 Request fee and cancellations (per slot / assignment)
- **Accept** ⇒ a **hold** of `requestFee` on the provider wallet (the solo handyman's wallet, or the company wallet for company jobs).
  Accept fails with `INSUFFICIENT_BALANCE` if the available balance is below the fee.
- **Free window** (`freeCancelSec` after acceptance): either side cancels ⇒ hold **released** (provider pays nothing).
  If the *customer* cancelled, that slot's emergency hold is released too. If the *provider* cancelled, the slot is re-dispatched.
- **Window closes** (delayed job) ⇒ hold **captured** (fee clipped: provider wallet −1000, platform revenue +1000), and the slot's
  emergency hold is captured (customer −500, revenue +500).
- After the window:
  - **Provider cancels**, or the customer reports a **no-show** ⇒ the fee stays captured, the provider gets a **strike**, the slot is
    re-dispatched at no new charge to the customer. If the slot finally stays unfilled, the customer's captured emergency fee for it is refunded.
  - **Customer cancels** or **declines on arrival** ⇒ the provider fee is **refunded** (revenue −1000 → provider +1000), the customer is
    charged **cancelPenalty** (customer −1500 → revenue +1500, may go negative = debt), and the provider is credited **penaltyCompensation**
    (platform promo −1000 → provider wallet +1000). Net: customer −15, provider +10, platform +5.
- **Completion** before the window closes captures the fee immediately.
- **Guarantee re-fix** requests carry no fee and no emergency fee.

### 4.2 Emergency
`timing = EMERGENCY` ⇒ at posting, one hold of `emergencyFeePerSlot` per slot on the customer wallet (fails with
`INSUFFICIENT_BALANCE`; the app offers a top-up). Dispatch starts at ring k=1 with `emergencyRingStepSec`. Offers are badged "TƏCİLİ".
Unfilled slots release their holds when the search ends.

### 4.3 Customer debt
A customer wallet below zero blocks new requests (`CUSTOMER_IN_DEBT`) until topped up.

### 4.4 Privacy and contact unlock
- **Offer** (before acceptance): category, short description, district + street (no flat details), distance, timing,
  customer first name + last-name initial + rating. No phone, no photo.
- **After acceptance**: both sides always see each other's **name and photo** (customer: first name + last-name initial;
  provider: full name, trade, rating, completed jobs, company name for company jobs). The provider sees the full address
  (entrance, floor, apartment, intercom, note), the description and the problem photos.
- **Company worker** view (board 04): location/address, category, customer name + photo. **Not** the description, the customer rating,
  price data or company money ("Digər detallar üçün idarəedici ilə əlaqə saxlayın").
- **Contact unlock**: when the server-computed live ETA ≤ `contactUnlockEtaSec` (computed from the provider's own location pings while
  the job is ACCEPTED or EN_ROUTE, see `isLiveTracked`), or the provider marks arrived, `contactUnlockedAt` is set
  once (never relocks). From then the other party's **phone number** is included in assignment views and **chat** is allowed, until
  2 hours after the assignment reaches a terminal state. Before unlock, phone fields are absent from every payload.
- Phones never appear in lists, offers, notifications or push payloads.

### 4.5 Final price and payment
- The provider taps "İşi tamamla" → enters **İş haqqı** (labour) and **Material xərci** (materials) → "Qiyməti təsdiqlə və işi bitir".
  For company jobs, whoever the company setting names (worker or manager) enters it; the other side is not shown the price screen.
- The customer sees the amount ("Razılaşdırılmış qiymət"), chooses **Nağd — qapıda ödəmə** (cash) or **Kartla ödəmə** (card, test mode),
  or opens a **price dispute** (an admin resolves it).
- Cash ⇒ assignment `COMPLETED`, no guarantee. Card ⇒ test checkout ⇒ on success `COMPLETED`, **guarantee until completedAt + 14 days**,
  then the **tip** page, then rating. Card money goes to the provider's **earnings** account (100%), paid out weekly.
- If the customer does nothing for `autoCompleteAfterMin`, the assignment completes as cash.

### 4.6 Guarantee
A card-paid assignment within `guaranteeDays` ⇒ the customer files a claim (text + photos) ⇒ admin case ⇒ the admin either re-dispatches
(new request flagged `isGuaranteeFix`, offered first to the original provider for 10 minutes, then normal dispatch; no fees; price fixed at 0)
or resolves/rejects it with a note.

### 4.7 Strikes
A late provider cancel and a no-show each add a strike (`StrikeEvent`). Admins see strikes and may block. No automatic block in the demo.

### 4.8 Ratings
After completion the customer rates the provider (1–5 + optional comment) and the provider rates the customer. Aggregates are stored on
the handyman profile, the company and the customer account.

### 4.9 Payouts
A weekly job (Monday 09:00 Asia/Baku) creates a `Payout` (PENDING) for every earnings account with a positive balance and moves the money
to "payouts in transit". An admin marks it PAID or FAILED (failed returns the money to earnings). Test mode: no provider call.
Providers set a payout card (masked number + holder name) in the pro app or the company panel.

### 4.10 B2B quote flow (board D)
- A company customer creates a **"Biznes sifarişi"**: service, site/branch, scope (e.g. "≈ 450 m² (3 mərtəbə, 12 otaq)"), date range,
  workers needed, description, photos. Any customer is routed here for categories with `flow = QUOTE`
  (e.g. "Tikinti-təmir briqadası", "Dam örtüyü").
- Eligible providers (solo and companies with the trade whose service area covers the site) see it and may **quote** within
  `quoteWindowHours`: total price, workers, days, note. Submitting a quote **holds** `b2bFeePerWorkerDay × workers × days`.
- The customer **compares and accepts** one quote ("Müqayisə və təsdiq"): the winner's hold is captured, the others are released, and the
  terms are snapshotted ("müqavilə platformada qeydə alınır").
- **Execution**: the provider posts daily status reports (note, progress %, photos).
- **Completion** ⇒ an **invoice** (hesab-faktura) with a VAT line (the provider marks itself VAT payer or not) is issued. Payment is a bank
  transfer; in the demo an admin marks it paid ⇒ money to the provider's earnings ⇒ weekly payout. The guarantee applies.

## 5. Dispatch (H3)

- Library `h3-js` 4.5.0 (v4 API: `latLngToCell`, `gridDisk`, `gridRing`, `cellToParent`, `cellToBoundary`, `greatCircleDistance`).
- **DISPATCH_RES = 7** (Baku cells ≈ 5.5 km², edge ≈ 1.45 km); **DATA_RES = 9** stored for analytics. Cells are stored as 15-char hex text.
- Guaranteed reach in Baku: k=0 1.2 km, k=1 2.9 km, k=2 5.1 km, k=3 7.1 km, k=4 9.3 km, k=5 11.4 km.
- **Ring schedule (now)**: step 0 = k0 at t=0, then k1, k2, k3, k4 every `ringStepSec`; the final "wide" step is k5 plus providers whose
  declared service area covers the request cell. The search ends at `noMatchAfterSec`. Emergency starts at k1 with `emergencyRingStepSec`.
  If fewer than `minCandidates` eligible providers have been offered so far, the next ring follows after a 3 s floor.
  Each step offers only the **new ring**, sorted by distance and capped at `maxOffersPerStep`. A provider is never offered the same request twice.
- **Eligibility (solo)**: profile APPROVED, user ACTIVE, online and seen within 90 s, no active assignment in ACCEPTED/EN_ROUTE/ARRIVED,
  has the category trade, wallet available ≥ fee, distance ≤ their `serviceRadiusKm`, request preference ANY or INDIVIDUAL.
- **Eligibility (company)**: company APPROVED, wallet available ≥ fee, at least one worker who is online, free and has the trade inside the
  current disk, preference ANY or COMPANY. The offer goes to the **company** (managers' phones + the web dispatch board) with the list of
  candidate workers (name, rating, distance, Boşdur/Sifarişdədir).
- **Accept** is one Postgres transaction: lock the offer (must be SENT and unexpired), lock an OPEN slot (`FOR UPDATE SKIP LOCKED`),
  create the fee hold (fails ⇒ 402), create the assignment, mark the slot FILLED and the offer ACCEPTED. When no OPEN slot remains the
  request becomes ASSIGNED and the remaining offers are CLOSED (pushed as "taken"). Nothing to lock ⇒ `OFFER_UNAVAILABLE`.
  A company accept takes 1..N workers (N ≤ open slots) with one hold per worker.
- **Presence**: a Redis sorted set per res-7 cell (`tz:pres:7:{cell}`, member = handymanId, score = last-seen ms) and a hash per handyman
  (`tz:hm:{id}`: lat, lng, cell7, cell9, busy, companyId, ts; TTL 120 s). Pings every 15 s online, 5 s en route. A Postgres snapshot
  (`HandymanProfile.lastLat/lastLng/lastSeenAt/lastCell7`) is written at most every 60 s for the panels.
- **Scheduled requests**: at creation, long-lived offers (expiring at `scheduledAt − scheduledLiveDispatchLeadMin`) go to providers whose
  service area covers the cell, with the trade, approved, wallet ok, and no other accepted job within ±2 h. They appear in the pro app's
  "Planlı sifarişlər" list and get a push. At `scheduledAt − scheduledLiveDispatchLeadMin`, remaining open slots run the live ring dispatch.
  At `scheduledAt − 15 min` (demo: at `scheduledAt`) unfilled slots become UNFILLED and the customer is notified. Reminders at T−24 h and T−1 h.
  The handyman taps "Yola çıxdım" to start tracking exactly as for immediate jobs.
- Postgres holds every deadline (`offer.expiresAt`, `assignment.freeCancelUntil`, `request.scheduledAt`); BullMQ delayed jobs are the timers;
  a reconciler runs every minute and repairs anything overdue (expire offers, capture fees, advance dispatch, auto-complete, end searches).

## 6. State machines

### 6.1 Request
`SEARCHING` (no slot filled, search running) → `ASSIGNED` (≥1 slot filled; `isSearching` stays true while open slots are still dispatched)
→ `IN_PROGRESS` (any assignment EN_ROUTE/ARRIVED/PRICE_PROPOSED/PRICE_DISPUTED) → `COMPLETED` (all assignments terminal, ≥1 completed).
Terminal alternatives: `CANCELLED` (customer or admin), `EXPIRED` (search ended with nothing filled).
Scheduled requests start in `SEARCHING` with `timing = SCHEDULED`.

### 6.2 Slot
`OPEN` → `FILLED` (has a current assignment) → `DONE`; back to `OPEN` after a provider cancel or no-show; `CANCELLED` (customer);
`UNFILLED` (search ended).

### 6.3 Assignment
`ACCEPTED` → `EN_ROUTE` → `ARRIVED` → `PRICE_PROPOSED` → `COMPLETED`.
Side state `PRICE_DISPUTED` (from PRICE_PROPOSED; an admin sets a corrected price and returns it to PRICE_PROPOSED, completes it, or cancels it).
Terminal negatives: `CANCELLED_FREE` (either side within the window), `CANCELLED_BY_PROVIDER` (late), `CANCELLED_BY_CUSTOMER` (late),
`DECLINED_ON_ARRIVAL`, `NO_SHOW`.
Allowed actions — provider: en-route (ACCEPTED), arrived (ACCEPTED|EN_ROUTE), price (ARRIVED), cancel (ACCEPTED|EN_ROUTE).
Customer: cancel (ACCEPTED|EN_ROUTE), decline on arrival (ARRIVED), report no-show (ACCEPTED|EN_ROUTE after `noShowAfterMin`),
confirm price / pay / dispute (PRICE_PROPOSED).

### 6.4 Offer
`SENT` → `ACCEPTED` | `DECLINED` | `EXPIRED` | `CLOSED` (filled elsewhere, cancelled, search ended).

### 6.5 Verification (handyman / company)
`DRAFT` → `PENDING_REVIEW` → `APPROVED` | `REJECTED` (with a reason; resubmission allowed, max 3 per 24 h); an admin may `BLOCK` from any state.

### 6.6 Project (B2B)
`OPEN` (collecting quotes) → `AWARDED` → `IN_PROGRESS` → `COMPLETED` → `INVOICED` → `PAID`; or `CANCELLED` / `EXPIRED` (no quotes in the window).
Quote: `SUBMITTED` → `ACCEPTED` | `REJECTED` | `WITHDRAWN` | `EXPIRED`.

## 7. Ledger (double entry, Postgres)

- `LedgerAccount`: owner (CUSTOMER_ACCOUNT / HANDYMAN / COMPANY / PLATFORM), kind (WALLET, EARNINGS, REVENUE, PROMO, EXTERNAL,
  PAYOUTS_IN_TRANSIT, ADJUSTMENTS), currency, `postedBalance`, `heldBalance`, `allowNegative`, `version`.
  Available = posted − held. Customer wallets go negative (debt) only through penalty postings; holds always need available ≥ amount.
- `LedgerTransaction` (kind, unique idempotency key, references, memo, actor) with `LedgerEntry` rows (signed amount, balanceAfter).
  **Entries of a transaction sum to zero**, enforced in code and by a deferred constraint trigger. Append-only: corrections are reversals.
- `Hold` (account, amount, kind REQUEST_FEE | EMERGENCY_FEE | B2B_QUOTE_FEE, references, status ACTIVE / CAPTURED / RELEASED).
- Every mutation runs in one DB transaction, locks the involved accounts with `SELECT … FOR UPDATE` ordered by id, checks balances,
  writes entries and updates cached balances. Money endpoints and accept take a client idempotency key (`Idempotency-Key` header).
- Transaction kinds: TOPUP, ADMIN_ADJUSTMENT, REQUEST_FEE_CAPTURE, REQUEST_FEE_REFUND, EMERGENCY_FEE_CAPTURE, EMERGENCY_FEE_REFUND,
  CANCEL_PENALTY, PENALTY_COMPENSATION, JOB_PAYMENT, TIP, B2B_FEE_CAPTURE, INVOICE_PAYMENT, PAYOUT_CREATED, PAYOUT_PAID, PAYOUT_FAILED.
- Seeded platform accounts: REVENUE, PROMO, EXTERNAL (money from/to the outside world), PAYOUTS_IN_TRANSIT, ADJUSTMENTS.
- A nightly job recomputes balances from entries and logs mismatches.

### 7.1 Test-mode payments
`PaymentIntent` (purpose WALLET_TOPUP | JOB_PAYMENT | TIP | INVOICE; amount; status CREATED → SUCCEEDED | FAILED | CANCELLED) sits behind a
`PaymentProvider` port. The `fake` provider serves a hosted **test checkout page** from the API
(`GET /tezfix/api/pay/checkout/:id?t=<signed>`): card 4242 4242 4242 4242 succeeds, 4000 0000 0000 0002 declines. On completion it
redirects to the app deep link (`tezfiks://payment/:id` or `tezfiksusta://payment/:id`) or to the panel return URL. The ledger posts only
from the settled intent. The real provider later is Payriff (first choice) or Epoint behind the same port.

## 8. Data model (entities; `apps/api/prisma/schema.prisma` is the source of truth)

IDs are UUID v7 (`@db.Uuid`). Timestamps are `timestamptz` (UTC), rendered in **Asia/Baku**. Money columns are `BigInt` (qəpik);
the API exposes money as integer numbers.

- **User**: phone (E.164, unique), firstName, lastName, photoFileId, locale (az|ru|en), status (ACTIVE|BLOCKED|DELETED), timestamps.
- **AdminUser**: email (unique), passwordHash, name, role (ADMIN|OPERATOR), active.
- **Session**: userId or adminId, app (CUSTOMER|PRO|PANEL|ADMIN), deviceId, refreshTokenHash, expiresAt, revokedAt, lastUsedAt, ip, userAgent.
- **OtpChallenge**: phone, codeHash, expiresAt, attempts, consumedAt, channel, ip.
- **Device**: userId, deviceId, app, platform, pushToken, pushProvider (EXPO|FCM), updatedAt.
- **File**: ownerUserId, kind (PROFILE_PHOTO, REQUEST_PHOTO, KYC_ID_FRONT, KYC_ID_BACK, KYC_SELFIE, KYC_SELFIE_TURN, KYC_SELFIE_BLINK,
  KYC_TRADE_PROOF, COMPANY_DOC, REPORT_PHOTO, CASE_PHOTO), storageKey, contentType, size, sha256, width, height, purgeAfter.
- **CustomerAccount**: type (INDIVIDUAL|COMPANY), ownerUserId (unique), companyName, voen, legalForm, contactPerson, ratingAvg, ratingCount,
  walletAccountId. **Address**: customerAccountId, label, lat, lng, cell7, cell9, placeId, formatted, district, street, building, block,
  entrance, floor, apartment, intercom, note, isSite (company "Obyekt / filial").
- **Category**: slug (unique), parentId, vertical (HOME|AUTO), kind (GROUP|SERVICE), nameAz/nameRu/nameEn, icon, keywords, sortOrder,
  active, featured, flow (INSTANT|QUOTE), emergencyAllowed.
- **HandymanProfile**: userId (unique), kind (SOLO|COMPANY_WORKER), companyId, status (DRAFT|PENDING_REVIEW|APPROVED|REJECTED|BLOCKED),
  rejectReason, trades (HandymanTrade → Category), serviceRadiusKm, baseLat/baseLng/baseCell7, isOnline, lastLat, lastLng, lastCell7,
  lastSeenAt, ratingAvg, ratingCount, completedCount, strikes, walletAccountId, earningsAccountId, isBot (demo simulator).
- **HandymanServiceCell**: handymanId, cell7 (materialised `gridDisk(baseCell7, ceil(radius / 2.44))`). **CompanyServiceCell** likewise.
- **Company**: name, legalForm, voen, status (as verification), rejectReason, ownerUserId, finalPriceEntry (WORKER|MANAGER), trades,
  baseLat/baseLng/baseCell7, serviceRadiusKm, ratingAvg, ratingCount, strikes, walletAccountId, earningsAccountId, isVatPayer.
- **CompanyMember**: companyId, userId, role (MANAGER|WORKER), status (ACTIVE|REMOVED), unique(companyId, userId).
- **CompanyInvite**: companyId, token (unique, random), role, expiresAt, maxUses, usedCount, revokedAt, createdByUserId.
- **VerificationSubmission**: subjectType (HANDYMAN|COMPANY), handymanId/companyId, submittedByUserId, file ids (ID front/back, selfies,
  trade proofs, company document), selfieChecks (json), consent (policyVersion, locale, textHash, acceptedAt, ip), status,
  reviewedByAdminId, reviewedAt, rejectReason, extracted fields typed by the reviewer (document number last 4, birth date, expiry).
- **KycAccessLog**: adminId, fileId, at.
- **ServiceRequest**: number (autoincrement from 1000, shown as "#1000"), customerAccountId, createdByUserId, categoryId, vertical,
  description, timing (NOW|SCHEDULED|EMERGENCY), scheduledAt, slotsRequested, providerPreference (ANY|INDIVIDUAL|COMPANY), address snapshot
  (lat, lng, cell7, cell9, formatted, district, street, building, block, entrance, floor, apartment, intercom, note), status, isSearching,
  dispatchStep, searchStartedAt, searchEndsAt, isGuaranteeFix, originAssignmentId, cancelledAt, cancelReason, photos.
- **RequestSlot**: requestId, index, status (OPEN|FILLED|DONE|CANCELLED|UNFILLED), emergencyHoldId, emergencyCaptured, currentAssignmentId.
- **Offer**: requestId, targetType (HANDYMAN|COMPANY), handymanId, companyId, step, ring, status, sentAt, expiresAt, respondedAt,
  deliveredAt, seenAt, distanceM, candidateWorkers (json, company offers); unique(requestId, handymanId) and unique(requestId, companyId).
- **Assignment**: requestId, slotId, providerType (SOLO|COMPANY), handymanId (the doer), companyId, acceptedByUserId, status, acceptedAt,
  freeCancelUntil, enRouteAt, arrivedAt, priceProposedAt, completedAt, cancelledAt, cancelledBy (CUSTOMER|PROVIDER|ADMIN|SYSTEM),
  cancelReason, feeHoldId, feeCaptured, laborAmount, materialsAmount, totalAmount, priceEnteredByUserId, paymentMethod (CASH|CARD),
  paymentIntentId, guaranteeUntil, tipAmount, etaSec, etaUpdatedAt, distanceM, routePolyline, routeDurationSec, routeDistanceM,
  routeComputedAt, lastLat, lastLng, lastLocationAt, contactUnlockedAt, customerRatedAt, providerRatedAt.
- **ChatMessage**: assignmentId, senderUserId, body (≤ 1000 chars), createdAt, readAt.
- **Rating**: assignmentId or projectId, direction (CUSTOMER_TO_PROVIDER|PROVIDER_TO_CUSTOMER), raterUserId, handymanId, companyId,
  customerAccountId, stars (1–5), comment; unique per direction per job.
- **StrikeEvent**: handymanId or companyId, assignmentId, reason, createdAt, clearedAt, clearedByAdminId.
- **Case**: type (GUARANTEE|PRICE_DISPUTE|REPORT), status (OPEN|IN_REVIEW|REDISPATCHED|RESOLVED|REJECTED), assignmentId, projectId,
  openedByUserId, description, photos, resolutionNote, resolvedByAdminId, followUpRequestId, timestamps. **CaseNote**: caseId, author, body.
- **Project** (B2B): number, customerAccountId, createdByUserId, categoryId, address snapshot, siteAddressId, scope, dateFrom, dateTo,
  workDays, workersNeeded, description, photos, status, quoteDeadline, awardedQuoteId, guaranteeUntil, cell7, timestamps.
- **Quote**: projectId, providerType, handymanId, companyId, submittedByUserId, totalAmount, workers, days, note, status, holdId,
  terms (json snapshot at award); unique(projectId, handymanId) and unique(projectId, companyId).
- **ProjectReport**: projectId, authorUserId, reportDate, note, progressPercent, photos.
- **Invoice**: number (e.g. `TF-2026-000123`), projectId, issuer (handymanId or companyId), customerAccountId, subtotal, vatRatePercent,
  vatAmount, total, status (ISSUED|PAID|VOID), issuedAt, paidAt, markedPaidByAdminId, lines (json).
- **LedgerAccount, LedgerTransaction, LedgerEntry, Hold, IdempotencyKey** (section 7).
- **PaymentIntent**: purpose, amount, currency, status, provider, providerRef, payerUserId, walletAccountId, assignmentId, invoiceId,
  returnUrl, idempotencyKey, failureReason, completedAt.
- **Payout**: ownerType (HANDYMAN|COMPANY), handymanId/companyId, amount, periodStart, periodEnd, status (PENDING|PAID|FAILED),
  idempotencyKey (`payout:<owner>:<isoWeek>`), payoutMethodSnapshot, paidAt, markedByAdminId.
  **PayoutMethod**: owner, type (CARD|IBAN), maskedNumber, holderName.
- **Notification**: userId, type, title, body, data (json), readAt, createdAt.
- **AiClassification**: userId, fileId, model, resultSlug, confidence, candidates, latencyMs, inputTokens, outputTokens, finalCategoryId, error.
- **PlatformSetting**: key, value (json), updatedByAdminId. **AuditLog**: actorType (ADMIN|USER|SYSTEM), actorId, action, entityType,
  entityId, before, after, ip, at.

Search: an immutable SQL function `tz_fold(text)` (İ/I/ı → i before lower, ə→e, ş→s, ç→c, ğ→g, ö→o, ü→u, ё→е) feeds generated columns
with pg_trgm indexes for admin search and category search. No PostGIS and no h3-pg, so the database stays Supabase-portable.

## 9. API (REST, prefix `/tezfix/api`, JSON, zod-validated)

Conventions: `Authorization: Bearer <access>`; `Accept-Language: az|ru|en` for localized names and messages; `Idempotency-Key` on money
and accept mutations; errors as `{ "error": { "code": "INSUFFICIENT_BALANCE", "message": "<localized>", "details": {…} } }`; cursor
pagination `{ items, nextCursor }`; money as integer qəpik plus `currency`. The exact request and response shapes live in
`packages/shared` (`contract.ts`), which both the API controllers and the clients import. Swagger UI at `/tezfix/api/docs` when `DOCS_ENABLED=true`.

- **Auth**: `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/admin/login`,
  `POST /realtime/ticket` (panel socket ticket).
- **Me**: `GET /me`, `PATCH /me`, `POST /me/photo`, `POST /me/devices`, `DELETE /me` (account deletion, a Google Play requirement).
- **Files**: `POST /files` (multipart with kind) ⇒ `{id, url}`; `GET /files/:id` (signed URL, or owner/admin auth; KYC files admin-only and logged).
- **Categories**: `GET /categories` (tree, localized); admin CRUD under `/admin/categories`.
- **Geo**: `GET /geo/reverse`, `GET /geo/autocomplete`, `GET /geo/place/:placeId` (Google via the server key, with fallbacks).
- **Customer**: `GET|POST|PATCH /customer/account`, `GET|POST|PATCH|DELETE /customer/addresses`.
- **Requests**: `POST /requests/classify-photo`, `POST /requests`, `GET /requests`, `GET /requests/:id`, `POST /requests/:id/cancel`.
- **Customer assignment actions**: `POST /assignments/:id/cancel`, `/decline-on-arrival`, `/report-no-show`, `/confirm-price`
  (CASH or CARD ⇒ checkoutUrl), `/dispute-price`, `/tip`, `/rating`, `/guarantee-claim`; chat `GET|POST /assignments/:id/messages`.
- **Pro (self)**: `POST /pro/onboarding/solo`, `POST /pro/onboarding/company`, `GET|PATCH /pro/profile`, `POST /pro/online`, `POST /pro/location`,
  `GET /pro/stats/today`, `GET /pro/offers/current`, `POST /pro/offers/:id/accept|decline|seen`, `GET /pro/scheduled`,
  `GET /pro/assignments`, `GET /pro/assignments/:id`, `POST /pro/assignments/:id/en-route|arrived|price|cancel|rate-customer`,
  `GET /pro/earnings`, `GET|PUT /pro/payout-method`.
- **KYC**: `POST /kyc/submissions`, `GET /kyc/status`.
- **Invites**: `GET /invites/:token` (public preview), `POST /invites/:token/accept`.
- **Company (manager)** under `/company/:companyId`: `GET /`, `PATCH /settings`, `GET /members`, `PATCH|DELETE /members/:userId`,
  `GET|POST /invites`, `DELETE /invites/:id`, `GET /offers/current`, `POST /offers/:offerId/accept` (workerIds), `POST /offers/:offerId/decline`,
  `GET /assignments`, `GET /assignments/:id`, `POST /assignments/:id/price`, `POST /assignments/:id/reassign`, `GET /workers/live`,
  `GET /wallet`, `GET /wallet/transactions`, `POST /wallet/topup`, `GET /earnings`, `GET|PUT /payout-method`, projects equivalents.
- **Wallet (self)**: `GET /wallet`, `GET /wallet/transactions`, `POST /wallet/topup` (customer or solo handyman).
- **Payments**: `GET /payments/:id`, `GET /pay/checkout/:id` (HTML test page), `POST /pay/checkout/:id` (test card submit).
- **Projects (B2B)**: customer `POST /projects`, `GET /projects`, `GET /projects/:id`, `POST /projects/:id/quotes/:quoteId/accept`,
  `POST /projects/:id/cancel`, `POST /projects/:id/rating`, `POST /projects/:id/guarantee-claim`; provider `GET /pro/projects/open`,
  `POST /pro/projects/:id/quotes`, `POST /pro/quotes/:id/withdraw`, `GET /pro/projects/mine`, `POST /pro/projects/:id/reports`,
  `POST /pro/projects/:id/complete` (issues the invoice); company equivalents under `/company/:companyId/projects…`.
- **Notifications**: `GET /notifications`, `POST /notifications/read`.
- **Admin** under `/admin` (admin JWT): dashboard, requests (list, detail, force-cancel), handymen (tabs, detail, approve, reject, block,
  unblock, clear strikes), companies (same), customers (list, detail, block), wallet adjustments with a reason, ledger transactions,
  payment intents, payouts (list, mark paid/failed, run now), invoices (mark paid), cases (list, detail, note, re-dispatch, resolve, reject),
  projects, categories, settings, admins, audit log, live map data, demo controls.
- **Health**: `GET /health` (DB + Redis).
- **Webhooks**: `GET|POST /webhooks/whatsapp` (Meta verification + HMAC over the raw body).

## 10. Realtime (Socket.IO, path `/tezfix/api/socket.io`, websocket transport)

Auth: the mobile access token in `auth.token`; panels use a 60-second ticket from `/realtime/ticket`. Rooms: `user:{userId}`,
`company:{companyId}` (managers), `assignment:{id}`, `request:{id}`, `admins`. Events are defined once in `packages/shared/src/socket.ts`.
Server → client: `offer:new`, `offer:closed`, `request:updated`, `request:search` (ring step + H3 cells for the animation),
`assignment:updated`, `assignment:location`, `assignment:contact`, `chat:message`, `wallet:updated`, `notification:new`, `company:workers`,
`payment:updated`. Client → server: `pro:location`, `pro:heartbeat`, `room:join` (assignment/request rooms, authorized server-side).
Clients refetch state on every (re)connect; the server is authoritative for all timers (`expiresAt` and `serverNow` in payloads).

## 11. Push notifications
`PushService` with senders `log` (default), `expo` (expo-server-sdk) and `fcm` (firebase-admin; data messages, priority high, ttl = remaining
offer window, collapse key). Android channels: `offers_v1` (max importance, sound, vibration) and `default_v1`. Offers also go over the
socket, and the app polls `/pro/offers/current` on resume. Push payloads carry ids and amounts only, never phone numbers.

## 12. Integrations
- **WhatsApp OTP**: an `OtpChannel` port with `console` (dev log; `OTP_DEV_ECHO=true` returns the code in the response, never in production),
  `whatsapp_cloud` (Graph API v26.0, authentication template `tezfiks_login`, copy-code button, languages az/ru/en) and `webhook`
  (POST `{phone, code, locale, expiresAt}` signed with HMAC-SHA256 to the founder's own WhatsApp bot). Demo bypass: `OTP_BYPASS_PHONES` +
  `OTP_BYPASS_CODE`. Limits: 6 digits, 5-minute validity, 60 s resend cooldown, max 5 codes per phone per hour and 20 per IP per hour,
  5 attempts per code.
- **Google Maps**: the Android apps use the Maps SDK via react-native-maps without a Map ID (free SKU). A server key covers the Routes API
  (ETA: one computeRoutes on "Yola çıxdım", refreshed at most every 120 s or when off-route by > 150 m), Geocoding (reverse geocoding on
  pin confirm) and Places (New) autocomplete with session tokens. Without keys everything falls back (haversine × 1.35 at 25 km/h;
  coordinates as the address). Navigation uses deep links to Google Maps (`google.navigation:q=lat,lng`) and Waze
  (`https://waze.com/ul?ll=lat,lng&navigate=yes`), plus share.
- **Anthropic**: `claude-haiku-5-5` via `@anthropic-ai/sdk` 1.x, server-side only, `messages.parse` with a zod structured output
  (category enum = active service slugs + `other` + `unsure`; confidence high|medium|low; up to 3 candidates). The image is resized with sharp to
  1280 px JPEG. Timeout 10 s, 1 retry; any failure ⇒ the manual picker. Every call is logged in `AiClassification`. KYC images are never sent to Claude.
- **Storage**: a `StorageDriver` port (`local` disk volume now; `s3` for Supabase Storage or R2 later). Images are re-encoded with sharp
  (EXIF stripped). Signed URLs (HMAC, 10 minutes). KYC files are admin-only, every view is logged, `Cache-Control: private, no-store`,
  and they are purged 30 days after the decision.
- **Payments**: the `PaymentProvider` port; the `fake` provider now.

## 13. Mobile apps (screens map to the boards)

Shared look (board 01): primary `#00A971`, dark `#0B1B2B`, accent/fee `#F59E0B`, background `#F6F8FA`, danger `#E5484D`; font **Inter**
(Bold headings, SemiBold buttons, Regular text). Bottom tabs, rounded cards, green primary buttons, dark hero headers.

**Customer app "TezFiks"** (`az.tezfiks.app`, scheme `tezfiks`), board 02:
welcome/phone (A1) → OTP (A2) → profile name + photo → account type (individual, or company with name, VÖEN, contact person) (A3) →
Home (B1/B2: greeting, location, search, Ev/Avto toggle, featured tiles, "Bütün kateqoriyalar", "Şəkil ilə tap" AI button, active-request banner)
→ all categories (grouped, searchable) → create request (B3: address with map pin and structured fields, description, photos,
İndi/Planla/Təcili, date-time, number of handymen, provider preference for company accounts) → searching (B4: pulsing H3 rings, cancel)
→ tracking (B5: route, moving marker, "12 dəq məsafədə", handyman card, call/message locked until 5 min) → arrived (decline with the 15 AZN
warning) → payment (C1: cash/card + guarantee explainer) → tip → rating (C2) → orders (active/history) → chat → wallet (balance,
debt banner, test top-up, history) → addresses → business request (D) and project detail (compare/accept quotes, daily reports, invoice)
→ guarantee claim → notifications → profile (language, company info, logout, delete account).

**Pro app "TezFiks Usta"** (`az.tezfiks.usta`, scheme `tezfiksusta`), boards 03 and 04:
phone/OTP → "Usta kimi qoşulun" (Fərdi usta / Usta şirkəti / Dəvət linki) → solo profile (name, photo, trades, radius) or company
registration (name, legal form, VÖEN, trades, base address) → KYC (consent, ID front, ID back, guided selfie with 3 prompts) →
pending/rejected ("Yoxlama prosesi … adətən 24 saat ərzində") → Home (B1: map, name + trade, ONLAYN toggle, "Bu gün" stats: jobs,
earnings, platform fees; low-balance banner) → incoming offer modal (B2: 30 s countdown, service, address, distance/ETA, customer,
fee warning, İmtina et / Qəbul et) → active job (B3: timeline, customer card, "Naviqasiyanı aç", status buttons, unlocked phone/chat) →
complete (B4: keypad, labour + materials = total) → rate customer → balance (B5: current balance, warning, "+ Balansı artır", history)
→ earnings and payouts, payout card → "Planlı sifarişlər" → projects (open requests, quote form, my quotes, awarded projects with daily
reports, complete ⇒ invoice) → device setup (notification permission, location, battery tips, test offer) → profile.
**Company worker** mode shows the limited job screen of board 04 (location, Google Maps / Waze / Paylaş, "Yola çıxdım").
**Manager** mode (board 04): company home with the balance chip, incoming order card with "Qəbulda şirkət balansından 10 AZN tutulacaq",
"Ustanı seçin" (Boşdur/Sifarişdədir, rating, distance), İmtina et / Qəbul et və göndər; company settings "Yekun qiyməti kim daxil edir?";
members + invite link sharing; company jobs with manager price entry.

Technical: expo-router; TanStack Query; zustand; i18next + `intl-pluralrules`; expo-secure-store for the refresh token; socket.io-client;
react-native-maps (Google provider); expo-location with a **location foreground service started on "Onlayn"/"Yola çıxdım"** and **without
ACCESS_BACKGROUND_LOCATION**; expo-camera (KYC); expo-image-picker (photos); expo-image-manipulator (resize before upload);
expo-notifications (channels, device token); @react-native-community/datetimepicker; libphonenumber-js. Development builds (Expo Go
cannot run this app). API base URL from `EXPO_PUBLIC_API_URL`; Google key from `GOOGLE_MAPS_ANDROID_KEY` at build time.

## 14. Web panels (`apps/panel`, basePath `/tezfix`)

- `/tezfix/admin` (TezFiks admin, board 05): login (email/password); Dashboard (today's orders with delta, active handymen + online count,
  today's fee revenue "N sifariş × 10 ₼", cancellation rate, recent orders); Sifarişlər (list + detail with timeline, assignments, offers log,
  ledger entries, map); Ustalar (tabs Hamısı / Təsdiq gözləyən / Bloklanmış; columns per board; detail with side-by-side KYC review,
  approve/reject, block, strikes, wallet adjustment); Şirkətlər; Müştərilər; Ödənişlər (ledger, intents, payouts, invoices);
  Müraciətlər (guarantee, disputes); Layihələr (B2B); Kateqoriyalar; Tənzimləmələr (fees, timers, admins); Xəritə (live map with H3 hexes);
  Audit; Demo.
- `/tezfix/company` (company admin + dispatch; phone OTP login): Dashboard (balance, today's jobs, members online); **Dispatch** (incoming
  offers with countdown and worker picker, active jobs board, live worker map); Sifarişlər (with manager price entry); Ustalar (members,
  invites); Balans (top-up, history, earnings, payouts, payout card); Layihələr (quote requests, quotes, awarded projects, reports, invoices);
  Tənzimləmələr.
- `/tezfix/join/[token]`: public invite landing (open the app / Play Store).

Auth is BFF: Server Actions and Server Components call the API over the internal network; tokens live in httpOnly cookies (path `/tezfix`);
the API itself is Bearer-only. next-intl (az/ru/en via cookie, `Asia/Baku`), shadcn/ui on Tailwind 4, TanStack Table, react-hook-form + zod,
@vis.gl/react-google-maps.

## 15. Security
OTP limits (above) in Redis; argon2 for admin passwords; JWT access tokens (15 min) + rotating refresh tokens (30 days; reuse ⇒ session
revoked); role and ownership checks on every resource; zod validation on every input; upload limits (8 MB, images only, re-encoded);
per-IP and per-user rate limits on OTP, AI, geo and login; helmet; CORS limited to the panel origin; `trust proxy` for the reverse proxy;
an audit log for every admin mutation; idempotency keys for money; secrets only from the environment; KYC access logging and retention.
KYC files are never exposed to company users.

## 16. Deployment
`deploy/docker-compose.yml`: `postgres:17.11-alpine`, `redis:8-alpine` (AOF, `noeviction`, password), `api` (NestJS; HTTP, socket and workers;
`ROLE=all`), `migrate` (one-shot `prisma migrate deploy` + base seed), `panel` (Next.js standalone). Ports bound to 127.0.0.1 only.
`deploy/nginx/tezfiks.conf` with `location ^~ /tezfix/api/socket.io/` (upgrade, long timeouts), `location ^~ /tezfix/api/` and
`location ^~ /tezfix/` (panel, `X-Forwarded-Host`); the Apache equivalent is documented. Cloudflare: Full (strict), WebSockets on, cache bypass
and Browser Integrity Check off for `/tezfix/api`. `.env.example` documents every variable. `docs/deploy.md` is the runbook (first deploy,
updates, backups with a `pg_dump` cron, the Supabase move).

## 17. Demo tooling
- **Seed** (migrate service): categories (az/ru/en), platform ledger accounts, settings, the first admin from the environment.
- **Demo seed** (`DEMO_MODE=true`): FixPro MMC with Rauf Hüseynov, Tural Əliyev, Kamran Səfərov; solo Elvin Məmmədov (santexnik), Samir Quliyev
  (pending), Vüqar Nəbiyev (blocked); customers Nizami T., Aysel Q., Kontur MMC; historical orders in every status; balances.
- **Simulator** (admin "Demo" page, DEMO_MODE only): spawn bot handymen around Baku, auto-accept after N seconds, drive to the customer along
  the route at a set speed (contact unlock and arrival happen live), propose a price, and create test requests at a chosen point so the pro
  app can be tried alone. Bots are flagged `isBot` and excluded from KPIs.

## 18. Testing
- `packages/shared`: unit tests (money, phone, time, schemas).
- API: unit tests for policies (fee and cancellation matrix, ring schedule, ETA and unlock, state transitions, VAT) and **integration tests against
  real Postgres + Redis** (Docker): OTP login; request → dispatch → concurrent accept race; ledger invariants (entries sum to zero, cached balances
  equal entry sums); every cancellation path; completion + card payment + tip + payout; company accept with workers; scheduled pre-assignment;
  B2B award + invoice; guarantee re-dispatch; privacy (no phone before unlock; worker view limits).
- Mobile: strict TypeScript, jest-expo unit tests for formatters, stores and hooks, Android JS bundle export, Gradle debug build.
- Panel: strict TypeScript, `next build`, smoke test against a seeded API.

## 19. Open items and flags (none blocks the build)
- **Legal**: closed-loop fee balances are likely outside Azerbaijan's e-money rules, but card job payments, tips, B2B invoice collection and
  weekly payouts move customer money to providers, which is a regulated payment service. Confirm with counsel and use a licensed provider
  before real money.
- WhatsApp authentication templates require a Meta-verified business; until then the demo uses the bypass/console channel or the founder's bot webhook.
- Push needs a Firebase project (google-services.json) or Expo push credentials; without them offers still arrive over the socket while the app is open.
- Google keys (Android key restricted to package + SHA-1; IP-restricted server key) and an Anthropic key are needed for maps and AI.
- Panel paths `/tezfix/admin` and `/tezfix/company`, and the Android package ids `az.tezfiks.app` / `az.tezfiks.usta`, are assumptions to
  confirm before the first store upload.
- A real KYC vendor (Sumsub or Veriff) and a real acquirer (Payriff or Epoint) at launch, behind the existing ports.
