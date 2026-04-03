# Create Entity Record — Specification

## Overview

This spec covers five deliverables for enabling manual entity record creation and improving the record editing experience:

1. **`ColumnDefinitionSummary` enrichment** — add `required`, `enumValues`, `defaultValue` to the contract and both `resolveColumns()` helpers
2. **`DynamicRecordField` component** — shared, type-aware field renderer for `json`, `array`, `boolean`, `number`, `currency`, `date`, `datetime`, `enum`, `string`, `reference`, `reference-array`
3. **`CreateEntityRecordDialog` component** — new dialog using `DynamicRecordField`, wired into `EntityDetail.view`
4. **`EditEntityRecordDialog` upgrade** — replace plain TextFields with `DynamicRecordField`
5. **`POST /` API endpoint** — single-record create route, contract, SDK method, and error code

---

## 1. ColumnDefinitionSummary Enrichment

### 1.1 Contract — `packages/core/src/contracts/entity-record.contract.ts`

Extend `ColumnDefinitionSummarySchema`:

```typescript
export const ColumnDefinitionSummarySchema = z.object({
  key: z.string(),
  label: z.string(),
  type: ColumnDataTypeEnum,
  required: z.boolean(),
  enumValues: z.array(z.string()).nullable(),
  defaultValue: z.string().nullable(),
});
```

### 1.2 API — `resolveColumns()` in `apps/api/src/routes/entity-record.router.ts`

Update the mapping in `resolveColumns()` to pass through the new fields:

```typescript
return {
  key: cd.key,
  label: cd.label,
  type: cd.type as ColumnDataType,
  required: cd.required,
  enumValues: cd.enumValues ?? null,
  defaultValue: cd.defaultValue ?? null,
};
```

### 1.3 API — `resolveColumns()` in `apps/api/src/utils/adapter.util.ts`

Apply the same change to the adapter utility's `resolveColumns()` so the adapter query path also returns enriched summaries.

---

## 2. DynamicRecordField Component

**File:** `apps/web/src/components/DynamicRecordField.component.tsx`

### 2.1 Props

```typescript
interface DynamicRecordFieldProps {
  column: ColumnDefinitionSummary;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  /** Field-level error message (from validation). */
  error?: string;
  /** Whether this field has been touched (for showing errors). */
  touched?: boolean;
  /** Ref for auto-focus (passed to first field in dialog). */
  inputRef?: React.Ref<HTMLInputElement>;
  /** Disable the field (e.g., during submission). */
  disabled?: boolean;
}
```

### 2.2 Type → Widget Mapping

| `column.type` | Widget | Details |
|---------------|--------|---------|
| `string` | `<TextField>` | Single-line. `required` from column. |
| `number` | `<TextField type="number">` | `inputProps={{ step: "any" }}`. |
| `currency` | `<TextField type="number">` | Same as number. |
| `boolean` | `<FormControlLabel>` + `<Checkbox>` | `checked` bound to value. Label from `column.label`. No empty/null state — defaults to `false`. |
| `date` | `<TextField type="date">` | `InputLabelProps={{ shrink: true }}` so the label doesn't overlap the native picker. |
| `datetime` | `<TextField type="datetime-local">` | Same shrink treatment. |
| `enum` | `<TextField select>` + `<MenuItem>` per `column.enumValues` entry | If `enumValues` is null or empty, fall back to plain `<TextField>`. Include an empty "None" option if not required. |
| `json` | Code-editor styled `<TextField multiline>` | See §2.3. Placeholder `{}`. |
| `array` | Code-editor styled `<TextField multiline>` | See §2.3. Placeholder `[]`. |
| `reference` | `<TextField>` | Plain text. |
| `reference-array` | `<TextField multiline rows={2}>` | Placeholder: `Comma-separated IDs`. |

### 2.3 JSON/Array Code-Editor Styling

Applied via MUI `sx` prop on the `<TextField>`:

- **Font**: `theme.typography.monospace.fontFamily` at `0.875rem`
- **Background**: `theme.palette.action.hover` on the input area
- **Min rows**: 4; auto-expands with content (`multiline` without fixed `rows`)
- **Placeholder**: `{}` for json, `[]` for array
- **Validation on blur**: Parse with `JSON.parse`. If invalid, set error with the parse error message (e.g., `"Unexpected token at position 12"`). For `array`, additionally check `Array.isArray(parsed)`.
- **Pretty-print on blur**: If valid, replace value with `JSON.stringify(parsed, null, 2)`
- **Border**: Standard outlined variant; switches to error state on invalid parse

No line numbers in v1 — the monospace font, recessed background, and auto-formatting provide sufficient code-editor feel.

### 2.4 Accessibility

- All `<TextField>` variants: `error={touched && !!error}`, `helperText={touched && error}`
- All validated fields: `slotProps={{ htmlInput: { "aria-invalid": touched && !!error } }}`
- Required fields: `required={column.required}`
- `<Checkbox>`: Wrapped in `<FormControlLabel>` which provides the accessible label

### 2.5 Value State Model

The parent dialog manages state as `Record<string, unknown>`. `DynamicRecordField` receives the raw value and calls `onChange(column.key, newValue)` with the **display value** (string for text/json fields, boolean for checkbox, etc.). Serialization to the final `normalizedData` shape happens at submit time in the parent dialog (see §2.6).

### 2.6 Serialization Utility

**File:** `apps/web/src/utils/record-field-serialization.util.ts`

```typescript
/**
 * Serialize form values into normalizedData for API submission.
 * Returns { data, errors } — errors is non-empty if JSON fields are invalid.
 */
export function serializeRecordFields(
  columns: ColumnDefinitionSummary[],
  values: Record<string, unknown>
): { data: Record<string, unknown>; errors: Record<string, string> };
```

Per-type serialization:

| Type | Logic |
|------|-------|
| `string`, `date`, `datetime`, `reference` | Empty string → `null`, otherwise string as-is |
| `number`, `currency` | Empty string → `null`, otherwise `Number(value)` (set error if `isNaN`) |
| `boolean` | Value as-is (always boolean, never null) |
| `enum` | Empty string → `null`, otherwise string as-is |
| `json` | Empty string → `null`, otherwise `JSON.parse(value)` (set error if throws) |
| `array` | Empty string → `null`, otherwise `JSON.parse(value)` + `Array.isArray` check (set error if either fails) |
| `reference-array` | Empty string → `null`, otherwise split by comma, trim, filter empty → `string[]` |

```typescript
/**
 * Validate required fields. Returns errors for required columns with empty/null values.
 */
export function validateRequiredFields(
  columns: ColumnDefinitionSummary[],
  values: Record<string, unknown>
): Record<string, string>;
```

### 2.7 Default Value Initialization

**File:** `apps/web/src/utils/record-field-serialization.util.ts`

```typescript
/**
 * Build initial form values from column definitions.
 * Used by CreateEntityRecordDialog for default values.
 * Used by EditEntityRecordDialog to deserialize existing normalizedData.
 */
export function initializeRecordFields(
  columns: ColumnDefinitionSummary[],
  existingData?: Record<string, unknown>
): Record<string, unknown>;
```

- If `existingData` is provided (edit mode): use existing values, converting to display format (e.g., `JSON.stringify` for json/array objects, `String()` for numbers)
- If no `existingData` (create mode): use `column.defaultValue` if set, otherwise type-appropriate empty (`""` for strings, `false` for booleans, `""` for numbers, `""` for json/array)

---

## 3. CreateEntityRecordDialog

### 3.1 Component — `apps/web/src/components/CreateEntityRecordDialog.component.tsx`

```typescript
export interface CreateEntityRecordDialogProps {
  open: boolean;
  onClose: () => void;
  columns: ColumnDefinitionSummary[];
  onSubmit: (body: EntityRecordCreateRequestBody) => void;
  isPending?: boolean;
  serverError?: ServerError | null;
}
```

