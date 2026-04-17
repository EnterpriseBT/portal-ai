# Spreadsheet Parsing — Architecture Spec

Shared conceptual model and contracts for the spreadsheet-parsing module. Backend and frontend specs reference this document for type shapes, boundaries, and policy.

Companion docs:

- `SPREADSHEET_PARSING.backend.spec.md` — core module implementation, persistence, sync integration
- `SPREADSHEET_PARSING.frontend.spec.md` — region-drawing UX, review and drift flows

## Summary

Spreadsheet sources (uploaded CSV/XLSX, Google Sheets, Microsoft Excel Online) often do not conform to a simple "one header row, rectangular data" layout. The spreadsheet-parsing module interprets irregular sheets into a declarative `LayoutPlan`, then deterministically replays that plan on subsequent syncs to produce records — invoking the AI interpreter again only when the source drifts beyond tolerance.

The module is a **library**, not a service. It is connector-agnostic: `FileUploadConnector` is the first consumer; Google Sheets and Microsoft (Excel Online / OneDrive) connectors follow the same pattern.

## Scope

In scope:

- A provider-agnostic `Workbook` abstraction and two pure functions (`interpret`, `replay`).
- A `LayoutPlan` schema describing how to extract records from a workbook.
- User-drawn region hints as the primary input to interpretation.
- Confidence scoring and structured warnings surfaced on the plan.
- Drift detection on replay; halt-and-ask policy with per-region auto-apply overrides.
- AI stage decomposition designed to migrate to LangGraph (or similar) without changing consumers.

## Non-goals

- Not a query-through / live connector. Output is always materialized into `entity_records` via sync cadence.
- Not a general-purpose data-cleaning tool. The module interprets structure; value coercion stays in `ColumnDefinition`.
- Not a replacement for the simple-layout path. The existing `FileUploadConnector` simple path remains the fast lane for well-formed files.
- Not coupled to any specific connector. The module opens no files, hits no APIs, and knows nothing about auth, connector instances, or upload workflows.

## Module boundary

The module exposes three surfaces:

1. A **`Workbook` input abstraction** — a provider-agnostic view of sheets and cells. Callers adapt their source into this shape.
2. A pure **`interpret(input): Promise<LayoutPlan>`** function. Consumes a `Workbook` plus optional prior plan, drift report, region hints, and user hints. Returns a plan.
3. A pure **`replay(plan, workbook): ReplayResult`** function. Produces extracted records and a drift report. No I/O, no persistence, no nondeterminism.

Everything stateful — persisting plans, running syncs, writing `entity_records`, triggering re-interpretation, displaying UI — is the **consumer's** responsibility.

### Consumer responsibilities

- Adapter from its native format to `Workbook`.
- Storage for the plan it owns (schema and ownership may differ per connector; may be absent for Mode A snapshot consumers).
- Decision about when to re-fetch, when to replay, when to replan.
- Mapping from `ReplayResult` records into `entity_records` writes.
- UX for showing interpretation results and collecting user confirmation on identity-changing drift.

## Usage modes

Both modes share the same three surfaces (`Workbook`, `interpret`, `replay`). The mode is a property of *how the consumer uses the outputs*, not of how the module computes them.

### Mode A — Snapshot upload (one-shot)

Used by file-upload connectors where a user hands over a file once and the extracted records are a static import.

- Flow: `interpret(workbook) → LayoutPlan → replay(plan, workbook) → records → entity_records`.
- Every upload is treated as a new upload. A fresh plan is produced each time; there is no prior plan, no reconcile step, and no attempt to reuse a previous interpretation.
- The plan drives extraction and is the object the UI uses for review/edits before commit. Consumers may optionally archive it for audit; the module makes no assumption.
- No drift handling, no `reconcileWithPrior`, no scheduled sync.

### Mode B — Connector-backed sync (repeating)

Used by Google Sheets, Microsoft Excel Online, and any future connector where the source is a live document that changes.

- First sync: `interpret(workbook) → LayoutPlan → persist plan → replay → entity_records`.
- Subsequent syncs: `fetch workbook → replay(priorPlan, workbook) → drift report`.
  - Drift within tolerance → records commit, plan unchanged.
  - Drift outside tolerance → `interpret(workbook, priorPlan, driftReport) → new plan version` → user confirmation if identity-affecting → commit new plan + records.
