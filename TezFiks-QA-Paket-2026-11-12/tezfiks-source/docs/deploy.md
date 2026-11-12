# TezFiks deployment runbook

Target: one Linux server with Docker, behind the existing nginx for `evosmart.az` (optionally behind Cloudflare).

| Public URL | Served by |
|---|---|
| `https://evosmart.az/tezfix/api/...` | API container (REST, test-mode checkout pages, signed file URLs) |
| `wss://evosmart.az/tezfix/api/socket.io/` | API container (Socket.IO: offers, live tracking, chat) |
| `https://evosmart.az/tezfix/admin`, `/tezfix/company`, `/tezfix/join/<token>` | Panel container (Next.js) |

Everything else (Postgres, Redis) stays on the Docker network. Every published port binds to `127.0.0.1`.

## 1. First deploy

1. Install Docker Engine with the compose plugin. Copy the repository to the server (git clone, or rsync without `node_modules`).
2. Create the environment file and fill in every REQUIRED value:
   ```bash
   cp deploy/.env.example deploy/.env
   openssl rand -hex 32   # use for JWT_SECRET
   openssl rand -hex 24   # use for POSTGRES_PASSWORD and REDIS_PASSWORD
   ```
   Set `ADMIN_BOOTSTRAP_EMAIL` / `ADMIN_BOOTSTRAP_PASSWORD` (the first TezFiks admin). Keep `DEMO_MODE=true` for the demo.
3. Build and start:
   ```bash
   docker compose -f deploy/docker-compose.yml up -d --build
   docker compose -f deploy/docker-compose.yml ps        # migrate = exited (0); api, panel = healthy
   curl -fsS http://127.0.0.1:3300/tezfix/api/health
   ```
   The one-shot `migrate` service applies database migrations and the base seed (categories, platform accounts, settings, first admin).
   It is safe to run on every deploy.
4. Optional demo data (FixPro MMC, demo handymen and customers, historical orders):
   ```bash
   docker compose -f deploy/docker-compose.yml exec api node dist/prisma/seed/demo.js
   ```
5. nginx: copy `deploy/nginx/tezfiks.conf` to `/etc/nginx/snippets/tezfiks.conf`, run `sh deploy/nginx/cloudflare-realip.sh` (writes
   `/etc/nginx/snippets/tezfiks-cloudflare-realip.conf`), add `include /etc/nginx/snippets/tezfiks.conf;` inside the HTTPS
   `server { ... }` block of `evosmart.az` (on evosmart.az: just before its `location / {`), then `nginx -t && systemctl reload nginx`.
   The evosmart.az site file is installed by the main site's own deploy script: add the same `include` line to that repo's
   `deploy/nginx/evosmart.conf`, or the next main-site deploy removes it.
6. Open `https://evosmart.az/tezfix/admin/login` and sign in with the bootstrap admin.

### Panels on tezfiks.evosmart.az

`deploy/nginx/tezfiks-subdomain.conf` is a self-contained vhost for `tezfiks.evosmart.az` (the root redirects to the admin
login; the API and Socket.IO paths come from the same snippet). Install it as `/etc/nginx/sites-available/tezfiks`, symlink it
into `sites-enabled`, and issue the certificate the same way as the other evosmart.az names:

```bash
# first enable only the :80 server block (certbot's challenge proxy), then:
certbot certonly --standalone --http-01-port 8888 --http-01-address 127.0.0.1 -d tezfiks.evosmart.az --deploy-hook "systemctl reload nginx"
# then install the full file (adds the :443 block) and: nginx -t && systemctl reload nginx
```

### Cloudflare (if the domain is proxied)

- SSL/TLS mode **Full (strict)**; Network: **WebSockets on**.
- A Cache Rule that **bypasses cache** for `/tezfix/api*`, and a Configuration Rule that turns **Browser Integrity Check off** for `/tezfix/api*`
  (the mobile apps are not browsers).
- Client IPs: `deploy/nginx/cloudflare-realip.sh` writes the Cloudflare ranges (`set_real_ip_from` + `real_ip_header CF-Connecting-IP`)
  that the TezFiks locations include. Re-run it monthly. Without it all users share Cloudflare's addresses and hit the per-IP login limits together.

### Apache instead of nginx

```apache
# Inside the evosmart.az <VirtualHost *:443>; needs mod_proxy, mod_proxy_http, mod_proxy_wstunnel, mod_rewrite, mod_headers.
ProxyPreserveHost On
RequestHeader set X-Forwarded-Proto "https"
RewriteEngine On
RewriteCond %{HTTP:Upgrade} =websocket [NC]
RewriteRule ^/tezfix/api/socket.io/(.*) ws://127.0.0.1:3300/tezfix/api/socket.io/$1 [P,L]
ProxyPass        /tezfix/api/ http://127.0.0.1:3300/tezfix/api/ timeout=3600
ProxyPassReverse /tezfix/api/ http://127.0.0.1:3300/tezfix/api/
ProxyPass        /tezfix/ http://127.0.0.1:3310/tezfix/
ProxyPassReverse /tezfix/ http://127.0.0.1:3310/tezfix/
```