**Structure** (follows the EditEntityRecordDialog inner-form + outer-guard pattern):

- Outer component: returns `null` when `!open`. Renders `<CreateForm key={...}>` when open.
- Inner `CreateForm`:
  - State: `values: Record<string, unknown>` initialized via `initializeRecordFields(columns)`
  - State: `errors: Record<string, string>` for field-level validation errors
  - State: `touched: Record<string, boolean>` for deferred error display
  - `useDialogAutoFocus(true)` ref on first field
  - On blur: set `touched[key] = true`; for json/array fields, trigger parse validation + pretty-print
  - On submit:
    1. Mark all fields as touched
    2. Run `validateRequiredFields(columns, values)` → merge into errors
    3. Run `serializeRecordFields(columns, values)` → merge serialization errors
    4. If any errors, call `focusFirstInvalidField()` and return
    5. Call `onSubmit({ normalizedData: serializedData })`
  - `<Modal>` with `slotProps.paper.component="form"`, `onSubmit` handler
  - Title: `"New Record"`
  - Body: `columns.map(col => <DynamicRecordField ...>)`
  - Actions: Cancel + Create buttons, both `type="button"`
  - `<FormAlert serverError={serverError}>` in body

### 3.2 Contract — `packages/core/src/contracts/entity-record.contract.ts`

```typescript
export const EntityRecordCreateRequestBodySchema = z.object({
  normalizedData: z.record(z.string(), z.unknown()),
  sourceId: z.string().optional(),
});

export type EntityRecordCreateRequestBody = z.infer<typeof EntityRecordCreateRequestBodySchema>;

export const EntityRecordCreateResponsePayloadSchema = z.object({
  record: EntityRecordSchema,
});

export type EntityRecordCreateResponsePayload = z.infer<typeof EntityRecordCreateResponsePayloadSchema>;
```

### 3.3 API Endpoint — `apps/api/src/routes/entity-record.router.ts`

**Route:** `POST /` (mounted under `/api/connector-entities/:connectorEntityId/records`)

```
1. resolveEntityOrThrow(connectorEntityId)
2. assertWriteCapability(connectorEntityId)
3. Parse body with EntityRecordCreateRequestBodySchema
4. Get { userId, organizationId } from req.application.metadata
5. Create model via EntityRecordModelFactory.create(userId)
6. model.update({
     organizationId,
     connectorEntityId,
     data: body.normalizedData,           // mirror
     normalizedData: body.normalizedData,
     sourceId: body.sourceId ?? crypto.randomUUID(),
     checksum: "manual",
     syncedAt: Date.now(),
   })
7. repository.create(model.parse())
8. Return 201 with { record }
```

**Error codes:**
- `400` + `ENTITY_RECORD_INVALID_PAYLOAD` — schema validation failure
- `404` + `CONNECTOR_ENTITY_NOT_FOUND` — entity not found
- `422` + `CONNECTOR_INSTANCE_WRITE_DISABLED` — write not enabled
- `500` + `ENTITY_RECORD_CREATE_FAILED` — database error (new code)

### 3.4 API Error Code — `apps/api/src/constants/api-codes.constants.ts`

Add: `ENTITY_RECORD_CREATE_FAILED = "ENTITY_RECORD_CREATE_FAILED"`

### 3.5 Swagger — `apps/api/src/routes/entity-record.router.ts`

Add OpenAPI JSDoc block above the `POST /` handler following the existing patterns (see `POST /import` and `PATCH /:recordId` blocks).

### 3.6 Frontend SDK — `apps/web/src/api/entity-records.api.ts`

```typescript
create: (connectorEntityId: string) =>
  useAuthMutation<EntityRecordCreateResponsePayload, EntityRecordCreateRequestBody>({
    url: recordsUrl(connectorEntityId),
  }),
```

### 3.7 View Integration — `apps/web/src/views/EntityDetail.view.tsx`

