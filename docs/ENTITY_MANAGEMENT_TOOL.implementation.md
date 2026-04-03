# Entity Management Tool Pack — Implementation Plan

> **Spec:** [ENTITY_MANAGEMENT_TOOL.spec.md](./ENTITY_MANAGEMENT_TOOL.spec.md)
> **Discovery:** [ENTITY_MANAGEMENT_TOOL.discovery.md](./ENTITY_MANAGEMENT_TOOL.discovery.md)

---

## Phase 1: Schema & Model Foundation

Adds the `origin` field to entity records and updates the `StationToolPackSchema`. Pure schema/model changes — no runtime behavior changes yet.

### 1.1 Add `origin` pgEnum and column to entity records table

**File:** `apps/api/src/db/schema/entity-records.table.ts`

- [x] Define `entityRecordOrigin` pgEnum: `["sync", "manual", "portal"]`
- [x] Add `origin` column to `entityRecords` table: `entityRecordOrigin("origin").notNull().default("manual")`
- [x] Export the `EntityRecordOrigin` type if needed by other schema files

### 1.2 Add `origin` to Zod model

**File:** `packages/core/src/models/entity-record.model.ts`

- [x] Add `origin: z.enum(["sync", "manual", "portal"]).default("manual")` to `EntityRecordSchema`

### 1.3 Update drizzle-zod generated schemas

**File:** `apps/api/src/db/schema/zod.ts`

- [x] Add `origin` to `createSelectSchema` and `createInsertSchema` for entity records

> No manual changes needed — `createSelectSchema(entityRecords)` and `createInsertSchema(entityRecords)` automatically pick up the new column from the Drizzle table definition.

### 1.4 Add type checks

**File:** `apps/api/src/db/schema/type-checks.ts`

- [x] Add bidirectional `IsAssignable` checks for the `origin` field between Zod model and Drizzle table

> No manual changes needed — the existing bidirectional `IsAssignable` checks for `EntityRecord` ↔ `EntityRecordSelect` already cover all fields including the new `origin` column. Type-check passes.

### 1.5 Generate and apply migration

- [x] Run `npm run db:generate` from `apps/api/` (use descriptive name)
- [x] Verify generated SQL adds `origin` column with `DEFAULT 'manual'`
- [x] Run `npm run db:migrate` from `apps/api/`

### 1.6 Add `"entity_management"` to `StationToolPackSchema`

**File:** `packages/core/src/models/station.model.ts`

- [x] Add `"entity_management"` to the `StationToolPackSchema` z.enum array

### 1.7 Update `ALL_TOOL_PACKS` and `PACK_TOOL_NAMES`

**File:** `apps/api/src/services/tools.service.ts`

- [x] Add `"entity_management"` to `ALL_TOOL_PACKS` array
- [x] Add all 12 tool names to `PACK_TOOL_NAMES` set: `entity_list`, `entity_record_list`, `entity_record_create`, `entity_record_update`, `entity_record_delete`, `connector_entity_update`, `connector_entity_delete`, `column_definition_create`, `column_definition_update`, `column_definition_delete`, `field_mapping_create`, `field_mapping_delete`

### 1.8 Contract tests for `origin` field

**File:** `packages/core/src/__tests__/models/entity-record.model.test.ts`

- [x] Test: `EntityRecordSchema` accepts `origin: "sync"` — parse succeeds
- [x] Test: `EntityRecordSchema` accepts `origin: "manual"` — parse succeeds
- [x] Test: `EntityRecordSchema` accepts `origin: "portal"` — parse succeeds
- [x] Test: `EntityRecordSchema` rejects invalid origin value — parse fails
- [x] Test: `EntityRecordSchema` defaults origin to `"manual"` when omitted — parsed value is `"manual"`

### Phase 1 Verification

- [x] `npm run type-check` passes
- [x] `npm run build` passes
- [x] `npm run test -- --selectProjects core` — all model tests pass (1126 tests)
- [ ] `npm run db:push` (dev only) succeeds with new schema
- [ ] Drizzle Studio shows `origin` column on `entity_records` table

---

## Phase 2: Origin Backfill

Sets `origin` on all existing record creation paths so the field is populated correctly going forward. No new features — just wiring the field into existing code.

