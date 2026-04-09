# Bulk Write — Implementation Plan (TDD)

> Step-by-step checklist based on `BULK_WRITE.spec.md`. Each step follows red-green-refactor: write the failing test first, implement just enough to pass, then clean up.

---

## Phase 1 — Infrastructure

Spec references: Sections 7, 8, 10

### 1.1 `NormalizationService.normalizeMany`

File: `apps/api/src/services/normalization.service.ts`
Test: `apps/api/src/__tests__/services/normalization.service.test.ts`

- [x] **RED** — Add test: `normalizeMany loads mappings once and normalizes all items`
  - Mock `fieldMappings.findMany` to return two mappings
  - Call `normalizeMany("ce-1", [data1, data2, data3])`
  - Assert `findMany` called exactly once
  - Assert return value is an array of 3 `NormalizationResult` objects
  - Assert each result matches what `normalizeWithMappings` would return for that item
- [x] **RED** — Add test: `normalizeMany returns empty array for empty input`
  - Call `normalizeMany("ce-1", [])`
  - Assert return value is `[]`
  - Assert `findMany` still called once (mappings are fetched regardless)
- [x] **GREEN** — Implement `normalizeMany` static method
  - Fetch mappings once via `findMany(eq(fieldMappings.connectorEntityId, id), { include: ["columnDefinition"] })`
  - Map over `dataItems` calling `normalizeWithMappings(mappings, data)`
- [x] **REFACTOR** — No expected cleanup

### 1.2 `AnalyticsService` batch cache methods

File: `apps/api/src/services/analytics.service.ts`
Test: `apps/api/src/__tests__/services/analytics.service.test.ts`

- [x] **RED** — Add test: `cacheBatchInsert inserts multiple rows in a single AlaSQL call`
  - Set up a station database in `stationDatabases` map
  - Call `applyRecordInsertMany(stationId, entityKey, [row1, row2, row3])`
  - Query AlaSQL to verify all 3 rows are present
- [x] **RED** — Add test: `cacheBatchInsert is a no-op when rows array is empty`
  - Call `applyRecordInsertMany(stationId, entityKey, [])`
  - Verify no AlaSQL calls made (or no error thrown)
- [x] **RED** — Add test: `cacheBatchUpsert replaces existing rows by ID`
  - Insert 2 rows, then call `applyRecordUpdateMany` with updated versions
  - Query AlaSQL to verify rows are updated, not duplicated
- [x] **RED** — Add test: `cacheBatchDelete removes rows by ID array`
  - Insert 3 rows, call `applyRecordDeleteMany` with 2 IDs
  - Query AlaSQL to verify only 1 row remains
- [x] **GREEN** — Implement private primitives
  - `cacheBatchInsert(stationId, table, rows)` — single `INSERT INTO ... SELECT * FROM ?`
  - `cacheBatchUpsert(stationId, table, idColumn, rows)` — `DELETE ... WHERE IN` then `INSERT`
  - `cacheBatchDelete(stationId, table, idColumn, ids)` — `DELETE ... WHERE IN`
- [x] **GREEN** — Implement public batch methods (all delegate to primitives)
  - `applyRecordInsertMany`, `applyRecordUpdateMany`, `applyRecordDeleteMany`
  - `applyColumnDefinitionInsertMany`, `applyColumnDefinitionUpdateMany`, `applyColumnDefinitionDeleteMany`
  - `applyFieldMappingInsertMany`, `applyFieldMappingUpdateMany`, `applyFieldMappingDeleteMany`
  - `applyEntityInsertMany`, `applyEntityUpdateMany`, `applyEntityDeleteMany`
- [x] **REFACTOR** — Ensure single-item `apply*` methods delegate to batch methods with a one-element array (DRY, optional)

### 1.3 `MutationResultContentBlockSchema` extension

File: `packages/core/src/contracts/portal.contract.ts`

- [x] **RED** — Add test in `packages/core` (or inline assertion): schema accepts `{ type: "mutation-result", operation: "created", entity: "record", count: 5, items: [{ entityId: "a" }] }` without `entityId` at the top level
- [x] **RED** — Add test: schema still accepts the old shape `{ type: "mutation-result", operation: "created", entity: "record", entityId: "a" }` (backward compat)
- [x] **GREEN** — Change `entityId` to `.optional()`, add `count: z.number().int().optional()`, add `items: z.array(z.object({ entityId: z.string(), summary: z.record(z.string(), z.unknown()).optional() })).optional()`
- [x] **REFACTOR** — Run `npm run type-check` to verify no downstream breakage from `entityId` becoming optional

