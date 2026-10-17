# Curated-view records at scale — Spec

**Issue:** [EnterpriseBT/portal-ai#649](https://github.com/EnterpriseBT/portal-ai/issues/649) · **Discovery:** `docs/CURATED_VIEW_RECORDS_AT_SCALE.discovery.md`

This spec pins the contract that gives `GET /api/curated-views/:id/records` keyset paging, a trigram-indexed text search (which string filters reuse), and a cached total. It also pins the wide-table index lifecycle that keeps those indexes present: created at column add, converged by a maintenance sweep. No sort btrees are added. Whether they're needed is gated on a recorded measurement.

## Key decisions (flag for review)

1. **Keyset on the view endpoint** (D1). `cursor` is honored and `nextCursor` returned. Both fields already exist in the request and response schemas, so the contract change is additive.
2. **One seek implementation** (D2). `buildKeysetPredicate` / `buildOrderByClause` gain a `tiebreaker` argument. The view's tiebreaker follows the sort direction (today it's always ASC), and every `c_*` sort is `NULLS LAST`.
3. **No per-column sort btrees** (D3, Q1). The PR records `EXPLAIN ANALYZE` for a column sort and a selective number/date range filter at ~400K rows. Either one over 1s opens a follow-up ticket. Tests assert no plans.
4. **Search is text-only** (D4, confirmed). It matches `text`-stored readable columns (string/enum/reference). Number and date values are reached through typed filters.
5. **String filters ride the trigram index** (D4b). The `::text` cast is dropped for `text`-stored columns. No filter-specific indexes.
6. **Index lifecycle** (D5). The reconciler builds a `_trgm` index at column add, inside its transaction, as GiST already does. A repeatable maintenance sweep **converges** each table: it builds missing indexes `CONCURRENTLY`, rebuilds `INVALID` ones, and drops indexes on retired columns. The reconciler has no drop path, because columns are only ever retired (`applyRetires` marks `retired_at`; nothing drops a column).
7. **Total from `EntityRecordCountCache`** (D6), with the caller's view scope in the fingerprint.
8. **`pg_trgm` via an idempotent migration** (Q2). It's a trusted extension, and the Helm README gains a line beside the PostGIS one. Creatability is verified on app-dev during smoke.
9. **Last-page inversion** (Q4) uses the shared helpers unchanged. A walk-to-last-page test over a column with NULLs pins the behavior.

## Scope

### In scope

1. Generalize the keyset helpers with a `tiebreaker` argument.
2. Keyset paging, cursor minting and the cached count in `PortalSqlService.queryCuratedViewRecords` and its route.
3. Text-only, per-column search in the view query.
4. A cast-free string-operator SQL for `text`-stored columns in `filter-sql.util.ts`.
5. The `pg_trgm` migration.
6. `trgmIndexName` and the trigram index at column add in the reconciler.
7. The maintenance sweep (`wide-table-search-index-sweep`), with its scheduler and env knob.
8. The web switch: keyset `usePagination`, `SyncNextCursor`, and a "Search text columns" placeholder.
9. Doc sync: OpenAPI description, the Helm README extension line, and Help/FAQ copy if it describes view search.

### Out of scope

Sort/range btrees (gated on the measurement), the entity-records search rewrite and its LIKE escaping (discovery Q3, follow-up), search over `text[]`/`jsonb`/number/date cells, per-view partial indexes, and `sql_query` performance.

## Surface

### Keyset helpers — `apps/api/src/db/repositories/entity-records.repository.ts:986-1032`

```ts
export function buildKeysetPredicate(opts: {
  column: Column | SQL;
  value: string | number | null;
  id: string;
  direction?: "asc" | "desc";
  nullable: boolean;
  /** Unique tiebreaker. Default `entityRecords.id`. */
  tiebreaker?: Column | SQL;
}): SQL;

export function buildOrderByClause(opts: {
  column: Column | SQL;
  direction?: "asc" | "desc";
  nullable?: boolean;
  /** Unique tiebreaker. Default `entityRecords.id`. */
  tiebreaker?: Column | SQL;
}): SQL;
```

The behavior is unchanged when `tiebreaker` is omitted, so entity-records callers stay byte-identical. The "already ordering by the tiebreaker" short-circuit compares `col === tiebreaker`, by identity, in place of the hard-coded `entityRecords.id`.

### View records query — `apps/api/src/services/portal-sql.service.ts:568`

