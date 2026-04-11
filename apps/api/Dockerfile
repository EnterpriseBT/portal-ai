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

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source
COPY packages/core/ packages/core/
COPY apps/api/ apps/api/

# Build core first, then API (turbo handles the dependency graph)
# --env-mode=loose allows build to proceed without .env
RUN npx turbo run build --filter=@portalai/api --env-mode=loose

# --- Deps stage (install production deps for target arch) ---
FROM --platform=$TARGETPLATFORM node:22-alpine AS deps
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/packages/core/package.json packages/core/
RUN npm ci --omit=dev

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

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

CMD ["node", "dist/index.js"]
