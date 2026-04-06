# Dynamic Sessions — Discovery

## Goal

Enable writable entity operations within portal sessions, allowing the LLM to create, update, and delete entities, entity records, entity groups, column definitions, field mappings, and entity group members on behalf of the user. Write permissions are scoped per connector instance via capability flags, enforced at runtime within tool execution.

---

## Current State

Portal sessions are **read-only**. When a portal opens:

1. `AnalyticsService.loadStation()` resolves the station's connector instances, loads all connector entities and their records into in-memory AlaSQL tables
2. `ToolService.buildAnalyticsTools()` registers tools based on the station's enabled tool packs (`data_query`, `statistics`, `regression`, `financial`, `web_search`)
3. The LLM queries data via `sql_query`, `visualize`, etc. — no mutations occur

Capability flags (`sync`, `query`, `write`) exist on `connector_definitions` as a ceiling. Each `connector_instance` has an `enabledCapabilityFlags` column that can further restrict the definition's flags (e.g., disable `write` for a specific instance). Resolution is handled by `resolveCapabilities()` in `utils/resolve-capabilities.util.ts`. However, portal sessions do not yet consult these resolved capabilities — tools are registered without checking whether attached instances support writes, and the system prompt does not surface per-entity permissions.

---

## Architecture

### 1. Instance-Level Capability Overrides (`enabledCapabilityFlags`) — Implemented

The `enabledCapabilityFlags` nullable JSONB column already exists on `connector_instances`. The resolution utility `resolveCapabilities()` in `utils/resolve-capabilities.util.ts` merges the definition ceiling with instance overrides, and `assertWriteCapability()` enforces write permissions for a given connector entity. The `CONNECTOR_INSTANCE_WRITE_DISABLED` error code is defined in `api-codes.constants.ts`.

**Key files:**

| File | What exists |
|------|-------------|
| `connector-instances.table.ts` | `enabledCapabilityFlags` column (`EnabledCapabilityFlags` interface) |
| `connector-definitions.table.ts` | `capabilityFlags` column (`CapabilityFlags` interface) |
| `utils/resolve-capabilities.util.ts` | `resolveCapabilities()`, `assertWriteCapability()` |
| `constants/api-codes.constants.ts` | `CONNECTOR_INSTANCE_WRITE_DISABLED` |

**Resolution rules (unchanged):**

- If the definition doesn't support `write`, the instance can never enable it
- If the definition supports `write` but the instance sets `write: false`, writes are blocked for that instance
- If `enabledCapabilityFlags` is `null`, the instance inherits all definition capabilities (backwards compatible)

**Remaining work for portal sessions:** `ToolService.buildAnalyticsTools()` and `buildSystemPrompt()` do not yet consult resolved capabilities. Sections 2–4 below address this gap.

---

### 2. New Tool Pack: `entity_manager`

Add `"entity_manager"` to the `StationToolPackSchema` enum alongside existing packs. Registered in `ToolService.buildAnalyticsTools()` following the same conditional pattern.

**Tool registration:**

```typescript
if (enabledPacks.has("entity_manager")) {
  const instanceCapabilities = await resolveStationCapabilities(stationId);

  // Read tools — always registered
  tools.entity_list         = new EntityListTool().build(organizationId, stationId);
  tools.entity_record_list  = new EntityRecordListTool().build(organizationId, stationId);
  tools.entity_group_list   = new EntityGroupListTool().build(organizationId, stationId);

  // Write tools — registered if ANY attached instance has write capability
  if (instanceCapabilities.some(c => c.write)) {
    tools.entity_create              = new EntityCreateTool().build(organizationId, stationId);
    tools.entity_record_create       = new EntityRecordCreateTool().build(organizationId, stationId);
    tools.entity_record_update       = new EntityRecordUpdateTool().build(organizationId, stationId);
    tools.entity_record_delete       = new EntityRecordDeleteTool().build(organizationId, stationId);
    tools.column_definition_create   = new ColumnDefinitionCreateTool().build(organizationId);
    tools.field_mapping_create       = new FieldMappingCreateTool().build(organizationId, stationId);
    tools.entity_group_create        = new EntityGroupCreateTool().build(organizationId);
    tools.entity_group_add_member    = new EntityGroupAddMemberTool().build(organizationId, stationId);
    tools.entity_group_remove_member = new EntityGroupRemoveMemberTool().build(organizationId, stationId);
  }
}
```

