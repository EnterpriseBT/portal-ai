# PR 3 — Per-Segment Classifier, Recommender, and Warnings

**Depends on**: PR-1 and PR-2 merged.

**Landing invariant**: the LLM classifier sees only field-segment
positions, the axis-name recommender fires once per pivot segment,
and warnings reflect the segmented model. Tidy regions still
behave identically end-to-end.

**Why this cut**: pure interpret-stage rewiring with no schema
changes. Shipping separately lets PR-2's matrix-id heuristic bake
before we layer LLM nuance on top.

## Scope

Renames (atomic with importer updates, no shims):

- `classify-columns.ts` → `classify-field-segments.ts`
- `recommend-records-axis-name.ts` → `recommend-segment-axis-names.ts`

Warning codes churn:

- **Delete**: `PIVOTED_REGION_MISSING_AXIS_NAME`,
  `SEGMENTED_CROSSTAB_NOT_SUPPORTED` (already gone from the
  refinement layer in PR-1; remove the code too).
- **Add**: `SEGMENT_MISSING_AXIS_NAME` (blocker, per segment),
  `CELL_VALUE_FIELD_NOT_BOUND` (warn).

Out of scope:

- Any schema change (lands in PR-1).
- `detect-segments` heuristic (lands in PR-2).
- RegionEditor (PR-4).

## Pre-flight

Files touched:

- `packages/spreadsheet-parsing/src/interpret/stages/classify-columns.ts`
  → rename to `classify-field-segments.ts`; rewrite candidate filter.
- `packages/spreadsheet-parsing/src/interpret/stages/recommend-records-axis-name.ts`
  → rename to `recommend-segment-axis-names.ts`; rewrite around
  per-segment calls.
- `packages/spreadsheet-parsing/src/interpret/index.ts` — rename
  imports + stage-name strings in log events.
- `packages/spreadsheet-parsing/src/warnings/codes.ts` —
  add/remove codes.
- `packages/spreadsheet-parsing/src/interpret/stages/score-and-warn.ts`
  — emit the new codes; drop the deleted one.
- `packages/spreadsheet-parsing/src/interpret/stages/__tests__/`
  — test file renames alongside stage renames; warning-code tests
  update.

Consumers grepped and fixed if they reference the deleted codes:

```
rg 'PIVOTED_REGION_MISSING_AXIS_NAME|SEGMENTED_CROSSTAB_NOT_SUPPORTED' packages/ apps/
```

## Phases

### Phase A — `classify-field-segments`

#### A1. Red — filter test

`classify-field-segments.test.ts` (renamed from
`classify-columns.test.ts`):

```ts
describe("classifyFieldSegments — filters non-field positions", () => {
  it("passes only field-segment positions to the classifier", async () => {
    const spy = jest.fn<ClassifierFn>(async () => []);
    const state = /* build state with:
      - segmentsByRegion[rid]: { row: [{ kind: "field", positionCount: 2 }, { kind: "pivot", id: "q", positionCount: 3 }] }
    */;
    await classifyFieldSegments(state, { classifier: spy, columnDefinitionCatalog: [] });
    expect(spy).toHaveBeenCalledTimes(1);
    const [candidates] = spy.mock.calls[0]!;
    expect(candidates.map((c) => c.sourceHeader)).toEqual(["name", "industry"]);
  });

  it("short-circuits the classifier when no field-segment positions exist", async () => {
    // crosstab with skip + pivot on each axis → zero field candidates
    const spy = jest.fn<ClassifierFn>();
    await classifyFieldSegments(crosstabState(), { classifier: spy });
    expect(spy).not.toHaveBeenCalled();
  });

  it("iterates both axes on 2D regions and merges candidates", async () => {
    // a crosstab with one field segment per axis (uncommon but allowed by schema)
  });
});
```

#### A2. Green — rewrite

```ts
export async function classifyFieldSegments(
  state: InterpretState,
  deps: InterpretDeps = {},
): Promise<InterpretState> {
  const next = new Map(state.columnClassifications);
  for (const region of state.detectedRegions) {
    const candidates: ClassifierCandidate[] = [];
    for (const axis of region.headerAxes) {
      const segments = state.segmentsByRegion.get(region.id)?.[axis] ?? [];
      const sheet = state.workbook.sheets.find((s) => s.name === region.sheet);
      if (!sheet) continue;
      candidates.push(...candidatesForAxisFieldSegments(region, axis, segments, sheet));
    }
    if (candidates.length === 0) continue;
    const classifier = deps.classifier ?? runBuiltIn;
    const classifications = await classifier(candidates, deps.columnDefinitionCatalog ?? []);
    next.set(region.id, classifications);
  }
  return { ...state, columnClassifications: next };
}

function candidatesForAxisFieldSegments(
  region: Region,
  axis: "row" | "column",
  segments: Segment[],
  sheet: Sheet,
): ClassifierCandidate[] {
  // Walk segments; for each kind: "field" run, expand its positions
  // via the shared header-line helper and build ClassifierCandidate
  // entries with sourceHeader + sourceCol/row + samples.
}
```

