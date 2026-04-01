# Create Field Mapping — Implementation Plan

Reference: [CREATE_FIELD_MAPPING.spec.md](./CREATE_FIELD_MAPPING.spec.md)

---

## Step 1: Add `create` method to field mappings SDK

**File:** `apps/web/src/api/field-mappings.api.ts`

**Changes:**

- Import `FieldMappingCreateRequestBody` and `FieldMappingCreateResponsePayload` from `@portalai/core/contracts`
- Add `create` method to the `fieldMappings` object:

```tsx
create: () =>
  useAuthMutation<FieldMappingCreateResponsePayload, FieldMappingCreateRequestBody>({
    url: "/api/field-mappings",
    method: "POST",
  }),
```

**Verification:**

```bash
npm run type-check
```

---

## Step 2: Create `CreateFieldMappingDialog` component

**File (new):** `apps/web/src/components/CreateFieldMappingDialog.component.tsx`

**Implementation details:**

1. Define `CreateFieldMappingDialogProps` interface per spec (props: `open`, `onClose`, `onSubmit`, `onSearchConnectorEntities`, `onSearchColumnDefinitions`, `onSearchFieldMappings`, `isPending`, `serverError`, `columnDefinitionId`, `columnDefinitionLabel`)
2. Define local `CreateFieldMappingFormSchema` Zod schema for validation (required: `connectorEntityId`, `sourceField`, `isPrimaryKey`; nullable: `refColumnDefinitionId`, `refEntityKey`, `refBidirectionalFieldMappingId`)
3. Define `CreateFieldMappingFormState` interface and `INITIAL_FORM` constant (defaults: `isPrimaryKey: false`, ref fields: `null`, string fields: `""`)
4. Define `validateForm()` function using `validateWithSchema`
5. Implement component:
   - `useState` for `form`, `errors`, `touched`
   - `useDialogAutoFocus(open)` for connector entity select auto-focus
   - `useEffect` to reset form state when `open` transitions to `true`
   - `handleChange` — updates form, validates if field is already touched
   - `handleBlur` — marks field as touched, triggers validation
   - `handleSubmit` — marks all required fields as touched, validates, calls `focusFirstInvalidField()` on failure, calls `onSubmit` with `FieldMappingCreateRequestBody` (injecting `columnDefinitionId` from props) on success
6. Render `Modal` with `slotProps.paper.component="form"` and `onSubmit` handler:
   - Disabled `TextField` showing `columnDefinitionLabel`
   - `AsyncSearchableSelect` for connector entity (required, auto-focused)
   - `TextField` for source field (required)
   - `Switch` for is primary key
   - `AsyncSearchableSelect` for ref column definition (optional)
   - `AsyncSearchableSelect` for ref entity key (optional)
   - `AsyncSearchableSelect` for ref bidirectional field mapping (optional)
   - `FormAlert` for server errors
   - Cancel / Create action buttons with `type="button"`

**Follow patterns from:** `CreateStationDialog.component.tsx`, `EditFieldMappingDialog.component.tsx`

**Verification:**

```bash
npm run type-check
npm run lint
```

---

## Step 3: Write `CreateFieldMappingDialog` tests

**File (new):** `apps/web/src/__tests__/CreateFieldMappingDialog.test.tsx`

**Test setup:**

- Import `jest` from `@jest/globals`
- Import `render`, `screen`, `fireEvent`, `waitFor` from `./test-utils`
- Import component via dynamic `await import("../components/CreateFieldMappingDialog.component")`
- Define `defaultProps` with `jest.fn()` callbacks and default values (`open: true`, `isPending: false`, `serverError: null`, `columnDefinitionId: "cd-1"`, `columnDefinitionLabel: "First Name"`)

**Tests to write:**

| # | Test | Assertion |
|---|------|-----------|
| 1 | Renders title and form fields when `open={true}` | Dialog title visible; Column Definition (disabled), Connector Entity, Source Field, Is Primary Key, and three optional ref fields rendered |
| 2 | Does not render when `open={false}` | Dialog title not in document |
| 3 | Shows locked Column Definition field | Disabled text field displays `columnDefinitionLabel` |
| 4 | Calls `onSubmit` with correct body on valid submit | Fill connector entity (mock `onSearchConnectorEntities` to resolve options, select one) and source field, click Create — assert `onSubmit` called with `{ connectorEntityId, columnDefinitionId: "cd-1", sourceField, isPrimaryKey: false, refColumnDefinitionId: null, refEntityKey: null, refBidirectionalFieldMappingId: null }` |
| 5 | Supports Enter key submission | Submit form via `fireEvent.submit` — assert `onSubmit` called |
| 6 | Calls `onClose` on Cancel click | Click Cancel — assert `onClose` called |
| 7 | Shows loading state when `isPending={true}` | Button text changes to "Creating...", buttons disabled |
| 8 | Renders `FormAlert` when `serverError` is provided | Pass `serverError: { message: "Duplicate", code: "FIELD_MAPPING_DUPLICATE" }` — assert error message visible |
| 9 | Does not render `FormAlert` when `serverError` is null | No alert role element in document |
| 10 | Displays validation errors on invalid submit | Click Create with empty form — "Connector entity is required" and "Source field is required" visible |
| 11 | `aria-invalid="true"` set on invalid fields | After invalid submit, check `aria-invalid` attribute on required fields |
| 12 | `required` attribute on required fields | Source Field input has `required` attribute |
| 13 | Calls `onSearchConnectorEntities` when typing | Type in connector entity select — assert callback called |
| 14 | Calls `onSearchColumnDefinitions` when typing | Type in ref column definition select — assert callback called |
| 15 | Calls `onSearchFieldMappings` when typing | Type in ref bidirectional select — assert callback called |
| 16 | Form resets when dialog reopens | Fill fields, rerender with `open={false}` then `open={true}` — fields reset to defaults |
| 17 | `isPrimaryKey` defaults to false | Switch is unchecked on initial render |
| 18 | Optional ref fields default to null and submit as null | Submit with only required fields filled — ref fields are `null` in `onSubmit` args |

