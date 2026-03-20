# Entity Record Detail Feature

## Overview

Allow users to click a row in the entity records list (`/entities/:entityId`) and navigate to a record detail page (`/entities/:entityId/records/:recordId`). The detail page shows all record metadata and all fields formatted by column type. JSON and array column types render as `<code>` blocks in both the list (truncated) and detail page (full).

---

## Phase 1 — Backend: Record Get Endpoint (`apps/api`)

Add a single-record fetch endpoint to the existing entity-record router.

### Checklist

- [x] Add `ENTITY_RECORD_NOT_FOUND` to `ApiCode` enum in `src/constants/api-codes.constants.ts`
- [x] Add `EntityRecordGetResponsePayloadSchema` and `EntityRecordGetResponsePayload` type to `packages/core/src/contracts/entity-record.contract.ts`
  - Shape: `{ record: EntityRecord, columns: ColumnDefinitionSummary[] }`
  - Export from `packages/core/src/index.ts`
- [x] Add `GET /:recordId` handler to `apps/api/src/routes/entity-record.router.ts`
  - Resolve connector entity via `resolveEntityOrThrow` (already exists)
  - Fetch record by `recordId` via `DbService.repository.entityRecords.findById(recordId)`
  - Guard: record must exist and belong to `connectorEntityId`, otherwise 404 `ENTITY_RECORD_NOT_FOUND`
  - Resolve column definitions via `resolveColumns(connectorEntityId)` (already exists)
  - Return `{ record, columns }`
- [x] Integration test: `GET /api/connector-entities/:connectorEntityId/records/:recordId`
  - 200 with correct record and columns
  - 404 when record does not exist
  - 404 when record belongs to a different entity
- [ ] `npm run type-check` passes _(pre-existing failures in `apps/web` test fixtures unrelated to Phase 1)_
- [x] `npm run lint` passes
- [x] `npm run test` passes (332 tests, all passing)
- [ ] `npm run build` passes _(same pre-existing `apps/web` TS errors)_

### Files

| Action | File |
|--------|------|
| Modify | `packages/core/src/contracts/entity-record.contract.ts` |
| Modify | `packages/core/src/index.ts` |
| Modify | `apps/api/src/constants/api-codes.constants.ts` |
| Modify | `apps/api/src/routes/entity-record.router.ts` |
| Modify | `apps/api/src/__tests__/__integration__/routes/entity-record.router.integration.test.ts` |

---

## Phase 2 — Core: DataTable Row & Cell Click Handlers (`packages/core`)

Extend `DataTable` to support optional row and cell click callbacks. Cell clicks take priority — they stop propagation so the row handler does not fire.

### Checklist

- [ ] Add to `DataTableProps` in `packages/core/src/ui/DataTable.tsx`:
  - `onRowClick?: (row: Record<string, unknown>, index: number) => void`
  - `onCellClick?: (value: unknown, column: DataTableColumn, row: Record<string, unknown>) => void`
- [ ] In `<TableRow>`: when `onRowClick` is set, attach `onClick` handler and `sx={{ cursor: "pointer" }}` style
- [ ] In `<TableCell>`: when `onCellClick` is set, attach `onClick` that calls `e.stopPropagation()` then `onCellClick(value, col, row)` — preventing the row handler from firing
- [ ] Unit tests in `packages/core/src/__tests__/ui/DataTable.test.tsx`:
  - `onRowClick` fires with correct row and index on row click
  - `onCellClick` fires with correct value, column, and row on cell click
  - Clicking a cell with both handlers set: only `onCellClick` fires (row handler suppressed)
- [ ] Storybook story in `packages/core/src/stories/DataTable.stories.tsx` showing clickable rows with `onRowClick` and a separate story for `onCellClick`
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes
- [ ] `npm run build` passes

### Files

| Action | File |
|--------|------|
| Modify | `packages/core/src/ui/DataTable.tsx` |
| Modify | `packages/core/src/__tests__/ui/DataTable.test.tsx` |
| Create | `packages/core/src/stories/DataTable.stories.tsx` |

---

## Phase 3 — Frontend: JSON/Array Cell Rendering + DataTable Wiring (`apps/web`)

