# Segments-as-Composition — Roadmap (Index)

Collapses every region shape — tidy, pivoted, crosstab — into one
composable representation built from segments. Lands across **five
PRs** so each merge leaves the tree green and the review is
bounded.

This file is the index. Each PR has its own plan file:

| # | Plan file | Landing invariant |
|---|-----------|-------------------|
| 1 | [`REGION_CONFIG.segments_01_schema_replay.plan.md`](REGION_CONFIG.segments_01_schema_replay.plan.md) | New schema + replay + adapter-only interpret stages. **Zero behavior change.** |
| 2 | [`REGION_CONFIG.segments_02_detect_segments.plan.md`](REGION_CONFIG.segments_02_detect_segments.plan.md) | `detect-segments` heuristic stage; regions start producing multi-segment layouts. |
| 3 | [`REGION_CONFIG.segments_03_segment_classify_recommend.plan.md`](REGION_CONFIG.segments_03_segment_classify_recommend.plan.md) | Classifier filters to field-segments; per-segment axis-name recommender. Warning codes churn. |
| 4 | [`REGION_CONFIG.segments_04_region_editor.plan.md`](REGION_CONFIG.segments_04_region_editor.plan.md) | RegionEditor: default region on draw, segment CRUD, crosstab promotion. |
| 5 | [`REGION_CONFIG.segments_05_docs.plan.md`](REGION_CONFIG.segments_05_docs.plan.md) | Architecture spec rewrite, discovery doc close-out. |

## Shared invariants

- **No production data to migrate.** In-repo fixtures + consumer
  code only.
- **Every PR leaves the tree green** and all test suites pass.
- **No temporary or deprecated code** between PRs. File renames
  land atomically with their importer updates. No alias shims, no
  opt-in flags, no compatibility layers.
- **Commands** always from `/workspace`, never `npx jest` directly
  (per the test-scripts memory):

  | Purpose                    | Command                                                                                 |
  |----------------------------|-----------------------------------------------------------------------------------------|
  | Parser full suite          | `npm --workspace packages/spreadsheet-parsing run test`                                 |
  | Schema                     | `npm --workspace packages/spreadsheet-parsing run test -- schemas`                      |
  | Replay                     | `npm --workspace packages/spreadsheet-parsing run test -- replay segmented-records`     |
  | detect-segments (PR-2)     | `npm --workspace packages/spreadsheet-parsing run test -- detect-segments`              |
  | classify (PR-3)            | `npm --workspace packages/spreadsheet-parsing run test -- classify-field-segments`      |
  | recommender (PR-3)         | `npm --workspace packages/spreadsheet-parsing run test -- recommend-segment-axis-names` |
  | Orchestration              | `npm --workspace packages/spreadsheet-parsing run test -- orchestration`                |
  | Root type-check            | `npm run type-check`                                                                    |
  | API unit                   | `npm --workspace apps/api run test:unit`                                                |
  | Web unit                   | `npm --workspace apps/web run test:unit`                                                |

## Final schema (single source of truth)

Every sub-plan references this section. Any schema change must
edit here first.

```ts
export const TerminatorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("untilBlank"),
    consecutiveBlanks: z.number().int().min(1).default(2),
  }),
  z.object({
    kind: z.literal("matchesPattern"),
    pattern: z.string().min(1),
  }),
]);

export const SegmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field"), positionCount: z.number().int().min(1) }),
  z.object({
    kind: z.literal("pivot"),
    id: z.string().min(1),
    axisName: z.string().min(1),
    axisNameSource: z.enum(["user", "ai", "anchor-cell"]),
    // At interpret time: count of observed pivot-label positions.
    // At replay time: floor when `dynamic` is set, exact when absent.
    positionCount: z.number().int().min(1),
    // When present, the segment can grow past `positionCount` at replay.
    // Only allowed on tail segments (schema refinement 10).
    dynamic: z.object({ terminator: TerminatorSchema }).optional(),
  }),
  z.object({ kind: z.literal("skip"), positionCount: z.number().int().min(1) }),
]);

export const CellValueFieldSchema = z.object({
  name: z.string().min(1),
  nameSource: z.enum(["user", "ai", "anchor-cell"]),
  columnDefinitionId: z.string().min(1).optional(),
});

const AxisMember = z.enum(["row", "column"]);

const RegionObjectSchema = z.object({
  // …id, sheet, bounds, targetEntityDefinitionId, axisAnchorCell?,
  //  warnings, confidence…
  headerAxes: z.array(AxisMember).max(2).default([]),
  segmentsByAxis: z.object({
    row: z.array(SegmentSchema).optional(),
    column: z.array(SegmentSchema).optional(),
  }).optional(),
  cellValueField: CellValueFieldSchema.optional(),
  recordsAxis: AxisMember.optional(),
  // Drives record-axis extension at replay. When absent, record-axis
  // extent is exactly `bounds`. Replaces the old
  // `boundsMode: "untilEmpty" | "matchesPattern"` + `boundsPattern`
  // + `untilEmptyTerminatorCount` fields.
  recordAxisTerminator: TerminatorSchema.optional(),
  headerStrategyByAxis: z.object({
    row: HeaderStrategySchema.optional(),
    column: HeaderStrategySchema.optional(),
  }).optional(),
  identityStrategy: IdentityStrategySchema,
  columnBindings: z.array(ColumnBindingSchema),
  skipRules: z.array(SkipRuleSchema),
  drift: DriftKnobsSchema,
});
```

