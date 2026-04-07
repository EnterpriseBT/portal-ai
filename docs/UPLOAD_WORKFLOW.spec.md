# Upload Workflow Overhaul — Specification

> Companion to [UPLOAD_WORKFLOW.audit.md](./UPLOAD_WORKFLOW.audit.md)

## Goals

1. **Remove** all column definition creation, modification, and suggestion from the CSV upload workflow. The workflow should only allow selecting an existing column definition for each field mapping.
2. **Expand** the system seed column definitions to cover the majority of common CSV data patterns, making it rare for a user to need a custom definition before uploading.

---

## Phase 1: Expand Seed Column Definitions

**Why first**: The new workflow relies on a rich set of existing definitions. Seeding must land before the frontend simplification so that the search-and-select experience is useful from day one.

### 1.1 Update `SYSTEM_COLUMN_DEFINITIONS` in `apps/api/src/services/seed.service.ts`

Add the following entries to the existing 9 definitions (uuid, email, phone, date, datetime, name, description, currency, url):

```ts
{ key: "string_id", label: "String ID", type: "string",
  description: "Generic text identifier (e.g. SKU, external ID)",
  validationPattern: null, validationMessage: null, canonicalFormat: "trim" },

{ key: "number_id", label: "Number ID", type: "number",
  description: "Numeric identifier",
  validationPattern: null, validationMessage: null, canonicalFormat: "#,##0" },

{ key: "integer", label: "Integer", type: "number",
  description: "Whole number without decimals",
  validationPattern: null, validationMessage: null, canonicalFormat: "#,##0" },

{ key: "decimal", label: "Decimal", type: "number",
  description: "Fractional number with decimals",
  validationPattern: null, validationMessage: null, canonicalFormat: "#,##0.00" },

{ key: "percentage", label: "Percentage", type: "number",
  description: "Percentage value (0-100)",
  validationPattern: null, validationMessage: null, canonicalFormat: "#,##0.00" },

{ key: "boolean", label: "Boolean", type: "boolean",
  description: "True/false value",
  validationPattern: null, validationMessage: null, canonicalFormat: null },

{ key: "text", label: "Text", type: "string",
  description: "Free-form text content",
  validationPattern: null, validationMessage: null, canonicalFormat: "trim" },

{ key: "code", label: "Code", type: "string",
  description: "Short code or identifier (SKU, ISO code, etc.)",
  validationPattern: null, validationMessage: null, canonicalFormat: "uppercase" },

{ key: "enum", label: "Enum", type: "enum",
  description: "Enumerated value from a fixed set",
  validationPattern: null, validationMessage: null, canonicalFormat: null },

{ key: "json_data", label: "JSON", type: "json",
  description: "Arbitrary JSON data",
  validationPattern: null, validationMessage: null, canonicalFormat: null },

{ key: "array", label: "Array", type: "array",
  description: "List of values",
  validationPattern: null, validationMessage: null, canonicalFormat: null },

{ key: "reference", label: "Reference", type: "reference",
  description: "Single reference to another entity record",
  validationPattern: null, validationMessage: null, canonicalFormat: null },

{ key: "reference_array", label: "Reference Array", type: "reference-array",
  description: "Multiple references to another entity's records",
  validationPattern: null, validationMessage: null, canonicalFormat: null },

{ key: "address", label: "Address", type: "string",
  description: "Street or mailing address",
  validationPattern: null, validationMessage: null, canonicalFormat: "trim" },

{ key: "quantity", label: "Quantity", type: "number",
  description: "Count or amount",
  validationPattern: null, validationMessage: null, canonicalFormat: "#,##0" },

{ key: "status", label: "Status", type: "enum",
  description: "Workflow or record status",
  validationPattern: null, validationMessage: null, canonicalFormat: null },

{ key: "tag", label: "Tags", type: "array",
  description: "Labels or tags",
  validationPattern: null, validationMessage: null, canonicalFormat: null },
```

**Total after expansion**: 26 system column definitions.

### 1.2 Seed Existing Organizations

The `seedSystemColumnDefinitions` method already uses `upsertByKey()` which is idempotent. To backfill existing orgs:

- Update the `db:seed` script (or add a one-time migration) to iterate all organizations and call `seedSystemColumnDefinitions(orgId, db)` for each.
- The upsert ensures no duplicates and won't overwrite user-customized definitions that share a key.

---

## Phase 2: Simplify Core Models & Contracts

### 2.1 `packages/core/src/models/job.model.ts`

**Remove `ColumnRecommendationActionEnum`** (lines 94-98) and all references to it.

**Update `FileUploadColumnRecommendationSchema`** (lines 101-134):

```ts
export const FileUploadColumnRecommendationSchema = z.object({
  sourceField: z.string(),
  existingColumnDefinitionId: z.string(),
  confidence: z.number().min(0).max(1),
  sampleValues: z.array(z.string()),
  // Field-mapping-level
  normalizedKey: z.string().optional(),
  isPrimaryKey: z.boolean(),
  required: z.boolean(),
  format: z.string().nullable(),
  defaultValue: z.string().nullable().optional(),
  enumValues: z.array(z.string()).nullable().optional(),
  // Reference fields (field-mapping-level, populated for reference/reference-array types)
  refEntityKey: z.string().nullable().optional(),
  refColumnKey: z.string().nullable().optional(),
  refColumnDefinitionId: z.string().nullable().optional(),
});
```

**Removed fields**: `key`, `label`, `type`, `action`, `validationPattern`, `canonicalFormat`.

The recommendation now only points to an existing column definition ID. The column definition's key, label, type, etc. are looked up from the definition itself — not carried in the recommendation.

### 2.2 `packages/core/src/contracts/upload.contract.ts`

**Update `ConfirmColumnSchema`**:

```ts
export const ConfirmColumnSchema = z.object({
  sourceField: z.string(),
  existingColumnDefinitionId: z.string(),  // required, no longer nullable
  // Field-mapping-level
  normalizedKey: z.string().regex(/^[a-z][a-z0-9_]*$/),
  isPrimaryKey: z.boolean(),
  required: z.boolean(),
  format: z.string().nullable(),
  defaultValue: z.string().nullable().optional(),
  enumValues: z.array(z.string()).nullable().optional(),
  // Reference fields (field-mapping-level)
  refEntityKey: z.string().nullable().optional(),
  refColumnKey: z.string().nullable().optional(),
  refColumnDefinitionId: z.string().nullable().optional(),
});
```

**Removed fields**: `key`, `label`, `type`, `action`, `validationPattern`, `validationMessage`, `canonicalFormat`.

**Remove import** of `ColumnRecommendationActionEnum`.

The `ConfirmEntitySchema` and `ConfirmResponsePayloadSchema` remain unchanged.

---

## Phase 3: Simplify Backend

### 3.1 `apps/api/src/services/uploads.service.ts`

**`confirm()` method** — simplify validation (lines 66-82):

```ts
// Validate ALL column definition references exist and belong to org
for (const entity of body.entities) {
  for (const col of entity.columns) {
    const existing = await DbService.repository.columnDefinitions.findById(
      col.existingColumnDefinitionId
    );
    if (!existing || existing.organizationId !== organizationId) {
      throw new ApiError(
        400,
        ApiCode.UPLOAD_INVALID_REFERENCE,
        `Column definition "${col.existingColumnDefinitionId}" not found or does not belong to this organization`
      );
    }
  }
}
```

**Remove entirely**:
- `validateCrossEntityColumnConsistency()` static method (lines 337-371)
- The call to it at line 88

**`confirmInTransaction()` method**:

- **Remove** `columnDefCache` (line 235) — no longer needed
- **Remove** `resolveColumnDefinition()` static method (lines 399-447) — replace with direct lookup

Simplify the column loop (lines 265-313):