- Add `createDialogOpen` state (`boolean`, default `false`)
- Add `createMutation` using `entityRecords.create(connectorEntityId)`
- Add `handleCreate` callback:
  - Call `createMutation.mutateAsync(body)`
  - On success: `queryClient.invalidateQueries({ queryKey: queryKeys.entityRecords.root })`
  - Close dialog, reset mutation
- Add "New Record" `<Button>` as `primaryAction` on the Records `<PageSection>`, visible only when `isWriteEnabled && columnDefs.length > 0`
- Render `<CreateEntityRecordDialog>` with: `open={createDialogOpen}`, `columns={columnDefs}`, `onSubmit={handleCreate}`, `isPending={createMutation.isPending}`, `serverError={toServerError(createMutation.error)}`

---

## 4. EditEntityRecordDialog Upgrade

### 4.1 Component Changes — `apps/web/src/components/EditEntityRecordDialog.component.tsx`

Replace the current column rendering loop with `DynamicRecordField`:

**Before:**
```tsx
{columns.map((col, i) => (
  <TextField
    key={col.key}
    label={col.label}
    value={values[col.key] ?? ""}
    onChange={(e) => handleChange(col.key, e.target.value)}
    multiline={col.type === "json" || col.type === "array"}
    rows={col.type === "json" || col.type === "array" ? 3 : undefined}
  />
))}
```

**After:**
```tsx
{columns.map((col, i) => (
  <DynamicRecordField
    key={col.key}
    column={col}
    value={values[col.key]}
    onChange={handleChange}
    error={errors[col.key]}
    touched={touched[col.key]}
    inputRef={i === 0 ? firstRef : undefined}
    disabled={isPending}
  />
))}
```

Additional changes:
- Change state from `Record<string, string>` to `Record<string, unknown>` (initialized via `initializeRecordFields(columns, normalizedData)`)
- Add `errors` and `touched` state
- On blur: set `touched[key] = true`
- On submit: use `serializeRecordFields()` and `validateRequiredFields()` instead of the current manual string comparison
- Only call `onSubmit` if serialization + validation pass and there are actual changes

### 4.2 Props Change

The `EditEntityRecordDialogProps` interface is unchanged — it already accepts `columns: ColumnDefinitionSummary[]`. The enriched summary fields are used internally by `DynamicRecordField`.

---

## 5. Test Plan

### 5.1 New Test: `DynamicRecordField.component.test.tsx`

**File:** `apps/web/src/__tests__/DynamicRecordField.test.tsx`

#### Rendering by type

| Test | Assertion |
|------|-----------|
| renders `<TextField>` for `string` type | `getByLabelText("Name")` is a text input |
| renders `<TextField type="number">` for `number` type | Input has `type="number"` |
| renders `<TextField type="number">` for `currency` type | Input has `type="number"` |
| renders `<Checkbox>` for `boolean` type | `getByRole("checkbox")` exists |
| renders `<TextField type="date">` for `date` type | Input has `type="date"` |
| renders `<TextField type="datetime-local">` for `datetime` type | Input has `type="datetime-local"` |
| renders `<TextField select>` with options for `enum` type | `getByRole("combobox")` exists; options match `enumValues` |
| renders enum as plain text field when `enumValues` is null | Falls back to `<TextField>` |
| renders multiline monospace field for `json` type | Textarea has monospace font-family in computed styles |
| renders multiline monospace field for `array` type | Same as json |
| renders `<TextField>` for `reference` type | Single-line text input |
| renders multiline field for `reference-array` type | Textarea present |

#### JSON/Array code-editor behavior

| Test | Assertion |
|------|-----------|
| shows placeholder `{}` for empty json field | Placeholder attribute is `{}` |
| shows placeholder `[]` for empty array field | Placeholder attribute is `[]` |
| pretty-prints valid JSON on blur | After entering `{"a":1}` and blurring, value becomes `{\n  "a": 1\n}` |
| shows parse error on blur for invalid JSON | `helperText` contains the JSON parse error message |
| clears error when corrected and blurred | Error disappears after entering valid JSON and blurring |
| validates array type rejects non-array JSON | Entering `{"a":1}` in array field shows "Value must be a JSON array" |

