#!/usr/bin/env bash
#
# api-cli.sh - Operator CLI for the Portal.ai API: bundles the
# database-tunnel and cloud-variables tooling that previously lived in
# scripts/db-tunnel.sh and scripts/cloud-vars.sh.
#
# Usage:
#   ./scripts/api-cli.sh <group> <command> [args]
#   ./scripts/api-cli.sh --help
#
# Groups:
#   db     Database tunnel + one-off operations through the SSM bastion.
#   vars   Cloud configuration: Secrets Manager secrets and SSM parameters.
#
# Database commands (group: db):
#   tunnel       Open an SSM port-forwarding tunnel only (default). Stays
#                open until Ctrl+C.
#   psql         Open an interactive psql session through the tunnel.
#   reset        Truncate all tables via psql, then close.
#   seed         Run db:seed:ci via an ECS one-off task (no tunnel needed).
#   reset-seed   Truncate all tables, then seed via ECS task.
#
# Cloud-variable commands (group: vars):
#   describe                 Print the inventory: which keys are secrets,
#                            which are SSM, and where they live.
#   list                     Show every variable with its current value
#                            (secrets masked; UNMASK=1 to reveal).
#   get <KEY>                Print the current value of one variable.
#   set <KEY> <VALUE>        Create or update a single variable. Pass
#   set <KEY> -              `-` as the value to read it from stdin.
#   apply <FILE>             Apply a KEY=VALUE file. Comments (`#`) and
#                            blank lines are ignored. Unknown keys cause
#                            a hard fail BEFORE any writes.
#   template [FILE]          Write a starter KEY=VALUE template containing
#                            every managed key, pre-filled with current
#                            values (default: ./cloud-vars.<env>.env).
#
# Prerequisites:
#   - AWS CLI v2 with session-manager-plugin installed (preinstalled in the
#     project dev container; see /workspace/Dockerfile).
#   - AWS credentials configured for the target account.
#   - psql (PostgreSQL client) for `db reset|psql|reset-seed`.
#   - IAM perms: ssm:StartSession (db tunnel), secretsmanager:{Describe,
#     CreateSecret,PutSecretValue,GetSecretValue} and ssm:{GetParameter,
#     PutParameter} for vars commands.
#
# Environment:
#   ENV          Target environment (default: dev). Drives every path.
#   REGION       AWS region (default: us-east-1).
#   LOCAL_PORT   Local port for the db tunnel (default: 15432).
#   CLUSTER      ECS cluster name override (only used by db seed commands).
#   SERVICE      ECS service name override (only used by db seed commands).
#   UNMASK=1     Show full secret values in `vars list` output.

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ENV="${ENV:-dev}"
REGION="${REGION:-us-east-1}"
LOCAL_PORT="${LOCAL_PORT:-15432}"
CLUSTER="${CLUSTER:-portalai-${ENV}}"
SERVICE="${SERVICE:-portalai-api-${ENV}}"
BASTION_STACK="portalai-${ENV}-bastion"
BASTION_EXPORT_NAME="${ENV}-BastionInstanceId"
SECRET_PREFIX="portalai/${ENV}"
SSM_PREFIX="/portalai/${ENV}"
DB_SECRET_ID="${SECRET_PREFIX}/database-url"

# Managed Secrets Manager secrets. Format: <ENV_VAR>:<secret-name>
SECRETS=(
  "DATABASE_URL:database-url"
  "ENCRYPTION_KEY:encryption-key"
  "AUTH0_WEBHOOK_SECRET:auth0-webhook-secret"
  "ANTHROPIC_API_KEY:anthropic-api-key"
  "TAVILY_API_KEY:tavily-api-key"
  "GOOGLE_OAUTH_CLIENT_SECRET:google-oauth-client-secret"
  "OAUTH_STATE_SECRET:oauth-state-secret"
)

# Managed SSM parameters. Format: <ENV_VAR>:<param-name>:<type>
PARAMS=(
  "GOOGLE_OAUTH_CLIENT_ID:google-oauth-client-id:String"
  "AUTH0_DOMAIN:auth0-domain:String"
  "AUTH0_AUDIENCE:auth0-audience:String"
  "CORS_ORIGIN:cors-origin:String"
  "NAMESPACE:namespace:String"
  "SYSTEM_ID:system-id:String"
)

