# Upload Workflow Overhaul — Implementation Plan (TDD)

> References: [UPLOAD_WORKFLOW.audit.md](./UPLOAD_WORKFLOW.audit.md) | [UPLOAD_WORKFLOW.spec.md](./UPLOAD_WORKFLOW.spec.md)

Each step follows red-green-refactor: write/update tests first (red), implement until tests pass (green), then clean up (refactor). Verification gates must pass before moving to the next step.

---

## Step 1: Expand Seed Column Definitions

### 1.1 Tests (Red)

- [x] Add test in `apps/api/src/__tests__/services/seed.service.test.ts` (create if needed):
  - [x] Assert `SYSTEM_COLUMN_DEFINITIONS` array has 26 entries
  - [x] Assert each entry has required fields: `key`, `label`, `type`, `description`, `validationPattern`, `validationMessage`, `canonicalFormat`
  - [x] Assert all keys are unique
  - [x] Assert all keys match `/^[a-z][a-z0-9_]*$/`
  - [x] Assert type values are valid `ColumnDataType` enum members
  - [x] Assert `seedSystemColumnDefinitions()` calls `upsertByKey()` for each definition

### 1.2 Implementation (Green)

- [x] Update `SYSTEM_COLUMN_DEFINITIONS` array in `apps/api/src/services/seed.service.ts` — add 17 new entries (string_id, number_id, integer, decimal, percentage, boolean, text, code, enum, json_data, array, reference, reference_array, address, quantity, status, tag)
- [x] Export `SYSTEM_COLUMN_DEFINITIONS` (or its length) for test access

### 1.3 Verification

- [x] `npm run test -- --testPathPattern seed.service`
- [x] `npm run type-check` passes
- [x] Run `npm run db:seed` against dev database — verify 26 column definitions exist per org
- [x] Re-run `npm run db:seed` — verify idempotent (no duplicates, no errors)

---

## Step 2: Update Core Models & Contracts

### 2.1 Tests (Red)

