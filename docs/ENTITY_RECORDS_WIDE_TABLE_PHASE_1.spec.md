# Entity Records Wide-Table Storage — Phase 1 — Spec

**Build the reconciler foundation: per-`connector_entity` Postgres tables (`er__<id>`) materialised from `field_mappings`, a metadata table that tracks the column-by-column linkage, and the service + advisory-lock plumbing that owns every DDL statement against those tables.** Phase 1 is purely additive: nothing reads or writes the wide tables yet. After this phase, every live connector entity has an empty (or column-only) `er__<id>` table on disk, the `wide_table_columns` metadata is in lockstep with `field_mappings`, and Phases 2–4 can proceed without re-deriving any of the foundation.

Proposal: `docs/ENTITY_RECORDS_WIDE_TABLE.proposal.md`. Audit: `docs/ENTITY_RECORDS_WIDE_TABLE.audit.md`. Resolved decisions for this phase:

- **Reconciler trigger style:** synchronous, in-process, called from the route handlers that mutate `connector_entities` and `field_mappings`. Per-entity advisory lock serializes concurrent requests. Async outbox / Postgres NOTIFY rejected (more moving parts, no benefit at v1 scale).
- **Column naming:** `c_<sanitized_normalized_key>` where sanitization is `lower + replace [^a-z0-9_] with '_'`. Collisions resolve by `_2` / `_3` suffixes detected at reconciler time. The `c_` prefix avoids reserved keywords and guarantees the first character is a letter. The actual column name is recorded verbatim in `wide_table_columns.column_name`.
- **Type changes:** detected and **refused** in Phase 1 — the reconciler raises `WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED` and aborts that entity's reconciliation. Phase 5 adds the staged add-new → backfill → swap → retire flow. (No data exists in wide tables in Phase 1, so this is a future-proofing choice, not an immediate constraint.)
- **Retirement vs. drop:** soft-deleting a `field_mapping` marks the corresponding wide-table column retired (`wide_table_columns.retired_at` set), but does **not** issue `DROP COLUMN`. The retired column stays on disk, no longer written to. Phase 5 adds the maintenance job that drops columns past a retention window.
- **Boot drift check:** sequential, runs before the HTTP listener binds. Refuses to start the app on any unfixable drift. Parallelisation is a Phase 5 polish if startup time becomes a problem.
- **Wide-table `entity_record_id` FK:** declared as `REFERENCES entity_records(id) ON DELETE CASCADE` from day one. Phase 2 will start writing both rows in the same transaction; the FK is harmless until then (no rows in either side reference each other yet on the wide-table side).

After this phase: `psql` shows one `er__<connector_entity_id>` table per live connector entity, each containing only the metadata columns plus one column per active field-mapping; `wide_table_columns` mirrors this shape; `pg_advisory_xact_lock` serializes any two concurrent DDL writes against the same entity; `npm run dev` boots cleanly with the drift check passing on a freshly-migrated database.

---

## Scope

### In scope

1. **`wide_table_columns` Drizzle table** — metadata catalog tracking, per `connector_entity`, the mapping of `field_mapping_id` → wide-table column name + Postgres type, plus retirement state.
2. **`WideTableReconcilerService`** (`apps/api/src/services/wide-table-reconciler.service.ts`) — the only code path that emits DDL against `er__<id>` tables. Public methods: `ensureTable`, `reconcileEntity`, `reconcileAll`, `dropTable`. Internally: `computeDesired`, `readActual`, `diff`, `applyAdds`, `applyRetires`, `detectTypeChanges`.
3. **`WideTableStatementCache`** (`apps/api/src/services/wide-table-statement.cache.ts`) — per-entity in-memory cache of generated SELECT / INSERT / UPDATE templates, invalidated on reconciler write. Phase 1 builds it; Phase 2 consumes it.
4. **`WideTableRepository`** (`apps/api/src/db/repositories/wide-table.repository.ts`) — scaffolding only. Public surface in Phase 1: `tableName(connectorEntityId): string`, `selectAll(connectorEntityId, ids?)` (single helper used by reconciler self-tests). Sync write methods land in Phase 2.
5. **Advisory-lock helper** (`apps/api/src/db/advisory-lock.util.ts`) — `withEntityLock(client, connectorEntityId, fn)` wraps a transaction with `pg_advisory_xact_lock(hashKey(connectorEntityId))`. Used by the reconciler in Phase 1 and by sync writes in Phase 2.
6. **Boot drift check wiring** — `WideTableReconcilerService.reconcileAll()` runs from `app.ts` (or wherever the bootstrap sequence lives) before `app.listen()`. Failure aborts startup.
7. **Trigger wiring** at the route layer:
   - `POST /api/connector-entities` → `reconciler.ensureTable(entity.id)` after the repo create.
   - `DELETE /api/connector-entities/:id` (soft-delete) → `reconciler.dropTable(entity.id)` is **not** called in Phase 1 (preserves data for any future un-soft-delete); reconciler skips soft-deleted entities at boot. *Hard* delete (none today) would call `dropTable`.
   - `POST /api/field-mappings` → `reconciler.reconcileEntity(fm.connectorEntityId)` after create.
   - `PATCH /api/field-mappings/:id` → same.
   - `DELETE /api/field-mappings/:id` (soft-delete) → same.
