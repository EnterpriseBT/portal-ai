# PR 1 — Schema + Replay Unification (Foundation)

**Depends on**: nothing. Part 1 of the segments roadmap; see
[`REGION_CONFIG.segments.plan.md`](REGION_CONFIG.segments.plan.md)
for the full vision.

**Landing invariant**: the tree is green, every existing behavior
preserved byte-for-byte. No new capabilities exposed — heuristic
segment detection and per-segment recommender land in PR-2 and
PR-3.

**Why this cut**: the schema collapse touches every layer at once
(schema → replay → interpret stages → API/web consumers). Splitting
it further would require temporary compatibility code, which
violates the clean-cut directive.

## Scope

- Rewrite `RegionSchema` around the final shape (see index's § Final
  schema).
- Unify replay into a single emit function that produces identical
  records to today's classic / pivoted / crosstab paths — but from
  the new field names.
- Adapt every interpret stage to read/write the new shape *while
  preserving today's behavior*. No new heuristics, no new
  classifier filters, no per-segment recommender.
- Migrate every in-repo fixture (parser + api + web) to the new
  shape.
- Downstream consumer fixes in `apps/api` / `apps/web` so the tree
  compiles.

Explicitly **out of scope** for this PR (later PRs):

- `detect-segments` stage with pattern clustering (PR-2).
- Classifier filter by segment kind (PR-3).
- Per-segment axis-name recommender (PR-3).
- New warning codes `SEGMENT_MISSING_AXIS_NAME` /
  `CELL_VALUE_FIELD_NOT_BOUND` (PR-3).
- RegionEditor default-region rework and segment ops (PR-4).
- Architecture-spec rewrite (PR-5).

## Pre-flight

Files rewritten in this PR:

- `packages/spreadsheet-parsing/src/plan/region.schema.ts`
- `packages/spreadsheet-parsing/src/plan/enums.ts` (drops
  `"cells-as-records"`, `"none"`)
- `packages/spreadsheet-parsing/src/plan/interpret-input.schema.ts`
- `packages/spreadsheet-parsing/src/plan/index.ts` (barrel)
- `packages/core/src/contracts/spreadsheet-parsing.contract.ts`
- `packages/spreadsheet-parsing/src/replay/extract-records.ts`
  (rename from `extract-segmented-records.ts`; delete old
  `extract-records.ts` orientation branches)
- `packages/spreadsheet-parsing/src/replay/resolve-headers.ts`
  (takes `axis` argument)
- Every file under
  `packages/spreadsheet-parsing/src/interpret/stages/` —
  **adapter-only rewrites** to the new shape
- `packages/spreadsheet-parsing/src/interpret/state.ts`,
  `types.ts` — state shape update (old fields gone, new fields
  present)

Fixtures migrated:

- `packages/spreadsheet-parsing/src/__tests__/fixtures/plans/simple-rows-as-records.json`
- `.../pivoted-columns-as-records.json`
- `.../crosstab.json`

Downstream consumers migrated:

- `apps/api/src/` — grep
  `orientation|headerAxis\b|recordsAxisName|secondaryRecordsAxisName|cellValueName|cells-as-records|positionRoles\b|pivotSegments\b|valueFieldName`
  and update every hit.
- `apps/web/src/modules/RegionEditor/` — same grep; update types
  and data-reading code. UI interactions continue to function but
  may display placeholder strings where removed fields used to
  render; that's OK and will be fixed in PR-4.

## Phases

### Phase A — Schema rewrite

#### A1. Red — one test block per numbered refinement

Extend `packages/spreadsheet-parsing/src/plan/__tests__/schemas.test.ts`:

- `describe("TerminatorSchema", …)` — `untilBlank` (with default
  `consecutiveBlanks`) and `matchesPattern` variants; reject
  `consecutiveBlanks < 1`; reject empty `pattern`.
