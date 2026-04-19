# Spreadsheet Parsing — Discovery

> **Status: superseded by specs.** This document is preserved as the historical record of how the design was reached. Normative content now lives in:
>
> - `SPREADSHEET_PARSING.architecture.spec.md` — conceptual model, module boundary, usage modes, confidence framework, region → entity merge, drift policy
> - `SPREADSHEET_PARSING.backend.spec.md` — module layout, types, stage decomposition, schema changes, sync integration
> - `SPREADSHEET_PARSING.frontend.spec.md` — region-drawing UX, review flow, Mode A/B interactions, drift review UI
>
> All four blocking open questions (1, 2, 10, 11) are resolved inline below. Non-blocking open questions carry forward to the specs that own them.

## Problem

Users upload spreadsheets (CSV, XLSX) that do not conform to a single "one header row, rectangular data below" layout. Real-world files contain:

- Title rows, notes, and metadata rows above the data
- Merged cells used as section headers
- Row labels (left-column categories) instead of, or in addition to, column headers
- Multiple datasets stacked or placed side-by-side on one sheet
- Empty rows/columns used as visual separators
- Pivoted layouts where "columns" are time periods or categories and the entity is the row label
- Multiple sheets where some are data, some are lookup/reference, some are junk

The existing `FileUploadConnector` workflow handles the simple case (one header row, rectangular body). We need a parsing layer that can interpret irregular sheets, propose a mapping to `ColumnDefinition`s, and — critically — **repeat that interpretation on subsequent syncs even as the file structure shifts** (a column added, a section moved down two rows, a sheet renamed).

## Non-goals

- Not a query-through / live connector. Per the connector domain model, output is always materialized into `entity_records` via sync cadence.
- Not a general-purpose data cleaning tool. We interpret structure; we do not transform values beyond what a `ColumnDefinition` already specifies.
- Not replacing the simple-layout path. The existing workflow remains the fast path for well-formed files; AI interpretation is opt-in or triggered when heuristics fail.
- **Not coupled to any specific connector.** The module must be consumable by the current `FileUploadConnector` *and* by planned Google Sheets and Microsoft (Excel Online / OneDrive) connectors. It knows nothing about connector instances, connector tables, upload workflows, or how bytes arrived.

## Module boundary

This module is a standalone package-level concern (tentatively `@portalai/spreadsheet-parsing` or a folder under `packages/core/` — TBD). Its surface is three things:

1. A **`Workbook` input abstraction** — a provider-agnostic view of sheets and cells. Callers adapt their source to this shape:
   - `FileUploadConnector` adapts parsed CSV/XLSX bytes
   - A future Google Sheets connector adapts the Sheets API response
   - A future Microsoft connector adapts Graph / Excel REST responses
   The module never opens files, hits APIs, or knows about auth.

2. A pure **`interpret(input): Promise<LayoutPlan>`** function that consumes the `Workbook` plus optional prior plan / drift report and returns a plan.

3. A pure **`replay(plan, workbook): ReplayResult`** function that produces extracted records and a drift report. No I/O, no persistence.

Everything stateful — persisting the plan, running the sync, writing `entity_records`, triggering re-interpretation — is the **caller's** responsibility. The module is a library, not a service. This is what makes it reusable across connector types.

### Consumer responsibilities (i.e., what each connector brings)

- Adapter from its native format to `Workbook`
- Storage for the plan it owns (schema and ownership model may differ per connector — and may be absent entirely for snapshot-only consumers; see Usage modes below)
- Decision about when to re-fetch, when to replay, when to replan
- Mapping from `ReplayResult` records into `entity_records` writes
- UX for showing interpretation results and collecting user confirmation on identity-changing drift

## Usage modes

The module supports two usage modes with the same core primitives. A consumer picks a mode based on whether the underlying source is expected to change over time.

### Mode A — Snapshot upload (one-shot)

Used by file-upload connectors where a user hands over a file once and the extracted records are treated as a static import.

- Flow: `interpret(workbook) → LayoutPlan → replay(plan, workbook) → records → entity_records`
- **Every upload is treated as a new upload.** A fresh plan is produced each time; there is no prior plan, no reconcile step, and no attempt to reuse a previous interpretation.
- The plan drives extraction and is the object the UI uses for review/edits before commit. The consumer is not required to persist it after commit (it may optionally archive for audit, but the module makes no assumptions either way).
- No drift handling, no `reconcileWithPrior`, no scheduled sync.

### Mode B — Connector-backed sync (repeating)

Used by Google Sheets, Microsoft Excel Online, and any future connector where the source is a live document that changes over time.