8. **One Drizzle migration**, named `wide_table_storage_phase_1`, that:
   - Creates `wide_table_columns`.
   - Does **not** create any `er__<id>` table — those are created at runtime by the reconciler on first boot. (Justification: the set is dynamic and per-entity; modelling them in static Drizzle is a category error.)
9. **Tests** — unit tests for diff/apply, integration tests against a real Postgres for the lock and the boot drift check, and route-level tests for the trigger wiring.

### Out of scope

- Any read or write against `er__<id>` tables from a feature path. JSONB `normalized_data` remains the source of truth for both REST and AlaSQL through Phase 1.
- Sync writes touching wide tables. Phase 2.
- REST list/get/patch path rewrites. Phase 3.
- `sql_query` / AlaSQL deletion. Phase 4.
- Type-change handling beyond detect + refuse. Phase 5.
- Column-drop maintenance job. Phase 5.
- Schema-per-org partitioning, columnar mirror, async reconciler. Out of v1 entirely.
- Web-app changes. The UI continues to read JSONB through Phase 3 with zero awareness of wide tables.
- System-prompt changes. The LLM continues to query AlaSQL through Phase 4.

---

## Concept changes

### Naming

- "wide table" = the `er__<connector_entity_id>` Postgres table holding typed columns mirroring an entity's field mappings.
- "wide-table column" = a single typed column inside one wide table, corresponding to exactly one `field_mapping`.
- "metadata columns" = the four wide-table columns that always exist regardless of field mappings: `entity_record_id`, `organization_id`, `synced_at`, `is_valid`.
- "data columns" = the dynamic, per-entity columns added by the reconciler from `field_mappings`. Always prefixed `c_`.
- "retired column" = a data column whose `field_mapping` was soft-deleted. The Postgres column still exists; the metadata row's `retired_at` is set; new writes ignore it.

### `c_` column-name prefix

Data columns are prefixed with `c_` so they cannot collide with metadata columns (which are unprefixed) or Postgres reserved words. The prefix is part of the stored column name in `wide_table_columns.column_name`; the rehydration layer in Phase 3 strips it when projecting back into `normalizedData`. Phase 1 just records and applies the prefix; the strip lands in Phase 3.

---

## Surface

### `wide_table_columns` Drizzle table

**File: `apps/api/src/db/schema/wide-table-columns.table.ts`** (new)

