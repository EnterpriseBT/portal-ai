# Region Segmentation — Schema + Replay

The foundational PR of the segments roadmap: replaces the pre-PR
region shape (`orientation` + `headerAxis` + `recordsAxisName` +
`secondaryRecordsAxisName` + `cellValueName`) with a unified
segment-list representation that works for 1D regions and crosstabs
alike. Replay drives off it uniformly; everything downstream — plan
persistence, interpret stages, the frontend editor — reads the new
fields.

Context: `docs/REGION_CONFIG_FLEXIBILITY.discovery.md` §§ "Crosstab
treatment", "Permutation matrix", "Phasing".

## Prerequisites

- C1 (`REGION_CONFIG.c1_one_region_per_entity.spec.md`) merged —
  segmented extraction assumes one region owns one entity.
- C2 (`REGION_CONFIG.c2_org_unique_entity_key.spec.md`) merged —
  reference validation inside segmented plans relies on org-unique
  keys.

## Schema

### `packages/spreadsheet-parsing/src/plan/region.schema.ts`

The canonical region shape:

```ts
export const SegmentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("field"),
    positionCount: z.number().int().min(1),
  }),
  z.object({
    kind: z.literal("pivot"),
    id: z.string().min(1),
    axisName: z.string().min(1),
    axisNameSource: z.enum(["user", "ai", "anchor-cell"]),
    positionCount: z.number().int().min(1),
    dynamic: z.object({ terminator: TerminatorSchema }).optional(),
  }),
  z.object({
    kind: z.literal("skip"),
    positionCount: z.number().int().min(1),
  }),
]);

export const CellValueFieldSchema = z.object({
  name: z.string().min(1),
  nameSource: z.enum(["user", "ai", "anchor-cell"]),
  columnDefinitionId: z.string().min(1).optional(),
});

// on RegionSchema:
headerAxes: z.array(AxisMemberEnum).max(2).default([]),
segmentsByAxis: z
  .object({
    row: z.array(SegmentSchema).optional(),
    column: z.array(SegmentSchema).optional(),
  })
  .optional(),
cellValueField: CellValueFieldSchema.optional(),
recordAxisTerminator: TerminatorSchema.optional(),
recordsAxis: AxisMemberEnum.optional(),
headerStrategyByAxis: z
  .object({
    row: HeaderStrategySchema.optional(),
    column: HeaderStrategySchema.optional(),
  })
  .optional(),
```

`Terminator` is a discriminated union of
`{ kind: "untilBlank", consecutiveBlanks }` and
`{ kind: "matchesPattern", pattern }`.

### Refinements

The delivered `RegionSchema.superRefine` block enforces:

| # | Rule |
|---|---|
| 1 | `headerAxes` entries are unique |
| 2 | `segmentsByAxis[axis]` is allowed (and required) iff `axis ∈ headerAxes` |
| 3 | Sum of `positionCount` on each axis matches the axis span; a dynamic tail pivot is allowed to claim ≥ 1 beyond the span floor |
| 4 | Pivot `id` is unique across both axes (implemented together with refinement 13 in the superRefine) |
| 5 | `recordsAxis` required iff `headerAxes.length === 0`; forbidden otherwise |
| 6 | `headerStrategyByAxis[axis]` required for each declared header axis; forbidden for axes not declared |
| 7 | `cellValueField` required iff at least one pivot segment exists; forbidden otherwise |
| 8 | `axisAnchorCell`, when present, must sit within `bounds` |
| 9 | `columnOverrides` keyed by default field names must target real positions on the record axis |
| 10 | `dynamic` segment must be the tail of its axis; at most one dynamic segment per axis |
| 11 | `recordAxisTerminator` is forbidden on a crosstab (`headerAxes.length === 2`) |
| 13 | Pivot `id` uniqueness restated as a hard per-segment constraint |
| 14 | `ColumnBinding.sourceLocator.axis` must be in `headerAxes` when `headerAxes` is non-empty |
| 15 | `byHeaderName` bindings are forbidden on headerless regions; `byPositionIndex` on a headerless region must target the axis opposite `recordsAxis` |
| 16 | `byPositionIndex.index` must fall within the position span on its axis |

Zod issues from the refinement block surface through the existing
parser plan-validation machinery as `LAYOUT_PLAN_INVALID_PAYLOAD`.

### `packages/core/src/contracts/spreadsheet-parsing.contract.ts`

Re-exports the new types (`Region`, `Segment`, `CellValueField`,
`Terminator`, `AxisMember`, etc.) so API + frontend consume them
through the same surface as the pre-PR region types.

## Replay

### `packages/spreadsheet-parsing/src/replay/extract-records.ts`

Replay is unified: there is no dispatch on pre-PR `orientation`.
Every region runs through the same emit loop driven by `headerAxes`
cardinality + per-axis segments.

### Unified record emission

Pseudocode:

```ts
function extractRecords(region, sheet): ExtractedRecord[] {
  const bounds = resolveRegionBounds(region, sheet);
  const axes = region.headerAxes;
  const recordAxisPositions = entityUnitsFor(region, bounds);
  const records: ExtractedRecord[] = [];

  for (const entityUnit of recordAxisPositions) {
    // Collect statics from field segments on declared axes.
    const statics = collectFieldValues(region, sheet, entityUnit);

    // Build the Cartesian product of pivot segments across declared
    // header axes. 1D region → 1-axis product; crosstab → 2-axis
    // product. Regions with no pivot segments have a 1-element
    // product and emit one statics-only record per entity unit.
    for (const pivotTuple of cartesianProduct(axes, region.segmentsByAxis)) {
      const axisFields: Record<string, unknown> = {};
      for (const { segment, position } of pivotTuple) {
        const label = pivotLabelAt(sheet, region, segment, position);
        axisFields[segment.axisName] = label;
      }
      const cellValue = valueAtIntersection(sheet, entityUnit, pivotTuple);
      records.push({
        regionId: region.id,
        targetEntityDefinitionId: region.targetEntityDefinitionId,
        sourceId: deriveSourceId(region, entityUnit, pivotTuple),
        checksum: computeChecksum({
          ...statics,
          ...axisFields,
          ...(region.cellValueField
            ? { [region.cellValueField.name]: cellValue }
            : {}),
        }),
        fields: {
          ...statics,
          ...axisFields,
          ...(region.cellValueField
            ? { [region.cellValueField.name]: cellValue }
            : {}),
        },
      });
    }
  }
  return records;
}
```

### Source-id derivation

`deriveSourceId` combines the base identity-strategy result with
`::segmentId::label` for each pivot involved in the tuple. A tidy
region (no pivot) produces `entitySourceId` unchanged — the
source-ids of the same shape match pre-PR encoding, so existing
records round-trip.

Drift detection still treats segment renames the same way axis
renames were treated pre-PR; the rename handler lives in the replay
drift module.

### Dynamic-tail + terminator

When the tail pivot on an axis has `dynamic` set, the replay engine
extends positions past the schema-declared `positionCount` up to the
point where the configured terminator fires
(`untilBlank.consecutiveBlanks` blanks in a row, or a cell matching
`matchesPattern.pattern`). `recordAxisTerminator` does the same for
the record axis on 1D / headerless regions — it's the sibling
affordance for "grow until" at the region level, forbidden on
crosstab (refinement 11).

## Acceptance criteria

- Every row of the discovery doc's permutation matrix round-trips
  through `RegionSchema.safeParse` when given a valid plan in the
  canonical segment shape.
- Row 8 (segmented crosstab) also round-trips — it is a crosstab with
  pivot segments on both axes plus `cellValueField`, no longer a
  deferred shape.
- `extractRecords` produces the expected record list for each matrix
  row. A single set of fixtures drives 1D (rows/cols/headerless) and
  2D (crosstab); the emit loop is shared across shapes.
- Refinements 1–11 + 13–16 from the table above reject every invalid
  plan fixture in `packages/spreadsheet-parsing/src/plan/__tests__/schemas.test.ts`.

## Test plan

### Schema
(`packages/spreadsheet-parsing/src/plan/__tests__/schemas.test.ts`)

- Valid 1D, pivoted-1D, headerless, and crosstab plans parse.
- Segment-span mismatch → refinement 3 error.
- Non-tail dynamic segment → refinement 10 error.
- `recordAxisTerminator` on a crosstab → refinement 11 error.
- Duplicate pivot ids across axes → refinement 13 error.
- `byPositionIndex.index` out of range → refinement 16 error.

### Replay
(`packages/spreadsheet-parsing/src/replay/__tests__/unified-emit.test.ts`)

Fixture-driven. Each matrix row has a hand-crafted plan + sheet
fixture; the test asserts on `extractRecords(plan, sheet)`:

- 1e canonical — Apple row produces 6 records, 3 quarter + 3 month,
  each with `{name: Apple, industry: Tech}` statics.
- 1c multi-pivot no statics — each row produces 6 records, no
  static fields.
- 1d mixed single segment — each row produces 3 records, all with
  the 2 statics.
- 1f mixed + skip — Total column has `kind: "skip"`; resulting
  records omit it entirely.
- 2e canonical transpose — each column produces 6 records.
- 3b / 4b — pivoted base + multi-segment emits records with the
  right segment axis-names (quarter vs. month).
- 7 — crosstab emits one record per `(row-label, col-label)` pair
  with `cellValueField.name` set to each intersection's value.
- 8 — static-prefix crosstab (field segment on row axis + pivot on
  both axes) replicates the statics into every record.

## Follow-ups

- `REGION_CONFIG.interpret.spec.md` — interpret pipeline produces
  segmented plans from hints.
- `REGION_CONFIG.ui.spec.md` — editor surfaces the segment-strip UI.
- Identity-drift handling for segment renames — tracked as a separate
  small spec once the rename UX is designed.
