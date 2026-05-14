# Entity Records Wide-Table Storage — Phase 1 — Plan

**TDD-sequenced implementation of the phase-1 cut: `wide_table_columns` metadata table, `WideTableReconcilerService`, statement cache, advisory-lock helper, route triggers, and boot drift check. No reads or writes against the new wide tables yet — that's phase 2 onward.**

Spec: `docs/ENTITY_RECORDS_WIDE_TABLE_PHASE_1.spec.md`. Proposal: `docs/ENTITY_RECORDS_WIDE_TABLE.proposal.md`. Audit: `docs/ENTITY_RECORDS_WIDE_TABLE.audit.md`.

The change is layered; six slices, each behind a green test suite. Slices are ordered so each red→green loop tightens around one concern at a time and the system stays compilable between slices.

Run tests with:

```bash
# from apps/api — never invoke jest directly (NODE_OPTIONS sets ESM)
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration

# whole-repo gates at slice boundaries
npm run lint
npm run type-check
```

Each slice follows the same loop:

1. Write failing tests for the slice's new behaviour.
2. Implement the smallest change that makes them pass.
3. Run focused tests; confirm green.
4. Run lint + type-check at slice boundary.
5. Move to the next slice.

The slices are sequenced so that:

- **Slice 1** lands the schema + migration + repository + error codes — pure DB plumbing, no service code, no behaviour change.
- **Slice 2** lands the advisory-lock util — leaf utility with zero coupling to the rest of phase 1; can be reviewed independently.
- **Slice 3** lands the statement cache — also leaf-shaped; tests seed `wide_table_columns` rows directly via slice-1's repo.
- **Slice 4** lands the reconciler service. Depends on slices 1-3. After this slice the reconciler exists end-to-end but is called from nothing (`reconcileAll` exists but `app.ts` does not invoke it; routes do not invoke `reconcileEntity`).
- **Slice 5** wires the reconciler into the route handlers (`POST /api/connector-entities`, `POST/PATCH/DELETE /api/field-mappings`).
- **Slice 6** wires the boot drift check into `app.ts`.

After every slice, the repo type-checks, the existing test suite is green, and no feature path has changed behaviour.

---

## Slice 1 — `wide_table_columns` schema + repository + error codes

The smallest diff. New table, new repo, three new error-code constants. Nothing calls the repo yet.

**Files**

- New: `apps/api/src/db/schema/wide-table-columns.table.ts`
- New: `apps/api/src/db/repositories/wide-table-columns.repository.ts`
- New: `apps/api/src/__tests__/__integration__/db/repositories/wide-table-columns.repository.integration.test.ts`
- New: `apps/api/src/__tests__/__integration__/db/migrations/wide_table_storage_phase_1.test.ts`
- New: Drizzle migration `<timestamp>_wide_table_storage_phase_1.sql` (generated, then reviewed)
- Edit: `apps/api/src/db/schema/index.ts` — re-export `wideTableColumns`.
- Edit: `apps/api/src/db/schema/zod.ts` — `createSelectSchema(wideTableColumns)` + insert schema.
- Edit: `apps/api/src/db/schema/type-checks.ts` — bidirectional `IsAssignable` block (no domain model in `@portalai/core`, so the assignability check just covers select/insert vs. each other and the table inference).
- Edit: `apps/api/src/db/repositories/index.ts` — register repo.
- Edit: `apps/api/src/services/db.service.ts` — bind `repository.wideTableColumns`.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — add `WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED`, `WIDE_TABLE_RECONCILE_FAILED`, `WIDE_TABLE_DRIFT_AT_BOOT`.

**Steps**

1. **Write the integration tests (cases 1–7).** Each test seeds an org + connector_instance + connector_entity + column_definition + field_mapping, then exercises the repo. Cases 1–5 cover repo behaviour; cases 6–7 cover the migration apply/rollback round-trip. Run; all fail (table does not exist).

2. **Author the table** per spec — `wide_table_columns` with `organizationId`, `connectorEntityId`, `fieldMappingId`, `columnDefinitionId`, `columnName`, `pgType`, `retiredAt`, plus `baseColumns`. Two partial unique indexes (`(connector_entity_id, column_name) WHERE deleted IS NULL`, `(connector_entity_id, field_mapping_id) WHERE deleted IS NULL`) and one secondary index on `connector_entity_id`.

