# portalai — command reference

Machine-oriented reference. Agent-operability contract (exit codes, server-enforced guards, auth, audit): [CLAUDE.md → Operating the Portal CLIs](../../CLAUDE.md). Invariants: `--env <name>` **required** everywhere (no default); banner `[env: <name> (<kind>)]` on **stderr**; payload (or the `--json` envelope `{"error":{"code","message"}}`) alone on **stdout**.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | success |
| 1 | unclassified error |
| 2 | usage error, incl. `ADMIN_INVALID_INPUT` — input the app would refuse (e.g. an invalid org name, an empty `org update`) |
| 3 | `ENV_NOT_CONFIGURED` — unknown env / local missing `DATABASE_URL` |
| 4 | `ENV_NOT_AUTHORIZED` — no device-flow session for a staging/prod mutation (run `portalai login --env <env>`), or AWS credentials lapsed |
| 5 | `ENV_CONFIRMATION_REQUIRED` — missing `--yes` / `--confirm-prod` |
| 6 | `ENV_DESTRUCTIVE_BLOCKED` — destructive op vs production (no override) |
| 7 | `ENV_INFRA_ERROR` — tunnel / spawn / infra failure |
| 8 | `ADMIN_NOT_FOUND` — org / user / tier / membership absent or soft-deleted |
| 9 | `ADMIN_CONFLICT` — duplicate membership, org-name collision, or `set-tier` on an org with a live Stripe subscription (#259) |

## Guard + session matrix

| Class | development | staging | production |
|---|---|---|---|
| read | — | — | — |
| mutation (`org create/update/set-tier`, `member *`, `demo create`, `demo delete`) | — | `--yes` **+ session** | `--yes --confirm-prod` **+ session** |
| destructive (`org delete`, `org reset`, `seed org`) | — | `--yes` **+ session** | **refused** (exit 6) |

Session = an active `portalai login` device-flow session for the env. Every mutation appends a JSONL audit line (`~/.portalai/audit.log`) attributed to the session's Auth0 `sub` (local: OS username); args carry ids/slugs only.

Local config (`--env local`): `DATABASE_URL` (DB ops) and `AUTH0_*` (`login`) are read from this package's own `.env` (`packages/admin-cli/.env`, git-ignored, auto-loaded for local only — #632; copy from `.env.example`) or from the shell (an export wins). app-dev/prod ignore the file and resolve from AWS.

Spawned app scripts (`org create`, `org delete`, `org reset`, `seed org`, `demo create`, `demo delete`) run against the target env with its `DATABASE_URL` injected and, for app-dev/prod, its `ENCRYPTION_KEY` (Secrets Manager) and `SYSTEM_ID` (SSM `system-id`). The system id is what platform rows carry as `createdBy`; before #952 a script took the operator's local `SYSTEM`, which left prod's Demo org unreadable through `created_by_system`. `demo create` also passes the env's `DEMO_TOOLPACK_URL` (SSM) and `DEMO_TOOLPACK_SIGNING_SECRETS` (Secrets Manager), #1035. A failed read stops the command before anything runs.

---

### `portalai login --env <env>` / `portalai logout --env <env>`
Device-flow session bootstrap / teardown. `login` prints the activation URL + code on stderr; approve in a browser once — refresh is silent thereafter.
`--json`: `{ "env", "loggedIn": true }` / `{ "env", "loggedOut": true }`

### `portalai org list --env <env> [--search <text>] [--limit <n>] [--offset <n>] [--json]`
Read. Live orgs, name-ILIKE search, created desc.
`--json`: `{ "orgs": [Organization] }`

### `portalai org get <id> --env <env> [--json]`
Read. `--json`: `{ "org": Organization }` · absent/soft-deleted → 8.

### `portalai org create --name <name> --owner-email <email> --env <env> --yes [--confirm-prod] [--json]`
Mutation. **Full app provisioning** via `db:create-org` (org + owner membership + system column definitions + Sandbox connector + the Administrate and Playground stations with their toolpacks + `defaultStationId`, which is Administrate). Owner must be an existing user (users originate in Auth0) → else 8-shaped failure from the script (exit 7 envelope carries the message).
`--json`: `{ "organizationId", "stationId" }` (`stationId` is the default station, Administrate)

### `portalai org update <id> [--name] [--timezone] [--default-station-id] --env <env> --yes [--json]`
Mutation, in one transaction with the org row locked. Pass at least one field (else `ADMIN_INVALID_INPUT`, exit 2). `--name` follows the app's rule: trimmed, 1–120 characters, one line (else exit 2, nothing runs). A value equal to the current one writes nothing (the row isn't stamped as edited).
- **Activity (#936):** a changed `--name` or `--default-station-id` records the same `org.update` entry the app does: `{ field: "name", from, to }` (#907) or `{ field: "defaultStationId", from, to, fromName, toName }` (#935), plus `via: "portalai"`. Entries commit with the change and are attributed to your user when your `portalai login` session matches one (else the session `sub`, or the OS username locally). An unchanged value records nothing. `--timezone` isn't recorded in Activity.
- **Default station:** must be a live station in that org, else `ADMIN_NOT_FOUND` (exit 8) and nothing is written.
- **Stripe:** `portalai` holds no Stripe credential. When the name changed and the org has a Stripe customer, the result carries the step that keeps the customer's name (invoices, billing portal) in step, and human output warns on stderr. Run it with the env's Stripe CLI.
- `--json`: `{ "org": Organization, "stripe"?: { "action": "update_customer_name", "customerId", "name", "command" } }`. The command targets the env's Stripe account: `stripe customers update '<cus>' --name='<name>'`, plus `--project-name <env>` for app-dev, and `--project-name prod --live` for prod.
- The local operator audit line records `{ orgId, requested, changed }`: the fields asked for and the ones that moved.

### `portalai org set-tier <id> <tierSlug> --env <env> --yes [--allow-stripe-desync] [--json]`
Mutation. Tier slug must exist live → else 8. Audits old→new; the app sees it within ≤60s (tier cache).
**Stripe guard (#259):** if the org has a **live Stripe subscription** (`stripe_subscription_id` set), the subscription drives the tier (webhook-authoritative), so a manual set-tier would desync the DB from Stripe — the command **refuses with `ADMIN_CONFLICT` (exit 9)** and names the subscription. Change/cancel the plan in Stripe or the billing portal instead, or pass **`--allow-stripe-desync`** to override consciously. (Inspect the linkage with `org get <id> --json`.)
`--json`: `{ "id", "tier", "previousTier" }`

### `portalai org delete <id> --env <env> --yes [--json]`
**Destructive** (never prod). Runs the app's **full organization deletion** (#197, the same one an owner gets from Settings) through `db:org:delete`, attributed to you (#1088): the org's content (records, `er__` wide tables, connectors, stations, uploads) is hard-deleted, its queued jobs are cancelled, and the org row and **every membership** are tombstoned, so no member keeps it as their current org. A missing or already-deleted org → 8 before anything runs. An org with an **active** job is refused by the script (exit 7, naming the job); wait for it or cancel it, then re-run.
`--json`: `{ "id", "deleted": true }`

### `portalai org reset <id> --env <env> --yes [--json]`
**Destructive** (never prod). The app's org-scoped data reset (`db:reset` via `ResetService`), spawned with the env's `DATABASE_URL`.
`--json`: `{ "id", "reset": true }`

### `portalai user list --env <env> [--org <orgId>] [--limit] [--offset] [--json]`
Read. `--org` filters via live membership. `--json`: `{ "users": [User] }`

### `portalai user get <email> --env <env> [--json]`
Read. `--json`: `{ "user": User }` · unknown/deleted → 8.

### `portalai member add|remove|switch <orgId> <email> --env <env> --yes [--json]`
Mutations, email-resolved. `add`: live duplicate → 9; a previously-removed membership is revived (and its `lastLogin` reset to 0); the new membership is created with `lastLogin=0` so it does **not** change which org the user currently lands in. `switch` bumps the membership's `lastLogin` to now — **the app's current-org selector** (`ORDER BY last_login DESC`) — so refresh the app and the user lands in this org. Adding a user to N orgs never silently moves them; only `switch` does.
`--json`: `{ "orgId", "userId", "added"|"removed"|"switched": true }`

### `portalai seed org --name <name> [--member-email <email>] --env <env> --yes [--json]`
**Destructive** class (synthetic data — never prod; production orgs go through `org create`). Idempotent by live org name. Creates a synthetic owner (`seed|<uuid>`), runs the full app provisioning, and optionally adds a real user as a member so the org is enterable from the app (pair with `member switch`).
`--json`: `{ "organizationId", "ownerUserId", "memberUserId"?, "existing": boolean }`

---
### `portalai demo create --name <name> --owner-email <email> [--tier <slug>] [--rows <n>] --env <env> --yes [--confirm-prod] [--json]`
**Mutation** (#1035). Provisions a **new** org for one demo through `db:demo:create` and loads the committed fictional-company dataset onto a station of its own. Running it twice with the same name makes two independent orgs.
- **What it creates:**
  - the org, through the same path as `org create`, so its Administrate and Playground stations are exactly a normal new org's and Administrate stays the default;
  - the internal `is_demo` marker;
  - the tier;
  - a **Demo** station holding the File Upload (CSV + XLSX), REST and Sandbox instances with all their entities and records, every built-in toolpack, the custom webhook toolpack, and the synthesized `transactions` table;
  - one unrestricted curated view per entity (keyed like the entity), attached to the Demo station. Since #674 a station queries data only through its attached views, so these are what the presenter script's prompts read.
- **Checked before anything runs:**
  - `--name`: the app's org-name rule; trimmed, 1–120 characters, one line.
  - `--rows`: a whole number from 0 to 10,000,000, default **10,000**.

  Either one invalid → exit 2. `--owner-email` must be an existing user and `--tier` (default `enterprise`) a live tier, else exit 8.
- **Toolpack config.** On app-dev/prod the env's `DEMO_TOOLPACK_URL` (SSM `demo-toolpack-url`) and `DEMO_TOOLPACK_SIGNING_SECRETS` (Secrets Manager `demo-toolpack-signing-secrets`) are read and passed to the script. Either missing → exit 3. Locally both come from the shell or `apps/api/.env`, and without them the demo gets built-ins only.
- **A failed load** (for example a refused toolpack registration) runs the full org deletion on the org it created and exits 7 with the error. A run killed mid-load can't clean up: find the leftover with `org list --search "<name>"` and `demo delete` it.
- **The owner's current org doesn't change.** The demo membership's `last_login` is 0, so the owner switches into it deliberately (`member switch`, or the app's org switcher).
- **stderr reminder:** `--rows` raises the dataset size, and a finished demo is removed with `demo delete`.

`--json`: `{ "organizationId", "stationId", "tier", "rows", "entities", "toolpacks": { "builtins", "custom" }, "views", "durationMs" }`

### `portalai demo delete <id> --env <env> --yes [--confirm-prod] [--json]`
**Mutation** (#1035), so it runs on prod with `--yes --confirm-prod`, unlike `org delete`. Runs the app's **full organization deletion** (#197, the same one an owner gets from Settings) through `db:demo:delete`, attributed to you:
- **Removed:** the org's content is hard-deleted (records, `er__` wide tables, connectors, stations, packs, portals).
- **Tombstoned:** the org row and **its memberships**, so no member keeps a deleted org as their current one.
- **Kept:** usage and ledger rows.
- **Jobs:** queued jobs are cancelled. An active one refuses the delete (exit 7, `ENTITY_LOCKED_BY_JOB`); retry when it finishes.

It only acts on an org `demo create` marked, checked before anything runs:
- any other live org → `ADMIN_CONFLICT` (exit 9), unchanged;
- a missing or already-deleted org → exit 8.

Reading the marker needs the env migrated to #1035. The CLI's other org commands don't read it.

`--json`: `{ "id", "deleted": true }`
