# Region Segmentation — Schema + Replay (Phase 1)

The smallest shippable unit that proves the segmented-region
semantics. No interpret-pipeline changes, no UI. Plans crafted by
hand or by direct API construction round-trip through schema
validation and extract records correctly.

Context: `docs/REGION_CONFIG_FLEXIBILITY.discovery.md` §§ "Schema
additions", "Record generation semantics", "Replay pipeline changes",
"Crosstab treatment".

## Prerequisites

- C1 (`REGION_CONFIG.c1_one_region_per_entity.spec.md`) merged —
  segmented extraction assumes one region owns one entity.
- C2 (`REGION_CONFIG.c2_org_unique_entity_key.spec.md`) merged —
  reference validation inside segmented plans relies on org-unique
  keys.

## Schema additions

### `packages/spreadsheet-parsing/src/plan/region.schema.ts`

Two new optional fields on the region schema:

```ts
const AxisPositionRoleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field") }),
  z.object({
    kind: z.literal("pivotLabel"),
    segmentId: z.string().min(1),
  }),
  z.object({ kind: z.literal("skip") }),
]);

const PivotSegmentSchema = z.object({
  id: z.string().min(1),
  axisName: z.string().min(1),
  axisNameSource: z.enum(["user", "ai", "anchor-cell"]),
  valueFieldName: z.string().min(1),
  valueFieldNameSource: z.enum(["user", "ai", "anchor-cell"]),
  valueColumnDefinitionId: z.string().min(1).optional(),
});

// on RegionSchema:
positionRoles: z.array(AxisPositionRoleSchema).optional(),
pivotSegments: z.array(PivotSegmentSchema).optional(),
```

### Zod refinements

The RegionSchema gets three refinements:

1. **Crosstab exemption** — if `orientation === "cells-as-records"`,
   `positionRoles` and `pivotSegments` must both be absent. Error
   code carried as `SEGMENTED_CROSSTAB_NOT_SUPPORTED`.
2. **Length match** — if `positionRoles` is present, its length
   must equal the header-line length (`bounds.endCol -
   bounds.startCol + 1` for `headerAxis:row`, or
   `bounds.endRow - bounds.startRow + 1` for `headerAxis:column`).
3. **Segment consistency** — every `pivotLabel.segmentId` in
   `positionRoles` must reference an id in `pivotSegments`; every
   segment in `pivotSegments` must be referenced by at least one
   position.

Refinement failures manifest as Zod issues; the existing parser's
plan-validation machinery surfaces them as
`LAYOUT_PLAN_INVALID_PAYLOAD`.

### `packages/core/src/contracts/spreadsheet-parsing.contract.ts`

Re-export the two new types so API + frontend consume them through
the same surface as today's region types.

## Replay changes

### `packages/spreadsheet-parsing/src/replay/extract-records.ts`

Add a branch at the top of `extractRecords`:

```ts
if (region.positionRoles && region.pivotSegments) {
  return extractSegmentedRecords(region, sheet);
}
// ...existing orientation branches...
```

### New function: `extractSegmentedRecords`

File:
`packages/spreadsheet-parsing/src/replay/extract-segmented-records.ts`

Pseudocode:

```ts
function extractSegmentedRecords(region, sheet): ExtractedRecord[] {
  const bounds = resolveRegionBounds(region, sheet);
  const records: ExtractedRecord[] = [];

  const positions = positionsForHeaderAxis(region, bounds);
  const roleByPosition = zipPositionsWithRoles(positions, region.positionRoles);
  const segmentById = indexBy(region.pivotSegments, "id");

  for (const entityUnit of entityUnitsFor(region, bounds)) {
    // Collect statics — one value per field-role position, cell value
    // at (entityUnit, position).
    const statics: Record<string, unknown> = {};
    for (const { position, role } of roleByPosition) {
      if (role.kind !== "field") continue;
      const binding = bindingForPosition(region, position);
      if (!binding) continue;
      statics[binding.columnDefinitionId] = cellValueAt(sheet, entityUnit, position);
    }

    // For each segment, emit one record per pivotLabel position.
    for (const segment of region.pivotSegments) {
      for (const { position, role } of roleByPosition) {
        if (role.kind !== "pivotLabel") continue;
        if (role.segmentId !== segment.id) continue;
        const label = headerLabelAt(sheet, region, position);
        const value = cellValueAt(sheet, entityUnit, position);
        records.push({
          regionId: region.id,
          targetEntityDefinitionId: region.targetEntityDefinitionId,
          sourceId: deriveSegmentedSourceId(region, entityUnit, segment.id, label),
          checksum: computeChecksum({
            ...statics,
            [segment.axisName]: label,
            [segment.valueFieldName]: value,
          }),
          fields: {
            ...statics,
            [segment.axisName]: label,
            [segment.valueFieldName]: value,
          },
        });
      }
    }
  }
  return records;
}
```

