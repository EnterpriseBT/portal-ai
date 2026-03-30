# UI/UX Audit — Implementation Plan

**Source:** [UI-UX.audit.md](./UI-UX.audit.md)
**Branch:** `feat/uiux-audit`
**Date:** 2026-03-30

---

## Phasing Strategy

The work is split into 5 phases ordered by dependency and priority. Each phase is independently shippable and must pass verification before moving to the next.

| Phase | Focus | Depends On |
|-------|-------|------------|
| 1 | Shared `ServerError` type + `FormAlert` component | — |
| 2 | `<form>` wrappers, Enter key submission, autoFocus | — |
| 3 | Zod schema validation on all forms | Phase 1 (FormAlert) |
| 4 | Missing error surfaces + accessibility hardening | Phase 1, Phase 2 |
| 5 | Query cache invalidation after mutations/deletions | — |

---

## Phase 1 — ServerError Type & FormAlert Component

Introduce a structured `ServerError` type that carries both `message` and `code`, and a reusable `FormAlert` component that replaces all ad-hoc error Typography.

### Checklist

- [x] **1.1** Create `ServerError` type and `toServerError` helper in `apps/web/src/utils/api.util.ts` (with `UNKNOWN_CODE` fallback)

- [x] **1.2** Create `FormAlert` component at `apps/web/src/components/FormAlert.component.tsx`

- [x] **1.3** Write unit test `apps/web/src/__tests__/FormAlert.test.tsx`

- [x] **1.4** Update `serverError` prop type across dialog components from `string | null` to `ServerError | null`:
  - `CreateStationDialog.component.tsx`
  - `EditStationDialog.component.tsx`
  - `CreatePortalDialog.component.tsx`
  - `TagFormModal.component.tsx`
  - `EntityGroups.view.tsx` (inline `CreateGroupDialog`)

- [x] **1.5** Replace inline `<Typography color="error">` with `<FormAlert>` in each dialog listed in 1.4

- [x] **1.6** Update all parent views to pass structured error via `toServerError()`:
  - `views/Stations.view.tsx` — `createMutation`
  - `views/StationDetail.view.tsx` — `updateMutation`
  - `views/Dashboard.view.tsx` — `createMutation`
  - `views/Tags.view.tsx` — `activeMutation`
  - `views/EntityGroups.view.tsx` — `createMutation`

- [x] **1.7** Update existing tests and stories to use the new `ServerError` shape:
  - `CreateStationDialog.test.tsx`
  - `EditStationDialog.test.tsx`
  - `CreatePortalDialog.test.tsx`
  - `TagFormModal.test.tsx`
  - `TagFormModal.component.stories.tsx`

### Verification

```bash
npm run type-check
npm run lint
npm run test -- --filter=web
npm run build
```

---

## Phase 2 — `<form>` Wrappers, Enter Key Submission & AutoFocus

Wrap every data-submission surface in a `<form onSubmit>` element and ensure the primary field is auto-focused on mount.

### Checklist

- [ ] **2.1** Wrap `CreateStationDialog` content in `<form onSubmit>`:
  - `<form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}>` around DialogContent + DialogActions
  - Change submit `<Button>` to `type="submit"`
  - Keep cancel `<Button>` as `type="button"` to prevent Enter triggering cancel

- [ ] **2.2** Wrap `EditStationDialog` — same pattern as 2.1

- [ ] **2.3** Wrap `CreatePortalDialog`:
  - Same `<form>` pattern
  - Add `autoFocus` to the station `Autocomplete`'s `TextField` via `renderInput` props

- [ ] **2.4** Wrap `TagFormModal`:
  - Same `<form>` pattern
  - Confirm `autoFocus` on name field (already present)

- [ ] **2.5** Wrap `EditConnectorInstanceDialog` — same pattern

- [ ] **2.6** Wrap `DeleteStationDialog`:
  - `<form onSubmit>` around confirmation content
  - Delete `<Button>` becomes `type="submit"`

- [ ] **2.7** Wrap `DeletePortalDialog` — same pattern as 2.6

- [ ] **2.8** Wrap `DeleteConnectorInstanceDialog` — same pattern as 2.6

- [ ] **2.9** Wrap `DeleteTagDialog` — same pattern as 2.6

