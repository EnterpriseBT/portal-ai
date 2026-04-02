# Create Entity — Implementation Plan

> **Spec doc:** [CREATE_ENTITY.spec.md](./CREATE_ENTITY.spec.md) — covers full feature specification, component APIs, and test plan.
> **Discovery doc:** [CREATE_ENTITY.discovery.md](./CREATE_ENTITY.discovery.md) — covers existing infrastructure and gap analysis.

---

## Phase 1: API — Capability filter on connector instances

Add a server-side `capability` query parameter to `GET /api/connector-instances` so the frontend can request only writable instances without client-side filtering.

### Step 1a: Contract — add `capability` to query schema

**File:** `packages/core/src/contracts/connector-instance.contract.ts`

- Add `capability: z.string().optional()` to `ConnectorInstanceListRequestQuerySchema`

#### Checklist

- [x] `capability: z.string().optional()` added to `ConnectorInstanceListRequestQuerySchema`
- [x] No other schemas in the file were modified
- [x] `ConnectorInstanceListRequestQuery` type automatically includes `capability` (inferred from schema)

### Step 1b: Router — parse and filter by capability

**File:** `apps/api/src/routes/connector-instance.router.ts`

- Destructure `capability` from the parsed query alongside existing params
- After existing filter construction (`connectorDefinitionId`, `status`, `search`), add:
  - Split `capability` on comma, trim, filter to valid names (`read`, `write`, `sync`)
  - For each valid capability, push a SQL condition using Drizzle's `sql` template:
    ```ts
    sql`${connectorInstances.enabledCapabilityFlags}->>'${sql.raw(cap)}' = 'true'`
    ```
- Only the allowlisted capability names (`read`, `write`, `sync`) are interpolated via `sql.raw`; invalid values are silently dropped

#### Checklist

- [x] `capability` destructured from `ConnectorInstanceListRequestQuerySchema.parse(req.query)`
- [x] Valid capabilities allowlist: `["read", "write", "sync"]`
- [x] Each valid capability produces a SQL condition: `enabled_capability_flags->>'<cap>' = 'true'`
- [x] Invalid capability values are silently ignored (no error thrown)
- [x] Multiple capabilities are ANDed (e.g. `?capability=read,write` requires both)
- [x] `sql` import added from `drizzle-orm`
- [x] Existing filters (`connectorDefinitionId`, `status`, `search`) are unchanged
- [x] OpenAPI JSDoc updated with new `capability` query parameter documentation

### Step 1c: Integration tests for capability filter

**File:** `apps/api/src/__tests__/__integration__/routes/connector-instance.router.integration.test.ts`

Added 3 test cases to the `GET /api/connector-instances` describe block:

| # | Test | What it verifies |
|---|------|------------------|
| 1 | `capability=write` returns only writable instances | Single capability filter; excludes `write: false` and `null` flags |
| 2 | `capability=write,sync` requires both flags | AND logic across multiple capabilities |
| 3 | `capability=write,bogus` ignores invalid values | Invalid capabilities are silently dropped |

#### Checklist

- [x] Test uses existing `createConnectorInstance` helper with `enabledCapabilityFlags` overrides
- [x] Test #1: 3 instances (writable, read-only, null flags) → only writable returned
- [x] Test #2: 3 instances (read+write, write+sync, all) → only write+sync and all returned
- [x] Test #3: 2 instances (writable, read-only) with `capability=write,bogus` → only writable returned, no error

### Verify

- [x] `npm run type-check` passes from repo root
- [x] `npm run lint` passes from repo root (0 errors, 2 pre-existing warnings)
- [x] `npm run build` passes from repo root
- [x] `npm run test` passes from repo root (no regressions)
- [x] Connector instance router integration tests: 36 passed (33 existing + 3 new)

---

## Phase 2: Frontend SDK — add `create` mutation for connector entities

**File:** `apps/web/src/api/connector-entities.api.ts`

