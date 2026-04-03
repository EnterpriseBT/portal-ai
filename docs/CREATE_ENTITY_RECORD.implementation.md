# Create Entity Record — Implementation Plan

Reference: [Spec](./CREATE_ENTITY_RECORD.spec.md) | [Discovery](./CREATE_ENTITY_RECORD.discovery.md)

---

## Phase 1: Contract & Schema Foundation

Establishes the shared types that all subsequent phases depend on. Pure type-level changes — no runtime behavior changes yet.

### 1.1 Enrich `ColumnDefinitionSummarySchema`

- [x] **File:** `packages/core/src/contracts/entity-record.contract.ts`
- [x] Add `required: z.boolean()` to `ColumnDefinitionSummarySchema`
- [x] Add `enumValues: z.array(z.string()).nullable()` to `ColumnDefinitionSummarySchema`
- [x] Add `defaultValue: z.string().nullable()` to `ColumnDefinitionSummarySchema`
- [x] Update the `ColumnDefinitionSummary` type export (auto-inferred from schema)

### 1.2 Add create record contract schemas

- [x] **File:** `packages/core/src/contracts/entity-record.contract.ts`
- [x] Add `EntityRecordCreateRequestBodySchema`: `{ normalizedData: z.record(z.string(), z.unknown()), sourceId: z.string().optional() }`
- [x] Add `EntityRecordCreateRequestBody` type export
- [x] Add `EntityRecordCreateResponsePayloadSchema`: `{ record: EntityRecordSchema }`
- [x] Add `EntityRecordCreateResponsePayload` type export
- [x] Export new schemas and types from package barrel

### 1.3 Contract tests

- [x] **File:** `packages/core/src/__tests__/contracts/entity-record.contract.test.ts` (create or update)
- [x] Test: `ColumnDefinitionSummarySchema` accepts enriched fields `{ key, label, type, required, enumValues, defaultValue }`
- [x] Test: `ColumnDefinitionSummarySchema` rejects payload missing `required` field
- [x] Test: `EntityRecordCreateRequestBodySchema` accepts `{ normalizedData }` only
- [x] Test: `EntityRecordCreateRequestBodySchema` accepts `{ normalizedData, sourceId }`
- [x] Test: `EntityRecordCreateRequestBodySchema` rejects empty body `{}`
- [x] Test: `EntityRecordCreateResponsePayloadSchema` validates full record shape

### Verification

- [x] `npm run type-check` passes
- [x] `npm run lint` passes
- [x] `npm run test -- --selectProjects core` passes (or equivalent for `packages/core` tests)
- [x] All Phase 1 contract tests pass

---

## Phase 2: API Backend

Adds the `POST /` endpoint and updates `resolveColumns()` to return enriched column summaries. Fully testable via integration tests before any frontend work begins.

### 2.1 Add API error code

- [x] **File:** `apps/api/src/constants/api-codes.constants.ts`
- [x] Add `ENTITY_RECORD_CREATE_FAILED = "ENTITY_RECORD_CREATE_FAILED"` to `ApiCode` enum

### 2.2 Update `resolveColumns()` — entity record router

- [x] **File:** `apps/api/src/routes/entity-record.router.ts`
- [x] Update `resolveColumns()` return mapping to include `required: cd.required`, `enumValues: cd.enumValues ?? null`, `defaultValue: cd.defaultValue ?? null`

### 2.3 Update `resolveColumns()` — adapter utility

- [x] **File:** `apps/api/src/utils/adapter.util.ts`
- [x] Apply same enrichment: `required`, `enumValues`, `defaultValue` in the return mapping

### 2.4 Add `POST /` endpoint

- [x] **File:** `apps/api/src/routes/entity-record.router.ts`
- [x] Add Swagger/OpenAPI JSDoc block above handler (follow `POST /import` pattern)
- [x] Implement handler:
  1. `resolveEntityOrThrow(connectorEntityId)`
  2. `assertWriteCapability(connectorEntityId)`
  3. Parse body with `EntityRecordCreateRequestBodySchema` → 400 if invalid
  4. Extract `{ userId, organizationId }` from `req.application!.metadata`
  5. Create model via `EntityRecordModelFactory.create(userId)`
  6. `model.update()` with `organizationId`, `connectorEntityId`, `data: body.normalizedData`, `normalizedData: body.normalizedData`, `sourceId: body.sourceId ?? crypto.randomUUID()`, `checksum: "manual"`, `syncedAt: Date.now()`
  7. `repository.create(model.parse())`
  8. Return 201 with `{ record }`