- [ ] **2.10** Wrap `EntityGroupDetail` add-member dialog (if rendered as a dialog) in `<form>`

- [ ] **2.11** Wrap `CSVConnector ReviewStep` confirm action in `<form>`

- [ ] **2.12** Update `EntityGroups.view.tsx` create-group dialog:
  - Wrap in `<form>`
  - Ensure `autoFocus` on name field

- [ ] **2.13** Update tests — any test that renders a dialog and simulates button clicks should also test Enter key submission:
  - For each dialog test file, add a test case: "submits form on Enter key press"
  - Verify that `onSubmit` callback fires when user presses Enter in a text field

### Verification

```bash
npm run type-check
npm run lint
npm run test -- --filter=web
npm run build
```

---

## Phase 3 — Zod Schema Validation

Replace all manual validation functions with Zod `safeParse()` using the existing contract schemas from `@portalai/core`.

### Schema Mapping

| Form | Contract Schema | Package Path |
|------|----------------|--------------|
| CreateStationDialog | `CreateStationBodySchema` | `@portalai/core/contracts/station.contract` |
| EditStationDialog | `UpdateStationBodySchema` | `@portalai/core/contracts/station.contract` |
| CreatePortalDialog | `CreatePortalBodySchema` | `@portalai/core/contracts/portal.contract` |
| TagFormModal (create) | `EntityTagCreateRequestBodySchema` | `@portalai/core/contracts/entity-tag.contract` |
| TagFormModal (edit) | `EntityTagUpdateRequestBodySchema` | `@portalai/core/contracts/entity-tag.contract` |
| EditConnectorInstanceDialog | (name field — use inline `z.object({ name: z.string().trim().min(1) })`) | N/A |
| EntityGroups create dialog | `EntityGroupCreateRequestBodySchema` | `@portalai/core/contracts/entity-group.contract` |
| EntityGroupDetail (name edit) | `EntityGroupUpdateRequestBodySchema` | `@portalai/core/contracts/entity-group.contract` |

### Checklist

- [ ] **3.1** Create shared validation utility `apps/web/src/utils/form-validation.util.ts`:
  ```ts
  import { ZodSchema, ZodError } from "zod";

  export function validateWithSchema<T>(
    schema: ZodSchema<T>,
    data: unknown
  ): { success: true; data: T } | { success: false; errors: Record<string, string> } {
    const result = schema.safeParse(data);
    if (result.success) return { success: true, data: result.data };
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".");
      if (!errors[key]) errors[key] = issue.message;
    }
    return { success: false, errors };
  }
  ```

- [ ] **3.2** Write unit tests for `validateWithSchema` in `apps/web/src/__tests__/form-validation.util.test.ts`:
  - Returns `{ success: true, data }` for valid input
  - Returns `{ success: false, errors }` with field-keyed messages for invalid input
  - Handles nested paths (e.g., `"address.city"`)
  - First error per field wins (no duplicates)

- [ ] **3.3** Refactor `CreateStationDialog` validation:
  - Import `CreateStationBodySchema` from `@portalai/core`
  - Replace manual `validateForm()` with `validateWithSchema(CreateStationBodySchema, formData)`
  - Map Zod error keys to `touched` state for field-level display
  - Preserve existing `onBlur` / `onChange` touched behavior

- [ ] **3.4** Refactor `EditStationDialog` validation — same approach with `UpdateStationBodySchema`

- [ ] **3.5** Refactor `CreatePortalDialog` validation — use `CreatePortalBodySchema`

- [ ] **3.6** Refactor `TagFormModal` validation:
  - Use `EntityTagCreateRequestBodySchema` for create mode
  - Use `EntityTagUpdateRequestBodySchema` for edit mode
  - The hex color regex validation in the Zod schema replaces the manual regex check

- [ ] **3.7** Refactor `EditConnectorInstanceDialog` validation:
  - Define a minimal inline schema: `z.object({ name: z.string().trim().min(1, "Name is required") })`
  - Or use the existing pattern if a contract schema exists

- [ ] **3.8** Add validation to `EntityGroups.view.tsx` create dialog — use `EntityGroupCreateRequestBodySchema`