- Import `ConnectorEntityCreateRequestBody` and `ConnectorEntityCreateResponsePayload` from `@portalai/core/contracts`
- Add `create` method to the `connectorEntities` object:
  ```ts
  create: () =>
    useAuthMutation<ConnectorEntityCreateResponsePayload, ConnectorEntityCreateRequestBody>({
      url: "/api/connector-entities",
      method: "POST",
    }),
  ```

### Checklist

- [x] `ConnectorEntityCreateRequestBody` import added
- [x] `ConnectorEntityCreateResponsePayload` import added
- [x] `create` method added with `url: "/api/connector-entities"` and `method: "POST"`
- [x] Method signature matches existing create patterns (e.g. `stations.api.ts`, `connector-instances.api.ts`)
- [x] No other methods in the file were modified

### Verify

- [x] `npm run type-check` passes from repo root
- [x] `npm run lint` passes from repo root

---

## Phase 3: Create the `CreateConnectorEntityDialog` component

**File (new):** `apps/web/src/components/CreateConnectorEntityDialog.component.tsx`

Reference: `CreateStationDialog.component.tsx` for structure, `CREATE_ENTITY.spec.md` Section 4 for full API.

### Step 3a: Define form schema and initial state

- Local `EntityFormSchema` validating:
  - `label`: `z.string().trim().min(1, "Label is required")`
  - `key`: `z.string().regex(/^[a-z][a-z0-9_]*$/, "Key must start with a lowercase letter and contain only lowercase letters, numbers, and underscores")`
  - `connectorInstanceId`: `z.string().min(1, "Connector instance is required")`
- `EntityFormState` interface: `{ label: string; key: string; connectorInstanceId: string }`
- `INITIAL_FORM` constant: all fields empty string
- `validateForm` wrapper calling `validateWithSchema`

### Step 3b: Define props interface

```ts
export interface CreateConnectorEntityDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (body: ConnectorEntityCreateRequestBody) => void;
  isPending: boolean;
  serverError: ServerError | null;
  lockedConnectorInstance: { id: string; name: string } | null;
}
```

### Step 3c: Implement component body

- `useState` for `form`, `errors`, `touched`
- `useDialogAutoFocus(open)` ref for Label field (first field)
- `useEffect` to reset form/errors/touched when `open` changes — if `lockedConnectorInstance` is provided, set `connectorInstanceId` to `lockedConnectorInstance.id`
- `handleChange` — updates form, re-validates if field is touched
- `handleBlur` — marks field touched, validates
- `handleSubmit` — marks all fields touched, validates, calls `focusFirstInvalidField()` on error, builds body and calls `onSubmit`
- Connector instance data: when `lockedConnectorInstance` is `null`, fetch writable instances via `sdk.connectorInstances.list({ capability: "write", limit: 100, sortBy: "name", sortOrder: "asc" })` and map to `{ value: ci.id, label: ci.name }[]`

### Step 3d: Implement JSX

- `<Modal>` with `slotProps.paper.component="form"` and `onSubmit` handler
- Title: `"New Entity"`
- Fields in order:
  1. **Label** — `TextField`, `inputRef={labelRef}`, `required`, `fullWidth`, standard `error`/`helperText`/`aria-invalid`
  2. **Key** — `TextField`, `required`, `fullWidth`, standard validation props
  3. **Connector Instance** — conditional rendering:
     - `lockedConnectorInstance` is `null`: MUI `Autocomplete` with writable instances, single-select, standard validation props on `renderInput`
     - `lockedConnectorInstance` is set: `TextField` with `value={lockedConnectorInstance.name}`, `disabled`, `fullWidth`
  4. **FormAlert** — `<FormAlert serverError={serverError} />`
- Actions: Cancel (`type="button"`, outlined, disabled when pending) + Create (`type="button"`, contained, shows "Creating..." when pending)

### Checklist

