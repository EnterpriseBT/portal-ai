# File Layout Heuristics — Feature Specification

> Purely structural layout detection for CSV and XLSX uploads. No LLM, no preview/adjust step. Detect common non-standard layouts, auto-correct what is safe, compute a confidence score, and surface adjustments and warnings to the user. When confidence is low or the file is unprocessable, link to a sample file showing the ideal layout.

---

## 1. Design Summary

Extend the existing server-side file parsing pipeline (`csv-parser.util.ts`, `xlsx-parser.util.ts`) with a pre-parse layout-detection pass. The detector operates on a buffered peek of the first ~100 rows per file/sheet, identifies common non-standard patterns via structural signals (row density, column shape, type ratios, blank-row runs), and returns a `LayoutDetection` object. The parsers apply the detection (skip title rows, trim columns, flatten multi-row headers, etc.) and emit the detection on `FileParseResult`.

The frontend `UploadStep` renders a confidence banner summarizing what was auto-corrected. At low confidence or for unprocessable files, the user sees a link to a sample file. Unprocessable files block stepper progression.

### Principles

- **Structural only.** Detection uses shape and type signals exclusively — no cell-content keyword matching. Consistent with the existing rule that heuristic analyzers stay generic and defer semantic judgment to AI.
- **Auto-correct the safe cases, flag the risky ones.** Title rows, leading blanks, BOM, and column offsets get silently fixed. Multi-row headers and empty-sheet selection get fixed but listed as adjustments. Transposed/pivot-like shapes get flagged without repair.
- **Confidence is advisory.** Users can proceed at any confidence except `unprocessable`. The score drives UI treatment, not gatekeeping.
- **No new endpoints, no LangGraph, no AI step in v1** — but the implementation **must** be composable and isolated enough that a later migration to LangGraph (adding an LLM classification node, retry loops, human-in-the-loop interrupts) is mechanical, not a rewrite. See §6.1 for the required pipeline architecture.
- **No preview step.** Users do not see raw rows. They see: what was fixed, the confidence level, and — if needed — a link to a sample file.

---

## 2. Scope

### In Scope

| Area | Change |
|------|--------|
| Layout detection | New `layout-detector/` module in API — a composable pipeline of pure analyzer functions over a typed `LayoutAnalysisState`, each mapping 1:1 onto a future LangGraph node |
| CSV parser integration | Buffer first ~100 rows, invoke detector, apply header/row skips, detect trailing aggregates on stream close |
| XLSX parser integration | Per-sheet peek, apply column offset + header/row skips, skip unprocessable sheets |
| Data contract | Extend `FileParseResultSchema` with a `layout` sub-object |
| Processor | Skip AI recommendation step for unprocessable files |
| Frontend | Confidence banner in `UploadStep`, adjustments/warnings lists, sample-file link component, Continue-gating for unprocessable files |
| Sample files | Static CSV + XLSX assets in `apps/web/public/samples/` |
| Tests | Layout-detector unit tests, parser integration tests, frontend rendering tests, upload flow integration test |

### Out of Scope

- Preview-and-adjust UI (deferred — decide based on user feedback from this release).
- LLM-assisted layout classification (deferred).
- Multi-table-per-sheet splitting.
- Transpose repair, pivot unwinding.
- User-supplied layout overrides (`?headerRow=3&sheet=Data`) at the API level.
- Keyword-based footer detection.
- Merged-cell value propagation (merged cells are flagged, not filled).

---

## 3. Detectable Patterns

All signals are structural: row density (fraction of non-empty cells), column count per row, per-column numeric-vs-text ratio, consecutive-blank-row runs, leading-empty-column runs, header-heuristic results over adjacent rows.

