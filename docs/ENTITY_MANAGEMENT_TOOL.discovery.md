# Entity Management Tool Pack — Discovery

## Goal

Expose entity management operations (create, update, delete) for connector entities, column definitions, field mappings, and entity records as an `entity_management` tool pack within portal sessions. Only entities belonging to connector instances with resolved `write` capability are eligible for mutation. Read-only tools are always available when the pack is enabled.

---

## Foundation

This plan builds on the architecture established in [DYNAMIC_SESSIONS.discovery.md](./DYNAMIC_SESSIONS.discovery.md). The following infrastructure is already implemented and ready to use:

| Component | File | Status |
|-----------|------|--------|
| `enabledCapabilityFlags` column | `connector-instances.table.ts` | Implemented |
| `capabilityFlags` on definitions | `connector-definitions.table.ts` | Implemented |
| `resolveCapabilities()` | `utils/resolve-capabilities.util.ts` | Implemented |
| `assertWriteCapability()` | `utils/resolve-capabilities.util.ts` | Implemented |
| `CONNECTOR_INSTANCE_WRITE_DISABLED` error code | `constants/api-codes.constants.ts` | Implemented |
| Base repository CRUD (create, update, softDelete) | `repositories/base.repository.ts` | Implemented |
| Entity-specific repositories | `repositories/*.repository.ts` | Implemented |
| Tool base class | `types/tools.ts` | Implemented |
| Tool registration pattern | `services/tools.service.ts` | Implemented |
| Station data cache | `services/portal.service.ts` | Implemented |

---

## Architecture

### 1. Tool Pack Registration

Add `"entity_management"` to `StationToolPackSchema` in `packages/core/src/models/station.model.ts` and `ALL_TOOL_PACKS` in `services/tools.service.ts`.

Register tools in `ToolService.buildAnalyticsTools()` following the existing conditional pattern:

```typescript
// tools.service.ts — inside buildAnalyticsTools()

if (enabledPacks.has("entity_management")) {
  const stationCapabilities = await resolveStationCapabilities(stationId);

  // Read tools — always registered
  tools.entity_list        = new EntityListTool().build(stationId);
  tools.entity_record_list = new EntityRecordListTool().build(stationId);

  // Write tools — registered only if ANY attached instance has write capability
  if (stationCapabilities.some(c => c.write)) {
    tools.entity_record_create       = new EntityRecordCreateTool().build(stationId, organizationId);
    tools.entity_record_update       = new EntityRecordUpdateTool().build(stationId, organizationId);
    tools.entity_record_delete       = new EntityRecordDeleteTool().build(stationId, organizationId);
    tools.connector_entity_update    = new ConnectorEntityUpdateTool().build(stationId, organizationId);
    tools.connector_entity_delete    = new ConnectorEntityDeleteTool().build(stationId, organizationId);
    tools.column_definition_create   = new ColumnDefinitionCreateTool().build(organizationId);
    tools.column_definition_update   = new ColumnDefinitionUpdateTool().build(organizationId);
    tools.column_definition_delete   = new ColumnDefinitionDeleteTool().build(organizationId);
    tools.field_mapping_create       = new FieldMappingCreateTool().build(stationId, organizationId);
    tools.field_mapping_delete       = new FieldMappingDeleteTool().build(stationId, organizationId);
  }
}
```

Write tools are registered if **any** station instance supports writes. Per-instance enforcement happens at runtime inside each tool's `execute`.

### 2. Station Capability Resolution

New helper in `utils/resolve-capabilities.util.ts`:

```typescript
export async function resolveStationCapabilities(
  stationId: string,
): Promise<ResolvedCapabilities[]> {
  const stationInstances = await stationInstancesRepo.findByStationId(stationId);
  const instanceIds = stationInstances.map(si => si.connectorInstanceId);
  if (instanceIds.length === 0) return [];

  const instances = await Promise.all(
    instanceIds.map(id => connectorInstancesRepo.findById(id))
  );
  const definitions = await Promise.all(
    instances
      .filter(Boolean)
      .map(inst => connectorDefinitionsRepo.findById(inst!.connectorDefinitionId))
  );

  return instances
    .map((inst, idx) =>
      inst && definitions[idx]
        ? resolveCapabilities(definitions[idx]!, inst)
        : null
    )
    .filter((cap): cap is ResolvedCapabilities => cap !== null);
}
```

### 3. Station Scope Enforcement

