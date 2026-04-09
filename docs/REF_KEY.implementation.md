# Field Mapping Reference Key Refactor — Implementation Plan

> Based on [REF_KEY.spec.md](./REF_KEY.spec.md) | TDD approach

## Approach

Each step follows red-green-refactor:

1. **Red** — Update tests first to assert the new field names and behavior. Tests fail.
2. **Green** — Update source code to make tests pass.
3. **Verify** — Run type-check, tests, lint, and build at defined checkpoints.

Steps are ordered by dependency. Earlier steps establish types that later steps consume.

---

## Step 1: Core Model Tests

Update the field mapping model test to expect the new schema shape.

### 1.1 Update model test fixtures

- [ ] `packages/core/src/__tests__/models/field-mapping.model.test.ts`
  - Replace `refColumnDefinitionId` with `refNormalizedKey` in all test fixtures
  - Remove `refBidirectionalFieldMappingId` from all test fixtures
  - Add test: valid model with `refNormalizedKey: "user_id"` and `refEntityKey: "user"` parses successfully
  - Add test: valid model with `refNormalizedKey: null` and `refEntityKey: null` parses successfully
  - Update any existing ref field validation tests

### 1.2 Update model source

- [ ] `packages/core/src/models/field-mapping.model.ts`
  - Replace `refColumnDefinitionId: z.string().nullable()` with `refNormalizedKey: z.string().nullable()`
  - Remove `refBidirectionalFieldMappingId: z.string().nullable()`
  - Update comment on line 26

### Verify

```bash
cd packages/core && npm run test -- --testPathPattern="field-mapping.model"
```

- [ ] Model tests pass

---

## Step 2: Core Contract Tests

### 2.1 Update field mapping contract tests

- [ ] `packages/core/src/__tests__/contracts/field-mapping.contract.test.ts`
  - Replace `refColumnDefinitionId` → `refNormalizedKey` in create/update request fixtures
  - Remove `refBidirectionalFieldMappingId` from create/update request fixtures
  - Update delete response assertions: `bidirectionalCleared` → `counterpartCleared`
  - Update impact response assertions: `bidirectionalCounterpart` → `counterpart` with added `normalizedKey` field

### 2.2 Update upload contract tests

- [ ] `packages/core/src/__tests__/contracts/upload.contract.test.ts`
  - Replace `refColumnKey` and `refColumnDefinitionId` with `refNormalizedKey` in `ConfirmColumnSchema` test fixtures
  - Add test: `ConfirmColumnSchema` rejects when `refColumnKey` is present (old field)

### 2.3 Update contract source

- [ ] `packages/core/src/contracts/field-mapping.contract.ts`
  - Create request: `refColumnDefinitionId` → `refNormalizedKey`, remove `refBidirectionalFieldMappingId`
  - Update request: same
  - Delete response: `bidirectionalCleared` → `counterpartCleared`
  - Impact response: `bidirectionalCounterpart` → `counterpart`, add `normalizedKey: z.string()` to shape

- [ ] `packages/core/src/contracts/upload.contract.ts`
  - Remove `refColumnKey` and `refColumnDefinitionId` from `ConfirmColumnSchema`
  - Add `refNormalizedKey: z.string().nullable().optional()`

### Verify

```bash
cd packages/core && npm run test -- --testPathPattern="contracts"
```

- [ ] Contract tests pass

### Checkpoint A — Core package

```bash
cd packages/core && npm run test && npm run lint
```

- [ ] All core tests pass
- [ ] Core lint passes

---

## Step 3: Database Schema

### 3.1 Update Drizzle table

- [ ] `apps/api/src/db/schema/field-mappings.table.ts`
  - Remove `refColumnDefinitionId` column (with `.references(() => columnDefinitions.id)`)
  - Remove `refBidirectionalFieldMappingId` column
  - Add `refNormalizedKey: text("ref_normalized_key")`
  - Remove `field_mappings_entity_column_unique` index from constraints array
  - Remove `foreignKey` for `refBidirectionalFieldMappingId` from constraints array

### 3.2 Verify type alignment

```bash
cd apps/api && npm run type-check
```

- [ ] Type-check passes (type-checks.ts `IsAssignable` assertions compile)

### 3.3 Generate migration

```bash
cd apps/api && npm run db:generate -- --name add-ref-normalized-key
```

- [ ] Migration file generated in `apps/api/drizzle/`
- [ ] Review migration SQL: adds `ref_normalized_key`, drops `ref_column_definition_id`, drops `ref_bidirectional_field_mapping_id`, drops `field_mappings_entity_column_unique` index, drops both FK constraints