### 2.1 Set `origin: "sync"` in CSV import

**File:** `apps/api/src/services/csv-import.service.ts`

- [x] In `importFromS3()`, add `origin: "sync"` to the `model.update()` call (alongside `data`, `normalizedData`, `sourceId`, etc.)

### 2.2 Set `origin: "manual"` in REST create endpoint

**File:** `apps/api/src/routes/entity-record.router.ts`

- [x] In the `POST /` handler, add `origin: "manual"` to the `model.update()` call
- [x] Also set `origin: "sync"` in the `POST /import` bulk import handler

### 2.3 Update existing tests

**File:** `apps/api/src/__tests__/services/csv-import.service.test.ts`

- [x] Verify upserted records include `origin: "sync"` in mock assertions

**File:** `apps/api/src/__tests__/__integration__/routes/entity-record.router.integration.test.ts`

- [x] Add assertion to existing POST test: `expect(record.origin).toBe("manual")`

### Phase 2 Verification

- [x] `npm run test -- --selectProjects api` passes — no regressions (651 tests)
- [x] CSV import integration test (if exists) passes with `origin: "sync"`
- [x] Entity record POST integration test passes with `origin: "manual"`

---

## Phase 3: Capability Plumbing

Adds the helper functions that resolve station-level capabilities and enforce station scope. These are prerequisites for tool registration and runtime permission checks.

### 3.1 Add `STATION_SCOPE_VIOLATION` API code

**File:** `apps/api/src/constants/api-codes.constants.ts`

- [x] Add `STATION_SCOPE_VIOLATION = "STATION_SCOPE_VIOLATION"` to `ApiCode` enum

### 3.2 Add `StationInstanceCapability` interface and `resolveStationCapabilities()`

**File:** `apps/api/src/utils/resolve-capabilities.util.ts`

- [x] Define `StationInstanceCapability` interface: `{ connectorInstanceId: string, capabilities: ResolvedCapabilities }`
- [x] Implement `resolveStationCapabilities(stationId)` — loads station instances, resolves capabilities for each via `resolveCapabilities()`
- [x] Add necessary imports: `stationInstancesRepo`

### 3.3 Add `assertStationScope()`

**File:** `apps/api/src/utils/resolve-capabilities.util.ts`

- [x] Implement `assertStationScope(stationId, connectorEntityId)` — verifies entity belongs to a station-attached instance
- [x] Throws 404 `CONNECTOR_ENTITY_NOT_FOUND` if entity doesn't exist
- [x] Throws 403 `STATION_SCOPE_VIOLATION` if entity's instance is not attached to station

### 3.4 Add `resolveEntityCapabilities()`

**File:** `apps/api/src/utils/resolve-capabilities.util.ts`

- [x] Implement `resolveEntityCapabilities(stationId)` — builds `Record<entityId, ResolvedCapabilities>` map
- [x] Uses existing `connectorEntitiesRepo.findByConnectorInstanceId()` (method already exists)

### 3.5 Unit tests for capability plumbing

**File:** `apps/api/src/__tests__/utils/resolve-capabilities.util.test.ts`

#### `resolveStationCapabilities()`

- [x] Test: returns empty array for station with no instances
- [x] Test: returns capabilities for each attached instance
- [x] Test: respects instance-level override narrowing write to false
- [x] Test: inherits definition capabilities when override is null
- [x] Test: skips instances with missing definitions

#### `assertStationScope()`

- [x] Test: passes for entity belonging to an attached instance
- [x] Test: throws `CONNECTOR_ENTITY_NOT_FOUND` for non-existent entity
- [x] Test: throws `STATION_SCOPE_VIOLATION` for cross-station entity

#### `resolveEntityCapabilities()`

- [x] Test: returns capability map keyed by entity ID
- [x] Test: returns empty map for station with no instances

### Phase 3 Verification

- [x] `npm run type-check` passes
- [x] `npm run test -- --selectProjects api` — all resolve-capabilities tests pass (17 tests)
- [x] No regressions in existing capability tests (398 unit tests pass)

---

## Phase 4: System Prompt Enrichment

Updates the system prompt to surface per-entity capability flags and sync behavior guidance.

### 4.1 Extend `StationContext` interface

