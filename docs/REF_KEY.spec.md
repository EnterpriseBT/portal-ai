# Field Mapping Reference Key Refactor — Specification

> Based on [REF_KEY.audit.md](./REF_KEY.audit.md)

## Summary

Replace `refColumnDefinitionId` and `refBidirectionalFieldMappingId` with a single `refNormalizedKey` field on field mappings. Change the upsert conflict target from `(connectorEntityId, columnDefinitionId)` to `(connectorEntityId, normalizedKey)`. These changes fix two bugs:

1. **Ambiguous references**: `refColumnDefinitionId` cannot distinguish between multiple field mappings that share the same column definition on the target entity.
2. **Upsert overwrites**: the `field_mappings_entity_column_unique` constraint allows only one field mapping per column definition per entity, silently overwriting mappings during upload confirmation.

## Schema Changes

### Before

```
FieldMapping {
  ...
  refColumnDefinitionId: string | null        // FK → column_definitions.id
  refEntityKey: string | null                 // target entity key
  refBidirectionalFieldMappingId: string | null  // self-FK → field_mappings.id
}
```

Constraints:
- `field_mappings_entity_column_unique` on `(connector_entity_id, column_definition_id) WHERE deleted IS NULL`
- `field_mappings_entity_normalized_key_unique` on `(connector_entity_id, normalized_key) WHERE deleted IS NULL`
- FK: `ref_column_definition_id → column_definitions.id`
- FK: `ref_bidirectional_field_mapping_id → field_mappings.id`

### After

```
FieldMapping {
  ...
  refNormalizedKey: string | null    // target field mapping's normalizedKey
  refEntityKey: string | null        // target entity key (unchanged)
}
```

Constraints:
- `field_mappings_entity_normalized_key_unique` on `(connector_entity_id, normalized_key) WHERE deleted IS NULL` (unchanged)
- `field_mappings_entity_column_unique` — **dropped**
- FK `ref_column_definition_id` — **dropped**
- FK `ref_bidirectional_field_mapping_id` — **dropped**

The pair `(refEntityKey, refNormalizedKey)` uniquely identifies the target field mapping because `normalizedKey` is unique per entity.

---

## Phase 1: Database Migration

### 1.1 Migration SQL

Generate via `npm run db:generate -- --name add-ref-normalized-key` after schema changes, or write manually:

```sql
ALTER TABLE field_mappings ADD COLUMN ref_normalized_key TEXT;

-- Backfill: resolve existing refColumnDefinitionId → normalizedKey
-- Only needed if production data has populated ref fields
UPDATE field_mappings fm
SET ref_normalized_key = target.normalized_key
FROM field_mappings target
JOIN connector_entities ce ON target.connector_entity_id = ce.id
WHERE fm.ref_column_definition_id IS NOT NULL
  AND fm.ref_entity_key IS NOT NULL
  AND ce.entity_key = fm.ref_entity_key
  AND target.column_definition_id = fm.ref_column_definition_id
  AND target.deleted IS NULL;

ALTER TABLE field_mappings DROP CONSTRAINT IF EXISTS field_mappings_ref_column_definition_id_column_definitions_id_fk;
ALTER TABLE field_mappings DROP COLUMN ref_column_definition_id;

ALTER TABLE field_mappings DROP CONSTRAINT IF EXISTS field_mappings_ref_bidirectional_field_mapping_id_field_mappings_id_fk;
ALTER TABLE field_mappings DROP COLUMN ref_bidirectional_field_mapping_id;

DROP INDEX IF EXISTS field_mappings_entity_column_unique;
```

### 1.2 Drizzle Table (`apps/api/src/db/schema/field-mappings.table.ts`)

**Remove:**
- `refColumnDefinitionId` column with FK to `columnDefinitions.id` (lines 38-40)
- `refBidirectionalFieldMappingId` column (line 42)
- `field_mappings_entity_column_unique` index (lines 45-47)
- `foreignKey` for `refBidirectionalFieldMappingId` (lines 48-51)

**Add:**
- `refNormalizedKey: text("ref_normalized_key")` (plain text, no FK)

**Result:**