---

## Phase 2 — Entity Record Tools

Spec references: Sections 2.1, 4, 6, 13.1–13.3

### 2.1 `entity_record_create` bulk support

File: `apps/api/src/tools/entity-record-create.tool.ts`
Test: `apps/api/src/__tests__/tools/entity-record-create.tool.test.ts`

- [x] **RED** — Add test: `single-item regression — { items: [single] } produces same result as before`
  - Call with `{ items: [{ connectorEntityId: "ce-1", data: { Name: "Jane" } }] }`
  - Assert `success: true`, `count: 1`, `items` array with one entry
  - Assert `NormalizationService.normalizeMany` called (not `normalize`)
  - Assert `entityRecords.createMany` called with one-element array
- [x] **RED** — Add test: `bulk create — 3 items persisted in single createMany call`
  - Call with 3 items targeting same `connectorEntityId`
  - Assert `assertStationScope` called once (not 3 times)
  - Assert `assertWriteCapability` called once
  - Assert `NormalizationService.normalizeMany` called once with 3-element data array
  - Assert `entityRecords.createMany` called once with 3 models
  - Assert response `count: 3` with 3-element `items` array
- [x] **RED** — Add test: `bulk create — mixed connectorEntityIds groups correctly`
  - 2 items for "ce-1", 1 item for "ce-2"
  - Assert `assertStationScope` called twice (once per entity)
  - Assert `normalizeMany` called twice (once per entity)
- [x] **RED** — Add test: `validation failure — scope check fails, nothing written`
  - `assertStationScope` rejects for one `connectorEntityId`
  - Assert response `success: false` with `failures`
  - Assert `createMany` not called
- [x] **RED** — Add test: `auto-generates sourceId per item when omitted`
  - Call with 2 items without `sourceId`
  - Assert each created model has a unique UUID `sourceId`
- [x] **GREEN** — Rewrite `execute` handler
  - Change `InputSchema` to `{ items: z.array(ItemSchema).min(1).max(100) }`
  - Update `description` string to mention bulk support
  - Implement three-phase pattern: validate → transaction → cache
  - Group by `connectorEntityId`, run scope/capability once per group
  - Call `NormalizationService.normalizeMany` per group
  - Build models with `EntityRecordModelFactory` per item
  - Call `entityRecords.createMany(models, tx)` inside `Repository.transaction`
  - Call `AnalyticsService.applyRecordInsertMany` per entity group after commit
  - Return `{ success, operation: "created", entity: "record", count, items }`
- [x] **REFACTOR** — Extract `groupBy` helper if not already available; verify existing single-item tests still pass

### 2.2 `entity_record_update` bulk support

File: `apps/api/src/tools/entity-record-update.tool.ts`
Test: `apps/api/src/__tests__/tools/entity-record-update.tool.test.ts`

- [x] **RED** — Add test: `single-item regression — { items: [single] } behaves as before`
  - Assert `success: true`, `count: 1`
  - Assert `normalizeMany` called, `updateMany` called with one payload
- [x] **RED** — Add test: `bulk update — 3 items updated in single transaction`
  - Mock `findById` to return matching records for all 3 IDs
  - Assert `updateMany` called with 3 payloads
  - Assert scope checks run once per unique entity
- [x] **RED** — Add test: `validation failure — record not found for one item, nothing written`
  - Mock `findById` to return null for second item
  - Assert `success: false`, `failures` includes index 1
  - Assert `updateMany` not called
- [x] **RED** — Add test: `validation failure — record belongs to wrong entity`
  - Mock `findById` to return record with different `connectorEntityId`
  - Assert failure for that item
- [x] **GREEN** — Rewrite `execute` handler with items wrapper and three-phase pattern
- [x] **REFACTOR** — Verify existing tests pass

### 2.3 `entity_record_delete` bulk support

File: `apps/api/src/tools/entity-record-delete.tool.ts`
Test: `apps/api/src/__tests__/tools/entity-record-delete.tool.test.ts`