Add `<code>` block rendering for `json` and `array` column types in the entity records table (truncated in the list view). Wire `onRowClick` through `EntityRecordDataTableUI` → `DataTable`.

### Checklist

#### `EntityRecordCellCode` component
- [ ] Create `apps/web/src/components/EntityRecordCellCode.component.tsx`
  - Props: `value: unknown`, `type: "json" | "array"`, `maxLength?: number` (default: 80)
  - Serialise: `JSON.stringify(value, null, 0)` for `json`, `JSON.stringify(value)` for `array`
  - If serialised string exceeds `maxLength`, truncate and append `…`
  - Render as `<code>` inside a `<Box component="code">` with monospace font, muted background, and `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 320px`
  - Tooltip showing full serialised value when truncated
- [ ] Unit tests in `apps/web/src/__tests__/EntityRecordCellCode.test.tsx`:
  - Renders JSON object as inline code
  - Renders array as inline code
  - Truncates long values and shows tooltip
  - Does not show tooltip when value is short
- [ ] Storybook story in `apps/web/src/stories/EntityRecordCellCode.component.stories.tsx`

#### `EntityRecordDataTableUI` updates
- [ ] In `toDataTableColumns` helper in `EntityRecordDataTable.component.tsx`:
  - For `col.type === "json"` or `col.type === "array"`, set `render: (value) => <EntityRecordCellCode value={value} type={col.type} />` instead of `format`
  - All other types continue using `format: (value) => Formatter.format(value, col.type)`
- [ ] Add `onRowClick?: (row: Record<string, unknown>) => void` to `EntityRecordDataTableUIProps`
- [ ] Pass `onRowClick` down to `<DataTable>`
- [ ] Unit tests in existing `EntityRecordDataTable` test file:
  - `json` column renders a `<code>` element
  - `array` column renders a `<code>` element
  - `onRowClick` fires when a row is clicked
- [ ] Update `apps/web/src/stories/` (or create if missing) Storybook story for `EntityRecordDataTableUI` with `onRowClick`
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes

### Files

| Action | File |
|--------|------|
| Create | `apps/web/src/components/EntityRecordCellCode.component.tsx` |
| Create | `apps/web/src/__tests__/EntityRecordCellCode.test.tsx` |
| Create | `apps/web/src/stories/EntityRecordCellCode.component.stories.tsx` |
| Modify | `apps/web/src/components/EntityRecordDataTable.component.tsx` |
| Modify | `apps/web/src/__tests__/EntityRecordDataTable.test.tsx` (or create) |

---

## Phase 4 — Frontend: API SDK + Routing (`apps/web`)

Add the `get` query to the entity-records API module and register the new nested route.

### Checklist

- [ ] Add `get(connectorEntityId, recordId, options?)` to `apps/web/src/api/entity-records.api.ts`
  - URL: `/api/connector-entities/:connectorEntityId/records/:recordId`
  - Uses `useAuthQuery` with `queryKeys.entityRecords.get(connectorEntityId, recordId)`
  - Returns `EntityRecordGetResponsePayload`
