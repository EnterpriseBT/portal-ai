# Entity Management Tool Pack — Specification

## 1. Overview

The `entity_management` tool pack exposes read and write operations for connector entities, column definitions, field mappings, and entity records within portal sessions. Write tools are gated by the connector instance's resolved `write` capability. This spec covers:

1. **Schema & model changes** — `origin` field on entity records, `StationToolPackSchema` update
2. **Capability plumbing** — `resolveStationCapabilities()`, `assertStationScope()`
3. **System prompt enrichment** — per-entity capability flags in `StationContext`
4. **`buildAnalyticsTools()` signature change** — accept `portalId`, `userId`, `onDataMutation`
5. **Shared validation services** — extract router validation logic into reusable service methods
6. **12 tool classes** — 2 read, 10 write
7. **Tool registration** — conditional registration in `ToolService`

References: [ENTITY_MANAGEMENT_TOOL.discovery.md](./ENTITY_MANAGEMENT_TOOL.discovery.md), [DYNAMIC_SESSIONS.discovery.md](./DYNAMIC_SESSIONS.discovery.md)

---

## 2. Schema & Model Changes

### 2.1 Entity Record `origin` Field

Add an `origin` column to `entity_records` to distinguish record provenance. This enables future two-way sync to determine which records to push to external sources and supports conflict detection.

**Drizzle table — `apps/api/src/db/schema/entity-records.table.ts`:**

```typescript
export const entityRecordOrigin = pgEnum("entity_record_origin", ["sync", "manual", "portal"]);

// Inside entity_records table definition:
origin: entityRecordOrigin("origin").notNull().default("manual"),
```

**Zod model — `packages/core/src/models/entity-record.model.ts`:**

```typescript
origin: z.enum(["sync", "manual", "portal"]).default("manual"),
```

**Migration:** Generate via `npm run db:generate` then `npm run db:migrate`. The default `"manual"` ensures backward compatibility — all existing records are classified as manually created.

**Origin values:**

| Value | Set by | Description |
|-------|--------|-------------|
| `"sync"` | `CsvImportService`, adapter sync | Record came from an external source |
| `"manual"` | REST API `POST /records` endpoint | Record created via the web UI |
| `"portal"` | `entity_record_create` tool | Record created by the LLM during a portal session |

**Existing code changes:**

| File | Change |
|------|--------|
| `services/csv-import.service.ts` | Set `origin: "sync"` on all upserted records |
| `routes/entity-record.router.ts` | Set `origin: "manual"` in `POST /` handler |
| `db/schema/type-checks.ts` | Add bidirectional type assertion for `origin` |
| `db/schema/zod.ts` | Add `origin` to drizzle-zod generated schemas |

### 2.2 StationToolPackSchema Update

**File:** `packages/core/src/models/station.model.ts`

```typescript
export const StationToolPackSchema = z.enum([
  "data_query",
  "statistics",
  "regression",
  "financial",
  "web_search",
  "entity_management",  // NEW
]);
```

### 2.3 ALL_TOOL_PACKS Update

**File:** `apps/api/src/services/tools.service.ts`

```typescript
export const ALL_TOOL_PACKS = [
  "data_query",
  "statistics",
  "regression",
  "financial",
  "web_search",
  "entity_management",  // NEW
] as const;
```

### 2.4 PACK_TOOL_NAMES Update

**File:** `apps/api/src/services/tools.service.ts`

Add all 12 new tool names to the `PACK_TOOL_NAMES` set:

```typescript
private static readonly PACK_TOOL_NAMES = new Set([
  // ... existing names ...
  "entity_list",
  "entity_record_list",
  "entity_record_create",
  "entity_record_update",
  "entity_record_delete",
  "connector_entity_update",
  "connector_entity_delete",
  "column_definition_create",
  "column_definition_update",
  "column_definition_delete",
  "field_mapping_create",
  "field_mapping_delete",
]);
```

---

## 3. Capability Plumbing

### 3.1 `resolveStationCapabilities()`

**File:** `apps/api/src/utils/resolve-capabilities.util.ts`

```typescript
export interface StationInstanceCapability {
  connectorInstanceId: string;
  capabilities: ResolvedCapabilities;
}

export async function resolveStationCapabilities(
  stationId: string,
): Promise<StationInstanceCapability[]> {
  const stationInstances = await stationInstancesRepo.findByStationId(stationId);
  if (stationInstances.length === 0) return [];

  const results: StationInstanceCapability[] = [];

  for (const si of stationInstances) {
    const instance = await connectorInstancesRepo.findById(si.connectorInstanceId);
    if (!instance) continue;

    const definition = await connectorDefinitionsRepo.findById(instance.connectorDefinitionId);
    if (!definition) continue;

    results.push({
      connectorInstanceId: instance.id,
      capabilities: resolveCapabilities(definition, instance),
    });
  }

  return results;
}
```

### 3.2 `assertStationScope()`

**File:** `apps/api/src/utils/resolve-capabilities.util.ts`

```typescript
export async function assertStationScope(
  stationId: string,
  connectorEntityId: string,
): Promise<void> {
  const entity = await connectorEntitiesRepo.findById(connectorEntityId);
  if (!entity) {
    throw new ApiError(404, ApiCode.CONNECTOR_ENTITY_NOT_FOUND, "Connector entity not found.");
  }

  const stationInstances = await stationInstancesRepo.findByStationId(stationId);
  const attachedInstanceIds = new Set(stationInstances.map(si => si.connectorInstanceId));

  if (!attachedInstanceIds.has(entity.connectorInstanceId)) {
    throw new ApiError(
      403,
      ApiCode.STATION_SCOPE_VIOLATION,
      "Entity does not belong to a connector instance attached to this station.",
    );
  }
}
```

**New API code — `apps/api/src/constants/api-codes.constants.ts`:**

```typescript
STATION_SCOPE_VIOLATION = "STATION_SCOPE_VIOLATION",
```

### 3.3 `resolveEntityCapabilities()`

**File:** `apps/api/src/utils/resolve-capabilities.util.ts`