- [ ] **3.9** Add validation to `EntityGroupDetail.view.tsx` inline name edit — use `EntityGroupUpdateRequestBodySchema`

- [ ] **3.10** Add `required` prop to all MUI TextFields that correspond to required Zod fields (adds `aria-required` automatically)

- [ ] **3.11** Update existing dialog test files to verify:
  - Validation errors appear for empty required fields on submit attempt
  - Validation errors clear when field is corrected
  - Form does not call `onSubmit` when validation fails

### Verification

```bash
npm run type-check
npm run lint
npm run test -- --filter=web
npm run test -- --filter=core   # ensure contract schemas still pass
npm run build
```

---

## Phase 4 — Missing Error Surfaces & Accessibility

Add `serverError` display to all forms that currently swallow errors, and apply accessibility attributes across all form fields.

### 4A — Missing Error Surfaces

- [ ] **4A.1** Add `serverError` prop (type `ServerError | null`) to `DeleteStationDialog`:
  - Add `<FormAlert>` inside the dialog
  - Update `views/Stations.view.tsx` to pass `toServerError(deleteMutation.error)`

- [ ] **4A.2** Add `serverError` prop to `DeletePortalDialog`:
  - Add `<FormAlert>` inside the dialog
  - Update `views/Portal.view.tsx` to pass `toServerError(removeMutation.error)`

- [ ] **4A.3** Add `serverError` prop to `DeleteTagDialog`:
  - Add `<FormAlert>` inside the dialog
  - Update `views/Tags.view.tsx` to pass `toServerError(deleteMutation.error)`

- [ ] **4A.4** Add error display to `EntityGroupDetail.view.tsx`:
  - Surface `updateMutation.error` on inline name edit (show `<FormAlert>` below the field)
  - Surface `addMemberMutation.error` in the add-member dialog
  - Surface `deleteMutation.error` in the delete confirmation

- [ ] **4A.5** Add error display to `views/Portal.view.tsx` rename dialog:
  - Surface `renameMutation.error` via `<FormAlert>`

- [ ] **4A.6** Add error display to `views/ConnectorInstance.view.tsx` delete dialog:
  - Surface `deleteMutation.error` via `<FormAlert>`

- [ ] **4A.7** Update tests for each dialog above:
  - Test that `<FormAlert>` renders when `serverError` is provided
  - Test that error code is visible in the rendered output

### 4B — Accessibility Hardening

- [ ] **4B.1** Add `aria-invalid` to all form TextFields:
  - Pattern: `inputProps={{ "aria-invalid": touched[field] && !!errors[field] }}`
  - Apply to every `<TextField>` in: CreateStationDialog, EditStationDialog, CreatePortalDialog, TagFormModal, EditConnectorInstanceDialog, EntityGroups create dialog

- [ ] **4B.2** Verify `aria-describedby` is automatically linked via MUI `helperText`:
  - MUI TextField auto-generates `aria-describedby` when `helperText` is set — confirm this in rendered output
  - No manual work needed if using `helperText` for error messages (which all dialogs already do)

- [ ] **4B.3** Add `aria-label` to all icon-only `<IconButton>` components:
  - Audit all files importing `IconButton` from MUI
  - Add descriptive `aria-label` (e.g., `aria-label="Delete station"`, `aria-label="Edit name"`)
  - Files to audit:
    - `views/Stations.view.tsx`
    - `views/StationDetail.view.tsx`
    - `views/Tags.view.tsx`
    - `views/EntityGroupDetail.view.tsx`
    - `views/ConnectorInstance.view.tsx`
    - `views/EntityDetail.view.tsx`
    - `views/Portal.view.tsx`
    - `views/PinnedResultDetail.view.tsx`
    - `components/AdvancedFilterBuilder.component.tsx`
    - Any other files found via `grep -r "IconButton" apps/web/src/`

- [ ] **4B.4** Add focus-to-first-error on validation failure:
  - After `handleSubmit` validation fails, call `.focus()` on the first invalid field
  - Pattern: assign `ref` to the first required field, call `ref.current?.focus()` when errors exist
  - Apply to: CreateStationDialog, EditStationDialog, TagFormModal

