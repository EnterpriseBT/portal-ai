# Advanced Filters for Entity Record JSONB Data

## Overview

Add a composable, type-aware advanced filter system for querying JSONB `normalizedData` on entity records. Users build filter expressions with AND/OR groups, per-column operators derived from ColumnDefinition types, and server-side SQL generation against the existing GIN-indexed `normalized_data` column. Filter state is persisted client-side and serialized as a query parameter for cache-friendly URLs.

---

## Architecture

### Filter Expression Model

```
FilterExpression
  ├── FilterGroup          (AND | OR combinator over child conditions/groups)
  │     ├── combinator     "and" | "or"
  │     └── conditions[]   Array<FilterCondition | FilterGroup>  (recursive)
  └── FilterCondition      (leaf: single column + operator + value)
        ├── field          string          (ColumnDefinition.key)
        ├── operator       FilterOperator  (type-dependent)
        └── value          string | number | boolean | string[] | null
```

### Operator Matrix (by ColumnDataType)

| ColumnDataType | Operators |
|---------------|-----------|
| `string` | `eq`, `neq`, `contains`, `not_contains`, `starts_with`, `ends_with`, `is_empty`, `is_not_empty` |
| `number`, `currency` | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `is_empty`, `is_not_empty` |
| `boolean` | `eq`, `neq` |
| `date`, `datetime` | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `between`, `is_empty`, `is_not_empty` |
| `enum` | `eq`, `neq`, `in`, `not_in`, `is_empty`, `is_not_empty` |
| `array` | `contains`, `not_contains`, `is_empty`, `is_not_empty` |
| `json` | `is_empty`, `is_not_empty` |
| `reference` | `eq`, `neq`, `is_empty`, `is_not_empty` |

### Data Flow

```
Frontend FilterBuilder UI
  → serialize to FilterExpression JSON
  → encode as `filters` query param (base64 JSON string)
  → API parses + validates with Zod schema
  → buildFilterSQL() generates parameterized SQL conditions on normalized_data JSONB
  → conditions appended to existing WHERE clause
  → results returned with same pagination contract
```

### Caching Strategy

- **URL-based caching**: Filter state encoded in query params enables TanStack Query deduplication and browser cache.
- **localStorage persistence**: Full FilterExpression saved per entity (keyed by `entityId`) alongside existing PaginationPersistedState.
- **Server-side**: No additional caching layer needed — PostgreSQL GIN index on `normalized_data` handles JSONB containment/existence queries efficiently. The existing `source: "cache" | "live"` response field already signals freshness.

---

## Implementation Checklist

### Phase 1: Shared Contracts & Validation (`packages/core`)

- [x] **1.1** Define `FilterOperator` union type with all operators listed in the operator matrix
- [x] **1.2** Define `FilterConditionSchema` (Zod) — `{ field: string, operator: FilterOperator, value: z.union([...]) }`
- [x] **1.3** Define `FilterGroupSchema` (Zod, recursive) — `{ combinator: "and" | "or", conditions: (FilterCondition | FilterGroup)[] }`
- [x] **1.4** Define `FilterExpressionSchema` as the top-level `FilterGroup`
- [x] **1.5** Add `OPERATORS_BY_COLUMN_TYPE` map: `Record<ColumnDataType, FilterOperator[]>` — used by both frontend (to populate operator dropdowns) and backend (to reject invalid operator/type combos)
- [x] **1.6** Export all filter types from `@portalai/core/contracts` barrel
- [x] **1.7** Extend `EntityRecordListRequestQuerySchema` with optional `filters` field (base64-encoded JSON string, validated by parsing and running through `FilterExpressionSchema`)
- [x] **1.8** Add `MAX_FILTER_DEPTH` (default: 4) and `MAX_CONDITIONS` (default: 20) constants to prevent abuse
- [x] **1.9** Write unit tests for schema validation — valid expressions, invalid operator/type combos, depth/count limits

### Phase 2: Backend SQL Generation (`apps/api`)

