# Frontend Phase 3 — Field Mapping UI: TDD Implementation Checklist

> Scope: Update Field Mapping dialogs and components to expose the new fields (`normalizedKey`, `required`, `defaultValue`, `format`, `enumValues`) that moved from ColumnDefinition to FieldMapping. Add revalidation confirmation to the edit dialog.
>
> Prerequisite: Frontend Phase 2 (Column Definition UI) must be complete.

---

## Table of Contents

- [1. Create Field Mapping Dialog](#1-create-field-mapping-dialog)
- [2. Edit Field Mapping Dialog](#2-edit-field-mapping-dialog)
- [3. Delete Field Mapping Dialog](#3-delete-field-mapping-dialog)
- [4. Field Mapping Data Component](#4-field-mapping-data-component)
- [5. Smoke Test & Verification](#5-smoke-test--verification)

---

## Current State Assessment

| File | Status | Remaining Work |
|------|--------|----------------|
| `CreateFieldMappingDialog.component.tsx` | `normalizedKey` auto-derived but not editable; `required`/`defaultValue`/`format`/`enumValues` hardcoded as defaults in payload | Add editable form fields for all 5 new fields; add `normalizedKey` auto-suggest from `sourceField`; show `enumValues` only when column type is `"enum"` |
| `EditFieldMappingDialog.component.tsx` | Missing all 5 new fields entirely | Add all new form fields; add revalidation confirmation |
| `FieldMapping.component.tsx` | Data wrapper only — response types already include new fields | No code change needed |
| `DeleteFieldMappingDialog.component.tsx` | No structural change needed | Verify only |

---

## 1. Create Field Mapping Dialog

**File:** `apps/web/src/components/CreateFieldMappingDialog.component.tsx`

The dialog currently auto-derives `normalizedKey` from `sourceField` at submit time (line 127) and hardcodes `required: false`, `defaultValue: null`, `format: null`, `enumValues: null`. These need to become editable form fields.

### 1.1 Write tests — new field rendering

> **Test file:** `apps/web/src/__tests__/CreateFieldMappingDialog.test.tsx` (existing — add new tests)

- [x] **Test:** Renders `Normalized Key` text field
- [x] **Test:** Renders `Required` switch/checkbox (defaults to unchecked)
- [x] **Test:** Renders `Default Value` text field
- [x] **Test:** Renders `Format` text field
- [x] **Test:** Does NOT render `Enum Values` when column type is `"string"`
- [x] **Test:** Renders `Enum Values` text field when column type is `"enum"`

### 1.2 Write tests — normalizedKey auto-suggest

- [x] **Test:** `Normalized Key` auto-populates from `Source Field` value converted to snake_case (e.g., "User Email" → "user_email")
- [x] **Test:** `Normalized Key` can be manually edited after auto-population
- [x] **Test:** `Normalized Key` shows validation error for invalid format (non-snake_case, e.g., "Bad Key!")
- [x] **Test:** `Normalized Key` shows validation error when empty on submit (required field)

### 1.3 Write tests — submit payload with new fields

- [x] **Test:** Submitting with all defaults produces payload including `normalizedKey` (auto-derived), `required: false`, `defaultValue: null`, `format: null`, `enumValues: null`
- [x] **Test:** Submitting with new fields populated produces payload including user-entered `normalizedKey`, `required: true`, `defaultValue: "N/A"`, `format: "lowercase"`, `enumValues: null` (non-enum type)
- [x] **Test:** Submitting with enum type and `enumValues` produces payload including `enumValues: ["a", "b"]`

### 1.4 Fix existing tests — payload shape

- [x] **Fix test** "should call onSubmit with correct body including null ref fields": Update expected payload to include `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues`
- [x] **Fix test** "should submit form on Enter key press": Update `expect.objectContaining` to include `normalizedKey`

### 1.5 Implement — add form fields

> **File:** `apps/web/src/components/CreateFieldMappingDialog.component.tsx`

- [x] Add fields to `CreateFieldMappingFormState`:
  ```ts
  normalizedKey: string;
  required: boolean;
  defaultValue: string;
  format: string;
  enumValues: string;
  ```
- [x] Update `INITIAL_FORM` with defaults:
  ```ts
  normalizedKey: "",
  required: false,
  defaultValue: "",
  format: "",
  enumValues: "",
  ```
- [x] Add `normalizedKey` to `CreateFieldMappingFormSchema` with regex validation: `z.string().regex(/^[a-z][a-z0-9_]*$/, "Must be lowercase alphanumeric with underscores")`
- [x] Update `handleChange`: when `sourceField` changes and `normalizedKey` has not been manually edited, auto-derive `normalizedKey` from `sourceField` (convert to snake_case)
- [x] Track whether `normalizedKey` has been manually touched to prevent overwriting user edits
- [x] Add JSX form fields after "Source Field":
  - `Normalized Key` — text input, required, with auto-suggest helper text
  - `Required` — `FormControlLabel` with `Switch` (separate from Primary Key)
  - `Default Value` — text input
  - `Format` — text input with type-aware helper text
  - `Enum Values` — text input, only shown when `columnDefinitionType === "enum"`, comma-separated input
- [x] Update `handleSubmit` payload construction:
  ```ts
  normalizedKey: form.normalizedKey,
  required: form.required,
  defaultValue: form.defaultValue.trim() || null,
  format: form.format.trim() || null,
  enumValues: columnDefinitionType === "enum" && form.enumValues.trim()
    ? form.enumValues.split(",").map(s => s.trim()).filter(Boolean)
    : null,
  ```
- [x] Run tests from 1.1–1.4 — all should pass

---

## 2. Edit Field Mapping Dialog

**File:** `apps/web/src/components/EditFieldMappingDialog.component.tsx`

The dialog is missing `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues` entirely. Also needs revalidation confirmation when any of these fields change.

### 2.1 Write tests — new field rendering

> **Test file:** `apps/web/src/__tests__/EditFieldMappingDialog.test.tsx` (new)

- [x] **Test:** Renders "Edit Field Mapping" title when open
- [x] **Test:** Does not render when `open={false}`
- [x] **Test:** Pre-fills `sourceField`, `isPrimaryKey`, and new fields (`normalizedKey`, `required`, `defaultValue`, `format`) from `fieldMapping` prop
- [x] **Test:** Renders `Normalized Key` text field
- [x] **Test:** Renders `Required` switch
- [x] **Test:** Renders `Default Value` text field
- [x] **Test:** Renders `Format` text field
- [x] **Test:** Shows `Enum Values` field only when column type is `"enum"`
- [x] **Test:** Hides `Enum Values` field when column type is `"string"`
- [x] **Test:** Shows Column Definition and Connector Entity as disabled fields

### 2.2 Write tests — normalizedKey validation

- [x] **Test:** Shows validation error for invalid `normalizedKey` format
- [x] **Test:** `normalizedKey` is required (error on empty submit)

### 2.3 Write tests — submit payload

- [x] **Test:** Submitting includes `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues` in body
- [x] **Test:** Empty `defaultValue`/`format` are sent as `null`

### 2.4 Write tests — revalidation confirmation

- [x] **Test:** When `normalizedKey` is changed and Save is clicked, a revalidation warning is shown
- [x] **Test:** When `required` is changed and Save is clicked, a revalidation warning is shown
- [x] **Test:** When `format` is changed and Save is clicked, a revalidation warning is shown
- [x] **Test:** When `defaultValue` is changed and Save is clicked, a revalidation warning is shown
- [x] **Test:** When `enumValues` is changed and Save is clicked, a revalidation warning is shown
- [x] **Test:** When only `sourceField` or `isPrimaryKey` is changed, no revalidation warning is shown
- [x] **Test:** Clicking "Confirm & Save" after warning submits the payload

### 2.5 Write tests — standard dialog behavior

- [x] **Test:** Calls `onClose` on Cancel click
- [x] **Test:** Shows "Saving..." and disables buttons when `isPending={true}`
- [x] **Test:** Renders `<FormAlert>` when `serverError` is provided
- [x] **Test:** Does not render `<FormAlert>` when `serverError` is null
- [x] **Test:** Supports Enter key submission
- [x] **Test:** `aria-invalid="true"` is set on `sourceField` when validation fails
- [x] **Test:** `required` attribute is present on `sourceField`

### 2.6 Implement — add form fields and revalidation

> **File:** `apps/web/src/components/EditFieldMappingDialog.component.tsx`

- [x] Add fields to `EditFieldMappingFormState`:
  ```ts
  normalizedKey: string;
  required: boolean;
  defaultValue: string;
  format: string;
  enumValues: string;
  ```
- [x] Add `normalizedKey` to `EditFieldMappingFormSchema` with regex validation
- [x] Update the `fieldMapping` prop type to include `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues`
- [x] Initialize form state from `fieldMapping` prop values
- [x] Add JSX form fields (same layout as create dialog)
- [x] Add `enumValues` conditional rendering based on `columnDefinitionType`
- [x] Add revalidation confirmation state and logic:
  - Define `REVALIDATION_FIELDS = ["normalizedKey", "required", "defaultValue", "format", "enumValues"]`
  - In `handleSubmit`, check if any of these fields differ from the original `fieldMapping` prop
  - If so, show `<Alert severity="info">` with "Confirm & Save" button
- [x] Update `handleSubmit` payload construction to include new fields:
  ```ts
  normalizedKey: form.normalizedKey,
  required: form.required,
  defaultValue: form.defaultValue.trim() || null,
  format: form.format.trim() || null,
  enumValues: columnDefinitionType === "enum" && form.enumValues.trim()
    ? form.enumValues.split(",").map(s => s.trim()).filter(Boolean)
    : null,
  ```
- [x] Update the call site in `ColumnDefinitionDetail.view.tsx` to pass new fields in the `fieldMapping` prop to `EditFieldMappingDialog`
- [x] Run tests from 2.1–2.5 — all should pass

---

## 3. Delete Field Mapping Dialog

**File:** `apps/web/src/components/DeleteFieldMappingDialog.component.tsx`

### 3.1 Verify no changes needed

- [x] Confirm delete dialog has no references to moved fields or `"currency"` type
- [x] Run existing delete dialog tests — all should pass

---

## 4. Field Mapping Data Component

**File:** `apps/web/src/components/FieldMapping.component.tsx`

### 4.1 Verify no code changes needed

- [x] `FieldMappingDataList` is a pass-through data wrapper that delegates to `sdk.fieldMappings.list()` — response types already include new fields from `@portalai/core/contracts`
- [x] Run existing `FieldMapping.component.test.tsx` — should pass (note: the mock data in the test may need `normalizedKey`, `required`, etc. added if the type check enforces it)

### 4.2 Fix test mock data if needed

- [x] Update `FieldMapping.component.test.tsx` mock field mapping objects to include `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues` if type-check fails

---

## 5. Smoke Test & Verification

### 5.1 Type-check

- [x] Run `npx tsc --noEmit -p apps/web/tsconfig.json` — verify 0 errors in all files touched by this phase
- [x] Specifically verify:
  - `CreateFieldMappingDialog.component.tsx` — no references to hardcoded `normalizedKey` auto-derive at submit
  - `EditFieldMappingDialog.component.tsx` — includes all new fields in form state and submit body
  - `ColumnDefinitionDetail.view.tsx` — passes new fields in `fieldMapping` prop to edit dialog

### 5.2 Run all Phase 3 tests

- [x] Run all field-mapping-related tests:
  ```bash
  cd apps/web && NODE_OPTIONS=--experimental-vm-modules npx jest --testPathPattern="(CreateFieldMappingDialog|EditFieldMappingDialog|DeleteFieldMappingDialog|FieldMapping\.component)" --no-coverage
  ```
- [x] All tests pass

### 5.3 Run full web test suite

- [x] Run `cd apps/web && NODE_OPTIONS=--experimental-vm-modules npx jest --no-coverage`
- [x] Document any new failures introduced by Phase 3 changes (should be zero for Phase 4+ files)

---

## Summary

| Step | Files Touched | Tests Updated/Created | Status |
|------|--------------|----------------------|--------|
| 1. Create Dialog | `CreateFieldMappingDialog.component.tsx` (added 5 form fields + auto-suggest) | `CreateFieldMappingDialog.test.tsx` (31 pass, 1 fixed, 10 new) | [x] |
| 2. Edit Dialog | `EditFieldMappingDialog.component.tsx` (full rewrite), `ColumnDefinitionDetail.view.tsx` (prop update) | `EditFieldMappingDialog.test.tsx` (23 pass, new file) | [x] |
| 3. Delete Dialog | (no change) | `DeleteFieldMappingDialog.test.tsx` (17 pass) | [x] |
| 4. Data Component | (no change) | `FieldMapping.component.test.tsx` (2 pass, no fixes needed) | [x] |
| 5. Smoke Test | 0 type errors | 73/73 tests pass across 4 suites | [x] |
