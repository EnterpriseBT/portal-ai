# Entity Tagging — Implementation Plan

Flat, org-scoped tags that can be assigned to `connector_entities` for organizational navigation. No hierarchy. Tags are purely metadata — no changes to column definitions, field mappings, or entity records.

---

## Step 1: Core Models

**Files:**
- `packages/core/src/models/entity-tag.model.ts` (new)
- `packages/core/src/models/entity-tag-assignment.model.ts` (new)
- `packages/core/src/models/index.ts` (update)

### Checklist

- [ ] Create `entity-tag.model.ts`
  - [ ] Define `EntityTagSchema` extending `CoreSchema` with fields: `organizationId`, `name` (min 1), `color` (nullable), `description` (nullable)
  - [ ] Export `EntityTag` type inferred from schema
  - [ ] Export `EntityTagModel` class extending `CoreModel<EntityTag>` with `get schema()`, `parse()`, `validate()`
  - [ ] Export `EntityTagModelFactory` class extending `ModelFactory<EntityTag, EntityTagModel>` with `create(createdBy)`
- [ ] Create `entity-tag-assignment.model.ts`
  - [ ] Define `EntityTagAssignmentSchema` extending `CoreSchema` with fields: `organizationId`, `connectorEntityId`, `entityTagId`
  - [ ] Export `EntityTagAssignment` type inferred from schema
  - [ ] Export `EntityTagAssignmentModel` class extending `CoreModel<EntityTagAssignment>` with `get schema()`, `parse()`, `validate()`
  - [ ] Export `EntityTagAssignmentModelFactory` class extending `ModelFactory<EntityTagAssignment, EntityTagAssignmentModel>` with `create(createdBy)`
- [ ] Update `models/index.ts`
  - [ ] Add `export * from "./entity-tag.model.js"`
  - [ ] Add `export * from "./entity-tag-assignment.model.js"`

### Verification

- [ ] `npm run type-check` passes from repo root

---

## Step 2: Database Tables

**Files:**
- `apps/api/src/db/schema/entity-tags.table.ts` (new)
- `apps/api/src/db/schema/entity-tag-assignments.table.ts` (new)
- `apps/api/src/db/schema/index.ts` (update)

### Checklist

- [ ] Create `entity-tags.table.ts`
  - [ ] Spread `baseColumns`
  - [ ] Add `organizationId` — `text`, not null, FK → `organizations.id`
  - [ ] Add `name` — `text`, not null
  - [ ] Add `color` — `text`, nullable
  - [ ] Add `description` — `text`, nullable
  - [ ] Export as `entityTags`
- [ ] Create `entity-tag-assignments.table.ts`
  - [ ] Spread `baseColumns`
  - [ ] Add `organizationId` — `text`, not null, FK → `organizations.id`
  - [ ] Add `connectorEntityId` — `text`, not null, FK → `connector_entities.id`
  - [ ] Add `entityTagId` — `text`, not null, FK → `entity_tags.id`
  - [ ] Add `unique("entity_tag_assignments_entity_tag_unique")` on `(connectorEntityId, entityTagId)`
  - [ ] Export as `entityTagAssignments`
- [ ] Update `schema/index.ts`
  - [ ] Add `export { entityTags } from "./entity-tags.table.js"`
  - [ ] Add `export { entityTagAssignments } from "./entity-tag-assignments.table.js"`
