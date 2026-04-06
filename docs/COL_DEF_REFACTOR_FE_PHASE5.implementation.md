# Frontend Phase 5 — CSV Connector Workflow: TDD Implementation Checklist

> Scope: Update the CSV Connector upload workflow to align with the refactored field ownership. Column-definition-level fields (`validationPattern`, `validationMessage`, `canonicalFormat`) replace removed fields (`required`, `defaultValue`, `format`, `enumValues`) on the column definition. Field-mapping-level fields (`normalizedKey`, `required`, `defaultValue`, `format`, `enumValues`) are added per-entity-column mapping. Remove `"currency"` type option.
>
> Prerequisite: Frontend Phase 4 (Entity Records & Display) must be complete.

---

## Table of Contents

- [1. Upload Workflow Utility — Types & Confirm Builder](#1-upload-workflow-utility)
- [2. CSV Validation Utility](#2-csv-validation-utility)
- [3. Column Mapping Step Component](#3-column-mapping-step-component)
- [4. Review Step Component](#4-review-step-component)
- [5. Storybook Stories](#5-storybook-stories)
- [6. Smoke Test & Verification](#6-smoke-test--verification)

---

## Current State Assessment

| File | `currency` | Old fields on col-def level | New mapping-level fields | Work Needed |
|------|:-:|:-:|:-:|-------------|
| `upload-workflow.util.ts` | None | `required`, `format`, `enumValues` on `RecommendedColumn.recommended` | None | Move fields to mapping context; add `normalizedKey`, `validationPattern`, `validationMessage`, `canonicalFormat`; update confirm builder |
| `csv-validation.util.ts` | None | Validates `key`, `label`, `type` only | None | Add `normalizedKey` validation (required, snake_case, unique per entity) |
| `ColumnMappingStep.component.tsx` | Line 42 (`currency` option) | `required`, `format`, `enumValues` as column inputs | None | Remove `currency` type; move per-column inputs to per-mapping; add `normalizedKey` auto-suggest; add `validationPattern`/`validationMessage`/`canonicalFormat` inputs |
| `ReviewStep.component.tsx` | None | Displays `required`, `format`, `enumValues` | `normalizedKey` in tests | Show column-def vs mapping fields separately; add `normalizedKey` display |
| `CSVConnectorWorkflow.stories.tsx` | Line 105 (`format: "currency"`) | `required`, `format`, `enumValues` on recommended | None | Update mock data; remove `currency` |
| `upload.contract.ts` | None | Already restructured — `ConfirmColumnSchema` has both levels | N/A | No changes needed (already done in backend phase) |

---

## 1. Upload Workflow Utility

**File:** `apps/web/src/workflows/CSVConnector/utils/upload-workflow.util.ts`

### 1.1 Write tests — RecommendedColumn type reflects new structure

> **Test file:** `apps/web/src/workflows/CSVConnector/__tests__/upload-workflow.test.ts` (existing)

- [x] **Test:** `RecommendedColumn.recommended` includes `validationPattern`, `validationMessage`, `canonicalFormat` (column-def-level fields)
- [x] **Test:** `RecommendedColumn` includes `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues` at the mapping level (alongside `sourceField`, not inside `recommended`)
- [x] **Test:** Confirm body places `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues` at the `ConfirmColumn` level
- [x] **Test:** Confirm body places `validationPattern`, `validationMessage`, `canonicalFormat` at the `ConfirmColumn` level

### 1.2 Implement — update RecommendedColumn type

> **File:** `apps/web/src/workflows/CSVConnector/utils/upload-workflow.util.ts`

- [x] Update `RecommendedColumn.recommended` — remove `required`, `format`, `enumValues`; add `validationPattern`, `validationMessage`, `canonicalFormat`, `description`
  ```ts
  recommended: {
    key: string;
    label: string;
    type: string;
    description?: string | null;
    validationPattern?: string | null;
    validationMessage?: string | null;
    canonicalFormat?: string | null;
    refEntityKey?: string | null;
    refColumnKey?: string | null;
    refColumnDefinitionId?: string | null;
  };
  ```
- [x] Add mapping-level fields to `RecommendedColumn`:
  ```ts
  normalizedKey?: string;
  required?: boolean;
  defaultValue?: string | null;
  format?: string | null;
  enumValues?: string[] | null;
  ```
- [x] Update `BackendRecommendation` mapping interface to include new fields from the backend response:
  - Add `normalizedKey`, `defaultValue`, `validationPattern`, `validationMessage`, `canonicalFormat` to the backend column shape
  - Move `required`, `format`, `enumValues` from `recommended` to the column's mapping level in `mapBackendRecommendations()`
- [x] Update `confirm()` function — the `ConfirmRequestBody` builder must:
  - Include `normalizedKey: col.normalizedKey ?? col.recommended.key` (default to column key if not user-edited)
  - Include `required: col.required ?? false`
  - Include `defaultValue: col.defaultValue ?? null`
  - Include `format: col.format ?? null` (moved from `col.recommended.format`)
  - Include `enumValues: col.enumValues ?? null` (moved from `col.recommended.enumValues`)
  - Include `validationPattern: col.recommended.validationPattern ?? null`
  - Include `validationMessage: col.recommended.validationMessage ?? null`
  - Include `canonicalFormat: col.recommended.canonicalFormat ?? null`
- [x] Run tests from 1.1 — all should pass

---

## 2. CSV Validation Utility

**File:** `apps/web/src/workflows/CSVConnector/utils/csv-validation.util.ts`

### 2.1 Write tests — normalizedKey validation

> **Test file:** `apps/web/src/workflows/CSVConnector/__tests__/csv-validation.util.test.ts` (existing)

- [x] **Test:** `validateColumnStep()` returns error when `normalizedKey` is empty
- [x] **Test:** `validateColumnStep()` returns error when `normalizedKey` has invalid format (non-snake_case)
- [x] **Test:** `validateColumnStep()` returns error when two columns in the same entity have the same `normalizedKey`
- [x] **Test:** `validateColumnStep()` passes when `normalizedKey` is valid snake_case and unique
- [x] **Test:** `validateColumnStep()` does NOT validate `required`, `format`, `enumValues` at the column-definition level (these moved to mapping)

### 2.2 Implement — add normalizedKey validation

> **File:** `apps/web/src/workflows/CSVConnector/utils/csv-validation.util.ts`

- [x] Add `normalizedKey` to `BaseColumnSchema`:
  ```ts
  normalizedKey: z.string().regex(/^[a-z][a-z0-9_]*$/, "Normalized key must be lowercase snake_case"),
  ```
  Note: `normalizedKey` lives at the mapping level conceptually, but it's validated here because the column mapping step is where users edit it. The schema validates the column's mapping properties.
- [x] Add uniqueness check for `normalizedKey` within each entity:
  After per-column schema validation, iterate columns in each entity and flag duplicates:
  ```ts
  const seen = new Map<string, number>();
  for (let ci = 0; ci < entity.columns.length; ci++) {
    const nk = entity.columns[ci].normalizedKey ?? entity.columns[ci].recommended.key;
    if (seen.has(nk)) {
      // Add error to both the current and first occurrence
      colErrors[ci] = { ...(colErrors[ci] ?? {}), normalizedKey: `Duplicate normalized key "${nk}"` };
    }
    seen.set(nk, ci);
  }
  ```
- [x] Run tests from 2.1 — all should pass

---

## 3. Column Mapping Step Component

**File:** `apps/web/src/workflows/CSVConnector/ColumnMappingStep.component.tsx`

This is the largest change — the per-column editing UI needs to separate column-definition fields from field-mapping fields.

### 3.1 Write tests — removed fields and currency type

> **Test file:** `apps/web/src/workflows/CSVConnector/__tests__/ColumnMappingStep.test.tsx` (existing)

- [x] **Test:** Type select does NOT contain `"currency"` option
- [x] **Test:** Per-column section does NOT render `Required`, `Default Value`, `Format`, or `Enum Values` inputs (these move to mapping section)

### 3.2 Write tests — new column-definition-level fields

- [x] **Test:** Per-column section renders `Validation Pattern` input
- [x] **Test:** Per-column section renders `Validation Message` input
- [x] **Test:** Per-column section renders `Canonical Format` input
- [x] **Test:** Validation preset dropdown auto-populates `validationPattern` and `validationMessage`

### 3.3 Write tests — new mapping-level fields

- [x] **Test:** Per-column section renders `Normalized Key` input
- [x] **Test:** `Normalized Key` auto-suggests from column key (snake_case)
- [x] **Test:** `Normalized Key` can be manually edited
- [x] **Test:** Per-column section renders `Required` switch (at mapping level)
- [x] **Test:** Per-column section renders `Default Value` input (at mapping level)
- [x] **Test:** Per-column section renders `Format` input (at mapping level)
- [x] **Test:** Per-column section renders `Enum Values` input only when type is `"enum"` (at mapping level)

### 3.4 Implement — update column mapping UI

> **File:** `apps/web/src/workflows/CSVConnector/ColumnMappingStep.component.tsx`

- [x] Remove `{ value: "currency", label: "Currency" }` from `TYPE_OPTIONS` array (line 42)
- [x] In the per-column editing section:
  - **Remove** inputs for `required`, `defaultValue`, `format`, `enumValues` that are currently at the column-definition level
  - **Add** column-definition-level inputs:
    - `Validation Pattern` (text input)
    - `Validation Message` (text input)
    - `Canonical Format` (text input)
    - Validation preset dropdown (Email, URL, Phone, UUID, None) — same as Phase 2 create dialog
  - **Add** mapping-level inputs:
    - `Normalized Key` (text input, required, auto-suggested from column key)
    - `Required` (switch)
    - `Default Value` (text input)
    - `Format` (text input)
    - `Enum Values` (text input, only shown when type is `"enum"`)
- [x] Wire `updateColumn()` calls for new fields — column-def fields go into `recommended`, mapping fields go onto the `RecommendedColumn` directly:
  ```ts
  // Column-definition-level update
  updateColumn(entityIndex, colIndex, {
    recommended: {
      ...col.recommended,
      validationPattern: value,
    },
  });
  // Mapping-level update
  updateColumn(entityIndex, colIndex, { normalizedKey: value });
  ```
- [x] Add `normalizedKey` auto-suggest logic: when column key changes and `normalizedKey` has not been manually edited, derive `normalizedKey` from key
- [x] Run tests from 3.1–3.3 — all should pass

### 3.5 Fix existing tests

> **Test file:** `apps/web/src/workflows/CSVConnector/__tests__/ColumnMappingStep.test.tsx`

- [x] Update mock `RecommendedColumn` objects to use the new type structure (mapping-level fields on column, column-def fields in `recommended`)
- [x] Remove tests that assert `Required`, `Format`, `Enum Values` at the column-definition level
- [x] Update tests that interact with form fields to use the new field locations
- [x] Run all ColumnMappingStep tests — all should pass

---

## 4. Review Step Component

**File:** `apps/web/src/workflows/CSVConnector/ReviewStep.component.tsx`

### 4.1 Write tests — updated review display

> **Test file:** `apps/web/src/workflows/CSVConnector/__tests__/ReviewStep.test.tsx` (existing)

- [x] **Test:** Review displays `normalizedKey` per column mapping
- [x] **Test:** Review displays `validationPattern` when set (column-definition level)
- [x] **Test:** Review displays `required`, `defaultValue`, `format`, `enumValues` at the mapping level (not column-definition level)
- [x] **Test:** Review does NOT display `"currency"` type

### 4.2 Implement — update review display

> **File:** `apps/web/src/workflows/CSVConnector/ReviewStep.component.tsx`

- [x] Update column review section to separate column-definition fields from mapping fields:
  - Column-definition section: `key`, `label`, `type`, `description`, `validationPattern`, `validationMessage`, `canonicalFormat`
  - Mapping section: `sourceField`, `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues`, `isPrimaryKey`
- [x] Display `normalizedKey` prominently (as the key the field will be stored under)
- [x] Run tests from 4.1 — all should pass

### 4.3 Fix existing tests

> **Test file:** `apps/web/src/workflows/CSVConnector/__tests__/ReviewStep.test.tsx`

- [x] Update mock data to use new `RecommendedColumn` structure
- [x] Update assertions that check for `required`, `format`, `enumValues` display
- [x] Run all ReviewStep tests — all should pass

---

## 5. Storybook Stories

**File:** `apps/web/src/workflows/CSVConnector/stories/CSVConnectorWorkflow.stories.tsx`

### 5.1 Update mock data

- [x] Remove `"currency"` type references (line 105: `format: "currency"` → remove or change to `canonicalFormat: "$#,##0.00"`)
- [x] Move `required`, `format`, `enumValues` from `recommended` to the column's mapping level
- [x] Add `normalizedKey` to each column (default to the column key)
- [x] Add `validationPattern`, `validationMessage`, `canonicalFormat` to `recommended` where appropriate

### 5.2 Verify stories render

- [x] Run Storybook or verify that the stories file compiles without errors
- [x] No automated tests needed — visual verification only

---

## 6. Smoke Test & Verification

### 6.1 Type-check

- [x] Run `npx tsc --noEmit -p apps/web/tsconfig.json` — verify 0 errors in all workflow files

### 6.2 Run all Phase 5 tests

- [x] Run all CSV workflow tests:
  ```bash
  cd apps/web && NODE_OPTIONS=--experimental-vm-modules npx jest --testPathPattern="workflows/CSVConnector" --no-coverage
  ```
- [x] All tests pass

### 6.3 Run full web test suite

- [x] Run `cd apps/web && NODE_OPTIONS=--experimental-vm-modules npx jest --no-coverage`
- [x] Confirm all prior phase tests still pass
- [x] Document total test count

---

## Summary

| Step | Files Touched | Tests Updated/Created | Status |
|------|--------------|----------------------|--------|
| 1. Workflow Utility | `upload-workflow.util.ts` (restructured types + confirm builder) | `upload-workflow.test.ts` (7 pass) | [x] |
| 2. CSV Validation | `csv-validation.util.ts` (added normalizedKey validation + uniqueness) | `csv-validation.util.test.ts` (24 pass) | [x] |
| 3. Column Mapping Step | `ColumnMappingStep.component.tsx` (removed currency, restructured UI) | `ColumnMappingStep.test.tsx` (131 pass, 4 fixed) | [x] |
| 4. Review Step | `ReviewStep.component.tsx` (added normalizedKey + mapping detail display) | `ReviewStep.test.tsx` (32 pass) | [x] |
| 5. Storybook | `CSVConnectorWorkflow.stories.tsx` (updated all mock data) | (visual only) | [x] |
| 6. Smoke Test | 0 type errors | 222/222 tests pass across 7 suites | [x] |