- `describe("SegmentSchema", …)` — three kinds; reject
  `positionCount < 1`; reject pivot without id / axisName; accept
  pivot with `dynamic: { terminator: … }`; reject `dynamic` on
  field / skip (discriminated-union enforces this).
- `describe("RegionSchema — headerAxes cardinality (refinement 1)", …)`.
- `describe("RegionSchema — segmentsByAxis / headerAxes coherence (refinement 2)", …)`.
- `describe("RegionSchema — segmentsByAxis length match (refinement 3)", …)`
  — fixed-only sum equals span; dynamic-tail sum ≤ span; tail
  claims at least one position.
- `describe("RegionSchema — pivot id uniqueness across axes (refinement 4)", …)`.
- `describe("RegionSchema — recordsAxis presence rule (refinement 5)", …)`.
- `describe("RegionSchema — headerStrategyByAxis presence (refinement 6)", …)`.
- `describe("RegionSchema — cellValueField presence rule (refinement 7)", …)`.
- `describe("RegionSchema — dynamic segment must be tail (refinement 10)", …)`
  — dynamic at tail accepted; dynamic mid-axis rejected; two dynamic
  segments on one axis rejected.
- `describe("RegionSchema — recordAxisTerminator / crosstab exclusion (refinement 11)", …)`
  — `recordAxisTerminator` rejected on 2D; accepted on 1D;
  accepted on headerless.
- `describe("RegionSchema — removed fields rejected (refinement 9)", …)`
  with `it.each` over every removed field name:
  `orientation`, `headerAxis`, `boundsMode`, `boundsPattern`,
  `untilEmptyTerminatorCount`, `recordsAxisName`,
  `secondaryRecordsAxisName`, `cellValueName`, `positionRoles`,
  `pivotSegments`. Also asserts that a binding locator of kind
  `byColumnIndex` (Phase-1 shape) is rejected — superseded by
  `byPositionIndex`.
- `describe("BindingSourceLocatorSchema", …)`:
  - `byHeaderName { axis: "row" | "column", name }` — both axes
    parse.
  - `byPositionIndex { axis: "row" | "column", index }` — both
    axes parse; reject `index < 1`; reject missing `axis`.
  - Reject `byHeaderName` missing `axis`.
  - Reject `byHeaderName { name: "" }`.
- `describe("RegionSchema — locator axis coherence (refinement 14)", …)`
  — a binding whose `sourceLocator.axis` is not in
  `region.headerAxes` is rejected (for non-headerless regions).
- `describe("RegionSchema — byHeaderName forbidden on headerless (refinement 15)", …)`
  — headerless regions reject `byHeaderName` locators; accept
  `byPositionIndex` with `axis` = opposite of `recordsAxis`.
- `describe("RegionSchema — positionIndex range (refinement 16)", …)`
  — `index: 0` rejected; `index > positionSpan(axis)` rejected;
  in-range accepted.

Delete Phase-1 tests that rely on the removed fields or on the
`byColumnIndex` locator shape.

Expect failure — schema doesn't know the new shape yet.

#### A2. Green — rewrite `region.schema.ts`

Implement `TerminatorSchema`, `SegmentSchema`,
`CellValueFieldSchema`, `RegionObjectSchema` per the index's §
Final schema. Refinements 1–16 inside the `superRefine`.

Rewrite `strategies.schema.ts`'s `BindingSourceLocatorSchema`:

```ts
const ByHeaderNameLocatorSchema = z.object({
  kind: z.literal("byHeaderName"),
  axis: z.enum(["row", "column"]),
  name: z.string().min(1),
});

const ByPositionIndexLocatorSchema = z.object({
  kind: z.literal("byPositionIndex"),
  axis: z.enum(["row", "column"]),
  index: z.number().int().min(1),
});

export const BindingSourceLocatorSchema = z.discriminatedUnion("kind", [
  ByHeaderNameLocatorSchema,
  ByPositionIndexLocatorSchema,
]);
```