- [ ] Run `npm run db:generate` from `apps/api/` and confirm migration file is created
- [ ] Run `npm run db:migrate` from `apps/api/` and confirm migration applies cleanly

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run build` passes from repo root

---

## Step 3: Drizzle-Zod Schemas & Type-Checks

**Files:**
- `apps/api/src/db/schema/zod.ts` (update)
- `apps/api/src/db/schema/type-checks.ts` (update)

### Checklist

- [ ] Update `zod.ts`
  - [ ] Import `entityTags` and `entityTagAssignments` from their table files
  - [ ] Add `EntityTagSelectSchema = createSelectSchema(entityTags)` and `EntityTagInsertSchema = createInsertSchema(entityTags)`
  - [ ] Export `EntityTagSelect` and `EntityTagInsert` types
  - [ ] Add `EntityTagAssignmentSelectSchema = createSelectSchema(entityTagAssignments)` and `EntityTagAssignmentInsertSchema = createInsertSchema(entityTagAssignments)`
  - [ ] Export `EntityTagAssignmentSelect` and `EntityTagAssignmentInsert` types
- [ ] Update `type-checks.ts`
  - [ ] Import `EntityTag` and `EntityTagAssignment` from `@portalai/core/models`
  - [ ] Import `EntityTagSelect`, `EntityTagAssignmentSelect` from `./zod.js`
  - [ ] Import `entityTags` and `entityTagAssignments` table types
  - [ ] Add bidirectional `IsAssignable` checks for `EntityTagSelect` ↔ `EntityTag`
  - [ ] Add `InferSelectModel` check for `entityTags` → `EntityTag`
  - [ ] Add bidirectional `IsAssignable` checks for `EntityTagAssignmentSelect` ↔ `EntityTagAssignment`
  - [ ] Add `InferSelectModel` check for `entityTagAssignments` → `EntityTagAssignment`

### Verification

- [ ] `npm run type-check` passes from repo root — confirms core models are in sync with Drizzle tables
- [ ] `npm run build` passes from repo root

---

## Step 4: Repositories

**Files:**
- `apps/api/src/db/repositories/entity-tags.repository.ts` (new)
- `apps/api/src/db/repositories/entity-tag-assignments.repository.ts` (new)
- `apps/api/src/db/repositories/connector-entities.repository.ts` (update)
- `apps/api/src/db/repositories/index.ts` (update)
- `apps/api/src/services/db.service.ts` (update)

### Checklist

- [ ] Create `entity-tags.repository.ts`
  - [ ] Extend `Repository<typeof entityTags, EntityTagSelect, EntityTagInsert>`
  - [ ] Implement `findByOrganizationId(organizationId, opts?)` — filters by org + not deleted, ordered by `name` ASC
  - [ ] Implement `findByName(organizationId, name)` — exact match within org, returns single row or undefined (used for duplicate name validation)
  - [ ] Export singleton `entityTagsRepo`
- [ ] Create `entity-tag-assignments.repository.ts`
  - [ ] Extend `Repository<typeof entityTagAssignments, EntityTagAssignmentSelect, EntityTagAssignmentInsert>`
  - [ ] Implement `findByConnectorEntityId(connectorEntityId)` — returns assignments with their tag details batch-loaded (two-query pattern matching existing repos)
  - [ ] Implement `findByEntityTagId(entityTagId)` — all assignments for a given tag
  - [ ] Implement `findByConnectorEntityIds(ids[])` — batch-loads assignments + tag details for a set of entity IDs; returns a `Map<connectorEntityId, EntityTagSelect[]>` for efficient assembly in list responses
  - [ ] Implement `findExisting(connectorEntityId, entityTagId)` — returns existing non-deleted assignment or undefined (used for duplicate detection before create)
  - [ ] Export singleton `entityTagAssignmentsRepo`
- [ ] Update `connector-entities.repository.ts`
  - [ ] Add `findManyWithTags(where, opts?)` — fetches paginated entities then calls `entityTagAssignmentsRepo.findByConnectorEntityIds` to batch-load tags; returns `(ConnectorEntitySelect & { tags: EntityTagSelect[] })[]`
  - [ ] Add `findManyByTagIds(organizationId, tagIds[], opts?)` — returns entities that have at least one assignment matching any of the given tag IDs; uses a subquery or join on `entity_tag_assignments`
- [ ] Update `repositories/index.ts`
  - [ ] Add `export * from "./entity-tags.repository.js"`
  - [ ] Add `export * from "./entity-tag-assignments.repository.js"`
- [ ] Update `db.service.ts`
  - [ ] Import `entityTagsRepo` and `entityTagAssignmentsRepo`
  - [ ] Add `entityTags: entityTagsRepo` to `DbService.repository`
  - [ ] Add `entityTagAssignments: entityTagAssignmentsRepo` to `DbService.repository`

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run build` passes from repo root

---

## Step 5: API Contracts

**Files:**
- `packages/core/src/contracts/entity-tag.contract.ts` (new)
- `packages/core/src/contracts/entity-tag-assignment.contract.ts` (new)
- `packages/core/src/contracts/connector-entity.contract.ts` (update)
- `packages/core/src/contracts/index.ts` (update)

### Checklist

