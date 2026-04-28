#!/usr/bin/env bash
#
# db-tunnel.sh - Open an SSM port-forwarding tunnel to the RDS instance
# through the dedicated bastion host, then optionally run database operations.
#
# Usage:
#   ./scripts/db-tunnel.sh [command]
#
# Commands:
#   tunnel      Open the tunnel only (default). Stays open until Ctrl+C.
#   reset       Truncate all tables via psql, then close.
#   seed        Run db:seed:ci via ECS one-off task (no tunnel needed).
#   reset-seed  Truncate all tables, then seed via ECS task.
#   psql        Open an interactive psql session through the tunnel.
#
# Prerequisites:
#   - AWS CLI v2 with session-manager-plugin installed (preinstalled in the
#     project dev container; see /workspace/Dockerfile)
#   - aws credentials configured for the target account
#   - psql (PostgreSQL client) installed for reset/psql commands
#
# Environment:
#   ENV             Target environment (default: dev)
#   LOCAL_PORT      Local port for the tunnel (default: 15432)
#   CLUSTER         ECS cluster name override (only used by seed commands)
#   SERVICE         ECS service name override (only used by seed commands)

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ENV="${ENV:-dev}"
LOCAL_PORT="${LOCAL_PORT:-15432}"
CLUSTER="${CLUSTER:-portalai-${ENV}}"
SERVICE="${SERVICE:-portalai-api-${ENV}}"
BASTION_STACK="portalai-${ENV}-bastion"
BASTION_EXPORT_NAME="${ENV}-BastionInstanceId"
SECRET_ID="portalai/${ENV}/database-url"
REGION="us-east-1"

