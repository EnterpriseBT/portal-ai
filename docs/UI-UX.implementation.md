# UI/UX Audit — Implementation Plan

**Source:** [UI-UX.audit.md](./UI-UX.audit.md)
**Branch:** `feat/uiux-audit`
**Date:** 2026-03-30

---

## Phasing Strategy

The work is split into 6 phases ordered by dependency and priority. Each phase is independently shippable and must pass verification before moving to the next.

| Phase | Focus | Depends On |
|-------|-------|------------|
| 1 | Shared `ServerError` type + `FormAlert` component | — |
| 2 | `<form>` wrappers, Enter key submission, autoFocus | — |
| 3 | Zod schema validation on all forms | Phase 1 (FormAlert) |
| 4 | Missing error surfaces + accessibility hardening | Phase 1, Phase 2 |
| 5 | Query cache invalidation after mutations/deletions | — |
| 6 | AI agent documentation updates (`CLAUDE.md`) | Phases 1–5 (codifies established patterns) |

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

- [x] **2.1** Wrap `CreateStationDialog` — `slotProps.paper` renders Dialog Paper as `<form>` with `onSubmit` handler

- [x] **2.2** Wrap `EditStationDialog` — same pattern

- [x] **2.3** Wrap `CreatePortalDialog` — same pattern + added `autoFocus` to station Autocomplete's TextField

- [x] **2.4** Wrap `TagFormModal` — same pattern (autoFocus already present on name field)

- [x] **2.5** Wrap `EditConnectorInstanceDialog` — same pattern

- [x] **2.6** Wrap `DeleteStationDialog` — same pattern

- [x] **2.7** Wrap `DeletePortalDialog` — same pattern

- [x] **2.8** Wrap `DeleteConnectorInstanceDialog` — same pattern

- [x] **2.9** Wrap `DeleteTagDialog` — same pattern

- [x] **2.10** Wrap `EntityGroupDetail` add-member dialog — native `<form>` wrapper around Dialog content

- [x] **2.11** Wrap `CSVConnector ReviewStep` — native `<form>` wrapper around review form content

- [x] **2.12** `EntityGroups.view.tsx` create-group dialog — already had `<form>` + autoFocus; added `type="button"` to Cancel

- [x] **2.13** Added Enter key submission tests to 8 test files:
  - `CreateStationDialog.test.tsx`, `EditStationDialog.test.tsx`, `TagFormModal.test.tsx`
  - `EditConnectorInstanceDialog.test.tsx`, `DeleteStationDialog.test.tsx`, `DeleteTagDialog.test.tsx`
  - `DeleteConnectorInstanceDialog.test.tsx`, `ReviewStep.test.tsx`

**Implementation note:** Used `slotProps.paper.component="form"` for Modal-based dialogs (renders MUI Dialog Paper as a `<form>`) and native `<form>` wrappers for raw MUI Dialog usage. Button click handlers (`onClick`) are preserved on action buttons (`type="button"`) for backward compatibility; form `onSubmit` handles Enter key submission only — no double-firing.

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

- [x] **3.0** Added `zod` `^4.3.6` as explicit dependency to `apps/web/package.json` (matches `@portalai/core` version)

- [x] **3.1** Created `apps/web/src/utils/form-validation.util.ts` with `validateWithSchema<T>()` utility and `FormErrors` type

- [x] **3.2** Unit tests in `apps/web/src/__tests__/form-validation.util.test.ts` — 4 test cases covering success, field errors, nested paths, first-error-wins

- [x] **3.3** `CreateStationDialog` — replaced manual `validateForm` with `StationFormSchema` (Zod `z.object`) + `validateWithSchema`

- [x] **3.4** `EditStationDialog` — same refactor with `EditStationFormSchema`

- [x] **3.5** `CreatePortalDialog` — added `CreatePortalBodySchema.safeParse()` validation at submit time

- [x] **3.6** `TagFormModal` — replaced manual validation with `TagFormSchema` (Zod `z.object` with hex color `.refine()`) + `validateWithSchema`

- [x] **3.7** `EditConnectorInstanceDialog` — added `EditNameSchema` with Zod validation, error display via `helperText`, and touched/blur behavior

- [x] **3.8** `EntityGroups.view.tsx` create dialog — added `EntityGroupCreateRequestBodySchema` validation with touched/blur error display on name field

- [x] **3.9** `EntityGroupDetail.view.tsx` inline name edit — replaced manual `trim()` check with `EntityGroupUpdateRequestBodySchema.safeParse()`

- [x] **3.10** All required TextFields already have `required` prop (confirmed: CreateStation, EditStation, TagForm, EditConnectorInstance, EntityGroups create)

- [x] **3.11** Existing tests already cover validation (empty submit blocked, errors appear, onSubmit not called) — all tests pass

