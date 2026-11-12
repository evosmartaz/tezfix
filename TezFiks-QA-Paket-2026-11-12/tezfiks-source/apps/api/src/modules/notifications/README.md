# Notifications (lane A3)

`NotificationsService` (exported by `NotificationsModule`):

```ts
notify(userId: string, type: NotificationType, opts?: NotifyOptions): Promise<NotificationView | null>
notifyMany(userIds: string[], type: NotificationType, opts?: NotifyOptions): Promise<NotificationView[]>

interface NotifyOptions {
  vars?: Record<string, string | number>;   // translation variables (table below)
  data?: Record<string, unknown>;           // ids and amounts only; stored + pushed
  app?: 'CUSTOMER' | 'PRO' | 'PANEL';       // push only to devices of this app
  push?: boolean;                           // default true
  priority?: 'high' | 'normal';             // default high for OFFER_NEW, else normal
  ttlSec?: number;                          // push TTL (offers: remaining offer window)
  collapseKey?: string;                     // FCM collapse key / Expo collapseId
  channelId?: 'offers_v1' | 'default_v1';   // default offers_v1 for OFFER_NEW, else default_v1
}
```

What `notify` does: creates a `Notification` row with title/body translated into the **recipient's** locale
(`server.notifications.<TYPE>.title|body` in `packages/i18n/locales/<lng>/server/notifications.json`), emits
`notification:new` to `user:<id>`, then pushes to the user's devices (`PushService`, never throws). Unknown or
DELETED users are skipped (`null`). Call it **after** your transaction commits.

Privacy: data keys containing `phone`/`msisdn`/`whatsapp` or address-like keys (`address`, `apartment`, `intercom`,
`entrance`, `formatted`, except `...Id`) are dropped, and phone-like strings in `data` and `vars` are replaced by `•••`.
Still: pass ids and amounts only.

## Variables

All values are strings or numbers. `amount` is a pre-formatted money string (`formatMoney(qepik, locale)`), `distance`
is pre-formatted (`formatDistance(m, locale)`), `date` is pre-formatted Baku local date/time, `number` is the request /
project / invoice / case number. Missing vars render as empty strings.

| Type | vars | typical data |
| --- | --- | --- |
| OFFER_NEW | `category`, `number`, `distance` | `offerId`, `requestId`, `expiresAt` |
| OFFER_CLOSED | `number` | `offerId`, `requestId`, `reason` |
| REQUEST_ASSIGNED | `name` (provider display name), `number` | `requestId`, `assignmentId` |
| REQUEST_EXPIRED | `number` | `requestId` |
| REQUEST_CANCELLED | `number` | `requestId` |
| ASSIGNMENT_EN_ROUTE | `name`, `minutes` | `assignmentId` |
| ASSIGNMENT_NEAR | `name`, `minutes` | `assignmentId` |
| ASSIGNMENT_ARRIVED | `name` | `assignmentId` |
| ASSIGNMENT_CANCELLED | `number` | `assignmentId`, `requestId` |
| PRICE_PROPOSED | `name`, `amount` | `assignmentId`, `total` |
| ASSIGNMENT_COMPLETED | `number` | `assignmentId` |
| PAYMENT_SUCCEEDED | `amount` | `paymentIntentId`, `assignmentId?` |
| TIP_RECEIVED | `amount` | `assignmentId`, `amount` |
| RATING_RECEIVED | `number` | `assignmentId` |
| CHAT_MESSAGE | `name` (sender display name; never the message text) | `assignmentId`, `messageId` |
| WORKER_ASSIGNED | `number`, `category` | `assignmentId` |
| KYC_APPROVED | – | – |
| KYC_REJECTED | `reason` | `submissionId` |
| COMPANY_APPROVED | `company` | `companyId` |
| COMPANY_REJECTED | `company`, `reason` | `companyId` |
| ACCOUNT_BLOCKED | `reason` | – |
| SCHEDULED_REMINDER | `number`, `date` | `requestId` |
| SCHEDULED_UNFILLED | `number`, `date` | `requestId` |
| WALLET_LOW | `amount` (current available balance) | `available` |
| WALLET_TOPUP | `amount` | `paymentIntentId` |
| PAYOUT_PAID | `amount` | `payoutId` |
| PROJECT_NEW | `number`, `category` | `projectId` |
| QUOTE_RECEIVED | `company`, `number`, `amount` | `projectId`, `quoteId` |
| QUOTE_ACCEPTED | `number` | `projectId`, `quoteId` |
| QUOTE_REJECTED | `number` | `projectId`, `quoteId` |
| PROJECT_REPORT | `company`, `number` | `projectId`, `reportId` |
| INVOICE_ISSUED | `number`, `amount` | `invoiceId`, `projectId` |
| INVOICE_PAID | `number`, `amount` | `invoiceId` |
| CASE_UPDATED | `number` | `caseId` |
| GENERIC | `title`, `body` (free text, already localized by the caller; empty title falls back to "TezFiks") | any |