Helper to build the per-entity capability map for system prompt enrichment:

```typescript
export async function resolveEntityCapabilities(
  stationId: string,
): Promise<Record<string, ResolvedCapabilities>> {
  const stationCaps = await resolveStationCapabilities(stationId);
  const capsByInstance = new Map(stationCaps.map(sc => [sc.connectorInstanceId, sc.capabilities]));

  const stationInstances = await stationInstancesRepo.findByStationId(stationId);
  const instanceIds = stationInstances.map(si => si.connectorInstanceId);

  const entities = await connectorEntitiesRepo.findByConnectorInstanceIds(instanceIds);

  const result: Record<string, ResolvedCapabilities> = {};
  for (const entity of entities) {
    const caps = capsByInstance.get(entity.connectorInstanceId);
    if (caps) result[entity.id] = caps;
  }

  return result;
}
```

---

## 4. System Prompt Enrichment

### 4.1 StationContext Extension

**File:** `apps/api/src/prompts/system.prompt.ts`

```typescript
export interface StationContext {
  stationId: string;
  stationName: string;
  entities: EntitySchema[];
  entityGroups: EntityGroupContext[];
  toolPacks: string[];
  entityCapabilities?: Record<string, ResolvedCapabilities>;  // NEW
}
```

### 4.2 `buildSystemPrompt()` Update

**File:** `apps/api/src/prompts/system.prompt.ts`

Update the entity rendering loop to include capability flags and connector info:

```typescript
for (const entity of stationContext.entities) {
  const caps = stationContext.entityCapabilities?.[entity.id];
  const flags = caps
    ? ` [${[caps.read && "read", caps.write && "write"].filter(Boolean).join(", ")}]`
    : "";
  lines.push(`### ${entity.label} (\`${entity.key}\`)${flags}`);
  lines.push("Columns:");
  for (const col of entity.columns) {
    lines.push(`  - \`${col.key}\` (${col.type}): ${col.label}`);
  }
  lines.push("");
}
```

### 4.3 Sync Behavior Guidance

When `entity_management` is in `toolPacks`, append to the system prompt:

```typescript
if (stationContext.toolPacks.includes("entity_management")) {
  lines.push("## Entity Management Notes");
  lines.push("");
  lines.push("- Entities marked [read, write] accept create, update, and delete operations.");
  lines.push("- Entities marked [read] are read-only — write tool calls will be rejected.");
  lines.push("- Records you create are independent and will not be overwritten by syncs.");
  lines.push("- Records you modify that originated from a sync will be overwritten on the next sync.");
  lines.push("- Structural changes (field mappings, column definitions) persist across syncs.");
  lines.push("");
}
```

### 4.4 Portal Service Wiring

**File:** `apps/api/src/services/portal.service.ts`

In `createPortal()`, resolve entity capabilities and include them in the station context:

```typescript
const entityCapabilities = toolPacks.includes("entity_management")
  ? await resolveEntityCapabilities(stationId)
  : undefined;

const stationContext: StationContext = {
  stationId: station.id,
  stationName: station.name,
  entities: stationData.entities,
  entityGroups: stationData.entityGroups,
  toolPacks,
  entityCapabilities,
};
```

---

## 5. `buildAnalyticsTools()` Signature Change

### 5.1 New Signature

**File:** `apps/api/src/services/tools.service.ts`

```typescript
static async buildAnalyticsTools(
  organizationId: string,
  stationId: string,
  userId: string,                    // NEW — portal owner for audit trail
  onDataMutation?: () => void,       // NEW — cache eviction callback
): Promise<Record<string, Tool>>
```

### 5.2 Portal Service Wiring

**File:** `apps/api/src/services/portal.service.ts`

In `streamResponse()`, pass the new parameters:

```typescript
const tools = await ToolService.buildAnalyticsTools(
  organizationId,
  stationId,
  portal.createdBy,
  () => stationDataCache.delete(portal.id),
);
```

Update all other call sites of `buildAnalyticsTools()` to pass the new parameters (or use defaults: `userId = "system"`, `onDataMutation = undefined`).

---

## 6. Shared Validation Services

Extract validation logic from routers into service classes so both HTTP routes and tools call the same methods. Each service is a static-method class following the API style guide.

### 6.1 ConnectorEntityValidationService

**File:** `apps/api/src/services/connector-entity-validation.service.ts`

```typescript
export class ConnectorEntityValidationService {
  /**
   * Validate that a connector entity can be deleted.
   * Checks: write capability, no external references via refEntityKey.
   * Throws ApiError if validation fails.
   */
  static async validateDelete(connectorEntityId: string): Promise<void> {
    await assertWriteCapability(connectorEntityId);

    const entity = await connectorEntitiesRepo.findById(connectorEntityId);
    if (!entity) {
      throw new ApiError(404, ApiCode.CONNECTOR_ENTITY_NOT_FOUND, "Connector entity not found");
    }

    const externalRefs = await fieldMappingsRepo.findByRefEntityKey(entity.key, connectorEntityId);
    if (externalRefs.length > 0) {
      throw new ApiError(
        422,
        ApiCode.ENTITY_HAS_EXTERNAL_REFERENCES,
        "Cannot delete entity — other entities have field mappings referencing it via refEntityKey",
        { refFieldMappings: externalRefs.map(fm => ({ id: fm.id, connectorEntityId: fm.connectorEntityId })) },
      );
    }
  }