**File:** `apps/api/src/prompts/system.prompt.ts`

- [x] Add `entityCapabilities?: Record<string, ResolvedCapabilities>` to `StationContext`
- [x] Add import for `ResolvedCapabilities` type

### 4.2 Update `buildSystemPrompt()` — capability flags

**File:** `apps/api/src/prompts/system.prompt.ts`

- [x] Update entity rendering loop to append `[read, write]` or `[read]` flags based on `entityCapabilities`
- [x] Omit flags when `entityCapabilities` is undefined (backward compatible)

### 4.3 Update `buildSystemPrompt()` — sync guidance

**File:** `apps/api/src/prompts/system.prompt.ts`

- [x] When `entity_management` is in `toolPacks`, append "Entity Management Notes" section explaining sync behavior for tool-created vs. synced records

### 4.4 Wire entity capabilities in `PortalService.createPortal()`

**File:** `apps/api/src/services/portal.service.ts`

- [x] When `toolPacks` includes `"entity_management"`, call `resolveEntityCapabilities(stationId)`
- [x] Pass result as `entityCapabilities` in the `StationContext`
- [x] Add import for `resolveEntityCapabilities`

### 4.5 System prompt tests

**File:** `apps/api/src/__tests__/prompts/system.prompt.test.ts`

- [x] Test: renders `[read, write]` when entity has both capabilities
- [x] Test: renders `[read]` for read-only entities
- [x] Test: omits flags when `entityCapabilities` is undefined
- [x] Test: includes "Entity Management Notes" section when `entity_management` in `toolPacks`
- [x] Test: omits "Entity Management Notes" when `entity_management` not in `toolPacks`

### Phase 4 Verification

- [x] `npm run type-check` passes
- [x] `npm run test -- --selectProjects api` — all system prompt tests pass (5 tests)
- [x] No regressions (403 unit tests pass)

---

## Phase 5: Shared Validation Services

Extracts validation and cascade logic from routers into reusable service classes. Both tools and routers will call these services.

### 5.1 `NormalizationService`

**File:** `apps/api/src/services/normalization.service.ts`

- [x] Create static class with `normalize(connectorEntityId, data)` method
- [x] Loads field mappings with `include: ["columnDefinition"]`
- [x] Builds `normalizedData` by projecting `data` through `sourceField → columnDefinitionKey`
- [x] Falls back to passthrough (`{ ...data }`) when no field mappings exist
- [x] Add unit tests:

**File:** `apps/api/src/__tests__/services/normalization.service.test.ts`

- [x] Test: normalizes data through field mappings
- [x] Test: omits unmapped source fields
- [x] Test: passes through data when no field mappings exist
- [x] Test: handles missing source fields gracefully

### 5.2 `ConnectorEntityValidationService`

**File:** `apps/api/src/services/connector-entity-validation.service.ts`

- [x] Create static class with `validateDelete(connectorEntityId)` — checks write capability and external references
- [x] Create `executeDelete(connectorEntityId, userId)` — cascade soft-delete in transaction
- [x] Add unit tests:

**File:** `apps/api/src/__tests__/services/connector-entity-validation.service.test.ts`

- [x] Test: `validateDelete` passes when no external references exist
- [x] Test: `validateDelete` throws `CONNECTOR_INSTANCE_WRITE_DISABLED` when write disabled
- [x] Test: `validateDelete` throws `ENTITY_HAS_EXTERNAL_REFERENCES` when references exist
- [x] Test: `executeDelete` cascade soft-deletes all dependent objects
- [x] Test: `executeDelete` runs in a single transaction

### 5.3 `FieldMappingValidationService`

**File:** `apps/api/src/services/field-mapping-validation.service.ts`

- [x] Create static class with `validateDelete(fieldMappingId)` — checks record count
- [x] Create `executeDelete(fieldMappingId, userId)` — cascade + bidirectional clear
- [x] Add unit tests:

**File:** `apps/api/src/__tests__/services/field-mapping-validation.service.test.ts`

- [x] Test: `validateDelete` passes when entity has no records
- [x] Test: `validateDelete` throws `FIELD_MAPPING_DELETE_HAS_RECORDS` when records exist
- [x] Test: `executeDelete` cascade soft-deletes group members
- [x] Test: `executeDelete` clears bidirectional counterpart
- [x] Test: `executeDelete` returns `bidirectionalCleared: false` when no counterpart

