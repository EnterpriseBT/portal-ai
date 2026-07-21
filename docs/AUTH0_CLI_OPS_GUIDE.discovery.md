# Auth0 CLI operations guide — Discovery

**Issue:** [EnterpriseBT/portal-ai#226](https://github.com/EnterpriseBT/portal-ai/issues/226)

**Why this exists.** Auth0 tenant administration — user lookup/management, application (client) config, connections, roles/permissions — and tenant log inspection (logins, failures, admin actions) are today done in the Auth0 dashboard. In the codebase Auth0 appears only as `portalai`'s device-flow login (`cli-env/src/auth0.ts`) and the API's JWT middleware; there is no operator/agent runbook for operating the tenants themselves. The #223 charter maps 14 Auth0 operations and rates them operable but points here for the runbook. This is the guide that turns those rows into a real, credentialed Auth0 **tenant-management** runbook — per environment, **inspection-first** — never touching the app's JWT runtime or the device-flow auth path.

## The current shape

### Two different Auth0 logins (the distinction the guide must nail)

| Login | Location | What it is |
|---|---|---|
| `portalai` device-flow | `packages/cli-env/src/auth0.ts:117-200` | OAuth **device authorization grant** (`/oauth/device/code`, scope `openid profile email offline_access`, `auth0.ts:122`) → a **user access token** for the *Portal API* (`AUTH0_AUDIENCE`), cached `~/.portalai/credentials.json` (0600, per-env). Acts *as the human against the app*. |
| `auth0` CLI | this guide | Authenticates the **Auth0 CLI** against a **tenant's Management API** (`auth0 login` device pairing, or machine login) → operates users/roles/apps/logs. Different app, audience, and purpose. |

They share the tenant/domain config but are otherwise unrelated — the guide leads with this so nobody conflates `auth0 login` with `portalai login`.

### Auth0 config & per-env tenants

| Piece | Location | Note |
|---|---|---|
| Env vars | `apps/api/.env.example:9-10,31` | `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `AUTH0_WEBHOOK_SECRET`; placeholder `AUTH0_AUDIENCE=https://api.mcp-ui.dev` (stale) |
| CLI catalog | `packages/devops-cli/src/catalog.ts:55-57` | `auth0-domain` / `auth0-audience` / `auth0-cli-client-id` (SSM) |
| Per-env resolution | `packages/cli-env/src/auth0.ts:46-67` | AWS envs read from SSM (`/portalai/dev/auth0-*`); `local` from `.env` |
| **No Management client secret** | — | `AUTH0_CLI_CLIENT_ID` is the **device-flow public client** (id only); there is **no** Management-API M2M secret in the repo. The guide must introduce Management-API auth separately. |
| Tenants (verified, smoke §3) | — | app-dev = `portalsai-staging.us.auth0.com`; local = `dev-ow7j1wh6zixlfcp1.us.auth0.com` — **separate tenants** |

### App-side Auth0 (out of scope, but what it reads)

- JWT middleware `apps/api/src/middleware/auth.middleware.ts:12-15` — `express-oauth2-jwt-bearer`, audience/issuer/RS256; `sub` = Auth0 user id. Post-login webhook `POST /api/webhooks/auth0/sync` (`webhook.router.ts:115`) syncs users on login.
- **RBAC caveat:** `authorization.middleware.ts:16-63` has `requireScope`/`requirePermission` reading Auth0 `scope`/`permissions` claims — **but they're not wired to any routes**. Authorization today is **app-level via org membership** (`packages/core/src/contracts/user-membership.contract.ts`, `organization.ownerUserId`); the `users` table has no `role` column. So Auth0 roles/permissions are CLI-manageable but **the app does not yet enforce them** — a grounding caveat the guide must carry.

### Charter rows + allowlist

- Charter Auth0 section `docs/CLI_OPERATIONS_CHARTER.md:71-90` — preamble (`:73`: per-tenant login, separate per-env tenants, `auth0 tenants use <tenant>` before directory ops, non-interactive `--json`) + **14 rows** (2 logging: `logs tail`, `logs list --filter "type:f"`; users search/show/update/delete; `users roles add`/`show`; `roles list`; `apps list`/`update`; `tenants use`/`list`; `apis list`). Coverage `:202` = 14/14.
- Allowlist: `.claude/settings.local.json` `permissions.allow` — flat `Bash(<prefix>:*)` array; no `auth0` entry yet.

### Verified live (smoke §3)

`auth0` CLI v1.32.0; `auth0 users search`, `auth0 logs list`, `auth0 apis list`, `auth0 roles list` all return JSON. **Quirk:** `auth0 … --json` prepends a `=== <tenant> <resource>` banner + blank line **before** the JSON array — downstream parsers must strip it.

## The design space

### Decision 1 — Guide location & format

**Lean: new `docs/AUTH0_CLI_OPS.md`** in the house COMMANDS style, matching the shipped `docs/AWS_CLI_OPS.md` / `docs/STRIPE_CLI_OPS.md` siblings (auth preamble → invariants → inspection ops → mutating ops prompt-gated → gotchas → prod). Vendor CLI; the charter's Auth0 Guide-ref points at #226.

### Decision 2 — Management-API auth: which credential

The `auth0` CLI authenticates against a tenant's Management API two ways; the repo has no Management M2M secret, so one must be introduced.

| | A: user login (`auth0 login`, device pairing) | B: dedicated read-only M2M app (machine login) |
|---|---|---|
| Humans | natural, interactive | overkill |
| Agents / CI | needs a TTY (device pairing) | non-interactive: `--client-id`/`--client-secret` |
| Scope | the human's admin rights | least-privilege read scopes |

**Lean: document both** — `auth0 login` (device pairing) for humans; a **dedicated read-only M2M app** (Management API grant, read scopes) via `auth0 login --domain … --client-id … --client-secret …` for agents/CI. Per-env separate tenants; select with `auth0 tenants use <tenant>` before directory ops.

### Decision 3 — Allowlist scope (which `auth0` verbs auto-run)

| | A: read-only verbs only | B: + `tenants use` | C: + mutations |
|---|---|---|---|
| Auto-run | `logs list/tail`, `users search/show`, `users roles show`, `roles list`, `apps list`, `apis list`, `tenants list` | + active-tenant switch | + `users update/delete`, `roles add`, `apps update` |
| Safety | fail-closed | silently redirects later commands | tenant-mutating unprompted |

**Lean: A.** Only pure-read verbs in `permissions.allow`. Mutations (`users update/delete`, `users roles add/remove`, `apps update`) stay prompt-gated. **`tenants use` is excluded too** — it silently redirects subsequent commands to another tenant (a footgun for auto-run); documented as a setup step.

### Decision 4 — The `--json` banner quirk

**Lean:** document the strip recipe in the invariants (the operable predicate allows "the guide documents how to parse it") — pipe through `sed '1,/^\[/{/^\[/!d}'` / `awk 'f;/^\[/{f=1;print}'`, or `--no-color` + skip the header. Note it applies to every `--json` subcommand.

## Tradeoff comparison

|  | D1: standalone doc | D2: read-only M2M + user login | D3: read-only allowlist | D4: banner strip |
|---|---|---|---|---|
| Spread to spec | Yes (layout) | Yes (auth section + M2M scopes) | Yes (exact allow-entries) | Yes (invariants) |

## Recommendation

1. Ship `docs/AUTH0_CLI_OPS.md` — vendor-CLI runbook in the sibling house shape: the two-logins callout, auth (user login + read-only M2M, per-env separate tenants, `auth0 tenants use`), invariants (`--json` banner strip, tenant selection), inspection ops (logs, users, roles, apps, apis), mutating ops (prompt-gated), the RBAC-not-enforced caveat, gotchas, prod.
2. Recommend a **dedicated read-only M2M app** for CLI inspection (Management API read scopes), distinct from the device-flow public client.
3. Add a read-only `auth0` allowlist to `.claude/settings.local.json`; mutations and `tenants use` stay prompt-gated.
4. Add a **brief one-line note** that Auth0 roles/permissions are CLI-manageable but not enforced by the app today (authz is org-membership; wiring Auth0 RBAC is a **future consideration**) — a note, not a prominent warning.

## Open questions

1. **Read-only M2M scopes.** **Lean:** `read:users`, `read:logs`, `read:roles`, `read:role_members`, `read:clients`, `read:connections`. The spec pins the final list.
2. **`tenants use` in the allowlist?** **Lean: no** — state-changing selection that silently redirects later commands; keep it a documented, prompt-gated setup step.
3. **Document role ops given they're not app-enforced?** **Lean: yes** — the charter assigned them and they're valid Auth0 tenant ops; document with the explicit caveat that the app doesn't yet enforce Auth0 roles (authz is org-membership).
4. **Stale config — RESOLVED: fold the cleanup in.** Fix the stale `AUTH0_AUDIENCE=https://api.mcp-ui.dev` (`.env.example:9`) to a current placeholder and remove/correct the stale `AUTH0_ISSUER` reference in `apps/api/README.md:28-29`, in this PR (docs-sync). Exact replacement values read from the files at implementation time.

## Enterprise-scale considerations

- **Multi-tenancy** — **Lean:** per-env **separate tenants** (confirmed); an Auth0 tenant ≠ a Portal org (a Portal org = users/memberships within the env's tenant). The guide states which tenant maps to which env and to always `auth0 tenants use` first.
- **Accuracy & auditability** — **Lean:** Auth0 **tenant logs** are the vendor audit record (the guide reads them); distinct from `portalai`'s `~/.portalai/audit.log` (device-flow/native actions). Name both.
- **Failure modes** — **Lean: fail-safe** — a read-only M2M / read-scoped session cannot mutate the tenant; the inspection surface can't do harm.
- **Contract stability** — **Lean:** per-tenant auth (select tenant + credential) extends to `prod` (its own tenant, #83) with no re-plumbing.
- **Scale & unbounded growth** — **Lean:** `logs list` is paginated (`--number`); show bounded forms first so an agent doesn't pull an unbounded log.
- **Concurrency / data lifecycle** — N/A because this is a read/inspection docs surface with no shared mutable state or business-period windows.

## What this doesn't decide

- **The app's Auth0 JWT runtime middleware and the `cli-env` device-flow** — inspection/management of the tenant only; not the app's auth path.
- **Wiring Auth0 RBAC into app authorization** — the app uses org membership today; enforcing Auth0 roles is a separate **future consideration**, only *noted* (one line) in the guide.
- **Wrapping the `auth0` CLI behind `portalops`** — rejected by the charter overlap rule; direct `auth0` use only.
- **Live `prod` tenant execution** — env pending #83; prod forms documented, not exercised.

## Next step

Write `docs/AUTH0_CLI_OPS_GUIDE.spec.md` (contract: guide section layout, the read-only M2M scope list, exact allowlist entries, the `--json` banner-strip note, acceptance mapped to #226) and `.plan.md` (slices). Likely slicing: (1) stale-config cleanup (`.env.example` `AUTH0_AUDIENCE` + `apps/api/README.md` `AUTH0_ISSUER`) — small, independent; (2) `docs/AUTH0_CLI_OPS.md` — two-logins callout + auth (user + read-only M2M) + invariants (`--json` banner strip) + inspection ops + RBAC future-note; (3) `.claude/settings.local.json` read-only `auth0` allowlist + `jq` validity + acceptance reconcile. All land on `feat/auth0-cli-ops-guide` → base `epic/cli-first-ops`. (No charter fix needed — the Auth0 rows are correct.)
