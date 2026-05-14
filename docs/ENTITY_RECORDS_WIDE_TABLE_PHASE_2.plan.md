# Entity Records Wide-Table Storage — Phase 2 — Plan

**TDD-sequenced implementation of the phase-2 cut: sync writes both stores in one transaction, every server-side `normalized_data` read site is rewritten against typed wide-table columns, the JSONB column drops, and a re-sync trigger refills the wide tables from source.** This plan absorbs what the proposal originally split into Phase 2 + Phase 3.

Spec: `docs/ENTITY_RECORDS_WIDE_TABLE_PHASE_2.spec.md`. Proposal: `docs/ENTITY_RECORDS_WIDE_TABLE.proposal.md`. Phase 1 plan: `docs/ENTITY_RECORDS_WIDE_TABLE_PHASE_1.plan.md`.

The change is layered; **eight slices** (one slice 0 + seven body slices), each behind a green test suite. Slices are ordered so each red→green loop tightens around one concern at a time and the system stays compilable between slices. Critically: the destructive `DROP COLUMN` (slice 6) is sequenced **after** every read site has been migrated off `normalized_data` (slices 4–5), so dropping the column never silently breaks an unmigrated path.

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

- **Slice 0** adds the `source_id` metadata column to every wide table (existing + future). Pure phase-1 reconciler extension; pre-requisite for slice 1 because the cache and projection helper assume the five-column metadata block.
- **Slice 1** lands the wide-table write surface (`upsertMany`, `softDeleteByEntityRecordIds`, `selectByEntityRecordIds`) plus the statement-cache extensions (`buildBulkInsertSql`, `normalizedDataJsonbExpr`, `columnRefByNormalizedKey`, `searchableConcatSql`). Pure additive; nothing is wired into a feature path yet.
- **Slice 2** wires the sync write path. `LayoutPlanCommitService` and the watermark sweep now write both stores. After this slice, the wide tables are dual-written but **nothing reads them yet** — `normalized_data` is still the read source.
- **Slice 3** builds the typed-column query primitives (filter operators, sort expression, search expression) and the rehydrated repository read methods. Uncalled by any route.
- **Slice 4** rewrites the REST `entity-record.router` list / get / patch / create / import / clear / revalidate against the new primitives. After this slice, every public REST read goes through the wide table; `normalized_data` is read from only by analytics + a handful of internal sites.
- **Slice 5** rewrites the remaining server-side read sites (analytics `loadStation`, entity-group resolution, entity-group-member linkage, field-mapping consistency, revalidation processor, record-import, portal mutation tools, adapter import-mode reader, system-prompt doc string). After this slice, **zero feature paths read `normalized_data`**.
- **Slice 6** drops the column + GIN, regenerates schemas + zod + type-checks, and removes the now-dead `normalizedData` references in `EntityRecordsRepository`'s write methods.
- **Slice 7** lands the re-sync trigger and a manual smoke run.

After every slice, the repo type-checks, the existing test suite is green, and the API responses are byte-equivalent to the pre-phase-2 contract for an equivalent input.

---

## Slice 0 — `source_id` metadata column

A leaf-shaped extension to phase 1's reconciler. Adds a fifth metadata column (`source_id text NOT NULL`) plus a unique index to every wide table, so cross-entity JOINs can hit the target wide table directly (`a.source_id = d.c_account_ref`) instead of bouncing through `entity_records.source_id`. Pre-requisite for slice 1 because the statement cache and projection helper both assume the new metadata-column set.

**Why now and not in phase 1.** Phase 1 created the wide tables empty; nothing has read or written them yet. Slice 0 is safe to ship as a phase-1 reconciler patch — the `ALTER TABLE ADD COLUMN source_id text NOT NULL` against an empty table needs no default, and the unique index is creatable instantly on zero rows.

**Files**

