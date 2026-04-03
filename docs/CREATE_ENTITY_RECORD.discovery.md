# Create Entity Record — Discovery

## Overview

This document captures the existing infrastructure, gaps, and design decisions for enabling users to create individual entity records from the EntityDetail view's records table, gated by the connector's write capability flag.

### Goals

1. **Create Entity Record dialog** — a new dialog that dynamically generates form fields from the connector entity's field mappings. Each field mapping resolves to a column definition whose `type` determines the input widget (text, number, checkbox, date picker, enum select, JSON editor, etc.).

2. **Type-aware DynamicRecordField component** — a shared component used by both the create and edit dialogs that renders the correct widget per column type, serializes values appropriately on submit (e.g., numbers parsed from strings, booleans from checkboxes, JSON from parsed text), and validates inline where applicable.

3. **Code-editor-style JSON/Array fields** — `json` and `array` column types render as monospace, auto-formatting multiline inputs with parse validation on blur and descriptive error messages. No external editor library; styled via the existing `Cutive Mono` theme typography.

4. **ColumnDefinitionSummary enrichment** — extend the summary contract with `required`, `enumValues`, and `defaultValue` so the form can enforce required fields, render enum dropdowns, and pre-fill defaults on create.

5. **Upgrade EditEntityRecordDialog** — replace its current plain-text-for-everything rendering with the same shared `DynamicRecordField` component, bringing type-aware inputs and validation to edit as well.

---

## Existing Infrastructure

### Write Capability Resolution

Write capability is already resolved at three levels and used consistently:

| Layer | File | Mechanism |
|-------|------|-----------|
| Definition ceiling | `packages/core/src/models/connector-definition.model.ts` | `capabilityFlags.write` |
| Instance override | `packages/core/src/models/connector-instance.model.ts` | `enabledCapabilityFlags.write` |
| API enforcement | `apps/api/src/utils/resolve-capabilities.util.ts` | `assertWriteCapability(connectorEntityId)` |
| Frontend resolution | `apps/web/src/views/EntityDetail.view.tsx` (line 545) | `definition.capabilityFlags.write && (instance.enabledCapabilityFlags.write ?? true)` |

**Edit and delete record operations are already gated by `isWriteEnabled`** in both:
- `EntityDetail.view.tsx` — entity-level edit/delete in `secondaryActions` (lines 256-261)
- `EntityRecordDetail.view.tsx` — record-level edit/delete in `secondaryActions` (lines 253-258)

No changes needed for existing edit/delete gating.

### Entity Record Data Model

**Schema** (`packages/core/src/models/entity-record.model.ts`):
```
organizationId, connectorEntityId, data, normalizedData, sourceId, checksum, syncedAt
```

- `data: Record<string, unknown>` — raw source data (keyed by source field names)
- `normalizedData: Record<string, unknown>` — column-mapped data (keyed by column definition keys; displayed in tables)
- `sourceId: string` — unique per entity, composite key: `(connectorEntityId, sourceId) WHERE deleted IS NULL`
- `checksum: string` — change detection during sync
- `syncedAt: number` — timestamp of last sync

#### Normalization: who builds `data` vs `normalizedData`?

Normalization means mapping source field names → column definition keys using field mappings. **Where** this happens depends on the flow:

| Flow | Who normalizes | `data` | `normalizedData` |
|------|---------------|--------|-------------------|
| **CSV import** | Server (`CsvImportService`) | Raw CSV row keyed by header names | Mapped via `sourceField → columnDef.key` using field mappings |
| **Sync** | Server (adapter) | Raw source payload | Mapped via field mappings |
| **Manual edit** | Frontend (dialog) | Not updated | Submitted directly keyed by `col.key` — already normalized |
| **Manual create** | Frontend (dialog) | Server mirrors from `normalizedData` | Submitted directly keyed by `col.key` — already normalized |

For automated flows (import/sync), the server has raw source data and field mappings, so it performs the `sourceField → columnDef.key` mapping. For manual flows, the dialog already renders fields keyed by column definition keys — the user is editing normalized values directly, so no server-side transformation is needed. The server just mirrors `normalizedData` into `data` for consistency.

