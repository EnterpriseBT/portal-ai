# @portalai/admin-cli — `portalai`

Portal's **customer-app-data operator CLI**: organization / user / membership / tier management, full org provisioning, and on-demand fixtures — per environment, guarded, audited, and drivable by an AI agent. Built on [`@portalai/cli-env`](../cli-env/README.md); the infrastructure sibling is [`portalops`](../devops-cli/README.md) (#190, epic #191). **Infra-free**: no AWS SDK — this package's domain core is what a future customer-facing CLI extends.

The machine-readable command reference is [`COMMANDS.md`](./COMMANDS.md); the agent-operability contract (exit codes, server-enforced guards, auth, audit) is in [CLAUDE.md → Operating the Portal CLIs](../../CLAUDE.md).

## Running it

From the **repo root**:

```bash
npm install && npx turbo run build --filter=@portalai/admin-cli   # one-time; rebuild after pulling changes
npx portalai --help
npx portalai org list --env app-dev
```

Bare command: `alias portalai="npx portalai"` or `npm link` inside `packages/admin-cli`.

For `--env local`, `DATABASE_URL` must be in your **shell env**:

```bash
DATABASE_URL=$(grep ^DATABASE_URL apps/api/.env | cut -d= -f2-) npx portalai org list --env local
```

## Login is part of the design

**Mutations against staging/production require a device-flow session** — that's how every audit line attributes to a real authenticated human (including when an agent drives the CLI inside a session you authorized):

```bash
npx portalai login --env app-dev     # approve the printed URL once; sessions refresh silently
# … mutate freely; audit lines carry your Auth0 identity …
npx portalai logout --env app-dev
```

Reads never need a session. `local` mutations don't either (audit falls back to your OS username).

## Quickstarts

```bash
# Inspect
portalai org list --env app-dev --search acme
portalai org get <orgId> --env app-dev
portalai user list --env app-dev --org <orgId>

# Manage
portalai org create --name "Acme" --owner-email ben@portalsai.io --env app-dev --yes
portalai org set-tier <orgId> standard --env app-dev --yes       # visible in the app ≤60s (tier cache)
portalai member add <orgId> teammate@portalsai.io --env app-dev --yes
portalai org delete <orgId> --env app-dev --yes                  # soft-delete; hard deletes don't exist here

# The org switcher the app UI doesn't have yet
portalai member switch <orgId> you@portalsai.io --env app-dev --yes   # refresh the app → you're in that org

# Dev/QA: a disposable, FULLY-provisioned org you can actually enter
portalai seed org --name "QA Sandbox" --member-email you@portalsai.io --env local --yes
portalai member switch <printed orgId> you@portalsai.io --env local

# The old `npm run db:reset` habit (org-scoped app-data reset)
portalai org reset <orgId> --env local
```

`org create` and `seed org` run the **app's own provisioning transaction** (`ApplicationService`) — the org gets system column definitions, the Sandbox connector, a default station with the `data_query` toolpack, and `defaultStationId`, exactly like a webhook-created org. `org reset` spawns the app's `db:reset` (which stays as the app's own entrypoint).

## The rules

- **`--env` required everywhere; no default.** Banner on stderr; payload/`--json` on stdout.
- Guards key on the env's `kind`: `development` free · `staging` mutations need `--yes` · `production` — `org delete`/`org reset`/`seed org` are **refused unconditionally**; other mutations need `--yes --confirm-prod`.
- **Sessions**: staging/prod mutations require `portalai login` (exit 4 tells you).
- Every mutation appends to `~/.portalai/audit.log` (ids/slugs only, never row contents).
- Users **originate in Auth0** — the CLI resolves them by email, never creates them (the synthetic `seed|…` owner of `seed org` is the deliberate exception).

## Troubleshooting (exit codes)

| Exit | Code | Fix |
|---|---|---|
| 2 | usage | check flags; `--env` is required |
| 3 | `ENV_NOT_CONFIGURED` | unknown env; local missing `DATABASE_URL` |
| 4 | `ENV_NOT_AUTHORIZED` | `portalai login --env <env>` (or `aws login` for the tunnel) |
| 5 | `ENV_CONFIRMATION_REQUIRED` | add `--yes` / `--confirm-prod` |
| 6 | `ENV_DESTRUCTIVE_BLOCKED` | destructive op against production — no override |
| 7 | `ENV_INFRA_ERROR` | tunnel/psql/spawn failure — message carries the cause |
| 8 | `ADMIN_NOT_FOUND` | org/user/tier/membership doesn't exist (or is soft-deleted) |
| 9 | `ADMIN_CONFLICT` | duplicate membership / name collision |

## Architecture notes

- CRUD goes through the **`AdminStore`** seam over the CLI's own minimal drizzle defs; a **schema-parity pin** (test-only import of `apps/api`'s schema) turns drift into a CI failure. Store tests run against a real in-memory Postgres (PGlite).
- Provisioning/reset/fixtures **spawn `apps/api`'s own scripts** with `DATABASE_URL` injected — the app owns its data semantics; nothing is reimplemented.
- Library-first: every command is an importable function with guards/session/audit inside — test harnesses and agents inherit the same protections.
