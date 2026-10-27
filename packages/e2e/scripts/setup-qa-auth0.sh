#!/usr/bin/env bash
# #489: set up an env's deployed QA identities (docs/E2E_DEPLOYED_QA.runbook.md).
#
#   1. a Database connection with sign-ups disabled and brute-force protection,
#      enabled only on the web SPA;
#   2. owner / admin / member users on it, with generated passwords;
#   3. those credentials in the env's Secrets Manager (portalops vars set);
#   4. the <ENV>_VITE_AUTH0_QA_CONNECTION repo secret.
#
# Passwords are generated here and piped straight to portalops; they're never
# printed or written to disk. Re-running is safe: an existing connection is
# reused, and an existing user is left alone (its password isn't rotated).
#
# Prereqs, in this shell:
#   auth0 login --domain portalsai-staging.us.auth0.com \
#     --scopes create:connections,read:connections,update:connections,read:clients,read:users,create:users,read:actions,read:guardian_factors,read:mfa_policies
#     # (prod: --domain portalsai.us.auth0.com)
#   aws login --remote && eval "$(aws configure export-credentials --format env)"
#   npm run build --workspace @portalai/devops-cli
#   gh auth status
#
# Usage: npm run --workspace @portalai/e2e e2e:qa:setup -- app-dev|prod [--spa-client-id <id>]
#
# Afterwards (runbook, "the QA org"): deploy, sign the owner in, name the org,
# set its tier and QA_ORG_ID, then invite the admin and the member.
set -euo pipefail

ENV_NAME=${1:?usage: setup-qa-auth0.sh app-dev|prod [--spa-client-id <id>]}
SPA_CLIENT_ID=""
[ "${2:-}" = "--spa-client-id" ] && SPA_CLIENT_ID=${3:?--spa-client-id needs a value}

case "$ENV_NAME" in
  app-dev) DOMAIN=portalsai-staging.us.auth0.com; GH_SECRET=DEV_VITE_AUTH0_QA_CONNECTION
           VARS_FLAGS=(--env app-dev --yes) ;;
  prod)    DOMAIN=portalsai.us.auth0.com; GH_SECRET=PROD_VITE_AUTH0_QA_CONNECTION
           VARS_FLAGS=(--env prod --yes --confirm-prod) ;;
  *) echo "unknown env: $ENV_NAME (app-dev | prod)" >&2; exit 2 ;;
esac
CONNECTION=qa-users
REPO=EnterpriseBT/portal-ai
ROOT=$(git rev-parse --show-toplevel)
A0=(auth0 --tenant "$DOMAIN" --no-input --no-color)

say() { printf '\n== %s\n' "$*"; }

say "Checks"
"${A0[@]}" api get "tenants/settings" >/dev/null \
  || { echo "auth0 CLI isn't signed in to $DOMAIN: run auth0 login --domain $DOMAIN" >&2; exit 1; }
aws sts get-caller-identity --query Arn --output text
gh auth status >/dev/null
[ -d "$ROOT/packages/devops-cli/dist" ] \
  || { echo "build portalops first: npm run build --workspace @portalai/devops-cli" >&2; exit 1; }

say "Web SPA application"
if [ -z "$SPA_CLIENT_ID" ]; then
  SPAS=$("${A0[@]}" api get clients -q "app_type=spa" -q "fields=client_id,name" -q "include_fields=true")
  echo "$SPAS" | jq -r '.[] | "  \(.client_id)  \(.name)"'
  [ "$(echo "$SPAS" | jq length)" = 1 ] \
    || { echo "expected exactly one SPA app; re-run with --spa-client-id <id>" >&2; exit 1; }
  SPA_CLIENT_ID=$(echo "$SPAS" | jq -r '.[0].client_id')
fi
echo "using $SPA_CLIENT_ID"

say "Connection $CONNECTION"
CONN_ID=$("${A0[@]}" api get connections -q "name=$CONNECTION" -q "strategy=auth0" | jq -r '.[0].id // empty')
if [ -z "$CONN_ID" ]; then
  CONN_ID=$("${A0[@]}" api post connections --data "$(jq -nc --arg n "$CONNECTION" '{
      name: $n, strategy: "auth0",
      options: { disable_signup: true, brute_force_protection: true,
                 passwordPolicy: "good", requires_username: false }
    }')" | jq -r .id)
  echo "created $CONN_ID"
else
  echo "exists: $CONN_ID"
  "${A0[@]}" api patch "connections/$CONN_ID" --data \
    "$("${A0[@]}" api get "connections/$CONN_ID" | jq -c '{options: (.options + {disable_signup: true, brute_force_protection: true})}')" >/dev/null