**Verification:**

```bash
cd apps/web && npx jest --testPathPattern="CreateFieldMappingDialog" --no-coverage
```

---

## Step 4: Integrate dialog into `ColumnDefinitionDetailView`

**File:** `apps/web/src/views/ColumnDefinitionDetail.view.tsx`

**Changes:**

1. **Imports** — add:
   - `FieldMappingCreateRequestBody` from `@portalai/core/contracts`
   - `CreateFieldMappingDialog` from `../components/CreateFieldMappingDialog.component`
   - `AddIcon` from `@mui/icons-material/Add`

2. **State** — add `createDialogOpen` boolean state (default `false`)

3. **Mutation** — initialize `fmCreateMutation` via `sdk.fieldMappings.create()`

4. **Search callbacks** — add:
   - `handleSearchConnectorEntities` — fetches `/api/connector-entities?search=<query>&limit=20`, maps to `{ value: id, label }`
   - `handleSearchConnectorEntitiesForRefKey` — same endpoint, maps to `{ value: key, label: "label (key)" }`
   - `handleSearchFieldMappings` — fetches `/api/field-mappings?search=<query>&include=connectorEntity&limit=20`, maps to `{ value: id, label: "sourceField (entityLabel)" }`
   - Reuses existing `handleSearchColumnDefinitions` for ref column definition

5. **Submit handler** — `handleFieldMappingCreate`:
   - Calls `fmCreateMutation.mutate(body, { onSuccess })`
   - `onSuccess`: close dialog, invalidate `queryKeys.fieldMappings.root` and `queryKeys.columnDefinitions.root`

6. **Create button** — add to the Field Mappings `PageSection` header via the `action` prop (or adjacent to the title):
   ```tsx
   <Button
     variant="outlined"
     size="small"
     startIcon={<AddIcon />}
     onClick={() => setCreateDialogOpen(true)}
   >
     Create
   </Button>
   ```

7. **Dialog render** — add `CreateFieldMappingDialog` alongside existing dialogs, passing:
   - `open={createDialogOpen}`
   - `onClose={() => setCreateDialogOpen(false)}`
   - `onSubmit={handleFieldMappingCreate}`
   - `onSearchConnectorEntities={handleSearchConnectorEntities}`
   - `onSearchColumnDefinitions={handleSearchColumnDefinitions}`
   - `onSearchFieldMappings={handleSearchFieldMappings}`
   - `isPending={fmCreateMutation.isPending}`
   - `serverError={toServerError(fmCreateMutation.error)}`
   - `columnDefinitionId={columnDefinitionId}`
   - `columnDefinitionLabel={cd.label}`

**Verification:**

```bash
npm run type-check
npm run lint
```

---

## Step 5: Update `ColumnDefinitionDetailView` tests

**File:** `apps/web/src/__tests__/ColumnDefinitionDetailView.test.tsx`

**Changes:**

1. **Update SDK mock** — add `create: () => noopMutation` to `sdk.fieldMappings` in the `jest.unstable_mockModule` block, and add `fieldMappings: { root: ["fieldMappings"] }` to `queryKeys`

2. **New tests to add:**

| # | Test | Setup | Assertion |
|---|------|-------|-----------|
| 1 | "Create" button is visible in Field Mappings section | Load view with column definition + empty field mappings list | Button with text "Create" is in document |
| 2 | Clicking "Create" opens the dialog | Same setup, click Create button | Dialog title (e.g., "New Field Mapping") appears in document |
| 3 | Dialog receives correct `columnDefinitionId` and `columnDefinitionLabel` | Same setup, click Create button | Disabled text field displays column definition label |

**Verification:**

```bash
cd apps/web && npx jest --testPathPattern="ColumnDefinitionDetailView" --no-coverage
```

---

## Step 6: Final Verification

Run the full suite to ensure no regressions:

```bash
# Type checking across monorepo
npm run type-check

# Lint across monorepo
npm run lint

# All tests across monorepo
npm run test

# Build all packages
npm run build
```

**Expected results:**
- Type check passes — no type errors in new or modified files
- Lint passes — new files follow ESLint config and import ordering
- All existing tests pass — SDK mock updates in `ColumnDefinitionDetailView.test.tsx` don't break existing assertions
- All new tests pass — `CreateFieldMappingDialog.test.tsx` (18 tests) and updated `ColumnDefinitionDetailView.test.tsx` (3 new tests)
- Build succeeds — no compilation errors

---

## File Change Summary

| File | Action | Step |
|------|--------|------|
| `apps/web/src/api/field-mappings.api.ts` | Modify — add `create` method | 1 |
| `apps/web/src/components/CreateFieldMappingDialog.component.tsx` | **Create** | 2 |
| `apps/web/src/__tests__/CreateFieldMappingDialog.test.tsx` | **Create** | 3 |
| `apps/web/src/views/ColumnDefinitionDetail.view.tsx` | Modify — add button, state, mutation, callbacks, dialog | 4 |
| `apps/web/src/__tests__/ColumnDefinitionDetailView.test.tsx` | Modify — update mock, add 3 tests | 5 |
