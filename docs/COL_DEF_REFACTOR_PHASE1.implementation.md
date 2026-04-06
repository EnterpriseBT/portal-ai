# Backend Phase 1 — Schema & Model Migration: Implementation Plan

> Reference: [COL_DEF_REFACTOR.audit.md](./COL_DEF_REFACTOR.audit.md) for design rationale | [COL_DEF_REFACTOR.spec.md](./COL_DEF_REFACTOR.spec.md) for full specification

## Context

Column definitions and field mappings conflate source-specific concerns (`required`, `defaultValue`, `format`, `enumValues`) with universal column identity. This migration moves those fields to FieldMapping, adds `normalizedKey` to FieldMapping, adds validation/display fields to ColumnDefinition, removes `currency` as a type, and adds validation tracking to EntityRecord.

The dual-schema architecture (Zod models in core + Drizzle tables in API + `type-checks.ts` assertions) means changes to any entity must be made atomically across all three layers. The plan is organized into 5 sections that can each be verified independently.

---

## Section Ordering Rationale

| Section | What | Why This Order |
|---------|------|----------------|
| 1 | Remove currency transitions | Standalone constant, no schema impact |
| 2 | Add fields to FieldMapping + EntityRecord | Additive — existing code ignores new fields |
| 3 | Modify ColumnDefinition + remove currency | Breaking change across all layers — must be atomic |
| 4 | Update upload confirmation flow | Depends on new schemas from 2–3 |
| 5 | Migration SQL + cleanup | Must be last — needs final schema state |

---

## Section 1: Remove `currency` from Transition Constants

**Goal:** Eliminate currency from business logic constants. No schema changes — type-checks unaffected.

### Checklist

- [x] **`apps/api/src/constants/column-definition-transitions.constants.ts`**
  - Remove `number: ["currency"]` entry
  - Remove `currency: ["number"]` entry

### Test Cases

- Existing transition tests should still pass (no test references currency transitions directly)

### Verification

```bash
npm run type-check && npm run test -- --filter=@portalai/api
```

---

## Section 2: Add New Fields to FieldMapping and EntityRecord (Additive)

**Goal:** Add `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues` to FieldMapping. Add `validationErrors`, `isValid` to EntityRecord. Purely additive — existing code ignores new fields.

**Constraint:** Zod model, Drizzle table, and type-checks must change in lockstep per entity. All files in this section must be edited before verifying.

### Checklist

#### FieldMapping — Zod Model

- [x] **`packages/core/src/models/field-mapping.model.ts`**
  - Add `normalizedKey: z.string().regex(/^[a-z][a-z0-9_]*$/)`
  - Add `required: z.boolean()`
  - Add `defaultValue: z.string().nullable()`
  - Add `format: z.string().nullable()`
  - Add `enumValues: z.array(z.string()).nullable()`

#### FieldMapping — Drizzle Table

- [x] **`apps/api/src/db/schema/field-mappings.table.ts`**
  - Add import for `jsonb`
  - Add columns:
    - `normalizedKey: text("normalized_key").notNull()`
    - `required: boolean("required").notNull()`
    - `defaultValue: text("default_value")`
    - `format: text("format")`
    - `enumValues: jsonb("enum_values").$type<string[]>()`
  - Add unique index:
    ```ts
    uniqueIndex("field_mappings_entity_normalized_key_unique")
      .on(table.connectorEntityId, table.normalizedKey)
      .where(sql`deleted IS NULL`)
    ```

#### EntityRecord — Zod Model

- [x] **`packages/core/src/models/entity-record.model.ts`**
  - Add `validationErrors: z.array(z.object({ field: z.string(), error: z.string() })).nullable()`
  - Add `isValid: z.boolean()`

#### EntityRecord — Drizzle Table

- [x] **`apps/api/src/db/schema/entity-records.table.ts`**
  - Add import for `boolean`
  - Add columns:
    - `validationErrors: jsonb("validation_errors").$type<{ field: string; error: string }[]>()`
    - `isValid: boolean("is_valid").notNull()`
  - Add index:
    ```ts
    index("entity_records_entity_is_valid_idx")
      .on(table.connectorEntityId, table.isValid)
    ```

#### Type Assertions