```ts
for (const col of entity.columns) {
  // Look up the existing column definition (already validated above)
  const colDef = await DbService.repository.columnDefinitions.findById(
    col.existingColumnDefinitionId, tx
  );
  entityColumnDefs.push({ id: colDef!.id, key: colDef!.key, label: colDef!.label });

  // Resolve reference column definition ID for reference types
  const refColumnDefinitionId = (colDef!.type === "reference" || colDef!.type === "reference-array")
    ? await UploadsService.resolveRefColumnDefinitionId(
        organizationId, col.refColumnKey, col.refColumnDefinitionId, tx
      )
    : null;

  // Upsert field mapping
  const fieldMapping = await DbService.repository.fieldMappings.upsertByEntityAndColumn(
    {
      id: crypto.randomUUID(),
      organizationId,
      connectorEntityId: connectorEntity.id,
      columnDefinitionId: colDef!.id,
      sourceField: col.sourceField,
      isPrimaryKey: col.isPrimaryKey,
      normalizedKey: col.normalizedKey,
      required: col.required,
      defaultValue: col.defaultValue ?? null,
      format: col.format,
      enumValues: col.enumValues ?? null,
      refColumnDefinitionId: refColumnDefinitionId ?? null,
      refEntityKey: (colDef!.type === "reference" || colDef!.type === "reference-array")
        ? (col.refEntityKey ?? null) : null,
      created: now,
      createdBy: userId,
      updated: null, updatedBy: null, deleted: null, deletedBy: null,
    },
    tx
  );
  // ... push to entityFieldMappings
}
```

**Update `resolveRefColumnDefinitionId()`** — remove `columnDefCache` parameter since the cache no longer exists. Simplify to check `refColumnDefinitionId` first, then DB lookup by key:

```ts
private static async resolveRefColumnDefinitionId(
  organizationId: string,
  refColumnKey: string | null | undefined,
  refColumnDefinitionId: string | null | undefined,
  tx: DbTransaction
): Promise<string | null> {
  if (refColumnDefinitionId) return refColumnDefinitionId;
  if (!refColumnKey) return null;
  const existing = await DbService.repository.columnDefinitions.findByKey(
    organizationId, refColumnKey, tx
  );
  return existing?.id ?? null;
}
```

**Remove `ApiCode.UPLOAD_CONFLICTING_COLUMN_DEFINITIONS`** from `apps/api/src/constants/api-codes.constants.ts` if no longer referenced elsewhere.

### 3.2 `apps/api/src/prompts/file-analysis.prompt.ts`

Rewrite the prompt to instruct the LLM to only select from existing column definitions:

- Pass full column definition metadata (id, key, label, type, description, validationPattern, canonicalFormat) to the prompt so the LLM can make informed matches
- Remove all `create_new` instructions and column-definition-level field generation
- The LLM must return `existingColumnDefinitionId` for every column — if no match exists, it should pick the closest type-compatible definition and set a low confidence score
- Keep field-mapping-level instructions: `normalizedKey`, `format`, `required`, `enumValues`, `defaultValue`, `isPrimaryKey`
- Simplify confidence scoring: 1.0 for exact key/label match, 0.8-0.99 for strong semantic match on type + meaning, 0.5-0.79 for type-only match

Update `ExistingColumnDefinition` interface in `file-analysis.service.ts` to include `description`, `validationPattern`, `canonicalFormat` so the prompt can display richer metadata.

### 3.3 `apps/api/src/utils/heuristic-analyzer.util.ts`

Update `heuristicAnalyze()` to:

- **Always** return `existingColumnDefinitionId` — match by inferred type + key/label similarity against the existing columns list
- **Remove** `action: "create_new"` path — if no exact match, pick the best type-compatible existing definition (e.g., inferred `string` with no special pattern → `text` definition; inferred `number` → `integer` or `decimal` based on sample values)
- **Remove** `key`, `label`, `type` from the return — these come from the matched definition
- Remove `validationPattern` and `canonicalFormat` from the return

Matching priority:
1. Exact key match (`existingByKey`)
2. Exact label match (`existingByLabel`)
3. Specialized type match (email pattern → `email` def, UUID pattern → `uuid` def, URL pattern → `url` def)
4. Generic type fallback (`string` → `text`, `number` → `decimal`, `boolean` → `boolean`, `date` → `date`, etc.)

### 3.4 `apps/api/src/services/file-analysis.service.ts`