### 5.4 `ColumnDefinitionValidationService`

**File:** `apps/api/src/services/column-definition-validation.service.ts`

- [x] Create static class with `validateDelete(columnDefinitionId)` — checks field mapping dependencies
- [x] Add unit tests:

**File:** `apps/api/src/__tests__/services/column-definition-validation.service.test.ts`

- [x] Test: `validateDelete` passes when no field mappings reference it
- [x] Test: `validateDelete` throws `COLUMN_DEFINITION_HAS_DEPENDENCIES` when referenced

### Phase 5 Verification

- [x] `npm run type-check` passes
- [x] `npm run test -- --selectProjects api` — all 4 service test files pass (17 tests)
- [x] No regressions in existing tests (420 unit tests pass)

---

## Phase 6: Router Refactoring

Refactors existing DELETE handlers to use the shared validation services. No behavior change — existing integration tests must continue to pass.

### 6.1 Refactor connector entity DELETE handler

**File:** `apps/api/src/routes/connector-entity.router.ts`

- [x] Replace inline write capability check + external reference check + cascade logic with:
  - `ConnectorEntityValidationService.validateDelete(id)`
  - `ConnectorEntityValidationService.executeDelete(id, userId)`
- [x] Keep `try/catch` + `next(error)` pattern in router
- [x] Remove inlined logic (capability resolution, transaction block)

### 6.2 Refactor field mapping DELETE handler

**File:** `apps/api/src/routes/field-mapping.router.ts`

- [x] Replace inline record count check + cascade logic with:
  - `FieldMappingValidationService.validateDelete(id)`
  - `FieldMappingValidationService.executeDelete(id, userId)`
- [x] Keep router-level error handling

### 6.3 Refactor column definition DELETE handler

**File:** `apps/api/src/routes/column-definition.router.ts`

- [x] Replace inline dependency check with:
  - `ColumnDefinitionValidationService.validateDelete(id)`
- [x] Keep existing `softDelete()` call in router (no cascade needed)

### Phase 6 Verification

- [x] `npm run type-check` passes
- [x] `npm run test -- --selectProjects api` — **zero** test regressions (651 tests pass)
- [x] Connector entity DELETE integration tests pass (same behavior, different code path)
- [x] Field mapping DELETE integration tests pass
- [x] Column definition DELETE integration tests pass
- [x] `npm run lint` passes (0 errors)

---

## Phase 7: `buildAnalyticsTools()` Signature Change

Updates the tool builder signature to accept `userId` and `onDataMutation`. This phase makes no behavioral change yet — the new parameters are accepted but not consumed until tools are registered in Phase 9.

### 7.1 Update `buildAnalyticsTools()` signature

**File:** `apps/api/src/services/tools.service.ts`

- [x] Add `userId: string` parameter (3rd positional)
- [x] Add `onDataMutation?: () => void` parameter (4th positional)

### 7.2 Update all call sites

**File:** `apps/api/src/services/portal.service.ts`

- [x] In `streamResponse()`, pass `userId` as 3rd arg (added `userId` to `streamResponse` params)
- [x] Pass `() => stationDataCache.delete(portalId)` as `onDataMutation`

**File:** `apps/api/src/routes/portal-events.router.ts`

- [x] Pass `portal.createdBy` as `userId` to `streamResponse()`

### 7.3 Update existing tool service tests

**File:** `apps/api/src/__tests__/services/tools.service.test.ts`

- [x] Update test call signatures to include new parameters

**File:** `apps/api/src/__tests__/services/portal.service.test.ts`

- [x] Update all `streamResponse()` test calls to include `userId`
- [x] Update `buildAnalyticsTools` assertion to expect new args

### Phase 7 Verification

- [x] `npm run type-check` passes
- [x] `npm run test -- --selectProjects api` — all tool service tests pass (422 unit tests)
- [x] No regressions

---

## Phase 8: Read Tools

Implements the 2 read-only tools. These are simpler and validate the tool registration pattern before tackling write tools.

### 8.1 `EntityListTool`

**File:** `apps/api/src/tools/entity-list.tool.ts`