- [x] **RED** — Add test: `single-item regression`
- [x] **RED** — Add test: `bulk delete — 3 items soft-deleted via softDeleteMany`
  - Assert `softDeleteMany` called with 3 IDs
  - Assert scope checks run once per unique entity
- [x] **RED** — Add test: `validation failure — record not found, nothing deleted`
- [x] **GREEN** — Rewrite `execute` handler
- [x] **REFACTOR** — Verify existing tests pass

---

## Phase 3 — Column Definition Tools

Spec references: Sections 2.2, 4, 5, 6, 13.4–13.6

### 3.1 `column_definition_create` bulk support + reuse logic

File: `apps/api/src/tools/column-definition-create.tool.ts`
Test: `apps/api/src/__tests__/tools/column-definition-create.tool.test.ts`

- [x] **RED** — Add test: `single-item regression — { items: [single] } behaves as before`
  - Mock `findByOrganizationId` to return empty array (no existing defs)
  - Assert `upsertByKey` called once
  - Assert response `count: 1`, `created: 1`, `reused: 0`
- [x] **RED** — Add test: `bulk create — 3 new items upserted`
  - Assert `upsertByKey` called 3 times within transaction
  - Assert response `count: 3`, `created: 3`, `reused: 0`
- [x] **RED** — Add test: `reuse — existing definition with matching key+type is not upserted`
  - Mock `findByOrganizationId` to return `[{ key: "revenue", type: "number", id: "cd-existing" }]`
  - Call with `items: [{ key: "revenue", type: "number", label: "Revenue" }]`
  - Assert `upsertByKey` NOT called for this item
  - Assert response item has `entityId: "cd-existing"`, `summary.status: "reused"`
  - Assert `reused: 1`, `created: 0`
- [x] **RED** — Add test: `reuse with type mismatch — existing key but different type triggers upsert`
  - Existing: `{ key: "revenue", type: "string" }`, input: `{ key: "revenue", type: "number" }`
  - Assert `upsertByKey` IS called (type change forces update)
  - Assert `summary.status: "created"` (not reused)
- [x] **RED** — Add test: `within-batch dedup — duplicate keys collapsed, last occurrence wins`
  - Call with `items: [{ key: "cost", label: "Cost v1", type: "number" }, { key: "cost", label: "Cost v2", type: "number" }]`
  - Assert `upsertByKey` called once with `label: "Cost v2"`
  - Assert response `count: 1` (deduplicated to 1 item)
- [x] **RED** — Add test: `mixed reuse and create in one batch`
  - 2 items: one matching existing key+type, one new
  - Assert `reused: 1`, `created: 1`, `count: 2`
- [x] **GREEN** — Rewrite `execute` handler
  - Change `InputSchema` to items wrapper
  - Load existing column defs via `findByOrganizationId(organizationId)`
  - Build `key→def` lookup map
  - Deduplicate within batch (last occurrence per key wins)
  - For each deduplicated item: check reuse (key+type match) → skip upsert; otherwise upsert in transaction
  - Build response with `reused`/`created` counts and per-item `status`
- [x] **REFACTOR** — Ensure `AnalyticsService.applyColumnDefinitionInsertMany` only includes actually-written items (not reused ones)

### 3.2 `column_definition_update` bulk support

File: `apps/api/src/tools/column-definition-update.tool.ts`
Test: `apps/api/src/__tests__/tools/column-definition-update.tool.test.ts`

- [x] **RED** — Add test: `single-item regression`
- [x] **RED** — Add test: `bulk update — 3 items updated in transaction`
  - Mock `findById` to return matching definitions
  - Assert `update` called 3 times with correct data
- [x] **RED** — Add test: `validation failure — column definition not found`
  - Mock `findById` to return null for second item
  - Assert `success: false`, nothing updated
- [x] **RED** — Add test: `validation failure — wrong organization`
  - Mock `findById` to return def with different `organizationId`
  - Assert failure
- [x] **GREEN** — Rewrite `execute` handler with items wrapper
- [x] **REFACTOR** — Verify existing tests pass

### 3.3 `column_definition_delete` bulk support

File: `apps/api/src/tools/column-definition-delete.tool.ts`
Test: `apps/api/src/__tests__/tools/column-definition-delete.tool.test.ts`

