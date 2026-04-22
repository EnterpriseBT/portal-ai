# Region Segmentation — Interpret Pipeline

Produce segmented plans from region hints. Covers the heuristic
position-role detector (phase 2) and the LLM classifier + per-segment
recommender (phase 4). Ships behind an opt-in so the legacy pipeline
keeps producing non-segmented plans by default until enablement.

Context: `docs/REGION_CONFIG_FLEXIBILITY.discovery.md` § "Interpret
pipeline changes".

## Prerequisites

- `REGION_CONFIG.schema_replay.spec.md` merged — schema accepts
  segmented plans, replay extracts them correctly. This spec just
  teaches interpret to emit them.

## New + changed stages

### New stage: `detect-position-roles` (phase 2)

File:
`packages/spreadsheet-parsing/src/interpret/stages/detect-position-roles.ts`

Runs after `detect-headers`, before `classify-columns`. Emits an
initial `positionRoles[]` and a seed `pivotSegments[]` on every
pivotable linear region. Crosstabs skip the stage (Zod refinement
rejects segmented crosstabs anyway).

Heuristics in v1:

1. **Label clustering** — contiguous cells along the header line
   that match a shared pattern cluster into one segment:
   - Quarter pattern: `^Q[1-4]$`, `^FY\d{2}Q[1-4]$` — auto-name the
     segment `"quarter"`.
   - Month pattern: `^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$`
     (case-insensitive) — auto-name `"month"`.
   - Year pattern: `^20\d{2}$|^FY\d{2}$` — auto-name `"year"`.
   - Date-ish pattern: `^\d{4}-\d{2}-\d{2}$` — auto-name `"date"`.
2. **Static fallback** — positions that don't match any known
   pattern and whose samples look like field values (non-numeric,
   multi-word identifiers, snake_case, title-case words) →
   `kind: "field"`.
3. **Ambiguous** — mixed patterns or inconclusive — emit
   `kind: "field"` as a safe default. The LLM classifier in phase 4
   may upgrade them to pivotLabel.

Segment naming:
- `axisName` auto-filled from the pattern (`"quarter"`, `"month"`,
  etc.), `axisNameSource: "anchor-cell"` when the region's anchor
  cell carries a better name (current anchor-cell resolution logic
  applies), else `axisNameSource: "ai"` once the LLM recommender
  runs, else a default value.
- `valueFieldName` defaults to `${axisName}Total` —
  `quarterTotal`, `monthlyTotal` (month exception), `yearTotal`, etc.

Segment ids are `segment_${axisName}` with a numeric suffix if two
segments with the same axisName appear (rare).

### Changed stage: `classify-columns` / `classify-positions` (phase 4)

Rename `classify-columns.ts` to `classify-positions.ts` once the new
semantics land; keep an alias so existing imports don't break mid-PR.

When a region has `positionRoles`:

- **Field positions**: classify their source-header → column
  definition as today.
- **PivotLabel positions**: skipped by the classifier — they don't
  bind to a column definition. Their axis-name is recommended by the
  updated per-segment recommender, not by the classifier.

The existing `runBuiltIn` heuristic and injected LLM classifier both
receive only the field-role candidates. The prompt template stays
the same.

### Changed stage: `recommend-records-axis-name` (phase 4)

Today: fires once per pivoted region.

New: fires once per `pivotSegment` on any segmented region, whether
the region is "pivoted" in the existing sense or not. Each segment's
positions' header labels are collected (anchor cell excluded) and
fed to the recommender independently.

Per-segment output:

- Updates the segment's `axisName` if the recommender returns a
  non-empty suggestion AND the segment's `axisNameSource` isn't
  already `"user"`.
- Updates `valueFieldName` likewise. In v1 the recommender returns
  only the axis name; the value-field-name stays heuristic
  (`${axisName}Total` with the month → `monthlyTotal` exception).
  A follow-up prompt extension can produce both.

LLM concurrency stays capped by the existing
`DEFAULT_INTERPRET_CONCURRENCY` (recommender calls are already
batched via `pLimit`).

### Changed stage: `propose-bindings`

For segmented regions, `propose-bindings` constructs:

- `columnBindings` from field positions only (pivotLabel + skip
  positions contribute no bindings).
- `positionRoles` copied from detect-position-roles' output, refined
  by any LLM overrides.
- `pivotSegments` from detect-position-roles, with `axisName` and
  `valueFieldName` updated by the per-segment recommender.

