# Bulk Write — Feature Specification

> Companion to `BULK_WRITE.discovery.md`. This document specifies the exact changes required to add bulk (array) support to all 12 entity-management tools.

---

## 1. Design Summary

Wrap every entity-management tool's input with an `items` array. The tool count stays at 12 — no new tools are added. Each tool accepts `{ items: [...] }` where each element matches the current single-item schema. Single-item calls simply pass a one-element array.

All bulk operations are **all-or-nothing**: validation failures return per-item errors with nothing written; database failures roll back the entire transaction.

---

## 2. Input Schema Changes

Every tool's `InputSchema` becomes an `items` wrapper around the current per-item schema.

### 2.1 Entity Record Tools

**entity_record_create**

```ts
const ItemSchema = z.object({
  connectorEntityId: z.string().describe("The connector entity to create a record in"),
  sourceId: z.string().optional().describe("Optional source ID; auto-generated if omitted"),
  data: z.record(z.string(), z.unknown()).describe("Record data keyed by source field names"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Records to create (1–100)"),
});
```

**entity_record_update**

```ts
const ItemSchema = z.object({
  connectorEntityId: z.string().describe("The connector entity the record belongs to"),
  entityRecordId: z.string().describe("The record ID to update"),
  data: z.record(z.string(), z.unknown()).describe("Updated record data keyed by source field names"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Records to update (1–100)"),
});
```

**entity_record_delete**

```ts
const ItemSchema = z.object({
  connectorEntityId: z.string().describe("The connector entity the record belongs to"),
  entityRecordId: z.string().describe("The record ID to delete"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Records to delete (1–100)"),
});
```

### 2.2 Column Definition Tools

**column_definition_create**

```ts
const ItemSchema = z.object({
  key: z.string().min(1).describe("Unique key for the column definition"),
  label: z.string().min(1).describe("Display label"),
  type: ColumnDataTypeEnum.describe("Column data type"),
  description: z.string().optional().describe("Column description"),
  validationPattern: z.string().optional().describe("Regex validation pattern"),
  validationMessage: z.string().optional().describe("Validation error message"),
  canonicalFormat: z.string().optional().describe("Canonical display format"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Column definitions to create (1–100)"),
});
```

**column_definition_update**

```ts
const ItemSchema = z.object({
  columnDefinitionId: z.string().describe("The column definition ID to update"),
  label: z.string().min(1).optional().describe("New display label"),
  description: z.string().nullable().optional().describe("New description"),
  validationPattern: z.string().nullable().optional().describe("New regex validation pattern"),
  validationMessage: z.string().nullable().optional().describe("New validation error message"),
  canonicalFormat: z.string().nullable().optional().describe("New canonical display format"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Column definitions to update (1–100)"),
});
```

**column_definition_delete**

```ts
const ItemSchema = z.object({
  columnDefinitionId: z.string().describe("The column definition ID to delete"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Column definitions to delete (1–100)"),
});
```

### 2.3 Field Mapping Tools

**field_mapping_create**

```ts
const ItemSchema = z.object({
  connectorEntityId: z.string().describe("The connector entity to create the mapping for"),
  columnDefinitionId: z.string().describe("The column definition to map to"),
  sourceField: z.string().min(1).describe("Source field name in the raw data"),
  isPrimaryKey: z.boolean().optional().describe("Whether this mapping is a primary key"),
  normalizedKey: z.string().regex(/^[a-z][a-z0-9_]*$/).describe("Snake_case normalized key"),
  required: z.boolean().optional().describe("Whether this field is required"),
  defaultValue: z.string().nullable().optional().describe("Default value"),
  format: z.string().nullable().optional().describe("Format string"),
  enumValues: z.array(z.string()).nullable().optional().describe("Allowed enum values"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Field mappings to create (1–100)"),
});
```

**field_mapping_update**

```ts
const ItemSchema = z.object({
  fieldMappingId: z.string().describe("The field mapping ID to update"),
  sourceField: z.string().min(1).optional().describe("New source field name"),
  isPrimaryKey: z.boolean().optional().describe("Primary key flag"),
  normalizedKey: z.string().regex(/^[a-z][a-z0-9_]*$/).optional().describe("Normalized key"),
  required: z.boolean().optional().describe("Required flag"),
  defaultValue: z.string().nullable().optional().describe("Default value"),
  format: z.string().nullable().optional().describe("Format string"),
  enumValues: z.array(z.string()).nullable().optional().describe("Allowed enum values"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Field mappings to update (1–100)"),
});
```