- [ ] Add `get` query key to `queryKeys.entityRecords` in `apps/web/src/api/keys.ts`
- [ ] Add `EntityRecord = "/entities/$entityId/records/$recordId"` to `ApplicationRoute` enum in `apps/web/src/utils/routes.util.ts`
- [ ] Create route file `apps/web/src/routes/entities.$entityId.records.$recordId.tsx`
  - `createFileRoute("/entities/$entityId/records/$recordId")`
  - Reads `entityId` and `recordId` from params
  - Renders `<EntityRecordDetailView entityId={entityId} recordId={recordId} />`
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` passes

### Files

| Action | File |
|--------|------|
| Modify | `apps/web/src/api/entity-records.api.ts` |
| Modify | `apps/web/src/api/keys.ts` |
| Modify | `apps/web/src/utils/routes.util.ts` |
| Create | `apps/web/src/routes/entities.$entityId.records.$recordId.tsx` |

---

## Phase 5 — Frontend: Entity Detail View — Wire Row Click (`apps/web`)

Wire `onRowClick` through `EntityDetailViewUI` so clicking a row navigates to the record detail page. Each row in the records list has the full `EntityRecord` including its `id`.

### Checklist

- [ ] In `EntityDetailView.view.tsx`:
  - The rows currently passed to `EntityRecordDataTableUI` are derived from `r.normalizedData`. The full record `id` is needed for navigation but is not in `normalizedData`.
  - Pass the full records array alongside the rows, or pass a separate `recordIds` array derived as `records.records.map((r) => r.id)`.
  - Add `onRowClick` to `EntityDetailViewUI` props:
    - `onRowClick: (rowIndex: number) => void` (the view maps index → recordId)
  - Add `onRowClick` to `EntityRecordDataTableUIProps` and wire through to `<DataTable onRowClick>`, mapping `(_, index) => props.onRowClick?.(index)`
  - In the container `EntityDetailView`, derive `recordIds` from `records.records.map(r => r.id)` and pass `onRowClick={(idx) => navigate({ to: ApplicationRoute.EntityRecord, params: { entityId, recordId: recordIds[idx] } })}` to `EntityDetailViewUI`
- [ ] Unit tests in `apps/web/src/__tests__/EntityDetail.view.test.tsx` (or create):
  - Clicking a row calls `navigate` with the correct `entityId` and `recordId`
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes

### Files

| Action | File |
|--------|------|
| Modify | `apps/web/src/views/EntityDetail.view.tsx` |
| Modify | `apps/web/src/components/EntityRecordDataTable.component.tsx` |
| Create / Modify | `apps/web/src/__tests__/EntityDetailView.test.tsx` |

---

## Phase 6 — Frontend: Record Detail View (`apps/web`)

Build the `EntityRecordDetailView` — a container + pure UI component that shows all metadata and all fields for a single record.

### Checklist

#### `EntityRecordFieldValue` component
- [ ] Create `apps/web/src/components/EntityRecordFieldValue.component.tsx`
  - Props: `value: unknown`, `type: ColumnDataType`
  - For `json`: render pretty-printed `JSON.stringify(value, null, 2)` inside a `<Box component="pre">` code block (full, no truncation)
  - For `array`: render `JSON.stringify(value, null, 2)` inside a `<Box component="pre">` code block
  - For all other types: render `Formatter.format(value, type)` as `<Typography>`
  - Null/undefined: render `"—"` as muted text
- [ ] Unit tests:
  - Each type renders correctly
  - Null renders dash
- [ ] Storybook story with all column types

#### `EntityRecordMetadata` component
- [ ] Create `apps/web/src/components/EntityRecordMetadata.component.tsx`
  - Props: `record: EntityRecord`
  - Displays: `id`, `sourceId`, `checksum`, `syncedAt` (formatted datetime), `created` (formatted datetime), `updated` (formatted datetime or "—"), `connectorEntityId`
  - Uses a definition-list-style layout (label + value rows) using MUI `Stack`/`Typography`
  - Monospace font for ID/checksum values
- [ ] Unit tests: renders all fields
- [ ] Storybook story

#### `EntityRecordDetailView` (container + pure UI)
- [ ] Create `apps/web/src/views/EntityRecordDetail.view.tsx`
  - `EntityRecordDetailViewUIProps`:
    - `entity: ConnectorEntity`
    - `record: EntityRecord`
    - `columns: ColumnDefinitionSummary[]`
  - `EntityRecordDetailViewUI`:
    - Breadcrumbs: Dashboard → Entities → `{entity.label}` → Record `{record.sourceId}`
    - Section 1 "Metadata": renders `<EntityRecordMetadata record={record} />`
    - Section 2 "Fields": renders a two-column grid (label | value) for each column definition, showing `<EntityRecordFieldValue value={record.normalizedData[col.key]} type={col.type} />`; columns not present in `normalizedData` are shown as `"—"`
    - Uses `<Stack>` and `<Box>` from `@portalai/core/ui`
  - `EntityRecordDetailView` container:
    - Accepts `{ entityId, recordId }`
    - Calls `sdk.connectorEntities.get(entityId)` and `sdk.entityRecords.get(entityId, recordId)` in parallel
    - Uses `<DataResult>` for loading / error states
    - Renders `EntityRecordDetailViewUI` once both resolve
- [ ] Unit tests for `EntityRecordDetailViewUI`:
  - Renders entity label in breadcrumbs
  - Renders `sourceId` in breadcrumbs
  - Renders all metadata fields
  - Renders all field values formatted by type
  - JSON fields render as `<pre>` code blocks
  - Array fields render as `<pre>` code blocks
- [ ] Storybook story with multiple column types including `json` and `array`
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run test` passes