- [x] **2.1** Create `src/utils/filter-sql.util.ts` with `buildFilterSQL(expression: FilterExpression, columnDefs: ColumnDefinitionSummary[]): SQL` function
- [x] **2.2** Implement `buildConditionSQL()` — maps each operator to parameterized SQL against `normalized_data->>'field'` with type-aware casting (reuse patterns from existing `buildJsonbSortExpression`)
  - String ops: `ILIKE`, `NOT ILIKE`, text equality
  - Numeric ops: cast to `::numeric` with regex guard (same pattern as sort)
  - Date ops: text comparison (ISO format is lexicographically sortable)
  - Boolean ops: text equality (`'true'`/`'false'`)
  - Empty/not-empty: `IS NULL OR = ''` / `IS NOT NULL AND <> ''`
  - `between`: two-value AND range
  - `in`/`not_in`: `= ANY(...)` / `<> ALL(...)`
- [x] **2.3** Implement `buildGroupSQL()` — recursively combines child conditions with `AND`/`OR`, enforces depth limit
- [x] **2.4** Validate operator-type compatibility using `OPERATORS_BY_COLUMN_TYPE` — return 400 for mismatches
- [x] **2.5** Validate that all referenced `field` keys exist in the entity's column definitions — return 400 for unknown fields
- [x] **2.6** Integrate into `entity-record.router.ts` GET `/` handler — parse `filters` query param, call `buildFilterSQL()`, append to existing `conditions[]` array
- [x] **2.7** Add `ENTITY_RECORD_INVALID_FILTER` to `ApiCode` enum
- [x] **2.8** Write unit tests for SQL generation — each operator type, nested groups, edge cases (empty values, special characters, SQL injection prevention)
- [x] **2.9** Write integration test — apply filters via API, verify correct records returned

### Phase 3: Frontend Filter Builder UI (`apps/web`)

- [ ] **3.1** Create `src/components/AdvancedFilterBuilder.component.tsx` — recursive filter group/condition builder
  - Top-level group with AND/OR toggle
  - "Add condition" and "Add group" buttons
  - Each condition row: column select → operator select (filtered by column type) → value input (type-aware)
  - Remove button per condition/group
  - Max depth / max conditions enforcement with disabled add buttons
- [ ] **3.2** Create type-aware value inputs:
  - `string`: text field
  - `number`/`currency`: number input (two inputs for `between`)
  - `boolean`: true/false toggle
  - `date`/`datetime`: date picker (two pickers for `between`)
  - `enum`: select/multi-select from `enumValues` on the column definition
- [ ] **3.3** Create `src/components/AdvancedFilterBuilder.util.ts`:
  - `serializeFilterExpression(expr: FilterExpression): string` — base64 encode
  - `deserializeFilterExpression(str: string): FilterExpression | null` — decode + validate
  - `isFilterExpressionEmpty(expr: FilterExpression): boolean`
  - `countActiveConditions(expr: FilterExpression): number`
- [ ] **3.4** Extend `PaginationPersistedState` with optional `advancedFilters?: FilterExpression`
- [ ] **3.5** Extend `usePagination` hook:
  - Add `advancedFilters` state, `setAdvancedFilters()` setter
  - Serialize into `queryParams.filters` when non-empty
  - Persist/restore from localStorage
  - Reset offset on filter change
- [ ] **3.6** Integrate `AdvancedFilterBuilder` into `PaginationToolbar` — add "Advanced Filters" button that opens a popover/drawer with the filter builder
- [ ] **3.7** Show active advanced filter count badge on the button
- [ ] **3.8** Show summary chips for active conditions below toolbar (consistent with existing filter chip pattern)
- [ ] **3.9** Add "Clear all filters" action

### Phase 4: Entity Detail View Integration (`apps/web`)

- [ ] **4.1** Pass `ColumnDefinitionSummary[]` (already returned by the API) to the filter builder so it can populate column dropdowns and determine available operators
- [ ] **4.2** Extend `EntityDetail.view.tsx` to wire `advancedFilters` from `usePagination` into the record list query
- [ ] **4.3** Persist advanced filter state to localStorage alongside existing pagination state (keyed by `entityId`)
- [ ] **4.4** Handle column definition changes gracefully — if a saved filter references a column that no longer exists, strip it on load and show a toast notification

### Phase 5: Testing & Polish

- [ ] **5.1** Unit tests for `AdvancedFilterBuilder` — renders conditions, adds/removes, operator filtering by type
- [ ] **5.2** Unit tests for serialization/deserialization round-trip
- [ ] **5.3** Storybook stories for `AdvancedFilterBuilder` — empty state, populated state, max depth reached
- [ ] **5.4** End-to-end validation: create filters in UI → verify correct API call → verify correct SQL → verify correct results
- [ ] **5.5** Performance test: verify GIN index is used for JSONB containment queries via `EXPLAIN ANALYZE`