### Source-id derivation

`deriveSegmentedSourceId` combines `(entityUnit sourceId,
segmentId, positionLabel)` into a stable string, e.g.
`${entitySourceId}::${segmentId}::${label}`. The entity sourceId
still comes from the existing identity strategy
(`rowPosition` / `column` / `composite`). The segment suffix plus
label disambiguate the multiple records a single entity-unit emits.

Drift detection treats segment renames the same way axis renames are
treated today (see `SPREADSHEET_PARSING.architecture.spec.md` §
"Identity drift"). That extension is tracked as a follow-up; for
v1, renaming a segment is a known rebuild trigger.

### Orientation dispatch

`entityUnitsFor` and `positionsForHeaderAxis` are small helpers that
resolve to:

| orientation            | headerAxis | entityUnits         | positions          |
|------------------------|------------|---------------------|--------------------|
| rows-as-records        | row        | data rows           | columns in bounds  |
| rows-as-records        | column     | data cols (pivoted) | rows in bounds     |
| columns-as-records     | column     | data cols           | rows in bounds     |
| columns-as-records     | row        | data rows (pivoted) | columns in bounds  |

The pivoted rows-as-records + headerAxis:column and its transpose
also get full segmentation support. When the base is pivoted, the
"statics" pass collects per-entity-unit static fields from the field
positions (perpendicular axis via `columnBindings`). The pivotLabel
positions then emit records exactly as in the non-pivoted case —
each position contributes one record per entity-unit.

## Backward compat

- Regions without `positionRoles` (or without `pivotSegments`) take
  the existing orientation branches. No behavior change.
- Existing plans in the database validate cleanly against the new
  schema.
- `plan-version.ts` — no bump required because the new fields are
  optional additions. A future plan-version bump is needed when
  segmented plans become the default representation for shapes that
  today use `recordsAxisName`/`cellValueName`.

## Acceptance criteria

- Zod validation accepts every row marked "✅" in the discovery doc's
  permutation matrix when fed a plan whose `positionRoles` and
  `pivotSegments` match the expected shape.
- Zod validation rejects segmented crosstab (matrix row 8) with
  `SEGMENTED_CROSSTAB_NOT_SUPPORTED`.
- `extractRecords` produces the expected record list for each
  in-scope matrix id. Fixture fed by
  `docs/fixtures/region-segmentation-matrix.csv` (or the XLSX
  equivalent) via a helper that builds a plan for each id.
- Existing replay tests (classic `rows-as-records`, `pivoted-columns-as-records`,
  crosstab) still pass unchanged.

## Test plan

### Schema
(`packages/spreadsheet-parsing/src/plan/__tests__/schemas.test.ts`)

- Valid segmented region with matching `positionRoles` +
  `pivotSegments` parses.
- Mismatched role count vs. bounds → Zod issue.
- Orphan `segmentId` reference in `positionRoles` → Zod issue.
- Segmented crosstab (`cells-as-records` + roles) → Zod issue with
  `SEGMENTED_CROSSTAB_NOT_SUPPORTED`.

### Replay
(`packages/spreadsheet-parsing/src/replay/__tests__/segmented-records.test.ts`
— new file)

Fixture-driven. A helper `loadMatrixFixture(id)` loads the
permutation block from the CSV + a hand-crafted plan for that id.
Tests:

- 1e canonical — Apple row produces 6 records, 3 quarter + 3 month,
  each with {name: Apple, industry: Tech} statics.
- 1c multi-pivot no statics — each row produces 6 records, no
  static fields.
- 1d mixed single segment — each row produces 3 records, all with
  the 2 statics.
- 1f mixed + skip — Total column has `kind: "skip"` role; resulting
  records omit it entirely.
- 2e canonical transpose — each col produces 6 records.
- 3b / 4b — pivoted base + multi-segment emits records with the
  right segment axis-names (quarter vs. month).

### Extract-records regression

Existing tests in
`packages/spreadsheet-parsing/src/replay/__tests__/{rows-as-records,columns-as-records,cells-as-records}.test.ts`
all pass unmodified.

## Non-goals

- No `detect-position-roles` stage — plans are hand-crafted.
- No LLM classify for segmented regions — existing classifier still
  runs; for a segmented region the classifier just sees the
  field-role positions (or an empty set if all roles are
  pivotLabel).
- No frontend role strip — UI still shows today's
  `recordsAxisName`/`cellValueName` editors. Segmented regions
  arrive at the editor already configured (from fixtures or direct
  API calls) and the editor may not render them accurately yet —
  spec for UI is separate.
- No crosstab segmentation (Zod rejects).

## Follow-ups

- `REGION_CONFIG.interpret.spec.md` — interpret pipeline produces
  segmented plans from hints.
- `REGION_CONFIG.ui.spec.md` — editor surfaces the role strip.
- Identity-drift handling for segment renames (separate small spec
  once the segment-rename UX is designed).
