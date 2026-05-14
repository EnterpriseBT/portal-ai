# Entity Records Wide-Table Storage — Phase 2 — Spec

**Storage cutover plus read-path cutover, in one phase.** Sync writes start populating `er__<connector_entity_id>` alongside `entity_records` in the same transaction; every server-side read site that today reaches into `entity_records.normalized_data` is rewritten to read typed columns from the wide table; the Drizzle migration drops `normalized_data` and its GIN index, truncates `entity_records`, and a re-sync trigger refills both stores from source. After phase 2, the wide tables are the only analyzable storage. The web-app contract is preserved verbatim (`EntityRecord.normalizedData` is rehydrated from typed columns at the API serialization seam).

This phase merges what the proposal originally split into Phase 2 ("Storage cutover") and Phase 3 ("REST read path rewrite"). The merge is deliberate: dropping `normalized_data` forces every JSONB read site to change anyway, and a transitional rehydrator shim would just be code to delete in the next phase. See the proposal phase breakdown (`docs/ENTITY_RECORDS_WIDE_TABLE.proposal.md`) for the updated numbering — old Phases 4 and 5 become new Phases 3 and 4.

Proposal: `docs/ENTITY_RECORDS_WIDE_TABLE.proposal.md`. Audit: `docs/ENTITY_RECORDS_WIDE_TABLE.audit.md`. Phase 1 spec: `docs/ENTITY_RECORDS_WIDE_TABLE_PHASE_1.spec.md`.

Resolved decisions for this phase:

- **Single transaction for both stores.** `LayoutPlanCommitService.writeRecords` upserts `entity_records` and `er__<entity_id>` inside the same `DbService.transaction` block. The transaction holds the per-entity advisory lock from phase 1's `withEntityLock` so reconciler DDL on this entity cannot interleave.
- **Multi-row INSERT for the wide-table bulk path.** `WideTableStatementCache` gains a `buildBulkInsertSql(connectorEntityId, batchSize)` method that produces a parameterised `INSERT … VALUES (…), (…), … ON CONFLICT (entity_record_id) DO UPDATE SET …` for the requested batch size. Same shape as `entity_records.upsertManyBySourceId`. Per-row INSERTs in a loop were rejected for sync throughput reasons.
- **Response rehydration produces `normalizedData` at the SELECT projection.** Read queries that need to return an `EntityRecord` join `er__<entity_id>` and project `jsonb_build_object('<normalizedKey>', "<columnName>", …) AS normalized_data`. Per-entity, the cache exposes the projection expression. There is no in-process JSON-rebuild step; Drizzle hydrates `record.normalizedData` exactly as it does today.
- **Filter / sort / search SQL targets typed columns directly.** The `parseAndBuildFilterSQL`, `buildJsonbSortExpression`, and the list-endpoint search subquery are all rewritten to reference `er__<entity_id>` data columns. JSONB casts, regex guards (`buildNumericCondition`'s numeric-text regex, `buildJsonbSortExpression`'s CASE-cast), and `SORTABLE_COLUMN_TYPES` are deleted; every typed column is natively sortable and natively comparable.
- **API contract is invariant.** `EntityRecord.normalizedData: Record<string, unknown>` stays in `@portalai/core`. The Drizzle inferred select type loses `normalizedData`; the repository read methods return `EntityRecord & { normalizedData: Record<string, unknown> }` shapes by joining the wide table.
- **Destructive migration.** `entity_records.normalized_data` and its GIN index are dropped in the same Drizzle migration; `entity_records` is truncated; `er__<id>` tables are truncated by FK cascade. A one-shot re-sync trigger fires every live connector instance after deploy. No production data exists today (memory `project_no_production_data_yet.md`, dated 2026-05-08); destructive cuts are safe.
- **AlaSQL station load stays.** Phase 3 (formerly Phase 4) cuts AlaSQL. Phase 2 only changes where `loadStation` reads from: instead of spreading `record.normalizedData`, it spreads typed columns from the wide table. The AlaSQL surface itself, the surgical `apply*` mutations, and the `data_query` tool are untouched.
- **Capability gates are unchanged.** `assertWriteCapability` is metadata-only and does not move. Write routes call it before any wide-table statement is built; the gate runs first, identical to today.
- **Reconciler interlock with sync writes.** Sync writes acquire the per-entity advisory lock for the duration of the write transaction. The reconciler already acquires the same lock for DDL. The two paths serialize cleanly. A new sync write blocks if the reconciler is mid-DDL on the same entity, and vice versa.
- **Fifth metadata column: `source_id`.** Every wide table grows a denormalised `source_id text NOT NULL UNIQUE` column alongside `entity_record_id` / `organization_id` / `synced_at` / `is_valid`. The value is copied from `entity_records.source_id` at write time. The denormalisation lets cross-entity JOINs hit `er__<target> a ON a.source_id = d.c_<ref_col>` in a single hop instead of three (the alternative path goes through `entity_records.source_id` twice). This is owned by the reconciler (DDL) and the sync-write path (value source); no semantic change to references — they remain source-id strings, not `entity_records.id` values. See *Concept changes — Cross-entity references* below.

After this phase: `entity_records` rows have only the transactional shape (no `normalized_data` column, no GIN); the matching `er__<id>` row exists for every live record; every API list/get/patch/create/import endpoint produces the same response shape it did before; the data-table UI, advanced-filter builder, and stored filter expressions in `localStorage` continue to work; portal sessions still load via AlaSQL but the loader hits the wide table.

---

## Scope

### In scope

1. **Wide-table write surface** on `WideTableRepository`:
   - `upsertMany(connectorEntityId, rows, client?)` — bulk upsert via the cache's bulk-INSERT template. `rows` is a typed array shaped from the live data columns.
   - `softDeleteByEntityRecordIds(connectorEntityId, ids, client?)` — soft-delete cascade via the wide table's PK FK to `entity_records`.
   - `selectByEntityRecordIds(connectorEntityId, ids, client?)` — narrow read used by validation, related-records, and rehydration call sites.
2. **Statement cache extensions** on `WideTableStatementCache`:
   - `buildBulkInsertSql(connectorEntityId, batchSize, client?)` — multi-row VALUES list, parameterised with `$1..$N`.
   - `normalizedDataJsonbExpr(connectorEntityId, alias?, client?)` — returns the SQL fragment `jsonb_build_object('<normalizedKey>', "<columnName>", …)` keyed by **field-mapping `normalized_key`** (not `column_name`). Alias defaults to `w`.
   - `columnRefByNormalizedKey(connectorEntityId, normalizedKey, alias?, client?)` — returns the SQL identifier `"w"."c_<sanitized>"` for a given `normalizedKey`. Used by filter/sort SQL.
   - `searchableColumns(connectorEntityId, client?)` — list of `(columnName, pgType)` for text-like data columns (`text`, `text[]` flattened to text, `jsonb` cast to text). Backs the rewritten search subquery.