- [ ] Create `entity-tag.contract.ts`
  - [ ] `EntityTagListRequestQuerySchema` — extends `PaginationRequestQuerySchema` with optional `search: z.string()` and `sortBy: z.enum(["name", "created"])`
  - [ ] `EntityTagListResponsePayloadSchema` — `PaginatedResponsePayloadSchema` with `entityTags: z.array(EntityTagSchema)`
  - [ ] `EntityTagWithAssignmentCountSchema` — `EntityTagSchema.extend({ assignmentCount: z.number().int().min(0) })` for enriched list views
  - [ ] `EntityTagGetResponsePayloadSchema` — `{ entityTag: EntityTagSchema }`
  - [ ] `EntityTagCreateRequestBodySchema` — `{ name: z.string().min(1), color: z.string().optional(), description: z.string().optional() }`
  - [ ] `EntityTagCreateResponsePayloadSchema` — `{ entityTag: EntityTagSchema }`
  - [ ] `EntityTagUpdateRequestBodySchema` — all fields optional (`name?`, `color?`, `description?`), refine to require at least one field present
  - [ ] `EntityTagUpdateResponsePayloadSchema` — `{ entityTag: EntityTagSchema }`
  - [ ] Export all schemas and their inferred types
- [ ] Create `entity-tag-assignment.contract.ts`
  - [ ] `EntityTagAssignmentCreateRequestBodySchema` — `{ entityTagId: z.string() }`
  - [ ] `EntityTagAssignmentCreateResponsePayloadSchema` — `{ entityTagAssignment: EntityTagAssignmentSchema }`
  - [ ] `EntityTagAssignmentListResponsePayloadSchema` — `{ tags: z.array(EntityTagSchema) }` (returns the tag objects, not raw assignments)
  - [ ] `ConnectorEntityWithTagsSchema` — `ConnectorEntitySchema.extend({ tags: z.array(EntityTagSchema) })`
  - [ ] `ConnectorEntityListWithTagsResponsePayloadSchema` — `PaginatedResponsePayloadSchema` with `connectorEntities: z.array(ConnectorEntityWithTagsSchema)`
  - [ ] Export all schemas and their inferred types
- [ ] Update `connector-entity.contract.ts`
  - [ ] Add `"tags"` to the `include` enum in `ConnectorEntityListRequestQuerySchema`
  - [ ] Add `tagIds: z.string().optional()` to `ConnectorEntityListRequestQuerySchema` — accepts a comma-separated string of tag IDs (e.g. `tagIds=id1,id2`); the API splits and filters to entities assigned any of those tags
