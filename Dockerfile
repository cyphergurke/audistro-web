# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PNPM_STORE_DIR=/pnpm/store
ENV PATH=${PNPM_HOME}:${PATH}
WORKDIR /app

FROM base AS deps
RUN npm install -g pnpm@10.9.2
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store \
    sh -lc 'for attempt in 1 2 3 4 5; do pnpm fetch --frozen-lockfile && exit 0; sleep $((attempt * 2)); done; exit 1'

FROM base AS builder
RUN npm install -g pnpm@10.9.2
COPY --from=deps /pnpm/store /pnpm/store
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline
COPY . .
RUN pnpm build

FROM node:24-bookworm-slim AS runner
ENV PNPM_HOME=/pnpm
ENV PNPM_STORE_DIR=/pnpm/store
ENV PATH=${PNPM_HOME}:${PATH}
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

RUN npm install -g pnpm@10.9.2
COPY --from=deps /pnpm/store /pnpm/store
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-lock.yaml ./pnpm-lock.yaml
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile --offline

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./next.config.js

EXPOSE 3000
CMD ["pnpm", "run", "start"]