```typescript
export const fieldMappings = pgTable(
  "field_mappings",
  {
    ...baseColumns,
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    connectorEntityId: text("connector_entity_id").notNull().references(() => connectorEntities.id),
    columnDefinitionId: text("column_definition_id").notNull().references(() => columnDefinitions.id),
    sourceField: text("source_field").notNull(),
    isPrimaryKey: boolean("is_primary_key").notNull().default(false),
    normalizedKey: text("normalized_key").notNull(),
    required: boolean("required").notNull().default(false),
    defaultValue: text("default_value"),
    format: text("format"),
    enumValues: jsonb("enum_values").$type<string[]>(),
    refNormalizedKey: text("ref_normalized_key"),
    refEntityKey: text("ref_entity_key"),
  },
  (table) => [
    uniqueIndex("field_mappings_entity_normalized_key_unique")
      .on(table.connectorEntityId, table.normalizedKey)
      .where(sql`deleted IS NULL`),
  ],
);
```

### 1.3 Generated Schemas (`apps/api/src/db/schema/zod.ts`)

No manual changes — `createSelectSchema(fieldMappings)` and `createInsertSchema(fieldMappings)` regenerate automatically from the updated table. The exported `FieldMappingSelect` and `FieldMappingInsert` types will reflect the new columns.

### 1.4 Type Checks (`apps/api/src/db/schema/type-checks.ts`)

No manual changes — the `IsAssignable` checks between `FieldMappingSelect` and `FieldMapping` (core model) will fail at compile time until both sides match. This is the intended enforcement mechanism.

---

## Phase 2: Core Model & Contracts (`packages/core`)

### 2.1 Field Mapping Model (`packages/core/src/models/field-mapping.model.ts`)

**Replace** (lines 26-29):

```typescript
// Before
refColumnDefinitionId: z.string().nullable(),
refEntityKey: z.string().nullable(),
refBidirectionalFieldMappingId: z.string().nullable(),

// After
refNormalizedKey: z.string().nullable(),
refEntityKey: z.string().nullable(),
```

Update the comment on line 26 to reflect the new field:

```typescript
// Reference fields (populated when the mapped column has type "reference" or "reference-array")
refNormalizedKey: z.string().nullable(),
refEntityKey: z.string().nullable(),
```

### 2.2 Field Mapping Contract (`packages/core/src/contracts/field-mapping.contract.ts`)

#### Create Request (lines 69-71)

```typescript
// Before
refColumnDefinitionId: nullableString.optional().default(null),
refEntityKey: nullableString.optional().default(null),
refBidirectionalFieldMappingId: nullableString.optional().default(null),

// After
refNormalizedKey: nullableString.optional().default(null),
refEntityKey: nullableString.optional().default(null),
```

#### Update Request (lines 93-95)

```typescript
// Before
refColumnDefinitionId: nullableString.optional(),
refEntityKey: nullableString.optional(),
refBidirectionalFieldMappingId: nullableString.optional(),

// After
refNormalizedKey: nullableString.optional(),
refEntityKey: nullableString.optional(),
```

#### Delete Response (lines 108-116)

Remove `bidirectionalCleared` from the cascaded result. The delete response should report whether counterpart ref fields were cleared, but the field name and logic change:

```typescript
// Before
cascaded: z.object({
  entityGroupMembers: z.number(),
  bidirectionalCleared: z.boolean(),
}),

// After
cascaded: z.object({
  entityGroupMembers: z.number(),
  counterpartCleared: z.boolean(),
}),
```

#### Impact Response (lines 120-131)

The `bidirectionalCounterpart` field stays structurally the same but rename for consistency:

```typescript
// Before
bidirectionalCounterpart: z.object({
  id: z.string(),
  sourceField: z.string(),
}).nullable(),

// After
counterpart: z.object({
  id: z.string(),
  sourceField: z.string(),
  normalizedKey: z.string(),
}).nullable(),
```

Add `normalizedKey` to the counterpart shape — it's useful for the frontend to display which specific field mapping is the counterpart.

#### Bidirectional Validation Response (lines 135-142)

No schema changes. The endpoint still returns `isConsistent`, `inconsistentRecordIds`, `totalChecked`, and `reason`. Only the internal resolution logic changes.

### 2.3 Upload Contract (`packages/core/src/contracts/upload.contract.ts`)

#### ConfirmColumnSchema (lines 49-62)

```typescript
// Before
refEntityKey: z.string().nullable().optional(),
refColumnKey: z.string().nullable().optional(),
refColumnDefinitionId: z.string().nullable().optional(),

// After
refEntityKey: z.string().nullable().optional(),
refNormalizedKey: z.string().nullable().optional(),
```

