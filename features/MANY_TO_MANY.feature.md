# Many-to-Many Relationships (`reference-array`) — Implementation Plan

## Overview

Add a `"reference-array"` column data type that lets a field hold an array of foreign IDs pointing at records in another entity. Bidirectional consistency is surfaced as a **validation warning** in the UI; write-time enforcement is deferred.

**Decisions in effect:**
- Bidirectional consistency = UI validation warning only (no write-time sync)
- No cardinality limit enforced

---

## Scope of Changes

| Layer | Files |
|-------|-------|
| Core model | `packages/core/src/models/column-definition.model.ts` |
| Core model | `packages/core/src/models/field-mapping.model.ts` |
| Core contracts | `packages/core/src/contracts/field-mapping.contract.ts` |
| DB schema (Drizzle) | `apps/api/src/db/schema/column-definitions.table.ts` |
| DB schema (Drizzle) | `apps/api/src/db/schema/field-mappings.table.ts` |
| DB schema (zod) | `apps/api/src/db/schema/zod.ts` — auto-derived, no manual change |
| DB schema (type checks) | `apps/api/src/db/schema/type-checks.ts` |
| DB migration | generated via `npm run db:generate` + `npm run db:migrate` |
| Repository | `apps/api/src/db/repositories/field-mappings.repository.ts` |
| API constants | `apps/api/src/constants/api-codes.constants.ts` |
| API router | `apps/api/src/routes/field-mapping.router.ts` |
| Frontend | `apps/web/src/` (field mapping config UI + entity detail view) |

---

## Implementation Checklist

### 1. Core — Column Definition Model

- [x] In `packages/core/src/models/column-definition.model.ts`, add `"reference-array"` to `ColumnDataTypeEnum`:
  ```ts
  export const ColumnDataTypeEnum = z.enum([
    ...,
    "reference",
    "reference-array",  // ← add
    "currency",
  ]);
  ```
- [x] `SORTABLE_COLUMN_TYPES` — no change needed; `"reference-array"` is not sortable.
- [x] Also added `"reference-array": ["contains", "not_contains", "is_empty", "is_not_empty"]` to `OPERATORS_BY_COLUMN_TYPE` in `packages/core/src/contracts/filter.contract.ts` (exhaustive `Record<ColumnDataType, ...>` required it).
- [x] Also added `"reference-array": Formatter.array` to `formatters` in `apps/web/src/utils/format.util.ts` (exhaustive `Record<ColumnDataType, ...>` required it).
- [x] Verify: `npm run type-check && npm run lint && npm run test && npm run build` — all passed

---

### 2. Core — Field Mapping Model

- [x] In `packages/core/src/models/field-mapping.model.ts`, add the optional back-reference field to `FieldMappingSchema`:
  ```ts
  refBidirectionalFieldMappingId: z.string().nullable(),
  ```
  Place it alongside the existing ref fields (`refColumnDefinitionId`, `refEntityKey`).
- [x] Also updated fixtures in `packages/core/src/__tests__/contracts/field-mapping.contract.test.ts`, `packages/core/src/__tests__/models/field-mapping.model.test.ts`, `apps/web/src/__tests__/ColumnDefinitionDetailView.test.tsx`, and `apps/web/src/workflows/CSVConnector/__tests__/ColumnMappingStep.test.tsx` to include `refBidirectionalFieldMappingId: null`.
- [x] Verify: `npm run type-check && npm run lint && npm run test && npm run build` — all passed

---

### 3. Core — Field Mapping Contract

- [ ] In `packages/core/src/contracts/field-mapping.contract.ts`, expose `refBidirectionalFieldMappingId` on the create and update request body schemas:
  ```ts
  // FieldMappingCreateRequestBodySchema
  refBidirectionalFieldMappingId: z.string().nullable().optional().default(null),

  // FieldMappingUpdateRequestBodySchema — add alongside existing ref fields
  refBidirectionalFieldMappingId: z.string().nullable().optional(),
  ```
- [ ] Add a new response contract for the bidirectional validation check:
  ```ts
  export const FieldMappingBidirectionalValidationResponsePayloadSchema = z.object({
    isConsistent: z.boolean(),
    inconsistentRecordIds: z.array(z.string()),
    totalChecked: z.number(),
  });
  export type FieldMappingBidirectionalValidationResponsePayload = z.infer<...>;
  ```
- [ ] Verify: `npm run type-check && npm run lint && npm run test && npm run build`

---

### 4. DB Schema — Drizzle pgEnum

- [x] In `apps/api/src/db/schema/column-definitions.table.ts`, add `"reference-array"` to `columnDataTypeEnum`:
  ```ts
  export const columnDataTypeEnum = pgEnum("column_data_type", [
    ...,
    "reference",
    "reference-array",  // ← add
    "currency",
  ]);
  ```
  > The enum value order must match `ColumnDataTypeEnum` in core to keep the dual-schema type checks green.
  > Note: this was done alongside step 1 — the `type-checks.ts` assertions compare core against Drizzle, so both must be updated together for the monorepo to type-check cleanly.