Every tool must verify that the target entity belongs to a connector instance attached to the current station. This prevents cross-station mutations.

```typescript
async function assertStationScope(
  stationId: string,
  connectorEntityId: string,
): Promise<void> {
  const entity = await connectorEntitiesRepo.findById(connectorEntityId);
  if (!entity) throw toolError("Entity not found");

  const stationInstances = await stationInstancesRepo.findByStationId(stationId);
  const attachedInstanceIds = new Set(stationInstances.map(si => si.connectorInstanceId));

  if (!attachedInstanceIds.has(entity.connectorInstanceId)) {
    throw toolError("Entity does not belong to this station");
  }
}
```

### 4. Runtime Permission Enforcement

Each write tool's `execute` validates permissions before mutating. Errors are returned as **tool results** (not HTTP errors) so the LLM learns which instances are writable:

```
1. LLM calls entity_record_create({ connectorEntityId, data })
2. Execute validates: connectorEntityId belongs to this station (scope check)
3. Execute resolves: connectorEntityId → connectorInstance → resolveCapabilities()
4. If instance write === false → return { error: "..." } to LLM
5. If instance write === true → perform repository operation
6. Invalidate station data cache so subsequent data_query tools see fresh data
```

### 5. Cache Invalidation

After any write operation, the tool invalidates the in-memory station data so `data_query` and analytics tools see fresh data on their next call.

The `stationDataCache` in `portal.service.ts` (line 180) is keyed by `portalId`. Write tools need access to the portal context to invalidate the correct cache entry. This requires passing `portalId` through to `buildAnalyticsTools()` or exposing a cache invalidation function.

**Proposed approach:** Add a `portalId` parameter to `buildAnalyticsTools()` and pass it into write tool `build()` methods alongside a cache-eviction callback:

```typescript
// tools.service.ts
static async buildAnalyticsTools(
  organizationId: string,
  stationId: string,
  portalId: string,                              // NEW
  onDataMutation?: () => void,                   // NEW — evicts stationDataCache entry
): Promise<Record<string, Tool>>
```

Each write tool calls `onDataMutation?.()` after a successful write. The callback is wired in `PortalService.streamResponse()`:

```typescript
const tools = await ToolService.buildAnalyticsTools(
  organizationId,
  stationId,
  portal.id,
  () => stationDataCache.delete(portal.id),
);
```

### 6. System Prompt Enrichment

Extend `StationContext` and `buildSystemPrompt()` to surface per-entity capability flags:

```typescript
// system.prompt.ts
export interface StationContext {
  stationId: string;
  stationName: string;
  entities: EntitySchema[];
  entityGroups: EntityGroupContext[];
  toolPacks: string[];
  entityCapabilities?: Record<string, ResolvedCapabilities>;  // NEW — keyed by entity ID
}
```

Prompt output changes from:

```
### orders (`orders`)
Columns:
  - `id` (number): ID
```

To:

```
### orders (`orders`) [read, write]
Connector: Sales Import (CSV Connector)
Columns:
  - `id` (number): ID
```

This gives the LLM upfront knowledge of which entities accept writes, reducing unnecessary tool call failures. The runtime check remains as a safety net.

---

## Tool Specifications

### Read Tools

| Tool | Description | Input | Repository Method |
|------|-------------|-------|-------------------|
| `entity_list` | List entities attached to this station | `{ connectorInstanceId?: string }` | `connectorEntities.findMany()` filtered by station scope |
| `entity_record_list` | List records for an entity with pagination | `{ connectorEntityId: string, limit?: number, offset?: number }` | `entityRecords.findMany()` |

### Write Tools — Entity Records

| Tool | Description | Input | Permission | Repository Method |
|------|-------------|-------|------------|-------------------|
| `entity_record_create` | Create a new record | `{ connectorEntityId: string, sourceId?: string, data: object }` | Entity's instance `write` | `entityRecords.create()` |
| `entity_record_update` | Update an existing record's data | `{ connectorEntityId: string, entityRecordId: string, data: object }` | Entity's instance `write` | `entityRecords.update()` |
| `entity_record_delete` | Soft-delete a record | `{ connectorEntityId: string, entityRecordId: string }` | Entity's instance `write` | `entityRecords.softDelete()` |

### Write Tools — Connector Entities

