# Region Segmentation — Interpret Pipeline

Produce segmented plans from region hints. The interpret pipeline
drives off the unified segment model; there is **no opt-in gate** —
every region flows through the same sequence and emits the canonical
`headerAxes` + `segmentsByAxis` + `cellValueField` shape that replay
consumes.

Context: `docs/REGION_CONFIG_FLEXIBILITY.discovery.md` § "Phasing"
(phases collapsed from 5 to 3 interpret-layer stages shipped together
in PR-2 + PR-3 of the segments roadmap).

## Prerequisites

- `REGION_CONFIG.schema_replay.spec.md` merged — schema accepts
  segmented plans, replay extracts them correctly. This spec teaches
  interpret to emit them.

## New + changed stages

### New stage: `detect-segments`

File:
`packages/spreadsheet-parsing/src/interpret/stages/detect-segments.ts`

Runs after `detect-headers`, before `classify-field-segments`. On
each declared header axis, emits the initial `Segment[]` — `field` /
`pivot` / `skip` — plus the `cellValueField` at the region level
when any pivot is seeded. Crosstabs run the same stage: the row and
column axes each get their own segment list.

Heuristics:

1. **Label clustering** — contiguous cells along the header line
   that match a shared pattern cluster into one pivot segment:
   - Quarter pattern: `^Q[1-4]$`, `^FY\d{2}Q[1-4]$` — axisName `"quarter"`.
   - Month pattern: `^(Jan|Feb|…|Dec)$` (case-insensitive) — axisName `"month"`.
   - Year pattern: `^20\d{2}$|^FY\d{2}$` — axisName `"year"`.
   - Date-ish pattern: `^\d{4}-\d{2}-\d{2}$` — axisName `"date"`.
2. **Totals skip** — positions whose cell value matches
   `/^total$|^subtotal$|^summary$/i` emit `{ kind: "skip" }` so the
   Totals column doesn't bind to a column definition or a pivot axis.
3. **Static fallback** — positions that don't match any known pattern
   cluster into a `{ kind: "field", positionCount }` segment that spans
   the contiguous run. The classifier in a later stage resolves each
   position to a column definition.
4. **Ambiguous** — mixed patterns that don't cluster cleanly emit a
   single `field` segment; the LLM classifier and per-segment
   recommender in later stages may upgrade pivot candidates.

Pivot ids are `segment_${axis}_${axisName}` with a numeric suffix if
two segments with the same axisName appear on the same axis (rare).

### Changed stage: `classify-field-segments`

`classify-columns.ts` was renamed to `classify-field-segments.ts`
when the segment model landed. The stage classifies field-segment
positions' source headers into `ColumnDefinition`s, exactly like the
pre-PR classifier, but its input is now the `field` positions from
`detect-segments` rather than every position on the header axis.
Pivot positions skip the classifier — they don't bind to a column
definition. Skip positions do the same.

The existing `runBuiltIn` heuristic and injected LLM classifier both
receive only the field candidates. The prompt template stays the
same.

### Changed stage: `recommend-segment-axis-names`

The pre-PR `recommend-records-axis-name` stage fired once per
pivoted region. The shipped stage fires once per **pivot segment**
on any region, whether the region is 1D or crosstab. Each segment's
label cells are collected and fed to the recommender independently.

Per-segment output:

- Updates the segment's `axisName` if the recommender returns a
  non-empty suggestion AND the segment's `axisNameSource` isn't
  already `"user"`.
- The region-level `cellValueField.name` is similarly seeded from
  the recommender when no user value is present.

LLM concurrency stays capped by the existing
`DEFAULT_INTERPRET_CONCURRENCY` (recommender calls are batched via
`pLimit`).

### Changed stage: `propose-bindings`

`propose-bindings` constructs `columnBindings` from field-segment
positions only. Pivot + skip positions contribute no bindings. The
`sourceLocator.axis` field (refinement 14) records which header axis
each binding came from — required for crosstab bindings where both
axes carry fields or pivots.

### Changed stage: `score-and-warn`

New warnings:

- `SEGMENT_MISSING_AXIS_NAME` (blocker) — per segment whose
  `axisName` is empty or `axisNameSource === "anchor-cell"` with no
  anchor cell value available.
- `SEGMENT_VALUE_FIELD_NOT_BOUND` (warn) — region has a pivot
  segment but `cellValueField.columnDefinitionId` is unset. Commit
  still works (FieldMapping reconcile allows it), but the value
  field won't map to a catalog definition.

## Enablement / opt-in

**There is no opt-in.** The segment model is the representation.
Every region produced by interpret carries `headerAxes` +
`segmentsByAxis` + `cellValueField` as appropriate for its shape.
A tidy region is `headerAxes: ["row"]` with a single `field` segment;
a pivoted 1D is `headerAxes: [axis]` with a single `pivot` segment;
a crosstab is `headerAxes: ["row", "column"]` with pivots on each.
`RegionHint` has no `enableSegmentation` flag.

## Acceptance criteria

- `detect-segments` produces correct segment assignments for every
  row of the permutation matrix. Correctness measured against
  hand-crafted expected `segmentsByAxis` per id (lives in
  `packages/spreadsheet-parsing/src/__tests__/fixtures/segment-expectations.ts`).
- `classify-field-segments` ignores pivot + skip positions; their
  labels never reach the classifier prompt.
- `recommend-segment-axis-names` fires once per pivot segment, not
  once per region. Usage logs show the stage name with a segment-id
  field for segmented calls.
- `propose-bindings` emits `sourceLocator.axis` on every binding
  (refinement 14 holds post-interpret).

## Test plan

### detect-segments
(`packages/spreadsheet-parsing/src/interpret/stages/__tests__/detect-segments.test.ts`)

- Row 1 = `Q1, Q2, Q3, Q4` → one pivot segment `quarter`; axisName
  auto-filled from the pattern.
- Row 1 = `name, industry, Q1, Q2, Q3` → `field(2) + pivot(3)` on
  the row axis; 1d canonical.
- Row 1 = `name, industry, Q1, Q2, Q3, Jan, Feb, Mar` → `field(2) +
  pivot-quarter(3) + pivot-month(3)`; 1e canonical.
- Row 1 = `name, industry, Q1, Q2, Q3, Total` → `field(2) +
  pivot(3) + skip(1)`; Totals column classified as skip.
- Crosstab fixture — both row and column axes emit their own pivot
  segments; `cellValueField` seeded at the region level.
- Mixed patterns → single `field` segment; the LLM stage may upgrade.

### classify-field-segments
(extension of existing `classify-columns.test.ts`, renamed file)

- Segmented region with pivot positions — classifier called only
  with the field candidates; pivot labels absent from the candidate
  list.

### recommend-segment-axis-names per-segment
(`packages/spreadsheet-parsing/src/interpret/stages/__tests__/recommend-segment-axis-names.test.ts`)

- Region with 2 pivot segments → recommender called twice, once per
  segment, each with that segment's axis labels.
- Segment with `axisNameSource === "user"` — recommender skipped for
  that segment only; others still fire.

### Orchestration
(`packages/spreadsheet-parsing/src/interpret/__tests__/orchestration.test.ts`)

- End-to-end interpret on fixture 1e — output plan carries the
  expected `segmentsByAxis.row` + `cellValueField`; piping it
  through `extractRecords` emits the expected 6 records.
- End-to-end interpret on a crosstab fixture — output plan has
  `headerAxes: ["row", "column"]` with pivots on both axes and a
  `cellValueField`.

## Non-goals

- UI changes — segment-composition editor lands in `REGION_CONFIG.ui.spec.md`.
- Value-field-name LLM recommendation — heuristic-only in the
  shipped classifier; upgrade tracked as a follow-up.
- Identity-drift handling for segment renames — a separate follow-up
  spec once the rename UX is designed.

## Rollout

Shipped as two sequential PRs (PR-2 detects segments + wires
dispatch; PR-3 adds classify/recommend per-segment). No opt-in
flag, no legacy codepath to deprecate.
