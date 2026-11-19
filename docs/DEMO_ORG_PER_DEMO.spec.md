# Demo org per demo — Spec

This spec pins the contract for replacing `portalai demo seed` / `demo reset` with `demo create` and `demo delete`, plus the org's demo marker that backs them. It builds on [`DEMO_ORG_PER_DEMO.discovery.md`](./DEMO_ORG_PER_DEMO.discovery.md) for [#1035](https://github.com/EnterpriseBT/portal-ai/issues/1035).

## Key decisions (flag for review)

1. **One spawned script owns the org.** `db:demo:create` provisions the org, sets the marker and tier, and creates the Demo station, all in one transaction. After that commits it loads the dataset. If anything throws after the commit, it soft-deletes the org it created before exiting 1.
2. **Inputs are checked in the CLI before anything is spawned.** The CLI checks the owner email and the tier in-process (exit 8) and validates the name and `--rows` (exit 2). The script checks owner and tier again inside its transaction, so a race fails before anything commits.
3. **The marker is `organizations.is_demo boolean NOT NULL DEFAULT false`.** No backfill: the pre-existing demo orgs are marked by hand and then deleted (see Release notes).
4. **`DemoSeedService.seed` takes `stationId`** and never reads the org's stations. `reset` is removed.
5. **Toolpack configuration comes from the catalog and is fatal when missing.** On AWS envs the CLI reads `demo-toolpack-url` (SSM) and `demo-toolpack-signing-secrets` (Secrets Manager). Either one missing → exit 3, before any spawn. The values reach the script through a new `extraEnv` on `runApiScript`. A failed registration throws, which triggers cleanup.
6. **The default tier is `enterprise`.** Tier visibility isn't checked on assignment (`assignOrgTier`, `application.service.ts:681-697`, and `store.setTier`, `store.ts:302-316`, look only at the slug), so `--tier demo` works on any org in an env that has the `demo` tier.
7. **The provisioned stations stay as they are.** The default station stays Administrate, and the Demo station is an extra station.
8. **`demo delete` is a mutation-class soft delete filtered on `is_demo`.** It behaves like `org delete` (no job check, no cascade) but is allowed on prod with `--yes --confirm-prod`. `org delete` doesn't change.

## Amendment — code review (supersedes the matching Surface items)

The branch's code review found four real defects in this contract; the fixes change it as follows:

1. **`demo delete` and the failed-load cleanup run the full organization deletion** (`OrganizationDeleteService`, #197) instead of a soft delete of the org row:
   - **Why the soft delete was wrong:**
     - It left the owner's membership live. The current-org pick doesn't skip deleted orgs, so the owner was left with no current org.
     - Record retention never reclaims a deleted org's data: its purge only covers deleted *entities*.
   - **The new path:** `ApplicationService.deleteDemoOrganization(orgId, actor)` refuses with `DEMO_ORGANIZATION_NOT_FOUND` (404) or `DEMO_ORGANIZATION_NOT_DEMO` (409). It runs through the new `db:demo:delete --org --actor` script, and `discardDemoOrganization` uses the same deletion.
   - **CLI:** `portalai demo delete` checks the marker in-process (`store.isDemoOrg`; exit 8 / 9), then spawns the script as the operator.
   - **Hard deletion of the content is now in scope**; #1035's issue body is amended to match.
2. **The owner's membership in a demo org gets `last_login = 0`**, so `demo create` never takes over the owner's current org. The owner switches to it deliberately.
3. **`is_demo` is not mirrored in admin-cli's `tables.ts`.** Every org read selects the mirrored columns, so mirroring it broke `org list/get` against an env not yet migrated (prod lags `main`). Only `isDemoOrg` reads it.
4. **The name and `--rows` rules live once in core** (`DemoOrganizationCreateInputSchema`, `DEMO_MAX_ROWS`, `organizationNameField`), used by the CLI and the script. The script now also refuses a line break in the name.

5. **The seed attaches one unrestricted curated view per entity to the demo station** (`seedStationViews`; `DemoSeedResult.views`, and `views` in `db:demo:create`'s JSON). Found by the smoke walk: since #674 a station queries data only through attached views, so a demo without them couldn't answer its presenter script.
6. **Adversarial fixes:**
   - **Flag parsing.** Both scripts parse their flags strictly as `--flag value` pairs (`db/script-args.util.ts`), so a value equal to a flag name (`--name --tier`) is just a value. Unknown flags, missing values and stray arguments are usage errors.
   - **Deleted org mid-load.** The seed's row stream checks every 5,000 rows or 2 s that its org is still live (`stopWhenOrgDeleted`). A `demo delete` racing a `demo create` therefore stops the load with `demo org <id> was deleted during the load`, instead of the load running on until it ran out of memory.

Also corrected: the create script's stderr id line isn't seen on a killed run, because `runApiScript` buffers stderr. The runbook finds a leftover org with `org list --search` instead.

## Scope

### In scope
- The marker column, model field, type checks, admin-cli mirror and migration 0137.
- The `db:demo:create` script and its `ApplicationService` seam.
- The `DemoSeedService` signature change, plus making toolpack registration fatal.
- `runApiScript` `extraEnv`, `isAwsNotFound`.
- `portalai demo create`, `portalai demo delete` and `store.softDeleteDemoOrg`.
- Removing `demo seed`, `demo reset`, `db:demo:seed`, `db:demo:reset`, `DemoSeedService.reset` and their tests.
- Updating the docs.

### Out of scope
Everything the issue rules out: a UI, hard deletion, changes to the dataset, QA orgs. Also out of scope: running the create from inside the env, unscoping the `demo` tier on app-dev or prod, and any automatic sweep of old demo orgs.

## Surface

### `packages/core/src/models/organization.model.ts`
`OrganizationSchema` gains the following field, after `entitlementThrough`:

```ts
/** Created by `portalai demo create` (#1035). Internal: never shown in the app;
 *  `portalai demo delete` refuses an org without it. */
isDemo: z.boolean().default(false),
```

### `apps/api/src/db/schema/organizations.table.ts`
Add `isDemo: boolean("is_demo").notNull().default(false)`. The two-way checks in `type-checks.ts:169-180` keep compiling, and `zod.ts` needs no edit. `packages/admin-cli/src/tables.ts` `organizations` gains the same column, held by `tables-parity.test.ts`.

### `ApplicationService.createDemoOrganization` (new, `application.service.ts`)

```ts
/** `db:demo:create` seam (#1035): one transaction — org + owner + workspace
 *  (provisionOrganizationInTx) → is_demo → tier → the "Demo" station. */
static async createDemoOrganization(opts: {
  ownerEmail: string; name: string; tier: string;
}): Promise<{ organizationId: string; stationId: string }>
```

- **Owner.** It looks up the owner with `users.findByEmail`. If there is none, it throws `Error("User <email> not found — users originate in Auth0")`, the same text as `createOrganizationForEmail`, before opening the transaction.
- **Inside `DbService.transaction`:**
  1. `provisionOrganizationInTx(user.id, tx, { name })`
  2. `organizations.update(id, { isDemo: true }, tx)`
  3. `assignOrgTier(id, tier, tx)`, which throws on an unknown slug and rolls everything back
  4. `stations.create(new StationModelFactory().create(systemId).update({ organizationId, name: DEMO_STATION_NAME, description: DEMO_STATION_DESCRIPTION }).parse(), tx)`
- **Constants.** `DEMO_STATION_NAME = "Demo"` and its description are exported from `apps/api/src/demo/dataset-manifest.ts`.
- **Default station.** `defaultStationId` is left as provisioning set it (Administrate).

### `DemoSeedService` (`apps/api/src/services/demo-seed.service.ts`)
- **`seed(params: { orgId: string; stationId: string; rows: number })`.** `rows` is now required, because the script owns the default, and `DEFAULT_TRANSACTION_ROWS` is deleted. The `DemoSeedResult` shape is unchanged apart from a new `stationId` field.
- **`ensureStationLinks(stationId, connectorInstanceIds)` and `seedToolpacks(orgId, stationId)`** take the id. Both `findByOrganizationId` reads and their "has no station" throws are removed.
- **Toolpack registration becomes fatal.** In `seedToolpacks`:
  - With `DEMO_TOOLPACK_URL` set, a `registerCustomToolpack` failure **rethrows** as `Error("demo toolpack registration failed: <message>")`. The keep-existing fallback (`:364-378`) goes, because a fresh org has nothing to keep.
  - With it unset (local only, since the CLI enforces it elsewhere), the seed logs `info` and enables built-ins only.
- **`reset`, `DemoResetResult` and the reset helpers (`:255-337`) are deleted.**

### `apps/api/src/db/demo-create.ts` (new; npm script `db:demo:create`)
Usage: `tsx src/db/demo-create.ts --name <name> --owner-email <email> --tier <slug> --rows <n>`. All four arguments are required, because the CLI fills in the defaults.

1. **Validate.** The name goes through the same `NAME_MAX_LENGTH` check as `create-org.ts`. `--rows` must be an integer between 0 and 10,000,000 (`/^\d+$/`). A failure is a usage error, exit 1.
2. **Create.** Call `createDemoOrganization`. A throw exits 1 with nothing committed.
3. **Print the id.** Print `demo org <organizationId> created; loading dataset` to **stderr**, so a killed process still leaves the id with the operator.
4. **Load.** Call `DemoSeedService.seed({ orgId, stationId, rows })`.
5. **Clean up on failure.** If step 4 throws, call `organizations.softDelete(orgId, SystemUtilities.id.system)` and print `demo create failed; org <id> soft-deleted: <message>` to stderr, then exit 1. If the soft delete itself throws, print `demo create failed and cleanup failed; run: portalai demo delete <id>`, then exit 1.
6. **Report.** On success, print one JSON line: `{ organizationId, stationId, tier, rows, entities: <count>, toolpacks: { builtins, custom }, durationMs }`.

`apps/api/package.json`: add `db:demo:create`, and remove `db:demo:seed` and `db:demo:reset` along with `src/db/demo-seed.ts` and `src/db/demo-reset.ts`.

### `packages/cli-env/src/spawn.ts`
`runApiScript(def, script, scriptArgs, spawner = npmSpawner, extraEnv: Record<string, string> = {})`. `extraEnv` is merged **under** `injected`, so `DATABASE_URL`, `ENCRYPTION_KEY` and `SYSTEM_ID` always win. Existing callers don't change.

### `packages/cli-env/src/aws.ts`
Add the following and export it from the package index:

```ts
export function isAwsNotFound(err: unknown): boolean
```

It is true when `err`, or its `cause`, is named `ParameterNotFound` or `ResourceNotFoundException`. `getSecret` and `getParam` keep throwing `EnvInfraError` with the AWS error as `cause`.

### `packages/admin-cli/src/commands/demo.ts`
`demoSeed` and `demoReset` are deleted. The file now exports:

```ts
export const DEMO_DEFAULT_TIER = "enterprise";
export const DEMO_DEFAULT_ROWS = 10_000;

export async function demoCreate(
  def: EnvironmentDefinition,
  opts: { name: string; ownerEmail: string; tier?: string; rows?: number },
  flags: MutateFlags,
  spawner?: WorkspaceSpawner,
  readConfig?: DemoConfigReader   // test seam; default reads SSM + Secrets Manager
): Promise<Record<string, unknown>>
```

The steps run in order:
1. **Validate the name.** Trim it; it must be 1–120 characters on one line, the same rule as `org update` (#936). Otherwise throw `AdminInvalidInputError` (exit 2).
2. **Validate `--rows`.** It must be an integer between 0 and 10,000,000. Otherwise exit 2. `bin.ts` passes the raw string, and `demoCreate` parses it.
3. **Guard.** `beginMutation(def, flags, false)`: app-dev needs `--yes` (exit 5), and prod needs `--yes --confirm-prod`.
4. **Check owner and tier in-process.** `withStore`: `getUserByEmail(ownerEmail)` (exit 8), then `getTier(tier)` (new; exit 8 `Tier "<slug>" not found`).
5. **Read toolpack config (AWS envs only).** `DEMO_TOOLPACK_URL = getParam(def, "demo-toolpack-url")` and `DEMO_TOOLPACK_SIGNING_SECRETS = getSecret(def, "demo-toolpack-signing-secrets")`. If `isAwsNotFound`, throw `EnvNotConfiguredError` (exit 3) with the message `demo toolpack <name> is not set for <env> — portalops vars set …`. Local envs pass nothing, so the script reads the shell or `.env`.
6. **Spawn.** `runApiScript(def, "db:demo:create", [--name, --owner-email, --tier, --rows], spawner, extraEnv)`, then `lastJsonLine`.
7. **Audit.** `audit(def, operator, "demo create", { organizationId, name, ownerEmail, tier, rows })`.
8. **Remind.** On success, print to stderr even under `--json`: `Seeded <rows> transactions; pass --rows <n> for a larger dataset. When the demo is over: portalai demo delete <organizationId> --env <env> --yes`.

```ts
export async function demoDelete(
  def: EnvironmentDefinition, id: string, flags: MutateFlags
): Promise<{ id: string; deleted: true }>
```

It calls `beginMutation(def, flags, false)`, then `withStore((s) => s.softDeleteDemoOrg(id, operator))`, then `audit(def, operator, "demo delete", { orgId: id })`.

### `packages/admin-cli/src/store.ts`
- **`getTier(slug): Promise<{ slug: string }>`.** Returns the live tier, or throws `AdminNotFoundError`. `setTier` reuses it.
- **`softDeleteDemoOrg(id, actor): Promise<void>`.** Runs `UPDATE … SET deleted, deleted_by WHERE id = $1 AND is_demo AND deleted IS NULL RETURNING id`. If no row comes back, it reads the org:
  - absent or soft-deleted → `AdminNotFoundError` (exit 8)
  - live but not a demo org → `AdminConflictError("Organization <id> is not a demo org — demo delete only removes orgs made by demo create")` (exit 9)

### `packages/admin-cli/src/bin.ts`
The `demo` group (`:307-346`) becomes:
- `demo create`, with `--name <name>` (required), `--owner-email <email>` (required), `--tier <slug>` (`enterprise`) and `--rows <n>` (`10000`)
- `demo delete <id>`

Both carry the `common()` flags.

## Migration

`npm run db:generate -- --name organization-is-demo` creates `0137_organization-is-demo.sql`: `ALTER TABLE "organizations" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;`. Commit it with `meta/_journal.json` and `0137_snapshot.json`. The change is additive with no destructive DDL, so `lint:migrations` passes without a marker. There's no backfill, and no migration test is needed.

## Seed

No change to seeding. `SYSTEM_COLUMN_DEFINITIONS` and the global seeds are untouched.

## TDD test plan

Run per package with `npm run test:unit` / `npm run test:integration`, plus `npm run type-check` and `npm run lint`.

### apps/api — integration (`src/__tests__/__integration__/`)
- **`services/demo-create.integration.test.ts` (new):**
  - creates an org with `isDemo`, the given tier, its owner, Administrate + Playground matching a normal provisioned org, and a third "Demo" station; `defaultStationId` is Administrate
  - unknown owner → throws, no org row
  - unknown tier → throws, and the transaction rolled back (no org or station)
  - two calls with the same name → two orgs
- **`demo-seed.counts.integration.test.ts`:** call `seed` with an explicit `stationId` and `rows`. Every demo instance links to *that* station and none to Administrate or Playground. Entity counts match `EXPECTED`, and `transactions` count equals `rows`.
- **`demo-seed.toolpacks.integration.test.ts`:**
  - packs land on the passed station only
  - an unreachable `DEMO_TOOLPACK_URL` now **rejects**
  - unset → built-ins only
- **`scripts/demo-create.script.integration.test.ts` (new):** run `demo-create.ts`'s `main` with a failing seed, mocked through `DemoSeedService.seed`. The org is soft-deleted, the stderr names it, and the exit code is 1.
- **Removed:** `demo-seed.reset.integration.test.ts` and its `durations.json` entry. The new files get entries from a local run.

### apps/api — unit
- `system-principal.guard.test.ts` still passes. `createDemoOrganization` uses `SystemUtilities.id.system` only inside `application.service.ts`, which is already allowed. Re-check its list.

### packages/core
`organization.model` test: `isDemo` defaults to `false`.

### packages/cli-env (`src/__tests__/`)
- `spawn.test.ts`: `extraEnv` reaches the spawner, and injected keys override a colliding `extraEnv` key.
- `aws.test.ts`: `isAwsNotFound` is true for both names, both directly and through `cause`, and false otherwise.

### packages/admin-cli (`src/__tests__/`)
- **`commands.test.ts`, replacing `:410-460`:**
  - **`demo create`:**
    - spawns `db:demo:create` with defaults `enterprise`/`10000`, or the given flags
    - app-dev without `--yes` → exit 5 and no spawn
    - prod without `--confirm-prod` → exit 5
    - unknown owner → exit 8 and no spawn
    - unknown tier → exit 8 and no spawn
    - name or rows invalid → exit 2 and no spawn
    - AWS env with a missing param or secret → exit 3 and no spawn
    - `extraEnv` carries both values
    - audit line written
    - reminder on stderr
  - **`demo delete`:**
    - prod with `--yes --confirm-prod` succeeds
    - prod without them → exit 5
- **`bin.test.ts`:** `buildProgram` has no `demo seed` / `demo reset` subcommands, and `demo create` has its defaults.
- **`store.test.ts` (PGlite):**
  - `softDeleteDemoOrg` deletes a demo org
  - refuses a non-demo org with exit 9, leaving the row unchanged
  - missing or deleted org → exit 8
  - `getTier` returns a live tier, and an unknown or deleted one → exit 8
- **`tables-parity.test.ts`:** passes with the new column.

**Totals ≈ 38 cases** (about 12 api, 1 core, 5 cli-env, 20 admin-cli).

## Acceptance criteria

- [ ] `portalai demo create --name "Acme demo" --owner-email <existing>` creates a new org. The owner is that user, `is_demo = true`, the tier is `enterprise`, and the demo dataset, connectors and every pack are on a station named "Demo". Administrate and Playground match a normal new org's, and the default station is Administrate.
- [ ] Running it again with the same name creates a second, independent org.
- [ ] With no `--rows`, `transactions` holds 10,000 rows and the reminder is printed. `--rows 1000000` seeds 1,000,000.
- [ ] An unknown owner email or tier exits 8 and no org is created.
- [ ] A dataset load that fails (for example an unreachable toolpack URL) leaves the created org soft-deleted and exits non-zero.
- [ ] On app-dev or prod, a missing `DEMO_TOOLPACK_URL` or `DEMO_TOOLPACK_SIGNING_SECRETS` exits 3 before any org is created.
- [ ] On prod, `demo create` and `demo delete` exit 5 without `--yes --confirm-prod` and run with both.
- [ ] `demo delete` on a non-demo org exits 9 and the org is unchanged. On a demo org it soft-deletes it.
- [ ] `portalai demo seed` and `portalai demo reset` are unknown commands, and `db:demo:seed` / `db:demo:reset` are gone from `apps/api/package.json`.
- [ ] After release, the pre-existing demo orgs on prod and app-dev are soft-deleted (Release notes).

## Release notes (operator step, in the PR body)

For each pre-existing demo org (ids recorded on #1035), on its env:
1. Run `portalops db psql --env <env>`, then `UPDATE organizations SET is_demo = true WHERE id = '<id>' AND deleted IS NULL;`.
2. Run `portalai demo delete <id> --env <env> --yes [--confirm-prod]`.

The `demo` tier on app-dev and prod was created with `--visible-to-org <old demo org>`. Since assignment ignores visibility, it stays usable through `--tier demo`.

## Risks & rollback

- **A partial org after a kill.** If the process is killed during the load, no cleanup runs. The org is marked and its id is on stderr, so the operator removes it with `demo delete`. This is documented in the runbook.
- **Toolpack strictness.** Making registration fatal means a misconfigured Lambda blocks every demo create. That is intended: it fails closed, and the cost is a re-run once the config is fixed, with no stranded org thanks to cleanup.
- **The marker leaking into the app.** `isDemo` rides along in organization payloads. Nothing in the web app reads it, and it isn't sensitive.
- **Rollback.** Revert the PR. The column is additive and harmless to keep. Pre-existing demo orgs deleted by the release step can be revived with `UPDATE … SET deleted = NULL`, since the delete is soft.

## Files touched

- **New:**
  - `apps/api/src/db/demo-create.ts`
  - `apps/api/drizzle/0137_organization-is-demo.sql` and its snapshot
  - `apps/api/src/__tests__/__integration__/services/demo-create.integration.test.ts`
  - `…/scripts/demo-create.script.integration.test.ts`
- **Edit:**
  - `packages/core/src/models/organization.model.ts`
  - `apps/api/src/db/schema/organizations.table.ts`
  - `apps/api/drizzle/meta/_journal.json`
  - `apps/api/src/services/application.service.ts`
  - `apps/api/src/services/demo-seed.service.ts`
  - `apps/api/src/demo/dataset-manifest.ts`
  - `apps/api/package.json`
  - `demo-seed.{counts,toolpacks}.integration.test.ts`
  - `utils/demo-seed.util.ts`
  - `durations.json`
  - `packages/cli-env/src/{spawn,aws,index}.ts` and its tests
  - `packages/admin-cli/src/{commands/demo,store,tables,bin}.ts` and its tests
  - `packages/devops-cli/src/catalog.ts` (comments)
- **Delete:**
  - `apps/api/src/db/demo-seed.ts`
  - `apps/api/src/db/demo-reset.ts`
  - `demo-seed.reset.integration.test.ts`
- **Docs:**
  - `packages/admin-cli/COMMANDS.md`
  - `docs/CLI_OPERATIONS_CHARTER.md` (rows `:150-151` and the counts at `:214`)
  - `docs/DEMO_ORG.runbook.md`
  - `docs/PROD_PROVISIONING.runbook.md:238`
  - `packages/devops-cli/COMMANDS.md` (the `demo` tier paragraph)

## Next step

`docs/DEMO_ORG_PER_DEMO.plan.md` sequences this as about six TDD slices on this branch:
1. The marker (core, table, migration, mirror).
2. `seed({stationId, rows})` with fatal registration, and removing `reset`.
3. `createDemoOrganization` and the `db:demo:create` script with cleanup.
4. `cli-env` `extraEnv` and `isAwsNotFound`.
5. `demo create` / `demo delete` and the store methods, removing `demo seed` / `demo reset`.
6. Docs and release notes.