- [ ] **4B.5** Write accessibility-focused tests:
  - Test that `aria-invalid="true"` appears on fields with errors
  - Test that `aria-required="true"` appears on required fields (via MUI `required` prop)
  - Test that `role="alert"` exists on `<FormAlert>` output

### Verification

```bash
npm run type-check
npm run lint
npm run test -- --filter=web
npm run build
```

---

## Phase 5 — Query Cache Invalidation After Mutations & Deletions

Ensure that every mutation (create, update, delete) invalidates the correct set of query keys so that list views, detail views, and dependent entities reflect the latest server state without a manual refresh.

### Current Gaps

| Mutation | Location | Missing Invalidation | Impact |
|----------|----------|----------------------|--------|
| Delete Connector Instance | `ConnectorInstance.view.tsx` | `connectorEntities.root`, `stations.root` | Deleted instance's entities and station links remain in cache |
| Delete Connector Instance | `Connector.view.tsx` | `connectorEntities.root`, `stations.root` | Same — duplicate delete path |
| Delete Portal | `Portal.view.tsx` | `portalResults.root` | Pinned results from deleted portal remain visible |
| Pin Result | `PortalMessage.component.tsx` | `portalResults.root` | Newly pinned result not reflected in pinned results list |
| Unpin Result | `PortalMessage.component.tsx` | `portalResults.root` | Unpinned result still appears in pinned results list |
| Delete Station | `StationDetail.view.tsx` | `portals.root` | Portals linked to deleted station may show stale data |

### Checklist

#### 5A — Connector Instance Cascade

- [ ] **5A.1** `views/ConnectorInstance.view.tsx` — after delete mutation succeeds, also invalidate:
  - `queryKeys.connectorEntities.root`
  - `queryKeys.stations.root`
  - `queryKeys.fieldMappings.root`

- [ ] **5A.2** `views/Connector.view.tsx` — same invalidation additions for its delete mutation

- [ ] **5A.3** Write test: after connector instance delete, verify `invalidateQueries` is called with `connectorEntities.root` and `stations.root`

#### 5B — Portal / Portal Results

- [ ] **5B.1** `views/Portal.view.tsx` — after portal delete (`removeMutation`), also invalidate:
  - `queryKeys.portalResults.root`

- [ ] **5B.2** `components/PortalMessage.component.tsx` — after pin result mutation succeeds, invalidate:
  - `queryKeys.portalResults.root`

- [ ] **5B.3** `components/PortalMessage.component.tsx` — after unpin result succeeds, invalidate:
  - `queryKeys.portalResults.root`

- [ ] **5B.4** Write tests: verify `portalResults.root` is invalidated after pin, unpin, and portal delete operations

#### 5C — Station Cascade

- [ ] **5C.1** `views/StationDetail.view.tsx` — after station delete, also invalidate:
  - `queryKeys.portals.root` (portals reference stations)

- [ ] **5C.2** Verify `views/Stations.view.tsx` station delete already invalidates `stations.root`, `organizations.root`, and `portalResults.root` (confirmed — no change needed)

#### 5D — Audit Remaining Mutations

- [ ] **5D.1** Audit all `onSuccess` callbacks to confirm every mutation invalidates at minimum its own entity's `.root` query key
- [ ] **5D.2** Confirm delete operations that cascade on the backend also cascade their invalidations on the frontend — cross-reference with API cascade behavior in Drizzle schema

### Verification

```bash
npm run type-check
npm run lint
npm run test -- --filter=web
npm run build
```

---

## Full Verification (Post All Phases)

Run the complete suite from the monorepo root after all phases are merged:

```bash
npm run type-check          # TypeScript across all packages
npm run lint                # ESLint across monorepo
npm run test                # Jest tests across monorepo (web, api, core)
npm run build               # Production build all packages
```

### Manual Smoke Tests

- [ ] Open each dialog form → press Enter with valid data → confirm submission fires
- [ ] Submit each dialog with empty required fields → confirm validation errors appear with field highlighting
- [ ] Trigger a server error (e.g., duplicate tag name) → confirm `<Alert>` shows message + error code
- [ ] Tab through each dialog with keyboard only → confirm all fields and buttons are reachable
- [ ] Run screen reader (or browser accessibility inspector) on a dialog → confirm `aria-invalid`, `aria-required`, and `role="alert"` are present