  /**
   * Execute cascade soft-delete for a connector entity.
   * Deletes: entity group members, tag assignments, field mappings, records, then the entity.
   * Returns cascaded counts.
   */
  static async executeDelete(
    connectorEntityId: string,
    userId: string,
  ): Promise<{ entityRecords: number; fieldMappings: number; entityTagAssignments: number; entityGroupMembers: number }> {
    const entityIds = [connectorEntityId];

    return DbService.transaction(async (tx) => {
      const [entityGroupMembers, entityTagAssignments, fieldMappings, entityRecords] =
        await Promise.all([
          DbService.repository.entityGroupMembers.softDeleteByConnectorEntityIds(entityIds, userId, tx),
          DbService.repository.entityTagAssignments.softDeleteByConnectorEntityIds(entityIds, userId, tx),
          DbService.repository.fieldMappings.softDeleteByConnectorEntityIds(entityIds, userId, tx),
          DbService.repository.entityRecords.softDeleteByConnectorEntityIds(entityIds, userId, tx),
        ]);

      await DbService.repository.connectorEntities.softDelete(connectorEntityId, userId, tx);

      return { entityRecords, fieldMappings, entityTagAssignments, entityGroupMembers };
    });
  }
}
```

### 6.2 FieldMappingValidationService

**File:** `apps/api/src/services/field-mapping-validation.service.ts`

```typescript
export class FieldMappingValidationService {
  /**
   * Validate that a field mapping can be deleted.
   * Checks: entity has no records.
   * Throws ApiError if validation fails.
   */
  static async validateDelete(fieldMappingId: string): Promise<void> {
    const fm = await fieldMappingsRepo.findById(fieldMappingId);
    if (!fm) {
      throw new ApiError(404, ApiCode.FIELD_MAPPING_NOT_FOUND, "Field mapping not found");
    }

    const recordCount = await entityRecordsRepo.countByConnectorEntityId(fm.connectorEntityId);
    if (recordCount > 0) {
      throw new ApiError(
        409,
        ApiCode.FIELD_MAPPING_DELETE_HAS_RECORDS,
        `Cannot delete field mapping: the connector entity has ${recordCount} record${recordCount !== 1 ? "s" : ""}. Delete the records first.`,
      );
    }
  }

