# TezFiks demo: seed, logins and the bot simulator

This page explains how to fill a database with demo data, log into the apps with the demo phones (no WhatsApp needed),
and run a live demo with bot handymen. The demo tooling is spec §17 and lane B6 of the build plan.

## 1. Seed the demo data

The demo seed needs a migrated database with the base seed (categories, platform ledger accounts, first admin):

```bash
cd apps/api
npx prisma migrate deploy
npm run seed                       # base seed (set ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD for the first admin)
DEMO_MODE=true npm run seed:demo   # demo seed (development, tsx)
```

In the production image (see `docs/deploy.md`, step 4) run the compiled script instead:

```bash
docker compose exec api node dist/prisma/seed/demo.js
```

Notes:

- The seed refuses to run unless `DEMO_MODE=true` is set (or `--force` is passed), because it adds demo users, jobs and money.
- It is idempotent. A finished seed is recorded in the platform setting `demo.seed`, and running it again changes nothing.
  If a run was interrupted, the next run continues with the unfinished steps.
- `npm run seed:demo` runs under tsx, which cannot emit the decorator metadata that NestJS needs. The script therefore compiles
  the API once with `tsc -p tsconfig.build.json` into `apps/api/node_modules/.cache/tezfiks-seed-demo` and runs the
  compiled copy. This adds a few seconds. `node dist/prisma/seed/demo.js` runs directly.
- Everything goes through the real services: onboarding, KYC and admin review, invite links, requests, dispatch, offers, the job
  lifecycle, test payments, cases and projects. Money moves only through the ledger with idempotency keys, so after the seed the
  ledger sum is 0 and the integrity check finds no differences.
- The history is played two days in the past (the business Clock is moved back during the seed and restored afterwards).
- Run the seed before you spawn bots. While it runs, bots that are already online could also receive the seed's requests.

### What the seed creates

| Who | What |
|---|---|
| FixPro MMC | Approved company (VÖEN 1700234561), trades: electrical, plumbing, air conditioning, renovation crew. Manager Rauf Hüseynov, workers Tural Əliyev and Kamran Səfərov. Company wallet: 240 AZN available. |
| Elvin Məmmədov | Approved solo handyman (santexnik, also heating and renovation crew), based in Sahil about 400 m from Fountain Square. Wallet: 34 AZN available. Starts offline. |
| Samir Quliyev | Solo handyman, KYC submitted with placeholder images, waiting for admin review. |
| Vüqar Nəbiyev | Solo handyman, approved and then blocked. |
| Nizami Talıbov | Individual customer, 100 AZN. Has one completed cash job, one free cancellation and one job in progress (Kamran is en route). |
| Aysel Qasımova | Individual customer. Has a card-paid job (guarantee and a 5 AZN tip) with an open guarantee case, and a late cancellation (15 AZN penalty). |
| Kontur MMC | Company customer (VÖEN 1234567890, contact Leyla Rzayeva). Has an expired request (nobody offers commercial refrigeration) and an open B2B project ("Ofisin təmiri", ≈ 450 m²) with quotes from FixPro MMC and Elvin. |
| Demo Müştəri | Demo customer used for test requests from the admin panel. Its wallet is topped up automatically. |

## 2. Demo logins

| Phone | App | Name | Role |
|---|---|---|---|
| +994 50 200 00 01 | pro | Elvin Məmmədov | Solo handyman, approved, 34 AZN |
| +994 50 200 00 02 | pro | Samir Quliyev | Solo handyman, KYC pending |
| +994 50 200 00 03 | pro | Vüqar Nəbiyev | Solo handyman, blocked |
| +994 50 200 00 11 | pro + company panel | Rauf Hüseynov | FixPro MMC manager |
| +994 50 200 00 12 | pro | Tural Əliyev | FixPro MMC worker |
| +994 50 200 00 13 | pro | Kamran Səfərov | FixPro MMC worker (job en route) |
| +994 55 200 00 21 | customer | Nizami Talıbov | Customer, job in progress |
| +994 55 200 00 22 | customer | Aysel Qasımova | Customer, open guarantee case |
| +994 55 200 00 23 | customer | Leyla Rzayeva (Kontur MMC) | Company customer, B2B project |
| +994 55 200 00 24 | customer | Demo Müştəri | Demo customer |

The admin panel (`/tezfix/admin`) uses the email and password of the base-seed admin (`ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD`).
The company panel (`/tezfix/company`) uses Rauf's phone.

### OTP without WhatsApp

Start the API with one of these settings:

```bash
# Any environment, including the production demo: these phones always accept the code 123456.
OTP_BYPASS_PHONES=+994502000001,+994502000002,+994502000003,+994502000011,+994502000012,+994502000013,+994552000021,+994552000022,+994552000023,+994552000024
OTP_BYPASS_CODE=123456

# Development only (the API refuses it when NODE_ENV=production): the code is returned as devCode in the OTP response.
OTP_DEV_ECHO=true
```

With the default `OTP_CHANNEL=console`, every OTP code is also printed in the API log.