- [x] Verify: `npm run type-check && npm run lint && npm run build` — passed as part of step 1 verification

---

### 5. DB Schema — Field Mappings Table

- [x] In `apps/api/src/db/schema/field-mappings.table.ts`, add the nullable column and declare the self-referential FK as a table-level `foreignKey` constraint (column-level `.references(() => fieldMappings.id)` causes a circular type inference error in TypeScript):
  ```ts
  refBidirectionalFieldMappingId: text("ref_bidirectional_field_mapping_id"),
  // ...in table constraints:
  foreignKey({ columns: [table.refBidirectionalFieldMappingId], foreignColumns: [table.id] }),
  ```
  > Note: done alongside step 2 — the `IsAssignable` assertions in `type-checks.ts` require both core model and Drizzle table to be updated together.
- [x] Verify: `npm run type-check && npm run lint && npm run build` — passed as part of step 2 verification

---

### 6. DB Migration

- [ ] Run `npm run db:generate --name=add_reference_array_type_and_bidirectional_field_mapping` from `apps/api/` to produce a migration for:
  - `ALTER TYPE column_data_type ADD VALUE 'reference-array'`
  - `ALTER TABLE field_mappings ADD COLUMN ref_bidirectional_field_mapping_id text REFERENCES field_mappings(id)`
- [ ] Review the generated SQL before applying.
- [ ] Run `npm run db:migrate` to apply.
- [ ] Verify: `npm run type-check && npm run lint && npm run build`

---

### 7. Type-Check Assertions

- [ ] In `apps/api/src/db/schema/type-checks.ts`, verify existing `FieldMapping` assertions still compile after the new column is added to both sides. No new assertion blocks required — the existing bidirectional `IsAssignable` checks for `FieldMapping` ↔ `FieldMappingSelect` will catch any drift automatically.
- [ ] Verify: `npm run type-check && npm run lint && npm run build`

---

### 8. Repository — Field Mappings

- [ ] In `apps/api/src/db/repositories/field-mappings.repository.ts`, include `refBidirectionalFieldMappingId` in the `upsertByEntityAndColumn` conflict resolution `set` block:
  ```ts
  set: {
    sourceField: data.sourceField,
    isPrimaryKey: data.isPrimaryKey,
    refColumnDefinitionId: data.refColumnDefinitionId,
    refEntityKey: data.refEntityKey,
    refBidirectionalFieldMappingId: data.refBidirectionalFieldMappingId,  // ← add
    updated: data.updated ?? Date.now(),
    updatedBy: data.updatedBy,
  }
  ```
- [ ] Add a method `findBidirectionalPair(fieldMappingId: string)` that returns the mapping and its linked counterpart (used by the validation endpoint):
  ```ts
  async findBidirectionalPair(
    fieldMappingId: string,
    client: DbClient = db
  ): Promise<{ mapping: FieldMappingSelect; counterpart: FieldMappingSelect | null }>
  ```
- [ ] Verify: `npm run type-check && npm run lint && npm run test && npm run build`

---

### 9. API — Error Codes

- [ ] In `apps/api/src/constants/api-codes.constants.ts`, add under the Field Mappings section:
  ```ts
  FIELD_MAPPING_BIDIRECTIONAL_VALIDATION_FAILED = "FIELD_MAPPING_BIDIRECTIONAL_VALIDATION_FAILED",
  FIELD_MAPPING_BIDIRECTIONAL_TARGET_NOT_FOUND = "FIELD_MAPPING_BIDIRECTIONAL_TARGET_NOT_FOUND",
  ```
- [ ] Verify: `npm run type-check && npm run lint && npm run build`

---

### 10. API Router — Field Mappings

- [ ] In `apps/api/src/routes/field-mapping.router.ts`, update the `PATCH /:id` handler to accept and persist `refBidirectionalFieldMappingId` (it flows through the existing `parsed.data` spread once the contract is updated).

- [ ] Add a new `GET /:id/validate-bidirectional` endpoint that:
  1. Loads the field mapping; 404 if missing.
  2. Checks that the column type is `"reference-array"`; returns a 400 with `FIELD_MAPPING_BIDIRECTIONAL_VALIDATION_FAILED` if not.
  3. Resolves `refBidirectionalFieldMappingId`; if null, returns `{ isConsistent: null, reason: "no-back-reference-configured" }`.
  4. Queries `entity_records.normalizedData` on both sides using the GIN index (`@>` containment) to find records whose arrays are out of sync.
  5. Returns `FieldMappingBidirectionalValidationResponsePayload`.

  > The GIN index on `entity_records.normalized_data` already supports this via `normalizedData @> '{"field_key": [id]}'::jsonb`. No schema change to `entity_records` is needed.
