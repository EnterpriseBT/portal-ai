# Phase 1 — Schema + Replay (Segmentation) — Implementation Plan

TDD-ordered walkthrough to ship
`REGION_CONFIG.schema_replay.spec.md` as a single PR. Every step is
**red → green → refactor**: write (or extend) the failing test first,
run it to confirm it fails for the right reason, implement the
smallest change that makes it green, run the scoped command, then
extend coverage and refactor.

Prerequisites (both merged):

- C1 — `REGION_CONFIG.c1_one_region_per_entity.spec.md`
- C2 — `REGION_CONFIG.c2_org_unique_entity_key.spec.md`

Feature flag: none. The new schema fields are optional; plans without
them take the existing orientation branches and behave exactly as
today. The PR is safe to ship because segmented plans reach the
system only through hand-crafted fixtures or direct API construction
until phase 2 (interpret) lands.

## Pre-flight

Open the current state so later steps have accurate references:

- `packages/spreadsheet-parsing/src/plan/region.schema.ts` — note the
  existing `RegionObjectSchema` (`z.object`) and the
  `RegionSchema = RegionObjectSchema.superRefine(...)` wrapper. New
  fields land on the object schema; new validation lands inside the
  existing `superRefine`.
- `packages/spreadsheet-parsing/src/plan/index.ts` — note the current
  barrel exports; `AxisPositionRole` and `PivotSegment` types need to
  join `Region`.
- `packages/spreadsheet-parsing/src/replay/extract-records.ts` — note
  `extractRecords` entry at line 153 and the three orientation
  branches it dispatches to. The segmented branch is a new sibling,
  not a replacement.
- `packages/spreadsheet-parsing/src/replay/resolve-bounds.ts` and
  `resolve-headers.ts` — note the helpers that return row/col ranges
  and header→coord maps. `extractSegmentedRecords` reuses them
  verbatim; no changes required.
- `packages/spreadsheet-parsing/src/replay/identity.ts` — note
  `deriveSourceId`'s contract. Segmented records extend the base
  source-id with a segment+label suffix; the helper stays unchanged
  and a new `deriveSegmentedSourceId` composes on top.
- `packages/spreadsheet-parsing/src/replay/__tests__/rows-as-records.test.ts`
  — note the inline `makeWorkbook(...)` fixture pattern. New
  segmentation tests follow the same shape (no CSV loader required).
- `packages/spreadsheet-parsing/src/plan/__tests__/schemas.test.ts` —
  existing parse/reject tests; extend with new `describe` blocks for
  segmented regions.
- `packages/core/src/contracts/spreadsheet-parsing.contract.ts` —
  re-exports `RegionSchema`, `Region`, etc.; must grow to re-export
  `AxisPositionRoleSchema`, `AxisPositionRole`, `PivotSegmentSchema`,
  `PivotSegment`.
- `packages/spreadsheet-parsing/src/plan-version.ts` — note the
  constant. **Not** bumped in this phase per the spec (optional
  additive fields).
- `docs/REGION_CONFIG_FLEXIBILITY.discovery.md` § "Permutation
  matrix" — the canonical list of in-scope shapes (1a–6, plus 7). Row
  ids drive the replay test matrix.
- `docs/REGION_CONFIG_FLEXIBILITY.discovery.md` § "Record generation
  semantics" — the pseudocode to follow.
- `apps/web/public/samples/region-segmentation-matrix.{csv,xlsx}` —
  the sample files already committed in 4186df1. The canonical data
  for each matrix id is here. For replay tests we transcribe cells
  into `makeWorkbook(...)` inline to match existing test style — no
  CSV-loader plumbing.

Commands referenced throughout, always run from `/workspace`:

| Purpose                         | Command                                                         |
|---------------------------------|-----------------------------------------------------------------|
| Parser unit + integration       | `npm --workspace packages/spreadsheet-parsing run test`         |
| Parser schema-focused re-run    | `npm --workspace packages/spreadsheet-parsing run test -- schemas` |
| Parser replay-focused re-run    | `npm --workspace packages/spreadsheet-parsing run test -- segmented-records` |
| Parser regression re-run        | `npm --workspace packages/spreadsheet-parsing run test -- rows-as-records columns-as-records cells-as-records` |
| Core contracts type-check       | `npm --workspace packages/core run build` (type-only)           |
| API unit                        | `npm --workspace apps/api run test:unit`                        |
| API integration                 | `npm --workspace apps/api run test:integration`                 |
| Web unit                        | `npm --workspace apps/web run test:unit`                        |
| Root type-check                 | `npm run type-check`                                            |

Per the memory on test scripts, never run `npx jest` directly — these
scripts set the right `NODE_OPTIONS`.

---

## Phase A — Schema types (foundational)

### A1. Red — schema parse tests

**File**: `packages/spreadsheet-parsing/src/plan/__tests__/schemas.test.ts`
(extend).

Add a new `describe` block that exercises the two new types in
isolation before tackling whole-region parsing:

```ts
describe("AxisPositionRoleSchema", () => {
  it("parses field / pivotLabel / skip variants", () => {
    expect(AxisPositionRoleSchema.safeParse({ kind: "field" }).success).toBe(true);
    expect(
      AxisPositionRoleSchema.safeParse({ kind: "pivotLabel", segmentId: "s1" }).success
    ).toBe(true);
    expect(AxisPositionRoleSchema.safeParse({ kind: "skip" }).success).toBe(true);
  });

  it("rejects pivotLabel without segmentId", () => {
    const r = AxisPositionRoleSchema.safeParse({ kind: "pivotLabel" });
    expect(r.success).toBe(false);
  });

  it("rejects unknown kind", () => {
    expect(
      AxisPositionRoleSchema.safeParse({ kind: "whatever" } as unknown).success
    ).toBe(false);
  });
});

describe("PivotSegmentSchema", () => {
  it("accepts a minimal segment with required fields", () => {
    const ok = PivotSegmentSchema.safeParse({
      id: "s1",
      axisName: "quarter",
      axisNameSource: "user",
      valueFieldName: "revenue",
      valueFieldNameSource: "user",
    });
    expect(ok.success).toBe(true);
  });

  it("accepts the optional valueColumnDefinitionId", () => {
    // …
  });

  it("rejects empty ids / axis names", () => {
    // …
  });
});
```

Run: `npm --workspace packages/spreadsheet-parsing run test -- schemas`.
Expect failure — the symbols don't exist yet.

### A2. Green — add the two schemas

**File**: `packages/spreadsheet-parsing/src/plan/region.schema.ts`.

```ts
export const AxisPositionRoleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field") }),
  z.object({
    kind: z.literal("pivotLabel"),
    segmentId: z.string().min(1),
  }),
  z.object({ kind: z.literal("skip") }),
]);
export type AxisPositionRole = z.infer<typeof AxisPositionRoleSchema>;

export const PivotSegmentSchema = z.object({
  id: z.string().min(1),
  axisName: z.string().min(1),
  axisNameSource: z.enum(["user", "ai", "anchor-cell"]),
  valueFieldName: z.string().min(1),
  valueFieldNameSource: z.enum(["user", "ai", "anchor-cell"]),
  valueColumnDefinitionId: z.string().min(1).optional(),
});
export type PivotSegment = z.infer<typeof PivotSegmentSchema>;
```

Extend `RegionObjectSchema` with the two optional arrays:

```ts
positionRoles: z.array(AxisPositionRoleSchema).optional(),
pivotSegments: z.array(PivotSegmentSchema).optional(),
```

Run A1 again — green.

### A3. Wire the barrel + contract re-exports

**Files**:

- `packages/spreadsheet-parsing/src/plan/index.ts` — add the new
  schemas and types to the existing barrel export list alongside
  `RegionSchema`.
- `packages/core/src/contracts/spreadsheet-parsing.contract.ts` —
  re-export `AxisPositionRoleSchema`, `AxisPositionRole`,
  `PivotSegmentSchema`, `PivotSegment` so API + web consume them
  through the same surface as today's region types.

