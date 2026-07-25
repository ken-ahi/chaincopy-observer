FROM node:24.12.0-alpine AS workspace

RUN apk add --no-cache libc6-compat openssl
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/analytics/package.json packages/analytics/package.json
COPY packages/blockchain-adapters/package.json packages/blockchain-adapters/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/demo-trading/package.json packages/demo-trading/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/notification/package.json packages/notification/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm db:generate

FROM workspace AS migrate
CMD ["pnpm", "db:migrate:deploy"]

FROM workspace AS api
RUN node node_modules/turbo/bin/turbo run build --filter=@chaincopy/api...
EXPOSE 3001
CMD ["pnpm", "--filter", "@chaincopy/api", "start"]

FROM workspace AS worker
RUN node node_modules/turbo/bin/turbo run build --filter=@chaincopy/worker...
EXPOSE 3002
CMD ["pnpm", "--filter", "@chaincopy/worker", "start"]

FROM workspace AS web-builder
RUN node node_modules/turbo/bin/turbo run build --filter=@chaincopy/web...

FROM node:24.12.0-alpine AS web

RUN apk add --no-cache libc6-compat openssl

WORKDIR /app

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=web-builder /app/apps/web/.next/standalone ./
COPY --from=web-builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