- The plan is durable, keyed to the connector instance (and optionally to a remote revision identifier like Sheets `revisionId` or Graph `eTag`).
- Re-interpretation is rare by design: replay is the hot path; interpret is the cold path.

### Mode-agnostic guarantees

- `interpret()` must work with or without a prior plan (Mode A never passes one; Mode B omits it only on first sync).
- `replay()` must return a drift report even when the consumer intends to ignore it (Mode A), so both modes share the same code path.
- The plan schema must not assume persistence or a connector instance; it is a pure value.

## The Layout Plan

The output of interpretation is a versioned, declarative `LayoutPlan`. It describes, in workbook-relative terms, how to extract records from a workbook. It references sheets and cells by name/coordinate addressable through the `Workbook` abstraction, so the same plan works whether the workbook came from an uploaded XLSX, a Google Sheet, or a Microsoft Excel Online file.

In Mode B the plan is durable and replay is the hot path. In Mode A a fresh plan is produced on every upload — it drives extraction and is the object the user edits in the UI before commit, but is not reused across uploads. The module treats the plan as a pure value in both cases.

Conceptual shape (concrete Zod types in backend spec):

```
LayoutPlan v1
  planVersion: semver
  workbookFingerprint: { sheetNames, dimensions, anchorCells }
  regions: [
    {
      id: stable region id
      sheet: string
      bounds: { startRow, endRow | dynamic, startCol, endCol }
      targetEntityDefinitionId: string
      orientation: "rows-as-records" | "columns-as-records"
      headerAxis: "row" | "column"
      recordsAxisName?: { name, source: "user" | "ai", confidence }
      headerStrategy: { kind, locator, confidence }
      identityStrategy: { kind, spec, confidence }
      columnBindings: [ { sourceLocator, columnDefinitionId, confidence, rationale? } ]
      skipRules: [ ... ]
      confidence: { region, aggregate }
      warnings: [ { code, severity, locator, message, suggestedFix? } ]
      drift: { tolerances, replanTriggers }
    }
    ...
  ]
  confidence: { overall, perRegion }
```

Two operations consume the plan:

1. **Replay** — deterministic. Given a workbook and a plan, extract records. No LLM call.
2. **Replan** — invoked only when replay detects drift beyond tolerance. Produces a new plan version; changes that affect `source_id` derivation require user confirmation before the sync commits.

## Region → entity merge model

Regions are the unit of interpretation. A region represents **either a whole entity or a partial entity**. The `targetEntityDefinitionId` is the entity key.

**Regions that share the same entity key merge into one entity.** Their extracted records are unioned under that entity. Consequences:

- One sheet can populate multiple entities (distinct target IDs).
- One entity can be assembled from multiple regions (same target ID, possibly across sheets).
- AI field-mapping / column classification runs **once per merged entity** — after all regions targeting it have been defined and configured — not once per region. This keeps the mapping coherent across contributing regions.
- At the connector level, `ConnectorEntity` is 1:1 with `targetEntityDefinitionId` within a connector instance; it owns N regions.
- `FieldMapping` rows belong to the merged entity, not to individual regions.
- `entity_records` writes resolve per merged entity; regions are the extraction unit, not the persistence unit.

This breaks the prior `FileUploadConnector` convention of "one entity per sheet / one entity per file." The parser emits regions with `targetEntityDefinitionId`; the connector groups-and-merges by that key when materializing.

## Pivoted regions

A region is *pivoted* when records run across one axis while field names run along the other. For pivoted regions:

- `orientation` declares which axis carries records (`columns-as-records` or `rows-as-records`).
- `headerAxis` declares which axis carries field names.
- `recordsAxisName` is **required** — it is a user-facing name for the records dimension (e.g., `Month`, `Year`, `Region`). Each extracted record gets a field named `recordsAxisName.name` whose value is the axis label.
- If the user does not supply a name, the interpreter may propose one via an `recommendRecordsAxisName` AI sub-call that inspects the records-axis labels. The plan marks `recordsAxisName.source` as `"user"` or `"ai"` so the UI can flag AI suggestions for confirmation.
- If no name can be proposed with high confidence and the user hasn't supplied one, the plan emits a `PIVOTED_REGION_MISSING_AXIS_NAME` blocker.

## v1 declarative surface

Surface variants kept and deferred in v1. The interpreter must recognize deferred shapes and emit `blocker` warnings rather than half-supporting them.

