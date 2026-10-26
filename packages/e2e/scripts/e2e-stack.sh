#!/usr/bin/env bash
# The ephemeral stack `test:e2e` walks (#489), shared by the e2e-test.yml CI
# job and local runs so the two can't drift.
#
#   e2e-stack.sh up     boot Postgres, Redis and s3mock (compose `e2e`
#                       profile), a fresh `portal_ai_e2e` database, the
#                       Anthropic stub, the API (build + start) on :3001 and
#                       the web app (production build + `vite preview`) on
#                       :3000.
#   e2e-stack.sh down   stop the processes `up` started, drop the database
#                       and stop s3mock. Postgres and Redis keep running: in
#                       the devcontainer they are the dev stack's own.
#
# Hosts: inside the devcontainer the compose services resolve by name on the
# shared network; on a bare runner (CI) they are published on localhost.
# Auth0: the API reads AUTH0_DOMAIN / AUTH0_AUDIENCE and the web build
# VITE_AUTH0_* from the environment, else from apps/{api,web}/.env.
# E2E_QA_CONNECTION (required) is the Auth0 Database connection the QA
# sign-in pins; the preview build has no DEV-only affordance, so the walk
# signs in through it (E2E_SIGN_IN_VIA=qa).
set -euo pipefail

cmd=${1:-up}
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
STATE="$ROOT/packages/e2e/test-results/stack"
DB=portal_ai_e2e
mkdir -p "$STATE"

# Reuse the compose project the running Postgres belongs to (the devcontainer's
# is named after the host checkout), else compose's default.
PROJECT=$(docker ps --filter label=com.docker.compose.service=postgres-test \
  --format '{{.Label "com.docker.compose.project"}}' | head -1)
COMPOSE=(docker compose -f "$ROOT/docker-compose.yml" ${PROJECT:+-p "$PROJECT"} --profile e2e)

if getent hosts postgres-test >/dev/null 2>&1; then
  PG_HOSTPORT=postgres-test:5432 REDIS_HOSTPORT=redis:6379 S3_URL=http://s3mock:9090
else
  PG_HOSTPORT=localhost:5433 REDIS_HOSTPORT=localhost:6380 S3_URL=http://localhost:9090
fi

psql_admin() {
  "${COMPOSE[@]}" exec -T postgres-test psql -v ON_ERROR_STOP=1 -U postgres -q -c "$1"
}

wait_http() { # url label
  for _ in $(seq 1 90); do
    curl -fs -o /dev/null "$1" && return 0
    sleep 1
  done
  echo "[e2e-stack] $2 did not come up at $1 (logs in $STATE)" >&2
  return 1
}

stop_pids() {
  for f in "$STATE"/*.pid; do
    [ -e "$f" ] || continue
    # The recorded pid leads a process group (setsid), so npm's children go too.
    kill -- "-$(cat "$f")" 2>/dev/null || true
    rm -f "$f"
  done
}

case "$cmd" in
up)
  : "${E2E_QA_CONNECTION:?set E2E_QA_CONNECTION to the Auth0 Database connection name}"
  for port in 3000 3001 4010; do
    if curl -s -o /dev/null --max-time 2 "http://localhost:$port"; then
      echo "[e2e-stack] something already listens on :$port (the dev stack?); stop it first" >&2
      exit 1
    fi
  done

  "${COMPOSE[@]}" up -d postgres-test redis s3mock --wait
  psql_admin "DROP DATABASE IF EXISTS $DB WITH (FORCE)"
  psql_admin "CREATE DATABASE $DB"

  export DATABASE_URL="postgresql://postgres:postgres@$PG_HOSTPORT/$DB"
  # Redis db 5 keeps this stack's queues apart from a dev stack's.
  export REDIS_URL="redis://$REDIS_HOSTPORT/5"
  export PORT=3001
  export UPLOAD_S3_ENDPOINT="$S3_URL" UPLOAD_S3_FORCE_PATH_STYLE=true
  export UPLOAD_S3_BUCKET=portalai-uploads-e2e UPLOAD_S3_REGION=us-east-1
  export AWS_ACCESS_KEY_ID=e2e AWS_SECRET_ACCESS_KEY=e2e-secret
  export ANTHROPIC_BASE_URL=http://localhost:4010/v1 ANTHROPIC_API_KEY=e2e-stub
  # createdBy for system-seeded rows; required, and only set by apps/api/.env
  # locally (CI has none).
  export SYSTEM_ID="${SYSTEM_ID:-SYSTEM}"
  # A throwaway key: nothing this stack encrypts outlives its database.
  export ENCRYPTION_KEY="${ENCRYPTION_KEY:-$(openssl rand -base64 32)}"

  setsid npm run --prefix "$ROOT/packages/e2e" e2e:stub:anthropic \
    >"$STATE/stub.log" 2>&1 & echo $! >"$STATE/stub.pid"

  npm run --prefix "$ROOT/apps/api" db:migrate >"$STATE/migrate.log" 2>&1
  npm run --prefix "$ROOT/apps/api" db:seed >"$STATE/seed.log" 2>&1
  npm run --prefix "$ROOT/apps/api" build >"$STATE/api-build.log" 2>&1
  setsid npm run --prefix "$ROOT/apps/api" start >"$STATE/api.log" 2>&1 &
  echo $! >"$STATE/api.pid"

  VITE_AUTH0_QA_CONNECTION="$E2E_QA_CONNECTION" VITE_API_BASE_URL="" \
    npm run --prefix "$ROOT/apps/web" build >"$STATE/web-build.log" 2>&1
  setsid npm run --prefix "$ROOT/apps/web" preview -- --port 3000 --strictPort \
    >"$STATE/web.log" 2>&1 & echo $! >"$STATE/web.pid"

  wait_http http://localhost:4010/health "Anthropic stub"
  wait_http http://localhost:3001/api/health API
  wait_http http://localhost:3000/ web
  echo "[e2e-stack] up: web :3000 · api :3001 · stub :4010 · db $DB"
  ;;
down)
  stop_pids
  psql_admin "DROP DATABASE IF EXISTS $DB WITH (FORCE)" 2>/dev/null || true
  "${COMPOSE[@]}" stop s3mock >/dev/null 2>&1 || true
  echo "[e2e-stack] down"
  ;;
*)
  echo "usage: e2e-stack.sh up|down" >&2
  exit 2
  ;;
esac
