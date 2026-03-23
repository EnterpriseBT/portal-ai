# Entity Tagging — Implementation Plan

Flat, org-scoped tags that can be assigned to `connector_entities` for organizational navigation. No hierarchy. Tags are purely metadata — no changes to column definitions, field mappings, or entity records.

---

## Step 1: Core Models

**Files:**
- `packages/core/src/models/entity-tag.model.ts` (new)
- `packages/core/src/models/entity-tag-assignment.model.ts` (new)
- `packages/core/src/models/index.ts` (update)

### Checklist

- [x] Create `entity-tag.model.ts`
  - [x] Define `EntityTagSchema` extending `CoreSchema` with fields: `organizationId`, `name` (min 1), `color` (nullable), `description` (nullable)
  - [x] Export `EntityTag` type inferred from schema
  - [x] Export `EntityTagModel` class extending `CoreModel<EntityTag>` with `get schema()`, `parse()`, `validate()`
  - [x] Export `EntityTagModelFactory` class extending `ModelFactory<EntityTag, EntityTagModel>` with `create(createdBy)`
- [x] Create `entity-tag-assignment.model.ts`
  - [x] Define `EntityTagAssignmentSchema` extending `CoreSchema` with fields: `organizationId`, `connectorEntityId`, `entityTagId`
  - [x] Export `EntityTagAssignment` type inferred from schema
  - [x] Export `EntityTagAssignmentModel` class extending `CoreModel<EntityTagAssignment>` with `get schema()`, `parse()`, `validate()`
  - [x] Export `EntityTagAssignmentModelFactory` class extending `ModelFactory<EntityTagAssignment, EntityTagAssignmentModel>` with `create(createdBy)`
- [x] Update `models/index.ts`
  - [x] Add `export * from "./entity-tag.model.js"`
  - [x] Add `export * from "./entity-tag-assignment.model.js"`

### Verification

- [x] `npm run type-check` passes from repo root

---

## Step 2: Database Tables

**Files:**
- `apps/api/src/db/schema/entity-tags.table.ts` (new)
- `apps/api/src/db/schema/entity-tag-assignments.table.ts` (new)
- `apps/api/src/db/schema/index.ts` (update)

### Checklist

- [x] Create `entity-tags.table.ts`
  - [x] Spread `baseColumns`
  - [x] Add `organizationId` — `text`, not null, FK → `organizations.id`
  - [x] Add `name` — `text`, not null
  - [x] Add `color` — `text`, nullable
  - [x] Add `description` — `text`, nullable
  - [x] Export as `entityTags`
- [x] Create `entity-tag-assignments.table.ts`
  - [x] Spread `baseColumns`
  - [x] Add `organizationId` — `text`, not null, FK → `organizations.id`
  - [x] Add `connectorEntityId` — `text`, not null, FK → `connector_entities.id`
  - [x] Add `entityTagId` — `text`, not null, FK → `entity_tags.id`
  - [x] Add `unique("entity_tag_assignments_entity_tag_unique")` on `(connectorEntityId, entityTagId)`
  - [x] Export as `entityTagAssignments`
- [x] Update `schema/index.ts`
  - [x] Add `export { entityTags } from "./entity-tags.table.js"`
  - [x] Add `export { entityTagAssignments } from "./entity-tag-assignments.table.js"`
- [x] Run `npm run db:generate` from `apps/api/` and confirm migration file is created
- [x] Run `npm run db:migrate` from `apps/api/` and confirm migration applies cleanly

### Verification

- [x] `npm run type-check` passes from repo root
- [x] `npm run build` passes from repo root

---

## Step 3: Drizzle-Zod Schemas & Type-Checks

**Files:**
- `apps/api/src/db/schema/zod.ts` (update)
- `apps/api/src/db/schema/type-checks.ts` (update)

### Checklist

