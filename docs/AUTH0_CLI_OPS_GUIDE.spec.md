# Auth0 CLI operations guide — Spec

**Issue:** [EnterpriseBT/portal-ai#226](https://github.com/EnterpriseBT/portal-ai/issues/226) · **Epic:** #222 · **Discovery:** `docs/AUTH0_CLI_OPS_GUIDE.discovery.md`

Pins the contract for #226: a new vendor-CLI runbook (`docs/AUTH0_CLI_OPS.md`) for Auth0 tenant **inspection + management**, a read-only `auth0` allowlist in `.claude/settings.local.json`, and a stale-config cleanup (`.env.example` + `apps/api/README.md`). Docs + config only — no code, no schema.

## Key decisions (flag for review)

Resolved in discovery, ratified here:

1. **Two logins, kept distinct** — the guide leads by separating `portalai login` (cli-env device-flow, user token for the app API) from `auth0 login` (the Auth0 CLI against a tenant's Management API).
2. **Auth: document both** — human device pairing (`auth0 login`) for interactive admin; a **dedicated read-only M2M app** (Management API, read scopes) as the **agent/CI path** (non-interactive + fail-safe). Per-env **separate tenants** (`auth0 tenants use <tenant>` first).
3. **Read-only allowlist only** — inspection verbs auto-run; mutations **and `tenants use`** (state-changing selection) stay prompt-gated.
4. **`--json` banner strip** — `auth0 … --json` prepends a `=== <tenant> <resource>` banner; the guide documents the strip (the operable predicate's "documents how to parse it").
5. **RBAC = future note** — a one-liner that Auth0 roles/permissions are CLI-manageable but not enforced by the app today (authz is org-membership; `requireScope`/`requirePermission` are unwired).
6. **Stale-config cleanup folded in** — fix `.env.example` `AUTH0_AUDIENCE` and remove the stale `AUTH0_ISSUER` from `apps/api/README.md`.

## Scope

### In scope
1. `docs/AUTH0_CLI_OPS.md` — the runbook.
2. `.claude/settings.local.json` — append read-only `auth0` allow-entries.
3. `apps/api/.env.example` + `apps/api/README.md` — stale-config cleanup.

### Out of scope
- The app's Auth0 JWT runtime middleware and the `cli-env` device-flow — inspection/management only.
- Wiring Auth0 RBAC into app authorization — future consideration, noted not built.
- Wrapping `auth0` behind `portalops`; live `prod` execution (#83).

## Surface

### A. `docs/AUTH0_CLI_OPS.md` (new) — section layout

House COMMANDS style, matching `docs/AWS_CLI_OPS.md` / `docs/STRIPE_CLI_OPS.md`. Ordered sections:

1. **Purpose & boundary** — vendor CLI for Auth0 tenant inspection/management, human **or** agent; not the app JWT runtime or the `portalai` device-flow.
2. **Two different logins** — the `portalai login` vs `auth0 login` callout (token type, audience, purpose).
3. **Auth** — human device pairing (`auth0 login`) for interactive admin; a **dedicated read-only M2M app** for agents/CI (`auth0 login --domain <tenant> --client-id … --client-secret …`), Management API grant scoped **read**: `read:users`, `read:logs`, `read:roles`, `read:role_members`, `read:clients`, `read:connections`. **Per-env separate tenants** (app-dev `portalsai-staging.us.auth0.com`, local `dev-ow7j1wh6zixlfcp1.us.auth0.com`); `auth0 tenants use <tenant>` before directory ops. `prod` = its own tenant (#83), gated.
4. **Invariants** — non-interactive `--json`; **strip the banner** (`auth0 … --json` emits a `=== <tenant> <resource>` header + blank line before the JSON — e.g. `| sed '1,/^\[/{/^\[/!d}'`); always select the tenant first.
5. **Logging operations** — `auth0 logs tail --json`; `auth0 logs list --filter "type:f" --json` (failed logins) with `--number` bound.
6. **Inspection operations** — find a user (`auth0 users search --query "email:…" --json`); user profile (`auth0 users show <id> --json`); a user's roles (`auth0 users roles show <id> --json`); roles + permissions (`auth0 roles list --json`); applications (`auth0 apps list --json`); APIs/audiences (`auth0 apis list --json`); tenants (`auth0 tenants list --json`).
7. **Management operations (prompt-gated, operator action)** — `auth0 users update`/`delete`, `auth0 users roles add/rm`, `auth0 apps update`. Flagged not-agent-auto.
8. **RBAC note (future)** — one line: Auth0 roles/permissions are manageable here but the app authorizes via org membership today; enforcing Auth0 RBAC is future.
9. **Gotchas** — separate tenants per env (a user id in one is meaningless in another); `auth0 login` ≠ `portalai login`; the `--json` banner; `tenants use` silently redirects subsequent commands.
10. **prod** — own tenant, gated; unexercised until #83.

### B. `.claude/settings.local.json` — appended `permissions.allow` entries

Append these read-only matchers (house `Bash(<prefix>:*)` shape):

```json
"Bash(auth0 logs list:*)",
"Bash(auth0 logs tail:*)",
"Bash(auth0 users search:*)",
"Bash(auth0 users show:*)",
"Bash(auth0 users roles show:*)",
"Bash(auth0 roles list:*)",
"Bash(auth0 apps list:*)",
"Bash(auth0 apis list:*)",
"Bash(auth0 tenants list:*)"
```

**Excluded (stay prompt-gated):** `auth0 users update`, `auth0 users delete`, `auth0 users roles add`/`rm`, `auth0 apps update`, `auth0 tenants use`, `auth0 login`.

### C. Stale-config cleanup

- `apps/api/.env.example:8` — `AUTH0_AUDIENCE=https://api.mcp-ui.dev` → a current placeholder `AUTH0_AUDIENCE=https://api.portalsai.local` (drop the old `mcp-ui` project name).
- `apps/api/README.md:29` — remove the stale `AUTH0_ISSUER=https://your-domain.auth0.com/` line (no `AUTH0_ISSUER` var exists; the API derives the issuer from `AUTH0_DOMAIN` via `issuerBaseURL`, `auth.middleware.ts:12-15`). Leave `AUTH0_AUDIENCE` (line 28) and add `AUTH0_DOMAIN` to that snippet if absent.

## Migration / Seed

**None** — no DB schema change. No migration, no seed.

## TDD test plan

Docs + JSON-config ticket; no code to unit-test, no pinning test over `docs/*.md` / `settings.local.json` / READMEs. Verification:

1. **Config validity** — `jq empty .claude/settings.local.json`; `jq -r '.permissions.allow[]|select(startswith("Bash(auth0"))' | wc -l` returns `9`; excluded verbs absent.
2. **Cleanup** — `grep -rn 'mcp-ui' apps/api/.env.example` returns nothing; `grep -n 'AUTH0_ISSUER' apps/api/README.md` returns nothing.
3. **Manual smoke** (`/smoke 226`, merge gate) — against the **app-dev tenant**: `auth0 tenants use portalsai-staging.us.auth0.com`, then `auth0 users search --query "email:…" --json` and `auth0 logs list --json` return JSON (after banner strip).
4. **Doc-consistency (manual)** — every charter Auth0 row (14) appears in the guide or is deferred; the login distinction + banner-strip are documented.

**Totals ≈ 0 automated cases** (jq/grep + manual smoke). No jest/integration tests warranted.

## Acceptance criteria

- [ ] From `docs/AUTH0_CLI_OPS.md` alone, a human or agent authenticates to the `app-dev` Auth0 tenant and reads tenant logs + inspects users/apps without the dashboard.
- [ ] Runbook commands are non-interactive with parseable output (the `--json` banner-strip is documented).
- [ ] The 9 read-only `auth0` allow-entries exist; reads run with no prompt; mutations + `tenants use` still prompt.
- [ ] Every Auth0 op the charter assigned to #226 is documented (or explicitly deferred).
- [ ] `.env.example` has no `mcp-ui` audience; `apps/api/README.md` has no stale `AUTH0_ISSUER`.

## Risks & rollback

- **Over-privileged credential** — mitigated by specifying a **read-only** M2M app; a read-only session cannot mutate the tenant (fail-safe). Human device pairing carries admin rights but is interactive/attributed.
- **Unparseable output** — mitigated by documenting the `--json` banner strip.
- **Rollback:** docs + config only — revert the commit; no runtime/DB impact.

## Files touched

- **NEW** `docs/AUTH0_CLI_OPS.md`
- **EDIT** `.claude/settings.local.json` (+9 read-only `auth0` allow-entries)
- **EDIT** `apps/api/.env.example` (AUTH0_AUDIENCE placeholder)
- **EDIT** `apps/api/README.md` (remove stale AUTH0_ISSUER)
- (already committed on this branch) `docs/AUTH0_CLI_OPS_GUIDE.discovery.md`

## Next step

`docs/AUTH0_CLI_OPS_GUIDE.plan.md` (`/plan 226`) sequences ~3 slices on this branch: (1) stale-config cleanup (small, independent); (2) `docs/AUTH0_CLI_OPS.md` runbook; (3) `.claude/settings.local.json` allowlist + `jq` validity + acceptance reconcile. The smoke (`/smoke 226`) follows as the merge gate.