**field_mapping_delete**

```ts
const ItemSchema = z.object({
  fieldMappingId: z.string().describe("The field mapping ID to delete"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Field mappings to delete (1–100)"),
});
```

### 2.4 Connector Entity Tools

**connector_entity_create**

```ts
const ItemSchema = z.object({
  connectorInstanceId: z.string().describe("The connector instance to create the entity under"),
  key: z.string().min(1).describe("Unique key (used as AlaSQL table name)"),
  label: z.string().min(1).describe("Human-readable label"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Connector entities to create (1–100)"),
});
```

**connector_entity_update**

```ts
const ItemSchema = z.object({
  connectorEntityId: z.string().describe("The connector entity ID to update"),
  label: z.string().min(1).describe("New label"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Connector entities to update (1–100)"),
});
```

**connector_entity_delete**

```ts
const ItemSchema = z.object({
  connectorEntityId: z.string().describe("The connector entity ID to delete"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Connector entities to delete (1–100)"),
});
```

---

## 3. Tool Description Updates

Each tool's `description` string must mention bulk support and the max item count. Example:

```
Current:  "Creates a new entity record with auto-normalized data."
Updated:  "Creates one or more entity records with auto-normalized data. Accepts 1–100 items."
```

Apply this pattern to all 12 tools. The `items` field description already documents the range.

---

## 4. Execution Flow (Per Tool)

All 12 tools follow a three-phase execution pattern inside their `execute` handler.

### Phase 1: Validate

1. Parse input via `this.validate(input)` — Zod enforces `items.min(1).max(100)`.
2. Group items by their scope key:
   - Entity record / field mapping / connector entity tools → group by `connectorEntityId`
   - Column definition tools → no grouping needed (organization-scoped)
   - Connector entity create → group by `connectorInstanceId`
3. Run pre-checks **once per unique scope key** (not per item):
   - `assertStationScope(stationId, connectorEntityId)` — once per unique `connectorEntityId`
   - `assertWriteCapability(connectorEntityId)` — once per unique `connectorEntityId`
   - Instance attachment check (connector entity create) — once per unique `connectorInstanceId`
4. Run per-item validation:
   - Record create/update: normalize data via `NormalizationService.normalizeMany()` (one DB query per unique `connectorEntityId`)
   - Record update/delete: verify each record exists and belongs to its claimed entity
   - Column definition delete: run `ColumnDefinitionValidationService.validateDelete()` per item
   - Field mapping delete: run `FieldMappingValidationService.validateDelete()` per item
   - Connector entity delete: run `ConnectorEntityValidationService.validateDelete()` per item
   - Field mapping create: verify each `columnDefinitionId` exists and belongs to the organization
5. If any item fails validation, return immediately with per-item errors (see Section 6).

### Phase 2: Execute

1. Open a single database transaction via `Repository.transaction()`.
2. Persist all items within that transaction:
   - **Entity record create**: `entityRecords.createMany(parsedModels, tx)`
   - **Entity record update**: `entityRecords.updateMany(payloads, tx)` (loops internally)
   - **Entity record delete**: `entityRecords.softDeleteMany(ids, userId, tx)`
   - **Column definition create**: loop `columnDefinitions.upsertByKey(model, tx)` per item
   - **Column definition update**: loop `columnDefinitions.update(id, data, tx)` per item
   - **Column definition delete**: loop `columnDefinitions.softDelete(id, userId, tx)` per item
   - **Field mapping create**: loop `fieldMappings.upsertByEntityAndNormalizedKey(model, tx)` per item
   - **Field mapping update**: loop `fieldMappings.update(id, data, tx)` per item
   - **Field mapping delete**: loop `FieldMappingValidationService.executeDelete(id, userId)` per item (uses its own transaction internally — see Section 9 note)
   - **Connector entity create**: loop `connectorEntities.upsertByKey(model, tx)` per item
   - **Connector entity update**: loop `connectorEntities.update(id, data, tx)` per item
   - **Connector entity delete**: loop `ConnectorEntityValidationService.executeDelete(id, userId)` per item (uses its own transaction internally — see Section 9 note)