- [x] Update `zod.ts`
  - [x] Import `entityTags` and `entityTagAssignments` from their table files
  - [x] Add `EntityTagSelectSchema = createSelectSchema(entityTags)` and `EntityTagInsertSchema = createInsertSchema(entityTags)`
  - [x] Export `EntityTagSelect` and `EntityTagInsert` types
  - [x] Add `EntityTagAssignmentSelectSchema = createSelectSchema(entityTagAssignments)` and `EntityTagAssignmentInsertSchema = createInsertSchema(entityTagAssignments)`
  - [x] Export `EntityTagAssignmentSelect` and `EntityTagAssignmentInsert` types
- [x] Update `type-checks.ts`
  - [x] Import `EntityTag` and `EntityTagAssignment` from `@portalai/core/models`
  - [x] Import `EntityTagSelect`, `EntityTagAssignmentSelect` from `./zod.js`
  - [x] Import `entityTags` and `entityTagAssignments` table types
  - [x] Add bidirectional `IsAssignable` checks for `EntityTagSelect` ↔ `EntityTag`
  - [x] Add `InferSelectModel` check for `entityTags` → `EntityTag`
  - [x] Add bidirectional `IsAssignable` checks for `EntityTagAssignmentSelect` ↔ `EntityTagAssignment`
  - [x] Add `InferSelectModel` check for `entityTagAssignments` → `EntityTagAssignment`

### Verification

- [x] `npm run type-check` passes from repo root — confirms core models are in sync with Drizzle tables
- [x] `npm run build` passes from repo root

---

## Step 4: Repositories

**Files:**
- `apps/api/src/db/repositories/entity-tags.repository.ts` (new)
- `apps/api/src/db/repositories/entity-tag-assignments.repository.ts` (new)
- `apps/api/src/db/repositories/connector-entities.repository.ts` (update)
- `apps/api/src/db/repositories/index.ts` (update)
- `apps/api/src/services/db.service.ts` (update)

### Checklist

- [x] Create `entity-tags.repository.ts`
  - [x] Extend `Repository<typeof entityTags, EntityTagSelect, EntityTagInsert>`
  - [x] Implement `findByOrganizationId(organizationId, opts?)` — filters by org + not deleted, ordered by `name` ASC
  - [x] Implement `findByName(organizationId, name)` — exact match within org, returns single row or undefined (used for duplicate name validation)
  - [x] Export singleton `entityTagsRepo`
- [x] Create `entity-tag-assignments.repository.ts`
  - [x] Extend `Repository<typeof entityTagAssignments, EntityTagAssignmentSelect, EntityTagAssignmentInsert>`
  - [x] Implement `findByConnectorEntityId(connectorEntityId)` — returns assignments with their tag details batch-loaded (two-query pattern matching existing repos)
  - [x] Implement `findByEntityTagId(entityTagId)` — all assignments for a given tag
  - [x] Implement `findByConnectorEntityIds(ids[])` — batch-loads assignments + tag details for a set of entity IDs; returns a `Map<connectorEntityId, EntityTagSelect[]>` for efficient assembly in list responses
  - [x] Implement `findExisting(connectorEntityId, entityTagId)` — returns existing non-deleted assignment or undefined (used for duplicate detection before create)
  - [x] Export singleton `entityTagAssignmentsRepo`
- [x] Update `connector-entities.repository.ts`
  - [x] Add `findManyWithTags(where, opts?)` — fetches paginated entities then calls `entityTagAssignmentsRepo.findByConnectorEntityIds` to batch-load tags; returns `(ConnectorEntitySelect & { tags: EntityTagSelect[] })[]`
  - [x] Add `findManyByTagIds(organizationId, tagIds[], opts?)` — returns entities that have at least one assignment matching any of the given tag IDs; uses a subquery or join on `entity_tag_assignments`
- [x] Update `repositories/index.ts`
  - [x] Add `export * from "./entity-tags.repository.js"`
  - [x] Add `export * from "./entity-tag-assignments.repository.js"`
- [x] Update `db.service.ts`
  - [x] Import `entityTagsRepo` and `entityTagAssignmentsRepo`
  - [x] Add `entityTags: entityTagsRepo` to `DbService.repository`
  - [x] Add `entityTagAssignments: entityTagAssignmentsRepo` to `DbService.repository`

### Verification

- [x] `npm run type-check` passes from repo root
- [x] `npm run build` passes from repo root