### Entity Record API Endpoints

**File:** `apps/api/src/routes/entity-record.router.ts`

| Method | Path | Purpose | Write-gated |
|--------|------|---------|-------------|
| GET | `/` | List records (paginated, filtered, sorted) | No |
| GET | `/count` | Record count | No |
| GET | `/:recordId` | Single record with columns | No |
| POST | `/import` | Bulk upsert by sourceId | Yes |
| POST | `/sync` | Trigger connector sync | Yes |
| PATCH | `/:recordId` | Update single record | Yes |
| DELETE | `/:recordId` | Soft-delete single record | Yes |
| DELETE | `/` | Soft-delete all records | Yes |

### Entity Record Contracts

**File:** `packages/core/src/contracts/entity-record.contract.ts`

Existing schemas:
- `EntityRecordImportRowSchema`: `{ data, normalizedData, sourceId, checksum }`
- `EntityRecordPatchRequestBodySchema`: `{ data?, normalizedData? }`
- `EntityRecordImportRequestBodySchema`: `{ records: EntityRecordImportRowSchema[] }`
- Response payloads for list, count, get, import, sync, patch, delete

### Frontend SDK

**File:** `apps/web/src/api/entity-records.api.ts`

Available methods: `list`, `count`, `get`, `import`, `sync`, `update`, `delete`, `clear`

### Repository

**File:** `apps/api/src/db/repositories/entity-records.repository.ts`

Key methods:
- `create(data)` — base class single insert
- `upsertBySourceId(data)` — insert or update by composite key
- `upsertManyBySourceId(data)` — bulk upsert
- `findByConnectorEntityId()` — paginated list
- `softDeleteByConnectorEntityId()` — cascade soft-delete

### Column Definitions & Field Mappings

Field mappings (`packages/core/src/models/field-mapping.model.ts`) define how source fields map to column definitions. The API resolves columns via `resolveColumns(connectorEntityId)` in the entity record router.

Column types (`ColumnDataType`): `string`, `number`, `date`, `datetime`, `boolean`, `currency`, `json`, `array`, `enum`, `reference`, `reference-array`

#### How field mappings drive record form fields

Field mappings **are** the property schema for entity records. The relationship:

```
Connector Entity
  └─ Field Mappings (1:N)
       └─ Column Definition (1:1) → { key, label, type, required, enumValues, defaultValue }
```

When creating or editing a record, the dialog:
1. Receives `columns: ColumnDefinitionSummary[]` (already resolved from field mappings → column definitions)
2. Renders one form field per column, with the input widget determined by `col.type`
3. Submits `normalizedData` keyed by `col.key` — the server mirrors this into `data`

No additional API call is needed — columns are already returned in the records list/detail response and available in `EntityDetailViewUI` state.

#### `ColumnDefinitionSummary` enrichment

The current `ColumnDefinitionSummary` only carries `{ key, label, type }`. To render proper form widgets, it must be enriched with:

| Field | Source | Purpose |
|-------|--------|---------|
| `required` | `column_definitions.required` | Mark fields as required, validate on submit |
| `enumValues` | `column_definitions.enum_values` | Populate `<Select>` options for `enum` type |
| `defaultValue` | `column_definitions.default_value` | Pre-fill on create |

These fields already exist on the `ColumnDefinition` model and Drizzle table — they just need to be added to the summary schema and the `resolveColumns()` helper.

#### Type-aware field input mapping

Both the create and edit dialogs should render type-appropriate widgets via a shared `DynamicRecordField` component:

| `ColumnDataType` | Widget | Behavior |
|-------------------|--------|----------|
| `string` | `<TextField>` | Standard single-line text input |
| `number` | `<TextField type="number">` | Numeric input with step; parse to number on submit |
| `currency` | `<TextField type="number">` | Numeric input (same as number, format hint in label) |
| `boolean` | `<FormControlLabel>` + `<Checkbox>` | Checked = `true`, unchecked = `false`; no null state |
| `date` | `<TextField type="date">` | Native date picker; ISO string value |
| `datetime` | `<TextField type="datetime-local">` | Native datetime picker; ISO string value |
| `enum` | `<TextField select>` + `<MenuItem>` | Dropdown from `col.enumValues`; falls back to text if none |
| `json` | `<TextField multiline>` code-editor style | JSON object editor; monospace font, line numbers gutter, dark surface, auto-resize; validate with `JSON.parse` on blur/submit |
| `array` | `<TextField multiline>` code-editor style | JSON array editor; same styling as `json`; validate as `JSON.parse` + `Array.isArray` on blur/submit |
| `reference` | `<TextField>` | Text input for referenced record ID (searchable select as future enhancement) |
| `reference-array` | `<TextField multiline rows={2}>` | Comma-separated IDs (searchable multi-select as future enhancement) |

#### JSON/Array code-editor field styling

`json` and `array` fields should feel like a lightweight code editor, not a plain textarea. Achieved with a styled MUI `<TextField multiline>` — no external editor library needed.

| Aspect | Implementation |
|--------|---------------|
| Font | `theme.typography.monospace.fontFamily` (`'Cutive Mono', 'Courier New', monospace`) at `0.875rem` |
| Background | Slightly recessed surface — `theme.palette.action.hover` over the input area |
| Line numbers | CSS `counter-reset`/`counter-increment` on line breaks, rendered via a `::before` pseudo-element gutter, or a lightweight overlay `<Box>` beside the textarea |
| Min height | 4 rows default, auto-expands with content |
| Border | Standard `<TextField>` outlined variant; error state on invalid JSON |
| Validation feedback | On blur: parse with `JSON.parse`; if invalid, set `error` + `helperText` showing the parse error message (e.g., "Unexpected token at position 12") |
| Pretty-print | On blur (if valid): replace value with `JSON.stringify(parsed, null, 2)` for consistent formatting |
| Empty state | Placeholder text: `{}` for json, `[]` for array |

No syntax highlighting is needed — the monospace font, dark surface, and auto-formatting provide enough of a code-editor feel. If richer editing is needed later, this can be swapped for CodeMirror without changing the component interface.

#### Value serialization on submit

| Type | Empty → | Non-empty → |
|------|---------|-------------|
| `string`, `date`, `datetime`, `reference` | `null` | String value as-is |
| `number`, `currency` | `null` | `Number(value)` |
| `boolean` | `false` | Boolean value as-is |
| `enum` | `null` | String value as-is |
| `json` | `null` | `JSON.parse(value)` (validated) |
| `array` | `null` | `JSON.parse(value)` (validated as array) |
| `reference-array` | `null` | Split by comma, trim, filter empty → `string[]` |

The `EditEntityRecordDialog` currently treats all fields as strings. Both create and edit dialogs should use this shared serialization logic.

### API Error Codes

**File:** `apps/api/src/constants/api-codes.constants.ts`

Existing entity record codes (lines 92-99):
```
ENTITY_RECORD_NOT_FOUND, ENTITY_RECORD_FETCH_FAILED, ENTITY_RECORD_IMPORT_FAILED,
ENTITY_RECORD_INVALID_PAYLOAD, ENTITY_RECORD_INVALID_FILTER,
ENTITY_RECORD_DELETE_FAILED, ENTITY_RECORD_UPDATE_FAILED, ENTITY_RECORD_SYNC_FAILED
```

### PageSection Component

**File:** `packages/core/src/ui/PageSection.tsx`

Supports `primaryAction?: React.ReactNode` prop — ideal for placing a "New Record" button in the Records section header.

### Reference Dialog Implementations

| Dialog | File | Pattern |
|--------|------|---------|
| EditEntityRecordDialog | `apps/web/src/components/EditEntityRecordDialog.component.tsx` | Inner form + outer guard; column-based fields; no client-side validation |
| CreateConnectorEntityDialog | `apps/web/src/components/CreateConnectorEntityDialog.component.tsx` | Full Zod validation, touched/errors state, AsyncSearchableSelect |
| DeleteEntityRecordDialog | `apps/web/src/components/DeleteEntityRecordDialog.component.tsx` | Confirmation dialog with FormAlert |