Uses the Phase-C helper `readHeaderLineLabels` from PR-2 to get
labels per position.

#### A3. Rename (atomic) + update importers

- Rename file + test file.
- Update `interpret/index.ts`:
  `import { classifyFieldSegments } from "./stages/classify-field-segments.js";`
  and change the dispatch call + the `emitStageCompleted(logger,
  "classify-field-segments", ...)` log name.
- Grep and update any other importer (there shouldn't be any
  outside `index.ts`).

### Phase B — `recommend-segment-axis-names`

#### B1. Red — per-segment firing

`recommend-segment-axis-names.test.ts` (renamed):

```ts
describe("recommendSegmentAxisNames", () => {
  it("invokes the recommender once per pivot segment with that segment's labels", async () => {
    const calls: string[][] = [];
    const recommender = jest.fn(async (labels: string[]) => {
      calls.push(labels);
      return { name: labels[0].startsWith("Q") ? "fiscalQuarter" : "month", confidence: 0.9 };
    });
    const state = /* state with 1e canonical: 2 pivot segments on row axis */;
    await recommendSegmentAxisNames(state, { axisNameRecommender: recommender });
    expect(recommender).toHaveBeenCalledTimes(2);
  });

  it("skips segments whose axisNameSource === 'user'", async () => { /* … */ });

  it("is a no-op for statics-only plans (no pivot segments)", async () => {
    const recommender = jest.fn();
    await recommendSegmentAxisNames(staticsOnlyState(), { axisNameRecommender: recommender });
    expect(recommender).not.toHaveBeenCalled();
  });

  it("fires once per axis on a 2D region (one segment per axis)", async () => {
    const recommender = jest.fn(async () => ({ name: "x", confidence: 1 }));
    await recommendSegmentAxisNames(crosstabState(), { axisNameRecommender: recommender });
    expect(recommender).toHaveBeenCalledTimes(2);
  });

  it("writes results into state.segmentAxisNameSuggestions keyed by segmentId", async () => { /* … */ });
});
```

Delete the old test file (`recommend-records-axis-name.test.ts`)
in the same commit.

#### B2. Green — rewrite + rename

```ts
export async function recommendSegmentAxisNames(
  state: InterpretState,
  deps: InterpretDeps = {},
): Promise<InterpretState> {
  const recommender = deps.axisNameRecommender;
  if (!recommender) return state;

  type Pending = { regionId: string; segmentId: string; labels: string[] };
  const pending: Pending[] = [];
  for (const region of state.detectedRegions) {
    const segmentsByAxis = state.segmentsByRegion.get(region.id);
    if (!segmentsByAxis) continue;
    const sheet = state.workbook.sheets.find((s) => s.name === region.sheet);
    if (!sheet) continue;
    for (const axis of region.headerAxes) {
      const segments = segmentsByAxis[axis] ?? [];
      let offset = 0;
      for (const segment of segments) {
        if (segment.kind !== "pivot") { offset += segment.positionCount; continue; }
        if (segment.axisNameSource === "user") { offset += segment.positionCount; continue; }
        const labels = collectSegmentLabels(region, axis, segment, offset, sheet);
        if (labels.length) pending.push({ regionId: region.id, segmentId: segment.id, labels });
        offset += segment.positionCount;
      }
    }
  }

  const limit = pLimit(deps.concurrency ?? DEFAULT_INTERPRET_CONCURRENCY);
  const results = await Promise.all(
    pending.map((work) => limit(() => Promise.resolve(recommender(work.labels))).then((s) => ({ work, suggestion: s })))
  );

  const next = new Map(state.segmentAxisNameSuggestions);
  for (const { work, suggestion } of results) {
    if (suggestion) next.set(work.segmentId, suggestion);
  }
  return { ...state, segmentAxisNameSuggestions: next };
}
```

`collectSegmentLabels(region, axis, segment, offset, sheet)` uses
the shared header-line helper and slices to the segment's
positions.

#### B3. `proposeBindings` applies suggestions

Already reads from `state.segmentAxisNameSuggestions` in PR-1's
adapter; update to apply per-segment overrides onto
`region.segmentsByAxis`:

```ts
for (const axis of region.headerAxes) {
  const segments = region.segmentsByAxis?.[axis] ?? [];
  region.segmentsByAxis![axis] = segments.map((seg) => {
    if (seg.kind !== "pivot") return seg;
    if (seg.axisNameSource === "user" || seg.axisNameSource === "anchor-cell") return seg;
    const suggestion = state.segmentAxisNameSuggestions.get(seg.id);
    if (!suggestion) return seg;
    return { ...seg, axisName: suggestion.name, axisNameSource: "ai" };
  });
}
```

#### B4. Rename imports + log-stage name

- `interpret/index.ts` — rename import, change the
  `emitStageCompleted(logger, "recommend-records-axis-name", …)`
  string to `"recommend-segment-axis-names"`.

### Phase C — Warning codes churn

#### C1. Red — codes + emission tests

`codes.test.ts`:

```ts
it("does not include PIVOTED_REGION_MISSING_AXIS_NAME anymore", () => {
  expect((WARNING_CODES as readonly string[]).includes("PIVOTED_REGION_MISSING_AXIS_NAME")).toBe(false);
});

it("includes the new segmentation codes", () => {
  expect(WARNING_CODES).toContain("SEGMENT_MISSING_AXIS_NAME");
  expect(WARNING_CODES).toContain("CELL_VALUE_FIELD_NOT_BOUND");
});
```

`score-and-warn.test.ts`:

```ts
describe("scoreAndWarn — SEGMENT_MISSING_AXIS_NAME", () => {
  it("emits per pivot segment with empty axisName", () => { /* blocker */ });
  it("emits for anchor-cell source with no anchor-cell value", () => { /* blocker */ });
  it("does not emit for user-sourced axisName", () => { /* … */ });
});

describe("scoreAndWarn — CELL_VALUE_FIELD_NOT_BOUND", () => {
  it("emits when cellValueField exists but has no columnDefinitionId", () => { /* warn */ });
  it("does not emit when cellValueField has a columnDefinitionId", () => { /* … */ });
  it("does not emit when no cellValueField exists (statics-only)", () => { /* … */ });
});
```

#### C2. Green — code list + emit

- `warnings/codes.ts`:
  - Delete `PIVOTED_REGION_MISSING_AXIS_NAME` from
    `DEFAULT_WARNING_SEVERITY`.
  - Delete `SEGMENTED_CROSSTAB_NOT_SUPPORTED` (if still present
    after PR-1).
  - Add `SEGMENT_MISSING_AXIS_NAME: "blocker"`.
  - Add `CELL_VALUE_FIELD_NOT_BOUND: "warn"`.
- `score-and-warn.ts`:
  - Remove the block that emitted `PIVOTED_REGION_MISSING_AXIS_NAME`.
  - Add per-pivot-segment emission of `SEGMENT_MISSING_AXIS_NAME`.
  - Add region-level emission of `CELL_VALUE_FIELD_NOT_BOUND` when
    `region.cellValueField` exists but `columnDefinitionId` is
    unset.

#### C3. Refactor — grep consumers

```
rg 'PIVOTED_REGION_MISSING_AXIS_NAME|SEGMENTED_CROSSTAB_NOT_SUPPORTED' packages/ apps/
```

Likely hits in `apps/web` error-display UIs. Replace references to
`PIVOTED_REGION_MISSING_AXIS_NAME` with `SEGMENT_MISSING_AXIS_NAME`.
The UX becomes "this segment needs an axis name" — per segment,
which is more actionable. Flag in the PR body.

### Phase D — Orchestration end-to-end

Extend `orchestration.test.ts`:

- For each in-scope matrix id, assert after `interpret()`:
  - Pivot segments carry non-empty `axisName` (recommender fired).
  - No `PIVOTED_REGION_MISSING_AXIS_NAME` in warnings.
  - `SEGMENT_MISSING_AXIS_NAME` appears only for segments the
    recommender couldn't name.

### Phase E — Cross-suite verification

```
npm --workspace packages/spreadsheet-parsing run test
npm run type-check
npm --workspace apps/api run test:unit
npm --workspace apps/web run test:unit
```

Any `apps/web` failure likely points to a consumer of the deleted
warning code; fix in this PR.

## PR body template

Title:
```
feat: per-segment classifier + recommender + segmentation warnings
```

Body:
```markdown
## Summary

Completes the segmentation rewire on the interpret side:

- `classify-columns` → `classify-field-segments` (rename + filter).
  LLM classifier now sees only positions inside `kind: "field"`
  segments. Pivot + skip positions are dropped before the prompt.
- `recommend-records-axis-name` → `recommend-segment-axis-names`
  (rename + per-segment). Fires once per pivot segment whose
  `axisNameSource !== "user"`. Zero calls on statics-only
  regions; 2 calls on crosstab regions (one per axis).
- Warning codes: `PIVOTED_REGION_MISSING_AXIS_NAME` deleted,
  replaced by per-segment `SEGMENT_MISSING_AXIS_NAME`.
  `CELL_VALUE_FIELD_NOT_BOUND` added.

## UI impact

The RegionEditor (and any other `apps/web` surface that displays
warnings) now shows axis-name blockers per pivot segment instead
of once per region. Reworded inline; PR-4 follows up with richer
composition UX.

## Test plan

- [x] `classify-field-segments.test.ts`
- [x] `recommend-segment-axis-names.test.ts`
- [x] `codes.test.ts` — removed + added warning codes
- [x] `score-and-warn.test.ts` — new emit paths
- [x] `orchestration.test.ts` — every matrix id with recommender
      results flowing to segment `axisName`
- [x] Full parser + type-check + API unit + web unit
```

## Commit / PR checklist

- [ ] A1–A3 `classify-field-segments` rename + filter
- [ ] B1–B4 `recommend-segment-axis-names` rename + per-segment
- [ ] C1–C3 warning codes churn + consumer grep
- [ ] D orchestration end-to-end
- [ ] E cross-suite green