| Tool | Description | Input | Permission | Repository Method |
|------|-------------|-------|------------|-------------------|
| `connector_entity_update` | Update entity label | `{ connectorEntityId: string, label: string }` | Entity's instance `write` | `connectorEntities.update()` |
| `connector_entity_delete` | Soft-delete entity and cascade | `{ connectorEntityId: string }` | Entity's instance `write` | `connectorEntities.softDelete()` + cascade |

### Write Tools — Column Definitions

| Tool | Description | Input | Permission | Repository Method |
|------|-------------|-------|------------|-------------------|
| `column_definition_create` | Create or upsert a column definition | `{ key: string, label: string, type: ColumnDataType, required?: boolean, enumValues?: string[] }` | Organization-level (no instance check) | `columnDefinitions.upsertByKey()` |
| `column_definition_update` | Update label, description, or enum values | `{ columnDefinitionId: string, label?: string, description?: string }` | Organization-level (no instance check) | `columnDefinitions.update()` |
| `column_definition_delete` | Soft-delete if no field mappings reference it | `{ columnDefinitionId: string }` | Organization-level (no instance check) | `columnDefinitions.softDelete()` |

### Write Tools — Field Mappings

| Tool | Description | Input | Permission | Repository Method |
|------|-------------|-------|------------|-------------------|
| `field_mapping_create` | Create a mapping between entity + column definition | `{ connectorEntityId: string, columnDefinitionId: string, sourceField: string, isPrimaryKey?: boolean }` | Entity's instance `write` | `fieldMappings.upsertByEntityAndColumn()` |
| `field_mapping_delete` | Soft-delete mapping (blocked if entity has records) | `{ fieldMappingId: string }` | Entity's instance `write` | `fieldMappings.softDelete()` |

---

## Tool Implementation Pattern

Each tool follows the existing pattern in `apps/api/src/tools/`. Example for `entity_record_create`:

```typescript
// tools/entity-record-create.tool.ts

import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { assertWriteCapability } from "../utils/resolve-capabilities.util.js";
import { SystemUtilities } from "../utils/system.util.js";

const InputSchema = z.object({
  connectorEntityId: z.string().describe("The entity to create a record in"),
  sourceId: z.string().optional().describe("Optional external source ID"),
  data: z.record(z.unknown()).describe("The record data as key-value pairs"),
});

export class EntityRecordCreateTool extends Tool<typeof InputSchema> {
  slug = "entity_record_create";
  name = "Create Entity Record";
  description =
    "Create a new record in a connector entity. " +
    "Only works for entities whose connector instance has write capability enabled.";

  get schema() {
    return InputSchema;
  }

  build(
    stationId: string,
    organizationId: string,
    userId: string,
    options?: {
      assertScope: (entityId: string) => Promise<void>;
      onMutation?: () => void;
    },
  ) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const validated = this.validate(input);
        const repo = DbService.repository;

        // 1. Station scope check
        await options?.assertScope(validated.connectorEntityId);

        // 2. Write capability check — returns error message, not HTTP error
        try {
          await assertWriteCapability(validated.connectorEntityId);
        } catch {
          return {
            error:
              "This entity's connector instance does not have write capability.",
          };
        }

        // 3. Auto-normalize data through field mappings
        const fieldMappings = await repo.fieldMappings.findByConnectorEntityId(
          validated.connectorEntityId,
          { include: ["columnDefinition"] },
        );
        const normalizedData: Record<string, unknown> = {};
        if (fieldMappings.length > 0) {
          for (const fm of fieldMappings) {
            const colKey = fm.columnDefinition?.key;
            if (colKey && fm.sourceField in (validated.data as Record<string, unknown>)) {
              normalizedData[colKey] = (validated.data as Record<string, unknown>)[fm.sourceField];
            }
          }
        } else {
          // No field mappings — passthrough (matches manual create behavior)
          Object.assign(normalizedData, validated.data);
        }

        // 4. Perform the write
        const now = SystemUtilities.utc.now().getTime();
        const record = await repo.entityRecords.create({
          id: SystemUtilities.id.v4.generate(),
          organizationId,
          connectorEntityId: validated.connectorEntityId,
          sourceId: validated.sourceId ?? SystemUtilities.id.v4.generate(),
          data: validated.data,
          normalizedData,
          checksum: "manual",
          syncedAt: now,
          created: now,
          createdBy: userId,
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        });

        // 5. Invalidate cache
        options?.onMutation?.();

        return { success: true, recordId: record.id };
      },
    });
  }
}
```

