# Column Binding Overrides — TDD Implementation Plan

> Companion to `BINDING_OVERRIDES.spec.md`. Step-by-step TDD-ordered tasks.

## Context

The review step's binding chips are currently read-only; users can't rebind a column, tweak its `FieldMapping` knobs (normalized key, required, format, enum values, reference target) or omit a column from the committed entity without leaving the workflow to edit `ColumnDefinition` rows. This plan restores that capability from the deprecated upload workflow, in the new plan-driven architecture, across the parser schema, the commit reconciler, and the review-step UI.

Phases:

- **Phase 1** — Extend `ColumnBindingSchema` + pass the new fields through the `preserveUserRegionConfig` round-trip and `planRegionsToDrafts` / `regionDraftsToHints` mappers. No UI yet; pure plumbing with tests.
- **Phase 2** — Teach `reconcileFieldMappings` to honor the overrides and skip excluded bindings. Add `LAYOUT_PLAN_INVALID_REFERENCE` + `LAYOUT_PLAN_DUPLICATE_NORMALIZED_KEY`.
- **Phase 3** — Workflow hook actions (`onUpdateBinding`, `onToggleBindingExcluded`). No UI yet.
- **Phase 4** — `BindingEditorPopover` module component + wiring into `RegionReviewCardUI` / `ReviewStepUI`.
- **Phase 5** — Container integration in `FileUploadConnectorWorkflow` + stories + accessibility polish.
- **Phase 6** — Validation rules, excluded-chip styling, and regression tests.

Each step follows TDD: failing test → just-enough implementation → verify prior tests still pass via `npm run test:unit`.

---

# Phase 1 — Schema + round-trip plumbing

## Step 1 — Extend `ColumnBindingSchema`

**File**: `packages/spreadsheet-parsing/src/plan/strategies.schema.ts`

### 1a. Tests — `packages/spreadsheet-parsing/src/plan/__tests__/schemas.test.ts`

Add cases under the existing binding schema block:

```
describe("ColumnBindingSchema — user overrides")
  - accepts a binding with no override fields (baseline still valid)
  - accepts `excluded: true` with no columnDefinitionId fallback required
  - accepts valid normalizedKey (`^[a-z][a-z0-9_]*$`)
  - rejects invalid normalizedKey ("Foo", "1_bar", "foo-bar")
  - accepts required / defaultValue / format / enumValues / refEntityKey / refNormalizedKey with nullable semantics
  - preserves unknown keys off (schema .strict optional — match the existing stance)
```

### 1b. Implementation

Add the new optional fields per spec. No change to `RegionSchema.superRefine` — cross-field binding validation lives in commit, not in the Zod schema, so stale plans don't fail parse.

### 1c. Verify

```
npm --prefix packages/spreadsheet-parsing run test
```

## Step 2 — Extend frontend `ColumnBindingDraft`

**File**: `apps/web/src/modules/RegionEditor/utils/region-editor.types.ts`

### 2a. Implementation (no new tests — type-only)

Add `excluded`, `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues`, `refEntityKey`, `refNormalizedKey`, and `columnDefinitionType`.

### 2b. Verify

```
npm --prefix apps/web run type-check
```

## Step 3 — Round-trip the overrides through `planRegionsToDrafts` + `preserveUserRegionConfig`

**File**: `apps/web/src/workflows/FileUploadConnector/utils/layout-plan-mapping.util.ts`

### 3a. Tests — extend `__tests__/layout-plan-mapping.util.test.ts`

```
describe("planRegionsToDrafts — binding overrides")
  - copies excluded, normalizedKey, required, defaultValue, format, enumValues, refEntityKey, refNormalizedKey from each binding onto the resulting draft

describe("preserveUserRegionConfig — binding overrides")
  - carries binding-level overrides from prior drafts onto the plan, matching by serialized sourceLocator
  - preserves a user's columnDefinitionId override if prior draft differs from plan
  - leaves non-overridden fields as interpret returned them
  - drops the prior override when the prior binding no longer exists in the returned plan
```

### 3b. Implementation

- Update `bindingToDraft` to copy every new field.
- Add a helper `serializeLocator(locator)` already exists; extract `indexPriorBindings(region)` to build the `Map<string, ColumnBindingDraft>` used by the merge.
- Extend `preserveUserRegionConfig`'s region-merge to also build merged `columnBindings` via the map lookup. When `prior.columnDefinitionId` differs, prefer it (user rebind wins over classifier).

### 3c. Verify

```
npm --prefix apps/web run test:unit -- --testPathPattern=layout-plan-mapping
```

---

# Phase 2 — Commit reconciler

## Step 4 — Add new API codes

