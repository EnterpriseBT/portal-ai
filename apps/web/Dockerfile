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
# The official nginx image, made unprivileged here (#1096): it listens on 8080
# and runs as uid 101 (the image's own `nginx` user), so no process in the
# serving container is root, matching the chart's securityContext.runAsNonRoot.
# We used nginxinc/nginx-unprivileged until it went a week without publishing
# a CVE-fixing release the official image already had; owning the few
# hardening steps below keeps us on nginx.org's release schedule instead.
# Pinned by digest (the multi-arch index), not just the tag: the deploy
# workflows gate each platform in separate builds before the push build, and
# a tag that moved between them would push layers the scan never saw (#909).
# Bump the tag and the digest together
# (`docker buildx imagetools inspect nginx:<tag>`).
# The stable line, not mainline, in its -slim variant: nginx with no dynamic
# modules (geoip, image-filter, njs, xslt), none of which nginx.conf uses
# (#918). nginx comes from nginx.org's repository. The Trivy gate matches it
# by package name since #1096, and scripts/nginx-advisories.mjs checks the
# exact version against nginx.org's advisories every week, since those land
# before Trivy's data. A fix that can't ship yet (no -alpine-slim image) gets
# a time-boxed entry in .github/actions/image-gate/trivyignore.yaml, scoped to
# this version's purl: delete it in the PR that bumps this tag + digest.
FROM nginx:1.30.8-alpine-slim@sha256:e9eaa7298465eab06d618c51556fdcf3fb5061f9ff40bd28ee898fbd7ee7f900 AS runtime

# Patch the base layer's OS packages to the latest in its Alpine release, then
# add nodejs (no npm) so the dependency-free render-config.mjs runs at startup.
# The deploy-time Trivy gate (#909, the API image's #573 gate) scans the whole
# image for fixable CRITICAL/HIGH CVEs; the pinned base tag ships stale
# packages (60 such findings before this upgrade, 0 after).
#
# Then make nginx runnable as uid 101 (#1096), as nginx-unprivileged did: the
# stock nginx.conf sets `user nginx` (a master that isn't root can't switch
# user) and keeps its pid in root-owned /run, and the temp paths compiled in
# under /var/cache/nginx are root-owned. Drop `user`, move the pid and every
# temp path to /tmp, and hand /var/cache/nginx to 101 as well.
# /etc/nginx/conf.d stays root-owned on purpose: default.conf is baked and we
# use no templates, so the entrypoint's 10-listen-on-ipv6 script logs that it
# can't modify default.conf and exits 0, and nothing rewrites our listen.
RUN apk upgrade --no-cache && apk add --no-cache nodejs \
 && sed -i -e '/^user /d' \
      -e 's,^pid .*,pid        /tmp/nginx.pid;,' \
      -e '/^http {/a\    client_body_temp_path /tmp/client_temp;\n    proxy_temp_path       /tmp/proxy_temp;\n    fastcgi_temp_path     /tmp/fastcgi_temp;\n    uwsgi_temp_path       /tmp/uwsgi_temp;\n    scgi_temp_path        /tmp/scgi_temp;' \
      /etc/nginx/nginx.conf \
 && chown -R 101:101 /var/cache/nginx

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/scripts/render-config.mjs /opt/render-config.mjs
# Runs before nginx starts (the image's /docker-entrypoint.sh sources every
# /docker-entrypoint.d/*.sh, as uid 101 here).
COPY apps/web/scripts/40-render-config.sh /docker-entrypoint.d/40-render-config.sh

# --chown so the startup entrypoint (running as uid 101) can write config.js
# into the served directory.
COPY --chown=101:101 --from=build /app/apps/web/dist /usr/share/nginx/html

# Numeric, so the chart's runAsNonRoot can verify it isn't root.
USER 101

EXPOSE 8080