- [x] Add `import { randomUUID } from "crypto"` (or use `crypto.randomUUID()`)
- [x] Add import for `EntityRecordCreateRequestBodySchema` and response type from `@portalai/core/contracts`
- [x] Ensure route is registered **before** `/:recordId` routes to avoid path conflict

### 2.5 API integration tests

- [x] **File:** `apps/api/src/__tests__/__integration__/routes/entity-record.router.integration.test.ts`
- [x] Add `describe("POST /")` block

**Success cases:**
- [x] Test: creates a record with `normalizedData` → 201, response has matching `normalizedData`
- [x] Test: mirrors `normalizedData` into `data` → `record.data` equals `record.normalizedData`
- [x] Test: auto-generates `sourceId` when omitted → `record.sourceId` is a valid UUID
- [x] Test: uses provided `sourceId` when present → `record.sourceId === "custom-123"`
- [x] Test: sets `checksum` to `"manual"`
- [x] Test: sets `syncedAt` to approximately `Date.now()`
- [x] Test: new record appears in subsequent `GET /` list response

**Error cases:**
- [x] Test: returns 400 for missing `normalizedData` (empty body)
- [x] Test: returns 400 for invalid body (`normalizedData: "not-an-object"`)
- [x] Test: returns 404 for non-existent `connectorEntityId`
- [x] Test: returns 422 when write capability is disabled on the connector instance

### Verification

- [x] `npm run type-check` passes
- [x] `npm run lint` passes
- [x] `npm run test -- --selectProjects api` passes (or equivalent for `apps/api` tests)
- [x] All Phase 2 integration tests pass
- [ ] Manual verification: `curl -X POST .../records` returns 201 with correct shape (optional)

---

## Phase 3: Serialization Utility

Pure TypeScript utility with no UI dependencies. Provides the serialize/validate/initialize logic consumed by both dialogs in later phases.

### 3.1 Implement `record-field-serialization.util.ts`

- [x] **File:** `apps/web/src/utils/record-field-serialization.util.ts`
- [x] Implement `serializeRecordFields(columns, values)` → `{ data, errors }`
  - `string`, `date`, `datetime`, `reference`, `enum`: empty → `null`, otherwise string as-is
  - `number`, `currency`: empty → `null`, otherwise `Number(value)` (error if `isNaN`)
  - `boolean`: value as-is (never null)
  - `json`: empty → `null`, otherwise `JSON.parse(value)` (error if throws)
  - `array`: empty → `null`, otherwise `JSON.parse(value)` + `Array.isArray` check (error if either fails)
  - `reference-array`: empty → `null`, otherwise split by comma, trim, filter empty → `string[]`
- [x] Implement `validateRequiredFields(columns, values)` → `Record<string, string>`
  - Return `"<Label> is required"` for required columns with empty/null/undefined values
  - Boolean fields always pass (no empty state)
- [x] Implement `initializeRecordFields(columns, existingData?)` → `Record<string, unknown>`
  - Create mode (no `existingData`): use `defaultValue` if set, else type-appropriate empty (`""`, `false`, etc.)
  - Edit mode (`existingData` provided): deserialize — `JSON.stringify(val, null, 2)` for json/array objects, `String(val)` for numbers, pass through strings and booleans

### 3.2 Serialization utility tests

- [x] **File:** `apps/web/src/__tests__/record-field-serialization.test.ts`

