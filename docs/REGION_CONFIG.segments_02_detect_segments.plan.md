# PR 2 — `detect-segments` Heuristic Stage

**Depends on**: PR-1 merged. Schema + replay already unified; every
interpret stage reads/writes the new shape; `segmentsByRegion` +
`cellValueFieldByRegion` + `segmentAxisNameSuggestions` exist on
`InterpretState` but `segmentsByRegion` is populated by
`proposeBindings`' adapter logic (one field segment or one pivot
segment per region).

**Landing invariant**: regions start producing multi-segment
layouts when the heuristic finds cluster patterns in header labels.
Classic tidy regions (no patterns detected) remain one field
segment, byte-identical to PR-1 output.

**Why this cut**: the detection heuristic is a self-contained
stage with localized state writes. Shipping it alone gives
reviewers a focused diff and lets us validate matrix-id coverage
before layering classifier/recommender rewiring on top.

## Scope

- New stage
  `packages/spreadsheet-parsing/src/interpret/stages/detect-segments.ts`.
- Pattern bank
  `packages/spreadsheet-parsing/src/interpret/stages/segment-patterns.ts`.
- Shared header-line helper
  `packages/spreadsheet-parsing/src/interpret/stages/header-line.util.ts`.
- Fixture
  `packages/spreadsheet-parsing/src/__tests__/fixtures/segment-expectations.ts`.
- Dispatch: insert `detectSegments` between `detectIdentity` and
  `classifyColumns` in `interpret/index.ts`.
