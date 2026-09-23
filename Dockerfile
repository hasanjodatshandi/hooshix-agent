# Stage 1: Build
FROM node:24-slim AS builder

RUN corepack enable && corepack prepare pnpm@11.24.0 --activate

WORKDIR /app

# Install dependencies (cached layer)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# Stage 2: Production
FROM node:24-slim AS production

RUN corepack enable && corepack prepare pnpm@11.24.0 --activate

WORKDIR /app

# Install production dependencies only
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

# Copy built output
COPY --from=builder /app/dist ./dist

# Prepare only the persisted data directory for non-root writes.
RUN mkdir -p /app/data && chown -R node:node /app/data && chown node:node /app/data

ENV NODE_ENV=production
ENV HOOSHIX_HTTP_PORT=3001
ENV HOOSHIX_DB_PATH=/app/data/agent-memory.db
ENV HOOSHIX_LOG_DIR=/app/data/logs
ENV HOOSHIX_BOOTSTRAP_TOKEN_FILE=/app/data/.token

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health/live').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index-http.js"]
