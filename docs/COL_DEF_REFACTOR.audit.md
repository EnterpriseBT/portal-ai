# Column Definition & Field Mapping Refactor Audit

## Problem Statement

Column definitions and field mappings conflate their intended purposes. Column definitions currently own fields that are source-dependent (`required`, `defaultValue`, `format`, `enumValues`), and the normalization pipeline lacks formatting, validation, and type coercion — it only renames keys.

The refactor separates concerns into two clean layers:
- **ColumnDefinition** — context-free, organization-wide schema catalog
- **FieldMapping** — source-specific mapping rules and constraints

---

## Refactored Models

### ColumnDefinition (context-free type catalog)

Describes *what a column type means* — independent of any source or entity. Acts as a reusable type definition, not a per-entity field.

```ts
export const ColumnDefinitionSchema = CoreSchema.extend({
  organizationId: z.string(),
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),  // catalog identifier, NOT the normalizedData key
  label: z.string(),
  type: ColumnDataTypeEnum,
  validationPattern: z.string().nullable(),    // universal regex validation
  validationMessage: z.string().nullable(),    // human-readable failure message
  canonicalFormat: z.string().nullable(),      // display/normalization format
  description: z.string().nullable(),
});
```

`key` is the column definition's identifier within the org catalog (e.g., `"id"`, `"email"`, `"status"`). It is **not** used as the key in `normalizedData` — that role moves to `fieldMapping.normalizedKey`.

### FieldMapping (source-to-normalized mapping + constraints)

Describes *how a specific source populates a column* and *what it's called in this entity's context*.

```ts
export const FieldMappingSchema = CoreSchema.extend({
  organizationId: z.string(),
  connectorEntityId: z.string(),
  columnDefinitionId: z.string(),
  sourceField: z.string(),
  normalizedKey: z.string().regex(/^[a-z][a-z0-9_]*$/),  // key in normalizedData

  // Mapping constraints (moved from ColumnDefinition)
  required: z.boolean(),
  defaultValue: z.string().nullable(),
  format: z.string().nullable(),
  enumValues: z.array(z.string()).nullable(),

  // Identity
  isPrimaryKey: z.boolean(),

  // Reference fields (unchanged)
  refColumnDefinitionId: z.string().nullable(),
  refEntityKey: z.string().nullable(),
  refBidirectionalFieldMappingId: z.string().nullable(),
});
```

`normalizedKey` is the key used in `normalizedData` for this entity. This allows a single column definition to be reused across entities with different attribute names:

```
ColumnDefinition:  key: "id", type: "string", validationPattern: UUID regex

FieldMapping (Accounts):  sourceField: "_id"     → normalizedKey: "account_id"
FieldMapping (Products):  sourceField: "pid"     → normalizedKey: "product_id"
FieldMapping (Contacts):  sourceField: "contact" → normalizedKey: "contact_id"
```

One column definition, three mappings. Each names the field appropriately for its entity context. All three share the same type, validation, and canonical format.

### Field Ownership Summary

| Field | Owner | Scope | Rationale |
|-------|-------|-------|-----------|
| `key` | ColumnDefinition | Universal | Catalog identifier for the column type definition |
| `label` | ColumnDefinition | Universal | Intrinsic display name for the type |
| `type` | ColumnDefinition | Universal | Storage/coercion/sorting semantics |
| `description` | ColumnDefinition | Universal | Documentation |
| `validationPattern` | ColumnDefinition | Universal | Regex intrinsic to what the column means (e.g., email, URL) |
| `validationMessage` | ColumnDefinition | Universal | Human-readable error for pattern failure |
| `canonicalFormat` | ColumnDefinition | Universal | How to display (or canonicalize for strings) the stored value |
| `normalizedKey` | FieldMapping | Per-entity | The key used in `normalizedData` — names the field in this entity's context |
| `format` | FieldMapping | Per-source | How to parse the source value (date format, boolean labels, delimiter) |
| `required` | FieldMapping | Per-source | A column may be required from one source but optional from another |
| `defaultValue` | FieldMapping | Per-source | Fill value when source field is absent/null |
| `enumValues` | FieldMapping | Per-source | What values this source is allowed to produce |
| `isPrimaryKey` | FieldMapping | Per-source | Identity resolution is per-source |