  /**
   * Execute cascade soft-delete for a field mapping.
   * Deletes: entity group members using this as link, clears bidirectional counterpart, then the mapping.
   * Returns cascaded counts and whether a bidirectional reference was cleared.
   */
  static async executeDelete(
    fieldMappingId: string,
    userId: string,
  ): Promise<{ entityGroupMembers: number; bidirectionalCleared: boolean }> {
    return Repository.transaction(async (tx) => {
      await DbService.repository.fieldMappings.softDelete(fieldMappingId, userId, tx);
      const cascadedEntityGroupMembers =
        await DbService.repository.entityGroupMembers.softDeleteByLinkFieldMappingId(fieldMappingId, userId, tx);

      // Clear bidirectional reference on counterpart
      const fm = await fieldMappingsRepo.findById(fieldMappingId);
      let bidirectionalCleared = false;
      if (fm?.refBidirectionalFieldMappingId) {
        await DbService.repository.fieldMappings.update(
          fm.refBidirectionalFieldMappingId,
          { refBidirectionalFieldMappingId: null, updatedBy: userId },
          tx,
        );
        bidirectionalCleared = true;
      }

      return { entityGroupMembers: cascadedEntityGroupMembers, bidirectionalCleared };
    });
  }
}
```

### 6.3 ColumnDefinitionValidationService

**File:** `apps/api/src/services/column-definition-validation.service.ts`

```typescript
export class ColumnDefinitionValidationService {
  /**
   * Validate that a column definition can be deleted.
   * Checks: no field mappings reference it.
   * Throws ApiError if validation fails.
   */
  static async validateDelete(columnDefinitionId: string): Promise<void> {
    const cd = await columnDefinitionsRepo.findById(columnDefinitionId);
    if (!cd) {
      throw new ApiError(404, ApiCode.COLUMN_DEFINITION_NOT_FOUND, "Column definition not found");
    }

    const dependentMappings = await fieldMappingsRepo.findByColumnDefinitionId(columnDefinitionId);
    if (dependentMappings.length > 0) {
      throw new ApiError(
        422,
        ApiCode.COLUMN_DEFINITION_HAS_DEPENDENCIES,
        "Cannot delete column definition — field mappings reference it",
        { fieldMappingIds: dependentMappings.map(fm => fm.id) },
      );
    }
  }
}
```

### 6.4 NormalizationService

**File:** `apps/api/src/services/normalization.service.ts`

Shared normalization logic used by both the tool and future sync paths:

```typescript
export class NormalizationService {
  /**
   * Build normalizedData from raw data using the entity's field mappings.
   * If no field mappings exist, returns data as-is (passthrough).
   */
  static async normalize(
    connectorEntityId: string,
    data: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const fieldMappings = await DbService.repository.fieldMappings.findByConnectorEntityId(
      connectorEntityId,
      { include: ["columnDefinition"] },
    );

    if (fieldMappings.length === 0) {
      return { ...data };
    }

    const normalizedData: Record<string, unknown> = {};
    for (const fm of fieldMappings) {
      const colKey = fm.columnDefinition?.key;
      if (colKey && fm.sourceField in data) {
        normalizedData[colKey] = data[fm.sourceField];
      }
    }

    return normalizedData;
  }
}
```

### 6.5 Router Refactoring

Update existing routers to call the shared validation services instead of inlining the logic:

| Router | Current inline logic | Replace with |
|--------|---------------------|--------------|
| `connector-entity.router.ts` DELETE handler | Lines 653–692 | `ConnectorEntityValidationService.validateDelete()` + `.executeDelete()` |
| `field-mapping.router.ts` DELETE handler | Lines 674–720 | `FieldMappingValidationService.validateDelete()` + `.executeDelete()` |
| `column-definition.router.ts` DELETE handler | Inline dependency check | `ColumnDefinitionValidationService.validateDelete()` |

The refactored routers call the validation service, then return the result. Error handling (`try/catch` + `next(error)`) remains in the router.

---

## 7. Tool Implementations

All tools live in `apps/api/src/tools/` and extend the `Tool` base class from `types/tools.ts`. Each tool follows the same pattern:

1. Define a Zod `InputSchema` with `.describe()` annotations for Claude
2. Extend `Tool<typeof InputSchema>`
3. `build()` returns `tool({ description, inputSchema, execute })`
4. `execute` validates input, checks scope + permissions, calls service/repository, invalidates cache

Write tools catch `ApiError` from validation services and return `{ error: message }` as tool results (not thrown), so the LLM can adjust its behavior.

### 7.1 Read Tools

#### `entity_list`

**File:** `apps/api/src/tools/entity-list.tool.ts`

```typescript
const InputSchema = z.object({
  connectorInstanceId: z.string().optional().describe("Filter by connector instance ID"),
});
```

| Field | Value |
|-------|-------|
| slug | `entity_list` |
| description | List connector entities attached to this station. Optionally filter by connector instance. |
| build params | `(stationId: string)` |
| execute | Load station instances → get attached instance IDs → `connectorEntities.findMany()` filtered to those IDs (+ optional `connectorInstanceId` filter). Return `{ entities: [{ id, key, label, connectorInstanceId }] }`. |

#### `entity_record_list`

**File:** `apps/api/src/tools/entity-record-list.tool.ts`

```typescript
const InputSchema = z.object({
  connectorEntityId: z.string().describe("The entity to list records from"),
  limit: z.number().optional().default(20).describe("Max records to return (default 20)"),
  offset: z.number().optional().default(0).describe("Number of records to skip"),
});
```

| Field | Value |
|-------|-------|
| slug | `entity_record_list` |
| description | List records for a connector entity with pagination. |
| build params | `(stationId: string)` |
| execute | `assertStationScope(stationId, connectorEntityId)` → `entityRecords.findMany()` with limit/offset. Return `{ records: [{ id, sourceId, normalizedData }], total }`. |

### 7.2 Write Tools — Entity Records

#### `entity_record_create`

**File:** `apps/api/src/tools/entity-record-create.tool.ts`

```typescript
const InputSchema = z.object({
  connectorEntityId: z.string().describe("The entity to create a record in"),
  sourceId: z.string().optional().describe("Optional external source ID (UUID generated if omitted)"),
  data: z.record(z.unknown()).describe("The record data as key-value pairs matching the entity's source fields"),
});
```

| Field | Value |
|-------|-------|
| slug | `entity_record_create` |
| build params | `(stationId, organizationId, userId, options)` |
| execute | 1. `assertStationScope` 2. `assertWriteCapability` (catch → return error) 3. `NormalizationService.normalize()` 4. `entityRecords.create()` with `origin: "portal"`, `checksum: "manual"`, `createdBy: userId` 5. `onMutation()` 6. Return `{ success: true, recordId }` |

#### `entity_record_update`

**File:** `apps/api/src/tools/entity-record-update.tool.ts`

```typescript
const InputSchema = z.object({
  connectorEntityId: z.string().describe("The entity the record belongs to"),
  entityRecordId: z.string().describe("The record ID to update"),
  data: z.record(z.unknown()).describe("The updated record data"),
});
```

| Field | Value |
|-------|-------|
| slug | `entity_record_update` |
| build params | `(stationId, organizationId, userId, options)` |
| execute | 1. `assertStationScope` 2. `assertWriteCapability` 3. Verify record exists and belongs to entity 4. `NormalizationService.normalize()` 5. `entityRecords.update(id, { data, normalizedData, updatedBy: userId })` 6. `onMutation()` 7. Return `{ success: true, recordId }` |

#### `entity_record_delete`

**File:** `apps/api/src/tools/entity-record-delete.tool.ts`

```typescript
const InputSchema = z.object({
  connectorEntityId: z.string().describe("The entity the record belongs to"),
  entityRecordId: z.string().describe("The record ID to delete"),
});
```

| Field | Value |
|-------|-------|
| slug | `entity_record_delete` |
| build params | `(stationId, organizationId, userId, options)` |
| execute | 1. `assertStationScope` 2. `assertWriteCapability` 3. Verify record exists and belongs to entity 4. `entityRecords.softDelete(id, userId)` 5. `onMutation()` 6. Return `{ success: true, recordId }` |

### 7.3 Write Tools — Connector Entities

#### `connector_entity_update`

**File:** `apps/api/src/tools/connector-entity-update.tool.ts`

```typescript
const InputSchema = z.object({
  connectorEntityId: z.string().describe("The entity to update"),
  label: z.string().min(1).describe("The new label for the entity"),
});
```

| Field | Value |
|-------|-------|
| slug | `connector_entity_update` |
| build params | `(stationId, organizationId, userId, options)` |
| execute | 1. `assertStationScope` 2. `assertWriteCapability` 3. `connectorEntities.update(id, { label, updatedBy: userId })` 4. `onMutation()` 5. Return `{ success: true, connectorEntityId }` |

#### `connector_entity_delete`

**File:** `apps/api/src/tools/connector-entity-delete.tool.ts`

```typescript
const InputSchema = z.object({
  connectorEntityId: z.string().describe("The entity to delete (cascades to records, field mappings, tags, and group members)"),
});
```

| Field | Value |
|-------|-------|
| slug | `connector_entity_delete` |
| build params | `(stationId, organizationId, userId, options)` |
| execute | 1. `assertStationScope` 2. `ConnectorEntityValidationService.validateDelete()` (catch → return error with reason) 3. `ConnectorEntityValidationService.executeDelete(id, userId)` 4. `onMutation()` 5. Return `{ success: true, connectorEntityId, cascaded }` |

### 7.4 Write Tools — Column Definitions

#### `column_definition_create`

**File:** `apps/api/src/tools/column-definition-create.tool.ts`

```typescript
const InputSchema = z.object({
  key: z.string().min(1).describe("Unique key (snake_case) for the column definition"),
  label: z.string().min(1).describe("Human-readable label"),
  type: z.enum(["string", "number", "boolean", "date", "datetime", "enum", "json", "array", "reference", "reference-array", "currency"]).describe("Column data type"),
  required: z.boolean().optional().default(false).describe("Whether this column is required"),
  enumValues: z.array(z.string()).optional().describe("Allowed values for enum type"),
  description: z.string().optional().describe("Description of the column"),
});
```

| Field | Value |
|-------|-------|
| slug | `column_definition_create` |
| build params | `(organizationId, userId, options)` |
| permission | Organization-level — no instance check |
| execute | 1. `columnDefinitions.upsertByKey({ organizationId, key, label, type, required, enumValues, description, createdBy: userId })` 2. `onMutation()` 3. Return `{ success: true, columnDefinitionId }` |

#### `column_definition_update`

**File:** `apps/api/src/tools/column-definition-update.tool.ts`

```typescript
const InputSchema = z.object({
  columnDefinitionId: z.string().describe("The column definition to update"),
  label: z.string().optional().describe("New label"),
  description: z.string().optional().describe("New description"),
  enumValues: z.array(z.string()).optional().describe("Updated enum values (for enum type only)"),
});
```

| Field | Value |
|-------|-------|
| slug | `column_definition_update` |
| build params | `(organizationId, userId, options)` |
| permission | Organization-level — no instance check |
| execute | 1. Verify column definition exists 2. `columnDefinitions.update(id, { ...fields, updatedBy: userId })` 3. `onMutation()` 4. Return `{ success: true, columnDefinitionId }`. Note: `key` and `type` are immutable — not accepted as input. |

#### `column_definition_delete`

**File:** `apps/api/src/tools/column-definition-delete.tool.ts`

```typescript
const InputSchema = z.object({
  columnDefinitionId: z.string().describe("The column definition to delete (blocked if field mappings reference it)"),
});
```

| Field | Value |
|-------|-------|
| slug | `column_definition_delete` |
| build params | `(organizationId, userId, options)` |
| permission | Organization-level — no instance check |
| execute | 1. `ColumnDefinitionValidationService.validateDelete()` (catch → return error) 2. `columnDefinitions.softDelete(id, userId)` 3. `onMutation()` 4. Return `{ success: true, columnDefinitionId }` |

### 7.5 Write Tools — Field Mappings

#### `field_mapping_create`

**File:** `apps/api/src/tools/field-mapping-create.tool.ts`

```typescript
const InputSchema = z.object({
  connectorEntityId: z.string().describe("The connector entity"),
  columnDefinitionId: z.string().describe("The column definition to map to"),
  sourceField: z.string().min(1).describe("The source field name from the external data"),
  isPrimaryKey: z.boolean().optional().default(false).describe("Whether this field is the primary key"),
});
```

| Field | Value |
|-------|-------|
| slug | `field_mapping_create` |
| build params | `(stationId, organizationId, userId, options)` |
| execute | 1. `assertStationScope` 2. `assertWriteCapability` 3. Verify column definition exists 4. `fieldMappings.upsertByEntityAndColumn({ connectorEntityId, columnDefinitionId, sourceField, isPrimaryKey, organizationId, createdBy: userId })` 5. `onMutation()` 6. Return `{ success: true, fieldMappingId }` |

#### `field_mapping_delete`

**File:** `apps/api/src/tools/field-mapping-delete.tool.ts`

```typescript
const InputSchema = z.object({
  fieldMappingId: z.string().describe("The field mapping to delete (blocked if entity has records)"),
});
```

| Field | Value |
|-------|-------|
| slug | `field_mapping_delete` |
| build params | `(stationId, organizationId, userId, options)` |
| execute | 1. Load field mapping, resolve `connectorEntityId` 2. `assertStationScope` 3. `assertWriteCapability` 4. `FieldMappingValidationService.validateDelete()` (catch → return error) 5. `FieldMappingValidationService.executeDelete(id, userId)` 6. `onMutation()` 7. Return `{ success: true, fieldMappingId, cascaded }` |

---

## 8. Tool Registration

### 8.1 Registration Block

**File:** `apps/api/src/services/tools.service.ts`

Inside `buildAnalyticsTools()`, after the existing pack blocks:

```typescript
// -------------------------------------------------------------------
// Pack: entity_management
// -------------------------------------------------------------------
if (enabledPacks.has("entity_management")) {
  const stationCaps = await resolveStationCapabilities(stationId);

  const scopeAssert = (entityId: string) => assertStationScope(stationId, entityId);
  const toolOptions = {
    assertScope: scopeAssert,
    onMutation: onDataMutation,
  };

  // Read tools — always registered
  tools.entity_list = new EntityListTool().build(stationId);
  tools.entity_record_list = new EntityRecordListTool().build(stationId);

  // Write tools — registered only if ANY attached instance has write capability
  if (stationCaps.some(sc => sc.capabilities.write)) {
    tools.entity_record_create = new EntityRecordCreateTool().build(stationId, organizationId, userId, toolOptions);
    tools.entity_record_update = new EntityRecordUpdateTool().build(stationId, organizationId, userId, toolOptions);
    tools.entity_record_delete = new EntityRecordDeleteTool().build(stationId, organizationId, userId, toolOptions);
    tools.connector_entity_update = new ConnectorEntityUpdateTool().build(stationId, organizationId, userId, toolOptions);
    tools.connector_entity_delete = new ConnectorEntityDeleteTool().build(stationId, organizationId, userId, toolOptions);
    tools.column_definition_create = new ColumnDefinitionCreateTool().build(organizationId, userId, toolOptions);
    tools.column_definition_update = new ColumnDefinitionUpdateTool().build(organizationId, userId, toolOptions);
    tools.column_definition_delete = new ColumnDefinitionDeleteTool().build(organizationId, userId, toolOptions);
    tools.field_mapping_create = new FieldMappingCreateTool().build(stationId, organizationId, userId, toolOptions);
    tools.field_mapping_delete = new FieldMappingDeleteTool().build(stationId, organizationId, userId, toolOptions);
  }
}
```

---

## 9. Two-Way Sync Support

The `origin` field (§2.1) and `checksum: "manual"` convention lay the foundation for future two-way sync. No additional work is required in this spec, but the following conventions must be maintained:

| Record source | `origin` | `checksum` | `sourceId` |
|---------------|----------|------------|------------|
| External sync (CSV, API) | `"sync"` | SHA256 hash | Row index or external ID |
| Web UI manual create | `"manual"` | `"manual"` | UUID |
| Portal tool create | `"portal"` | `"manual"` | UUID |

When two-way sync is implemented:

1. **Push candidates**: Records with `origin: "portal"` or `origin: "manual"` and `updated > syncedAt` (or never synced)
2. **Conflict detection**: Compare local `updated` against remote last-modified timestamp
3. **Conflict resolution**: Configurable per connector instance — deferred to a future spec

---

## 10. File Change Summary

### New Files

| File | Purpose |
|------|---------|
| `apps/api/src/tools/entity-list.tool.ts` | Read tool |
| `apps/api/src/tools/entity-record-list.tool.ts` | Read tool |
| `apps/api/src/tools/entity-record-create.tool.ts` | Write tool |
| `apps/api/src/tools/entity-record-update.tool.ts` | Write tool |
| `apps/api/src/tools/entity-record-delete.tool.ts` | Write tool |
| `apps/api/src/tools/connector-entity-update.tool.ts` | Write tool |
| `apps/api/src/tools/connector-entity-delete.tool.ts` | Write tool |
| `apps/api/src/tools/column-definition-create.tool.ts` | Write tool |
| `apps/api/src/tools/column-definition-update.tool.ts` | Write tool |
| `apps/api/src/tools/column-definition-delete.tool.ts` | Write tool |
| `apps/api/src/tools/field-mapping-create.tool.ts` | Write tool |
| `apps/api/src/tools/field-mapping-delete.tool.ts` | Write tool |
| `apps/api/src/services/connector-entity-validation.service.ts` | Shared validation |
| `apps/api/src/services/field-mapping-validation.service.ts` | Shared validation |
| `apps/api/src/services/column-definition-validation.service.ts` | Shared validation |
| `apps/api/src/services/normalization.service.ts` | Shared normalization |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/src/models/station.model.ts` | Add `"entity_management"` to `StationToolPackSchema` |
| `packages/core/src/models/entity-record.model.ts` | Add `origin` field |
| `apps/api/src/db/schema/entity-records.table.ts` | Add `origin` column + pgEnum |
| `apps/api/src/db/schema/type-checks.ts` | Add `origin` type assertion |
| `apps/api/src/db/schema/zod.ts` | Add `origin` to generated schemas |
| `apps/api/src/services/tools.service.ts` | Add `"entity_management"` to `ALL_TOOL_PACKS` and `PACK_TOOL_NAMES`, update `buildAnalyticsTools()` signature, add registration block |
| `apps/api/src/utils/resolve-capabilities.util.ts` | Add `resolveStationCapabilities()`, `assertStationScope()`, `resolveEntityCapabilities()` |
| `apps/api/src/prompts/system.prompt.ts` | Extend `StationContext`, update `buildSystemPrompt()` |
| `apps/api/src/services/portal.service.ts` | Pass new params to `buildAnalyticsTools()`, resolve entity capabilities |
| `apps/api/src/constants/api-codes.constants.ts` | Add `STATION_SCOPE_VIOLATION` |
| `apps/api/src/services/csv-import.service.ts` | Set `origin: "sync"` on upserted records |
| `apps/api/src/routes/entity-record.router.ts` | Set `origin: "manual"` in POST handler |
| `apps/api/src/routes/connector-entity.router.ts` | Refactor DELETE to use `ConnectorEntityValidationService` |
| `apps/api/src/routes/field-mapping.router.ts` | Refactor DELETE to use `FieldMappingValidationService` |
| `apps/api/src/routes/column-definition.router.ts` | Refactor DELETE to use `ColumnDefinitionValidationService` |

