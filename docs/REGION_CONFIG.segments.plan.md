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
export const SegmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field"), positionCount: z.number().int().min(1) }),
  z.object({
    kind: z.literal("pivot"),
    id: z.string().min(1),
    axisName: z.string().min(1),
    axisNameSource: z.enum(["user", "ai", "anchor-cell"]),
    positionCount: z.number().int().min(1),
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
  // …id, sheet, bounds, boundsMode, targetEntityDefinitionId, axisAnchorCell?,
  //  boundsPattern?, untilEmptyTerminatorCount?, warnings, confidence…
  headerAxes: z.array(AxisMember).max(2).default([]),
  segmentsByAxis: z.object({
    row: z.array(SegmentSchema).optional(),
    column: z.array(SegmentSchema).optional(),
  }).optional(),
  cellValueField: CellValueFieldSchema.optional(),
  recordsAxis: AxisMember.optional(),
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

### Refinements (numbered; sub-plans reference by number)

1. `headerAxes` entries unique.
2. `segmentsByAxis[axis]` only when `axis ∈ headerAxes`.
3. Sum of `segment.positionCount` per axis === span along that axis.
4. Pivot `id` unique across both axes.
5. `recordsAxis` required iff `headerAxes.length === 0`; forbidden otherwise.
6. `headerStrategyByAxis[axis]` required for every `axis ∈ headerAxes`; forbidden otherwise.
7. `cellValueField` required iff at least one pivot segment exists; forbidden otherwise.
8. Every field-segment position has a matching `columnBindings` entry (byColumnIndex locators validated at schema; byHeaderName at replay).
9. Removed fields (`orientation`, `headerAxis`, `recordsAxisName`, `secondaryRecordsAxisName`, `cellValueName`, `positionRoles`, `pivotSegments`, per-segment `valueFieldName`) rejected by the schema.

### Derived properties

- `isCrosstab(region) ≡ headerAxes.length === 2`
- `recordsAxisOf(region) ≡ headerAxes.length === 1 ? headerAxes[0]
    : headerAxes.length === 0 ? region.recordsAxis
    : undefined`
- `isPivoted(region) ≡ any segment.kind === "pivot"`

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