---

## Acceptance Criteria

### Functional

1. **Filter builder UI** renders in the entity detail view with a button to open/close it
2. **Column selection** dropdown shows all columns from the entity's ColumnDefinitions
3. **Operator selection** is constrained to valid operators for the selected column's data type
4. **Value inputs** are type-appropriate (text field, number input, date picker, enum select, boolean toggle)
5. **AND/OR groups** can be created, nested up to `MAX_FILTER_DEPTH` levels, and toggled between combinators
6. **Adding/removing** conditions and groups works correctly; empty groups are auto-removed
7. **Filter submission** encodes the expression as a query parameter and triggers a new API request
8. **API validates** the filter expression — rejects invalid operator/type combos, unknown fields, depth/count exceeding limits with 400 status and `ENTITY_RECORD_INVALID_FILTER` code
9. **SQL generation** produces parameterized queries (no SQL injection) against `normalized_data` JSONB
10. **Correct results** are returned — records match all specified filter conditions with proper AND/OR logic
11. **Pagination** resets to page 1 when filters change; total count reflects filtered results
12. **Filter persistence** — active filters survive page refresh (localStorage) and can be shared via URL (query param)
13. **Filter chips** display a summary of active conditions below the toolbar; each chip can be individually removed
14. **Clear all** removes all advanced filter conditions in one action
15. **Graceful degradation** — if a saved filter references a removed column, it is stripped on load with a notification

### Non-Functional

16. **Performance**: Queries with filters must use the GIN index — verified by `EXPLAIN ANALYZE` showing index scan, not sequential scan
17. **Security**: All filter values are parameterized in SQL (no string interpolation of user input)
18. **Limits**: Maximum 4 nesting levels and 20 conditions per filter expression (configurable constants)
19. **Contract safety**: Filter schemas are shared between frontend and backend via `@portalai/core` — no type drift
20. **Backwards compatibility**: Existing list endpoint behavior is unchanged when `filters` param is absent
21. **Bundle size**: Filter builder UI is lazily loaded (React.lazy) so it doesn't impact initial page load for users who don't use filters

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Base64-encoded JSON query param (not individual params) | Recursive group structures can't be flattened to key-value params; single param keeps URL manageable |
| Operator validation against ColumnDataType on both client and server | Prevents nonsensical queries (e.g., `gt` on a boolean) and provides immediate UI feedback |
| Reuse existing `buildJsonbSortExpression` casting patterns | Consistent type-safe JSONB access; proven regex guards for numeric casting |
| GIN index on `normalized_data` (already exists) | Supports `@>` containment, `?` existence, and text extraction operators efficiently |
| Recursive Zod schema with depth limit | Enables arbitrarily nested AND/OR logic while preventing DoS via deeply nested expressions |
| Filter state in `usePagination` (not separate hook) | Filters are tightly coupled with pagination (offset reset, query params) — single source of truth |
| No server-side filter caching layer | PostgreSQL's query cache + GIN index + TanStack Query client-side dedup is sufficient |

---

## Files to Create / Modify

### New Files
| File | Purpose |
|------|---------|
| `packages/core/src/contracts/filter.contract.ts` | FilterOperator, FilterCondition, FilterGroup, FilterExpression schemas + OPERATORS_BY_COLUMN_TYPE |
| `apps/api/src/utils/filter-sql.util.ts` | buildFilterSQL, buildConditionSQL, buildGroupSQL |
| `apps/web/src/components/AdvancedFilterBuilder.component.tsx` | Recursive filter builder UI |
| `apps/web/src/components/AdvancedFilterBuilder.util.ts` | Serialize/deserialize/utility functions |

### Modified Files
| File | Change |
|------|--------|
| `packages/core/src/contracts/entity-record.contract.ts` | Add `filters` to `EntityRecordListRequestQuerySchema` |
| `packages/core/src/contracts/index.ts` | Export filter contracts |
| `apps/api/src/routes/entity-record.router.ts` | Parse `filters` param, call `buildFilterSQL()`, append to WHERE |
| `apps/api/src/constants/api-codes.constants.ts` | Add `ENTITY_RECORD_INVALID_FILTER` |
| `apps/web/src/components/PaginationToolbar.component.tsx` | Add advanced filter button, badge, and integration |
| `apps/web/src/views/EntityDetail.view.tsx` | Wire advanced filters to query |
