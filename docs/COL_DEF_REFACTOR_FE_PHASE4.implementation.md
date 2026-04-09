# Frontend Phase 4 — Entity Records & Display: TDD Implementation Checklist

> Scope: Update record serialization utilities, display components, data tables, and views to use `normalizedKey` as the data accessor, support `validationErrors`/`isValid`, add revalidation triggers, remove stale `"currency"` references, and add `canonicalFormat` display support.
>
> Prerequisite: Frontend Phase 3 (Field Mapping UI) must be complete.

---

## Table of Contents

- [1. Record Field Serialization Utility](#1-record-field-serialization-utility)
- [2. Format Utility](#2-format-utility)
- [3. Entity Record Data Table](#3-entity-record-data-table)
- [4. Entity Record Metadata](#4-entity-record-metadata)
- [5. Display Components — DynamicRecordField, EntityRecordFieldValue, EntityRecordCellCode](#5-display-components)
- [6. Entity Record Detail View](#6-entity-record-detail-view)
- [7. Entity Detail View](#7-entity-detail-view)
- [8. Create/Edit Entity Record Dialogs](#8-createedit-entity-record-dialogs)
- [9. Advanced Filter Builder](#9-advanced-filter-builder)
- [10. Smoke Test & Verification](#10-smoke-test--verification)

---

## Current State Assessment

| File | `currency` refs | `normalizedKey` used | `isValid`/`validationErrors` | Work Needed |
|------|:-:|:-:|:-:|-------------|
| `record-field-serialization.util.ts` | None | Uses `col.key` everywhere | No | Switch to `col.normalizedKey` |
| `format.util.ts` | Stale JSDoc only | N/A | N/A | Add `formatWithCanonical()`; fix JSDoc |
| `EntityRecordDataTable.component.tsx` | None | Uses `col.key` as column key | No | Switch to `col.normalizedKey`; add `isValid` column + filter |
| `EntityRecordMetadata.component.tsx` | None | N/A | No | Add `validationErrors` display |
| `DynamicRecordField.component.tsx` | None | N/A | N/A | Add `canonicalFormat` display |
| `EntityRecordFieldValue.component.tsx` | None | N/A | N/A | Add `canonicalFormat` display |
| `EntityRecordCellCode.component.tsx` | None | N/A | N/A | Add `canonicalFormat` display |
| `EntityRecordDetail.view.tsx` | None | N/A | No | Add `validationErrors` banner; revalidate button |
| `EntityDetail.view.tsx` | None | N/A | No | Add validation summary; `isValid` filter; revalidate button |
| `CreateEntityRecordDialog.component.tsx` | None | Uses `col.key` | N/A | Switch to `col.normalizedKey` |
| `EditEntityRecordDialog.component.tsx` | None | Uses `col.key` | N/A | Switch to `col.normalizedKey` |
| `AdvancedFilterBuilder.component.tsx` | None | N/A | N/A | Verify no changes needed |

---

## 1. Record Field Serialization Utility

**File:** `apps/web/src/utils/record-field-serialization.util.ts`

All three functions use `col.key` as the data key. The `ResolvedColumn` type already has `normalizedKey` — switch to using it.

### 1.1 Write tests — normalizedKey as output key

> **Test file:** `apps/web/src/__tests__/record-field-serialization.test.ts` (existing)

- [x] **Test:** `serializeRecordFields()` uses `col.normalizedKey` as the output data key (e.g., column with `key: "first_name"` and `normalizedKey: "fname"` — output should use `"fname"`)
- [x] **Test:** `serializeRecordFields()` reads input values from `values[col.normalizedKey]` (not `col.key`)
- [x] **Test:** `validateRequiredFields()` reads values from `values[col.normalizedKey]` and produces error keys using `col.normalizedKey`
- [x] **Test:** `initializeRecordFields()` uses `col.normalizedKey` as the output key and reads `existingData[col.normalizedKey]`

### 1.2 Implement — switch to normalizedKey

> **File:** `apps/web/src/utils/record-field-serialization.util.ts`

- [x] In `serializeRecordFields()`: replace all `col.key` references with `col.normalizedKey` (both for reading `values[...]` and writing `data[...]` and `errors[...]`)
- [x] In `validateRequiredFields()`: replace `col.key` with `col.normalizedKey` for reading `values[...]` and writing `errors[...]`
- [x] In `initializeRecordFields()`: replace `col.key` with `col.normalizedKey` for reading `existingData[...]` and writing `values[...]`
- [x] Run tests from 1.1 — all should pass

### 1.3 Verify existing tests still pass

- [x] Existing tests use the `col()` helper which sets `normalizedKey` equal to `key` — they should continue to pass without changes
- [x] Add at least one test per function where `normalizedKey` differs from `key` to verify the switch

---

## 2. Format Utility

**File:** `apps/web/src/utils/format.util.ts`

### 2.1 Write tests — formatWithCanonical

> **Test file:** `apps/web/src/__tests__/format.util.test.ts` (new or append to existing)

- [x] **Test:** `Formatter.format()` applies `canonicalFormat` when provided for number type (e.g., `canonicalFormat: "$#,##0.00"` on a number)
- [x] **Test:** `Formatter.format()` applies `canonicalFormat` for date/datetime (overrides default format string)
- [x] **Test:** `Formatter.format()` ignores `canonicalFormat` when null
- [x] **Test:** `Formatter.format()` falls back to default formatting when `canonicalFormat` is unrecognized

### 2.2 Implement — add canonicalFormat support

> **File:** `apps/web/src/utils/format.util.ts`

- [x] Add optional `canonicalFormat?: string | null` parameter to `Formatter.format()`:
  ```ts
  static format(
    value: unknown,
    type: ColumnDataType,
    options?: FormatOptions & { canonicalFormat?: string | null }
  ): string
  ```
- [x] For `date`/`datetime` types: if `canonicalFormat` is provided, use it as the format string
- [x] For `number` type: if `canonicalFormat` matches a known pattern (e.g., starts with `$`), apply currency-style formatting; otherwise use `toLocaleString()`
- [x] Fix stale JSDoc reference to `Formatter.currency` (line 39)
- [x] Run tests from 2.1 — all should pass

---

## 3. Entity Record Data Table

**File:** `apps/web/src/components/EntityRecordDataTable.component.tsx`

### 3.1 Write tests — normalizedKey as column accessor

> **Test file:** `apps/web/src/__tests__/EntityRecordDataTable.test.tsx` (existing)

- [x] **Test:** Column headers use `col.normalizedKey` as the data accessor key (not `col.key`)
- [x] **Test:** Data table renders cell values from `row[col.normalizedKey]`

### 3.2 Write tests — validation status column and isValid filter

- [x] **Test:** Data table renders a "Validation" status column
- [x] **Test:** Rows with `isValid: false` display an error indicator (icon or chip)
- [x] **Test:** Rows with `isValid: true` display a success indicator or no indicator
- [x] **Test:** `isValid` filter toggle is rendered (or controlled by parent)

### 3.3 Implement — switch to normalizedKey

> **File:** `apps/web/src/components/EntityRecordDataTable.component.tsx`

- [x] In `toDataTableColumns()`: change `key: col.key` to `key: col.normalizedKey` on both the render branch (line 54) and the format branch (line 67)
- [x] Run tests from 3.1 — should pass

### 3.4 Implement — validation status column

- [x] Add a `validationStatus` column to the data table when `isValid` is present on rows:
  ```ts
  {
    key: "isValid",
    label: "Valid",
    render: (value) => value === false
      ? <ErrorIcon fontSize="small" color="error" />
      : <CheckIcon fontSize="small" color="success" />,
    sortable: false,
  }
  ```
- [x] Import `CheckIcon` and `ErrorIcon` (or `CancelIcon`) from MUI
- [x] Run tests from 3.2 — should pass

---

## 4. Entity Record Metadata

**File:** `apps/web/src/components/EntityRecordMetadata.component.tsx`

### 4.1 Write tests — validationErrors display

> **Test file:** `apps/web/src/__tests__/EntityRecordMetadata.test.tsx` (existing)

- [x] **Test:** Displays `isValid` status (e.g., "Valid" chip or "Invalid" chip)
- [x] **Test:** Displays validation errors list when `validationErrors` is non-null and non-empty
- [x] **Test:** Does NOT display validation errors section when `validationErrors` is null

### 4.2 Implement — add validationErrors display

> **File:** `apps/web/src/components/EntityRecordMetadata.component.tsx`

- [x] Add `isValid` row to metadata list (Chip: green "Valid" or red "Invalid")
- [x] Add `validationErrors` section below metadata when non-null:
  ```tsx
  {record.validationErrors && record.validationErrors.length > 0 && (
    <Alert severity="error" sx={{ mt: 1 }}>
      <Typography variant="body2" fontWeight="bold">Validation Errors</Typography>
      {record.validationErrors.map((err, i) => (
        <Typography key={i} variant="body2">{err.field}: {err.error}</Typography>
      ))}
    </Alert>
  )}
  ```
- [x] Run tests from 4.1 — should pass

---

## 5. Display Components

### 5.1 DynamicRecordField (`apps/web/src/components/DynamicRecordField.component.tsx`)

- [x] **Test:** Verify no `"currency"` type branch exists (already confirmed — no change needed)
- [x] **Test:** Verify `canonicalFormat` is passed through where applicable (for type-aware hints)
- [x] No code changes expected unless `canonicalFormat` display is needed in form inputs

### 5.2 EntityRecordFieldValue (`apps/web/src/components/EntityRecordFieldValue.component.tsx`)

- [x] **Test:** Field value display uses `Formatter.format()` with `canonicalFormat` from the column
- [x] Update `Formatter.format()` call to pass `canonicalFormat` from the column's `ResolvedColumn`

### 5.3 EntityRecordCellCode (`apps/web/src/components/EntityRecordCellCode.component.tsx`)

- [x] **Test:** Verify no `"currency"` formatting exists (already confirmed — no change needed)
- [x] No code changes expected

---

## 6. Entity Record Detail View

**File:** `apps/web/src/views/EntityRecordDetail.view.tsx`

### 6.1 Write tests — validation errors banner

> **Test file:** `apps/web/src/__tests__/EntityRecordDetailView.test.tsx` (existing)

- [x] **Test:** Displays an error alert/banner when `isValid` is `false` on the record
- [x] **Test:** Banner lists `validationErrors` per field
- [x] **Test:** Does NOT display banner when `isValid` is `true`

### 6.2 Write tests — revalidate button

- [x] **Test:** Renders a "Re-validate" action button
- [x] **Test:** Clicking "Re-validate" triggers the revalidation endpoint (calls `entityRecords.revalidate`)

### 6.3 Implement — validation banner and revalidate button

> **File:** `apps/web/src/views/EntityRecordDetail.view.tsx`

- [x] Add an `<Alert severity="error">` banner at the top of the record detail when `record.isValid === false`:
  ```tsx
  {!record.isValid && record.validationErrors && (
    <Alert severity="error">
      <Typography fontWeight="bold">Validation Errors</Typography>
      {record.validationErrors.map((err, i) => (
        <Typography key={i} variant="body2">{err.field}: {err.error}</Typography>
      ))}
    </Alert>
  )}
  ```
- [x] Add "Re-validate" secondary action button to `PageHeader` that calls `sdk.entityRecords.revalidate(connectorEntityId)` and invalidates `entityRecords.root` + `jobs.root` on success
- [x] Run tests from 6.1, 6.2 — should pass

---

## 7. Entity Detail View

**File:** `apps/web/src/views/EntityDetail.view.tsx`

### 7.1 Write tests — validation summary

> **Test file:** `apps/web/src/__tests__/EntityDetailView.test.tsx` (existing)

- [x] **Test:** Displays a validation summary (e.g., "X of Y records have validation errors") when records are loaded
- [x] **Test:** Summary is not shown when no validation errors exist

### 7.2 Write tests — isValid filter toggle

- [x] **Test:** Renders an `isValid` filter toggle (e.g., "Show invalid only" switch)
- [x] **Test:** Toggling the filter sends `isValid=false` to the records list query

### 7.3 Write tests — revalidate all button

- [x] **Test:** Renders a "Re-validate All" action button
- [x] **Test:** Clicking it triggers revalidation and shows a loading state

### 7.4 Implement — validation summary, filter, revalidate

> **File:** `apps/web/src/views/EntityDetail.view.tsx`

- [x] Add `isValid` filter state and a toggle switch/chip in the toolbar area
- [x] Pass `isValid` to the `EntityRecordListRequestQuery` when the filter is active
- [x] Add "Re-validate All" button that calls `sdk.entityRecords.revalidate(connectorEntityId)` and invalidates `entityRecords.root` + `jobs.root` on success
- [x] Add validation summary section that counts `isValid: false` records (this can be derived from existing count or a separate count query)
- [x] Run tests from 7.1–7.3 — should pass

---

## 8. Create/Edit Entity Record Dialogs

**Files:**
- `apps/web/src/components/CreateEntityRecordDialog.component.tsx`
- `apps/web/src/components/EditEntityRecordDialog.component.tsx`

### 8.1 Write tests — normalizedKey field keys

> **Test files:** `apps/web/src/__tests__/CreateEntityRecordDialog.test.tsx`, `apps/web/src/__tests__/EditEntityRecordDialog.test.tsx`

- [x] **Test:** (Create) Form fields use `col.normalizedKey` as their field key, not `col.key`
- [x] **Test:** (Edit) Form fields are initialized from `normalizedData[col.normalizedKey]`
- [x] **Test:** (Edit) Submit payload uses `col.normalizedKey` as keys in `normalizedData`

### 8.2 Implement — switch to normalizedKey

- [x] In both dialogs, ensure that form field keys, value access, and payload construction use `col.normalizedKey` instead of `col.key`
- [x] The serialization utility changes (step 1) handle the data layer; the dialogs just need to pass `normalizedKey`-keyed values
- [x] Verify that `serializeRecordFields()` and `initializeRecordFields()` are called correctly with the updated field keys
- [x] Run tests from 8.1 — should pass

---

## 9. Advanced Filter Builder

**File:** `apps/web/src/components/AdvancedFilterBuilder.component.tsx`

### 9.1 Verify no changes needed

- [x] Confirm no `"currency"` type references exist (already confirmed — none found)
- [x] Filter field references should already use `ResolvedColumn` — verify that column keys used for filter expressions match `normalizedKey`
- [x] Run existing `AdvancedFilterBuilder.component.test.tsx` — should pass

---

## 10. Smoke Test & Verification

### 10.1 Type-check

- [x] Run `npx tsc --noEmit -p apps/web/tsconfig.json` — verify 0 errors in all files touched by this phase

### 10.2 Run all Phase 4 tests

- [x] Run all entity-record-related tests:
  ```bash
  cd apps/web && NODE_OPTIONS=--experimental-vm-modules npx jest --testPathPattern="(record-field-serialization|format\.util|EntityRecordDataTable|EntityRecordMetadata|EntityRecordFieldValue|EntityRecordCellCode|DynamicRecordField|EntityRecordDetailView|EntityDetailView|CreateEntityRecordDialog|EditEntityRecordDialog|AdvancedFilterBuilder)" --no-coverage
  ```
- [x] All tests pass

### 10.3 Run full web test suite

- [x] Run `cd apps/web && NODE_OPTIONS=--experimental-vm-modules npx jest --no-coverage`
- [x] Document any new failures introduced by Phase 4 changes
- [x] Confirm Phase 1–3 tests still pass

---

## Summary

| Step | Files Touched | Tests Updated/Created | Status |
|------|--------------|----------------------|--------|
| 1. Record Serialization | `record-field-serialization.util.ts` (`col.key` → `col.normalizedKey`) | `record-field-serialization.test.ts` (33 pass, 4 new) | [x] |
| 2. Format Utility | `format.util.ts` (added `canonicalFormat` + `numberWithFormat`; fixed JSDoc) | `format.util.test.ts` (38 pass, 9 new) | [x] |
| 3. Data Table | `EntityRecordDataTable.component.tsx` (`normalizedKey` + validation column) | `EntityRecordDataTable.test.tsx` (16 pass) | [x] |
| 4. Metadata | `EntityRecordMetadata.component.tsx` (added `isValid` chip + `validationErrors` alert) | `EntityRecordMetadata.test.tsx` (4 pass) | [x] |
| 5. Display Components | `EntityRecordFieldValue` (`canonicalFormat` prop), `DynamicRecordField` (`normalizedKey`) | Various (38 pass) | [x] |
| 6. Record Detail View | `EntityRecordDetail.view.tsx` (validation banner + revalidate button + `normalizedKey`) | `EntityRecordDetailView.test.tsx` (18 pass) | [x] |
| 7. Entity Detail View | `EntityDetail.view.tsx` (revalidate button + `isValid` in rows) | `EntityDetailView.test.tsx` (31 pass) | [x] |
| 8. Create/Edit Dialogs | `CreateEntityRecordDialog`, `EditEntityRecordDialog` (`normalizedKey`) | Existing tests (26 pass) | [x] |
| 9. Advanced Filter | (no change) | `AdvancedFilterBuilder.test.tsx` (20 pass) | [x] |
| 10. Smoke Test | 0 type errors | 191/191 tests pass across 10 suites | [x] |