3. If any DB operation fails, the transaction rolls back and the tool returns an error.

### Phase 3: Cache Update

After the transaction commits, update the AlaSQL in-memory cache using the new batch methods (see Section 7).

---

## 5. Column Definition Reuse

The `column_definition_create` tool must prioritize reusing existing column definitions over creating duplicates.

### Deduplication Logic

Before persisting, the tool must:

1. Load all existing column definitions for the organization via `columnDefinitions.findByOrganizationId(organizationId, tx)`.
2. Build a lookup map keyed by `key` (the composite unique constraint is `organizationId + key`).
3. For each item in the `items` array:
   - If an existing column definition matches by `key`:
     - Compare `type` — if the type matches, **reuse the existing definition** (return its ID, skip upsert).
     - If the type differs, **upsert** to update the existing definition with the new values.
   - If no existing definition matches by `key`, **create** a new one.
4. The tool result should indicate which items were reused vs. created:
   ```ts
   {
     success: true,
     operation: "created",
     entity: "column definition",
     count: 5,
     reused: 2,    // matched existing definitions
     created: 3,   // new definitions inserted
     items: [
       { entityId: "abc", summary: { key: "revenue", status: "reused" } },
       { entityId: "def", summary: { key: "cost", status: "created" } },
       // ...
     ],
   }
   ```

### Within-Batch Deduplication

If the `items` array contains duplicate `key` values, collapse them:
- Use the **last** occurrence (later items override earlier ones with the same key).
- This matches upsert semantics where the final write wins.

### Impact on Field Mapping Create

The `field_mapping_create` tool already accepts a `columnDefinitionId` — it does not create column definitions. However, the LLM should be guided (via tool descriptions) to call `column_definition_create` first, which will return existing IDs for reused definitions, and then pass those IDs to `field_mapping_create`.

---

## 6. Response Format

### Success Response

```ts
{
  success: true,
  operation: "created" | "updated" | "deleted",
  entity: string,
  count: number,
  items: Array<{
    entityId: string,
    summary?: Record<string, unknown>,
  }>,
}
```

- `count` — total items processed.
- `items` — per-item details. Keep summaries minimal (2–3 fields) to limit token cost.
- For single-item calls (`items.length === 1`), the response is identical — `count: 1` with a one-element `items` array.

### Validation Failure Response

```ts
{
  success: false,
  error: string,                          // e.g. "2 of 5 items failed validation"
  failures: Array<{
    index: number,                         // 0-based index in the input array
    error: string,                         // human-readable error
  }>,
}
```

- Nothing is written when validation fails.
- `failures` only includes items that failed — successful validations are omitted to save tokens.

### Database Error Response

```ts
{
  error: string,                          // e.g. "Transaction failed: unique constraint violated"
}
```

- The transaction rolls back entirely — no partial writes.

---

## 7. AlaSQL Cache Batch Methods

New static methods on `AnalyticsService` (`apps/api/src/services/analytics.service.ts`):

### 7.1 Core Batch Primitives

```ts
// Batch insert — single INSERT statement with row array
private static cacheBatchInsert(
  stationId: string,
  table: string,
  rows: Record<string, unknown>[],
): void {
  const entry = stationDatabases.get(stationId);
  if (!entry || rows.length === 0) return;
  try {
    alasql(`INSERT INTO [${entry.dbName}].[${table}] SELECT * FROM ?`, [rows]);
  } catch (err) {
    logger.warn({ stationId, table, count: rows.length, err }, "AlaSQL batch insert failed");
  }
}

// Batch upsert — delete by IDs then batch insert
private static cacheBatchUpsert(
  stationId: string,
  table: string,
  idColumn: string,
  rows: Record<string, unknown>[],
): void {
  const entry = stationDatabases.get(stationId);
  if (!entry || rows.length === 0) return;
  try {
    const ids = rows.map((r) => r[idColumn]);
    alasql(`DELETE FROM [${entry.dbName}].[${table}] WHERE [${idColumn}] IN @(?)`, [ids]);
    alasql(`INSERT INTO [${entry.dbName}].[${table}] SELECT * FROM ?`, [rows]);
  } catch (err) {
    logger.warn({ stationId, table, count: rows.length, err }, "AlaSQL batch upsert failed");
  }
}

// Batch delete — single DELETE with IN clause
private static cacheBatchDelete(
  stationId: string,
  table: string,
  idColumn: string,
  ids: string[],
): void {
  const entry = stationDatabases.get(stationId);
  if (!entry || ids.length === 0) return;
  try {
    alasql(`DELETE FROM [${entry.dbName}].[${table}] WHERE [${idColumn}] IN @(?)`, [ids]);
  } catch (err) {
    logger.warn({ stationId, table, count: ids.length, err }, "AlaSQL batch delete failed");
  }
}
```

