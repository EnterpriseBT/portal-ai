# Column Binding Overrides — Spec

Implementation spec for letting a user rebind an interpreted column to a different `ColumnDefinition`, override the per-binding field-mapping metadata, and omit columns from the committed entity — all from the review step of the FileUpload (and sibling) workflows, without leaving the workflow to edit `ColumnDefinition` rows.

Read `SPREADSHEET_PARSING.architecture.spec.md` first for the plan-driven architecture, `SPREADSHEET_PARSING.backend.spec.md` for `LayoutPlan` / `ColumnBinding` shape, and `SPREADSHEET_PARSING.frontend.spec.md` for the existing review step.

## Summary

The interpret stage produces a `LayoutPlan` where each region carries a list of `ColumnBinding`s (`sourceLocator → columnDefinitionId`). Today those bindings are immutable from the review step: the chip click in `RegionReviewCardUI` fires `onEditBinding`, which the FileUpload container routes to "jump to region" because the binding-edit popover was left out of scope.

The old (now-deprecated) upload workflow had a dedicated Column Mapping step that let the user (a) pick a different `ColumnDefinition` per column, (b) edit per-column `FieldMapping` knobs (`normalizedKey`, `required`, `defaultValue`, `format`, `enumValues`, `refEntityKey`, `refNormalizedKey` for reference-typed columns), and (c) exclude columns from the committed entity entirely. This spec ports that capability onto the current plan-driven review step.

**Non-goal**: users do not create or edit `ColumnDefinition` rows from the workflow. That stays an administrative task on `/column-definitions`. The binding editor's `ColumnDefinition` picker is read-only over the org catalog.

## Scope

In scope:
- Extend `ColumnBinding` with override fields mirroring `FieldMapping`'s per-column knobs.
- Add an `excluded: boolean` flag that causes commit to skip materialising a `FieldMapping` row.
- Surface a binding-edit popover on the review step's chips.
- Render excluded bindings as dimmed / strikethrough in both the review step and the region editor.
- Round-trip the overrides through the `interpret` → review → commit flow. The `preserveUserRegionConfig` merge already handles carrying user-only knobs across re-interpret; extend it to cover bindings too.

Out of scope:
- Creating or editing `ColumnDefinition` rows.
- Bulk-apply affordances ("apply this override to all 'email' columns across regions").
- Per-binding confidence recomputation after rebind — the UI shows confidence as-returned by interpret; a user override reads `confidence: 1` implicitly.
- Mode B (connector re-sync / drift) specific ergonomics. The feature works there but any drift-specific banner copy lands separately.

## Data model

### Extend `ColumnBindingSchema`

`packages/spreadsheet-parsing/src/plan/strategies.schema.ts`:

```ts
export const ColumnBindingSchema = z.object({
  sourceLocator: BindingSourceLocatorSchema,
  columnDefinitionId: z.string().min(1),
  confidence: z.number().min(0).max(1),
  rationale: z.string().optional(),

  // ── User overrides ────────────────────────────────────────────────
  /** When true, commit writes no FieldMapping row for this binding. */
  excluded: z.boolean().optional(),
  /**
   * Override the normalized key (DB field name) materialised into
   * `FieldMapping.normalizedKey`. When unset, reconcile derives it from
   * `ColumnDefinition.key` as it does today. Must match the repo's
   * normalized-key regex: `^[a-z][a-z0-9_]*$`.
   */
  normalizedKey: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
  required: z.boolean().optional(),
  defaultValue: z.string().nullable().optional(),
  format: z.string().nullable().optional(),
  enumValues: z.array(z.string()).nullable().optional(),
  /**
   * Reference-typed targets. Only meaningful when the bound
   * `ColumnDefinition.type` is `reference` or `reference-array`. Commit
   * validates: if the resolved definition is a reference type, `refEntityKey`
   * must be present and resolve to an entity key in the same commit (staged
   * or DB-backed); `refNormalizedKey` must resolve to a field on that entity.
   */
  refEntityKey: z.string().nullable().optional(),
  refNormalizedKey: z.string().nullable().optional(),
});
```

All new fields are optional so existing persisted plans remain schema-valid (there is no historical corpus today, but the shape mirrors how other plan-level overrides already compose).

### Update frontend `ColumnBindingDraft`

`apps/web/src/modules/RegionEditor/utils/region-editor.types.ts`:

```ts
export type ColumnBindingDraft = {
  sourceLocator: string;
  columnDefinitionId: string | null;
  columnDefinitionLabel?: string;
  columnDefinitionType?: ColumnDataType; // added — drives conditional editors
  confidence: number;
  rationale?: string;

  // ── Override fields (mirror ColumnBindingSchema) ──────────────────
  excluded?: boolean;
  normalizedKey?: string;
  required?: boolean;
  defaultValue?: string | null;
  format?: string | null;
  enumValues?: string[] | null;
  refEntityKey?: string | null;
  refNormalizedKey?: string | null;
};
```

`columnDefinitionType` is a frontend-only convenience populated alongside `columnDefinitionLabel` in the container's `columnDefinitionLabelMap`; it drives whether the reference / enum editors render.

## Commit-time semantics

`apps/api/src/services/field-mappings/reconcile.ts`:

1. Filter out bindings with `excluded === true` before computing `desired`. These bindings contribute no `FieldMapping` row, so any existing row keyed on their derived `normalizedKey` gets soft-deleted by the usual stale-detection path.
2. When deriving `normalizedKey`, prefer `binding.normalizedKey` over the catalog fallback. The result still has to pass the regex; reconcile rejects bindings that violate it (throws `ApiError(400, LAYOUT_PLAN_INVALID_PAYLOAD)`).
3. When building the `FieldMapping` upsert payload, read the override fields off the binding and fall back to the catalog defaults that live today (line 108–113):
   - `required`: `binding.required ?? false`
   - `defaultValue`: `binding.defaultValue ?? null`
   - `format`: `binding.format ?? catalog?.canonicalFormat ?? null`
   - `enumValues`: `binding.enumValues ?? null`
   - `refEntityKey` / `refNormalizedKey`: read from the binding; validate presence for reference-typed definitions.
4. **Reference validation** (new): if `catalog.type ∈ {"reference", "reference-array"}`, require `binding.refEntityKey` to be non-null. It must resolve to one of (a) another region's `targetEntityDefinitionId` (staged entity created in the same commit) or (b) an existing `ConnectorEntity.key` in the same org. Missing or unresolvable → throw `ApiError(400, LAYOUT_PLAN_INVALID_REFERENCE)`. Add `LAYOUT_PLAN_INVALID_REFERENCE` to `ApiCode`.

## Interpret preservation

`apps/web/src/workflows/FileUploadConnector/utils/layout-plan-mapping.util.ts`:

`preserveUserRegionConfig` already merges region-level user knobs onto the interpreted plan. Extend it to also merge binding-level overrides. Matching strategy:

- Per region, build `priorBySourceLocator: Map<string, ColumnBindingDraft>` keyed by the serialised `sourceLocator` (`"header:Name"` / `"col:2"`).
- For each binding on the incoming plan region, look up the prior draft binding by serialised locator. If present, carry forward `excluded`, `normalizedKey`, `required`, `defaultValue`, `format`, `enumValues`, `refEntityKey`, `refNormalizedKey`.
- If the user rebound the column to a different `columnDefinitionId` before Interpret, preserve that override too: `columnDefinitionId: prior.columnDefinitionId ?? region.columnDefinitionId`. (The interpret stage would otherwise re-classify from scratch.)

`planRegionsToDrafts` mirrors the copy in the other direction — it already copies region-level knobs (`boundsMode`, `skipRules`, …); add the same for every new binding field so a draft round-trips cleanly.

## Frontend — review step binding editor

### Chip affordance

`RegionReviewCardUI` today renders each binding as a clickable chip. The new behavior:

- Excluded bindings: `opacity: 0.5`, strikethrough through the locator → label line, with a tiny "Excluded" chip. Still clickable so the user can un-exclude.
- Non-excluded bindings: unchanged visually; clicking opens the binding editor.

### Binding editor popover

A new `BindingEditorPopover` lives inside `apps/web/src/modules/RegionEditor/`. Trigger: clicking a chip anchors the popover to that chip. Contents, top to bottom:

1. **Header** — source locator (read-only), e.g. `Column 2` or `Header: "Email"`.
2. **Column Definition** picker — `AsyncSearchableSelect` over `sdk.columnDefinitions.search`. Required unless `excluded`. Shows the resolved `ColumnDefinition`'s `type` as a read-only chip + its `description` when set.
3. **Omit toggle** — `Checkbox` labelled "Omit this column from the entity". When on, collapses everything below and disables the Column Definition picker's required constraint.
4. **Normalized key** — `TextInput`, pattern-validated against `^[a-z][a-z0-9_]*$` with live error. Placeholder shows the catalog default. Empty → clears the override so reconcile falls back.
5. **Reference editor** — rendered only when the resolved definition's `type ∈ {reference, reference-array}`. Two `Select`s:
   - `refEntityKey` — options are the region's sibling regions' `targetEntityDefinitionId` (prefixed `"this import"`) + the user's existing entity keys loaded via `sdk.connectorEntities.search` (prefixed `"existing"`).
   - `refNormalizedKey` — depends on the picked target; either the target region's resolved bindings' `normalizedKey`s (staged case) or the target entity's `fieldMappings` list (DB case).
