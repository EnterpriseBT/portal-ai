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

- `describe("SegmentSchema", …)` — three kinds; reject
  `positionCount < 1`; reject pivot without id / axisName.
- `describe("RegionSchema — headerAxes cardinality (refinement 1)", …)`.
- `describe("RegionSchema — segmentsByAxis / headerAxes coherence (refinement 2)", …)`.
- `describe("RegionSchema — segmentsByAxis length match (refinement 3)", …)`.
- `describe("RegionSchema — pivot id uniqueness across axes (refinement 4)", …)`.
- `describe("RegionSchema — recordsAxis presence rule (refinement 5)", …)`.
- `describe("RegionSchema — headerStrategyByAxis presence (refinement 6)", …)`.
- `describe("RegionSchema — cellValueField presence rule (refinement 7)", …)`.
- `describe("RegionSchema — removed fields rejected (refinement 9)", …)`
  with `it.each` over every removed field name.

Delete Phase-1 tests that rely on the removed fields.

Expect failure — schema doesn't know the new shape yet.

#### A2. Green — rewrite `region.schema.ts`

Implement `SegmentSchema`, `CellValueFieldSchema`,
`RegionObjectSchema` per the index's § Final schema. Nine
refinements inside the `superRefine`.

Delete:
- `AxisPositionRoleSchema` (Phase-1)
- `PivotSegmentSchema` (Phase-1 shape)
- `SEGMENTED_CROSSTAB_NOT_SUPPORTED` refinement
- The old length-match / consistency refinements

Re-run A1 — green.

#### A3. Green — enums + barrel + core contracts

- `enums.ts`: drop `"cells-as-records"` from `ORIENTATIONS` (and
  delete `Orientation` type). Drop `"none"` from `HEADER_AXES`.
- `plan/index.ts`: export `SegmentSchema`, `Segment`,
  `CellValueFieldSchema`, `CellValueField`. Remove the old exports.
- `packages/core/src/contracts/spreadsheet-parsing.contract.ts`:
  mirror.

#### A4. Green — `interpret-input.schema.ts`

`RegionHintSchema` mirrors `RegionObjectSchema`. Hints drop
`orientation`, `headerAxis`, `recordsAxisName`, etc.

#### A5. Migrate fixture plans

- `simple-rows-as-records.json` — `headerAxes: ["row"]`, one field
  segment spanning every column.
- `pivoted-columns-as-records.json` — `headerAxes: ["column"]`,
  one pivot segment named `Month`; region-level
  `cellValueField: { name: "Revenue", nameSource: "user" }`.
- `crosstab.json` — `headerAxes: ["row", "column"]`, one pivot
  segment per axis with a `skip` segment at each axis's corner
  position, `cellValueField` present.

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

#### B2. Green — unified emit

Rename `extract-segmented-records.ts` → `extract-records.ts`
(atomic with importer updates; delete the old
`extract-records.ts`). The single function dispatches on
`headerAxes.length`:

- `0` (headerless): emit one record per entity-unit (direction
  from `recordsAxis`) via `columnBindings` with `byColumnIndex`.
- `1`: walk axis segments; statics-only emits one record per
  entity-unit; pivot-bearing emits one record per (entity-unit ×
  pivot position) with segment `axisName` + `cellValueField` in
  `fields`.
- `2`: Cartesian product of the two axes' pivot-label positions.
  One record per cell; `cellValueField` mandatory.

Helper signatures:

```ts
function expandSegmentsToPositions(
  segments: Segment[],
  startCoord: number,
): Array<{ segment: Segment; offsetInSegment: number; coord: number }>;

function cartesianCellSet(region: Region, bounds: ResolvedBounds, sheet: Sheet):
  Iterable<{ row: number; col: number; axisPositions: Position[] }>;
```

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