### 7.2 Public Batch Methods

```ts
// Entity records
static applyRecordInsertMany(stationId: string, entityKey: string, rows: Record<string, unknown>[]): void
static applyRecordUpdateMany(stationId: string, entityKey: string, rows: Record<string, unknown>[]): void
static applyRecordDeleteMany(stationId: string, entityKey: string, recordIds: string[]): void

// Column definitions
static applyColumnDefinitionInsertMany(stationId: string, rows: Record<string, unknown>[]): void
static applyColumnDefinitionUpdateMany(stationId: string, rows: Record<string, unknown>[]): void
static applyColumnDefinitionDeleteMany(stationId: string, ids: string[]): void

// Field mappings
static applyFieldMappingInsertMany(stationId: string, rows: Record<string, unknown>[]): void
static applyFieldMappingUpdateMany(stationId: string, rows: Record<string, unknown>[]): void
static applyFieldMappingDeleteMany(stationId: string, ids: string[]): void

// Connector entities
static applyEntityInsertMany(stationId: string, rows: Record<string, unknown>[]): void
static applyEntityUpdateMany(stationId: string, rows: Record<string, unknown>[]): void
static applyEntityDeleteMany(stationId: string, entityIds: string[], entityKeys: string[]): void
```

Each method delegates to the appropriate core primitive (`cacheBatchInsert`, `cacheBatchUpsert`, or `cacheBatchDelete`) with the correct table name and ID column.

---

## 8. NormalizationService Changes

Add one new static method to `NormalizationService` (`apps/api/src/services/normalization.service.ts`):

```ts
/**
 * Normalize multiple data objects for the same connector entity.
 * Loads field mappings once and applies to all items.
 */
static async normalizeMany(
  connectorEntityId: string,
  dataItems: Record<string, unknown>[],
): Promise<NormalizationResult[]> {
  const mappings = await DbService.repository.fieldMappings.findMany(
    eq(fieldMappings.connectorEntityId, connectorEntityId),
    { include: ["columnDefinition"] },
  ) as unknown as MappingWithColumnDef[];

  return dataItems.map((data) =>
    NormalizationService.normalizeWithMappings(mappings, data),
  );
}
```

The existing `normalizeWithMappings` method handles the per-item logic. The only new code is the wrapping `normalizeMany` that fetches mappings once.

### Usage in Bulk Record Tools

Record create and update tools group items by `connectorEntityId`, then call `normalizeMany` once per group:

```ts
const groups = groupBy(items, (item) => item.connectorEntityId);

for (const [connectorEntityId, groupItems] of Object.entries(groups)) {
  const dataArray = groupItems.map((item) => item.data);
  const results = await NormalizationService.normalizeMany(connectorEntityId, dataArray);
  // pair each result back to its item...
}
```

---

## 9. Pre-check Optimization

### Batched Scope and Capability Assertions

Tools that require `assertStationScope` and `assertWriteCapability` must group items by `connectorEntityId` and run each check once:

```ts
const uniqueEntityIds = [...new Set(items.map((item) => item.connectorEntityId))];

for (const entityId of uniqueEntityIds) {
  await assertStationScope(stationId, entityId);
  await assertWriteCapability(entityId);
}
```

This pattern applies to:
- `entity_record_create`, `entity_record_update`, `entity_record_delete`
- `field_mapping_create`, `field_mapping_update`
- `connector_entity_update`, `connector_entity_delete`

Column definition tools do not require station scope (organization-level).

Connector entity create checks instance attachment instead — group by `connectorInstanceId` and verify once per instance.

### Transaction Compatibility Note