Deleted region fields (vs. Phase 1 schema): `orientation`,
`headerAxis`, `boundsMode`, `boundsPattern`,
`untilEmptyTerminatorCount`, `recordsAxisName`,
`secondaryRecordsAxisName`, `cellValueName`, `positionRoles`,
`pivotSegments`. `BOUNDS_MODES` / `BoundsModeEnum` delete entirely.

### Binding locators

`ColumnBinding.sourceLocator` needs to be unambiguous across both
axes of a 2D region. The Phase-1 locators (`byHeaderName {
name }`, `byColumnIndex { col }`) silently assumed a single
header line per region — fine for 1D, ambiguous for 2D. Under
this roadmap every locator carries an explicit `axis`:

```ts
export const BindingSourceLocatorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("byHeaderName"),
    axis: z.enum(["row", "column"]),
    name: z.string().min(1),
  }),
  z.object({
    kind: z.literal("byPositionIndex"),
    axis: z.enum(["row", "column"]),
    // 1-based ordinal along the axis's position list (not a sheet col/row).
    index: z.number().int().min(1),
  }),
]);
```

Renames: `byColumnIndex` → `byPositionIndex`. The old name was
1D-centric ("sheet column index"); the new semantics are
axis-relative ("1-based position along the axis"). For 1D
regions with a "row" header axis, `axis: "row"` + `index: N`
still resolves to sheet column N — behaviorally identical to
today's `byColumnIndex { col: N }`.

`axis` is required on every locator. Defaults would re-introduce
the ambiguity we're deleting.

### Refinements (numbered; sub-plans reference by number)

1. `headerAxes` entries unique.
2. `segmentsByAxis[axis]` only when `axis ∈ headerAxes`.
3. Fixed-segment `positionCount` constraint per axis — see § Extent model.
4. Pivot `id` unique across both axes.
5. `recordsAxis` required iff `headerAxes.length === 0`; forbidden otherwise.
6. `headerStrategyByAxis[axis]` required for every `axis ∈ headerAxes`; forbidden otherwise.
7. `cellValueField` required iff at least one pivot segment exists; forbidden otherwise.
8. Every field-segment position has a matching `columnBindings` entry (byPositionIndex locators validated at schema; byHeaderName at replay).
9. Removed fields (`orientation`, `headerAxis`, `boundsMode`, `boundsPattern`, `untilEmptyTerminatorCount`, `recordsAxisName`, `secondaryRecordsAxisName`, `cellValueName`, `positionRoles`, `pivotSegments`, per-segment `valueFieldName`, locator `byColumnIndex`) rejected by the schema.
10. A segment carrying `dynamic` must be the **last** segment on its axis. At most one dynamic segment per axis. (Discriminated-union structure already forbids `dynamic` on non-pivot segments.)
11. `recordAxisTerminator` forbidden when `headerAxes.length === 2` — no record axis on a crosstab.
12. `recordAxisTerminator` requires `recordsAxisOf(region)` to resolve to a concrete axis (1D or headerless). Paired with refinement 5, this is automatic.
13. Pivot id is unique across both axes AND across all segments (refinement 4 strengthened): mid-axis dynamic segments aren't supported in v1, so allowing shared ids would confuse extension claims.
14. `sourceLocator.axis` must appear in `region.headerAxes` when `headerAxes.length > 0`. A locator cannot reference an axis that has no segments.
15. `byHeaderName` locators are forbidden on headerless regions (no header line exists to look up a name against). Headerless regions use `byPositionIndex` only, with `axis` equal to the axis opposite `recordsAxis` (the direction positions would lie along if a header line existed).
16. `byPositionIndex.index` must be in `[1, positionSpan(axis)]` where `positionSpan("row") = endCol − startCol + 1` and `positionSpan("column") = endRow − startRow + 1`.

### Extent model

**Three sources of dynamism**, each opt-in:

1. **Record-axis terminator** (region-level
   `recordAxisTerminator`). Extends the record axis (row for
   `recordsAxisOf === "row"`, col for `"column"`). Valid only on
   1D + headerless (refinement 11). Replaces the old
   `boundsMode: "untilEmpty"` / `"matchesPattern"` +
   `boundsPattern` + `untilEmptyTerminatorCount` trio.