### 3.4 Apply migration (dev only)

```bash
cd apps/api && npm run db:push
```

- [ ] Schema pushed to dev database

---

## Step 4: Repository Layer

### 4.1 Update repository integration tests

- [ ] `apps/api/src/__tests__/__integration__/db/repositories/field-mappings.repository.integration.test.ts`
  - Rename `upsertByEntityAndColumn` test block → `upsertByEntityAndNormalizedKey`
  - Update upsert test: conflict on `(connectorEntityId, normalizedKey)` updates `columnDefinitionId` in `set`
  - Add test: two field mappings with same `columnDefinitionId` but different `normalizedKey` coexist (no conflict)
  - Add test: upsert with same `normalizedKey` updates existing row (including `columnDefinitionId` change)
  - Remove `findByRefColumnDefinitionId` tests
  - Remove `countByRefColumnDefinitionId` tests
  - Add `findCounterpart` tests:
    - Returns counterpart when bidirectional pair exists
    - Returns null when no counterpart exists
    - Returns null when target mapping exists but doesn't point back
    - Skips soft-deleted mappings
  - Update `findBidirectionalPair` tests to work without `refBidirectionalFieldMappingId`
  - Replace `refColumnDefinitionId` → `refNormalizedKey` in all test fixtures
  - Remove `refBidirectionalFieldMappingId` from all test fixtures

### 4.2 Update repository source

- [ ] `apps/api/src/db/repositories/field-mappings.repository.ts`
  - Rename `upsertByEntityAndColumn` → `upsertByEntityAndNormalizedKey`
  - Change conflict target to `[fieldMappings.connectorEntityId, fieldMappings.normalizedKey]`
  - Update `set` clause: remove `normalizedKey` (now in conflict target), add `columnDefinitionId`, replace `refColumnDefinitionId` → `refNormalizedKey`, remove `refBidirectionalFieldMappingId`
  - Remove `findByRefColumnDefinitionId` method
  - Remove `countByRefColumnDefinitionId` method
  - Add `findCounterpart(organizationId, entityKey, refEntityKey, refNormalizedKey, client)` method
  - Update `findBidirectionalPair` to use `findCounterpart` instead of `refBidirectionalFieldMappingId`
  - Update `findByRefEntityKey` / `countByRefEntityKey` — remove any `refBidirectionalFieldMappingId` references

### 4.3 Update fixture files

These integration test files seed field mapping data. Update all fixtures to use `refNormalizedKey` instead of `refColumnDefinitionId` and remove `refBidirectionalFieldMappingId`:

- [ ] `apps/api/src/__tests__/__integration__/db/repositories/entity-group-members.repository.integration.test.ts`
- [ ] `apps/api/src/__tests__/__integration__/db/repositories/entity-groups.repository.integration.test.ts`
- [ ] `apps/api/src/__tests__/__integration__/db/repositories/connector-entities.repository.integration.test.ts`
- [ ] `apps/api/src/__tests__/__integration__/tools/entity-management.integration.test.ts`

### Verify

```bash
cd apps/api && npm run type-check
```

- [ ] Type-check passes

---

## Step 5: Service Layer — Uploads

### 5.1 Update uploads service tests

- [ ] `apps/api/src/__tests__/services/uploads.service.test.ts`
  - Remove all tests for `resolveRefColumnDefinitionId`
  - Update confirm test fixtures: replace `refColumnKey`/`refColumnDefinitionId` → `refNormalizedKey` in column payloads
  - Update stale-mapping cleanup assertions: filter by `normalizedKey` not `columnDefinitionId`
  - Add test: confirm with two columns sharing same `columnDefinitionId` but different `normalizedKey` creates two distinct field mappings
  - Update upsert call assertions: expect `upsertByEntityAndNormalizedKey` instead of `upsertByEntityAndColumn`
  - Verify upsert data includes `refNormalizedKey` (not `refColumnDefinitionId`) and excludes `refBidirectionalFieldMappingId`

### 5.2 Update uploads service source

- [ ] `apps/api/src/services/uploads.service.ts`
  - Remove `resolveRefColumnDefinitionId()` private static method
  - Update `hasRefFields` check: `!!col.refNormalizedKey || colDef.type === "reference" || ...`
  - Remove `refColumnDefinitionId` resolution block
  - Update stale-mapping cleanup: filter by `normalizedKey` instead of `columnDefinitionId`
  - Remove `incomingColDefIds` set construction
  - Rename `upsertByEntityAndColumn` → `upsertByEntityAndNormalizedKey` call
  - Update upsert data: `refNormalizedKey` instead of `refColumnDefinitionId`, remove `refBidirectionalFieldMappingId`

