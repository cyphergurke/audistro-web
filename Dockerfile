# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PNPM_STORE_DIR=/pnpm/store
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /app
RUN npm install -g pnpm@10.30.3

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=audistro-web-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone /app
COPY --from=builder --chown=nextjs:nodejs /app/.next/static /app/services/audistro-web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public /app/services/audistro-web/public

USER nextjs
WORKDIR /app/services/audistro-web
EXPOSE 3000

CMD ["node", "server.js"]
