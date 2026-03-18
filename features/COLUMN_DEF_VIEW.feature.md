# Feature: Column Definition List & Detail Views

## Summary

Add two new views to the web app for browsing and inspecting Column Definitions:

1. **List View** (`/column-definitions`) — Paginated, filterable, sortable table of all column definitions for the user's organization. Displays key metadata (label, key, type, required, description, format, default value) with filters for `type` and `required`, sorting by key/label/type/created.

2. **Detail View** (`/column-definitions/$columnDefinitionId`) — Shows full metadata for a single column definition plus a paginated list of all field mappings that reference it across all connector entities. Each mapping row shows the source field, entity label/key, connector instance name, and primary key status.

Both views follow existing patterns: Breadcrumbs navigation, `usePagination` + `PaginationToolbar`, render-props data components (`DataList`/`DataItem`), `DataResult` for loading/error states, and card-based list items.

---

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `apps/web/src/api/column-definitions.api.ts` | SDK hooks: `list()` and `get()` using `useAuthQuery` |
| `apps/web/src/api/field-mappings.api.ts` | SDK hook: `list()` with `columnDefinitionId` filter |
| `apps/web/src/routes/column-definitions.tsx` | Parent route — wraps children in `Authorized` + `AuthorizedLayout` |
| `apps/web/src/routes/column-definitions.index.tsx` | List route — renders `ColumnDefinitionListView` |
| `apps/web/src/routes/column-definitions.$columnDefinitionId.tsx` | Detail route — renders `ColumnDefinitionDetailView` |
| `apps/web/src/views/ColumnDefinitionList.view.tsx` | List view component |
| `apps/web/src/views/ColumnDefinitionDetail.view.tsx` | Detail view component |
| `apps/web/src/components/ColumnDefinition.component.tsx` | Data wrapper components (`ColumnDefinitionDataList`, `ColumnDefinitionDataItem`) and `ColumnDefinitionCardUI` |
| `apps/web/src/components/FieldMapping.component.tsx` | Data wrapper `FieldMappingDataList` for detail view |

### Modified Files

| File | Change |
|------|--------|
| `apps/web/src/api/sdk.ts` | Add `columnDefinitions` and `fieldMappings` to SDK |
| `apps/web/src/api/keys.ts` | Add `columnDefinitions` and `fieldMappings` query key entries |
| `apps/web/src/utils/routes.util.ts` | Add `ColumnDefinitions` and `ColumnDefinition` to `ApplicationRoute` enum |

### No API Changes Required

The existing API already supports everything needed:
- `GET /api/column-definitions` — paginated list with `type` and `required` filters
- `GET /api/column-definitions/:id` — single definition
- `GET /api/field-mappings?columnDefinitionId=X` — field mappings filtered by column definition

---

## Component Details

### ColumnDefinitionCardUI

Card displaying a single column definition in the list view:
- **Header row**: Label (title), Type chip (colored by data type), Required badge (if true)
- **Detail row**: Key (monospace), description (if present)
- **Metadata row**: Format, default value, enum values (if applicable)
- **Click**: Navigates to detail view

### ColumnDefinitionDetailView

Two sections:
1. **Metadata section**: All fields of the column definition displayed in a structured layout
2. **Mappings section**: Paginated table of field mappings referencing this column definition, showing source field, entity info, and primary key indicator. Uses the existing `GET /api/field-mappings?columnDefinitionId=X` endpoint.

### Navigation

- Sidebar: Add "Column Definitions" nav item
- Breadcrumbs: Dashboard > Column Definitions > {label}

---

## Implementation Checklist

### Phase 1: SDK & Routing Infrastructure
- [ ] Add `columnDefinitions` query keys to `apps/web/src/api/keys.ts`
- [ ] Add `fieldMappings` query keys to `apps/web/src/api/keys.ts`
- [ ] Create `apps/web/src/api/column-definitions.api.ts` with `list()` and `get()` hooks
- [ ] Create `apps/web/src/api/field-mappings.api.ts` with `list()` hook
- [ ] Register both in `apps/web/src/api/sdk.ts`
- [ ] Add `ColumnDefinitions` and `ColumnDefinition` to `ApplicationRoute` enum

### Phase 2: Routes
- [ ] Create `apps/web/src/routes/column-definitions.tsx` (parent route with auth guard)
- [ ] Create `apps/web/src/routes/column-definitions.index.tsx` (list route)
- [ ] Create `apps/web/src/routes/column-definitions.$columnDefinitionId.tsx` (detail route)