---

## Gaps

### 1. No POST endpoint for single record creation

The API only supports bulk import (`POST /import`) and sync (`POST /sync`). There is no `POST /` endpoint to create a single entity record. The repository's base `create()` method exists but isn't exposed via a route.

### 2. No create contract schema

No `EntityRecordCreateRequestBodySchema` or `EntityRecordCreateResponsePayloadSchema` exist in the contracts.

### 3. No frontend SDK `create` method

The `entityRecords` SDK object has no `create` method.

### 4. No CreateEntityRecordDialog component

No dialog exists for creating a single record. The closest reference is `EditEntityRecordDialog` which renders fields from `ColumnDefinitionSummary[]`.

### 5. No "New Record" button in EntityDetail view

The Records `<PageSection>` has no `primaryAction` button for record creation.

### 6. EditEntityRecordDialog renders all fields as plain text inputs

The current edit dialog (`EditEntityRecordDialog.component.tsx`) treats every column type as a `<TextField>`, only differentiating `json`/`array` with `multiline`. It does not render checkboxes for booleans, number inputs for numbers, date pickers for dates, selects for enums, or validate JSON structure. This should be upgraded alongside the create dialog via a shared `DynamicRecordField` component.

### 7. ColumnDefinitionSummary lacks metadata for form rendering

`ColumnDefinitionSummarySchema` currently only has `{ key, label, type }`. The `required`, `enumValues`, and `defaultValue` fields are needed for proper form rendering but are not included in the summary or returned by `resolveColumns()`.

---

## Design Decisions

### sourceId handling
- **Decision**: Optional in the request body; server generates `crypto.randomUUID()` when omitted
- **Rationale**: `sourceId` is a business key used by import/sync flows. For manually created records, auto-generation is the common case, but power users may want to specify a meaningful ID.

### data vs normalizedData
- **Decision**: Server mirrors `normalizedData` into `data` for manually created records
- **Rationale**: `data` represents raw source data, but manually created records have no external source. Mirroring keeps the data model consistent without requiring the user to provide redundant input.

### checksum
- **Decision**: Set to `"manual"` server-side
- **Rationale**: Checksum is used for change detection during sync. Manually created records don't participate in sync-based change detection.

### syncedAt
- **Decision**: Set to `Date.now()` server-side
- **Rationale**: Represents the timestamp when the record's data was last synchronized. For manual creation, the creation time is the logical equivalent.

### Client-side validation
- **Decision**: Type-aware validation for `json` and `array` fields (validate with `JSON.parse`); `required` field enforcement; no Zod schema for the overall form
- **Rationale**: JSON/array fields need parse validation to avoid submitting malformed data. Required fields should block submission. Full Zod validation is unnecessary since the field set is dynamic and the API validates structure.

### Column source for the dialog
- **Decision**: Use `columnDefs` state already maintained in `EntityDetailViewUI` (populated from records API response via `SyncColumns`)
- **Rationale**: Avoids an additional API call. Column definitions are already available from the first successful records list fetch.

### ColumnDefinitionSummary enrichment
- **Decision**: Add `required`, `enumValues`, and `defaultValue` to `ColumnDefinitionSummarySchema`
- **Rationale**: These fields already exist on the column definition table/model. The summary is the contract between API and dialog — it must carry enough metadata to render type-appropriate inputs, mark required fields, populate enum dropdowns, and pre-fill defaults on create. The `resolveColumns()` helper in the entity record router already loads full column definitions; it just needs to pass through the additional fields.

### Shared DynamicRecordField component
- **Decision**: Extract a shared `DynamicRecordField` component used by both `CreateEntityRecordDialog` and `EditEntityRecordDialog`
- **Rationale**: Both dialogs render the same column-to-input mapping. A shared component ensures consistent type-aware rendering and value serialization, and avoids duplicating the type-switch logic. Lives at `apps/web/src/components/DynamicRecordField.component.tsx`.
