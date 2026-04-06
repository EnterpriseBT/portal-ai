# Frontend Phase 1 — SDK & Contracts: TDD Implementation Checklist

> Scope: Update `apps/web/src/api/` layer to align with the refactored backend contracts. This phase touches **no UI components or views** — only the API client module, query keys, types, and their tests.
>
> Prerequisite: Backend Phase 1–4 must be deployed (or at minimum, contracts in `@portalai/core` must be updated and built).

---

## Table of Contents

- [1. Column Definitions API Client](#1-column-definitions-api-client)
- [2. Field Mappings API Client](#2-field-mappings-api-client)
- [3. Entity Records API Client](#3-entity-records-api-client)
- [4. Query Key Invalidation Rules](#4-query-key-invalidation-rules)
- [5. Shared Types](#5-shared-types)
- [6. Smoke Test & Type-Check](#6-smoke-test--type-check)

---

## 1. Column Definitions API Client

**File:** `apps/web/src/api/column-definitions.api.ts`

The contracts have already been updated in `@portalai/core` (Backend Phase 1). The column definition create/update request bodies no longer include `required`, `defaultValue`, `format`, `enumValues` and now include `validationPattern`, `validationMessage`, `canonicalFormat`. The list query no longer accepts a `required` filter. The `"currency"` type has been removed from `ColumnDataTypeEnum`.

### 1.1 Write tests — column definitions API hooks

> **Test file:** `apps/web/src/__tests__/api/column-definitions.api.test.ts` (new)

- [x] **Test:** `columnDefinitions.create()` mutation hook sends payload with `validationPattern`, `validationMessage`, `canonicalFormat`
- [x] **Test:** `columnDefinitions.create()` mutation payload does NOT include `required`, `defaultValue`, `format`, `enumValues`
- [x] **Test:** `columnDefinitions.update()` mutation hook sends payload with `validationPattern`, `validationMessage`, `canonicalFormat` (all optional)
- [x] **Test:** `columnDefinitions.update()` mutation payload does NOT include `required`, `defaultValue`, `format`, `enumValues`
- [x] **Test:** `columnDefinitions.list()` query does NOT send `required` as a filter parameter
- [x] **Test:** `columnDefinitions.list()` query accepts `type` filter parameter
- [x] **Test:** Response type from `columnDefinitions.get()` includes `validationPattern`, `validationMessage`, `canonicalFormat` fields
- [x] **Test:** Response type from `columnDefinitions.get()` does NOT include `required`, `defaultValue`, `format`, `enumValues`
- [x] **Test:** `useColumnDefinitionSearch()` still maps items to `{ value: id, label: label }`

### 1.2 Update implementation — column definitions API

> **File:** `apps/web/src/api/column-definitions.api.ts`

- [x] Verify imported contract types (`ColumnDefinitionCreateRequestBody`, `ColumnDefinitionUpdateRequestBody`, `ColumnDefinitionListRequestQuery`) reflect the new schema — these types flow from `@portalai/core/contracts` and should already have the correct shape after the core package rebuild
- [x] Remove any hardcoded `required` filter parameter construction if present
- [x] Verify `ColumnDefinitionListRequestQuery` no longer has `required` field (this is a contract-level change, not an API client change — confirm the import is correct)
- [x] Run tests from step 1.1 — all should pass

---

## 2. Field Mappings API Client

**File:** `apps/web/src/api/field-mappings.api.ts`

The field mapping create/update request bodies now include `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues`. Response types include these new fields.

### 2.1 Write tests — field mappings API hooks

> **Test file:** `apps/web/src/__tests__/api/field-mappings.api.test.ts` (new)

- [x] **Test:** `fieldMappings.create()` mutation hook sends payload with `normalizedKey` (required string)
- [x] **Test:** `fieldMappings.create()` mutation hook sends payload with `required` (boolean), `defaultValue` (nullable string), `format` (nullable string), `enumValues` (nullable string array)
- [x] **Test:** `fieldMappings.update()` mutation hook sends payload with `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues` (all optional)
- [x] **Test:** Response type from `fieldMappings.list()` includes `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues` on each field mapping
- [x] **Test:** `useFieldMappingWithEntitySearch()` still maps items correctly (label = `sourceField (entityLabel)`)
- [x] **Test:** `useFieldMappingWithColumnDefinitionSearch()` still maps items correctly (label = `columnDefinition.label`)

### 2.2 Update implementation — field mappings API

> **File:** `apps/web/src/api/field-mappings.api.ts`

- [x] Verify imported contract types (`FieldMappingCreateRequestBody`, `FieldMappingUpdateRequestBody`) include the new fields from the rebuilt `@portalai/core`
- [x] Consider updating `useFieldMappingWithEntitySearch` label to include `normalizedKey` — e.g., `"normalizedKey (entityLabel)"` or `"sourceField → normalizedKey (entityLabel)"`. Decision: keep current label format unless spec explicitly requires change (spec says "may want to show `normalizedKey` in labels")
- [x] Run tests from step 2.1 — all should pass

---

## 3. Entity Records API Client

**File:** `apps/web/src/api/entity-records.api.ts`

Three changes: (a) list query accepts `isValid` filter, (b) response types include `validationErrors` and `isValid`, (c) new `revalidate` mutation.

### 3.1 Write tests — entity records API hooks (isValid filter)

> **Test file:** `apps/web/src/__tests__/api/entity-records.api.test.ts` (new)

- [x] **Test:** `entityRecords.list()` sends `isValid` query parameter when provided (value: `"true"` or `"false"`)
- [x] **Test:** `entityRecords.list()` omits `isValid` when not provided
- [x] **Test:** Response type from `entityRecords.list()` records include `validationErrors` (nullable array of `{ field, error }`) and `isValid` (boolean)
- [x] **Test:** Response type from `entityRecords.get()` record includes `validationErrors` and `isValid`

### 3.2 Implement — isValid filter support

> **File:** `apps/web/src/api/entity-records.api.ts`

- [x] Verify `EntityRecordListRequestQuery` from `@portalai/core/contracts` includes `isValid` (already added in contract: `z.enum(["true", "false"]).optional()`)
- [x] Verify `entityRecords.list()` passes params through `buildUrl()` — `isValid` will be included automatically since it's part of the query type
- [x] Run isValid filter tests — should pass

### 3.3 Write tests — revalidate mutation

> **Test file:** `apps/web/src/__tests__/api/entity-records.api.test.ts` (append)

- [x] **Test:** `entityRecords.revalidate()` calls `POST /api/connector-entities/:id/records/revalidate`
- [x] **Test:** `entityRecords.revalidate()` returns a mutation hook (no request body needed)

### 3.4 Implement — revalidate mutation

> **File:** `apps/web/src/api/entity-records.api.ts`

- [x] Added `revalidate` method to the `entityRecords` object:
  ```ts
  revalidate: (connectorEntityId: string) =>
    useAuthMutation<JobCreateResponsePayload, void>({
      url: recordsUrl(connectorEntityId, "/revalidate"),
    }),
  ```
- [x] Imported `JobCreateResponsePayload` from `@portalai/core/contracts` (existing contract type with `{ job: Job }` shape)
- [x] Run revalidate tests — all pass

---

## 4. Query Key Invalidation Rules

No new query keys are needed (existing `queryKeys.entityRecords`, `queryKeys.fieldMappings`, `queryKeys.columnDefinitions` cover all cases). The invalidation *rules* are enforced at the call site (views/components), but this phase establishes the contract for what must be invalidated.

### 4.1 Write tests — invalidation rules documentation

> **Test file:** `apps/web/src/__tests__/api/query-key-structure.test.ts` (new)

These tests verify the query key structure supports the invalidation patterns needed:

- [x] **Test:** `queryKeys.fieldMappings.root` is a prefix of `queryKeys.fieldMappings.list()`
- [x] **Test:** `queryKeys.entityRecords.root` is a prefix of `queryKeys.entityRecords.list()`
- [x] **Test:** `queryKeys.columnDefinitions.root` is a prefix of `queryKeys.columnDefinitions.list()`

### 4.2 Document invalidation rules (no code change — rules for downstream phases)

The following invalidation rules must be applied when UI components call mutations. Document here for reference during Frontend Phases 2–5:

- [x] **Rule:** Field mapping create/update/delete → invalidate `fieldMappings.root` AND `entityRecords.root`
  - Reason: mapping changes affect `normalizedData` and validation state on records
- [x] **Rule:** Column definition update (when `validationPattern` or `canonicalFormat` changed) → invalidate `columnDefinitions.root` AND `entityRecords.root`
  - Reason: these fields affect record validation and display
- [x] **Rule:** `entityRecords.revalidate()` onSuccess → invalidate `entityRecords.root` AND `jobs.root`
  - Reason: revalidation updates record validation state; creates a job

---

## 5. Shared Types

**File:** `apps/web/src/api/types.ts`

### 5.1 Review shared types

- [x] Verify `QueryOptions<T>` type is still valid with updated contract types (no change expected)
- [x] Check if any custom type aliases reference removed fields (`required`, `defaultValue`, `format`, `enumValues` on column definitions, or `"currency"` type) — grep for these in `apps/web/src/api/`

---

## 6. Smoke Test & Type-Check

### 6.1 Full type-check

- [x] Run `npm run type-check` from repo root — verify no type errors in `apps/web/`
- [x] Specifically check that no file in `apps/web/src/` references `ColumnDefinition["required"]`, `ColumnDefinition["defaultValue"]`, `ColumnDefinition["format"]`, or `ColumnDefinition["enumValues"]` (these will produce type errors since the fields are removed from the model)

### 6.2 Identify downstream breakages for Phase 2+

Run type-check and catalog errors. These are NOT to be fixed in Phase 1 — they are the work items for subsequent phases:

- [x] Catalog type errors in `apps/web/src/components/CreateColumnDefinitionDialog.component.tsx` (references removed fields)
- [x] Catalog type errors in `apps/web/src/components/EditColumnDefinitionDialog.component.tsx` (references removed fields)
- [x] Catalog type errors in `apps/web/src/views/ColumnDefinitionList.view.tsx` (references `required` filter, `"currency"` type)
- [x] Catalog type errors in `apps/web/src/views/ColumnDefinitionDetail.view.tsx` (references removed fields in display)
- [x] Catalog type errors in `apps/web/src/components/CreateFieldMappingDialog.component.tsx` (missing new fields)
- [x] Catalog type errors in `apps/web/src/components/EditFieldMappingDialog.component.tsx` (missing new fields)
- [x] Catalog type errors in `apps/web/src/utils/record-field-serialization.util.ts` (references `"currency"`, reads `required` from column def)
- [x] Catalog type errors in `apps/web/src/components/DynamicRecordField.component.tsx` (references `"currency"` type)
- [x] Catalog type errors in `apps/web/src/components/EntityRecordDataTable.component.tsx` (references `"currency"`, missing `isValid` filter)
- [x] Catalog type errors in CSV Connector workflow files (references old field ownership)

### 6.3 Run existing tests

- [x] Run `npm run test -- --testPathPattern="apps/web"` — capture baseline of passing/failing tests
- [x] Note: Tests that reference removed fields on column definitions or `"currency"` type WILL fail — this is expected and confirms the contract change propagated correctly
- [x] Document which test files need updates in Phase 2+ based on failures

---

## Summary

| Step | Files Touched | Tests Written | Status |
|------|--------------|---------------|--------|
| 1. Column Definitions API | `column-definitions.api.ts` (no change) | `api/column-definitions.api.test.ts` | [x] |
| 2. Field Mappings API | `field-mappings.api.ts` (no change) | `api/field-mappings.api.test.ts` | [x] |
| 3. Entity Records API | `entity-records.api.ts` (added `revalidate`) | `api/entity-records.api.test.ts` | [x] |
| 4. Query Key Invalidation | `keys.ts` (no change) | `api/query-key-structure.test.ts` | [x] |
| 5. Shared Types | `types.ts` (no change) | — | [x] |
| 6. Smoke Test | — (0 type errors in api/) | — (47/47 tests pass) | [x] |