- [x] **RED** — Add test: `single-item regression`
- [x] **RED** — Add test: `bulk delete — 3 items soft-deleted in transaction`
  - Assert `validateDelete` called for each item
  - Assert `softDelete` called 3 times
- [x] **RED** — Add test: `validation failure — field mappings reference one definition, nothing deleted`
  - Mock `validateDelete` to throw for second item
  - Assert `success: false`, `softDelete` not called for any item
- [x] **GREEN** — Rewrite `execute` handler
- [x] **REFACTOR** — Verify existing tests pass

---

## Phase 4 — Field Mapping Tools

Spec references: Sections 2.3, 4, 6, 13.7–13.9

### 4.1 `field_mapping_create` bulk support

File: `apps/api/src/tools/field-mapping-create.tool.ts`
Test: `apps/api/src/__tests__/tools/field-mapping-create.tool.test.ts`

- [x] **RED** — Add test: `single-item regression`
  - Assert `assertStationScope` + `assertWriteCapability` called
  - Assert `findById` called for column definition
  - Assert `upsertByEntityAndNormalizedKey` called once
- [x] **RED** — Add test: `bulk create — 3 mappings upserted in transaction`
  - Assert scope checks run once per unique entity
  - Assert all 3 column definitions verified
  - Assert `upsertByEntityAndNormalizedKey` called 3 times
- [x] **RED** — Add test: `validation failure — column definition not found for one item`
  - Mock `findById` to return null for one `columnDefinitionId`
  - Assert `success: false`, nothing written
- [x] **RED** — Add test: `validation failure — column definition belongs to different org`
  - Assert failure
- [x] **RED** — Add test: `bulk create — batch column definition lookup`
  - 3 items referencing 2 unique `columnDefinitionId`s
  - Assert `findById` called only twice (not 3 times) — batch-load optimization
- [x] **GREEN** — Rewrite `execute` handler with items wrapper
  - Batch-load unique `columnDefinitionId`s, build id→def map
  - Validate all before writing
  - Upsert in transaction loop
- [x] **REFACTOR** — Verify existing tests pass

### 4.2 `field_mapping_update` bulk support

File: `apps/api/src/tools/field-mapping-update.tool.ts`
Test: `apps/api/src/__tests__/tools/field-mapping-update.tool.test.ts`

- [x] **RED** — Add test: `single-item regression`
- [x] **RED** — Add test: `bulk update — 3 mappings updated`
  - Assert scope checks grouped by `connectorEntityId`
  - Assert `update` called 3 times
- [x] **RED** — Add test: `validation failure — mapping not found`
- [x] **RED** — Add test: `validation failure — wrong organization`
- [x] **GREEN** — Rewrite `execute` handler
- [x] **REFACTOR** — Verify existing tests pass

### 4.3 `field_mapping_delete` bulk support

File: `apps/api/src/tools/field-mapping-delete.tool.ts`
Test: `apps/api/src/__tests__/tools/field-mapping-delete.tool.test.ts`

- [x] **RED** — Add test: `single-item regression`
- [x] **RED** — Add test: `bulk delete — 3 mappings deleted sequentially`
  - Assert `validateDelete` called for all 3 before any `executeDelete`
  - Assert `executeDelete` called 3 times
- [x] **RED** — Add test: `validation failure — one mapping fails validateDelete, nothing deleted`
  - Assert `executeDelete` not called for any item
- [x] **GREEN** — Rewrite `execute` handler
  - Validate all items first (load mapping, check org, check scope, `validateDelete`)
  - Execute deletes sequentially (not in wrapping transaction — per spec Section 9)
- [x] **REFACTOR** — Verify existing tests pass

---

## Phase 5 — Connector Entity Tools

Spec references: Sections 2.4, 4, 6, 13.10–13.12

### 5.1 `connector_entity_create` bulk support

File: `apps/api/src/tools/connector-entity-create.tool.ts`
Test: `apps/api/src/__tests__/tools/connector-entity-create.tool.test.ts`

- [x] **RED** — Add test: `single-item regression`
  - Assert station link check, instance lookup, capability check, `upsertByKey`
- [x] **RED** — Add test: `bulk create — 3 entities created in transaction`
  - All targeting same `connectorInstanceId`
  - Assert station link loaded once, instance looked up once, capability checked once
  - Assert `upsertByKey` called 3 times