**`serializeRecordFields`:**
- [x] Test: serializes string field → `"Alice"` stays `"Alice"`
- [x] Test: serializes empty string to `null`
- [x] Test: serializes number field → `"25"` becomes `25`
- [x] Test: returns error for non-numeric number field → `"abc"` errors
- [x] Test: serializes empty number to `null`
- [x] Test: serializes boolean `true` → stays `true`
- [x] Test: serializes boolean `false` → stays `false`
- [x] Test: serializes date field → string as-is
- [x] Test: serializes json field → `'{"a":1}'` becomes `{ a: 1 }`
- [x] Test: returns error for invalid json → parse error message
- [x] Test: serializes array field → `'["a","b"]'` becomes `["a", "b"]`
- [x] Test: returns error for non-array json in array field
- [x] Test: serializes reference-array → `"a, b, c"` becomes `["a", "b", "c"]`
- [x] Test: serializes empty reference-array to `null`
- [x] Test: serializes currency same as number
- [x] Test: serializes enum → string as-is
- [x] Test: serializes empty enum to `null`

**`validateRequiredFields`:**
- [x] Test: returns error for empty required string
- [x] Test: returns error for null required field
- [x] Test: passes for non-empty required field
- [x] Test: passes for non-required empty field
- [x] Test: boolean required fields always pass

**`initializeRecordFields`:**
- [x] Test: initializes string with `defaultValue`
- [x] Test: initializes string without default → `""`
- [x] Test: initializes boolean → `false`
- [x] Test: initializes json → `""`
- [x] Test: deserializes existing json object to pretty-printed string
- [x] Test: deserializes existing number to string
- [x] Test: deserializes existing boolean → pass through
- [x] Test: passes through existing string

### Verification

- [x] `npm run type-check` passes
- [x] `npm run lint` passes
- [x] `npm run test -- --selectProjects web` — all serialization tests pass
- [x] All 30 serialization/validation/initialization tests green

---

## Phase 4: DynamicRecordField Component

Shared presentational component. Testable in isolation before wiring into any dialog.

### 4.1 Implement `DynamicRecordField`

- [x] **File:** `apps/web/src/components/DynamicRecordField.component.tsx`
- [x] Define `DynamicRecordFieldProps` interface (see Spec §2.1)
- [x] Implement type-switch rendering:
  - `string` → `<TextField>`
  - `number`, `currency` → `<TextField type="number">` with `step="any"`
  - `boolean` → `<FormControlLabel>` + `<Checkbox>`
  - `date` → `<TextField type="date">` with `InputLabelProps={{ shrink: true }}`
  - `datetime` → `<TextField type="datetime-local">` with `InputLabelProps={{ shrink: true }}`
  - `enum` → `<TextField select>` + `<MenuItem>` per `enumValues` entry; fallback to plain text if `enumValues` is null/empty; include empty "None" option if not required
  - `json` → code-editor styled `<TextField multiline>` (see below)
  - `array` → code-editor styled `<TextField multiline>` (see below)
  - `reference` → `<TextField>`
  - `reference-array` → `<TextField multiline rows={2}>` with comma-separated placeholder
- [x] JSON/Array code-editor styling via `sx`:
  - Font: `theme.typography.monospace.fontFamily` at `0.875rem`
  - Background: `theme.palette.action.hover`
  - `minRows={4}`, auto-expand
  - Placeholder: `{}` for json, `[]` for array
  - On blur: `JSON.parse` → pretty-print if valid, set error if invalid
  - For array: additionally validate `Array.isArray(parsed)`
- [x] Accessibility props on all fields:
  - `error={touched && !!error}`, `helperText={touched && error}`
  - `slotProps={{ htmlInput: { "aria-invalid": touched && !!error } }}`
  - `required={column.required}` (except boolean)
- [x] `disabled`, `inputRef` prop passthrough

### 4.2 DynamicRecordField tests

- [x] **File:** `apps/web/src/__tests__/DynamicRecordField.test.tsx`

**Rendering by type (12 tests):**
- [x] Test: renders text input for `string` type
- [x] Test: renders `type="number"` input for `number` type
- [x] Test: renders `type="number"` input for `currency` type
- [x] Test: renders checkbox for `boolean` type
- [x] Test: renders `type="date"` input for `date` type
- [x] Test: renders `type="datetime-local"` input for `datetime` type
- [x] Test: renders select with options for `enum` type
- [x] Test: renders plain text field for `enum` when `enumValues` is null
- [x] Test: renders multiline monospace field for `json` type
- [x] Test: renders multiline monospace field for `array` type
- [x] Test: renders text input for `reference` type
- [x] Test: renders multiline field for `reference-array` type