- [x] **3.12** CSVConnector EntityStep (Step 2) — entity key and label fields now required with Zod validation:
  - Created `csv-validation.util.ts` with `EntityFieldSchema`, `validateEntityStep()`, and `EntityStepErrors` type
  - `EntityStep` accepts `errors` prop, displays field-level errors on key/label TextInputs
  - Container validates on "Next" click; blocks navigation if errors exist

- [x] **3.13** CSVConnector ColumnMappingStep (Step 3) — column key, label, and type fields now required:
  - `BaseColumnSchema` validates key, label, type as required
  - `ReferenceColumnSchema` extends base — requires refEntityKey and refColumnKey/refColumnDefinitionId when type is `reference` or `reference-array`
  - Format and enum fields remain optional
  - `ColumnMappingStep` and `ColumnRow` accept `errors`/`fieldErrors` props with per-entity per-column error display
  - `ReferenceEditor` accepts `fieldErrors` and shows errors on Reference Entity and Reference Column selects
  - Container validates on "Next" click; blocks navigation if errors exist

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

- [x] **4A.1** Add `serverError` prop (type `ServerError | null`) to `DeleteStationDialog`:
  - Add `<FormAlert>` inside the dialog
  - Update `views/Stations.view.tsx` to pass `toServerError(deleteMutation.error)`

- [x] **4A.2** Add `serverError` prop to `DeletePortalDialog`:
  - Add `<FormAlert>` inside the dialog
  - Update `views/Portal.view.tsx` to pass `toServerError(removeMutation.error)`

- [x] **4A.3** Add `serverError` prop to `DeleteTagDialog`:
  - Add `<FormAlert>` inside the dialog
  - Update `views/Tags.view.tsx` to pass `toServerError(deleteMutation.error)`

- [x] **4A.4** Add error display to `EntityGroupDetail.view.tsx`:
  - Surface `updateMutation.error` on inline name edit (show `<FormAlert>` below the field)
  - Surface `addMemberMutation.error` in the add-member dialog
  - Surface `deleteMutation.error` in the delete confirmation

- [x] **4A.5** Add error display to `views/Portal.view.tsx` rename dialog:
  - Surface `renameMutation.error` via `<FormAlert>`

- [x] **4A.6** Add error display to `views/ConnectorInstance.view.tsx` delete dialog:
  - Surface `deleteMutation.error` via `<FormAlert>`

- [x] **4A.7** Update tests for each dialog above:
  - Test that `<FormAlert>` renders when `serverError` is provided
  - Test that error code is visible in the rendered output

### 4B — Accessibility Hardening

- [x] **4B.1** Add `aria-invalid` to all form TextFields:
  - Pattern: `slotProps={{ htmlInput: { "aria-invalid": touched[field] && !!errors[field] } }}`
  - Applied to every validated `<TextField>` in: CreateStationDialog, EditStationDialog, TagFormModal, EditConnectorInstanceDialog, EntityGroups create dialog, EntityGroupDetail edit dialog, CSVConnector ReviewStep

- [x] **4B.2** Verify `aria-describedby` is automatically linked via MUI `helperText`:
  - MUI TextField auto-generates `aria-describedby` when `helperText` is set — confirmed via test in CreateStationDialog
  - No manual work needed — all dialogs use `helperText` for error messages

- [x] **4B.3** Add `aria-label` to all icon-only `<IconButton>` components:
  - Audited all files importing `IconButton` from MUI and `@portalai/core/ui`
  - Added descriptive `aria-label` to all icon-only buttons:
    - `components/AdvancedFilterBuilder.component.tsx` — "Remove filter group", "Remove filter condition"
    - `components/EntityRecordFieldValue.component.tsx` — "Copy value"
    - `components/ConnectorEntity.component.tsx` — "Collapse/Expand field mappings"
    - `components/ConnectorInstance.component.tsx` — "Delete connector instance"
    - `components/ChatWindow.component.tsx` — "Exit", "Cancel", "Reset", "Submit"
    - `components/PaginationToolbar.component.tsx` — "Clear search", "First/Previous/Next/Last page"
    - `components/PinnedResultsList.component.tsx` — "Unpin result"
    - `components/PortalCard.component.tsx` — "Delete portal"
  - Already had `aria-label`: StationList, TagCard, SidebarNavToggle, HeaderMenu, ThemeSwitcher, PortalMessage, EntityGroupDetail

- [x] **4B.4** Add focus-and-scroll-to-first-error on validation failure:
  - Created `focusFirstInvalidField()` utility in `form-validation.util.ts`
  - Queries `[aria-invalid="true"]`, falls back to `.Mui-error input`, scrolls into view, and focuses
  - Applied to all 10 validation paths: CreateStationDialog, EditStationDialog, TagFormModal, EditConnectorInstanceDialog, CreatePortalDialog, EntityGroupDetail edit dialog, EntityGroups create dialog, Portal rename dialog, CSVConnector entity step, CSVConnector column step, CSVConnector review step