- `proposeBindings` reads from `state.segmentsByRegion` +
  `state.cellValueFieldByRegion` instead of synthesizing a
  single-segment default. The adapter logic added in PR-1 becomes
  a fallback when the stage produces no segments (e.g., for
  headerless regions the stage doesn't run).

Out of scope:

- Classifier segment-kind filter (PR-3).
- Per-segment recommender rewrite (PR-3).
- New warning codes (PR-3).
- RegionEditor (PR-4).

## Pre-flight

Files added:

- `packages/spreadsheet-parsing/src/interpret/stages/detect-segments.ts`
- `packages/spreadsheet-parsing/src/interpret/stages/segment-patterns.ts`
- `packages/spreadsheet-parsing/src/interpret/stages/header-line.util.ts`
- `packages/spreadsheet-parsing/src/interpret/stages/__tests__/detect-segments.test.ts`
- `packages/spreadsheet-parsing/src/interpret/stages/__tests__/header-line.util.test.ts`
- `packages/spreadsheet-parsing/src/__tests__/fixtures/segment-expectations.ts`

Files touched:

- `packages/spreadsheet-parsing/src/interpret/index.ts` — dispatch
  insertion.
- `packages/spreadsheet-parsing/src/interpret/stages/propose-bindings.ts`
  — read `state.segmentsByRegion` first, fall back to the PR-1
  adapter logic when empty.
- Any existing stage that previously duplicated header-line cell
  iteration (most notably `classify-columns.ts` and
  `recommend-records-axis-name.ts`) migrates to the shared helper.

## Phases

### Phase A — Shared header-line helper

#### A1. Red — unit tests

`header-line.util.test.ts`:

```ts
describe("readHeaderLineLabels", () => {
  it("returns trimmed labels in position order for headerAxes:['row']", () => { /* … */ });
  it("returns row-labels for headerAxes:['column']", () => { /* … */ });
  it("coerces non-strings to trimmed strings", () => { /* numbers / dates */ });
  it("returns empty string for blank cells (preserving alignment)", () => { /* … */ });
  it("throws when axis is not in region.headerAxes", () => { /* strict contract */ });
});

describe("headerLineCoords", () => {
  it("returns sheet-col indices for row axis", () => { /* … */ });
  it("returns sheet-row indices for column axis", () => { /* … */ });
});
```

#### A2. Green — implement

Single module, two pure functions:

```ts
export function headerLineCoords(region: Region, axis: "row" | "column", bounds: ResolvedBounds): number[];
export function readHeaderLineLabels(
  region: Region,
  axis: "row" | "column",
  sheet: Sheet,
  headerIndex: number,
): string[];
```

Both throw if `axis ∉ region.headerAxes`. Alignment guarantee:
`readHeaderLineLabels` returns an array of the same length as
`headerLineCoords`, index-matched.

#### A3. Refactor — migrate existing callsites

- `classify-columns.ts`'s `candidatesFromHeader` reads through the
  helper.
- `recommend-records-axis-name.ts`'s `collectRecordsAxisLabels`
  reads through the helper.

Run parser suite; zero test churn expected.

### Phase B — Pattern bank

#### B1. Red — classifyLabel tests

`segment-patterns.test.ts`:

```ts
describe("classifyLabel", () => {
  it.each([ "Q1", "Q2", "Q3", "Q4", "FY26Q1" ])("%s → quarter", …);
  it.each([ "Jan", "Feb", "January", "MARCH" ])("%s → month (case-insensitive)", …);
  it.each([ "2024", "2025", "FY26" ])("%s → year", …);
  it.each([ "2024-01-15", "2026-12-31" ])("%s → date", …);
  it.each([ "Total", "TOTAL", "total" ])("%s → skip", …);
  it.each([ "name", "industry", "Account Owner" ])("%s → field", …);
  it("returns field for empty / unknown", () => { /* … */ });
});
```

#### B2. Green — implement

`segment-patterns.ts`:

```ts
export type LabelTag = "quarter" | "month" | "year" | "date" | "skip" | "field";

const PATTERNS: ReadonlyArray<{ tag: LabelTag; regex: RegExp; axisName: string }> = [
  { tag: "quarter", regex: /^(FY\d{2})?Q[1-4]$/i, axisName: "quarter" },
  { tag: "month",   regex: /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)$/i, axisName: "month" },
  { tag: "year",    regex: /^(20\d{2}|FY\d{2})$/, axisName: "year" },
  { tag: "date",    regex: /^\d{4}-\d{2}-\d{2}$/, axisName: "date" },
  { tag: "skip",    regex: /^total$/i, axisName: "" },
];

export function classifyLabel(label: string): LabelTag {
  for (const p of PATTERNS) if (p.regex.test(label.trim())) return p.tag;
  return "field";
}

export function axisNameFor(tag: LabelTag): string | null {
  return PATTERNS.find((p) => p.tag === tag)?.axisName ?? null;
}
```

Per the heuristic-vs-AI memory: stay generic. No
schema-specific name guessing, no field-value sampling — those
are LLM responsibilities.

### Phase C — `detect-segments` stage

#### C1. Red — matrix-id coverage

`segment-expectations.ts` — TS table mapping each matrix id to
expected `{ headerAxes, segmentsByAxis, cellValueField }`. IDs:

- `1a` — tidy all-static
- `1b` — pivot all
- `1c` — 2 pivots no statics
- `1d` — statics + 1 pivot
- `1e` — statics + 2 pivots (canonical)
- `1f` — statics + 1 pivot + skip
- `2a` – `2f` — column-axis versions
- `3b`, `4b` — pivoted base multi-segment
- `crosstab-sales-leads` — 2D (both axes)
- `headerless-rows` — no header axis (stage is a no-op)

`detect-segments.test.ts`:

```ts
describe("detect-segments — matrix coverage", () => {
  it.each(MATRIX_IDS)("produces expected segments for %s", (id) => {
    const state = runUpToDetectIdentity(matrixInput(id));
    const after = detectSegments(state);
    const regionId = state.detectedRegions[0].id;
    const expected = EXPECTATIONS[id];
    expect(after.segmentsByRegion.get(regionId)).toEqual(expected.segmentsByAxis);
    if (expected.cellValueField) {
      expect(after.cellValueFieldByRegion.get(regionId)).toEqual(expected.cellValueField);
    } else {
      expect(after.cellValueFieldByRegion.get(regionId)).toBeUndefined();
    }
  });
});

describe("detect-segments — headerless skip", () => {
  it("does not populate for regions with empty headerAxes", () => { /* … */ });
});

describe("detect-segments — purity", () => {
  it("returns equal output on repeated invocations of the same state", () => { /* … */ });
});
```

#### C2. Green — implement

```ts
export function detectSegments(state: InterpretState): InterpretState {
  const segmentsByRegion = new Map(state.segmentsByRegion);
  const cellValueFieldByRegion = new Map(state.cellValueFieldByRegion);

  for (const region of state.detectedRegions) {
    if (region.headerAxes.length === 0) continue;
    const sheet = state.workbook.sheets.find((s) => s.name === region.sheet);
    if (!sheet) continue;
    const segmentsByAxis: { row?: Segment[]; column?: Segment[] } = {};
    for (const axis of region.headerAxes) {
      const headerIndex = pickHeaderIndex(region, axis, state);
      const labels = readHeaderLineLabels(region, axis, sheet, headerIndex);
      segmentsByAxis[axis] = clusterLabels(labels, axis);
    }
    segmentsByRegion.set(region.id, segmentsByAxis);
    if (anyPivot(segmentsByAxis)) {
      cellValueFieldByRegion.set(region.id, seedCellValueField(region, state));
    }
  }

  return { ...state, segmentsByRegion, cellValueFieldByRegion };
}
```

`clusterLabels(labels, axis)`:

- Classify each label via `classifyLabel`.
- Collapse contiguous same-tag runs into segments.
- Pivot-tag runs become `kind: "pivot"` with
  `id: "segment_" + tag + ("_" + axis-or-uniquifier)`, `axisName`
  from `axisNameFor(tag)`, `axisNameSource: "ai"`.
- `skip` runs → `kind: "skip"`.
- `field` runs → `kind: "field"`.

`seedCellValueField`:

- If `region.axisAnchorCell` resolves to a non-empty cell, seed
  `{ name: <value>, nameSource: "anchor-cell" }`.
- Else seed `{ name: "value", nameSource: "ai" }` so PR-3's
  recommender has a suggestion target.

#### C3. Wire into dispatch

`interpret/index.ts`:

```ts
state = detectRegions(state);
state = detectHeaders(state);
state = detectIdentity(state);
state = detectSegments(state);                 // ← new
state = await classifyColumns(state, wrappedDeps);
state = await recommendRecordsAxisName(state, wrappedDeps);
state = proposeBindings(state);
state = reconcileWithPrior(state);
state = scoreAndWarn(state);
```

#### C4. `proposeBindings` reads `segmentsByRegion`

Update `propose-bindings.ts`:

```ts
const segments = state.segmentsByRegion.get(region.id);
if (segments && (segments.row || segments.column)) {
  region.headerAxes = Object.keys(segments) as Array<"row" | "column">;
  region.segmentsByAxis = segments;
  if (state.cellValueFieldByRegion.get(region.id)) {
    region.cellValueField = state.cellValueFieldByRegion.get(region.id);
  }
} else {
  // Fall back to PR-1 adapter: one field segment + no cellValueField.
  // (Applies to headerless regions which detect-segments skips.)
}
```

### Phase D — Orchestration regression

#### D1. Red — end-to-end per matrix id

`orchestration.test.ts`:

```ts
describe("interpret() — detect-segments wired", () => {
  it.each(MATRIX_IDS)("produces the expected plan for %s", async (id) => {
    const plan = await interpret(matrixInput(id));
    const region = plan.regions[0]!;
    expect(region.segmentsByAxis).toEqual(EXPECTATIONS[id].segmentsByAxis);
    // Close the loop: replay.
    const records = extractRecords(region, /* sheet */);
    expect(records).toHaveLength(EXPECTATIONS[id].recordCount);
  });
});
```

#### D2. Green — any remaining wiring fixes

Most of the wiring landed in C. Fix any gap the test directs to.

### Phase E — Cross-suite verification

```
npm --workspace packages/spreadsheet-parsing run test
npm run type-check
npm --workspace apps/api run test:unit
npm --workspace apps/web run test:unit
```

API + web unchanged — this PR is parser-internal.

## PR body template

Title:
```
feat: detect-segments heuristic stage
```

Body:
```markdown
## Summary

Adds the `detect-segments` stage to the interpret pipeline. Runs
between `detect-identity` and `classify-columns` and populates
`state.segmentsByRegion` + `state.cellValueFieldByRegion` from a
generic pattern bank (quarter / month / year / ISO date / totals).
`proposeBindings` reads the results; regions now ship with
multi-segment layouts when the heuristic finds cluster patterns in
header labels.

Classic tidy is unchanged (no patterns detected → one field
segment). Headerless regions skip the stage.

## Pattern bank

Intentionally generic per the heuristic-vs-AI memory: no
schema-specific naming, no field-value sampling. LLM refinement
happens in PR-3's classifier and recommender.

## Matrix-id coverage

| id | shape |
|----|-------|
| 1a / 2a | tidy all-static |
| 1b / 2b | pivot all |
| 1c / 2c | 2 pivots, no statics |
| 1d / 2d | statics + 1 pivot |
| 1e / 2e | statics + 2 pivots (canonical) |
| 1f / 2f | statics + pivot + skip |
| 3b / 4b | pivoted multi-segment |
| crosstab-sales-leads | 2D (both axes) |

All land in `segment-expectations.ts` with end-to-end coverage
through `orchestration.test.ts`.

## Test plan

- [x] `segment-patterns.test.ts` — pattern classification
- [x] `header-line.util.test.ts` — shared helper
- [x] `detect-segments.test.ts` — matrix-id coverage + purity
- [x] `orchestration.test.ts` — every matrix id round-trips
- [x] Full parser + type-check
```

## Commit / PR checklist

- [ ] A1–A3 shared header-line helper + callsite migration
- [ ] B1–B2 pattern bank
- [ ] C1–C4 detect-segments stage + dispatch wiring +
      proposeBindings reader
- [ ] D1–D2 orchestration regression green
- [ ] E cross-suite green