Write tools are registered if **any** attached instance supports writes, but each tool's `execute` function enforces per-instance permissions at runtime.

---

### 3. Runtime Permission Enforcement

Each write tool's `execute` function validates permissions before mutating:

```
1. LLM calls entity_record_create({ connectorEntityId, data })
2. Execute resolves: connectorEntityId → connectorInstance → resolveCapabilities()
3. If instance doesn't have write: true → return error message to LLM
4. If instance has write: true → perform the operation via repository
5. Invalidate AlaSQL cache for the station
```

The error is returned as a **tool result** (not an HTTP error), so the LLM learns which instances are writable and adjusts its behavior for the rest of the session.

**Station scope enforcement:** Every write tool validates that the target `connectorEntityId` or `connectorInstanceId` belongs to a connector instance attached to the current station. Operations that cross station boundaries are rejected.

---

### 4. System Prompt Enrichment

Extend the station context passed to the system prompt to include per-instance capability flags:

```
Entities:
  - "orders" (CSV Connector — Sales Import) [read, write]
  - "customers" (CSV Connector — CRM Export) [read]
  - "transactions" (CSV Connector — Sales Import) [read, write]
```

This gives the LLM upfront knowledge of which entities accept writes, reducing unnecessary tool call failures. The runtime check remains as a safety net.

---

### 5. Data Loading Strategy

**Read path (unchanged):** `loadStation()` loads all entity records into AlaSQL for `data_query` tools. No changes needed.

**Write path (new):** Entity manager tools call repositories directly — they do not interact with AlaSQL. After any write operation, the tool invalidates the AlaSQL cache so the next `data_query` or analytics tool call reloads fresh data:

```typescript
// Inside a write tool's execute:
const record = await repo.entityRecords.create(validatedInput);
AnalyticsService.dropStation(stationId);
return { success: true, record };
```

This avoids re-loading the entire dataset on every write while ensuring consistency when the user switches between write and query operations within the same session.

---

## Tool Specifications

### Read Tools

| Tool | Repository Method | Input Parameters | Description |
|------|------------------|-----------------|-------------|
| `entity_list` | `connectorEntities.findMany()` | `{ connectorInstanceId?: string }` | List entities in the station, optionally filtered by instance |
| `entity_record_list` | `entityRecords.findByConnectorEntityId()` | `{ connectorEntityId: string, limit?: number, offset?: number }` | List records for an entity with pagination |
| `entity_group_list` | `entityGroups.findByOrganizationId()` | `{}` | List all entity groups in the organization |

### Write Tools

| Tool | Repository Method | Input Parameters | Permission Check |
|------|------------------|-----------------|-----------------|
| `entity_create` | `connectorEntities.create()` | `{ connectorInstanceId: string, key: string, label: string }` | Instance must have `write` |
| `entity_record_create` | `entityRecords.create()` | `{ connectorEntityId: string, data: object }` | Entity's instance must have `write` |
| `entity_record_update` | `entityRecords.update()` | `{ entityRecordId: string, data: object }` | Entity's instance must have `write` |
| `entity_record_delete` | `entityRecords.softDelete()` | `{ entityRecordId: string }` | Entity's instance must have `write` |
| `column_definition_create` | `columnDefinitions.upsertByKey()` | `{ key: string, label: string, type: ColumnDataType }` | Organization-level, no instance check |
| `field_mapping_create` | `fieldMappings.upsertByEntityAndColumn()` | `{ connectorEntityId: string, columnDefinitionId: string, sourceField: string }` | Entity's instance must have `write` |
| `entity_group_create` | `entityGroups.create()` | `{ name: string, description?: string }` | Organization-level, no instance check |
| `entity_group_add_member` | `entityGroupMembers.create()` | `{ entityGroupId: string, connectorEntityId: string, linkFieldMappingId: string }` | Entity's instance must have `write` |
| `entity_group_remove_member` | `entityGroupMembers.softDelete()` | `{ entityGroupMemberId: string }` | Member's entity's instance must have `write` |