No dedicated test; this is verified by the downstream consumers'
type-check (`npm run type-check`).

---

## Phase B — Schema refinements

### B1. Red — crosstab exemption test

**File**: `packages/spreadsheet-parsing/src/plan/__tests__/schemas.test.ts`
(extend).

```ts
describe("RegionSchema — segmented crosstab exemption", () => {
  it("rejects a cells-as-records region that carries positionRoles", () => {
    const plan = {
      ...baseCrosstabRegion(),
      positionRoles: [{ kind: "field" as const }],
    };
    const r = RegionSchema.safeParse(plan);
    expect(r.success).toBe(false);
    const msg = JSON.stringify(r.error);
    expect(msg).toMatch(/SEGMENTED_CROSSTAB_NOT_SUPPORTED/);
  });

  it("rejects a cells-as-records region that carries pivotSegments", () => {
    // same shape, pivotSegments instead of positionRoles.
  });
});
```

Run: schema test file. Expect failure — the current
`superRefine` has no crosstab guard.

### B2. Green — crosstab exemption refinement

**File**: `packages/spreadsheet-parsing/src/plan/region.schema.ts`.

Inside the existing `superRefine`:

```ts
if (
  region.orientation === "cells-as-records" &&
  (region.positionRoles?.length || region.pivotSegments?.length)
) {
  ctx.addIssue({
    code: "custom",
    message: "SEGMENTED_CROSSTAB_NOT_SUPPORTED",
    path: ["positionRoles"],
  });
}
```

Surface `SEGMENTED_CROSSTAB_NOT_SUPPORTED` as the `message` so the
existing issue-reporting path doesn't need a new code constant. If a
dedicated constant is already conventional elsewhere in the package,
match that pattern instead.

Run B1 again — green.

### B3. Red — length-match refinement test

```ts
describe("RegionSchema — positionRoles length must match header-line length", () => {
  it("rejects when positionRoles length differs from header-row width", () => {
    const plan = rowsBaseRegion({ cols: [1, 4] }); // width 4
    plan.positionRoles = [
      { kind: "field" },
      { kind: "field" },
    ]; // only 2 — mismatch
    plan.pivotSegments = [];
    const r = RegionSchema.safeParse(plan);
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error)).toMatch(/positionRoles/);
  });

  it("accepts when length matches header-row width", () => {
    const plan = rowsBaseRegion({ cols: [1, 4] });
    plan.positionRoles = Array(4).fill({ kind: "field" as const });
    plan.pivotSegments = [];
    expect(RegionSchema.safeParse(plan).success).toBe(true);
  });

  it("uses column span when headerAxis === 'column'", () => {
    // headerAxis: "column" → length = endRow - startRow + 1
  });
});
```

### B4. Green — length-match refinement

Inside the same `superRefine`:

```ts
if (region.positionRoles && region.headerAxis !== "none") {
  const expected =
    region.headerAxis === "row"
      ? region.bounds.endCol - region.bounds.startCol + 1
      : region.bounds.endRow - region.bounds.startRow + 1;
  if (region.positionRoles.length !== expected) {
    ctx.addIssue({
      code: "custom",
      message: `positionRoles length ${region.positionRoles.length} does not match header-line length ${expected}`,
      path: ["positionRoles"],
    });
  }
}
```

### B5. Red — segment-consistency refinement test

```ts
describe("RegionSchema — positionRoles / pivotSegments consistency", () => {
  it("rejects when a pivotLabel role references an unknown segmentId", () => {
    const plan = segmentedPlan();
    plan.positionRoles![1] = { kind: "pivotLabel", segmentId: "ghost" };
    plan.pivotSegments = [segment("s1")];
    const r = RegionSchema.safeParse(plan);
    expect(r.success).toBe(false);
  });

  it("rejects when pivotSegments contains a segment no position references", () => {
    const plan = segmentedPlan();
    plan.pivotSegments = [segment("s1"), segment("s2")]; // s2 unused
    const r = RegionSchema.safeParse(plan);
    expect(r.success).toBe(false);
  });

  it("accepts when every pivotLabel.segmentId maps to a segment and vice versa", () => {
    // …
  });
});
```

