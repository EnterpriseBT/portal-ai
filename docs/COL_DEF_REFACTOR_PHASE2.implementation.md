# Backend Phase 2 — Normalization Pipeline: Implementation Plan

> Reference: [COL_DEF_REFACTOR.spec.md](./COL_DEF_REFACTOR.spec.md) for full specification | [COL_DEF_REFACTOR_PHASE1.implementation.md](./COL_DEF_REFACTOR_PHASE1.implementation.md) for Phase 1

## Context

The current `NormalizationService.normalize()` is a simple key-renaming projection — it maps `sourceField → columnDefinition.key` with no type coercion, validation, or default handling. Phase 1 moved `required`, `defaultValue`, `format`, and `enumValues` to FieldMapping and added `normalizedKey`, `validationPattern`, `validationMessage`, and `canonicalFormat` to the schema. Phase 2 builds the actual normalization pipeline that uses these fields.

The new pipeline must:
1. Coerce values by column type (string, number, boolean, date, etc.)
2. Apply field-mapping-level defaults and format parsing
3. Apply column-definition-level validation patterns and canonicalization
4. Collect per-field validation errors and return `isValid` status
5. Output to `normalizedKey` (not `columnDefinition.key`)

### Key Callers

The normalization pipeline has three call sites that must be updated:

| Caller | File | Current Behavior |
|--------|------|------------------|
| `NormalizationService.normalize()` | `services/normalization.service.ts` | Key-rename projection, returns `Record<string, unknown>` |
| `CsvImportService.importFromS3()` | `services/csv-import.service.ts` | Inline mapping via `sourceToKey` Map, no coercion |
| `EntityRecordCreateTool` / `EntityRecordUpdateTool` | `tools/entity-record-*.tool.ts` | Calls `NormalizationService.normalize()`, hardcodes `isValid: true` |

---

## Section Ordering Rationale

| Section | What | Why This Order |
|---------|------|----------------|
| 1 | Type coercion utilities | Pure functions, no dependencies — foundation for everything else |
| 2 | Validation utilities | Pure functions, depend on nothing |
| 3 | Canonicalization utilities | Pure functions, depend on nothing |
| 4 | Rewrite NormalizationService | Orchestrator — depends on 1–3 |
| 5 | Update CsvImportService | Depends on new NormalizationService signature |
| 6 | Update entity record tools | Depends on new NormalizationService signature |
| 7 | Tests | Verify everything end-to-end |

---

## Section 1: Type Coercion Utilities

**Goal:** Create per-type coercion functions that convert raw source values into their target types. Each returns `{ value, error? }` so the pipeline can collect errors without throwing.

### Checklist

