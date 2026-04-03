# Add Column Definition — Implementation Plan

> **Discovery doc:** [ADD_COLUMN_DEFINITON.discovery.md](./ADD_COLUMN_DEFINITON.discovery.md) — covers what already exists, the gap analysis, and the full change specification.

## Step 1: Add `create` method to SDK

**File:** `apps/web/src/api/column-definitions.api.ts`

- Import `ColumnDefinitionCreateRequestBody` and `ColumnDefinitionCreateResponsePayload` from `@portalai/core/contracts`
- Add `create` method to the `columnDefinitions` object, following the pattern in `stations.api.ts`:
  ```ts
  create: () =>
    useAuthMutation<ColumnDefinitionCreateResponsePayload, ColumnDefinitionCreateRequestBody>({
      url: "/api/column-definitions",
      method: "POST",
    }),
  ```

### Checklist

- [x] `ColumnDefinitionCreateRequestBody` import added
- [x] `ColumnDefinitionCreateResponsePayload` import added
- [x] `create` method added to `columnDefinitions` object with `url: "/api/column-definitions"` and `method: "POST"`
- [x] Method signature matches existing create patterns (returns `useAuthMutation<ResponseType, RequestBody>`)
- [x] No other methods in the file were modified

### Verify

- [x] `npm run type-check` passes from repo root

---

## Step 2: Create `CreateColumnDefinitionDialog` component

**File (new):** `apps/web/src/components/CreateColumnDefinitionDialog.component.tsx`

Reference: `CreateStationDialog.component.tsx` for structure, `EditColumnDefinitionDialog.component.tsx` for field set.

### 2a: Define form schema and initial state

- Local `CreateColumnDefinitionFormSchema` validating `key` (regex + required), `label` (min 1), `type` (enum)
- `ColumnDefinitionFormState` interface with all 8 fields
- `INITIAL_FORM` constant with sensible defaults (`type: "string"`, `required: false`, rest empty)
- `validateForm` wrapper calling `validateWithSchema`

### 2b: Define props interface

```ts
export interface CreateColumnDefinitionDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: ColumnDefinitionCreateRequestBody) => void;
  isPending: boolean;
  serverError: ServerError | null;
}
```

### 2c: Implement component body

- `useState` for `form`, `errors`, `touched`
- `useDialogAutoFocus(open)` ref for `key` field (first field)
- `useEffect` to reset form/errors/touched when `open` changes
- `handleChange` — updates form, re-validates if field is touched
- `handleBlur` — marks field touched, validates
- `handleSubmit` — marks all validated fields touched, validates, calls `focusFirstInvalidField()` on error, builds body and calls `onSubmit`

### 2d: Implement JSX

- `<Modal>` with `slotProps.paper.component="form"` and `onSubmit` handler
- Fields in order: Key, Label, Type (select), Description (multiline), Required (switch), Default Value, Format, Enum Values (conditionally rendered when `type === "enum"`)
- All validated fields: `error`, `helperText`, `aria-invalid`, `required` props
- `<FormAlert serverError={serverError} />`
- Actions: Cancel (outlined, disabled when pending) + Create (contained, shows "Creating..." when pending)

### Checklist