TUNNEL_PID=""
TUNNEL_LOG=""

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
# When a tunnel is running, it lives under `setsid` so `aws ssm start-session`
# and its `session-manager-plugin` child share a process group whose PGID
# equals TUNNEL_PID. Signaling just the aws parent leaves the plugin
# reparented to init and squatting on the local port, so we signal the whole
# group instead.
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
  [[ -n "$TUNNEL_LOG" ]] && rm -f "$TUNNEL_LOG"
  return 0
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------
log()  { echo "==> $*"; }
warn() { echo "WARN: $*" >&2; }
fail() { echo "ERROR: $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null || fail "'$1' is required but not found"
}

# URL-decode a string (Secrets Manager stores DATABASE_URL with the password
# percent-encoded, but PGPASSWORD expects the raw value).
urldecode() {
  local s="${1//+/ }"
  printf '%b' "${s//%/\\x}"
}

# ---------------------------------------------------------------------------
# DB tunnel internals
# ---------------------------------------------------------------------------
fetch_db_url() {
  log "Fetching DATABASE_URL from Secrets Manager ($DB_SECRET_ID)..."
  DB_URL=$(aws secretsmanager get-secret-value \
    --secret-id "$DB_SECRET_ID" \
    --query SecretString \
    --output text \
    --region "$REGION") || fail "Could not retrieve secret $DB_SECRET_ID"

  # Parse components: postgresql://user:password@host:port/dbname?params
  DB_USER=$(urldecode "$(echo "$DB_URL" | sed -n 's|postgresql://\([^:]*\):.*|\1|p')")
  DB_PASS=$(urldecode "$(echo "$DB_URL" | sed -n 's|postgresql://[^:]*:\(.*\)@[^@]*|\1|p' | sed 's|?.*||')")
  DB_HOST=$(echo "$DB_URL" | sed -n 's|.*@\([^:]*\):.*|\1|p')
  DB_PORT=$(echo "$DB_URL" | sed -n 's|.*:\([0-9]*\)/.*|\1|p')
  DB_NAME=$(urldecode "$(echo "$DB_URL" | sed -n 's|.*/\([^?]*\).*|\1|p')")

  LOCAL_DB_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:${LOCAL_PORT}/${DB_NAME}?sslmode=require"
}

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