- Edit: `apps/api/src/services/wide-table-reconciler.service.ts` — `ensureTable` SQL grows `source_id text NOT NULL` and the `er__<id>_source_id_unique` unique index.
- Edit: `apps/api/src/services/wide-table-statement.cache.ts` — `WIDE_TABLE_METADATA_COLUMNS` grows from 4 to 5 entries; `normalizedDataJsonbExpr` exclusion list and `searchableConcatSql` exclusion list both pick up `source_id` (no test impact — neither was emitting it).
- New: `apps/api/drizzle/<timestamp>_wide_table_storage_phase_2_source_id.sql` — one-shot migration that loops every existing `er__*` table (via a `DO $$ … $$` block scanning `pg_tables` for the prefix) and adds `source_id text NOT NULL` + the unique index. Idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`).
- Edit: `apps/api/src/__tests__/__integration__/services/wide-table-reconciler.service.integration.test.ts` — append cases A–D (see spec).

**Steps**

1. **Write the integration tests (cases A–D).** Run; fail.
2. **Edit the reconciler.** `ensureTable` SQL becomes:
   ```sql
   CREATE TABLE IF NOT EXISTS "er__<entityId>" (
     entity_record_id  text PRIMARY KEY REFERENCES entity_records(id) ON DELETE CASCADE,
     organization_id   text NOT NULL,
     synced_at         bigint NOT NULL,
     is_valid          boolean NOT NULL,
     source_id         text NOT NULL
   );
   CREATE UNIQUE INDEX IF NOT EXISTS "er__<entityId>__source_id_unique"
     ON "er__<entityId>" (source_id);
   CREATE INDEX IF NOT EXISTS "er__<entityId>__org_idx"
     ON "er__<entityId>" (organization_id);
   ```
3. **Edit the cache constant.** `WIDE_TABLE_METADATA_COLUMNS = ["entity_record_id", "organization_id", "synced_at", "is_valid", "source_id"] as const`. The cache builder picks this up automatically — `selectAllSql` projects all five, `insertSqlTemplate` includes all five (slice 1's caller binds `source_id` from `record.sourceId`), `normalizedDataJsonbExpr` excludes all five (it already excluded by membership in this set).
4. **Author the backfill migration.** Generate via `npm run db:generate -- --name wide_table_storage_phase_2_source_id`; replace the generated body with a `DO $$` block that iterates `pg_tables` for `tablename LIKE 'er\_\_%'` and runs `ALTER TABLE … ADD COLUMN IF NOT EXISTS source_id text NOT NULL` + `CREATE UNIQUE INDEX IF NOT EXISTS` per table. The block is the right shape for a dynamic-table backfill; static Drizzle DDL would not see the per-instance tables.
5. **Apply.** `npm run db:migrate`. Boot drift check from phase 1 still passes — the reconciler's expected shape now includes `source_id`, and the migration brought every table up to that shape.
6. **Run focused tests.** `cd apps/api && npm run test:integration -- wide-table-reconciler`. Cases A–D plus phase 1's existing reconciler suite all green.
7. **Lint + type-check.** Clean.

**Done when:** every `er__*` table on disk has `source_id text NOT NULL` and the unique index; the reconciler's `ensureTable` produces the same shape going forward; nothing else has changed.

**Risk:**

- **A wide table has rows already** (because slice 0 was deployed late). `ADD COLUMN … NOT NULL` without a default fails on populated tables. Mitigation: the migration's `DO $$` block can detect non-empty tables and either backfill from `entity_records.source_id` (a `JOIN` is straightforward — `UPDATE er__<id> SET source_id = er.source_id FROM entity_records er WHERE er.id = er__<id>.entity_record_id`) or refuse to apply with an explicit error. For phase 2's deploy timeline, the assumption is "wide tables are still empty"; the migration treats non-empty tables as a hard error and the operator runs the backfill manually.

---

## Slice 1 — Wide-table write surface + statement-cache extensions

The largest leaf-shaped slice. New methods, new SQL builders. Tests seed `wide_table_columns` directly via phase 1's repo, then assert the generated SQL and the `upsertMany` / `softDeleteByEntityRecordIds` / `selectByEntityRecordIds` semantics.

**Files**

- Edit: `apps/api/src/db/repositories/wide-table.repository.ts` — new methods.
- Edit: `apps/api/src/services/wide-table-statement.cache.ts` — new fields on `CachedStatements`, new `buildBulkInsertSql` method.
- New: `apps/api/src/__tests__/__integration__/db/repositories/wide-table.repository.integration.test.ts` (cases 1–9).
- Edit: `apps/api/src/__tests__/services/wide-table-statement.cache.test.ts` — append cases 10–17.

**Steps**

1. **Statement-cache tests first (cases 10–17).** Each test seeds N field-mappings + matching `wide_table_columns` rows, calls the cache, and asserts on string contents. Case 12 specifically asserts the JSONB expression keys by `normalized_key`, not `column_name` — this is the rehydration contract. Run; fail.

2. **Extend the cache.**
   - In `build()`, join `wide_table_columns` to `field_mappings` on `field_mapping_id` so each column has both `column_name` and `normalized_key` available.
   - Build `normalizedDataJsonbExpr(alias = "w")`: `jsonb_build_object('<normalizedKey>', "<alias>"."<columnName>", …)` for live data columns. Memoise per cache entry; the function form lets callers retarget the alias.
   - Build `columnRefByNormalizedKey`: `Map<string, (alias?: string) => string>`, returns `"<alias>"."<columnName>"`.
   - Build `searchableConcatSql(alias = "w")`: `concat_ws(' ', <expr>, …)` over text-shaped columns. `text` → `"alias"."col"::text`. `text[]` → `array_to_string("alias"."col", ' ')`. `jsonb` → `"alias"."col"::text`. Numeric / boolean / date columns are excluded.
   - Add `buildBulkInsertSql(connectorEntityId, batchSize)`: build the column list once, then emit `batchSize` placeholder tuples `($1, $2, …, $K), ($K+1, …, $2K), …` followed by `ON CONFLICT (entity_record_id) DO UPDATE SET …` from the existing single-row builder. Throw on `batchSize < 1`.

3. **Run cache tests.** All 8 new cases green.

4. **Repository tests next (cases 1–9).** Each seeds an entity, reconciles columns via phase 1's reconciler, then exercises the new repo methods. Run; fail.

5. **Implement repo methods.**
   - `upsertMany(entityId, rows, client = db)`:
     - `const stmt = await statementCache.get(entityId, client);`
     - `const sql = statementCache.buildBulkInsertSql(entityId, rows.length, client);`
     - Bind: for each row, in column order (metadata first, then `stmt.columns`), push the value (or `null` if the row's `normalizedData` did not provide it).
     - `client.execute(sql.raw(sql), params)`.
   - `softDeleteByEntityRecordIds(entityId, ids, client = db)`:
     - `client.execute(sql.raw(`DELETE FROM "${tableName(entityId)}" WHERE entity_record_id = ANY($1::text[])`), [ids])`. (Hard delete; the spec explains why.)
   - `selectByEntityRecordIds(entityId, ids, client = db)`:
     - Use `stmt.selectAllSql + ` WHERE entity_record_id = ANY($1::text[])`` and bind `[ids]`.

6. **Run repo tests.** All 9 cases green.

7. **Lint + type-check.** Clean.

**Done when:** cases 1–17 pass; the new methods are exported but called from nowhere outside their own tests.

**Risk:** `buildBulkInsertSql` parameter ordering must match the binding order in `upsertMany`. Mitigation: case 1 builds a 3-row batch with distinct values per column and asserts every value lands in the correct column on read-back. Catastrophic mis-ordering surfaces immediately.

---

## Slice 2 — Sync write transaction integration

`LayoutPlanCommitService.writeRecords` and the watermark sweep now upsert/delete both stores in the same transaction, with the per-entity advisory lock held.

**Files**

- New: `apps/api/src/services/wide-table-projection.util.ts` — `projectToWideRow`.
- Edit: `apps/api/src/services/layout-plan-commit.service.ts` — wrap the post-prep writes in `withEntityLock`; add wide-table upsert calls; resurrection branch.
- Edit: `apps/api/src/adapters/google-sheets/google-sheets.adapter.ts` (and any other adapter that calls `softDeleteBeforeWatermark`) — pair the soft-delete with `wideTableRepo.softDeleteByEntityRecordIds`.
- Edit: `apps/api/src/__tests__/__integration__/services/layout-plan-commit.service.integration.test.ts` — append cases 18–22.

**Steps**

1. **Write the integration tests (cases 18–22).** Each test runs a sync against a seeded organization + connector + entity + field-mappings, then asserts on both `entity_records` and `er__<id>` post-commit. Case 21 (transaction rollback) injects a failure by patching the wide-table repo to throw and asserts neither side committed. Case 22 (advisory-lock serialisation) opens two concurrent operations against the same entity and asserts they complete sequentially. Run; fail.

2. **Author `projectToWideRow`.**

   ```ts
   export function projectToWideRow(
     record: EntityRecordInsert,
     mappings: ReadonlyMap<string /*normalizedKey*/, string /*columnName*/>
   ): Record<string, unknown> {
     const out: Record<string, unknown> = {
       entity_record_id: record.id,
       organization_id: record.organizationId,
       synced_at: record.syncedAt,
       is_valid: record.isValid,
       source_id: record.sourceId,    // slice-0 metadata column; copied verbatim
     };
     for (const [normalizedKey, value] of Object.entries(record.normalizedData ?? {})) {
       const columnName = mappings.get(normalizedKey);
       if (!columnName) continue; // unknown key — caller's normalizer should have rejected; log debug
       out[columnName] = value;
     }
     return out;
   }
   ```

   Pure, fully unit-testable; lives in its own util file because slice 4 will reuse it from REST routes.

3. **Modify `writeRecords`.** Wrap the trailing `if`-blocks (lines 664–679 in current code) inside `withEntityLock(tx, connectorEntityId, async (locked) => …)`. Replace `tx` with `locked` for the writes inside.

   After `entityRecordsRepo.upsertManyBySourceId(toUpsert, locked)`:
   ```ts
   if (toUpsert.length > 0) {
     const mappings = await loadMappingsForProjection(connectorEntityId, locked);
     await DbService.repository.wideTable.upsertMany(
       connectorEntityId,
       toUpsert.map((r) => projectToWideRow(r, mappings)),
       locked
     );
   }
   ```

   Same pattern after `bulkResurrect` (using the resurrected payload).

   `loadMappingsForProjection` is a small inline helper that reads `field_mappings` for the entity, joins to `wide_table_columns` for `column_name`, and returns the `normalizedKey → columnName` map. (Could live on the cache; keeping it inline initially keeps the slice tight.)

4. **Modify watermark sweep.** Find `softDeleteBeforeWatermark` callers (Google Sheets adapter line 145+, plus any others — `grep -n softDeleteBeforeWatermark apps/api/src`). Each call now also issues `wideTableRepo.softDeleteByEntityRecordIds(entityId, sweptIds, tx)` in the same transaction.

5. **Run focused tests.** `cd apps/api && npm run test:integration -- layout-plan-commit`. All 5 new cases green; the existing suite stays green.

6. **Lint + type-check.** Clean.

**Done when:** every sync write produces the matching `er__<id>` row; the advisory lock serialises sync vs. reconciler; rollback rolls both sides back.

**Risk:**

- **`bulkResurrect` data plumbing.** The resurrected `data` object is a `Partial<EntityRecordInsert>` — make sure `normalizedData` is in there before projecting. Mitigation: case 19 (resurrection) explicitly asserts the wide row's data columns equal the resurrected payload's `normalizedData` values.
- **`loadMappingsForProjection` is N+1 across batches.** Within a single sync run, the same entity's mappings are fetched once per batch. If batches are large, cache the map for the lifetime of the transaction. For phase 2, the per-entity sync is one batch; deferring the cache is fine.

---

## Slice 3 — Typed-column query primitives + rehydrated repo reads

Build the read primitives that slice 4 (REST routes) will consume. Tests are unit-shaped over the SQL builders plus integration tests for the repository's hydrated read.

**Files**

- Edit: `apps/api/src/utils/filter-sql.util.ts` — operator builders take a column resolver; JSONB plumbing removed.
- Edit: `apps/api/src/db/repositories/entity-records.repository.ts` — `findByConnectorEntityId`, `findById`, `findManyWithFilter` (or whichever is the existing list-supporting method) now JOIN `er__<id>` and project `normalizedData` via the cache's expression. Returns `EntityRecordHydrated`.
- New: `apps/api/src/__tests__/utils/filter-sql.util.test.ts` if it doesn't exist; otherwise edit. Cover one case per operator builder (numeric range, string ILIKE, boolean equality, date range, enum, array contains) — about 8 unit cases — assert on the generated SQL fragment.
- Edit: `apps/api/src/__tests__/__integration__/db/repositories/entity-records.repository.integration.test.ts` — add cases that assert the hydrated read returns `normalizedData` rebuilt from the wide table.

**Steps**

1. **Write the operator-builder unit tests + the rehydrated-read integration tests.** Run; fail (the JSONB versions still pass; the new typed-column versions fail).

2. **Rewrite operator builders.** Each builder now takes `(columnRef: SQL, value, op?)` and emits typed comparisons:
   - `buildStringCondition(columnRef, op, value)` — `columnRef ILIKE $value` or `columnRef = $value`. No more `regexp_replace` / `LOWER(jsonbText…)`.
   - `buildNumericCondition(columnRef, op, value)` — `columnRef <op> $value::numeric`. The numeric-text regex guard deletes.
   - `buildDateCondition(columnRef, op, value)` — `columnRef <op> $value::timestamptz`. The date-text regex guard deletes.
   - `buildBooleanCondition(columnRef, op, value)` — `columnRef IS [NOT] $value`.
   - `buildEnumCondition(columnRef, op, values)` — `columnRef = ANY($values)` or `<>` variants.
   - `buildArrayCondition(columnRef, op, value)` — `columnRef @> ARRAY[$value]` (and the inverse).

3. **Rewrite `parseAndBuildFilterSQL(connectorEntityId, expr, opts?)`.** It now:
   - Calls `await wideTableStatementCache.get(connectorEntityId, opts.client)`.
   - Uses `cachedStatements.columnRefByNormalizedKey` to resolve each `field` in the expression.
   - Throws `ApiError(ENTITY_RECORD_INVALID_FILTER, "unknown column: <key>")` if a `field` does not resolve.
   - Returns a `SQL` fragment.

   `SORTABLE_COLUMN_TYPES` deletes (or becomes a no-op return for backwards compat — but the spec says delete; do it now).

4. **Rewrite the repository reads.** Each read method that today returns `EntityRecordSelect[]`:

   ```ts
   async findByConnectorEntityId(
     entityId: string,
     opts?: { … },
     client: DbClient = db
   ): Promise<EntityRecordHydrated[]> {
     const stmt = await wideTableStatementCache.get(entityId, client);
     const sql = `
       SELECT er.*, ${stmt.normalizedDataJsonbExpr("w")} AS normalized_data
       FROM entity_records er
       JOIN "${tableName(entityId)}" w ON w.entity_record_id = er.id
       WHERE er.connector_entity_id = $1
         AND er.deleted IS NULL
         …
     `;
     return await client.execute(…);
   }
   ```

   Define `EntityRecordHydrated = EntityRecordSelect & { normalizedData: Record<string, unknown> }` and export it.

5. **Run focused tests.** Unit + integration tests green.

6. **Lint + type-check.** Clean. (`type-check` will surface any caller of the repo that today destructures `EntityRecordSelect`'s `normalizedData` — those callers still work because the hydrated type is a superset.)

**Done when:** filter / sort / search SQL all build against typed columns; the repository's read methods produce hydrated rows; nothing else has changed.

**Risk:**

- **`parseAndBuildFilterSQL` is sync today.** Resolving the cache is async. Either propagate `await` to every caller (small, local — they're all in `entity-record.router.ts`) or pre-resolve the cache once in the route handler and pass `cachedStatements` to a sync-shaped `buildFilterSql`. Pick the latter: it lets the route handler resolve the cache once and reuse it for filter + sort + search.

---

## Slice 4 — REST `entity-record.router` rewrite

Wire the slice-3 primitives into every list / get / patch / create / import / clear / revalidate handler. After this slice, the public REST surface reads only the wide table.

**Files**

- Edit: `apps/api/src/routes/entity-record.router.ts` — every handler that touches `normalizedData`.
- Edit: `apps/api/src/__tests__/__integration__/routes/entity-record.router.integration.test.ts` — extend with cases 23–41.

**Steps**

1. **Write the integration tests (cases 23–41).** Each test uses the existing test harness to `POST` / `GET` / `PATCH` against the route surface and asserts on response shape and on side-effect SQL state. Cases include: each filter operator, sort by typed columns, search across text columns, column projection, pagination + sort + filter together, single-record GET hydration, write paths persisting both stores, clear + revalidate cascades, and the write-capability gate. Run; the contract assertions still pass under JSONB (the response shape is invariant); the new "wide-table state" assertions fail.

2. **Rewrite `GET /` (list).** Resolve the cache once per request; build the FROM with the wide-table JOIN; build search via `cachedStatements.searchableConcatSql() ILIKE $search`; build filter SQL via the new `buildFilterSql(cachedStatements, expr)`; build sort via `buildSortExpression(cachedStatements, normalizedKey)` for normalized fields, otherwise `SORTABLE_COLUMNS[field]` for transactional fields. Project `er.*, <normalizedDataJsonbExpr> AS normalized_data`. Apply `?columns=…` by narrowing the JSONB build expression server-side (build a per-request `jsonb_build_object` containing only the requested keys).

3. **Rewrite `GET /:recordId`.** Single-row JOIN + projection, same shape.

4. **Rewrite `POST /` (create).** Validate; `entityRecordsRepo.create(...)`; then `wideTableRepo.upsertMany(entityId, [projectToWideRow(...)], tx)`. Both inside a transaction with the entity advisory lock. The `assertWriteCapability(entityId)` call stays as the first thing.

5. **Rewrite `POST /import`.** Bulk variant — same shape, batched via `wideTableRepo.upsertMany(entityId, projected, tx)`.

6. **Rewrite `PATCH /:recordId`.** Validate the partial; build a typed UPDATE statement against `er__<id>` for only the supplied keys (use `cachedStatements.columnRefByNormalizedKey`); execute alongside the `entity_records` update. *Don't* go through `upsertMany` here — partial-merge semantics matter; the bulk template overwrites every column.

   Add a small helper to `WideTableRepository`: `updatePartial(entityId, recordId, normalizedDataPatch, client)`. It builds `UPDATE "er__<id>" SET "c_x" = $1, "c_y" = $2 WHERE entity_record_id = $3` from the patch keys.

7. **Rewrite `POST /clear`.** `entityRecordsRepo.softDeleteMany(...)` + `wideTableRepo.softDeleteByEntityRecordIds(entityId, ids, tx)`.

8. **Rewrite `POST /revalidate`.** Re-runs validation; updates `entity_records.validation_errors` / `is_valid`; persists the recomputed normalized values via `wideTableRepo.upsertMany`.

9. **Run focused tests.** `cd apps/api && npm run test:integration -- entity-record.router`. All 19 new cases plus the existing suite green.

10. **Run the slice-3 tests again.** Still green.

11. **Lint + type-check.** Clean.

**Done when:** every public REST endpoint serves identical responses to the pre-phase-2 baseline (snapshot tests confirm) AND every read goes through the wide table. `grep -n "normalized_data" apps/api/src/routes/entity-record.router.ts` returns nothing other than the rehydrated alias `AS normalized_data`.

**Risk:**

- **Sort stability and null-ordering changes.** Postgres orders typed nulls differently from JSONB-cast nulls. Snapshot tests are the regression net; if a difference surfaces, either add explicit `NULLS FIRST/LAST` or document the new behaviour as more-correct.
- **`?columns=` projection narrowing.** Build the per-request `jsonb_build_object` server-side; do not strip keys post-fetch (avoid wasted work). Tests 32 confirms.

---

## Slice 5 — Other server-side read sites

Migrate every remaining `record.normalizedData` reader off `normalized_data`. After this slice, no feature path reads the JSONB column.

**Files**

- Edit: `apps/api/src/services/analytics.service.ts` — `loadStation` reads from `wideTableRepo.selectAll`.
- Edit: `apps/api/src/routes/entity-group.router.ts` — link-resolution SQL.
- Edit: `apps/api/src/routes/entity-group-member.router.ts` — linkage-summary read via rehydrated repo.
- Edit: `apps/api/src/routes/field-mapping.router.ts` — bidirectional consistency read via rehydrated repo.
- Edit: `apps/api/src/queues/processors/revalidation.processor.ts` — fallback removed; batch update writes wide table.
- Edit: `apps/api/src/services/record-import.util.ts` — bulk write via wide-table repo.
- Edit: `apps/api/src/tools/entity-record-create.tool.ts`, `entity-record-update.tool.ts` — write to wide table.
- Edit: `apps/api/src/utils/adapter.util.ts` — `importModeQueryRows` reads via rehydrated repo.
- Edit: `apps/api/src/prompts/system.prompt.ts` — schema-doc paragraph rewritten.
- Edit: tests for each of the above (existing test files).

**Steps**

1. **Write or extend integration tests (cases 42–46).** Each existing test for these surfaces continues to assert on response/output shape; the new assertions check that the wide table is hit (spy) and that the JSONB column is not. Run; the wide-table-hit assertions fail.

2. **`AnalyticsService.loadStation` (line 383).** Replace:

   ```ts
   const records = await repo.entityRecords.findByConnectorEntityId(entity.id);
   const rows = records.map((r) => ({
     _record_id: r.id,
     _connector_entity_id: entity.id,
     ...r.normalizedData,
   }));
   ```

   With:

   ```ts
   const wideRows = await wideTableRepo.selectAll(entity.id);
   const stmt = await wideTableStatementCache.get(entity.id);
   // Build inverse map columnName → normalizedKey for one-shot rename.
   const inverseMap = await loadInverseMap(entity.id);
   const rows = wideRows.map((w) => {
     const out: Record<string, unknown> = {
       _record_id: w.entity_record_id,
       _connector_entity_id: entity.id,
     };
     for (const [k, v] of Object.entries(w)) {
       if (WIDE_TABLE_METADATA_COLUMNS.includes(k as any)) continue;
       const nk = inverseMap.get(k); // strip c_ prefix and rename to normalized_key
       if (nk) out[nk] = v;
     }
     return out;
   });
   ```

   AlaSQL `CREATE TABLE` and `INSERT` calls untouched.

3. **`entity-group.router.ts:940` link resolution.** The existing query that does `normalizedData->>'columnKey' = linkValue` is rewritten to JOIN `er__<id>` and reference `cache.columnRefByNormalizedKey(columnKey)` for the comparison.

4. **`entity-group-member.router.ts:743, 767` linkage summary.** Already iterates `record.normalizedData`. Because the repo now returns the hydrated shape, no code change is needed *in this file* — but the test confirms it. Update the test assertion if needed.

5. **`field-mapping.router.ts:1173, 1182` bidirectional consistency.** Same — uses the repo's hydrated read; no code change beyond the repo migration.

6. **`revalidation.processor.ts`.**
   - Line 59: delete the `?? record.normalizedData` fallback. The processor now reads `record.data` only; if `data` is null, log a structured error and skip the record.
   - Lines 84, 94: alongside the `entityRecordsRepo` update, call `wideTableRepo.upsertMany(entityId, [projectToWideRow(updated, mappings)], tx)`.

7. **`record-import.util.ts:125`.** Per-batch wide-table write; same pattern as sync.

8. **Portal mutation tools.** `entity-record-create.tool.ts:121` — `wideTableRepo.upsertMany(entityId, [projected], tx)` after the `entity_records` write. `entity-record-update.tool.ts:160` — same.

9. **`adapter.util.ts:110` (`importModeQueryRows`).** Reads via the rehydrated repo; no code change beyond what the repo migration already does. Test confirms.

10. **`prompts/system.prompt.ts:99`.** Replace the `normalizedData` JSONB blurb with prose describing the typed-column shape. (The LLM still queries AlaSQL in this phase; phase 3 is what changes that.)

11. **Run focused tests.** `cd apps/api && npm run test:integration` (whole suite). All slices green.

12. **Lint + type-check.** Clean.

**Done when:** `grep -rn "record.normalizedData" apps/api/src` returns matches **only** in the repository / projection / cache files (the rehydration code) and in tests. No feature path destructures `normalizedData` from a transaction-row read of `entity_records`.

**Risk:**

- **`loadStation` performance.** Selecting every row in an entity to spread into AlaSQL is `O(rows)`. Phase 2 doesn't optimise this — phase 3 (Postgres-direct) eliminates it entirely.
- **Revalidation legacy fallback.** If any in-flight job has `data: null`, it'll skip with a structured error after slice 5. Mitigation: re-run the `record-import` re-population in dev to confirm `data` is always present; case 46 tests the skip path explicitly.

---

## Slice 6 — Drop `normalized_data` + slim `EntityRecordsRepository`

The destructive cut. Drop the column, drop the GIN, regenerate Drizzle schema + zod + type-checks, slim the repository's write methods.

**Files**

- New: `apps/api/drizzle/<timestamp>_entity_records_drop_normalized_data.sql` — generated migration.
- Edit: `apps/api/src/db/schema/entity-records.table.ts` — remove `normalizedData` field and the GIN index from the Drizzle definition.
- Edit: `apps/api/src/db/schema/zod.ts` — regenerate `entityRecords` select / insert schemas.
- Edit: `apps/api/src/db/schema/type-checks.ts` — assert against `EntityRecordHydrated`.
- Edit: `apps/api/src/db/repositories/entity-records.repository.ts` — drop `normalizedData` from `upsertBySourceId` / `upsertManyBySourceId` / `bulkResurrect` / any other write helper.
- New: `apps/api/src/__tests__/__integration__/db/migrations/entity_records_drop_normalized_data.test.ts` (cases 47–48).

**Steps**

1. **Write the migration tests (cases 47–48).** They assert the migration applies forward against a freshly-migrated database and that `information_schema.columns` for `entity_records` matches the post-migration set. Run; fail (migration doesn't exist).

2. **Edit `entity-records.table.ts`.** Remove the `normalizedData` field from the column object and remove the `entity_records_normalized_data_gin` index from the indexes array.

3. **Generate the migration.** `cd apps/api && npm run db:generate -- --name entity_records_drop_normalized_data`. Review the generated SQL; it should produce something like:
   ```sql
   DROP INDEX IF EXISTS "entity_records_normalized_data_gin";
   ALTER TABLE "entity_records" DROP COLUMN "normalized_data";
   ```
   **Insert `TRUNCATE TABLE "entity_records" CASCADE;` before the `DROP COLUMN`** by hand. (Drizzle's generator will not produce `TRUNCATE`; this is intentional manual surgery.) Justification: the post-migration database has empty `entity_records` and empty `er__<id>` ready for re-sync. The cascade catches every FK target.

4. **Apply.** `npm run db:migrate`.

5. **Update zod / type-checks.** `db/schema/zod.ts` regenerates without `normalizedData`. `db/schema/type-checks.ts` adds:
   ```ts
   import type { EntityRecord } from "@portalai/core/contracts";
   import type { EntityRecordHydrated } from "../repositories/entity-records.repository.js";
   const _check1: IsAssignable<EntityRecord, EntityRecordHydrated> = true;
   const _check2: IsAssignable<EntityRecordHydrated, EntityRecord> = true;
   ```
   Remove the existing `IsAssignable` against the bare table inference for `entityRecords`.

6. **Slim `EntityRecordsRepository`.** Every write helper:
   - `upsertBySourceId(...)` — drop `normalizedData` from the `set` clause (it's no longer a column).
   - `upsertManyBySourceId(...)` — same; the `INSERT … ON CONFLICT DO UPDATE` no longer references `normalized_data`.
   - `bulkResurrect(...)` — drop `normalizedData` from the per-row UPDATE.
   - Anywhere else `normalizedData` appears on the *write* side. (It's already gone from reads after slice 3.)

7. **Run focused tests.** `cd apps/api && npm run test:integration -- entity_records_drop_normalized_data`. Cases 47–48 green.

8. **Run the full suite.** `cd apps/api && npm run test:unit && npm run test:integration`. Everything green.

9. **Lint + type-check.** Clean.

10. **Manual smoke.** `cd apps/api && npm run dev`. Server boots; phase 1 reconciler still passes its drift check; `psql -c "\d entity_records"` shows no `normalized_data` and no GIN.

**Done when:** the column is gone; the schema is in lockstep; every repo read returns `EntityRecordHydrated`; no test references `normalizedData` from a write surface that no longer accepts it.

**Risk:**

- **An untested code path still references `entity_records.normalized_data`.** The grep gate at the slice boundary catches this — `grep -rn "normalized_data\|normalizedData" apps/api/src` returns only the allowed locations from the spec's acceptance criteria.
- **Drizzle's generator emits something unexpected.** Review the SQL by eye before applying. If the generator produces ALTER + DROP without DROP INDEX, add `DROP INDEX IF EXISTS` by hand.

---

## Slice 7 — Re-sync trigger + smoke

The cleanup that brings the database back to a populated state.

**Files**

- New: `apps/api/src/services/wide-table-resync.service.ts` — `resyncAllConnectorInstances()`.
- Edit: `apps/api/src/routes/admin.router.ts` (or new) — `POST /api/admin/wide-table/resync`.
- New: `apps/api/src/__tests__/__integration__/services/wide-table-resync.service.integration.test.ts` (cases 49–50).

**Steps**

1. **Write the integration tests (cases 49–50).** Mock the per-adapter sync entry point; assert the trigger calls each live `connector_instances` once; soft-deleted instances skipped; idempotent re-run produces the same final state. Run; fail.

2. **Author the service over the existing BullMQ chain.** The dispatch chain `SyncService.enqueueSync` (`apps/api/src/services/sync.service.ts:169`) → `connector-sync` queue → `connectorSyncProcessor` (`apps/api/src/queues/processors/connector-sync.processor.ts:22`) → `adapter.syncInstance` already exists. Sync is fire-and-forget: enqueue returns a job id immediately. The trigger is a fan-out:

   ```ts
   export const wideTableResyncService = {
     async resyncAllConnectorInstances(actorUserId: string): Promise<ResyncReport> {
       const instances = await connectorInstancesRepo.findMany({ deleted: null });
       const triggered: string[] = [];
       const skippedInFlight: string[] = [];
       const skippedUnsupported: string[] = [];
       const failed: Array<{ instanceId: string; error: string }> = [];

       for (const inst of instances) {
         const def = await connectorDefinitionsRepo.findById(inst.connectorDefinitionId);
         const adapter = ConnectorAdapterRegistry.get(def.slug);
         if (!adapter.syncInstance) { skippedUnsupported.push(inst.id); continue; }

         const active = await SyncService.findActiveSyncJob(inst.id);
         if (active) { skippedInFlight.push(inst.id); continue; }

         try {
           const job = await SyncService.enqueueSync({
             connectorInstanceId: inst.id,
             organizationId: inst.organizationId,
             userId: actorUserId,
           });
           triggered.push(job.id);
         } catch (err) {
           failed.push({ instanceId: inst.id, error: String(err) });
         }
       }
       return { triggered, skippedInFlight, skippedUnsupported, failed };
     },
   };
   ```

   The `actorUserId` comes from the admin route's caller (`req.application!.metadata.userId`) — `createdBy`/`updatedBy` on the resulting jobs and per-instance writes attribute to that operator. No system user constant is introduced.

3. **Wire the admin route.** `POST /api/admin/wide-table/resync` (auth-gated) reads `userId` from the request, calls the service, returns the `ResyncReport`. The route returns 200 immediately — per-instance progress is observable via the existing job-progress UI / SSE consumer.

4. **Run focused tests.** All cases green.

5. **Manual smoke against dev.**
   - `cd apps/api && npm run db:migrate` (slice 6's migration applies).
   - `npm run dev`.
   - `curl -X POST http://localhost:3001/api/admin/wide-table/resync` — response is the `ResyncReport`. Each `triggered` entry is a BullMQ job id; the existing job dashboard / SSE stream reports per-instance progress. `skippedUnsupported` should list every sandbox-adapter instance.
   - Wait for jobs to drain (queue dashboard, or poll `/api/jobs/:id`).
   - `curl http://localhost:3001/api/connector-entities/<id>/records` — verify hydrated `normalizedData` matches expectations.
   - Open the web app at http://localhost:3000 — verify list, advanced filter, sort, search, column projection, edit, create, clear, revalidate all behave normally.