---

## 11. Implementation Order

1. **Schema changes** — `origin` field on entity records, migration
2. **Model updates** — Zod schema, type checks, drizzle-zod
3. **Origin backfill** — Set `origin: "sync"` in CSV import, `origin: "manual"` in REST create endpoint
4. **`StationToolPackSchema`** — Add `"entity_management"`
5. **Capability plumbing** — `resolveStationCapabilities()`, `assertStationScope()`, `resolveEntityCapabilities()`
6. **API code** — `STATION_SCOPE_VIOLATION`
7. **Shared validation services** — 4 service files
8. **Router refactoring** — Wire existing DELETE handlers to shared services
9. **System prompt enrichment** — `StationContext` extension, `buildSystemPrompt()` update
10. **`buildAnalyticsTools()` signature** — Add `userId`, `onDataMutation`
11. **`NormalizationService`** — Shared normalization logic
12. **Read tools** — `entity_list`, `entity_record_list`
13. **Write tools** — All 10 write tool classes
14. **Tool registration** — `entity_management` block in `ToolService`
15. **Portal service wiring** — Entity capabilities + new `buildAnalyticsTools()` params

---

## 12. Test Plan

### 12.1 Unit Tests — Capability Plumbing

**File:** `apps/api/src/__tests__/utils/resolve-capabilities.util.test.ts`

