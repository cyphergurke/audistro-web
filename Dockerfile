# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PNPM_STORE_DIR=/pnpm/store
ENV PATH=${PNPM_HOME}:${PATH}
RUN npm install -g pnpm@10.9.2

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store \
    sh -lc 'for attempt in 1 2 3 4 5; do pnpm fetch --frozen-lockfile && exit 0; sleep $((attempt * 2)); done; exit 1'

FROM base AS builder
WORKDIR /app
COPY --from=deps /pnpm/store /pnpm/store
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY . .
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline \
    && pnpm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.js ./next.config.js
EXPOSE 3000
CMD ["pnpm", "run", "start"]