6. **Run the full integration suite + lint + type-check** as a final gate.

**Done when:** the trigger reliably refills both stores; the manual smoke matches the pre-phase-2 user-visible behaviour; all 50 spec test cases are green; all 9 acceptance-criteria checkboxes from the spec are satisfied.

**Risk:**

- **An adapter is missing from `ConnectorAdapterRegistry`.** Resolution throws inside the per-instance loop; the trigger catches and reports it under `failed`. The operator inspects the report and either registers the adapter or fixes the registration. The trigger is idempotent — re-running picks up where it left off.
- **`enqueueSync` is fire-and-forget; the trigger returns before any sync completes.** This is intentional. Per-instance progress is observable via the job dashboard the same way a user-initiated sync is. The operator's smoke checks run after the queue drains.
- **A real adapter runs slow.** Each adapter's sync is bounded by source-system rate limits. The trigger doesn't add latency. Operator can pause / cancel per-instance via existing routes.

---

## Cross-slice gates

After each slice:

1. `cd apps/api && npm run test:unit && npm run test:integration` is green.
2. `npm run lint && npm run type-check` from repo root are clean.
3. `git diff --stat` matches the slice's "Files" list (within reason).
4. Snapshot tests on the API contract (any `EntityRecord` response shape) remain byte-equivalent to the pre-phase-2 baseline. (Maintained by the existing route integration tests, which assert on response shape.)