#### `resolveStationCapabilities()`

| Test | Setup | Expected |
|------|-------|----------|
| returns empty array for station with no instances | Station with no `station_instances` | `[]` |
| returns capabilities for each attached instance | Station with 2 instances (one write, one read-only) | Array of 2 `StationInstanceCapability` with correct flags |
| respects instance-level override narrowing write to false | Definition `write: true`, instance `enabledCapabilityFlags: { write: false }` | `capabilities.write === false` |
| inherits definition capabilities when override is null | Definition `write: true`, instance `enabledCapabilityFlags: null` | `capabilities.write === true` |
| skips instances with missing definitions | Instance with deleted definition | Excluded from results |

#### `assertStationScope()`

| Test | Setup | Expected |
|------|-------|----------|
| passes for entity belonging to an attached instance | Entity's instance is in `station_instances` | No error thrown |
| throws `CONNECTOR_ENTITY_NOT_FOUND` for non-existent entity | Invalid `connectorEntityId` | 404 ApiError |
| throws `STATION_SCOPE_VIOLATION` for cross-station entity | Entity belongs to instance not attached to station | 403 ApiError |

#### `resolveEntityCapabilities()`

| Test | Setup | Expected |
|------|-------|----------|
| returns capability map keyed by entity ID | Station with 2 entities across 2 instances | Map with correct capabilities per entity |
| returns empty map for station with no instances | Empty station | `{}` |