- [x] **`apps/api/src/db/schema/type-checks.ts`** — Verify compile-time assertions pass. If `jsonb` for `validationErrors` widens to a JSON union type, add an `Omit`-based workaround similar to existing patterns.
- [x] **`apps/api/src/db/schema/zod.ts`** — No manual changes needed (auto-generated from `createSelectSchema`/`createInsertSchema`), but verify it compiles.

#### Contracts

- [x] **`packages/core/src/contracts/field-mapping.contract.ts`**
  - `FieldMappingCreateRequestBodySchema`: Add:
    - `normalizedKey: z.string().regex(/^[a-z][a-z0-9_]*$/)`
    - `required: z.boolean().optional().default(false)`
    - `defaultValue: nullableString.optional().default(null)`
    - `format: nullableString.optional().default(null)`
    - `enumValues: z.array(z.string()).nullable().optional().default(null)`
  - `FieldMappingUpdateRequestBodySchema`: Add same fields as optional

- [x] **`packages/core/src/contracts/upload.contract.ts`**
  - `ConfirmColumnSchema`: Add `normalizedKey: z.string().regex(/^[a-z][a-z0-9_]*$/).optional()`

#### Repositories

- [x] **`apps/api/src/db/repositories/field-mappings.repository.ts`**
  - `upsertByEntityAndColumn` set clause: Add `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues`

- [x] **`apps/api/src/db/repositories/entity-records.repository.ts`**
  - `upsertBySourceId` set clause: Add `validationErrors: data.validationErrors`, `isValid: data.isValid`
  - `upsertManyBySourceId` set clause: Add `validationErrors: sql.raw(\`excluded."validation_errors"\`)`, `isValid: sql.raw(\`excluded."is_valid"\`)`

### Test Cases

- [x] **`packages/core/src/__tests__/models/field-mapping.model.test.ts`**
  - Update `validMappingFields` with `normalizedKey: "account_name"`, `required: false`, `defaultValue: null`, `format: null`, `enumValues: null`
  - Add test: `normalizedKey` rejects invalid format (uppercase, hyphens)
  - Add test: `normalizedKey` accepts valid snake_case

- [x] **`packages/core/src/__tests__/models/entity-record.model.test.ts`**
  - Update `validRecordFields` with `validationErrors: null`, `isValid: true`
  - Add test: accepts `validationErrors` array with `{ field, error }` objects
  - Add test: accepts `isValid: false`

- [x] **`packages/core/src/__tests__/contracts/field-mapping.contract.test.ts`**
  - Update `validFieldMapping` helper to include new fields
  - Add test: `FieldMappingCreateRequestBodySchema` requires `normalizedKey`
  - Add test: `normalizedKey` rejects invalid format
  - Add test: `required` defaults to `false`
  - Add test: `defaultValue`, `format`, `enumValues` default to null

- [x] **`packages/core/src/__tests__/contracts/upload.contract.test.ts`**
  - Add test: `ConfirmColumnSchema` accepts optional `normalizedKey`

### Verification

```bash
npm run type-check && npm run build && npm run test && npm run lint
```

---

## Section 3: Modify ColumnDefinition — Remove Fields, Add Fields, Remove `currency`

**Goal:** Remove `required`, `defaultValue`, `format`, `enumValues` from ColumnDefinition. Add `validationPattern`, `validationMessage`, `canonicalFormat`. Remove `"currency"` from the type enum everywhere.

**The build WILL break within this section until all files are updated.** All changes below are atomic — every file must be edited before running verification.

### Checklist

#### Core Model

- [x] **`packages/core/src/models/column-definition.model.ts`**
  - Remove `"currency"` from `ColumnDataTypeEnum`
  - Remove `"currency"` from `SORTABLE_COLUMN_TYPES`
  - Remove fields from `ColumnDefinitionSchema`: `required`, `defaultValue`, `format`, `enumValues`
  - Add fields: `validationPattern: z.string().nullable()`, `validationMessage: z.string().nullable()`, `canonicalFormat: z.string().nullable()`

#### Drizzle Table

- [x] **`apps/api/src/db/schema/column-definitions.table.ts`**
  - Remove `"currency"` from `columnDataTypeEnum`
  - Remove columns: `required`, `defaultValue`, `format`, `enumValues`
  - Add columns: `validationPattern: text("validation_pattern")`, `validationMessage: text("validation_message")`, `canonicalFormat: text("canonical_format")`

#### Filter Contract (currency removal)