- Flow (first sync): `interpret(workbook) → LayoutPlan → persist plan → replay → entity_records`
- Flow (subsequent syncs): `fetch workbook → replay(priorPlan, workbook) → drift report`
  - Drift within tolerance → records commit, plan unchanged
  - Drift outside tolerance → `interpret(workbook, priorPlan, driftReport) → new plan version` → user confirmation if identity-affecting → commit new plan + records
- The plan is a durable artifact keyed to the connector instance (and optionally to a remote revision identifier like Sheets `revisionId` or Graph `eTag`).
- Re-interpretation is rare by design: replay is the hot path; interpret is the cold path triggered by drift or explicit user action ("re-analyze this sheet").

### What this means for the module's design

Both modes hit the same three surfaces: `Workbook`, `interpret()`, `replay()`. The module does not distinguish between them — the mode is a property of *how the consumer uses the outputs*, not of how the module computes them. Specifically:

- `interpret()` must work with or without a prior plan (Mode A never passes one; Mode B omits it only on first sync).
- `replay()` must return a drift report even when the consumer intends to ignore it (Mode A), so both modes share the same code path.
- The plan schema itself must not assume persistence or a connector instance; it is a pure value.

This keeps the module usable for ad-hoc imports and for long-lived connectors without a mode switch.

## Core idea: the Layout Plan is the extraction artifact

The output of interpretation is a **versioned, declarative `LayoutPlan`**. The plan describes, in workbook-relative terms, how to extract records from a workbook. It references sheets and cells by name/coordinate addressable through the `Workbook` abstraction, so the same plan works whether the workbook came from an uploaded XLSX, a Google Sheet, or a Microsoft Excel Online file.

In Mode B (connector syncs) the plan is durable and replay is the hot path. In Mode A (snapshot uploads) a fresh plan is produced on every upload — it drives extraction and is the object the user edits in the UI before commit, but is not reused across uploads. The module treats the plan as a pure value in both cases; persistence is a consumer concern.

Conceptual shape (details to be specified):

```
LayoutPlan v1
  planVersion: semver
  workbookFingerprint: { sheetNames, dimensions, anchorCells }  // provider-agnostic
  regions: [
    {
      id: stable region id
      sheet: string
      bounds: { startRow, endRow | dynamic, startCol, endCol }
      targetEntityDefinitionId: string         // region → entity binding (1 sheet → N entities)
      orientation: "rows-as-records" | "columns-as-records"
      headerAxis: "row" | "column"             // which axis holds field names
      recordsAxisName?: { name, source: "user" | "ai", confidence }  // required for pivoted regions
      headerStrategy: { kind: "row" | "column" | "composite", locator: ..., confidence }
      identityStrategy: { kind: "column" | "composite" | "derived", spec: ..., confidence }
      columnBindings: [
        { sourceLocator, columnDefinitionId, transform?, confidence, rationale? }
      ]
      skipRules: [ predicates identifying non-data rows ]
      confidence: { region, aggregate }
      warnings: [ { code, severity, locator, message, suggestedFix? } ]
    }
    ...
  ]
  drift: { tolerances, replanTriggers }
  confidence: { overall, perRegion }
```

Two operations consume the plan:

1. **Replay** — deterministic. Given a new file and an existing plan, extract records. No LLM call.
2. **Replan** — invoked only when replay detects drift beyond tolerance. Produces a new plan version; changes that affect `source_id` derivation require user confirmation before the sync commits.

This keeps the common case cheap and reproducible, and keeps the AI cost bounded to files that have actually changed shape.

## Confidence scoring

Interpretation must emit confidence scores and actionable warnings alongside the plan, so the user can decide — **before committing** — whether to fix their source file/sheet and re-run, or accept the plan as-is. This applies equally to Mode A (snapshot upload) and Mode B (first-time connector setup, or any replan in an existing connector).

### What gets scored

Confidence is reported at multiple granularities, not as a single blended number:

- **Per `columnBinding`** — how sure is the interpreter this source column maps to this `ColumnDefinition`? Low scores are the most common "fixable" signal (ambiguous header, mixed types in the column, values that don't match the definition's pattern).
- **Per `headerStrategy`** — was the header row unambiguously located? Low scores suggest a title row was mistaken for a header, or no header exists.
- **Per `identityStrategy`** — is the chosen `source_id` actually unique and stable? Low scores suggest duplicate values, blank cells in the identity column, or a fallback "row index as id" that will break on reorder.
- **Per region** — aggregate + bounds confidence (did the region's extent look rectangular, or did the interpreter guess at where it ends?).
- **Overall** — rolled up for the plan. Used for coarse gating only; the UI should never show *only* this number.

Each score is a number in `[0, 1]`. Scores are **only meaningful in relative and threshold terms** — not as a precise probability. The spec will fix threshold bands (e.g., `>= 0.85` green, `0.6–0.85` yellow, `< 0.6` red) so UI and gating are consistent.

### Warnings are first-class

Scores alone are not actionable. Every low-confidence score must be accompanied by a structured `warning` that includes:

- `code` — enum (e.g., `AMBIGUOUS_HEADER`, `MIXED_COLUMN_TYPES`, `DUPLICATE_IDENTITY_VALUES`, `IDENTITY_COLUMN_HAS_BLANKS`, `UNRECOGNIZED_COLUMN`, `REGION_BOUNDS_UNCERTAIN`, `MULTIPLE_HEADER_CANDIDATES`, `SHEET_MAY_BE_NON_DATA`)
- `severity` — `info | warn | blocker`. Blockers prevent commit.
- `locator` — the specific sheet/cell/region the warning points to, so the UI can highlight it.
- `message` — short, user-facing.
- `suggestedFix` — optional, e.g., "Remove the title row in A1:F1" or "Fill in the missing values in column C before re-uploading." This is the feature that lets the user go update their sheet.

The interpreter must produce warnings even when overall confidence is high, if it detects fixable issues (duplicate identity values can coexist with a confidently-located region, for example).

### How confidence flows through the modes

- **Mode A (snapshot upload)**: the workflow shows the plan with scores and warnings at a review step. The user chooses:
  1. Commit as-is
  2. Edit specific bindings inline
  3. **Cancel, fix the source file, and re-upload** — this is the path the scores are designed to inform.

  Blockers disable the commit button until resolved (either by editing the plan or by re-uploading a fixed file).

- **Mode B (connector sync)**:
  - *First connection*: same review step as Mode A before the first sync commits.
  - *Replan after drift*: the replan result is compared to the prior plan; if overall confidence dropped significantly or new blockers appeared, the sync halts and prompts the user to review/fix (analogous to the identity-change halt). Configurable per-connector whether warn-level drops also require review, or are auto-logged.

### What the module emits vs. what the consumer does

The module emits scores and warnings; it does not decide workflow. Gating (what severity blocks commit, how scores are presented, whether to auto-retry after the user fixes and re-uploads) is the consumer's job. This keeps the module uniform across Mode A and Mode B and across connector types.

### Calibration

Scores will initially be heuristic + LLM-emitted. We will not claim probabilistic calibration. To keep them useful:

- Fixture-based regression: a set of known-irregular spreadsheets with hand-annotated expected scores, used to detect regressions when prompts change.
- No silent score changes: if the interpreter internals change in a way that shifts typical score ranges, the `planVersion` bumps and thresholds are reviewed.

## Records-centric sync contract

Each region's `identityStrategy` yields a stable `source_id` per extracted record. The sync pipeline treats a `LayoutPlan` the same way it treats a CSV header mapping today: input is rows, output is `entity_records` with `source_id`, `checksum`, `origin: "sync"`. The plan is stored alongside the connector instance; sync history links to the plan version used.

Drift of **any** kind halts the sync and requests user review by default. Regions may opt into auto-apply for specific drift classes (e.g., added non-identity columns, header shifts within N rows) via their own drift knobs — this is a per-region decision, not a global or per-connector one. Drift that would change `source_id` derivation is never eligible for auto-apply.

## AI boundary — designed for LangGraph migration later

The AI layer has **one job**: given a raw grid (plus optional prior plan and drift report), produce a `LayoutPlan`. Everything else is deterministic.

To keep a future LangGraph (or similar) migration cheap, the v1 implementation — even if it is a single structured-output LLM call — should:

1. **Expose a single typed interface**: `interpret(input: InterpretInput): Promise<LayoutPlan>` where `InterpretInput` carries raw grid, optional prior plan, optional drift report, and optional user hints. Callers never depend on how the interior is organized.

2. **Model the interior as named stages with a shared state object**, even when they execute in one call. Suggested stages:
   - `detectRegions` — find rectangular data regions and their orientation
   - `detectHeaders` — locate header rows/columns per region
   - `detectIdentity` — choose or derive a `source_id` column per region
   - `classifyColumns` — semantic match from source columns → `ColumnDefinition`s (this is where [feedback_heuristic_vs_ai] lives — AI owns naming semantics; heuristic owns pure value-pattern fallbacks)
   - `proposeBindings` — final plan assembly with confidence scores
   - `reconcileWithPrior` (only when a prior plan exists) — diff against prior, mark preserved vs changed bindings, flag identity changes
   - `scoreAndWarn` — consolidates per-stage confidence signals into the plan's `confidence` fields and emits structured `warnings` with `suggestedFix` hints (see Confidence scoring)

   In v1 these can all be one prompt with a structured-output schema; the *state object* passed between them is a first-class type. This is exactly the shape a LangGraph `StateGraph` would consume.

3. **Make each stage individually testable** with fixture grids and fixture state, so migrating to a graph is a refactor, not a rewrite.

4. **Checkpoint intermediate artifacts** — region detections, header candidates, classification scores — on the plan itself (or on a sibling `InterpretationTrace`). A future graph may pause and resume across these checkpoints; a v1 single-call implementation just writes them all at once.

5. **No nondeterminism leakage into the plan**. The plan must be a pure function of (grid, prior plan, user confirmations). Model call nondeterminism is absorbed at interpretation time; replay is deterministic.

The consequence: migrating to LangGraph later is "replace `interpret()`'s body with a graph that reads/writes the same state object and produces the same `LayoutPlan`." No changes required in the connector, sync pipeline, UI, or storage.

## How consumers plug into the module

Consumers are connector-shaped but the module treats them uniformly. The first consumer is `FileUploadConnector`; Google Sheets and Microsoft (Excel Online) connectors follow the same pattern.

Per-consumer responsibilities:

- **Workbook adapter**: converts the native representation into the module's `Workbook` type. This is the only provider-specific code.
- **Plan storage**: each connector persists the `LayoutPlan` where it makes sense for that connector (likely a generic `connector_instance_layout_plans` table keyed by connector instance, but a cloud connector may also want to cache against the remote file's `etag`/`revisionId`).
- **Workflow UI**: presents interpretation results and collects confirmation. Can be shared across connectors via a generic component that takes a `LayoutPlan` and emits edits — the UI doesn't need to know which connector it's serving.
- **Sync driver**: on `canSync`, fetches the latest workbook (from upload, Sheets API, or Graph), calls `replay(plan, workbook)`, writes `entity_records`, and on drift decides whether to call `interpret()` and surface confirmation.
- **Field mappings**: `columnBindings` in the plan resolve to the same `FieldMapping` rows used elsewhere — the plan is a *source of* field mappings, not a replacement for them. This is shared, not per-connector.

Cross-cutting (not per-connector): the `entity_records` write path, `FieldMapping` schema, `ColumnDefinition` resolution. None of these change.

## Declarative surface — working sketch for open question #1

This is a first pass at enumerating the declarative primitives the plan would need to cover the irregular-layout cases listed in **Problem**. The goal is to see how large the surface becomes before deciding how much to encode declaratively vs leave opaque.

Each group is a discriminated union of variants. Counts at the end.

### Locator — "how to point at something"

Used by bounds, headers, identity, skip rules, and bindings.

- `cell` — `{ sheet, row, col }`
- `range` — `{ sheet, startRow, startCol, endRow, endCol }`
- `column` — `{ sheet, col }` (whole column)
- `row` — `{ sheet, row }` (whole row)
- `headerRelative` — `{ regionId, headerName }` (resolved after header detected)
- `pattern` — `{ sheet, regex, scope: "cell" | "row" | "column" }` (resolve by match)

### Region bounds

- `absolute` — literal range
- `anchoredTo` — `{ anchorLocator, offsetRows, offsetCols, extent }`
- `untilBlank` — `{ startLocator, direction: "down" | "right" }` (grow until a fully-blank row/col)
- `untilPattern` — `{ startLocator, stopPattern, direction }` (grow until match, e.g., "TOTAL")
- `wholeSheet` — the used range of a sheet

### Orientation

- `rows-as-records`
- `columns-as-records`
- `cells-as-records` (crosstab — every cell is a record indexed by row and column labels)

### Header strategy

- `row` — `{ rowLocator }` (standard case)
- `column` — `{ colLocator }` (for pivoted regions where row labels act as headers)
- `composite` — `{ rowLocators: [...], joiner }` (merged multi-row headers)
- `none` — synthesize headers from position ("Column 1", "Column 2"…)
- `rowLabels` — left-column labels are the entity identity *and* the header axis (common in pivoted exports)

### Identity strategy (source_id derivation)

- `column` — `{ sourceLocator }` (single column value)
- `composite` — `{ sourceLocators: [...], joiner }`
- `derived` — `{ expression: "checksum" | "hashOfFields", fields: [...] }`
- `rowPosition` — discouraged; emits a `warn` severity. id = "row-{n}"; breaks on any reorder.

### Skip rule predicates (rows to exclude from extraction)

- `blank` — row has no non-empty cells
- `allSameValue` — every cell identical (separator rows)
- `cellMatches` — `{ locator, regex }`
- `columnMatches` — `{ colLocator, regex }` (e.g., "TOTAL" or "Subtotal" in first column)
- `marker` — `{ colLocator, value }` (explicit marker column)

### Transforms on binding

**Likely don't belong in the plan at all.** `ColumnDefinition` already specifies type parsing; putting transforms here duplicates that surface and creates ambiguity about who owns value coercion. Proposal: **omit from plan**. If the interpreter detects a format mismatch, it emits a warning with `suggestedFix` instead of encoding a transform. (Flagging explicitly because it was sketched earlier.)

### Binding source locator (inside a columnBinding)

- `byHeaderName` — `{ name }` (requires header strategy ≠ `none`; robust to column reorder)
- `byColumnIndex` — `{ col }` (brittle; used only as fallback)
- `byHeaderMatch` — `{ regex }` (for loose matching against varied-but-recognizable headers)

### Drift tolerance knobs (per region or per plan)

- `headerShiftRows` — ±N rows the header may have moved
- `columnReorder` — boolean; allow reorder when headers still match
- `addedColumns` — boolean; allow new source columns (ignored by replay)
- `removedColumns` — integer; max # of bindings that may drop before replan is required
- `renamedHeaders` — fuzzy match threshold (0–1)

### Surface tally (full expansion)

| Group | Variants / knobs |
|---|---|
| Locator | 6 |
| Bounds | 5 |
| Orientation | 2 |
| Header strategy | 5 |
| Identity strategy | 4 |
| Skip predicates | 5 |
| Transforms | **0 (proposal: omit)** |
| Binding source locator | 3 |
| Drift tolerance knobs | 5 |
| **Total** | **~30 discriminated cases + 5 knobs** |

That is a lot for a v1. Most of it is unavoidable if we want to cover the full **Problem** list declaratively. The honest question is which subset we commit to for v1.

### Proposed v1 minimum

Drop or defer the least-necessary variants. The interpreter may still recognize the dropped cases and reject them via `blocker` warnings ("this sheet uses a composite header, which isn't supported yet") — that's cheaper than building half-support. The table below reflects what was actually built (see the "Updated v1 declarative surface" table in the Primary design section and the architecture spec for the normative definitions):

| Group | v1 keeps | v1 defers |
|---|---|---|
| Locator | `cell`, `range`, `column`, `row` | `headerRelative`, `pattern` |
| Bounds | `absolute`, `untilEmpty` (configurable terminator count), `matchesPattern` (regex stop rule) | `anchoredTo`, `wholeSheet` auto-detect |
| Orientation | `rows-as-records`, `columns-as-records`, `cells-as-records` (crosstab) | — |
| Header strategy / axis | `headerAxis: "row" \| "column" \| "none"`; `headerStrategy.kind: "row" \| "column" \| "rowLabels"` | `composite` header strategy |
| Identity strategy | `column`, `composite`, `rowPosition` (with warn) | `derived` |
| Skip predicates | `blank`, `cellMatches` (with optional `axis` for crosstab row/column targeting) | `allSameValue`, `marker`, `columnMatches` by header name |
| Transforms | none | none |
| Binding source locator | `byHeaderName`, `byColumnIndex` (fallback) | `byHeaderMatch` |
| Drift tolerance knobs | `headerShiftRows`, `addedColumns`, `removedColumns` | `columnReorder`, `renamedHeaders` |

That gives a v1 surface that covers: title rows above data, empty-row separators, multiple stacked datasets, simple and complex pivoted layouts (via orientation + header-axis selection), crosstab / cells-as-records regions, headerless regions with auto-generated field names, configurable extent with until-empty and pattern-match modes, and deterministic replay with bounded drift. It does **not** cover: multi-row merged headers, pattern-anchored bounds, composite fuzzy header matching.

### Implications

- The **v1 keeps** column is close to the lower bound of "covers enough to be useful." Going smaller probably means falling back to the existing simple-layout path.
- Every deferred variant should have a **corresponding warning code** in the interpreter so unsupported shapes are surfaced clearly rather than silently mis-parsed.
- Transforms being omitted from the plan is a load-bearing decision — it keeps the plan about *structure* only, and pushes value semantics into `ColumnDefinition` where they already live.
- The drift-tolerance knobs are the part most likely to churn post-v1 as we learn what real syncs look like. Consider making them per-region-overridable from the start so we don't have to change schema later.

## Primary design: user-drawn regions as the interpretation unit

v1 makes **user-drawn region hints the primary way to describe a sheet**, not a fallback for when auto-detection fails. Auto-detection exists as an assist (especially for trivial one-region sheets) but the declarative surface and interpretation flow are designed around explicit user input first.

### Shape

Regions are the unit of interpretation. Each region is:

- **Bounded** — user draws or types a rectangular range on a single sheet (A1 notation or numeric offsets). Bounds mode can be `absolute` (the drawn rectangle), `untilEmpty` (expand until a configurable number of consecutive blank records), or `matchesPattern` (stop at a regex-matching record).
- **Bound to a target entity** — each region targets exactly one entity definition. Different regions may target different entities; multiple regions may target the same entity (records appended).
- **Oriented** — user declares how records are laid out: down the rows (`rows-as-records`), across the columns (`columns-as-records`), or as individual cells in a crosstab (`cells-as-records`).
- **Labeled on one or both axes** — one axis holds field names (the "header axis"); the other axis holds record-varying values (the "records axis"). For non-pivoted regions, the records axis is anonymous (each row is just a record). For pivoted regions, the user supplies a **semantic name for the records axis** — e.g., `Month` — which becomes a field on every extracted record alongside the fields from the header axis. For crosstab regions, **three** names are required: a row-axis name, a column-axis name, and a cell-value name.
- **Anchored** — an optional axis-name anchor cell (defaulting to the region's top-left corner) whose non-blank string value auto-populates the records-axis name. The anchor is overridable when the axis label lives in a different cell (e.g., a legend row at the bottom of the block).

### Pivoted example

Region `B2:N4` — a Payment Schedule block with column headers `JAN…DEC` in `C2:N2` and row labels `amount`, `source` in `B3:B4`.

User config:

- `bounds` = `B2:N4`
- `orientation` = `columns-as-records`
- `headerAxis` = `row` (row labels `amount`, `source` are the field names)
- `recordsAxisName` = `Month`
- `targetEntityDefinitionId` = `PaymentSchedule`

Parser emits 12 records, each shaped `{ amount, source, month: "JAN" | "FEB" | ... }`. The same principle holds symmetrically when columns carry field names and rows carry the varying dimension.

### Crosstab example

Region `A1:E5` — a Revenue block with column headers `Q1…Q4` in `B1:E1`, row labels `North`, `South`, `East`, `West` in `A2:A5`, and a corner cell `A1` containing `"Revenue"`.

User config:

- `bounds` = `A1:E5`
- `orientation` = `cells-as-records`
- `recordsAxisName` = `Region` (row axis — auto-populated from anchor cell value `"Revenue"` is overridden by user)
- `secondaryRecordsAxisName` = `Quarter` (column axis)
- `cellValueName` = `Revenue`
- `axisAnchorCell` = `A1` (default — top-left corner, value `"Revenue"`)
- `targetEntityDefinitionId` = `QuarterlyRevenue`

Parser emits 16 records (4 rows × 4 cols), each shaped `{ region: "North" | ..., quarter: "Q1" | ..., revenue: <cell-value> }`.

### Input shape

```
InterpretInput {
  workbook: Workbook
  regionHints?: Array<{
    sheet: string
    bounds: { startRow, endRow, startCol, endCol }            // 1-based, inclusive
    targetEntityDefinitionId: string
    orientation: "rows-as-records" | "columns-as-records" | "cells-as-records"
    headerAxis: "row" | "column" | "none"                     // which axis holds field names
    recordsAxisName?: string                                   // required for pivoted + crosstab regions
    secondaryRecordsAxisName?: string                          // required for crosstab (column dimension)
    cellValueName?: string                                     // required for crosstab (cell value field)
    axisAnchorCell?: { row, col }                              // override for axis-name anchor; default = top-left
    proposedLabel?: string                                     // user-facing name for this region
  }>
  priorPlan?: LayoutPlan
  driftReport?: DriftReport
  userHints?: ...
}
```

Semantics:

- If `regionHints` is provided, the interpreter **skips region detection entirely**. It creates exactly one `region` per hint.
- Everything downstream — header detection within bounds, identity strategy, column classification, confidence, warnings — still runs per region.
- If `regionHints` is omitted, the interpreter runs auto-detection on the workbook as a best-effort fallback.

### Records-axis name — anchor-cell auto-population and AI recommendation

Users shouldn't have to invent `Month` from a blank field. Two auto-population paths exist, in priority order:

1. **Anchor-cell auto-population** — the region's axis-name anchor cell (default: top-left of bounds, overridable via `axisAnchorCell`) is read for a non-blank string value. If one exists, `recordsAxisName` is set with `source: "anchor-cell"` so the UI shows it pre-filled but editable. Moving the anchor cell updates the name in real time. Anchor-cell names are never written over user-typed (`source: "user"`) or AI-suggested (`source: "ai"`) names.

2. **AI recommendation** — once the region is drawn and orientation + headerAxis are declared, the interpreter inspects the values along the records axis and proposes a name. Seeing `JAN, FEB, MAR, …, DEC` yields a high-confidence suggestion of `Month`; seeing `2021, 2022, 2023` yields `Year`; seeing `North, South, East, West` yields `Region`. The user accepts, edits, or overrides.

The AI path is a narrow task: input is one axis's labels, output is a single string plus a confidence score. It fits inside the existing AI stage decomposition as an optional `recommendRecordsAxisName` sub-stage gated on pivoted orientation; no new top-level stage is required. The plan records `recordsAxisName.source` as `"user"`, `"ai"`, or `"anchor-cell"` so the UI can mark non-user names as needing confirmation.

When no name can be proposed with high confidence and the user hasn't supplied one, the plan emits a `blocker` warning (`PIVOTED_REGION_MISSING_AXIS_NAME`) — records can't be uniquely identified without that field.

### Multi-region, multi-entity per sheet — region → entity merge model

Each region represents **either a whole entity or a partial entity**. The `targetEntityDefinitionId` is the entity key; **regions that share the same key merge into one entity**, with their extracted records unioned under that entity. This means:

- One sheet can populate multiple entities (distinct target IDs), and one entity can be assembled from multiple regions (same target ID, possibly across sheets).
- AI field-mapping / column classification runs **once per merged entity** — after all regions targeting that entity have been defined and configured — not once per region. This keeps the mapping recommendation coherent across regions that contribute to the same logical entity.
- `ConnectorEntity` is 1:1 with `targetEntityDefinitionId` within a connector instance (one `ConnectorEntity` can own N regions).
- `FieldMapping` rows belong to the merged entity, not to individual regions.
- `entity_records` writes resolve per merged entity; regions are the extraction unit, not the persistence unit.
- UI surfaces regions grouped by their target entity during setup and drift review.

This breaks the prior `FileUploadConnector` convention of "one entity per sheet / one entity per file," but the break is contained: the parser emits regions with `targetEntityDefinitionId`; the connector groups-and-merges by that key when materializing.

### Updated v1 declarative surface

With user-drawn regions as the primary path, the surface shrinks. The table below reflects what was actually built (see architecture and backend specs for the normative definitions):

| Group | v1 keeps | v1 defers |
|---|---|---|
| Locator | `cell`, `range`, `column`, `row` | `headerRelative`, `pattern` |
| Bounds | `absolute` (from hints), `untilEmpty` (configurable terminator count), `matchesPattern` (regex stop rule) | `anchoredTo`, `wholeSheet` auto-detect |
| Orientation | `rows-as-records`, `columns-as-records`, `cells-as-records` (crosstab) | — |
| Header strategy / axis | `headerAxis: "row" \| "column" \| "none"`; `headerStrategy.kind: "row" \| "column" \| "rowLabels"` | `composite` header strategy |
| Identity strategy | `column`, `composite`, `rowPosition` (warn) | `derived` |
| Skip predicates | `blank`, `cellMatches` (with optional `axis` for crosstab row/column targeting) | `allSameValue`, `marker`, `columnMatches` by header name |
| Transforms | none | none |
| Binding source locator | `byHeaderName`, `byColumnIndex` | `byHeaderMatch` |
| Drift tolerance knobs | `headerShiftRows`, `addedColumns`, `removedColumns` | `columnReorder`, `renamedHeaders` |

New v1 region fields (from this design):

- `targetEntityDefinitionId: string`
- `headerAxis: "row" | "column" | "none"` (explicit rather than implicit in header strategy; `"none"` enables headerless regions with auto-generated `columnOverrides`)
- `recordsAxisName?: { name, source: "user" | "ai" | "anchor-cell", confidence }` — required on pivoted and crosstab regions
- `secondaryRecordsAxisName?: { name, source, confidence }` — required on crosstab regions (column dimension)
- `cellValueName?: { name, source, confidence }` — required on crosstab regions (the field holding each cell's value)
- `axisAnchorCell?: { row, col }` — optional override for the cell whose value auto-populates axis names; defaults to the region's top-left corner; must be within bounds; only meaningful for pivoted and crosstab shapes
- `boundsMode: "absolute" | "untilEmpty" | "matchesPattern"` with companion `boundsPattern` and `untilEmptyTerminatorCount`
- `skipRules: SkipRule[]` — union of `{ kind: "blank" }` and `{ kind: "cellMatches", crossAxisIndex, pattern, axis? }`
- `columnOverrides?: Record<string, string>` — per-field user overrides when `headerAxis === "none"`

Note: `rowLabels` header strategy is promoted into v1 because it's now the default shape for pivoted regions, not a deferred edge case.

### Mode interactions

- **Mode A (snapshot upload)**: after upload, show a preview of the sheet with a grid overlay; user either (a) accepts a single auto-detected region, (b) edits bounds, or (c) draws multiple regions and binds each to an entity. Especially useful for the "multiple datasets on one sheet" case.
- **Mode B (connector sync, first connection)**: same preview UX; hints are captured into the first plan version. On subsequent syncs, bounds are locked by the stored plan; drift logic applies (e.g., a region that has grown past its bounds triggers a drift warning, not silent truncation).

### Drift implications

Hinted bounds create new drift cases:

- **Region grew past its bounds** — new rows/columns exist beyond the hinted range. Default: flag as drift, ask user; do not silently truncate.
- **Region shrank** — empty rows/columns inside the hinted range. Default: skip via existing `blank` skip rule, no drift event.
- **Records-axis values changed** — e.g., `JAN` replaced with `Q1`. Affects `source_id` derivation for pivoted records; treat as identity-changing drift per the existing contract.

### Tradeoffs

- **Pro**: smaller and sharper declarative surface; pivoted layouts become trivially supportable; multi-dataset sheets resolve without AI ambiguity; AI cost bounded to a small recommendation + column classification; offline-ish fallback viable (hints + deterministic parsing, no model call).
- **Con**: requires real UX work (region drawing, orientation picker, axis-name input); requires connector-level changes to support N entities per sheet; the auto-detect fallback still needs to exist for zero-input single-region uploads, so we're adding a preferred path, not replacing the harder one.

## Open questions

1. ~~**Plan schema surface — declarative vs opaque.**~~ **Resolved.** v1 surface as defined under "Updated v1 declarative surface" in Primary design section is signed off. Deferred variants remain deferred; interpreter must emit `blocker` warnings for unsupported shapes rather than half-support them.
2. ~~**Drift tolerance policy**~~ **Resolved.** Default: always halt and ask on any detected drift. Override is **per-region** — a region may opt into auto-apply for specific drift classes via its `drift` knobs. No per-connector global auto-apply.
3. **Identity derivation for pivoted regions** — when records are columns-as-records, the identity is typically the records-axis value (e.g., `JAN`); what happens when that value is renamed? Does it count as identity-changing drift always, or only when no alias mapping exists?
4. **Auto-detect fallback UX** — when the user declines to draw regions and the interpreter finds multiple candidates, auto-pick most confident or require user action? (The hinted path resolves the primary multi-region UX; this is only the fallback.)
5. **Cost/latency envelope** — what's the budget per interpret call? This bounds how much context (raw grid sample size, prior-plan excerpt) we can send. Now also includes the bounded `recommendRecordsAxisName` sub-call.
6. **Offline/deterministic mode** — do we need a "no AI" fallback for customers who can't send data to a model provider? The hinted-primary path makes this more viable; question is whether it's a supported product mode or an emergent capability.
7. **Sheet classification** — how do we decide which sheets are data vs lookup/junk without sending every sheet to the model? With hints-primary, the user implicitly classifies by drawing regions; question reduces to "what do we do with sheets the user didn't annotate."
8. **Confidence thresholds** — where do green/yellow/red bands sit, and which warning codes are `blocker` by default? Per-consumer override (e.g., stricter for Mode B first-time setup than Mode A)?
9. **Warning code taxonomy** — finalize the enum and `suggestedFix` wording guidelines so UI copy is consistent across Mode A and Mode B. Include `PIVOTED_REGION_MISSING_AXIS_NAME` as a blocker.
10. ~~**Multi-entity per sheet — connector-level impact.**~~ **Resolved.** A region represents either a whole entity or a **partial entity**. Regions that share the same `targetEntityDefinitionId` (the entity key) **merge into one entity** — their extracted records are unioned under that entity. AI field-mapping recommendation then runs **once per merged entity**, after all regions targeting it have been defined and configured, not once per region. Implications: one `ConnectorEntity` per distinct `targetEntityDefinitionId` (owning N regions); `FieldMapping` rows belong to the merged entity; the UI groups regions by target entity during setup and drift review.
11. ~~**Region-drawing UX**~~ **Resolved.** Primary UX is a **visual overlay on a rendered sheet preview**: the user sees the spreadsheet as a grid, click-drags (or click + shift-click) to draw a rectangular region, and the selection is captured as A1-notation bounds. Each drawn region gets an inline side-panel / popover to set `targetEntityDefinitionId`, `orientation`, `headerAxis`, and `recordsAxisName`. Existing regions are visibly highlighted on the grid (colored by target entity, so regions merging into the same entity share a color) and are resizable by dragging edges. A1-notation / numeric-offset inputs remain available as a power-user/accessibility fallback, but are not the primary path. Multi-sheet workbooks use a tab strip at the top of the preview.
12. **Hinted bounds drift policy** — when a hinted region grew past its bounds on a later sync: auto-expand within a tolerance, flag as drift and ask, or strictly respect user bounds and drop overflow with a warning? Should be a drift-knob decision, not a silent default.

## Suggested next steps

- All blocking open questions (1, 2, 10, 11) are resolved; proceed to spec.
- Prototype `interpret()` as a single structured-output call — plus the narrow `recommendRecordsAxisName` sub-call — against 5–10 real irregular spreadsheets (including at least two pivoted and two multi-region) to validate the stage decomposition.
- Draft `SPREADSHEET_PARSING.spec.md` once the plan schema stabilizes.