### B6. Green — segment-consistency refinement

Inside the same `superRefine`:

```ts
if (region.positionRoles && region.pivotSegments) {
  const segmentIds = new Set(region.pivotSegments.map((s) => s.id));
  const referenced = new Set<string>();
  region.positionRoles.forEach((role, i) => {
    if (role.kind === "pivotLabel") {
      referenced.add(role.segmentId);
      if (!segmentIds.has(role.segmentId)) {
        ctx.addIssue({
          code: "custom",
          message: `positionRoles[${i}].segmentId "${role.segmentId}" is not declared in pivotSegments`,
          path: ["positionRoles", i, "segmentId"],
        });
      }
    }
  });
  region.pivotSegments.forEach((s, i) => {
    if (!referenced.has(s.id)) {
      ctx.addIssue({
        code: "custom",
        message: `pivotSegments[${i}].id "${s.id}" is not referenced by any position`,
        path: ["pivotSegments", i, "id"],
      });
    }
  });
}
```

Run B3 + B5 again — green.

### B7. Refactor

- If the three refinements are independently complex, extract them
  into private helpers (`refineCrosstabExemption(region, ctx)`,
  `refinePositionRoleLength(region, ctx)`,
  `refineSegmentConsistency(region, ctx)`) called from the single
  `superRefine`. Keep the file flat otherwise.
- Re-run the full schema suite.

---

## Phase C — Replay dispatch

### C1. Red — non-segmented plans still work (regression guard)

**File**: `packages/spreadsheet-parsing/src/replay/__tests__/rows-as-records.test.ts`
(and its siblings — no edit required, just re-run to establish the
baseline).

Before touching `extractRecords`, run the full replay suite once:

```
npm --workspace packages/spreadsheet-parsing run test -- rows-as-records columns-as-records cells-as-records
```

All tests must be green. This is the regression floor.

### C2. Red — segmented-records test file with a failing 1e canonical

**File**: `packages/spreadsheet-parsing/src/replay/__tests__/segmented-records.test.ts`
(new).

Start with the motivating case — matrix id **1e** (rows ×
headerAxis:row × statics + 2 segments):