- [x] `CreateColumnDefinitionFormSchema` validates `key` with regex `/^[a-z][a-z0-9_]*$/` and custom error message
- [x] `CreateColumnDefinitionFormSchema` validates `label` with `min(1)` and custom error message
- [x] `CreateColumnDefinitionFormSchema` validates `type` with `ColumnDataTypeEnum`
- [x] `INITIAL_FORM` defaults: `type: "string"`, `required: false`, all optional fields empty/`""`
- [x] Props interface matches `CreateColumnDefinitionDialogProps` definition above
- [x] `useDialogAutoFocus(open)` ref attached to `key` field (first interactive field)
- [x] `useEffect` resets `form`, `errors`, `touched` when `open` changes to `true`
- [x] `handleChange` re-validates only when `touched[field]` is true
- [x] `handleBlur` marks field as touched and runs validation
- [x] `handleSubmit` marks all schema-validated fields as touched before validating
- [x] `handleSubmit` calls `focusFirstInvalidField()` inside `requestAnimationFrame` on validation failure
- [x] `handleSubmit` does not call `onSubmit` when validation fails
- [x] `handleSubmit` builds body: trims strings, omits empty optional fields, converts empty strings to `null` for nullable fields
- [x] `handleSubmit` parses `enumValues` from comma-separated string to `string[]`
- [x] `<Modal>` uses `slotProps.paper.component="form"` with `onSubmit` handler calling `e.preventDefault()`
- [x] Key `<TextField>`: `required`, `error`, `helperText`, `aria-invalid` props bound to `touched`/`errors`
- [x] Label `<TextField>`: `required`, `error`, `helperText`, `aria-invalid` props bound to `touched`/`errors`
- [x] Type `<TextField select>`: renders all 11 `ColumnDataTypeEnum.options` as `<MenuItem>`
- [x] Description `<TextField>`: `multiline`, `rows={2}`, optional
- [x] Required: `<FormControlLabel>` with `<Switch>`, default unchecked
- [x] Default Value `<TextField>`: optional
- [x] Format `<TextField>`: optional
- [x] Enum Values `<TextField>`: conditionally rendered only when `type === "enum"`, helper text "Comma-separated values"
- [x] `<FormAlert serverError={serverError} />` rendered inside the form stack
- [x] Cancel button: `type="button"`, `variant="outlined"`, `disabled={isPending}`, calls `onClose`
- [x] Create button: `type="button"`, `variant="contained"`, `disabled={isPending}`, text toggles to `"Creating..."` when pending

### Verify

- [x] `npm run type-check` passes from repo root
- [x] File follows project naming convention: `CreateColumnDefinitionDialog.component.tsx`
- [x] Imports follow ordering convention (React → third-party → monorepo → local)

---

## Step 3: Integrate into `ColumnDefinitionList.view.tsx`

**File:** `apps/web/src/views/ColumnDefinitionList.view.tsx`

Reference: `Stations.view.tsx` container/UI split.

### 3a: Extract current component to `ColumnDefinitionListViewUI`

- Move existing JSX into a new `ColumnDefinitionListViewUI` component
- Accept props: `onCreateOpen`, `pagination`, `navigate`
- Add `primaryAction` to `<PageHeader>`:
  ```tsx
  primaryAction={
    <Button variant="contained" startIcon={<AddIcon />} onClick={onCreateOpen}>
      Create Column Definition
    </Button>
  }
  ```

### 3b: Create container `ColumnDefinitionListView`

- Import `useQueryClient` from `@tanstack/react-query`
- Import `sdk`, `queryKeys`, `toServerError` from SDK
- Import `CreateColumnDefinitionDialog`
- State: `createOpen` (boolean)
- Mutation: `sdk.columnDefinitions.create()`
- Callbacks:
  - `handleOpenCreate` — `setCreateOpen(true)`
  - `handleCreateClose` — `setCreateOpen(false)`
  - `handleCreateSubmit` — `createMutation.mutate(body, { onSuccess: close + invalidate })`
- Invalidation: `queryClient.invalidateQueries({ queryKey: queryKeys.columnDefinitions.root })`
- Render `<ColumnDefinitionListViewUI>` + `<CreateColumnDefinitionDialog>` with mutation state

### Checklist

