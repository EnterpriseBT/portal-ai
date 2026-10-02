# Curated view table parity with the entity records table — Discovery

**Issue:** [EnterpriseBT/portal-ai#678](https://github.com/EnterpriseBT/portal-ai/issues/678) (Bug, re-sized `full` on 2026-10-02)

**Why this exists.** The curated view detail page shows a view's records in a bare table. Headers are the **column definition's** label, and column definitions are shared and often generic (`integer`, `enum`, `geometry`), so headers are meaningless and two fields mapped to one definition look identical. The page also lacks everything the entity detail page's records table has:
- field-mapping headers with a `label · type` caption;
- type-aware cells;
- the advanced filter builder;
- the column order and visibility picker.

A user who can read a view but not its entity gets a much weaker table over the same records.

The fix spans `core` (the records contract), `api` (column metadata, normalizedKey-keyed rows, a view-scoped ad-hoc filter) and `web` (reuse the entity table). The new filter is a data-access path on view-scoped data, so it has to narrow only, over only the columns the caller can read. This is the change that gives a curated view the **same table** as its entity, without widening what the view exposes.

## The current shape

### Reference: the entity records table

| Piece | Location | Note |
|---|---|---|
| Table UI | `apps/web/src/components/EntityRecordDataTable.component.tsx:94-138` (`toDataTableColumns`) | header = `normalizedKey`, caption `label · type`; sortable only for `SORTABLE_COLUMN_TYPES`; cells via `EntityRecordCellCode` (json/array) or `Formatter.format(value, type, {canonicalFormat})` + `TruncatedCell`; appends `VALID_COLUMN` (`isValid`) |
| Props | same file `:142-151` | `connectorEntityId`, `rows`, `columns: ResolvedColumn[]`, `source` (Cached/Live chip), sort props, `onRowClick` |
| Column picker | same file `:174-185`; `packages/core/src/ui/DataTable.tsx:88-140, 358-367` | `useColumnConfig`, persisted `column-config:entity-records:${id}`; 5 columns default on small screens, 8 otherwise |
| Filter + paging state | `apps/web/src/views/EntityDetail.view.tsx:260-307` | `pagination:entity-records:${id}` (incl. `advancedFilters`); `stripInvalidColumns` on load; `usePagination` keyset mode with `columnDefinitions` → enables the builder |
| Builder | `apps/web/src/components/PaginationToolbar.component.tsx:730-731, 1017-1054` | `serializeFilterExpression` → `params.filters` (base64 JSON) |
| API | `apps/api/src/routes/entity-record.router.ts:206-267` | `filters` → `parseFilterPayload` → `buildFilterSqlForEntity` (`apps/api/src/utils/filter-sql.util.ts:63,107`) |
| Column metadata | `packages/core/src/contracts/entity-record.contract.ts:15-36` (`ResolvedColumnSchema`) | key, label, type, normalizedKey, required, enumValues, format, canonicalFormat… |

### The curated view table today

| Piece | Location | Note |
|---|---|---|
| View | `apps/web/src/views/CuratedViewDetail.view.tsx:76-110, 200-206` | bare `DataTable`; every column sortable; cells `String(value)`; no caption, no picker, no builder; `usePagination` offset mode, nothing persisted |
| Contract | `packages/core/src/contracts/curated-view.contract.ts:~173-195` | request = `PaginationRequestQuerySchema` (limit/offset/sortBy/sortOrder/search); columns = `{ key, label }` |
| Route | `apps/api/src/routes/curated-view.router.ts:874-882` | passes exactly those params |
| Service | `apps/api/src/services/portal-sql.service.ts:558-668` (`queryCuratedViewRecords`) | `columnsOut = { key: columnName (c_*), label: cd.label }` (`:591-599`); rows keyed by `columnName` + `_record_id`, `source_id`; sort and search are limited to projected columns (`:636-653`) |
| Scoping | same file `:357-435`, `:448-469`, `:624-630` | `resolveViewColumnsById`: org, read on the view, class-level `deny read entity_record`; projection = view field mappings minus hidden, ∩ the caller's per-field-mapping read grants; the view's own filter is rendered inline and ANDed with the org and deleted guards |
| Precedent | same file `:473-484` (`queryViewRowsByColumn`) | refuses to filter on a column the caller can't read: "would be an oracle for its values" |
| Callers | `apps/web/src/views/CuratedViewDetail.view.tsx:200` | the only consumer of the records endpoint |

### Filter validation

`parseFilterPayload(encoded, columnDefs)` (`filter-sql.util.ts:63`) validates against **the given** `columnDefs`: `validateOperatorTypeCompat` (`packages/core/src/contracts/filter.contract.ts:195-223`) rejects any field not in them ("Unknown field"). `buildFilterSqlForEntity` itself resolves **any** column in the entity's statement cache. So the projection restriction holds only if the `columnDefs` passed in are the projected, readable columns. `renderFilterGroupToSql` (`:133`) gives the inline-escaped form the view path needs, since it builds with `sql.raw`.

## The design space

### Decision 1 — Column metadata and row keys on the records response

- **A. Return projected `ResolvedColumn`s, with rows keyed by `normalizedKey`.** The server already has both the resolved columns (`:593`) and the projection's `columnName ↔ normalizedKey`. Rows alias `w."c_x" AS "<normalizedKey>"`, and `sortBy` takes a `normalizedKey`. The response is the same shape the entity table already consumes.
- **B. Keep `c_*` keys and add type, caption and format fields to `{key,label}`.** Smaller contract delta, but the web layer then needs an adapter to feed `EntityRecordDataTableUI`, which keys on `normalizedKey`.
- **C. Client remap.** It needs both name maps on the client, which is B plus logic in the view.

| | A | B | C |
|---|---|---|---|
| Reuses the entity table as-is | yes | via adapter | via adapter |
| Contract delta | columns + row keys + sortBy semantics | columns only | columns only |
| Matches the entity list's filter field names | yes (`normalizedKey`) | no (filter fields ≠ row keys) | no |

**Lean: A.** Filter fields, sort keys, row keys and headers all become `normalizedKey`, exactly like the entity list, so one table and one builder work unchanged. The endpoint has a single caller, so the contract change is contained.

### Decision 2 — The ad-hoc filter

- **A. The entity list's `filters` param** (base64 `FilterExpression`):
  - validated by `parseFilterPayload` against **only** the projected, readable columns;
  - rendered by `renderFilterGroupToSql`;
  - ANDed as an extra WHERE part **after** the view's own filter.
- **B. Merge the ad-hoc filter into the view's filter client-side** and send one expression. The client could then drop the view's own filter, so it's rejected outright.
- **C. A new, smaller filter dialect for views.** It diverges from the entity builder, which is the opposite of parity.

**Lean: A.** It's the same builder and wire format. Narrow-only holds by construction (an extra AND), and an "Unknown field" refusal covers any column outside the caller's projection, which is the same oracle rule as `queryViewRowsByColumn`. The count shares the WHERE, so totals stay consistent. Invalid filters are a 400 (`CURATED_VIEW_INVALID_FILTER`), never a 500.

### Decision 3 — The web table

- **A. Reuse `EntityRecordDataTableUI`** with options:
  - hide `VALID_COLUMN` (view rows don't carry `is_valid`);
  - hide the Cached/Live chip;
  - a column-config storage key;
  - wire it in `CuratedViewDetail` with `usePagination` + `columnDefinitions` (the builder) and per-view persisted state.
- **B. A view-specific copy of the table.** It drifts from the reference the issue names.

**Lean: A.** One table definition means parity holds by construction. Storage keys: `column-config:curated-view:${viewId}` and `pagination:curated-view:${viewId}` (incl. `advancedFilters`, cleaned with `stripInvalidColumns` against the view's columns on load).

### Decision 4 — Pagination mode

- **A. Keep offset** (today's view behaviour).
- **B. Keyset like the entity table.** That's #649 ("index/keyset the detail table's sort + search at scale"), an open epic ticket with its own index work.

**Lean: A.** #649 owns keyset paging for views, and this ticket stays about the table's configuration.

## Tradeoff comparison

|  | D1: ResolvedColumn + normalizedKey rows | D2: `filters` param, projection-validated | D3: reuse entity table | D4: keep offset |
|---|---|---|---|---|
| Spread to spec | Yes (contract + service) | Yes (contract + service + error code) | Yes (component options + view) | No (deferred to #649) |

## Recommendation

1. **Response contract:** `CuratedViewRecordsResponsePayloadSchema.columns` becomes the projected columns as `ResolvedColumn` (`ResolvedColumnSchema`), and rows are keyed by `normalizedKey` (plus `_record_id`, `source_id`).
2. **Sort and search:** `sortBy` takes a projected `normalizedKey`; search is still over projected columns only.
3. **Request contract:** `CuratedViewRecordsRequestQuerySchema` gains `filters?: string` (base64 `FilterExpression`, the entity list's format).
4. **Filter path:** `queryCuratedViewRecords` validates `filters` with `parseFilterPayload` against the caller's projected, readable `ResolvedColumn`s only, renders it with `renderFilterGroupToSql`, and ANDs it after the view's own filter. An invalid or unknown field gives 400 `CURATED_VIEW_INVALID_FILTER`.
5. **Table component:** `EntityRecordDataTableUI` gains options to hide the validity column and the source chip, and to take a column-config storage key.
6. **View page:** `CuratedViewDetail` renders it, with `usePagination` (offset) + `columnDefinitions` for the builder, and persisted `column-config:curated-view:${viewId}` / `pagination:curated-view:${viewId}`.
   - **Column picker:** the list of columns that can be reordered or shown/hidden is exactly the caller's readable field mappings in the view's projection. Columns outside the projection, or that the caller can't read, never appear, not even hidden. The validity column and the source chip are absent.
   - **Builder fields:** the same readable projected columns, so the builder can't offer a field the server would refuse.
8. **Sort refusals:** sorting is refused for non-sortable types (json, arrays, reference arrays; the complement of `SORTABLE_COLUMN_TYPES`). The UI doesn't offer it, and the server rejects a `sortBy` naming such a column with a 400 rather than silently sorting or ignoring it. (Decided 2026-10-02.)
7. **Unchanged:** the projection, the view's own filter and the per-column read grants are untouched.

## Open questions

1. ~~Should the view's own filter appear in the builder, or as read-only conditions in the details?~~ **Decided: no** (2026-10-02). The builder holds only the reader's extra narrowing, and the details keep today's "Row filter: Filtered / All rows". A reader doesn't need to see the filter that shaped their view.
   - **Found while deciding (pre-existing, out of scope here):** `GET /api/curated-views/:id` and the list endpoint return the full view row to any reader, including the raw `filter` (field names and literal values, possibly on columns the reader can't read) and the full `fieldMappingIds`. The UI never renders them, but they are in the payload. This predates #678 and should be its own bug: e.g. send non-editors only whether the view is filtered.
2. ~~Should ad-hoc filters persist per view across visits?~~ **Decided: yes** (same `pagination:*` persistence, cleaned against the current projection on load).
3. ~~Should agent tools get the ad-hoc filter?~~ **Decided: no** (they have SQL; this is a UI table feature).
4. ~~Drop a saved filter that references a no-longer-readable column?~~ **Decided: yes** (`stripInvalidColumns` on load; the server would 400 it anyway). The same applies to saved column config: unknown keys drop out.
5. ~~Refuse sorting on json and arrays server-side?~~ **Decided: yes, refused** (a 400, not a fallback). See recommendation 8.

## Enterprise-scale considerations

- **Concurrency & correctness:** N/A because it's read-only, with no writes.
- **Accuracy & auditability:** N/A because reads aren't audited today, and this adds no record of truth.
- **Failure modes:** Lean fail-closed on the filter. Malformed, unknown-field or wrong-operator input gives a 400 before any query, and never runs an unvalidated fragment. A missing `filters` behaves exactly as today.
- **Scale & unbounded growth:** Lean keep today's bounds. The filter is existing limits-checked input (`validateFilterLimits`), and an extra WHERE over the wide table is the same cost class as the entity list. Deep offset paging is the known gap that #649 owns.
- **Multi-tenancy:** Lean preserve every guard. The org predicate, the per-caller projection, the view filter and `deny read entity_record` all stay. The filter can only reference projected, readable columns (no value oracle on hidden columns), and it can only add an AND.
- **Contract stability:** Lean the same filter wire format and the same `ResolvedColumn` shape as the entity list, so future table features apply to both.
- **Data lifecycle:** Lean browser-local, per-view keys. A deleted view leaves inert localStorage keys, the same as entities today.

## What this doesn't decide

- Keyset paging and indexes for view records: #649.
- Agent-tool access to the ad-hoc filter (see open question 3).
- Editing the view's own filter from this table: the view editor dialog owns it.

## Next step

`docs/CURATED_VIEW_TABLE_PARITY.spec.md` pins the contract deltas, the service's filter and scoping path, the error codes and the component options. `docs/CURATED_VIEW_TABLE_PARITY.plan.md` slices it roughly as:
1. core contract;
2. API columns, normalizedKey rows and sort;
3. the view-scoped filter, with security tests;
4. table component options;
5. the view page wiring and persistence;
6. docs and help text.