6. **Enum values** — `TextInput` (comma-separated) when `type === "enum"`.
7. **Default value** and **Format** — `TextInput`s, always shown when not excluded.
8. **Required** — `Checkbox`.

Footer: `Cancel` (resets local draft state) and `Apply` (fires `onUpdateBinding`). Enter submits; Escape cancels. `FormAlert` renders a local `formError` when validation blocks apply — matching the Form & Dialog pattern in `CLAUDE.md`.

### Props wiring

New module-level props on `ReviewStepUIProps` (already referenced via `onEditBinding`; replace the `(regionId, sourceLocator) => void` signature with the following wiring):

```ts
// modules/RegionEditor/ReviewStep.component.tsx
export interface ReviewStepUIProps {
  // ...existing...
  onToggleBindingExcluded?: (
    regionId: string,
    sourceLocator: string,
    excluded: boolean
  ) => void;
  onUpdateBinding?: (
    regionId: string,
    sourceLocator: string,
    patch: Partial<ColumnBindingDraft>
  ) => void;
  /** Options surface for the AsyncSearchableSelect. */
  columnDefinitionSearch?: SearchResult<SelectOption & {
    columnDefinition?: ColumnDefinition;
  }>;
  /** For the reference editor's DB-entity selector. */
  connectorEntitySearch?: SearchResult<SelectOption>;
}
```

When the new props are unset, the editor falls back to the current "jump to region" behavior so existing Storybook stories and the tests that don't exercise rebinding stay green.

### Workflow hook

`useFileUploadWorkflow` gains:

```ts
onToggleBindingExcluded(regionId, sourceLocator, excluded): void
onUpdateBinding(regionId, sourceLocator, patch): void
```

Both mutate `state.regions` *and* `state.plan` in a single `setState` callback, so commit always sees the latest plan without a separate re-sync. No server round-trip.

### Validation

`region-editor-validation.util.ts` extends per-region errors with a binding-level map `{ [sourceLocator]: FormErrors }`:

- `columnDefinitionId` required unless excluded.
- `normalizedKey` must match the regex when set.
- If the bound definition is a reference type and not excluded, `refEntityKey` is required. `refNormalizedKey` is required when the target is a staged region with no auto-derivable key.
- `enumValues` optional; when set, non-empty array of unique, non-empty strings.

These errors block the Commit button (they compose into the existing `commitDisabledReason` path on `ReviewStepUI`).

## Accessibility

- Popover uses MUI `Popover` with `role="dialog"` and `aria-labelledby` pointing at the source-locator header.
- First field auto-focuses via `useDialogAutoFocus(open)`.
- The Omit toggle is a labelled `Checkbox`; screen readers get `aria-describedby` pointing at a helper line describing the consequence ("No field mapping will be created").
- Excluded chips get `aria-label="Excluded — click to re-enable"` on the chip button.

## Telemetry / observability

Out of scope. The existing interpret / commit logs are sufficient; no per-edit events needed in v1.

## Migration

No persisted plans exist pre-GA, so there is no upgrade path to write. All new fields are optional.

## Resolved decisions

1. **Normalized-key collision policy across bindings in the same entity.** Reconcile detects two bindings that map to different `ColumnDefinition`s but share an overridden `normalizedKey` within the same region, and throws `LAYOUT_PLAN_DUPLICATE_NORMALIZED_KEY`. The review-step validation surfaces the same check as a per-binding error on both colliding rows so the user can resolve it pre-commit. Rationale: `FieldMapping` is keyed on `(connectorEntityId, normalizedKey)` — silently overwriting one mapping with another would erase data.
2. **Reference target scope (v1).** Reference-typed bindings can only point at (a) another region's `targetEntityDefinitionId` in the same commit (staged batch entity) or (b) an existing `ConnectorEntity.key` loaded via `sdk.connectorEntities.search`. Creating a new staged entity directly from the reference editor is deferred — if the user needs a new target, they use the region editor's existing "+ Create new entity" flow on step 1. Keeps the staged-entity creation path single-sourced and the binding editor focused on rebinding/overrides.