#### Validation and accessibility

| Test | Assertion |
|------|-----------|
| shows error when `touched` and `error` are set | `helperText` contains error message |
| does not show error when `touched` is false | No error text visible |
| sets `aria-invalid="true"` when `touched` and `error` | Input has `aria-invalid="true"` |
| sets `required` attribute when `column.required` is true | Input has `required` attribute |
| boolean field does not show required (no empty state) | Checkbox does not have `required` |

#### Interaction

| Test | Assertion |
|------|-----------|
| calls `onChange` with string value for text fields | `onChange("name", "hello")` called |
| calls `onChange` with string value for number fields | `onChange("age", "25")` called (serialization is separate) |
| calls `onChange` with boolean value for checkbox | `onChange("active", true)` called |
| calls `onChange` with string value for enum select | `onChange("status", "active")` called |
| disables input when `disabled` is true | Input is disabled |
| passes `inputRef` to the underlying input | Ref is attached |

### 5.2 New Test: `record-field-serialization.util.test.ts`

**File:** `apps/web/src/__tests__/record-field-serialization.test.ts`

#### `serializeRecordFields`

| Test | Input | Expected |
|------|-------|----------|
| serializes string field | `{ name: "Alice" }` | `{ data: { name: "Alice" }, errors: {} }` |
| serializes empty string to null | `{ name: "" }` | `{ data: { name: null }, errors: {} }` |
| serializes number field | `{ age: "25" }` | `{ data: { age: 25 }, errors: {} }` |
| returns error for non-numeric number field | `{ age: "abc" }` | `{ errors: { age: "Must be a valid number" } }` |
| serializes empty number to null | `{ age: "" }` | `{ data: { age: null }, errors: {} }` |
| serializes boolean field (true) | `{ active: true }` | `{ data: { active: true }, errors: {} }` |
| serializes boolean field (false) | `{ active: false }` | `{ data: { active: false }, errors: {} }` |
| serializes date field | `{ dob: "2024-01-15" }` | `{ data: { dob: "2024-01-15" }, errors: {} }` |
| serializes json field | `{ meta: '{"a":1}' }` | `{ data: { meta: { a: 1 } }, errors: {} }` |
| returns error for invalid json | `{ meta: '{bad' }` | `{ errors: { meta: "Invalid JSON: ..." } }` |
| serializes array field | `{ tags: '["a","b"]' }` | `{ data: { tags: ["a", "b"] }, errors: {} }` |
| returns error for non-array json in array field | `{ tags: '{"a":1}' }` | `{ errors: { tags: "Value must be a JSON array" } }` |
| serializes reference-array field | `{ ids: "a, b, c" }` | `{ data: { ids: ["a", "b", "c"] }, errors: {} }` |
| serializes empty reference-array to null | `{ ids: "" }` | `{ data: { ids: null }, errors: {} }` |
| serializes currency same as number | `{ price: "9.99" }` | `{ data: { price: 9.99 }, errors: {} }` |
| serializes enum field | `{ status: "active" }` | `{ data: { status: "active" }, errors: {} }` |
| serializes empty enum to null | `{ status: "" }` | `{ data: { status: null }, errors: {} }` |

#### `validateRequiredFields`

| Test | Input | Expected |
|------|-------|----------|
| returns error for empty required string | Column `required: true`, value `""` | `{ name: "Name is required" }` |
| returns error for null required field | Column `required: true`, value `null` | `{ name: "Name is required" }` |
| passes for non-empty required field | Column `required: true`, value `"Alice"` | `{}` |
| passes for non-required empty field | Column `required: false`, value `""` | `{}` |
| boolean required fields always pass | Column `required: true, type: "boolean"`, value `false` | `{}` |

#### `initializeRecordFields`