**File**: `apps/api/src/constants/api-codes.constants.ts`

Add:
```
LAYOUT_PLAN_INVALID_REFERENCE = "LAYOUT_PLAN_INVALID_REFERENCE",
LAYOUT_PLAN_DUPLICATE_NORMALIZED_KEY = "LAYOUT_PLAN_DUPLICATE_NORMALIZED_KEY",
```

No standalone test — the codes assert themselves in Step 5's tests.

## Step 5 — `reconcileFieldMappings` honors overrides + skips excluded

**File**: `apps/api/src/services/field-mappings/reconcile.ts`

### 5a. Tests — `apps/api/src/__tests__/__integration__/services/field-mappings/reconcile.integration.test.ts` (new)

Use the existing integration-test scaffolding (Postgres test container). Seed an org + `ColumnDefinition` catalog (including one `reference`-typed column pointing at a known target entity). Cases:

```
describe("reconcileFieldMappings — overrides")
  - writes defaults when no overrides are set (baseline — matches today's behavior)
  - honors binding.normalizedKey over catalog.key
  - honors binding.required / defaultValue / format / enumValues over hardcoded defaults
  - skips excluded bindings — no FieldMapping row written for them
  - soft-deletes an existing mapping whose binding was flipped to excluded on a re-commit
  - rejects a binding.normalizedKey that violates the regex -> throws ApiError(LAYOUT_PLAN_INVALID_PAYLOAD)
  - rejects two bindings sharing the same normalizedKey in the same region -> LAYOUT_PLAN_DUPLICATE_NORMALIZED_KEY

describe("reconcileFieldMappings — reference validation")
  - accepts binding.refEntityKey pointing at a sibling staged entity in the same commit
  - accepts binding.refEntityKey pointing at an existing org ConnectorEntity.key
  - rejects a reference-typed binding with null refEntityKey -> LAYOUT_PLAN_INVALID_REFERENCE
  - rejects refEntityKey that resolves to nothing in the org -> LAYOUT_PLAN_INVALID_REFERENCE
  - rejects refNormalizedKey that doesn't exist on the target entity -> LAYOUT_PLAN_INVALID_REFERENCE
```

### 5b. Implementation

- Parameterise `reconcileFieldMappings` with `allStagedEntityKeys: Set<string>` (sibling regions in the same commit) computed at call-time by the caller in `layout-plan-commit.service.ts`.
- Filter out `excluded` bindings up front.
- Validate normalized-key regex + uniqueness before any writes.
- Validate reference targets before writing; resolve against the staged set OR `connectorEntities.findByKey`.
- When building the upsert payload, read overrides with catalog fallbacks per spec.

### 5c. Verify

```
npm --prefix apps/api run test:integration -- --testPathPattern=reconcile
```

---

# Phase 3 — Workflow hook actions

## Step 6 — `onToggleBindingExcluded` + `onUpdateBinding`

**File**: `apps/web/src/workflows/FileUploadConnector/utils/file-upload-workflow.util.ts`

### 6a. Tests — extend `__tests__/file-upload-workflow.util.test.ts`

```
describe("useFileUploadWorkflow — binding edits")
  - onToggleBindingExcluded flips the flag on the matching binding in regions AND in plan
  - onUpdateBinding merges the patch onto the matching binding in regions AND in plan
  - mutating a binding on a region with no plan-side counterpart is a no-op (no plan yet)
  - preserves untouched bindings on other regions
  - matching is by serialized sourceLocator (handles both byHeaderName and byColumnIndex)
```

### 6b. Implementation

Add two `useCallback`-wrapped actions that `setState((prev) => ...)`:

- Locate the region by `regionId` (no-op if missing).
- For the region, locate the binding by serialised locator (no-op if missing).
- Produce a new `regions` array + a new `plan` with the matching region's `columnBindings` updated.

Both actions route through a shared helper `patchBinding(prev, regionId, sourceLocator, patch)` to avoid duplication.

### 6c. Verify

```
npm --prefix apps/web run test:unit -- --testPathPattern=file-upload-workflow
```

---

# Phase 4 — Review-step binding editor UI

## Step 7 — `BindingEditorPopover` module component

**New file**: `apps/web/src/modules/RegionEditor/BindingEditorPopover.component.tsx`

Pure UI only (`…UI` + container split per `CLAUDE.md` §Component File Policy). Initially only the UI variant; the stateful popover shell (anchor, open/close) lives in the caller — see Step 8.

### 7a. Tests — `__tests__/BindingEditorPopover.test.tsx`