After slice 5, before slice 6:

- `grep -rn "record\.normalizedData" apps/api/src/{routes,services,queues,tools,utils,adapters}` returns **zero** matches.
- `grep -rn "normalized_data" apps/api/src/{routes,services,queues,tools,utils,adapters}` returns **zero** matches outside `wide-table-statement.cache.ts`.
- This is the gate that says "slice 6's destructive cut is safe to run".

After slice 7 (phase end):

- All 54 spec test cases pass (4 slice-0 + 50 phase-2-body).
- All acceptance-criteria checkboxes from the spec are satisfied.
- Manual `npm run dev` + admin re-sync trigger reproduces the full pre-phase-2 user-visible behaviour.
- `psql -c "\d entity_records"` shows the slimmed schema.
- `psql -c "\d er__*"` (any one) shows five metadata columns + per-mapping `c_*` columns + the `er__<id>__source_id_unique` index.
- `psql -c "SELECT count(*) FROM entity_records"` matches the sum of `count(*)` across all `er__<id>` tables (one wide-table row per transactional row).
- Cross-entity `JOIN` smoke: pick a `reference` field on one entity; run `SELECT count(*) FROM "er__<src>" s JOIN "er__<tgt>" t ON t.source_id = s."c_<ref_col>"`; non-zero count confirms the slice-0 denormalisation works.

---

## What this plan does *not* attempt

- **AlaSQL deletion.** New phase 3 (formerly phase 4). `loadStation` still spreads rows into AlaSQL; only its source moves.
- **`validateSql` Postgres-direct rewrite.** New phase 3.
- **Math-method port.** New phase 3.
- **Retired-column drop maintenance** and **type-change backfill stager.** New phase 4.
- **Schema-per-org partitioning.** Out of v1.
- **Web-app changes.** Zero — the contract is invariant.
- **Storybook changes.** Zero — stories drive UI components from props.
