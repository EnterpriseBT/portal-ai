# --- Build stage (runs on native arch, not under QEMU) ---
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app

ARG BUILD_VERSION=dev
ARG BUILD_SHA=local
ENV BUILD_VERSION=$BUILD_VERSION
ENV BUILD_SHA=$BUILD_SHA

# Copy monorepo manifests for dependency install
COPY package*.json turbo.json tsconfig.json ./
COPY apps/api/package*.json apps/api/
COPY packages/core/package*.json packages/core/
COPY packages/spreadsheet-parsing/package*.json packages/spreadsheet-parsing/

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source
COPY packages/spreadsheet-parsing/ packages/spreadsheet-parsing/
COPY packages/core/ packages/core/
COPY apps/api/ apps/api/

# Build core first, then API (turbo handles the dependency graph)
# --env-mode=loose allows build to proceed without .env
RUN npx turbo run build --filter=@portalai/api --env-mode=loose

# --- Deps stage (install production deps on native arch to avoid QEMU crashes) ---
# Runs on BUILDPLATFORM (no QEMU) but uses npm's --cpu/--os flags to resolve
# optional dependencies (like esbuild's platform-specific binaries) for the
# target runtime platform. This is npm's supported mechanism for building
# Docker images for a different architecture than the build host.
#
# Docker's TARGETARCH uses Go naming (amd64/arm64); npm uses Node naming
# (x64/arm64), so amd64 is translated to x64.
FROM --platform=$BUILDPLATFORM node:22-alpine AS deps
ARG TARGETOS
ARG TARGETARCH
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/packages/core/package.json packages/core/
COPY --from=build /app/packages/spreadsheet-parsing/package.json packages/spreadsheet-parsing/
RUN NPM_CPU=$(echo "$TARGETARCH" | sed 's/amd64/x64/') && \
    npm ci --omit=dev --cpu="$NPM_CPU" --os="$TARGETOS"

# --- Runtime stage (target arch) ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# curl is needed for ECS health checks; postgresql-client provides psql
RUN apk add --no-cache curl postgresql-client

# Copy built API
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/package.json ./

# Copy drizzle migrations (needed for db:migrate)
COPY --from=build /app/apps/api/drizzle ./drizzle
COPY --from=build /app/apps/api/drizzle.config.ts ./drizzle.config.ts

# Copy production node_modules (installed for target arch)
COPY --from=deps /app/node_modules ./node_modules

# Copy built @portalai/core into node_modules
COPY --from=build /app/packages/core/dist ./node_modules/@portalai/core/dist
COPY --from=build /app/packages/core/package.json ./node_modules/@portalai/core/

# Copy built @portalai/spreadsheet-parsing into node_modules
COPY --from=build /app/packages/spreadsheet-parsing/dist ./node_modules/@portalai/spreadsheet-parsing/dist
COPY --from=build /app/packages/spreadsheet-parsing/package.json ./node_modules/@portalai/spreadsheet-parsing/

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

CMD ["node", "--max-old-space-size=3200", "dist/index.js"]