`connector_entity_delete` delegates to `ConnectorEntityValidationService.executeDelete()` and `field_mapping_delete` delegates to `FieldMappingValidationService.executeDelete()`, both of which manage their own transactions internally. For bulk delete on these tools, call each delete sequentially (not inside a wrapping transaction). If any delete fails, the previously completed deletes will have committed. This is acceptable because:

- Delete validation is run upfront for **all** items before any deletes execute.
- The most likely runtime failure is a DB constraint violation, which the upfront validation already catches.
- Wrapping external transaction managers inside another transaction adds complexity for minimal safety gain.

For entity record delete and column definition delete, these use simple `softDelete`/`softDeleteMany` and **should** be wrapped in a single transaction.

---

## 10. MutationResultContentBlock Schema Changes

File: `packages/core/src/contracts/portal.contract.ts`

```ts
export const MutationResultContentBlockSchema = z.object({
  type: z.literal("mutation-result"),
  operation: z.enum(["created", "updated", "deleted"]),
  entity: z.string(),
  entityId: z.string().optional(),       // optional for bulk (no single ID)
  count: z.number().int().optional(),     // how many items were affected
  summary: z.record(z.string(), z.unknown()).optional(),
  items: z.array(z.object({
    entityId: z.string(),
    summary: z.record(z.string(), z.unknown()).optional(),
  })).optional(),
});
```

### Changes from Current Schema

| Field | Current | New |
|-------|---------|-----|
| `entityId` | `z.string()` (required) | `z.string().optional()` |
| `count` | — | `z.number().int().optional()` |
| `items` | — | `z.array(...).optional()` |

### Backward Compatibility

Single-item results continue to set `entityId` directly. The `count` and `items` fields are optional and omitted for single-item results. No existing code breaks.

---

## 11. MutationResultBlock Component Changes

File: `packages/core/src/ui/MutationResultBlock.tsx`

### Display Logic

```
if count > 1:
  "{Operation} {count} {entity}s"              → "Created 5 records"
  + summary text if present                     → "Created 5 records (in Customers)"
else:
  "{Operation} {entity}"                        → "Created record"
  + summary text if present                     → "Created record (sourceId: abc-123)"
```

### Updated Component

Add bulk-aware rendering to `MutationResultBlock`:

```tsx
export const MutationResultBlock: React.FC<MutationResultBlockProps> = ({ content }) => {
  const config = OPERATION_LABELS[content.operation] ?? {
    label: content.operation,
    severity: "info" as const,
  };
  const isBulk = (content.count ?? 0) > 1;
  const summaryText = content.summary ? formatSummary(content.summary) : "";

  return (
    <Alert
      severity={config.severity}
      variant="outlined"
      sx={{ py: 0.5, my: 0.5, "& .MuiAlert-message": { py: 0.25 } }}
    >
      <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
        {config.label}
      </Typography>{" "}
      <Typography variant="body2" component="span">
        {isBulk ? `${content.count} ${content.entity}s` : content.entity}
      </Typography>
      {summaryText && (
        <Typography
          variant="body2"
          component="span"
          sx={{ color: "text.secondary", ml: 1 }}
        >
          ({summaryText})
        </Typography>
      )}
    </Alert>
  );
};
```

No changes needed to `PortalSession.component.tsx` — the existing `"mutation-result"` block detection works unchanged since the `type` field is the same.

---

## 12. Tool Registration Changes

File: `apps/api/src/services/tools.service.ts`

No changes to tool registration. The same 12 tool classes are instantiated with the same `.build()` signatures. Only the internal input schemas and execute handlers change.

The `PACK_TOOL_NAMES` set remains unchanged — same 12 slugs.

---

## 13. Tool-by-Tool Specification

### 13.1 entity_record_create

| Aspect | Detail |
|--------|--------|
| **Input** | `{ items: [{ connectorEntityId, sourceId?, data }] }` |
| **Scope check** | `assertStationScope` + `assertWriteCapability` per unique `connectorEntityId` |
| **Normalization** | `NormalizationService.normalizeMany()` per unique `connectorEntityId` |
| **Model factory** | `EntityRecordModelFactory.create(userId)` per item, set `origin: "portal"`, `checksum: "manual"`, `syncedAt: Date.now()` |
| **DB operation** | `entityRecords.createMany(parsedModels, tx)` — single statement |
| **Cache update** | `AnalyticsService.applyRecordInsertMany(stationId, entityKey, rows)` per unique entity |
| **Response** | `{ success, operation: "created", entity: "record", count, items: [{ entityId, summary: { entityLabel, sourceId } }] }` |

