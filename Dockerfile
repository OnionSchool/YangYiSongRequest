# syntax=docker/dockerfile:1

FROM oven/bun:1.3.13-alpine AS deps
WORKDIR /app

# Alpine 未提供独立的 node-gyp 包，better-sqlite3 需要 npm 安装的 node-gyp 与本机构建工具。
RUN apk add --no-cache python3 make g++ nodejs npm \
  && npm install --global node-gyp
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile

FROM oven/bun:1.3.13-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . ./
RUN bun run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S app && adduser -S app -u 1001 \
  && mkdir -p /app/data && chown -R app:app /app/data
COPY --from=builder --chown=app:app /app/.output ./.output
COPY --from=builder --chown=app:app /app/server/migrations ./server/migrations

USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", ".output/server/index.mjs"]
