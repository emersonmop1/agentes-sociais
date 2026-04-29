# ─── Build stage ─────────────────────────────────────────────────────
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json .npmrc ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/worker/package.json ./apps/worker/

RUN pnpm install --frozen-lockfile=false --filter @agentes/worker...

COPY packages/shared ./packages/shared
COPY apps/worker ./apps/worker

RUN pnpm --filter @agentes/worker build

# ─── Runtime stage ───────────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
RUN apk add --no-cache tini

WORKDIR /app

COPY --from=build /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml* /repo/package.json /repo/.npmrc ./
COPY --from=build /repo/packages/shared/package.json ./packages/shared/
COPY --from=build /repo/apps/worker/package.json ./apps/worker/

RUN pnpm install --frozen-lockfile=false --prod --filter @agentes/worker...

COPY --from=build /repo/apps/worker/dist ./apps/worker/dist
COPY --from=build /repo/packages/shared/src ./packages/shared/src

ENV NODE_ENV=production

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/worker/dist/index.js"]