### 13.2 entity_record_update

| Aspect | Detail |
|--------|--------|
| **Input** | `{ items: [{ connectorEntityId, entityRecordId, data }] }` |
| **Scope check** | `assertStationScope` + `assertWriteCapability` per unique `connectorEntityId` |
| **Existence check** | Load each record by ID, verify it belongs to the claimed `connectorEntityId` |
| **Normalization** | `NormalizationService.normalizeMany()` per unique `connectorEntityId` |
| **DB operation** | `entityRecords.updateMany(payloads, tx)` — loops within transaction |
| **Cache update** | `AnalyticsService.applyRecordUpdateMany(stationId, entityKey, rows)` per unique entity |
| **Response** | `{ success, operation: "updated", entity: "record", count, items: [{ entityId, summary: { entityLabel, fields } }] }` |

### 13.3 entity_record_delete

| Aspect | Detail |
|--------|--------|
| **Input** | `{ items: [{ connectorEntityId, entityRecordId }] }` |
| **Scope check** | `assertStationScope` + `assertWriteCapability` per unique `connectorEntityId` |
| **Existence check** | Load each record by ID, verify it belongs to the claimed `connectorEntityId` |
| **DB operation** | `entityRecords.softDeleteMany(ids, userId, tx)` per unique `connectorEntityId` — single statement |
| **Cache update** | `AnalyticsService.applyRecordDeleteMany(stationId, entityKey, recordIds)` per unique entity |
| **Response** | `{ success, operation: "deleted", entity: "record", count, items: [{ entityId, summary: { entityLabel } }] }` |

### 13.4 column_definition_create

| Aspect | Detail |
|--------|--------|
| **Input** | `{ items: [{ key, label, type, description?, validationPattern?, validationMessage?, canonicalFormat? }] }` |
| **Scope check** | None (organization-level) |
| **Dedup** | Load all org column definitions, build key→def map. Skip upsert for items where key+type match existing. See Section 5. |
| **Within-batch dedup** | Collapse duplicate keys — last occurrence wins |
| **Model factory** | `ColumnDefinitionModelFactory.create(userId)` per new/updated item |
| **DB operation** | Loop `columnDefinitions.upsertByKey(model, tx)` for items that need write |
| **Cache update** | `AnalyticsService.applyColumnDefinitionInsertMany(stationId, rows)` |
| **Response** | `{ success, operation: "created", entity: "column definition", count, reused, created, items: [{ entityId, summary: { key, label, type, status: "reused"|"created" } }] }` |

### 13.5 column_definition_update

| Aspect | Detail |
|--------|--------|
| **Input** | `{ items: [{ columnDefinitionId, label?, description?, validationPattern?, validationMessage?, canonicalFormat? }] }` |
| **Scope check** | Verify each ID exists and `organizationId` matches |
| **DB operation** | Loop `columnDefinitions.update(id, data, tx)` per item |
| **Cache update** | `AnalyticsService.applyColumnDefinitionUpdateMany(stationId, rows)` |
| **Response** | `{ success, operation: "updated", entity: "column definition", count, items: [{ entityId, summary: { label, fields } }] }` |

### 13.6 column_definition_delete

| Aspect | Detail |
|--------|--------|
| **Input** | `{ items: [{ columnDefinitionId }] }` |
| **Scope check** | Verify each ID exists and `organizationId` matches |
| **Dependency check** | `ColumnDefinitionValidationService.validateDelete()` per item — fails if field mappings reference it |
| **DB operation** | Loop `columnDefinitions.softDelete(id, userId, tx)` per item |
| **Cache update** | `AnalyticsService.applyColumnDefinitionDeleteMany(stationId, ids)` |
| **Response** | `{ success, operation: "deleted", entity: "column definition", count, items: [{ entityId, summary: { key, label } }] }` |

### 13.7 field_mapping_create