- [x] **Create `apps/api/src/utils/coercion.util.ts`**

  **Dependency:** Import `DateFactory` from `@portalai/core/utils`. Instantiate a module-level UTC factory for date/datetime coercion:

  ```ts
  import { DateFactory } from "@portalai/core/utils";

  const utcDateFactory = new DateFactory("UTC");
  ```

  Define the shared result type:

  ```ts
  interface CoercionResult {
    value: unknown;
    error?: string;
  }
  ```

  Implement these functions:

  - `coerceString(value: unknown): CoercionResult`
    - `null`/`undefined` → `{ value: null }`
    - All others → `{ value: String(value) }`

  - `coerceNumber(value: unknown, format?: string | null): CoercionResult`
    - `null`/`undefined` → `{ value: null }`
    - String: strip `$`, `,`, whitespace; `parseFloat()`
    - If `format` contains `"eu"` or `","` as decimal separator: swap `,` and `.` before parsing
    - `NaN` → `{ value: null, error: "Expected a number" }`
    - Already a number → pass through

  - `coerceBoolean(value: unknown, format?: string | null): CoercionResult`
    - `null`/`undefined` → `{ value: null }`
    - Already boolean → pass through
    - If `format` is a custom label pair (e.g., `"active:inactive"`): match case-insensitively against the two labels; first = true, second = false
    - Default truthy: `"true"`, `"yes"`, `"1"`, `"on"` (case-insensitive)
    - Default falsy: `"false"`, `"no"`, `"0"`, `"off"`, `""` (case-insensitive)
    - Unrecognized → `{ value: null, error: "Expected a boolean" }`

  - `coerceDate(value: unknown, format?: string | null): CoercionResult`
    - Uses `DateFactory` from `@portalai/core/utils` for all parsing and formatting
    - `null`/`undefined` → `{ value: null }`
    - If `format` provided: parse with `dateFns.parse(String(value), format, referenceDate)` via a UTC `DateFactory` instance
    - No format: attempt `dateFactory.toTZDate(value)` — if invalid date → error
    - Validate result with `dateFns.isValid()`
    - Store as ISO 8601 date string (`YYYY-MM-DD`) via `dateFactory.format(parsed, "yyyy-MM-dd")`
    - Invalid → `{ value: null, error: "Expected a valid date" }`

  - `coerceDatetime(value: unknown, format?: string | null): CoercionResult`
    - Uses `DateFactory` from `@portalai/core/utils` for all parsing and formatting
    - Same parsing logic as `coerceDate`
    - Store as ISO 8601 datetime via `dateFactory.format(parsed, "yyyy-MM-dd'T'HH:mm:ss.SSSXXX")`

  - `coerceEnum(value: unknown): CoercionResult`
    - `null`/`undefined` → `{ value: null }`
    - All others → `{ value: String(value) }` (validation of allowed values happens in the validation step, not coercion)

  - `coerceJson(value: unknown): CoercionResult`
    - `null`/`undefined` → `{ value: null }`
    - String → `JSON.parse()`; catch → `{ value: null, error: "Invalid JSON" }`
    - Object/array → pass through

  - `coerceArray(value: unknown, format?: string | null): CoercionResult`
    - `null`/`undefined` → `{ value: null }`
    - Array → pass through
    - String → split by `format` delimiter (default `","`)
    - Other → `{ value: [value] }`

  - `coerceReference(value: unknown): CoercionResult`
    - `null`/`undefined` → `{ value: null }`
    - Otherwise → `{ value: String(value) }`

  - `coerceReferenceArray(value: unknown, format?: string | null): CoercionResult`
    - `null`/`undefined` → `{ value: null }`
    - Array → pass through
    - String → split by `format` delimiter (default `","`)

  - `coerce(type: ColumnDataType, value: unknown, format?: string | null): CoercionResult`
    - Dispatcher: switch on `type`, delegate to the correct function above

### Verification

```bash
npm run type-check
```

---

## Section 2: Validation Utilities

**Goal:** Create field-level validation functions that return `null` (valid) or an error string.

### Checklist

- [x] **Create `apps/api/src/utils/field-validation.util.ts`**

  ```ts
  function validateRequired(value: unknown): string | null
  ```
  - Returns error if `value` is `null`, `undefined`, or empty string `""`

  ```ts
  function validatePattern(value: unknown, pattern: string, message?: string | null): string | null
  ```
  - Returns `null` if `value` is null/undefined (required check is separate)
  - Tests `String(value)` against `new RegExp(pattern)`
  - On failure: return `message ?? \`Does not match pattern ${pattern}\``

  ```ts
  function validateEnum(value: unknown, enumValues: string[]): string | null
  ```
  - Returns `null` if `value` is null/undefined
  - Checks `enumValues.includes(String(value))`
  - On failure: return `"Value '${value}' is not one of: ${enumValues.join(', ')}"`

### Verification

```bash
npm run type-check
```

---

## Section 3: Canonicalization Utilities

**Goal:** Write-time string canonicalization based on `columnDefinition.canonicalFormat`.

### Checklist

- [x] **Create `apps/api/src/utils/canonicalize.util.ts`**

  ```ts
  function canonicalizeString(value: string, canonicalFormat: string): string
  ```

  Supported format directives (applied to string-type values only):

  | `canonicalFormat` value | Behavior |
  |------------------------|----------|
  | `"lowercase"` | `.toLowerCase()` |
  | `"uppercase"` | `.toUpperCase()` |
  | `"trim"` | `.trim()` |
  | `"phone"` | Strip to digits, reformat as `+1XXXXXXXXXX` (10-digit US) or keep digits as-is |
  | Other / unrecognized | Return value unchanged (no-op, log warning) |

  > Note: The format set is deliberately small. New formats are additive and don't break existing data.

### Verification

```bash
npm run type-check
```

---

## Section 4: Rewrite NormalizationService

**Goal:** Replace the key-renaming projection with the full coerce → validate → canonicalize pipeline. Change the return type to include validation results.

### Checklist