### Verify

```bash
cd apps/api && npm run test -- --testPathPattern="uploads.service"
```

- [ ] Uploads service tests pass

---

## Step 6: Service Layer — Validation

### 6.1 Update column definition validation tests

- [ ] `apps/api/src/__tests__/services/column-definition-validation.service.test.ts`
  - Remove assertions for `findByRefColumnDefinitionId` call
  - Remove `refFieldMappings` from error detail assertions
  - Update: `validateDelete` only checks `findByColumnDefinitionId` (direct mappings)

### 6.2 Update column definition validation source

- [ ] `apps/api/src/services/column-definition-validation.service.ts`
  - Remove `findByRefColumnDefinitionId` from `validateDelete`
  - Remove `refFieldMappings` from error detail object
  - Simplify to single `findByColumnDefinitionId` call

### 6.3 Update field mapping validation tests

- [ ] Tests for `field-mapping-validation.service.ts` (unit or integration)
  - Update `FieldMappingCascadeResult` assertions: `bidirectionalCleared` → `counterpartCleared`
  - Update delete cascade tests: expect counterpart resolution via `findCounterpart` instead of direct ID lookup
  - Add test: delete mapping with `refEntityKey` + `refNormalizedKey` clears counterpart's ref fields
  - Add test: delete mapping without ref fields does not attempt counterpart resolution
  - Add test: delete mapping where counterpart doesn't point back — `counterpartCleared: false`

### 6.4 Update field mapping validation source

- [ ] `apps/api/src/services/field-mapping-validation.service.ts`
  - Rename `FieldMappingCascadeResult.bidirectionalCleared` → `counterpartCleared`
  - Replace `executeDelete` cascade logic: use `findCounterpart` instead of `refBidirectionalFieldMappingId`
  - Clear `refNormalizedKey` and `refEntityKey` on counterpart (not `refBidirectionalFieldMappingId`)

### Verify

```bash
cd apps/api && npm run test -- --testPathPattern="(column-definition-validation|field-mapping-validation)"
```

- [ ] Validation service tests pass

---

## Step 7: Router Layer

### 7.1 Update field mapping router integration tests

- [ ] `apps/api/src/__tests__/__integration__/routes/field-mapping.router.integration.test.ts`
  - POST create: send `refNormalizedKey` and `refEntityKey` (not `refColumnDefinitionId` / `refBidirectionalFieldMappingId`)
  - PATCH update: same field renames
  - GET impact: assert `counterpart` (with `normalizedKey`) instead of `bidirectionalCounterpart`
  - GET validate-bidirectional: seed bidirectional pair using ref fields only (no explicit ID link), assert consistency check works
  - DELETE: assert `counterpartCleared` instead of `bidirectionalCleared`

- [ ] `apps/api/src/__tests__/__integration__/routes/uploads.router.integration.test.ts`
  - Update confirm payloads: `refNormalizedKey` instead of `refColumnKey`/`refColumnDefinitionId`
  - Assert created field mappings have `refNormalizedKey` set correctly
  - Add test: confirm with two columns sharing `columnDefinitionId` creates both mappings

- [ ] `apps/api/src/__tests__/__integration__/routes/column-definition.router.integration.test.ts`
  - Update delete validation tests: no ref dependency check (only direct mapping dependency)

- [ ] `apps/api/src/__tests__/__integration__/routes/connector-instance.router.integration.test.ts`
  - Update field mapping fixtures

- [ ] `apps/api/src/__tests__/__integration__/routes/entity-group.router.integration.test.ts`
  - Update field mapping fixtures

- [ ] `apps/api/src/__tests__/__integration__/routes/entity-group-member.router.integration.test.ts`
  - Update field mapping fixtures

### 7.2 Update field mapping router source

- [ ] `apps/api/src/routes/field-mapping.router.ts`
  - POST create: `refNormalizedKey` and `refEntityKey` from `parsed.data` (remove `refBidirectionalFieldMappingId`)
  - PATCH update: verify `parsed.data` spread works (contract change handles this)
  - GET impact: replace `refBidirectionalFieldMappingId` lookup with `findCounterpart`; add `normalizedKey` to counterpart shape; rename `bidirectionalCounterpart` → `counterpart`
  - GET validate-bidirectional: change guard to `!mapping.refEntityKey || !mapping.refNormalizedKey`; use updated `findBidirectionalPair`; change `keyA`/`keyB` to use `mapping.normalizedKey` / `counterpart.normalizedKey`
  - DELETE: use renamed `counterpartCleared` from cascade result