```ts
import { describe, it, expect } from "@jest/globals";
import { makeWorkbook } from "../../workbook/helpers.js";
import { extractRecords } from "../extract-records.js";
import type { Region } from "../../plan/index.js";

describe("extractRecords — segmented (matrix id 1e)", () => {
  it("emits statics + one record per pivotLabel position per entity-unit", () => {
    // Header: name | industry | Q1 | Q2 | Q3 | Jan | Feb | Mar
    // Row:    Apple | Tech    | 10 | 20 | 30 | 4   | 5   | 6
    const wb = makeWorkbook({
      "Data": [
        ["name", "industry", "Q1", "Q2", "Q3", "Jan", "Feb", "Mar"],
        ["Apple", "Tech", 10, 20, 30, 4, 5, 6],
      ],
    });

    const region: Region = {
      id: "r1",
      sheet: "Data",
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 8 },
      boundsMode: "absolute",
      targetEntityDefinitionId: "companies",
      orientation: "rows-as-records",
      headerAxis: "row",
      headerStrategy: {
        kind: "row",
        locator: { kind: "row", sheet: "Data", row: 1 },
        confidence: 1,
      },
      identityStrategy: {
        kind: "column",
        sourceLocator: { kind: "column", sheet: "Data", col: 1 },
        confidence: 1,
      },
      columnBindings: [
        { sourceLocator: { kind: "byHeaderName", name: "name" },     columnDefinitionId: "col-name",     confidence: 1 },
        { sourceLocator: { kind: "byHeaderName", name: "industry" }, columnDefinitionId: "col-industry", confidence: 1 },
      ],
      skipRules: [],
      drift: defaultDrift(),
      confidence: { region: 1, aggregate: 1 },
      warnings: [],
      positionRoles: [
        { kind: "field" },        // name
        { kind: "field" },        // industry
        { kind: "pivotLabel", segmentId: "quarter" },
        { kind: "pivotLabel", segmentId: "quarter" },
        { kind: "pivotLabel", segmentId: "quarter" },
        { kind: "pivotLabel", segmentId: "month" },
        { kind: "pivotLabel", segmentId: "month" },
        { kind: "pivotLabel", segmentId: "month" },
      ],
      pivotSegments: [
        { id: "quarter", axisName: "quarter", axisNameSource: "user",
          valueFieldName: "revenue", valueFieldNameSource: "user" },
        { id: "month",   axisName: "month",   axisNameSource: "user",
          valueFieldName: "revenue", valueFieldNameSource: "user" },
      ],
    };

    const records = extractRecords(region, wb.sheet("Data")!);
    expect(records).toHaveLength(6);

    // statics are present on every record
    for (const r of records) {
      expect(r.fields["col-name"]).toBe("Apple");
      expect(r.fields["col-industry"]).toBe("Tech");
    }

    // quarter segment — 3 records
    const quarterLabels = records
      .filter((r) => "quarter" in r.fields)
      .map((r) => r.fields.quarter);
    expect(quarterLabels).toEqual(["Q1", "Q2", "Q3"]);

    // month segment — 3 records, distinct source ids
    const monthRecords = records.filter((r) => "month" in r.fields);
    expect(monthRecords.map((r) => r.fields.month)).toEqual(["Jan", "Feb", "Mar"]);
    const ids = new Set(records.map((r) => r.sourceId));
    expect(ids.size).toBe(6);
  });
});
```

Run: `npm --workspace packages/spreadsheet-parsing run test -- segmented-records`.
Expect failure — `extractRecords` doesn't branch on `positionRoles`
yet, so it falls into the classic rows-as-records path and returns 1
record.

### C3. Green — dispatch + first-cut `extractSegmentedRecords`

**Files**:

- `packages/spreadsheet-parsing/src/replay/extract-segmented-records.ts`
  (new) — implementation of the pseudocode in the spec § "New
  function: `extractSegmentedRecords`". Scope this first cut to
  `orientation === "rows-as-records"` + `headerAxis === "row"` (i.e.
  matrix row 1e). Throw a deliberate `Error("not yet implemented:
  <orientation, headerAxis>")` for other combos so later phases fail
  loudly.
- `packages/spreadsheet-parsing/src/replay/extract-records.ts` — add
  the dispatch branch at the top of `extractRecords`:

  ```ts
  if (region.positionRoles && region.pivotSegments) {
    return extractSegmentedRecords(region, sheet);
  }
  ```

  The branch is gated on both fields being *present* (arrays, not
  empty). An empty `positionRoles` alongside no `pivotSegments`
  should not trigger segmentation — existing behavior wins.

Reuse `resolveRegionBounds`, `resolveHeaders`, `deriveSourceId`, and
`computeChecksum` unchanged. The new module owns only the segmented
emit loop.

Source-id derivation:

```ts
function deriveSegmentedSourceId(
  region: Region,
  entityUnit: number,
  segmentId: string,
  label: string
): string {
  const base = deriveSourceId(region, entityUnit /* and whatever inputs */);
  return `${base}::${segmentId}::${label}`;
}
```

Run C2 again — green.

### C4. Refactor

- If `extractSegmentedRecords` turned out modular enough, split
  `collectStatics` and `emitSegmentRecords` into small private
  functions inside the same module. Do not split across files.
- Drop any `TODO`s that the first cut left behind.

---

## Phase D — Replay matrix coverage (rows × headerAxis:row family)

Extend `segmented-records.test.ts` with one `describe` per in-scope
matrix id. Each `describe` follows the same red/green/refactor loop,
but with the machinery in place from Phase C the "green" step is
usually just data — no production code change needed beyond the
Phase C implementation.