---

## Step 5: API Contracts

**Files:**
- `packages/core/src/contracts/entity-tag.contract.ts` (new)
- `packages/core/src/contracts/entity-tag-assignment.contract.ts` (new)
- `packages/core/src/contracts/connector-entity.contract.ts` (update)
- `packages/core/src/contracts/index.ts` (update)

### Checklist

- [x] Create `entity-tag.contract.ts`
  - [x] `EntityTagListRequestQuerySchema` — extends `PaginationRequestQuerySchema` with optional `search: z.string()` and `sortBy: z.enum(["name", "created"])`
  - [x] `EntityTagListResponsePayloadSchema` — `PaginatedResponsePayloadSchema` with `entityTags: z.array(EntityTagSchema)`
  - [x] `EntityTagWithAssignmentCountSchema` — `EntityTagSchema.extend({ assignmentCount: z.number().int().min(0) })` for enriched list views
  - [x] `EntityTagGetResponsePayloadSchema` — `{ entityTag: EntityTagSchema }`
  - [x] `EntityTagCreateRequestBodySchema` — `{ name: z.string().min(1), color: z.string().optional(), description: z.string().optional() }`
  - [x] `EntityTagCreateResponsePayloadSchema` — `{ entityTag: EntityTagSchema }`
  - [x] `EntityTagUpdateRequestBodySchema` — all fields optional (`name?`, `color?`, `description?`), refine to require at least one field present
  - [x] `EntityTagUpdateResponsePayloadSchema` — `{ entityTag: EntityTagSchema }`
  - [x] Export all schemas and their inferred types
- [x] Create `entity-tag-assignment.contract.ts`
  - [x] `EntityTagAssignmentCreateRequestBodySchema` — `{ entityTagId: z.string() }`
  - [x] `EntityTagAssignmentCreateResponsePayloadSchema` — `{ entityTagAssignment: EntityTagAssignmentSchema }`
  - [x] `EntityTagAssignmentListResponsePayloadSchema` — `{ tags: z.array(EntityTagSchema) }` (returns the tag objects, not raw assignments)
  - [x] `ConnectorEntityWithTagsSchema` — `ConnectorEntitySchema.extend({ tags: z.array(EntityTagSchema) })`
  - [x] `ConnectorEntityListWithTagsResponsePayloadSchema` — `PaginatedResponsePayloadSchema` with `connectorEntities: z.array(ConnectorEntityWithTagsSchema)`
  - [x] Export all schemas and their inferred types
- [x] Update `connector-entity.contract.ts`
  - [x] Add `"tags"` to the `include` enum in `ConnectorEntityListRequestQuerySchema`
  - [x] Add `tagIds: z.string().optional()` to `ConnectorEntityListRequestQuerySchema` — accepts a comma-separated string of tag IDs (e.g. `tagIds=id1,id2`); the API splits and filters to entities assigned any of those tags
- [x] Update `contracts/index.ts`
  - [x] Add `export * from "./entity-tag.contract.js"`
  - [x] Add `export * from "./entity-tag-assignment.contract.js"`

### Verification

- [x] `npm run type-check` passes from repo root
- [x] `npm run build` passes from repo root

---

## Step 6: API Error Codes

**Files:**
- `apps/api/src/constants/api-codes.constants.ts` (update)

### Checklist

- [x] Add Entity Tag codes:
  - [x] `ENTITY_TAG_NOT_FOUND`
  - [x] `ENTITY_TAG_FETCH_FAILED`
  - [x] `ENTITY_TAG_INVALID_PAYLOAD`
  - [x] `ENTITY_TAG_CREATE_FAILED`
  - [x] `ENTITY_TAG_UPDATE_FAILED`
  - [x] `ENTITY_TAG_DELETE_FAILED`
  - [x] `ENTITY_TAG_DUPLICATE_NAME`
  - [x] `ENTITY_TAG_USER_NOT_FOUND`