### 12.2 Unit Tests — Shared Validation Services

**File:** `apps/api/src/__tests__/services/connector-entity-validation.service.test.ts`

#### `ConnectorEntityValidationService.validateDelete()`

| Test | Setup | Expected |
|------|-------|----------|
| passes when no external references exist | Entity with no `refEntityKey` references | No error |
| throws `CONNECTOR_INSTANCE_WRITE_DISABLED` when write is disabled | Write disabled on instance | 422 ApiError |
| throws `ENTITY_HAS_EXTERNAL_REFERENCES` when references exist | Another entity's field mapping references this entity | 422 ApiError with `refFieldMappings` metadata |

#### `ConnectorEntityValidationService.executeDelete()`

| Test | Setup | Expected |
|------|-------|----------|
| cascade soft-deletes all dependent objects | Entity with records, mappings, tags, group members | All counts > 0, entity soft-deleted |
| runs in a single transaction | Mock transaction | All operations share same `tx` |

**File:** `apps/api/src/__tests__/services/field-mapping-validation.service.test.ts`

#### `FieldMappingValidationService.validateDelete()`

| Test | Setup | Expected |
|------|-------|----------|
| passes when entity has no records | Entity with 0 records | No error |
| throws `FIELD_MAPPING_DELETE_HAS_RECORDS` when records exist | Entity with 5 records | 409 ApiError |

#### `FieldMappingValidationService.executeDelete()`

| Test | Setup | Expected |
|------|-------|----------|
| cascade soft-deletes group members | Mapping used as link in group member | `entityGroupMembers > 0` |
| clears bidirectional counterpart | Mapping has `refBidirectionalFieldMappingId` | Counterpart's ref set to null, `bidirectionalCleared: true` |
| returns `bidirectionalCleared: false` when no counterpart | No bidirectional ref | `bidirectionalCleared: false` |

**File:** `apps/api/src/__tests__/services/column-definition-validation.service.test.ts`

#### `ColumnDefinitionValidationService.validateDelete()`

| Test | Setup | Expected |
|------|-------|----------|
| passes when no field mappings reference it | No dependent mappings | No error |
| throws `COLUMN_DEFINITION_HAS_DEPENDENCIES` when referenced | 2 field mappings reference it | 422 ApiError with `fieldMappingIds` |

### 12.3 Unit Tests — NormalizationService

**File:** `apps/api/src/__tests__/services/normalization.service.test.ts`

| Test | Setup | Expected |
|------|-------|----------|
| normalizes data through field mappings | Entity with 2 mappings: `Name→name`, `Email→email` | `{ name: "Jane", email: "jane@x.com" }` |
| omits unmapped source fields | Data has field with no mapping | Field absent from normalizedData |
| passes through data when no field mappings exist | Entity with 0 mappings | normalizedData equals input data |
| handles missing source fields gracefully | Mapping references field not in data | Key absent from normalizedData |

### 12.4 Unit Tests — Tool Classes

Each tool needs isolated unit tests mocking the repository and validation layers. One test file per tool.

**File pattern:** `apps/api/src/__tests__/tools/<tool-slug>.tool.test.ts`

#### Common patterns across all write tools

| Test | Expected |
|------|----------|
| returns error object when `assertWriteCapability` rejects | `{ error: "..." }` (not thrown) |
| returns error object when station scope check fails | `{ error: "..." }` (not thrown) |
| calls `onMutation()` after successful write | Callback invoked once |
| does not call `onMutation()` on validation failure | Callback not invoked |
| uses provided `userId` for `createdBy`/`updatedBy` | Repository called with correct user |

#### `entity_record_create` specific

| Test | Expected |
|------|----------|
| creates record with auto-normalized data | `NormalizationService.normalize()` called, result used as `normalizedData` |
| sets `origin: "portal"` | Record has `origin: "portal"` |
| sets `checksum: "manual"` | Record has `checksum: "manual"` |
| auto-generates UUID `sourceId` when omitted | `sourceId` is a valid UUID |
| uses provided `sourceId` when given | `sourceId` matches input |

#### `entity_record_update` specific

| Test | Expected |
|------|----------|
| rejects if record does not belong to entity | `{ error: "..." }` |
| updates `data` and `normalizedData` | Both fields written |
| sets `updatedBy` to userId | Correct audit trail |

#### `entity_record_delete` specific

| Test | Expected |
|------|----------|
| soft-deletes the record | `softDelete()` called with correct ID and userId |
| rejects if record does not belong to entity | `{ error: "..." }` |

#### `connector_entity_update` specific

| Test | Expected |
|------|----------|
| updates entity label | `update()` called with new label |

#### `connector_entity_delete` specific

| Test | Expected |
|------|----------|
| returns cascaded counts | `{ success: true, cascaded: { entityRecords: N, ... } }` |
| returns error when external references exist | `{ error: "..." }` with explanation |

#### `column_definition_create` specific

| Test | Expected |
|------|----------|
| upserts by key | `upsertByKey()` called |
| does not require station scope or write capability | No scope/write check |

#### `column_definition_update` specific

| Test | Expected |
|------|----------|
| does not accept `key` or `type` changes | Input schema rejects these fields |
| updates label and description | `update()` called with fields |

#### `column_definition_delete` specific

| Test | Expected |
|------|----------|
| returns error when field mappings reference it | `{ error: "..." }` |

#### `field_mapping_create` specific

| Test | Expected |
|------|----------|
| upserts mapping by entity + column | `upsertByEntityAndColumn()` called |
| rejects if column definition does not exist | `{ error: "..." }` |

#### `field_mapping_delete` specific

| Test | Expected |
|------|----------|
| returns error when entity has records | `{ error: "..." }` with record count |
| returns cascaded counts | `{ cascaded: { entityGroupMembers, bidirectionalCleared } }` |