### D1. Matrix id 1b — `all-pivot 1 segment`

Test: Same bounds as 1e but every position is `pivotLabel` under
one segment `months` with a single `revenue` value field. Expect 3
records per entity-unit (one per label), no statics.

**Why this case matters:** it's the "existing pivoted shape encoded
under segmentation". The `extractSegmentedRecords` output for 1b
must equal what the classic pivoted path produces for the same data
modulo source-id formatting. Assert exact equivalence on field
values and counts.

### D2. Matrix id 1c — `2-segments, no statics`

Test: Two segments `quarter` and `month`, no `field` positions.
Expect 6 records per entity-unit; statics absent from `fields`.
Assert `Object.keys(r.fields)` contains exactly
`[segment.axisName, segment.valueFieldName]`.

### D3. Matrix id 1d — `mixed: statics + 1 segment`

Test: One segment, some `field` positions. Expect 3 records per
entity-unit, each carrying the statics.

### D4. Matrix id 1f — `mixed + skip`

Test: Like 1d but insert a `{ kind: "skip" }` role on (say) a
`Total` column. Assert:

- Skipped column contributes neither statics nor a record.
- Record count is unchanged from the equivalent no-skip case.
- The skipped column's `columnDefinitionId` (if bound) does not
  appear in any record's `fields`.

### D5. Refactor pass

- If the tests copy-paste region scaffolding, extract a small
  `segmentedRowsRegion(overrides)` test helper alongside
  `segmented-records.test.ts`. Do *not* promote it to a shared
  module — it's test-local.
- Re-run the parser suite entirely.

---

## Phase E — Orientation coverage (cols × headerAxis:col family)

### E1. Red — 2e canonical transpose

A mirror of 1e transposed 90°: one column per entity, rows carrying
static field names (name/industry) plus two per-row segments
(quarter rows, month rows).

This is the first case that the Phase-C "not yet implemented" guard
must stop rejecting. Before starting E1, extend
`extractSegmentedRecords` to dispatch on the four
`(orientation, headerAxis)` combinations listed in the spec's
Orientation dispatch table.

### E2. Green — orientation dispatch

**File**:
`packages/spreadsheet-parsing/src/replay/extract-segmented-records.ts`.

Introduce two small helpers per the spec:

```ts
function entityUnitsFor(region: Region, bounds: ResolvedBounds): number[] {
  // rows-as-records + headerAxis:row → data rows (startRow+1 .. endRow)
  // rows-as-records + headerAxis:column → data cols (pivoted)
  // columns-as-records + headerAxis:column → data cols
  // columns-as-records + headerAxis:row → data rows (pivoted)
}

function positionsForHeaderAxis(region: Region, bounds: ResolvedBounds): number[] {
  // headerAxis:row → columns in bounds
  // headerAxis:column → rows in bounds
}
```

The emit loop is orientation-agnostic once it takes `entityUnits` +
`positions` + a `cellValueAt(entityUnit, position)` closure. Keep
the value accessor a tiny helper.

Run E1 — green.

### E3. Red → Green — matrix ids 2b, 2c, 2d, 2f

Mirror D1–D4 transposed 90° against the same helper-factored region
builder. Each case is data-only against the code landed in E2.

### E4. Refactor

- Confirm `extract-segmented-records.ts` has no orientation-specific
  `if` chains outside `entityUnitsFor` / `positionsForHeaderAxis` /
  `cellValueAt`. If it does, collapse them.
- Re-run parser suite.

---

## Phase F — Pivoted base + multi-segment (rows × headerAxis:col and transpose)

### F1. Red — 3b (`rows-as-records` + `headerAxis:column`, N-segments)

This is the pivoted analogue: the existing pivoted shape already
assigns records-axis labels along the column header axis. Under
segmentation, those labels split across multiple named axes (e.g. a
single vertical header is partially "quarter" and partially
"month").

Test data sketch — one entity per column, vertical headers carrying
3 quarter rows then 3 month rows:

```
         col-Apple   col-Berry   col-Cherry
Q1       10          11          12
Q2       20          21          22
Q3       30          31          32
Jan       4           5           6
Feb       5           6           7
Mar       6           7           8
```

Expect each entity (column) to emit 6 records, 3 under segment
`quarter`, 3 under segment `month`. Statics are collected from the
perpendicular axis — i.e. from `columnBindings` on the top-of-column
banner if the region defines one.

Expect failure — the Phase-C/E implementation so far has covered
`(rows, row)` and `(cols, col)`. The `(rows, column)` pivoted branch
is new.

### F2. Green — pivoted-base segmentation

The key insight from the spec: when the base is pivoted, the
"statics" pass collects per-entity-unit static fields from the
`field` positions (perpendicular axis via `columnBindings`). The
pivotLabel positions then emit records exactly as in the non-pivoted
case — each position contributes one record per entity-unit.

In `extract-segmented-records.ts`, ensure:

- `entityUnitsFor` returns data columns when
  `(rows-as-records, headerAxis:column)`.
- Static collection for pivoted bases reads
  `columnBindings`-resolved cells via the existing binding
  resolver.
- Emit loop is otherwise unchanged from the non-pivoted case.

Run F1 — green.

### F3. Red → Green — 4b (transpose of 3b)

`columns-as-records` + `headerAxis:row` analogue. Data-only test.

### F4. Refactor

- Parser regression run over the whole replay suite. The pivoted
  base change must not regress existing `rowsAsRecords +
  headerAxis:column` behavior for non-segmented plans (matrix id 3a).

---

## Phase G — 1b / 2b round-trip equivalence

### G1. Encode 1a and 2a under segmentation and assert equality

**Goal**: prove the segmented encoding is a faithful superset of the
existing shape.

Test:

- Take an existing `rows-as-records, headerAxis:row, all-field` plan
  (canonical 1a).
- Produce a matching segmented plan where every position carries
  `{ kind: "field" }` and `pivotSegments` is empty.
- Expect `extractRecords` to produce records with identical `fields`
  content and equal-length counts. Source-ids may format
  differently — document the expected format if so.

If source-ids diverge, that's a spec question: decide whether
segmented source-ids with no `pivotLabel` positions should strip the
suffix. Default choice: only append `::segmentId::label` when the
record is emitted from a `pivotLabel` position — statics-only
regions keep the base source-id untouched. Code this in
`deriveSegmentedSourceId` and assert it.

### G2. Same for 2a / 2b (columns × headerAxis:col)

Transpose of G1.

### G3. Refactor

If round-trip uncovered a divergence that's cleaner to fix in
`extractSegmentedRecords` than to paper over in tests, fix it now.
Re-run all three replay suites.

---

## Phase H — Regression safety net

### H1. Rerun every existing replay test, unmodified

```
npm --workspace packages/spreadsheet-parsing run test
```

Specifically look for:

- `rows-as-records.test.ts` — must pass with zero changes.
- `columns-as-records.test.ts` — must pass with zero changes.
- `cells-as-records.test.ts` — must pass with zero changes. A
  crosstab plan with no `positionRoles`/`pivotSegments` must not
  trip the new crosstab-exemption refinement.
- `orchestration.test.ts`, `drift.test.ts`, `identity.test.ts`,
  `skip-rules.test.ts` — must pass unchanged.

### H2. Rerun API + web suites

```
npm --workspace apps/api run test:unit
npm --workspace apps/api run test:integration
npm --workspace apps/web run test:unit
```

These shouldn't depend on the new schema fields, but the
contract-level re-export in A3 means any `Region`-shaped consumer
now sees the optional fields. Type-check any touched files if
errors appear.

### H3. Root type-check

```
npm run type-check
```

---

## Phase I — Documentation

### I1. Update the architecture spec

**File**: `docs/SPREADSHEET_PARSING.architecture.spec.md`.

Add a short subsection titled "Region segmentation (Phase 1)" after
the existing § on record generation. Content sketch:

> Each `Region` may optionally carry `positionRoles` (one entry per
> header position) and `pivotSegments` (named axes + value-field
> declarations). When both are present, `extractRecords` dispatches
> to `extractSegmentedRecords`: for each entity-unit, statics are
> collected from `kind: "field"` positions; then each
> `pivotSegment` emits one record per matching `kind: "pivotLabel"`
> position, combining the statics with the segment's axis-name and
> value-field. Crosstab (`cells-as-records`) regions reject these
> fields at Zod time — segmented crosstab is deferred to v2.

Cross-link to `REGION_CONFIG.schema_replay.spec.md`.

### I2. Mark the phase-1 acceptance criteria as satisfied

**File**: `docs/REGION_CONFIG.schema_replay.spec.md`.

Optional: add a closing note that the spec has landed, pointing at
the commit(s). The spec itself does not need restructuring.

### I3. Leave follow-up specs untouched

`REGION_CONFIG.interpret.spec.md`, `REGION_CONFIG.ui.spec.md`, and
the identity-drift follow-up stay as written — they're still
pending.

---

## Phase J — Manual smoke (no UI yet, but a sanity loop)

Optional. The editor can't construct segmented plans until the UI
spec ships, so a manual smoke run means invoking the parser /
replay programmatically against the sample file.

1. Write a throwaway script (`/tmp/segment-smoke.ts` or a
   `console.log` inside an existing test run with `it.only`) that
   loads `apps/web/public/samples/region-segmentation-matrix.xlsx`,
   constructs a hand-crafted plan for id 1e, and prints the record
   count.
2. Expect 6 records with the Apple statics on every row.
3. Delete the script before opening the PR.

---

## Phase K — PR body

The spec lists the acceptance criteria; the PR body should include
the matrix coverage table so reviewers can see at a glance which
ids are green:

```
| id | test                                                       | status |
|----|------------------------------------------------------------|--------|
| 1a | rows-as-records.test.ts (existing)                         | ✅     |
| 1b | segmented-records.test.ts → "all-pivot 1 segment"          | ✅     |
| 1c | segmented-records.test.ts → "2-segments, no statics"       | ✅     |
| 1d | segmented-records.test.ts → "mixed: statics + 1 segment"   | ✅     |
| 1e | segmented-records.test.ts → "canonical 1e"                 | ✅     |
| 1f | segmented-records.test.ts → "mixed + skip"                 | ✅     |
| 2a | columns-as-records.test.ts (existing)                      | ✅     |
| 2b | segmented-records.test.ts → "all-pivot 1 segment (cols)"   | ✅     |
| …  | …                                                          | …      |
| 7  | cells-as-records.test.ts (existing)                        | ✅     |
| 8  | rejected by schema — SEGMENTED_CROSSTAB_NOT_SUPPORTED      | ✅     |
```

---

## Commit / PR checklist

- [ ] A1–A3 schema types + barrel + contract re-export
- [ ] B1–B7 three refinements with parse/reject tests
- [ ] C1–C4 replay dispatch + canonical 1e end-to-end
- [ ] D1–D5 rows × headerAxis:row matrix (1b, 1c, 1d, 1f)
- [ ] E1–E4 cols × headerAxis:col matrix (2b, 2c, 2d, 2e, 2f)
- [ ] F1–F4 pivoted base + multi-segment (3b, 4b)
- [ ] G1–G3 1b/2b round-trip equivalence documented + enforced
- [ ] H1–H3 full regression green
- [ ] I1 architecture-spec addendum
- [ ] PR body coverage table
- [ ] PR description notes: "Implements
  `REGION_CONFIG.schema_replay.spec.md`. Adds optional
  `positionRoles` + `pivotSegments` to the region schema, with three
  Zod refinements, and a segmented replay path that extracts records
  for every in-scope permutation-matrix id. No interpret or UI
  changes; no plan-version bump. Crosstab segmentation (id 8) is
  rejected at the schema layer, deferred to v2."