- [x] Define `InputSchema` with optional `connectorInstanceId`
- [x] Extend `Tool<typeof InputSchema>`
- [x] `build(stationId)` returns tool that:
  - Loads station instances → attached instance IDs
  - Calls `connectorEntities.findByConnectorInstanceId()` for each attached instance
  - Optionally filters by `connectorInstanceId` if provided
  - Returns `{ entities: [{ id, key, label, connectorInstanceId }] }`

### 8.2 `EntityRecordListTool`

**File:** `apps/api/src/tools/entity-record-list.tool.ts`

- [x] Define `InputSchema` with `connectorEntityId`, optional `limit` (default 20), optional `offset` (default 0)
- [x] Extend `Tool<typeof InputSchema>`
- [x] `build(stationId)` returns tool that:
  - Calls `assertStationScope(stationId, connectorEntityId)`
  - Calls `entityRecords.findMany()` with limit/offset
  - Returns `{ records: [{ id, sourceId, normalizedData }], total }`

### 8.3 Unit tests for read tools

**File:** `apps/api/src/__tests__/tools/entity-list.tool.test.ts`

- [x] Test: returns only entities attached to station
- [x] Test: filters by `connectorInstanceId` when provided
- [x] Test: returns empty array for station with no entities

**File:** `apps/api/src/__tests__/tools/entity-record-list.tool.test.ts`

- [x] Test: returns paginated records (respects limit and offset)
- [x] Test: validates station scope — rejects entity from another station
- [x] Test: returns total count alongside records

### Phase 8 Verification

- [x] `npm run type-check` passes
- [x] `npm run test -- --selectProjects api` — read tool tests pass (6 tests)
- [x] No regressions (428 unit tests pass)

---

## Phase 9: Write Tools

Implements all 10 write tools. Each tool follows the same pattern: validate input → check scope → check permissions → call service/repository → invalidate cache → return result.

### 9.1 Entity Record Write Tools

**File:** `apps/api/src/tools/entity-record-create.tool.ts`

- [x] Input: `{ connectorEntityId, sourceId?, data }`
- [x] Execute: scope check → write check → `NormalizationService.normalize()` → `entityRecords.create()` with `origin: "portal"`, `checksum: "manual"`, `createdBy: userId` → `onMutation()`
- [x] Returns `{ success: true, recordId }` or `{ error: "..." }`

**File:** `apps/api/src/tools/entity-record-update.tool.ts`

- [x] Input: `{ connectorEntityId, entityRecordId, data }`
- [x] Execute: scope check → write check → verify record belongs to entity → `NormalizationService.normalize()` → `entityRecords.update()` → `onMutation()`

**File:** `apps/api/src/tools/entity-record-delete.tool.ts`

- [x] Input: `{ connectorEntityId, entityRecordId }`
- [x] Execute: scope check → write check → verify record belongs to entity → `entityRecords.softDelete()` → `onMutation()`

### 9.2 Connector Entity Write Tools

**File:** `apps/api/src/tools/connector-entity-update.tool.ts`

- [x] Input: `{ connectorEntityId, label }`
- [x] Execute: scope check → write check → `connectorEntities.update()` → `onMutation()`

**File:** `apps/api/src/tools/connector-entity-delete.tool.ts`

- [x] Input: `{ connectorEntityId }`
- [x] Execute: scope check → `ConnectorEntityValidationService.validateDelete()` → `.executeDelete()` → `onMutation()` → return cascaded counts

### 9.3 Column Definition Write Tools

**File:** `apps/api/src/tools/column-definition-create.tool.ts`

- [x] Input: `{ key, label, type, required?, enumValues?, description? }`
- [x] Execute: `columnDefinitions.upsertByKey()` → `onMutation()`
- [x] No scope or write capability check (organization-level)

**File:** `apps/api/src/tools/column-definition-update.tool.ts`

- [x] Input: `{ columnDefinitionId, label?, description?, enumValues? }`
- [x] Execute: verify exists → `columnDefinitions.update()` → `onMutation()`
- [x] `key` and `type` are immutable — not in input schema

**File:** `apps/api/src/tools/column-definition-delete.tool.ts`