Delete the old `ByColumnIndexLocatorSchema` (Phase-1 shape).
Update `BINDING_SOURCE_KINDS` in `enums.ts` from
`["byHeaderName", "byColumnIndex"]` to
`["byHeaderName", "byPositionIndex"]`.

Key refinement implementations:

- **3 (length match with dynamic)**: per axis, partition segments
  into `fixed` and `dynamic`. If no dynamic segment:
  `Σ positionCount === span`. If dynamic tail present:
  `Σ positionCount ≤ span` AND `Σ fixed ≤ span − 1` (the dynamic
  tail claims ≥ 1 position).
- **10 (dynamic tail-only)**: walk each axis's segments; if any
  segment carries `dynamic`, it must be the last one AND there
  must be at most one dynamic segment on that axis.
- **11 (`recordAxisTerminator` forbidden on crosstab)**: when
  `region.headerAxes.length === 2` and `region.recordAxisTerminator`
  is defined, add issue.
- **12 (implicit)**: falls out of refinement 5 since
  `recordAxisTerminator` is only meaningful when a record axis
  exists.
- **14 (locator axis coherence)**: for every binding, if
  `headerAxes.length > 0` then `binding.sourceLocator.axis ∈
  headerAxes`; emit a well-pathed issue pointing at the
  offending locator.
- **15 (no byHeaderName on headerless)**: when `headerAxes` is
  empty, reject any `byHeaderName` locator; allow
  `byPositionIndex` only with `axis` equal to the opposite of
  `recordsAxis`.
- **16 (position index range)**: compute
  `positionSpan("row") = endCol − startCol + 1` and
  `positionSpan("column") = endRow − startRow + 1`; reject
  locators with `index` outside `[1, positionSpan(axis)]`.

Delete:

- `AxisPositionRoleSchema` (Phase-1).
- `PivotSegmentSchema` (Phase-1 shape).
- `SEGMENTED_CROSSTAB_NOT_SUPPORTED` refinement.
- The old length-match / consistency refinements.
- The `boundsMode === "matchesPattern"` requires `boundsPattern`
  refinement (`boundsMode` is gone).
- The `boundsMode`-based length logic anywhere else in the file.

Re-run A1 — green.

#### A3. Green — enums + barrel + core contracts

- `enums.ts`: **delete entirely** `ORIENTATIONS` /
  `OrientationEnum` / `Orientation` type, `HEADER_AXES` /
  `HeaderAxisEnum` / `HeaderAxis` type, and `BOUNDS_MODES` /
  `BoundsModeEnum` / `BoundsMode` type. All three collapse under
  the new schema (`headerAxes` is an inline enum; orientation
  becomes derivable; `boundsMode` disappears along with
  `untilEmpty` / `matchesPattern`).
- `plan/index.ts`: export `SegmentSchema`, `Segment`,
  `CellValueFieldSchema`, `CellValueField`, `TerminatorSchema`,
  `Terminator`. Remove the old exports (including the deleted
  enum exports).
- `packages/core/src/contracts/spreadsheet-parsing.contract.ts`:
  mirror.

#### A4. Green — `interpret-input.schema.ts`

`RegionHintSchema` mirrors `RegionObjectSchema`. Hints drop
`orientation`, `headerAxis`, `recordsAxisName`, etc.

#### A5. Migrate fixture plans

- `simple-rows-as-records.json` — `headerAxes: ["row"]`, one field
  segment spanning every column. No `recordAxisTerminator` (the
  fixture historically used absolute bounds).
- `pivoted-columns-as-records.json` — `headerAxes: ["column"]`,
  one pivot segment named `Month`; region-level
  `cellValueField: { name: "Revenue", nameSource: "user" }`. If the
  fixture's Month segment is meant to extend indefinitely, attach
  `dynamic: { terminator: { kind: "untilBlank" } }` — otherwise
  leave it fixed. Default to fixed for round-trip parity with
  pre-PR behavior.