- [x] **RED** — Add test: `bulk create — mixed connectorInstanceIds`
  - 2 items for "ci-1", 1 item for "ci-2"
  - Assert instance lookup called twice
- [x] **RED** — Add test: `validation failure — instance not attached to station`
  - Assert `success: false`, nothing written
- [x] **RED** — Add test: `validation failure — write capability disabled`
  - Assert failure
- [x] **GREEN** — Rewrite `execute` handler
  - Load station links once
  - Group by `connectorInstanceId`, verify attachment + write capability once per group
  - Upsert in transaction loop
- [x] **REFACTOR** — Verify existing tests pass

### 5.2 `connector_entity_update` bulk support

File: `apps/api/src/tools/connector-entity-update.tool.ts`
Test: `apps/api/src/__tests__/tools/connector-entity-update.tool.test.ts`

- [x] **RED** — Add test: `single-item regression`
- [x] **RED** — Add test: `bulk update — 3 entities updated`
  - Assert scope checks grouped
  - Assert `update` called 3 times
- [x] **RED** — Add test: `validation failure — entity not found`
- [x] **GREEN** — Rewrite `execute` handler
- [x] **REFACTOR** — Verify existing tests pass

### 5.3 `connector_entity_delete` bulk support

File: `apps/api/src/tools/connector-entity-delete.tool.ts`
Test: `apps/api/src/__tests__/tools/connector-entity-delete.tool.test.ts`

- [x] **RED** — Add test: `single-item regression`
- [x] **RED** — Add test: `bulk delete — 3 entities deleted sequentially`
  - Assert `validateDelete` called for all 3 before any `executeDelete`
  - Assert `executeDelete` called 3 times
  - Assert `applyEntityDeleteMany` called once with all 3 entity IDs/keys
- [x] **RED** — Add test: `validation failure — one entity fails validateDelete, nothing deleted`
  - Assert `executeDelete` not called for any item
- [x] **GREEN** — Rewrite `execute` handler
  - Validate all items first (scope check, `validateDelete`)
  - Execute deletes sequentially (not in wrapping transaction — per spec Section 9)
- [x] **REFACTOR** — Verify existing tests pass

---

## Phase 6 — Frontend Display

Spec references: Sections 10, 11

### 6.1 `MutationResultBlock` bulk-aware rendering

File: `packages/core/src/ui/MutationResultBlock.tsx`
Test: `packages/core/src/__tests__/MutationResultBlock.test.tsx` (new file)

- [x] **RED** — Add test: `renders "Created record" for single-item result (no count)`
  - Pass `{ type: "mutation-result", operation: "created", entity: "record", entityId: "r-1" }`
  - Assert text contains "Created" and "record"
- [x] **RED** — Add test: `renders "Created 5 records" when count > 1`
  - Pass `{ type: "mutation-result", operation: "created", entity: "record", count: 5 }`
  - Assert text contains "Created" and "5 records"
- [x] **RED** — Add test: `renders "Deleted 3 field mappings" for bulk delete`
  - Pass `{ type: "mutation-result", operation: "deleted", entity: "field mapping", count: 3 }`
  - Assert text contains "Deleted" and "3 field mappings"
- [x] **RED** — Add test: `renders summary text in parentheses for bulk result`
  - Pass `{ ..., count: 5, summary: { entityLabel: "Customers" } }`
  - Assert text contains "(entityLabel: Customers)"
- [x] **RED** — Add test: `backward compat — old shape with entityId still renders`
  - Pass `{ type: "mutation-result", operation: "updated", entity: "record", entityId: "r-1", summary: { sourceId: "abc" } }`
  - Assert renders without error, shows "Updated" and "record"
- [x] **GREEN** — Update component
  - Derive `isBulk = (content.count ?? 0) > 1`
  - Bulk: render `{count} {entity}s`
  - Single: render `{entity}` (unchanged)
- [x] **REFACTOR** — Verify no changes needed in `PortalSession.component.tsx` (the `"mutation-result"` type check is unchanged)

---

## Phase 7 — Integration Verification

### 7.1 Type check and lint

- [x] Run `npm run type-check` — verify no TypeScript errors across the monorepo
- [x] Run `npm run lint` — verify no lint errors (0 errors, pre-existing warnings only)

### 7.2 Run full test suite