- [x] Add Entity Tag Assignment codes:
  - [x] `ENTITY_TAG_ASSIGNMENT_NOT_FOUND`
  - [x] `ENTITY_TAG_ASSIGNMENT_FETCH_FAILED`
  - [x] `ENTITY_TAG_ASSIGNMENT_CREATE_FAILED`
  - [x] `ENTITY_TAG_ASSIGNMENT_DELETE_FAILED`
  - [x] `ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS`

### Verification

- [x] `npm run type-check` passes from repo root

---

## Step 7: API Routes

**Files:**
- `apps/api/src/routes/entity-tag.router.ts` (new)
- `apps/api/src/routes/entity-tag-assignment.router.ts` (new)
- `apps/api/src/routes/connector-entity.router.ts` (update)
- `apps/api/src/routes/protected.router.ts` (update)

### Checklist

- [x] Create `entity-tag.router.ts`
  - [x] `GET /` — list tags scoped to org; support `search` (ilike on `name`), `limit`, `offset`, `sortBy` (name/created), `sortOrder`; use `EntityTagListRequestQuerySchema` to parse query
  - [x] `GET /:id` — fetch single tag by ID; 404 with `ENTITY_TAG_NOT_FOUND` if missing
  - [x] `POST /` — create tag; validate with `EntityTagCreateRequestBodySchema`; call `findByName` to detect duplicate name within org, return 409 with `ENTITY_TAG_DUPLICATE_NAME` if found; use `EntityTagModelFactory` to build the record
  - [x] `PATCH /:id` — update tag; validate with `EntityTagUpdateRequestBodySchema`; if `name` is changing, re-run `findByName` duplicate check; 404 if tag not found
  - [x] `DELETE /:id` — soft-delete tag; also soft-delete all its assignments by calling `entityTagAssignmentsRepo.softDeleteMany` filtered by `entityTagId`; wrap both in a `DbService.transaction`; 404 if tag not found
  - [x] Add OpenAPI JSDoc comments for all routes
- [x] Create `entity-tag-assignment.router.ts`
  - [x] `GET /` — list tags assigned to `:connectorEntityId`; returns `EntityTagAssignmentListResponsePayload`
  - [x] `POST /` — assign a tag to `:connectorEntityId`; validate `EntityTagAssignmentCreateRequestBodySchema`; verify the tag exists and belongs to the same org; call `findExisting` to detect duplicate, return 409 with `ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS` if found; use `EntityTagAssignmentModelFactory` to build the record
  - [x] `DELETE /:assignmentId` — soft-delete the assignment; 404 if assignment not found
  - [x] Add OpenAPI JSDoc comments for all routes
- [x] Update `connector-entity.router.ts`
  - [x] Import and mount: `connectorEntityRouter.use("/:connectorEntityId/tags", entityTagAssignmentRouter)`
  - [x] Add `"tags"` to the `include` query param enum
  - [x] In the `GET /` handler, add a branch for `include === "tags"` that calls `findManyWithTags` and returns `ConnectorEntityListWithTagsResponsePayload`
  - [x] Add `tagIds` filter handling: if `tagIds` is present in the query, split on commas and call `findManyByTagIds` instead of `findMany`; the two approaches (`include=tags` and `tagIds` filter) are composable — when both are present, filter by tag IDs first then batch-load full tag arrays onto the results
- [x] Update `protected.router.ts`
  - [x] Import `entityTagRouter`
  - [x] Add `protectedRouter.use("/entity-tags", entityTagRouter)`

### Verification

- [x] `npm run type-check` passes from repo root
- [x] `npm run lint` passes from repo root
- [x] `npm run build` passes from repo root
- [ ] Manually verify routes are visible in Swagger UI at `http://localhost:3001/api-docs`

---

## Step 8: API Tests

**Files:**
- `apps/api/src/__tests__/__integration__/routes/entity-tag.router.integration.test.ts` (new)
- `apps/api/src/__tests__/__integration__/routes/entity-tag-assignment.router.integration.test.ts` (new)
- `apps/api/src/__tests__/__integration__/db/repositories/entity-tags.repository.integration.test.ts` (new)
- `apps/api/src/__tests__/__integration__/db/repositories/entity-tag-assignments.repository.integration.test.ts` (new)

### Checklist