TUNNEL_PID=""
TUNNEL_LOG=$(mktemp)

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
# The tunnel runs under `setsid` so `aws ssm start-session` and its
# `session-manager-plugin` child share a process group whose PGID equals
# TUNNEL_PID. Signaling just the aws parent leaves the plugin reparented to
# init and squatting on the local port, so we signal the whole group instead.
cleanup() {
  if [[ -n "$TUNNEL_PID" ]] && kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "Closing SSM tunnel (pgid $TUNNEL_PID)..."
    kill -TERM "-$TUNNEL_PID" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "-$TUNNEL_PID" 2>/dev/null || break
      sleep 0.2
    done
    kill -KILL "-$TUNNEL_PID" 2>/dev/null || true
    wait "$TUNNEL_PID" 2>/dev/null || true
  fi
  rm -f "$TUNNEL_LOG"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log()  { echo "==> $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

check_deps() {
  for dep in aws; do
    command -v "$dep" >/dev/null || fail "'$dep' is required but not found"
  done
}

# URL-decode a string (Secrets Manager stores the DATABASE_URL with the
# password percent-encoded, but PGPASSWORD expects the raw value).
urldecode() {
  local s="${1//+/ }"
  printf '%b' "${s//%/\\x}"
}

# Retrieve the DATABASE_URL from Secrets Manager and parse it
fetch_db_url() {
  log "Fetching DATABASE_URL from Secrets Manager ($SECRET_ID)..."
  DB_URL=$(aws secretsmanager get-secret-value \
    --secret-id "$SECRET_ID" \
    --query SecretString \
    --output text \
    --region "$REGION") || fail "Could not retrieve secret $SECRET_ID"

  # Parse components: postgresql://user:password@host:port/dbname?params
  DB_USER=$(urldecode "$(echo "$DB_URL" | sed -n 's|postgresql://\([^:]*\):.*|\1|p')")
  DB_PASS=$(urldecode "$(echo "$DB_URL" | sed -n 's|postgresql://[^:]*:\(.*\)@[^@]*|\1|p' | sed 's|?.*||')")
  DB_HOST=$(echo "$DB_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
  DB_PORT=$(echo "$DB_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
  DB_NAME=$(urldecode "$(echo "$DB_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')")

  LOCAL_DB_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:${LOCAL_PORT}/${DB_NAME}?sslmode=require"
}

# Resolve the bastion EC2 instance ID from the CloudFormation stack output
resolve_bastion_target() {
  log "Resolving bastion instance from stack=$BASTION_STACK..."

  SSM_TARGET=$(aws cloudformation describe-stacks \
    --stack-name "$BASTION_STACK" \
    --query "Stacks[0].Outputs[?ExportName=='${BASTION_EXPORT_NAME}'].OutputValue" \
    --output text \
    --region "$REGION") || fail "Could not describe stack $BASTION_STACK"

  [[ -z "$SSM_TARGET" || "$SSM_TARGET" == "None" ]] && \
    fail "No bastion instance found. Is the $BASTION_STACK stack deployed?"

  log "SSM target: $SSM_TARGET"
}

# Start the SSM port-forwarding tunnel in the background
start_tunnel() {
  log "Starting SSM tunnel (localhost:${LOCAL_PORT} -> ${DB_HOST}:${DB_PORT})..."

  # `setsid` makes aws the session leader of a new process group, so the
  # cleanup trap can kill the whole group (including session-manager-plugin).
  setsid aws ssm start-session \
    --target "$SSM_TARGET" \
    --document-name AWS-StartPortForwardingSessionToRemoteHost \
    --parameters "{\"host\":[\"${DB_HOST}\"],\"portNumber\":[\"${DB_PORT}\"],\"localPortNumber\":[\"${LOCAL_PORT}\"]}" \
    --region "$REGION" \
    > "$TUNNEL_LOG" 2>&1 &

  TUNNEL_PID=$!

  # Wait for the tunnel to be ready
  log "Waiting for tunnel to be ready..."
  for i in $(seq 1 30); do
    if grep -q "Waiting for connections" "$TUNNEL_LOG" 2>/dev/null; then
      log "Tunnel is ready."
      return
    fi
    if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
      cat "$TUNNEL_LOG"
      fail "Tunnel process exited unexpectedly"
    fi
    sleep 1
  done

  cat "$TUNNEL_LOG"
  fail "Tunnel did not become ready within 30 seconds"
}

# Run psql command through the tunnel
run_psql() {
  PGPASSWORD="$DB_PASS" psql -h localhost -p "$LOCAL_PORT" -U "$DB_USER" -d "$DB_NAME" "$@"
}

# Truncate all tables
do_reset() {
  log "Fetching table list..."
  TABLES=$(run_psql -t -A -c "SELECT string_agg('\"' || tablename || '\"', ', ')
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename != '__drizzle_migrations';")

  if [[ -z "$TABLES" ]]; then
    log "No tables found - nothing to truncate."
    return
  fi

  log "Truncating tables: $TABLES"
  run_psql -c "TRUNCATE TABLE ${TABLES} CASCADE;"
  log "All tables truncated."
}

# Run seed via ECS one-off task
do_seed() {
  log "Running db:seed:ci via ECS one-off task..."

  # Get network config from the running service
  NETWORK_CONFIG=$(aws ecs describe-services \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --query 'services[0].networkConfiguration' \
    --region "$REGION") || fail "Could not get service network config"

  TASK_DEF=$(aws ecs describe-services \
    --cluster "$CLUSTER" \
    --services "$SERVICE" \
    --query 'services[0].taskDefinition' \
    --output text \
    --region "$REGION") || fail "Could not get task definition"

  CONTAINER_NAME=$(aws ecs describe-task-definition \
    --task-definition "$TASK_DEF" \
    --query 'taskDefinition.containerDefinitions[0].name' \
    --output text \
    --region "$REGION") || fail "Could not get container name"

  SEED_TASK_ARN=$(aws ecs run-task \
    --cluster "$CLUSTER" \
    --task-definition "$TASK_DEF" \
    --network-configuration "$NETWORK_CONFIG" \
    --overrides "{\"containerOverrides\":[{\"name\":\"${CONTAINER_NAME}\",\"command\":[\"npm\",\"run\",\"db:seed:ci\"]}]}" \
    --launch-type FARGATE \
    --query 'tasks[0].taskArn' \
    --output text \
    --region "$REGION") || fail "Could not start seed task"

  log "Seed task started: $SEED_TASK_ARN"
  log "Waiting for seed task to complete..."

  aws ecs wait tasks-stopped \
    --cluster "$CLUSTER" \
    --tasks "$SEED_TASK_ARN" \
    --region "$REGION"

  EXIT_CODE=$(aws ecs describe-tasks \
    --cluster "$CLUSTER" \
    --tasks "$SEED_TASK_ARN" \
    --query 'tasks[0].containers[0].exitCode' \
    --output text \
    --region "$REGION")

  if [[ "$EXIT_CODE" == "0" ]]; then
    log "Seed completed successfully."
  else
    fail "Seed task exited with code $EXIT_CODE. Check CloudWatch logs for details."
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  local cmd="${1:-tunnel}"
  check_deps

  case "$cmd" in
    tunnel)
      fetch_db_url
      resolve_bastion_target
      start_tunnel
      log "Tunnel open at localhost:${LOCAL_PORT}. Press Ctrl+C to close."
      log ""
      log "Connect with:"
      log "  PGPASSWORD='...' psql -h localhost -p ${LOCAL_PORT} -U ${DB_USER} -d ${DB_NAME}"
      wait "$TUNNEL_PID"
      ;;

    reset)
      command -v psql >/dev/null || fail "'psql' is required for reset"
      fetch_db_url
      resolve_bastion_target
      start_tunnel
      do_reset
      ;;

    seed)
      do_seed
      ;;

    reset-seed)
      command -v psql >/dev/null || fail "'psql' is required for reset"
      fetch_db_url
      resolve_bastion_target
      start_tunnel
      do_reset
      do_seed
      ;;

    psql)
      command -v psql >/dev/null || fail "'psql' is required"
      fetch_db_url
      resolve_bastion_target
      start_tunnel
      log "Opening interactive psql session..."
      run_psql
      ;;

    *)
      echo "Usage: $0 {tunnel|reset|seed|reset-seed|psql}"
      exit 1
      ;;
  esac
}

main "$@"
