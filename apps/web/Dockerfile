# syntax=docker/dockerfile:1
#
# Residency web image (#566). A self-contained nginx image serving the built
# SPA, for the L2 Helm chart / full-residency install. This is ADDITIVE — the
# SaaS path still ships the SPA to S3 + CloudFront (deploy-*.yml). The one
# difference that makes a single image serve any customer: auth/runtime config
# is NOT baked into the bundle here; it is written to /config.js from container
# env at startup (render-config.mjs) and loaded before the bundle (index.html).
# SPA consumption of that runtime config is #607.

# --- Build stage (runs on native arch, not under QEMU) ---
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app

ARG BUILD_VERSION=dev
ARG BUILD_SHA=local

# VITE_* are build-time (baked into the bundle). For a residency image the
# auth values are placeholders — config.js overrides them at runtime (#607) —
# but the SaaS build passes the real values here, unchanged from deploy-*.yml.
ARG VITE_APP_VERSION=$BUILD_VERSION
ARG VITE_APP_SHA=$BUILD_SHA
ARG VITE_API_BASE_URL=""
ARG VITE_SITE_URL=""
ARG VITE_AUTH0_DOMAIN=""
ARG VITE_AUTH0_CLIENT_ID=""
ARG VITE_AUTH0_AUDIENCE=""
ENV VITE_APP_VERSION=$VITE_APP_VERSION \
    VITE_APP_SHA=$VITE_APP_SHA \
    VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_SITE_URL=$VITE_SITE_URL \
    VITE_AUTH0_DOMAIN=$VITE_AUTH0_DOMAIN \
    VITE_AUTH0_CLIENT_ID=$VITE_AUTH0_CLIENT_ID \
    VITE_AUTH0_AUDIENCE=$VITE_AUTH0_AUDIENCE

# Monorepo manifests for a cached dependency install.
COPY package*.json turbo.json tsconfig.json ./
COPY apps/web/package*.json apps/web/
COPY packages/core/package*.json packages/core/
# @portalai/core's contracts import @portalai/spreadsheet-parsing, so it must be
# present for core (and thus web) to build.
COPY packages/spreadsheet-parsing/package*.json packages/spreadsheet-parsing/

RUN npm ci

# Sources: web → core → spreadsheet-parsing (turbo builds them in order).
COPY packages/spreadsheet-parsing/ packages/spreadsheet-parsing/
COPY packages/core/ packages/core/
COPY apps/web/ apps/web/

# turbo builds @portalai/core first, then the web bundle.
RUN npx turbo run build --filter=@portalai/web --env-mode=loose

# --- Runtime stage (nginx, non-root) ---
# nginx-unprivileged listens on 8080 and runs as uid 101 — no root in the
# serving container, matching the chart's securityContext.runAsNonRoot.
# Pinned by digest (the multi-arch index), not just the tag: the deploy
# workflows gate each platform in separate builds before the push build, and
# a tag that moved between them would push layers the scan never saw (#909).
# Bump the tag and the digest together.
# The stable line, not mainline, in its -slim variant: nginx with no dynamic
# modules (geoip, image-filter, njs, xslt), none of which nginx.conf uses
# (#918). nginx comes from nginx.org's repository, which the Trivy gate can't
# see, so the tag names the exact version and scripts/nginx-advisories.mjs
# checks it against nginx.org's security advisories every week.
FROM nginxinc/nginx-unprivileged:1.30.6-alpine-slim@sha256:5d8bb9437d74a600ec5dbf90c035451c724dc33eac8d3a71078f6f8612c345f6 AS runtime

# Patch the base layer's OS packages to the latest in its Alpine release, then
# add nodejs (no npm) so the dependency-free render-config.mjs runs at startup.
# The deploy-time Trivy gate (#909, the API image's #573 gate) scans the whole
# image for fixable CRITICAL/HIGH CVEs; the pinned base tag ships stale
# packages (60 such findings before this upgrade, 0 after).
USER root
RUN apk upgrade --no-cache && apk add --no-cache nodejs
USER nginx

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/scripts/render-config.mjs /opt/render-config.mjs
# Runs before nginx starts (nginx-unprivileged sources /docker-entrypoint.d/*.sh).
COPY apps/web/scripts/40-render-config.sh /docker-entrypoint.d/40-render-config.sh

# --chown so the startup entrypoint (running as uid 101) can write config.js
# into the served directory.
COPY --chown=nginx:nginx --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080