| Aspect | Detail |
|--------|--------|
| **Input** | `{ items: [{ connectorEntityId, columnDefinitionId, sourceField, isPrimaryKey?, normalizedKey, required?, defaultValue?, format?, enumValues? }] }` |
| **Scope check** | `assertStationScope` + `assertWriteCapability` per unique `connectorEntityId` |
| **Column def check** | Batch-load all referenced `columnDefinitionId`s, verify each exists and belongs to the organization |
| **Model factory** | `FieldMappingModelFactory.create(userId)` per item |
| **DB operation** | Loop `fieldMappings.upsertByEntityAndNormalizedKey(model, tx)` per item |
| **Cache update** | `AnalyticsService.applyFieldMappingInsertMany(stationId, rows)` |
| **Response** | `{ success, operation: "created", entity: "field mapping", count, items: [{ entityId, summary: { sourceField, columnLabel, isPrimaryKey } }] }` |

### 13.8 field_mapping_update

| Aspect | Detail |
|--------|--------|
| **Input** | `{ items: [{ fieldMappingId, sourceField?, isPrimaryKey?, normalizedKey?, required?, defaultValue?, format?, enumValues? }] }` |
| **Scope check** | Load each mapping, verify `organizationId`, then `assertStationScope` + `assertWriteCapability` per unique `connectorEntityId` |
| **DB operation** | Loop `fieldMappings.update(id, data, tx)` per item |
| **Cache update** | `AnalyticsService.applyFieldMappingUpdateMany(stationId, rows)` |
| **Response** | `{ success, operation: "updated", entity: "field mapping", count, items: [{ entityId, summary: { sourceField, fields } }] }` |

### 13.9 field_mapping_delete

| Aspect | Detail |
|--------|--------|
| **Input** | `{ items: [{ fieldMappingId }] }` |
| **Scope check** | Load each mapping, verify `organizationId`, then `assertStationScope` + `assertWriteCapability` per unique `connectorEntityId` |
| **Dependency check** | `FieldMappingValidationService.validateDelete()` per item |
| **DB operation** | Loop `FieldMappingValidationService.executeDelete(id, userId)` per item (sequential, not wrapped in outer transaction — see Section 9 note) |
| **Cache update** | `AnalyticsService.applyFieldMappingDeleteMany(stationId, ids)` |
| **Response** | `{ success, operation: "deleted", entity: "field mapping", count, items: [{ entityId, summary: { sourceField, cascaded } }] }` |

### 13.10 connector_entity_create

| Aspect | Detail |
|--------|--------|
| **Input** | `{ items: [{ connectorInstanceId, key, label }] }` |
| **Scope check** | Load station links once. Verify each `connectorInstanceId` is attached. Load instance + definition, verify write capability — once per unique `connectorInstanceId`. |
| **Model factory** | `ConnectorEntityModelFactory.create(userId)` per item |
| **DB operation** | Loop `connectorEntities.upsertByKey(model, tx)` per item |
| **Cache update** | `AnalyticsService.applyEntityInsertMany(stationId, rows)` |
| **Response** | `{ success, operation: "created", entity: "connector entity", count, items: [{ entityId, summary: { key, label } }] }` |

### 13.11 connector_entity_update

| Aspect | Detail |
|--------|--------|
| **Input** | `{ items: [{ connectorEntityId, label }] }` |
| **Scope check** | `assertStationScope` + `assertWriteCapability` per unique `connectorEntityId` |
| **Existence check** | Verify each entity exists |
| **DB operation** | Loop `connectorEntities.update(id, { label, updated, updatedBy }, tx)` per item |
| **Cache update** | `AnalyticsService.applyEntityUpdateMany(stationId, rows)` |
| **Response** | `{ success, operation: "updated", entity: "connector entity", count, items: [{ entityId, summary: { label } }] }` |

### 13.12 connector_entity_delete

| Aspect | Detail |
|--------|--------|
| **Input** | `{ items: [{ connectorEntityId }] }` |
| **Scope check** | `assertStationScope` per unique `connectorEntityId` |
| **Dependency check** | `ConnectorEntityValidationService.validateDelete()` per item |
| **DB operation** | Loop `ConnectorEntityValidationService.executeDelete(id, userId)` per item (sequential, not wrapped — see Section 9 note) |
| **Cache update** | `AnalyticsService.applyEntityDeleteMany(stationId, entityIds, entityKeys)` |
| **Response** | `{ success, operation: "deleted", entity: "connector entity", count, items: [{ entityId, summary: { label, cascaded } }] }` |

---

## 14. Implementation Phases

