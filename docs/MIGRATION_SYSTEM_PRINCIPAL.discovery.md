# Literal system principal in data migrations and CLI scripts — Discovery

**Issue:** [EnterpriseBT/portal-ai#952](https://github.com/EnterpriseBT/portal-ai/issues/952) · Bug · full

**Why this exists.** The system principal is `SystemUtilities.id.system`: the environment's `SYSTEM_ID`, written as `createdBy` on platform-owned rows (#641). Prod's value is a UUID by design (`docs/PROD_PROVISIONING.runbook.md` step 7, write-once); everywhere else it's the literal `SYSTEM`. Two writers ignore the environment's value:

- **Data migrations.** They hard-code it: `'SYSTEM'` in 0065, 0066 and 0080, and `'system'` in 0102, 0104, 0106, 0110, 0111, 0116 and 0129.
- **CLI scripts spawned against a deployed env.** `portalai demo seed` and the other `runApiScript` scripts receive that env's `DATABASE_URL` and `ENCRYPTION_KEY`, but take `SYSTEM_ID` from the operator's local `.env`.

The read-only audit on 2026-11-03 (comment on #952) found:
- **app-dev is consistent where it matters** (its id *is* `SYSTEM`). Only the RBAC backfill rows differ, as `'system'`.
- **Prod's Demo org is labeled `'SYSTEM'` throughout:** the org, its membership, 29 column definitions, 4 connectors, 11 entities, 11 views, its station and **253,595 records**. Prod's `standard` tier is also `'SYSTEM'`.
- **No one is locked out today**, because the Demo org's only member is its owner. A member added there would read nothing, since `created_by_system` matches only `createdBy === SystemUtilities.id.system`.

This is the change that makes every platform write carry the environment's own system principal, and repairs the rows that don't.

## The current shape

### Where the principal is read

| Consumer | Location | Reads |
|---|---|---|
| Statement matching | `apps/api/src/services/permission-set.ts:247-248` | `created_by_system` → `SystemUtilities.id.system` |
| List visibility predicate | `permission-set.ts:306-313` | `eq(createdByCol, SystemUtilities.id.system)` |
| Point check | `permission-set.ts:385-386` | `norm.createdBy === SystemUtilities.id.system` |
| Column-definition list | `apps/api/src/routes/column-definition.router.ts:177-185` | via `visibilityPredicate` |
| Contract | `packages/core/src/models/permission.model.ts:139` | `created_by_system ⇒ === SystemUtilities.id.system` |

`created_by_system` grants exist on the six `DATA_RESOURCE_TYPES` (station, pin, curated_view, portal, entity, connector_instance) and on `column_definition` (seed `MemberAccess`; backfilled by 0129).

Records and field mappings are parts of their entity and carry no permission of their own (#829), so their `created_by` is provenance only. RBAC rows signal system-ness through `roles.kind` / `permission_policies.kind` (`db/schema/roles.table.ts:36`, `permission-policies.table.ts:32`; read at `role.service.ts:56`, `policy.service.ts:103`, `seat.service.ts:224,654`). Nothing reads their `created_by`.

### How migrations run

| Path | Runner | Has `SYSTEM_ID`? |
|---|---|---|
| ECS deploy (app-dev, prod) | `node dist/scripts/db-migrate.js` override of the API task def (`deploy-dev.yml:579`, `deploy-prod.yml:593`) | yes: SSM `/portalai/<env>/system-id` (`infra/cloudformation/backend.yml:689-690`) |
| `portalops db upgrade` / `db seed` (deployed) | ECS one-off on the same task def (`packages/devops-cli/src/commands/db.ts:248,313`) | yes |
| Helm | `migrate-job.yaml:70` / `upgrade-job.yaml:41` with the hook ConfigMap | yes, pinned to `"SYSTEM"` (`templates/_env.tpl:9-17`, which `fail`s on any other value *because the migrations write the literal*) |
| Local | `npm run db:migrate` = **drizzle-kit** migrate (`apps/api/package.json:28`), used by `portalops local provision` (`local.ts:153`) | in `.env`, but drizzle-kit opens its own connection |
| Integration tests | `__tests__/__integration__/setup.ts:97-100`: drizzle `migrate()` on its own client; `SYSTEM_ID ??= "SYSTEM_TEST"` (`:30`) | in env, not on the connection |

`runMigrations` (`apps/api/src/scripts/db-migrate.ts:160-180`) opens one client (`max: 1`). drizzle 0.45 applies **every pending migration in one transaction**.

`buildMigrationClientOptions` (`db-migrate.ts:48-62`) already passes a postgres-js startup parameter, `connection: { "portalai.sql_reader_role": … }`. Migration 0118 reads it with `nullif(current_setting('portalai.sql_reader_role', true), '')` (`0118_portal-sql-reader-role.sql:19,26`). That is the precedent for env values in SQL, and the only one besides 0096's `app.audit_retention_purge`.

### The CLI spawn path

`runApiScript` (`packages/cli-env/src/spawn.ts:59-93`) injects `DATABASE_URL`, and on AWS envs `ENCRYPTION_KEY` from Secrets Manager (`:76-78`). Its comment records the same class of bug, fixed for the key. Injected values win over the script's `dotenv -e .env`.

- An SSM reader already exists: `getParam(def, name)` (`packages/cli-env/src/aws.ts:126-148`). The catalog maps `SYSTEM_ID` to `system-id` (`packages/devops-cli/src/catalog.ts:105`).
- Callers: `demo.ts:40,59`, `provision.ts:50,72,87`, devops `db.ts:250,315`, `local.ts:153,175`, `jobs.ts:187`.
- Tests: `packages/cli-env/src/__tests__/spawn.test.ts:94,101`, which inject and don't inject `ENCRYPTION_KEY`.

### Migration guards

`npm run lint:migrations` (`scripts/check-migrations.mjs`, CI `unit-test.yml:123`) flags destructive DDL after index 95 unless `-- destructive-ok:` is present. It blanks string literals before matching (`:60`), and self-tests inline `FIXTURES` (`:100-126`). `seed-backfill-coverage.test.ts` is a jest-side precedent for reading `drizzle/*.sql`.

## The design space

### Decision 1 — How a data migration learns the environment's principal

- **A. A startup parameter `portalai.system_id`** on the migration connection, set by `buildMigrationClientOptions` from `environment.SYSTEM_ID` and read in SQL with `current_setting('portalai.system_id', true)`. This is the 0118 pattern.
- **B. No SQL access:** platform-owned data is written only by TypeScript steps (seed, a repair script) that read `SystemUtilities.id.system`.
- **C. A per-environment literal**, or a lookup of "whatever the tier's `created_by` is".

| | A | B | C |
|---|---|---|---|
| Precedent | 0118 | seed | none |
| Atomic with schema changes | yes (same txn) | no | yes |
| Runs on every path | only if every runner passes it | only where seed runs | yes |
| Correct in prod | yes | yes | no (a literal is the bug) |

**Lean: A**, and every runner passes the parameter. The two that don't today, drizzle-kit `db:migrate` and integration `setup.ts`, are changed: `db:migrate` runs `db-migrate.ts` (the prod runner, via tsx), and `setup.ts` passes the same `connection` options. A migration that needs the principal **raises** when the setting is empty, rather than no-op'ing. Otherwise a runner that forgot it would mark the repair applied without doing it, and it would never run again.

### Decision 2 — What the repair rewrites

- **A. Everything:** every table with `created_by`/`updated_by`/`deleted_by`, `IN ('SYSTEM','system')` → the principal, including `entity_records` and the `er__<id>` wide tables.
- **B. Rows that carry authorization plus small platform tables:** the six data types, `column_definitions`, `organizations`, `organization_users`, `tiers`, `connector_definitions`, and the RBAC tables. Not records and not wide tables.
- **C. Only the authorization-bearing rows** (data types + `column_definitions`).

| | A | B | C |
|---|---|---|---|
| Fixes member access in prod Demo | yes | yes | yes |
| Rows in prod | ~255K+ (records, plus their `er__` mirrors) | ~400 | ~60 |
| Runs inside the deploy txn | a long `entity_records` write lock during deploy | trivial | trivial |
| Leaves provenance inconsistent | no | records only | records, RBAC, tiers |

Records are provenance-only parts (#829). Rewriting 250K+ of them plus their `er__` mirrors inside the deploy's single migration transaction holds a write lock on `entity_records` for the whole org's import volume, for no access change.

**Lean: B.** It fixes every row that authorization reads, plus every small platform table, so they all match what provisioning writes. Records stay as provenance, recorded as a known exception: a re-seed or the batched follow-up below fixes them.

### Decision 3 — Which value counts as "wrong"

Today the literals are `'SYSTEM'` and `'system'`. In app-dev and local the principal *is* `SYSTEM`, so only `'system'` changes there. In prod both change. The SQL is `WHERE created_by IN ('SYSTEM','system') AND created_by <> :principal`. No user id can equal either literal, because user ids are UUIDs and `createdBy` on user objects is a user id.

**Lean: exactly those two literals, on the Decision 2 tables, `created_by` and `updated_by`.** The audit saw no `deleted_by`.

### Decision 4 — Stopping new literals

- **A. A lint rule in `check-migrations.mjs`:** a new migration (index > the repair's) that writes a `'SYSTEM'`/`'system'` string literal inside an `INSERT`/`UPDATE` fails. It needs its own literal-aware scan, since the destructive scan blanks strings.
- **B. A jest test** like `seed-backfill-coverage`.

**Lean: A.** That's where migration rules live, it runs in the same CI job, and it self-tests with fixtures.

### Decision 5 — The CLI spawn path

`runApiScript` injects `SYSTEM_ID = await getParam(def, "system-id")` on AWS envs, beside `ENCRYPTION_KEY`. Local keeps `.env`. Not injecting it is the bug, so there's no real alternative.

**Lean: do it**, with a `spawn.test.ts` case on each side, mirroring `:94`/`:101`.

## Tradeoff comparison

| | D1 A (startup param, raise if unset) | D2 B (auth + small tables) | D4 A (lint rule) | D5 (inject) |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| New pattern | the setting becomes standard | — | a second migration rule | — |
| Prod data touched | via D2 | ~400 rows | — | — |

## Recommendation

1. `buildMigrationClientOptions` passes `"portalai.system_id": environment.SYSTEM_ID`. The integration `setup.ts` migrate client passes the same, and `npm run db:migrate` runs `db-migrate.ts`, so every runner carries it.
2. A new forward migration reads `current_setting('portalai.system_id', true)`. It raises when the setting is empty, then rewrites `created_by`/`updated_by` from `'SYSTEM'`/`'system'` to it on:
   - the six data types, `column_definitions`, `organizations`, `organization_users`, `tiers`, `connector_definitions`;
   - `roles`, `permission_policies`, `policy_attachments`, `permission_statements`, `user_role`.
   - the Demo org's other small per-org tables (`field_mappings`, `station_views`, `station_toolpacks`, `organization_toolpacks`, …). The spec fixes the exact list from the prod audit; large append-only tables (`audit_log`, `tool_usage_ledger`, `jobs`) stay out.
   It's idempotent, and a no-op where the principal already matches.
3. `entity_records` and the `er__` wide tables are not rewritten. Their `created_by` is provenance only (#829), and the volume (253,595 prod rows) doesn't belong in the deploy transaction.
4. `check-migrations.mjs` fails a migration after the repair that writes a `'SYSTEM'`/`'system'` literal. It has fixtures and a self-test.
5. `runApiScript` injects the target env's `SYSTEM_ID` from SSM on AWS envs.
6. `docs/PROD_PROVISIONING.runbook.md` and `packages/admin-cli/COMMANDS.md` say spawned scripts now get the target env's principal.

## Open questions

1. **Lift the Helm chart's `SYSTEM_ID: "SYSTEM"` pin?** Once migrations read the setting, a residency install could use a UUID like prod. **Decided: not here.** Filed as #953, which depends on this ticket: a chart change (generate or accept a UUID, keep it stable across upgrades, refuse a change).
2. **Records in prod's Demo org.** They keep `'SYSTEM'`. **Lean: accept.** Records carry no permission. If a consistent record is ever wanted, `portalai demo reset` + `demo seed` (now injecting the right id) rewrites the dataset, a documented operator path.
3. **Do existing tests assert a literal `created_by`** (e.g. the tier's `'SYSTEM'`)? With `SYSTEM_TEST` on the integration connection, the repair rewrites the 0065 tier to `SYSTEM_TEST` there. **Lean: grep in the spec.** A test that assumed the literal is asserting the bug.
4. **Should the repair cover the `MemberAccess` statements' `updated_by`?** **Lean: yes.** Same rule, both columns.

## Enterprise-scale considerations

- **Concurrency & correctness.** The repair runs inside the deploy's single migration transaction, which is atomic with the rest of the batch (drizzle) and serialized by the `db:upgrade` advisory lock (#581) on Helm. It's a set-based `UPDATE`, so there's no check-then-act.
- **Accuracy & auditability.** The rewrite changes provenance on existing rows. Lean: the migration's comment records the before/after rule. The #952 audit comment is the before-state record; the spec adds a post-deploy re-run of the same audit query.
- **Failure modes.** The repair fails closed: an empty setting raises, the batch rolls back, and the deploy's migrate step fails visibly, rather than silently marking the repair applied.
- **Scale & unbounded growth.** Bounded at ~400 prod rows by excluding records (Decision 2). The lint rule stops new literals, so the problem can't grow.
- **Multi-tenancy.** The update is per-row on literal values, so no org's data is read into another's. It touches every org's RBAC rows, all with the same rule.
- **Contract stability.** No API or model change. `portalai.system_id` becomes a migration-runner contract beside `portalai.sql_reader_role`.
- **Data lifecycle.** N/A because nothing here has a retention window.

## What this doesn't decide

- The Helm `SYSTEM_ID` pin (Open question 1): #953, after this lands.
- Rewriting records and `er__` rows (Open question 2): provenance-only and large; the re-seed path exists.
- The Swagger authorize URL's Auth0 assumption (#950's out of scope): unrelated.

## Next step

`docs/MIGRATION_SYSTEM_PRINCIPAL.spec.md` (contract: the setting, the repair's table list and rule, the lint rule, the spawn injection) and `.plan.md`, roughly four slices:
1. The runner carries `portalai.system_id`, covering `db-migrate.ts`, integration setup and `db:migrate`.
2. The repair migration with integration tests on literal-seeded rows.
3. The lint rule.
4. The spawn injection plus docs.

The prod repair then ships with the next prod release, followed by a re-run of the audit.
