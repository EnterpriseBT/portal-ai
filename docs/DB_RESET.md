# DB reset — org-scoped FK fix + working hard reset — Condensed design (#295)

**Issue:** [EnterpriseBT/portal-ai#295](https://github.com/EnterpriseBT/portal-ai/issues/295) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Two reset paths, both broken. (1) The **org-scoped** reset — `ResetService.resetOrganization`, exposed as `portalai org reset` — aborts on a foreign-key violation for any org that has been used: it deletes 17 tables child → parent but never the three that hold FKs into them (`wide_table_columns`, `api_endpoint_configs`, `connector_instance_layout_plans`), and never drops the `er__*` wide tables it orphans. (2) The **whole-DB hard reset** — `portalops db reset-seed` — works only against app-dev: its reset half is fine everywhere, but the seed half is ECS-only and throws for `--env local`, *after* the destructive half has already run. So a hard reset leaves the DB truncated with no `tiers` row and no connector definitions, and every subsequent org insert dies on the tier FK. Packages: `apps/api`, `packages/devops-cli`, `packages/cli-env`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Org-scoped reset (defect 1) | `apps/api/src/services/reset.service.ts:41` | 17 deletes in one transaction; keeps the org row + owner membership. Not destructive — each FK failure rolls back |
| …its CLI surface | `packages/admin-cli/src/commands/provision.ts:105` (`orgReset`) | Spawns `npm run db:reset <orgId>` with `DATABASE_URL` injected from the env connection |
| The correct order already written | `apps/api/src/services/organization-delete.service.ts:156`–`:223` | #197 does the `er__` drops (`wideTableReconcilerService.dropTable(id, tx)`), `wideTableColumns`, `connectorInstanceLayoutPlans` (instance-id subquery), `apiEndpointConfigs`. Reset is the same order minus these |
| Hard reset — wipe half | `packages/devops-cli/src/reset.ts:79` (`runReset`) | DROP each `er__*` (one at a time — batching trips `max_locks_per_transaction`), then one `TRUNCATE … CASCADE`; `__drizzle_migrations` excluded, so schema + migration journal survive. **Semantics are already right for both envs** |
| Hard reset — seed half (defect 2) | `packages/devops-cli/src/ecs.ts:32` (`runSeedTask`) | Throws `EnvNotConfiguredError` when `def.aws` is null: *"seed local with `npm run db:seed`"*. `dbResetSeed` (`commands/db.ts:143`) resets first, then hits it |
| What seed restores | `apps/api/src/services/seed.service.ts:298` | `seedTiers` (the `standard` row `organizations.tier` FKs to) + `seedConnectorDefinitions` |
| The local-spawn pattern to reuse | `packages/admin-cli/src/commands/provision.ts:26`–`:66` | `npmSpawner` + `runApiScript` — run the app's own script with `DATABASE_URL` from `resolveEnvConnection`. `dotenv -e .env` does not override an already-set `DATABASE_URL`, so injection wins |

## Decision 1 — patch the org reset in place; do not extract a shared cascade

Reset and `OrganizationDeleteService.cascade` will now hold the same delete order in two files. Extracting it would couple a dev/QA data reset to the customer-facing org-delete cascade (billing tombstones, S3, Stripe) — the wrong dependency for the cheaper of the two. **Copy the four statements into `ResetService`, with a comment on each side naming the other.** The new integration test is what keeps them honest.

## Decision 2 — make the hard reset env-symmetric by fixing the seed half, not by adding a script

`portalops db reset` is already a total truncate + `er__` drop for every env; the only asymmetry is seeding. So `runSeed(def)` **dispatches on `def.aws`**: present → the existing ECS one-off (`db:seed:ci` in the container); absent → spawn `npm run --workspace @portalai/api db:seed` with `DATABASE_URL` from the env connection — the same pattern `portalai` already uses for `org create` / `org reset`. One command, `portalops db reset-seed --env local|app-dev`, means the same thing in both places: truncate everything, re-seed system data. No new `apps/api` script; `portalops` stays the infra surface per the CLI domain split.

The spawner moves to `@portalai/cli-env` (new `spawn.ts`, exporting `npmSpawner` + `runApiScript`) so `admin-cli` and `devops-cli` share one copy rather than growing a second.

No migration step is needed: TRUNCATE preserves the schema and `__drizzle_migrations`.

## Plan — 3 slices

**Slice 1 — org-reset FK fix (`apps/api`).**
**Files:** `apps/api/src/services/reset.service.ts` — select the org's live `connectorEntities` ids, `dropTable(id, tx)` per entity + delete `wideTableColumns` by org (before `fieldMappings`); delete `apiEndpointConfigs` by org (before `connectorEntities`); delete `connectorInstanceLayoutPlans` by org-instance-id subquery (before `connectorInstances`).
**Tests:** new `apps/api/src/__tests__/__integration__/services/reset.service.integration.test.ts` — seed an org carrying an instance, entity, field mappings, a reconciled `er__` table, an endpoint config and a layout plan (the shape `seedPopulatedOrg` at `organization-delete.service.integration.test.ts:81` already builds — lift it to `__integration__/utils/seed-populated-org.util.ts` and import from both), run `resetOrganization`, assert: it resolves; those three tables are empty for the org; `er__<entityId>` is gone from `pg_tables`; the org row, owner membership and a control org survive; the non-owner membership is gone. `npm run test:integration` from `apps/api/`.

**Slice 2 — share the spawner (`packages/cli-env`, `packages/admin-cli`).**
**Files:** new `packages/cli-env/src/spawn.ts` (`npmSpawner`, `runApiScript`, `WorkspaceSpawner`, `SpawnResult`), exported from `src/index.ts`; `packages/admin-cli/src/commands/provision.ts` deletes its copies and imports them. Pure move — behavior identical.
**Tests:** existing `packages/admin-cli/src/__tests__/commands.test.ts:180`–`:245` must pass unchanged (it injects a fake spawner and asserts the args + `DATABASE_URL`) — that is the guard. Add `packages/cli-env/src/__tests__/spawn.test.ts` covering the injected-spawner contract: args shape (`run --workspace @portalai/api <script> -- …`), `DATABASE_URL` injection, non-zero exit → `EnvInfraError`.

**Slice 3 — local seed in `portalops` (`packages/devops-cli`).**
**Files:** `packages/devops-cli/src/ecs.ts` — keep `runSeedTask` as the AWS path; `packages/devops-cli/src/commands/db.ts` — `dbSeed` dispatches: `def.aws` → `runSeedTask`, else → `runApiScript(def, "db:seed", [])`; its audit line records which path ran. `dbResetSeed` unchanged (it composes the two).
**Tests:** `packages/devops-cli/src/__tests__/` — `dbSeed` on a local def calls the spawner and never the ECS client; on an app-dev def calls the ECS path; `dbResetSeed --env app-dev` without `--yes` throws the confirmation error **before** any wipe. `npm run test:unit`.

## Smoke (manual, against your dev stack)

Rebuild first — `npx portalops` runs `dist/`, not `src/`: `npm run build --workspace @portalai/devops-cli`.

1. **Local hard reset.** `export $(grep '^DATABASE_URL' apps/api/.env | xargs)` (the CLI reads the shell, not `.env`), then `npx portalops db reset-seed --env local`. Expect exit 0 and JSON on stdout naming dropped + truncated counts and the seed result.
2. `psql "$DATABASE_URL" -c "\dt er__*"` → none. `select count(*) from entity_records;` → 0. `select slug from tiers;` → `standard`. `select count(*) from connector_definitions;` → non-zero.
3. `npx portalai org create --env local --owner-email bbgrabbag@gmail.com --name "Dev Org"`, log in at http://localhost:3000 — org is enterable, workspace empty.
4. Re-run step 1 on the now-fresh DB — completes cleanly (idempotent).
5. **App-dev hard reset.** `npx portalops db reset-seed --env app-dev` **without** `--yes` → exits 5 (confirmation required) and changes nothing. Then with `--yes` → exit 0; app-dev loads with an empty workspace and re-provisions your user on next login.
6. **Org reset (the FK bug).** Rebuild a local org's state (import records, configure a REST endpoint, commit a layout plan), then `npx portalai org reset --env local <orgId>` → completes with no `violates foreign key constraint`; `\dt er__*` shows the org's wide tables gone; the org still exists and you are still a member.
7. Run step 6 a second time against the now-empty org — clean, no leftovers.

## Out of scope

- **Making `--env local` read `apps/api/.env` itself.** `resolveEnvConnection` requires `DATABASE_URL` in the process env (`packages/cli-env/src/connection.ts:72`) for every local command; changing that is a cli-env-wide behavior change, not this bug. Smoke step 1 carries the one-liner.
- **Dropping/re-running migrations.** Truncate keeps the schema and `__drizzle_migrations`; a schema rebuild stays `db:push` or a fresh container.
- **Restarting the app-dev service after a wipe.** The boot drift check recreates wide tables for live entities; after a truncate there are none, so stale statement-cache entries are inert.
- **S3 objects and Stripe state.** A DB truncate leaves both untouched.
- **Retiring `npm run db:reset`.** It stays as the app-owned script `portalai org reset` spawns.