### Phase 3: Data Components
- [ ] Create `apps/web/src/components/ColumnDefinition.component.tsx`
  - [ ] `ColumnDefinitionDataList` — render-prop wrapper for paginated list
  - [ ] `ColumnDefinitionDataItem` — render-prop wrapper for single item
  - [ ] `ColumnDefinitionCardUI` — card component for list items
- [ ] Create `apps/web/src/components/FieldMapping.component.tsx`
  - [ ] `FieldMappingDataList` — render-prop wrapper for filtered field mappings list

### Phase 4: Views
- [ ] Create `apps/web/src/views/ColumnDefinitionList.view.tsx`
  - [ ] Breadcrumbs (Dashboard > Column Definitions)
  - [ ] `usePagination` with sort fields: key, label, type, created
  - [ ] Filters: type (select from ColumnDataType enum), required (boolean)
  - [ ] `PaginationToolbar` + `ColumnDefinitionDataList` + `DataResult` + `SyncTotal`
  - [ ] Map results to `ColumnDefinitionCardUI` cards with click-to-navigate
  - [ ] Empty state when no results
- [ ] Create `apps/web/src/views/ColumnDefinitionDetail.view.tsx`
  - [ ] Breadcrumbs (Dashboard > Column Definitions > {label})
  - [ ] Metadata section showing all column definition fields
  - [ ] Field mappings section with `usePagination` + `FieldMappingDataList`
  - [ ] Table showing source field, entity key/label, connector instance, isPrimaryKey

### Phase 5: Navigation
- [ ] Add "Column Definitions" link to sidebar navigation

### Phase 6: Frontend Unit Tests
- [ ] Create `apps/web/src/__tests__/ColumnDefinitionListView.test.tsx`
  - [ ] Test loading state renders correctly
  - [ ] Test list renders column definition cards with mock data
  - [ ] Test empty state when no results
  - [ ] Test error state rendering
  - [ ] Test filter by type updates list
  - [ ] Test filter by required updates list
  - [ ] Test sort field changes
  - [ ] Test card click navigates to detail route
- [ ] Create `apps/web/src/__tests__/ColumnDefinitionDetailView.test.tsx`
  - [ ] Test loading state renders correctly
  - [ ] Test metadata section displays all column definition fields
  - [ ] Test field mappings table renders with mock data
  - [ ] Test empty state when no field mappings exist
  - [ ] Test error state for invalid column definition ID
  - [ ] Test breadcrumbs display correct label
- [ ] Create `apps/web/src/__tests__/ColumnDefinition.component.test.tsx`
  - [ ] Test `ColumnDefinitionCardUI` renders label, type chip, required badge
  - [ ] Test `ColumnDefinitionCardUI` hides required badge when not required
  - [ ] Test `ColumnDefinitionCardUI` renders key in monospace, description, metadata
  - [ ] Test `ColumnDefinitionDataList` passes paginated data to render prop
  - [ ] Test `ColumnDefinitionDataItem` passes single item to render prop
- [ ] Create `apps/web/src/__tests__/FieldMapping.component.test.tsx`
  - [ ] Test `FieldMappingDataList` passes filtered data to render prop
  - [ ] Test renders source field, entity info, connector instance, primary key indicator

### Phase 7: Backend Integration Tests
- [ ] Verify existing `apps/api/src/__tests__/__integration__/routes/column-definition.router.integration.test.ts` covers list with `type` and `required` filters
- [ ] Verify existing `apps/api/src/__tests__/__integration__/routes/field-mapping.router.integration.test.ts` covers filtering by `columnDefinitionId`
- [ ] Add test for `GET /api/field-mappings?columnDefinitionId=X` returns mappings with entity and connector instance details (if not already covered)

---

## Verification Steps

1. **Type-check**: Run `npm run type-check` from root — no new errors
2. **Lint**: Run `npm run lint` from root — no new warnings/errors
3. **Build**: Run `npm run build` — all packages compile successfully
4. **Route generation**: Verify TanStack Router auto-generates routes for the new files (check `routeTree.gen.ts`)
5. **Manual smoke test** (with `npm run dev`):
   - Navigate to `/column-definitions` — list loads with pagination controls
   - Filter by type and required — list updates correctly
   - Sort by each field — order changes
   - Click a card — navigates to `/column-definitions/{id}`
   - Detail page shows all metadata fields
   - Detail page shows field mappings table (or empty state if none)
   - Breadcrumbs work for navigation back
   - Sidebar link is highlighted on column definitions pages
6. **Empty states**: Verify list shows empty message when no column definitions exist
7. **Error states**: Verify error UI renders if API returns an error (e.g., invalid ID on detail page)