| Test | Input | Expected |
|------|-------|----------|
| initializes string with default value | Column `defaultValue: "hello"` | `{ name: "hello" }` |
| initializes string without default | Column `defaultValue: null` | `{ name: "" }` |
| initializes boolean as false | Column `type: "boolean"` | `{ active: false }` |
| initializes json as empty string | Column `type: "json"` | `{ meta: "" }` |
| deserializes existing json object to string | `existingData: { meta: { a: 1 } }` | `{ meta: '{\n  "a": 1\n}' }` |
| deserializes existing number to string | `existingData: { age: 25 }` | `{ age: "25" }` |
| deserializes existing boolean | `existingData: { active: true }` | `{ active: true }` |
| passes through existing string | `existingData: { name: "Alice" }` | `{ name: "Alice" }` |

### 5.3 New Test: `CreateEntityRecordDialog.test.tsx`

**File:** `apps/web/src/__tests__/CreateEntityRecordDialog.test.tsx`

Uses ESM dynamic imports with `jest.unstable_mockModule` for SDK mocks (same pattern as `CreateConnectorEntityDialog.test.tsx`).

**Test columns fixture:**
```typescript
const columns: ColumnDefinitionSummary[] = [
  { key: "name", label: "Name", type: "string", required: true, enumValues: null, defaultValue: null },
  { key: "age", label: "Age", type: "number", required: false, enumValues: null, defaultValue: null },
  { key: "active", label: "Active", type: "boolean", required: false, enumValues: null, defaultValue: null },
  { key: "metadata", label: "Metadata", type: "json", required: false, enumValues: null, defaultValue: null },
];
```

#### Rendering

| Test | Assertion |
|------|-----------|
| renders dialog title and fields when `open={true}` | "New Record" title visible; one field per column |
| does not render when `open={false}` | "New Record" not in document |
| renders type-appropriate inputs for each column | Name is text, Age is number, Active is checkbox, Metadata is multiline |
| pre-fills default values from columns | Column with `defaultValue: "default"` has that value |

#### Submission

| Test | Assertion |
|------|-----------|
| calls `onSubmit` with serialized `normalizedData` on Create click | `onSubmit({ normalizedData: { name: "Alice", age: 30, active: true, metadata: null } })` |
| calls `onSubmit` on Enter key (form submit) | Same as above via `fireEvent.submit` |
| does not call `onSubmit` when required field is empty | Error message shown, `onSubmit` not called |
| does not call `onSubmit` when JSON field is invalid | Error message shown, `onSubmit` not called |
| serializes boolean false correctly | Unchecked checkbox submits `false`, not `null` |

#### Cancel / Close

| Test | Assertion |
|------|-----------|
| calls `onClose` on Cancel click | `onClose` called once |

#### Loading state

| Test | Assertion |
|------|-----------|
| shows "Creating..." and disables buttons when `isPending` | Create button text is "Creating...", both buttons disabled |

#### Server errors

| Test | Assertion |
|------|-----------|
| renders `<FormAlert>` when `serverError` is provided | Error message and code visible |
| does not render `<FormAlert>` when `serverError` is null | No `role="alert"` in document |

#### Field validation

| Test | Assertion |
|------|-----------|
| shows required error for empty required field on submit | "Name is required" visible |
| shows JSON parse error for invalid JSON on submit | Parse error message visible |
| sets `aria-invalid="true"` on invalid fields | Required empty field has `aria-invalid="true"` |
| sets `required` attribute on required fields | Name input has `required` attribute |
| does not show errors before submit or blur | Errors not visible initially |

### 5.4 Updated Test: `EditEntityRecordDialog.test.tsx`

**File:** `apps/web/src/__tests__/EditEntityRecordDialog.test.tsx`

This test file does not currently exist. Create it with the full dialog test checklist.

**Test columns fixture** (same as create, plus existing data):
```typescript
const normalizedData = { name: "Alice", age: 25, active: true, metadata: { key: "val" } };
```

#### Rendering

| Test | Assertion |
|------|-----------|
| renders dialog title and fields when `open={true}` | "Edit Record" title visible; fields populated with existing values |
| does not render when `open={false}` | "Edit Record" not in document |
| renders type-appropriate inputs | Checkbox for boolean, number input for number, multiline for json |
| deserializes existing json to pretty-printed string | Metadata field contains `'{\n  "key": "val"\n}'` |
| deserializes existing number to string | Age field contains `"25"` |