Update `resolveColumnDefinitionIds()`:
- Remove the "demote to create_new" fallback (line 115) — instead, if the ID can't be resolved, log a warning and attempt a type-based fallback match from the existing columns list
- If still unresolvable, leave the `existingColumnDefinitionId` as-is and set confidence to 0 — the frontend validation will catch it

---

## Phase 4: Simplify Frontend

### 4.1 `apps/web/src/workflows/CSVConnector/utils/upload-workflow.util.ts`

**Update `RecommendedColumn` interface**:

```ts
export interface RecommendedColumn {
  existingColumnDefinitionId: string | null;
  confidence: number;
  sourceField: string;
  sampleValues: string[];
  // Field-mapping-level (editable)
  normalizedKey?: string;
  isPrimaryKeyCandidate: boolean;
  required?: boolean;
  defaultValue?: string | null;
  format?: string | null;
  enumValues?: string[] | null;
  // Reference fields (field-mapping-level)
  refEntityKey?: string | null;
  refColumnKey?: string | null;
  refColumnDefinitionId?: string | null;
}
```

**Removed**: `action`, `recommended` object (key, label, type, description, validationPattern, validationMessage, canonicalFormat).

**Update `RecommendedColumnUpdate`**: Remove the nested `recommended` partial merge — it's a flat object now.

**Update `BackendRecommendation`** mapping: Map the simplified backend response directly.

**Update `confirm()` method** — the payload becomes:

```ts
columns: entity.columns.map((col) => ({
  sourceField: col.sourceField,
  existingColumnDefinitionId: col.existingColumnDefinitionId!,
  normalizedKey: col.normalizedKey!,
  isPrimaryKey: col.isPrimaryKeyCandidate,
  required: col.required ?? false,
  format: col.format ?? null,
  defaultValue: col.defaultValue ?? null,
  enumValues: col.enumValues ?? null,
  refEntityKey: col.refEntityKey ?? null,
  refColumnKey: col.refColumnKey ?? null,
  refColumnDefinitionId: col.refColumnDefinitionId ?? null,
})),
```

**Update `updateColumn()`**: Remove the `recommended` merge logic — shallow merge only.

### 4.2 `apps/web/src/workflows/CSVConnector/ColumnMappingStep.component.tsx`

This is the largest change. **Rewrite the component** from ~780 lines to ~250-300 lines.

**Remove entirely**:
- `COLUMN_TYPE_OPTIONS` (lines 32-43)
- `STRING_CANONICAL_FORMAT_OPTIONS` (lines 45-51)
- `NUMBER_CANONICAL_FORMAT_OPTIONS` (lines 53-62)
- `VALIDATION_PRESETS` (lines 64-70)
- `TypeFieldConfig` interface and `TYPE_FIELD_CONFIG` / `DEFAULT_TYPE_CONFIG` (lines 72-135)
- `ReferenceEditor` component (lines 187-352)
- All column definition field handlers in `ColumnRow`: `handleLabelChange`, `handleTypeChange`, `handleValidationPresetChange`, `handleValidationPatternChange`, `handleValidationMessageChange`, `handleCanonicalFormatChange` (lines 412-496)

**Simplify `ColumnRowProps`**: Remove `allEntities`, `dbEntities`, `isLoadingDbEntities` (no longer needed for reference editor). Add `columnDef: ColumnDefinition | null` (the resolved definition for display).

**New `ColumnRow` structure**:

```
+-------------------------------------------------------+
| Source Field: "Customer Email"     [85% confidence]    |
+-------------------------------------------------------+
| Column Definition: [===== AsyncSearchableSelect =====] |
|                                                         |
| (when selected, show read-only metadata):               |
|   Type: string | Validation: ^[^\s@]+@... | Format: lowercase |
+-------------------------------------------------------+
| Field Mapping:                                          |
|   Normalized Key: [customer_email]                      |
|   Default Value:  [_______________]                     |
|   Format:         [_______________]                     |
|   [x] Required   [ ] Primary Key                        |
|   (if enum type): Enum Values: [val1, val2, ...]       |
+-------------------------------------------------------+
| Sample: john@example.com, jane@test.org, ...           |
+-------------------------------------------------------+
```

