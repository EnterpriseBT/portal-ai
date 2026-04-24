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
- **The plan is the single surface the user edits.** Initial setup, post-interpret review, and Mode B drift resolution are all expressed as edits to a `LayoutPlan`. Consumers present these via one region-editor UX seeded with different inputs (empty, interpreter-proposed, or prior + drift report), not separate UIs per mode or per drift class. If drift resolution needs a capability the editor can't express — for example, visualizing *why* an identity strategy changed — that's a plan-schema gap to close, not a separate surface to build.
- **The editor always operates on the workbook the plan will `replay()` against.** Any plan-editing session must render the current workbook from the source (the just-uploaded file in Mode A; a freshly fetched workbook in Mode B initial setup; the pinned workbook the halting replay ran against during drift resolution). Editing against a stale snapshot — e.g., the workbook as it existed when the plan was first drawn — is silently wrong: cell coordinates and header labels the user references may no longer match the data the next sync extracts. Consumers are responsible for supplying the fresh `Workbook` when they open the editor; the module treats it as an input, not something it refetches.

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
      bounds: { startRow, endRow, startCol, endCol }
      targetEntityDefinitionId: string
      headerAxes: AxisMember[]                  // 0, 1, or 2 of { "row", "column" }
      segmentsByAxis?: {                         // segments per declared header axis
        row?:    Segment[]                       // each Segment is field | pivot | skip
        column?: Segment[]
      }
      cellValueField?: { name, nameSource, columnDefinitionId? }  // present iff ≥1 pivot
      recordAxisTerminator?: Terminator          // grows-until stop; forbidden on crosstab
      recordsAxis?: "row" | "column"             // required iff headerAxes.length === 0
      headerStrategyByAxis?: { row?, column? }   // strategy per declared axis
      axisAnchorCell?: { row, col }              // override for axis-name anchor; default = top-left
      columnOverrides?: Record<string, string>   // field-name overrides for headerless regions
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

## Region → entity 1:1 mapping

Regions are the unit of interpretation. A region represents **exactly one entity**. The `targetEntityDefinitionId` is the entity key.

**Each target may appear on at most one region within a connector instance.** Duplicates are rejected at three layers:

- Parser — the interpreter emits `DUPLICATE_ENTITY_TARGET` (blocker severity) on the second region claiming a target. Commit is blocked upstream by the blocker-warnings gate.
- API — `POST /api/layout-plans/commit` (and the connector-instance-scoped variant) returns `400 LAYOUT_PLAN_DUPLICATE_ENTITY` if the submitted plan carries duplicate targets, before any DB writes.
- Editor — `validateRegions` in `apps/web/src/modules/RegionEditor/utils/region-editor-validation.util.ts` flags both offending regions, and the entity picker disables options already claimed by another region in the same upload.

Consequences:

- One sheet can still populate multiple entities (distinct target IDs across its regions).
- At the connector level, `ConnectorEntity` is 1:1 with `targetEntityDefinitionId` within a connector instance, and 1:1 with the region that produced it.
- `FieldMapping` rows belong to the one region/entity that owns them; there is no cross-region merge.
- `entity_records` writes resolve per region — region is both the extraction unit and the persistence unit.

Before this change the section documented a merge semantic where regions sharing a target key combined into one entity. That no longer applies — the rule and its rollout are documented in `docs/REGION_CONFIG.c1_one_region_per_entity.spec.md`.

## Entity key — org-wide uniqueness

**`ConnectorEntity.key` is unique per organization** (enforced by the partial index `UNIQUE(organization_id, key) WHERE deleted IS NULL` on `connector_entities`). Each connector still owns its own entities; the constraint is a **lookup-space guarantee** so that any `FieldMapping.refEntityKey` resolves to exactly one entity org-wide — no first-row-wins, no cross-connector ambiguity.

Collisions surface at three layers:

- Repository — `connectorEntitiesRepo.upsertByKey` pre-selects by `(organization_id, key)`; updates the existing row when the same connector owns it, and throws `ApiError(400, CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR, …)` when another connector in the same org already owns it.
- API — commit flows bubble that error through the route as a 400.
- Editor — the "+ Create new entity" dialog awaits an optional async `validateKey` (wired from the file-upload workflow container to `sdk.connectorEntities.search`) so the user sees the owning connector's name inline before the Create action fires; the entity picker renders DB-backed options as `<label> — <connectorInstanceName>` via `include=connectorInstance` on the list endpoint.