- [x] `ColumnDefinitionListViewUI` extracted as a separate component in the same file
- [x] `ColumnDefinitionListViewUI` accepts `onCreateOpen` callback prop
- [x] `ColumnDefinitionListView` (container) is the default export / named export used by the route
- [x] `useQueryClient` imported from `@tanstack/react-query`
- [x] `sdk`, `queryKeys`, `toServerError` imported from `../api/sdk`
- [x] `CreateColumnDefinitionDialog` imported from `../components/CreateColumnDefinitionDialog.component`
- [x] `useState<boolean>` for `createOpen`, initialized to `false`
- [x] `sdk.columnDefinitions.create()` called at container top level (not inside callback)
- [x] `handleOpenCreate` wrapped in `useCallback`, sets `createOpen(true)`
- [x] `handleCreateClose` wrapped in `useCallback`, sets `createOpen(false)`
- [x] `handleCreateSubmit` wrapped in `useCallback`, calls `createMutation.mutate(body, { onSuccess })`
- [x] `onSuccess` callback: calls `handleCreateClose()` then `queryClient.invalidateQueries({ queryKey: queryKeys.columnDefinitions.root })`
- [x] `<PageHeader>` `primaryAction` renders a `<Button>` with Add icon and text "Create Column Definition"
- [x] `<CreateColumnDefinitionDialog>` rendered with props: `open={createOpen}`, `onClose={handleCreateClose}`, `onSubmit={handleCreateSubmit}`, `isPending={createMutation.isPending}`, `serverError={toServerError(createMutation.error)}`
- [x] Existing list rendering, pagination, filtering, and navigation logic unchanged

### Verify

- [x] `npm run type-check` passes from repo root
- [x] `npm run dev` — "Create Column Definition" button visible on `/column-definitions`
- [x] Clicking button opens the dialog
- [x] Submitting valid data closes dialog and list refreshes

---

## Step 4: Write tests for `CreateColumnDefinitionDialog`

**File (new):** `apps/web/src/__tests__/CreateColumnDefinitionDialog.test.tsx`

Pattern: Direct dynamic imports (no SDK mock needed — dialog is a pure presentational component accepting props). Follow `CreateStationDialog.test.tsx` exactly.

### Setup

```ts
import { jest } from "@jest/globals";

const { render, screen, fireEvent, waitFor } = await import("./test-utils");
const { CreateColumnDefinitionDialog } = await import(
  "../components/CreateColumnDefinitionDialog.component"
);

const defaultProps = {
  open: true,
  onClose: jest.fn(),
  onSubmit: jest.fn(),
  isPending: false,
  serverError: null,
};
```

### Test cases

| # | Test | What it verifies |
|---|------|------------------|
| 1 | should render 'New Column Definition' title | Dialog renders when `open={true}` |
| 2 | should render empty form fields with defaults | Key and label empty, type defaults to "string", required unchecked |
| 3 | should not render content when `open` is false | Dialog hidden when `open={false}` |
| 4 | should show key validation error when submitting empty key | `key` required validation fires, `onSubmit` not called |
| 5 | should show key format error for invalid key (uppercase, special chars) | Regex `/^[a-z][a-z0-9_]*$/` rejects `"Bad Key!"` |
| 6 | should show label required error when submitting empty label | `label` min(1) validation fires |
| 7 | should submit with correct payload for minimal valid form | `onSubmit` called with `{ key, label, type }` and defaults for optionals |
| 8 | should submit with all optional fields populated | `onSubmit` called with description, defaultValue, format, required, enumValues |
| 9 | should submit form on Enter key press (form submission) | `fireEvent.submit` on closest `<form>` triggers `onSubmit` |
| 10 | should call onClose when Cancel is clicked | `onClose` callback fires |
| 11 | should show 'Creating...' and disable buttons when pending | Button text changes, Cancel disabled |
| 12 | should display server error message and code via FormAlert | `<FormAlert>` renders with `serverError` prop |
| 13 | should not render FormAlert when serverError is null | No `role="alert"` element in DOM |
| 14 | should have `role='alert'` on FormAlert when server error is present | Accessibility: alert role present |
| 15 | should show field error on blur for key field | Focus then blur empty key — error appears |
| 16 | should show field error on blur for label field | Focus then blur empty label — error appears |
| 17 | should set `aria-invalid` on key field when validation fails | Accessibility: `aria-invalid="true"` after submit with empty key |
| 18 | should set `aria-invalid` on label field when validation fails | Accessibility: `aria-invalid="true"` after submit with empty label |
| 19 | should have `required` attribute on key and label fields | `expect(input).toBeRequired()` |
| 20 | should auto-link `aria-describedby` to helper text via MUI | After blur, `aria-describedby` attribute set on invalid field |
| 21 | should show enum values field only when type is "enum" | Field hidden for "string", visible after changing type to "enum" |
| 22 | should hide enum values field when type changes away from "enum" | Change type from "enum" to "string" — field disappears |