**Column definition metadata display** — read-only chips/typography showing:
- **Type** (from `columnDef.type`)
- **Validation** (from `columnDef.validationPattern`, if set)
- **Canonical Format** (from `columnDef.canonicalFormat`, if set)
- **Description** (from `columnDef.description`, if set)

**`handleKeyChange`** — simplify to only set `existingColumnDefinitionId`:

```ts
const handleKeyChange = (value: string | null) => {
  const key = value ?? "";
  const existing = columnDefsByKey[key];
  if (existing) {
    onUpdate(entityIndex, columnIndex, {
      existingColumnDefinitionId: existing.id,
    });
  } else {
    onUpdate(entityIndex, columnIndex, {
      existingColumnDefinitionId: null,
    });
  }
};
```

**Reference fields**: For reference/reference-array column definitions, the reference entity/column configuration remains at the field-mapping level. Keep a simplified `ReferenceEditor` that only appears when the selected column definition's type is `reference` or `reference-array`. This editor sets `refEntityKey`, `refColumnKey`, and `refColumnDefinitionId` on the `RecommendedColumn` directly (not nested under `recommended`).

**`ColumnMappingStepProps`** update:

```ts
interface ColumnMappingStepProps {
  entities: RecommendedEntity[];
  dbEntities: ConnectorEntityWithMappings[];
  isLoadingDbEntities: boolean;
  onUpdateColumn: (entityIndex: number, columnIndex: number, updates: RecommendedColumnUpdate) => void;
  errors?: ColumnStepErrors;
  onColumnKeySearch: (query: string) => Promise<SelectOption[]>;
  columnDefsByKey: Record<string, ColumnDefinition>;
}
```

Props remain mostly the same. `dbEntities` and `isLoadingDbEntities` are still needed for the reference editor.

### 4.3 `apps/web/src/workflows/CSVConnector/utils/csv-validation.util.ts`

**Rewrite the column step validation**:

```ts
const NormalizedKeySchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "Normalized key must be lowercase snake_case");

export function validateColumnStep(entities: RecommendedEntity[]): ColumnStepErrors {
  const allErrors: ColumnStepErrors = {};

  for (let ei = 0; ei < entities.length; ei++) {
    const colErrors: Record<number, FormErrors> = {};

    for (let ci = 0; ci < entities[ei].columns.length; ci++) {
      const col = entities[ei].columns[ci];
      const fieldErrors: FormErrors = {};

      // Column definition must be selected
      if (!col.existingColumnDefinitionId) {
        fieldErrors.columnDefinition = "A column definition must be selected";
      }

      // Validate normalizedKey
      const nk = col.normalizedKey;
      if (nk) {
        const nkResult = NormalizedKeySchema.safeParse(nk);
        if (!nkResult.success) {
          fieldErrors.normalizedKey = nkResult.error.issues[0].message;
        }
      } else {
        fieldErrors.normalizedKey = "Normalized key is required";
      }

      // Reference validation (when column def type is reference/reference-array)
      // Requires the caller to pass the resolved column definition type
      // or check against columnDefsByKey in the component layer

      if (Object.keys(fieldErrors).length > 0) {
        colErrors[ci] = fieldErrors;
      }
    }

    // Uniqueness check for normalizedKey within the entity
    const seen = new Map<string, number>();
    for (let ci = 0; ci < entities[ei].columns.length; ci++) {
      const nk = entities[ei].columns[ci].normalizedKey;
      if (!nk) continue;
      const nkResult = NormalizedKeySchema.safeParse(nk);
      if (!nkResult.success) continue;
      if (seen.has(nk)) {
        colErrors[ci] = {
          ...(colErrors[ci] ?? {}),
          normalizedKey: `Duplicate normalized key "${nk}"`,
        };
      }
      seen.set(nk, ci);
    }

    if (Object.keys(colErrors).length > 0) {
      allErrors[ei] = colErrors;
    }
  }

  return allErrors;
}
```

**Removed**:
- `BaseColumnSchema` (key/label/type validation) — no longer relevant
- `ReferenceColumnSchema` — reference validation moves to component layer (checks against resolved column def type)
- Cross-entity consistency check — no `create_new` to reconcile