- `crosstab.json` — `headerAxes: ["row", "column"]`, one pivot
  segment per axis with a `skip` segment at each axis's corner
  position, `cellValueField` present. No `recordAxisTerminator`
  (2D; refinement 11).
- If any fixture previously used `boundsMode: "untilEmpty"` or
  `"matchesPattern"`, migrate to `recordAxisTerminator` with the
  matching terminator shape. Grep:
  `rg '"boundsMode"' packages/spreadsheet-parsing/src/__tests__/fixtures/`
  and convert each.
- **Binding-locator migration**: every fixture using
  `"byColumnIndex"` / `"col"` renames to
  `"byPositionIndex"` / `"index"` with an explicit
  `"axis": "row"` (for 1D regions with a row-header axis — the
  typical Phase-1 case). Grep:
  `rg '"byColumnIndex"' packages/ apps/` and convert each.
- Every `byHeaderName` locator in fixtures gains
  `"axis": "row"` (1D default) or `"axis": "column"` (1D pivoted
  with a column header). For the crosstab fixture, the two new
  field-segment bindings take `axis: "row"` and `axis: "column"`
  respectively per the "Quarterly revenue by company" example.

#### A6. Run

```
npm --workspace packages/spreadsheet-parsing run test -- schemas
```

### Phase B — Replay unification (behavior-preserving)

#### B1. Red — rewrite replay tests around the new shape

Every helper in `rows-as-records.test.ts`,
`columns-as-records.test.ts`, `segmented-records.test.ts` migrates.
Assertions on record count, field names, and source-id formats
stay invariant — today's output is the specification.

Delete `cells-as-records.test.ts`; move its cases into
`segmented-records.test.ts` under a "2D crosstab (migrated from
cells-as-records)" `describe` block. Include the user's
sales-leads-by-industry-per-month example as a canonical fixture.

#### B2. Green — unified emit with effective-bounds computation

Rename `extract-segmented-records.ts` → `extract-records.ts`
(atomic with importer updates; delete the old
`extract-records.ts`). The single function:

1. Computes `effectiveBounds` from `region.bounds` by applying
   `recordAxisTerminator` (if set) and each axis's dynamic tail
   segment (if set).
2. Computes `effectiveSegmentsByAxis` — every segment unchanged
   except the dynamic tail on each axis, whose `positionCount` is
   bumped to the count claimed by the terminator scan.
3. Dispatches on `headerAxes.length`:
   - `0` (headerless): emit one record per entity-unit
     (direction from `recordsAxis`) via `columnBindings` with
     `byColumnIndex`, across the effective record-axis extent.
   - `1`: walk effective axis segments; statics-only emits one
     record per entity-unit; pivot-bearing emits one record per
     (entity-unit × pivot position) with segment `axisName` +
     `cellValueField` in `fields`.
   - `2`: Cartesian product of the two axes' effective pivot-label
     positions. One record per cell; `cellValueField` mandatory.

Helper signatures:

```ts
function computeEffectiveBounds(
  region: Region,
  sheet: Sheet,
): { bounds: ResolvedBounds; segmentsByAxis: { row?: Segment[]; column?: Segment[] } };

function scanTerminator(
  terminator: Terminator,
  sheet: Sheet,
  axis: "row" | "column",
  startCoord: number,  // first position to examine
  crossCoordStart: number,
  crossCoordEnd: number,
  sheetEdge: number,   // dimensions.rows or dimensions.cols
): number;             // returns last-claimed coord along `axis`

function expandSegmentsToPositions(
  segments: Segment[],
  startCoord: number,
): Array<{ segment: Segment; offsetInSegment: number; coord: number }>;

function cartesianCellSet(
  region: Region,
  effective: { bounds: ResolvedBounds; segmentsByAxis: {...} },
  sheet: Sheet,
): Iterable<{ row: number; col: number; axisPositions: Position[] }>;
```