### Client IPs and `TRUST_PROXY`

nginx reaches the containers through the Docker bridge and the panel calls the API over the Docker network, so the API must trust private
hops: `TRUST_PROXY=loopback, uniquelocal` (the default in `.env.example`). The real client is then the right-most public address in
`X-Forwarded-For`, which a client cannot forge.

## 2. Updating

```bash
git pull
docker compose -f deploy/docker-compose.yml up -d --build    # rebuilds images, re-runs migrate, restarts api and panel
docker image prune -f
```

Migrations are forward-only (`prisma migrate deploy`). Take a backup (below) before every update.

## 3. Backups

Nightly database dump with 14 days of retention (root crontab, adjust the path):

```cron
30 3 * * * cd /opt/tezfiks && docker compose -f deploy/docker-compose.yml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > /var/backups/tezfiks/db-$(date +\%F).dump && find /var/backups/tezfiks -name 'db-*.dump' -mtime +14 -delete
```

Uploaded files (photos, KYC documents) live in the `tezfiks_uploads` volume:

```bash
docker run --rm -v tezfiks_uploads:/data -v /var/backups/tezfiks:/backup alpine tar czf /backup/uploads-$(date +%F).tgz -C /data .
```

Restore a dump: `docker compose -f deploy/docker-compose.yml exec -T postgres pg_restore -U tezfiks -d tezfiks --clean --if-exists < db-YYYY-MM-DD.dump`.

## 4. Moving the database to Supabase later

1. Create the Supabase project. In the SQL editor run `create extension if not exists pg_trgm;` (the search indexes need it).
2. Stop writes (`docker compose ... stop api panel`), dump the local database (above) and restore it into Supabase with `pg_restore --no-owner --no-acl`
   using the **direct** connection string.
3. In `deploy/.env` set:
   ```bash
   DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres   # session pooler
   DIRECT_URL=postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres                        # migrations
   ```
4. Files: either keep `STORAGE_DRIVER=local`, or switch to Supabase Storage with `STORAGE_DRIVER=s3` and its S3 credentials
   (`S3_ENDPOINT=https://<ref>.supabase.co/storage/v1/s3`, `S3_REGION`, `S3_BUCKET`, keys), after copying the `uploads` volume into the bucket.
5. `docker compose -f deploy/docker-compose.yml up -d --build`. The local `postgres` service can then be removed from the compose file.

## 5. Rebuilding the Android apps with the production API URL

The API URL is baked into the apps at build time (`EXPO_PUBLIC_API_URL`). For each app (`apps/customer` = TezFiks, `apps/pro` = TezFiks Usta):

```bash
cd apps/customer                     # or apps/pro
export EXPO_PUBLIC_API_URL=https://evosmart.az/tezfix/api
export GOOGLE_MAPS_ANDROID_KEY=...   # optional; without it the map uses OpenStreetMap tiles
export TEZFIKS_RELEASE_STORE_FILE=... TEZFIKS_RELEASE_STORE_PASSWORD=... TEZFIKS_RELEASE_KEY_ALIAS=... TEZFIKS_RELEASE_KEY_PASSWORD=...
npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease     # APK in android/app/build/outputs/apk/release/
```

- Release builds are signed with the company release key (`TEZFIKS_RELEASE_*`, never the debug key; the build fails
  without them). Creating/backing up the key, verifying APK signatures and the Google Cloud Maps key setup:
  [android-release-signing.md](android-release-signing.md).
- Restrict the Android Maps key to the package names `az.tezfiks.app` / `az.tezfiks.usta` and the release certificate SHA-1.
- Push notifications need a Firebase project (`google-services.json`) or Expo push credentials, plus `PUSH_PROVIDER` on the server.
  Without them, offers still arrive over the socket while the app is open.

## 6. Operations

- Logs: `docker compose -f deploy/docker-compose.yml logs -f api` (NestJS logger, one line per request; `LOG_LEVEL` in `.env`).
- Health: `GET /tezfix/api/health` (container healthcheck); public config: `GET /tezfix/api/config/public`.
- Scale-out note: the API runs as one process (`ROLE=all`: HTTP, Socket.IO, jobs). Running several replicas needs the Socket.IO Redis adapter
  and `ROLE=api` / `ROLE=worker` split; not needed for the demo.