| Phase | Scope | Files Modified | Files Added |
|-------|-------|----------------|-------------|
| **1 — Infrastructure** | `normalizeMany`, batch AlaSQL methods, schema extension | `normalization.service.ts`, `analytics.service.ts`, `portal.contract.ts` | — |
| **2 — Entity Record Tools** | Bulk support for create/update/delete | `entity-record-create.tool.ts`, `entity-record-update.tool.ts`, `entity-record-delete.tool.ts` | — |
| **3 — Column Definition Tools** | Bulk support + reuse logic for create, bulk update/delete | `column-definition-create.tool.ts`, `column-definition-update.tool.ts`, `column-definition-delete.tool.ts` | — |
| **4 — Field Mapping Tools** | Bulk support for create/update/delete | `field-mapping-create.tool.ts`, `field-mapping-update.tool.ts`, `field-mapping-delete.tool.ts` | — |
| **5 — Connector Entity Tools** | Bulk support for create/update/delete | `connector-entity-create.tool.ts`, `connector-entity-update.tool.ts`, `connector-entity-delete.tool.ts` | — |
| **6 — Frontend Display** | Bulk-aware MutationResultBlock | `MutationResultBlock.tsx` | — |
| **7 — Tests** | Single-item regression + bulk + validation failure | All 12 tool test files, `MutationResultBlock` test | — |

### Phase Dependencies

```
Phase 1 ──→ Phase 2
         ├─→ Phase 3
         ├─→ Phase 4
         └─→ Phase 5
Phase 1 ──→ Phase 6
Phases 2–6 ─→ Phase 7
```

Phases 2–5 are independent of each other and can be done in parallel after Phase 1. Phase 6 depends only on Phase 1 (schema changes). Phase 7 depends on all prior phases.

---

## 15. Test Plan

Each tool requires three categories of tests:

### 15.1 Single-Item Regression

Verify that passing `{ items: [<single item>] }` produces the same behavior as the current single-item schema. This ensures backward compatibility with LLM prompts that send one item at a time.

### 15.2 Multi-Item Success

- Pass 3–5 items in a single call.
- Verify all items are persisted.
- Verify the response has correct `count` and `items` array.
- Verify AlaSQL cache is updated for all items.

### 15.3 Validation Failure

- Include one invalid item among valid items (e.g., nonexistent `connectorEntityId`, missing required field).
- Verify the response contains `success: false` with `failures` array.
- Verify **no** items were written to the database.
- Verify AlaSQL cache was **not** updated.

### 15.4 Column Definition Reuse (column_definition_create only)

- Pre-create a column definition with `key: "revenue", type: "number"`.
- Call bulk create with `items` including `{ key: "revenue", type: "number", label: "Revenue" }`.
- Verify the existing definition is returned (not duplicated).
- Verify `status: "reused"` in the item summary.

### 15.5 Frontend

- `MutationResultBlock` renders "Created 5 records" when `count: 5`.
- `MutationResultBlock` renders "Created record" when `count: 1` or `count` absent.
- Backward compatibility: existing `entityId`-only responses still render correctly.

---

## 16. Guardrails

| Guardrail | Implementation |
|-----------|---------------|
| Max array size | `.max(100)` on the `items` Zod schema |
| Tool descriptions | Updated to document `1–100 items` capability |
| Token cost | Per-item summaries limited to 2–3 fields; `count` used for LLM reasoning |
| Transaction timeout | Max 100 items bounds the transaction size |
| Within-batch dedup | Column definition create collapses duplicate keys |
| Column definition reuse | Existing definitions matched by key before inserting |

---

## 17. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| LLM sends 100 items with complex data | Medium | Slow transaction | Zod `.max(100)` hard limit; normalization is CPU-bound and fast |
| Cascade delete tools can't share a transaction | Low | Non-atomic bulk delete | Upfront validation catches all failures before any deletes execute |
| Column definition reuse misidentifies a match | Low | Wrong column reused | Match on `key` (unique per org) — deterministic, not heuristic |
| Large `items` array in tool result exhausts context | Medium | LLM loses track | Summaries are minimal; `count` gives the LLM the key number without enumerating |
| Breaking change to single-item callers | Low | Existing prompts break | Single-item calls use `{ items: [<item>] }` — tool descriptions guide the LLM |
