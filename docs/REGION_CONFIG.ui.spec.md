# Region Segmentation — Editor UI

Render segmented regions in the editor. Users compose regions from
segments (field / pivot / skip) on each declared header axis, can
promote a 1D region to a crosstab, edit axis names on pivots, and
name the cell-value field at the region level.

Context: `docs/REGION_CONFIG_FLEXIBILITY.discovery.md` § "Crosstab
treatment"; `docs/REGION_CONFIG.segments_04_region_editor.plan.md` for
the PR's phased test-driven walkthrough.

## Prerequisites

- `REGION_CONFIG.schema_replay.spec.md` merged — schema + replay
  accept the unified segment model.
- `REGION_CONFIG.interpret.spec.md` merged — the interpret endpoint
  emits segmented plans for every region.

## Shipped components (apps/web)

All new components live in
`apps/web/src/modules/RegionEditor/`. Each is a pure UI component
(no SDK dependency); the `RegionConfigurationPanel` container wires
them up.

### `SegmentStrip.component.tsx`

Per-axis chip row. One chip per segment, showing the segment's kind +
`positionCount` (and a `·∞` badge when a tail pivot is dynamic).
Props:

```ts
interface SegmentStripUIProps {
  axis: AxisMember;
  segments: Segment[];
  axisLabel?: string;                      // default: "<axis> axis"
  onEditSegment: (axis: AxisMember, index: number, anchor: HTMLElement) => void;
  onAddSegment: (axis: AxisMember) => void;
  /** Only passed when the other axis isn't already a header axis — the
   *  strip renders an "Add <other> axis" button that forwards this
   *  callback. */
  onAddHeaderAxis?: (otherAxis: AxisMember) => void;
}
```

### `SegmentEditPopover.component.tsx`

Per-segment popover opened by clicking a chip. Renders:

- Axis-name text input (pivots only; required).
- "Can this segment grow?" toggle (tail pivot only; refinement 10
  forbids non-tail dynamic).
- Terminator form (kind selector + consecutive-blanks / pattern
  input) — `TerminatorForm.component.tsx` is shared with the
  record-axis popover.
- Convert-to buttons (field / pivot / skip), with the current kind
  disabled.

### `RecordAxisTerminatorPopover.component.tsx`

Region-level "Extent" popover opened from a button in the panel's
Extent slot. Exposes the same terminator form at the record-axis
level; gated on `!isCrosstab` (refinement 11).

### `TerminatorForm.component.tsx`

Shared inner form used by the two popovers above. Kind selector +
one of: a number input for `untilBlank.consecutiveBlanks`, or a
pattern input (`matchesPattern.pattern`) with a lightweight regex
validity check.

## Changed components

### `RegionConfigurationPanel.component.tsx`

The shape section renders:

1. One `SegmentStripUI` per axis in `region.headerAxes` (always when
   1D; two strips when crosstab).
2. An "Add <other> axis" button from the strip, surfacing only when
   the other axis isn't yet a header axis.
3. A "Collapse crosstab" button when the region is a crosstab.
4. A `cellValueField.name` text input whenever any pivot segment
   exists on the region (auto-seeds to `"value"` when the first
   pivot appears, auto-drops when the last pivot leaves).
5. The axis-anchor-cell picker remains (still pivoted-only).

The extent section renders:

1. A "Fixed bounds" / "Grows until …" button that opens
   `RecordAxisTerminatorPopoverUI`. Hidden on crosstab.
2. Skip rules + existing skip-and-terminator editor (unchanged).

Gone from the panel (relative to the pre-PR editor):

- Orientation dropdown.
- Header-axis toggle.
- Records-axis-name / secondary-records-axis-name / cell-value-name
  inputs (replaced by per-segment axis-name inputs + region-level
  `cellValueField`).
- `boundsMode` picker + `boundsPattern` input (replaced by the
  Extent control and per-segment dynamic toggles).
- Field-names editor for `headerAxis: "none"` (a replacement UI
  surfaces as part of the headerless affordance when that lands).

### `RegionDrawingStep.component.tsx`

On a new bounds commit (`onRegionDraft`), the workflow constructs a
default-tidy `RegionDraft` — `headerAxes: ["row"]` + a single
`{ kind: "field", positionCount: span }` segment. The caller reads
row 1 of the selected sheet and supplies the initial byHeaderName
`ColumnBinding`s via `defaultRegionForBounds` in
`apps/web/src/modules/RegionEditor/utils/default-region.util.ts`.

### `FileUploadConnectorWorkflow.component.tsx` (container)

Wires `onRegionDraft` → `defaultRegionForBounds` for new regions;
wires the panel's `onUpdate(partial)` through to the workflow's
existing `onRegionUpdate(regionId, updates)`. Plan mirroring keeps
`state.plan.regions[i]` in sync with `state.regions[i]` on every
segment edit.

## Pure segment operations

`apps/web/src/modules/RegionEditor/utils/segment-ops.util.ts`
exports pure `Region → Region` helpers the panel's handlers call:

| Operation                    | Effect                                                                 |
|------------------------------|------------------------------------------------------------------------|
| `splitSegment`               | Splits a field segment in two; rejects dynamic splits (refinement 10). |
| `convertSegmentKind`         | field ↔ pivot ↔ skip; auto-seeds `cellValueField` when first pivot appears; auto-drops when last pivot leaves. |
| `addHeaderAxis`              | Promotes 1D → crosstab by seeding a skip segment on the new axis.      |
| `removeHeaderAxis`           | Collapses crosstab → 1D; drops that axis's segments, bindings, strategy. |
| `addFieldSegment`            | Inserts a field segment; merges adjacent same-kind segments.           |
| `removeSegment`              | Removes a segment; merges adjacent same-kind; rejects removing the only segment on an axis. |
| `setCellValueField`          | Explicit setter; auto-drops when no pivot exists.                      |
| `setSegmentDynamic`          | Tail-pivot only (refinement 10); rejects a second dynamic on same axis. |
| `setRecordAxisTerminator`    | 1D / headerless only (refinement 11).                                  |