| Group | v1 keeps | v1 defers |
|---|---|---|
| Locator | `cell`, `range`, `column`, `row` | `headerRelative`, `pattern` |
| Bounds | `absolute` (from hints), `wholeSheet` (auto-detect fallback) | `anchoredTo`, `untilBlank`, `untilPattern` |
| Orientation | `rows-as-records`, `columns-as-records` | — |
| Header strategy | `row`, `column`, `rowLabels` | `composite`, `none` |
| Identity strategy | `column`, `composite`, `rowPosition` (warn) | `derived` |
| Skip predicates | `blank`, `columnMatches` | `allSameValue`, `cellMatches`, `marker` |
| Transforms | none (belong in `ColumnDefinition`) | none |
| Binding source locator | `byHeaderName`, `byColumnIndex` (fallback) | `byHeaderMatch` |
| Drift tolerance knobs | `headerShiftRows`, `addedColumns`, `removedColumns` | `columnReorder`, `renamedHeaders` |

New v1 region fields from the primary (hinted-region) design:

- `targetEntityDefinitionId: string`
- `headerAxis: "row" | "column"` (explicit rather than implicit in header strategy)
- `recordsAxisName?: { name, source: "user" | "ai", confidence }`

Transforms are deliberately omitted: value coercion is `ColumnDefinition`'s job. The plan describes *structure only*.

Drift-tolerance knobs are **per-region overridable** from the start to avoid schema churn later.

## Records-centric sync contract

Each region's `identityStrategy` yields a stable `source_id` per extracted record. The sync pipeline treats a `LayoutPlan` the same way it treats a CSV header mapping today: input is rows, output is `entity_records` with `source_id`, `checksum`, `origin: "sync"`. The plan is stored alongside the connector instance; sync history links to the plan version used.

**Drift policy (default): halt and ask on any detected drift.** Per-region drift knobs can opt a region into auto-apply for specific drift classes (e.g., added non-identity columns, header shifts within N rows). There is no per-connector global auto-apply. Drift that would change `source_id` derivation is never eligible for auto-apply and always halts the sync for user review.

## Confidence scoring

Interpretation must emit confidence scores and actionable warnings alongside the plan, so the user can decide — **before committing** — whether to fix their source file and re-run, or accept the plan as-is.

### Granularities

- **Per `columnBinding`** — how sure is the interpreter this source column maps to this `ColumnDefinition`?
- **Per `headerStrategy`** — was the header row unambiguously located?
- **Per `identityStrategy`** — is the chosen `source_id` actually unique and stable?
- **Per region** — aggregate + bounds confidence.
- **Overall** — rolled up for the plan. Used for coarse gating only; the UI must never show *only* this number.

Each score is a number in `[0, 1]`. Scores are meaningful only in relative and threshold terms. Threshold bands (green / yellow / red) are fixed at the module level so UI and gating stay consistent; exact cutoffs are specified in the backend/frontend specs.

### Warnings are first-class

Every low-confidence score must be accompanied by a structured `warning`:

- `code` — enum (examples: `AMBIGUOUS_HEADER`, `MIXED_COLUMN_TYPES`, `DUPLICATE_IDENTITY_VALUES`, `IDENTITY_COLUMN_HAS_BLANKS`, `UNRECOGNIZED_COLUMN`, `REGION_BOUNDS_UNCERTAIN`, `MULTIPLE_HEADER_CANDIDATES`, `SHEET_MAY_BE_NON_DATA`, `PIVOTED_REGION_MISSING_AXIS_NAME`).
- `severity` — `info | warn | blocker`. Blockers prevent commit.
- `locator` — the specific sheet/cell/region the warning points to.
- `message` — short, user-facing.
- `suggestedFix` — optional; e.g., "Remove the title row in A1:F1." This is the feature that lets the user go update their sheet and re-run.

The interpreter must produce warnings even when overall confidence is high, if it detects fixable issues.

### Module emits, consumer decides

The module emits scores and warnings; it does not decide workflow. Gating (what severity blocks commit, how scores are presented, whether to auto-retry after the user fixes and re-uploads) is the consumer's job. This keeps the module uniform across Mode A and Mode B.

### Calibration

Scores are heuristic + LLM-emitted. We do not claim probabilistic calibration.

- Fixture-based regression: a set of known-irregular spreadsheets with hand-annotated expected scores, used to detect regressions when prompts change.
- No silent score changes: if interpreter internals shift typical score ranges, `planVersion` bumps and thresholds are reviewed.

