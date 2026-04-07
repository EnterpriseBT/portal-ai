## Audit Summary

### Current State

The CSV workflow's **ColumnMappingStep** (~780 lines) is the complexity epicenter. For every CSV column, users currently can:
- Search for an existing column definition key (`match_existing`) **or** define a brand new one inline (`create_new`)
- Edit label, type, validation pattern/message, canonical format for new definitions
- Configure type-aware field visibility (10 type variants with different enabled fields)
- Set up reference/reference-array targets with entity + column selectors
- The backend `UploadsService.confirm()` then upserts new column definitions in-transaction

This creates a mini column-definition-editor embedded inside the upload flow — the root of the complexity.

---

### Requirement 1: Remove column definition creation/modification from CSV workflow

**Frontend — `ColumnMappingStep.component.tsx` (largest changes)**
- **Remove**: All inline field editors for column definition properties (label, type, validationPattern, validationMessage, canonicalFormat) — lines ~583-643
- **Remove**: `TYPE_FIELD_CONFIG`, `DEFAULT_TYPE_CONFIG`, `VALIDATION_PRESETS`, `STRING_CANONICAL_FORMAT_OPTIONS`, `NUMBER_CANONICAL_FORMAT_OPTIONS` — lines ~45-135
- **Remove**: Reference entity/column selection UI — lines ~187-352
- **Remove**: `create_new` action path — the `action` toggle logic and "new key" fallback
- **Simplify to**: A single `AsyncSearchableSelect` per column that picks an existing column definition key. On selection, display the definition's metadata (type, label, validation, canonical format) as **read-only info** (chips/typography, not form fields)
- **Estimated reduction**: ~500+ lines removed from this file alone

**Frontend — `upload-workflow.util.ts`**
- **Simplify** `editedRecommendations` state: columns only need `existingColumnDefinitionId` + field-mapping-level props (normalizedKey, required, defaultValue, format, enumValues, isPrimaryKey)
- **Remove** column-definition-level fields from the confirm payload (key, label, type, validationPattern, validationMessage, canonicalFormat) — these come from the selected definition
- **Remove** `action` field entirely — everything is `match_existing`

**Frontend — `csv-validation.util.ts`**
- **Remove**: Column definition field validation (key/label/type required, regex validation of validationPattern)
- **Remove**: Cross-entity consistency checks for `create_new` columns (lines ~130-165)
- **Simplify to**: Validate that every column has a `existingColumnDefinitionId` selected, plus the existing field-mapping-level validations

**Frontend — `column-definitions.api.ts`**
- **Keep** `useColumnDefinitionKeySearch` — still needed for the search select
- Consider enhancing to return richer metadata for display

**Contract — `upload.contract.ts` (packages/core)**
- **Remove** `action`, `key`, `label`, `type`, `validationPattern`, `validationMessage`, `canonicalFormat` from `ConfirmColumnPayload`
- **Require** `existingColumnDefinitionId` (no longer optional)

**Backend — `UploadsService.confirm()` (apps/api)**
- **Remove**: `create_new` branch in column resolution (lines ~421-441)
- **Remove**: Column definition cache (`columnDefCache`) — no more in-transaction upserts
- **Remove**: Cross-entity consistency validation
- **Simplify to**: Look up the existing column definition by ID, create the field mapping linking to it

**Backend — `file-analysis.prompt.ts` (apps/api/src/prompts/)**
- Currently instructs the LLM to use `action: "match_existing"` or `"create_new"` and generate full column definition properties (key, label, type, validationPattern, canonicalFormat, etc.)
- **Update to**: Only recommend an `existingColumnDefinitionId` from the provided list — remove all `create_new` instructions and column-definition-level field generation from the prompt
- Remove instructions for generating `validationPattern`, `canonicalFormat`, `key`, `label`, `type` per column — these come from the matched definition
- Keep field-mapping-level instructions (normalizedKey, format, required, enumValues, defaultValue, isPrimaryKey)
- Simplify confidence scoring to reflect match quality against existing definitions only

**Backend — column definition tools**
- `column-definition-create.tool.ts` — unaffected (still used outside CSV workflow)

---

### Requirement 2: Expand default seed column definitions

**Current seed** (`seed.service.ts`): 9 definitions — uuid, email, phone, date, datetime, name, description, currency, url

**Proposed additions** to cover common CSV upload patterns:

| Key | Label | Type | Notes |
|-----|-------|------|-------|
| `string_id` | String ID | `string` | Generic text identifier |
| `number_id` | Number ID | `number` | Numeric identifier |
| `integer` | Integer | `number` | Whole numbers, canonical format for 0 decimals |
| `decimal` | Decimal | `number` | Fractional numbers |
| `percentage` | Percentage | `number` | 0-100 or 0-1 values |
| `boolean` | Boolean | `boolean` | True/false |
| `text` | Text | `string` | Long-form text (no validation) |
| `code` | Code | `string` | Short codes (SKU, ISO, etc.) |
| `enum` | Enum | `enum` | Generic enumerated value |
| `json` | JSON | `json` | Arbitrary JSON blob |
| `array` | Array | `array` | Generic array |
| `reference` | Reference | `reference` | Single entity reference |
| `reference_array` | Reference Array | `reference-array` | Multi-entity reference |
| `address` | Address | `string` | Street/mailing address |
| `quantity` | Quantity | `number` | Counts/amounts |
| `status` | Status | `enum` | Workflow/record status |
| `tag` | Tags | `array` | Label/tag arrays |

**Changes needed in `seed.service.ts`**:
- Expand `SYSTEM_COLUMN_DEFINITIONS` array with the new entries
- Each needs appropriate `validationPattern`, `validationMessage`, `canonicalFormat` defaults
- Existing `upsertByKey()` approach handles idempotency — safe to re-run on existing orgs

**Migration consideration**: Need a one-time seed for existing organizations, not just new ones. The `db:seed` script or a migration hook can handle this.

---

### Impact Summary

| Area | Files Affected | Effort |
|------|---------------|--------|
| ColumnMappingStep simplification | 1 file, ~500 lines removed | High (but net simplification) |
| upload-workflow.util.ts | 1 file, moderate edits | Medium |
| csv-validation.util.ts | 1 file, major simplification | Low-Medium |
| Upload contract (core) | 1 file | Low |
| UploadsService.confirm (API) | 1 file, ~80 lines removed | Medium |
| file-analysis.prompt.ts | 1 file, moderate rewrite | Medium |
| Seed expansion | 1 file | Low |
| Tests | Multiple test files need updating | Medium |

The net result is a **significant reduction in code and complexity** — the ColumnMappingStep drops from ~780 lines to roughly ~250-300, the confirm backend loses its most error-prone branch, and validation becomes trivial. The tradeoff is users must pre-create non-standard column definitions before importing, which requirement 2 mitigates by covering most common cases out of the box.