### Validation Presets (frontend-only convenience)

The model stores raw regex + message. The UI offers quick-select presets that auto-populate both fields:

```ts
const VALIDATION_PRESETS = {
  email: {
    validationPattern: "^[^@]+@[^@]+\\.[^@]+$",
    validationMessage: "Must be a valid email address",
  },
  url: {
    validationPattern: "^https?://.*",
    validationMessage: "Must be a valid URL",
  },
  phone: {
    validationPattern: "^\\+?[\\d\\s\\-()]+$",
    validationMessage: "Must be a valid phone number",
  },
  uuid: {
    validationPattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    validationMessage: "Must be a valid UUID",
  },
};
```

---

## Column Data Types

`currency` is collapsed into `number` — it's just a number with a `canonicalFormat` that includes a currency symbol.

```ts
export const ColumnDataTypeEnum = z.enum([
  "string",
  "number",
  "boolean",
  "date",
  "datetime",
  "enum",
  "json",
  "array",
  "reference",
  "reference-array",
]);
```

---

## Normalization Pipeline

### Pipeline Overview

Every source value flows through the same pipeline. The field's `type` determines which steps apply.

```
sourceValue = data[fieldMapping.sourceField]
        |
   NULL / MISSING
   |  Has defaultValue?  --> use it
   |  Is required?       --> validation error
   |  Otherwise          --> null, continue
        |
   COERCE by columnDefinition.type
   |  Smart defaults per type (see below)
   |  fieldMapping.format overrides parse behavior
        |
   FORMAT MAP (if fieldMapping.format defines value mapping)
   |  e.g., enum source-to-canonical mapping
        |
   CANONICALIZE (for string types only)
   |  Apply columnDefinition.canonicalFormat at write time
   |  e.g., phone number normalization
        |
   VALIDATE by columnDefinition.validationPattern (if set)
   |  regex test on coerced/canonicalized value
   |  fail --> { field, error: validationMessage }
        |
   CONSTRAINT CHECK by fieldMapping
   |  enum --> value in fieldMapping.enumValues?
        |
   STORE in normalizedData[fieldMapping.normalizedKey]
```

### canonicalFormat: Write-time vs Read-time

The `type` determines when `canonicalFormat` is applied:

| Type | Stored as | canonicalFormat applied at |
|------|-----------|--------------------------|
| `string` | Canonicalized string | **Write time** — stored value IS the display value |
| `number` | Raw number | **Read time** — display formatting only |
| `boolean` | `true` / `false` | **Read time** — display label mapping only |
| `date` | ISO 8601 (`2024-03-15`) | **Read time** — display formatting only |
| `datetime` | ISO 8601 (`2024-03-15T14:30:00Z`) | **Read time** — display formatting only |
| `enum` | Canonical label | N/A — stored value is display value |
| `json` | Parsed object | N/A |
| `array` | Parsed array | N/A |
| `reference` | Source ID string | N/A — display is resolved record label |
| `reference-array` | Array of source ID strings | N/A — display is resolved record labels |

For typed values (number, boolean, date, datetime), storing the raw typed representation preserves correct sorting and filtering behavior. `canonicalFormat` is applied only at read/display time.

For strings, the canonicalized form IS the stored value (e.g., phone numbers normalized to `+1 555-123-4567`), so lexicographic sorting operates on the consistent format.

### fieldMapping.format vs columnDefinition.canonicalFormat

These are mirrors of each other:

| Field | Direction | Owner | Example |
|-------|-----------|-------|---------|
| `fieldMapping.format` | **Inbound** — how to parse the source value | FieldMapping (per-source) | `"MM/DD/YYYY"`, `"Active/Inactive"`, `","` |
| `canonicalFormat` | **Outbound** — how to display the stored value | ColumnDefinition (universal) | `"MMM D, YYYY"`, `"Yes/No"`, `"$#,##0.00"` |

---

## Type-by-Type Specification

