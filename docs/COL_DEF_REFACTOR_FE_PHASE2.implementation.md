# Frontend Phase 2 — Column Definition UI: TDD Implementation Checklist

> Scope: Update Column Definition views, dialogs, and card components to align with the refactored schema. Remove old fields (`required`, `defaultValue`, `format`, `enumValues`, `"currency"` type) from UI, add new fields (`validationPattern`, `validationMessage`, `canonicalFormat`), and add validation preset dropdown to create/edit dialogs.
>
> Prerequisite: Frontend Phase 1 (SDK & Contracts) must be complete.

---

## Table of Contents

- [1. Column Definition List View](#1-column-definition-list-view)
- [2. Create Column Definition Dialog](#2-create-column-definition-dialog)
- [3. Edit Column Definition Dialog](#3-edit-column-definition-dialog)
- [4. Column Definition Detail View](#4-column-definition-detail-view)
- [5. Column Definition Card Component](#5-column-definition-card-component)
- [6. Delete Column Definition Dialog](#6-delete-column-definition-dialog)
- [7. Smoke Test & Verification](#7-smoke-test--verification)

---

## Current State Assessment

Several source files have **already been updated** in prior commits to reflect the new schema:

| File | Status | Remaining Work |
|------|--------|----------------|
| `CreateColumnDefinitionDialog.component.tsx` | Already updated — new fields, old fields removed | Add validation preset dropdown; fix tests |
| `EditColumnDefinitionDialog.component.tsx` | Already updated — new fields, old fields removed | Add revalidation confirmation; add tests |
| `ColumnDefinition.component.tsx` | Already updated — card shows new fields | Verify tests |
| `ColumnDefinitionDetail.view.tsx` | Already updated — metadata shows new fields | Add `normalizedKey`/`required`/`defaultValue`/`format`/`enumValues` columns to field mapping table; fix tests |
| `ColumnDefinitionList.view.tsx` | **Needs update** — still has `required` filter | Remove `required` filter; fix tests |

---

## 1. Column Definition List View

**File:** `apps/web/src/views/ColumnDefinitionList.view.tsx`

The list view still defines a `required` boolean filter in `usePagination` (line 67). The `"currency"` type is already removed from `ColumnDataTypeEnum`, so `TYPE_OPTIONS` is correct. The card component already displays the new fields.

### 1.1 Write tests — remove required filter

> **Test file:** `apps/web/src/__tests__/ColumnDefinitionListView.test.tsx` (existing)

- [x] **Test:** Verify that no "Required" filter option is available in the filter UI
- [x] **Test:** Verify that `TYPE_OPTIONS` does not contain `"currency"` (the type select in the filter should not list it)

### 1.2 Implement — remove required filter

> **File:** `apps/web/src/views/ColumnDefinitionList.view.tsx`

- [x] Remove the `required` boolean filter from the `usePagination` `filters` array (lines 66–69):
  ```diff
  -     {
  -       type: "boolean",
  -       field: "required",
  -       label: "Required",
  -     },
  ```
- [x] Run tests from 1.1 — all should pass

### 1.3 Verify existing tests still pass

> **Test file:** `apps/web/src/__tests__/ColumnDefinitionListView.test.tsx`

- [x] Verify existing tests (loading, cards, empty state, error, sort, breadcrumbs, create button, create dialog) still pass
- [x] No tests in this file reference `required` or `"currency"` — confirm this is true

---

## 2. Create Column Definition Dialog

**File:** `apps/web/src/components/CreateColumnDefinitionDialog.component.tsx`

The dialog has already been updated: old fields (`required`, `defaultValue`, `format`, `enumValues`) are removed, new fields (`validationPattern`, `validationMessage`, `canonicalFormat`) are added. The spec also calls for a **validation preset dropdown** that auto-populates `validationPattern` and `validationMessage`.

### 2.1 Write tests — new field rendering

> **Test file:** `apps/web/src/__tests__/CreateColumnDefinitionDialog.test.tsx` (existing — needs update)

- [x] **Test:** Renders `Validation Pattern` text field
- [x] **Test:** Renders `Validation Message` text field
- [x] **Test:** Renders `Canonical Format` text field
- [x] **Test:** Does NOT render `Required` checkbox
- [x] **Test:** Does NOT render `Default Value` text field
- [x] **Test:** Does NOT render `Format` text field
- [x] **Test:** Does NOT render `Enum Values` text field
- [x] **Test:** Type select does NOT contain `"currency"` option

### 2.2 Write tests — validation preset dropdown

- [x] **Test:** Renders a "Validation Preset" select/dropdown
- [x] **Test:** Selecting "Email" preset auto-populates `validationPattern` with an email regex and `validationMessage` with "Must be a valid email address"
- [x] **Test:** Selecting "URL" preset auto-populates `validationPattern` with a URL regex and `validationMessage` with "Must be a valid URL"
- [x] **Test:** Selecting "Phone" preset auto-populates the relevant pattern and message
- [x] **Test:** Selecting "UUID" preset auto-populates the relevant pattern and message
- [x] **Test:** Selecting "None" or clearing the preset does not overwrite manually edited `validationPattern`/`validationMessage`
- [x] **Test:** Manually editing `validationPattern` after selecting a preset does not revert to the preset value

### 2.3 Write tests — submit payload

- [x] **Test:** Submitting with minimal fields produces payload `{ key, label, type, description: null, validationPattern: null, validationMessage: null, canonicalFormat: null }` — no `required`, `defaultValue`, `format`, `enumValues`
- [x] **Test:** Submitting with all optional fields populated produces payload including `validationPattern`, `validationMessage`, `canonicalFormat`

### 2.4 Update existing tests

> **Test file:** `apps/web/src/__tests__/CreateColumnDefinitionDialog.test.tsx`

Several existing tests reference removed fields and will fail:

- [x] **Fix test #7** ("submit with correct payload for minimal valid form"): Update expected payload — remove `required: false`, `defaultValue: null`, `format: null`, `enumValues: null`; add `validationPattern: null`, `validationMessage: null`, `canonicalFormat: null`
- [x] **Fix test #8** ("submit with all optional fields populated"): Rewrite to populate `validationPattern`, `validationMessage`, `canonicalFormat` instead of `required`, `defaultValue`, `format`, `enumValues`
- [x] **Fix test #21** ("show enum values field only when type is 'enum'"): Remove — `enumValues` is no longer a column definition field (it moved to field mappings)
- [x] **Fix test #22** ("hide enum values field when type changes away from 'enum'"): Remove — same reason

### 2.5 Implement — validation preset dropdown

> **File:** `apps/web/src/components/CreateColumnDefinitionDialog.component.tsx`

- [x] Define a `VALIDATION_PRESETS` constant:
  ```ts
  const VALIDATION_PRESETS = [
    { label: "None", value: "", pattern: "", message: "" },
    { label: "Email", value: "email", pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$", message: "Must be a valid email address" },
    { label: "URL", value: "url", pattern: "^https?://.*", message: "Must be a valid URL" },
    { label: "Phone", value: "phone", pattern: "^\\+?[\\d\\s\\-().]+$", message: "Must be a valid phone number" },
    { label: "UUID", value: "uuid", pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", message: "Must be a valid UUID" },
  ];
  ```
- [x] Add `preset` to `ColumnDefinitionFormState` (string, default `""`)
- [x] Add a `TextField select` for "Validation Preset" above the `validationPattern` field
- [x] When a preset is selected, auto-populate `validationPattern` and `validationMessage` with the preset values
- [x] The `preset` field is NOT included in the submit payload — it's UI-only
- [x] Run tests from 2.1, 2.2, 2.3, 2.4 — all should pass

---

## 3. Edit Column Definition Dialog

**File:** `apps/web/src/components/EditColumnDefinitionDialog.component.tsx`

The dialog has already been updated with new fields. The spec calls for a **revalidation confirmation** when `validationPattern` or `canonicalFormat` changes.

### 3.1 Write tests — basic rendering and fields

> **Test file:** `apps/web/src/__tests__/EditColumnDefinitionDialog.test.tsx` (new)

- [x] **Test:** Renders "Edit Column Definition" title when open
- [x] **Test:** Does not render when `open={false}`
- [x] **Test:** Pre-fills form with column definition values (`label`, `type`, `description`, `validationPattern`, `validationMessage`, `canonicalFormat`)
- [x] **Test:** Shows Key as a disabled/read-only field
- [x] **Test:** Renders `Validation Pattern`, `Validation Message`, `Canonical Format` text fields
- [x] **Test:** Does NOT render `Required`, `Default Value`, `Format`, `Enum Values` fields
- [x] **Test:** Type select does NOT contain `"currency"` option
- [x] **Test:** Type select disables types not in `ALLOWED_TYPE_TRANSITIONS` for current type

### 3.2 Write tests — submit payload

- [x] **Test:** Submitting with only label changed sends `{ label: "new" }` — no removed fields
- [x] **Test:** Submitting with `validationPattern` changed sends only the changed field
- [x] **Test:** Submitting with no changes calls `onClose` without calling `onSubmit`

### 3.3 Write tests — revalidation confirmation

- [x] **Test:** When `validationPattern` is changed and Save is clicked, a confirmation message is displayed before submitting (e.g., "Changing validation pattern will trigger re-validation of affected records")
- [x] **Test:** When `canonicalFormat` is changed and Save is clicked, a confirmation message is displayed
- [x] **Test:** When only `label` or `description` is changed, no confirmation is shown
- [x] **Test:** Confirming the revalidation warning calls `onSubmit` with the changed fields

### 3.4 Write tests — standard dialog behavior

- [x] **Test:** Calls `onClose` on Cancel click
- [x] **Test:** Shows "Saving..." and disables buttons when `isPending={true}`
- [x] **Test:** Renders `<FormAlert>` when `serverError` is provided
- [x] **Test:** Does not render `<FormAlert>` when `serverError` is null
- [x] **Test:** Shows warnings from API response when `warnings` array is non-empty
- [x] **Test:** Supports Enter key submission (form submit event)
- [x] **Test:** `aria-invalid="true"` is set on label field when validation fails
- [x] **Test:** `required` attribute is present on label field

### 3.5 Implement — revalidation confirmation

> **File:** `apps/web/src/components/EditColumnDefinitionDialog.component.tsx`

- [x] Add state: `showRevalidationWarning` (boolean)
- [x] In `handleSubmit`, before calling `onSubmit`, check if `validationPattern` or `canonicalFormat` differs from the original column definition values
- [x] If either changed, set `showRevalidationWarning = true` and render an `<Alert severity="info">` with text: "Changing validation pattern or canonical format will trigger re-validation of affected records. This may take a moment."
- [x] Add a "Confirm & Save" button in the warning state that proceeds with `onSubmit`
- [x] Run tests from 3.1–3.4 — all should pass

---

## 4. Column Definition Detail View

**File:** `apps/web/src/views/ColumnDefinitionDetail.view.tsx`

The metadata panel already shows new fields. The field mappings table needs additional columns for `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues` per mapping row.

### 4.1 Write tests — metadata panel

> **Test file:** `apps/web/src/__tests__/ColumnDefinitionDetailView.test.tsx` (existing — may need update)

- [x] **Test:** Displays `validationPattern` in metadata when set (already covered by existing test "display metadata section with all column definition fields" — verify)
- [x] **Test:** Displays `validationMessage` in metadata when set
- [x] **Test:** Displays `canonicalFormat` in metadata when set
- [x] **Test:** Does NOT display `Required`, `Default Value`, `Format`, `Enum Values` in metadata
- [x] **Test:** Hides `validationPattern`, `validationMessage`, `canonicalFormat` rows when values are null

### 4.2 Write tests — field mapping table columns

- [x] **Test:** Field mapping table displays `normalizedKey` column
- [x] **Test:** Field mapping table displays `required` column (with check icon when true)
- [x] **Test:** Field mapping table displays `defaultValue` column when value is non-null
- [x] **Test:** Field mapping table displays `format` column when value is non-null
- [x] **Test:** Field mapping table displays `enumValues` column when value is non-null (as comma-separated)

### 4.3 Implement — field mapping table columns

> **File:** `apps/web/src/views/ColumnDefinitionDetail.view.tsx` — `FieldMappingTable` component (line 392)

- [x] Add `normalizedKey` column to the `columns` array:
  ```ts
  { key: "normalizedKey", label: "Normalized Key" },
  ```
- [x] Add `required` column with check icon rendering:
  ```ts
  {
    key: "required",
    label: "Required",
    render: (value) => (value ? <CheckIcon fontSize="small" /> : null),
  },
  ```
- [x] Add `defaultValue` column:
  ```ts
  { key: "defaultValue", label: "Default Value" },
  ```
- [x] Add `format` column:
  ```ts
  { key: "format", label: "Format" },
  ```
- [x] Add `enumValues` column with array rendering:
  ```ts
  {
    key: "enumValues",
    label: "Enum Values",
    render: (value) => Array.isArray(value) ? value.join(", ") : null,
  },
  ```
- [x] Run tests from 4.1, 4.2 — all should pass

### 4.4 Verify existing tests still pass

- [x] Existing tests (loading, metadata, field mappings, empty state, error, breadcrumbs, create dialog) should pass without modification since the mock `makeColumnDefinition` and `makeFieldMapping` already use the new schema

---

## 5. Column Definition Card Component

**File:** `apps/web/src/components/ColumnDefinition.component.tsx`

The card already displays new fields and hides them when null. No code changes needed — only test verification.

### 5.1 Write tests — card displays new fields

> **Test file:** `apps/web/src/__tests__/ColumnDefinition.component.test.tsx` (existing)

- [x] **Test:** Card displays `validationPattern` when set (verify existing test coverage)
- [x] **Test:** Card displays `canonicalFormat` when set (verify existing test coverage)
- [x] **Test:** Card does NOT display `Required`, `Default Value`, `Format`, `Enum Values` labels
- [x] **Test:** Card hides `validationPattern`, `validationMessage`, `canonicalFormat` rows when null

### 5.2 Verify no code changes needed

- [x] Confirm `ColumnDefinitionCardUI` `MetadataList` items match the new schema (already correct — only shows `type`, `key`, `description`, `validationPattern`, `validationMessage`, `canonicalFormat`)
- [x] Run existing card tests — all should pass

---

## 6. Delete Column Definition Dialog

**File:** `apps/web/src/components/DeleteColumnDefinitionDialog.component.tsx`

### 6.1 Verify no changes needed

- [x] Confirm delete dialog has no references to removed fields or `"currency"` type
- [x] Run existing delete dialog tests — all should pass

---

## 7. Smoke Test & Verification

### 7.1 Type-check

- [x] Run `npx tsc --noEmit -p apps/web/tsconfig.json` — verify 0 errors in all files touched by this phase
- [x] Specifically verify no references to removed fields (`required`, `defaultValue`, `format`, `enumValues` as column definition properties) in:
  - `ColumnDefinitionList.view.tsx`
  - `CreateColumnDefinitionDialog.component.tsx`
  - `EditColumnDefinitionDialog.component.tsx`
  - `ColumnDefinitionDetail.view.tsx`
  - `ColumnDefinition.component.tsx`

### 7.2 Run all Phase 2 tests

- [x] Run all column-definition-related tests:
  ```bash
  NODE_OPTIONS=--experimental-vm-modules npx jest --testPathPattern="(CreateColumnDefinitionDialog|EditColumnDefinitionDialog|ColumnDefinitionListView|ColumnDefinitionDetailView|ColumnDefinition\.component)" --no-coverage
  ```
- [x] All tests pass

### 7.3 Run full web test suite

- [x] Run `cd apps/web && NODE_OPTIONS=--experimental-vm-modules npx jest --no-coverage` — note any failures outside Phase 2 scope (expected in Phase 3+ files)
- [x] Document any new failures introduced by Phase 2 changes (should be zero — Phase 2 only removes the `required` filter and adds the preset dropdown)

---

## Summary

| Step | Files Touched | Tests Updated/Created | Status |
|------|--------------|----------------------|--------|
| 1. List View | `ColumnDefinitionList.view.tsx` (removed `required` filter) | `ColumnDefinitionListView.test.tsx` (10 pass) | [x] |
| 2. Create Dialog | `CreateColumnDefinitionDialog.component.tsx` (added preset dropdown) | `CreateColumnDefinitionDialog.test.tsx` (29 pass, 4 fixed, 9 new) | [x] |
| 3. Edit Dialog | `EditColumnDefinitionDialog.component.tsx` (added revalidation confirm) | `EditColumnDefinitionDialog.test.tsx` (22 pass, new file) | [x] |
| 4. Detail View | `ColumnDefinitionDetail.view.tsx` (added 5 FM table columns) | `ColumnDefinitionDetailView.test.tsx` (10 pass, 1 new) | [x] |
| 5. Card Component | (no change) | `ColumnDefinition.component.test.tsx` (12 pass) | [x] |
| 6. Delete Dialog | (no change) | `DeleteColumnDefinitionDialog.test.tsx` (8 pass) | [x] |
| 7. Smoke Test | 0 type errors | 91/91 tests pass | [x] |