```ts
async queryCuratedViewRecords(
  viewId: string, organizationId: string, userId: string,
  opts: {
    limit: number; offset: number;
    sortBy?: string; sortOrder?: "asc" | "desc";
    search?: string; filters?: string;
    /** Opaque keyset cursor (#649). Takes precedence over `offset` when it decodes and matches the effective sort. */
    cursor?: string;
  },
  client: DbClient = db
): Promise<{
  records: Record<string, unknown>[];
  total: number;
  columns: ResolvedColumn[];
  /** Cursor for the following page, or null at the end / when unmintable. */
  nextCursor: string | null;
} | null>;
```

**Effective sort and tiebreaker**

| `sortBy` | Effective `sortBy` (in the cursor) | Sort expr | Nullable | Tiebreaker |
|---|---|---|---|---|
| `created` | `created` | `r."created"` (joins `entity_records r`, as today) | no | `r."id"` (so `(connector_entity_id, created, id)` serves it) |
| a readable sortable column's `normalizedKey` | that key | `w.<col>` | yes | `w."entity_record_id"` |
| anything else | `_record_id` | `w."entity_record_id"` | no | the same expr (the short-circuit applies) |

An unsortable type still throws `400 CURATED_VIEW_INVALID_SORT`.

**Cursor handling** mirrors `entity-record.router.ts:341-352`:
- `decodeCursor(cursor)`. The anchor is used only when its `sortBy`/`sortOrder` equal the effective ones. Otherwise the request serves the first page; it is never an error.
- With an anchor, the query ANDs `buildKeysetPredicate(...)` into the WHERE and runs no `OFFSET`. Without one, `OFFSET offset` stays.
- The query fetches `limit + 1` rows.

**Composition:** the existing `sql.raw` fragments (select list, WHERE parts, join) are kept. The keyset predicate and ORDER BY are drizzle `sql` fragments, so the cursor's `value`/`id` travel as **bound parameters**, never inlined.

