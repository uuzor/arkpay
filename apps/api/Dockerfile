FROM node:20-slim AS build

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@9

WORKDIR /app

# Workspace manifests first so dependency layers cache.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

# COPY merges into the layer, so clear the source tree first or files deleted
# from the repo (e.g. renamed services) survive from an older build and get
# compiled. Never delete apps/api/node_modules: pnpm's links live there.
RUN rm -rf apps/api/src apps/api/prisma apps/api/test
COPY apps/api apps/api
RUN pnpm --filter @arkpay/api exec prisma generate
# AI SDK/toolkit types are heavy; cap the compiler heap for the 4 GB VPS.
RUN NODE_OPTIONS=--max-old-space-size=3072 pnpm --filter @arkpay/api build

WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3001

# Migrations run once per container start; Prisma is idempotent on an
# already-migrated database.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