- [x] `EntityFormSchema` validates `label` with `trim().min(1)` and custom error message
- [x] `EntityFormSchema` validates `key` with regex `/^[a-z][a-z0-9_]*$/` and custom error message
- [x] `EntityFormSchema` validates `connectorInstanceId` with `min(1)` and custom error message
- [x] `INITIAL_FORM` defaults: all fields empty string `""`
- [x] Props interface matches `CreateConnectorEntityDialogProps` with `lockedConnectorInstance` prop
- [x] `useDialogAutoFocus(open)` ref attached to Label field (first interactive field)
- [x] `useEffect` resets `form`, `errors`, `touched` when `open` changes to `true`
- [x] `useEffect` sets `connectorInstanceId` to `lockedConnectorInstance.id` when provided
- [x] `handleChange` re-validates only when `touched[field]` is true
- [x] `handleBlur` marks field as touched and runs validation
- [x] `handleSubmit` marks all fields as touched before validating
- [x] `handleSubmit` calls `focusFirstInvalidField()` inside `requestAnimationFrame` on validation failure
- [x] `handleSubmit` does not call `onSubmit` when validation fails
- [x] `handleSubmit` trims `label` before submitting
- [x] `<Modal>` uses `slotProps.paper.component="form"` with `onSubmit` calling `e.preventDefault()`
- [x] Modal title is `"New Entity"`
- [x] Label `<TextField>`: `inputRef={labelRef}`, `required`, `error`, `helperText`, `aria-invalid` bound to `touched`/`errors`
- [x] Key `<TextField>`: `required`, `error`, `helperText`, `aria-invalid` bound to `touched`/`errors`
- [x] When `lockedConnectorInstance` is `null`: `Autocomplete` renders with options from `sdk.connectorInstances.list({ capability: "write" })`
- [x] When `lockedConnectorInstance` is `null`: `Autocomplete` `renderInput` has `required`, `error`, `helperText`, `aria-invalid`
- [x] When `lockedConnectorInstance` is provided: `TextField` renders with `value={lockedConnectorInstance.name}` and `disabled`
- [x] `<FormAlert serverError={serverError} />` rendered inside the form stack
- [x] Cancel button: `type="button"`, `variant="outlined"`, `disabled={isPending}`, calls `onClose`
- [x] Create button: `type="button"`, `variant="contained"`, `disabled={isPending}`, text toggles to `"Creating..."` when pending

### Verify

- [x] `npm run type-check` passes from repo root
- [x] `npm run lint` passes from repo root (0 errors, pre-existing warnings only)
- [x] File follows project naming convention: `CreateConnectorEntityDialog.component.tsx`
- [x] Imports follow ordering convention (React → third-party → monorepo → local)

---

## Phase 4: Wire into Entities view

**File:** `apps/web/src/views/Entities.view.tsx`

Reference: `CREATE_ENTITY.spec.md` Section 5.

### Step 4a: Update `EntitiesViewUI` props and JSX

- Add `onCreate: () => void` to `EntitiesViewUIProps`
- Add `primaryAction` to `<PageHeader>`:
  ```tsx
  primaryAction={
    <Button variant="contained" onClick={onCreate}>
      Create Entity
    </Button>
  }
  ```

### Step 4b: Wire mutation in `EntitiesView` container

- Import `CreateConnectorEntityDialog` and `ConnectorEntityCreateRequestBody`
- Add `createOpen` state (`useState<boolean>(false)`)
- Add `createMutation` via `sdk.connectorEntities.create()`
- `handleCreateClose`: set `createOpen(false)`, call `createMutation.reset()`
- `handleCreateSubmit`: call `createMutation.mutate(body, { onSuccess })` where `onSuccess` calls `handleCreateClose()` and `queryClient.invalidateQueries({ queryKey: queryKeys.connectorEntities.root })`
- Pass `onCreate={() => setCreateOpen(true)}` to `EntitiesViewUI`
- Render `<CreateConnectorEntityDialog>` with:
  - `open={createOpen}`
  - `onClose={handleCreateClose}`
  - `onSubmit={handleCreateSubmit}`
  - `isPending={createMutation.isPending}`
  - `serverError={toServerError(createMutation.error)}`
  - `lockedConnectorInstance={null}`

### Checklist

