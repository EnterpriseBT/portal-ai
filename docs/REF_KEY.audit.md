# Reference Key Audit: `refColumnDefinitionId` → `refNormalizedKey`

## Problem

Field mappings currently store `refColumnDefinitionId` to identify the target of a `reference` or `reference-array` relationship. This is **ambiguous** when multiple field mappings on the target entity share the same column definition.

### Example: `reference` (foreign key)

Account has an `owner_id` field mapping whose column definition type is `reference` — it stores a single foreign key pointing to a record on the User entity.

User has two field mappings — `user_id` and `employee_id` — both mapped to the same column definition `string_id`.

**Current (ambiguous):**

| Entity | Field Mapping | Column Def | refEntityKey | refColumnDefinitionId |
|--------|--------------|------------|--------------|----------------------|
| Account | `owner_id` | `reference` | `"user"` | `<string_id UUID>` |

The system cannot determine whether `owner_id` references `user_id` or `employee_id` on the User entity — both share the same column definition ID.

**Proposed (unambiguous):**

| Entity | Field Mapping | Column Def | refEntityKey | refNormalizedKey |
|--------|--------------|------------|--------------|-----------------|
| Account | `owner_id` | `reference` | `"user"` | `"user_id"` |

`owner_id` now explicitly targets the `user_id` field mapping. No counterpart is needed — `reference` is unidirectional. The User entity's `user_id` mapping has no ref fields pointing back to Account.

### Example: `reference-array` (many-to-many)

Class has an `enrolled_student_ids` field mapping whose column definition type is `reference-array` — it stores an array of Student record IDs. Student has a `class_ids` field mapping (also `reference-array`) storing an array of Class record IDs. These form a bidirectional many-to-many relationship.

**Current (ambiguous + redundant):**

| Entity | Field Mapping | Column Def | refEntityKey | refColumnDefinitionId | refBidirectionalFieldMappingId |
|--------|--------------|------------|--------------|----------------------|-------------------------------|
| Class | `enrolled_student_ids` | `reference-array` | `"student"` | `<string_id UUID>` | `<class_ids FM UUID>` |
| Student | `class_ids` | `reference-array` | `"class"` | `<string_id UUID>` | `<enrolled_student_ids FM UUID>` |

The `refColumnDefinitionId` is ambiguous (Student may have multiple `string_id` mappings), and the bidirectional IDs must be kept in sync on both sides — set on create, cleared on delete.

**Proposed (unambiguous, no explicit link):**

| Entity | Field Mapping | Column Def | refEntityKey | refNormalizedKey |
|--------|--------------|------------|--------------|-----------------|
| Class | `enrolled_student_ids` | `reference-array` | `"student"` | `"student_id"` |
| Student | `class_ids` | `reference-array` | `"class"` | `"class_id"` |

Each side declares the target entity and the specific field mapping it references. The bidirectional relationship is **implicit** — the system discovers the counterpart by querying for the field mapping on the target entity whose own `(refEntityKey, refNormalizedKey)` points back. No explicit ID link to maintain.

### Counterpart discovery for `reference-array`

Given the Class mapping `enrolled_student_ids` with `refEntityKey="student"`, `refNormalizedKey="student_id"`:

1. Find the target: field mapping on entity `"student"` with `normalizedKey = "student_id"`
2. Check if it points back: its `refEntityKey = "class"` matches the Class entity
3. If yes → bidirectional pair confirmed. If no → unidirectional (no counterpart).

This replaces the explicit `refBidirectionalFieldMappingId` lookup in all three current use cases (delete cascade, impact assessment, bidirectional validation).

## Current Schema

```
FieldMapping {
  refEntityKey: string | null            // target entity key (e.g. "user")
  refColumnDefinitionId: string | null   // target column definition ID — AMBIGUOUS
  refBidirectionalFieldMappingId: string | null  // counterpart field mapping ID (reference-array only)
}
```