- [x] **`apps/api/src/services/normalization.service.ts`**

  **New return type:**

  ```ts
  export interface NormalizationResult {
    normalizedData: Record<string, unknown>;
    validationErrors: Array<{ field: string; error: string }> | null;
    isValid: boolean;
  }
  ```

  **New signature:**

  ```ts
  static async normalize(
    connectorEntityId: string,
    data: Record<string, unknown>,
  ): Promise<NormalizationResult>
  ```

  **New implementation — per-field pipeline:**

  For each field mapping on the entity (fetched with `include: ["columnDefinition"]`, filtered to `connectorEntityId`):

  1. **Extract:** `sourceValue = data[mapping.sourceField]`
  2. **Default handling:**
     - If `sourceValue` is `null`/`undefined`/`""` and `mapping.defaultValue` is not null → `sourceValue = mapping.defaultValue`
  3. **Required check:**
     - If still null/undefined/empty and `mapping.required` → push `{ field: mapping.normalizedKey, error: "Required field is missing" }`, continue to next mapping
     - If still null/undefined and not required → set `normalizedData[mapping.normalizedKey] = null`, continue
  4. **Coerce:** `coerce(columnDefinition.type, sourceValue, mapping.format)` → if error, push to errors, continue
  5. **Enum validation** (when `mapping.enumValues` is not null): `validateEnum(coercedValue, mapping.enumValues)` → if error, push
  6. **Pattern validation** (when `columnDefinition.validationPattern` is not null): `validatePattern(coercedValue, columnDefinition.validationPattern, columnDefinition.validationMessage)` → if error, push
  7. **Canonicalize** (when `columnDefinition.type === "string"` and `columnDefinition.canonicalFormat` is not null): `canonicalizeString(String(coercedValue), columnDefinition.canonicalFormat)`
  8. **Store:** `normalizedData[mapping.normalizedKey] = finalValue`

  **Passthrough behavior:**
  - When no field mappings exist for the entity, return `{ normalizedData: { ...data }, validationErrors: null, isValid: true }` (unchanged from current behavior)

  **Error collection:**
  - Collect all errors into `validationErrors` array
  - A field with a coercion error still stores `null` in `normalizedData` — the error is recorded but processing continues for remaining fields
  - `isValid = validationErrors.length === 0`
  - Return `validationErrors: null` (not empty array) when there are no errors

  **Query optimization:**
  - Change from fetching all org mappings then filtering in JS, to fetching only mappings for the specific `connectorEntityId`:
    ```ts
    const entityMappings = await DbService.repository.fieldMappings.findMany(
      eq(fieldMappings.connectorEntityId, connectorEntityId),
      { include: ["columnDefinition"] },
    );
    ```

### Verification

```bash
npm run type-check
```

---

## Section 5: Update CSV Import Service

**Goal:** Replace the inline `sourceToKey` mapping in `CsvImportService` with calls to `NormalizationService.normalize()`, persisting `validationErrors` and `isValid` on each record.

### Checklist

- [x] **`apps/api/src/services/csv-import.service.ts`**

  **Changes to `importFromS3()`:**

  1. **Remove** the `sourceToKey` Map construction (lines 142–145) and inline `normalizedData` building (lines 176–182)

  2. **Replace** with a call to `NormalizationService.normalize()` for each row:
     ```ts
     const { normalizedData, validationErrors, isValid } =
       await NormalizationService.normalize(connectorEntityId, data);
     ```

  3. **Update** the model update call to pass through validation results:
     ```ts
     model.update({
       ...
       normalizedData,
       validationErrors,
       isValid,
       ...
     });
     ```

  4. **Remove** the `fieldMappings` parameter from `ImportEntityParams` — normalization now fetches its own mappings internally

  5. **Add** validation summary logging after batch upsert:
     ```ts
     const invalidCount = toUpsert.filter(r => !r.isValid).length;
     if (invalidCount > 0) {
       logger.warn(
         { connectorEntityId, invalidCount, total: toUpsert.length },
         "CSV import completed with validation errors"
       );
     }
     ```

  6. **Update** `CsvImportResult` to include validation summary:
     ```ts
     export interface CsvImportResult {
       created: number;
       updated: number;
       unchanged: number;
       invalid: number;
     }
     ```

  **Performance consideration:** `NormalizationService.normalize()` fetches field mappings on every call. For CSV imports this means one DB query per row. To avoid this:

  - Add an overload or helper that accepts pre-fetched mappings:
    ```ts
    static normalizeWithMappings(
      mappings: Array<FieldMappingSelect & { columnDefinition: ColumnDefinitionSelect }>,
      data: Record<string, unknown>,
    ): NormalizationResult
    ```
  - `normalize()` becomes a convenience wrapper that fetches mappings then delegates to `normalizeWithMappings()`
  - `CsvImportService` calls `normalizeWithMappings()` directly, fetching mappings once before the row loop

