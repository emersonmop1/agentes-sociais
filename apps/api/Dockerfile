# ─── Build stage ─────────────────────────────────────────────────────
FROM node:22-alpine AS build

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /repo

# Copy workspace metadata first for better layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml* package.json .npmrc ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile=false --filter @agentes/api...

# Now copy sources
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN pnpm --filter @agentes/api build

# ─── Runtime stage ───────────────────────────────────────────────────
FROM node:22-alpine AS runtime

RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
RUN apk add --no-cache tini

WORKDIR /app

COPY --from=build /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml* /repo/package.json /repo/.npmrc ./
COPY --from=build /repo/packages/shared/package.json ./packages/shared/
COPY --from=build /repo/apps/api/package.json ./apps/api/

# Production-only install
RUN pnpm install --frozen-lockfile=false --prod --filter @agentes/api...

COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/packages/shared/src ./packages/shared/src

ENV NODE_ENV=production
ENV API_PORT=8000
EXPOSE 8000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "apps/api/dist/index.js"]