```ts
import {
  pgTable,
  text,
  bigint,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { connectorEntities } from "./connector-entities.table.js";
import { fieldMappings } from "./field-mappings.table.js";
import { columnDefinitions } from "./column-definitions.table.js";

/**
 * Catalog of dynamic columns on each `er__<connector_entity_id>` wide
 * table. One row = one (connector_entity, field_mapping) → wide-table
 * column linkage. The reconciler is the only writer.
 *
 * `retired_at` is set when the source field_mapping is soft-deleted.
 * The Postgres column itself is *not* dropped at retire time — Phase 5
 * has a maintenance job for that. Until then, retired columns stay on
 * disk and are skipped by the statement cache.
 */
export const wideTableColumns = pgTable(
  "wide_table_columns",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    connectorEntityId: text("connector_entity_id")
      .notNull()
      .references(() => connectorEntities.id),
    fieldMappingId: text("field_mapping_id")
      .notNull()
      .references(() => fieldMappings.id),
    columnDefinitionId: text("column_definition_id")
      .notNull()
      .references(() => columnDefinitions.id),
    /** Sanitized column name as it appears on the wide table (e.g. `c_amount`). */
    columnName: text("column_name").notNull(),
    /** Postgres type as it was applied (`numeric`, `text`, `boolean`, …). */
    pgType: text("pg_type").notNull(),
    /** Set when the source field-mapping is soft-deleted. */
    retiredAt: bigint("retired_at", { mode: "number" }),
  },
  (table) => [
    uniqueIndex("wide_table_columns_entity_column_unique")
      .on(table.connectorEntityId, table.columnName)
      .where(sql`deleted IS NULL`),
    uniqueIndex("wide_table_columns_entity_field_mapping_unique")
      .on(table.connectorEntityId, table.fieldMappingId)
      .where(sql`deleted IS NULL`),
    index("wide_table_columns_entity_idx").on(table.connectorEntityId),
  ]
);
```

Standard Zod / type-checks updates in `apps/api/src/db/schema/zod.ts` and `apps/api/src/db/schema/type-checks.ts`. Standard repository in `apps/api/src/db/repositories/wide-table-columns.repository.ts` extending `Repository`. No domain model in `@portalai/core` — this is a pure API-side metadata table not exposed via REST.

### Reconciler service

**File: `apps/api/src/services/wide-table-reconciler.service.ts`** (new)

Public surface:

```ts
export interface WideTableReconciler {
  /** Create the empty `er__<entityId>` table if it does not exist. Idempotent. */
  ensureTable(connectorEntityId: string, client?: DbClient): Promise<void>;

  /** Diff field_mappings against wide_table_columns + information_schema, apply changes. */
  reconcileEntity(connectorEntityId: string, client?: DbClient): Promise<void>;

  /** Boot drift check across every live connector entity. Throws on first failure. */
  reconcileAll(): Promise<{ reconciled: number; skipped: number }>;

  /** Hard-drop the `er__<entityId>` table (used only by tests in Phase 1). */
  dropTable(connectorEntityId: string, client?: DbClient): Promise<void>;
}
```

Behaviour outline:

```
reconcileEntity(entityId):
  withEntityLock(entityId):
    ensureTable(entityId)
    desired = computeDesired(entityId)
        // SELECT field_mappings join column_definitions
        //   WHERE connector_entity_id = entityId AND deleted IS NULL
        // → Array<{ fieldMappingId, columnDefinitionId, normalizedKey, pgType }>
    actual  = readActual(entityId)
        // SELECT * FROM wide_table_columns
        //   WHERE connector_entity_id = entityId AND deleted IS NULL
    diff = computeDiff(desired, actual)
        // adds:       in desired, not in actual
        // retires:    in actual, not in desired (and not already retired)
        // typeChanges: same fieldMappingId, different pgType
    if diff.typeChanges.length > 0:
      throw ApiError(WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED, ...)
    applyAdds(diff.adds)        // ALTER TABLE ADD COLUMN per add, plus wide_table_columns INSERT
    applyRetires(diff.retires)  // wide_table_columns.retiredAt = now() (no DROP COLUMN)
    statementCache.invalidate(entityId)
```

Type mapping (`column_definitions.type` → Postgres):

| Column type       | Postgres type   |
|-------------------|------------------|
| `string`, `enum`  | `text`           |
| `number`          | `numeric`        |
| `boolean`         | `boolean`        |
| `date`            | `date`           |
| `datetime`        | `timestamptz`    |
| `reference`       | `text`           |
| `reference-array` | `text[]`         |
| `array`, `json`   | `jsonb`          |

Centralised in a `pgTypeForColumnDefinitionType(type: ColumnDataType): string` helper exported from the reconciler module.

`ensureTable(entityId)` SQL:

```sql
CREATE TABLE IF NOT EXISTS "er__<entityId>" (
  entity_record_id  text PRIMARY KEY
                       REFERENCES entity_records(id) ON DELETE CASCADE,
  organization_id   text NOT NULL,
  synced_at         bigint NOT NULL,
  is_valid          boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS "er__<entityId>__org_idx"
  ON "er__<entityId>" (organization_id);
```