- [x] Update/add schema validation tests in `packages/core/src/__tests__/` (or colocated):
  - [x] `FileUploadColumnRecommendationSchema` rejects payloads with `action` or `key`/`label`/`type` fields (ensure they're not silently accepted via passthrough)
  - [x] `FileUploadColumnRecommendationSchema` requires `existingColumnDefinitionId` as a non-nullable string
  - [x] `FileUploadColumnRecommendationSchema` accepts valid payloads with field-mapping-level fields only
  - [x] `ConfirmColumnSchema` rejects payloads with `action`, `key`, `label`, `type`, `validationPattern`, `validationMessage`, `canonicalFormat`
  - [x] `ConfirmColumnSchema` requires `existingColumnDefinitionId` as a non-nullable string
  - [x] `ConfirmColumnSchema` requires `normalizedKey` matching `/^[a-z][a-z0-9_]*$/`
  - [x] `ConfirmColumnSchema` accepts valid payloads with all field-mapping-level fields

### 2.2 Implementation (Green)

- [x] Remove `ColumnRecommendationActionEnum` from `packages/core/src/models/job.model.ts`
- [x] Update `FileUploadColumnRecommendationSchema` — remove `key`, `label`, `type`, `action`, `validationPattern`, `canonicalFormat`; make `existingColumnDefinitionId` required (`z.string()` not nullable)
- [x] Update `FileUploadColumnRecommendation` type export
- [x] Update `ConfirmColumnSchema` in `packages/core/src/contracts/upload.contract.ts` — remove `action`, `key`, `label`, `type`, `validationPattern`, `validationMessage`, `canonicalFormat`; make `existingColumnDefinitionId` required; make `normalizedKey` required (not optional)
- [x] Remove `ColumnRecommendationActionEnum` import from `upload.contract.ts`
- [x] Update any barrel exports in `packages/core/src/models/index.ts` and `packages/core/src/contracts/index.ts`

### 2.3 Verification

- [x] `npm run test -- --testPathPattern packages/core`
- [x] `npm run type-check` — expect type errors downstream (API + web); confirms contract change propagated
- [x] List all type errors — they map to the files we'll fix in subsequent steps

---

## Step 3: Simplify Backend — `UploadsService.confirm()`

### 3.1 Tests (Red)

- [x] Update/create tests in `apps/api/src/__tests__/services/uploads.service.test.ts`:
  - [x] Confirm with valid `existingColumnDefinitionId` for every column succeeds
  - [x] Confirm with invalid/missing `existingColumnDefinitionId` returns 400 `UPLOAD_INVALID_REFERENCE`
  - [x] Confirm with column def belonging to different org returns 400
  - [x] Confirm creates field mappings linked to the existing column definition IDs
  - [x] Confirm no longer calls `columnDefinitions.upsertByKey()` (no column def creation)
  - [x] Confirm for reference-type column resolves `refColumnDefinitionId` correctly
  - [x] Remove/update any existing tests that assert `create_new` behavior
  - [x] Remove/update tests for `validateCrossEntityColumnConsistency`

### 3.2 Implementation (Green)

- [x] Update `confirm()` validation loop — remove `col.action === "match_existing"` guard; validate `existingColumnDefinitionId` on every column
- [x] Remove `validateCrossEntityColumnConsistency()` method and its call
- [x] Remove `resolveColumnDefinition()` method
- [x] Remove `columnDefCache` from `confirmInTransaction()`
- [x] Replace column resolution with direct `findById(col.existingColumnDefinitionId, tx)`
- [x] Update `resolveRefColumnDefinitionId()` — remove `columnDefCache` parameter
- [x] Update field mapping creation — use `col.normalizedKey` directly (now required), remove `col.key` fallback
- [x] Remove `ApiCode.UPLOAD_CONFLICTING_COLUMN_DEFINITIONS` from `apps/api/src/constants/api-codes.constants.ts` if unused elsewhere

### 3.3 Verification

- [x] `npm run test -- --testPathPattern uploads.service`
- [x] `npm run type-check` from `apps/api/` passes (for this service)

---

## Step 4: Update Heuristic Analyzer

### 4.1 Tests (Red)

- [x] Update tests in `apps/api/src/__tests__/utils/heuristic-analyzer.util.test.ts` (create if needed):
  - [x] Given existing columns covering all types, every CSV column maps to an `existingColumnDefinitionId`
  - [x] Email-pattern samples match the `email` column definition
  - [x] UUID-pattern samples match the `uuid` column definition
  - [x] URL-pattern samples match the `url` column definition
  - [x] Numeric samples match `integer` or `decimal` based on decimal presence
  - [x] Date/datetime samples match `date`/`datetime` definitions
  - [x] Boolean samples match `boolean` definition
  - [x] Generic string samples fall back to `text` definition
  - [x] No recommendation returns `action: "create_new"` (field removed)
  - [x] Confidence is 1.0 for exact key/label match, 0.9 for pattern-based match, 0.5 for generic type fallback
  - [x] `normalizedKey` is still derived from source field via `toSnakeCase`
  - [x] Return shape matches updated `FileUploadColumnRecommendationSchema`

### 4.2 Implementation (Green)

- [x] Update `heuristicAnalyze()` return shape — remove `key`, `label`, `type`, `action`, `validationPattern`, `canonicalFormat` from each column
- [x] Add specialized matching: email → `email` def, UUID → `uuid` def, URL → `url` def, phone → `phone` def
- [x] Add type-based fallback matching: `string` → `text`, `number` → `decimal`, `boolean` → `boolean`, `date` → `date`, `datetime` → `datetime`, `enum` → `enum`, `array` → `array`
- [x] Set confidence based on match quality
- [x] Return `existingColumnDefinitionId` for every column (required by updated schema)

### 4.3 Verification

- [x] `npm run test -- --testPathPattern heuristic-analyzer`
- [x] `npm run type-check` from `apps/api/`

---

## Step 5: Update File Analysis Prompt & Service

### 5.1 Tests (Red)

- [x] Update/create tests in `apps/api/src/__tests__/prompts/file-analysis.prompt.test.ts`:
  - [x] Built prompt does NOT contain `"create_new"` anywhere
  - [x] Built prompt does NOT instruct the LLM to generate `key`, `label`, `type`, `validationPattern`, `canonicalFormat`
  - [x] Built prompt includes full column definition metadata (id, key, label, type, description) for each existing column
  - [x] Built prompt instructs to return `existingColumnDefinitionId` for every column
  - [x] Built prompt includes field-mapping-level instructions (normalizedKey, format, required, etc.)
- [x] Update tests in `apps/api/src/__tests__/services/file-analysis.service.test.ts` (if exists):
  - [x] `resolveColumnDefinitionIds` no longer demotes to `create_new` — instead attempts type fallback
  - [x] `ExistingColumnDefinition` interface includes `description`, `validationPattern`, `canonicalFormat`

### 5.2 Implementation (Green)

- [x] Update `ExistingColumnDefinition` interface in `file-analysis.service.ts` — add `description`, `validationPattern`, `canonicalFormat` fields
- [x] Update callers that construct `AnalyzeFileInput.existingColumns` to include the new fields
- [x] Rewrite `buildFileAnalysisPrompt()` in `file-analysis.prompt.ts`:
  - [x] Display full metadata per existing column definition
  - [x] Instruct LLM to select from existing definitions only — return `existingColumnDefinitionId` for every column
  - [x] Remove all `create_new` instructions
  - [x] Keep field-mapping-level output instructions
- [x] Update `resolveColumnDefinitionIds()` — remove `create_new` demotion; add type-based fallback when ID is unresolvable

### 5.3 Verification

- [x] `npm run test -- --testPathPattern file-analysis`
- [x] `npm run type-check` from `apps/api/`
- [x] Full `npm run test` from `apps/api/` — all backend tests pass

---

## Step 6: Simplify Frontend — `upload-workflow.util.ts`

### 6.1 Tests (Red)

- [x] Update `apps/web/src/workflows/CSVConnector/__tests__/upload-workflow.test.ts`:
  - [x] `RecommendedColumn` fixtures use new flat shape (no `recommended` nesting, no `action`)
  - [x] `mapBackendRecommendations` correctly maps new backend response shape
  - [x] `updateColumn` performs shallow merge (no `recommended` partial merge)
  - [x] `confirm()` builds payload matching new `ConfirmColumnSchema` (no `key`, `label`, `type`, `action`, `validationPattern`, etc.)
  - [x] `confirm()` sends `existingColumnDefinitionId` as a required string for every column

### 6.2 Implementation (Green)

- [x] Update `RecommendedColumn` interface — flatten (remove `recommended` nesting, remove `action`)
- [x] Update `RecommendedColumnUpdate` type — remove `recommended` partial merge
- [x] Update `BackendRecommendation` interface — match new backend shape
- [x] Update `mapBackendRecommendations()` — flat mapping
- [x] Update `updateColumn()` — simple shallow merge
- [x] Update `confirm()` — build payload matching new contract
- [x] Update `UseUploadWorkflowReturn` if any exposed types changed

### 6.3 Verification

- [x] `npm run test -- --testPathPattern upload-workflow`
- [x] `npm run type-check` from `apps/web/` — expect remaining errors in ColumnMappingStep and CSVConnectorWorkflow (fixed next)

---

## Step 7: Simplify Frontend — `csv-validation.util.ts`

### 7.1 Tests (Red)

- [x] Update `apps/web/src/workflows/CSVConnector/__tests__/csv-validation.util.test.ts`:
  - [x] Column with `existingColumnDefinitionId: null` fails validation with "column definition must be selected"
  - [x] Column with valid `existingColumnDefinitionId` passes
  - [x] Column with missing `normalizedKey` fails validation
  - [x] Column with invalid `normalizedKey` (uppercase, special chars) fails validation
  - [x] Duplicate `normalizedKey` within same entity flagged
  - [x] Duplicate `normalizedKey` across different entities is fine
  - [x] Remove all tests for: `BaseColumnSchema` (key/label/type), `ReferenceColumnSchema`, cross-entity `create_new` consistency, `validationPattern` regex validation

### 7.2 Implementation (Green)

- [x] Remove `BaseColumnSchema`, `ReferenceColumnSchema`
- [x] Rewrite `validateColumnStep()`:
  - [x] Validate `existingColumnDefinitionId` is present
  - [x] Validate `normalizedKey` format and uniqueness
  - [x] Remove column-definition-level validation
  - [x] Remove cross-entity consistency check
- [x] Update `ColumnStepErrors` type if needed

### 7.3 Verification

- [x] `npm run test -- --testPathPattern csv-validation`

---

## Step 8: Rewrite Frontend — `ColumnMappingStep.component.tsx`

### 8.1 Tests (Red)

- [x] Update `apps/web/src/workflows/CSVConnector/__tests__/ColumnMappingStep.test.tsx`:
  - [x] Renders `AsyncSearchableSelect` for column definition selection per column
  - [x] Selecting a column definition via search calls `onUpdateColumn` with `existingColumnDefinitionId`
  - [x] Clearing selection calls `onUpdateColumn` with `existingColumnDefinitionId: null`
  - [x] When column has a matched definition, displays read-only metadata (type, validation, canonical format, description)
  - [x] When column has no matched definition, shows "select a column definition" prompt
  - [x] Renders field-mapping editors: normalizedKey, defaultValue, format, required checkbox, primary key checkbox
  - [x] Renders enum values input when selected definition type is `enum`
  - [x] Renders reference editor when selected definition type is `reference` or `reference-array`
  - [x] Displays confidence chip
  - [x] Displays sample values
  - [x] Shows validation errors from `errors` prop
  - [x] Tabs switch between entities
  - [x] Shows "No entities available" when entities array is empty
  - [x] Remove all tests for: inline label editing, type dropdown, validation preset/pattern/message editing, canonical format dropdown, TYPE_FIELD_CONFIG behavior

### 8.2 Implementation (Green)

- [x] Remove constants: `COLUMN_TYPE_OPTIONS`, `STRING_CANONICAL_FORMAT_OPTIONS`, `NUMBER_CANONICAL_FORMAT_OPTIONS`, `VALIDATION_PRESETS`, `TYPE_FIELD_CONFIG`, `DEFAULT_TYPE_CONFIG`
- [x] Simplify `ColumnRowProps` — add `columnDef: ColumnDefinition | null`
- [x] Rewrite `ColumnRow`:
  - [x] `AsyncSearchableSelect` for column definition key (keep `freeSolo={false}` — must pick existing)
  - [x] Read-only metadata display when definition selected (Typography/Chips for type, validation, format, description)
  - [x] Field-mapping editors (normalizedKey, defaultValue, format, required, isPrimaryKey, enumValues)
  - [x] Conditional `ReferenceEditor` when `columnDef?.type` is `reference` or `reference-array`
- [x] Simplify `ReferenceEditor` — operates on flat `RecommendedColumn` fields, not `recommended` nesting
- [x] Remove all column-definition-level handlers
- [x] Update `ColumnMappingStep` to resolve `columnDef` from `columnDefsByKey` using the column's `existingColumnDefinitionId`

### 8.3 Verification

- [x] `npm run test -- --testPathPattern ColumnMappingStep`

---

## Step 9: Update Workflow Container & API Hooks

### 9.1 Tests (Red)

- [x] Update `apps/web/src/workflows/CSVConnector/__tests__/CSVConnectorWorkflow.test.tsx`:
  - [x] Mocked recommendations use new flat `RecommendedColumn` shape
  - [x] Column mapping step receives correct simplified props
  - [x] Workflow navigation still works (steps 0-3)
  - [x] Confirm triggers with correct payload shape
  - [x] Remove tests for column-definition-editing interactions

### 9.2 Implementation (Green)

- [x] Update `CSVConnectorWorkflow.component.tsx`:
  - [x] Remove column-definition-level update logic from `onUpdateColumn` calls
  - [x] Resolve `columnDef` type for reference detection using `columnDefsByKey` instead of `col.recommended.type`
  - [x] Pass simplified props to `ColumnMappingStep`
- [x] Update `column-definitions.api.ts` — enhance `useColumnDefinitionKeySearch` option labels to include description
- [x] Update `ReviewStep.component.tsx` — display column definition info by looking up `columnDefsByKey` instead of reading from `col.recommended`

### 9.3 Verification

- [x] `npm run test -- --testPathPattern CSVConnectorWorkflow`
- [x] `npm run test -- --testPathPattern ReviewStep`

---

## Step 10: Full Verification & Cleanup

### 10.1 Full Test Suite

- [x] `npm run test` — all tests pass across all packages (pre-existing Tabs.test.tsx and SettingsView snapshot failures only)
- [x] `npm run type-check` — no type errors (all 3 packages clean)
- [x] `npm run lint` — no lint errors (0 errors, only pre-existing warnings)
- [x] `npm run build` — successful build (all 3 packages)

### 10.2 Manual Verification

- [ ] Start dev servers: `npm run dev`
- [ ] Navigate to CSV upload workflow
- [ ] **Step 0 (Upload)**: Upload a CSV file — file processes successfully
- [ ] **Step 1 (Entities)**: Entity detected and editable
- [ ] **Step 2 (Column Mapping)**:
  - [ ] Each CSV column shows a column definition search select
  - [ ] Searching returns matching system definitions
  - [ ] Selecting a definition shows read-only metadata (type, validation, format)
  - [ ] No inline editing of column definition properties (no type dropdown, no validation fields)
  - [ ] Field-mapping fields are editable (normalizedKey, required, default, format, primaryKey)
  - [ ] Reference columns show entity/column selectors when definition type is reference
  - [ ] Validation fires when no definition selected — blocks navigation
  - [ ] AI/heuristic recommendations pre-select definitions with confidence scores
- [ ] **Step 3 (Review & Import)**: Confirm succeeds, records imported
- [ ] Verify column definitions page still works independently (CRUD operations unaffected)

### 10.3 Edge Cases

- [ ] Upload CSV where AI can't find a strong match for a column — low confidence shown, user can manually search and select
- [ ] Upload CSV with reference columns — reference editor works correctly
- [ ] Upload CSV with all common types (string, number, date, boolean, enum) — all auto-matched to seed definitions
- [ ] Upload multiple CSVs in one batch — each entity's columns independently selectable
- [ ] Re-run `npm run db:seed` on existing database — no errors, no duplicates

### 10.4 Cleanup

- [x] Remove any dead code flagged by type-check or lint
- [x] Verify no orphaned imports from removed features
- [x] Confirm `ColumnRecommendationActionEnum` is fully removed (grep for `create_new` and `match_existing` in frontend)
- [x] Confirm `UPLOAD_CONFLICTING_COLUMN_DEFINITIONS` API code removed if unused