- [x] **`packages/core/src/contracts/filter.contract.ts`**
  - Remove `currency: [...]` from `OPERATORS_BY_COLUMN_TYPE` (now safe — `"currency"` no longer in `ColumnDataType`)

#### Column Definition Contracts

- [x] **`packages/core/src/contracts/column-definition.contract.ts`**
  - `ColumnDefinitionListRequestQuerySchema`: Remove `required` query param
  - `ColumnDefinitionCreateRequestBodySchema`: Remove `required`, `defaultValue`, `format`, `enumValues`. Add:
    - `validationPattern: z.string().nullable().optional().default(null)`
    - `validationMessage: z.string().nullable().optional().default(null)`
    - `canonicalFormat: z.string().nullable().optional().default(null)`
  - `ColumnDefinitionUpdateRequestBodySchema`: Same field swap

#### Entity Record Contract (ColumnDefinitionSummary)

- [x] **`packages/core/src/contracts/entity-record.contract.ts`**
  - `ColumnDefinitionSummarySchema`: Remove `required`, `enumValues`, `defaultValue`. Add `validationPattern: z.string().nullable()`, `canonicalFormat: z.string().nullable()`

#### Upload Contract

- [x] **`packages/core/src/contracts/upload.contract.ts`**
  - `ConfirmColumnSchema`: Remove `"currency"` from inline type enum. Add `canonicalFormat: z.string().nullable().optional()`

#### Job Model

- [x] **`packages/core/src/models/job.model.ts`**
  - Remove `"currency"` from inline `ColumnRecommendationSchema` type enum (line ~108)

#### Column Definition Repository

- [x] **`apps/api/src/db/repositories/column-definitions.repository.ts`**
  - `upsertByKey` set clause: Remove `required`, `defaultValue`, `format`, `enumValues`. Add `validationPattern`, `validationMessage`, `canonicalFormat`

#### API Routes

- [x] **`apps/api/src/routes/column-definition.router.ts`**
  - Remove `required` from destructured query params (~line 97)
  - Remove `required` filter push (~lines 119–121)
  - Remove `currency` from Swagger JSDoc type enums
  - Remove `required`, `defaultValue`, `format`, `enumValues` from Swagger create/update schemas
  - Add `validationPattern`, `validationMessage`, `canonicalFormat` to Swagger schemas

- [x] **`apps/api/src/routes/entity-record.router.ts`**
  - Remove `case "currency":` from sort-cast switch (~line 69)
  - Update `resolveColumns` helper (~lines 103–114): Read `required`, `enumValues`, `defaultValue` from mapping `m` instead of column def `cd`. Add `validationPattern: cd.validationPattern ?? null`, `canonicalFormat: cd.canonicalFormat ?? null`

#### API Utilities

- [x] **`apps/api/src/utils/filter-sql.util.ts`**
  - Remove `case "currency":` from both switch statements (~lines 69, 143)

- [x] **`apps/api/src/utils/adapter.util.ts`**
  - Update `resolveColumns` helper (~lines 54–66): Same change as entity-record.router.ts — read `required`, `enumValues`, `defaultValue` from mapping instead of column def. Add `validationPattern`, `canonicalFormat`

#### API Tools

- [x] **`apps/api/src/tools/column-definition-create.tool.ts`**
  - Remove `"currency"` from type description
  - Remove `required`, `enumValues` from InputSchema
  - Add `validationPattern`, `validationMessage`, `canonicalFormat` to InputSchema

#### Swagger Config

- [x] **`apps/api/src/config/swagger.config.ts`**
  - Remove `"currency"` from column type enum (~line 573)
  - Remove `required` property from column definition schema
  - Add `validationPattern`, `validationMessage`, `canonicalFormat`

### Test Cases

- [x] **`packages/core/src/__tests__/models/column-definition.model.test.ts`**
  - Remove `"currency"` from `it.each` type enum test
  - Update `validColumnFields`: Remove `required`, `defaultValue`, `format`, `enumValues`. Add `validationPattern: null`, `validationMessage: null`, `canonicalFormat: null`
  - Update schema shape validation tests
  - Remove tests that assert `required` field behavior

- [x] **`packages/core/src/__tests__/contracts/column-definition.contract.test.ts`**
  - Update `validColumnDefinition` helper: same field swap
  - Remove `required` query param coercion test
  - Update create/update schema tests: remove old field defaults, add new field defaults