Bot handymen use `+994 00 …` numbers. No operator uses this prefix, so nobody can log in as a bot and no real person's number is taken.

## 3. Driving a demo with bots

The simulator runs inside the API when `DEMO_MODE=true`. `DEMO_MODE=true` also turns on the fast demo timers
(offers 15 s, rings every 10 s, search 90 s, cash auto-completion after 10 min; see spec §4).

Admin panel → **Demo** (or the API under `/tezfix/api/admin/demo`):

1. **Spawn bots**: `POST /admin/demo/bots` with `{ "count": 5, "radiusKm": 3, "center": { "lat": 40.3777, "lng": 49.8531 }, "tradeIds"?: [...], "companyId"?: "..." }`.
   - Solo bots: approved handymen (`isBot=true`) with 100 AZN funded through an `ADMIN_ADJUSTMENT`, placed at random inside the circle and
     put online. Their trades are the given `tradeIds`, or else all featured services.
   - With `companyId` (an approved company): the bots become workers of that company and get its trades (or the given subset). They have
     no wallet of their own, because the company pays the fee.
2. **Create a request**: either log into the customer app (for example as Nizami or the demo customer) and order, or use
   `POST /admin/demo/requests` with `{ "categoryId": "...", "lat": 40.39, "lng": 49.86, "timing"?: "NOW" | "EMERGENCY" | "SCHEDULED", "slots"?: 1, "scheduledAt"?: "...", "description"?: "..." }`.
   This creates the request as the demo customer (or as `customerUserId`) through the normal request service, so dispatch starts.
   It also lets you try the pro app on its own: log in as Elvin, go online near the point, and the offer arrives.
3. **Watch a bot**: once a bot has an offer, it
   - accepts it `acceptDelaySec` seconds after the offer was sent (default 4 s), through the same service as the pro app's accept;
   - leaves `acceptDelaySec` later. Scheduled jobs leave 30 minutes before `scheduledAt`;
   - drives along the computed route at `speedKmh` (default 40 km/h) and sends a location every 2 s. The customer sees it move,
     the ETA updates, and phone and chat unlock when the ETA drops to 5 minutes;
   - marks itself arrived at the address (`autoArrive`);
   - proposes `priceLabor + priceMaterials` (default 35 + 10 AZN) `acceptDelaySec` after arriving (`autoPrice`). For company jobs it does
     this only when the company lets the worker enter the price. With `finalPriceEntry = MANAGER`, the manager enters it in the panel or app.
   The customer then pays cash or by test card (4242 4242 4242 4242) exactly as with a human handyman.
4. **Tune it**: `PATCH /admin/demo/config` with any of `autoAccept`, `acceptDelaySec` (1–120), `speedKmh` (5–300), `autoArrive`, `autoPrice`,
   `priceLabor`, `priceMaterials` (qəpik). The values are stored in the platform setting `demo.config` and apply on the next tick.
5. **Remove the bots**: `DELETE /admin/demo/bots`. Bots are never deleted, because the ledger is append-only and their jobs and offers are
   history. Their unfinished jobs (accepted, en route or arrived) are cancelled through the admin cancellation (no fee kept, no penalty) and
   the slot is sent to other handymen. Their open offers are declined, the rest of their wallet goes back to the platform, and the bot user
   is deactivated (offline, left its company, hidden from the demo page). Jobs where a bot already proposed a price stay payable.

Bots only accept offers sent to themselves. Company offers stay with the company's manager, who can pick a bot worker on the dispatch board.
The simulator never acts for a handyman whose `isBot` flag is false.

### How the simulator runs

- It is a `demo.tick` job of the normal job system (BullMQ in production), run once per second and scheduled again after every run,
  with at most one job per second. The `demo.simulator` reconciler task starts it again after a restart (every `RECONCILER_INTERVAL_SEC`).
- Every step is computed from the database and the Clock: whether an offer is due for acceptance, whether to leave, where the bot is on
  its route, and when to arrive. A restarted API therefore picks up a bot mid-route where it would have been. A Redis lock makes sure that
  two processes never act for the same bot at once.
- All bot actions use the real services (offers, assignment actions, presence and tracking), so fees, holds, notifications, sockets,
  ETA and contact unlock behave exactly as for people. Bots are flagged `isBot` and are left out of the admin KPIs.

## 4. Quick checklist for an end-to-end demo

1. Start Postgres and Redis (`npm run dev:db`), then migrate and run the base seed and the demo seed (section 1).
2. Start the API with `DEMO_MODE=true` and the OTP bypass from section 2 (for local emulator builds use port 3300, see CLAUDE.md).
3. Admin panel → Demo → spawn 5 bots around the centre.
4. Customer app → log in as `+994 55 200 00 24` (code 123456) → order a plumber near the centre → a bot accepts, drives, arrives and proposes 45 AZN → pay by card → tip → rate.
5. Pro app → log in as Elvin (`+994 50 200 00 01`) → go online → create a request at his location from the admin Demo page → accept the offer in the app.
6. Pro app or company panel → log in as Rauf (`+994 50 200 00 11`) → company offers and Kamran's job en route.