- [x] **`apps/api/src/services/uploads.service.ts`**
  - Remove `fieldMappings` from the `CsvImportService.importFromS3()` call params (no longer needed)
  - Remove the `fieldMappingInfo` construction that builds `{ sourceField, columnDefinitionKey }[]`

### Verification

```bash
npm run type-check
```

---

## Section 6: Update Entity Record Tools

**Goal:** Update the create/update tools to handle the new `NormalizationResult` return type and persist validation results.

### Checklist

- [x] **`apps/api/src/tools/entity-record-create.tool.ts`**

  Update the `normalize()` call site (line 35):

  ```ts
  // Before:
  const normalizedData = await NormalizationService.normalize(connectorEntityId, data);

  // After:
  const { normalizedData, validationErrors, isValid } =
    await NormalizationService.normalize(connectorEntityId, data);
  ```

  Update `model.update()` (line 39–50):
  - Replace hardcoded `isValid: true` and `validationErrors: null` with the values from normalization result

- [x] **`apps/api/src/tools/entity-record-update.tool.ts`**

  Update the `normalize()` call site (line 38):

  ```ts
  // Before:
  const normalizedData = await NormalizationService.normalize(connectorEntityId, data);

  // After:
  const { normalizedData, validationErrors, isValid } =
    await NormalizationService.normalize(connectorEntityId, data);
  ```

  Update the `entityRecords.update()` call (line 42–47):
  - Add `validationErrors` and `isValid` to the update payload

### Verification

```bash
npm run type-check
```

---

## Section 7: Tests

**Goal:** Unit-test each new utility and the rewritten service. Update existing tests for the new return type.

### Checklist

#### 7.1 Coercion Utility Tests

- [x] **Create `apps/api/src/__tests__/utils/coercion.util.test.ts`**

  Test each coercion function:

  | Function | Test Cases |
  |----------|------------|
  | `coerceString` | null → null, number → string, object → string |
  | `coerceNumber` | `"1,234.56"` → 1234.56, `"$99"` → 99, `"abc"` → error, `""` → null, EU format `"1.234,56"` with format hint |
  | `coerceBoolean` | `"yes"` → true, `"no"` → false, `"1"` → true, `"0"` → false, custom format `"active:inactive"`, unrecognized → error |
  | `coerceDate` | ISO string → `"yyyy-MM-dd"` via `DateFactory.format()`, `"01/15/2024"` with `"MM/dd/yyyy"` format parsed via `dateFns.parse()`, invalid → error, `DateFactory.toTZDate()` produces valid TZDate |
  | `coerceDatetime` | ISO string formatted via `DateFactory.format()` with time component, date-only string gets `T00:00:00.000Z`, `DateFactory.toTZDate()` round-trips correctly |
  | `coerceEnum` | string passthrough, null → null |
  | `coerceJson` | valid JSON string → parsed, invalid JSON → error, object passthrough |
  | `coerceArray` | string `"a,b,c"` → `["a","b","c"]`, custom delimiter via format, array passthrough |
  | `coerceReference` | string passthrough, null → null |
  | `coerceReferenceArray` | string split, array passthrough |
  | `coerce` | dispatcher routes to correct function |

#### 7.2 Validation Utility Tests

- [x] **Create `apps/api/src/__tests__/utils/field-validation.util.test.ts`**

  | Function | Test Cases |
  |----------|------------|
  | `validateRequired` | null → error, undefined → error, `""` → error, `"value"` → null, `0` → null |
  | `validatePattern` | matches → null, no match → default message, no match with custom message → custom message, null value → null (skip) |
  | `validateEnum` | member → null, non-member → error with allowed values listed, null → null (skip) |

#### 7.3 Canonicalization Utility Tests

- [x] **Create `apps/api/src/__tests__/utils/canonicalize.util.test.ts`**

  | Format | Test Cases |
  |--------|------------|
  | `"lowercase"` | `"HELLO"` → `"hello"` |
  | `"uppercase"` | `"hello"` → `"HELLO"` |
  | `"trim"` | `"  hello  "` → `"hello"` |
  | `"phone"` | `"(555) 123-4567"` → `"+15551234567"`, `"5551234567"` → `"+15551234567"`, `"+44..."` → digits only |
  | unrecognized | value returned unchanged |

#### 7.4 NormalizationService Tests