- [ ] Update `contracts/index.ts`
  - [ ] Add `export * from "./entity-tag.contract.js"`
  - [ ] Add `export * from "./entity-tag-assignment.contract.js"`

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run build` passes from repo root

---

## Step 6: API Error Codes

**Files:**
- `apps/api/src/constants/api-codes.constants.ts` (update)

### Checklist

- [ ] Add Entity Tag codes:
  - [ ] `ENTITY_TAG_NOT_FOUND`
  - [ ] `ENTITY_TAG_FETCH_FAILED`
  - [ ] `ENTITY_TAG_INVALID_PAYLOAD`
  - [ ] `ENTITY_TAG_CREATE_FAILED`
  - [ ] `ENTITY_TAG_UPDATE_FAILED`
  - [ ] `ENTITY_TAG_DELETE_FAILED`
  - [ ] `ENTITY_TAG_DUPLICATE_NAME`
  - [ ] `ENTITY_TAG_USER_NOT_FOUND`
- [ ] Add Entity Tag Assignment codes:
  - [ ] `ENTITY_TAG_ASSIGNMENT_NOT_FOUND`
  - [ ] `ENTITY_TAG_ASSIGNMENT_FETCH_FAILED`
  - [ ] `ENTITY_TAG_ASSIGNMENT_CREATE_FAILED`
  - [ ] `ENTITY_TAG_ASSIGNMENT_DELETE_FAILED`
  - [ ] `ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS`

### Verification

- [ ] `npm run type-check` passes from repo root

---

## Step 7: API Routes

**Files:**
- `apps/api/src/routes/entity-tag.router.ts` (new)
- `apps/api/src/routes/entity-tag-assignment.router.ts` (new)
- `apps/api/src/routes/connector-entity.router.ts` (update)
- `apps/api/src/routes/protected.router.ts` (update)

### Checklist

- [ ] Create `entity-tag.router.ts`
  - [ ] `GET /` — list tags scoped to org; support `search` (ilike on `name`), `limit`, `offset`, `sortBy` (name/created), `sortOrder`; use `EntityTagListRequestQuerySchema` to parse query
  - [ ] `GET /:id` — fetch single tag by ID; 404 with `ENTITY_TAG_NOT_FOUND` if missing
  - [ ] `POST /` — create tag; validate with `EntityTagCreateRequestBodySchema`; call `findByName` to detect duplicate name within org, return 409 with `ENTITY_TAG_DUPLICATE_NAME` if found; use `EntityTagModelFactory` to build the record
  - [ ] `PATCH /:id` — update tag; validate with `EntityTagUpdateRequestBodySchema`; if `name` is changing, re-run `findByName` duplicate check; 404 if tag not found
  - [ ] `DELETE /:id` — soft-delete tag; also soft-delete all its assignments by calling `entityTagAssignmentsRepo.softDeleteMany` filtered by `entityTagId`; wrap both in a `DbService.transaction`; 404 if tag not found
  - [ ] Add OpenAPI JSDoc comments for all routes
- [ ] Create `entity-tag-assignment.router.ts`
  - [ ] `GET /` — list tags assigned to `:connectorEntityId`; returns `EntityTagAssignmentListResponsePayload`
  - [ ] `POST /` — assign a tag to `:connectorEntityId`; validate `EntityTagAssignmentCreateRequestBodySchema`; verify the tag exists and belongs to the same org; call `findExisting` to detect duplicate, return 409 with `ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS` if found; use `EntityTagAssignmentModelFactory` to build the record
  - [ ] `DELETE /:assignmentId` — soft-delete the assignment; 404 if assignment not found
  - [ ] Add OpenAPI JSDoc comments for all routes
- [ ] Update `connector-entity.router.ts`
  - [ ] Import and mount: `connectorEntityRouter.use("/:connectorEntityId/tags", entityTagAssignmentRouter)`
  - [ ] Add `"tags"` to the `include` query param enum
  - [ ] In the `GET /` handler, add a branch for `include === "tags"` that calls `findManyWithTags` and returns `ConnectorEntityListWithTagsResponsePayload`
  - [ ] Add `tagIds` filter handling: if `tagIds` is present in the query, split on commas and call `findManyByTagIds` instead of `findMany`; the two approaches (`include=tags` and `tagIds` filter) are composable — when both are present, filter by tag IDs first then batch-load full tag arrays onto the results
- [ ] Update `protected.router.ts`
  - [ ] Import `entityTagRouter`
  - [ ] Add `protectedRouter.use("/entity-tags", entityTagRouter)`

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run lint` passes from repo root
- [ ] `npm run build` passes from repo root
- [ ] Manually verify routes are visible in Swagger UI at `http://localhost:3001/api-docs`

---

## Step 8: API Tests

**Files:**
- `apps/api/src/__tests__/__integration__/routes/entity-tag.router.integration.test.ts` (new)
- `apps/api/src/__tests__/__integration__/routes/entity-tag-assignment.router.integration.test.ts` (new)
- `apps/api/src/__tests__/__integration__/db/repositories/entity-tags.repository.integration.test.ts` (new)
- `apps/api/src/__tests__/__integration__/db/repositories/entity-tag-assignments.repository.integration.test.ts` (new)

### Checklist

- [ ] `entity-tags.repository.integration.test.ts`
  - [ ] `findByOrganizationId` returns tags scoped to org, excludes soft-deleted
  - [ ] `findByName` returns correct row on match, undefined on miss
  - [ ] `create` inserts and returns full row
  - [ ] `update` modifies fields correctly
  - [ ] `softDelete` sets `deleted` and excludes row from subsequent reads
- [ ] `entity-tag-assignments.repository.integration.test.ts`
  - [ ] `findByConnectorEntityId` returns enriched assignments with tag details
  - [ ] `findByConnectorEntityIds` batch-loads correctly for multiple entity IDs
  - [ ] `findExisting` detects existing assignment, returns undefined for non-existent
  - [ ] Unique constraint prevents duplicate `(connectorEntityId, entityTagId)` at DB level