- [x] `onCreate: () => void` added to `EntitiesViewUIProps`
- [x] `EntitiesViewUI` accepts and uses `onCreate` prop
- [x] `<PageHeader>` has `primaryAction` with "Create Entity" `<Button>`
- [x] `CreateConnectorEntityDialog` imported
- [x] `useState<boolean>` for `createOpen`, initialized to `false`
- [x] `sdk.connectorEntities.create()` called at container top level
- [x] `handleCreateClose` wrapped in `useCallback`, resets `createOpen` and calls `createMutation.reset()`
- [x] `handleCreateSubmit` wrapped in `useCallback`, calls `createMutation.mutate` with `onSuccess`
- [x] `onSuccess` invalidates `queryKeys.connectorEntities.root`
- [x] `<CreateConnectorEntityDialog>` rendered with all required props
- [x] `lockedConnectorInstance={null}` passed (connector instance is selectable)
- [x] Existing list rendering, pagination, filtering, delete dialog logic unchanged

### Verify

- [x] `npm run type-check` passes from repo root
- [x] `npm run lint` passes from repo root (0 errors, pre-existing warnings only)
- [x] `npm run build` passes from repo root

---

## Phase 5: Wire into Connector Instance view

**File:** `apps/web/src/views/ConnectorInstance.view.tsx`

Reference: `CREATE_ENTITY.spec.md` Section 6.

### Step 5a: Add state and mutation

- Import `CreateConnectorEntityDialog` and `ConnectorEntityCreateRequestBody`
- Add `createEntityOpen` state (`useState<boolean>(false)`)
- Add `createEntityMutation` via `sdk.connectorEntities.create()`

### Step 5b: Add handlers

- `handleCreateEntityClose`: set `createEntityOpen(false)`, call `createEntityMutation.reset()`
- `handleCreateEntitySubmit`: call `createEntityMutation.mutate(body, { onSuccess })` where `onSuccess` calls `handleCreateEntityClose()` and `queryClient.invalidateQueries({ queryKey: queryKeys.connectorEntities.root })`

### Step 5c: Update Entities PageSection

- Add `primaryAction` to the Entities `<PageSection>`:
  ```tsx
  primaryAction={
    <Button variant="contained" size="small" onClick={() => setCreateEntityOpen(true)}>
      Create Entity
    </Button>
  }
  ```

### Step 5d: Render dialog

- Render `<CreateConnectorEntityDialog>` alongside existing dialogs with:
  - `open={createEntityOpen}`
  - `onClose={handleCreateEntityClose}`
  - `onSubmit={handleCreateEntitySubmit}`
  - `isPending={createEntityMutation.isPending}`
  - `serverError={toServerError(createEntityMutation.error)}`
  - `lockedConnectorInstance={{ id: connectorInstanceId, name: ci.name }}`

### Checklist

- [x] `CreateConnectorEntityDialog` imported
- [x] `ConnectorEntityCreateRequestBody` type imported (used in handler signature)
- [x] `useState<boolean>` for `createEntityOpen`, initialized to `false`
- [x] `sdk.connectorEntities.create()` called at component top level
- [x] `handleCreateEntityClose` wrapped in `useCallback`, resets state and calls `createEntityMutation.reset()`
- [x] `handleCreateEntitySubmit` wrapped in `useCallback`, calls `createEntityMutation.mutate` with `onSuccess`
- [x] `onSuccess` invalidates `queryKeys.connectorEntities.root`
- [x] Entities `<PageSection>` has `primaryAction` with "Create Entity" `<Button>` (size `"small"`)
- [x] `<CreateConnectorEntityDialog>` rendered with all required props
- [x] `lockedConnectorInstance` passes `{ id: connectorInstanceId, name: ci.name }`
- [x] Existing detail rendering, pagination, delete/edit dialogs unchanged

### Verify

- [x] `npm run type-check` passes from repo root
- [x] `npm run lint` passes from repo root (0 errors, pre-existing warnings only)
- [x] `npm run build` passes from repo root

---

## Phase 6: Tests for `CreateConnectorEntityDialog`

**File (new):** `apps/web/src/__tests__/CreateConnectorEntityDialog.test.tsx`

Pattern: ESM dynamic imports with `jest.unstable_mockModule` to mock `useAuthFetch` (the dialog uses `AsyncSearchableSelect` with `useAuthFetch` internally). Follow `CreateStationDialog.test.tsx` for structure.