### 4.4 `apps/web/src/workflows/CSVConnector/CSVConnectorWorkflow.component.tsx`

Update the container to reflect simplified props:
- Remove column-definition-level fields from `updateColumn` calls
- The `columnDefsByKey` lookup remains for display purposes
- Reference type detection uses `columnDefsByKey[col.existingColumnDefinitionId]?.type` instead of `col.recommended.type`

### 4.5 `apps/web/src/api/column-definitions.api.ts`

**`useColumnDefinitionKeySearch`** — enhance the returned option label to include description:

```ts
return defs.map((cd) => ({
  value: cd.key,
  label: `${cd.label} (${cd.key}) — ${cd.type}${cd.description ? `: ${cd.description}` : ""}`,
}));
```

No other changes needed. The `defsByKey` lookup map is already used by the ColumnMappingStep.

---

## Phase 5: Update Tests

### 5.1 `apps/web/src/workflows/CSVConnector/__tests__/ColumnMappingStep.test.tsx`

- Remove all tests for inline column definition editing (type change, validation preset, canonical format, etc.)
- Remove tests for `create_new` action path
- Add tests for: selecting a column definition via search, displaying read-only metadata, clearing selection
- Update test fixtures to use simplified `RecommendedColumn` shape (no `recommended` nesting)

### 5.2 `apps/web/src/workflows/CSVConnector/__tests__/csv-validation.util.test.ts`

- Remove tests for column definition field validation (key/label/type required)
- Remove tests for cross-entity consistency
- Remove tests for regex validation of `validationPattern`
- Add tests for: `existingColumnDefinitionId` required validation, normalizedKey validation, normalizedKey uniqueness

### 5.3 `apps/web/src/workflows/CSVConnector/__tests__/upload-workflow.test.ts`

- Update `RecommendedColumn` fixtures to new shape
- Update confirm payload assertions to match new `ConfirmColumnSchema`
- Remove assertions about `action` field

### 5.4 `apps/web/src/workflows/CSVConnector/__tests__/CSVConnectorWorkflow.test.tsx`

- Update mocked recommendations to new shape
- Remove column-definition-editing interaction tests

### 5.5 Backend tests

- Update `file-analysis.prompt.test.ts` (if exists) for new prompt structure
- Update any `uploads.service` tests for simplified confirm flow
- Update heuristic analyzer tests for new return shape

---

## Migration & Rollout Considerations

1. **Database**: No schema migrations required. The `column_definitions` and `field_mappings` tables are unchanged. Only seed data is expanded.

2. **API backward compatibility**: The `ConfirmColumnSchema` changes are breaking. Frontend and backend must deploy together. Since this is an internal API with no external consumers, this is acceptable.

3. **Existing data**: Previously created column definitions via `create_new` remain in the database and are fully valid. They will appear in the search select and can be matched in future uploads.

4. **Seed idempotency**: `upsertByKey()` ensures the expanded seed can run on any org — new or existing — without duplicating or overwriting definitions whose keys match.

5. **User impact**: Users who previously relied on creating column definitions inline during upload will need to create definitions separately first via the Column Definitions management page. The expanded seed set (26 definitions) covers the vast majority of common CSV patterns.

---

## Implementation Order

| Step | Phase | Description |
|------|-------|-------------|
| 1 | Phase 1 | Expand seed column definitions |
| 2 | Phase 2 | Update core models and contracts |
| 3 | Phase 3.1 | Simplify `UploadsService.confirm()` |
| 4 | Phase 3.2-3.4 | Update prompt, heuristic analyzer, file analysis service |
| 5 | Phase 4.1 | Simplify `upload-workflow.util.ts` |
| 6 | Phase 4.2 | Rewrite `ColumnMappingStep.component.tsx` |
| 7 | Phase 4.3 | Simplify `csv-validation.util.ts` |
| 8 | Phase 4.4-4.5 | Update workflow container and API hooks |
| 9 | Phase 5 | Update all tests |

Steps 1-4 (backend) and 5-8 (frontend) can be developed in parallel but must deploy together due to the contract change.