fi
# Enable it on the SPA only: the connection-clients endpoint where the tenant
# has it, else the connection's enabled_clients list (replaced wholesale).
if "${A0[@]}" api get "connections/$CONN_ID/clients" >/dev/null 2>&1; then
  "${A0[@]}" api patch "connections/$CONN_ID/clients" \
    --data "$(jq -nc --arg c "$SPA_CLIENT_ID" '[{client_id: $c, status: true}]')" >/dev/null
  OTHERS=$("${A0[@]}" api get "connections/$CONN_ID/clients" | jq -r --arg c "$SPA_CLIENT_ID" '[.clients[]?.client_id | select(. != $c)] | join(" ")')
  for c in $OTHERS; do
    "${A0[@]}" api patch "connections/$CONN_ID/clients" \
      --data "$(jq -nc --arg c "$c" '[{client_id: $c, status: false}]')" >/dev/null
    echo "disabled on $c"
  done
  ENABLED=$("${A0[@]}" api get "connections/$CONN_ID/clients" | jq -c '[.clients[]?.client_id]')
else
  "${A0[@]}" api patch "connections/$CONN_ID" \
    --data "$(jq -nc --arg c "$SPA_CLIENT_ID" '{enabled_clients: [$c]}')" >/dev/null
  ENABLED=$("${A0[@]}" api get "connections/$CONN_ID" | jq -c '.enabled_clients')
fi
echo "enabled on: $ENABLED"
[ "$ENABLED" = "[\"$SPA_CLIENT_ID\"]" ] || { echo "expected only $SPA_CLIENT_ID" >&2; exit 1; }
"${A0[@]}" api get "connections/$CONN_ID" \
  | jq '{name, disable_signup: .options.disable_signup, brute_force_protection: .options.brute_force_protection}'

say "Users"
gen_password() { openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-32; }
for role in owner admin member; do
  if [ "$role" = owner ]; then email="qa+${ENV_NAME}@portalsai.io"; suffix=""
  else email="qa+${ENV_NAME}-${role}@portalsai.io"; suffix="_${role^^}"; fi
  existing=$("${A0[@]}" api get users-by-email -q "email=$email" \
    | jq -r --arg c "$CONNECTION" '[.[] | select(.identities[]?.connection == $c)][0].user_id // empty')
  if [ -n "$existing" ]; then
    echo "$role: $email exists ($existing); left as is, vars not touched"
    continue
  fi
  pw=$(gen_password)
  "${A0[@]}" api post users --data "$(jq -nc --arg e "$email" --arg p "$pw" --arg c "$CONNECTION" --arg n "QA $role ($ENV_NAME)" \
      '{email: $e, password: $p, connection: $c, name: $n, email_verified: true}')" \
    | jq -r --arg r "$role" '"\($r): created \(.user_id) \(.email)"'
  (cd "$ROOT" && printf '%s' "$email" | npx portalops vars set "QA_AUTH0_USERNAME${suffix}" - "${VARS_FLAGS[@]}" >/dev/null)
  (cd "$ROOT" && printf '%s' "$pw" | npx portalops vars set "QA_AUTH0_PASSWORD${suffix}" - "${VARS_FLAGS[@]}" >/dev/null)
  unset pw
  echo "$role: QA_AUTH0_USERNAME${suffix} / QA_AUTH0_PASSWORD${suffix} set"
done

say "Repo secret $GH_SECRET"
printf '%s' "$CONNECTION" | gh secret set "$GH_SECRET" --repo "$REPO"

say "MFA"
# The sign-in can't answer an MFA prompt, so a tenant that requires MFA needs
# the QA connection exempted (in an Action), never MFA turned off.
POLICIES=$("${A0[@]}" api get "guardian/policies")
echo "  tenant policy: $POLICIES   ([] = MFA not required)"
echo "  enabled factors: $("${A0[@]}" api get "guardian/factors" | jq -c '[.[] | select(.enabled) | .name]')"
echo "  post-login Actions:"
"${A0[@]}" api get "actions/triggers/post-login/bindings" \
  | jq -r '.bindings[]? | "    \(.display_name)"' || true
if [ "$POLICIES" != "[]" ]; then
  echo "  MFA is required: exempt the QA users in a post-login Action before deploying:"
  echo "    if (event.connection.name === \"$CONNECTION\") return;"
fi

say "Done. Next: deploy, then provision the QA org and set QA_ORG_ID (runbook)."