**`scanTerminator` semantics** (axis = "column" case; "row" is
symmetric):

- For `untilBlank`: walk cols starting from `startCoord`,
  inspecting every cell at each cross-coord in
  `[crossCoordStart, crossCoordEnd]`. A "blank cell at col c" =
  every inspected cell in that col is empty. Stop after
  `consecutiveBlanks` blanks in a row; return the last non-blank
  col. If no blanks, return `sheetEdge`.
- For `matchesPattern`: walk cols; stop when a cell at any
  cross-coord matches the pattern; return col − 1.

**`ruleMatchesRecord` dispatch** for skip rules is rewritten to
key on `headerAxes.length` + `recordsAxisOf(region)` instead of
`orientation`:

- 1D / headerless: per-record scan (row for records-axis "row",
  col for "column"). Identical to today once the orientation
  lookup is replaced by the derived helper.
- 2D: per-cell evaluation. `blank` = the cell is empty.
  `cellMatches` reads the `axis` field to pick the cross-axis
  cell reference.

**Record-axis extension for 1D record axis.** When
`recordAxisTerminator` is set, extend `effectiveBounds.endRow`
(records-axis "row") or `effectiveBounds.endCol` ("column") by
scanning past `bounds.end*` until the terminator fires.

**Binding resolution under the new locator shape.** Replay's
header-label-to-coord resolver dispatches on `locator.axis`:

```ts
function resolveBindingCoord(
  locator: BindingSourceLocator,
  region: Region,
  sheet: Sheet,
  bounds: ResolvedBounds,
): { axis: "row" | "column"; coord: number } | undefined {
  if (locator.kind === "byPositionIndex") {
    // Axis-relative; convert to a sheet coord.
    const start = locator.axis === "row" ? bounds.startCol : bounds.startRow;
    return { axis: locator.axis, coord: start + locator.index - 1 };
  }
  // byHeaderName — look up the label on the header line for locator.axis.
  const headerIndex = headerStrategyFor(region, locator.axis);
  if (headerIndex === undefined) return undefined;
  const labels = readHeaderLineLabels(region, locator.axis, sheet, headerIndex);
  const offset = labels.findIndex((l) => l === locator.name);
  if (offset < 0) return undefined;
  const start = locator.axis === "row" ? bounds.startCol : bounds.startRow;
  return { axis: locator.axis, coord: start + offset };
}
```

In the emit loop, for a field-position's binding:
- If the binding's `axis` matches the row-header axis (cells run
  across cols), read the cell at `(entityRow, coord)` for 1D, or
  `(record's col-header-axis row, coord)` for 2D.
- If the binding's `axis` matches the col-header axis (cells run
  down rows), read the cell at `(coord, entityCol)` for 1D, or
  `(coord, record's row-header-axis col)` for 2D.

The axis-aware resolution is what makes 2D static-on-both-axes
regions work naturally — the same "Quarterly revenue by company"
shape from the design docs round-trips end-to-end.

#### B3. Refactor — `resolve-headers.ts`

`resolveHeaders(region, axis, sheet, bounds)`. Callers specify the
axis explicitly (crosstabs call twice).

#### B4. Run

```
npm --workspace packages/spreadsheet-parsing run test -- replay segmented-records
```

All pre-PR replay behavior preserved; classic `cells-as-records`
coverage now lives inside `segmented-records.test.ts`.

### Phase C — Interpret stages: adapter-only rewrites

**Goal**: every stage reads/writes the new shape but keeps today's
behavior identical. No new heuristics.

#### C1. State shape update

- `types.ts`: replace `recordsAxisNameSuggestions` with
  `segmentAxisNameSuggestions: Map<segmentId, AxisNameSuggestion>`.
  Add `segmentsByRegion: Map<regionId, { row?: Segment[]; column?: Segment[] }>`
  and `cellValueFieldByRegion: Map<regionId, CellValueField | undefined>`.