- [x] Input: `{ columnDefinitionId }`
- [x] Execute: `ColumnDefinitionValidationService.validateDelete()` → `columnDefinitions.softDelete()` → `onMutation()`

### 9.4 Field Mapping Write Tools

**File:** `apps/api/src/tools/field-mapping-create.tool.ts`

- [x] Input: `{ connectorEntityId, columnDefinitionId, sourceField, isPrimaryKey? }`
- [x] Execute: scope check → write check → verify column definition exists → `fieldMappings.upsertByEntityAndColumn()` → `onMutation()`

**File:** `apps/api/src/tools/field-mapping-delete.tool.ts`

- [x] Input: `{ fieldMappingId }`
- [x] Execute: load mapping → resolve entity → scope check → write check → `FieldMappingValidationService.validateDelete()` → `.executeDelete()` → `onMutation()` → return cascaded counts

### 9.5 Unit tests for write tools

One test file per tool. Each file tests the common patterns plus tool-specific behavior.

**Common tests for every write tool** (10 files):

- [x] Returns error object when `assertWriteCapability` rejects (not thrown)
- [x] Returns error object when station scope check fails (not thrown)
- [x] Calls `onMutation()` after successful write
- [x] Does not call `onMutation()` on validation failure
- [x] Uses provided `userId` for `createdBy`/`updatedBy`/`deletedBy`

**File:** `apps/api/src/__tests__/tools/entity-record-create.tool.test.ts`

- [x] Test: creates record with auto-normalized data via `NormalizationService`
- [x] Test: sets `origin: "portal"` and `checksum: "manual"`
- [x] Test: auto-generates UUID `sourceId` when omitted
- [x] Test: uses provided `sourceId` when given

**File:** `apps/api/src/__tests__/tools/entity-record-update.tool.test.ts`

- [x] Test: rejects if record does not belong to entity
- [x] Test: updates `data` and `normalizedData`

**File:** `apps/api/src/__tests__/tools/entity-record-delete.tool.test.ts`

- [x] Test: soft-deletes the record
- [x] Test: rejects if record does not belong to entity

**File:** `apps/api/src/__tests__/tools/connector-entity-update.tool.test.ts`

- [x] Test: updates entity label

**File:** `apps/api/src/__tests__/tools/connector-entity-delete.tool.test.ts`

- [x] Test: returns cascaded counts on success
- [x] Test: returns error when external references exist

**File:** `apps/api/src/__tests__/tools/column-definition-create.tool.test.ts`

- [x] Test: upserts by key
- [x] Test: does not require station scope or write capability

**File:** `apps/api/src/__tests__/tools/column-definition-update.tool.test.ts`

- [x] Test: does not accept `key` or `type` changes (schema rejects)
- [x] Test: updates label and description

**File:** `apps/api/src/__tests__/tools/column-definition-delete.tool.test.ts`

- [x] Test: returns error when field mappings reference it

**File:** `apps/api/src/__tests__/tools/field-mapping-create.tool.test.ts`

- [x] Test: upserts mapping by entity + column
- [x] Test: rejects if column definition does not exist

**File:** `apps/api/src/__tests__/tools/field-mapping-delete.tool.test.ts`

- [x] Test: returns error when entity has records
- [x] Test: returns cascaded counts (entityGroupMembers, bidirectionalCleared)

### Phase 9 Verification

- [x] `npm run type-check` passes
- [x] `npm run test -- --selectProjects api` — all 12 tool test files pass (44 tests)
- [x] `npm run lint` passes (0 errors)

---

## Phase 10: Tool Registration

Wires all 12 tools into `ToolService.buildAnalyticsTools()` with conditional write-tool registration.

### 10.1 Add tool imports

**File:** `apps/api/src/services/tools.service.ts`

- [x] Import all 12 tool classes from `../tools/`
- [x] Import `resolveStationCapabilities` from `../utils/resolve-capabilities.util.js`

### 10.2 Add `entity_management` registration block

**File:** `apps/api/src/services/tools.service.ts`

- [x] Add block inside `buildAnalyticsTools()` after existing packs
- [x] Read tools registered unconditionally: `entity_list`, `entity_record_list`
- [x] Write tools registered conditionally on `stationCaps.some(sc => sc.capabilities.write)`: all 10 write tools
- [x] Pass `stationId`, `organizationId`, `userId`, and `onDataMutation` to each tool's `build()`