#### `entity_list` specific

| Test | Expected |
|------|----------|
| returns only entities attached to station | Entities from other stations excluded |
| filters by `connectorInstanceId` when provided | Only matching entities returned |

#### `entity_record_list` specific

| Test | Expected |
|------|----------|
| returns paginated records | Respects `limit` and `offset` |
| validates station scope | Rejects entity from another station |

### 12.5 Unit Tests — System Prompt

**File:** `apps/api/src/__tests__/prompts/system.prompt.test.ts`

| Test | Setup | Expected |
|------|-------|----------|
| renders capability flags when `entityCapabilities` is provided | Entity with `{ read: true, write: true }` | Output contains `[read, write]` |
| renders `[read]` for read-only entities | Entity with `{ read: true, write: false }` | Output contains `[read]` |
| omits flags when `entityCapabilities` is undefined | No capabilities | No brackets in output |
| includes sync behavior notes when `entity_management` is in `toolPacks` | `toolPacks: ["entity_management"]` | Output contains "Entity Management Notes" section |
| omits sync behavior notes when `entity_management` not in `toolPacks` | `toolPacks: ["data_query"]` | No "Entity Management Notes" section |

### 12.6 Unit Tests — Tool Registration

**File:** `apps/api/src/__tests__/services/tools.service.test.ts`

| Test | Setup | Expected |
|------|-------|----------|
| registers only read tools when no instances have write | Station with `entity_management` pack, all instances read-only | `entity_list` and `entity_record_list` in tools, no write tools |
| registers read + write tools when any instance has write | At least one instance with write | All 12 tools registered |
| does not register entity_management tools when pack not enabled | Station without `entity_management` | No entity_management tools |
| passes `userId` and `onDataMutation` to write tools | Mock assertions | Build called with correct params |

### 12.7 Integration Tests — Tool Execution

**File:** `apps/api/src/__tests__/__integration__/tools/entity-management.integration.test.ts`

End-to-end tests that create a real station with connector instances and execute tools against the database.

#### Setup

- Create organization, user
- Create connector definition with `capabilityFlags: { write: true, query: true }`
- Create connector instance with `enabledCapabilityFlags: { write: true }`
- Create station, attach instance via `station_instances`
- Create connector entity, column definitions, field mappings

#### `entity_record_create`

| Test | Expected |
|------|----------|
| creates record in database with `origin: "portal"` | Record exists with correct origin, normalizedData auto-generated |
| rejects when write disabled on instance | Error result returned, no record created |
| rejects when entity not attached to station | Error result returned |

#### `entity_record_update`

| Test | Expected |
|------|----------|
| updates record data and normalizedData | DB reflects changes |
| rejects update on record from different entity | Error result returned |

#### `entity_record_delete`

| Test | Expected |
|------|----------|
| soft-deletes record | Record has `deleted` timestamp, invisible to queries |

#### `connector_entity_delete`

| Test | Expected |
|------|----------|
| cascade deletes all dependents in transaction | Records, mappings, tags, group members all soft-deleted |
| blocks when external references exist | Error returned, nothing deleted |

#### `field_mapping_delete`

| Test | Expected |
|------|----------|
| blocks when entity has records | Error with record count |
| cascades to group members | Group members soft-deleted |

#### `column_definition_delete`

| Test | Expected |
|------|----------|
| blocks when field mappings reference it | Error with mapping IDs |
| succeeds when unreferenced | Column definition soft-deleted |

### 12.8 Integration Tests — Sync After Portal Mutations

**File:** `apps/api/src/__tests__/__integration__/tools/sync-interaction.integration.test.ts`

Tests that verify sync behavior after tool-initiated mutations.

| Test | Setup | Expected |
|------|-------|----------|
| sync does not overwrite tool-created records | Create record via tool (`sourceId: UUID`), then run CSV import | Tool-created record preserved, import records added alongside |
| sync restores tool-deleted synced records | Import CSV, delete a record via tool, re-import same CSV | Record re-created with `origin: "sync"` |
| sync overwrites tool-modified synced records | Import CSV, modify record via tool, re-import same CSV | Record reverted to source data |
| sync uses tool-created field mappings | Create field mapping via tool, then run CSV import | New mapping applied to `normalizedData` |
| sync skips deleted entities | Delete entity via tool, attempt sync | Sync fails gracefully or skips |

### 12.9 Contract Tests

**File:** `packages/core/src/__tests__/models/entity-record.model.test.ts`

| Test | Expected |
|------|----------|
| `EntityRecordSchema` accepts `origin: "sync"` | Parse succeeds |
| `EntityRecordSchema` accepts `origin: "manual"` | Parse succeeds |
| `EntityRecordSchema` accepts `origin: "portal"` | Parse succeeds |
| `EntityRecordSchema` rejects invalid origin | Parse fails |
| `EntityRecordSchema` defaults origin to `"manual"` when omitted | Parsed value is `"manual"` |

### 12.10 Existing Test Updates

| File | Change |
|------|--------|
| `apps/api/src/__tests__/services/tools.service.test.ts` | Add entity_management registration tests (§12.6) |
| `apps/api/src/__tests__/prompts/system.prompt.test.ts` | Add capability flag rendering tests (§12.5) |
| `apps/api/src/__tests__/__integration__/routes/connector-entity.router.integration.test.ts` | Verify DELETE still works after refactoring to shared validation service |
| `apps/api/src/__tests__/__integration__/routes/field-mapping.router.integration.test.ts` | Verify DELETE still works after refactoring to shared validation service |
| `apps/api/src/__tests__/__integration__/routes/column-definition.router.integration.test.ts` | Verify DELETE still works after refactoring to shared validation service |
| `apps/api/src/__tests__/__integration__/routes/entity-record.router.integration.test.ts` | Verify `origin: "manual"` is set on POST-created records |
| `apps/api/src/__tests__/services/csv-import.service.test.ts` | Verify `origin: "sync"` is set on imported records |
