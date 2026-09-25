# Stage 1: Build
# R7.06: base image pinned by digest to the exact Node line declared in .nvmrc
# (24.18.0) and used by CI. Digest captured from Docker Hub on 2026-09-23; see
# docs/implementation/R7_DEPLOYMENT_PINNING_2026-09-23.md for the update procedure.
FROM node:24.18.0-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS builder

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
FROM node:24.18.0-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d AS production

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
# Bind all interfaces inside the container; without this the image defaults to
# 127.0.0.1 and is unreachable unless run through compose. An external binding
# still requires HOOSHIX_PUBLIC_BASE_URL, which is enforced at startup.
ENV HOOSHIX_HTTP_HOST=0.0.0.0
ENV HOOSHIX_DB_PATH=/app/data/agent-memory.db
ENV HOOSHIX_LOG_DIR=/app/data/logs
ENV HOOSHIX_BOOTSTRAP_TOKEN_FILE=/app/data/.token

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/health/live').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index-http.js"]