### 10.3 Tool registration tests

**File:** `apps/api/src/__tests__/services/tools.service.test.ts`

- [x] Test: registers only read tools when no instances have write capability
- [x] Test: registers read + write tools (all 12) when any instance has write
- [x] Test: does not register entity_management tools when pack is not enabled

### Phase 10 Verification

- [x] `npm run type-check` passes
- [x] `npm run test -- --selectProjects api` — tool service tests pass (20 tests, 3 new)
- [x] `npm run lint` passes (0 errors)
- [x] No regressions in existing tool packs (469 unit tests pass)

---

## Phase 11: Integration Tests

End-to-end tests that create a real station with connector instances and execute tools against the database. Also tests sync-after-mutation scenarios.

### 11.1 Tool execution integration tests

**File:** `apps/api/src/__tests__/__integration__/tools/entity-management.integration.test.ts`

#### Setup

- [ ] Create organization, user
- [ ] Create connector definition with `capabilityFlags: { write: true, query: true }`
- [ ] Create connector instance with `enabledCapabilityFlags: { write: true }`
- [ ] Create station, attach instance via `station_instances`
- [ ] Create connector entity, column definitions, field mappings

#### `entity_record_create`

- [ ] Test: creates record in DB with `origin: "portal"` and auto-generated normalizedData
- [ ] Test: rejects when write disabled on instance — error result, no record created
- [ ] Test: rejects when entity not attached to station — error result

#### `entity_record_update`

- [ ] Test: updates record data and normalizedData in DB
- [ ] Test: rejects update on record from different entity

#### `entity_record_delete`

- [ ] Test: soft-deletes record — `deleted` timestamp set, invisible to queries

#### `connector_entity_delete`

- [ ] Test: cascade deletes all dependents in transaction
- [ ] Test: blocks when external references exist — nothing deleted

#### `field_mapping_delete`

- [ ] Test: blocks when entity has records — error with record count
- [ ] Test: cascades to group members

#### `column_definition_delete`

- [ ] Test: blocks when field mappings reference it
- [ ] Test: succeeds when unreferenced

### 11.2 Sync-after-mutation integration tests

**File:** `apps/api/src/__tests__/__integration__/tools/sync-interaction.integration.test.ts`

- [ ] Test: sync does not overwrite tool-created records (UUID sourceId vs row-index sourceId)
- [ ] Test: sync restores tool-deleted synced records (re-created with `origin: "sync"`)
- [ ] Test: sync overwrites tool-modified synced records (reverted to source data)
- [ ] Test: sync uses tool-created field mappings (new mapping applied to normalizedData)
- [ ] Test: sync skips deleted entities (fails gracefully or skips)

### Phase 11 Verification

- [ ] `npm run test -- --selectProjects api` — all integration tests pass
- [ ] Integration test database is clean after tests (teardown works)
- [ ] No regressions in existing integration tests

---

## Phase 12: Final Verification

Full-stack verification to ensure everything works together.

### 12.1 Full test suite

- [ ] `npm run test` from repo root — all packages pass
- [ ] `npm run type-check` from repo root — no errors
- [ ] `npm run build` from repo root — builds successfully
- [ ] `npm run lint` from repo root — no new errors

### 12.2 Manual smoke test (optional)

- [ ] Create a station with `entity_management` tool pack enabled
- [ ] Open a portal session
- [ ] Verify system prompt includes `[read, write]` flags
- [ ] Verify LLM can call `entity_list` and see attached entities
- [ ] Verify LLM can call `entity_record_create` and record appears
- [ ] Verify LLM can call `entity_record_update` and record is updated
- [ ] Verify LLM can call `entity_record_delete` and record is soft-deleted
- [ ] Verify `sql_query` reflects changes after cache invalidation
- [ ] Verify write tools return error for read-only entities

### 12.3 Confirm no regressions

- [ ] Existing portal sessions without `entity_management` work as before
- [ ] Existing REST API endpoints (entity CRUD, field mapping CRUD, etc.) work as before
- [ ] CSV import still sets `origin: "sync"` correctly
- [ ] Manual record creation via UI still sets `origin: "manual"` correctly
