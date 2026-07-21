# Auth0 CLI operations runbook

The **agent- and human-operable runbook** for Auth0 **tenant inspection and management** on Portal.ai environments — the runbook the [CLI Operations Charter](./CLI_OPERATIONS_CHARTER.md)'s Auth0 table points at (#226, epic #222). Every inspection command is non-interactive and emits JSON.

**Boundary.** This operates the Auth0 **tenants** (users, roles, applications, connections, logs). It is **not** the app's JWT runtime middleware, and **not** the `portalai` device-flow login (see below). `local`, `app-dev`, and future `prod` each have their **own Auth0 tenant** — tenant-scoped ids (application `client_id`s, role/connection ids, DB `auth0|…` user ids) do not cross tenants (see [Gotchas](#gotchas) for the social-id nuance).

## Two different logins (don't conflate them)

| Login | What it authenticates | Use |
|---|---|---|
| **`portalai login`** (`cli-env` device-flow) | a **user access token for the Portal API** (`AUTH0_AUDIENCE`), cached `~/.portalai/credentials.json` | operating app data via `portalai` — *not* this guide |
| **`auth0 login`** (the Auth0 CLI) | the **Auth0 CLI against a tenant's Management API** | operating the tenant itself — *this guide* |

Same tenant/domain config, different apps, tokens, and audiences. This guide only uses `auth0`.

## Auth

Each env is a **separate tenant** — select it first, then run directory ops:

```bash
auth0 tenants use portalsai-staging.us.auth0.com   # app-dev; local = dev-ow7j1wh6zixlfcp1.us.auth0.com
auth0 tenants list --json                          # confirm the active tenant
```

Two ways to authenticate the CLI to a tenant's Management API:

- **Humans — device pairing:** `auth0 login` (interactive; opens a browser, carries your admin rights). Fine for the interactive management ops below.
- **Agents / CI — dedicated read-only M2M app (recommended):** create one **per tenant** — Dashboard → Applications → Create Application → **Machine to Machine** → authorize the **Auth0 Management API** → grant **only** these **read** scopes: `read:users`, `read:logs`, `read:roles`, `read:role_members`, `read:clients`, `read:connections`. Then:
  ```bash
  auth0 login --domain <tenant> --client-id <m2m-client-id> --client-secret <m2m-secret>
  ```
  Non-interactive. Store the secret per env (Secrets Manager, like other env secrets). `prod` uses its own tenant + credential (#83), gated.

> **Safety model — the credential is the gate, not the prompt.** A read-only M2M session literally **cannot** mutate the tenant: Auth0 rejects any `users update`/`delete`/`roles add`/`apps update` with a 403 (insufficient scope). That server-side rejection — **not** the `.claude` allowlist and **not** a Claude Code permission prompt — is the mutation-safety boundary. The allowlist only reduces prompts for *reads*, and whether an un-allowlisted command prompts depends on the session's permission mode (it is **not** a guarantee). So: run the agent path with the read-only M2M; the mutating ops below require a **write-capable** credential and deliberate operator intent.

## Invariants

- **Non-interactive `--json`** on every read.
- **Strip the banner:** `auth0 … --json` prints a human header (`=== <tenant> <resource>`) + a blank line **before** the JSON array. Pipe it off before parsing:
  ```bash
  auth0 users search --query "email:user@example.com" --json | sed '1,/^\[/{/^\[/!d}' | jq .
  # or:  auth0 … --json | awk 'f;/^\[/{f=1;print}'
  ```
- **Select the tenant first** (`auth0 tenants use <tenant>`) — every directory op runs against the active tenant.

## Logging operations

### Tail tenant logs
```bash
auth0 logs tail --json                       # live stream
```

### Search tenant logs (e.g. failed logins)
```bash
auth0 logs list --filter "type:f" --number 20 --json   # type:f = failed login; bound with --number
```

## Inspection operations

### Find a user by email
```bash
auth0 users search --query "email:user@example.com" --json
```

### Get a user's profile
```bash
auth0 users show <user-id> --json
```

### Show a user's assigned roles
```bash
auth0 users roles show <user-id> --json
```

### List roles & their permissions
```bash
auth0 roles list --json
```

### List / inspect applications and APIs
```bash
auth0 apps list --json
auth0 apis list --json
```

## Management operations (require a write credential — not agent-auto)

These mutate the tenant. Per the [safety model](#auth), the gate is the **credential**: the read-only M2M (agent path) can't run them (Auth0 → 403); they require a **write-capable** login (`auth0 login` device pairing as an admin) + deliberate operator intent. They are **not** in the agent allowlist — but do not treat the absence of a prompt as safety.

```bash
auth0 users update <user-id> --json          # block/unblock, update profile
auth0 users delete <user-id> --force
auth0 users roles add <user-id> --roles <role-id>
auth0 apps update <client-id> --json         # callbacks, grant types
```

## RBAC note (future)

Auth0 **roles/permissions are manageable here**, but the app does **not** enforce them today — API authorization is by **org membership** (the `requireScope`/`requirePermission` middleware exists but is unwired). Wiring Auth0 RBAC into app authz is a future consideration; assigning an Auth0 role does not currently change app access.

## Gotchas

- **Separate tenants per env, with a social-id nuance** — **tenant-scoped** ids are per-tenant and do not cross: application `client_id`s, role ids, connection ids, and **DB-connection** user ids (`auth0|…`). **But social-connection user ids** (`google-oauth2|…`, etc.) are the *provider's* account id — the **same string in every tenant** that person has logged into (verified: the same `google-oauth2|…` id resolves in both app-dev and local). So a social `user_id` is **not** a reliable "which tenant" signal; always `auth0 tenants use` the right tenant first and scope by the tenant, not the id.
- **`auth0 login` ≠ `portalai login`** — different apps/tokens (see the callout above).
- **`--json` has a banner** — strip the header line before parsing.
- **`tenants use` is sticky** — it silently redirects *all* subsequent commands to that tenant; re-confirm with `auth0 tenants list` if unsure.

## prod (pending #83)

`prod` has its **own tenant** + credential, gated. Its commands are identical with `auth0 tenants use <prod-tenant>` selected. **Unexercised until #83.**