- [x] **`packages/core/src/__tests__/contracts/entity-record.contract.test.ts`**
  - Update `ColumnDefinitionSummarySchema` valid payload: remove `required`, `enumValues`, `defaultValue`. Add `validationPattern`, `canonicalFormat`

- [x] **`packages/core/src/__tests__/contracts/filter.contract.test.ts`**
  - Remove `"currency"` from "should include 'between'" test
  - Remove `amount: "currency"` from `columnTypes` in `validateOperatorTypeCompat` tests

- [x] **`packages/core/src/__tests__/contracts/upload.contract.test.ts`**
  - Ensure no test uses `type: "currency"`
  - Add test for `canonicalFormat` field acceptance

- [x] **`apps/api/src/__tests__/utils/filter-sql.util.test.ts`**
  - Remove `{ key: "amount", ..., type: "currency" }` from `columnDefs` fixture (~line 14)
  - Remove or update any test cases that filter on currency columns
  - Update `ColumnDefinitionSummary` shape in fixtures: remove `required`, `enumValues`, `defaultValue`. Add `validationPattern`, `canonicalFormat`

- [x] **`apps/api/src/__tests__/tools/column-definition-create.tool.test.ts`**
  - Remove `"currency"` references
  - Update tool input/output assertions for new fields

### Verification

```bash
npm run type-check && npm run build && npm run test && npm run lint
```

---

## Section 4: Update Upload Confirmation Flow

**Goal:** Wire new fields through the upload confirmation transaction.

### Checklist

- [x] **`apps/api/src/services/uploads.service.ts`**
  - `upsertByKey` call (~line 379): Remove `required`, `defaultValue`, `format`, `enumValues`. Add `validationPattern: null`, `validationMessage: null`, `canonicalFormat: col.canonicalFormat ?? null`
  - `upsertByEntityAndColumn` call (~line 286): Add `normalizedKey: col.normalizedKey ?? col.key`, `required: col.required`, `defaultValue: null`, `format: col.format`, `enumValues: null`
  - `refBidirectionalFieldMappingId` field: Ensure it's still passed (already present)

- [x] **`apps/api/src/services/uploads.service.ts` — response**
  - `ConfirmResponseEntitySchema` field mappings: Added `normalizedKey` to the response objects

### Test Cases

- [x] **`apps/api/src/__tests__/services/uploads.service.test.ts`**
  - Update mock column data: remove `required`, `defaultValue`, `format`, `enumValues` from column def creation
  - Verify field mappings are created with `normalizedKey`, `required`, `format`
  - Ensure no `"currency"` type in test fixtures

### Verification

```bash
npm run type-check && npm run build && npm run test && npm run lint
```

---

## Section 5: Database Migration and Final Cleanup

**Goal:** Generate migration SQL, handle pgEnum removal, backfill data, sweep for remaining `currency` references.

### Checklist

#### Generate Migration

- [x] Run `cd apps/api && npm run db:generate` — review generated SQL (use descriptive name)
- [x] Verify or manually write migration that:

**Step 1 — Add new columns (with defaults for existing rows):**

```sql
ALTER TABLE field_mappings ADD COLUMN normalized_key TEXT NOT NULL DEFAULT '';
ALTER TABLE field_mappings ADD COLUMN required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE field_mappings ADD COLUMN default_value TEXT;
ALTER TABLE field_mappings ADD COLUMN format TEXT;
ALTER TABLE field_mappings ADD COLUMN enum_values JSONB;

ALTER TABLE entity_records ADD COLUMN validation_errors JSONB;
ALTER TABLE entity_records ADD COLUMN is_valid BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE column_definitions ADD COLUMN validation_pattern TEXT;
ALTER TABLE column_definitions ADD COLUMN validation_message TEXT;
ALTER TABLE column_definitions ADD COLUMN canonical_format TEXT;
```

**Step 2 — Backfill field_mappings from linked column_definitions:**

```sql
UPDATE field_mappings fm
SET normalized_key = cd.key,
    required = cd.required,
    default_value = cd.default_value,
    format = cd.format,
    enum_values = cd.enum_values
FROM column_definitions cd
WHERE fm.column_definition_id = cd.id
  AND fm.deleted IS NULL;
```

**Step 3 — Migrate currency rows to number:**

```sql
UPDATE column_definitions
SET type = 'number', canonical_format = '$#,##0.00'
WHERE type = 'currency' AND deleted IS NULL;
```