### Setup

- Mock `../utils/api.util` with `useAuthFetch` returning a `mockFetchWithAuth` that resolves to writable connector instances
- `defaultProps` with `open: true`, mock `onClose`/`onSubmit`, `isPending: false`, `serverError: null`, `lockedConnectorInstance: null`
- `lockedProps` with `lockedConnectorInstance: { id: "ci-1", name: "My Connector" }`

### Test cases

#### 6a: Rendering

| # | Test | What it verifies |
|---|------|------------------|
| 1 | Renders dialog title "New Entity" and all fields when `open={true}` | Dialog visible with Label, Key, Connector Instance fields |
| 2 | Does not render dialog content when `open={false}` | Dialog hidden |

#### 6b: Submission

| # | Test | What it verifies |
|---|------|------------------|
| 3 | Calls `onSubmit` with `{ label, key, connectorInstanceId }` on Create button click | Happy path with unlocked connector instance |
| 4 | Calls `onSubmit` on Enter key (form submit event) | Form submission via keyboard |
| 5 | Does not call `onSubmit` when validation fails | Blocked by validation errors |

#### 6c: Cancel / Close

| # | Test | What it verifies |
|---|------|------------------|
| 6 | Calls `onClose` on Cancel button click | Close handler fires |

#### 6d: Loading state

| # | Test | What it verifies |
|---|------|------------------|
| 7 | Create button shows "Creating..." and both buttons are disabled when `isPending={true}` | Loading feedback |

#### 6e: Server errors

| # | Test | What it verifies |
|---|------|------------------|
| 8 | Renders `<FormAlert>` with error message when `serverError` is provided | Server error display |
| 9 | Does not render `<FormAlert>` when `serverError` is `null` | No false alert |

#### 6f: Field validation

| # | Test | What it verifies |
|---|------|------------------|
| 10 | Shows "Label is required" when label is empty on submit | Label required validation |
| 11 | Shows key format error when key is `"BadKey!"` | Regex validation with user-friendly message |
| 12 | Shows "Connector instance is required" when no instance selected (unlocked mode) | Connector instance required validation |
| 13 | `aria-invalid="true"` set on each invalid field after failed submit | Accessibility |
| 14 | `required` attribute present on Label, Key, and Connector Instance inputs | Accessibility |

#### 6g: Locked connector instance

| # | Test | What it verifies |
|---|------|------------------|
| 15 | When `lockedConnectorInstance` provided, field displays instance name and is disabled | Locked mode rendering |
| 16 | When `lockedConnectorInstance` provided, `onSubmit` payload uses locked ID | Correct ID in payload |
| 17 | When `lockedConnectorInstance` is `null`, connector instance field is enabled and selectable | Unlocked mode rendering |

### Checklist

- [x] File uses `import { jest } from "@jest/globals"` (ESM pattern)
- [x] `jest.unstable_mockModule` used for `../utils/api.util` mock (`useAuthFetch` with `mockFetchWithAuth`)
- [x] Dynamic imports for `test-utils` and component (top-level `await import`)
- [x] `defaultProps` defined with `lockedConnectorInstance: null`
- [x] `lockedProps` defined with `lockedConnectorInstance: { id: "ci-1", name: "My Connector" }`
- [x] `beforeEach` calls `jest.clearAllMocks()`
- [x] Test #1: `screen.getByText("New Entity")` is in document; Label, Key, Connector Instance fields present
- [x] Test #2: `screen.queryByText("New Entity")` is not in document when `open={false}`
- [x] Test #3: Fill all fields, click Create → `onSubmit` called with correct payload
- [x] Test #4: Fill all fields, `fireEvent.submit` on closest `<form>` → `onSubmit` called
- [x] Test #5: Click Create with empty fields → `onSubmit` not called
- [x] Test #6: Click Cancel → `onClose` called
- [x] Test #7: Render with `isPending: true` → "Creating..." visible, both buttons disabled
- [x] Test #8: Render with `serverError` → error message visible via `role="alert"`
- [x] Test #9: Render with `serverError: null` → `queryByRole("alert")` is null
- [x] Test #10: Submit with empty label → "Label is required" visible
- [x] Test #11: Set key to `"BadKey!"`, submit → key format error visible
- [x] Test #12: Submit with no connector instance selected → "Connector instance is required" visible
- [x] Test #13: Submit with empty fields → `aria-invalid="true"` on invalid inputs
- [x] Test #14: Label, Key inputs have `required` attribute
- [x] Test #15: Render with `lockedProps` → field shows "My Connector" and is disabled
- [x] Test #16: Render with `lockedProps`, fill label + key, submit → `onSubmit` payload has `connectorInstanceId: "ci-1"`
- [x] Test #17: Render with `defaultProps` → connector instance field is enabled

