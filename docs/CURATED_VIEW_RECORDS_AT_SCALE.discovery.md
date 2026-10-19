# Curated-view records at scale — Discovery

**Issue:** [EnterpriseBT/portal-ai#649](https://github.com/EnterpriseBT/portal-ai/issues/649)

**Why this exists.** #599 (PR #642) gave curated views a records table: `GET /api/curated-views/:id/records` reads the entity's `er__<entityId>` wide table through the view's projection and row filter, with `sortBy` / `sortOrder` / `search` / `filters`. The behavior is correct, and it has three costs that grow with the table. Offset paging makes deep pages pay for every row before them. An arbitrary-column `ORDER BY` sorts the whole filtered set on every page. Search is a leading-wildcard `ILIKE` across every projected column, so it always runs a sequential scan, and an uncached exact `COUNT(*)` repeats that scan on every request. These are the same costs #433 measured on `entity_records` (14.6s vs 86ms for a missing sort index; 24.5s vs 21ms for `OFFSET` vs keyset). The entity-records table got keyset paging for that reason. The view table did not, and its hook says so (`apps/web/src/utils/curated-view-table.util.ts:45`, "keyset for views is #649").

This is the work that gives the view records table keyset paging, an indexed search path and a cached count, so a view over a 400K-row entity pages as fast as the entity's own table does.

## The current shape

### The records endpoint

| Piece | Location | Shape today |
|---|---|---|
| Route | `apps/api/src/routes/curated-view.router.ts:1049-1103` (OpenAPI `:1010-1048`) | Parses `CuratedViewRecordsRequestQuerySchema` and answers `{columns, records, total, limit, offset}`. It never reads `cursor` or returns `nextCursor`. |
| Contract | `packages/core/src/contracts/curated-view.contract.ts:203-235` | Extends `PaginationRequestQuerySchema`, so `cursor` is **already accepted** and then ignored. The response extends `PaginatedResponsePayloadSchema`, so `nextCursor` is already in the shape. |
| Query builder | `apps/api/src/services/portal-sql.service.ts:568-735` (`queryCuratedViewRecords`) | Raw SQL strings over `er__<id> w`: org + `deleted IS NULL`, the view filter (`renderViewFilterWhere`, `:458`), ad-hoc `filters` limited to readable columns (`:647-663`). |
| Search | `portal-sql.service.ts:669-677` | Escapes `\ % _`, then ORs `w.<col>::text ILIKE '%term%'` across **every** projected column of every type. |
| Sort | `portal-sql.service.ts:691-711` | `created` joins `entity_records r` and orders by `r.created`. A projected column of a `SORTABLE_COLUMN_TYPES` type (`packages/core/src/models/column-definition.model.ts:51`: string, number, date, datetime) orders by `w.<col> DIR, w.entity_record_id ASC`. Anything else orders by `w.entity_record_id DIR`. The tiebreaker is **always ASC**, and there is no `NULLS` clause. |
| Paging / count | `portal-sql.service.ts:713-727` | `LIMIT` (clamped 1..500) `OFFSET n`, with an exact `COUNT(*)` run in parallel on every request and never cached. |

### The keyset precedent (#433)

| Piece | Location | Note |
|---|---|---|
| Cursor codec | `packages/core/src/contracts/pagination.contract.ts:48-127` | `KeysetCursorSchema` is `{sortBy, sortOrder, value, id}`, encoded as base64url JSON. `decodeCursor` never throws: a bad cursor means the first page. |
| Route handling | `apps/api/src/routes/entity-record.router.ts:211-467` | Uses a cursor only when its `sortBy`/`sortOrder` match the effective sort (`:341-352`). Fetches `limit+1`. `nextCursor` comes from the last row via `readSortValue` (`:91-109`). |
| Seek predicate | `apps/api/src/db/repositories/entity-records.repository.ts:986-1009` (`buildKeysetPredicate`) | Row-value comparison for NOT NULL columns. Nullable columns expand to `col > v OR (col = v AND id > x) OR col IS NULL`. |
| Order clause | `entity-records.repository.ts:1011-1032` (`buildOrderByClause`) | `NULLS LAST` only on nullable columns. The tiebreaker takes the **same direction** as the sort, so a single index scan can serve it. |
| Limitation | both helpers | `entityRecords.id` is hard-coded as the tiebreaker, so they can't seek on `w.entity_record_id` yet. |

### Wide tables, indexes, count

- `ensureTable` (`apps/api/src/services/wide-table-reconciler.service.ts:224-267`) creates the `entity_record_id` PK, `er__<id>__org_idx` and the unique `source_id` index. **No `c_*` column has a btree or trigram index.** Only geometry columns get one: `applyAdds` (`:600-630`) builds a GiST index in the transaction, which is cheap only because a new column is empty. Type conversion does the same (`:455-470`).
- `gistIndexName` (`:178-197`, #804) builds a fixed-length 63-byte name `er__<uuid>__<md5(col)[0:16]>_gist`. A trigram index name can use the same scheme.
- **No `pg_trgm` extension is installed.** The only extension migration is `apps/api/drizzle/0076_enable-postgis.sql:13`. The latest migration is `0125`.
- Storage types (`wide-table-reconciler.service.ts:70-87`): string/enum/reference → `text`; number → `numeric`; date/datetime → `timestamptz`; reference-array → `text[]`; array/json → `jsonb`.
- `EntityRecordCountCache` (`apps/api/src/services/entity-record-count.cache.ts`) holds exact counts in Redis per (entity, fingerprint of search/filters/isValid) with a 60s TTL. A per-entity version bump invalidates it (e.g. `record-write.service.ts:172`, `revalidation.processor.ts:144`), and it fails open. The view endpoint doesn't use it.
- Entity-records search (`entity-record.router.ts:262-269`) does `concat_ws(' ', <text, text[], jsonb cols>) ILIKE '%term%'` (`wide-table-statement.cache.ts:191-200`). That is the same unindexable shape, over a narrower column set.

### Frontend

- `CuratedViewDetail.view.tsx:195-300` pages through `useCuratedViewTablePagination` (`curated-view-table.util.ts:48-100`, offset only) and `sdk.curatedViews.records` (`apps/web/src/api/curated-views.api.ts:63-77`).
- `usePagination`'s keyset mode (`apps/web/src/components/PaginationToolbar.component.tsx:212-540`) keeps a cursor stack for Prev. It reaches the last page by inverting `sortOrder` and asking for `lastPageSize` rows, so it depends on `total`.
- `EntityDetail.view.tsx:313-324, 515-538` is the reference wiring (`mode: "keyset"`, `SyncNextCursor`, `transformPage`).

## The design space

### Decision 1 — Paging model

- **A. Keyset cursor on the records endpoint.** Honor `cursor`, return `nextCursor`, fetch `limit+1`, and drop `OFFSET` when a cursor is in play. The web switches to `mode: "keyset"`.
- **B. Keep offset and cap the depth.** Refuse `offset` past N. This is cheap, and it breaks "go to last page" on big views.
- **C. Keyset only for the default `created` sort**, offset otherwise. This leaves two code paths, and the expensive sorts stay on the slow one.

| | A | B | C |
|---|---|---|---|
| Fixes OFFSET spill | Yes | Hides it | Partly |
| Contract change | Additive (fields already in schema) | New 400 | Additive |
| Parity with entity table | Yes | No | Partial |

**Lean: A.** The contract already carries both fields. It matches the entity table users already know, and #433 measured exactly this gap.

### Decision 2 — Sharing the keyset SQL with entity-records

- **A. Generalize `buildKeysetPredicate` / `buildOrderByClause`** to take the tiebreaker as an argument (`entityRecords.id` stays the default). The view query composes its ORDER BY and seek predicate as drizzle `sql` fragments around its existing `sql.raw` body.
- **B. A raw-string twin inside `portal-sql.service.ts`.** Two copies of the nullable-expansion logic, which #433 got wrong once already.

**Lean: A.** One seek implementation. This also fixes the view's order clause, whose ASC-only tiebreaker under a DESC sort can't be served by one index scan and doesn't mirror cleanly for the last-page inversion. Every `c_*` column is nullable, so view sorts get `NULLS LAST` and the expanded predicate.

### Decision 3 — Indexes for arbitrary-column sort

- **A. No per-column btrees.** Keyset bounds the sort's memory (a top-N heap of `limit+1` rows), though each page still scans the filtered set. The default `created` sort streams through the existing `entity_records_entity_created_id_idx` (`apps/api/src/db/schema/entity-records.table.ts:69-80`) joined to the wide-table PK.
- **B. A `(col, entity_record_id) WHERE deleted IS NULL` btree for every sortable column.** Built at column add, with a concurrent backfill for existing columns. Most columns are sortable types, so a 30-column entity carries ~30 more indexes on every sync write.
- **C. On-demand indexes** for columns a view's sort actually uses. The sort is an ad-hoc header click, so there's no stable signal to build from.

| | A | B | C |
|---|---|---|---|
| Column-sort page cost | Scan + top-N | Index stream | Varies |
| Sync write amplification | None | ~1 index per column | Unpredictable |
| Parity with entity table | Same (it has none either) | Better than entity | — |

**Lean: A, with a recorded measurement.** Every 400K-row sync would pay for B's write cost, to speed up a view action that is rarer than syncs. The entity table lives with A today. The plan records `EXPLAIN ANALYZE` for a column-sorted first and deep page against a production-sized `er__` table. If a page exceeds the threshold in Open question 1, B follows as its own ticket.

### Decision 4 — Search path

- **A. A per-column `gin_trgm_ops` index on `text` columns** (string/enum/reference), with search restricted to those columns. `col ILIKE '%term%'` OR-ed across indexed columns becomes a BitmapOr of GIN scans. The index is built in the transaction at column add (empty, as GiST is), named `er__<uuid>__<md5(col)[0:16]>_trgm`. A sweep fills in existing columns.
- **B. One expression trigram index over a `concat_ws` search document** per table. It's a single index, but its expression names the column list, so every column add, drop or rename rebuilds a full-table GIN, and that has to run concurrently outside the reconciler's transaction.
- **C. Full-text `tsvector`.** This changes the semantics from substring to word match ("Spring" no longer matches "Springfield").
- **D. Keep the seq scan and bound it** with an admission gate and timeout. It contains the blast radius and never gets faster.

| | A | B | C | D |
|---|---|---|---|---|
| Survives schema churn | Yes, per column | Rebuild per change | Rebuild per change | n/a |
| Substring semantics | Kept | Kept | Lost | Kept |
| Searches number/date cells | **No** | No | No | Yes |
| Write cost | GIN per text column (fastupdate) | One GIN | One GIN | None |

**Lean: A.** It's the only option that stays correct under the reconciler's column churn without a full-table rebuild. The restriction is required, not a choice: a single unindexed OR branch (`c_amount::text ILIKE …`) makes the planner seq-scan the whole disjunction anyway. Text columns are also what entity-records search covers, apart from `text[]`/`jsonb`, so the two tables' search semantics converge.

### Decision 4b — Filters (the view's stored filter and the reader's ad-hoc `filters`)

Both kinds of filter go through `renderFilterGroupToSql` (`apps/api/src/utils/filter-sql.util.ts:143`), which compiles each condition by column type (`:236-254`). The operators a type allows are in `OPERATORS_BY_COLUMN_TYPE` (`packages/core/src/contracts/filter.contract.ts:36-95`). Narrowing search to text columns therefore takes nothing away: number and date cells stay reachable through typed `eq`/`gt`/`between` filters, which is the right tool for them anyway. What's left is speed, and it splits by operator:

| Operator on | SQL today | Served by |
|---|---|---|
| string `contains` / `starts_with` / `ends_with` | `col::text ILIKE …` (`:268-275`) | **D4's trigram index**, for free. The `::text` cast is a no-op on a `text` column, but the builder drops it for text-stored types so index matching never depends on it. |
| string / enum / reference `eq` | `col = v` | The trigram index (pg_trgm ≥ 1.6 / PG14+ supports `=`). Confirmed in the measurement. |
| enum `in` | `col IN (…)` | Unindexed (trigram doesn't serve `= ANY`). Low-cardinality columns, so a scan is rarely selective enough to matter. |
| number / date `gt`…`between`, `eq` | `col > v` etc. (`:281-350`) | **Unindexed.** This needs the same `(col, entity_record_id)` btree that D3 declines for sort, so D3's measurement gate covers range filters too. |
| `neq` / `not_contains` / `is_empty` / boolean / array | various | Unindexed. These are low selectivity by nature, and an index wouldn't be chosen. |

Two properties follow from how conditions combine. An `and` group is fast whenever *one* of its branches is indexed: the bitmap narrows the rows and the rest is rechecked. An `or` group with *any* unindexed branch scans the table, the same rule that forced D4's text-only search. The count is cached (D6), so an unindexed filter's scan repeats once per cache window rather than on every page.

**Lean: no filter-specific indexes.** String filters ride on D4. Number/date range filters join D3's measurement, and a btree follow-up, if it trips, serves both sort and range filtering. The view's stored filter is a constant per view, so a per-view partial index is conceivable, but the reconciler would have to track view edits. It's out of scope.

### Decision 5 — Building trigram indexes on existing tables

- **A. A repeatable sweep on the `maintenance` queue.** It lists `text` columns lacking a valid `_trgm` index, builds one at a time `CONCURRENTLY`, and drops and rebuilds any `INVALID` index a failed build left behind. It's self-healing, so it also covers columns a type conversion turned into `text` on a populated table.
- **B. A one-shot migration with a `DO` block.** It can't run `CONCURRENTLY` inside the migration transaction, so it would write-lock every wide table during deploy.

**Lean: A.** `entity-record-retention-purge.processor.ts` is the pattern (batch loop, env-configured cadence, summary as `returnvalue`). It uses one connection at a time, so it doesn't crowd the shared 10-connection pool (#698).

### Decision 6 — Total count

- **A. Reuse `EntityRecordCountCache`**, keyed by entity plus a fingerprint of (view id, view `updated`, the caller's readable-column set, filters, search). Entity writes already bump its version.
- **B. Drop `total`** and show "N+" from `limit+1`. This breaks keyset's jump-to-last-page, which inverts the sort and needs `total`.

**Lean: A.** A repeated page or a Prev/Next click stops re-counting. The readable-column set belongs in the key because search runs over projected readable columns, so two callers with different field grants can get different counts.

## Tradeoff comparison

| | Keyset (D1) | Shared helpers (D2) | No sort btrees (D3) | Per-column trgm (D4) | Sweep (D5) | Count cache (D6) |
|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes (measurement gate) | Yes | Yes | Yes |
| New migration | No | No | No | `pg_trgm` extension | No | No |
| User-visible change | Paging feel | Sort order of NULLs | None | Search skips non-text cells | None | None |

## Recommendation

1. `GET /api/curated-views/:id/records` honors `cursor` (`KeysetCursorSchema`, matched against the effective sort as entity-records does), fetches `limit+1`, drops `OFFSET` under a cursor, and returns `nextCursor`; OpenAPI is updated.
2. `buildKeysetPredicate` and `buildOrderByClause` take an optional tiebreaker column. The view query uses them with `w."entity_record_id"`, so its tiebreaker follows the sort direction and nullable `c_*` sorts get `NULLS LAST`.
3. No per-column sort btrees. The plan records `EXPLAIN ANALYZE` evidence for the `created` and column sorts, first and deep page, against a production-sized `er__` table, with no plan assertions in tests.
4. A migration runs `CREATE EXTENSION IF NOT EXISTS pg_trgm`, in the shape of `0076_enable-postgis.sql`.
5. The reconciler creates a `gin_trgm_ops` index, named by a `trgmIndexName` twin of `gistIndexName`, whenever it adds a `text` column. It drops the index when the column is dropped or converted away from `text`.
6. A repeatable `maintenance`-queue sweep builds any missing or `INVALID` `_trgm` index `CONCURRENTLY`, one at a time. A table dropped mid-sweep is skipped, not failed.
7. View search matches only `text`-stored projected columns, OR-ed per column, keeping the existing metacharacter escaping. A view with no text columns hides the search box. Its hint points to filters for number and date values.
8. `filter-sql.util.ts` emits string-operator conditions on `text`-stored columns without the `::text` cast, so the trigram index serves view filters and entity-records filters alike. No other filter changes.
9. The view's `total` comes from `EntityRecordCountCache`, under a fingerprint that includes the view id, its `updated`, the caller's readable-column set, filters and search.
10. `CuratedViewDetail` switches `useCuratedViewTablePagination` to `mode: "keyset"` with `SyncNextCursor`, mirroring `EntityDetail.view.tsx`.

## Open questions

1. **What latency makes Decision 3 flip to per-column btrees?** The measurement covers a column-sorted page and a selective number/date range filter, under both the default `created` sort and a column sort. **Lean:** either case over 1s at 400K rows opens a follow-up, since one btree serves both. Below that, the write cost isn't worth it.
2. **Is `pg_trgm` creatable without superuser on our RDS instances and on a residency customer's Postgres?** It's a trusted extension since PG13, so the database owner should be able to create it, but 0076's notes record PostGIS needing `rds_superuser`. **Lean:** verify on app-dev during smoke. The Helm/residency install notes gain the same out-of-band line 0076 carries.
3. **Should the sweep also give entity-records search its indexes?** Its `concat_ws` expression can't use per-column indexes. **Lean:** no. Rewriting it to per-column ORs (and escaping its LIKE metacharacters, which it doesn't do today) is a natural follow-up ticket, and the indexes this ticket builds serve it unchanged.
4. **Does the last-page inversion stay correct with `NULLS LAST` on both directions?** Inverting ASC NULLS LAST gives DESC NULLS LAST, which isn't a pure reverse. **Lean:** mirror entity-records exactly through the shared helpers. Any asymmetry is a shared bug with one fix, and the spec adds a test that walks to the last page over a column with NULLs.

## Enterprise-scale considerations

- **Concurrency & correctness.** **Lean:** keyset tolerates inserts and deletes between pages without repeats or skips along the walk (OFFSET doesn't). A cursor whose sort no longer matches resets to the first page. `CREATE INDEX CONCURRENTLY` doesn't block sync writes. A concurrent `DROP COLUMN`/table drop makes that build fail harmlessly, and the next sweep cleans up the `INVALID` remnant.
- **Accuracy & auditability.** **Lean:** counts stay exact (cached, never estimated). A 60s-stale total after an unrelated write is already the entity table's contract, and the version bump clears it on writes to this entity.
- **Failure modes.** **Lean:** fail open on performance, closed on correctness. A missing trigram index leaves search correct but slow, Redis down means a live count, and the extension migration failing fails the deploy loudly rather than shipping a search that 500s.
- **Scale & unbounded growth.** **Lean:** this is the ticket's point. Page cost stops growing with depth, and search becomes index-driven. Trigram write amplification grows with the number of text columns, and GIN `fastupdate` is the mitigation. The recorded measurement includes a sync's write time before and after.
- **Multi-tenancy.** **Lean:** indexes sit on per-entity tables, so each org pays only for its own data. The sweep builds one index at a time on the `maintenance` queue, so no tenant's backfill monopolizes the shared pool. The count-cache key includes the caller's readable-column set, so a count never crosses grant scopes.
- **Contract stability.** **Lean:** additive. `cursor`/`nextCursor` already exist in the schema. The search narrowing to text columns is the one semantic change, and it's recorded in the OpenAPI description and Help copy.
- **Data lifecycle.** N/A because nothing new is retained. The count cache's existing 60s TTL and the indexes' lifetime track their tables.

## What this doesn't decide

- Per-column sort btrees. Gated on the Open question 1 measurement and filed separately if it trips, because the write cost lands on every sync.
- Entity-records search rewrite and its missing LIKE escaping (Open question 3). It's a separate surface, and this ticket's indexes already serve it.
- Searching `text[]` / `jsonb` / number / date cells. Those need expression indexes over non-immutable casts, or a different search model.
- Agent-side `sql_query` performance over views. That's a different path (`runSqlQuery`) with its own cost gate.

## Next step

`/spec 649` writes `docs/CURATED_VIEW_RECORDS_AT_SCALE.spec.md`, the endpoint contract (cursor, `nextCursor`, the search column set, count fingerprint) and the index/sweep contract. `/plan 649` slices it into roughly five commits:

1. Generalize the keyset helpers.
2. Keyset on the view endpoint plus the web switch.
3. The `pg_trgm` migration and the reconciler's trigram index at column add/drop.
4. The maintenance sweep.
5. Text-only indexed search plus the cached count.

The production-sized measurement is recorded in the PR.
