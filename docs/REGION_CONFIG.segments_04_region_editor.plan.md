# PR 4 — RegionEditor: Default Region + Segment Composition

**Depends on**: PR-1, PR-2, PR-3 merged.

**Landing invariant**: user-drawn regions default to classic tidy
(byte-identical to today's user experience). New UI affordances
let users compose regions from segments: add / remove / convert
segments; add a second header axis for crosstabs; name cell-value
field.

**Why this cut**: frontend-only work on the RegionEditor module,
well-isolated from the parser + api changes. Shipping separately
means the backend's unified model is battle-tested before the
editor UX churn lands.

## Scope

- Default region shape emitted when the user draws new bounds:
  classic tidy with one field segment.
- Pure-function segment operations:
  `addFieldSegment`, `removeSegment`, `splitSegment`,
  `convertSegmentKind`, `addHeaderAxis`, `removeHeaderAxis`,
  `setCellValueField`.
- UI wire-up: segment chips per axis, inline edit for pivot
  segments (axis name input), crosstab toggle.
- Delete obsolete editor inputs:
  `recordsAxisName` / `secondaryRecordsAxisName` / `cellValueName`
  fields, orientation dropdown.
- Tests for each pure operation + a component-level interaction
  test per composable flow.

Out of scope:

- Parser / API changes (landed in PR-1..PR-3).
- Drag-to-reorder segments (follow-up).
- Segment-rename drift handling (follow-up).

## Pre-flight

Files touched:

- `apps/web/src/modules/RegionEditor/RegionConfigurationPanel.component.tsx`
  — remove obsolete inputs; wire segment-chip panel.
- `apps/web/src/modules/RegionEditor/RegionDrawingStep.component.tsx`
  — default-region constructor on bounds commit.
- `apps/web/src/modules/RegionEditor/NewEntityDialog.component.tsx`
  — unchanged.
- `apps/web/src/modules/RegionEditor/utils/region-editor.types.ts`
  — remove `recordsAxisName` / `cellValueName` draft fields; add
  per-segment draft shape.
- `apps/web/src/modules/RegionEditor/utils/segment-ops.util.ts`
  (new) — pure segment operations.
- `apps/web/src/modules/RegionEditor/SegmentStrip.component.tsx`
  (new) — per-axis chip row.
- `apps/web/src/modules/RegionEditor/SegmentEditPopover.component.tsx`
  (new) — inline per-segment edit (kind, axisName, positionCount).
- `apps/web/src/modules/RegionEditor/__tests__/` — unit + component
  tests alongside.
- `apps/web/src/workflows/FileUploadConnector/FileUploadConnectorWorkflow.component.tsx`
  — may set a default region on the file-upload path; updates
  accordingly.

## Phases

### Phase A — Pure segment operations

#### A1. Red — one test per operation

`utils/__tests__/segment-ops.test.ts`:

```ts
describe("splitSegment", () => {
  it("splits a field segment at an offset into two field segments", () => { /* … */ });
  it("rejects an offset outside the segment", () => { /* throws */ });
});

describe("convertSegmentKind", () => {
  it("field → pivot inserts an axisName with source 'user'", () => { /* … */ });
  it("pivot → field removes the pivot metadata", () => { /* … */ });
  it("any → skip preserves positionCount", () => { /* … */ });
});

describe("addHeaderAxis", () => {
  it("promotes a 1D region to crosstab with a default skip segment at the intersection", () => { /* … */ });
  it("is a no-op when the axis is already present", () => { /* … */ });
});

describe("removeHeaderAxis", () => {
  it("collapses a crosstab to 1D and drops that axis's segments", () => { /* … */ });
  it("removes pivot segments on the removed axis from cellValueField scope", () => { /* … */ });
});

describe("addFieldSegment / removeSegment", () => { /* … */ });

describe("setCellValueField", () => {
  it("creates cellValueField when the first pivot segment appears", () => { /* … */ });
  it("removes cellValueField when the last pivot segment disappears", () => { /* … */ });
});
```

Each test asserts on the returned Region value (pure function) and
confirms schema-validity via `RegionSchema.safeParse`.

#### A2. Green — implement

`utils/segment-ops.util.ts`:

```ts
import type { Region, Segment } from "@portalai/core/contracts";

export function splitSegment(region: Region, axis: "row" | "column", segmentIndex: number, offset: number): Region { /* … */ }

export function convertSegmentKind(region: Region, axis: "row" | "column", segmentIndex: number, toKind: "field" | "pivot" | "skip", init?: PivotInit): Region { /* … */ }

export function addHeaderAxis(region: Region, axis: "row" | "column"): Region { /* … */ }
export function removeHeaderAxis(region: Region, axis: "row" | "column"): Region { /* … */ }

export function addFieldSegment(region: Region, axis: "row" | "column", atIndex: number, positionCount: number): Region { /* … */ }
export function removeSegment(region: Region, axis: "row" | "column", segmentIndex: number): Region { /* merges with adjacent if same kind */ }

export function setCellValueField(region: Region, field: Region["cellValueField"]): Region { /* auto-drops when no pivot */ }
```

All return a new `Region` (immutable pattern). Each function is
responsible for maintaining schema invariants — in particular:

- Positions cover the full axis span after edits.
- `cellValueField` exists iff any pivot segment exists (auto-sync).
- `headerStrategyByAxis` gets added/removed alongside
  `addHeaderAxis` / `removeHeaderAxis`.

### Phase B — Default region on draw

#### B1. Red

`utils/__tests__/default-region.test.ts`:

```ts
describe("defaultRegionForBounds", () => {
  it("emits classic tidy: headerAxes=['row'], one field segment, byHeaderName bindings across row 1", () => {
    const region = defaultRegionForBounds({ sheet: "S1", startRow: 1, startCol: 1, endRow: 10, endCol: 4 }, { /* entity + sheet refs */ });
    expect(region.headerAxes).toEqual(["row"]);
    expect(region.segmentsByAxis?.row).toEqual([{ kind: "field", positionCount: 4 }]);
    expect(region.columnBindings).toHaveLength(4);
    expect(region.columnBindings.every((b) => b.sourceLocator.kind === "byHeaderName")).toBe(true);
    expect(region.cellValueField).toBeUndefined();
    expect(region.pivotSegments).toBeUndefined();
    expect(region.recordsAxis).toBeUndefined();
  });

  it("validates against RegionSchema", () => { /* … */ });
});
```

#### B2. Green — implement

`utils/default-region.util.ts` (new):

```ts
export function defaultRegionForBounds(
  bounds: Bounds,
  { sheet, targetEntityDefinitionId, proposedBindings }: DefaultRegionInputs,
): Region {
  const positionCount = bounds.endCol - bounds.startCol + 1;
  return {
    id: nanoid(),
    sheet,
    bounds,
    boundsMode: "absolute",
    targetEntityDefinitionId,
    headerAxes: ["row"],
    segmentsByAxis: { row: [{ kind: "field", positionCount }] },
    headerStrategyByAxis: {
      row: { kind: "row", locator: { kind: "row", sheet, row: bounds.startRow }, confidence: 1 },
    },
    columnBindings: proposedBindings,
    identityStrategy: { kind: "rowPosition", confidence: 0.6 },
    skipRules: [],
    drift: defaultDriftKnobs(),
    confidence: { region: 1, aggregate: 1 },
    warnings: [],
  };
}
```

`proposedBindings` come from the caller reading row 1 cells of the
sheet — each becomes a `byHeaderName` binding with a placeholder
`columnDefinitionId`. The user picks the real definition in the
configuration step.

### Phase C — SegmentStrip + SegmentEditPopover components

#### C1. Red — pure UI component tests

Render `SegmentStripUI` with seeded props; assert:

- One chip per segment, showing kind + positionCount.
- Clicking a chip calls `onEditSegment(axis, segmentIndex)`.
- "Add segment" button emits `onAddSegment(axis)`.
- "Add header axis" button emits `onAddHeaderAxis(axis)` only when
  the axis isn't already present.

`SegmentEditPopoverUI`:

- For `kind: "pivot"`, renders an `axisName` input and wires
  `onChangeAxisName(value)`.
- Conversion buttons emit
  `onConvert(toKind)`.

Per the component-file policy, `*UI` components are pure
presentational; the containers wire hooks and pass callbacks.

#### C2. Green — implement

- `SegmentStrip.component.tsx` pair: container reads the region from
  context (draft builder state) and dispatches segment-ops calls on
  interaction; UI component renders chips + buttons.
- `SegmentEditPopover.component.tsx` pair: container manages the
  open/closed + current segment; UI component renders the form.

Follow the Form & Dialog pattern in `CLAUDE.md` — Zod validation
for the axis-name input, `FormAlert` if a validation fails, etc.

### Phase D — Wire into RegionConfigurationPanel

#### D1. Red — replace obsolete inputs

Update component tests for `RegionConfigurationPanel`:

- Remove assertions about `recordsAxisName` / `cellValueName`
  inputs rendering.
- Add assertions for `SegmentStrip` rendering + a `cellValueField`
  name input when the region has any pivot segment.
- Add assertion that `orientation` dropdown is gone.

#### D2. Green — replace UI

- Delete the records-axis-name / cell-value-name / orientation
  form fields.
- Render `<SegmentStrip axis="row" … />` and, when
  `region.headerAxes.includes("column")`,
  `<SegmentStrip axis="column" … />`.
- Render a `cellValueField.name` input whenever the region has any
  pivot segment.
- Render an "Add header axis (crosstab)" button when
  `region.headerAxes.length === 1`.

### Phase E — Workflow integration

#### E1. Red → Green — FileUploadConnector draft-region default

Update the file-upload workflow to call `defaultRegionForBounds`
when the user commits bounds. Before this PR the workflow
constructed a draft with `orientation` + `recordsAxisName`; that
whole path is gone.

Existing workflow tests that asserted on the old shape update to
the new shape.

### Phase F — Storybook + snapshots

Update Storybook stories for RegionConfigurationPanel /
RegionDrawingStep. Drop stories that illustrated the old
`recordsAxisName` UX. Add new stories:

- Tidy (classic): single row axis, all field segment.
- Pivoted: single axis, one pivot segment (shows axis-name input).
- Crosstab: both axes, pivot segments on each, cellValueField
  input visible.

### Phase G — Cross-suite verification

```
npm --workspace apps/web run test:unit
npm --workspace apps/web run storybook:build   # if CI runs this
npm run type-check
```

## PR body template

Title:
```
feat: RegionEditor composable segments + crosstab promotion
```

Body:
```markdown
## Summary

The RegionEditor now composes regions from segments instead of
surfacing opaque `recordsAxisName` / `cellValueName` / orientation
inputs.

- A user-drawn region defaults to classic tidy: `headerAxes:
  ["row"]`, one field segment spanning the bounds, byHeaderName
  bindings from row 1. Matches today's UX byte-for-byte when the
  user doesn't interact with the new affordances.
- New operations per axis:
  - Add / remove / split segment.
  - Convert segment kind (field ↔ pivot ↔ skip).
  - Promote 1D → crosstab (add a second header axis).
  - Collapse crosstab → 1D (remove a header axis).
- When any pivot segment exists, a `cellValueField.name` input
  surfaces; removing the last pivot segment removes the input.

## Removed editor fields

- `recordsAxisName` / `secondaryRecordsAxisName` /
  `cellValueName` — replaced by per-segment axis-name inputs +
  region-level `cellValueField`.
- `orientation` dropdown — derived from `headerAxes` + (for
  headerless) `recordsAxis`.

## Test plan

- [x] `segment-ops.test.ts` — pure operations, schema-validity
- [x] `default-region.test.ts` — classic tidy seed
- [x] `SegmentStrip.test.tsx` / `SegmentEditPopover.test.tsx` —
      pure UI components
- [x] `RegionConfigurationPanel.test.tsx` — integrated interaction
- [x] `FileUploadConnector` workflow test — default region on
      bounds commit
- [x] Storybook stories: tidy / pivoted / crosstab

## Screenshots

[inline at review]

## Out of scope / follow-ups

- Drag-to-reorder segments
- Segment-rename drift detection
- Per-segment `columnDefinitionId` picker for `cellValueField`
```

## Commit / PR checklist

- [ ] A1–A2 pure segment operations + schema-validity
- [ ] B1–B2 default region on draw
- [ ] C1–C2 SegmentStrip + SegmentEditPopover components
- [ ] D1–D2 RegionConfigurationPanel wire-up
- [ ] E1 FileUploadConnector workflow integration
- [ ] F Storybook stories updated
- [ ] G cross-suite + storybook green
