# TezFiks web panels (Next.js standalone). Build from the repository root:
#   docker build -f apps/panel/Dockerfile -t tezfiks-panel .
# NEXT_PUBLIC_* values are baked in at build time.
FROM node:24-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/i18n/package.json packages/i18n/
COPY packages/mobile/package.json packages/mobile/
COPY apps/api/package.json apps/api/
COPY apps/customer/package.json apps/customer/
COPY apps/pro/package.json apps/pro/
COPY apps/panel/package.json apps/panel/
RUN npm ci --workspace @tezfiks/panel --workspace @tezfiks/shared --workspace @tezfiks/i18n --include-workspace-root=false

FROM deps AS build
ARG NEXT_PUBLIC_SOCKET_URL=
ARG NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL \
    NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/i18n packages/i18n
COPY apps/panel apps/panel
RUN npm run build -w @tezfiks/shared && npm run build -w @tezfiks/panel

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /repo/apps/panel/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/panel/.next/static ./apps/panel/.next/static
USER node
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/tezfix/admin/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/panel/server.js"]