---

## Validation Rules Carried Forward from API Routes

Write tools must enforce the same validation rules that the existing REST API routes enforce. These are not new rules — they exist in the routers today and must be replicated in tool `execute` functions:

| Tool | Validation | Source Router |
|------|-----------|---------------|
| `connector_entity_delete` | Block if other entities reference it via `refEntityKey` | `connector-entity.router.ts` |
| `column_definition_update` | `key` is immutable; type transitions restricted to `ALLOWED_TYPE_TRANSITIONS` | `column-definition.router.ts` |
| `column_definition_delete` | Block if field mappings reference it | `column-definition.router.ts` |
| `field_mapping_delete` | Block if entity has any records | `field-mapping.router.ts` |
| `entity_record_create` | Auto-generate `sourceId` if not provided | `entity-record.router.ts` |

**Recommendation:** Extract shared validation logic from routers into service methods (e.g., `ConnectorEntityService.validateDelete()`) that both the HTTP route and the tool can call. This avoids duplicating business rules.

---

## File Changes Summary

### New Files

| File | Purpose |
|------|---------|
| `apps/api/src/tools/entity-list.tool.ts` | Read: list entities in station |
| `apps/api/src/tools/entity-record-list.tool.ts` | Read: paginated record listing |
| `apps/api/src/tools/entity-record-create.tool.ts` | Write: create entity record |
| `apps/api/src/tools/entity-record-update.tool.ts` | Write: update entity record |
| `apps/api/src/tools/entity-record-delete.tool.ts` | Write: soft-delete entity record |
| `apps/api/src/tools/connector-entity-update.tool.ts` | Write: update entity label |
| `apps/api/src/tools/connector-entity-delete.tool.ts` | Write: soft-delete entity + cascade |
| `apps/api/src/tools/column-definition-create.tool.ts` | Write: create/upsert column definition |
| `apps/api/src/tools/column-definition-update.tool.ts` | Write: update column definition |
| `apps/api/src/tools/column-definition-delete.tool.ts` | Write: soft-delete column definition |
| `apps/api/src/tools/field-mapping-create.tool.ts` | Write: create field mapping |
| `apps/api/src/tools/field-mapping-delete.tool.ts` | Write: soft-delete field mapping |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/src/models/station.model.ts` | Add `"entity_management"` to `StationToolPackSchema` |
| `apps/api/src/services/tools.service.ts` | Add `"entity_management"` to `ALL_TOOL_PACKS`, add registration block, add new tool names to `PACK_TOOL_NAMES`, accept `portalId` + `onDataMutation` params |
| `apps/api/src/utils/resolve-capabilities.util.ts` | Add `resolveStationCapabilities()` and `assertStationScope()` helpers |
| `apps/api/src/prompts/system.prompt.ts` | Extend `StationContext` with `entityCapabilities`, update `buildSystemPrompt()` to render `[read, write]` flags |
| `apps/api/src/services/portal.service.ts` | Pass `portalId` and cache-eviction callback to `buildAnalyticsTools()` |
| `apps/api/src/services/analytics.service.ts` | Ensure `connectorInstanceId` is on `EntitySchema` (needed for scope/capability resolution in tools) |

---

## Implementation Phases

### Phase 1: Capability Plumbing

1. Add `resolveStationCapabilities()` to `resolve-capabilities.util.ts`
2. Add `assertStationScope()` to `resolve-capabilities.util.ts`
3. Extend `StationContext` with `entityCapabilities` map
4. Update `buildSystemPrompt()` to render per-entity capability flags

### Phase 2: Read Tools

1. Implement `EntityListTool` and `EntityRecordListTool`
2. Add `"entity_management"` to `StationToolPackSchema` and `ALL_TOOL_PACKS`
3. Register read tools in `ToolService.buildAnalyticsTools()`
4. Add tool names to `PACK_TOOL_NAMES`

### Phase 3: Write Tools

1. Add `portalId` and `onDataMutation` parameters to `buildAnalyticsTools()` signature
2. Wire cache eviction callback in `PortalService.streamResponse()`
3. Implement all 10 write tools following the pattern above
4. Register write tools conditionally on station write capability

### Phase 4: Shared Validation Extraction

1. Extract validation logic from routers into service-layer methods:
   - `ConnectorEntityService.validateDelete()`
   - `ColumnDefinitionService.validateUpdate()` / `validateDelete()`
   - `FieldMappingService.validateDelete()`
2. Refactor existing routers to call shared service methods
3. Wire tools to call the same shared service methods

### Phase 5: Frontend

1. Add `"entity_management"` to station tool pack selector UI with label and description
2. Surface per-entity write capability indicators in entity list views

---

## Sync Interactions

Portal sessions with `entity_management` enabled can create, modify, and delete entities, records, column definitions, field mappings, and groups. A subsequent connector sync (one-way import or future two-way sync) must handle this mutated state correctly. This section documents the interaction points and required safeguards.

### Current Sync Architecture

Syncs are adapter-driven. The current adapters (CSV, Sandbox) are **import-mode** — data flows one way from an external source into `entity_records` via `CsvImportService.importFromS3()`. The sync path:

1. Loads field mappings to build a `sourceField → columnDefinitionKey` map
2. For each source row, builds `data` (raw) and `normalizedData` (mapped through field mappings)
3. Computes a checksum (`SHA256(data)`) for change detection
4. Upserts via `(connectorEntityId, sourceId)` composite key — existing records with matching `sourceId` are updated, new ones are created

Key fields on `entity_records`:

| Field | Purpose | Set by sync | Set by tool |
|-------|---------|-------------|-------------|
| `data` | Raw source payload | Header → value from CSV | User-provided `data` |
| `normalizedData` | Mapped through field mappings | `sourceField → columnDefinitionKey` | Auto-normalized (see resolved Q1) |
| `sourceId` | Dedup key within an entity | Row index (`"0"`, `"1"`, ...) for CSV | UUID (auto-generated) |
| `checksum` | Change detection on re-sync | `SHA256(data).slice(0,16)` | `"manual"` |
| `syncedAt` | Last sync timestamp | `Date.now()` | `Date.now()` |

### One-Way Sync (Import) After Portal Mutations

**Records created by tools are safe from sync overwrite.** The upsert key is `(connectorEntityId, sourceId)`. Tool-created records use UUID `sourceId` values, while CSV imports use row-index strings (`"0"`, `"1"`, ...). These namespaces do not collide, so a re-import will never overwrite a tool-created record.

However, several scenarios require consideration:

#### Scenario 1: Tool deletes records, then sync runs

- Tool soft-deletes records (sets `deleted` timestamp)
- Sync upserts on `(connectorEntityId, sourceId)` — the unique constraint is soft-delete aware (`WHERE deleted IS NULL`)
- **Result:** The soft-deleted record is invisible to the unique constraint. The sync creates a new record with the same `sourceId`, effectively "restoring" the data from the external source
- **Acceptable:** This is correct behavior for import-mode connectors — the external source is authoritative. If the user deleted a record via the portal but the source still contains it, the next sync should bring it back

#### Scenario 2: Tool modifies records that came from a sync

- Tool updates `data` and `normalizedData` on an existing synced record
- Next sync computes a fresh checksum from the external source
- If the source data hasn't changed, the checksum matches the **original** checksum (pre-tool-edit), not the tool-modified data
- **Result:** The sync overwrites the tool's changes with the source data, since `checksum` is computed from source `data`, not from the current DB state
- **Acceptable for import-mode:** The external source is authoritative. Tool edits to synced records are intentionally ephemeral — they persist until the next sync. The system prompt should inform the LLM of this behavior

#### Scenario 3: Tool creates/deletes field mappings or column definitions, then sync runs

- Sync relies on **existing field mappings** to build `normalizedData`. It loads them at import time via `fieldMappings` parameter
- If the tool deleted a field mapping, the next sync will not map that source field → `normalizedData` entry. The source field is still preserved in `data`
- If the tool created a new field mapping, the next sync will use it — the new mapping will appear in the field mappings list and source fields will be mapped through it
- If the tool deleted a column definition that a field mapping references, the field mapping delete guard (`COLUMN_DEFINITION_HAS_DEPENDENCIES`) prevents this unless the mapping is removed first. No orphaned mappings are possible
- **Acceptable:** Field mapping and column definition changes are structural and intentionally persistent across syncs

#### Scenario 4: Tool deletes an entire connector entity, then sync runs

- Entity is soft-deleted along with its records, field mappings, tag assignments, and group members
- Sync requires a valid `connectorEntityId` — if the entity doesn't exist (soft-deleted), the sync fails or is skipped
- **No risk:** The sync targets a specific entity. If it's been deleted, the sync has nothing to act on. Re-importing requires the user to recreate the entity

### Two-Way Sync (Future)

Two-way sync is not currently implemented. When it is, additional considerations apply:

#### Write-back conflicts

If a tool creates or modifies a record and a two-way sync attempts to push changes to the external source, a conflict resolution strategy is needed:

- **Tool-created records** (`sourceId` is UUID, `checksum` is `"manual"`): These have no external counterpart. The sync must decide whether to push them to the external source or ignore them. A `checksum: "manual"` marker or a dedicated `origin` field could distinguish tool-created from synced records
- **Tool-modified synced records**: The external source may have also changed. A last-write-wins strategy based on `syncedAt` vs. `updated` timestamps could resolve this, but risks data loss in either direction

#### Recommended approach for two-way sync

1. Add an `origin` field to `entity_records` (`"sync"` | `"manual"` | `"portal"`) to distinguish record provenance
2. Two-way sync only pushes `origin: "portal"` or `origin: "manual"` records to the external source
3. Conflict detection: compare `updated` timestamp against `syncedAt` — if `updated > syncedAt`, the record was modified locally since last sync
4. Conflict resolution strategy should be configurable per connector instance (last-write-wins, local-wins, remote-wins, or manual review)

This is deferred but the `entity_management` tool pack should set `checksum: "manual"` on tool-created records (already specified in the implementation pattern) to enable future differentiation.

### System Prompt Guidance

The system prompt should inform the LLM about sync behavior when `entity_management` is enabled on an import-mode connector:

```
Note: Entities marked [read, write] with import-mode connectors sync from an external source.
Records you create (via tools) are independent and will not be overwritten by syncs.
Records you modify that originated from a sync will be overwritten on the next sync with the
source data. Structural changes (field mappings, column definitions) persist across syncs.
```

---

## Open Questions

1. **Normalization on write — resolved:** `entity_record_create` and `entity_record_update` must auto-generate `normalizedData` from the provided `data` using existing field mappings for the target entity. This is necessary because writable connector instances may also receive data from external sources (syncs, imports) that rely on `normalizedData` being consistent with field mappings. The tool should query the entity's field mappings (with their column definition keys), build a `sourceField → columnDefinitionKey` map, and project `data` through it — mirroring the pattern in `CsvImportService.importFromS3()` (line 170–182 of `csv-import.service.ts`). If no field mappings exist for the entity, `normalizedData` should be set equal to `data` as a passthrough (matching the manual create endpoint behavior in `entity-record.router.ts` line 461–462).

2. **Cascading deletes via tools — resolved:** The same cascade and guard rules that the REST API enforces apply identically to tool-initiated deletes. No special tool-level behavior — tools call the same validation and cascade logic:

   - **`connector_entity_delete`**: Block if external references exist via `refEntityKey` (422 `ENTITY_HAS_EXTERNAL_REFERENCES`). On success, cascade soft-delete in a transaction: entity group members, entity tag assignments, field mappings, entity records, then the entity itself. Return cascaded counts so the LLM can report what was affected. (Reference: `connector-entity.router.ts` lines 656–692)
   - **`field_mapping_delete`**: Block if the entity has any records (409 `FIELD_MAPPING_DELETE_HAS_RECORDS`). On success, cascade soft-delete entity group members that reference it as their link field mapping, and clear the bidirectional counterpart reference if one exists. (Reference: `field-mapping.router.ts` lines 674–720)
   - **`column_definition_delete`**: Block if any field mappings reference it (422 `COLUMN_DEFINITION_HAS_DEPENDENCIES`). No cascade — the guard prevents orphaned mappings.

   This is a strong argument for Phase 4's shared validation extraction: the cascade/guard logic should live in service methods callable by both routers and tools rather than being duplicated.

3. **Audit trail — resolved:** Write operations via tools must be attributed to the user who opened the portal, not a system account. The portal's `createdBy` user ID must be threaded from `PortalService` through to tool `build()` methods and used for all `createdBy`/`updatedBy`/`deletedBy` fields. This can be passed alongside `organizationId` in the `build()` signature (e.g., `build(stationId, organizationId, userId)`).

4. **Rate limiting — deferred:** No per-session write limits for now. Can be revisited if runaway tool loops become an issue in practice.

5. **Undo support:** Deferred. Soft-delete already provides a recovery path via the REST API. Tool-level undo adds complexity with limited initial value.
