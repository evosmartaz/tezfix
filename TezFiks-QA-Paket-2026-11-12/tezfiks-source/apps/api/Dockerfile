# TezFiks API image (NestJS). Build from the repository root:
#   docker build -f apps/api/Dockerfile -t tezfiks-api .
FROM node:24-bookworm-slim AS deps
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/i18n/package.json packages/i18n/
COPY packages/mobile/package.json packages/mobile/
COPY apps/api/package.json apps/api/
COPY apps/customer/package.json apps/customer/
COPY apps/pro/package.json apps/pro/
COPY apps/panel/package.json apps/panel/
RUN npm ci --workspace @tezfiks/api --workspace @tezfiks/shared --workspace @tezfiks/i18n --include-workspace-root=false --ignore-scripts=false

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/i18n packages/i18n
COPY apps/api apps/api
RUN npm run build -w @tezfiks/shared && npm run build -w @tezfiks/api

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/package.json ./
COPY --from=build /repo/packages/shared/package.json packages/shared/package.json
COPY --from=build /repo/packages/shared/dist packages/shared/dist
COPY --from=build /repo/packages/i18n packages/i18n
COPY --from=build /repo/apps/api/package.json apps/api/package.json
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/prisma apps/api/prisma
COPY --from=build /repo/apps/api/prisma.config.ts apps/api/prisma.config.ts
WORKDIR /repo/apps/api
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/'+(process.env.API_PREFIX||'tezfix/api')+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/src/main.js"]