Two fields (`refColumnKey`, `refColumnDefinitionId`) collapse into one (`refNormalizedKey`).

---

## Phase 3: Repository Layer (`apps/api`)

### 3.1 Rename Upsert Method (`apps/api/src/db/repositories/field-mappings.repository.ts`)

Rename `upsertByEntityAndColumn` → `upsertByEntityAndNormalizedKey`. Change conflict target from `(connectorEntityId, columnDefinitionId)` to `(connectorEntityId, normalizedKey)`.

```typescript
async upsertByEntityAndNormalizedKey(
  data: FieldMappingInsert,
  client: DbClient = db
): Promise<FieldMappingSelect> {
  const [row] = await (client as typeof db)
    .insert(this.table)
    .values(data as never)
    .onConflictDoUpdate({
      target: [
        fieldMappings.connectorEntityId,
        fieldMappings.normalizedKey,
      ] as IndexColumn[],
      targetWhere: isNull(fieldMappings.deleted),
      set: {
        sourceField: data.sourceField,
        isPrimaryKey: data.isPrimaryKey,
        columnDefinitionId: data.columnDefinitionId,
        required: data.required,
        defaultValue: data.defaultValue,
        format: data.format,
        enumValues: data.enumValues,
        refNormalizedKey: data.refNormalizedKey,
        refEntityKey: data.refEntityKey,
        updated: data.updated ?? Date.now(),
        updatedBy: data.updatedBy,
      } as never,
    })
    .returning();
  return row as FieldMappingSelect;
}
```

Key differences:
- `normalizedKey` moves to conflict target (not in `set`)
- `columnDefinitionId` moves to `set` (updatable — user can re-map to a different column definition)
- `refBidirectionalFieldMappingId` removed from `set`
- `refColumnDefinitionId` replaced with `refNormalizedKey`

### 3.2 Remove Methods

Remove these methods (no longer needed):
- `findByRefColumnDefinitionId(columnDefinitionId)` — was used by column-definition-validation
- `countByRefColumnDefinitionId(columnDefinitionId)` — was used by column-definition-validation

### 3.3 Add Counterpart Resolution Method

```typescript
/**
 * Find the bidirectional counterpart of a field mapping.
 * Given mapping A on entity X with refEntityKey="Y" and refNormalizedKey="y_id",
 * finds the field mapping on entity Y with normalizedKey="y_id" whose own
 * refEntityKey points back to entity X.
 */
async findCounterpart(
  organizationId: string,
  entityKey: string,
  refEntityKey: string,
  refNormalizedKey: string,
  client: DbClient = db
): Promise<FieldMappingSelect | null> {
  const rows = await (client as typeof db)
    .select({ fieldMapping: getTableColumns(fieldMappings) })
    .from(fieldMappings)
    .innerJoin(
      connectorEntities,
      eq(fieldMappings.connectorEntityId, connectorEntities.id)
    )
    .where(
      and(
        eq(connectorEntities.entityKey, refEntityKey),
        eq(connectorEntities.organizationId, organizationId),
        eq(fieldMappings.normalizedKey, refNormalizedKey),
        eq(fieldMappings.refEntityKey, entityKey),
        this.notDeleted(),
      )
    );
  return (rows[0]?.fieldMapping as FieldMappingSelect) ?? null;
}
```

### 3.4 Update `findBidirectionalPair`

Replace the current implementation that uses `refBidirectionalFieldMappingId` with one that calls `findCounterpart`:

```typescript
async findBidirectionalPair(
  fieldMappingId: string,
  client: DbClient = db
): Promise<{ mapping: FieldMappingSelect; counterpart: FieldMappingSelect | null }> {
  const mapping = await this.findById(fieldMappingId, client);
  if (!mapping || !mapping.refEntityKey || !mapping.refNormalizedKey) {
    return { mapping: mapping as FieldMappingSelect, counterpart: null };
  }

  // Resolve the entity key of this mapping's entity
  const entity = await db
    .select()
    .from(connectorEntities)
    .where(eq(connectorEntities.id, mapping.connectorEntityId));

  if (!entity[0]) {
    return { mapping, counterpart: null };
  }

  const counterpart = await this.findCounterpart(
    mapping.organizationId,
    entity[0].entityKey,
    mapping.refEntityKey,
    mapping.refNormalizedKey,
    client
  );
  return { mapping, counterpart };
}
```

### 3.5 Update `findByRefEntityKey` / `countByRefEntityKey`