2. **Dynamic tail pivot segment** (`segment.dynamic.terminator`).
   Extends a header axis beyond its declared `positionCount`.
   Only allowed on the tail segment (refinement 10). Enables
   indefinite pivot-label sets like year / date.
3. **Fixed segments** (no `dynamic`). `positionCount` is exact.
   Quarter (4), month (12), enum-like label sets.

**Refinement 3 (length match)** becomes:

- For each axis with segments: let `fixed = Σ positionCount of
  non-dynamic segments`, `dynamicFloor = Σ positionCount of
  dynamic segments`.
  - No dynamic segment on the axis: `fixed === span` (as before).
  - Dynamic tail segment present: `fixed + dynamicFloor ≤ span`
    AND `fixed + dynamicFloor - tail.positionCount + 1 ≤ span`
    (the tail dynamic segment claims at least one position).

At replay time, the dynamic segment's **effective** `positionCount`
is computed by walking the axis from its starting offset until the
terminator fires (blank-run of `consecutiveBlanks`, or a cell
matching `pattern`) or the sheet edge.

**Bounds semantics.** `region.bounds` reflects the extent observed
at last interpret. Replay computes `effectiveBounds` by:

- Extending the record axis via `recordAxisTerminator`.
- Extending each axis with a dynamic tail segment via the
  segment's terminator.
- Leaving axes with no extension at `bounds`.

Persisted plans stay stable between replays — replay is pure.
Drift detection noting significant extent growth is a follow-up
(today's drift machinery only covers added/removed columns on
classic tidy; segmented extent drift is out of scope for v1).

### Derived properties

- `isCrosstab(region) ≡ headerAxes.length === 2`
- `recordsAxisOf(region) ≡ headerAxes.length === 1 ? headerAxes[0]
    : headerAxes.length === 0 ? region.recordsAxis
    : undefined`
  — Convention: `headerAxes` entry `"row"` means "a header line
    that's a row of cells." For headerAxes:["row"], records
    iterate along row indices (each data row is a record) →
    records axis = `"row"`. Same-direction, not orthogonal.
- `isPivoted(region) ≡ any segment.kind === "pivot"`
- `isDynamic(region) ≡ recordAxisTerminator defined
    OR any segment.dynamic defined`

### Skip rules vs. skip segments

The two are orthogonal and coexist:

| | `segment.kind === "skip"` | `region.skipRules[]` |
|---|---|---|
| Scope | one position on a header axis | one record (row / col / cell) |
| Mechanism | structural, declared upfront | predicate evaluated per record at replay |
| Example | "Total" column inside a pivot row | "skip rows where column 1 matches /^Total$/" |

Structural skipping (skip segment) is resolved at emit time by
walking `effectiveSegmentsByAxis` and dropping positions tagged
`skip`. Predicate skipping (skip rule) is resolved per-record by
the existing `ruleMatchesRecord` machinery — rewritten in PR-1
to dispatch on `headerAxes.length` + `recordsAxisOf(region)`
instead of `orientation`. 2D (crosstab) regions evaluate skip
rules per cell: `blank` = cell empty; `cellMatches` reads the
`axis` field to pick the cross-axis reference cell.

The editor (PR-4) surfaces both: a segment chip's "Convert to
skip" operation creates a skip segment; a separate skip-rules
panel lets the user add value-matching rules. They don't merge.

### Default region on draw (RegionEditor)

```ts
{
  headerAxes: ["row"],
  segmentsByAxis: { row: [{ kind: "field", positionCount: N }] },
  headerStrategyByAxis: { row: { kind: "row", locator: { kind: "row", sheet, row: bounds.startRow }, confidence: 1 } },
  columnBindings: /* N byHeaderName bindings, one per row-1 cell */,
  identityStrategy: { kind: "rowPosition", confidence: 0.6 },
  // no pivotSegments, no cellValueField, no recordsAxis
}
```

Matches today's classic tidy byte-for-byte. Lands in PR-4.

## Prerequisites

- `d2c1d1d`, `d24bf63`, `b7997ed` — schema_replay Phase 1 on this
  branch. Superseded by PR-1 below.

## Completion criteria

After all five PRs merge:

- A region is one composable list of segments per header axis, 0/1/2
  axes.
- `orientation`, `headerAxis`, `recordsAxisName`,
  `secondaryRecordsAxisName`, `cellValueName`, `positionRoles`,
  `pivotSegments`, per-segment `valueFieldName` all erased from the
  codebase.
- RegionEditor composes regions through segment-level operations.
- Classic tidy / pivoted / crosstab all work via one emit path.
- Architecture spec reflects the unified model.