**Minting `nextCursor`:**
- The query selects the sort expression as a framing column `"_sort_value"` (the `_` prefix can't collide with a normalizedKey).
- When there is a probe row, `nextCursor = encodeCursor({ sortBy, sortOrder, value, id: last._record_id })`.
- `value` is normalized by a new exported `readViewSortValue(raw: unknown): { value: string | number | null } | null`. A string or number passes through, a `Date` becomes `toISOString()`, `null` stays `null`, and anything else returns `null`, which means no cursor (the client stays on offset).
- `_sort_value` is stripped from every returned row, so `records` keeps its documented keys: the readable normalizedKeys plus `_record_id`/`_source_id`.

**Search (text-only):**
- `textColumns = readable.filter(c => pgTypeForColumnDefinitionType(c.type) === "text")`.
- A non-empty trimmed `search` pushes `(w.<c1> ILIKE <term> OR …)` over `textColumns`, with no `::text` cast, keeping the existing `\ % _` escaping and `quoteLiteral`.
- When `textColumns` is empty, it pushes `FALSE`. A search the caller typed narrows to nothing rather than being silently ignored.

**Count:**
- `EntityRecordCountCache.get(view.connectorEntityId, fp)`, falling back to the live `COUNT(*)` and then `set`.
- The fingerprint is `fp = EntityRecordCountCache.fingerprint({ search, filters, viewScope })`.
- `viewScope` = `` `${view.id}:${view.updated}:${readable.map(c => c.normalizedKey).sort().join(",")}` ``. It includes the readable set because search runs over readable columns, so two callers with different field grants never share a count.
- A Redis failure falls back to the live count (the cache already fails open).

### Count cache scope — `apps/api/src/services/entity-record-count.cache.ts:47`

`CountCacheScope` gains `viewScope?: string`, and `fingerprint` includes it as `viewScope: scope.viewScope ?? ""`. Entity-records fingerprints are unchanged in value, because the new key is `""` for them. A unit test pins one known hash.

### Route — `apps/api/src/routes/curated-view.router.ts:1049`

- Destructures `cursor` from the parsed query and passes it through.
- Responds with `{ columns, records, total, limit, offset, nextCursor }`. `CuratedViewRecordsResponsePayloadSchema` already admits `nextCursor` via `PaginatedResponsePayloadSchema`, so there's no contract-file change beyond doc comments.
- The `@openapi` block documents `cursor` and `nextCursor`, and states that `search` matches text columns only.

### Filter SQL — `apps/api/src/utils/filter-sql.util.ts:257-277`

`buildTypedStringCondition(colRef, operator, value, castToText: boolean)`. `contains`/`not_contains`/`starts_with`/`ends_with` emit `colRef ILIKE …` without `::text` when `castToText` is false. The dispatcher passes `castToText = dataType === "json"`. String columns map to `text`, so dropping the cast changes no result. `json` keeps the cast, although its allowed operators (`OPERATORS_BY_COLUMN_TYPE.json` = `is_empty`/`is_not_empty`) never reach this branch.

### Migration — `apps/api/drizzle/0126_enable-pg-trgm.sql`

```sql
-- #649: trigram indexes for curated-view text search (wide-table c_* text columns).
-- Trusted extension (PG13+): the database owner can create it. Idempotent; on
-- RDS it may be pre-created out-of-band, in which case this is a no-op.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

This is a custom migration (`drizzle-kit generate --custom`). `meta/_journal.json` and the `0126` snapshot are committed with it. It's not destructive, so `lint:migrations` passes untagged.

### Reconciler — `apps/api/src/services/wide-table-reconciler.service.ts`

```ts
/** Trigram index name for a text column (#649). Always 63 bytes, gistIndexName's scheme. */
export function trgmIndexName(connectorEntityId: string, columnName: string): string;
// → `er__${connectorEntityId}__${md5(physicalIdentifier(columnName)).slice(0,16)}_trgm`
```

`applyAdds` (`:588`) gains a branch beside the GiST one: when `add.pgType === "text"`, it runs `CREATE INDEX IF NOT EXISTS <trgmIndexName> ON <table> USING GIN (<col> gin_trgm_ops)`. That's a plain (non-concurrent) build inside the entity-lock transaction, sound for the same reason as GiST: the column is new and empty.

### Sweep — `apps/api/src/queues/processors/wide-table-search-index-sweep.processor.ts` (new)

```ts
export interface WideTableSearchIndexSweepSummary {
  tablesScanned: number;
  built: number;       // missing → created CONCURRENTLY
  rebuilt: number;     // INVALID → dropped + created
  dropped: number;     // on retired columns
  skipped: number;     // table/column vanished mid-sweep
  deferred: number;    // left for the next run (budget reached)
  durationMs: number;
}
export const wideTableSearchIndexSweepProcessor: (opts?: { maxBuilds?: number }) => Promise<WideTableSearchIndexSweepSummary>;
```

**Desired state:**
- One `_trgm` GIN index per **live** (`retired_at IS NULL`) `wide_table_columns` row with `pg_type = 'text'`, on `er__<id>` tables that exist (`to_regclass`).
- Tables of entities soft-deleted, or awaiting `entity_data_delete`, are skipped.

**Actual state** is read from `pg_index`/`pg_class`, by index name, plus `indisvalid`.

**Actions:**
- Each action is a separate autocommit statement on **one** pool client checked out for the run.
- Builds: `CREATE INDEX CONCURRENTLY IF NOT EXISTS …`.
- Rebuilds: `DROP INDEX CONCURRENTLY IF EXISTS` then build.
- Drops for retired columns: `DROP INDEX CONCURRENTLY IF EXISTS`.

**Budget and errors:**
- `maxBuilds` (env `WIDE_TABLE_SEARCH_INDEX_SWEEP_MAX_BUILDS`, default `25`) caps builds plus rebuilds per run. The remainder is `deferred`.
- An `undefined_table`/`undefined_column` error counts as `skipped`. Any other error is logged at warn with the index name, and the sweep continues.
- The summary is the BullMQ return value.

**Scheduler:** `maintenance.queue.ts` exports `WIDE_TABLE_SEARCH_INDEX_SWEEP_JOB = "wide-table-search-index-sweep"`. `registerMaintenanceSchedulers` upserts it at `{ pattern: "45 * * * *" }`, hourly at :45, clear of the :00/:30 purge starts. The first post-deploy run backfills existing tables within the hour. `maintenance.worker.ts` dispatches it, and `.env.example` and `environment.ts` carry the knob.

### Web

- **`apps/web/src/utils/curated-view-table.util.ts:48`:** `usePagination({ mode: "keyset", … })`, and the `#649` comment is removed.
- **`apps/web/src/views/CuratedViewDetail.view.tsx`:** wraps the table in `SyncNextCursor nextCursor={data?.nextCursor}` and renders `pagination.transformPage(records)`, as `EntityDetail.view.tsx:515-538` does. `handleSort`'s manual offset reset is dropped, since keyset mode resets the walk on a sort change.
- **`apps/web/src/components/PaginationToolbar.component.tsx`:** `PaginationToolbarProps` gains `searchPlaceholder?: string`, defaulting to `"Search..."`. The view passes `"Search text columns"`. This replaces discovery recommendation 7's "hide the box": the API's `FALSE` already makes a no-text-column search honest, and a hidden box would read as a missing feature.

## Migration

`0126_enable-pg-trgm.sql` is the only migration. No table changes, no backfill migration (the sweep is the backfill), and no seed.

## Seed

None.

## TDD test plan

Run per package: `npm run test:unit -- --testPathPattern <file>` and `npm run test:integration -- --testPathPattern <file>` from `apps/api` or `apps/web`. Never raw jest.

### `apps/api` unit

- **`__tests__/db/repositories/entity-records-order-by.test.ts`** (extend):
  - a custom tiebreaker appears in ORDER BY with the sort's direction
  - the default stays `entity_records.id`
  - the short-circuit fires when column is the tiebreaker
  - the predicate uses a custom tiebreaker in the NOT NULL, nullable and NULL-anchor forms
  - **(5)**
- **`__tests__/services/wide-table-reconciler.gist-name.test.ts`** (extend):
  - `trgmIndexName` is exactly 63 bytes
  - two long-prefix columns get distinct names
  - it shares the hash with `gistIndexName`, with a different suffix
  - **(3)**
- **`__tests__/services/entity-record-count.cache.test.ts`** (extend):
  - `viewScope` changes the fingerprint
  - an absent `viewScope` keeps the pinned pre-#649 hash
  - **(2)**
- **`__tests__/utils/filter-sql.util.test.ts`** (new or extend):
  - string `contains`/`starts_with`/`ends_with`/`not_contains` emit no `::text`
  - `json` keeps it
  - **(5)**
- **`__tests__/services/portal-sql-view-records.util.test.ts`** (new), `readViewSortValue`:
  - string, number, Date → ISO, null, object → null
  - **(5)**
- **`__tests__/queues/maintenance.worker.test.ts`** (extend):
  - dispatches the sweep job name
  - **(1)**

### `apps/api` integration

- **`__integration__/routes/curated-view.router.integration.test.ts`** (extend):
  - a keyset walk over `created`, a numeric column and a string column returns every row exactly once, matching an offset walk
  - a mismatched-sort cursor serves page 1
  - a garbage cursor serves page 1
  - `nextCursor` is null on the last page
  - `_sort_value` is never in `records`
  - DESC column sort with NULLs: NULLs last, ties broken DESC
  - walking to the last page by inverted sort over a column with NULLs matches the forward walk's tail (Q4)
  - search matches a text column, never a number/date cell, never a hidden column
  - search on a view with no text columns returns 0 rows and `total: 0`
  - the cursor value is bound, not inlined (a `'` in a string sort value round-trips)
  - two callers with different field grants get independent cached totals
  - a record write bumps the version and the total refreshes
  - **(13)**
- **`__integration__/services/wide-table-reconciler.service.integration.test.ts`** (extend):
  - adding a string/enum/reference column creates a valid `_trgm` GIN index
  - a number column gets none
  - re-reconcile is idempotent
  - **(3)**
- **`__integration__/queues/wide-table-search-index-sweep.integration.test.ts`** (new):
  - builds a missing index on a populated table
  - rebuilds an `INVALID` index (simulated with `UPDATE pg_index SET indisvalid=false`)
  - drops the index on a retired column
  - skips a dropped table
  - skips a soft-deleted entity
  - respects `maxBuilds` and reports `deferred`
  - a second run is a no-op
  - **(7)**
- **`__integration__/db/migrations` / the fresh-DB run:** covered by CI's migrate. The extension test is the reconciler case above. **(0)**

### `apps/web`

- **`src/__tests__/curated-view-table.util.test.tsx`** (extend):
  - the hook runs keyset mode: `queryParams` carries `cursor`, not `offset`, after Next
  - a sort change resets the cursor stack
  - **(2)**
- **`src/__tests__/CuratedViewDetailView.test.tsx`** (extend):
  - Next sends the response's `nextCursor`
  - Prev returns to the previous page
  - the search placeholder reads "Search text columns"
  - **(3)**
- **`src/__tests__/PaginationToolbar.test.tsx`** (extend):
  - `searchPlaceholder` renders, with the default otherwise
  - **(1)**

**Totals ≈ 50 cases** (unit 21, integration 23, web 6).

### Measurement (recorded in the PR, not a test)

`EXPLAIN (ANALYZE, BUFFERS)` against a ~400K-row app-dev-shaped `er__` table, before and after, for:
- page 1 and a deep page under `created`
- a numeric column sort
- a 3-character and an 8-character search
- a selective number range filter
- a string `contains` filter
- one sync's write time with and without the trigram indexes

A column sort or range filter over 1s opens the btree follow-up.

## Acceptance criteria

- [ ] Paging a view of ~400K rows to page 1, 100 and the last page each answers in comparable time. There's no OFFSET growth (measured).
- [ ] A keyset walk yields every matching row exactly once under every sort, including DESC with NULLs.
- [ ] A stale, garbage or cross-sort cursor never errors. It serves the first page.
- [ ] Search finds substrings in string/enum/reference columns and never matches number/date cells or columns the caller can't read. The box says "Search text columns".
- [ ] Text search and string `contains` filters use a trigram bitmap scan on a production-sized table (measured).
- [ ] A new text column gets its `_trgm` index at first sync. Existing text columns gain theirs within an hour of deploy, without blocking syncs.
- [ ] Retired columns lose their `_trgm` index on the next sweep.
- [ ] Repeating a page or pressing Prev/Next doesn't re-run `COUNT(*)` inside the cache window. Callers with different field grants never see each other's totals.
- [ ] `pg_trgm` is created by migration on app-dev (or confirmed pre-created), and the Helm README names it.
- [ ] The measurement is recorded on the PR, and the btree follow-up is filed only if the 1s threshold trips.

## Risks & rollback

- **Sync write amplification** from GIN on every text column. It's mitigated by GIN `fastupdate` (default on) and measured in the PR. If it's unacceptable, the rollback is operational: set `WIDE_TABLE_SEARCH_INDEX_SWEEP_MAX_BUILDS=0`, so the sweep builds nothing (retired-column drops still run), then drop the `_trgm` indexes. Search stays correct without them, only slower. **Fail-open on performance, never on correctness.**
- **`CREATE EXTENSION` refused** on a managed DB. The migration fails and the deploy halts loudly, which is fail-closed. Remediation is a superuser `CREATE EXTENSION pg_trgm`, the same path as PostGIS.
- **A long concurrent build** holds the maintenance worker's single slot. `maxBuilds` bounds a run. A concurrent build waits on older transactions but never blocks writes.
- **The cursor across deploys.** An old client sends `offset` only, and that still works because offset is kept.
- **Count staleness** is ≤60s after a non-bumping change. View edits change `updated`, so they're in the key.
- **Rollback** is to revert the PR. The extension and indexes are harmless left in place (or drop the `_trgm` indexes), and offset paging returns.

## Files touched

- **Edit:**
  - `apps/api/src/db/repositories/entity-records.repository.ts`
  - `apps/api/src/services/portal-sql.service.ts`
  - `apps/api/src/services/entity-record-count.cache.ts`
  - `apps/api/src/routes/curated-view.router.ts`
  - `apps/api/src/utils/filter-sql.util.ts`
  - `apps/api/src/services/wide-table-reconciler.service.ts`
  - `apps/api/src/queues/maintenance.queue.ts`
  - `apps/api/src/queues/maintenance.worker.ts`
  - `apps/api/src/environment.ts`
  - `apps/api/.env.example`
  - `packages/core/src/contracts/curated-view.contract.ts` (doc comments)
  - `apps/web/src/utils/curated-view-table.util.ts`
  - `apps/web/src/views/CuratedViewDetail.view.tsx`
  - `apps/web/src/components/PaginationToolbar.component.tsx`
  - `deploy/helm/portalai/README.md`
  - Help/FAQ copy, if it describes view search
- **New:**
  - `apps/api/drizzle/0126_enable-pg-trgm.sql`, plus its journal and snapshot
  - `apps/api/src/queues/processors/wide-table-search-index-sweep.processor.ts`
  - the sweep integration test
  - `portal-sql-view-records.util.test.ts`

## Next step

`/plan 649` writes `docs/CURATED_VIEW_RECORDS_AT_SCALE.plan.md` in roughly six TDD slices on this branch:

1. Generalize the keyset helpers.
2. Keyset and minting on the view endpoint, plus the count cache.
3. The `pg_trgm` migration, `trgmIndexName` and the reconciler build.
4. Text-only search and cast-free string filters.
5. The sweep and its scheduler.
6. The web keyset switch and placeholder.

The measurement and doc sync close out the branch.