All write tools wrap existing repository methods — no new data access patterns are introduced.

---

## Implementation Sequence

### Phase 1: Schema & Model Changes

1. Add `EnabledCapabilityFlags` interface to `connector-definitions.table.ts`
2. Add `enabledCapabilityFlags` to `ConnectorInstanceSchema` (core) and `connector_instances` table (Drizzle)
3. Add type checks for bidirectional sync
4. Generate and apply migration
5. Build `resolveCapabilities()` utility

### Phase 2: Tool Pack Registration

1. Add `"entity_manager"` to `StationToolPackSchema` enum
2. Add `"entity_manager"` to `ALL_TOOL_PACKS` in `ToolService`
3. Implement read tool classes (`entity_list`, `entity_record_list`, `entity_group_list`)
4. Implement write tool classes with per-instance permission checks
5. Register tools in `ToolService.buildAnalyticsTools()`

### Phase 3: Session Integration

1. Extend `StationContext` to include per-entity capability flags
2. Update `buildSystemPrompt()` to surface read/write permissions per entity
3. Add AlaSQL cache invalidation after write operations
4. Update `PACK_TOOL_NAMES` set with new tool names

### Phase 4: Frontend

1. Add `enabledCapabilityFlags` to connector instance edit UI (checkboxes constrained by definition ceiling)
2. Add `"entity_manager"` to station tool pack selector with label and description
3. Surface write capability indicators in entity list views

---

## Open Questions

- **Normalization on write — resolved:** Write tools must auto-generate `normalizedData` from `data` using the entity's field mappings (sourceField → columnDefinitionKey). Writable connector instances may also receive data from external sources (syncs, imports), so `normalizedData` must stay consistent with field mappings. If no field mappings exist, `normalizedData` is set equal to `data` as a passthrough. See `CsvImportService.importFromS3()` for the reference pattern.
- **Cascading deletes — resolved:** The same cascade and guard rules from the REST API apply to tool-initiated deletes. Entity delete cascades to records, field mappings, tag assignments, and group members in a transaction. Field mapping delete is blocked if the entity has records, and cascades to group members on success. Column definition delete is blocked if field mappings reference it. Tools return cascaded counts so the LLM can report impact. Shared service methods should be extracted so routers and tools call the same logic.
- **Audit trail — resolved:** Write operations via portal sessions are attributed to the user who opened the portal. The portal's `createdBy` user ID is threaded from `PortalService` through `buildAnalyticsTools()` into each write tool's `build()` method and used for all `createdBy`/`updatedBy`/`deletedBy` fields.
- **Undo/rollback — resolved:** Not supported. Soft-delete already provides a recovery path via the REST API. Tool-level undo adds complexity with limited initial value.
- **Rate limiting — deferred:** No per-session write limits for now. Can be revisited if runaway tool loops become an issue in practice.
- **Sync interactions — documented:** Tool-created records use UUID `sourceId` values and are safe from sync overwrite (syncs upsert on `(connectorEntityId, sourceId)` which won't collide). Tool edits to synced records are ephemeral for import-mode connectors — the next sync restores source data. Structural changes (field mappings, column definitions) persist across syncs. Two-way sync will require an `origin` field and conflict resolution strategy. Full analysis in [ENTITY_MANAGEMENT_TOOL.discovery.md](./ENTITY_MANAGEMENT_TOOL.discovery.md#sync-interactions).