These methods remain but no longer need to coordinate with `refBidirectionalFieldMappingId`. Review their usage and simplify if needed.

---

## Phase 4: Service Layer (`apps/api`)

### 4.1 Uploads Service (`apps/api/src/services/uploads.service.ts`)

#### Remove `resolveRefColumnDefinitionId()` (lines 341-352)

Delete the entire private static method. No longer needed — `refNormalizedKey` is stored directly.

#### Update stale-mapping cleanup (lines 260-265)

```typescript
// Before
const staleIds = existingMappings
  .filter((fm) => !incomingColDefIds.includes(fm.columnDefinitionId))
  .map((fm) => fm.id);

// After
const incomingNormalizedKeys = new Set(entity.columns.map((c) => c.normalizedKey));
const staleIds = existingMappings
  .filter((fm) => !incomingNormalizedKeys.has(fm.normalizedKey))
  .map((fm) => fm.id);
```

Also remove the `incomingColDefIds` set construction that precedes this block.

#### Update reference resolution (lines 274-284)

```typescript
// Before
const hasRefFields = !!(col.refColumnKey || col.refColumnDefinitionId)
  || colDef!.type === "reference" || colDef!.type === "reference-array";
const refColumnDefinitionId = hasRefFields
  ? await UploadsService.resolveRefColumnDefinitionId(
    organizationId, col.refColumnKey, col.refColumnDefinitionId, tx
  )
  : null;

// After
const hasRefFields = !!col.refNormalizedKey
  || colDef!.type === "reference" || colDef!.type === "reference-array";
```

#### Update upsert call (lines 287-310)

```typescript
// Before
const fieldMapping = await DbService.repository.fieldMappings.upsertByEntityAndColumn({
  ...
  refColumnDefinitionId: refColumnDefinitionId ?? null,
  refEntityKey: hasRefFields ? (col.refEntityKey ?? null) : null,
  ...
}, tx);

// After
const fieldMapping = await DbService.repository.fieldMappings.upsertByEntityAndNormalizedKey({
  ...
  refNormalizedKey: hasRefFields ? (col.refNormalizedKey ?? null) : null,
  refEntityKey: hasRefFields ? (col.refEntityKey ?? null) : null,
  ...
}, tx);
```

Note: the upsert data object no longer includes `refBidirectionalFieldMappingId`.

### 4.2 Column Definition Validation (`apps/api/src/services/column-definition-validation.service.ts`)

#### Update `validateDelete` (lines 31-51)

Remove the `findByRefColumnDefinitionId` check. Column definitions are no longer referenced by field mapping ref fields — only by `columnDefinitionId` (the direct mapping).

```typescript
// Before
const [depsByColumn, depsByRef] = await Promise.all([
  DbService.repository.fieldMappings.findByColumnDefinitionId(columnDefinitionId),
  DbService.repository.fieldMappings.findByRefColumnDefinitionId(columnDefinitionId),
]);

if (depsByColumn.length > 0 || depsByRef.length > 0) { ... }

// After
const depsByColumn = await DbService.repository.fieldMappings.findByColumnDefinitionId(columnDefinitionId);

if (depsByColumn.length > 0) { ... }
```

Remove `refFieldMappings` from the error detail object.

### 4.3 Field Mapping Validation (`apps/api/src/services/field-mapping-validation.service.ts`)

#### Update `FieldMappingCascadeResult` (lines 12-15)

```typescript
// Before
export interface FieldMappingCascadeResult {
  cascadedEntityGroupMembers: number;
  bidirectionalCleared: boolean;
}

// After
export interface FieldMappingCascadeResult {
  cascadedEntityGroupMembers: number;
  counterpartCleared: boolean;
}
```

#### Update `executeDelete` cascade logic (lines 167-179)

Replace the direct ID lookup with counterpart resolution:

```typescript
// Before
let bidirectionalCleared = false;
if (mapping.refBidirectionalFieldMappingId) {
  await DbService.repository.fieldMappings.updateWhere(
    eq(fieldMappings.id, mapping.refBidirectionalFieldMappingId),
    {
      refBidirectionalFieldMappingId: null,
      updated: Date.now(),
      updatedBy: userId,
    } as never,
    tx,
  );
  bidirectionalCleared = true;
}

// After
let counterpartCleared = false;
if (mapping.refEntityKey && mapping.refNormalizedKey) {
  // Resolve this mapping's entity key
  const entity = await DbService.repository.connectorEntities.findById(
    mapping.connectorEntityId, tx
  );
  if (entity) {
    const counterpart = await DbService.repository.fieldMappings.findCounterpart(
      mapping.organizationId,
      entity.entityKey,
      mapping.refEntityKey,
      mapping.refNormalizedKey,
      tx
    );
    if (counterpart) {
      await DbService.repository.fieldMappings.updateWhere(
        eq(fieldMappings.id, counterpart.id),
        {
          refNormalizedKey: null,
          refEntityKey: null,
          updated: Date.now(),
          updatedBy: userId,
        } as never,
        tx,
      );
      counterpartCleared = true;
    }
  }
}
```

---

## Phase 5: Router Layer (`apps/api`)

### 5.1 Field Mapping Router (`apps/api/src/routes/field-mapping.router.ts`)

#### POST create (lines 365-368)

```typescript
// Before
refColumnDefinitionId: parsed.data.refColumnDefinitionId,
refEntityKey: parsed.data.refEntityKey,
refBidirectionalFieldMappingId: parsed.data.refBidirectionalFieldMappingId,

// After
refNormalizedKey: parsed.data.refNormalizedKey,
refEntityKey: parsed.data.refEntityKey,
```

#### PATCH update (line 528)

The update endpoint spreads `parsed.data` into the update object. Since the contract schema changes, this works automatically — just verify that `refBidirectionalFieldMappingId` is no longer in the parsed data.

#### GET impact (lines 631-642)

Replace direct ID lookup with counterpart resolution:

```typescript
// Before
let bidirectionalCounterpart = null;
if (existing.refBidirectionalFieldMappingId) {
  const counterpart = await DbService.repository.fieldMappings.findById(
    existing.refBidirectionalFieldMappingId
  );
  ...
}

// After
let counterpart = null;
if (existing.refEntityKey && existing.refNormalizedKey) {
  const entity = await DbService.repository.connectorEntities.findById(
    existing.connectorEntityId
  );
  if (entity) {
    const found = await DbService.repository.fieldMappings.findCounterpart(
      existing.organizationId,
      entity.entityKey,
      existing.refEntityKey,
      existing.refNormalizedKey
    );
    if (found) {
      counterpart = {
        id: found.id,
        sourceField: found.sourceField,
        normalizedKey: found.normalizedKey,
      };
    }
  }
}
```

Update response to use `counterpart` instead of `bidirectionalCounterpart`.

#### GET validate-bidirectional (lines 783-874)

**Line 803**: Change guard condition:

```typescript
// Before
if (!mapping.refBidirectionalFieldMappingId) {

// After
if (!mapping.refEntityKey || !mapping.refNormalizedKey) {
```

**Line 813**: Replace `findBidirectionalPair` with updated version that uses counterpart resolution (see Phase 3.4).

**Lines 824-825**: The column definition keys used for array lookup (`keyA`, `keyB`) currently come from `columnDef.key` and `counterpartColumnDef.key`. These should change to use the field mapping's `normalizedKey` instead, since that's the key used in `normalizedData`:

```typescript
// Before
const keyA = columnDef.key;
const keyB = counterpartColumnDef.key;

// After
const keyA = mapping.normalizedKey;
const keyB = counterpart.normalizedKey;
```

### 5.2 API Error Codes (`apps/api/src/constants/api-codes.constants.ts`)

Keep both error codes — they still apply:
- `FIELD_MAPPING_BIDIRECTIONAL_VALIDATION_FAILED` — validation endpoint errors
- `FIELD_MAPPING_BIDIRECTIONAL_TARGET_NOT_FOUND` — counterpart not found

Optionally rename to `FIELD_MAPPING_COUNTERPART_*` for consistency, but this is cosmetic.

### 5.3 Swagger Config (`apps/api/src/config/swagger.config.ts`)

Update the FieldMapping schema definition (lines 691-693):

```typescript
// Before
refColumnDefinitionId: { type: "string", nullable: true },
refEntityKey: { type: "string", nullable: true },
refBidirectionalFieldMappingId: { type: "string", nullable: true },

// After
refNormalizedKey: { type: "string", nullable: true },
refEntityKey: { type: "string", nullable: true },
```

Update all request/response schemas that reference these fields.

---

## Phase 6: Frontend (`apps/web`)

### 6.1 Upload Workflow Util (`apps/web/src/workflows/CSVConnector/utils/upload-workflow.util.ts`)