The upload contract (`ConfirmColumnSchema`) sends both `refColumnKey` (a column definition key) and `refColumnDefinitionId`. The backend resolves `refColumnKey` → `refColumnDefinitionId` via `UploadsService.resolveRefColumnDefinitionId()`. Both suffer the same ambiguity — they identify a column definition, not a specific field mapping.

## Proposed Fix

Replace `refColumnDefinitionId` with `refNormalizedKey` — the `normalizedKey` of the target **field mapping**. The pair `(refEntityKey, refNormalizedKey)` uniquely identifies the target field mapping because `normalizedKey` is unique per entity (enforced by `field_mappings_entity_normalized_key_unique` constraint).

### New Schema

```
FieldMapping {
  refEntityKey: string | null        // target entity key (e.g. "user")
  refNormalizedKey: string | null    // target field mapping normalizedKey (e.g. "user_id") — UNAMBIGUOUS
}
```

`refBidirectionalFieldMappingId` is **removed** — see analysis below.

### `refBidirectionalFieldMappingId` is redundant

The explicit bidirectional ID is currently used for three operations:

| Operation | Current approach | New approach with `(refEntityKey, refNormalizedKey)` |
|-----------|-----------------|------------------------------------------------------|
| **Delete cascade** — when deleting mapping A, clear the back-pointer on mapping B | Look up mapping B by `refBidirectionalFieldMappingId`, set its `refBidirectionalFieldMappingId = null` | Query for the counterpart: find the field mapping on entity `refEntityKey` with `normalizedKey = refNormalizedKey` whose own `(refEntityKey, refNormalizedKey)` points back to mapping A's entity + normalizedKey. Clear its ref fields. |
| **Impact assessment** — show counterpart before delete | `findById(refBidirectionalFieldMappingId)` | Same counterpart query as above |
| **Bidirectional validation** — check array consistency | `findBidirectionalPair(id)` uses the stored ID | Resolve counterpart by `(refEntityKey, refNormalizedKey)` then validate arrays |

In every case, the counterpart is **derivable** from the two-field pair. The explicit ID stored an optimization shortcut, but it introduced a maintenance burden (keeping both sides in sync on create, clearing on delete) and a third nullable column to manage.

#### Counterpart resolution query

```sql
-- Given mapping A on entity "account" with refEntityKey="user", refNormalizedKey="user_id":
SELECT fm.*
FROM field_mappings fm
JOIN connector_entities ce ON fm.connector_entity_id = ce.id
WHERE ce.entity_key = 'user'              -- A's refEntityKey
  AND fm.normalized_key = 'user_id'       -- A's refNormalizedKey
  AND fm.ref_entity_key = 'account'       -- points back to A's entity
  AND fm.deleted IS NULL
```

This can be encapsulated in a single repository method (`findCounterpart(entityKey, refEntityKey, refNormalizedKey)`).

### Benefits

- **Unambiguous**: directly identifies the specific field mapping, not a shared column definition
- **Simpler schema**: two fields instead of three; no self-referential FK to manage
- **Simpler upload flow**: `ConfirmColumnSchema.refColumnKey` already carries a key-like value — rename to `refNormalizedKey` and store directly, eliminating `resolveRefColumnDefinitionId()` entirely
- **No sync burden**: bidirectional pairs no longer need explicit ID linking on create or clearing on delete — the relationship is implicit from the ref fields on both sides
- **Human-readable**: `refNormalizedKey: "user_id"` is more meaningful than a UUID

### Trade-offs

- `refNormalizedKey` is a logical reference (not a FK) — if the target field mapping's `normalizedKey` is renamed, `refNormalizedKey` on referencing mappings becomes stale. This must be handled with a cascade update in the normalizedKey rename flow.
- Counterpart resolution requires a join through `connector_entities` instead of a direct ID lookup. This is negligible for single-record operations but worth noting.
- Requires a data migration to resolve existing `refColumnDefinitionId` values into their corresponding `normalizedKey` values (only relevant if production data exists with populated `refColumnDefinitionId`).