## AI boundary — designed for LangGraph migration

The AI layer has **one job**: given a raw grid (plus optional prior plan, drift report, region hints), produce a `LayoutPlan`. Everything else is deterministic.

The v1 implementation — even if it is a single structured-output LLM call — must:

1. **Expose one typed interface**: `interpret(input: InterpretInput): Promise<LayoutPlan>`. Callers never depend on interior organization.
2. **Model the interior as named stages with a shared state object**, even when they execute in one call. Stages:
   - `detectRegions` — (auto-detect fallback only) find rectangular data regions. Skipped when `regionHints` are supplied.
   - `detectHeaders` — locate header rows/columns per region.
   - `detectIdentity` — choose or derive a `source_id` column per region.
   - `classifyColumns` — semantic match from source columns → `ColumnDefinition`s. AI owns naming semantics; heuristic owns pure value-pattern fallbacks.
   - `proposeBindings` — final plan assembly with confidence scores.
   - `reconcileWithPrior` — (only when a prior plan exists) diff against prior, mark preserved vs changed bindings, flag identity changes.
   - `recommendRecordsAxisName` — (only for pivoted regions without a user-supplied name) propose a records-axis label.
   - `scoreAndWarn` — consolidate per-stage signals into the plan's `confidence` fields and emit structured warnings with `suggestedFix`.
3. **Make each stage individually testable** with fixture grids and fixture state, so migrating to a graph is a refactor, not a rewrite.
4. **Checkpoint intermediate artifacts** — region detections, header candidates, classification scores — on the plan itself (or on a sibling `InterpretationTrace`).
5. **No nondeterminism leakage**. The plan must be a pure function of (grid, prior plan, user confirmations). Model call nondeterminism is absorbed at interpretation time; replay is deterministic.

Migration consequence: replacing `interpret()`'s body with a LangGraph `StateGraph` requires no changes to the connector, sync pipeline, UI, or storage.

## Consumer plug-in pattern

Per-consumer responsibilities:

- **Workbook adapter** — converts the native representation into the module's `Workbook` type. The only provider-specific code.
- **Plan storage** — each connector persists the `LayoutPlan` where appropriate (likely a generic `connector_instance_layout_plans` table keyed by connector instance; a cloud connector may also cache against the remote file's `etag`/`revisionId`).
- **Workflow UI** — presents interpretation results and collects confirmation. A shared generic component takes a `LayoutPlan` and emits edits; it does not know which connector it serves.
- **Sync driver** — on `canSync`, fetches the latest workbook, calls `replay(plan, workbook)`, writes `entity_records`, and on drift decides whether to call `interpret()` and surface confirmation.
- **Field mappings** — `columnBindings` in the plan resolve to the same `FieldMapping` rows used elsewhere. The plan is a *source of* field mappings, not a replacement for them. Shared, not per-connector.

Cross-cutting (not per-connector): the `entity_records` write path, `FieldMapping` schema, `ColumnDefinition` resolution. None of these change.

## Open questions

These are not blockers for the spec but should be tracked through implementation.

1. **Identity derivation for pivoted regions.** When records are columns-as-records, identity is typically the records-axis value (e.g., `JAN`). What happens when that value is renamed? Always identity-changing drift, or only when no alias mapping exists?
2. **Cost/latency envelope.** Per-interpret budget bounds how much context (raw grid sample size, prior-plan excerpt) can be sent. Includes the bounded `recommendRecordsAxisName` sub-call.
3. **Offline/deterministic mode.** Do we support a "no AI" product mode for customers who can't send data to a model provider? The hinted-primary path makes this viable; question is whether it's advertised or emergent.
4. **Sheet classification.** With hints-primary, the user implicitly classifies sheets by drawing regions. What do we do with sheets the user didn't annotate?
5. **Confidence thresholds.** Where do green/yellow/red bands sit, and which warning codes are `blocker` by default? Per-consumer override (e.g., stricter for Mode B first-time setup than Mode A)?
6. **Warning code taxonomy.** Finalize the enum and `suggestedFix` wording guidelines so UI copy is consistent across Mode A and Mode B.
7. **Hinted bounds drift policy.** When a hinted region grew past its bounds: auto-expand within tolerance, flag as drift and ask, or strictly respect user bounds and drop overflow with a warning?