| # | Pattern | Signal | Action | Confidence Δ |
|---|---------|--------|--------|--------------|
| 1 | Leading title / metadata rows | Row 1 has ≤ 2 non-empty cells; a later row in the peek has ≥ 3× cell count | Auto-skip; set `headerRowIndex` | −0.05 |
| 2 | Leading blank rows | Run of ≥ 1 fully empty rows before first dense row | Auto-skip | −0.05 |
| 3 | Leading empty columns (XLSX offset) | All peek rows empty in columns `1..N` | Auto-skip; set `columnOffset` | −0.05 |
| 4 | Trailing blank rows | Run of empty rows at end of stream | Auto-trim | 0 |
| 5 | Trailing aggregate rows | After main block, 1–3 rows where first cell is non-empty and ≥ 80% of remaining cells are numeric, following a blank separator OR as the final non-empty rows | Auto-trim; record in adjustments | −0.05 |
| 6 | Multi-row headers | Rows `N` and `N+1` both pass header heuristic (all non-empty, non-numeric); row `N+2` is data-ish (mixed types) | Flatten via `parent › child` concat | −0.15 |
| 7 | BOM prefix (CSV) | First bytes `EF BB BF` | Strip | 0 |
| 8 | Inconsistent row widths | Std-dev of column counts across first 50 data rows > 1 | Flag, no auto-fix | −0.10 |
| 9 | XLSX merged cells in data region | ExcelJS merge rectangles below header row | Flag | −0.10 |
| 10 | Wrong-first-sheet (XLSX) | Sheet has 0 data rows OR all rows collapse to one column | Skip sheet, continue to next | −0.05 |
| 11 | Possibly transposed | Data region has < 10 rows AND > 20 columns AND column 1 text-dominant, cols 2+ numeric-dominant | Flag, no repair | −0.20 |
| 12 | Possibly pivot table | First column has leading-whitespace indentation in ≥ 30% of rows | Flag, no repair | −0.15 |
| 13 | Unprocessable: no dense region | No row in peek buffer has ≥ 2 non-empty cells | Mark `unprocessable`; block Continue | → 0 |
| 14 | Unprocessable: single-column table | Every data row has exactly 1 non-empty cell | Mark `unprocessable` | → 0 |

### Peek buffer size

100 rows. For CSV: read from `csv-parse` stream into a buffer before the existing header logic (`csv-parser.util.ts:195`). For XLSX: same, per sheet. Memory cost: ~100 rows × up to 500 cols × ~50 bytes ≈ 2.5 MB worst case per file.

### Trailing-aggregate detection

Requires awareness of stream end. Maintain a ring buffer of the last 5 rows during streaming. On stream close, inspect the ring buffer and trim any trailing rows matching pattern #5. Row counts and column stats are corrected after trim.

---

## 4. Confidence Scoring

Start at `1.0`, subtract each matched pattern's Δ, floor at `0`. Hard-failure patterns (13, 14) set confidence to `0` and level to `unprocessable` directly.

### Level buckets

| Score | Level | UI treatment |
|-------|-------|--------------|
| ≥ 0.85 | `high` | Green alert, adjustments collapsed (or hidden if none) |
| 0.60 – 0.85 | `medium` | Info alert, adjustments visible |
| 0.30 – 0.60 | `low` | Warning alert, adjustments visible, sample-file link |
| < 0.30 or hard-failure | `unprocessable` | Error alert, Continue disabled, prominent sample-file link |

The cutoffs are an opening guess. Log production scores and retune after the first release.

---

## 5. Data Contract Changes

### `packages/core/src/models/job.model.ts`

```ts
export const LayoutAdjustmentCodeEnum = z.enum([
  "SKIPPED_TITLE_ROWS",
  "SKIPPED_BLANK_ROWS",
  "TRIMMED_TRAILING_BLANKS",
  "TRIMMED_AGGREGATE_ROWS",
  "SKIPPED_LEADING_COLUMNS",
  "STRIPPED_BOM",
  "FLATTENED_MULTI_HEADER",
  "SKIPPED_EMPTY_SHEETS",
]);

export const LayoutAdjustmentSchema = z.object({
  code: LayoutAdjustmentCodeEnum,
  message: z.string(),                          // UI-ready sentence
  rowsAffected: z.number().optional(),
  columnsAffected: z.number().optional(),
  sheetsAffected: z.array(z.string()).optional(),
});

export const LayoutWarningCodeEnum = z.enum([
  "INCONSISTENT_ROW_WIDTHS",
  "MERGED_CELLS_IN_DATA",
  "POSSIBLY_TRANSPOSED",
  "POSSIBLY_PIVOT",
]);

export const LayoutWarningSchema = z.object({
  code: LayoutWarningCodeEnum,
  message: z.string(),
});

export const LayoutConfidenceLevelEnum = z.enum([
  "high",
  "medium",
  "low",
  "unprocessable",
]);

export const LayoutDetectionSchema = z.object({
  headerRowIndex: z.number(),                   // 0-based, in original file
  dataStartRowIndex: z.number(),                // 0-based, in original file
  columnOffset: z.number(),                     // XLSX only; 0 for CSV
  confidence: z.number().min(0).max(1),
  level: LayoutConfidenceLevelEnum,
  adjustments: z.array(LayoutAdjustmentSchema),
  warnings: z.array(LayoutWarningSchema),
});
export type LayoutDetection = z.infer<typeof LayoutDetectionSchema>;
```