### Files

| Action | File |
|--------|------|
| Create | `apps/web/src/components/EntityRecordFieldValue.component.tsx` |
| Create | `apps/web/src/__tests__/EntityRecordFieldValue.test.tsx` |
| Create | `apps/web/src/stories/EntityRecordFieldValue.component.stories.tsx` |
| Create | `apps/web/src/components/EntityRecordMetadata.component.tsx` |
| Create | `apps/web/src/__tests__/EntityRecordMetadata.test.tsx` |
| Create | `apps/web/src/stories/EntityRecordMetadata.component.stories.tsx` |
| Create | `apps/web/src/views/EntityRecordDetail.view.tsx` |
| Create | `apps/web/src/__tests__/EntityRecordDetailView.test.tsx` |
| Create | `apps/web/src/stories/EntityRecordDetailView.stories.tsx` |

---

## File Change Summary

| File | Action | Phase |
|------|--------|-------|
| `packages/core/src/contracts/entity-record.contract.ts` | Modify | 1 |
| `packages/core/src/index.ts` | Modify | 1 |
| `apps/api/src/constants/api-codes.constants.ts` | Modify | 1 |
| `apps/api/src/routes/entity-record.router.ts` | Modify | 1 |
| `apps/api/src/__tests__/__integration__/routes/entity-record.router.integration.test.ts` | Modify | 1 |
| `packages/core/src/ui/DataTable.tsx` | Modify | 2 |
| `packages/core/src/__tests__/ui/DataTable.test.tsx` | Modify | 2 |
| `packages/core/src/stories/DataTable.stories.tsx` | Create | 2 |
| `apps/web/src/components/EntityRecordCellCode.component.tsx` | Create | 3 |
| `apps/web/src/__tests__/EntityRecordCellCode.test.tsx` | Create | 3 |
| `apps/web/src/stories/EntityRecordCellCode.component.stories.tsx` | Create | 3 |
| `apps/web/src/components/EntityRecordDataTable.component.tsx` | Modify | 3, 5 |
| `apps/web/src/__tests__/EntityRecordDataTable.test.tsx` | Create / Modify | 3, 5 |
| `apps/web/src/api/entity-records.api.ts` | Modify | 4 |
| `apps/web/src/api/keys.ts` | Modify | 4 |
| `apps/web/src/utils/routes.util.ts` | Modify | 4 |
| `apps/web/src/routes/entities.$entityId.records.$recordId.tsx` | Create | 4 |
| `apps/web/src/views/EntityDetail.view.tsx` | Modify | 5 |
| `apps/web/src/__tests__/EntityDetailView.test.tsx` | Create / Modify | 5 |
| `apps/web/src/components/EntityRecordFieldValue.component.tsx` | Create | 6 |
| `apps/web/src/__tests__/EntityRecordFieldValue.test.tsx` | Create | 6 |
| `apps/web/src/stories/EntityRecordFieldValue.component.stories.tsx` | Create | 6 |
| `apps/web/src/components/EntityRecordMetadata.component.tsx` | Create | 6 |
| `apps/web/src/__tests__/EntityRecordMetadata.test.tsx` | Create | 6 |
| `apps/web/src/stories/EntityRecordMetadata.component.stories.tsx` | Create | 6 |
| `apps/web/src/views/EntityRecordDetail.view.tsx` | Create | 6 |
| `apps/web/src/__tests__/EntityRecordDetailView.test.tsx` | Create | 6 |
| `apps/web/src/stories/EntityRecordDetailView.stories.tsx` | Create | 6 |

---

## Verification (each phase)

Each phase is complete when **all** of the following pass with no errors:

```bash
npm run type-check   # TypeScript validation across monorepo
npm run lint         # ESLint across monorepo
npm run test         # Jest unit + integration tests
npm run build        # Full monorepo build
```