- [x] `entity-tags.repository.integration.test.ts`
  - [x] `findByOrganizationId` returns tags scoped to org, excludes soft-deleted
  - [x] `findByName` returns correct row on match, undefined on miss
  - [x] `create` inserts and returns full row
  - [x] `update` modifies fields correctly
  - [x] `softDelete` sets `deleted` and excludes row from subsequent reads
- [x] `entity-tag-assignments.repository.integration.test.ts`
  - [x] `findByConnectorEntityId` returns enriched assignments with tag details
  - [x] `findByConnectorEntityIds` batch-loads correctly for multiple entity IDs
  - [x] `findExisting` detects existing assignment, returns undefined for non-existent
  - [x] Unique constraint prevents duplicate `(connectorEntityId, entityTagId)` at DB level
- [x] `entity-tag.router.integration.test.ts`
  - [x] `GET /api/entity-tags` returns paginated list scoped to org
  - [x] `GET /api/entity-tags` with `search` filters by name
  - [x] `GET /api/entity-tags/:id` returns 200 for valid ID, 404 for unknown
  - [x] `POST /api/entity-tags` creates tag, returns 201
  - [x] `POST /api/entity-tags` returns 409 on duplicate name within org
  - [x] `PATCH /api/entity-tags/:id` updates fields, returns 200
  - [x] `PATCH /api/entity-tags/:id` returns 409 if new name conflicts with existing tag
  - [x] `DELETE /api/entity-tags/:id` soft-deletes tag and its assignments, returns 200
  - [x] `DELETE /api/entity-tags/:id` returns 404 for unknown ID
- [x] `entity-tag-assignment.router.integration.test.ts`
  - [x] `GET /api/connector-entities/:id/tags` returns assigned tags
  - [x] `POST /api/connector-entities/:id/tags` assigns a tag, returns 201
  - [x] `POST /api/connector-entities/:id/tags` returns 409 if already assigned
  - [x] `DELETE /api/connector-entities/:id/tags/:assignmentId` removes assignment, returns 200
  - [x] `GET /api/connector-entities?include=tags` returns entities with tags array populated
  - [x] `GET /api/connector-entities?tagIds=id1,id2` returns only entities assigned to those tags
  - [x] `GET /api/connector-entities?tagIds=id1&include=tags` returns filtered entities with full tags array

### Verification

- [x] `npm run test` passes from repo root

---

## Step 9: Core — SearchableSelect component family

A general-purpose searchable select component family to be added to `packages/core`. Three variants covering the full range of option-loading patterns. Built on MUI `Autocomplete`.

**Files:**
- `packages/core/src/ui/SearchableSelect.tsx` (new)
- `packages/core/src/ui/index.ts` (update)
- `packages/core/src/stories/SearchableSelect.stories.tsx` (new)
- `packages/core/src/__tests__/ui/SearchableSelect.test.tsx` (new)

### Variants

| Variant | Options source | When to use |
|---------|---------------|-------------|
| `SearchableSelect` | Pre-loaded array prop | Small-to-medium lists already in memory (e.g. tag filter in toolbar where options were fetched upfront) |
| `AsyncSearchableSelect` | Callback triggered on input change | Large lists where typing should filter server-side; always shows fresh results matching the current query |
| `InfiniteScrollSelect` | Paginated fetch callback | Very large lists where the user may not know the name and wants to browse; combines search with scroll-to-load-more |

### Shared props (all variants)

```ts
interface SearchableSelectBaseProps {
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string;
  placeholder?: string;
  helperText?: string;
  error?: boolean;
  disabled?: boolean;
  required?: boolean;
  size?: "small" | "medium";
}
```

### Checklist

#### `SearchableSelect` (synchronous)

- [x] Accepts `options: SelectOption[]` — the full list is passed in; filtering is done client-side by MUI `Autocomplete`
- [x] Wraps `MuiAutocomplete` with `options`, `value` resolved to the matching `SelectOption` object, `onChange` mapped to emit `option.value` (string) or `null`
- [x] Renders `TextField` as the input; forwards `label`, `placeholder`, `helperText`, `error`, `disabled`, `required`, `size`
- [x] `isOptionEqualToValue` compares by `option.value`
- [x] `getOptionLabel` returns `option.label`
- [x] Export `SearchableSelect` and `SearchableSelectProps`