#### `RecommendedColumn` interface

```typescript
// Before
refEntityKey?: string | null;
refColumnKey?: string | null;
refColumnDefinitionId?: string | null;

// After
refEntityKey?: string | null;
refNormalizedKey?: string | null;
```

#### `RecommendedColumnUpdate` type

Update to include `refNormalizedKey` instead of `refColumnKey` and `refColumnDefinitionId`.

#### `confirm()` payload construction

```typescript
// Before
refEntityKey: col.refEntityKey ?? null,
refColumnKey: col.refColumnKey ?? null,
refColumnDefinitionId: col.refColumnDefinitionId ?? null,

// After
refEntityKey: col.refEntityKey ?? null,
refNormalizedKey: col.refNormalizedKey ?? null,
```

### 6.2 Column Mapping Step (`apps/web/src/workflows/CSVConnector/ColumnMappingStep.component.tsx`)

#### `deriveEntitySelectValue` (lines 93-109)

```typescript
// Before
function deriveEntitySelectValue(column, allEntities, dbEntities): string {
  const { refEntityKey, refColumnKey, refColumnDefinitionId } = column;
  if (!refEntityKey) return "";
  if (refColumnDefinitionId) return `db:${refEntityKey}`;
  if (refColumnKey) return `batch:${refEntityKey}`;
  ...
}

// After
function deriveEntitySelectValue(column, allEntities, dbEntities): string {
  const { refEntityKey, refNormalizedKey } = column;
  if (!refEntityKey) return "";
  if (!refNormalizedKey) return "";
  const inBatch = allEntities.some((e) => e.connectorEntity.key === refEntityKey);
  if (inBatch) return `batch:${refEntityKey}`;
  const inDb = dbEntities.some((e) => e.key === refEntityKey);
  if (inDb) return `db:${refEntityKey}`;
  return `batch:${refEntityKey}`;
}
```

#### DB mode column options (lines 153-163)

```typescript
// Before
columnOptions = selectedDbEntity
  ? selectedDbEntity.fieldMappings
      .filter((fm) => fm.columnDefinition !== null)
      .map((fm) => ({
        value: fm.columnDefinition!.id,
        label: `${fm.columnDefinition!.label} (${fm.columnDefinition!.key})`,
      }))
  : [];

// After
columnOptions = selectedDbEntity
  ? selectedDbEntity.fieldMappings
      .map((fm) => ({
        value: fm.normalizedKey,
        label: `${fm.normalizedKey} (${fm.sourceField})`,
      }))
  : [];
```

#### `currentColumnValue` (lines 166-168)

```typescript
// Before
const currentColumnValue = isDbMode
  ? (column.refColumnDefinitionId ?? "")
  : (column.refColumnKey ?? "");

// After
const currentColumnValue = column.refNormalizedKey ?? "";
```

#### `handleEntityChange` (lines 170-187)

```typescript
// Before
onUpdate(entityIndex, columnIndex, {
  refEntityKey: null,
  refColumnKey: null,
  refColumnDefinitionId: null,
});
// ...
onUpdate(entityIndex, columnIndex, {
  refEntityKey: entityKey,
  refColumnKey: null,
  refColumnDefinitionId: null,
});

// After
onUpdate(entityIndex, columnIndex, {
  refEntityKey: null,
  refNormalizedKey: null,
});
// ...
onUpdate(entityIndex, columnIndex, {
  refEntityKey: entityKey,
  refNormalizedKey: null,
});
```

#### `handleColumnChange` (lines 189-202)

```typescript
// Before
const handleColumnChange = (e) => {
  const val = e.target.value || null;
  if (isDbMode) {
    onUpdate(entityIndex, columnIndex, {
      refColumnKey: null,
      refColumnDefinitionId: val,
    });
  } else {
    onUpdate(entityIndex, columnIndex, {
      refColumnKey: val,
      refColumnDefinitionId: null,
    });
  }
};

// After
const handleColumnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const val = e.target.value || null;
  onUpdate(entityIndex, columnIndex, { refNormalizedKey: val });
};
```

### 6.3 Review Step (`apps/web/src/workflows/CSVConnector/ReviewStep.component.tsx`)

Update `formatRefTarget` helper (lines 111-122) to use `refNormalizedKey` instead of `refColumnKey`:

```typescript
// Before
if (col.refEntityKey && col.refColumnKey) {
  return `→ ${col.refEntityKey}.${col.refColumnKey}`;
}

// After
if (col.refEntityKey && col.refNormalizedKey) {
  return `→ ${col.refEntityKey}.${col.refNormalizedKey}`;
}
```

### 6.4 Create Field Mapping Dialog (`apps/web/src/components/CreateFieldMappingDialog.component.tsx`)

#### Form validation schema (lines 33-35)

```typescript
// Before
refColumnDefinitionId: z.string().nullable(),
refEntityKey: z.string().nullable(),
refBidirectionalFieldMappingId: z.string().nullable(),

// After
refNormalizedKey: z.string().nullable(),
refEntityKey: z.string().nullable(),
```

#### Form state interface (lines 48-50)

```typescript
// Before
refColumnDefinitionId: string | null;
refEntityKey: string | null;
refBidirectionalFieldMappingId: string | null;

// After
refNormalizedKey: string | null;
refEntityKey: string | null;
```

#### Initial form state

```typescript
// Before
refColumnDefinitionId: null,
refEntityKey: null,
refBidirectionalFieldMappingId: null,

// After
refNormalizedKey: null,
refEntityKey: null,
```

#### Submit handler (lines 181-183)

```typescript
// Before
refColumnDefinitionId: form.refColumnDefinitionId,
refEntityKey: form.refEntityKey,
refBidirectionalFieldMappingId: form.refBidirectionalFieldMappingId,

// After
refNormalizedKey: form.refNormalizedKey,
refEntityKey: form.refEntityKey,
```

#### Reference type UI (lines 294-315)

Currently renders three selects: entity, column definition, and bidirectional mapping. Change to two selects: entity and normalizedKey. Remove the `onSearchFieldMappings` prop (was used for bidirectional pairing).

The entity select (`onSearchConnectorEntitiesForRefKey`) stays. The column select changes from searching column definitions to showing field mappings on the selected entity — similar to how DB mode works in ColumnMappingStep.

### 6.5 Edit Field Mapping Dialog (`apps/web/src/components/EditFieldMappingDialog.component.tsx`)

Same changes as Create dialog:
- Form schema: replace three ref fields with two
- Form state: same
- Initial values from `fieldMapping` prop (lines 123-125): map old fields to new
- Submit handler (lines 168-170): same as create
- Reference type UI (lines 321-341): same simplification

### 6.6 Column Definition Detail View (`apps/web/src/views/ColumnDefinitionDetail.view.tsx`)

#### Remove `onSearchFieldMappings` (lines 113-115)

The `sdk.fieldMappings.searchWithEntity()` call was used to populate the bidirectional field mapping select. Remove it.

#### Update dialog props (lines 306-307, 341-342)

Remove `onSearchFieldMappings` prop passed to Create and Edit dialogs.

#### Update default field mapping values (lines 334-336)

```typescript
// Before
refColumnDefinitionId: null,
refEntityKey: null,
refBidirectionalFieldMappingId: null,

// After
refNormalizedKey: null,
refEntityKey: null,
```

---

## Phase 7: AI Tool (`apps/api`)

### 7.1 Field Mapping Create Tool (`apps/api/src/tools/field-mapping-create.tool.ts`)

Update hardcoded null ref fields (lines 57-59):

```typescript
// Before
refColumnDefinitionId: null,
refEntityKey: null,
refBidirectionalFieldMappingId: null,

// After
refNormalizedKey: null,
refEntityKey: null,
```

The tool's `InputSchema` (lines 10-20) does not include ref fields — no change needed there.

---

## Phase 8: Tests

### 8.1 Unit Tests