### string

**Coercion:** `toString()`. Smart by default.

**Example — UUID (shared across entities):**

```
ColumnDefinition:
  key: "id", type: "string"
  validationPattern: "^[0-9a-f]{8}-...$"
  validationMessage: "Must be a valid UUID"
  canonicalFormat: null

FieldMapping (Accounts):       FieldMapping (Products):       FieldMapping (Contacts):
  sourceField: "_id"             sourceField: "pid"             sourceField: "contact"
  normalizedKey: "account_id"    normalizedKey: "product_id"    normalizedKey: "contact_id"
  isPrimaryKey: true             isPrimaryKey: true             isPrimaryKey: true
  required: true                 required: true                 required: true
```

One column definition, reused across entities. Source field names and normalized keys differ.

```
Accounts normalizedData:  { "account_id": "550e8400-..." }
Products normalizedData:  { "product_id": "6ba7b810-..." }
Contacts normalizedData:  { "contact_id": "f47ac10b-..." }
```

**Example — Phone number (normalization within source):**

```
ColumnDefinition:
  key: "phone", type: "string"
  canonicalFormat: "+1 ###-###-####"
  validationPattern: "^\\+1 \\d{3}-\\d{3}-\\d{4}$"
  validationMessage: "Must be a valid US phone number"

FieldMapping:
  sourceField: "phone_number"
  normalizedKey: "work_phone"

Pipeline: "(555) 123-4567" → strip to digits → apply canonicalFormat → "+1 555-123-4567" → validate → store as normalizedData["work_phone"]
```

`canonicalFormat` applied at write time. Stored value is the normalized form. Another entity could reuse the same column definition with `normalizedKey: "mobile_phone"`.

### number

**Coercion:** Strip whitespace, currency symbols (`$`, `EUR`, etc.), commas. `parseFloat()`. `NaN` = validation error. Smart by default — if source data is wildly non-standard, `fieldMapping.format` overrides (e.g., `"#.###,##"` for European formatting).

**Example — Employee Count (integer):**

```
ColumnDefinition:
  key: "employee_count", type: "number"
  canonicalFormat: "0"                    // no decimals
  validationPattern: "^\\d+$"
  validationMessage: "Must be a positive whole number"
```

**Example — Latitude (fixed decimal):**

```
ColumnDefinition:
  key: "latitude", type: "number"
  canonicalFormat: "0.0000"               // 4 decimal places
  validationPattern: "^-?\\d+\\.\\d+$"
  validationMessage: "Must be a decimal coordinate"
```

**Example — Revenue (currency display):**

```
ColumnDefinition:
  key: "revenue", type: "number"
  canonicalFormat: "$#,##0.00"            // 2 decimals, dollar sign, commas

FieldMapping (European source):
  sourceField: "umsatz"
  format: "#.###,##"                      // European notation

Pipeline: "1.234,56" → parse with European format → 1234.56 → store → display as "$1,234.56"
```

Stored value is always a raw number. `canonicalFormat` applied at read time. Sorting/filtering works natively.

### boolean

**Coercion:** Smart by default — maps common truthy/falsy values (case-insensitive, trimmed):

```
true:  "true", "yes", "y", "1", "on"
false: "false", "no", "n", "0", "off", ""
```

Anything outside this set = validation error, unless `fieldMapping.format` provides custom labels.

**Example:**

```
ColumnDefinition:
  key: "is_active", type: "boolean"
  canonicalFormat: "Yes/No"               // display labels

FieldMapping (CRM source):
  sourceField: "status"
  format: "Active/Inactive"              // source uses "Active"/"Inactive"

Pipeline: "Active" → match truthy label from format → true → store → display as "Yes"
```

`format` and `canonicalFormat` share the same shape for booleans (`"trueLabel/falseLabel"`) but serve opposite directions:
- `fieldMapping.format`: how to **read** the source value
- `canonicalFormat`: how to **display** the stored value

Stored value is always a raw boolean.

### date & datetime

**Coercion:** Parse to Date object using `fieldMapping.format`. Store as ISO 8601 always (`"2024-03-15"` for date, `"2024-03-15T14:30:00Z"` for datetime).