Each returns a new region whose `RegionSchema.safeParse` succeeds —
unit tests assert on that invariant for every op.

## Validation

`region-editor-validation.util.ts`'s `validateRegion` enforces:

- A pivot segment with an empty `axisName` →
  `errors["segmentsByAxis.<axis>.pivot.axisName"]`.
- Any pivot segment present with no `cellValueField.name` →
  `errors.cellValueField`.
- `recordAxisTerminator` on a crosstab → `errors.recordAxisTerminator`.
- `recordAxisTerminator.kind === "matchesPattern"` with invalid
  regex → `errors.recordAxisTerminator`.
- `axisAnchorCell` off-region or on a non-pivoted region →
  `errors.axisAnchorCell`.

Errors render inline on the relevant input or chip. Blocker-level
errors block the Interpret / Commit actions.

## Storybook

Stories under `apps/web/src/modules/RegionEditor/stories/`:

- `RegionConfigurationPanel.stories.tsx`:
  - **Tidy (classic)** — single row axis, one field segment.
  - **Pivoted** — single axis, one pivot segment, cell-value field
    input visible.
  - **Crosstab** — both axes with pivot segments, cell-value field
    + axis-anchor decoration visible.
  - **Crosstab with dynamic tail** — row axis carries a
    dynamic-tail pivot so the dashed-edge overlay + `·∞` badge have
    visible coverage.
- `SegmentStrip.stories.tsx`, `SegmentEditPopover.stories.tsx`,
  `RecordAxisTerminatorPopover.stories.tsx`,
  `TerminatorForm.stories.tsx` — one pure-UI story per component
  for visual review.

## Acceptance criteria

- A freshly-drawn region defaults to tidy — `headerAxes: ["row"]` +
  one field segment + byHeaderName bindings from row 1. Matches the
  pre-PR byte-for-byte when the user doesn't interact with the new
  affordances.
- Clicking a chip opens the popover anchored on the chip; the user
  can change axis name, toggle dynamic, change terminator, or
  convert kind. Each edit dispatches a segment-ops call that
  produces a schema-valid region.
- Adding a header axis promotes 1D → crosstab (second `SegmentStripUI`
  renders, `Add header axis` button hides, `cellValueField` input
  visible if any pivot exists).
- Collapsing a crosstab removes the other axis's segments +
  strategies + axis-bound bindings (refinement 14 stays satisfied).
- The Extent control renders only on 1D / headerless regions; it's
  absent for crosstab.
- Commit is blocked when validation errors exist (blocker severity
  mirrors the pre-PR blocker-gate).

## Test plan

### Pure UI tests

- `SegmentStrip.test.tsx` — chip per segment; chip click callback
  receives the anchor element; add-segment + add-header-axis
  buttons emit the right axis.
- `SegmentEditPopover.test.tsx` — axis-name input on pivots; dynamic
  toggle on tail pivots only; terminator form per kind; convert
  buttons emit `onConvert(kind)`.
- `RecordAxisTerminatorPopover.test.tsx` — hidden on crosstab;
  toggle on/off emits `onToggle`; pattern edit emits
  `onChangeTerminator`.
- `TerminatorForm.test.tsx` — each kind's branch renders; invalid
  regex flagged via `aria-invalid`; consecutive-blanks < 1 rejected.
- `RegionConfigurationPanel.test.tsx` — SegmentStrip renders;
  cellValueField input gated on pivot presence; Extent control
  gated on `!isCrosstab`; add-header-axis button gated on 1D;
  dynamic-tail chip badge renders when `segment.dynamic` is set;
  orientation / boundsMode UI is gone.

### Pure operation tests

- `segment-ops.test.ts` — one test per operation covering the
  acceptance case + each invariant it preserves. End-state validated
  through `RegionSchema.safeParse` via a helper.
- `default-region.test.ts` — classic tidy seed matches the plan's
  expected shape and validates clean.

### Container + workflow tests

- `RegionConfigurationPanel.test.tsx` (container integration) — the
  panel's segment-ops calls mirror into the parent's `onUpdate`
  callback with the right partial shape.
- `FileUploadConnectorWorkflow.test.tsx` — `onRegionDraft` emits a
  default-tidy new-shape draft; the workflow's plan mirroring keeps
  `state.plan.regions[i]` in sync with edit events.

### Storybook smoke

- Visual parity check for Tidy / Pivoted / Crosstab / Crosstab
  dynamic-tail stories. No functional regressions in existing
  RegionEditor stories.

## Non-goals

- Drag-to-reorder segments — follow-up.
- Segment-rename drift detection — follow-up (shares a spec with
  identity-drift segment-rename handling).
- Per-segment `columnDefinitionId` picker for `cellValueField` — the
  shipped input accepts a name only; mapping to a catalog definition
  is a workflow-layer follow-up.
- Mid-axis dynamic segments — forbidden by refinement 10.

## Rollout

One PR (`segments_04_region_editor`) delivers the panel rework
alongside the four new components + segment-ops helpers + updated
tests + stories. A follow-up PR adds the suggestion affordance on
pivot axis-names (the `onSuggestAxisName` entry point was removed
when the region-level "Suggest" button went away; the replacement
lives in the per-segment popover).