### Checklist

- [x] File uses `import { jest } from "@jest/globals"` (ESM pattern)
- [x] Dynamic imports for `test-utils` and component (top-level `await import`)
- [x] `defaultProps` defined with `open: true`, mock `onClose`/`onSubmit`, `isPending: false`, `serverError: null`
- [x] `beforeEach` calls `jest.clearAllMocks()`
- [x] Test #1: `screen.getByText("New Column Definition")` is in document
- [x] Test #2: Key and Label fields have empty values; type field shows "string"
- [x] Test #3: `screen.queryByText("New Column Definition")` is not in document when `open={false}`
- [x] Test #4: Click Create with empty key → validation error text visible, `onSubmit` not called
- [x] Test #5: Set key to `"Bad Key!"`, click Create → regex error message visible
- [x] Test #6: Set key to valid value, leave label empty, click Create → label error visible
- [x] Test #7: Fill key + label, click Create → `onSubmit` called with `{ key, label, type: "string" }`
- [x] Test #8: Fill all fields including description, defaultValue, format, enumValues (with type "enum"), required true → `onSubmit` called with full body
- [x] Test #9: Fill key + label, `fireEvent.submit` on `.closest("form")` → `onSubmit` called
- [x] Test #10: Click Cancel button → `onClose` called
- [x] Test #11: Render with `isPending: true` → "Creating..." button exists and is disabled, Cancel is disabled
- [x] Test #12: Render with `serverError: { message: "...", code: "..." }` → both message and code visible
- [x] Test #13: Render with `serverError: null` → `screen.queryByRole("alert")` is null
- [x] Test #14: Render with `serverError` → `screen.getByRole("alert")` is in document
- [x] Test #15: Focus then blur key field → error text appears (use `waitFor`)
- [x] Test #16: Focus then blur label field → error text appears (use `waitFor`)
- [x] Test #17: Click Create with empty key → key input has `aria-invalid="true"` (use `waitFor`)
- [x] Test #18: Click Create with empty label → label input has `aria-invalid="true"` (use `waitFor`)
- [x] Test #19: Key and label inputs pass `toBeRequired()` assertion
- [x] Test #20: Focus + blur key → input has `aria-describedby` attribute (use `waitFor`)
- [x] Test #21: Initially no "Enum Values" label; change type to "enum" → "Enum Values" label appears
- [x] Test #22: Set type to "enum" → enum field appears; change type away from "enum" → enum field disappears

### Verify

- [x] `npm run test -- --testPathPattern=CreateColumnDefinitionDialog` — all 22 tests pass
- [x] No SDK mocks needed (component is purely presentational)

---

## Step 5: Update existing `ColumnDefinitionListView` tests

**File:** `apps/web/src/__tests__/ColumnDefinitionListView.test.tsx`

The existing test mocks `sdk.columnDefinitions` with only `list`. After Step 3, the view also calls `sdk.columnDefinitions.create()`. The mock and tests must be updated.

### 5a: Update SDK mock

Add `create` to the mock to avoid runtime errors:

```ts
const noopMutation = { mutate: jest.fn(), isPending: false, error: null };

jest.unstable_mockModule("../api/sdk", () => ({
  sdk: {
    columnDefinitions: {
      list: () => currentListQuery,
      create: () => noopMutation,
    },
  },
  queryKeys: {
    columnDefinitions: { root: ["columnDefinitions"] },
  },
  toServerError: () => null,
}));
```