`applyAdds` SQL (one statement per add, all inside the same transaction):

```sql
ALTER TABLE "er__<entityId>" ADD COLUMN "<columnName>" <pgType>;
INSERT INTO wide_table_columns (...) VALUES (...);
```

`applyRetires` SQL:

```sql
UPDATE wide_table_columns SET retired_at = $now WHERE id = $rowId;
-- no ALTER TABLE
```

### Statement cache

**File: `apps/api/src/services/wide-table-statement.cache.ts`** (new)

```ts
interface CachedStatements {
  selectAllSql: string;     // "SELECT entity_record_id, organization_id, synced_at, is_valid, c_a, c_b, … FROM er__<id>"
  insertSql: string;        // INSERT (...) VALUES (...) ON CONFLICT (entity_record_id) DO UPDATE SET ...
  columns: ReadonlyArray<{ columnName: string; pgType: string; fieldMappingId: string }>;
  schemaVersion: number;    // bumped on every invalidate; used to detect stale callers
}

export class WideTableStatementCache {
  get(connectorEntityId: string): CachedStatements; // lazy build
  invalidate(connectorEntityId: string): void;
  clear(): void;
}
```

Phase 1 builds the cache and exposes it; Phase 2 consumes it from the sync write path. The cache is a process-local `Map`. It rebuilds from `wide_table_columns` on demand — no global TTL. Callers that hold a stale `CachedStatements` reference past an invalidation will be wrong; the contract is "always call `cache.get()` before each statement build, never hold a reference across awaits".

### Repository scaffold

**File: `apps/api/src/db/repositories/wide-table.repository.ts`** (new)

Phase 1 only exposes:

```ts
export class WideTableRepository {
  /** "er__<connectorEntityId>" — exported so tests and reconciler share the convention. */
  tableName(connectorEntityId: string): string;

  /** Used by reconciler self-tests; not yet wired into any feature path. */
  selectAll(
    connectorEntityId: string,
    ids?: string[],
    client?: DbClient
  ): Promise<Record<string, unknown>[]>;
}

export const wideTableRepo = new WideTableRepository();
```

Sync-write methods (`upsertMany`, `softDeleteByEntityRecordIds`, etc.) land in Phase 2.

### Advisory-lock helper

**File: `apps/api/src/db/advisory-lock.util.ts`** (new)