**JSON/Array code-editor behavior (6 tests):**
- [x] Test: shows placeholder `{}` for empty json field
- [x] Test: shows placeholder `[]` for empty array field
- [x] Test: pretty-prints valid JSON on blur
- [x] Test: shows parse error on blur for invalid JSON
- [x] Test: clears error when corrected and blurred
- [x] Test: validates array type rejects non-array JSON

**Validation and accessibility (5 tests):**
- [x] Test: shows error when `touched` and `error` are set
- [x] Test: does not show error when `touched` is false
- [x] Test: sets `aria-invalid="true"` when `touched` and `error`
- [x] Test: sets `required` attribute when `column.required` is true
- [x] Test: boolean field does not show `required`

**Interaction (6 tests):**
- [x] Test: calls `onChange` with string value for text fields
- [x] Test: calls `onChange` with string value for number fields
- [x] Test: calls `onChange` with boolean value for checkbox
- [x] Test: calls `onChange` with string value for enum select
- [x] Test: disables input when `disabled` is true
- [x] Test: passes `inputRef` to the underlying input

### Verification

- [x] `npm run type-check` passes
- [x] `npm run lint` passes
- [x] `npm run test -- --selectProjects web` — all DynamicRecordField tests pass
- [x] All 29 DynamicRecordField tests green
- [ ] Visual review in Storybook (optional — story file not required)

---

## Phase 5: EditEntityRecordDialog Upgrade

Upgrades the existing edit dialog to use `DynamicRecordField` and the serialization utility. No new API or SDK changes. Testable independently.

### 5.1 Refactor `EditEntityRecordDialog`

- [x] **File:** `apps/web/src/components/EditEntityRecordDialog.component.tsx`
- [x] Import `DynamicRecordField`
- [x] Import `serializeRecordFields`, `validateRequiredFields`, `initializeRecordFields` from `record-field-serialization.util`
- [x] Change `values` state type from `Record<string, string>` to `Record<string, unknown>`, initialized via `initializeRecordFields(columns, normalizedData)`
- [x] Add `errors: Record<string, string>` state (initially `{}`)
- [x] Add `touched: Record<string, boolean>` state (initially `{}`)
- [x] Update `handleChange` to accept `(key: string, value: unknown)`
- [x] Add `handleBlur` to set `touched[key] = true`
- [x] Rewrite `handleSubmit`:
  1. Mark all fields as touched
  2. Run `validateRequiredFields(columns, values)` → merge errors
  3. Run `serializeRecordFields(columns, values)` → merge serialization errors
  4. If any errors, call `focusFirstInvalidField()` and return
  5. Compare serialized values against original `normalizedData` for change detection
  6. If no changes, call `onClose()` and return
  7. Call `onSubmit({ normalizedData: serializedData })`