- `state.ts`: `createInitialState` seeds the three new maps empty.

#### C2. `classify-columns.ts` — adapter only

- Iterates `region.headerAxes` instead of the old `headerAxis`
  enum.
- Skip the pivoted-anchor position as today (derived from
  `axisAnchorCell` + the single header axis for pivoted regions).
- **Behavior preservation**: pivoted regions today produce
  classifier candidates excluding the anchor; under the new shape
  the same candidates come out because we aren't filtering by
  segment kind yet. The classifier still sees every non-anchor
  position.
- File stays named `classify-columns.ts` for this PR; rename to
  `classify-field-segments.ts` happens in PR-3 alongside the
  filter.

#### C3. `recommend-records-axis-name.ts` — adapter only

- Rewritten internally to work from `pivotSegments` (reading
  `segmentsByAxis` for pivot-kind entries) but still fires
  per-region. For regions with a single pivot segment (today's
  "pivoted" shape), it calls the recommender once with that
  segment's labels and writes the suggestion under the segment's
  id in `segmentAxisNameSuggestions`.
- For tidy / crosstab regions: behavior identical to today (no
  call for tidy; crosstab uses the same anchor-cell mechanism).
- File stays named `recommend-records-axis-name.ts` for this PR;
  PR-3 does the rename + true per-segment semantics.

#### C4. `propose-bindings.ts` — assemble the new shape

Writes `headerAxes`, `segmentsByAxis`, `cellValueField`,
`headerStrategyByAxis` onto the region. Derivation:

- From `state.headerCandidates`: pick a `HeaderCandidate` per axis
  that the region declares. Today's per-region header candidate
  becomes `headerStrategyByAxis[axis]`.
- For `segmentsByAxis[axis]`: today's pipeline has exactly one
  header axis per region (no crosstabs are produced by interpret
  today). Emit one field segment spanning every position EXCEPT
  the anchor-cell position (if pivoted, that becomes a skip).
  Pivoted-today regions get one pivot segment spanning their
  non-anchor positions.
- For `cellValueField`: if a pivot segment exists, seed from
  today's `recordsAxisName` equivalent in state.

This is the adapter layer that translates today's
pipeline output into the new shape.

#### C5. `score-and-warn.ts` — reshape warnings

- Today's `PIVOTED_REGION_MISSING_AXIS_NAME` fires when a pivoted
  region lacks a records-axis name. Under the new shape, rewrite
  it to fire per pivot segment whose `axisName === ""` or whose
  `axisNameSource === "anchor-cell"` with no anchor-cell value.
- Keep emitting the same code for this PR (preserving the external
  contract); PR-3 renames it to `SEGMENT_MISSING_AXIS_NAME`.

#### C6. `reconcile-with-prior.ts` / `detect-identity.ts` / `detect-headers.ts` / `detect-regions.ts`

- Every reader of the old fields updates to the new shape; no
  behavior changes.

### Phase D — Orchestration regression

#### D1. Rerun orchestration tests, plans migrated

Every fixture that carried the pre-schema shape migrates inline.
Assertions on the plan's `regions[*].segmentsByAxis`,
`cellValueField`, `headerAxes`, etc. replace the old
`orientation` / `headerAxis` / `recordsAxisName` checks.

Where the orchestration test previously asserted on the full plan
JSON (snapshot), compare the migrated expected snapshot to the new
output. Each migration is a small diff — document in the PR body.

#### D2. Replay-bridge assertion

Every migrated orchestration case feeds `plan.regions[0]` into
`extractRecords` and asserts the record count + sample fields
match the pre-PR values.

### Phase E — Downstream consumers

#### E1. API

```
rg 'orientation|headerAxis\b|recordsAxisName|secondaryRecordsAxisName|cellValueName|cells-as-records|positionRoles\b|pivotSegments\b|valueFieldName' apps/api/src/
```

