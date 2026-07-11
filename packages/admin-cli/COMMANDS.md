# portalai — command reference

Machine-oriented reference. Invariants: `--env <name>` **required** everywhere (no default); banner `[env: <name> (<kind>)]` on **stderr**; payload (or the `--json` envelope `{"error":{"code","message"}}`) alone on **stdout**.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | success |
| 1 | unclassified error |
| 2 | usage error |
| 3 | `ENV_NOT_CONFIGURED` — unknown env / local missing `DATABASE_URL` |
| 4 | `ENV_NOT_AUTHORIZED` — no device-flow session for a staging/prod mutation (run `portalai login --env <env>`), or AWS credentials lapsed |
| 5 | `ENV_CONFIRMATION_REQUIRED` — missing `--yes` / `--confirm-prod` |
| 6 | `ENV_DESTRUCTIVE_BLOCKED` — destructive op vs production (no override) |
| 7 | `ENV_INFRA_ERROR` — tunnel / spawn / infra failure |
| 8 | `ADMIN_NOT_FOUND` — org / user / tier / membership absent or soft-deleted |
| 9 | `ADMIN_CONFLICT` — duplicate membership, org-name collision |

## Guard + session matrix

| Class | development | staging | production |
|---|---|---|---|
| read | — | — | — |
| mutation (`org create/update/set-tier`, `member *`) | — | `--yes` **+ session** | `--yes --confirm-prod` **+ session** |
| destructive (`org delete`, `org reset`, `seed org`) | — | `--yes` **+ session** | **refused** (exit 6) |

Session = an active `portalai login` device-flow session for the env. Every mutation appends a JSONL audit line (`~/.portalai/audit.log`) attributed to the session's Auth0 `sub` (local: OS username); args carry ids/slugs only.

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
Mutation. **Full app provisioning** via `db:create-org` (org + owner membership + system column definitions + Sandbox connector + default station/toolpack + `defaultStationId`). Owner must be an existing user (users originate in Auth0) → else 8-shaped failure from the script (exit 7 envelope carries the message).
`--json`: `{ "organizationId", "stationId" }`

### `portalai org update <id> [--name] [--timezone] [--default-station-id] --env <env> --yes [--json]`
Mutation. `--json`: `{ "org": Organization }`

### `portalai org set-tier <id> <tierSlug> --env <env> --yes [--json]`
Mutation. Tier slug must exist live → else 8. Audits old→new; the app sees it within ≤60s (tier cache).
`--json`: `{ "id", "tier", "previousTier" }`

### `portalai org delete <id> --env <env> --yes [--json]`
**Destructive** (never prod). Soft-delete only — hard deletion does not exist in this CLI.
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