- [ ] Verify: `npm run type-check && npm run lint && npm run test && npm run build`

---

### 11. Frontend — Field Mapping Configuration

- [ ] In the field mapping creation/edit form (under the Entities or Column Definitions view), add `"reference-array"` as a selectable column type, displayed as "Reference Array (M:M)".
- [ ] When `type === "reference-array"` is selected, show the same ref target fields already present for `"reference"`:
  - Ref Column Definition (dropdown)
  - Ref Entity Key (text)
  - Back-reference Field Mapping (optional dropdown — lists field mappings on the target entity that are also `reference-array` type pointing back)
- [ ] The back-reference field mapping picker is **optional** — leaving it empty means unidirectional mode with no validation available.
- [ ] Verify: `npm run type-check && npm run lint && npm run test && npm run build`

---

### 12. Frontend — Bidirectional Validation Warning

- [ ] On the Entity Detail view (`apps/web/src/routes/entities.$entityId.tsx` or the entity record detail), when a record has a `reference-array` field that has a configured back-reference (`refBidirectionalFieldMappingId` is set):
  - Call `GET /api/field-mappings/:id/validate-bidirectional` on page load (or on demand via a "Check consistency" button).
  - If `isConsistent === false`, render an inline warning banner: _"Array references are out of sync with [target entity name]. X records have inconsistent back-references."_
  - The warning must never block reads or writes — it is advisory only.
- [ ] The warning banner links to a filtered view of the `inconsistentRecordIds`.
- [ ] Verify: `npm run type-check && npm run lint && npm run test && npm run build`

---

## Tests

### Core (unit)

- [ ] `ColumnDataTypeEnum` accepts `"reference-array"` and rejects unknown values.
- [ ] `FieldMappingSchema` accepts `refBidirectionalFieldMappingId: null` and a valid string ID.
- [ ] `FieldMappingCreateRequestBodySchema` defaults `refBidirectionalFieldMappingId` to `null` when omitted.
- [ ] `FieldMappingUpdateRequestBodySchema` allows partial update of `refBidirectionalFieldMappingId`.

### API (integration)

- [ ] `POST /api/field-mappings` with `type: "reference-array"` and `refBidirectionalFieldMappingId: null` persists correctly.
- [ ] `PATCH /api/field-mappings/:id` can set and clear `refBidirectionalFieldMappingId`.
- [ ] `GET /api/field-mappings/:id/validate-bidirectional` returns 400 when the mapping's column type is not `"reference-array"`.
- [ ] `GET /api/field-mappings/:id/validate-bidirectional` returns `{ isConsistent: null, reason: "no-back-reference-configured" }` when `refBidirectionalFieldMappingId` is null.
- [ ] `GET /api/field-mappings/:id/validate-bidirectional` returns `isConsistent: true` when all arrays agree across both entities.
- [ ] `GET /api/field-mappings/:id/validate-bidirectional` returns `isConsistent: false` with `inconsistentRecordIds` populated when arrays diverge.

### Repository (unit)

- [ ] `findBidirectionalPair` returns `{ mapping, counterpart: null }` when `refBidirectionalFieldMappingId` is null.
- [ ] `findBidirectionalPair` returns both mappings when the link is set.
- [ ] `upsertByEntityAndColumn` round-trips `refBidirectionalFieldMappingId`.

### Frontend (component)

- [ ] The field mapping form renders the back-reference picker only when type is `"reference-array"`.
- [ ] The validation warning banner renders when `isConsistent === false`.
- [ ] The warning banner is absent when `isConsistent === true` or the field has no back-reference.
- [ ] The warning banner does not block form submission or record display.

---

## Validations

### At field mapping creation / update

| Condition | Behavior |
|-----------|----------|
| `type` is `"reference-array"` but `refColumnDefinitionId` is null | API returns 400 — a ref target is required for array references |
| `refBidirectionalFieldMappingId` points to a mapping whose column type is not `"reference-array"` | API returns 400 — back-reference must also be a `reference-array` field |
| `refBidirectionalFieldMappingId` points to the mapping itself (self-link) | API returns 400 — a mapping cannot reference itself |
| `refBidirectionalFieldMappingId` points to a mapping in a different organization | API returns 400 — org-scoping violation |
| `refBidirectionalFieldMappingId` is null | Allowed — unidirectional mode |

### At validation check time (non-blocking)

| Condition | Warning surfaced |
|-----------|-----------------|
| Record A contains ID `x` in its array, but Record B (the target with ID `x`) does not list Record A's ID in its back-reference array | "Inconsistent back-reference" warning |
| Back-reference field mapping no longer exists (deleted after linking) | Warning: "Back-reference mapping has been removed — reconfigure or clear this link" |
| Both arrays are in agreement | No warning |

---

## Deferred (out of scope for this iteration)

- Write-time enforcement (sync job that repairs divergent arrays on save)
- Cardinality limit on array length
- UI display of resolved back-reference records inline in the entity record detail