### Verify

- [x] `npm run test -- --testPathPattern=CreateConnectorEntityDialog` — all 17 tests pass
- [x] `npm run lint` passes from repo root

---

## Phase 7: Update existing view tests (if applicable)

Check whether existing tests for `Entities.view.tsx` or `ConnectorInstance.view.tsx` need SDK mock updates to avoid runtime errors from the new `sdk.connectorEntities.create()` call.

### Step 7a: Update Entities view tests

**File:** `apps/web/src/__tests__/EntitiesView.test.tsx`

- Added `onCreate: jest.fn()` to `sharedProps` since `EntitiesViewUIProps` now requires it (fixed during build fix)

### Step 7b: Update Connector Instance view tests

No `ConnectorInstanceView` test file exists — only `DeleteConnectorInstanceDialog.test.tsx` and `EditConnectorInstanceDialog.test.tsx`, which are unaffected (they test standalone dialog components, not the view).

### Checklist

- [x] All existing tests for both views still pass without modification to assertions
- [x] `onCreate: jest.fn()` added to Entities view test `sharedProps` to satisfy new required prop
- [x] No Connector Instance view test file exists — no updates needed

### Verify

- [x] `EntitiesView` tests: 8 passed (all existing, no regressions)
- [x] `ConnectorInstance` tests: 25 passed across dialog test files (no regressions)

---

## Phase 8: Final verification

All of the following must pass before the feature is considered complete:

```bash
# 1. Type checking — no compilation errors across the monorepo
npm run type-check

# 2. Linting — no lint errors or warnings introduced
npm run lint

# 3. All tests — full suite passes (existing + new)
npm run test

# 4. Targeted test runs — new and modified test files pass in isolation
npm run test -- --testPathPattern=CreateConnectorEntityDialog
npm run test -- --testPathPattern=Entities
npm run test -- --testPathPattern=ConnectorInstance

# 5. Build — production build succeeds
npm run build
```

### Checklist

- [x] `npm run type-check` exits with code 0
- [x] `npm run lint` exits with code 0, no new warnings
- [x] `npm run test` exits with code 0, all 94 suites pass (1214 tests)
- [x] `npm run test -- --testPathPattern=CreateConnectorEntityDialog` — 17 tests pass
- [x] `npm run build` exits with code 0
- [x] No existing test assertions were modified to make them pass

### Manual smoke test

- [x] `npm run dev` — app starts without errors
- [x] Navigate to `/entities` — "Create Entity" button visible in page header
- [x] Click button — dialog opens with title "New Entity", Label field auto-focused
- [x] Connector Instance dropdown loads only writable instances
- [x] Submit empty form — validation errors on all three fields
- [x] Enter invalid key (`"Bad Key!"`) — regex format error shown
- [x] Enter valid key (`"contacts"`), label (`"Contacts"`), select instance — submit succeeds
- [x] Dialog closes, entity appears in list without manual refresh
- [x] Navigate to a connector instance detail page (`/connectors/:id`)
- [x] "Create Entity" button visible in Entities section
- [x] Click button — dialog opens with connector instance field pre-filled and disabled
- [x] Fill label + key, submit — entity created under that connector instance
- [x] Dialog closes, entity appears in the Entities section without manual refresh
- [x] Trigger a server error (e.g. duplicate key) — error displayed in `<FormAlert>`
- [x] Cancel button closes dialog without submitting
- [x] Reopen dialog after close — form fields are reset