**Step 4 — Drop removed columns from column_definitions:**

```sql
ALTER TABLE column_definitions DROP COLUMN required;
ALTER TABLE column_definitions DROP COLUMN default_value;
ALTER TABLE column_definitions DROP COLUMN format;
ALTER TABLE column_definitions DROP COLUMN enum_values;
```

**Step 5 — Remove `currency` from pgEnum (rename-create-alter-drop):**

```sql
ALTER TYPE column_data_type RENAME TO column_data_type_old;
CREATE TYPE column_data_type AS ENUM (
  'string','number','boolean','date','datetime',
  'enum','json','array','reference','reference-array'
);
ALTER TABLE column_definitions
  ALTER COLUMN type TYPE column_data_type
  USING type::text::column_data_type;
DROP TYPE column_data_type_old;
```

**Step 6 — Add new indexes:**

```sql
CREATE UNIQUE INDEX field_mappings_entity_normalized_key_unique
  ON field_mappings (connector_entity_id, normalized_key)
  WHERE deleted IS NULL;

CREATE INDEX entity_records_entity_is_valid_idx
  ON entity_records (connector_entity_id, is_valid);
```

> **Note:** Steps 1–2 must run before step 4 to avoid data loss. Step 3 must run before step 5 (no rows can reference `'currency'` when the enum value is removed).

#### Final Sweep

- [x] Grep entire codebase for remaining `"currency"` string literals — verify none remain in source files
- [x] Check `apps/api/src/__tests__/__integration__/` files for `currency` references
- [x] Check `apps/api/src/queues/jobs.worker.ts` for any `currency` or stale field references

### Test Cases

- [x] Integration tests that reference currency types are updated
- [x] If database is available: run `npm run db:migrate` and verify schema

### Verification

```bash
npm run type-check && npm run build && npm run test && npm run lint
# With database:
cd apps/api && npm run db:migrate
```

---

## Critical Files Reference

| File | Role |
|------|------|
| `packages/core/src/models/column-definition.model.ts` | Source of truth for ColumnDefinition shape |
| `packages/core/src/models/field-mapping.model.ts` | Source of truth for FieldMapping shape |
| `packages/core/src/models/entity-record.model.ts` | Source of truth for EntityRecord shape |
| `packages/core/src/models/job.model.ts` | `ColumnRecommendationSchema` inline type enum |
| `apps/api/src/db/schema/column-definitions.table.ts` | Drizzle table + pgEnum definition |
| `apps/api/src/db/schema/field-mappings.table.ts` | Drizzle table for field mappings |
| `apps/api/src/db/schema/entity-records.table.ts` | Drizzle table for entity records |
| `apps/api/src/db/schema/type-checks.ts` | Compile-time sync assertions |
| `apps/api/src/db/schema/zod.ts` | Auto-derived Zod schemas from Drizzle |
| `packages/core/src/contracts/filter.contract.ts` | `OPERATORS_BY_COLUMN_TYPE` exhaustiveness check |
| `packages/core/src/contracts/entity-record.contract.ts` | `ColumnDefinitionSummarySchema` shape |
| `packages/core/src/contracts/upload.contract.ts` | `ConfirmColumnSchema` for upload flow |
| `apps/api/src/constants/column-definition-transitions.constants.ts` | Type transition allowlist |
| `apps/api/src/routes/column-definition.router.ts` | CRUD routes + Swagger docs |
| `apps/api/src/routes/entity-record.router.ts` | `resolveColumns` helper + sort-cast switch |
| `apps/api/src/utils/filter-sql.util.ts` | Type-aware SQL filter builder |
| `apps/api/src/utils/adapter.util.ts` | Second `resolveColumns` helper |
| `apps/api/src/services/uploads.service.ts` | Confirmation transaction creates column defs + field mappings |
| `apps/api/src/tools/column-definition-create.tool.ts` | AI tool parameter schema |
| `apps/api/src/config/swagger.config.ts` | OpenAPI schema definitions |
| `apps/api/src/db/repositories/column-definitions.repository.ts` | `upsertByKey` set clause |
| `apps/api/src/db/repositories/field-mappings.repository.ts` | `upsertByEntityAndColumn` set clause |
| `apps/api/src/db/repositories/entity-records.repository.ts` | `upsertBySourceId` / `upsertManyBySourceId` set clauses |