- [ ] `entity-tag.router.integration.test.ts`
  - [ ] `GET /api/entity-tags` returns paginated list scoped to org
  - [ ] `GET /api/entity-tags` with `search` filters by name
  - [ ] `GET /api/entity-tags/:id` returns 200 for valid ID, 404 for unknown
  - [ ] `POST /api/entity-tags` creates tag, returns 201
  - [ ] `POST /api/entity-tags` returns 409 on duplicate name within org
  - [ ] `PATCH /api/entity-tags/:id` updates fields, returns 200
  - [ ] `PATCH /api/entity-tags/:id` returns 409 if new name conflicts with existing tag
  - [ ] `DELETE /api/entity-tags/:id` soft-deletes tag and its assignments, returns 200
  - [ ] `DELETE /api/entity-tags/:id` returns 404 for unknown ID
- [ ] `entity-tag-assignment.router.integration.test.ts`
  - [ ] `GET /api/connector-entities/:id/tags` returns assigned tags
  - [ ] `POST /api/connector-entities/:id/tags` assigns a tag, returns 201
  - [ ] `POST /api/connector-entities/:id/tags` returns 409 if already assigned
  - [ ] `DELETE /api/connector-entities/:id/tags/:assignmentId` removes assignment, returns 200
  - [ ] `GET /api/connector-entities?include=tags` returns entities with tags array populated
  - [ ] `GET /api/connector-entities?tagIds=id1,id2` returns only entities assigned to those tags
  - [ ] `GET /api/connector-entities?tagIds=id1&include=tags` returns filtered entities with full tags array

### Verification

- [ ] `npm run test` passes from repo root

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

- [ ] Accepts `options: SelectOption[]` — the full list is passed in; filtering is done client-side by MUI `Autocomplete`
- [ ] Wraps `MuiAutocomplete` with `options`, `value` resolved to the matching `SelectOption` object, `onChange` mapped to emit `option.value` (string) or `null`
- [ ] Renders `TextField` as the input; forwards `label`, `placeholder`, `helperText`, `error`, `disabled`, `required`, `size`
- [ ] `isOptionEqualToValue` compares by `option.value`
- [ ] `getOptionLabel` returns `option.label`
- [ ] Export `SearchableSelect` and `SearchableSelectProps`

#### `AsyncSearchableSelect` (search-on-type)

- [ ] Accepts `onSearch: (query: string) => Promise<SelectOption[]>` — called with the current input value; replaces the options list with each result
- [ ] Accepts `debounceMs?: number` (default `300`) — debounces calls to `onSearch`
- [ ] Manages internal `options` state (replaced, not appended, on each search result)
- [ ] Shows a loading indicator in the listbox while the search is in-flight (`loading` prop on `MuiAutocomplete`)
- [ ] Sets `filterOptions={(x) => x}` to disable client-side filtering (server already filtered)
- [ ] Clears options to `[]` when input is cleared
- [ ] `inputValue` is controlled so the text field always reflects the current query
- [ ] Export `AsyncSearchableSelect` and `AsyncSearchableSelectProps`

#### `InfiniteScrollSelect` (search + paginated scroll)

- [ ] Accepts `fetchPage: (params: { search: string; page: number; pageSize: number }) => Promise<{ options: SelectOption[]; hasMore: boolean }>` — called on open, on search change (resets to page 0), and when the bottom sentinel is reached
- [ ] Accepts `pageSize?: number` (default `20`)
- [ ] Accepts `debounceMs?: number` (default `300`) for search input debouncing
- [ ] Manages internal state: `options` (accumulated across pages), `page`, `hasMore`, `loading`
- [ ] When search input changes: resets `options` to `[]`, `page` to `0`, calls `fetchPage({ search, page: 0, pageSize })`
- [ ] When dropdown opens with no options loaded yet: calls `fetchPage({ search: "", page: 0, pageSize })`
- [ ] Renders a custom `ListboxComponent` that appends a bottom sentinel `<div>` after the last option; attaches an `IntersectionObserver` to it — when the sentinel enters the viewport and `hasMore` is true and not currently loading, increments `page` and calls `fetchPage` to append the next batch to `options`
- [ ] Shows a loading spinner item at the bottom of the list while fetching a new page
- [ ] Sets `filterOptions={(x) => x}` (server-side filtering)
- [ ] `inputValue` is controlled
- [ ] Export `InfiniteScrollSelect` and `InfiniteScrollSelectProps`

#### Shared / housekeeping