#### `AsyncSearchableSelect` (search-on-type)

- [x] Accepts `onSearch: (query: string) => Promise<SelectOption[]>` — called with the current input value; replaces the options list with each result
- [x] Accepts `debounceMs?: number` (default `300`) — debounces calls to `onSearch`
- [x] Manages internal `options` state (replaced, not appended, on each search result)
- [x] Shows a loading indicator in the listbox while the search is in-flight (`loading` prop on `MuiAutocomplete`)
- [x] Sets `filterOptions={(x) => x}` to disable client-side filtering (server already filtered)
- [x] Clears options to `[]` when input is cleared
- [x] `inputValue` is controlled so the text field always reflects the current query
- [x] Export `AsyncSearchableSelect` and `AsyncSearchableSelectProps`

#### `InfiniteScrollSelect` (search + paginated scroll)

- [x] Accepts `fetchPage: (params: { search: string; page: number; pageSize: number }) => Promise<{ options: SelectOption[]; hasMore: boolean }>` — called on open, on search change (resets to page 0), and when the bottom sentinel is reached
- [x] Accepts `pageSize?: number` (default `20`)
- [x] Accepts `debounceMs?: number` (default `300`) for search input debouncing
- [x] Manages internal state: `options` (accumulated across pages), `page`, `hasMore`, `loading`
- [x] When search input changes: resets `options` to `[]`, `page` to `0`, calls `fetchPage({ search, page: 0, pageSize })`
- [x] When dropdown opens with no options loaded yet: calls `fetchPage({ search: "", page: 0, pageSize })`
- [x] Renders a custom `ListboxComponent` that appends a bottom sentinel `<div>` after the last option; attaches an `IntersectionObserver` to it — when the sentinel enters the viewport and `hasMore` is true and not currently loading, increments `page` and calls `fetchPage` to append the next batch to `options`
- [x] Shows a loading spinner item at the bottom of the list while fetching a new page
- [x] Sets `filterOptions={(x) => x}` (server-side filtering)
- [x] `inputValue` is controlled
- [x] Export `InfiniteScrollSelect` and `InfiniteScrollSelectProps`

#### Shared / housekeeping

- [x] All three components re-export `SelectOption` from `Select.tsx` (or move the type to a shared location if needed)
- [x] Update `packages/core/src/ui/index.ts` — add `export * from "./SearchableSelect.js"`
- [x] Stories (`SearchableSelect.stories.tsx`):
  - [x] `SearchableSelect` story with a static list of 20+ options demonstrating client-side search
  - [x] `AsyncSearchableSelect` story with a mock `onSearch` that simulates a network delay and filters a large dataset
  - [x] `InfiniteScrollSelect` story with a mock `fetchPage` returning 20 items per page from a 200-item dataset, demonstrating scroll-to-load
- [x] Tests (`SearchableSelect.test.tsx`):
  - [x] `SearchableSelect`: renders options, filters on type, calls `onChange` with correct value, calls `onChange(null)` on clear
  - [x] `AsyncSearchableSelect`: calls `onSearch` after debounce, shows loading state, replaces options on new search, does not call `onSearch` synchronously on every keystroke
  - [x] `InfiniteScrollSelect`: calls `fetchPage` on open, appends results on scroll-to-bottom (mock `IntersectionObserver`), resets on search change, does not fetch next page when `hasMore` is false

### Verification

- [x] `npm run type-check` passes from repo root
- [x] `npm run lint` passes from repo root
- [x] `npm run build` passes from repo root
- [x] `npm run test` passes from repo root
- [ ] All three stories render correctly in Storybook (`npm run storybook` from repo root, core at `:7006`)

---

## Step 10: Frontend — PaginationToolbar: multi-select filter type

The existing `FilterConfig` union in `PaginationToolbar.component.tsx` supports `select` (radio, single-value), `boolean`, `number`, and `text`. Tag filtering requires a **multi-select** type so users can filter by more than one tag simultaneously. This is a general extension to the toolbar, not tagging-specific.

