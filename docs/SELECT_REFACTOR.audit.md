# Async Select Search Convention — Audit & Refactor Plan

## Context

Search hooks (`useColumnDefinitionSearch`, `useEntityTagSearch`, etc.) currently bypass the SDK — they import `useAuthFetch` directly and construct URLs ad-hoc. The `useColumnDefinitionKeySearch` hook is fully hand-rolled. There's no standard `getById` support for pre-selected option resolution. Goal: SDK becomes sole API gatekeeper, with a consistent search + getById pattern for all async select components.

## Current State

### SDK Structure (`apps/web/src/api/sdk.ts`)

The SDK is a plain object aggregating per-entity modules. Each module has declarative hooks for CRUD:

```typescript
export const columnDefinitions = {
  list: (params?, options?) => useAuthQuery<ListPayload>(...),
  get: (id, options?) => useAuthQuery<GetPayload>(...),
  create: () => useAuthMutation<CreatePayload, CreateBody>(...),
  update: (id) => useAuthMutation<UpdatePayload, UpdateBody>(...),
  delete: (id) => useAuthMutation<void, void>(...),
};
```

### Search Hooks (bypass SDK)

9 search hooks across 5 API files. Most use `useAsyncFilterOptions` from core, but still bypass the SDK by importing `useAuthFetch` directly:

| Hook | File | Pattern | mapItem | Has getById? |
|------|------|---------|---------|--------------|
| `useColumnDefinitionSearch` | column-definitions.api | useAsyncFilterOptions | `{id, label}` | No |
| `useColumnDefinitionKeySearch` | column-definitions.api | **AD-HOC** | `{id, richLabel, columnDefinition}` | **Yes** |
| `useConnectorEntitySearch` | connector-entities.api | useAsyncFilterOptions | `{id, label}` (custom mapItem opt) | No |
| `useEntityTagSearch` | entity-tags.api | useAsyncFilterOptions | `{id, name}` | No |
| `useEntityTagFilter` | entity-tags.api | useInfiniteFilterOptions | `{id, name}` | No |
| `useFieldMappingWithEntitySearch` | field-mappings.api | useAsyncFilterOptions | `{id, sourceField+entity}` | No |
| `useFieldMappingWithColumnDefinitionSearch` | field-mappings.api | useAsyncFilterOptions | `{id, colDef label}` | No |
| `useConnectorInstanceSearch` | connector-instances.api | useAsyncFilterOptions | `{id, name}` | No |
| `useConnectorInstanceFilter` | connector-instances.api | useInfiniteFilterOptions | `{id, name}` | No |

### `useAsyncFilterOptions` (packages/core)

```typescript
interface AsyncFilterOptionsConfig<TResponse, TItem> {
  url: string;
  fetcher: (url: string) => Promise<TResponse>;
  getItems: (response: TResponse) => TItem[];
  mapItem: (item: TItem) => { value: string; label: string };
  defaultParams?: Record<string, string>;
}

interface AsyncFilterOptionsResult {
  onSearch: (query: string) => Promise<SelectOption[]>;
  labelMap: Record<string, string>;
}
```

**Missing:** No `getById` / `loadSelectedOption` support. No generic `TOption` for rich options with extra data.

### Async Select Components (packages/core)

| Component | Value Type | onSearch | loadSelectedOption |
|-----------|-----------|---------|-------------------|
| `AsyncSearchableSelect` | `string \| null` | Required | Optional |
| `MultiAsyncSearchableSelect` | `string[]` | Required | Not supported |
| `InfiniteScrollSelect` | `string \| null` | paginated | — |
| `MultiInfiniteScrollSelect` | `string[]` | paginated | — |

### Consumer Wiring Pattern

```typescript
// Container (hook level):
const { onSearch } = useEntityTagSearch();
// or for CSV workflow (ad-hoc):
const { onSearch, getById } = useColumnDefinitionKeySearch();

// Passed to presentational component:
<AsyncSearchableSelect
  value={selectedId}
  onChange={handleChange}
  onSearch={onSearch}
  loadSelectedOption={getById}
/>
```