```ts
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { DbClient } from "../db/repositories/base.repository.js";

/** Stable 64-bit signed int derived from the entity id (Postgres advisory-lock key). */
export function entityLockKey(connectorEntityId: string): bigint {
  const hash = crypto.createHash("sha256").update(connectorEntityId).digest();
  return hash.readBigInt64BE(0);
}

/**
 * Wraps a function in a transaction that holds `pg_advisory_xact_lock`
 * keyed on the entity id. Released automatically at COMMIT/ROLLBACK.
 */
export async function withEntityLock<T>(
  client: DbClient,
  connectorEntityId: string,
  fn: (tx: DbClient) => Promise<T>
): Promise<T> {
  const key = entityLockKey(connectorEntityId);
  return await client.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${key}::bigint)`);
    return await fn(tx as DbClient);
  });
}
```

Phase 1 uses it from the reconciler. Phase 2 wires it into the sync write path.

### Boot drift check wiring

**File: `apps/api/src/app.ts`** (edit) — call `reconciler.reconcileAll()` between repo initialization and `app.listen()`. On failure, log a structured error and exit non-zero. The drift-check failure mode for Phase 1 is exclusively "type-change pending" (since no other path can produce drift yet); the operator's recovery is to revert the offending field-mapping change in `db:studio` and restart.

### Trigger wiring

**Files edited:**

- `apps/api/src/routes/connector-entity.router.ts` — `POST /` handler, after `connectorEntitiesRepo.create()`, calls `reconciler.ensureTable(entity.id)`.
- `apps/api/src/routes/field-mapping.router.ts` — `POST /`, `PATCH /:id`, `DELETE /:id` handlers each call `reconciler.reconcileEntity(connectorEntityId)` after their repo write returns.

The reconciler call is **not** part of the same transaction as the repo write — the repo write commits first, then reconciliation runs against the committed state. If reconciliation fails after a successful field-mapping commit, the route returns a 500 with `WIDE_TABLE_RECONCILE_FAILED`; the boot drift check will retry the reconciliation on the next deploy, and field-mapping mutations are idempotent enough that a retry from the client is safe. (Phase 5 may revisit this — see *Risks*.)

### Error codes

`apps/api/src/constants/api-codes.constants.ts` adds:

- `WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED` (422) — reconciler refused a type change; operator must intervene.
- `WIDE_TABLE_RECONCILE_FAILED` (500) — reconciler threw for any other reason.
- `WIDE_TABLE_DRIFT_AT_BOOT` (logged-only; app exits) — the boot drift check failed.

---

## Tests

### `wideTableColumns` repository / migration

**`apps/api/src/__tests__/__integration__/db/repositories/wide-table-columns.repository.integration.test.ts`** (new)

1. **Inserts a row.** Create a fixture `connector_entity` + `field_mapping` + `column_definition`; insert; read back.
2. **Unique on `(connector_entity_id, column_name)` (live rows).** Two inserts with the same column name on the same entity collide; on a different entity, succeed.
3. **Unique on `(connector_entity_id, field_mapping_id)` (live rows).** Two rows for the same field-mapping collide.
4. **Soft-delete frees both unique constraints.** Soft-delete a row, then insert a new row reusing both name and field-mapping id — succeeds.
5. **`retired_at` is independent of `deleted`.** Set `retired_at`; row still satisfies the live-row unique indexes.

**`apps/api/src/__tests__/__integration__/db/migrations/wide_table_storage_phase_1.test.ts`** (new)

6. **Migration is forward-applicable.** Run `db:migrate` from a clean schema; `wide_table_columns` exists.
7. **Migration is rollback-safe.** Apply, then rollback, then re-apply — no errors.

### Reconciler unit tests

**`apps/api/src/__tests__/services/wide-table-reconciler.service.test.ts`** (new — uses real Postgres via the integration test harness)

8. **`ensureTable` creates an empty `er__<id>` with the four metadata columns.** Inspect `information_schema.columns`.
9. **`ensureTable` is idempotent.** Call twice; second call no-ops.
10. **`reconcileEntity` adds a column for each new field_mapping.** Seed 3 mappings, run, assert 3 `c_*` columns and 3 `wide_table_columns` rows.
11. **`reconcileEntity` skips already-applied columns.** Run twice; the second run is a no-op (no DDL emitted, statement cache not invalidated).
12. **`reconcileEntity` retires soft-deleted mappings.** Soft-delete a mapping, re-run, assert `retired_at` is set, the Postgres column still exists, and `selectAll` does not include the retired column in the SELECT list.
13. **`reconcileEntity` refuses type changes.** Change a mapping's `column_definition_id` to point at a definition with a different `type`; expect `WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED`.
14. **`reconcileEntity` survives column-name collisions.** Two normalized_keys that sanitize to the same `c_<name>` — second one becomes `c_<name>_2`.
15. **`reconcileAll` covers every live entity.** Seed 3 entities × 2 mappings each; run; assert 3 tables × 2 `c_*` columns each.
16. **`reconcileAll` skips soft-deleted entities.** A soft-deleted `connector_entities` row produces no table, no metadata.
17. **`dropTable` removes the table and all metadata rows.** (Used by test cleanup; not by feature paths.)

### Statement cache

**`apps/api/src/__tests__/services/wide-table-statement.cache.test.ts`** (new)

18. **`get` lazy-builds on first call.** Empty cache → call → returns valid SQL strings, second call returns same object reference (memoised).
19. **`invalidate` forces a rebuild.** First call → `invalidate` → second call returns a new object reference; `schemaVersion` increments.
20. **`selectAllSql` lists all live data columns plus the four metadata columns, in deterministic order.** Order is: metadata columns first (fixed), then data columns sorted by `wide_table_columns.created`.
21. **`insertSql` is `INSERT … VALUES (…) ON CONFLICT (entity_record_id) DO UPDATE SET …`.** All live data columns appear in both the column list and the ON CONFLICT SET clause; retired columns appear in neither.

### Advisory lock

**`apps/api/src/__tests__/__integration__/db/advisory-lock.integration.test.ts`** (new)

22. **`withEntityLock` serializes two concurrent calls for the same entity.** Open two connections; first acquires lock with a 200ms hold; second blocks until first commits. Assert wall-clock ordering.
23. **`withEntityLock` does not block calls for a different entity.** Two entity ids run in parallel without contention.
24. **Lock is released on rollback.** Throw inside the callback; assert a subsequent acquire on the same entity succeeds immediately.

### Trigger wiring (route-level integration)

**`apps/api/src/__tests__/__integration__/routes/connector-entity.router.integration.test.ts`** (edit)

25. **`POST /api/connector-entities` triggers `ensureTable`.** Create entity via the API; assert `er__<newId>` exists in `information_schema`.

**`apps/api/src/__tests__/__integration__/routes/field-mapping.router.integration.test.ts`** (edit)

26. **`POST /api/field-mappings` adds a wide-table column.** Create a mapping; assert the corresponding `c_*` column exists and `wide_table_columns` has a matching row.
27. **`PATCH /api/field-mappings/:id` (no schema change) is a no-op DDL-wise.** Patch a non-schema field (e.g. `defaultValue`); assert no DDL ran (compare `wide_table_columns.updated` timestamps and column count).
28. **`DELETE /api/field-mappings/:id` retires the wide-table column.** Soft-delete; assert `wide_table_columns.retired_at` is set; the Postgres column still exists.
29. **`PATCH /api/field-mappings/:id` with a type-changing column-definition swap returns 422.** Assert `WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED` code; the field-mapping update *did* commit (state is now drifted); the next reconciler call (or boot) will continue to refuse until the operator reverts.

### Boot drift check

**`apps/api/src/__tests__/__integration__/services/boot-drift-check.integration.test.ts`** (new)

30. **App boot reconciles every live entity from a clean state.** Seed N entities × M mappings before the bootstrap path runs; trigger the drift check; assert each `er__<id>` exists with the expected columns.
31. **App boot tolerates an entity that's already correctly reconciled.** Pre-create the table + metadata in the seed; bootstrap is a no-op for that entity.
32. **App boot fails on a pending type change.** Inject drift (mismatched `wide_table_columns.pg_type` vs. current `column_definitions.type`); assert `reconcileAll` throws and the bootstrap aborts.

### Test totals

- API integration / migration / repository: 7 cases (1–7).
- Reconciler service: 10 cases (8–17).
- Statement cache: 4 cases (18–21).
- Advisory lock: 3 cases (22–24).
- Trigger wiring (existing route tests): 5 cases (25–29).
- Boot drift check: 3 cases (30–32).

Total **32 new test cases**.

---

## Acceptance criteria

- [ ] All 32 new test cases pass.
- [ ] `cd apps/api && npm run test:unit && npm run test:integration` is green.
- [ ] `npm run lint && npm run type-check` from repo root are clean.
- [ ] `npm run db:migrate` against a clean database produces `wide_table_columns` and no `er__*` tables (the latter are created at runtime).
- [ ] `npm run dev` boots cleanly; server logs show `reconcileAll` ran with `reconciled: <N>, skipped: 0`.
- [ ] After dev boot, `psql -c '\dt er__*'` lists one table per live `connector_entities` row; each table has only the four metadata columns plus one `c_*` column per active `field_mappings` row on that entity.
- [ ] After dev boot, `SELECT connector_entity_id, COUNT(*) FROM wide_table_columns GROUP BY 1` matches `SELECT connector_entity_id, COUNT(*) FROM field_mappings WHERE deleted IS NULL GROUP BY 1` exactly.
- [ ] No feature path reads from or writes to any `er__*` table — verified by `grep "er__" apps/api/src` returning only matches inside the reconciler service, the statement cache, the advisory-lock util, the wide-table repo, and their tests.
- [ ] No `normalizedData` reference is removed in this phase. The JSONB path is untouched.

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Reconciler call after a route's repo write fails, leaving `field_mappings` and `wide_table_columns` out of sync. | Boot drift check catches this on the next restart and re-runs reconciliation. The route returns 500 so the client knows the server-side change is incomplete. Phase 5 may move the trigger inside the same transaction as the repo write — for Phase 1 the post-commit pattern is acceptable because no feature path *reads* the wide table yet. |
| Concurrent field-mapping mutations on the same entity race the reconciler. | The advisory lock serialises reconciler runs per entity. Two routes against the same entity will queue at the lock; throughput per entity is one reconciliation at a time. |
| Column-name collisions break a sync. | Detected at reconciler time (the `wide_table_columns` unique constraint catches it). Resolution: suffix `_2`, `_3`, etc., logged loudly. Sanitisation should not produce collisions in practice (normalized keys are usually distinct snake_case strings). |
| `pg_advisory_xact_lock` key collision across unrelated entities. | The 64-bit key is the leading 8 bytes of SHA-256(entityId). Birthday-collision probability across ~1M entities is negligible. |
| The boot drift check is slow on a large database, blocking `npm run dev`. | Phase 1 ships sequential. With realistic v1 entity counts (≤100) reconciliation is sub-second. Phase 5 adds parallelism if measurements demand it. |
| Drift-check refuses to start the app, blocking unrelated work in dev. | The error message includes the offending entity ids and the specific mismatch (e.g. "field-mapping fm_… expected pg_type=numeric, actual=text"). Operator can drop the offending row in `db:studio`; the app then boots. The `WIDE_TABLE_DRIFT_AT_BOOT` log line names the recovery path. |
| Reconciler emits an `ALTER TABLE ADD COLUMN` against a heavily-written table. | In Phase 1 the wide tables are empty (no Phase 2 writes yet). In Phase 2+, `ADD COLUMN` with a NULL default is metadata-only in modern Postgres — no rewrite, no exclusive lock of consequence. The advisory lock prevents reconciler DDL from racing with sync's bulk inserts in Phase 2. |
| `wide_table_columns` table fills up over time as columns are retired. | Bounded by `count(field_mappings)` × small constant for retire churn. At v1 scale the row count never exceeds low thousands. Phase 5's column-drop maintenance job also clears retired metadata after the retention window. |

**Rollback** is straightforward and data-lossless: revert the merge commit, run a `DROP TABLE wide_table_columns` migration, and `psql -c "DROP TABLE er__<entity_id>"` for each table the reconciler created. The reconciler creates tables only — it does not write rows into them in Phase 1 — so dropping them deletes nothing of consequence. Because no feature path reads or writes the wide tables in Phase 1, rollback is invisible to the rest of the system.

---

## Files touched

### `apps/api`

- New: `src/db/schema/wide-table-columns.table.ts`
- New: `src/db/repositories/wide-table-columns.repository.ts`
- New: `src/db/repositories/wide-table.repository.ts`
- New: `src/db/advisory-lock.util.ts`
- New: `src/services/wide-table-reconciler.service.ts`
- New: `src/services/wide-table-statement.cache.ts`
- New: Drizzle migration `<timestamp>_wide_table_storage_phase_1.sql`
- New: integration tests (cases 1–7, 22–24, 30–32) and unit tests (cases 8–21).
- Edit: `src/db/schema/index.ts`, `src/db/schema/zod.ts`, `src/db/schema/type-checks.ts` — register `wideTableColumns`.
- Edit: `src/db/repositories/index.ts`, `src/services/db.service.ts` — register `wideTableColumnsRepo` and `wideTableRepo`.
- Edit: `src/app.ts` (or wherever bootstrap lives) — call `reconciler.reconcileAll()` before `app.listen()`.
- Edit: `src/routes/connector-entity.router.ts` — call `reconciler.ensureTable(entity.id)` in the POST handler.
- Edit: `src/routes/field-mapping.router.ts` — call `reconciler.reconcileEntity(connectorEntityId)` in POST / PATCH / DELETE handlers.
- Edit: `src/__tests__/__integration__/routes/connector-entity.router.integration.test.ts` — add case 25.
- Edit: `src/__tests__/__integration__/routes/field-mapping.router.integration.test.ts` — add cases 26–29.
- Edit: `src/constants/api-codes.constants.ts` — add `WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED`, `WIDE_TABLE_RECONCILE_FAILED`, `WIDE_TABLE_DRIFT_AT_BOOT`.

### `packages/core`

- No changes. `wide_table_columns` is API-internal metadata; no domain model is exposed.

### `apps/web`

- No changes.

No new dependency. No env-var change. No infra change.