Soft-deleted keys free up for reuse because the index is partial on `deleted IS NULL`. Cross-org scoping is unchanged — different organizations can freely share keys. See `docs/REGION_CONFIG.c2_org_unique_entity_key.spec.md`.

## Region structure

A region is a rectangle over a sheet (its `bounds`), with three region-level
fields that together describe how cells inside that rectangle become
records: `headerAxes`, `segmentsByAxis`, and `cellValueField`. `orientation`
and `headerAxis` are not fields of the shipped model — they are derived
properties (see below) that the UI and replay compute on demand.

See `docs/REGION_CONFIG.segments.plan.md` for the full roadmap index and
sub-plan references; the remainder of this section summarizes what the
shipped schema enforces.

### Header axes

`headerAxes: AxisMember[]` lists the axes that carry header values (field
names or pivot axis labels). Its cardinality picks the region shape:

- **`[]` — headerless.** The rectangle is all data. `recordsAxis` names
  which direction records run (complement is the field-index axis), and
  `columnOverrides` supplies per-field names. Each position on the field
  axis maps to one field; each position on the record axis is a record.
- **`["row"]` — row-headed (classic tidy).** The top row carries headers;
  each row below is a record.
- **`["column"]` — column-headed.** The left column carries headers; each
  column to its right is a record.
- **`["row", "column"]` — crosstab.** Both bands carry labels and every
  interior cell is a record. The corner cell is the axis-name anchor.

Refinement 1 forbids duplicates; refinement 5 enforces `recordsAxis` iff
`headerAxes.length === 0`.

### Segments

`segmentsByAxis.row` / `.column` each hold an ordered list of `Segment`s
that covers the axis (sum of `positionCount` matches the span; a dynamic
tail is allowed to claim "≥ 1 additional"). `Segment` is a discriminated
union:

- **`field`** — positions are field names. Each position becomes one
  field on every record along the record axis.
- **`pivot`** — positions are *axis values* (e.g. quarters). Each
  position becomes one extracted record per record-axis position, and
  the pivot's `axisName` names the field that carries the label.
- **`skip`** — positions are ignored (e.g. a Totals column in the
  middle of a header row).

Segments compose: a single axis can mix `[field, pivot, skip]` so one
header row can carry static field names alongside a pivoted axis
alongside ignored columns. A segment is required on each declared
header axis (refinement 2); segment lengths sum to the axis span unless
the tail is a dynamic pivot (refinements 3, 10).

Pivot `id` values are unique across both axes (refinement 13). `dynamic`
is allowed only on the tail pivot of an axis, and at most one per axis
(refinement 10). `recordAxisTerminator` is forbidden on a crosstab
(refinement 11) because a crosstab's record axis is a complement of two
header axes, not a single growing edge.

### `cellValueField`

Required iff at least one pivot segment exists (refinement 7); forbidden
otherwise. It carries the field name that holds each cell's *value*
under a pivoted/crosstab emit (the `name` corresponds to what the user
types in the "Cell value name" input). `nameSource` is `"user"` /
`"ai"` / `"anchor-cell"` and carries provenance; the UI treats only
`"user"` as confirmed.

### Record generation (unified emit)

Replay walks every region once. For an entity-unit (a single record-axis
position on a 1D region, or a single `(row, col)` pair on a crosstab),
it collects statics from `field`-role segments, then runs a
Cartesian-product loop over the pivot segments present on declared
header axes. Each element of the product emits one record whose fields
are the statics plus `{ [pivot.axisName]: axisLabel, ...,
[cellValueField.name]: cellValue }`.

A tidy region (no pivots, one `field` segment) has a 1-element Cartesian
product and degenerates to "one record per record-axis position" —
identical to pre-segment emit for the same shape. A crosstab with pivot
segments on both axes has a 2-axis product: one record per `(row-label,
col-label)` pair, picking up the row-axis pivot's name + the column-axis
pivot's name + `cellValueField.name` on each record. Source-ids combine
the base identity-strategy result with `::segmentId::label` for each
pivot involved; plans with zero pivots keep the base source-id
unchanged, so tidy and segmented encodings round-trip.

### Derived properties

The shipped module exports three helpers so consumers don't re-derive
the shape inline:

- `isCrosstab(region)` — `headerAxes.length === 2`.
- `isPivoted(region)` — any pivot segment on either axis.
- `recordsAxisOf(region)` — the axis records run along: the complement
  of `headerAxes[0]` for 1D, `region.recordsAxis` for headerless, or
  `undefined` for crosstab (records are cells, not a single axis).

A "pivoted vs. tidy" display is a function of `isPivoted`; an
"orientation arrow" is a function of `headerAxes` and pivot presence —
neither carries state of its own. See
`packages/spreadsheet-parsing/src/plan/region.schema.ts` for the
authoritative schema + refinements.

## v1 declarative surface

Surface variants kept and deferred in v1. The interpreter must recognize deferred shapes and emit `blocker` warnings rather than half-supporting them.

| Group | v1 keeps | v1 defers |
|---|---|---|
| Locator | `cell`, `range`, `column`, `row` | `headerRelative`, `pattern` |
| Bounds | `absolute` (from hints), `untilBlank` terminator (with configurable `consecutiveBlanks`), `matchesPattern` terminator | `anchoredTo`, `wholeSheet` auto-detect |
| Region shape | derived from `headerAxes` cardinality + pivot presence (headerless / row-headed / column-headed / crosstab; tidy vs. pivoted) | — |
| Header strategy / axis | `headerAxes: ("row" \| "column")[]` with max two entries; `headerStrategyByAxis.row?` / `.column?` with `kind: "row" \| "column" \| "rowLabels"` | `composite` header strategy |
| Identity strategy | `column`, `composite`, `rowPosition` (warn) | `derived` |
| Skip predicates | `blank`, `cellMatches` (row or column target) | `allSameValue`, `marker`, `columnMatches` by header name |
| Transforms | none (belong in `ColumnDefinition`) | none |
| Binding source locator | `byHeaderName`, `byPositionIndex` (fallback) | `byHeaderMatch` |
| Drift tolerance knobs | `headerShiftRows`, `addedColumns`, `removedColumns` | `columnReorder`, `renamedHeaders` |

Region fields from the primary (hinted-region) design:

- `targetEntityDefinitionId: string`.
- `headerAxes: AxisMember[]` (0, 1, or 2 entries) — explicit rather than
  implicit in header strategy; an empty list enables headerless regions
  with auto-generated `columnOverrides`.
- `segmentsByAxis?: { row?: Segment[], column?: Segment[] }` — required
  on each declared header axis; each segment is `field` / `pivot` /
  `skip` with a `positionCount`. Pivot segments carry their own
  `axisName` + `axisNameSource` for the label field each pivot
  introduces.
- `cellValueField?: { name, nameSource, columnDefinitionId? }` —
  required iff ≥ 1 pivot segment exists; forbidden otherwise.
- `recordAxisTerminator?: Terminator` — optional "grows until" rule
  along the record axis of a 1D or headerless region; forbidden on
  crosstab (refinement 11). `Terminator` is one of
  `{ kind: "untilBlank", consecutiveBlanks }` or
  `{ kind: "matchesPattern", pattern }`.
- `recordsAxis?: AxisMember` — required iff `headerAxes.length === 0`.
- `axisAnchorCell?: { row, col }` — optional override for the cell whose
  value seeds an unassigned pivot `axisName`; defaults to the region's
  top-left corner; must be within bounds; only meaningful for pivoted
  and crosstab shapes.
- `skipRules: SkipRule[]` — union of `{ kind: "blank" }` and
  `{ kind: "cellMatches", crossAxisIndex, pattern, axis? }`.
- `columnOverrides?: Record<string, string>` — per-field user overrides
  for headerless regions.

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

