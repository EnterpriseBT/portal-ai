#!/bin/sh
# Renders /config.js from container env before nginx starts (#566).
# nginx-unprivileged sources every /docker-entrypoint.d/*.sh at startup, so
# each container gets a config.js reflecting its own OIDC issuer / deploy mode
# without a rebuild. SPA consumption is #607.
set -eu

node /opt/render-config.mjs > /usr/share/nginx/html/config.js
echo "render-config: wrote /usr/share/nginx/html/config.js"