Smart coercion when `fieldMapping.format` is null:
- Try ISO 8601 first
- Try epoch (if purely numeric)
- Fail otherwise — dates are too ambiguous to guess (`01/02/03`?)

`fieldMapping.format` is almost always required for non-ISO sources. The AI recommendation step during upload can infer it from sample values.

**Example:**

```
ColumnDefinition:
  key: "hire_date", type: "date"
  canonicalFormat: "MMM D, YYYY"          // "Mar 15, 2024"

FieldMapping (CSV source):          FieldMapping (HubSpot source):       FieldMapping (Legacy DB):
  sourceField: "hire_date"            sourceField: "properties.start"      sourceField: "emp_start"
  format: "MM/DD/YYYY"               format: null (already ISO)           format: "epoch_ms"

Pipeline: "03/15/2024" → parse with MM/DD/YYYY → "2024-03-15" → store → display as "Mar 15, 2024"
```

Stored as ISO 8601. Lexicographic sorting works correctly. `canonicalFormat` applied at read time.

### enum

**Coercion:** Pass through as string.

Validation comes from `fieldMapping.enumValues`, not the column definition. The column just declares `type: "enum"`.

**Pipeline order: validate source values first, then map to canonical form.**

```
ColumnDefinition:
  key: "status", type: "enum"
  canonicalFormat: null
  validationPattern: null

FieldMapping (CRM source):
  sourceField: "account_status"
  enumValues: ["Active", "Inactive", "Churned"]
  format: null                              // source labels match canonical

FieldMapping (CSV source):
  sourceField: "status"
  enumValues: ["active", "inactive", "vip"]
  format: "active:Active, inactive:Inactive, vip:VIP"    // map to canonical
  defaultValue: "Active"

Pipeline: "active" → validate against enumValues ✓ → apply format mapping → "Active" → store
```

#### Tradeoffs: Validate Before vs After Format Mapping

**Chosen approach: validate source values before mapping, then map to canonical.**

| | Validate Before Mapping (chosen) | Validate After Mapping |
|---|---|---|
| **enumValues represents** | Source vocabulary | Canonical output set |
| **Pro** | Catches unexpected source values immediately — if source sends a value not in `enumValues`, you know the source changed | Simpler mental model — one set of allowed values matching stored output |
| **Pro** | Format mapping is explicit — every source value must be accounted for | Don't need to maintain both `enumValues` and `format` in sync |
| **Con** | Must keep `enumValues` and `format` in sync — adding a source value without a mapping means it passes validation with no canonical form | Bad format mapping could silently transform garbage into a valid canonical value |
| **Con** | Two concepts to configure per mapping | Can't distinguish "source sent unexpected value" from "mapping is wrong" |

**Mitigation:** When `format` is null, the source value passes through as-is and becomes the canonical value (no mapping needed when source and canonical labels already match). When a user adds a value to `enumValues`, the UI should prompt them to add a corresponding format mapping entry.

### json

**Coercion:** If string, `JSON.parse()` (fail if invalid JSON). If already an object, pass through.

```
ColumnDefinition:
  key: "metadata", type: "json"
  canonicalFormat: null
  validationPattern: null

Pipeline: '{"role": "admin"}' → JSON.parse → { role: "admin" } → store
```

No `canonicalFormat`, `validationPattern`, or `enumValues` apply. Escape hatch type for complex/variable data. If a specific JSON field needs normalization later, extract it into its own scalar column definition.

### array

**Coercion:** If array, pass through. If string, split by `fieldMapping.format` delimiter.

```
ColumnDefinition:
  key: "tags", type: "array"
  canonicalFormat: null
  validationPattern: null

FieldMapping (CSV source):           FieldMapping (Legacy source):
  sourceField: "tags"                  sourceField: "categories"
  format: ","                          format: "|"

Pipeline: "tag1, tag2, tag3" → split by "," → trim → ["tag1", "tag2", "tag3"] → store
```

No `canonicalFormat` or `validationPattern` apply. Rendered as list/chips in the UI.