start_tunnel() {
  TUNNEL_LOG=$(mktemp)
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

  log "Waiting for tunnel to be ready..."
  for _ in $(seq 1 30); do
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

run_psql() {
  PGPASSWORD="$DB_PASS" psql -h localhost -p "$LOCAL_PORT" -U "$DB_USER" -d "$DB_NAME" "$@"
}

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

do_seed() {
  log "Running db:seed:ci via ECS one-off task..."

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
# DB commands
# ---------------------------------------------------------------------------
db_dispatch() {
  local cmd="${1:-tunnel}"

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
      require_cmd psql
      fetch_db_url
      resolve_bastion_target
      start_tunnel
      do_reset
      ;;

    seed)
      do_seed
      ;;

    reset-seed)
      require_cmd psql
      fetch_db_url
      resolve_bastion_target
      start_tunnel
      do_reset
      do_seed
      ;;

    psql)
      require_cmd psql
      fetch_db_url
      resolve_bastion_target
      start_tunnel
      log "Opening interactive psql session..."
      run_psql
      ;;

    *)
      fail "Unknown db command: $cmd (run '$0 --help')"
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Cloud-variable helpers
# ---------------------------------------------------------------------------
mask() {
  local v="$1"
  local n=${#v}
  if (( n == 0 )); then echo "(empty)"; return; fi
  if [[ "${UNMASK:-0}" == "1" ]]; then echo "$v"; return; fi
  if (( n <= 8 )); then echo "********"; return; fi
  printf '%s…%s (len=%d)\n' "${v:0:4}" "${v: -2}" "$n"
}

# Look up the kind/path/type for a KEY. Sets globals KIND, PATH_, TYPE_.
# KIND is "secret" or "ssm". TYPE_ is empty for secrets.
lookup_key() {
  local key="$1" entry name type
  KIND=""; PATH_=""; TYPE_=""

  for entry in "${SECRETS[@]}"; do
    if [[ "${entry%%:*}" == "$key" ]]; then
      name="${entry#*:}"
      KIND="secret"
      PATH_="${SECRET_PREFIX}/${name}"
      return 0
    fi
  done

  for entry in "${PARAMS[@]}"; do
    if [[ "${entry%%:*}" == "$key" ]]; then
      name="${entry#*:}"; name="${name%%:*}"
      type="${entry##*:}"
      KIND="ssm"
      PATH_="${SSM_PREFIX}/${name}"
      TYPE_="$type"
      return 0
    fi
  done

  return 1
}

all_keys() {
  local entry
  for entry in "${SECRETS[@]}"; do echo "${entry%%:*}"; done
  for entry in "${PARAMS[@]}";  do echo "${entry%%:*}"; done
}

get_secret() {
  aws secretsmanager get-secret-value \
    --secret-id "$1" \
    --query SecretString \
    --output text \
    --region "$REGION" 2>/dev/null
}

secret_exists() {
  aws secretsmanager describe-secret \
    --secret-id "$1" \
    --region "$REGION" \
    >/dev/null 2>&1
}

get_param() {
  aws ssm get-parameter \
    --name "$1" \
    --with-decryption \
    --query 'Parameter.Value' \
    --output text \
    --region "$REGION" 2>/dev/null
}

put_secret() {
  local path="$1" value="$2"
  if secret_exists "$path"; then
    aws secretsmanager put-secret-value \
      --secret-id "$path" \
      --secret-string "$value" \
      --region "$REGION" \
      --output text >/dev/null
    log "secret updated:  $path"
  else
    aws secretsmanager create-secret \
      --name "$path" \
      --secret-string "$value" \
      --region "$REGION" \
      --output text >/dev/null
    log "secret created:  $path"
    warn "Created NEW secret. Update its ARN in the deploy workflow / CloudFormation parameters before deploying."
  fi
}

put_param() {
  local path="$1" type="$2" value="$3"
  aws ssm put-parameter \
    --name "$path" \
    --type "$type" \
    --value "$value" \
    --overwrite \
    --region "$REGION" \
    --output text >/dev/null
  log "ssm upserted:    $path ($type)"
}

# ---------------------------------------------------------------------------
# Cloud-variable commands
# ---------------------------------------------------------------------------
vars_describe() {
  echo "Environment: $ENV"
  echo "Region:      $REGION"
  echo
  echo "Secrets Manager (prefix: $SECRET_PREFIX/):"
  for entry in "${SECRETS[@]}"; do
    printf '  %-30s -> %s\n' "${entry%%:*}" "${SECRET_PREFIX}/${entry#*:}"
  done
  echo
  echo "SSM Parameter Store (prefix: $SSM_PREFIX/):"
  for entry in "${PARAMS[@]}"; do
    local key="${entry%%:*}" rest="${entry#*:}"
    printf '  %-30s -> %s (%s)\n' "$key" "${SSM_PREFIX}/${rest%%:*}" "${rest##*:}"
  done
}

vars_list() {
  printf '%-32s %-8s %s\n' "KEY" "KIND" "VALUE"
  printf '%-32s %-8s %s\n' "---" "----" "-----"
  local key value
  while IFS= read -r key; do
    lookup_key "$key" || continue
    if [[ "$KIND" == "secret" ]]; then
      value=$(get_secret "$PATH_" || true)
      printf '%-32s %-8s %s\n' "$key" "secret" "$(mask "${value:-}")"
    else
      value=$(get_param "$PATH_" || true)
      # SSM params hold non-sensitive config, so display unmasked.
      printf '%-32s %-8s %s\n' "$key" "ssm" "${value:-(unset)}"
    fi
  done < <(all_keys)
}

vars_get() {
  local key="${1:-}"
  [[ -z "$key" ]] && fail "Usage: $0 vars get <KEY>"
  lookup_key "$key" || fail "Unknown key: $key (run '$0 vars describe')"
  if [[ "$KIND" == "secret" ]]; then
    get_secret "$PATH_" || fail "Secret not found at $PATH_"
  else
    get_param "$PATH_" || fail "Parameter not found at $PATH_"
  fi
  echo
}

vars_set() {
  local key="${1:-}" value="${2-}"
  [[ -z "$key" || $# -lt 2 ]] && fail "Usage: $0 vars set <KEY> <VALUE|->"
  lookup_key "$key" || fail "Unknown key: $key (run '$0 vars describe')"

  if [[ "$value" == "-" ]]; then
    value=$(cat)
  fi
  [[ -z "$value" ]] && fail "Refusing to set empty value for $key"

  if [[ "$KIND" == "secret" ]]; then
    put_secret "$PATH_" "$value"
  else
    put_param "$PATH_" "$TYPE_" "$value"
  fi
}

vars_apply() {
  local file="${1:-}"
  [[ -z "$file" ]] && fail "Usage: $0 vars apply <FILE>"
  [[ -r "$file" ]] || fail "Cannot read $file"

  declare -A PENDING=()
  local lineno=0 line key val

  while IFS= read -r line || [[ -n "$line" ]]; do
    lineno=$((lineno + 1))
    line="${line#"${line%%[![:space:]]*}"}"   # trim leading ws
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue
    [[ "$line" != *"="* ]] && fail "$file:$lineno: missing '=' in line: $line"

    key="${line%%=*}"
    val="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"      # trim trailing ws on key

    # Strip a single matching pair of surrounding quotes.
    if [[ "$val" =~ ^\".*\"$ ]]; then val="${val:1:${#val}-2}"
    elif [[ "$val" =~ ^\'.*\'$ ]]; then val="${val:1:${#val}-2}"
    fi

    lookup_key "$key" || fail "$file:$lineno: unknown key '$key' (run '$0 vars describe')"
    [[ -z "$val" ]] && fail "$file:$lineno: empty value for '$key'"
    PENDING["$key"]="$val"
  done < "$file"

  (( ${#PENDING[@]} == 0 )) && { log "Nothing to apply in $file"; return; }

  log "Applying ${#PENDING[@]} variable(s) to env=$ENV region=$REGION..."
  for key in "${!PENDING[@]}"; do
    lookup_key "$key"
    if [[ "$KIND" == "secret" ]]; then
      put_secret "$PATH_" "${PENDING[$key]}"
    else
      put_param "$PATH_" "$TYPE_" "${PENDING[$key]}"
    fi
  done
  log "Done."
}

vars_template() {
  local out="${1:-./cloud-vars.${ENV}.env}"
  [[ -e "$out" ]] && fail "$out already exists; refusing to overwrite"

  {
    echo "# cloud-vars template for env=$ENV (region=$REGION)"
    echo "# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ). Existing values are pre-filled."
    echo "# Apply with: ENV=$ENV ./scripts/api-cli.sh vars apply $out"
    echo
    echo "# ── Secrets Manager (sensitive) ─"
    for entry in "${SECRETS[@]}"; do
      local key="${entry%%:*}" path="${SECRET_PREFIX}/${entry#*:}"
      local val
      val=$(get_secret "$path" || true)
      printf '%s=%s\n' "$key" "$val"
    done
    echo
    echo "# ── SSM Parameter Store (config) ─"
    for entry in "${PARAMS[@]}"; do
      local key="${entry%%:*}" rest="${entry#*:}" name="${rest%%:*}"
      local val
      val=$(get_param "${SSM_PREFIX}/${name}" || true)
      printf '%s=%s\n' "$key" "$val"
    done
  } > "$out"

  log "Wrote template to $out"
  warn "$out contains plaintext secrets. Do not commit it."
}

vars_dispatch() {
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    describe) vars_describe ;;
    list)     vars_list ;;
    get)      vars_get "$@" ;;
    set)      vars_set "$@" ;;
    apply)    vars_apply "$@" ;;
    template) vars_template "$@" ;;
    "")       fail "Missing vars command (run '$0 --help')" ;;
    *)        fail "Unknown vars command: $cmd (run '$0 --help')" ;;
  esac
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
print_help() {
  sed -n '2,53p' "$0" | sed 's/^# \{0,1\}//'
}

main() {
  require_cmd aws
  local group="${1:-}"; shift || true

  case "$group" in
    db)
      db_dispatch "$@"
      ;;
    vars)
      vars_dispatch "$@"
      ;;
    ""|-h|--help|help)
      print_help
      ;;
    *)
      fail "Unknown group: $group (run '$0 --help')"
      ;;
  esac
}

main "$@"
