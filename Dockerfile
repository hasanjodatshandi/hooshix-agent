# Stage 1: Build
FROM node:24-slim AS builder

RUN corepack enable && corepack prepare pnpm@11.24.0 --activate

WORKDIR /app

# Install dependencies (cached layer)
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile 2>/dev/null || pnpm install

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# Stage 2: Production
FROM node:24-slim AS production

RUN corepack enable && corepack prepare pnpm@11.24.0 --activate

WORKDIR /app

# Install production dependencies only
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile 2>/dev/null || pnpm install --prod

# Copy built output
COPY --from=builder /app/dist ./dist

# Create data directory for SQLite
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV MCP_PORT=3001
# Set your API key: docker run -e MCP_API_KEY=your-secret ...
# ENV MCP_API_KEY=""

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index-http.js"]