### reference

**Coercion:** Pass through as string identifier.

Relationship metadata lives entirely on FieldMapping. The column type tells the system "this value is a foreign key" which enables linking UI, integrity checks, and delete impact analysis.

```
ColumnDefinition:
  key: "id", type: "reference"
  canonicalFormat: null
  validationPattern: null

FieldMapping:
  sourceField: "company_id"
  normalizedKey: "company"
  refColumnDefinitionId: → "id" column def on target entity
  refEntityKey: "companies"
  required: true

Pipeline: "comp_123" → pass through → store as normalizedData["company"] → display as resolved record label
```

### reference-array

**Coercion:** If array, pass through. If string, split by `fieldMapping.format` delimiter.

Same as `reference` but holds multiple pointers. Supports bidirectional sync via `refBidirectionalFieldMappingId`.

```
ColumnDefinition:
  key: "tags", type: "reference-array"
  canonicalFormat: null
  validationPattern: null

FieldMapping:
  sourceField: "tag_ids"
  normalizedKey: "tags"
  refColumnDefinitionId: → "id" column def on Tags entity
  refEntityKey: "tags"
  refBidirectionalFieldMappingId: → reverse mapping on Tags entity
  format: ","

Pipeline: "tag_1, tag_2" → split by "," → ["tag_1", "tag_2"] → store as normalizedData["tags"] → display as resolved record labels
```

### Reference Validation Tradeoffs

Validating references at import time requires import ordering (companies before contacts). Three approaches:

| Approach | Tradeoff |
|----------|----------|
| Validate at import time | Fails if import order is wrong |
| Validate async after all imports complete | More forgiving, but errors surface later |
| Store as-is, validate on demand | Simplest — broken links surfaced in UI when displaying |

---

## Record Validation Strategy

### Persist with Errors (recommended)

Every record is persisted regardless of validation outcome. Validation state is tracked per-record:

```ts
{
  data: { ... },                    // raw source data (never mutated)
  normalizedData: { ... },          // best-effort coerced values
  validationErrors: [               // per-field issues
    { field: "email", error: "Must be a valid email address" },
    { field: "hire_date", error: "invalid date format" },
  ] | null,
  isValid: boolean,                 // quick filter flag
}
```

This enables:
- Import everything, surface errors in the UI
- Users fix individual records or adjust mappings and re-validate in bulk
- Filter/sort records by validation status
- Distinguish "valid and clean" from "imported but needs attention"

### Re-validation on Mapping Changes

When a user edits a field mapping after import (changes `format`, toggles `required`, updates `enumValues`), affected records must be re-validated. The raw `data` is still intact, so the transform pipeline re-runs from scratch:

```
PATCH field mapping --> trigger async re-validation of all records for that entity
```

---

## Migration Strategy

### Data Migration

Existing `required`, `defaultValue`, `format`, and `enumValues` values on `column_definitions` rows must propagate to their associated `field_mappings` rows. The `normalizedKey` field must be backfilled from the linked column definition's `key` (preserving current behavior as the starting point).

1. Add `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues` columns to `field_mappings` table (with defaults)
2. Add `validationPattern`, `validationMessage`, `canonicalFormat` columns to `column_definitions` table
3. Backfill field mappings:
   - Copy `required`, `defaultValue`, `format`, `enumValues` from the linked column definition
   - Set `normalizedKey` to the linked column definition's `key` (existing behavior — `normalizedData` keys currently come from `columnDefinition.key`)
4. Drop `required`, `defaultValue`, `format`, `enumValues` from `column_definitions` table
5. Remove `currency` from `ColumnDataTypeEnum`; migrate existing `currency` columns to `number` with `canonicalFormat` set to a currency display pattern
6. Add `validationErrors` (JSONB, nullable) and `isValid` (boolean) to `entity_records` table
7. Update Zod models, Drizzle tables, type-checks, drizzle-zod schemas
8. Update NormalizationService to use `fieldMapping.normalizedKey` instead of `columnDefinition.key` when building `normalizedData`
9. Update routers, services, and frontend views/dialogs