### 5b: Add new test cases

| # | Test | What it verifies |
|---|------|------------------|
| 1 | should render "Create Column Definition" button | Primary action button present in page header |
| 2 | should open create dialog when button is clicked | Click button → dialog title "New Column Definition" appears |

### Checklist

- [x] `noopMutation` defined with `mutate: jest.fn()`, `isPending: false`, `error: null`
- [x] `create: () => noopMutation` added to `sdk.columnDefinitions` mock
- [x] `queryKeys` added to mock with `columnDefinitions: { root: ["columnDefinitions"] }`
- [x] `toServerError: () => null` added to mock
- [x] Test #1: `screen.getByRole("button", { name: /Create Column Definition/ })` is in document (with loaded list query)
- [x] Test #2: Click the "Create Column Definition" button → `screen.getByText("New Column Definition")` appears
- [x] Existing test "should display loading state" still passes
- [x] Existing test "should display column definition cards with mock data" still passes
- [x] Existing test "should display empty state when no results" still passes
- [x] Existing test "should display error state" still passes
- [x] Existing test "should render filter button for type filter" still passes
- [x] Existing test "should render sort button" still passes
- [x] Existing test "should display sort options when sort button is clicked" still passes
- [x] Existing test "should render breadcrumbs with Dashboard link" still passes

### Verify

- [x] `npm run test -- --testPathPattern=ColumnDefinitionListView` — all 10 tests pass (8 existing + 2 new)
- [x] No existing test assertions were modified

---

## Step 6: Manual smoke test

- [x] Navigate to `/column-definitions`
- [x] "Create Column Definition" button is visible in the page header
- [x] Click button — dialog opens with "New Column Definition" title
- [x] First field (Key) is auto-focused
- [x] Submit empty form — validation errors appear on key and label
- [x] Enter invalid key (`"Bad Key!"`) — regex format error shown
- [x] Enter valid key (`"customer_name"`) and label (`"Customer Name"`) — submit succeeds
- [x] Dialog closes after successful creation
- [x] New column definition appears in the list without manual refresh
- [x] Change type to "enum" — enum values field appears
- [x] Change type away from "enum" — enum values field disappears
- [x] Submit with `type: "enum"` and comma-separated enum values — values saved correctly
- [x] Trigger duplicate key conflict — server error displayed in `<FormAlert>`
- [x] Cancel button closes dialog without submitting
- [x] Reopen dialog after close — form fields are reset to defaults

---

## Verification Criteria

All of the following must pass before the feature is considered complete:

```bash
# 1. Type checking — no compilation errors across the monorepo
npm run type-check

# 2. Linting — no lint errors or warnings introduced
npm run lint

# 3. All tests — full suite passes (existing + new)
npm run test

# 4. Targeted test runs — new and modified test files pass in isolation
npm run test -- --testPathPattern=CreateColumnDefinitionDialog
npm run test -- --testPathPattern=ColumnDefinitionListView

# 5. Build — production build succeeds
npm run build
```

### Checklist

- [x] `npm run type-check` exits with code 0
- [x] `npm run lint` exits with code 0, no new warnings
- [x] `npm run test` exits with code 0, all suites pass
- [x] `npm run test -- --testPathPattern=CreateColumnDefinitionDialog` — 22 tests pass
- [x] `npm run test -- --testPathPattern=ColumnDefinitionListView` — 10 tests pass (8 existing + 2 new)
- [x] `npm run test -- --testPathPattern=ColumnDefinition.component` — existing tests pass (no regression)
- [x] `npm run test -- --testPathPattern=ColumnDefinitionDetailView` — existing tests pass (no regression)
- [x] `npm run test -- --testPathPattern=DeleteColumnDefinitionDialog` — existing tests pass (no regression)
- [x] `npm run build` exits with code 0
- [x] No existing test assertions were modified to make them pass