| Test File | Changes |
|-----------|---------|
| `packages/core/src/__tests__/models/field-mapping.model.test.ts` | Update test fixtures: replace `refColumnDefinitionId` and `refBidirectionalFieldMappingId` with `refNormalizedKey` |
| `packages/core/src/__tests__/contracts/field-mapping.contract.test.ts` | Update contract validation tests for new field names |
| `packages/core/src/__tests__/contracts/upload.contract.test.ts` | Update `ConfirmColumnSchema` tests: replace `refColumnKey`/`refColumnDefinitionId` with `refNormalizedKey` |
| `apps/api/src/__tests__/services/uploads.service.test.ts` | Remove `resolveRefColumnDefinitionId` tests; update confirm fixtures to use `refNormalizedKey`; update stale-mapping assertions |
| `apps/api/src/__tests__/services/column-definition-validation.service.test.ts` | Remove `findByRefColumnDefinitionId` assertions |
| `apps/web/src/workflows/CSVConnector/__tests__/upload-workflow.test.ts` | Replace `refColumnKey`/`refColumnDefinitionId` with `refNormalizedKey` in `updateColumn` and `confirm()` tests |
| `apps/web/src/workflows/CSVConnector/__tests__/ColumnMappingStep.test.tsx` | Update ReferenceEditor tests for unified column value |
| `apps/web/src/workflows/CSVConnector/__tests__/ReviewStep.test.tsx` | Update ref display assertions |
| `apps/web/src/__tests__/CreateFieldMappingDialog.test.tsx` | Update form state and submission assertions |
| `apps/web/src/__tests__/EditFieldMappingDialog.test.tsx` | Update form state and submission assertions |
| `apps/web/src/__tests__/ColumnDefinitionDetailView.test.tsx` | Remove `onSearchFieldMappings` prop assertions |

### 8.2 Integration Tests

| Test File | Changes |
|-----------|---------|
| `apps/api/src/__tests__/__integration__/routes/uploads.router.integration.test.ts` | Update confirm payloads and field mapping assertions |
| `apps/api/src/__tests__/__integration__/db/repositories/field-mappings.repository.integration.test.ts` | Update upsert tests, add `findCounterpart` tests, remove `findByRefColumnDefinitionId` tests |
| `apps/api/src/__tests__/__integration__/routes/field-mapping.router.integration.test.ts` | Update create/update/impact/validate-bidirectional tests |
| `apps/api/src/__tests__/__integration__/routes/column-definition.router.integration.test.ts` | Update delete validation tests (no ref dependency check) |
| `apps/api/src/__tests__/__integration__/db/repositories/entity-group-members.repository.integration.test.ts` | Update field mapping fixtures |
| `apps/api/src/__tests__/__integration__/db/repositories/entity-groups.repository.integration.test.ts` | Update field mapping fixtures |
| `apps/api/src/__tests__/__integration__/db/repositories/connector-entities.repository.integration.test.ts` | Update field mapping fixtures |
| `apps/api/src/__tests__/__integration__/routes/connector-instance.router.integration.test.ts` | Update field mapping fixtures |
| `apps/api/src/__tests__/__integration__/routes/entity-group.router.integration.test.ts` | Update field mapping fixtures |
| `apps/api/src/__tests__/__integration__/routes/entity-group-member.router.integration.test.ts` | Update field mapping fixtures |
| `apps/api/src/__tests__/__integration__/tools/entity-management.integration.test.ts` | Update field mapping fixtures |

---

## Implementation Order

Execute phases in dependency order:

1. **Phase 2** — Core model & contracts (establishes the new type shape)
2. **Phase 1** — Database migration & table schema (aligns DB with new types; compile-time checks in type-checks.ts will pass)
3. **Phase 3** — Repository layer (new methods, renamed upsert)
4. **Phase 4** — Service layer (uploads, validation)
5. **Phase 5** — Router layer (endpoints, swagger)
6. **Phase 6** — Frontend (upload workflow, dialogs, views)
7. **Phase 7** — AI tool
8. **Phase 8** — Tests (update throughout, run after each phase)

Run `npm run type-check` after phases 1-2 to verify model ↔ DB alignment. Run `npm run test` after each subsequent phase.

---

## Verification Checklist

- [ ] `npm run type-check` passes (model ↔ Drizzle alignment)
- [ ] `npm run db:generate -- --name add-ref-normalized-key` produces expected migration
- [ ] `npm run db:migrate` applies cleanly
- [ ] `npm run test` passes all unit tests
- [ ] Integration tests pass for upload confirm with `reference` column type
- [ ] Integration tests pass for upload confirm with `reference-array` column type
- [ ] Integration tests pass for field mapping create/update with ref fields
- [ ] Integration tests pass for field mapping delete with counterpart clearing
- [ ] Integration tests pass for bidirectional validation endpoint
- [ ] Integration tests pass for column definition delete (no ref dependency check)
- [ ] Frontend: batch mode reference selection works in ColumnMappingStep
- [ ] Frontend: DB mode reference selection shows normalizedKey (not column def ID)
- [ ] Frontend: two field mappings sharing a column definition appear as distinct dropdown entries
- [ ] `npm run build` succeeds across all packages
- [ ] `npm run lint` passes