- [ ] All three components re-export `SelectOption` from `Select.tsx` (or move the type to a shared location if needed)
- [ ] Update `packages/core/src/ui/index.ts` — add `export * from "./SearchableSelect.js"`
- [ ] Stories (`SearchableSelect.stories.tsx`):
  - [ ] `SearchableSelect` story with a static list of 20+ options demonstrating client-side search
  - [ ] `AsyncSearchableSelect` story with a mock `onSearch` that simulates a network delay and filters a large dataset
  - [ ] `InfiniteScrollSelect` story with a mock `fetchPage` returning 20 items per page from a 200-item dataset, demonstrating scroll-to-load
- [ ] Tests (`SearchableSelect.test.tsx`):
  - [ ] `SearchableSelect`: renders options, filters on type, calls `onChange` with correct value, calls `onChange(null)` on clear
  - [ ] `AsyncSearchableSelect`: calls `onSearch` after debounce, shows loading state, replaces options on new search, does not call `onSearch` synchronously on every keystroke
  - [ ] `InfiniteScrollSelect`: calls `fetchPage` on open, appends results on scroll-to-bottom (mock `IntersectionObserver`), resets on search change, does not fetch next page when `hasMore` is false

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run lint` passes from repo root
- [ ] `npm run build` passes from repo root
- [ ] `npm run test` passes from repo root
- [ ] All three stories render correctly in Storybook (`npm run storybook` from repo root, core at `:7006`)

---

## Step 10: Frontend — PaginationToolbar: multi-select filter type

The existing `FilterConfig` union in `PaginationToolbar.component.tsx` supports `select` (radio, single-value), `boolean`, `number`, and `text`. Tag filtering requires a **multi-select** type so users can filter by more than one tag simultaneously. This is a general extension to the toolbar, not tagging-specific.

**Files:**
- `apps/web/src/components/PaginationToolbar.component.tsx` (update)

### Checklist

- [ ] Add `MultiSelectFilterConfig` interface to the `FilterConfig` union:
  ```ts
  export interface MultiSelectFilterConfig extends BaseFilterConfig {
    type: "multi-select";
    options: FilterOption[];
  }
  ```
- [ ] Add `"multi-select"` to the `FilterConfig` type union
- [ ] In the filter popover render block, add a branch for `config.type === "multi-select"` that renders a `SearchableSelect` (synchronous variant from Step 9) inside the popover; the currently selected values are shown as chips below the select; selecting an option adds it to the values array if not already present; `onChange` fires `setFilter(field, updatedValues)`
- [ ] In `queryParams` building inside `usePagination`, add a branch for `multi-select`: serialize the selected values array as a comma-separated string — `params[field] = values.join(",")` — so the API receives `tagIds=id1,id2`
- [ ] In the active filter chips row, add a branch for `multi-select` that renders one chip per selected value (showing the option label, not the raw ID), each with its own `onDelete` that removes just that value from the array
- [ ] Update `PaginationToolbarProps` JSDoc to document the new type

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run lint` passes from repo root
- [ ] `npm run build` passes from repo root
- [ ] `npm run test` passes from repo root (update `PaginationToolbar.test.tsx` to cover multi-select behaviour)

---

## Step 11: Frontend — EntitiesView tag filter

**Files:**
- `apps/web/src/views/Entities.view.tsx` (update)

### Checklist

- [ ] Add `useEntityTagOptions` hook (inline in the file, following the `useConnectorInstanceOptions` pattern):
  - [ ] Call `sdk.entityTags.list({ limit: 100, offset: 0, sortBy: "name", sortOrder: "asc" })`
  - [ ] Return `{ label: tag.name, value: tag.id }[]`; return `[]` while loading
- [ ] In `EntitiesViewUI`, add `tagOptions` to props (type `{ label: string; value: string }[]`)
- [ ] Add a `"multi-select"` filter entry to the `filters` array passed to `usePagination`:
  ```ts
  {
    type: "multi-select",
    field: "tagIds",
    label: "Tags",
    options: tagOptions,
  }
  ```