---

## Design

### 1. Extend `useAsyncFilterOptions` (packages/core)

Add optional `loadSelectedOption` passthrough and a `TOption` generic for rich options:

```typescript
interface AsyncFilterOptionsConfig<TResponse, TItem, TOption extends SelectOption = SelectOption> {
  // existing fields unchanged...
  url: string;
  fetcher: (url: string) => Promise<TResponse>;
  getItems: (response: TResponse) => TItem[];
  mapItem: (item: TItem) => TOption;          // now generic
  defaultParams?: Record<string, string>;
  // NEW
  loadSelectedOption?: (id: string) => Promise<TOption | null>;
}

interface AsyncFilterOptionsResult<TOption extends SelectOption = SelectOption> {
  onSearch: (query: string) => Promise<TOption[]>;
  loadSelectedOption: ((id: string) => Promise<TOption | null>) | undefined;  // NEW
  labelMap: Record<string, string>;
}
```

The hook wraps `config.loadSelectedOption` to also update `labelMap`, then exposes it on the result. Core has zero knowledge of get-endpoint URLs or response shapes — the SDK layer constructs the `loadSelectedOption` function.

**File:** `packages/core/src/ui/searchable-select/useAsyncFilterOptions.ts`

### 2. Add `SearchHookOptions` type

```typescript
export interface SearchHookOptions<TItem, TOption extends SelectOption = SelectOption> {
  mapItem?: (item: TItem) => TOption;
  defaultParams?: Record<string, string>;
}
```

**File:** `apps/web/src/api/types.ts`

### 3. Add `search()` to each SDK module

Each module gets a `search` hook that encapsulates URL, response extractors, and default mapItem — then delegates to `useAsyncFilterOptions`. The hook returns `{ onSearch, getById, labelMap }`, where `getById` is the SDK-facing name for the function that resolves a single option by ID (passed to `AsyncSearchableSelect` as `loadSelectedOption`).

**Pattern (column-definitions example):**

```typescript
export const columnDefinitions = {
  list: ..., get: ..., create: ..., update: ..., delete: ...,

  search: <TOption extends SelectOption = SelectOption>(
    options?: SearchHookOptions<ColumnDefinition, TOption>
  ) => {
    const { fetchWithAuth } = useAuthFetch();
    const mapFn = (options?.mapItem ?? defaultMapItem) as (cd: ColumnDefinition) => TOption;

    const config = useMemo(() => ({
      url: "/api/column-definitions",
      fetcher: fetchWithAuth,
      getItems: (res) => res.payload.columnDefinitions,
      mapItem: mapFn,
      defaultParams: options?.defaultParams,
      loadSelectedOption: async (id: string): Promise<TOption | null> => {
        const res = await fetchWithAuth(`/api/column-definitions/${encodeURIComponent(id)}`);
        return mapFn(res.payload.columnDefinition);
      },
    }), [fetchWithAuth, mapFn, options?.defaultParams]);

    // Rename loadSelectedOption → getById for the SDK-facing return value
    const { loadSelectedOption, ...rest } = useAsyncFilterOptions(config);
    return { ...rest, getById: loadSelectedOption };
  },
};

// Consumer usage:
const { onSearch, getById } = sdk.columnDefinitions.search();
<AsyncSearchableSelect onSearch={onSearch} loadSelectedOption={getById} />
```

**Modules to add `search()` to:**

| Module | File | Default mapItem | getById URL |
|--------|------|----------------|-------------|
| `columnDefinitions` | `column-definitions.api.ts` | `{id, label}` | `/api/column-definitions/{id}` |
| `connectorEntities` | `connector-entities.api.ts` | `{id, label}` | `/api/connector-entities/{id}` |
| `entityTags` | `entity-tags.api.ts` | `{id, name}` | `/api/entity-tags/{id}` |
| `connectorInstances` | `connector-instances.api.ts` | `{id, name}` | `/api/connector-instances/{id}` |
| `fieldMappings` | `field-mappings.api.ts` | see below | `/api/field-mappings/{id}` |