## Upsert Key: `(entityId, columnDefinitionId)` → `(entityId, normalizedKey)`

### Problem

`upsertByEntityAndColumn()` uses `onConflictDoUpdate` targeting the `field_mappings_entity_column_unique` index on `(connectorEntityId, columnDefinitionId)`. This means only **one field mapping per column definition per entity** can exist. If an entity has two fields that share the same column definition, the second upsert silently overwrites the first.

### Example

User entity has source fields `user_id` and `employee_id`, both mapped to column definition `string_id`.

During upload confirmation, the entity's columns are processed in order:

1. Upsert `user_id` → inserts row with `(entity=user, colDef=string_id, normalizedKey=user_id)`
2. Upsert `employee_id` → conflict on `(entity=user, colDef=string_id)` → **overwrites** `user_id` mapping

Result: only `employee_id` survives. The `user_id` mapping is lost.

### Current schema constraints

```sql
-- Prevents multiple mappings to the same column definition per entity (TOO RESTRICTIVE)
CREATE UNIQUE INDEX field_mappings_entity_column_unique
  ON field_mappings (connector_entity_id, column_definition_id)
  WHERE deleted IS NULL;

-- Prevents duplicate normalizedKey per entity (CORRECT — already exists)
CREATE UNIQUE INDEX field_mappings_entity_normalized_key_unique
  ON field_mappings (connector_entity_id, normalized_key)
  WHERE deleted IS NULL;
```

### Fix

**Drop** `field_mappings_entity_column_unique` and change the upsert to target `field_mappings_entity_normalized_key_unique` instead.

The `(connectorEntityId, normalizedKey)` pair is the correct natural key — `normalizedKey` is what uniquely identifies a field mapping within an entity. Multiple mappings sharing a column definition is valid (e.g., `user_id` and `employee_id` both using `string_id`).

#### Repository change

```diff
  async upsertByEntityAndColumn(
+   // Rename to upsertByEntityAndNormalizedKey
    data: FieldMappingInsert,
    client: DbClient = db
  ): Promise<FieldMappingSelect> {
    const [row] = await (client as typeof db)
      .insert(this.table)
      .values(data as never)
      .onConflictDoUpdate({
        target: [
          fieldMappings.connectorEntityId,
-         fieldMappings.columnDefinitionId,
+         fieldMappings.normalizedKey,
        ] as IndexColumn[],
        targetWhere: isNull(fieldMappings.deleted),
        set: {
          sourceField: data.sourceField,
          isPrimaryKey: data.isPrimaryKey,
-         normalizedKey: data.normalizedKey,
+         columnDefinitionId: data.columnDefinitionId,
          required: data.required,
          defaultValue: data.defaultValue,
          format: data.format,
          enumValues: data.enumValues,
-         refColumnDefinitionId: data.refColumnDefinitionId,
+         refNormalizedKey: data.refNormalizedKey,
          refEntityKey: data.refEntityKey,
-         refBidirectionalFieldMappingId: data.refBidirectionalFieldMappingId,
          updated: data.updated ?? Date.now(),
          updatedBy: data.updatedBy,
        } as never,
      })
      .returning();
    return row as FieldMappingSelect;
  }
```