**Files:**
- `apps/web/src/components/PaginationToolbar.component.tsx` (update)

### Checklist

- [x] Add `MultiSelectFilterConfig` interface to the `FilterConfig` union:
  ```ts
  export interface MultiSelectFilterConfig extends BaseFilterConfig {
    type: "multi-select";
    options: FilterOption[];
  }
  ```
- [x] Add `"multi-select"` to the `FilterConfig` type union
- [x] In the filter popover render block, add a branch for `config.type === "multi-select"` that renders a `SearchableSelect` (synchronous variant from Step 9) inside the popover; the currently selected values are shown as chips below the select; selecting an option adds it to the values array if not already present; `onChange` fires `setFilter(field, updatedValues)`
- [x] In `queryParams` building inside `usePagination`, add a branch for `multi-select`: serialize the selected values array as a comma-separated string — `params[field] = values.join(",")` — so the API receives `tagIds=id1,id2`
- [x] In the active filter chips row, add a branch for `multi-select` that renders one chip per selected value (showing the option label, not the raw ID), each with its own `onDelete` that removes just that value from the array
- [x] Update `PaginationToolbarProps` JSDoc to document the new type

### Verification

- [x] `npm run type-check` passes from repo root
- [x] `npm run lint` passes from repo root
- [x] `npm run build` passes from repo root
- [x] `npm run test` passes from repo root (update `PaginationToolbar.test.tsx` to cover multi-select behaviour)

---

## Step 11: Frontend — EntitiesView tag filter

**Files:**
- `apps/web/src/views/Entities.view.tsx` (update)

### Checklist

- [x] Add `useEntityTagFilter` hook (in `entity-tags.api.ts`, using `InfiniteScrollSelect` pattern with `fetchPage` + `labelMap` for unbounded tag counts):
  - [x] Uses `useAuthFetch` for authenticated paginated fetching via `fetchPage` callback
  - [x] Maintains a `labelMap` of fetched tag values to labels for chip display
- [x] In `EntitiesViewUI`, add `tagFetchPage` and `tagLabelMap` to props
- [x] Add a `"multi-select"` filter entry to the `filters` array passed to `usePagination`:
  ```ts
  {
    type: "multi-select",
    field: "tagIds",
    label: "Tags",
    fetchPage: tagFetchPage,
    labelMap: tagLabelMap,
  }
  ```
- [x] The `tagIds` value produced by `usePagination.queryParams` (comma-separated string) is already spread into the `ConnectorEntityDataList` query via `pagination.queryParams` — no additional wiring needed
- [x] Update `EntitiesView` container to call `useEntityTagFilter` and pass `tagFetchPage` / `tagLabelMap` down to `EntitiesViewUI`
- [x] Update `EntitiesViewUIProps` interface to include `tagFetchPage` and `tagLabelMap`

### Verification

- [x] `npm run type-check` passes from repo root
- [x] `npm run lint` passes from repo root
- [x] `npm run build` passes from repo root
- [x] `npm run test` passes from repo root (update `EntitiesView.test.tsx` to cover tag filter rendering and query param output)

---

## Step 12: Frontend — Entity detail

**Files:**
- `apps/web/src/views/EntityDetail.view.tsx` (update)

### Checklist

- [x] Entity detail view (`EntityDetail.view.tsx`)
  - [x] Fetch assigned tags via `GET /api/connector-entities/:id/tags` on load
  - [x] Display assigned tags as MUI `Chip` components in the entity metadata section
  - [x] Add inline tag assignment using `AsyncSearchableSelect`: `onSearch` calls `GET /api/entity-tags?search=<query>` and returns matching tags as options; selecting an option calls `POST /api/connector-entities/:id/tags`; reset the select value after a successful assignment


### Verification

- [x] `npm run type-check` passes from repo root
- [x] `npm run lint` passes from repo root
- [x] `npm run build` passes from repo root
- [x] `npm run test` passes from repo root

---

## Final Verification

Run all checks from the repo root in order:

- [ ] `npm run type-check`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run test`