3. **Sync write transaction integration** in `LayoutPlanCommitService.writeRecords` (`apps/api/src/services/layout-plan-commit.service.ts:516+`):
   - After `entityRecordsRepo.upsertManyBySourceId(toUpsert, tx)`, call `wideTableRepo.upsertMany(entity.id, toUpsertWideRows, tx)` inside `withEntityLock(tx, entity.id, …)`.
   - The resurrection path (`bulkResurrect`) and the unchanged-only `bulkUpdateSyncedAt` path both extend identically.
   - The watermark sweep `softDeleteBeforeWatermark` ((`google-sheets.adapter.ts:145`) and friends) gets a wide-table-side `softDeleteByEntityRecordIds` call in the same transaction.
4. **REST entity-record routes** (`apps/api/src/routes/entity-record.router.ts`):
   - `GET /` (list) — filter / sort / search / column-projection / pagination all rewritten against the wide-table join. Response rehydration via `jsonb_build_object`.
   - `GET /:recordId` — single-row join + projection.
   - `PATCH /:recordId` — fans out the `normalizedData` payload into a typed UPDATE on `er__<id>`. The `entity_records` row's `validation_errors` and `is_valid` continue to be set on the transaction row.
   - `POST /` (create) and `POST /import` (bulk) — same fan-out via `wideTableRepo.upsertMany`.
   - `POST /clear` — soft-deletes via the wide-table cascade.
   - `POST /revalidate` — re-runs validation, then writes back via the same fan-out.
5. **Filter SQL primitives** (`apps/api/src/utils/filter-sql.util.ts`):
   - Operator builders (`buildStringCondition`, `buildNumericCondition`, `buildBooleanCondition`, `buildDateCondition`, `buildEnumCondition`, `buildArrayCondition`) drop their `jsonbText` plumbing and resolve `field` to a typed column reference via the cache.
   - `parseAndBuildFilterSQL` accepts a `connectorEntityId` (or a pre-built column-resolver) so it can build references; the API of this helper changes — every caller is in `entity-record.router.ts`.
   - The numeric-text regex guard, the date-text regex guard, and the `CASE WHEN value::text ~` casts all delete.
   - `SORTABLE_COLUMN_TYPES` deletes; every typed column is natively sortable.
6. **List-endpoint sort and search**:
   - `buildJsonbSortExpression` becomes `buildSortExpression(connectorEntityId, normalizedKey)` and returns a direct column reference. The transactional-field branch (`created`, `syncedAt`, `sourceId`) is untouched.
   - The `EXISTS (SELECT 1 FROM jsonb_each_text(normalized_data) …)` search predicate is replaced by `concat_ws(' ', "c_a"::text, "c_b"::text, …) ILIKE $1` over the cache's `searchableColumns`.
7. **Other server-side read sites** that today reach into `record.normalizedData`:
   - `analytics.service.ts:loadStation` (line 383) — fetches via `wideTableRepo.selectByEntityRecordIds` (or full `selectAll`) and spreads the wide-row payload into AlaSQL with the `c_`-prefix stripped. AlaSQL surface is otherwise unchanged.
   - `entity-group.router.ts:940` — link-resolution SQL joins `er__<id>` and references the typed column for the linkage field.
   - `entity-group-member.router.ts:743, 767` — linkage-summary lookup hydrates the rehydrated `normalizedData` (preferred) or reads the typed column directly (equivalent).
   - `field-mapping.router.ts:1173, 1182` — bidirectional-consistency check rehydrates `normalizedData` before iterating.
   - `record-import.util.ts:125` — record-import upserts go through `wideTableRepo.upsertMany`.
   - `entity-record-create.tool.ts:121`, `entity-record-update.tool.ts:160` — portal mutation tools fan out to the wide table.
   - `revalidation.processor.ts:59, 84, 94` — the `record.data ?? record.normalizedData` fallback is **deleted**; `data` is always populated by every write path. Revalidation writes `validation_errors` / `is_valid` onto `entity_records` and the recomputed normalized values onto `er__<id>`.
   - `adapter.util.ts:110` (`importModeQueryRows`) — fetches via the wide-table read path.
   - `prompts/system.prompt.ts:99` — the `normalizedData` reference in the schema documentation is rewritten to describe the wide-table shape (informational only; LLM-visible).
8. **Schema + repository slim-down**:
   - `apps/api/src/db/schema/entity-records.table.ts` — drop `normalizedData` column, drop `entity_records_normalized_data_gin` index.
   - `apps/api/src/db/schema/zod.ts` — regenerate select/insert schemas for `entityRecords`.
   - `apps/api/src/db/schema/type-checks.ts` — assignability now compares against `EntityRecordHydrated = EntityRecordSelect & { normalizedData: Record<string, unknown> }`. The hydrated type is what the repository returns; the bare select type is what the table inference produces.
   - `apps/api/src/db/repositories/entity-records.repository.ts` — drop `normalizedData` from `upsertBySourceId` / `upsertManyBySourceId` / `bulkResurrect`. Reads return the hydrated shape (the join is repository-internal). The repository depends on `wideTableStatementCache.normalizedDataJsonbExpr` to build the projection.
9. **Drizzle migration `<timestamp>_entity_records_drop_normalized_data.sql`**:
   ```sql
   DROP INDEX IF EXISTS "entity_records_normalized_data_gin";
   TRUNCATE TABLE "entity_records" CASCADE;
   ALTER TABLE "entity_records" DROP COLUMN "normalized_data";
   ```
   The `CASCADE` clears every `er__<id>` row by FK cascade.
10. **Re-sync trigger** — a one-shot service `apps/api/src/services/wide-table-resync.service.ts` exposing `resyncAllConnectorInstances()`, plus a privileged admin route (`POST /api/admin/wide-table/resync`) that the operator invokes after deploy. The service iterates every live `connector_instances` row and calls the same sync entry point each adapter uses. Tests cover idempotency (re-running is safe).
11. **Tests** — see *Tests* below.

### Out of scope