- [x] **4B.5** Write accessibility-focused tests:
  - `aria-invalid="true"` tested in: CreateStationDialog, EditStationDialog, TagFormModal, EditConnectorInstanceDialog, ReviewStep
  - `required` attribute tested in: CreateStationDialog, EditStationDialog, TagFormModal, EditConnectorInstanceDialog, ReviewStep
  - `role="alert"` tested in: FormAlert, CreateStationDialog
  - `aria-describedby` auto-link tested in: CreateStationDialog

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

## Phase 6 — AI Agent Documentation Updates

Update the repository's AI agent instructions (`CLAUDE.md`) to codify the form validation, error handling, and accessibility standards established in Phases 1–5 so that all future AI-generated code follows these patterns by default.

### 6.1 — Form & Dialog Standards (CLAUDE.md)

- [ ] **6.1.1** Add a **"Form & Dialog Pattern"** section to `CLAUDE.md` documenting the required structure for all data-submission dialogs:
  - Every dialog that submits data **must** be wrapped in a `<form onSubmit>` element
  - For `Modal`-based dialogs: use `slotProps.paper.component="form"` with `onSubmit` handler
  - For raw MUI `Dialog`: wrap `DialogContent` + `DialogActions` in a native `<form>`
  - Action buttons must use `type="button"` to prevent double-firing with form submission
  - The first interactive field must receive auto-focus via `useDialogAutoFocus(open)` (or `autoFocus` prop for simple text fields)

- [ ] **6.1.2** Document the **`serverError` prop contract** — every dialog that triggers a mutation must:
  - Accept a `serverError?: ServerError | null` prop
  - Render `<FormAlert serverError={serverError} />` inside the dialog content
  - The parent view must pass `toServerError(mutation.error)` from `utils/api.util.ts`

- [ ] **6.1.3** Document the **Zod validation pattern** — every form with user input must:
  - Validate via `validateWithSchema(Schema, data)` from `utils/form-validation.util.ts` using the matching `@portalai/core/contracts` schema
  - Maintain `touched` and `errors` state; show errors only after blur or submit
  - Block submission when validation fails (never call `onSubmit` with invalid data)

### 6.2 — Accessibility Standards (CLAUDE.md)

- [ ] **6.2.1** Add an **"Accessibility Requirements"** section to `CLAUDE.md`:
  - All `<TextField>` with validation must include `error={touched[field] && !!errors[field]}` and `helperText={touched[field] && errors[field]}` (MUI auto-links `aria-describedby`)
  - All icon-only `<IconButton>` components must have a descriptive `aria-label`
  - `<FormAlert>` uses MUI `<Alert>` which provides `role="alert"` automatically — do not add custom alert roles
  - Searchable select components (`AsyncSearchableSelect`, `SearchableSelect`, etc.) accept `inputRef` for focus management

### 6.3 — Workflow Stepper Validation (CLAUDE.md)

- [ ] **6.3.1** Extend the existing **"Workflow Module Pattern"** section in `CLAUDE.md` to include validation rules:
  - Each step that collects user input must define a Zod schema in `utils/<feature>.util.ts`
  - The container must call the step's validation function before advancing to the next step (`onNext`)
  - If validation fails, the step must display per-field errors and block navigation
  - Reference implementation: `workflows/CSVConnector/utils/csv-validation.util.ts`

### 6.4 — Query Cache Invalidation (CLAUDE.md)

- [ ] **6.4.1** Add a **"Mutation Cache Invalidation"** section to `CLAUDE.md`:
  - Every mutation's `onSuccess` callback must invalidate at minimum its own entity's `.root` query key
  - Delete operations that cascade on the backend must also invalidate downstream entity query keys on the frontend (e.g., deleting a station must invalidate `portals.root` and `portalResults.root`)
  - Use `queryClient.invalidateQueries({ queryKey: queryKeys.<entity>.root })` — never manually remove or update cache entries

### 6.5 — Test Requirements (CLAUDE.md)

- [ ] **6.5.1** Add a **"Dialog & Form Test Checklist"** to `CLAUDE.md` — every new dialog must have tests covering:
  - Renders title and content when `open={true}`
  - Does not render when `open={false}`
  - Calls `onSubmit`/`onConfirm` on button click
  - Supports Enter key submission (form submit event)
  - Calls `onClose` on Cancel click
  - Shows loading state when `isPending={true}`
  - Renders `<FormAlert>` when `serverError` is provided
  - Does not render `<FormAlert>` when `serverError` is null
  - Displays field-level validation errors on invalid submit

### Verification

```bash
# No code changes — documentation only. Verify CLAUDE.md is well-formed:
cat CLAUDE.md | head -300
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