Hotspots:

- `layout-plan-commit.service.ts` — the commit path reads region
  shape to emit entity records. Now reads `segmentsByAxis` +
  `cellValueField`.
- `field-mappings/reconcile.ts` — may reference records-axis names
  via warning codes or error paths. Update.
- Plan-contract tests that build inline regions.

Migrate every hit. No behavior change.

#### E2. Web — RegionEditor types + read paths only

```
rg 'orientation|headerAxis\b|recordsAxisName|secondaryRecordsAxisName|cellValueName|cells-as-records|positionRoles\b|pivotSegments\b|valueFieldName' apps/web/src/modules/RegionEditor/
```

For this PR: update type imports and data-read paths only. The
RegionEditor's UI forms that rendered `recordsAxisName` /
`cellValueName` inputs continue to function but may render stale
placeholder strings — that's acceptable for this PR because PR-4
reworks the editor UI.

Specifically:

- Type imports from `@portalai/core/contracts` point at the new
  symbols.
- Draft-region builders that constructed plans with the old shape
  emit the new shape (minimum viable: one field segment; no pivot
  segments) — this is a stopgap until PR-4 seeds properly.
- Read paths that displayed records-axis names now display the
  first pivot segment's `axisName` if any, else empty.

### Phase F — Cross-suite verification

```
npm run type-check
npm --workspace packages/spreadsheet-parsing run test
npm --workspace apps/api run test:unit
npm --workspace apps/web run test:unit
```

All green. Integration suites run manually against a reseeded dev
DB before PR open.

## PR body template

Title:
```
feat: unify region schema + replay around composable segments
```

Body:
```markdown
## Summary

Collapses every region shape — tidy, pivoted, crosstab — into one
composable representation: `headerAxes`, `segmentsByAxis`, and a
region-level `cellValueField`. The classic orientation /
records-axis-name / cell-value-name machinery is gone.
**No behavior change** — replay produces bit-identical records to
pre-PR and every interpret stage is adapted, not rewritten.
Subsequent PRs land:

- PR-2: heuristic `detect-segments` stage.
- PR-3: per-segment classifier + recommender + new warnings.
- PR-4: RegionEditor default-region + segment ops.
- PR-5: architecture-spec rewrite.

## Schema migration (in-repo only)

| removed | replaced by |
|---------|-------------|
| `orientation` enum | derived — `headerAxes` + `recordsAxis` for headerless |
| `headerAxis` enum with `"none"` | `headerAxes: Array<"row" \| "column">` |
| `positionRoles[]` + `pivotSegments[]` | `segmentsByAxis: { row?: Segment[]; column?: Segment[] }` |
| `recordsAxisName` / `secondaryRecordsAxisName` / `cellValueName` | per-segment `axisName` + region-level `cellValueField` |
| per-segment `valueFieldName` | `cellValueField.name` |
| refinement `SEGMENTED_CROSSTAB_NOT_SUPPORTED` | removed — crosstab is segmented now |

## Migrated fixtures

- `simple-rows-as-records.json`, `pivoted-columns-as-records.json`,
  `crosstab.json`
- (list any snapshots migrated here)

## Test plan

- [x] `schemas.test.ts` — new refinements green, removed fields rejected
- [x] `segmented-records.test.ts` — every 1D + 2D case passes with migrated fixtures
- [x] Orchestration — every fixture round-trips unchanged records
- [x] Full parser + API unit + web unit + root type-check
```

## Commit / PR checklist

- [ ] A1–A6 schema rewrite + fixtures migrated
- [ ] B1–B4 replay unified, cells-as-records coverage folded
- [ ] C1–C6 interpret stage adapters
- [ ] D1–D2 orchestration regression green
- [ ] E1–E2 API + web consumers migrated
- [ ] F cross-suite + type-check green
- [ ] PR body with migration table