#### Submission

| Test | Assertion |
|------|-----------|
| calls `onSubmit` with updated `normalizedData` on Save click | Only changed fields reflected |
| calls `onSubmit` on Enter key (form submit) | Same via `fireEvent.submit` |
| calls `onClose` without `onSubmit` when no changes made | `onSubmit` not called, `onClose` called |
| does not call `onSubmit` when JSON field is invalid | Error shown, `onSubmit` not called |

#### Cancel / Close

| Test | Assertion |
|------|-----------|
| calls `onClose` on Cancel click | `onClose` called once |

#### Loading state

| Test | Assertion |
|------|-----------|
| shows "Saving..." and disables buttons when `isPending` | Save button text is "Saving...", both buttons disabled |

#### Server errors

| Test | Assertion |
|------|-----------|
| renders `<FormAlert>` when `serverError` is provided | Error message visible |
| does not render `<FormAlert>` when `serverError` is null | No `role="alert"` |

#### Field validation

| Test | Assertion |
|------|-----------|
| shows required error when clearing a required field and submitting | "Name is required" visible |
| shows JSON parse error for invalid JSON on submit | Parse error visible |
| sets `aria-invalid="true"` on invalid fields | Attribute present |

### 5.5 API Integration Test: `entity-record.router.integration.test.ts`

**File:** `apps/api/src/__tests__/__integration__/routes/entity-record.router.integration.test.ts`

Add a new `describe("POST /")` block with these tests:

#### Success cases

| Test | Setup | Assertion |
|------|-------|-----------|
| creates a record with normalizedData | POST with `{ normalizedData: { name: "Alice" } }` | 201; response has `record` with matching `normalizedData` |
| mirrors normalizedData into data | POST with `{ normalizedData: { name: "Alice" } }` | `record.data` equals `record.normalizedData` |
| auto-generates sourceId when omitted | POST with `{ normalizedData: {...} }` (no sourceId) | `record.sourceId` is a valid UUID |
| uses provided sourceId when present | POST with `{ normalizedData: {...}, sourceId: "custom-123" }` | `record.sourceId === "custom-123"` |
| sets checksum to "manual" | POST | `record.checksum === "manual"` |
| sets syncedAt to current timestamp | POST | `record.syncedAt` is approximately `Date.now()` |
| returns enriched columns in list after create | POST then GET `/` | New record appears in list |

#### Error cases

| Test | Setup | Assertion |
|------|-------|-----------|
| returns 400 for missing normalizedData | POST with `{}` | 400, `ENTITY_RECORD_INVALID_PAYLOAD` |
| returns 400 for invalid body | POST with `{ normalizedData: "not-an-object" }` | 400, `ENTITY_RECORD_INVALID_PAYLOAD` |
| returns 404 for non-existent entity | POST to invalid connectorEntityId | 404, `CONNECTOR_ENTITY_NOT_FOUND` |
| returns 422 when write capability disabled | POST to entity with write disabled | 422, `CONNECTOR_INSTANCE_WRITE_DISABLED` |

### 5.6 View Integration Test Updates

#### `EntityDetail.view.tsx` tests — `apps/web/src/__tests__/EntityDetailView.test.tsx`

Add tests for the new create flow (if this test file exists; otherwise note as new):

| Test | Assertion |
|------|-----------|
| shows "New Record" button when `isWriteEnabled` and columns exist | Button visible |
| hides "New Record" button when `isWriteEnabled` is false | Button not in document |
| hides "New Record" button when no columns | Button not in document |
| opens CreateEntityRecordDialog on "New Record" click | Dialog title "New Record" visible |
| invalidates `entityRecords.root` after successful create | `queryClient.invalidateQueries` called with `queryKeys.entityRecords.root` |

### 5.7 Contract Test: `entity-record.contract.test.ts`