```
describe("BindingEditorPopoverUI — rendering")
  - renders the source locator header (e.g. "Column 2" for byColumnIndex)
  - renders the ColumnDefinition picker with the current id selected
  - shows the resolved type chip + description when columnDefinitionType is supplied
  - hides reference editor when type is not reference / reference-array
  - hides enumValues input when type is not "enum"
  - when excluded is true: disables the picker, hides per-type editors, shows "Excluded" alert

describe("BindingEditorPopoverUI — interaction")
  - editing normalizedKey fires onChange with the new value
  - toggling Omit fires onChangeExcluded
  - Apply fires onApply with the composed patch
  - Cancel fires onCancel
  - Enter submits (via form) when the draft is valid
  - Escape fires onCancel

describe("BindingEditorPopoverUI — validation")
  - shows a per-field error when normalizedKey violates the regex
  - shows the serverError alert via FormAlert when passed
  - Apply disabled while invalid
```

### 7b. Implementation

Props (UI variant):
```ts
interface BindingEditorPopoverUIProps {
  binding: ColumnBindingDraft;
  columnDefinitionType?: ColumnDataType;
  columnDefinitionDescription?: string | null;
  columnDefinitionSearch: SearchResult<SelectOption>;
  referenceOptions?: SelectOption[];                 // resolved by container
  referenceFieldOptions?: SelectOption[];            // dependent on refEntityKey
  draft: ColumnBindingDraft;                         // live edit buffer
  errors: FormErrors;
  serverError: ServerError | null;
  onChange: (patch: Partial<ColumnBindingDraft>) => void;
  onApply: () => void;
  onCancel: () => void;
}
```

Wrap content in `<form onSubmit>` per Form & Dialog Pattern; Apply is `type="submit"`, Cancel/Omit-toggle are `type="button"`. Auto-focus the first field via `useDialogAutoFocus(open)`. Render inside MUI `Popover` with `role="dialog"`.

### 7c. Verify

```
npm --prefix apps/web run test:unit -- --testPathPattern=BindingEditorPopover
```

## Step 8 — `RegionReviewCardUI` renders the chips + hosts the popover

**File**: `apps/web/src/modules/RegionEditor/RegionReviewCard.component.tsx`

### 8a. Tests — extend `__tests__/RegionReviewCard.test.tsx` (new if missing)

```
describe("RegionReviewCardUI — chip affordance")
  - excluded binding renders dimmed with an "Excluded" pill and strikethrough label
  - clicking a non-excluded chip calls onEditBinding(sourceLocator)
  - clicking an excluded chip calls onEditBinding(sourceLocator) (lets user re-enable)
  - click target has aria-label that includes "Excluded" for excluded chips
```

### 8b. Implementation

- Excluded styling: `sx={{ opacity: 0.5, textDecoration: "line-through" }}`.
- Small "Excluded" `MuiChip` alongside the label.
- `aria-label` reflects state.

The popover anchor and open/close live in `ReviewStepUI`, not per-card — one popover instance keyed on `{regionId, sourceLocator}`. This keeps the card presentational and the editor a single well-known DOM node.

### 8c. Verify

```
npm --prefix apps/web run test:unit -- --testPathPattern=RegionReviewCard
```

## Step 9 — `ReviewStepUI` mounts the popover + routes events

**File**: `apps/web/src/modules/RegionEditor/ReviewStep.component.tsx`

### 9a. Tests — extend `__tests__/ReviewStep.test.tsx` (new if missing)

```
describe("ReviewStepUI — binding editor")
  - clicking a chip opens the popover anchored at the chip
  - Apply fires onUpdateBinding(regionId, sourceLocator, patch) then closes
  - Omit toggle fires onToggleBindingExcluded(regionId, sourceLocator, true) and keeps the popover open
  - Cancel closes the popover without firing onUpdateBinding
  - blocker validation from any binding disables the Commit button with a descriptive reason
```

### 9b. Implementation

Add local state `editing: { regionId, sourceLocator } | null`. Derive `editingBinding` from `regions`. Render one `<BindingEditorPopover>` controlled by that state. Pass through the new props (`onToggleBindingExcluded`, `onUpdateBinding`, `columnDefinitionSearch`, `connectorEntitySearch`). When props are unset, fall back to the legacy "jump to region" behavior so existing consumers compile.

### 9c. Verify

```
npm --prefix apps/web run test:unit -- --testPathPattern=ReviewStep
```

---

# Phase 5 — Container integration + stories

## Step 10 — Wire `FileUploadConnectorWorkflow` container

**File**: `apps/web/src/workflows/FileUploadConnector/FileUploadConnectorWorkflow.component.tsx`

### 10a. Tests — extend `__tests__/FileUploadConnectorWorkflow.test.tsx` and add an integration-flavoured test