## Push

`PushService.sendToUsers(userIds, message, { app? })` / `deliver(deliveries, message)`. Senders: `log` (default;
in-memory `LogPushSender.sent`, used by tests), `expo` (expo-server-sdk, devices with `pushProvider = EXPO`) and `fcm`
(firebase-admin, `FCM_SERVICE_ACCOUNT` = file path or inline JSON; devices with `pushProvider = FCM`). With
`PUSH_PROVIDER=log` every device goes to the log sender; otherwise each device goes to its provider's sender.

Payload: `{ type, title, body, data }`. FCM sends **data messages** shaped for expo-notifications:
`data = { type, title, message: <body>, body: JSON.stringify({ type, ...data }), channelId, priority, sound? }`,
`android = { priority: high|normal, ttl: ttlSec*1000, collapseKey }`. Tokens reported as unregistered
(`DeviceNotRegistered`, `messaging/registration-token-not-registered`, `messaging/invalid-registration-token`) are
cleared from the device rows (`pushToken = null`).
A failed FCM initialisation (missing or broken service-account file) is retried on the next send after 60 s.
Phone redaction also masks numbers written without `0`/`+994` (`50 123 45 67`, `501234567`, `(55) 123-45-67`).

## Realtime and presence contract for other lanes (RealtimeModule)

- **Presence writes are atomic** (one Redis Lua script each). A location ping only writes location fields and `ts`;
  it never changes `busy` or `online`. `setBusy` owns `busy`; `setOnline`/`setOffline` own `online`.
- **Order for B2**: commit the DB flags first (`isOnline`, and `onlineSince = now` when going online), then call
  `PresenceService.setOnline` / `setOffline`. `setOffline` leaves a 120 s offline marker, so a ping that read stale DB
  state cannot bring the pro back online; `setOnline` clears it.
- **B1/B3**: call `setBusy(handymanId, true|false)` after the accept / finish transaction commits.
- **`LocationEvent.assignmentId` is untrusted client input.** Use `verifiedAssignmentId` (set only when the assignment
  belongs to the pinging handyman) for ETA, contact unlock and anything else.
- **Membership changes (B2)**: after removing, demoting or promoting a company member, call
  `RoomAccessService.refreshUser(userId)`; live sockets leave company/assignment rooms they may no longer join and join
  new manager rooms. The `realtime.sweep` reconciler task does the same for every connected user and disconnects
  sockets whose session was revoked; every client event also re-checks the session (`UNAUTHORIZED` ack + disconnect).
- **Snapshot** (`presence.snapshot` reconciler task): DB location snapshot at most every 60 s (Clock); online Redis
  entries whose DB `isOnline` is false are demoted; pros are set offline only when both `lastSeenAt` and `onlineSince`
  are older than 30 min and their Redis entry is not fresh.