3. **Generate the migration.** From `apps/api`: `npm run db:generate -- --name wide_table_storage_phase_1`. Review the generated SQL — must contain only the `CREATE TABLE wide_table_columns` and the three indexes. Nothing about `er__*` tables (those are runtime). Apply with `npm run db:migrate`.

4. **Author the repository.** Extends `Repository<typeof wideTableColumns, WideTableColumnSelect, WideTableColumnInsert>`. Phase-1 surface is the inherited base methods plus:

   - `findByConnectorEntityId(connectorEntityId, opts?, client?)` — lists live (non-soft-deleted, non-retired by default; pass `{ includeRetired: true }` for the reconciler's full diff).
   - `findRetiredByConnectorEntityId(connectorEntityId, client?)` — used by the maintenance job in phase 5; included now to keep the surface stable.
   - `markRetired(id, retiredAt, actor, client?)` — sets `retired_at` and bumps the row's `updated`.

5. **Wire the Zod / type-checks / repo registration / error codes.** Standard plumbing.

6. **Run focused tests.** `cd apps/api && npm run test:integration -- wide-table-columns`. All 7 cases green.

7. **Lint + type-check.** `npm run lint && npm run type-check` from repo root. Clean.

**Done when:** cases 1–7 pass; the migration round-trips cleanly; nothing else in the codebase references `wide_table_columns` yet.

**Risk:** none — pure additive schema. The migration is reversible (drop the table).

---

## Slice 2 — Advisory-lock helper

Standalone utility. Tests it against a real Postgres connection. Nothing in the rest of phase 1 imports it yet.

**Files**

- New: `apps/api/src/db/advisory-lock.util.ts`
- New: `apps/api/src/__tests__/__integration__/db/advisory-lock.integration.test.ts`

**Steps**

1. **Write the integration tests (cases 22–24).** Tests open two Drizzle clients against the integration-test database. Case 22 holds a lock for ~200 ms and asserts the second waiter's elapsed time exceeds the hold. Case 23 acquires locks on two different keys in parallel and asserts both finish in < 100 ms. Case 24 throws inside the callback and asserts a subsequent acquire on the same key returns immediately. Run; all fail.

2. **Author `entityLockKey(connectorEntityId)`.** SHA-256 the entity id; read the leading 8 bytes as a `bigint` via `Buffer.readBigInt64BE(0)`. Stable, signed, fits the Postgres advisory-lock key type.

3. **Author `withEntityLock(client, connectorEntityId, fn)`.** Wraps `client.transaction` such that the transaction first executes `SELECT pg_advisory_xact_lock($key::bigint)` and then runs `fn(tx)`. The lock auto-releases on COMMIT or ROLLBACK.

4. **Run focused tests.** `cd apps/api && npm run test:integration -- advisory-lock`. All 3 cases green.

5. **Lint + type-check.** Clean.

**Done when:** cases 22–24 pass; `withEntityLock` is exported but called from nowhere.

**Risk:** advisory-lock semantics on the test runner's Postgres differ from production. Mitigation: the integration test runner uses the same Postgres image as dev/staging, so semantics are identical.

---

## Slice 3 — Statement cache

Standalone module; tests seed `wide_table_columns` rows via slice-1's repo, then assert the generated SQL.

**Files**

- New: `apps/api/src/services/wide-table-statement.cache.ts`
- New: `apps/api/src/__tests__/services/wide-table-statement.cache.test.ts`

**Steps**

1. **Write the unit tests (cases 18–21).** Each test seeds a connector entity + N field-mappings + N matching `wide_table_columns` rows, instantiates a fresh `WideTableStatementCache`, and asserts SQL string contents. Cases:

   - **18 — lazy build + memoisation.** Two `get` calls, no `invalidate` between them, return the same object reference (`===`).
   - **19 — invalidate forces a rebuild.** Call `get`, then `invalidate`, then `get` — second result is a new reference; `schemaVersion` increments.
   - **20 — `selectAllSql` ordering.** Metadata columns first (`entity_record_id, organization_id, synced_at, is_valid`) then data columns sorted by `wide_table_columns.created` ascending.
   - **21 — `insertSql` shape.** Contains every live data column in both the column list and the `ON CONFLICT … DO UPDATE SET …` clause; retired columns are omitted from both.

   Run; all fail.

2. **Author the cache.**

   ```ts
   export class WideTableStatementCache {
     private entries = new Map<string, CachedStatements>();
     private versions = new Map<string, number>();

     constructor(private readonly columnsRepo = wideTableColumnsRepo) {}

     async get(connectorEntityId: string): Promise<CachedStatements> {
       const cached = this.entries.get(connectorEntityId);
       if (cached) return cached;
       const built = await this.build(connectorEntityId);
       this.entries.set(connectorEntityId, built);
       return built;
     }

     invalidate(connectorEntityId: string): void {
       this.entries.delete(connectorEntityId);
       this.versions.set(connectorEntityId, (this.versions.get(connectorEntityId) ?? 0) + 1);
     }

     clear(): void { this.entries.clear(); }

     private async build(connectorEntityId: string): Promise<CachedStatements> {
       const cols = await this.columnsRepo.findByConnectorEntityId(connectorEntityId);
       // generate selectAllSql, insertSql, columns, schemaVersion
     }
   }

   export const wideTableStatementCache = new WideTableStatementCache();
   ```

   The `selectAllSql` builds the column list as `entity_record_id, organization_id, synced_at, is_valid, ${liveDataCols.map(c => `"${c.columnName}"`).join(", ")}`. The `insertSql` is `INSERT INTO "${tableName}" (...) VALUES (...) ON CONFLICT (entity_record_id) DO UPDATE SET ${liveDataCols.map(c => `"${c.columnName}" = EXCLUDED."${c.columnName}"`).join(", ")}`.

   `tableName(entityId)` is a private helper; it'll move to `WideTableRepository` in slice 4 and be re-exported. For now, inline in the cache module.

3. **Run focused tests.** `cd apps/api && npm run test:unit -- wide-table-statement.cache`. All 4 cases green.

4. **Lint + type-check.** Clean.

**Done when:** cases 18–21 pass; the cache is exported but called from nowhere.

**Risk:** the `selectAllSql` ordering assertion could become flaky if `created` values collide (two `wide_table_columns` inserted in the same ms tick). Mitigation: tests insert columns serially with explicit `await` between each, guaranteeing distinct `created` timestamps. If flakiness emerges in CI, fall back to ordering by `(created, id)` for determinism.

---

## Slice 4 — Reconciler service + wide-table repository scaffold

The phase's centre of gravity. Combines slices 1-3 plus the new reconciler logic plus the slim `WideTableRepository` shell that the reconciler uses to read row data in tests.

**Files**

- New: `apps/api/src/services/wide-table-reconciler.service.ts`
- New: `apps/api/src/db/repositories/wide-table.repository.ts`
- New: `apps/api/src/__tests__/services/wide-table-reconciler.service.test.ts`
- Edit: `apps/api/src/db/repositories/index.ts` — register `wideTableRepo`.
- Edit: `apps/api/src/services/db.service.ts` — bind `repository.wideTable`.

**Steps**

1. **Write the reconciler tests first (cases 8–17).** Each test seeds a fixture connector_entity + field_mappings, calls a reconciler method, then asserts on `information_schema.columns` and `wide_table_columns` directly. Tests share a small helper `expectWideTableShape(entityId, expected)` that snapshots both sides. Cases:

   - **8 — `ensureTable` creates the four metadata columns.**
   - **9 — `ensureTable` is idempotent.**
   - **10 — `reconcileEntity` adds one column per new field-mapping.**
   - **11 — `reconcileEntity` is a no-op when desired matches actual.** Assert `wideTableStatementCache.invalidate` is *not* called (spy on it).
   - **12 — `reconcileEntity` retires soft-deleted mappings.** `retired_at` set; column still on disk; `selectAllSql` excludes it.
   - **13 — `reconcileEntity` refuses type changes** with `WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED`.
   - **14 — `reconcileEntity` resolves column-name collisions** by suffixing `_2`, `_3`, …
   - **15 — `reconcileAll` covers every live entity.**
   - **16 — `reconcileAll` skips soft-deleted entities.**
   - **17 — `dropTable` removes table + metadata.**

   Run; all fail (no service exists).

2. **Write the wide-table-repository scaffold first.** Two methods only:

   ```ts
   export class WideTableRepository {
     tableName(connectorEntityId: string): string {
       return `er__${connectorEntityId}`;
     }
     async selectAll(
       connectorEntityId: string,
       ids?: string[],
       client: DbClient = db
     ): Promise<Record<string, unknown>[]> {
       // dynamic SQL using wideTableStatementCache.selectAllSql
     }
   }
   export const wideTableRepo = new WideTableRepository();
   ```

   No tests for the repo in phase 1 — it's a pass-through used by the reconciler tests. `selectAll` is exercised by reconciler test 12 ("retired column does not appear in selectAllSql") and by the smoke check in slice 6.

3. **Author the reconciler.** Public methods:

   - `ensureTable(connectorEntityId, client?)` — `CREATE TABLE IF NOT EXISTS "er__<id>" (entity_record_id text PRIMARY KEY REFERENCES entity_records(id) ON DELETE CASCADE, organization_id text NOT NULL, synced_at bigint NOT NULL, is_valid boolean NOT NULL); CREATE INDEX IF NOT EXISTS …`. Wrapped in `withEntityLock` so concurrent calls serialise.
   - `reconcileEntity(connectorEntityId, client?)` — wrapped in `withEntityLock(client, entityId, async (tx) => …)`. Calls `ensureTable`; computes `desired` (live `field_mappings` + their `column_definitions.type`); reads `actual` (live `wide_table_columns`); diffs; refuses on type changes; applies adds (one `ALTER TABLE … ADD COLUMN` + one `wide_table_columns` insert per add) and retires (`wide_table_columns.retired_at` set); finishes by calling `wideTableStatementCache.invalidate(entityId)` if any change was applied.
   - `reconcileAll()` — `connector_entities.findMany({ deleted: null })`, sequential `for` loop calling `reconcileEntity`. Returns `{ reconciled, skipped }`.
   - `dropTable(connectorEntityId, client?)` — `DROP TABLE IF EXISTS "er__<id>" CASCADE; DELETE FROM wide_table_columns WHERE connector_entity_id = $1;`. Used by tests only.

   Internal helpers:

   - `pgTypeForColumnDefinitionType(type)` — the type-mapping table from the spec, exported so other phases can re-use.
   - `sanitizeColumnName(normalizedKey, existing: Set<string>)` — `c_${lower(replace(normalizedKey, /[^a-z0-9_]/g, "_"))}`, then suffix `_2/_3/…` if the result collides with `existing`. Pure function; unit-tested as part of case 14.
   - `computeDiff(desired, actual)` — returns `{ adds, retires, typeChanges }`. Pure function over the two arrays.

3. **Run focused tests.** `cd apps/api && npm run test:integration -- wide-table-reconciler` (these live in `__tests__/services/` but use a real database, so go through the integration runner). All 10 cases green.

4. **Run the slice-3 cache tests again.** `npm run test:unit -- wide-table-statement.cache`. Still green — the reconciler invalidates the cache as a side-effect; cache tests don't depend on the reconciler.

5. **Lint + type-check.** Clean.

**Done when:** cases 8–17 pass; the reconciler exists end-to-end but is called from nowhere outside its own tests.

**Risk:**

- **Type-checking the dynamic SQL.** `ALTER TABLE` and `CREATE TABLE IF NOT EXISTS` aren't expressible in Drizzle's typed query builder — they go through `tx.execute(sql.raw(…))` with care around identifier quoting. Mitigation: identifiers come exclusively from `entityLockKey(...)` / `sanitizeColumnName(...)` / a hard-coded prefix; never from user input. A unit test (case 14, collision suffix) exercises the sanitiser against malicious-looking inputs.
- **The reconciler's transaction interacts with concurrent writes.** Today nothing else writes to `wide_table_columns` or the runtime `er__*` tables; phase 2's sync writers will. The advisory lock is the contract; phase 2's plan reuses `withEntityLock` and the contract holds.

---

## Slice 5 — Trigger wiring at the route layer

Wire the reconciler into the existing route handlers for connector-entity create and field-mapping mutations.

**Files**

- Edit: `apps/api/src/routes/connector-entity.router.ts` — POST handler calls `reconciler.ensureTable(entity.id)` after the repo create returns.
- Edit: `apps/api/src/routes/field-mapping.router.ts` — POST, PATCH, DELETE handlers each call `reconciler.reconcileEntity(connectorEntityId)` after their repo write.
- Edit: `apps/api/src/__tests__/__integration__/routes/connector-entity.router.integration.test.ts` — add case 25.
- Edit: `apps/api/src/__tests__/__integration__/routes/field-mapping.router.integration.test.ts` — add cases 26–29.

**Steps**

1. **Write the four new route integration test cases (25–29).** Each test makes the relevant HTTP request via the integration test runner, then asserts both `information_schema.columns` and `wide_table_columns` reflect the change. Case 27 asserts a *non-schema-changing* PATCH (e.g. `defaultValue` only) results in *no* DDL — implemented as: capture `wide_table_columns.updated` before/after, assert unchanged. Case 29 asserts a column-definition-swap PATCH that changes `type` returns 422 with `WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED` *after* the field-mapping update has already committed (state is now drifted; spec accepts this and operator must revert).

   Run; all fail (routes don't yet call the reconciler).

2. **Wire `reconciler.ensureTable` into `connector-entity.router.ts` POST handler.** After `connectorEntitiesRepo.create(...)`. Wrap in a try/catch — on reconciler failure, log structured error and return 500 with `WIDE_TABLE_RECONCILE_FAILED`. The repo create has already committed at this point; failure means the boot drift check on next restart will fix it (or the operator can call the reconciler explicitly).

3. **Wire `reconciler.reconcileEntity` into `field-mapping.router.ts` POST/PATCH/DELETE handlers.** Same shape. Always called with the field-mapping's `connectorEntityId`.

4. **Important wrinkle for PATCH (case 29).** A `connectorEntityId`-changing or `columnDefinitionId`-changing PATCH could affect *two* entities (the old and the new). For phase 1, the spec doesn't allow re-pointing a field-mapping to a different entity (treat as a 422 if attempted — already enforced upstream by the existing PATCH validator). A `columnDefinitionId` swap that changes type triggers the type-change refusal — this is case 29.

5. **Run focused tests.** `cd apps/api && npm run test:integration -- connector-entity.router field-mapping.router`. All 5 new cases plus the existing route suites green.

6. **Lint + type-check.** Clean.

**Done when:** cases 25–29 pass; existing route tests still green; the reconciler now runs on every `connector_entities` / `field_mappings` mutation in dev.

**Risk:**

- **The reconciler call is post-commit, not in-transaction.** Acknowledged in the spec. Failure path is: route returns 500, but the underlying field_mappings change is already persisted. The boot drift check is the safety net; operators see it on next restart. Phase 5 may move the call inside the same transaction once we have evidence of incidents — for phase 1, post-commit is acceptable because no feature path *reads* the wide table yet.
- **Existing route integration tests now hit the reconciler.** This adds ~50–200 ms per test (one ALTER TABLE + one wide_table_columns insert). Acceptable for the integration suite; if total runtime grows uncomfortably, share fixture setup across cases with `beforeAll` instead of `beforeEach`.

---

## Slice 6 — Boot drift check

The final piece: `app.ts` runs `reconciler.reconcileAll()` before binding the HTTP listener. Failure aborts startup.

**Files**

- New: `apps/api/src/__tests__/__integration__/services/boot-drift-check.integration.test.ts`
- Edit: `apps/api/src/app.ts` (or whichever file owns the bootstrap sequence — audit first; likely `src/index.ts` or `src/server.ts`).

**Steps**

1. **Write the boot-drift integration tests (cases 30–32).** Each test directly invokes `reconciler.reconcileAll()` against a seeded database (the integration harness already provides this) — no actual `app.listen()` involved. Cases:

   - **30 — Clean state reconciliation.** Seed N entities × M mappings; call `reconcileAll()`; assert each `er__<id>` exists with the expected `c_*` columns.
   - **31 — Idempotent on already-reconciled state.** Seed entities + run `reconcileAll`, then run again; second run reports `reconciled: 0, skipped: 0` (no DDL emitted) — implemented as: spy on `wideTableStatementCache.invalidate` and assert zero calls.
   - **32 — Type-change drift causes failure.** Pre-seed `wide_table_columns` with a stale `pg_type` value that mismatches the current `column_definitions.type`; call `reconcileAll`; assert it throws `WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED` and the offending entity id is in the error message.

   Run; cases 30 and 31 pass already (slice 4's `reconcileAll` covers them); case 32 may already pass if slice 4's test 13 is exhaustive — verify and skip duplication. Net new cases here: at least case 32 if it's not already covered.

2. **Audit the bootstrap location.** Inspect `apps/api/src/app.ts` / `src/index.ts` / `src/server.ts` to find where `app.listen()` is called. The reconciler call goes immediately before `app.listen` and immediately after the database client is initialised.

3. **Wire `reconciler.reconcileAll()` into bootstrap.** Pseudocode:

   ```ts
   logger.info("Starting wide-table boot drift check…");
   try {
     const result = await wideTableReconciler.reconcileAll();
     logger.info({ ...result }, "Wide-table boot drift check complete");
   } catch (err) {
     logger.error({ err }, "WIDE_TABLE_DRIFT_AT_BOOT — refusing to start");
     process.exit(1);
   }
   app.listen(port, …);
   ```

4. **Run focused tests.** `cd apps/api && npm run test:integration -- boot-drift-check`. All 3 cases green.

5. **Manual smoke check.** `cd apps/api && npm run dev`. Server logs should include `Wide-table boot drift check complete { reconciled: N, skipped: 0 }` followed by the existing `Server listening` log. `psql -c '\dt er__*'` lists one table per live `connector_entities` row.

6. **Run the full integration suite.** `cd apps/api && npm run test:integration`. All slices' tests still green; total green count is the previous baseline + 32 new cases (some of which already passed at end of earlier slices).

7. **Run the full unit suite + repo lint + type-check.** All green.

**Done when:** cases 30–32 pass; `npm run dev` boots cleanly; the acceptance criteria from the spec are all satisfied.

**Risk:**

- **Boot drift check fails on a real dev database.** If a developer's local database has unexpected drift (e.g. they hand-edited a `wide_table_columns` row), the dev server refuses to start. Mitigation: the error log names the offending entity id and the specific mismatch; the developer can drop the offending row in `db:studio` and restart. Document this recovery path in the slice-6 commit message.
- **`reconcileAll` is slow on a large dev DB.** Phase-1 expectation is sub-second on ≤100 entities. If slow, consider running drift in parallel — but only after measurement. Don't optimise prematurely.

---

## Cross-slice gates

After each slice:

1. `cd apps/api && npm run test:unit && npm run test:integration` is green.
2. `npm run lint && npm run type-check` from repo root are clean.
3. `git diff --stat` matches the slice's "Files" list.
4. No `er__*` table is referenced from any feature path (`grep -rn "er__" apps/api/src` returns matches only inside reconciler / cache / advisory-lock / wide-table-repo / their tests).
5. No `normalizedData` reference is removed (phase 1 does not touch the JSONB path).

After slice 6 (phase end):

- All 9 acceptance-criteria checkboxes from the spec are satisfied.
- Manual `npm run dev` boots; `psql -c '\dt er__*'` matches `connector_entities` count.
- A short-lived feature branch is opened with the merge — no behaviour change is expected from anyone using the app.

---

## What this plan does *not* attempt

- No phase-2 sync write-path changes. The sync pipeline still upserts JSONB only.
- No phase-3 read-path or filter-SQL rewrites. The list endpoint still reads `normalized_data`.
- No phase-4 `data_query` / AlaSQL changes. Portal sessions still load station data into AlaSQL.
- No web-app changes. The UI is unaware of wide tables.
- No system-prompt changes.
- No type-change handling beyond detect-and-refuse.
- No column-drop maintenance.

Each of those has a dedicated phase-N spec and plan to follow.