- **AlaSQL deletion** and `data_query` Postgres-direct. New phase 3 (formerly phase 4).
- **`validateSql` rewrite, view-aliasing, math-method port.** New phase 3.
- **Steady-state polish:** retired-column drop maintenance job, type-change backfill stager, schema-per-org partitioning. New phase 4.
- **Web-app changes.** Zero. The data-table, advanced-filter builder, persisted localStorage filter expressions all continue to work because the API contract is invariant.
- **Storybook updates.** Stories drive `*UI` components from props; they are unaffected.
- **Capability-flag changes.** `assertWriteCapability` and the read-capability scoping at the entity level are untouched. Write gates run before any wide-table statement is built.
- **The raw `data` JSONB column.** Stays. It is the audit trail of what the connector delivered before mapping.

---

## Concept changes

### Cross-entity references

References (`reference`, `reference-array` typed columns) carry the **target row's `source_id`**, not the target row's `entity_records.id`. This is the existing JSONB behaviour preserved verbatim — `coerceReference` (`apps/api/src/utils/coercion.util.ts:184`) is `String(value)` with no lookup, and `bidirectional-consistency` (`apps/api/src/routes/field-mapping.router.ts:1095+`) compares source-ids on both sides. Phase 2 keeps the contract.

To make cross-entity JOINs cheap, every wide table denormalises a fifth metadata column `source_id text NOT NULL UNIQUE`. The value is `entity_records.source_id` at write time. A "deals → accounts" join collapses from three hops to one:

```sql
SELECT d.c_amount, a.c_name AS account_name
FROM "er__<deals_id>"    d
JOIN "er__<accounts_id>" a ON a.source_id = d.c_account_ref
WHERE …;
```