- [x] Replace the `columns.map(col => <TextField ...>)` loop with `columns.map(col => <DynamicRecordField ...>)` passing `column`, `value`, `onChange`, `error`, `touched`, `inputRef`, `disabled`
- [x] Pass `onBlur` handling to `DynamicRecordField` (via the existing blur-on-json behavior internal to the component, plus the parent's `touched` tracking)

### 5.2 EditEntityRecordDialog tests

- [x] **File:** `apps/web/src/__tests__/EditEntityRecordDialog.test.tsx` (new file)

**Rendering (5 tests):**
- [x] Test: renders dialog title and fields when `open={true}`
- [x] Test: does not render when `open={false}`
- [x] Test: renders type-appropriate inputs (checkbox for boolean, number input for number, multiline for json)
- [x] Test: deserializes existing json to pretty-printed string
- [x] Test: deserializes existing number to string

**Submission (4 tests):**
- [x] Test: calls `onSubmit` with updated `normalizedData` on Save click
- [x] Test: calls `onSubmit` on Enter key (form submit)
- [x] Test: calls `onClose` without `onSubmit` when no changes made
- [x] Test: does not call `onSubmit` when JSON field is invalid

**Cancel / Close (1 test):**
- [x] Test: calls `onClose` on Cancel click

**Loading state (1 test):**
- [x] Test: shows "Saving..." and disables buttons when `isPending`

**Server errors (2 tests):**
- [x] Test: renders `<FormAlert>` when `serverError` is provided
- [x] Test: does not render `<FormAlert>` when `serverError` is null

**Field validation (3 tests):**
- [x] Test: shows required error when clearing a required field and submitting
- [x] Test: shows JSON parse error for invalid JSON on submit
- [x] Test: sets `aria-invalid="true"` on invalid fields

### Verification

- [x] `npm run type-check` passes
- [x] `npm run lint` passes
- [x] `npm run test -- --selectProjects web` — all EditEntityRecordDialog tests pass
- [x] All 16 EditEntityRecordDialog tests green
- [x] Existing `EntityRecordDetail.view` tests still pass (edit dialog consumed there)
- [ ] Manual smoke test: edit a record in the browser, verify type-aware fields render correctly

---

## Phase 6: CreateEntityRecordDialog + Frontend SDK

New dialog component, SDK method, and wiring into the view. Depends on all previous phases.

### 6.1 Frontend SDK — `create` method

- [x] **File:** `apps/web/src/api/entity-records.api.ts`
- [x] Add import for `EntityRecordCreateRequestBody` and `EntityRecordCreateResponsePayload` from `@portalai/core/contracts`
- [x] Add `create` method:
  ```typescript
  create: (connectorEntityId: string) =>
    useAuthMutation<EntityRecordCreateResponsePayload, EntityRecordCreateRequestBody>({
      url: recordsUrl(connectorEntityId),
    }),
  ```

### 6.2 Implement `CreateEntityRecordDialog`

- [x] **File:** `apps/web/src/components/CreateEntityRecordDialog.component.tsx`
- [x] Define `CreateEntityRecordDialogProps` interface (see Spec §3.1)
- [x] Implement outer guard: return `null` when `!open`
- [x] Implement inner `CreateForm`:
  - `values` state initialized via `initializeRecordFields(columns)` (no existing data)
  - `errors` state: `Record<string, string>`, initially `{}`
  - `touched` state: `Record<string, boolean>`, initially `{}`
  - `useDialogAutoFocus(true)` ref on first field
  - On blur: set `touched[key] = true`
  - On submit:
    1. Mark all fields as touched
    2. `validateRequiredFields(columns, values)` → merge errors
    3. `serializeRecordFields(columns, values)` → merge serialization errors
    4. If errors, `focusFirstInvalidField()` and return
    5. `onSubmit({ normalizedData: serializedData })`
  - `<Modal>` with `slotProps.paper.component="form"`, `onSubmit` handler
  - Title: `"New Record"`
  - Body: `columns.map(col => <DynamicRecordField ...>)` + `<FormAlert>`
  - Actions: Cancel + Create buttons, both `type="button"`

### 6.3 CreateEntityRecordDialog tests

- [x] **File:** `apps/web/src/__tests__/CreateEntityRecordDialog.test.tsx`
- [x] Use ESM dynamic imports with `jest.unstable_mockModule` (same pattern as `CreateConnectorEntityDialog.test.tsx`)

**Rendering (4 tests):**
- [x] Test: renders dialog title and fields when `open={true}`
- [x] Test: does not render when `open={false}`
- [x] Test: renders type-appropriate inputs for each column
- [x] Test: pre-fills default values from columns

**Submission (5 tests):**
- [x] Test: calls `onSubmit` with serialized `normalizedData` on Create click
- [x] Test: calls `onSubmit` on Enter key (form submit)
- [x] Test: does not call `onSubmit` when required field is empty
- [x] Test: does not call `onSubmit` when JSON field is invalid
- [x] Test: serializes boolean `false` correctly (not `null`)

**Cancel / Close (1 test):**
- [x] Test: calls `onClose` on Cancel click

**Loading state (1 test):**
- [x] Test: shows "Creating..." and disables buttons when `isPending`

**Server errors (2 tests):**
- [x] Test: renders `<FormAlert>` when `serverError` is provided
- [x] Test: does not render `<FormAlert>` when `serverError` is null

**Field validation (5 tests):**
- [x] Test: shows required error for empty required field on submit
- [x] Test: shows JSON parse error for invalid JSON on submit
- [x] Test: sets `aria-invalid="true"` on invalid fields
- [x] Test: sets `required` attribute on required fields
- [x] Test: does not show errors before submit or blur

### Verification

- [x] `npm run type-check` passes
- [x] `npm run lint` passes
- [x] `npm run test -- --selectProjects web` — all CreateEntityRecordDialog tests pass
- [x] All 18 CreateEntityRecordDialog tests green

---

## Phase 7: View Integration

Wires the create dialog into `EntityDetail.view`, adds the "New Record" button, and handles mutation lifecycle. Final integration phase.

### 7.1 Wire into `EntityDetail.view`

- [x] **File:** `apps/web/src/views/EntityDetail.view.tsx`
- [x] Import `CreateEntityRecordDialog`
- [x] Import `entityRecords` SDK (if not already imported for other operations)
- [x] Import `toServerError` from `utils/api.util`
- [x] Add `createDialogOpen` state: `useState(false)`
- [x] Add `createMutation` using `entityRecords.create(connectorEntityId)`
- [x] Add `handleCreate` callback:
  1. Call `createMutation.mutate(body)`
  2. On success: `queryClient.invalidateQueries({ queryKey: queryKeys.entityRecords.root })`
  3. Set `createDialogOpen(false)`
  4. Reset mutation state
- [x] Add "New Record" `<Button>` as `primaryAction` prop on the Records `<PageSection>`
  - Visible only when `isWriteEnabled && columnDefs.length > 0`
  - `onClick={() => setCreateDialogOpen(true)}`
- [x] Render `<CreateEntityRecordDialog>`:
  - `open={createDialogOpen}`
  - `onClose={() => setCreateDialogOpen(false)}`
  - `columns={columnDefs}`
  - `onSubmit={handleCreate}`
  - `isPending={createMutation.isPending}`
  - `serverError={toServerError(createMutation.error)}`

### 7.2 View integration tests

- [x] **File:** `apps/web/src/__tests__/EntityDetailView.test.tsx` (update existing or create)

- [x] Test: shows "New Record" button when `isWriteEnabled` and columns exist
- [x] Test: hides "New Record" button when `isWriteEnabled` is false
- [x] Test: hides "New Record" button when no columns defined
- [x] Test: opens `CreateEntityRecordDialog` on "New Record" click
- [x] Test: renders CreateEntityRecordDialog when createRecordDialogOpen is true

### Verification

- [x] `npm run type-check` passes
- [x] `npm run lint` passes
- [x] `npm run test -- --selectProjects web` — all view integration tests pass
- [x] All 5 view integration tests green
- [x] **Full test suite:** `npm run test` passes across all projects
- [x] **Full build:** `npm run build` succeeds
- [ ] Manual end-to-end smoke test:
  1. Navigate to a writable connector entity's detail page
  2. Verify "New Record" button appears in Records section
  3. Click "New Record" → dialog opens with type-appropriate fields
  4. Fill fields, verify JSON auto-formats on blur
  5. Submit → record appears in table
  6. Edit the created record → verify type-aware fields and values
  7. Verify "New Record" button is hidden for read-only connector entities

---

## Summary

| Phase | Deliverable | New Tests | Files Changed |
|-------|-------------|-----------|---------------|
| 1 | Contract & schema foundation | 6 | 1 new, 1 modified |
| 2 | API backend (`POST /`, `resolveColumns` enrichment) | 11 | 3 modified, 1 test updated |
| 3 | Serialization utility | 30 | 1 new, 1 test new |
| 4 | DynamicRecordField component | 29 | 1 new, 1 test new |
| 5 | EditEntityRecordDialog upgrade | 16 | 1 modified, 1 test new |
| 6 | CreateEntityRecordDialog + SDK | 18 | 2 new, 1 modified, 1 test new |
| 7 | View integration | 5 | 1 modified, 1 test updated |
| **Total** | | **115** | **7 new, 7 modified** |