- [ ] The `tagIds` value produced by `usePagination.queryParams` (comma-separated string) is already spread into the `ConnectorEntityDataList` query via `pagination.queryParams` — no additional wiring needed
- [ ] Update `EntitiesView` container to call `useEntityTagOptions` and pass `tagOptions` down to `EntitiesViewUI`
- [ ] Update `EntitiesViewUIProps` interface to include `tagOptions: { label: string; value: string }[]`

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run lint` passes from repo root
- [ ] `npm run build` passes from repo root
- [ ] `npm run test` passes from repo root (update `EntitiesView.test.tsx` to cover tag filter rendering and query param output)

---

## Step 12: Frontend — Entity detail & Settings

**Files:**
- `apps/web/src/views/EntityDetail.view.tsx` (update)
- `apps/web/src/routes/settings/tags.tsx` (new)

### Checklist

- [ ] Entity detail view (`EntityDetail.view.tsx`)
  - [ ] Fetch assigned tags via `GET /api/connector-entities/:id/tags` on load
  - [ ] Display assigned tags as MUI `Chip` components in the entity metadata section
  - [ ] Add inline tag assignment using `AsyncSearchableSelect`: `onSearch` calls `GET /api/entity-tags?search=<query>` and returns matching tags as options; selecting an option calls `POST /api/connector-entities/:id/tags`; reset the select value after a successful assignment
  - [ ] Clicking chip X calls `DELETE /api/connector-entities/:id/tags/:assignmentId` and removes the chip optimistically
- [ ] Settings Tags page (`settings/tags.tsx`)
  - [ ] Create route file; add "Tags" link to the settings sidebar nav
  - [ ] Render a table listing all org tags: name, color swatch, assignment count, edit and delete actions; use `InfiniteScrollSelect` as a reference pattern for the paginated fetch but the table itself uses standard pagination
  - [ ] "New tag" opens a modal/drawer with name, color picker, and description fields; submits to `POST /api/entity-tags`
  - [ ] Edit action opens the same modal pre-populated; submits to `PATCH /api/entity-tags/:id`
  - [ ] Delete action shows a confirmation dialog warning that all assignments will also be removed; calls `DELETE /api/entity-tags/:id`

### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run lint` passes from repo root
- [ ] `npm run build` passes from repo root
- [ ] `npm run test` passes from repo root

---

## Final Verification

Run all checks from the repo root in order:

- [ ] `npm run type-check`
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm run test`

---

## SearchableSelect Migration Plan

Audit of existing places in the app where the new `SearchableSelect` family (built in Step 9) should replace the current `Select` or raw MUI `Select`. Ordered by priority.

### Candidates

| # | File | Location | Current | Variant | Reason |
|---|------|----------|---------|---------|--------|
| 1 | `AdvancedFilterBuilder.component.tsx` | Column field picker in `FilterConditionEditor` | Raw MUI `Select` + `MenuItem` | `SearchableSelect` (sync) | Column defs grow with entity size; hard to scroll to the right field when an entity has 20+ mapped columns. Also the only place in the app still using raw MUI `Select` instead of the core wrapper. |
| 2 | `ColumnMappingStep.component.tsx` | "Reference Entity" select in `ReferenceEditor` | Core `Select` | `SearchableSelect` (sync) | Combines current-import entities and all DB entities into one list; the DB entity list can grow unboundedly as the org imports more connectors. |
| 3 | `ColumnMappingStep.component.tsx` | "Reference Column" select in `ReferenceEditor` | Core `Select` | `SearchableSelect` (sync) | Columns of the selected entity; low urgency but consistent with candidate 2 since both selects sit side-by-side. |
| 4 | `PaginationToolbar.component.tsx` | `select` filter type rendering inside the filter popover | `RadioGroup` | `SearchableSelect` (sync) | Radio groups stop scaling visually beyond ~8 options. Current uses include the "Connector Instance" filter (`Entities.view.tsx`) and others. Replacing with a searchable select makes the filter usable as option counts grow. |

---

### Candidate 1 — `AdvancedFilterBuilder`: column field picker

**File:** `apps/web/src/components/AdvancedFilterBuilder.component.tsx`

**Current code (line ~280):**
```tsx
<FormControl size="small" sx={{ minWidth: 130 }}>
  <Select
    value={condition.field}
    onChange={(e) => handleFieldChange(e.target.value)}
    displayEmpty
  >
    {columnDefinitions.map((col) => (
      <MenuItem key={col.key} value={col.key}>{col.label}</MenuItem>
    ))}
  </Select>
