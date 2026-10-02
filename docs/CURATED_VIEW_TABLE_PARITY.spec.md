# Curated view table parity with the entity records table — Spec

**Issue:** [EnterpriseBT/portal-ai#678](https://github.com/EnterpriseBT/portal-ai/issues/678) · **Discovery:** `docs/CURATED_VIEW_TABLE_PARITY.discovery.md`

This pins the contract that makes the curated view detail table the same table as the entity detail page's: field-mapping headers with a `label · type` caption, type-aware cells, the advanced filter builder, sort, and the column order and visibility picker, persisted per view. The view's projection, its own filter and the caller's per-column read grants keep deciding what the table can show. The new ad-hoc filter can only narrow, and only over the caller's readable projected columns.

## Key decisions (flag for review)

1. **One column shape.** The records response returns the caller's readable projected columns as `ResolvedColumn` (the entity list's shape), in the entity's field-mapping order. Rows, `sortBy`, filter fields and headers are all keyed by `normalizedKey`.
2. **The picker's universe is the readable projection.** The columns that can be reordered or shown/hidden are exactly the readable projected field mappings the response returns. Nothing outside the projection or the caller's grants appears, not even hidden. The table has no validity column and no Cached/Live chip.
3. **Ad-hoc filter = the entity list's `filters`** (base64 `FilterExpression`). It's validated against **only** the readable projected columns: a field outside them is "Unknown field", 400. It's then rendered with `renderFilterGroupToSql` and ANDed **after** the view's own filter. It narrows by construction and is never an oracle on a hidden column (the `queryViewRowsByColumn` rule).
4. **Sorting json/array columns is refused.** `sortBy` naming a projected column whose type isn't in `SORTABLE_COLUMN_TYPES` gives 400 `CURATED_VIEW_INVALID_SORT`; the UI never offers it. A `sortBy` naming no projected column (e.g. the default `created`) still falls back to the stable record-id order, unchanged.
5. **Failure is fail-closed.** A malformed, unknown-field or wrong-operator filter gives 400 before any query. A missing `filters` behaves exactly as today. The view's stored filter keeps its own 500 path (`CURATED_VIEW_INVALID_FILTER`) when it fails to render.
6. **The view's own filter isn't displayed.** The details keep "Row filter: Filtered / All rows"; the builder holds only the reader's narrowing. (The pre-existing payload exposure of the raw filter is #680, out of scope.)
7. **Offset paging stays.** Keyset and indexes for view records are #649.

## Scope

### In scope
- **Core:** the records request gains `filters`; the response columns become `ResolvedColumn`, and `CuratedViewRecordColumnSchema` is removed.
- **API:** `queryCuratedViewRecords` returns `ResolvedColumn`s with `normalizedKey`-keyed rows, takes the scoped `filters`, and refuses unsortable `sortBy`. The route passes `filters` through. New `ApiCode.CURATED_VIEW_INVALID_SORT`. `@openapi` updated.
- **Web:**
  - `EntityRecordDataTableUI` gains options: no validity column, no source chip, a caller-supplied column-config key.
  - `CuratedViewDetail` renders it with the filter builder and per-view persistence.

### Out of scope
- #680 (readers receive the raw view filter and full projection ids).
- #649 (keyset paging for view records).
- Agent-tool access to the ad-hoc filter.
- Editing the view's own filter from this page.

## Surface

### `packages/core/src/contracts/curated-view.contract.ts`

```ts
import { ResolvedColumnSchema } from "./entity-record.contract.js";

export const CuratedViewRecordsRequestQuerySchema =
  PaginationRequestQuerySchema.extend({
    /** #678: base64-encoded JSON FilterExpression (the entity records list's
     *  format), ANDed after the view's own filter. Fields must be the caller's
     *  readable projected columns (normalizedKey). */
    filters: z.string().optional(),
  });

export const CuratedViewRecordsResponsePayloadSchema =
  PaginatedResponsePayloadSchema.extend({
    /** #678: the caller's readable projected columns, in the entity's field-mapping order (as the entity table) — the
     *  whole set the table can show, sort, filter, reorder or hide. */
    columns: z.array(ResolvedColumnSchema),
    /** Keyed by normalizedKey, plus `_record_id` and `_source_id`. */
    records: z.array(z.record(z.string(), z.unknown())),
  });
```

