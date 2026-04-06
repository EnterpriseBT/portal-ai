# Column Definition & Field Mapping Refactor — Implementation Specification

> Reference: [COL_DEF_REFACTOR.audit.md](./COL_DEF_REFACTOR.audit.md) for full design rationale, type-by-type examples, and tradeoff analysis.

---

## Table of Contents

- [Summary of Changes](#summary-of-changes)
- [Backend Phase 1 — Schema & Model Migration](#backend-phase-1--schema--model-migration)
- [Backend Phase 2 — Normalization Pipeline](#backend-phase-2--normalization-pipeline)
- [Backend Phase 3 — Record Validation](#backend-phase-3--record-validation)
- [Backend Phase 4 — API Routes & Services](#backend-phase-4--api-routes--services)
- [Frontend Phase 1 — SDK & Contracts](#frontend-phase-1--sdk--contracts)
- [Frontend Phase 2 — Column Definition UI](#frontend-phase-2--column-definition-ui)
- [Frontend Phase 3 — Field Mapping UI](#frontend-phase-3--field-mapping-ui)
- [Frontend Phase 4 — Entity Records & Display](#frontend-phase-4--entity-records--display)
- [Frontend Phase 5 — CSV Connector Workflow](#frontend-phase-5--csv-connector-workflow)
- [Affected Files Inventory](#affected-files-inventory)

---

## Summary of Changes

### Fields Moving from ColumnDefinition → FieldMapping

| Field | Current Owner | New Owner |
|-------|--------------|-----------|
| `required` | ColumnDefinition | FieldMapping |
| `defaultValue` | ColumnDefinition | FieldMapping |
| `format` | ColumnDefinition | FieldMapping |
| `enumValues` | ColumnDefinition | FieldMapping |

### New Fields on ColumnDefinition

| Field | Type | Purpose |
|-------|------|---------|
| `validationPattern` | `string \| null` | Universal regex validation (e.g., email, URL, UUID) |
| `validationMessage` | `string \| null` | Human-readable failure message for pattern validation |
| `canonicalFormat` | `string \| null` | Display format (read-time) or canonicalization (write-time for strings) |

### New Fields on FieldMapping

| Field | Type | Purpose |
|-------|------|---------|
| `normalizedKey` | `string` | Key used in `normalizedData` — names the field in entity context |
| `required` | `boolean` | Per-source requirement (moved from ColumnDefinition) |
| `defaultValue` | `string \| null` | Per-source fill value (moved from ColumnDefinition) |
| `format` | `string \| null` | Per-source parse instructions (moved from ColumnDefinition) |
| `enumValues` | `string[] \| null` | Per-source allowed values (moved from ColumnDefinition) |

### New Fields on EntityRecord

| Field | Type | Purpose |
|-------|------|---------|
| `validationErrors` | `json \| null` | Array of `{ field, error }` objects for per-field validation failures |
| `isValid` | `boolean` | Quick filter flag — `true` when `validationErrors` is null or empty |

### Type Enum Changes

- Remove `currency` from `ColumnDataTypeEnum` — collapse into `number` with `canonicalFormat`

---

## Backend Phase 1 — Schema & Model Migration

### 1.1 Update Zod Models (`packages/core/src/models/`)

**`column-definition.model.ts`**
- Remove fields: `required`, `defaultValue`, `format`, `enumValues`
- Add fields: `validationPattern` (string, nullable), `validationMessage` (string, nullable), `canonicalFormat` (string, nullable)
- Remove `"currency"` from `ColumnDataTypeEnum`
- Update `SORTABLE_COLUMN_TYPES` — remove `"currency"`
- Update `ColumnDefinitionModel` class and factory

**`field-mapping.model.ts`**
- Add fields: `normalizedKey` (string, regex `/^[a-z][a-z0-9_]*$/`), `required` (boolean), `defaultValue` (string, nullable), `format` (string, nullable), `enumValues` (string array, nullable)
- Update `FieldMappingModel` class and factory

**`entity-record.model.ts`**
- Add fields: `validationErrors` (array of `{ field: string, error: string }`, nullable), `isValid` (boolean)

### 1.2 Update Contracts (`packages/core/src/contracts/`)

**`column-definition.contract.ts`**
- `ColumnDefinitionCreateRequestBodySchema`: remove `required`, `defaultValue`, `format`, `enumValues`; add `validationPattern`, `validationMessage`, `canonicalFormat`
- `ColumnDefinitionUpdateRequestBodySchema`: same field changes (all optional)
- `ColumnDefinitionListRequestQuerySchema`: remove `required` filter param; consider adding `type` filter if not present

**`field-mapping.contract.ts`**
- `FieldMappingCreateRequestBodySchema`: add `normalizedKey` (required), `required`, `defaultValue`, `format`, `enumValues`
- `FieldMappingUpdateRequestBodySchema`: add same fields as optional
- Update enriched response schemas to include new fields

**`upload.contract.ts`**
- `ConfirmColumn` schema: remove `required`, `defaultValue`, `format`, `enumValues` from column-level; add them to the field mapping context within each entity's column confirmation
- Add `normalizedKey` to the per-entity column confirmation (defaults to the column definition key if not provided)
- Add `validationPattern`, `validationMessage`, `canonicalFormat` to column-level creation fields

**`entity-record.contract.ts`**
- Add `validationErrors` and `isValid` to response schemas
- Add `isValid` as a filterable query parameter

**`filter.contract.ts`**
- Remove `"currency"` from any type-specific filter logic

### 1.3 Update Drizzle Schema (`apps/api/src/db/schema/`)

**`column-definitions.table.ts`**
- Remove columns: `required`, `defaultValue`, `format`, `enumValues`
- Add columns: `validationPattern` (text, nullable), `validationMessage` (text, nullable), `canonicalFormat` (text, nullable)
- Update `columnDataTypeEnum` pgEnum: remove `"currency"`

**`field-mappings.table.ts`**
- Add columns: `normalizedKey` (varchar, not null), `required` (boolean, not null, default false), `defaultValue` (text, nullable), `format` (text, nullable), `enumValues` (jsonb, nullable)
- Add unique index on `(connector_entity_id, normalized_key)` where `deleted IS NULL` — prevents two mappings in the same entity from producing the same `normalizedData` key

**`entity-records.table.ts`**
- Add columns: `validationErrors` (jsonb, nullable), `isValid` (boolean, not null, default true)
- Add index on `(connector_entity_id, is_valid)` for efficient filtering

### 1.4 Update Type Checks & Zod Derivations (`apps/api/src/db/schema/`)

**`type-checks.ts`**
- Update `IsAssignable` checks for ColumnDefinition, FieldMapping, and EntityRecord to reflect new fields
- Remove any references to `currency` type

**`zod.ts`**
- Regenerate `createSelectSchema` / `createInsertSchema` for all three tables
- Ensure derived schemas match updated Zod models

### 1.5 Generate Database Migration

Run `npm run db:generate` from `apps/api/` to produce a migration SQL file. The migration must:

1. Add `validation_pattern`, `validation_message`, `canonical_format` columns to `column_definitions`
2. Add `normalized_key`, `required`, `default_value`, `format`, `enum_values` columns to `field_mappings`
3. Add `validation_errors`, `is_valid` columns to `entity_records`
4. **Backfill `field_mappings`:**
   - Copy `required`, `default_value`, `format`, `enum_values` from each field mapping's linked `column_definition`
   - Set `normalized_key` to the linked `column_definition.key`
5. **Migrate `currency` type:**
   - Update all `column_definitions` where `type = 'currency'` to `type = 'number'`
   - Set `canonical_format = '$#,##0.00'` for migrated rows (or derive from existing `format`)
6. Drop `required`, `default_value`, `format`, `enum_values` columns from `column_definitions`
7. Remove `'currency'` from the `column_data_type` pgEnum
8. Add unique index on `field_mappings(connector_entity_id, normalized_key)` where `deleted IS NULL`
9. Add index on `entity_records(connector_entity_id, is_valid)`

> **Note:** Steps 1–5 must run before step 6 to avoid data loss. The pgEnum removal (step 7) requires no existing rows reference `'currency'` (ensured by step 5).

### 1.6 Update Repositories (`apps/api/src/db/repositories/`)

**`column-definitions.repository.ts`**
- `upsertByKey()`: update to handle new fields (`validationPattern`, `validationMessage`, `canonicalFormat`) and exclude removed fields
- `findByOrganizationId()` / `findByKey()`: no structural change — schema handles field shape

**`field-mappings.repository.ts`**
- `upsertByEntityAndColumn()`: include `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues` in upsert
- Add `findByNormalizedKey(connectorEntityId, normalizedKey)` — lookup by entity + normalized key
- Update all existing methods to select/return new fields

**`entity-records.repository.ts`**
- Update `upsertManyBySourceId()` to include `validationErrors` and `isValid`
- Add filtering support for `isValid` in `findMany`

### 1.7 Update Constants (`apps/api/src/constants/`)

**`column-definition-transitions.constants.ts`**
- Remove `number ↔ currency` transition from `ALLOWED_TYPE_TRANSITIONS`
- Remove `"currency"` from any type references
- Keep `reference` and `reference-array` in `BLOCKED_TYPES`

### 1.8 Update Core Model Tests (`packages/core/src/__tests__/`)

**`models/column-definition.model.test.ts`**
- Remove tests for `required`, `defaultValue`, `format`, `enumValues`
- Add tests for `validationPattern`, `validationMessage`, `canonicalFormat`
- Remove `"currency"` from type enum tests

**`models/field-mapping.model.test.ts`**
- Add tests for `normalizedKey` (including regex validation), `required`, `defaultValue`, `format`, `enumValues`

**`models/entity-record.model.test.ts`**
- Add tests for `validationErrors` structure and `isValid`

**`contracts/column-definition.contract.test.ts`**
- Update create/update request body tests for new fields

**`contracts/field-mapping.contract.test.ts`**
- Update create/update request body tests for new fields

**`contracts/upload.contract.test.ts`**
- Update confirmation body tests for restructured fields

**`contracts/entity-record.contract.test.ts`**
- Add tests for `validationErrors` and `isValid` in response schema

---

## Backend Phase 2 — Normalization Pipeline

### 2.1 Rewrite NormalizationService (`apps/api/src/services/normalization.service.ts`)

Replace the current key-renaming projection with the full pipeline:

```
For each field mapping on the entity:
  1. Extract: sourceValue = data[fieldMapping.sourceField]
  2. Null handling:
     - If null/missing and fieldMapping.defaultValue exists → use defaultValue
     - If null/missing and fieldMapping.required → record validation error
     - If null/missing and not required → set null, continue
  3. Coerce by columnDefinition.type (smart defaults):
     - string: toString()
     - number: strip symbols/commas, parseFloat(), NaN → error
     - boolean: map common truthy/falsy, fieldMapping.format for custom labels
     - date/datetime: parse with fieldMapping.format, store ISO 8601
     - enum: pass through as string
     - json: JSON.parse if string, pass through if object
     - array: split by fieldMapping.format delimiter if string, pass through if array
     - reference: pass through
     - reference-array: split by delimiter if string, pass through if array
  4. Format map (enum): apply fieldMapping.format value mapping (e.g., "active:Active")
  5. Canonicalize (string type only): apply columnDefinition.canonicalFormat at write time
  6. Validate:
     - columnDefinition.validationPattern → regex test on coerced value
     - enum → check value against fieldMapping.enumValues
  7. Store: normalizedData[fieldMapping.normalizedKey] = coercedValue
```

**Return type** changes from `Record<string, unknown>` to:

```ts
{
  normalizedData: Record<string, unknown>;
  validationErrors: Array<{ field: string; error: string }> | null;
  isValid: boolean;
}
```

### 2.2 Create Type Coercion Utilities (`apps/api/src/utils/coercion.util.ts` — new file)

Per-type coercion functions, each returning `{ value, error? }`:

- `coerceString(value)` — toString
- `coerceNumber(value, format?)` — strip symbols, parseFloat, NaN detection; European format support via `format`
- `coerceBoolean(value, format?)` — smart truthy/falsy map; custom labels via `format`
- `coerceDate(value, format?)` — parse with format, store ISO; smart detection when no format
- `coerceDatetime(value, format?)` — same as date but with time component
- `coerceEnum(value)` — pass through as string
- `coerceJson(value)` — JSON.parse if string
- `coerceArray(value, format?)` — split by delimiter if string
- `coerceReference(value)` — pass through
- `coerceReferenceArray(value, format?)` — split if string, pass through if array

### 2.3 Create Canonicalization Utilities (`apps/api/src/utils/canonicalize.util.ts` — new file)

Write-time canonicalization for string types:

- `canonicalizeString(value, canonicalFormat)` — apply pattern-based normalization (e.g., phone: strip to digits, reformat)

### 2.4 Create Validation Utilities (`apps/api/src/utils/field-validation.util.ts` — new file)

- `validatePattern(value, pattern, message)` — regex test, returns error or null
- `validateEnum(value, enumValues)` — membership check, returns error or null
- `validateRequired(value)` — null/undefined/empty check

### 2.5 Update CSV Import Service (`apps/api/src/services/csv-import.service.ts`)

- Update calls to `NormalizationService.normalize()` to handle new return type
- Persist `validationErrors` and `isValid` on each entity record during upsert
- Log validation error summary per import batch

### 2.6 Update Normalization Pipeline Tests

**`services/normalization.service.test.ts`**
- Add tests for every type's coercion path (string, number, boolean, date, datetime, enum, json, array, reference, reference-array)
- Test null handling with `required`, `defaultValue`
- Test `validationPattern` enforcement
- Test `enumValues` constraint checking
- Test `canonicalFormat` write-time application for strings
- Test `fieldMapping.format` parsing for booleans, dates, enums, arrays
- Test `normalizedKey` used as output key instead of `columnDefinition.key`
- Test validation error collection (multiple errors per record)

**`utils/coercion.util.test.ts`** (new)
- Unit tests for each coercion function
- Edge cases: empty strings, whitespace, mixed types, European number formats

**`utils/field-validation.util.test.ts`** (new)
- Unit tests for pattern, enum, and required validation

**`services/csv-import.service.test.ts`**
- Update to verify `validationErrors` and `isValid` are persisted on records

---

## Backend Phase 3 — Record Validation

### 3.1 Add Re-validation Endpoint (Background Job)

**New route:** `POST /api/connector-entities/:connectorEntityId/records/revalidate`

Enqueues a background revalidation job (BullMQ, type `revalidation`) and returns `202` with the job record. The processor:
1. Fetches all field mappings for the entity (with column definitions)
2. For each record (in batches of 100): re-runs the normalization pipeline from `data` using current mappings
3. Updates `normalizedData`, `validationErrors`, `isValid` on each record
4. Reports progress via SSE and completes with summary: `{ total, valid, invalid, errors: [...] }`

If a revalidation job is already active for the entity, the endpoint returns the existing job (idempotent).

**Mutation guard:** While a revalidation job is active (`pending` or `active` status) for a connector entity, all write operations on affected objects are blocked with a `409 REVALIDATION_ACTIVE` error. Guarded endpoints:
- **Entity records:** POST (create), POST /import, POST /sync, PATCH, DELETE (single), DELETE (all)
- **Field mappings:** POST (create), PATCH, DELETE — for mappings belonging to the entity
- **Column definitions:** PATCH, DELETE — for column defs used by any entity with an active revalidation job

### 3.2 Trigger Re-validation on Mapping Changes

**`field-mapping.router.ts` — PATCH handler:**
- After successfully updating a field mapping, if any of `format`, `required`, `enumValues`, `defaultValue`, or `normalizedKey` changed, enqueue a re-validation job for the affected entity

**`column-definition.router.ts` — PATCH handler:**
- After successfully updating a column definition, if `validationPattern`, `validationMessage`, or `canonicalFormat` changed, enqueue re-validation jobs for all entities that have field mappings pointing to this column definition

### 3.3 Update Entity Record Router (`apps/api/src/routes/entity-record.router.ts`)

- Add `isValid` query parameter for filtering (boolean)
- Include `validationErrors` and `isValid` in GET responses
- Update type-aware sorting: remove `"currency"` handling, use `"number"` path

### 3.4 Add Re-validation Tests

- Test re-validation endpoint: verify records are re-normalized from raw `data`
- Test trigger on field mapping update
- Test trigger on column definition update
- Test that `normalizedKey` change re-keys `normalizedData`
- Test mutation guard: verify 409 when revalidation job is active
- Test idempotency: verify duplicate enqueue returns existing job

---

## Backend Phase 4 — API Routes & Services

### 4.1 Update Column Definition Router (`apps/api/src/routes/column-definition.router.ts`)

**POST (create):**
- Accept `validationPattern`, `validationMessage`, `canonicalFormat`
- Remove `required`, `defaultValue`, `format`, `enumValues` from request body
- Remove `"currency"` from accepted types

**PATCH (update):**
- Accept `validationPattern`, `validationMessage`, `canonicalFormat`
- Remove `required`, `defaultValue`, `format`, `enumValues` from request body
- Update `ALLOWED_TYPE_TRANSITIONS` — remove `currency` transitions
- Trigger re-validation when `validationPattern` or `canonicalFormat` changes

**GET (list):**
- Remove `required` filter query parameter
- Response payloads no longer include `required`, `defaultValue`, `format`, `enumValues`

**DELETE:**
- No structural change — impact analysis still counts field mappings and entity records

### 4.2 Update Field Mapping Router (`apps/api/src/routes/field-mapping.router.ts`)

**POST (create):**
- Accept `normalizedKey` (required), `required`, `defaultValue`, `format`, `enumValues`
- Validate `normalizedKey` uniqueness within the entity (no two mappings with the same `normalizedKey` on the same `connectorEntityId`)

**PATCH (update):**
- Accept `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues`
- Validate `normalizedKey` uniqueness if changed
- Trigger re-validation if `format`, `required`, `enumValues`, `defaultValue`, or `normalizedKey` changed

**GET (list/detail):**
- Response payloads include new fields

### 4.3 Update Uploads Service (`apps/api/src/services/uploads.service.ts`)

The confirmation transaction must:
- Create/match column definitions with new fields (`validationPattern`, `validationMessage`, `canonicalFormat`) and without removed fields (`required`, `defaultValue`, `format`, `enumValues`)
- Create field mappings with `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues`
- Default `normalizedKey` to the column definition's `key` if not explicitly provided in the confirmation payload

### 4.4 Update Column Definition Validation Service (`apps/api/src/services/column-definition-validation.service.ts`)

- Remove validation logic for `required`, `defaultValue`, `format`, `enumValues`
- Add validation for `validationPattern` (must be a valid regex)
- Remove `"currency"` from type transition logic

### 4.5 Update Field Mapping Validation Service (`apps/api/src/services/field-mapping-validation.service.ts`)

- Add validation for `normalizedKey` format and uniqueness per entity
- Add validation for `enumValues` (array of non-empty strings when provided)
- Add validation for `format` compatibility with column definition type (e.g., boolean format must be `"trueLabel/falseLabel"`)

### 4.6 Update File Analysis Service (`apps/api/src/services/file-analysis.service.ts`)

- AI recommendations must produce `normalizedKey` per column (default to suggested `key`)
- Recommendations must place `required`, `defaultValue`, `format`, `enumValues` at the mapping level, not column level
- Remove `"currency"` from type recommendations — recommend `"number"` with appropriate `canonicalFormat`

### 4.7 Update File Analysis Prompt (`apps/api/src/prompts/file-analysis.prompt.ts`)

- Update prompt to instruct LLM to recommend `normalizedKey` per entity-column pair
- Update prompt to output `required`, `format`, `enumValues` as mapping-level attributes
- Remove `"currency"` from type options; add note about `canonicalFormat` for currency display
- Add `validationPattern` to recommendation output for detectable patterns (email, URL, UUID, phone)

### 4.8 Update Heuristic Analyzer (`apps/api/src/utils/heuristic-analyzer.util.ts`)

- `inferType()`: remove `"currency"` detection — return `"number"` instead
- Add heuristic detection for `validationPattern` (email, URL, UUID patterns from sample values)
- Add heuristic `canonicalFormat` suggestions based on detected type
- Output `normalizedKey` per column recommendation (default to the snake_case key)
- Output `required`, `format`, `enumValues` at mapping level

### 4.9 Update Filter SQL Utility (`apps/api/src/utils/filter-sql.util.ts`)

- Remove `"currency"` type handling — use `"number"` path
- Ensure filter operations reference `normalizedData` keys that come from `fieldMapping.normalizedKey`

### 4.10 Update AI Tools (`apps/api/src/tools/`)

**`column-definition-create.tool.ts`**
- Update parameter schema: remove `required`, `defaultValue`, `format`, `enumValues`; add `validationPattern`, `validationMessage`, `canonicalFormat`
- Remove `"currency"` from type options

**`column-definition-update.tool.ts`**
- Same field changes as create tool

**`column-definition-delete.tool.ts`**
- No structural change

**`field-mapping-create.tool.ts`**
- Add `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues` to parameter schema

**`field-mapping-update.tool.ts`**
- Add same fields to parameter schema

**`field-mapping-delete.tool.ts`**
- No structural change

**`entity-record-create.tool.ts`**
- Update to handle new `NormalizationService.normalize()` return type (includes `validationErrors`, `isValid`)

**`entity-record-update.tool.ts`**
- Same as create tool

### 4.11 Update System Prompt (`apps/api/src/prompts/system.prompt.ts`)

- Update tool descriptions to reflect new field ownership
- Remove `"currency"` type references
- Document `normalizedKey` concept

### 4.12 Update API Route Tests

**`column-definition.router.test.ts`**
- Update create/update tests: remove old fields, add new fields
- Remove `"currency"` type tests
- Add tests for `validationPattern` regex validation

**`field-mapping.router.test.ts`**
- Add tests for `normalizedKey` (creation, uniqueness within entity, update)
- Add tests for `required`, `defaultValue`, `format`, `enumValues` on create/update
- Add test for re-validation trigger on mapping update

**`entity-record.router.test.ts`**
- Add tests for `isValid` filter query parameter
- Add tests for `validationErrors` in response payload
- Remove `"currency"` sort type tests

**Integration tests:**
- Update entity management integration tests
- Update sync interaction tests

### 4.13 Update Tool Tests (`apps/api/src/__tests__/tools/`)

- Update all column definition tool tests for new fields
- Update all field mapping tool tests for new fields
- Update entity record tool tests for validation error handling

### 4.14 Update Service Tests

**`column-definition-validation.service.test.ts`**
- Remove tests for `required`, `format`, `enumValues` validation
- Add tests for `validationPattern` regex validity check

**`field-mapping-validation.service.test.ts`**
- Add tests for `normalizedKey` validation and uniqueness
- Add tests for `enumValues` and `format` validation

**`uploads.service.test.ts`**
- Update confirmation tests for restructured payload
- Verify `normalizedKey` is set on created field mappings
- Verify `required`, `defaultValue`, `format`, `enumValues` are set on field mappings

**`file-analysis.service.test.ts`**
- Update recommendation output structure tests

**`heuristic-analyzer.util.test.ts`**
- Remove `"currency"` detection tests
- Add `validationPattern` detection tests
- Add `normalizedKey` output tests

**`filter-sql.util.test.ts`**
- Remove `"currency"` filter tests

### 4.15 Update Swagger Configuration (`apps/api/src/config/swagger.config.ts`)

- Update OpenAPI schemas for column definition and field mapping request/response bodies
- Remove `"currency"` from type enum documentation
- Document new fields and re-validation endpoint

---

## Frontend Phase 1 — SDK & Contracts

### 1.1 Update API Client (`apps/web/src/api/`)

**`column-definitions.api.ts`**
- Update create/update mutation payloads: remove `required`, `defaultValue`, `format`, `enumValues`; add `validationPattern`, `validationMessage`, `canonicalFormat`
- Remove `required` from list filter parameters
- Update response types to include new fields

**`field-mappings.api.ts`**
- Update create/update mutation payloads: add `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues`
- Update response types to include new fields
- Update search hook labels if needed (may want to show `normalizedKey` in labels)

**`entity-records.api.ts`**
- Add `isValid` query parameter support for list endpoint
- Update response types to include `validationErrors` and `isValid`
- Add `revalidate(connectorEntityId)` mutation — calls `POST /api/connector-entities/:id/records/revalidate`

**`keys.ts`**
- No structural change — query key factories remain the same

**`types.ts`**
- Update any shared type definitions

### 1.2 Update Query Key Invalidation

After field mapping mutations (create/update/delete), invalidate:
- `fieldMappings.root`
- `entityRecords.root` (mapping changes affect normalized data and validation state)

After column definition mutations (update), if `validationPattern` or `canonicalFormat` changed, invalidate:
- `columnDefinitions.root`
- `entityRecords.root`

---

## Frontend Phase 2 — Column Definition UI

### 2.1 Update Column Definition List View (`apps/web/src/views/ColumnDefinitionList.view.tsx`)

- Remove `required` filter/column from the list table
- Remove `"currency"` from type filter options
- Add `validationPattern` indicator (e.g., icon or badge when set)

### 2.2 Update Column Definition Detail View (`apps/web/src/views/ColumnDefinitionDetail.view.tsx`)

- **Metadata panel:** remove `required`, `defaultValue`, `format`, `enumValues` display; add `validationPattern`, `validationMessage`, `canonicalFormat` display
- **Field mappings table:** add columns for `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues` per mapping row
- Update edit/create dialog triggers to pass correct fields

### 2.3 Update Create Column Definition Dialog (`apps/web/src/components/CreateColumnDefinitionDialog`)

- Remove form fields: `required` (checkbox), `defaultValue` (text), `format` (text), `enumValues` (tag input)
- Add form fields:
  - `validationPattern` (text input with regex preview/test)
  - `validationMessage` (text input)
  - `canonicalFormat` (text input with type-aware hint)
- Add validation preset dropdown (email, URL, phone, UUID) that auto-populates `validationPattern` and `validationMessage`
- Remove `"currency"` from type select options

### 2.4 Update Edit Column Definition Dialog (`apps/web/src/components/EditColumnDefinitionDialog`)

- Same field changes as create dialog
- On save, if `validationPattern` or `canonicalFormat` changed, show a confirmation that affected records will be re-validated

### 2.5 Update Delete Column Definition Dialog

- No structural change — impact analysis unchanged

### 2.6 Update Column Definition Components (`apps/web/src/components/ColumnDefinition.component.tsx`)

- `ColumnDefinitionCardUI`: remove required badge, format/default/enum display; add validation pattern indicator and canonical format display

### 2.7 Update Column Definition Tests

**`__tests__/components/CreateColumnDefinitionDialog.test.tsx`**
- Remove tests for `required`, `defaultValue`, `format`, `enumValues` fields
- Add tests for `validationPattern`, `validationMessage`, `canonicalFormat` fields
- Add test for validation preset auto-population

**`__tests__/components/EditColumnDefinitionDialog.test.tsx`**
- Same test changes as create dialog

**`__tests__/views/ColumnDefinitionListView.test.tsx`**
- Remove `required` filter tests
- Remove `"currency"` type tests

**`__tests__/views/ColumnDefinitionDetailView.test.tsx`**
- Update metadata panel assertions
- Update field mappings table assertions for new columns

---

## Frontend Phase 3 — Field Mapping UI

### 3.1 Update Create Field Mapping Dialog (`apps/web/src/components/CreateFieldMappingDialog`)

- Add form fields:
  - `normalizedKey` (text input, required, snake_case validated) — auto-suggest from `sourceField` converted to snake_case
  - `required` (checkbox)
  - `defaultValue` (text input)
  - `format` (text input with type-aware hint based on linked column definition's type)
  - `enumValues` (tag input — only shown when linked column definition type is `"enum"`)
- Validate `normalizedKey` uniqueness within the entity (client-side check against existing mappings)

### 3.2 Update Edit Field Mapping Dialog (`apps/web/src/components/EditFieldMappingDialog`)

- Add same fields as create dialog
- On save, if `format`, `required`, `enumValues`, `defaultValue`, or `normalizedKey` changed, show confirmation that affected records will be re-validated

### 3.3 Update Delete Field Mapping Dialog

- No structural change

### 3.4 Update Field Mapping Components (`apps/web/src/components/FieldMapping.component.tsx`)

- `FieldMappingDataList`: response type includes new fields
- Display `normalizedKey` as a primary identifier alongside `sourceField`

### 3.5 Update Field Mapping Tests

**`__tests__/components/CreateFieldMappingDialog.test.tsx`**
- Add tests for `normalizedKey` (required, validation, auto-suggest)
- Add tests for `required`, `defaultValue`, `format`, `enumValues` fields
- Add test for `enumValues` visibility tied to column type

**`__tests__/components/EditFieldMappingDialog.test.tsx`**
- Same test additions
- Add test for re-validation confirmation on constraint changes

---

## Frontend Phase 4 — Entity Records & Display

### 4.1 Update Record Field Serialization (`apps/web/src/utils/record-field-serialization.util.ts`)

**`serializeRecordFields()`**
- Update to use `fieldMapping.normalizedKey` as the output key instead of `columnDefinition.key`
- Remove `"currency"` type handling — use `"number"` path
- Remove field-level `required` check from column definitions — read from field mappings

**`validateRequiredFields()`**
- Change to read `required` from field mappings instead of column definitions

**`initializeRecordFields()`**
- Update to read `normalizedData` keys using `fieldMapping.normalizedKey`

### 4.2 Update Display Components

**`DynamicRecordField` / `EntityRecordFieldValue`**
- Apply `canonicalFormat` for read-time display formatting (number, boolean, date, datetime)
- Remove `"currency"` type branch — handle via `"number"` with `canonicalFormat`

**`EntityRecordDataTable`**
- Update `SORTABLE_COLUMN_TYPES` usage — remove `"currency"`
- Column headers should use `fieldMapping.normalizedKey` as the data accessor
- Add validation status indicator column (valid/invalid icon per row)
- Add `isValid` filter toggle

**`EntityRecordCellCode`**
- Remove `"currency"` formatting
- Apply `canonicalFormat` for display

**`EntityRecordMetadata`**
- Show `validationErrors` if present — list of field-level errors

### 4.3 Update Entity Record Detail View (`apps/web/src/views/EntityRecordDetail.view.tsx`)

- Display `validationErrors` as an alert/banner when `isValid` is false
- Per-field error indicators next to invalid fields
- Add "Re-validate" action button that triggers the re-validation endpoint

### 4.4 Update Entity Detail View (`apps/web/src/views/EntityDetail.view.tsx`)

- Add validation summary (e.g., "42 of 1,000 records have validation errors")
- Add `isValid` filter toggle on record list
- Add "Re-validate All" action button

### 4.5 Update Create/Edit Entity Record Dialogs

- Read `required` from field mappings instead of column definitions
- Use `fieldMapping.normalizedKey` as field keys
- Remove `"currency"` type handling

### 4.6 Update Format Utility (`apps/web/src/utils/format.util.ts`)

- Add `formatWithCanonical(value, type, canonicalFormat)` function for read-time display formatting
- Remove `"currency"` specific formatting — handle via `"number"` with `canonicalFormat`

### 4.7 Update Advanced Filter Builder (`apps/web/src/components/AdvancedFilterBuilder`)

- Remove `"currency"` type from filter type options
- Filter field references should use `fieldMapping.normalizedKey`
- Update type-specific filter controls (date format, number ranges)

### 4.8 Update Entity Record Tests

**`__tests__/utils/record-field-serialization.util.test.ts`**
- Update to test `normalizedKey` as output key
- Remove `"currency"` tests
- Update `required` field validation to use field mappings

**`__tests__/views/EntityRecordDetailView.test.tsx`**
- Add tests for validation error display
- Add test for re-validate button

**`__tests__/views/EntityDetailView.test.tsx`**
- Add tests for validation summary
- Add tests for `isValid` filter

**`__tests__/components/EntityRecordDataTable.test.tsx`**
- Remove `"currency"` column tests
- Add validation status column tests

**`__tests__/components/AdvancedFilterBuilder.test.tsx`**
- Remove `"currency"` filter tests

---

## Frontend Phase 5 — CSV Connector Workflow

### 5.1 Update Column Mapping Step (`apps/web/src/workflows/CSVConnector/ColumnMappingStep.component.tsx`)

- Remove per-column `required`, `defaultValue`, `format`, `enumValues` inputs
- Add per-column `validationPattern`, `validationMessage`, `canonicalFormat` inputs (for new column definitions)
- Add per-mapping `normalizedKey` input (auto-suggested from column key, editable)
- Add per-mapping `required`, `defaultValue`, `format`, `enumValues` inputs
- Remove `"currency"` from type select options
- Add validation preset selector for `validationPattern`

### 5.2 Update Review Step (`apps/web/src/workflows/CSVConnector/ReviewStep.component.tsx`)

- Display updated field layout: column definition fields vs mapping fields clearly separated
- Show `normalizedKey` per mapping in the review summary
- Remove `"currency"` references

### 5.3 Update Workflow Utilities (`apps/web/src/workflows/CSVConnector/utils/`)

**`upload-workflow.util.ts`**
- Update `FileUploadRecommendation` types to reflect new field structure
- `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues` on per-entity column recommendations
- `validationPattern`, `validationMessage`, `canonicalFormat` on column definition recommendations
- Remove `"currency"` type handling

**`csv-validation.util.ts`**
- Add validation for `normalizedKey` (required, snake_case format, unique within entity)
- Move `required`, `format`, `enumValues` validation from column context to mapping context
- Remove `"currency"` validation

### 5.4 Update Confirmation Payload Builder

The workflow builds and sends a `ConfirmRequestBody` to the uploads API. Update to:
- Place `validationPattern`, `validationMessage`, `canonicalFormat` at the column definition level
- Place `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues` at the field mapping level
- Default `normalizedKey` to the column key if not user-edited

### 5.5 Update CSV Workflow Tests

**`__tests__/CSVConnectorWorkflow.test.tsx`**
- Update confirmation payload structure tests
- Update column mapping step interaction tests

**`__tests__/ColumnMappingStep.test.tsx`**
- Add tests for `normalizedKey` input (auto-suggest, validation, uniqueness)
- Add tests for per-mapping `required`, `format`, `enumValues` inputs
- Remove tests for per-column `required`, `format`, `enumValues`

**`__tests__/ReviewStep.test.tsx`**
- Update review display assertions

**`__tests__/utils/csv-validation.util.test.ts`**
- Add `normalizedKey` validation tests
- Move constraint validation tests to mapping context

**`__tests__/utils/upload-workflow.util.test.ts`**
- Update recommendation type tests

### 5.6 Update Storybook Stories

**`stories/CSVConnectorWorkflow.stories.tsx`**
- Update mock data to reflect new field structure
- Remove `"currency"` from example types

---

## Affected Files Inventory

### `packages/core/src/` (8 files)

| File | Change Type |
|------|------------|
| `models/column-definition.model.ts` | Modify — remove fields, add fields, remove currency type |
| `models/field-mapping.model.ts` | Modify — add normalizedKey, required, defaultValue, format, enumValues |
| `models/entity-record.model.ts` | Modify — add validationErrors, isValid |
| `contracts/column-definition.contract.ts` | Modify — update request/response schemas |
| `contracts/field-mapping.contract.ts` | Modify — update request/response schemas |
| `contracts/upload.contract.ts` | Modify — restructure confirmation payload |
| `contracts/entity-record.contract.ts` | Modify — add validation fields to response |
| `contracts/filter.contract.ts` | Modify — remove currency type handling |

### `packages/core/src/__tests__/` (8 files)

| File | Change Type |
|------|------------|
| `models/column-definition.model.test.ts` | Modify |
| `models/field-mapping.model.test.ts` | Modify |
| `models/entity-record.model.test.ts` | Modify |
| `contracts/column-definition.contract.test.ts` | Modify |
| `contracts/field-mapping.contract.test.ts` | Modify |
| `contracts/upload.contract.test.ts` | Modify |
| `contracts/entity-record.contract.test.ts` | Modify |
| `contracts/filter.contract.test.ts` | Modify |

### `apps/api/src/db/schema/` (4 files)

| File | Change Type |
|------|------------|
| `column-definitions.table.ts` | Modify — remove fields, add fields, update pgEnum |
| `field-mappings.table.ts` | Modify — add columns, add unique index |
| `entity-records.table.ts` | Modify — add columns, add index |
| `type-checks.ts` | Modify — update type assertions for all three tables |
| `zod.ts` | Modify — regenerate derived schemas |

### `apps/api/src/db/repositories/` (3 files)

| File | Change Type |
|------|------------|
| `column-definitions.repository.ts` | Modify — update upsert, exclude removed fields |
| `field-mappings.repository.ts` | Modify — add normalizedKey lookup, update upsert |
| `entity-records.repository.ts` | Modify — add isValid filter, include validation fields |

### `apps/api/src/services/` (6 files)

| File | Change Type |
|------|------------|
| `normalization.service.ts` | **Rewrite** — full coercion/validation pipeline |
| `uploads.service.ts` | Modify — restructure confirmation transaction |
| `csv-import.service.ts` | Modify — handle validation errors on records |
| `file-analysis.service.ts` | Modify — update recommendation structure |
| `column-definition-validation.service.ts` | Modify — new field validation, remove old |
| `field-mapping-validation.service.ts` | Modify — normalizedKey uniqueness, format validation |

### `apps/api/src/routes/` (3 files)

| File | Change Type |
|------|------------|
| `column-definition.router.ts` | Modify — update CRUD fields, add re-validation trigger |
| `field-mapping.router.ts` | Modify — update CRUD fields, add re-validation trigger |
| `entity-record.router.ts` | Modify — add isValid filter, add revalidate endpoint, remove currency sort |

### `apps/api/src/constants/` (1 file)

| File | Change Type |
|------|------------|
| `column-definition-transitions.constants.ts` | Modify — remove currency transitions |

### `apps/api/src/utils/` (4 files, 3 new)

| File | Change Type |
|------|------------|
| `coercion.util.ts` | **New** — per-type coercion functions |
| `canonicalize.util.ts` | **New** — write-time string canonicalization |
| `field-validation.util.ts` | **New** — pattern, enum, required validation |
| `heuristic-analyzer.util.ts` | Modify — remove currency, add normalizedKey/validationPattern detection |
| `filter-sql.util.ts` | Modify — remove currency, use normalizedKey |

### `apps/api/src/tools/` (8 files)

| File | Change Type |
|------|------------|
| `column-definition-create.tool.ts` | Modify — update parameter schema |
| `column-definition-update.tool.ts` | Modify — update parameter schema |
| `column-definition-delete.tool.ts` | No change |
| `field-mapping-create.tool.ts` | Modify — add new parameters |
| `field-mapping-update.tool.ts` | Modify — add new parameters |
| `field-mapping-delete.tool.ts` | No change |
| `entity-record-create.tool.ts` | Modify — handle validation return type |
| `entity-record-update.tool.ts` | Modify — handle validation return type |

### `apps/api/src/prompts/` (2 files)

| File | Change Type |
|------|------------|
| `file-analysis.prompt.ts` | Modify — restructure recommendation output |
| `system.prompt.ts` | Modify — update tool descriptions |

### `apps/api/src/config/` (1 file)

| File | Change Type |
|------|------------|
| `swagger.config.ts` | Modify — update OpenAPI schemas |

### `apps/api/drizzle/` (1 file)

| File | Change Type |
|------|------------|
| `XXXX_col_def_refactor.sql` | **New** — migration with backfill |

### `apps/api/src/__tests__/` (~25 files)

| File Group | Change Type |
|------------|------------|
| `routes/column-definition.router.test.ts` | Modify |
| `routes/field-mapping.router.test.ts` | Modify |
| `routes/entity-record.router.test.ts` | Modify |
| `services/normalization.service.test.ts` | **Rewrite** |
| `services/uploads.service.test.ts` | Modify |
| `services/csv-import.service.test.ts` | Modify |
| `services/file-analysis.service.test.ts` | Modify |
| `services/column-definition-validation.service.test.ts` | Modify |
| `services/field-mapping-validation.service.test.ts` | Modify |
| `utils/coercion.util.test.ts` | **New** |
| `utils/field-validation.util.test.ts` | **New** |
| `utils/heuristic-analyzer.util.test.ts` | Modify |
| `utils/filter-sql.util.test.ts` | Modify |
| `tools/column-definition-*.tool.test.ts` (3) | Modify |
| `tools/field-mapping-*.tool.test.ts` (3) | Modify |
| `tools/entity-record-*.tool.test.ts` (2) | Modify |
| Integration tests (entity-management, sync) | Modify |

### `apps/web/src/api/` (4 files)

| File | Change Type |
|------|------------|
| `column-definitions.api.ts` | Modify — update payloads and response types |
| `field-mappings.api.ts` | Modify — update payloads and response types |
| `entity-records.api.ts` | Modify — add isValid filter, revalidate mutation |
| `types.ts` | Modify — update shared types |

### `apps/web/src/views/` (4 files)

| File | Change Type |
|------|------------|
| `ColumnDefinitionList.view.tsx` | Modify — remove required filter, remove currency |
| `ColumnDefinitionDetail.view.tsx` | Modify — update metadata panel and field mapping table |
| `EntityDetail.view.tsx` | Modify — add validation summary, isValid filter |
| `EntityRecordDetail.view.tsx` | Modify — add validation error display |

### `apps/web/src/components/` (~12 files)

| File | Change Type |
|------|------------|
| `ColumnDefinition.component.tsx` | Modify — update card display |
| `CreateColumnDefinitionDialog` | Modify — swap form fields |
| `EditColumnDefinitionDialog` | Modify — swap form fields |
| `FieldMapping.component.tsx` | Modify — show normalizedKey |
| `CreateFieldMappingDialog` | Modify — add new form fields |
| `EditFieldMappingDialog` | Modify — add new form fields |
| `DynamicRecordField` | Modify — canonicalFormat display, remove currency |
| `EntityRecordFieldValue` | Modify — canonicalFormat display, remove currency |
| `EntityRecordDataTable` | Modify — validation column, remove currency sort |
| `EntityRecordCellCode` | Modify — remove currency |
| `EntityRecordMetadata` | Modify — show validation errors |
| `AdvancedFilterBuilder` | Modify — remove currency type |

### `apps/web/src/utils/` (2 files)

| File | Change Type |
|------|------------|
| `record-field-serialization.util.ts` | Modify — use normalizedKey, remove currency |
| `format.util.ts` | Modify — add canonicalFormat display, remove currency |

### `apps/web/src/workflows/CSVConnector/` (6 files)

| File | Change Type |
|------|------------|
| `ColumnMappingStep.component.tsx` | Modify — restructure column vs mapping fields |
| `ReviewStep.component.tsx` | Modify — display updated structure |
| `utils/upload-workflow.util.ts` | Modify — update recommendation types |
| `utils/csv-validation.util.ts` | Modify — add normalizedKey validation, move constraints |
| `stories/CSVConnectorWorkflow.stories.tsx` | Modify — update mock data |
| `index.ts` | Likely no change |

### `apps/web/src/__tests__/` (~20 files)

| File Group | Change Type |
|------------|------------|
| Column definition dialog tests (2) | Modify |
| Field mapping dialog tests (2) | Modify |
| Column definition view tests (2) | Modify |
| Entity detail/record view tests (2) | Modify |
| Entity record component tests (3) | Modify |
| Record field serialization tests (1) | Modify |
| Format utility tests (1) | Modify |
| Advanced filter tests (1) | Modify |
| CSV workflow tests (5) | Modify |
| Cache invalidation tests (1) | Modify |

### Documentation (1 file)

| File | Change Type |
|------|------------|
| `docs/COL_DEF_REFACTOR.audit.md` | Reference — no changes needed |

---

## Total Impact Summary

| Package | Files Modified | Files Created | Files Rewritten |
|---------|---------------|---------------|-----------------|
| `packages/core` | 16 | 0 | 0 |
| `apps/api` | ~45 | 4 | 1 |
| `apps/web` | ~45 | 0 | 0 |
| **Total** | **~106** | **4** | **1** |