- [x] Run `npm run test` from repo root — all existing + new tests pass (720 tests, 47 suites)

### 7.3 Manual smoke test

- [ ] Start dev servers (`npm run dev`)
- [ ] Open a portal session with entity management tools enabled
- [ ] Ask the LLM to create multiple records in a single prompt — verify it uses the `items` array
- [ ] Verify the UI renders a single "Created N records" block (not N individual blocks)
- [ ] Verify the records appear in the data table
- [ ] Test a bulk column definition create that reuses an existing definition — verify `reused` count in the result

### 7.4 Tool description audit

- [x] Verify all 12 tool `description` strings mention "1–100 items" bulk capability
- [x] Verify all `items` field `.describe()` strings document the range

---

## File Change Summary

| File | Action | Phase |
|------|--------|-------|
| `apps/api/src/services/normalization.service.ts` | Add `normalizeMany` | 1.1 |
| `apps/api/src/__tests__/services/normalization.service.test.ts` | Add tests | 1.1 |
| `apps/api/src/services/analytics.service.ts` | Add batch cache methods | 1.2 |
| `apps/api/src/__tests__/services/analytics.service.test.ts` | Add tests | 1.2 |
| `packages/core/src/contracts/portal.contract.ts` | Extend schema | 1.3 |
| `apps/api/src/tools/entity-record-create.tool.ts` | Rewrite execute handler | 2.1 |
| `apps/api/src/__tests__/tools/entity-record-create.tool.test.ts` | Replace + add tests | 2.1 |
| `apps/api/src/tools/entity-record-update.tool.ts` | Rewrite execute handler | 2.2 |
| `apps/api/src/__tests__/tools/entity-record-update.tool.test.ts` | Replace + add tests | 2.2 |
| `apps/api/src/tools/entity-record-delete.tool.ts` | Rewrite execute handler | 2.3 |
| `apps/api/src/__tests__/tools/entity-record-delete.tool.test.ts` | Replace + add tests | 2.3 |
| `apps/api/src/tools/column-definition-create.tool.ts` | Rewrite with reuse logic | 3.1 |
| `apps/api/src/__tests__/tools/column-definition-create.tool.test.ts` | Replace + add tests | 3.1 |
| `apps/api/src/tools/column-definition-update.tool.ts` | Rewrite execute handler | 3.2 |
| `apps/api/src/__tests__/tools/column-definition-update.tool.test.ts` | Replace + add tests | 3.2 |
| `apps/api/src/tools/column-definition-delete.tool.ts` | Rewrite execute handler | 3.3 |
| `apps/api/src/__tests__/tools/column-definition-delete.tool.test.ts` | Replace + add tests | 3.3 |
| `apps/api/src/tools/field-mapping-create.tool.ts` | Rewrite execute handler | 4.1 |
| `apps/api/src/__tests__/tools/field-mapping-create.tool.test.ts` | Replace + add tests | 4.1 |
| `apps/api/src/tools/field-mapping-update.tool.ts` | Rewrite execute handler | 4.2 |
| `apps/api/src/__tests__/tools/field-mapping-update.tool.test.ts` | Replace + add tests | 4.2 |
| `apps/api/src/tools/field-mapping-delete.tool.ts` | Rewrite execute handler | 4.3 |
| `apps/api/src/__tests__/tools/field-mapping-delete.tool.test.ts` | Replace + add tests | 4.3 |
| `apps/api/src/tools/connector-entity-create.tool.ts` | Rewrite execute handler | 5.1 |
| `apps/api/src/__tests__/tools/connector-entity-create.tool.test.ts` | Replace + add tests | 5.1 |
| `apps/api/src/tools/connector-entity-update.tool.ts` | Rewrite execute handler | 5.2 |
| `apps/api/src/__tests__/tools/connector-entity-update.tool.test.ts` | Replace + add tests | 5.2 |
| `apps/api/src/tools/connector-entity-delete.tool.ts` | Rewrite execute handler | 5.3 |
| `apps/api/src/__tests__/tools/connector-entity-delete.tool.test.ts` | Replace + add tests | 5.3 |
| `packages/core/src/ui/MutationResultBlock.tsx` | Add bulk rendering | 6.1 |
| `packages/core/src/__tests__/MutationResultBlock.test.tsx` | New test file | 6.1 |