### 7.3 Update swagger config

- [ ] `apps/api/src/config/swagger.config.ts`
  - Replace `refColumnDefinitionId` → `refNormalizedKey` in FieldMapping schema
  - Remove `refBidirectionalFieldMappingId` from FieldMapping schema
  - Update request/response schemas for create, update, delete, impact endpoints

### 7.4 Update API codes (optional)

- [ ] `apps/api/src/constants/api-codes.constants.ts`
  - Optionally rename `FIELD_MAPPING_BIDIRECTIONAL_*` → `FIELD_MAPPING_COUNTERPART_*` (cosmetic, not required)

### Verify

```bash
cd apps/api && npm run test && npm run type-check && npm run lint
```

- [ ] All API tests pass
- [ ] API type-check passes
- [ ] API lint passes

### Checkpoint B — Full API

```bash
cd apps/api && npm run build
```

- [ ] API builds successfully

---

## Step 8: Frontend — Upload Workflow

### 8.1 Update upload workflow tests

- [ ] `apps/web/src/workflows/CSVConnector/__tests__/upload-workflow.test.ts`
  - `updateColumn persists ref fields`: assert `refNormalizedKey` instead of `refColumnKey`
  - `updateColumn can set refColumnDefinitionId for an existing DB column`: rewrite as `updateColumn sets refNormalizedKey for DB mode`
  - `confirm() includes ref fields in request body`: assert `refNormalizedKey` in payload, remove `refColumnKey`/`refColumnDefinitionId`
  - Remove any test that asserts `refColumnKey` or `refColumnDefinitionId` independently

### 8.2 Update upload workflow source

- [ ] `apps/web/src/workflows/CSVConnector/utils/upload-workflow.util.ts`
  - `RecommendedColumn`: replace `refColumnKey` and `refColumnDefinitionId` with `refNormalizedKey`
  - `RecommendedColumnUpdate`: same
  - `confirm()` payload: `refNormalizedKey: col.refNormalizedKey ?? null`

### Verify

```bash
cd apps/web && npm run test -- --testPathPattern="upload-workflow"
```

- [ ] Upload workflow tests pass

---

## Step 9: Frontend — Column Mapping Step

### 9.1 Update ColumnMappingStep tests

- [ ] `apps/web/src/workflows/CSVConnector/__tests__/ColumnMappingStep.test.tsx`
  - Update ReferenceEditor tests: assert column dropdown shows `fm.normalizedKey` in DB mode (not `fm.columnDefinition.id`)
  - Update: `handleColumnChange` sets `refNormalizedKey` for both batch and DB mode
  - Update: `deriveEntitySelectValue` derives mode from entity list presence, not from which ref field is set
  - Add test: DB mode lists two distinct entries when field mappings share a column definition

### 9.2 Update ColumnMappingStep source

- [ ] `apps/web/src/workflows/CSVConnector/ColumnMappingStep.component.tsx`
  - `deriveEntitySelectValue`: use `refNormalizedKey` only, determine batch/db from entity lists
  - DB mode column options: `value: fm.normalizedKey`, `label: fm.normalizedKey (fm.sourceField)`
  - `currentColumnValue`: `column.refNormalizedKey ?? ""`
  - `handleEntityChange`: reset `refNormalizedKey` (not `refColumnKey`/`refColumnDefinitionId`)
  - `handleColumnChange`: unified `{ refNormalizedKey: val }` for both modes

### Verify

```bash
cd apps/web && npm run test -- --testPathPattern="ColumnMappingStep"
```

- [ ] ColumnMappingStep tests pass

---

## Step 10: Frontend — Review Step

### 10.1 Update ReviewStep tests

- [ ] `apps/web/src/workflows/CSVConnector/__tests__/ReviewStep.test.tsx`
  - Update ref display assertions: `refEntityKey.refNormalizedKey` instead of `refEntityKey.refColumnKey`

### 10.2 Update ReviewStep source

- [ ] `apps/web/src/workflows/CSVConnector/ReviewStep.component.tsx`
  - `formatRefTarget`: use `col.refNormalizedKey` instead of `col.refColumnKey`

### Verify

```bash
cd apps/web && npm run test -- --testPathPattern="ReviewStep"
```

- [ ] ReviewStep tests pass

---

## Step 11: Frontend — Field Mapping Dialogs

### 11.1 Update dialog tests

- [ ] `apps/web/src/__tests__/CreateFieldMappingDialog.test.tsx`
  - Replace `refColumnDefinitionId` → `refNormalizedKey` in form state assertions
  - Remove `refBidirectionalFieldMappingId` from form state assertions
  - Update submit payload assertions
  - Remove `onSearchFieldMappings` prop from test renders