</FormControl>
```

#### Checklist

- [ ] Replace `FormControl` + raw MUI `Select` + `MenuItem` with `SearchableSelect`
- [ ] Map `columnDefinitions` to `SelectOption[]` (`value: col.key`, `label: col.label`) — inline or memoised
- [ ] Change handler: `onChange={(value) => handleFieldChange(value ?? "")}` — `SearchableSelect` passes `string | null`, not a synthetic event
- [ ] Remove the `FormControl` wrapper (no longer needed)
- [ ] Remove the `Select` and `MenuItem` imports from `@mui/material` if no longer used elsewhere in the file
- [ ] Update `AdvancedFilterBuilder.test.tsx` / stories to reflect the new input behaviour (type into the field to filter column options)

#### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run lint` passes from repo root
- [ ] `npm run test` passes from repo root

---

### Candidate 2 & 3 — `ColumnMappingStep`: Reference Entity and Reference Column selects

**File:** `apps/web/src/workflows/CSVConnector/ColumnMappingStep.component.tsx`

**Current code (lines ~236–255):**
```tsx
<Select
  label="Reference Entity"
  value={currentEntityValue}
  onChange={handleEntityChange}  // expects e.target.value
  options={entityOptions}
  ...
/>
<Select
  label="Reference Column"
  value={currentColumnValue}
  onChange={handleColumnChange}  // expects e.target.value
  options={columnOptions}
  ...
/>
```

#### Checklist

- [ ] Replace both `Select` components in `ReferenceEditor` with `SearchableSelect`
- [ ] Update `handleEntityChange`: change signature from `(e: React.ChangeEvent<HTMLInputElement>) => void` to `(value: string | null) => void`; replace `e.target.value` references with `value ?? ""`
- [ ] Update `handleColumnChange`: same signature change; replace `e.target.value || null` with `value`
- [ ] The `placeholder` prop becomes `placeholder` on `SearchableSelect` (no functional change needed)
- [ ] The `disabled` prop passes through unchanged
- [ ] `fullWidth` passes through unchanged
- [ ] Update `ColumnMappingStep.test.tsx` to use `SearchableSelect` interaction pattern (type + select from dropdown) rather than `Select` change events
- [ ] Update `CSVConnectorWorkflow.stories.tsx` if stories exercise the reference editor

#### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run lint` passes from repo root
- [ ] `npm run test` passes from repo root

---

### Candidate 4 — `PaginationToolbar`: `select` filter type rendering

**File:** `apps/web/src/components/PaginationToolbar.component.tsx`

**Current code (line ~540–556):**
```tsx
{config.type === "select" && (
  <RadioGroup
    value={(filters[config.field] ?? [])[0] ?? ""}
    onChange={(e) => onFilterValueChange(config.field, e.target.value)}
  >
    {config.options.map((option) => (
      <FormControlLabel
        key={option.value}
        value={option.value}
        control={<Radio size="small" />}
        label={option.label}
      />
    ))}
  </RadioGroup>
)}
```

This currently renders a radio list — single-select, no search. It works for small fixed-enum filters (e.g. "Type" on ColumnDefinitionList which has 12 options) but breaks down for dynamic lists like connector instances.

#### Checklist

- [ ] Replace the `RadioGroup`/`FormControlLabel`/`Radio` block for `config.type === "select"` with a `SearchableSelect`
- [ ] Pass `options={config.options}`, `value={(filters[config.field] ?? [])[0] ?? null}` (convert empty string to null)
- [ ] `onChange={(value) => onFilterValueChange(config.field, value ?? "")}` — passing empty string clears the filter (matches existing `setFilterValue` contract which uses `""` to mean "clear")
- [ ] Set `size="small"` and `fullWidth`
- [ ] Remove `RadioGroup`, `Radio`, `FormControlLabel` imports from `PaginationToolbar.component.tsx` if no longer used (check `boolean` filter type still uses `Switch`/`FormControlLabel` before removing)
- [ ] The active filter chip for `select` type is already rendered correctly (uses `option?.label ?? values[0]`) — no change needed there
- [ ] Update `PaginationToolbar.test.tsx` to use `SearchableSelect` interaction instead of radio button clicks for `select` type filter tests
- [ ] Verify `ColumnDefinitionListView` (type filter), `Entities.view.tsx` (connector instance filter), and `ConnectorInstance.view.tsx` (status filter) all still work correctly

#### Verification

- [ ] `npm run type-check` passes from repo root
- [ ] `npm run lint` passes from repo root
- [ ] `npm run build` passes from repo root
- [ ] `npm run test` passes from repo root