Key changes in the `set` clause:
- `normalizedKey` moves out (it's now part of the conflict target, not updatable)
- `columnDefinitionId` moves in (can change if the user re-maps the same normalizedKey to a different column definition)

#### Migration

```sql
-- Drop the overly restrictive constraint
DROP INDEX IF EXISTS field_mappings_entity_column_unique;

-- The entity_normalized_key_unique index already exists and is sufficient
```

#### Stale mapping cleanup in upload confirmation

The current stale-mapping cleanup in `UploadsService.confirmInTransaction` (lines 260-265) filters by `columnDefinitionId`:

```typescript
const staleIds = existingMappings
  .filter((fm) => !incomingColDefIds.includes(fm.columnDefinitionId))
  .map((fm) => fm.id);
```

This must change to filter by `normalizedKey`:

```diff
- const staleIds = existingMappings
-   .filter((fm) => !incomingColDefIds.includes(fm.columnDefinitionId))
-   .map((fm) => fm.id);
+ const incomingNormalizedKeys = new Set(entity.columns.map((c) => c.normalizedKey));
+ const staleIds = existingMappings
+   .filter((fm) => !incomingNormalizedKeys.has(fm.normalizedKey))
+   .map((fm) => fm.id);
```

This correctly identifies mappings that no longer appear in the incoming batch, regardless of which column definition they use.

## Impact on CSV Upload Workflow

The upload workflow is the primary consumer of reference fields. Here is how data flows today and what changes.

### Current flow

```
┌─ Frontend (ColumnMappingStep) ──────────────────────────────────────────┐
│                                                                         │
│  ReferenceEditor renders two dropdowns: Entity and Column               │
│                                                                         │
│  Entity dropdown: "batch:<key>" or "db:<key>" options                   │
│                                                                         │
│  Column dropdown (depends on mode):                                     │
│    Batch mode → lists normalizedKey from sibling batch entities         │
│    DB mode    → lists columnDefinition.id from existing field mappings  │ ← BUG: ambiguous
│                                                                         │
│  handleColumnChange sets:                                               │
│    Batch mode → { refColumnKey: normalizedKey }                         │
│    DB mode    → { refColumnDefinitionId: colDef.id }                    │
│                                                                         │
└───────── confirm() ─────────────────────────────────────────────────────┘
                │
                │  ConfirmColumnSchema payload:
                │    refEntityKey, refColumnKey, refColumnDefinitionId
                │
                ▼
┌─ Backend (UploadsService) ──────────────────────────────────────────────┐
│                                                                         │
│  resolveRefColumnDefinitionId():                                        │
│    1. If refColumnDefinitionId provided → use it                        │
│    2. Else if refColumnKey provided → look up colDef by key in DB       │
│    3. Else → null                                                       │
│                                                                         │
│  Upsert field mapping with:                                             │
│    refColumnDefinitionId: <resolved UUID>                               │
│    refEntityKey: <entity key>                                           │
│    refBidirectionalFieldMappingId: NOT SET (null)                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key observations:**

1. **Batch mode already works correctly** — it stores `refColumnKey` as a `normalizedKey` string, which is exactly what `refNormalizedKey` would be. The rename is cosmetic.

2. **DB mode has the ambiguity bug** — `ColumnMappingStep` line 156-163 lists `fm.columnDefinition!.id` as the dropdown value and displays `fm.columnDefinition!.label (key)`. When two field mappings share the same column definition (e.g., `user_id` and `employee_id` both map to `string_id`), only one dropdown entry appears — and selecting it stores a column definition ID that doesn't distinguish between them.

3. **`refBidirectionalFieldMappingId` is not set during upload** — bidirectional pairing is a separate concern handled by the Create/Update field mapping endpoints. Removing it has zero impact on the upload flow.

4. **`resolveRefColumnDefinitionId()` becomes unnecessary** — with `refNormalizedKey`, the backend stores the value directly. No lookup needed.

### New flow

```
┌─ Frontend (ColumnMappingStep) ──────────────────────────────────────────┐
│                                                                         │
│  Column dropdown (unified across both modes):                           │
│    Batch mode → lists normalizedKey from sibling batch entities         │
│    DB mode    → lists fm.normalizedKey from existing field mappings     │ ← FIX: unambiguous
│                                                                         │
│  handleColumnChange sets (both modes):                                  │
│    { refNormalizedKey: normalizedKey }                                   │
│                                                                         │
└───────── confirm() ─────────────────────────────────────────────────────┘
                │
                │  ConfirmColumnSchema payload:
                │    refEntityKey, refNormalizedKey
                │
                ▼
┌─ Backend (UploadsService) ──────────────────────────────────────────────┐
│                                                                         │
│  No resolution needed — store refNormalizedKey directly                  │
│                                                                         │
│  Upsert field mapping with:                                             │
│    refNormalizedKey: <normalized key string>                             │
│    refEntityKey: <entity key>                                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Detailed frontend changes

#### `RecommendedColumn` type (`upload-workflow.util.ts`)

```diff
  refEntityKey?: string | null;
- refColumnKey?: string | null;       // batch refs: normalized key
- refColumnDefinitionId?: string | null; // DB refs: column def ID
+ refNormalizedKey?: string | null;    // target field mapping normalizedKey (both modes)
```

The two separate fields collapse into one because both modes now carry the same kind of value — a `normalizedKey`.

#### `ReferenceEditor` (`ColumnMappingStep.component.tsx`)

**DB mode column options** (lines 156-163): Change from listing column definition IDs to listing field mapping normalized keys.

```diff
  columnOptions = selectedDbEntity
    ? selectedDbEntity.fieldMappings
        .filter((fm) => fm.columnDefinition !== null)
        .map((fm) => ({
-         value: fm.columnDefinition!.id,
-         label: `${fm.columnDefinition!.label} (${fm.columnDefinition!.key})`,
+         value: fm.normalizedKey,
+         label: `${fm.normalizedKey} (${fm.sourceField})`,
        }))
    : [];
```

This also fixes the ambiguity — if `user_id` and `employee_id` both map to `string_id`, they now appear as two distinct dropdown entries.

**`deriveEntitySelectValue`** (lines 93-109): Simplify — no longer need to branch on `refColumnDefinitionId` vs `refColumnKey`.

```diff
- if (refColumnDefinitionId) return `db:${refEntityKey}`;
- if (refColumnKey) return `batch:${refEntityKey}`;
+ if (refNormalizedKey) {
+   // Determine mode from whether the entity is in batch or DB
+ }
```

**`handleColumnChange`** (lines 189-202): Unified for both modes.

```diff
  const handleColumnChange = (e) => {
    const val = e.target.value || null;
-   if (isDbMode) {
-     onUpdate(entityIndex, columnIndex, {
-       refColumnKey: null,
-       refColumnDefinitionId: val,
-     });
-   } else {
-     onUpdate(entityIndex, columnIndex, {
-       refColumnKey: val,
-       refColumnDefinitionId: null,
-     });
-   }
+   onUpdate(entityIndex, columnIndex, { refNormalizedKey: val });
  };
```

#### `confirm()` payload (`upload-workflow.util.ts`, lines 319-353)

```diff
  refEntityKey: col.refEntityKey ?? null,
- refColumnKey: col.refColumnKey ?? null,
- refColumnDefinitionId: col.refColumnDefinitionId ?? null,
+ refNormalizedKey: col.refNormalizedKey ?? null,
```

#### `ReviewStep` display (`ReviewStep.component.tsx`)

```diff
- col.sourceField → normalizedKey → refEntityKey.refColumnKey
+ col.sourceField → normalizedKey → refEntityKey.refNormalizedKey
```

### Backend changes

#### `ConfirmColumnSchema` (`upload.contract.ts`)

```diff
  refEntityKey: z.string().nullable().optional(),
- refColumnKey: z.string().nullable().optional(),
- refColumnDefinitionId: z.string().nullable().optional(),
+ refNormalizedKey: z.string().nullable().optional(),
```

#### `UploadsService.confirmInTransaction` (`uploads.service.ts`)

```diff
- const hasRefFields = !!(col.refColumnKey || col.refColumnDefinitionId)
-   || colDef!.type === "reference" || colDef!.type === "reference-array";
- const refColumnDefinitionId = hasRefFields
-   ? await UploadsService.resolveRefColumnDefinitionId(
-     organizationId, col.refColumnKey, col.refColumnDefinitionId, tx
-   )
-   : null;
+ const hasRefFields = !!col.refNormalizedKey
+   || colDef!.type === "reference" || colDef!.type === "reference-array";

  // Upsert field mapping
  {
-   refColumnDefinitionId: refColumnDefinitionId ?? null,
-   refEntityKey: hasRefFields ? (col.refEntityKey ?? null) : null,
+   refNormalizedKey: hasRefFields ? (col.refNormalizedKey ?? null) : null,
+   refEntityKey: hasRefFields ? (col.refEntityKey ?? null) : null,
  }
```

**Remove** `resolveRefColumnDefinitionId()` entirely (lines 341-352).

### Test changes

#### `upload-workflow.test.ts`

- `updateColumn persists ref fields`: assert `refNormalizedKey` instead of `refColumnKey`
- `updateColumn can set refColumnDefinitionId for an existing DB column`: replace with asserting `refNormalizedKey` for DB mode
- `confirm() includes ref fields in request body`: assert `refNormalizedKey` in payload, remove `refColumnKey`/`refColumnDefinitionId` assertions

#### `uploads.service.test.ts`

- Remove tests for `resolveRefColumnDefinitionId()`
- Update confirm test fixtures to use `refNormalizedKey`

## Files Requiring Changes

### packages/core (model + contracts)

| File | Change |
|------|--------|
| `models/field-mapping.model.ts` | `refColumnDefinitionId` → `refNormalizedKey` |
| `contracts/field-mapping.contract.ts` | Same rename in create/update request schemas |
| `contracts/upload.contract.ts` | Drop `refColumnDefinitionId`, rename `refColumnKey` → `refNormalizedKey` |

### apps/api (DB + services)

| File | Change |
|------|--------|
| `db/schema/field-mappings.table.ts` | Rename ref column, drop FK to `columnDefinitions`, drop `field_mappings_entity_column_unique` constraint |
| `db/schema/zod.ts` | Regenerated automatically |
| `db/schema/type-checks.ts` | Updated automatically (compile-time) |
| `db/repositories/field-mappings.repository.ts` | Rename `upsertByEntityAndColumn` → `upsertByEntityAndNormalizedKey`; change conflict target to `(connectorEntityId, normalizedKey)`; remove `findByRefColumnDefinitionId`, `countByRefColumnDefinitionId`; add `findCounterpart` method |
| `services/uploads.service.ts` | Remove `resolveRefColumnDefinitionId()`; store `refNormalizedKey` directly; change stale-mapping filter from `columnDefinitionId` to `normalizedKey` |
| `services/column-definition-validation.service.ts` | Remove ref-column-definition checks |
| `services/field-mapping-validation.service.ts` | Update any ref resolution logic |
| `routes/field-mapping.router.ts` | Update bidirectional validation / impact endpoints |
| `constants/api-codes.constants.ts` | Update/remove codes referencing column definition refs |
| `config/swagger.config.ts` | Update OpenAPI schema |
| New migration file | `ALTER TABLE field_mappings` rename + drop FK |

### apps/web (frontend)

| File | Change |
|------|--------|
| `workflows/CSVConnector/utils/upload-workflow.util.ts` | `refColumnKey` → `refNormalizedKey` |
| `workflows/CSVConnector/ColumnMappingStep.component.tsx` | Same rename in UI |
| `workflows/CSVConnector/ReviewStep.component.tsx` | Same rename in display |
| `components/CreateFieldMappingDialog.component.tsx` | `refColumnDefinitionId` → `refNormalizedKey` |
| `components/EditFieldMappingDialog.component.tsx` | Same rename |
| `views/ColumnDefinitionDetail.view.tsx` | Remove ref-column-definition usage |

### Tests

All corresponding `__tests__/` files for the above source files need updates. Integration tests that seed `refColumnDefinitionId` must be updated to use `refNormalizedKey`.

### Files that do NOT need changes

- Migration snapshots (`drizzle/meta/*.json`) — new migration generates its own snapshot
- Documentation files (`docs/`) — can be updated separately if desired