For non-segmented regions (no `positionRoles` set), behavior is
unchanged from today.

### Changed stage: `score-and-warn`

New warnings:

- `SEGMENT_MISSING_AXIS_NAME` (blocker) — per segment whose
  `axisName` is empty or the `source` is `"anchor-cell"` with no
  anchor cell value available. Analogous to
  `PIVOTED_REGION_MISSING_AXIS_NAME` today.
- `SEGMENT_VALUE_FIELD_NOT_BOUND` (warn) — segment's
  `valueColumnDefinitionId` unset. Commit still works (FieldMapping
  reconcile allows it), but the value field won't map to a catalog
  definition.

## Enablement / opt-in

Phase 2 ships behind a per-region hint flag:

```ts
RegionHint {
  // ...existing...
  enableSegmentation?: boolean;  // defaults false
}
```

When false (or absent), the interpret pipeline produces non-segmented
regions exactly as today — detect-position-roles runs but its output
is discarded at propose-bindings time. When true, the segmented
codepath takes over.

Flip the default to `true` in a follow-up PR once heuristic + UI
stabilize (phase 5 in the discovery doc).

## Acceptance criteria

- detect-position-roles produces correct role assignments for every
  in-scope matrix id from
  `docs/fixtures/region-segmentation-matrix.csv` when the region
  hint sets `enableSegmentation: true`. Correctness measured against
  hand-crafted expected `positionRoles`/`pivotSegments` per id
  (lives in `packages/spreadsheet-parsing/src/__tests__/fixtures/
  segmentation-expectations.ts`).
- For hints without `enableSegmentation`, plans produced today stay
  identical — bit-for-bit diff on a replay of the existing
  interpret orchestration tests.
- Per-segment recommender fires once per segment, not once per
  region. Usage logs show `stage: "recommend-records-axis-name"`
  with a segment-id field for segmented calls.
- `classify-columns`/`classify-positions` ignores pivotLabel
  positions; their labels never reach the classifier prompt.

## Test plan

### detect-position-roles
(`packages/spreadsheet-parsing/src/interpret/stages/__tests__/detect-position-roles.test.ts`)

- Row 1 = `Q1, Q2, Q3, Q4` → one segment `quarter` spanning all
  four positions; all roles `pivotLabel`.
- Row 1 = `name, industry, Q1, Q2, Q3` → two static positions + one
  quarter segment; 1d canonical.
- Row 1 = `name, industry, Q1, Q2, Q3, Jan, Feb, Mar` → two statics
  + two segments `quarter` and `month`; 1e canonical.
- Row 1 = `name, industry, Q1, Q2, Q3, Total` → statics + quarter
  segment; `Total` flagged as `kind: "skip"` via a totals-label
  heuristic (regex `/^total$/i`).
- Mixed patterns that don't cluster cleanly → all positions
  `kind: "field"` as a safe fallback; LLM sees them.

### classify-positions
(extension of existing `classify-columns.test.ts`)

- Segmented region with pivotLabel positions — classifier called
  only with the field candidates; pivotLabels are absent from the
  candidate list.
- Legacy region with `positionRoles` absent — classifier called with
  all candidates, behavior unchanged.

### recommend-records-axis-name per-segment
(extension of existing test file)

- Region with 2 segments — recommender called twice, once per
  segment, each with that segment's axis labels.
- Segment with `axisNameSource === "user"` — recommender skipped
  for that segment only; others still fire.

### Orchestration
(`packages/spreadsheet-parsing/src/interpret/__tests__/orchestration.test.ts`)

- End-to-end interpret on fixture 1e with `enableSegmentation:
  true` — output plan matches expected shape (column bindings for
  name/industry, 2 pivot segments, 6-record extraction via
  `extractRecords`).
- Same fixture without the flag — output is a legacy single-record
  plan; `positionRoles`/`pivotSegments` absent.

## Non-goals

- UI changes — role-strip editor lands in `REGION_CONFIG.ui.spec.md`.
- Flipping the default from opt-in to opt-out — phase 5, deferred.
- Crosstab segmentation — Zod-rejected.
- Value-field-name LLM recommendation — heuristic-only for v1.
- Identity-drift handling for segment renames — a follow-up spec.

## Rollout

Ships as one PR. The opt-in flag keeps the default behavior
unchanged for every existing region hint path. Frontend wiring to
set the flag lands separately in the UI spec; until then, the flag
is exercised only through direct API calls (fixtures, automation).