### Extend `FileParseResultSchema`

```ts
export const FileParseResultSchema = z.object({
  fileName: z.string(),
  delimiter: z.string(),
  hasHeader: z.boolean(),
  encoding: z.string(),
  rowCount: z.number(),
  headers: z.array(z.string()),
  sampleRows: z.array(z.array(z.string())),
  columnStats: z.array(ColumnStatSchema),
  layout: LayoutDetectionSchema.optional(),     // optional for back-compat
});
```

`layout` is optional on read so existing persisted job results deserialize cleanly. New runs always populate it.

### Adjustment message templates

Backend generates UI-ready strings using these templates:

| Code | Template |
|------|----------|
| `SKIPPED_TITLE_ROWS` | `"Skipped {n} title {row/rows} above the header."` |
| `SKIPPED_BLANK_ROWS` | `"Skipped {n} blank {row/rows} before the data."` |
| `TRIMMED_TRAILING_BLANKS` | `"Trimmed {n} trailing blank {row/rows}."` |
| `TRIMMED_AGGREGATE_ROWS` | `"Trimmed {n} trailing total/aggregate {row/rows}."` |
| `SKIPPED_LEADING_COLUMNS` | `"Skipped {n} empty leading {column/columns}."` |
| `STRIPPED_BOM` | `"Removed byte-order mark from file start."` |
| `FLATTENED_MULTI_HEADER` | `"Combined {n} header rows into a single row."` |
| `SKIPPED_EMPTY_SHEETS` | `"Selected sheet \"{name}\" — skipped empty {sheet/sheets} {names}."` |

| Code | Template |
|------|----------|
| `INCONSISTENT_ROW_WIDTHS` | `"Rows have inconsistent column counts — some values may be misaligned."` |
| `MERGED_CELLS_IN_DATA` | `"Merged cells detected — only the top-left value of each merge is imported."` |
| `POSSIBLY_TRANSPOSED` | `"Data may be transposed (headers down the first column instead of across the top)."` |
| `POSSIBLY_PIVOT` | `"File looks like a pivot table — results may be incomplete."` |

---

## 6. Backend Implementation

### 6.1 Composable Pipeline Architecture (required)

The detector **must** be implemented as a sequence of pure analyzer steps, each taking a typed `LayoutAnalysisState` and returning a new `LayoutAnalysisState`. The top-level `detectLayout` function is a trivial reduce over an ordered list of analyzers. This shape is a **hard requirement**, not an aesthetic preference — it is what makes a later LangGraph migration (adding LLM classification, retry loops, human-in-the-loop interrupts) a mechanical rewrite of the orchestrator rather than a rewrite of the logic.

#### State shape

```ts
export const MergeRectSchema = z.object({
  top: z.number(), left: z.number(),
  bottom: z.number(), right: z.number(),
});

export const LayoutAnalysisStateSchema = z.object({
  // Inputs — immutable after initialization
  input: z.object({
    rows: z.array(z.array(z.string())),         // peek buffer, pre-trim
    format: z.enum(["csv", "xlsx"]),
    mergedCells: z.array(MergeRectSchema).optional(),
  }),

  // Progressively refined detection (each analyzer may update a subset)
  headerRowIndex: z.number(),
  dataStartRowIndex: z.number(),
  columnOffset: z.number(),
  flattenedHeaders: z.array(z.string()).optional(),

  // Accumulated across steps — analyzers append, never replace
  adjustments: z.array(LayoutAdjustmentSchema),
  warnings: z.array(LayoutWarningSchema),

  // Terminal flag — any analyzer may set; downstream analyzers short-circuit
  unprocessable: z.boolean(),
  unprocessableReason: z.string().optional(),

  // Computed only by the final scoring analyzer
  confidence: z.number().optional(),
  level: LayoutConfidenceLevelEnum.optional(),
});
export type LayoutAnalysisState = z.infer<typeof LayoutAnalysisStateSchema>;
```

#### Analyzer contract

```ts
export type Analyzer = (state: LayoutAnalysisState) => LayoutAnalysisState;
```

Every analyzer **must** obey these rules. They are the requirements that preserve LangGraph readiness:

1. **Pure.** No I/O, no global state, no mutation of input. Always return a new state object. Logging via the module logger is permitted; network, disk, and database access is not.
2. **Idempotent.** Running the same analyzer twice on the same state produces the same state. This is what allows graph checkpointing to replay analyzers safely.
3. **Short-circuit on `unprocessable`.** If `state.unprocessable === true`, return state unchanged. Lets the pipeline (and future graph) bail early without wrapping every node in a guard.
4. **Single responsibility.** One analyzer per detectable pattern (or tightly coupled pair, e.g. `detectTitleRowsAnalyzer` may consume `detectLeadingBlanksAnalyzer`'s output but still emits a single adjustment). Composition lives at the orchestrator, never inside analyzers.
5. **Full state in, full state out.** Every analyzer returns a complete, zod-validated `LayoutAnalysisState`. No partial diffs, no callback-style mutation.
6. **Independently exported and testable.** Every analyzer is a named export with its own unit-test file. No private helpers that can only be exercised through `detectLayout`.

#### Orchestrator

```ts
const ANALYZER_PIPELINE: Analyzer[] = [
  stripBomAnalyzer,                       // pattern 7
  detectUnprocessableAnalyzer,            // patterns 13, 14 — may terminate
  detectColumnOffsetAnalyzer,             // pattern 3
  detectLeadingBlanksAnalyzer,            // pattern 2
  detectTitleRowsAnalyzer,                // pattern 1
  detectMultiRowHeaderAnalyzer,           // pattern 6
  detectInconsistentRowWidthsAnalyzer,    // pattern 8
  detectMergedCellsAnalyzer,              // pattern 9 (xlsx only; no-op on csv)
  detectPossiblyTransposedAnalyzer,       // pattern 11
  detectPossiblyPivotAnalyzer,            // pattern 12
  computeConfidenceAnalyzer,              // must be last
];

export function detectLayout(input: LayoutDetectorInput): LayoutDetection {
  const initial = createInitialState(input);
  const final = ANALYZER_PIPELINE.reduce(
    (state, analyzer) => analyzer(state),
    initial,
  );
  return toLayoutDetection(final);
}
```

Two patterns do not fit the synchronous peek-buffer pipeline and are handled as **separate** pure reducers with the same analyzer contract, so they too map cleanly onto future graph nodes:

- **Trailing-aggregate trim (pattern 5)** — runs after stream close with its own state shape (`TrailingTrimState` containing the last 5 rows and current `columnStats` accumulators). Implemented as `trailingTrimAnalyzer` in the same module.
- **Empty-sheet skipping (pattern 10)** — runs at the XLSX multi-sheet orchestrator level as a pure reducer over a list of per-sheet `LayoutAnalysisState`s. Implemented as `skipEmptySheetsAnalyzer`.

#### LangGraph migration path (informational, not v1 work)

Because analyzers are already pure reducers over a zod-typed state, migration is limited to:

```ts
// Future LangGraph version — sketch only, not part of v1
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";

const graph = new StateGraph(LayoutAnalysisStateAnnotation)
  .addNode("stripBom", stripBomAnalyzer)
  .addNode("detectUnprocessable", detectUnprocessableAnalyzer)
  .addNode("detectColumnOffset", detectColumnOffsetAnalyzer)
  // ... one addNode call per existing analyzer, zero body changes ...
  .addNode("computeConfidence", computeConfidenceAnalyzer)
  .addEdge(START, "stripBom")
  .addConditionalEdges("detectUnprocessable",
    (s) => s.unprocessable ? "computeConfidence" : "detectColumnOffset")
  // ... remaining linear edges ...
  .addEdge("computeConfidence", END);
```

At migration time, the net of new work is:
- Wrap each analyzer in `addNode` (zero body changes).
- Replace `reduce` with explicit graph edges.
- Optionally insert an LLM-backed `classifyAmbiguousLayoutNode` behind a conditional edge that routes to it only when heuristic confidence is below a threshold.
- Optionally insert a `humanInterruptNode` for the deferred preview-and-adjust UX.
- Swap the zod schema for a LangGraph `Annotation`-typed state (mechanical translation).

No analyzer function body changes. That is the bar this spec requires.

#### Anti-patterns to reject in code review

These are explicit no-gos — each one creates LangGraph migration friction and must be caught at review time:

| Anti-pattern | Why it blocks migration |
|---|---|
| Analyzers reading from the parser's internal state (stream handles, accumulator refs) | Graph nodes receive only the state object; they cannot reach into parsers |
| Analyzers mutating their input `state` | Graph state snapshots must be immutable per node invocation |
| I/O inside analyzers (disk, network, DB) | Checkpointing replays analyzers on resume; I/O must not repeat |
| Fan-out or branching logic embedded in a single analyzer (`if (csv) ... else ...`) | Branching belongs on graph edges, not inside nodes |
| Confidence scoring sprinkled across multiple analyzers | Graph nodes emit deltas; a single terminal node aggregates the score |
| Analyzers returning partial state shapes (spread of a subset) | Every analyzer returns a full, zod-validated `LayoutAnalysisState` |
| Private helpers reachable only through `detectLayout` | Every analyzer must be independently exported and unit-testable |
| Shared mutable module-level state between analyzers | Graph nodes run in isolation; module-level mutation breaks replay |

### 6.2 Module layout: `apps/api/src/utils/layout-detector/`

Folder, not a single file — each analyzer gets its own module for isolation:

```
apps/api/src/utils/layout-detector/
  index.ts                                      # detectLayout orchestrator + barrel exports
  state.ts                                      # LayoutAnalysisState schema + createInitialState + toLayoutDetection
  analyzer.types.ts                             # Analyzer type alias, MergeRect schema
  helpers.ts                                    # rowDensity, looksLikeHeader, isEmptyRow (shared pure utilities)
  analyzers/
    strip-bom.analyzer.ts
    detect-unprocessable.analyzer.ts
    detect-column-offset.analyzer.ts
    detect-leading-blanks.analyzer.ts
    detect-title-rows.analyzer.ts
    detect-multi-row-header.analyzer.ts
    detect-inconsistent-row-widths.analyzer.ts
    detect-merged-cells.analyzer.ts
    detect-possibly-transposed.analyzer.ts
    detect-possibly-pivot.analyzer.ts
    compute-confidence.analyzer.ts
    trailing-trim.analyzer.ts                   # separate pipeline, same contract
    skip-empty-sheets.analyzer.ts               # xlsx multi-sheet, same contract
```

Public API (`index.ts`):

```ts
export interface LayoutDetectorInput {
  rows: string[][];
  format: "csv" | "xlsx";
  mergedCells?: MergeRect[];
}

export function detectLayout(input: LayoutDetectorInput): LayoutDetection;
export function runTrailingTrim(state: TrailingTrimState): TrailingTrimState;
export function skipEmptySheets(perSheet: LayoutAnalysisState[]): LayoutAnalysisState[];

// Every analyzer is also re-exported for direct unit testing
export * from "./analyzers/strip-bom.analyzer.js";
export * from "./analyzers/detect-title-rows.analyzer.js";
// ... etc
```

Shared helpers (`helpers.ts`):

```ts
export function rowDensity(row: string[]): number {
  const nonEmpty = row.filter((c) => c.trim() !== "").length;
  return row.length === 0 ? 0 : nonEmpty / row.length;
}

export function looksLikeHeader(row: string[]): boolean {
  // Reuses existing rule from csv-parser.util.ts:45-50
  return row.length > 1 && row.every((v) => v.trim() !== "" && isNaN(Number(v.trim())));
}

export function isEmptyRow(row: string[]): boolean {
  return row.length === 0 || row.every((v) => v.trim() === "");
}
```

### 6.3 CSV parser integration

`apps/api/src/utils/csv-parser.util.ts`. The parser is the **only** place that knows about streams, buffers, and I/O — it calls the detector and applies its output but contains none of the detection logic.

- Strip BOM from raw buffer bytes before first read (pattern #7) — the parser does this at the byte layer, then the detector records it via `stripBomAnalyzer` only if it receives a hint via state. Alternatively (preferred): the detector's `stripBomAnalyzer` operates on raw bytes; the parser passes the pre-strip buffer in. Pick one in implementation and document.
- Buffer the first 100 rows from the `csv-parse` stream into memory before the existing header branch (line 195).
- Call `detectLayout({ rows: peekBuffer, format: "csv" })`.
- Apply `layout.headerRowIndex` and `layout.dataStartRowIndex` instead of the current `rowIndex === 0` branch.
- If `layout.adjustments` includes `FLATTENED_MULTI_HEADER`, use `layout.flattenedHeaders` as the header array.
- Track the last 5 rows in a ring buffer during streaming. On stream close, invoke `runTrailingTrim(...)` with the ring buffer and current accumulators. Simplest correct approach: hold the last 5 rows out of the accumulators entirely until a new row arrives behind them; on close, discard any trimmed rows without ever feeding them in.
- Return `layout` on `FileParseResult`.

The parser does not implement any pattern checks directly — every detection decision goes through the analyzer pipeline.

### 6.4 XLSX parser integration

`apps/api/src/utils/xlsx-parser.util.ts`. Same discipline: parser knows I/O, analyzers know logic.

- Per sheet, buffer the first 100 rows from `worksheetReader` before the existing header branch (line 139).
- Collect merge rectangles during peek (ExcelJS streaming reader exposes merges per row as rows are iterated).
- Call `detectLayout({ rows: peekBuffer, format: "xlsx", mergedCells })` per sheet → produces one `LayoutAnalysisState` per sheet.
- Collect all per-sheet states, pass through `skipEmptySheets(...)` to drop unprocessable sheets and annotate the first kept sheet with a `SKIPPED_EMPTY_SHEETS` adjustment.
- For each kept sheet: apply `layout.columnOffset` by trimming each row via `values.slice(columnOffset)` (`rowToValues` gets a `startCol` option at line 68). Apply header/data row indices as in CSV.
- Ring-buffer the last 5 rows for trailing-aggregate detection per sheet via `runTrailingTrim`.

### 6.5 Processor integration

`apps/api/src/queues/processors/file-upload.processor.ts`:

- After parse phase, inspect each `FileParseResult.layout.level`.
- If `unprocessable`, skip the `FileAnalysisService.getRecommendations` call for that file and emit a placeholder recommendation with `entity: null`, `columns: []`, and the layout warnings attached.
- Progress reporting unchanged.

### 6.6 Column-stats correctness

The current column stats pipeline (`column-stats.util.ts`) ingests values as they stream. Two changes are needed for correct stats under trimming:

1. **Trailing-aggregate trim**: hold the last 5 rows in a buffer, feed them into accumulators only when a new row arrives behind them. On stream close, discard trimmed tail rows without ever feeding them to accumulators. This keeps the accumulator API pure-append (no `revert`), which is a prerequisite for later running stats computation inside a checkpointable graph node.
2. **Multi-row header flattening**: the header-row itself is never fed to accumulators (correct today), so flattening is just a header-array concat — no stats impact.

---

## 7. Frontend Implementation

### 7.1 Confidence banner

Extend `apps/web/src/workflows/FileUploadConnector/UploadStep.component.tsx` post-parse summary card (currently at lines 115–154):

```tsx
{parseResult.layout && (
  <LayoutConfidenceBanner layout={parseResult.layout} fileName={parseResult.fileName} />
)}
```

New component `LayoutConfidenceBanner.component.tsx` in the workflow directory:

- `high` → `<Alert severity="success">File parsed successfully.</Alert>`; adjustments list hidden unless present, then collapsible.
- `medium` → `<Alert severity="info">` with summary sentence and visible adjustments `<List>`.
- `low` → `<Alert severity="warning">` with adjustments list + `<SampleFileLink />` inline.
- `unprocessable` → `<Alert severity="error">We couldn't find a data table in this file.</Alert>` with prominent `<SampleFileLink />`.

Adjustments render as `<List dense>` with one `<ListItem>` per `LayoutAdjustment`, using the pre-formatted `message` field. Warnings render the same way under a `Warnings` subheading.

### 7.2 Sample file link

New component `apps/web/src/components/SampleFileLink.component.tsx`:

```tsx
interface SampleFileLinkProps {
  format?: "csv" | "xlsx" | "both";
}
```

Renders `<Link href="/samples/sample-upload.csv" download>Download sample CSV</Link>` and/or the XLSX link based on prop. Default `both`.

Reusable so it can be dropped into other upload-related surfaces later (e.g. the connector-picker empty state).

### 7.3 Continue-gating

`FileUploadConnectorWorkflow.component.tsx`: before advancing past the Upload step, if any `parseResult.layout.level === "unprocessable"`, keep the Continue button disabled and show an inline message listing affected file names. Extend the existing validation pattern in `utils/file-upload-validation.util.ts`.

### 7.4 Sample files

- `apps/web/public/samples/sample-upload.csv`
- `apps/web/public/samples/sample-upload.xlsx`

Contents: ≤ 10 rows, 5 columns, one clean header row, no blanks, no totals, mixed types:

```
id,name,email,signup_date,status
1,Alice Chen,alice@example.com,2025-01-15,active
2,Bob Nguyen,bob@example.com,2025-02-03,active
3,Carla Ruiz,carla@example.com,2025-02-20,pending
4,Dan Park,dan@example.com,2025-03-11,active
5,Eve Schmidt,eve@example.com,2025-03-28,inactive
```

XLSX: single sheet named `Data`, no formatting, no frozen panes, no merged cells.

No README — the files are their own documentation.

---

## 8. Testing

### 8.1 Analyzer unit tests (per-analyzer isolation required)

The composability requirement in §6.1 implies every analyzer is tested **in isolation**, not only through the orchestrator. Test layout:

```
apps/api/src/__tests__/utils/layout-detector/
  helpers.test.ts                               # rowDensity, looksLikeHeader, isEmptyRow
  state.test.ts                                 # createInitialState, toLayoutDetection
  analyzers/
    strip-bom.analyzer.test.ts
    detect-unprocessable.analyzer.test.ts
    detect-column-offset.analyzer.test.ts
    detect-leading-blanks.analyzer.test.ts
    detect-title-rows.analyzer.test.ts
    detect-multi-row-header.analyzer.test.ts
    detect-inconsistent-row-widths.analyzer.test.ts
    detect-merged-cells.analyzer.test.ts
    detect-possibly-transposed.analyzer.test.ts
    detect-possibly-pivot.analyzer.test.ts
    compute-confidence.analyzer.test.ts
    trailing-trim.analyzer.test.ts
    skip-empty-sheets.analyzer.test.ts
  detect-layout.integration.test.ts             # end-to-end orchestrator
```

Every per-analyzer test file must cover:

- **Happy path** — pattern present → expected state mutation.
- **No-op path** — pattern absent → state returned unchanged (reference equality where possible, or deep equality).
- **Short-circuit** — when `state.unprocessable === true`, the analyzer returns state unchanged.
- **Purity** — input state is not mutated (assert via `Object.freeze` on the input before calling).
- **Idempotence** — running the analyzer twice on the same state produces equal state.

Integration test (`detect-layout.integration.test.ts`) covers the orchestrator and confidence boundaries:

- Pure standard layout → `1.0`, `high`.
- One title row auto-skipped → `0.95`, `high`.
- Title rows + trimmed aggregates → `0.90`, `high`.
- Multi-row header + inconsistent widths → `0.75`, `medium`.
- Possibly transposed + merged cells → `0.70`, `medium`.
- Empty input → `0.0`, `unprocessable`.
- Single-column data → `0.0`, `unprocessable`.
- Analyzer ordering property test: shuffling commutable analyzers (all except `computeConfidenceAnalyzer`, which must be last, and `detectUnprocessableAnalyzer`, which must run early) produces the same final `LayoutDetection`. This property protects the migration path — if ordering is load-bearing, graph edges cannot be rearranged freely.

### 8.2 Parser integration tests

Extend `apps/api/src/__tests__/utils/csv-parser.util.test.ts` and `xlsx-parser.util.test.ts`:

- Fixtures per pattern in `apps/api/src/__tests__/__fixtures__/layouts/`.
- Assert `result.layout.adjustments` contains expected codes.
- Assert `result.headers` and `result.rowCount` reflect post-trim state.
- XLSX multi-sheet test: one empty sheet followed by one valid sheet → `SKIPPED_EMPTY_SHEETS` adjustment on the valid sheet's result; empty sheet not yielded.

### 8.3 Frontend tests

`apps/web/src/workflows/FileUploadConnector/__tests__/LayoutConfidenceBanner.test.tsx`:

- Renders correct severity and copy per `level`.
- Lists all `adjustments` and `warnings`.
- Shows `<SampleFileLink />` at `low` and `unprocessable` only.

`UploadStep.test.tsx`:

- Continue button disabled when any file is `unprocessable`.
- Disabled reason copy visible and lists affected file names.

### 8.4 Integration test

Extend `apps/api/src/__tests__/__integration__/routes/uploads.router.integration.test.ts` with a title-row CSV fixture:

- Upload → process → recommendation response includes `parseResults[0].layout.adjustments` containing `SKIPPED_TITLE_ROWS`.
- Import step ingests the correct data rows (title row is not imported).

---

## 9. Rollout

Single PR, additive. Order of commits:

1. Contracts: add `LayoutDetectionSchema`, `LayoutAdjustmentSchema`, `LayoutWarningSchema`, `LayoutAnalysisStateSchema` to `@portalai/core/models`. Extend `FileParseResultSchema`.
2. Add `layout-detector/` module skeleton: `state.ts`, `analyzer.types.ts`, `helpers.ts`, empty orchestrator (`index.ts` exports `detectLayout` that runs an empty pipeline).
3. Add analyzers one commit at a time — each commit adds one analyzer file + its isolated unit test. Order: `strip-bom` → `detect-unprocessable` → `detect-column-offset` → `detect-leading-blanks` → `detect-title-rows` → `detect-multi-row-header` → `detect-inconsistent-row-widths` → `detect-merged-cells` → `detect-possibly-transposed` → `detect-possibly-pivot` → `compute-confidence` → `trailing-trim` → `skip-empty-sheets`. Each commit wires the new analyzer into the orchestrator pipeline. This makes code review granular and the migration path visible per-analyzer.
4. Add orchestrator integration test (`detect-layout.integration.test.ts`) covering confidence boundaries and the ordering property test.
5. Wire detector into `csv-parser.util.ts` + update `csv-parser.util.test.ts`.
6. Wire detector into `xlsx-parser.util.ts` + update `xlsx-parser.util.test.ts`.
7. Update `file-upload.processor.ts` to skip AI recommendation for `unprocessable` files.
8. Add `SampleFileLink.component.tsx` + sample files in `apps/web/public/samples/`.
9. Add `LayoutConfidenceBanner.component.tsx` + wire into `UploadStep.component.tsx`.
10. Add Continue-gating in `FileUploadConnectorWorkflow.component.tsx`.
11. Upload flow integration test.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Trailing-aggregate trim drops a legitimate last row | Require the blank-row separator before a candidate aggregate block; log trimmed rows in `adjustments` so users see what was dropped |
| XLSX sheet selection drops a sheet the user wanted | `SKIPPED_EMPTY_SHEETS` adjustment lists sheet names by name; users can see what was skipped and re-upload with only the desired sheet |
| Inconsistent-row-width warning is noisy on files with legitimately ragged data | Tune the std-dev threshold against fixtures before shipping; downgrade to a silent note if it proves useless |
| Confidence weights are subjective | Log `confidence` and `level` on every processed file; retune after 2–4 weeks of production data |
| Peek buffer memory | Bounded at ~2.5 MB worst case per file (100 rows × 500 cols × 50 bytes); acceptable given existing 3.2 GB Node heap |
| Multi-row header flattening produces ugly column names | Flattened names go into `headers` as-is; users can edit column labels in the existing Column Mapping step — no new UX surface needed |

---

## 11. Deferred

Explicitly not in this spec, but **the §6.1 architecture is the mechanism by which each of these becomes additive rather than a rewrite**. Revisit after the release based on real usage data.

| Deferred work | How §6.1 enables it |
|---|---|
| LangGraph migration | Each analyzer is already a pure reducer over typed state — wrap each with `addNode`, translate `reduce` to edges, done. See §6.1 "LangGraph migration path". |
| LLM-assisted classification for ambiguous layouts | Add a `classifyAmbiguousLayoutAnalyzer` that runs after heuristics and only fires when `confidence < threshold`. Slots into the pipeline (or a LangGraph conditional edge) with no changes to existing analyzers. |
| Preview-and-adjust UI | The `LayoutAnalysisState` is already a checkpointable structure. LangGraph's interrupt/resume primitives operate directly on it. |
| Multi-table-per-sheet splitting | New analyzer `detectMultipleTablesAnalyzer` emitting multiple `LayoutAnalysisState`s from one input. Requires extending the XLSX orchestrator but not changing existing analyzers. |
| Transpose repair, pivot unwinding | New analyzers that transform `state.input.rows` into a repaired shape before later analyzers see it. Order matters here — these would run immediately after `detectUnprocessableAnalyzer`. |
| User-supplied overrides at the API level | Extend `LayoutDetectorInput` with an optional `overrides` field; `createInitialState` seeds state from overrides; analyzers short-circuit on fields the user has set explicitly. |
| Keyword-based footer detection | New analyzer behind a feature flag. Ships as a single file. |
| Merged-cell value propagation | New analyzer `propagateMergedCellsAnalyzer` that rewrites `state.input.rows` for merged regions. |