- [ ] `apps/web/src/__tests__/EditFieldMappingDialog.test.tsx`
  - Same changes as create dialog tests
  - Update initial form values from `fieldMapping` prop

- [ ] `apps/web/src/__tests__/ColumnDefinitionDetailView.test.tsx`
  - Remove `onSearchFieldMappings` prop assertions
  - Update default field mapping value assertions

### 11.2 Update dialog source

- [ ] `apps/web/src/components/CreateFieldMappingDialog.component.tsx`
  - Form schema: `refNormalizedKey` replaces `refColumnDefinitionId`, remove `refBidirectionalFieldMappingId`
  - Form state interface: same
  - Initial state: same
  - Submit handler: send `refNormalizedKey` and `refEntityKey`
  - UI: two selects (entity + normalizedKey) instead of three; remove `onSearchFieldMappings` prop

- [ ] `apps/web/src/components/EditFieldMappingDialog.component.tsx`
  - Same changes as create dialog
  - Initial values from prop: `refNormalizedKey: fm.refNormalizedKey`

- [ ] `apps/web/src/views/ColumnDefinitionDetail.view.tsx`
  - Remove `sdk.fieldMappings.searchWithEntity()` call
  - Remove `onSearchFieldMappings` prop from dialog renders
  - Update default field mapping values: `refNormalizedKey: null`

### Verify

```bash
cd apps/web && npm run test -- --testPathPattern="(CreateFieldMappingDialog|EditFieldMappingDialog|ColumnDefinitionDetail)"
```

- [ ] Dialog and view tests pass

### Checkpoint C — Full frontend

```bash
cd apps/web && npm run test && npm run type-check && npm run lint
```

- [ ] All web tests pass
- [ ] Web type-check passes
- [ ] Web lint passes

---

## Step 12: AI Tool

### 12.1 Update tool source

- [ ] `apps/api/src/tools/field-mapping-create.tool.ts`
  - Replace `refColumnDefinitionId: null` → `refNormalizedKey: null`
  - Remove `refBidirectionalFieldMappingId: null`

### Verify

```bash
cd apps/api && npm run type-check
```

- [ ] Type-check passes

---

## Step 13: Final Verification

### Full monorepo checks

```bash
npm run type-check
```

- [ ] Type-check passes across all packages

```bash
npm run test
```

- [ ] All tests pass across all packages

```bash
npm run lint
```

- [ ] Lint passes across all packages

```bash
npm run build
```

- [ ] Build succeeds across all packages

### Manual smoke tests

- [ ] Upload CSV with `reference` column type — batch mode ref selection works
- [ ] Upload CSV with `reference` column type — DB mode ref selection shows `normalizedKey` values
- [ ] Upload CSV where two columns share a column definition — both mappings created
- [ ] Upload CSV with `reference-array` column type — bidirectional validation works
- [ ] Create field mapping via dialog with ref fields
- [ ] Edit field mapping via dialog — ref fields populate and save
- [ ] Delete field mapping with counterpart — counterpart ref fields cleared
- [ ] Impact assessment shows counterpart with `normalizedKey`

---

## Summary

| Step | Scope | Key files | Checkpoint |
|------|-------|-----------|------------|
| 1 | Core model | `field-mapping.model.ts` + test | Model tests pass |
| 2 | Core contracts | `field-mapping.contract.ts`, `upload.contract.ts` + tests | **A**: Core tests + lint |
| 3 | Database | `field-mappings.table.ts` + migration | Type-check passes |
| 4 | Repository | `field-mappings.repository.ts` + integration tests | Type-check passes |
| 5 | Uploads service | `uploads.service.ts` + test | Service tests pass |
| 6 | Validation services | `column-definition-validation.service.ts`, `field-mapping-validation.service.ts` + tests | Service tests pass |
| 7 | Router + swagger | `field-mapping.router.ts`, `swagger.config.ts` + integration tests | **B**: API tests + build |
| 8 | Upload workflow | `upload-workflow.util.ts` + test | Workflow tests pass |
| 9 | ColumnMappingStep | `ColumnMappingStep.component.tsx` + test | Component tests pass |
| 10 | ReviewStep | `ReviewStep.component.tsx` + test | Component tests pass |
| 11 | Dialogs + view | Create/Edit dialogs, detail view + tests | **C**: Web tests + lint |
| 12 | AI tool | `field-mapping-create.tool.ts` | Type-check passes |
| 13 | Final | — | All tests, lint, build pass |