`WIDE_TABLE_METADATA_COLUMNS` becomes `["entity_record_id", "organization_id", "synced_at", "is_valid", "source_id"]`. The set propagates everywhere the cache and reconciler reference it: `ensureTable` SQL grows the column + a unique index, `selectAllSql` includes it, `insertSqlTemplate` includes it, `normalizedDataJsonbExpr` *excludes* it (it's metadata, not user data), `projectToWideRow` populates it from the record's `sourceId`. Reconciler diff/apply logic is unchanged otherwise; the column is fixed-shape, not field-mapping-driven.

### Read shape

The repository's read methods produce an `EntityRecordHydrated` row by joining `er__<entity_id>`:

```sql
SELECT
  er.*,
  <wideTableStatementCache.normalizedDataJsonbExpr(entityId, alias='w')>  AS normalized_data
FROM entity_records er
JOIN "er__<entityId>" w ON w.entity_record_id = er.id
WHERE …;
```

The expression is per-entity and stable across requests — the cache rebuilds it on schema change. Drizzle hydrates `record.normalizedData` exactly as it did when the JSONB column existed.

### Write shape

The sync write path ends with two coordinated upserts inside one transaction:

```ts
await DbService.transaction(async (tx) => {
  // …existing entity, field-mapping, soft-delete prep…

  await withEntityLock(tx, entity.id, async (locked) => {
    if (toUpsert.length > 0) {
      await DbService.repository.entityRecords.upsertManyBySourceId(toUpsert, locked);
      await DbService.repository.wideTable.upsertMany(
        entity.id,
        toUpsert.map((r) => projectToWideRow(r, entity.id, mappings)),
        locked
      );
    }
    if (toResurrect.length > 0) {
      await DbService.repository.entityRecords.bulkResurrect(toResurrect, locked);
      await DbService.repository.wideTable.upsertMany(
        entity.id,
        toResurrect.map((r) => projectToWideRow(r.data, entity.id, mappings, { id: r.id })),
        locked
      );
    }
    // unchangedIds: bulkUpdateSyncedAt only — `synced_at` lives on entity_records, not on the wide table.
  });
});
```

`projectToWideRow` is a pure helper (`apps/api/src/services/wide-table-projection.util.ts`, new) that takes an `EntityRecordInsert` plus the entity's field-mapping → column-name map and produces an object matching the cache's INSERT column list. The metadata block it produces is `{ entity_record_id, organization_id, synced_at, is_valid, source_id }` — five fields, not four — and `source_id` comes straight from `record.sourceId`.

### Filter / sort / search

Per-entity, the cache exposes `columnRefByNormalizedKey`. Operator builders take that map (or a closure over it) and emit identifier references:

```ts
// before
buildNumericCondition(jsonbText("normalized_data", "amount"), op, value)
// after
buildNumericCondition(columnRef("amount"), op, value)
```

`columnRef("amount")` returns `sql`"w"."c_amount"`` (or whatever sanitization produced for that `normalizedKey`). The operator builders no longer cast — the column is already typed.

Search is one expression per entity:

```sql
WHERE concat_ws(' ',
  "w"."c_name"::text,
  "w"."c_description"::text,
  array_to_string("w"."c_tags", ' ')::text,
  "w"."c_payload"::text
) ILIKE $search
```

Cached as `searchableConcatSql` on the entity's cache entry.

### Hydrated repository return type

`@portalai/core/contracts.EntityRecord` keeps `normalizedData`. The Drizzle `EntityRecordSelect` loses it. Reconcile via:

```ts
// apps/api/src/db/repositories/entity-records.repository.ts
export type EntityRecordHydrated = EntityRecordSelect & {
  normalizedData: Record<string, unknown>;
};
```

Every repository read method returns `EntityRecordHydrated[]` (or one). The type-check in `db/schema/type-checks.ts` asserts `IsAssignable<EntityRecord, EntityRecordHydrated>` and `IsAssignable<EntityRecordHydrated, EntityRecord>`. Bare-Drizzle assignability against the table inference is no longer asserted for `entityRecords`.

---

## Surface

### `WideTableRepository` additions

**File: `apps/api/src/db/repositories/wide-table.repository.ts`** (edit)

```ts
async upsertMany(
  connectorEntityId: string,
  rows: ReadonlyArray<Record<string, unknown>>,
  client: DbClient = db
): Promise<void>;

async softDeleteByEntityRecordIds(
  connectorEntityId: string,
  ids: ReadonlyArray<string>,
  client: DbClient = db
): Promise<void>;

async selectByEntityRecordIds(
  connectorEntityId: string,
  ids: ReadonlyArray<string>,
  client: DbClient = db
): Promise<Record<string, unknown>[]>;
```

`upsertMany` builds the bulk INSERT via `statementCache.buildBulkInsertSql(entityId, rows.length, client)`, binds parameters in the order returned by `cachedStatements.columns` (metadata first, then data columns), and executes against the supplied client. Rows missing a data column bind `NULL` (caller is responsible for omitting unmapped fields). Caller MUST hold the entity advisory lock for the transaction.

`softDeleteByEntityRecordIds` is a no-op — wide-table rows go away by FK cascade when `entity_records.deleted` is set… **except** the wide table doesn't store `deleted` and the FK is `ON DELETE CASCADE`, not "on soft-delete". So this method actually issues `DELETE FROM "er__<id>" WHERE entity_record_id = ANY($1)`. Hard-delete is the right semantic: a soft-deleted `entity_records` row is invisible to queries, and the wide-table row would never be read again anyway. (Re-syncing the same source-id after a soft-delete goes through the `bulkResurrect` path, which re-upserts the wide row.)

### `WideTableStatementCache` extensions

**File: `apps/api/src/services/wide-table-statement.cache.ts`** (edit)

The `CachedStatements` interface gains:

```ts
interface CachedStatements {
  // existing
  selectAllSql: string;
  insertSqlTemplate: string;
  columns: ReadonlyArray<WideTableCachedColumn>;
  schemaVersion: number;

  // new
  /** SQL fragment producing a JSONB blob keyed by normalizedKey. Alias=`w` by default. */
  normalizedDataJsonbExpr: (alias?: string) => string;
  /** Map normalizedKey → sql identifier `"<alias>"."<columnName>"`. */
  columnRefByNormalizedKey: Map<string, (alias?: string) => string>;
  /** ILIKE-able concat expression of every text-shaped data column. */
  searchableConcatSql: (alias?: string) => string;
}
```

`buildBulkInsertSql(connectorEntityId, batchSize)` is a method on the cache class (not on `CachedStatements` — it depends on `batchSize` so it can't be precomputed once). It returns the full SQL string and the parameter count.

The `normalizedKey` for each column comes from joining `wide_table_columns.field_mapping_id` to `field_mappings.normalized_key`. The cache's `build()` method gains a join (one extra read per rebuild). `searchableColumns` filters columns whose `pgType` ∈ {`text`, `jsonb`, `text[]`}; the concat list quotes accordingly (`"col"::text` for scalars, `array_to_string("col", ' ')` for `text[]`, `"col"::text` for `jsonb`).

### Sync write path

**File: `apps/api/src/services/layout-plan-commit.service.ts`** (edit)

Inside the per-entity `DbService.transaction(async (tx) => …)` block (around line 315+), after `reconcileFieldMappings` and `LayoutPlanCommitService.writeRecords`:

```ts
await withEntityLock(tx, entity.id, async (locked) => {
  // existing writes use `tx`; pass `locked` so they happen inside the lock.
  // Or, easier: move the entire writeRecords body inside withEntityLock.
});
```

Actual placement: `writeRecords` is the function that builds `toUpsert`, `toResurrect`, and `unchangedIds`. Wrap its tail (the three `if` blocks at lines 664–679) in `withEntityLock`, and add the wide-table calls in the same scope.

`projectToWideRow` (new helper, `apps/api/src/services/wide-table-projection.util.ts`) takes the entity-record insert plus the entity's `(normalizedKey → columnName)` map and produces a flat row object with metadata columns set:

```ts
projectToWideRow(record, entityId, mappings) →
  { entity_record_id: record.id,
    organization_id: record.organizationId,
    synced_at: record.syncedAt,
    is_valid: record.isValid,
    c_amount: record.normalizedData["amount"],
    c_close_date: record.normalizedData["close_date"],
    … }
```

For the resurrection branch (line 619+), the same projection runs against the resurrected payload; `entity_record_id` is the existing row's id.

For the watermark sweep:

**File: `apps/api/src/adapters/google-sheets/google-sheets.adapter.ts:145`** (edit) and equivalents — when `softDeleteBeforeWatermark` returns the soft-deleted ids, call `wideTableRepo.softDeleteByEntityRecordIds(entityId, ids, tx)` in the same transaction.

### Filter / sort / search rewrite

**Files edited:**

- `apps/api/src/utils/filter-sql.util.ts` — operator builders take a `columnRef: (key: string) => SQL` instead of building `jsonbText` expressions inline. `parseAndBuildFilterSQL(connectorEntityId, expr, opts)` resolves the resolver via `wideTableStatementCache.get(connectorEntityId)` and passes per-call resolvers down. Numeric, date, boolean, and array casts delete.
- `apps/api/src/routes/entity-record.router.ts` — `buildJsonbSortExpression` is replaced by `buildSortExpression(cachedStatements, normalizedKey)`. The transactional-field map (`SORTABLE_COLUMNS` for `created`, `syncedAt`, `sourceId`) stays. Search subquery is replaced by `cachedStatements.searchableConcatSql() ILIKE $search`.
- `apps/api/src/utils/filter-sql.util.ts` — `SORTABLE_COLUMN_TYPES` deletes.

`parseAndBuildFilterSQL` API change is breaking but local — every call site is in `entity-record.router.ts`. The existing error code `ENTITY_RECORD_INVALID_FILTER` continues to surface; only its message text might mention "unknown column" instead of "unsupported jsonb type" in some branches.

### REST routes

**File: `apps/api/src/routes/entity-record.router.ts`** (edit)

Each handler that today reads `record.normalizedData`:

- **`GET /` (list)** — the FROM clause becomes `entity_records er JOIN "er__<entityId>" w ON w.entity_record_id = er.id`. The SELECT projects `er.*` and the rehydrated `normalized_data` jsonb. WHERE is a combination of `er.connector_entity_id = …`, the rewritten search, and `parseAndBuildFilterSQL` output. ORDER BY uses the new sort expression. The `columns` query parameter today filters keys out of `record.normalizedData` post-fetch — after the rewrite, it instead narrows the `normalizedDataJsonbExpr` projection (build a per-request `jsonb_build_object` containing only the requested keys).
- **`GET /:recordId`** — same join + projection.
- **`POST /` (create)** — the validated `normalizedData` payload is written: insert into `entity_records` (no `normalizedData` column), then call `wideTableRepo.upsertMany(entityId, [projectToWideRow(…)], tx)`. Both inside one transaction with the entity lock.
- **`POST /import` (bulk)** — per-batch `wideTableRepo.upsertMany`.
- **`PATCH /:recordId`** — partial-merge validation runs; the result is fanned out via `wideTableRepo.upsertMany(entityId, [oneRow], tx)` (upsert is idempotent on the existing row by PK). `entity_records.validation_errors` / `is_valid` updates on the transaction row.
- **`POST /clear`** — `entityRecordsRepo.softDeleteMany(...)` and `wideTableRepo.softDeleteByEntityRecordIds(entityId, ids, tx)` in one transaction. The wide-table call is a hard delete by design (see *Surface*).
- **`POST /revalidate`** — re-runs validation, then writes back via the same fan-out.

The `assertWriteCapability` call at every write route stays exactly where it is — first call before any wide-table or `entity_records` statement is issued.

### Other read sites

Each is a small, local change. None requires re-architecting.

| Site | Change |
|---|---|
| `analytics.service.ts:loadStation` (`383`) | Replace `repo.entityRecords.findByConnectorEntityId(entity.id)` + `.normalizedData` spread with `wideTableRepo.selectAll(entity.id)` + a helper that strips `c_` and renames to `normalizedKey` using the cache's `(columnName → normalizedKey)` inverse map. Synthetic `_record_id` / `_connector_entity_id` columns continue to be projected. AlaSQL `CREATE TABLE` and `INSERT` calls unchanged. |
| `entity-group.router.ts:940` | Resolution query joins `er__<id>` and references the typed column via `cache.columnRefByNormalizedKey`. |
| `entity-group-member.router.ts:743, 767` | Iterates over the rehydrated `normalizedData` (now produced by the repository's read path). No SQL change here; the existing in-memory access pattern survives because the response shape is invariant. |
| `field-mapping.router.ts:1173, 1182` | Same — read goes through the rehydrated repo method; iteration unchanged. |
| `record-import.util.ts:125` | Bulk import call now writes to wide table via `wideTableRepo.upsertMany(...)` in the same transaction. |
| `entity-record-create.tool.ts:121` | Same. |
| `entity-record-update.tool.ts:160` | Same. |
| `revalidation.processor.ts:59` | The fallback `record.data ?? record.normalizedData` becomes `record.data` only. Audit confirms every write path populates `data`. |
| `revalidation.processor.ts:84, 94` | Batch update now calls `wideTableRepo.upsertMany(...)` in addition to the entity-records update. |
| `adapter.util.ts:110` | `importModeQueryRows` reads from the rehydrated repo; in-memory shape preserved. |
| `prompts/system.prompt.ts:99` | The schema-doc paragraph that mentions `normalizedData` JSONB is rewritten. (The LLM still queries AlaSQL in this phase — phase 3 is what kills AlaSQL.) |

### Migration

**Files:**

- New: `apps/api/drizzle/<timestamp>_entity_records_drop_normalized_data.sql` — generated by `npm run db:generate -- --name entity_records_drop_normalized_data`.
- Edit: `apps/api/src/db/schema/entity-records.table.ts` — drop the `normalizedData` field and the `entity_records_normalized_data_gin` index from the Drizzle definition.
- Edit: `apps/api/src/db/schema/zod.ts` — regenerated select / insert schemas.

Migration body:

```sql
DROP INDEX IF EXISTS "entity_records_normalized_data_gin";
TRUNCATE TABLE "entity_records" CASCADE;
ALTER TABLE "entity_records" DROP COLUMN "normalized_data";
```

Truncate happens before drop-column so the cascade clears `er__<id>` rows by their `entity_record_id REFERENCES entity_records(id) ON DELETE CASCADE` FK. After the migration, every `er__<id>` table is empty and ready for the re-sync trigger to refill.

### Re-sync trigger

**File: `apps/api/src/services/wide-table-resync.service.ts`** (new)

```ts
export interface ResyncReport {
  /** Job ids enqueued via `SyncService.enqueueSync`. One per instance newly enqueued. */
  triggered: string[];
  /** Instance ids that already had an active sync job (409 from `assertNoActiveSyncJob`). */
  skippedInFlight: string[];
  /** Instance ids whose adapter does not implement `syncInstance` (e.g. `sandbox`). */
  skippedUnsupported: string[];
  /** Per-instance enqueue failures (adapter lookup error, queue error, etc.). */
  failed: Array<{ instanceId: string; error: string }>;
}

export const wideTableResyncService = {
  /**
   * One-shot trigger run after the destructive migration. Iterates every
   * live connector_instance and enqueues a sync job per instance via
   * `SyncService.enqueueSync`. Skips instances with an in-flight sync and
   * adapters that do not support `syncInstance`. Returns immediately with
   * the enqueued job ids; per-instance progress is observable through
   * BullMQ / the existing job-progress UI.
   *
   * Idempotent — re-running picks up any instance that has no active job
   * and re-enqueues it.
   */
  async resyncAllConnectorInstances(actorUserId: string): Promise<ResyncReport>;
};
```

**File: `apps/api/src/routes/admin.router.ts`** (edit, or new) — `POST /api/admin/wide-table/resync` (auth-gated) calls the service with `req.application!.metadata.userId` as the actor and returns the `ResyncReport`. The route is fire-and-forget per instance: each enqueued sync runs in BullMQ on its own.

The dispatch chain that already exists:

1. `SyncService.enqueueSync({ connectorInstanceId, organizationId, userId })` (`apps/api/src/services/sync.service.ts:169`) creates a BullMQ job in the `connector-sync` queue.
2. `connectorSyncProcessor` (`apps/api/src/queues/processors/connector-sync.processor.ts:22`) picks the job up, looks up the adapter via `ConnectorAdapterRegistry.get(definition.slug)`, and calls `adapter.syncInstance(instance, userId, progress)`.
3. `SyncService.assertNoActiveSyncJob(connectorInstanceId)` (`apps/api/src/services/sync.service.ts:84`) is the in-flight guard — the trigger calls `findActiveSyncJob` directly to decide whether to enqueue. (We intentionally don't call `assertNoActiveSyncJob` because it throws; the trigger reports skips, not errors.)

The trigger introduces no new adapter surface and no new queue. It's a fan-out over existing primitives.

### Error codes

`apps/api/src/constants/api-codes.constants.ts` — no new codes. `WIDE_TABLE_RECONCILE_FAILED` and friends are reused at the write seam if a wide-table upsert errors. The existing `ENTITY_RECORD_INVALID_FILTER` continues to surface on filter-SQL build errors.

---

## Tests

Naming and placement follow phase 1: integration tests under `apps/api/src/__tests__/__integration__/…`, unit tests beside their target.

### Reconciler `source_id` metadata column (slice 0)

**`apps/api/src/__tests__/__integration__/services/wide-table-reconciler.service.integration.test.ts`** (extended from phase 1's suite)

A. **`ensureTable` creates the `source_id` metadata column.** A freshly reconciled `er__<id>` has all five metadata columns: `entity_record_id`, `organization_id`, `synced_at`, `is_valid`, `source_id`.
B. **`source_id` is `text NOT NULL` with a unique index.** Inspect `information_schema.columns` and `pg_indexes`; the unique index is named `er__<id>_source_id_unique`.
C. **Existing wide tables get the column added by the slice-0 backfill.** Pre-create an `er__<id>` table with the four phase-1 metadata columns only; run the slice-0 migration; assert the table now has `source_id` and the unique index. (Wide tables are empty at this point so `NOT NULL` add-column is safe.)
D. **`WIDE_TABLE_METADATA_COLUMNS` reflects the new shape** — referenced by the cache builder; assert the constant exposes the five-column tuple.

### Wide-table repository (`WideTableRepository`)

**`apps/api/src/__tests__/__integration__/db/repositories/wide-table.repository.integration.test.ts`** (new)

1. **`upsertMany` writes one row per record** with metadata + every live data column populated. `source_id` is set from `record.sourceId`.
2. **`upsertMany` is idempotent** — second call with same rows updates in place; row count unchanged.
3. **`upsertMany` honours retired columns** — a retired column's value is silently dropped (caller may pass it; cache excludes it; bind list ignores it).
4. **`upsertMany` updates only the data columns supplied** — partial-merge case (PATCH); columns not in the payload retain their previous values via `EXCLUDED.<col>` only on the supplied columns. *(If the cache's INSERT shape doesn't support partial — see Risks — this case becomes a "patch path goes through a separate UPDATE" test.)*
5. **`upsertMany` rejects rows missing the PK** with a structured error.
6. **`softDeleteByEntityRecordIds` removes rows** via the wide-table path (hard delete; no soft-delete column on the wide side).
7. **`softDeleteByEntityRecordIds` ignores ids not present** without throwing.
8. **`selectByEntityRecordIds` returns one row per requested id** in arbitrary order.
9. **`upsertMany` is FK-cascaded by `DROP entity_records row`** — a hard delete on `entity_records` removes the wide row (already exercised by phase 1's `dropTable`, repeated here for the row-level cascade).

### Statement cache extensions

**`apps/api/src/__tests__/services/wide-table-statement.cache.test.ts`** (edit)

10. **`buildBulkInsertSql(entityId, 3)`** produces three VALUES tuples with `$1..$N` placeholders matching `columns.length × 3 + metadataColCount × 3` total parameters.
11. **`buildBulkInsertSql(entityId, 0)`** throws (caller invariant).
12. **`normalizedDataJsonbExpr` keys by `normalizedKey`, not `columnName`** — given a column `c_amount_total` for a field-mapping with `normalized_key = 'amount_total'`, the expression contains `'amount_total', "w"."c_amount_total"`.
13. **`columnRefByNormalizedKey('amount_total')` returns `"w"."c_amount_total"`** by default.
14. **`searchableConcatSql` includes `text` columns and excludes `numeric` / `boolean`** — emits `concat_ws(' ', "c_a"::text, …)`.
15. **`searchableConcatSql` arrays use `array_to_string`** — a `text[]` column produces `array_to_string("c_tags", ' ')::text`.
16. **`searchableConcatSql` jsonb cells cast to text** — a `jsonb` column produces `"c_payload"::text`.
17. **Cache invalidation rebuilds the new fields** — `invalidate(entityId)` then `get(entityId)` returns a new `searchableConcatSql` reflecting any retired columns.

### Sync write integration

**`apps/api/src/__tests__/__integration__/services/layout-plan-commit.service.integration.test.ts`** (edit)

18. **A clean sync writes both stores in one transaction.** Assert `entity_records` has the row (no `normalizedData` field) AND `er__<id>` has the row with each `c_*` column populated.
19. **Resurrection writes the wide row.** Soft-delete a row, then re-sync the same `source_id`; assert the wide-table row is upserted (or re-inserted).
20. **Watermark sweep cascades to the wide table.** Soft-delete by watermark; assert the wide row is hard-deleted.
21. **The transaction rolls both back on failure.** Inject a failure between the entity-records upsert and the wide-table upsert; assert neither side commits.
22. **The advisory lock serialises sync and reconciler.** Two concurrent operations on the same entity (a sync write + a `reconcileEntity`) complete sequentially; the wall-clock ordering shows them ordered.

### REST list endpoint

**`apps/api/src/__tests__/__integration__/routes/entity-record.router.integration.test.ts`** (edit; the existing list-endpoint suite expands)

23. **List response shape unchanged.** Existing assertions on `EntityRecord` shape continue to pass; `normalizedData` is present and equal to what was written.
24. **Filter on a `numeric` column.** `amount > 50000` matches the rows that were written with `amount: 60000` and excludes the rows with `amount: 40000`.
25. **Filter on a `date` column.** Range filter on `close_date` works without regex guards.
26. **Filter on a `boolean` column.** Equality on `is_active` works.
27. **Filter on a `string` column with `ILIKE`.** Substring match on `name`.
28. **Filter on `array` column with contains.** Postgres `@>` against the typed `text[]` column.
29. **Sort by a numeric column ascending and descending.** Ordering reflects numeric, not lexicographic, comparison (regression net for the JSONB CASE-cast that today's code uses).
30. **Sort by a date column.** Same.
31. **Search across multiple text columns.** `?search=acme` matches rows where ANY text-shaped column contains 'acme'.
32. **Column projection narrows `normalizedData`.** `?columns=amount,close_date` returns `normalizedData` containing only those two keys.
33. **Pagination + sort + filter together.** Standard combination smoke test.
34. **Stored advanced-filter expression survives the rewrite.** Round-trip the same `FilterExpression` JSON the web app produces; expect identical row sets to a hand-written equivalent.

### REST single-record + write endpoints

**Same test file (edit)**

35. **`GET /:recordId` returns a hydrated record.** `normalizedData` populated from the wide table.
36. **`POST /` writes both stores.** Create endpoint persists; subsequent `GET` returns the written values.
37. **`PATCH /:recordId` updates only the supplied keys.** Other keys retain prior values.
38. **`POST /import` writes a batch.** Verify the wide-table count matches.
39. **`POST /clear` cascades to the wide table.** Wide-table rows for the cleared records are gone.
40. **`POST /revalidate` recomputes and persists.** `validation_errors` updates on `entity_records`; `er__<id>` row reflects the recomputed values.
41. **`assertWriteCapability` runs first.** Call against a write-disabled instance; expect 422 with `CONNECTOR_INSTANCE_WRITE_DISABLED`; verify no wide-table row was written.

### Other read sites

42. **`AnalyticsService.loadStation` reads from the wide table.** Spy on `wideTableRepo.selectAll`; verify it's called instead of `entityRecordsRepo.findByConnectorEntityId` for normalized data. AlaSQL still loads; first `data_query` succeeds.
43. **Entity-group resolve joins the wide table.** Existing route test passes with the rewritten SQL.
44. **Entity-group-member linkage-summary** continues to return the correct linkage. Existing test passes.
45. **Field-mapping bidirectional consistency** continues to flag broken references. Existing test passes.
46. **Revalidation processor** runs without ever taking the `normalizedData` fallback. Test seeds a record with `data: null` (legacy fixture) and expects revalidation to skip it cleanly with a structured error — fallback path is gone.

### Drop migration

**`apps/api/src/__tests__/__integration__/db/migrations/entity_records_drop_normalized_data.test.ts`** (new)

47. **Migration is forward-applicable.** Apply against a freshly seeded database with rows in `entity_records`; assert the column and GIN index are gone, `entity_records` is empty, `er__<id>` rows are gone.
48. **`entity_records` schema after migration matches the updated Drizzle table.** Assert `information_schema.columns` for `entity_records` is precisely the post-migration set (no `normalized_data`).

### Re-sync trigger

**`apps/api/src/__tests__/__integration__/services/wide-table-resync.service.integration.test.ts`** (new)

49. **`resyncAllConnectorInstances` enqueues one job per live, sync-capable instance.** Seed N live instances (mix of google-sheets, microsoft-excel, sandbox) plus one soft-deleted; assert `triggered.length` equals the live-and-sync-capable count, `skippedUnsupported` includes the sandbox instance ids, soft-deleted instances are absent from every list. Each `triggered` id is a real BullMQ job in the `connector-sync` queue.
50. **`resyncAllConnectorInstances` skips instances with an in-flight job.** Pre-enqueue a sync for one instance via `SyncService.enqueueSync`; call the trigger; assert that instance appears in `skippedInFlight` (not `triggered`) and the existing job id is unchanged. Re-running the trigger after that job completes re-enqueues the instance — confirms the trigger is idempotent w.r.t. terminal job state.

### Test totals

- Reconciler `source_id` metadata (slice 0): 4 cases (A–D).
- Wide-table repository: 9 cases (1–9).
- Statement cache extensions: 8 cases (10–17) — case 12's JSONB-expr test asserts `source_id` is excluded; case 14's searchable-cols test asserts `source_id` is excluded.
- Sync write integration: 5 cases (18–22) — case 18 asserts `source_id` round-trips from `entity_records.source_id` into the wide row.
- REST list endpoint: 12 cases (23–34).
- REST single-record + write endpoints: 7 cases (35–41).
- Other read sites: 5 cases (42–46).
- Drop migration: 2 cases (47–48).
- Re-sync trigger: 2 cases (49–50).

**Total 54 new test cases** (4 slice-0 + 50 phase-2-body; some existing route tests shift from "tests JSONB shape" to "tests rehydrated shape" without becoming new cases).

---

## Acceptance criteria

- [ ] All 54 new test cases pass (4 slice-0 + 50 phase-2-body).
- [ ] Every wide table on disk has the five metadata columns: `entity_record_id`, `organization_id`, `synced_at`, `is_valid`, `source_id` — verified by `psql -c "\d er__*"`. Each has the `er__<id>_source_id_unique` index.
- [ ] `cd apps/api && npm run test:unit && npm run test:integration` is green.
- [ ] `npm run lint && npm run type-check` from repo root are clean.
- [ ] `npm run db:migrate` against a freshly migrated database (post-phase-1) applies the new drop migration cleanly.
- [ ] `npm run dev` boots cleanly; the boot drift check from phase 1 still passes; the API serves a `GET /api/connector-entities/:id/records` request that returns hydrated records (verified by manual `curl`).
- [ ] `psql -c "\d entity_records"` shows no `normalized_data` column and no `entity_records_normalized_data_gin` index.
- [ ] `grep -rn "normalizedData\|normalized_data" apps/api/src` returns matches **only** inside:
  - `db/schema/zod.ts` and `db/schema/type-checks.ts` (for the hydrated select type).
  - `db/repositories/entity-records.repository.ts` and `db/repositories/wide-table.repository.ts` (the rehydration projection).
  - `services/wide-table-statement.cache.ts` and `services/wide-table-projection.util.ts` (the projection helpers).
  - `services/wide-table-reconciler.service.ts` (unchanged from phase 1; references field-mapping `normalizedKey`).
  - Tests.
  - `prompts/system.prompt.ts` if the prompt continues to mention the contract field name (informational).
- [ ] `grep -rn "normalizedData\|normalized_data" apps/web/src` returns matches **only** in unchanged web-app code (the contract is invariant).
- [ ] After running the re-sync trigger against a seeded multi-connector dev environment, `SELECT count(*) FROM entity_records` matches `SELECT sum(c) FROM (SELECT count(*) AS c FROM "er__<id>" GROUP BY tableoid) t` — every transactional row has exactly one wide-table row.
- [ ] `EntityRecord.normalizedData` returned by every list / get / patch / create / import endpoint is byte-equivalent to what the same endpoint returned before phase 2 for an equivalent input. (Snapshot test on a representative fixture.)
- [ ] Web-app smoke test: open `Entities.view` → click into an entity → verify list, advanced filter, sort, search, column projection, edit dialog, create dialog, clear, revalidate all behave as before. No frontend code changed.

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Sync write transaction grows large enough to bottleneck under bulk imports. | The wide-table upsert is one bulk INSERT — same shape as `entity_records.upsertManyBySourceId`. The advisory lock holds for the duration; phase 1's reconciler already accepts that contract. If wall-clock latency on big batches becomes a problem, the bulk size is bounded by the existing per-batch chunking in `LayoutPlanCommitService.writeRecords`. |
| `WideTableStatementCache` ON CONFLICT clause overwrites *every* live data column on every upsert, but PATCH wants partial merge. | The bulk template is an "upsert all" semantically. PATCH paths build a **separate** UPDATE statement that touches only the supplied columns. The cache exposes `columnRefByNormalizedKey` so the PATCH builder constructs `UPDATE "er__<id>" SET "c_amount" = $1, "c_close_date" = $2 WHERE entity_record_id = $3` per call. (This is why test case 4 has the conditional in *Tests*.) |
| `normalizedKey` and `columnName` mapping drifts after a rename. | Phase 1's reconciler is the only DDL author; it writes both `wide_table_columns.column_name` and the underlying Postgres column atomically. The cache reads `(normalizedKey, columnName)` from the same row. Drift would require a code path outside the reconciler to mutate one without the other — none exists. |
| Filter / sort SQL behavior changes subtly because typed columns sort/compare differently from JSONB-cast text. | Tests 24–30 are explicit regression nets for numeric, date, boolean, and array operators. Snapshot tests on the list-endpoint response confirm shape parity. Any case where the new behavior is **more** correct (numeric ordering of "10" vs. "9" being numerically right rather than lexicographically) is the desired direction. |
| The destructive migration runs against a database with data someone cared about. | Memory `project_no_production_data_yet.md` (2026-05-08) confirms no production data exists. The migration's `TRUNCATE` is intentional. The runbook for the cutover has the operator confirm this in writing before the deploy. |
| Re-sync trigger fails partway through (a particular adapter errors). | Each adapter's sync runs in its own try/catch; partial completion is acceptable because re-running the trigger is idempotent. The trigger logs per-instance success/failure and exits 0 even on partial failure (operator inspects logs). Failed instances can be retried individually via the existing per-instance sync admin route. |
| `loadStation` change breaks portal sessions. | The shape spread into AlaSQL is identical (`{ _record_id, _connector_entity_id, ...normalizedKeyedValues }`); only the source changes. Test 42 exercises one full session through the new path. |
| Drizzle's typed select inference no longer matches the API contract. | `EntityRecordHydrated` makes the asymmetry explicit. Any caller that uses the bare table inference (rather than the hydrated type from the repository) will be flagged by the type-checker. |
| `revalidation.processor` legacy fallback removal breaks an in-flight job. | The fallback path is the only protection against `data IS NULL`; every write path populates `data` (verified by `grep`). If an in-flight job exists with `data IS NULL`, it surfaces a structured error and is skipped (test 46). The operator re-syncs to repopulate. |
| The migration's `TRUNCATE … CASCADE` deletes more than `entity_records` + `er__<id>` rows. | Dry-run on staging first. The cascade fans out only through FKs that name `entity_records(id)` as the parent — confirmed by `pg_constraint` introspection in the migration test. The expected fan-out: `er__<id>` (every entity), and any secondary table that lists `entity_records.id` as an FK target (audit before merge). |

**Rollback** within this phase: revert the merge commit. The reverse migration restores `normalized_data` and the GIN. `entity_records` is empty after rollback (forward migration truncated); a re-sync repopulates `normalized_data` via the *old* sync write path, exactly as before phase 2.

If rollback happens *after* the re-sync trigger has populated rows, the wide-table rows survive (they're not in the `entity_records` rollback path) and the reconciler will recreate any tables phase 1 dropped. The system is in the post-phase-1 state with extra rows in `er__<id>` that nothing reads — harmless and reaped on the next re-sync.

---

## Files touched

### `apps/api`

**New:**

- `src/services/wide-table-projection.util.ts` — `projectToWideRow(record, entityId, mappings)`.
- `src/services/wide-table-resync.service.ts` — re-sync trigger.
- `drizzle/<timestamp>_wide_table_storage_phase_2_source_id.sql` — slice-0 migration that adds `source_id text NOT NULL UNIQUE` to every existing `er__*` table (empty at this point — phase 1 created tables; wide-table writes start in slice 1).
- `drizzle/<timestamp>_entity_records_drop_normalized_data.sql` — destructive migration.
- Integration tests (cases A–D for slice 0; 1–9, 18–22, 23–46, 47–48, 49–50 for the body).
- Unit tests (cases 10–17).

**Edit:**

- `src/db/schema/entity-records.table.ts` — drop `normalizedData` and the GIN index.
- `src/db/schema/zod.ts` — regen entity-records schemas.
- `src/db/schema/type-checks.ts` — assert against `EntityRecordHydrated`.
- `src/db/repositories/entity-records.repository.ts` — drop `normalizedData` from upsert/insert; reads return hydrated shape.
- `src/db/repositories/wide-table.repository.ts` — `upsertMany`, `softDeleteByEntityRecordIds`, `selectByEntityRecordIds`.
- `src/services/wide-table-statement.cache.ts` — `buildBulkInsertSql`, `normalizedDataJsonbExpr`, `columnRefByNormalizedKey`, `searchableConcatSql`. Also: `WIDE_TABLE_METADATA_COLUMNS` grows to include `source_id`; the JSONB rehydration expression and the searchable-cols list both exclude it.
- `src/services/wide-table-reconciler.service.ts` — `ensureTable` SQL grows the `source_id text NOT NULL` column and the `er__<id>_source_id_unique` index. Diff/apply logic for data columns is unchanged.
- `src/services/layout-plan-commit.service.ts` — wide-table upsert in same tx + advisory lock; resurrection branch; watermark sweep.
- `src/utils/filter-sql.util.ts` — operator builders take a column resolver; JSONB casts removed.
- `src/utils/adapter.util.ts` — `importModeQueryRows` reads via the repo (rehydrated).
- `src/routes/entity-record.router.ts` — list/get/patch/create/import/clear/revalidate rewritten.
- `src/routes/entity-group.router.ts` — link-resolution SQL rewritten.
- `src/routes/entity-group-member.router.ts` — linkage-summary read via rehydrated repo.
- `src/routes/field-mapping.router.ts` — bidirectional consistency read via rehydrated repo.
- `src/routes/admin.router.ts` (or new) — `POST /api/admin/wide-table/resync`.
- `src/services/analytics.service.ts` — `loadStation` reads from wide table.
- `src/services/record-import.util.ts` — bulk write hits wide table.
- `src/queues/processors/revalidation.processor.ts` — fallback removed; batch update writes wide table.
- `src/tools/entity-record-create.tool.ts` — write to wide table.
- `src/tools/entity-record-update.tool.ts` — write to wide table.
- `src/prompts/system.prompt.ts` — schema-doc paragraph rewritten.
- `src/__tests__/__integration__/routes/entity-record.router.integration.test.ts` — extended.
- `src/__tests__/__integration__/services/layout-plan-commit.service.integration.test.ts` — extended.
- `src/__tests__/services/wide-table-statement.cache.test.ts` — extended.
- `src/__tests__/__integration__/db/migrations/…` — new migration test.

### `packages/core`

- No source changes. The contract is invariant.

### `apps/web`

- No changes.

No new dependency. No env-var change. No infra change.