**Field mappings special case:** Two search variants exist with different `include` params and response types. Add named variants:
- `fieldMappings.searchWithEntity(options?)` — `defaultParams: { include: "connectorEntity" }`, typed as `FieldMappingWithConnectorEntity`
- `fieldMappings.searchWithColumnDefinition(options?)` — `defaultParams: { include: "columnDefinition" }`, typed as `FieldMappingWithColumnDefinition`

### 4. Migrate consumers

Replace standalone hook calls with SDK equivalents:

| Old | New |
|-----|-----|
| `useColumnDefinitionSearch()` | `sdk.columnDefinitions.search()` |
| `useColumnDefinitionKeySearch()` | `sdk.columnDefinitions.search({ mapItem: richMapper })` |
| `useConnectorEntitySearch(opts)` | `sdk.connectorEntities.search(opts)` |
| `useEntityTagSearch()` | `sdk.entityTags.search()` |
| `useFieldMappingWithEntitySearch(opts)` | `sdk.fieldMappings.searchWithEntity(opts)` |
| `useFieldMappingWithColumnDefinitionSearch(opts)` | `sdk.fieldMappings.searchWithColumnDefinition(opts)` |
| `useConnectorInstanceSearch(opts)` | `sdk.connectorInstances.search(opts)` |

Then remove the old standalone hooks and their `_SEARCH_BASE` / `_FILTER_BASE` constants.

### 5. Update `ColumnMappingStep` to use standardized `getById`

Replace the current `onLoadColumnDefinitionById` prop threading with the standard `getById` from `sdk.columnDefinitions.search()`. The consumer calls `search({ mapItem })` which returns `{ onSearch, getById }` — `getById` gets passed to `AsyncSearchableSelect` as `loadSelectedOption`. The `columnDefinition` caching in `ColumnMappingStep` uses the rich option's attached data.

### 6. Clean up prop threading

Since `onColumnKeySearch` and `onLoadColumnDefinitionById` were separate props threaded through `CSVConnectorWorkflowUI -> ColumnMappingStep`, consolidate to a single `onSearch` + `getById` pair (both from the same `search()` call). Remove `onLoadColumnDefinitionById` prop. Pass `getById` to `AsyncSearchableSelect` as `loadSelectedOption`.

---

## Files to modify

1. `packages/core/src/ui/searchable-select/useAsyncFilterOptions.ts` — extend with `loadSelectedOption` config/result + `TOption` generic
2. `packages/core/src/ui/searchable-select/index.ts` — re-export updated types
3. `apps/web/src/api/types.ts` — add `SearchHookOptions`
4. `apps/web/src/api/column-definitions.api.ts` — add `search()`, remove standalone hooks
5. `apps/web/src/api/connector-entities.api.ts` — add `search()`, remove standalone hook
6. `apps/web/src/api/entity-tags.api.ts` — add `search()`, remove standalone hook
7. `apps/web/src/api/field-mappings.api.ts` — add `searchWithEntity()` + `searchWithColumnDefinition()`, remove standalone hooks
8. `apps/web/src/api/connector-instances.api.ts` — add `search()`, remove standalone hook
9. `apps/web/src/workflows/CSVConnector/CSVConnectorWorkflow.component.tsx` — use `sdk.columnDefinitions.search()`, simplify prop threading
10. `apps/web/src/workflows/CSVConnector/ColumnMappingStep.component.tsx` — consume `getById` instead of `onLoadColumnDefinitionById`
11. All consumer views/components that use the old standalone hooks
12. All test files for affected components

## Verification

1. `npm run type-check` — all packages pass
2. `npm run test` — existing tests pass (update mocks where needed)
3. `npm run lint` — no lint errors
4. Manual: verify AsyncSearchableSelect with pre-selected value resolves label via `getById` → `loadSelectedOption`