```
describe("FileUploadConnectorWorkflow — binding overrides end-to-end")
  - opens the binding editor from the review step, applies a normalizedKey override, and commits the plan containing that override
  - marks a binding as excluded and commits a plan with excluded=true on that binding
  - chooses a different ColumnDefinition via the search select and commits with the new columnDefinitionId
```

Mocks: `sdk.columnDefinitions.search` returning a canned list; `sdk.layoutPlans.commit` asserting the payload shape.

### 10b. Implementation

Provide:
- `columnDefinitionSearch`: from `sdk.columnDefinitions.search` hook.
- `connectorEntitySearch`: from `sdk.connectorEntities.search` hook.
- Pass `workflow.onToggleBindingExcluded` and `workflow.onUpdateBinding` through.
- Extend the `columnDefinitionLabelMap` path (already in place after earlier work) to also expose `columnDefinitionType` and `columnDefinitionDescription` — so the popover can show the type chip.

### 10c. Verify

```
npm --prefix apps/web run test:unit -- --testPathPattern=FileUploadConnectorWorkflow
npm --prefix apps/web run type-check
```

## Step 11 — Stories

**Files**: `modules/RegionEditor/stories/ReviewStep.stories.tsx`, `modules/RegionEditor/stories/BindingEditorPopover.stories.tsx` (new).

Cover:
- Default binding editor (string column).
- Reference-typed column (shows reference editor, staged + DB options).
- Enum-typed column (shows enum-values input).
- Excluded state (dimmed chip + opened popover shows un-exclude affordance).
- Validation error on `normalizedKey`.
- Server-error alert path.

No test assertions — stories are the manual visual check.

---

# Phase 6 — Validation + polish

## Step 12 — Extend `region-editor-validation.util.ts`

**File**: `apps/web/src/modules/RegionEditor/utils/region-editor-validation.util.ts`

### 12a. Tests — extend `__tests__/region-editor-validation.util.test.ts`

```
describe("validateRegion — binding overrides")
  - flags normalizedKey violating the regex
  - flags reference-typed bindings with no refEntityKey
  - does NOT flag excluded bindings for missing columnDefinitionId / refEntityKey
  - flags two bindings in the same region with the same normalizedKey override
  - rolls up into RegionEditorErrors.columnBindings[sourceLocator][field]
```

### 12b. Implementation

Add a `BindingDraftSchema` that mirrors the backend schema's override fields. Add a cross-binding refinement inside `validateRegion` that detects normalized-key collisions. Shape the return as `{ [sourceLocator]: FormErrors }` under a new `columnBindings` key on the per-region error record.

### 12c. Verify

```
npm --prefix apps/web run test:unit -- --testPathPattern=region-editor-validation
```

## Step 13 — Commit gating in `ReviewStepUI`

Surface the new binding-level errors through the existing `commitDisabledReason` path. Counter label: e.g. "3 bindings have validation errors — fix them before committing." Tested incidentally by Step 9's validation case; add an explicit case for "commit stays disabled until the last binding error is fixed".

## Step 14 — Full suite regression

```
npm --prefix apps/web run test:unit
npm --prefix apps/web run type-check
npm --prefix apps/api run test:unit
npm --prefix apps/api run test:integration -- --testPathPattern=layout-plan|reconcile
npm --prefix packages/spreadsheet-parsing run test
```

Fix any fallout. Add no-op stub cases wherever existing tests constructed a `ColumnBinding` literal and the new optional fields trigger deep-equality drift.

---

# Risks and mitigations

- **Reference validation at commit vs. at edit time.** If the UI validates only on Apply, but staged entities mutate underneath (region deleted, target's `targetEntityDefinitionId` changed), the plan can hold a stale `refEntityKey`. Mitigation: on every `state.regions` change, re-run binding validation and surface stale refs as blocker warnings on the affected region's card. The existing warnings machinery composes cleanly with `RegionDraft.warnings`.
- **Interpret clobbering binding overrides.** `preserveUserRegionConfig` already protects region-level knobs; Step 3 extends that protection to bindings. The matching key is the serialised `sourceLocator`, which survives interpret unless the header text changes — in which case a new binding emerges and the old override is dropped (acceptable: the column itself is gone).
- **Plan schema drift vs. in-flight plans.** No persisted plans exist pre-GA, so there's no migration burden. Should persistence start before this lands, the new fields are all optional — existing plans parse unchanged.
- **AsyncSearchableSelect resolution lag.** The picker shows an id-only chip for a split second until `loadSelectedOption` resolves the label. Mitigation: the workflow already caches a `columnDefinitionLabelMap`; pass it as a seeded `labelMap` to the select so the initial render has the label in hand.