**File:** `packages/core/src/__tests__/contracts/entity-record.contract.test.ts` (create or update)

| Test | Assertion |
|------|-----------|
| `ColumnDefinitionSummarySchema` accepts enriched fields | Parse succeeds with `{ key, label, type, required, enumValues, defaultValue }` |
| `ColumnDefinitionSummarySchema` requires `required` field | Parse fails without `required` |
| `EntityRecordCreateRequestBodySchema` accepts normalizedData only | Parse succeeds |
| `EntityRecordCreateRequestBodySchema` accepts normalizedData + sourceId | Parse succeeds |
| `EntityRecordCreateRequestBodySchema` rejects empty body | Parse fails |
| `EntityRecordCreateResponsePayloadSchema` validates record shape | Parse succeeds with valid record |

---

## 6. File Change Summary

### New Files

| File | Purpose |
|------|---------|
| `apps/web/src/components/DynamicRecordField.component.tsx` | Shared type-aware field renderer |
| `apps/web/src/utils/record-field-serialization.util.ts` | Serialize, validate, initialize record field values |
| `apps/web/src/components/CreateEntityRecordDialog.component.tsx` | Create record dialog |
| `apps/web/src/__tests__/DynamicRecordField.test.tsx` | DynamicRecordField tests |
| `apps/web/src/__tests__/record-field-serialization.test.ts` | Serialization utility tests |
| `apps/web/src/__tests__/CreateEntityRecordDialog.test.tsx` | Create dialog tests |
| `apps/web/src/__tests__/EditEntityRecordDialog.test.tsx` | Edit dialog tests (new file) |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/src/contracts/entity-record.contract.ts` | Add `required`, `enumValues`, `defaultValue` to `ColumnDefinitionSummarySchema`; add `EntityRecordCreateRequestBodySchema`, `EntityRecordCreateResponsePayloadSchema` |
| `apps/api/src/routes/entity-record.router.ts` | Add `POST /` handler; update `resolveColumns()` to include enriched fields |
| `apps/api/src/utils/adapter.util.ts` | Update `resolveColumns()` to include enriched fields |
| `apps/api/src/constants/api-codes.constants.ts` | Add `ENTITY_RECORD_CREATE_FAILED` |
| `apps/web/src/api/entity-records.api.ts` | Add `create` method |
| `apps/web/src/components/EditEntityRecordDialog.component.tsx` | Replace TextFields with DynamicRecordField; use serialization utils |
| `apps/web/src/views/EntityDetail.view.tsx` | Add create dialog state, mutation, "New Record" button |
| `apps/api/src/__tests__/__integration__/routes/entity-record.router.integration.test.ts` | Add `POST /` test block |

### Potentially Updated Test Files

| File | Change |
|------|--------|
| `apps/web/src/__tests__/EntityDetailView.test.tsx` | Add "New Record" button and create dialog tests |
| `packages/core/src/__tests__/contracts/entity-record.contract.test.ts` | Add enriched summary and create schema tests |

---

## 7. Implementation Order

1. **Contract enrichment** — `ColumnDefinitionSummarySchema` + create schemas (`packages/core`)
2. **API error code** — `ENTITY_RECORD_CREATE_FAILED` (`apps/api`)
3. **`resolveColumns()` updates** — both in router and adapter util (`apps/api`)
4. **`POST /` endpoint** — entity record router (`apps/api`)
5. **API integration tests** — `POST /` block (`apps/api`)
6. **Serialization utility** — `record-field-serialization.util.ts` + tests (`apps/web`)
7. **`DynamicRecordField`** — component + tests (`apps/web`)
8. **`EditEntityRecordDialog` upgrade** — swap to DynamicRecordField + tests (`apps/web`)
9. **`CreateEntityRecordDialog`** — component + tests (`apps/web`)
10. **Frontend SDK** — `create` method (`apps/web`)
11. **View integration** — EntityDetail "New Record" button + dialog wiring + tests (`apps/web`)
12. **Contract tests** — enriched summary + create schemas (`packages/core`)
