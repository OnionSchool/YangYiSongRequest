FROM node:24-alpine AS deps
WORKDIR /app

# better-sqlite3 需要本机构建工具。
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . ./
RUN npm run build

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