- **Removals:** `CuratedViewRecordColumnSchema` and the `CuratedViewRecordColumn` type are deleted, with no alias. The web view is the only consumer.
- **Framing keys:** `_record_id` and `_source_id`. `source_id` is renamed because a `normalizedKey` (`^[a-z][a-z0-9_]*$`) can be `source_id`, but can never start with `_`.

### `apps/api/src/constants/api-codes.constants.ts`
- `CURATED_VIEW_INVALID_SORT = "CURATED_VIEW_INVALID_SORT"`, under the curated-view block.
- `CURATED_VIEW_INVALID_FILTER` (existing) is reused for an invalid **request** filter as a **400**. A stored filter that fails to render stays a 500.

### `apps/api/src/services/portal-sql.service.ts` — `queryCuratedViewRecords`

```ts
async queryCuratedViewRecords(
  viewId: string, organizationId: string, userId: string,
  opts: { limit: number; offset: number; sortBy?: string; sortOrder?: "asc" | "desc";
          search?: string;
          /** #678: base64 FilterExpression over the readable projected columns. */
          filters?: string },
  client: DbClient = db
): Promise<{ records: Record<string, unknown>[]; total: number; columns: ResolvedColumn[] } | null>
```

1. **Scope (unchanged):** `resolveViewColumnsById` handles org, read on the view, `deny read entity_record`, and the projection ∩ the caller's field grants. `null` → 404.
2. **Readable columns:** `readable = resolvedCols` filtered to the projected (readable) normalizedKeys, in field-mapping order (the entity table's order), each carrying its `columnName`. It is returned as `columns`, and it's the **only** column set used below.
3. **Select list:** `w."entity_record_id" AS "_record_id"`, `w."source_id" AS "_source_id"`, and for each projected column `w.<quoteIdent(columnName)> AS <quoteIdent(normalizedKey)>`.
4. **WHERE**, in this order, joined with AND:
   - org guard; deleted guard;
   - the view's own filter (`renderViewFilterWhere`, unchanged);
   - **the ad-hoc filter**;
   - search (unchanged: projected columns only).
5. **Ad-hoc filter:**
   - `const parsed = parseFilterPayload(opts.filters, readable)`. A `FilterValidationError` → `ApiError(400, CURATED_VIEW_INVALID_FILTER, message)`.
   - Then `renderFilterGroupToSql(expression, stmt, columnTypes)`, with `stmt` from `deps.statementCache.get(view.connectorEntityId)`. A render error → the same 400.
   - Pushed as `(${rendered})`.
   - Because `readable` is the validation set, a field outside it is refused before any SQL is built.
6. **Sort:**
   - `sortCol = readable.find(r => r.normalizedKey === opts.sortBy)`.
   - If found and `!SORTABLE_COLUMN_TYPES.has(sortCol.type)` → `ApiError(400, CURATED_VIEW_INVALID_SORT, "Column \"<key>\" can't be sorted")`.
   - If found and sortable → `ORDER BY w.<columnName> <dir>, w."entity_record_id" ASC`.
   - If not found → `ORDER BY w."entity_record_id" <dir>` (unchanged fallback).
7. **Count:** shares the same `whereSql`.

### `apps/api/src/routes/curated-view.router.ts` — `GET /:id/records`
- Parse `filters` and pass it through.
- **Errors:** the 400s propagate (`ApiError` is rethrown, as today). The `catch` that maps unknown errors to `CURATED_VIEW_FETCH_FAILED` is unchanged.
- **`@openapi`:**
  - add `{ in: query, name: filters, schema: { type: string }, description: base64 FilterExpression over the readable projected columns }`;
  - the 200 schema's `columns` becomes `$ref: '#/components/schemas/ResolvedColumn'` (newly registered from `ResolvedColumnSchema` via `z.toJSONSchema` in `swagger.config.ts`; it isn't there today);
  - add `400: { description: Invalid filter (CURATED_VIEW_INVALID_FILTER) or unsortable sortBy (CURATED_VIEW_INVALID_SORT) }`.

### `apps/web/src/components/EntityRecordDataTable.component.tsx`

```ts
export interface EntityRecordDataTableUIProps {
  connectorEntityId: string;
  rows: Record<string, unknown>[];
  columns: ResolvedColumn[];
  /** Cached/Live chip; omitted → no chip (#678: a curated view has none). */
  source?: "cache" | "live";
  /** #678: include the `isValid` column (default true; views have no is_valid). */
  showValidity?: boolean;
  /** #678: column-config storage key (default `column-config:entity-records:${connectorEntityId}`). */
  columnConfigKey?: string;
  sortColumn?: string; sortDirection?: "asc" | "desc";
  onSort?: (column: string) => void;
  onRowClick?: (row: Record<string, unknown>) => void;
}
```

`toDataTableColumns(columns, { showValidity })` is unchanged except that it appends `VALID_COLUMN` only when `showValidity`. The headers (`normalizedKey`), captions (`label · type`), sortable flags (`SORTABLE_COLUMN_TYPES`) and cell renderers are the existing ones. The entity page passes `source` and nothing new, so its behaviour is identical.

### `apps/web/src/views/CuratedViewDetail.view.tsx`

- **`CuratedViewDetailUIProps.columns`** becomes `ResolvedColumn[]`. The records table renders `<EntityRecordDataTableUI connectorEntityId={view.connectorEntityId} columns={columns} rows={records} showValidity={false} columnConfigKey={`column-config:curated-view:${view.id}`} … />` in place of the bare `DataTable`.
- **Container:**
  - `usePagination({ sortFields: [], defaultSortBy: "created", defaultSortOrder: "asc", initialValue: cleaned, onPersist, columnDefinitions: columns })`, offset mode;
  - persisted under `pagination:curated-view:${viewId}` (`useStorage<PaginationPersistedState>`);
  - `advancedFilters` cleaned on load with `stripInvalidColumns` against the response's `columns`, as on `EntityDetail.view.tsx:273-294`;
  - `columns` captured from the first successful response.
- **Unchanged:** the "Row filter: Filtered / All rows" metadata row.

## Migration
None. There is no schema change.

## Seed
None.

## TDD test plan

Run from each package: `npm run test:unit`, and `npm run test:integration -- --testPathPattern "curated-view|portal-sql"` (api).

### core — `packages/core/src/__tests__/contracts/curated-view.contract.test.ts` (new)
1. The records request accepts an optional `filters` string.
2. The records response requires `ResolvedColumn` columns (a `{key,label}`-only column is rejected).

### api — `apps/api/src/__tests__/__integration__/routes/curated-view.router.integration.test.ts`
3. `columns` are `ResolvedColumn`s in field-mapping order, each with its normalizedKey, column-definition label and type. Rows are keyed by normalizedKey, plus `_record_id`/`_source_id` (the pinning `Email`/`Age` header assertions are replaced).
4. Two field mappings sharing **one** column definition come back as two columns with distinct `normalizedKey`s.
5. A caller without read on one projected field mapping gets `columns` and rows without it.
6. `sortBy=<normalizedKey>` sorts asc and desc.
7. `sortBy` naming a json column gives 400 `CURATED_VIEW_INVALID_SORT`.
8. `sortBy=created` (not projected) falls back without an error.
9. `filters` (eq on a projected number column) narrows the rows and the `total`.
10. **Narrow-only:** the view's own filter excludes row X. An ad-hoc OR group that would match X still returns no X.
11. **Scope:** a filter on a column **outside the projection** gives 400 `CURATED_VIEW_INVALID_FILTER` ("Unknown field").
12. **Scope:** a filter on a projected column the caller **can't read** gives the same 400.
13. Malformed base64 or JSON gives 400. An operator not valid for the type gives 400.
14. An injection-shaped literal (`'; DROP TABLE x; --`) is escaped: 200, zero rows, the table intact.
15. `filters` + `search` + `sortBy` together: each still applies.

### api — `apps/api/src/__tests__/__integration__/services/portal-sql.service.integration.test.ts`
16. The `filters` render for the records read keeps the `FilterGroup → inline SQL` escaping (the `renderFilterGroupToSql` path is shared, not re-implemented). One case covers this.

### web — `apps/web/src/__tests__/EntityRecordDataTable.test.tsx`
17. `showValidity={false}` gives no `isValid` column. The default still shows it.
18. Omitting `source` gives no Cached/Live chip.
19. `columnConfigKey` is the storage key used; the default is unchanged.

### web — `apps/web/src/__tests__/CuratedViewDetailView.test.tsx`
20. Headers are `normalizedKey`s with a `label · type` caption. Two columns sharing a column definition have distinct headers.
21. A json column isn't sortable.
22. The column picker lists exactly the response's columns (no `isValid`, nothing outside the projection).
23. The filter builder is offered (column definitions passed) over the same columns.
24. "Row filter: Filtered / All rows" is unchanged.

**Totals ≈ 24 cases.**

## Acceptance criteria

- [ ] **Headers:** the view table's headers are the field mappings' keys with a `label · type` caption, matching the entity table. Columns sharing a column definition are distinguishable.
- [ ] **Cells:** cells render by type like the entity table (formatted values; code cells for json and arrays).
- [ ] **Sort:** sortable types sort asc/desc. Json and array columns can't be sorted, and the API refuses them with a 400.
- [ ] **Advanced filters:** they narrow the view's rows and its total. They never return a row the view's own filter excludes.
- [ ] **Filter scope:** a filter may only reference the caller's readable projected columns. Anything else is a 400 before any query.
- [ ] **Column picker:** it reorders and shows/hides exactly the caller's readable projected columns, remembered per view. Filters are remembered per view too, and stale ones are dropped on load.
- [ ] **No regressions:** the entity detail table is unchanged (validity column, source chip, its own storage keys).
- [ ] **Metadata:** "Row filter" still reads "Filtered" / "All rows".

## Risks & rollback

- **Filter scope is the security core.** `buildFilterSqlForEntity` resolves any entity column, so the restriction rests entirely on validating against `readable`. Cases 11–12 pin it; adversarial probes extend it. Fail-closed: anything that isn't valid is a 400.
- **Contract change.** Rows and `columns` change shape. The web view is the only consumer, and it changes in the same PR. Rollback means reverting the PR.
- **Saved browser state.** It lives under new keys (`*:curated-view:*`), so there's no collision with entity keys.

## Files touched

- Edit:
  - `packages/core/src/contracts/curated-view.contract.ts`;
  - `apps/api/src/constants/api-codes.constants.ts`;
  - `apps/api/src/services/portal-sql.service.ts`;
  - `apps/api/src/routes/curated-view.router.ts`;
  - `apps/api/src/config/swagger.config.ts` (register `ResolvedColumn`);
  - `apps/web/src/components/EntityRecordDataTable.component.tsx`;
  - `apps/web/src/views/CuratedViewDetail.view.tsx`;
  - `apps/web/src/stories/` (the view and table stories, if present).
- Tests:
  - New: `packages/core/src/__tests__/contracts/curated-view.contract.test.ts`;
  - `apps/api/src/__tests__/__integration__/routes/curated-view.router.integration.test.ts`;
  - `apps/api/src/__tests__/__integration__/services/portal-sql.service.integration.test.ts`;
  - `apps/web/src/__tests__/EntityRecordDataTable.test.tsx`;
  - `apps/web/src/__tests__/CuratedViewDetailView.test.tsx`.
- Docs: the Help copy that describes the view page, if any (checked in the plan).

## Next step

`docs/CURATED_VIEW_TABLE_PARITY.plan.md` slices this into about four TDD commits on this branch:
1. core contract + API columns/rows/sort (cases 1–8);
2. the scoped ad-hoc filter (9–16);
3. the table component options (17–19);
4. the view page wiring and persistence (20–24), plus the docs check.