- `code` — enum (examples: `AMBIGUOUS_HEADER`, `MIXED_COLUMN_TYPES`, `DUPLICATE_IDENTITY_VALUES`, `IDENTITY_COLUMN_HAS_BLANKS`, `UNRECOGNIZED_COLUMN`, `REGION_BOUNDS_UNCERTAIN`, `MULTIPLE_HEADER_CANDIDATES`, `SHEET_MAY_BE_NON_DATA`, `SEGMENT_MISSING_AXIS_NAME`).
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
   - `detectSegments` — partition each declared header axis into `field` / `pivot` / `skip` segments. Runs once per declared axis and emits the segments that the rest of the pipeline threads through.
   - `classifyFieldSegments` — resolve field-segment positions to `ColumnDefinition`s. AI owns naming semantics; heuristic owns pure value-pattern fallbacks.
   - `recommendSegmentAxisNames` — (only for pivot segments whose `axisName` the user hasn't supplied) propose an axis label by inspecting the label cells.
   - `detectIdentity` — choose or derive a `source_id` rule per region.
   - `proposeBindings` — final plan assembly with confidence scores.
   - `reconcileWithPrior` — (only when a prior plan exists) diff against prior, mark preserved vs changed bindings, flag identity changes.
   - `scoreAndWarn` — consolidate per-stage signals into the plan's `confidence` fields and emit structured warnings with `suggestedFix`.
3. **Make each stage individually testable** with fixture grids and fixture state, so migrating to a graph is a refactor, not a rewrite.
4. **Checkpoint intermediate artifacts** — region detections, header candidates, classification scores — on the plan itself (or on a sibling `InterpretationTrace`).
5. **No nondeterminism leakage**. The plan must be a pure function of (grid, prior plan, user confirmations). Model call nondeterminism is absorbed at interpretation time; replay is deterministic.

Migration consequence: replacing `interpret()`'s body with a LangGraph `StateGraph` requires no changes to the connector, sync pipeline, UI, or storage.

## Consumer plug-in pattern

Per-consumer responsibilities:

- **Workbook adapter** — converts the native representation into the module's `Workbook` type. The only provider-specific code.
- **Plan storage** — each connector persists the `LayoutPlan` where appropriate (likely a generic `connector_instance_layout_plans` table keyed by connector instance; a cloud connector may also cache against the remote file's `etag`/`revisionId`).
- **Workflow UI** — a single region editor takes a `LayoutPlan` and emits edits. It is a shared building block, not a workflow of its own, and is embedded by every consumer workflow that needs to define or revise a plan:
  - `FileUploadConnector` workflow (Mode A) — initial region drawing + review after upload.
  - Cloud-spreadsheet connector workflows (Mode B, e.g. Google Sheets, Excel Online) — initial region drawing + review on first connection.
  - The same cloud-spreadsheet workflows on **resync drift** — editor re-entered from a drift halt, seeded with prior plan + drift report (see `SPREADSHEET_PARSING.frontend.spec.md` §Mode B drift halt).

  Consumers seed the editor with the appropriate inputs (empty hints, interpreter-proposed plan, or prior plan + drift report) and route users into it from different entry points, but do not fork the UI per mode, per connector, or per drift class. The editor does not know which connector it serves.
- **Sync driver** — on `canSync`, fetches the latest workbook, calls `replay(plan, workbook)`, writes `entity_records`, and on drift decides whether to call `interpret()` and surface confirmation.
- **Field mappings** — `columnBindings` in the plan resolve to the same `FieldMapping` rows used elsewhere. The plan is a *source of* field mappings, not a replacement for them. Shared, not per-connector.

Cross-cutting (not per-connector): the `entity_records` write path, `FieldMapping` schema, `ColumnDefinition` resolution. None of these change.

## Open questions

These are not blockers for the spec but should be tracked through implementation.

1. **Identity derivation for pivoted regions.** When records are columns-as-records, identity is typically the records-axis value (e.g., `JAN`). What happens when that value is renamed? Always identity-changing drift, or only when no alias mapping exists?
2. **Cost/latency envelope.** Per-interpret budget bounds how much context (raw grid sample size, prior-plan excerpt) can be sent. Includes the bounded `recommendSegmentAxisNames` sub-call.
3. **Offline/deterministic mode.** Do we support a "no AI" product mode for customers who can't send data to a model provider? The hinted-primary path makes this viable; question is whether it's advertised or emergent.
4. **Sheet classification.** With hints-primary, the user implicitly classifies sheets by drawing regions. What do we do with sheets the user didn't annotate?
5. **Confidence thresholds.** Where do green/yellow/red bands sit, and which warning codes are `blocker` by default? Per-consumer override (e.g., stricter for Mode B first-time setup than Mode A)?
6. **Warning code taxonomy.** Finalize the enum and `suggestedFix` wording guidelines so UI copy is consistent across Mode A and Mode B.
7. **Hinted bounds drift policy.** When a hinted region grew past its bounds: auto-expand within tolerance, flag as drift and ask, or strictly respect user bounds and drop overflow with a warning?