- [x] **Update `apps/api/src/__tests__/services/normalization.service.test.ts`**

  **Update mocks:** `mockFindMany` must now return mapping objects with full field mapping fields (`normalizedKey`, `required`, `defaultValue`, `format`, `enumValues`) and joined `columnDefinition` objects (`type`, `validationPattern`, `validationMessage`, `canonicalFormat`).

  **Update all existing assertions** to destructure `{ normalizedData, validationErrors, isValid }` from the result instead of treating the result as a plain record.

  **Existing tests to update:**

  - `"normalizes data through field mappings"` — assert `normalizedData` uses `normalizedKey` as output key, `isValid: true`, `validationErrors: null`
  - `"omits unmapped source fields"` — same structure update
  - `"passes through data when no field mappings exist"` — assert passthrough in `normalizedData` field
  - `"handles missing source fields gracefully"` — now depends on `required`: if required, expect validation error; if not required, expect `null` in output

  **New test cases:**

  | Category | Test |
  |----------|------|
  | Output key | Uses `normalizedKey` (not `columnDefinition.key`) as the output key |
  | Default values | Null source value + `defaultValue` set → uses default |
  | Required | Null source value + `required: true` + no default → `isValid: false`, error for that field |
  | Required with default | Null source value + `required: true` + `defaultValue` set → uses default, `isValid: true` |
  | String coercion | Numeric input → coerced to string |
  | Number coercion | `"$1,234"` → `1234`, `"abc"` → error |
  | Boolean coercion | `"yes"` → `true`, custom format `"active:inactive"` |
  | Date coercion | `"01/15/2024"` with format `"MM/dd/yyyy"` → `"2024-01-15"` (parsed and formatted via `DateFactory`) |
  | Enum validation | Value not in `enumValues` → error |
  | Pattern validation | Value fails `validationPattern` → error with `validationMessage` |
  | Canonicalization | String value with `canonicalFormat: "lowercase"` → lowercased |
  | Multiple errors | Record with 2 invalid fields → `validationErrors` has 2 entries, `isValid: false` |
  | Partial errors | Record with 1 valid and 1 invalid field → normalizedData has both keys, 1 as null |

#### 7.5 CSV Import Service Tests

- [x] **Update `apps/api/src/__tests__/services/csv-import.service.test.ts`**

  **New mock required:** Mock `NormalizationService.normalizeWithMappings()` (or the field mapping fetch + normalize flow).

  **Update existing tests:**
  - Remove `fieldMappings` from `importFromS3()` params
  - Assert that upserted records include `validationErrors` and `isValid` fields
  - Assert `result.invalid` count is returned

  **New test cases:**
  - CSV row with invalid data → record saved with `isValid: false` and `validationErrors` populated
  - CSV import logs warning when invalid records exist

#### 7.6 Entity Record Tool Tests

- [x] **Update `apps/api/src/__tests__/tools/entity-record-create.tool.test.ts`**
  - Update mock of `NormalizationService.normalize` to return `{ normalizedData, validationErrors, isValid }`
  - Assert that `validationErrors` and `isValid` are passed through to the created record

- [x] **Update `apps/api/src/__tests__/tools/entity-record-update.tool.test.ts`**
  - Same mock update
  - Assert that `validationErrors` and `isValid` are included in the update payload

### Verification

```bash
npm run type-check && npm run build && npm run test && npm run lint
```

---

## Critical Files Reference

| File | Role |
|------|------|
| `apps/api/src/utils/coercion.util.ts` | **New** — Per-type coercion functions |
| `apps/api/src/utils/field-validation.util.ts` | **New** — Pattern, enum, and required validation |
| `apps/api/src/utils/canonicalize.util.ts` | **New** — Write-time string canonicalization |
| `apps/api/src/services/normalization.service.ts` | **Rewrite** — Full coerce → validate → canonicalize pipeline |
| `apps/api/src/services/csv-import.service.ts` | **Update** — Use NormalizationService, remove inline mapping |
| `apps/api/src/services/uploads.service.ts` | **Update** — Remove fieldMappingInfo param from CSV import call |
| `apps/api/src/tools/entity-record-create.tool.ts` | **Update** — Destructure NormalizationResult |
| `apps/api/src/tools/entity-record-update.tool.ts` | **Update** — Destructure NormalizationResult |
| `packages/core/src/models/field-mapping.model.ts` | Reference — FieldMapping schema (Phase 1) |
| `packages/core/src/models/column-definition.model.ts` | Reference — ColumnDefinition schema (Phase 1) |
| `apps/api/src/db/repositories/field-mappings.repository.ts` | Reference — `findManyWithColumnDefinition()` |
