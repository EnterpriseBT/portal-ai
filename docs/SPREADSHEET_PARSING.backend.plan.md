# Spreadsheet Parsing — Backend Implementation Plan

Step-by-step, TDD-driven plan to build the `@portalai/spreadsheet-parsing` module and wire it into `FileUploadConnector`'s sync path per **`SPREADSHEET_PARSING.backend.spec.md`**. Contracts land once in the new module and are re-exported through `@portalai/core/contracts` so API and web share a single source of truth.

## Scope

- New package `packages/spreadsheet-parsing/` — `Workbook` abstraction, `LayoutPlan` Zod schemas, `interpret()`, `replay()`, warning codes.
- Core re-exports so web and api stop hand-rolling parallel parser types.
- New API surface: `POST /api/connector-instances/:id/layout-plan/interpret`, `POST /api/connector-instances/:id/layout-plan/:planId/commit`, `GET /api/connector-instances/:id/layout-plan`.
- New DB table `connector_instance_layout_plans` + `layout_plan_id` FK on sync history.
- Sync integration: plan-driven commit path materializes one `ConnectorEntity` per `targetEntityDefinitionId`, merges `FieldMapping` rows, writes `entity_records`.
- Swagger JSDoc for every new endpoint; existing upload-endpoint docs unchanged (legacy path coexists).

## Non-goals

- Frontend wiring (see `SPREADSHEET_PARSING.frontend.plan.md`).
- Mode B connectors (Google Sheets, Excel Online). The module must remain provider-agnostic but no new connector is shipped in this plan.
- Deleting the legacy `/api/uploads/*` flow. It keeps serving "simple-layout" uploads until every consumer moves. Deprecation is a follow-up.
- LangGraph migration. The v1 single-LLM-call interior is designed to accept a graph later with no consumer changes.

## Source of truth

- `docs/SPREADSHEET_PARSING.architecture.spec.md` — domain model, module boundary, confidence framework.
- `docs/SPREADSHEET_PARSING.backend.spec.md` — concrete types, algorithms, schema changes. Authoritative for this plan.
- `docs/SPREADSHEET_PARSING.frontend.spec.md` — UX surface that consumes these endpoints.
- `CLAUDE.md` §Database Schema Workflow, §API Style Guide, §Include / Join Convention.

## Duplication audit — what the parser module will own

The existing `FileUploadConnector` stack hand-rolls several concepts that the parser module must become the canonical owner of. Each row in the table below must be consolidated before the plan is "done"; the phase column names where the consolidation lands.

| Concept | Current owner | Target owner | Action | Landing phase |
|---|---|---|---|---|
| `Workbook` / `Sheet` / `WorkbookCell` shape | Ad-hoc inside `csv-parser.util.ts` + `xlsx-parser.util.ts` (per-file `FileParseResult`, lossy — only headers + sample rows) | `@portalai/spreadsheet-parsing/workbook` | Define canonical `Workbook` interface + Zod schema; rewrite adapters to produce it; `FileParseResult` keeps living under `core/models/job.model.ts` as a legacy summary for the simple-layout path only | 1 |
| Header detection heuristic (`first non-empty row, all non-numeric`) | `apps/api/src/utils/csv-parser.util.ts` lines 45–49 | `packages/spreadsheet-parsing/src/interpret/stages/detect-headers.ts` | Move the heuristic into the stage; call it as the LLM-free fallback when hints cover `headerAxis` | 3 |
| CSV delimiter sniff + XLSX cell coercion (date/bool/richtext) | `csv-parser.util.ts`, `xlsx-parser.util.ts` | Stay in `apps/api` as **adapters** (they consume provider bytes) | Refactor to return `Workbook` rather than `FileParseResult`; adapter signatures export from `apps/api/src/services/workbook-adapters/*` | 1 |
| `RegionDraft`, `SkipRule`, `ColumnBindingDraft`, `RecordsAxisName`, `HeaderAxis`, `Orientation`, `BoundsMode`, `HeaderStrategyKind`, `IdentityStrategyKind` (TypeScript types) | `apps/web/src/modules/RegionEditor/utils/region-editor.types.ts` | `@portalai/core/contracts` (re-exported from the parser module's Zod schemas) | Delete the hand-rolled types, derive `RegionDraft` as `RegionSchema.deepPartial().extend({ id, sheetId })` in the editor's util file; no behavioural change | 2 |
| Column recommendation schemas (`FileUploadColumnRecommendationSchema`, `FileUploadRecommendationEntitySchema`, `FileUploadRecommendationSchema`) | `packages/core/src/models/job.model.ts` | Unchanged — they drive the legacy path | Flag as legacy in the file header; the new path produces `LayoutPlan` instead, not recommendations | 0 |
| AI column-name → `ColumnDefinition` matching | `apps/api/src/services/file-analysis.service.ts` (Anthropic via Vercel AI SDK) | Split by layer: parser module owns the *prompt template + response Zod schema + sampling helper* (pure content); api service owns the *model call + logging + key handling* and wires both into the parser via the `ClassifierFn` / `AxisNameRecommenderFn` DI slots | `file-analysis.service` becomes a thin adapter that builds deps via `createInterpretDeps()` and calls `interpret(input, deps)` — parser stays a pure library with zero SDK deps | 4 |
| `ConnectorEntity` / `FieldMapping` materialization (1 entity per sheet) | `apps/api/src/services/uploads.service.ts` lines 263–342 | Unchanged table schemas; new **service** `LayoutPlanCommitService` owns the plan-driven write (1 entity per `targetEntityDefinitionId`, merged mappings) | New service calls shared helpers in `uploads.service.ts` for the actual upsert; no copy-paste | 9 |
| `entity_records` write path (checksum, normalize, upsert batching) | `apps/api/src/services/record-import.util.ts` | Unchanged — pure reuse | The new commit service calls this directly, feeding it `ExtractedRecord[]` → row objects | 9 |

Rules for the duplication pass:

- **No backwards-compat aliases.** When a frontend type is superseded, delete it in the same PR that lands its replacement. Per the `no_compat_aliases` memory, we do not keep `export type RegionDraft = ...` re-exports pointing at the old shape.
- **Legacy path stays.** `/api/uploads/*` and `FileParseResult` are not deprecated by this plan; they serve the simple-layout fast path. Only the *frontend* `RegionDraft` et al. are superseded, because the region-editor is the new surface for anything plan-shaped.
- **One source of truth per concept.** If a concept exists both in the parser module and in `core`, `core` always re-exports from the parser module — never the reverse, and never both maintained independently.

## Export convention: three subpaths by environment

The parser package ships three subpath exports in `packages/spreadsheet-parsing/package.json` and every new file under `src/` must land in exactly one of them. See [`packages/spreadsheet-parsing/README.md`](../packages/spreadsheet-parsing/README.md) for the full write-up; the decision rules each phase must respect are:

| Subpath | Runs in | Source prefix | Use for |
|---|---|---|---|
| `@portalai/spreadsheet-parsing` | Node **and** browser | `src/` (excluding `src/replay/` and `src/ui/`) | Zod schemas, types, pure JS helpers, `interpret()`, `LlmBridge`, workbook accessors. No Node builtins, no DOM APIs. |
| `@portalai/spreadsheet-parsing/replay` | Node only | `src/replay/` | `replay()`, checksum, record extractors. May use `node:crypto`. Never re-exported via `@portalai/core/contracts`. |
| `@portalai/spreadsheet-parsing/ui` | Browser only | `src/ui/` | Reserved for browser-only helpers (DOM, React hooks, Web Crypto). Empty today. Must not import from `/replay`. |

Cross-subpath isolation is enforced by the `forbidden-deps.test.ts` audit:

- External deps beyond `zod` blocked everywhere.
- `node:*` imports allowed only under `src/replay/`.
- Main entry files must not import from `/replay` or `/ui`.
- `/ui` files must not import from `/replay`.

A regression fails the audit before it reaches the bundler. When a phase introduces a new file under `src/`, the author picks the subpath using the decision flow in the README; if unclear, start in the main entry and split out later.

## TDD rhythm

Every phase follows red → green → refactor → swagger (when endpoints change):

1. **Red** — failing Jest tests. Unit tests against pure functions (stages, `replay`, schema validation); integration tests (`__integration__/`) for routes + DB, hitting a real Postgres per the `use_npm_test_scripts` memory.
2. **Green** — smallest implementation that turns the tests green. No speculative surface.
3. **Refactor** — tighten types, extract helpers, delete duplicated code the phase replaces. Re-run the suite.
4. **Swagger** — if the phase touches a route, update JSDoc `@openapi` blocks, re-generate the in-memory spec, and verify `GET /api/docs/spec` matches the Zod contracts via a round-trip test.

Commands after each phase (per the `use_npm_test_scripts` memory — never invoke jest or tsc directly):

```bash
npm run type-check
npm --workspace packages/spreadsheet-parsing run test:unit
npm --workspace apps/api run test:unit
npm --workspace apps/api run test:integration -- --testPathPattern="<phase-relevant-pattern>"
```

The integration suite already mocks S3/BullMQ/Auth0 at the module level and hits real Postgres; the new suites follow that pattern.

---

## Phase 0 — Package scaffolding & core re-export contract

**Goal**: `@portalai/spreadsheet-parsing` exists as a Turborepo workspace with an empty public surface and a passing test. `@portalai/core/contracts` has an empty `spreadsheet-parsing.contract.ts` that re-exports from it. No runtime behaviour yet.

### 0.1 Red — workspace contract test

`packages/spreadsheet-parsing/src/__tests__/package.test.ts`:

- `import * as pkg from "@portalai/spreadsheet-parsing"` succeeds.
- `pkg.PLAN_VERSION === "1.0.0"`.
- Main-entry re-exports include `LayoutPlanSchema`, `RegionSchema`, `WorkbookSchema`, `interpret`, `WarningCode` (initially as placeholders that throw `not-implemented` — tests for behaviour come in later phases).
- `replay` is **not** re-exported from the main entry; it lives at `@portalai/spreadsheet-parsing/replay` (Node-only subpath — see the export convention above).
- `@portalai/spreadsheet-parsing/ui` resolves as a module (browser-only landing zone; empty in Phase 0 and intentionally so).

`packages/core/src/contracts/__tests__/spreadsheet-parsing.contract.test.ts`:

- `import { LayoutPlanSchema } from "@portalai/core/contracts"` resolves to the parser module's symbol (identity check via `===` against a direct import).
- `replay` is **absent** from `@portalai/core/contracts` (keeps the contracts barrel browser-safe).

### 0.2 Green — scaffold the package

1. Create `packages/spreadsheet-parsing/package.json`:
   - `name: "@portalai/spreadsheet-parsing"`, `private: true`, `type: "module"`.
   - Scripts: `build`, `dev`, `test:unit`, `lint`, `type-check` mirroring `@portalai/core`'s scripts.
   - Dependencies: `zod` only. The parser module is a pure leaf library — no `ai` / `@ai-sdk/*` / provider SDK dep, no network I/O, no logger. LLM calls happen in `apps/api/` behind the parser's `ClassifierFn` / `AxisNameRecommenderFn` DI slots (Phase 4).
   - Peer dep: none.
   - `exports` map with three subpaths: `.` (main, cross-compatible), `./replay` (Node-only), `./ui` (browser-only). Each subpath points at its own `dist/<subpath>/index.{js,d.ts}`.
2. `packages/spreadsheet-parsing/tsconfig.json` extends the monorepo base, emits to `dist/`.
3. `packages/spreadsheet-parsing/jest.config.js` mirrors `@portalai/core`'s.
4. `src/index.ts` — placeholder main-entry exports (symbols that throw on first use are fine); `src/replay/index.ts` + `src/ui/index.ts` start as empty placeholders populated in later phases.
5. Add the package to the root `package.json` workspaces + `turbo.json` task graph.
6. `packages/core/src/contracts/spreadsheet-parsing.contract.ts` — barrel re-export from the parser's **main entry only** (`@portalai/spreadsheet-parsing`); never from `/replay`. Keeps `@portalai/core/contracts` browser-safe.
7. `packages/core/src/contracts/index.ts` — add the re-export.

### 0.3 Refactor

- Verify `turbo run build` succeeds for the new package.
- Confirm `apps/api` and `apps/web` resolve `@portalai/spreadsheet-parsing` through the workspace symlink (no npm publishing needed).

### 0.4 Swagger

No endpoint change; skip.

---

## Phase 1 — `Workbook` abstraction + adapters

**Goal**: one canonical `Workbook` shape exists; the existing CSV/XLSX parsers produce it. `FileParseResult` keeps living under `core/models/job.model.ts` for the legacy path, with a header comment noting its scope.

### 1.1 Red — `packages/spreadsheet-parsing/src/workbook/__tests__/workbook.test.ts`

- `WorkbookSchema.parse({ sheets: [{ name, dimensions, cells }] })` accepts a minimal workbook.
- Sheet helpers `sheet.cell(row, col)` and `sheet.range(r1, c1, r2, c2)` are 1-based and return `undefined` / empty slices for out-of-bounds access.
- Merged-cell metadata round-trips (Zod-level only; no adapter work yet).
- Fingerprint helper `computeWorkbookFingerprint(workbook)` produces a deterministic `{ sheetNames, dimensions, anchorCells }` whose `anchorCells` are the top-left of each sheet's used range. Snapshot-tested against a fixture workbook.

`apps/api/src/services/workbook-adapters/__tests__/csv-adapter.test.ts`:

- Given a CSV buffer with headers + 3 rows, the adapter returns a `Workbook` with one sheet, dimensions `{ rows: 4, cols: N }`, and cells at 1-based coordinates.
- Delimiter sniff still works (`,` / `\t` / `;` / `|`).
- Empty-header rows synthesize no values (header detection is deferred to the parser module).

`apps/api/src/services/workbook-adapters/__tests__/xlsx-adapter.test.ts`:

- Given a multi-sheet XLSX file (fixture), returns a `Workbook` with all sheets.
- Date cells land as `Date` values; booleans as `boolean`; rich text flattened into `string`; merged ranges attached to the top-left cell's `merged` field.

### 1.2 Green

1. `packages/spreadsheet-parsing/src/workbook/types.ts` — TypeScript interfaces matching the spec (`Workbook`, `Sheet`, `WorkbookCell`, `WorkbookRange`).
2. `packages/spreadsheet-parsing/src/workbook/schema.ts` — `WorkbookSchema`, `WorkbookCellSchema`, `SheetSchema`. Workbook is *serialisable* (no methods); helpers live separately.
3. `packages/spreadsheet-parsing/src/workbook/helpers.ts` — `makeSheetAccessor(sheetData)` returns an object exposing `.cell` and `.range` backed by a pre-sorted cell map.
4. `packages/spreadsheet-parsing/src/workbook/fingerprint.ts` — `computeWorkbookFingerprint`.
5. `apps/api/src/services/workbook-adapters/csv.adapter.ts` — rewrites of the bits of `csv-parser.util.ts` that are pure cell production. The legacy `csv-parser.util.ts` keeps its `FileParseResult` producer (it now delegates to the adapter for cells, then summarises).
6. `apps/api/src/services/workbook-adapters/xlsx.adapter.ts` — same, wrapping `exceljs`.
7. Re-export `computeWorkbookFingerprint` from the package barrel.

### 1.3 Refactor

- The old header-detection heuristic in `csv-parser.util.ts` stays **in place** for the legacy path but gains a `/** @deprecated moved to @portalai/spreadsheet-parsing/interpret/stages/detect-headers in Phase 3 */` comment.
- Ensure the adapters never reach into `apps/api` domain types (`ConnectorEntity`, etc.) — the adapters see bytes → `Workbook` only.

### 1.4 Swagger

No route change; skip.

---

## Phase 2 — `LayoutPlan` Zod schemas + core re-exports

**Goal**: every Zod schema listed in spec §"Core types" exists in the parser module, is validated by fixture tests, and is importable via `@portalai/core/contracts`. Frontend's hand-rolled `RegionDraft` et al. are deleted in the same phase and replaced with schemas derived from the canonical ones.

### 2.1 Red

`packages/spreadsheet-parsing/src/plan/__tests__/schemas.test.ts`:

- `LayoutPlanSchema.parse(fixturePlan)` succeeds for `fixtures/plans/simple-rows-as-records.json`, `fixtures/plans/pivoted-columns-as-records.json`, `fixtures/plans/crosstab.json`.
- Discriminated unions reject invalid `kind` values (e.g. `headerStrategy.kind === "bogus"` throws).
- `RegionSchema` rejects:
  - crosstab region missing `secondaryRecordsAxisName` or `cellValueName` → `PIVOTED_REGION_MISSING_AXIS_NAME`-shaped error path;
  - `boundsMode === "matchesPattern"` with no `boundsPattern`;
  - `headerAxis === "none"` with non-empty `columnBindings` that reference `byHeaderName` (must be `byColumnIndex`);
  - `axisAnchorCell` outside `bounds`.
- `SkipRuleSchema` discriminated union: `{ kind: "blank" }` and `{ kind: "cellMatches", crossAxisIndex, pattern, axis? }` both parse; unknown kinds reject.
- `DriftKnobsSchema` defaults: `headerShiftRows === 0`, `addedColumns === "halt"`, `removedColumns.action === "halt"`.
- `WarningSchema` accepts every member of the `WarningCode` enum.

`apps/web/src/modules/RegionEditor/utils/__tests__/region-editor.types.test.ts`:

- `RegionDraft` type identity: a value typed as `RegionDraft` must be assignable to `z.infer<typeof RegionSchema>` partial. (Compile-time assertion via `expectType` helper.)
- Existing editor tests continue to pass after the type-only rewrite — if any break, they were depending on a shape detail that has changed and must be updated.

### 2.2 Green

1. `packages/spreadsheet-parsing/src/plan/locator.schema.ts` — `LocatorSchema` discriminated union.
2. `packages/spreadsheet-parsing/src/plan/strategies.schema.ts` — `HeaderStrategySchema`, `IdentityStrategySchema`, `BindingSourceLocatorSchema`, `ColumnBindingSchema`.
3. `packages/spreadsheet-parsing/src/plan/skip-rule.schema.ts` — `SkipRuleSchema`.
4. `packages/spreadsheet-parsing/src/plan/drift.schema.ts` — `DriftKnobsSchema`, `DriftReportSchema`, `RegionDriftSchema`.
5. `packages/spreadsheet-parsing/src/plan/region.schema.ts` — `RegionSchema` with cross-field `.refine()` for the crosstab / headerless / anchor-within-bounds invariants listed in Red.
6. `packages/spreadsheet-parsing/src/plan/layout-plan.schema.ts` — `LayoutPlanSchema`, `WorkbookFingerprintSchema`.
7. `packages/spreadsheet-parsing/src/plan/interpret-input.schema.ts` — `InterpretInputSchema`, `RegionHintSchema`, `UserHintsSchema`.
8. `packages/spreadsheet-parsing/src/plan/replay.schema.ts` — `ReplayResultSchema`, `ExtractedRecordSchema`, `DriftReportSchema`.
9. `packages/spreadsheet-parsing/src/plan/index.ts` — barrel.
10. `packages/core/src/contracts/spreadsheet-parsing.contract.ts` — replace the placeholder with real re-exports.
11. `apps/web/src/modules/RegionEditor/utils/region-editor.types.ts` — delete every hand-rolled type; replace with:
    ```ts
    import { RegionSchema, SkipRuleSchema, ColumnBindingSchema, ... } from "@portalai/core/contracts";
    export type RegionDraft = z.infer<typeof RegionSchema>["deepPartial"] & { id: string; sheetId: string };
    // ... other draft types derived the same way
    ```
    Per the `no_compat_aliases` memory, no legacy re-exports are kept. Call sites that imported types by the old names either continue to compile (identical shape) or are updated.

### 2.3 Refactor

- Audit `apps/web/src/modules/RegionEditor/` for any remaining string literals like `"rows-as-records"` — replace with the enum values exported from the contract.
- Audit `apps/web/src/workflows/FileUploadConnector/` for the same.
- Delete any unused imports flagged by the type-checker.

### 2.4 Swagger

Add schema definitions to `apps/api/src/config/swagger.config.ts` for:

- `LayoutPlan`, `Region`, `ColumnBinding`, `SkipRule`, `HeaderStrategy`, `IdentityStrategy`, `Warning`, `DriftReport`, `InterpretInput`, `RegionHint`.

Each is emitted from the Zod schema via `zod-to-json-schema` (add as a dependency) and registered under `components.schemas`. The swagger round-trip test (`apps/api/src/__tests__/swagger.test.ts` — create if absent) asserts every listed schema appears in `GET /api/docs/spec`.

---

## Phase 3 — `interpret()` stage skeletons + `InterpretState`

**Goal**: every stage function exists with its signature, called in order from `interpret()`, all producing deterministic fixture outputs without yet calling an LLM. Real LLM-backed `ClassifierFn` / `AxisNameRecommenderFn` land in `apps/api/` in Phase 4 and are injected through the existing DI slots — the parser module itself never gains an SDK dep.

### 3.1 Red — stage unit tests

One test file per stage under `packages/spreadsheet-parsing/src/interpret/stages/__tests__/`:

- `detect-regions.test.ts` — seeded from `regionHints`, returns exactly one region per hint; throws if no hints *and* no auto-detect fallback (fallback is a Phase 4 concern — throw `UNSUPPORTED_LAYOUT_SHAPE` here).
- `detect-headers.test.ts` — given a region with `headerAxis: "row"` and a fixture sheet, returns the row with the highest "header-ness" score (heuristic). Moves the heuristic out of `csv-parser.util.ts` per the duplication audit.
- `detect-identity.test.ts` — given header candidates + fixture, prefers a single unique column > composite > `rowPosition` (always warns).
- `classify-columns.test.ts` — given header names + `ColumnDefinition[]`, matches via heuristic exact-name / normalised-name. Semantic / AI matching is deferred to Phase 4 and mocked out here via an injected `classifier: (headers, columnDefs) => ColumnClassification[]`.
- `recommend-records-axis-name.test.ts` — given pivoted region + axis labels, returns `{ name, source: "ai", confidence }`. AI client mocked out via injection.
- `propose-bindings.test.ts` — assembles a `Region` from prior stage outputs; each binding carries `sourceLocator`, `columnDefinitionId`, `confidence`, `rationale?`.
- `reconcile-with-prior.test.ts` — given a prior plan + assembled regions, preserves region ids where fingerprints match; marks identity changes explicitly.
- `score-and-warn.test.ts` — emits `PIVOTED_REGION_MISSING_AXIS_NAME` blockers on missing names; `AMBIGUOUS_HEADER` at `warn`; `ROW_POSITION_IDENTITY` at `warn`; confidence roll-up is a mean over per-binding confidences weighted by field coverage (documented in the stage's README, fixture-asserted).

`interpret/__tests__/orchestration.test.ts`:

- Given a fixture `InterpretInput` with hints, calling `interpret()` runs the stages in the order declared in the spec and produces a plan whose shape exactly matches `LayoutPlanSchema`.
- State mutations are isolated per stage — `interpret()` returns the same plan on a second call against a cloned input (determinism).

### 3.2 Green

1. `packages/spreadsheet-parsing/src/interpret/state.ts` — `InterpretState` type, `createInitialState(input)` factory.
2. `packages/spreadsheet-parsing/src/interpret/stages/*` — one file per stage, each exporting a pure function `(state: InterpretState) => InterpretState` (or `async` for stages that will call the LLM in Phase 4).
3. `packages/spreadsheet-parsing/src/interpret/index.ts` — orchestrator:
   ```ts
   export async function interpret(input: InterpretInput): Promise<LayoutPlan> {
     const validated = InterpretInputSchema.parse(input);
     let state = createInitialState(validated);
     state = detectRegions(state);
     state = await detectHeaders(state);
     state = await detectIdentity(state);
     state = await classifyColumns(state);
     state = await recommendRecordsAxisName(state);
     state = proposeBindings(state);
     if (validated.priorPlan) state = reconcileWithPrior(state);
     state = scoreAndWarn(state);
     return assemblePlan(state);
   }
   ```
4. `packages/spreadsheet-parsing/src/warnings/codes.ts` — `WarningCode` enum + default severity map. Re-export from the barrel.
5. Move the header heuristic out of `apps/api/src/utils/csv-parser.util.ts` into `detect-headers.ts`; CSV adapter no longer knows about headers at all.

### 3.3 Refactor

- Stage functions take a `classifier` / `axisNameRecommender` injection slot for tests. Phase 4 wires the real LLM-backed implementations through that slot.
- Delete the deprecated header heuristic from `csv-parser.util.ts` and update any remaining call sites in `apps/api/src/services/uploads.service.ts`; they must now accept that the CSV adapter produces cells, not `{ hasHeader, headers }`.

### 3.4 Swagger

No route change; skip.

---

## Phase 4 — LLM-backed classifier + axis-name recommender (factory in apps/api)

**Goal**: ship real LLM-backed implementations of the two DI slots `interpret()` already accepts — `ClassifierFn` and `AxisNameRecommenderFn` — **inside `apps/api/`, not inside the parser module**. The parser stays a pure, leaf library (zod-only runtime dep) and contributes only prompt templates, structured-output Zod schemas, and sampling helpers that the api service reuses. Model selection, API keys, network I/O, and token/cost logging all live in the api layer.

### Architectural constraint (rule for this phase)

The parser module (`@portalai/spreadsheet-parsing`) **is a pure library**:

- No `ai` / `@ai-sdk/*` / provider SDK dependency. Zod and plain TypeScript only.
- No network I/O, no `fetch`, no `process.env` read, no logger wiring.
- No model ids, no API keys, no retry policy, no timeouts.
- Every interaction with an LLM goes through the Phase 3 DI slots: `deps.classifier` and `deps.axisNameRecommender`. The parser never calls a model directly.

The parser module **may** expose (content, not runtime):

- Prompt *templates* — pure string-builder functions.
- Structured-output Zod *schemas* that describe the model's expected response shape.
- Workbook *sampling helpers* that trim a region for prompt inclusion.
- These are grouped behind a single `LlmBridge` namespace so the hand-off between "content the parser owns" and "runtime the api owns" is explicit.

The **api service** (`apps/api/src/services/spreadsheet-parsing-llm.service.ts`) owns:

- The model provider (Anthropic via the existing `AiService`), API key handling, retries, timeouts.
- Pino structured logging — `{ event, stage, inputTokens, outputTokens, modelId, latencyMs }` per call.
- A `createInterpretDeps(opts)` **factory** that returns `InterpretDeps` closing over the model client and logger.

Consumers call `interpret(input, createInterpretDeps({ ... }))` — the parser remains oblivious to any SDK.

### 4.1 Red

#### Parser module (stays pure)

`packages/spreadsheet-parsing/src/interpret/llm/__tests__/prompt.test.ts`:

- `buildClassifierPrompt({ candidates, catalog })` returns a deterministic string for the same input (snapshot test).
- `buildAxisNameRecommenderPrompt({ axisLabels })` truncates at `MAX_AXIS_LABELS = 30` and never exceeds a documented byte budget.
- `ClassifierResponseSchema` parses `{ classifications: [{ sourceHeader, columnDefinitionId, confidence, rationale? }] }` and rejects unknown shapes.
- `AxisNameRecommenderResponseSchema` parses `{ name: string, confidence: number }` and rejects out-of-range confidence.
- `sampleWorkbookRegion(sheet, bounds, { maxRows, maxCols })` clips a sheet region to the cell budget and is a pure function of `(sheet, bounds, opts)`.
- No test under `packages/spreadsheet-parsing/` imports `ai`, `@ai-sdk/*`, `pino`, or any other runtime-side library — enforced by an audit test that greps the source tree (`forbidden-deps.test.ts`).

`packages/spreadsheet-parsing/package.json` audit: `dependencies` contains `zod` only. Added as an assertion in the audit test.

Existing stage unit tests from Phase 3 are unchanged — they keep mocking `classifier` / `axisNameRecommender` directly.

#### API service (owns the runtime)

`apps/api/src/services/__tests__/spreadsheet-parsing-llm.service.test.ts`:

- `createInterpretDeps(opts)` returns an object typed as `InterpretDeps` with `classifier` and `axisNameRecommender` populated.
- The returned `classifier`:
  - Calls the mocked `generateObject` (from the `ai` SDK) exactly once per invocation, passing the prompt built by `LlmBridge.buildClassifierPrompt` and the Zod schema from `LlmBridge.ClassifierResponseSchema`.
  - Returns `ColumnClassification[]` translated from the validated response.
  - Throws a typed `LlmResponseError` (with stage name in `message`) when the model output fails the Zod schema.
- The returned `axisNameRecommender` validates through `LlmBridge.AxisNameRecommenderResponseSchema`, returns `{ name, confidence } | null`, and is **never** called with zero axis labels.
- Token-count observability — after each call, `logger.info({ event: "interpret.llm.call", stage: "classify" | "recommend-axis-name", inputTokens, outputTokens, modelId, latencyMs })` runs (verified via a pino stream capture).
- The factory respects `opts.model` (defaults to `AiService.DEFAULT_MODEL`) and accepts an injected `generateObject` for testing.

`apps/api/src/services/__tests__/file-analysis.service.test.ts` (existing file, updated):

- `FileAnalysisService.analyze(workbook, hints, orgId, userId)` loads the org's `ColumnDefinition` catalog, builds deps via `createInterpretDeps`, calls `interpret(input, deps)`, and returns the plan.
- The Anthropic mock lives in *this* test file only; the parser module's tests stay SDK-free.

### 4.2 Green

#### Parser module (pure)

1. `packages/spreadsheet-parsing/src/interpret/llm/prompt.ts` — pure string builders `buildClassifierPrompt` / `buildAxisNameRecommenderPrompt`, plus `MAX_AXIS_LABELS`, `MAX_SHEET_SAMPLE` constants.
2. `packages/spreadsheet-parsing/src/interpret/llm/schema.ts` — `ClassifierResponseSchema`, `AxisNameRecommenderResponseSchema` (zod only).
3. `packages/spreadsheet-parsing/src/interpret/llm/sampler.ts` — `sampleWorkbookRegion(sheet, bounds, opts)` returning a structured preview of the cells inside the region.
4. `packages/spreadsheet-parsing/src/interpret/llm/index.ts` — barrel under the public `LlmBridge` namespace:
   ```ts
   // src/index.ts
   export * as LlmBridge from "./interpret/llm/index.js";
   ```
   Consumers write `LlmBridge.buildClassifierPrompt(...)`, making it explicit that the parser exposes *content* (prompts + schemas), not runtime.
5. `packages/spreadsheet-parsing/src/__tests__/forbidden-deps.test.ts` — audit test:
   - `package.json.dependencies` is exactly `{ zod }`.
   - No source file under `src/` contains an import of `ai`, `@ai-sdk/`, `pino`, `axios`, `node-fetch`, or `undici`.
   - No `node:*` import outside `src/replay/` (enforces the browser-safe main entry + `/ui`; `/replay` is the only Node-only subpath).
   - Cross-subpath isolation: main entry must not import from `/replay` or `/ui`; `/ui` must not import from `/replay`.
6. No change to `package.json` dependencies. Parser stays zod-only.

#### API service (impure)

7. `apps/api/src/services/spreadsheet-parsing-llm.service.ts`:
   ```ts
   import { generateObject } from "ai";
   import { LlmBridge } from "@portalai/spreadsheet-parsing";
   import type {
     ClassifierFn,
     AxisNameRecommenderFn,
     InterpretDeps,
   } from "@portalai/spreadsheet-parsing";

   import { AiService } from "./ai.service.js";
   import { createLogger } from "../utils/logger.util.js";

   interface CreateDepsOptions {
     model?: string;
     generateObject?: typeof generateObject;   // test seam
     logger?: ReturnType<typeof createLogger>;
     columnDefinitionCatalog?: InterpretDeps["columnDefinitionCatalog"];
   }

   export function createInterpretDeps(
     opts: CreateDepsOptions = {},
   ): InterpretDeps {
     const anthropic = AiService.providers.anthropic;
     const modelId = opts.model ?? AiService.DEFAULT_MODEL;
     const gen = opts.generateObject ?? generateObject;
     const log = opts.logger ?? createLogger({ module: "interpret-llm" });

     const classifier: ClassifierFn = async (candidates, catalog) => {
       const prompt = LlmBridge.buildClassifierPrompt({ candidates, catalog });
       const started = Date.now();
       const result = await gen({
         model: anthropic(modelId),
         prompt,
         schema: LlmBridge.ClassifierResponseSchema,
       });
       log.info(
         {
           event: "interpret.llm.call",
           stage: "classify",
           inputTokens: result.usage?.inputTokens,
           outputTokens: result.usage?.outputTokens,
           modelId,
           latencyMs: Date.now() - started,
         },
         "interpret classifier call completed",
       );
       return result.object.classifications;
     };

     const axisNameRecommender: AxisNameRecommenderFn = async (labels) => {
       if (labels.length === 0) return null;
       const prompt = LlmBridge.buildAxisNameRecommenderPrompt({ axisLabels: labels });
       const started = Date.now();
       const result = await gen({
         model: anthropic(modelId),
         prompt,
         schema: LlmBridge.AxisNameRecommenderResponseSchema,
       });
       log.info(
         {
           event: "interpret.llm.call",
           stage: "recommend-axis-name",
           inputTokens: result.usage?.inputTokens,
           outputTokens: result.usage?.outputTokens,
           modelId,
           latencyMs: Date.now() - started,
         },
         "interpret axis-name recommender call completed",
       );
       return result.object;
     };

     return {
       classifier,
       axisNameRecommender,
       columnDefinitionCatalog: opts.columnDefinitionCatalog,
     };
   }
   ```
8. `apps/api/src/services/file-analysis.service.ts` reduces to:
   ```ts
   static async analyze(
     workbook: Workbook,
     hints: RegionHint[],
     orgId: string,
     userId: string,
   ): Promise<LayoutPlan> {
     const catalog = await ColumnDefinitionsService.listForOrg(orgId);
     const deps = createInterpretDeps({
       columnDefinitionCatalog: catalog.map((c) => ({
         id: c.id,
         label: c.label,
         normalizedKey: c.normalizedKey ?? undefined,
         description: c.description ?? undefined,
       })),
       logger: createLogger({ module: "interpret", orgId, userId }),
     });
     return interpret({ workbook, regionHints: hints }, deps);
   }
   ```
9. Delete any obsolete prompt file under `apps/api/src/services/prompts/` or `apps/api/src/prompts/` once this phase proves the new flow end-to-end.

### 4.3 Refactor

- Model selection, API key handling, retries, and structured-logging policy live in exactly one file: `apps/api/src/services/spreadsheet-parsing-llm.service.ts`. Anything that wants to tune any of those knobs edits that file.
- Stage tests in the parser module keep using direct `classifier` / `axisNameRecommender` mocks — no real SDK calls ever enter the parser's test run.
- `file-analysis.service.test.ts` mocks `generateObject` in the same style the existing legacy-path tests already do. The parser module's tests gain zero new mocks.
- Parser lint + type-check stay clean without any network/SDK-related rule exceptions. The `forbidden-deps` audit test is the compile-time gate that prevents future drift.

### 4.4 Swagger

No route change; skip. Phase 7 adds `/layout-plan/interpret` and documents its request/response shapes; this phase only changes *how* interpretation is computed, not the wire surface.

---

## Phase 5 — `replay()` + drift detection

**Goal**: pure function `replay(plan, workbook)` produces `ReplayResult` with extracted records + drift report for every orientation + bounds mode listed in v1. No LLM call, no I/O.

### 5.1 Red — `packages/spreadsheet-parsing/src/replay/__tests__/`

- `rows-as-records.test.ts` — fixture workbook + plan; records array matches snapshot; `source_id` equals the identity-column value; checksum is order-independent (re-ordering fields yields the same checksum).
- `columns-as-records.test.ts` — pivoted region with `recordsAxisName: "Month"`; each record has `{ Month: "Jan" | "Feb" | ... }` attached.
- `cells-as-records.test.ts` — crosstab; each record has `{ [recordsAxisName.name]: rowLabel, [secondaryRecordsAxisName.name]: colLabel, [cellValueName.name]: cellValue }`.
- `bounds-modes.test.ts` — `absolute` respects literal range; `untilEmpty` expands until `untilEmptyTerminatorCount` consecutive blank rows; `matchesPattern` stops on regex match.
- `skip-rules.test.ts` — `blank` skips both axes; `cellMatches` with `axis: "row"` only skips rows, `axis: "column"` only skips columns; null cells coerce to "" before regex test.
- `drift.test.ts`:
  - Header shift within tolerance → `withinTolerance: true`, `severity: "info"`.
  - Added column with `addedColumns: "halt"` → `severity: "warn"`, `identityChanging: false`.
  - Added column with `addedColumns: "auto-apply"` → silently dropped, `severity: "info"`.
  - Removed column beyond `removedColumns.max` → `severity: "blocker"`.
  - Records-axis value renamed → `identityChanging: true` always (even if knobs allow).
  - Identity column has blanks → `IDENTITY_COLUMN_HAS_BLANKS` warning.
  - Duplicate identity values → `DUPLICATE_IDENTITY_VALUES` warning, `severity: "blocker"`.

### 5.2 Green

1. `packages/spreadsheet-parsing/src/replay/resolve-bounds.ts` — expands `untilEmpty` / `matchesPattern` against the workbook.
2. `packages/spreadsheet-parsing/src/replay/resolve-headers.ts` — maps header-axis labels to `ColumnBinding`s.
3. `packages/spreadsheet-parsing/src/replay/extract-records.ts` — per-orientation walker producing `ExtractedRecord[]`.
4. `packages/spreadsheet-parsing/src/replay/identity.ts` — identity derivation (column / composite / rowPosition).
5. `packages/spreadsheet-parsing/src/replay/checksum.ts` — stable, order-independent checksum (sort field keys, hash JSON via `node:crypto.createHash("sha256")` — Node-only, confined to `/replay`).
6. `packages/spreadsheet-parsing/src/replay/drift.ts` — per-region drift evaluation against `DriftKnobsSchema`.
7. `packages/spreadsheet-parsing/src/replay/index.ts` — orchestrator exported from the `/replay` subpath only (not from the main entry):
   ```ts
   export function replay(plan: LayoutPlan, workbook: Workbook): ReplayResult {
     LayoutPlanSchema.parse(plan);
     const records: ExtractedRecord[] = [];
     const regionDrifts: RegionDrift[] = [];
     for (const region of plan.regions) {
       const { records: r, drift } = replayRegion(region, workbook);
       records.push(...r);
       regionDrifts.push(drift);
     }
     return { records, drift: rollUpDrift(regionDrifts) };
   }
   ```

### 5.3 Refactor

- Keep the legacy `apps/api/src/services/record-import.util.ts#computeChecksum` in place; the parser's `checksum.ts` must produce the **same hex bytes** (SHA-256 → first 16 chars) so plan-driven commits upsert into the existing `entity_records.checksum` column without migration. Both call into `node:crypto` independently — they don't share code, just format.
- Update the audit: `forbidden-deps.test.ts` asserts `node:crypto` is imported **only** under `src/replay/`. Main entry + `/ui` stay browser-safe so Storybook and the web bundle don't trip on Vite's externalization.
- Register `./replay` in the parser package's `exports` map and write the commit path's imports as:
  ```ts
  import { replay } from "@portalai/spreadsheet-parsing/replay";
  ```
  Never re-export from `@portalai/core/contracts` — that barrel stays browser-safe.

### 5.4 Swagger

No route change; skip.

---

## Phase 6 — DB schema: `connector_instance_layout_plans` + sync history FK

**Goal**: the new table exists, passes the dual-schema `type-checks.ts` gate, has a named migration applied, and a repository class exposing standard CRUD + "fetch current plan for instance".

### 6.1 Red

`apps/api/src/db/repositories/__tests__/connector-instance-layout-plans.repository.integration.test.ts`:

- `create` persists a plan, `findById` returns it, soft-delete hides it from `findMany`.
- `findCurrentByConnectorInstanceId(id)` returns the row with `supersededBy: null` (or undefined if none).
- `supersede(oldPlanId, newPlanId)` atomically sets `oldPlan.supersededBy = newPlanId`.
- Zod validation at `plan` JSONB column — invalid shapes rejected by `createInsertSchema` derived validator.

`apps/api/src/db/schema/__tests__/type-checks.test.ts` — extend the existing suite to include:

- `IsAssignable<ConnectorInstanceLayoutPlanRow, LayoutPlanTableType>` passes.
- Attempting to construct a row without `plan` or `planVersion` fails compilation (verified via a `// @ts-expect-error` assertion in the test file).

### 6.2 Green

1. `apps/api/src/db/schema/connector-instance-layout-plans.table.ts`:
   ```ts
   export const connectorInstanceLayoutPlans = pgTable("connector_instance_layout_plans", {
     ...baseColumns,
     connectorInstanceId: text("connector_instance_id").notNull()
       .references(() => connectorInstances.id),
     planVersion: text("plan_version").notNull(),
     revisionTag: text("revision_tag"),
     plan: jsonb("plan").$type<LayoutPlan>().notNull(),
     interpretationTrace: jsonb("interpretation_trace").$type<InterpretationTrace | null>(),
     supersededBy: text("superseded_by"),
   }, (table) => [
     index("cilp_instance_current_idx").on(table.connectorInstanceId, table.supersededBy),
   ]);
   ```
2. `apps/api/src/db/schema/zod.ts` — add `createSelectSchema(connectorInstanceLayoutPlans)` and `createInsertSchema(...)` derivations.
3. `apps/api/src/db/schema/type-checks.ts` — add bidirectional `IsAssignable` guards between the Drizzle row and `LayoutPlan` so renames in `@portalai/spreadsheet-parsing` break the build.
4. `apps/api/src/db/repositories/connector-instance-layout-plans.repository.ts` — extends `Repository<typeof connectorInstanceLayoutPlans>`, adds `findCurrentByConnectorInstanceId` and `supersede`.
5. Register the repository in `apps/api/src/db/repositories/index.ts`.
6. **Sync history FK** — audit whether a `sync_history` (or equivalent) table exists:
   - If yes, add a nullable `layout_plan_id` FK column pointing to `connectorInstanceLayoutPlans.id`.
   - If no, this plan does **not** create it; the commit endpoint writes to the plan-linked audit record via another future mechanism and leaves a `TODO(sync-history):` in the commit service pointing at the gap.
7. Generate the migration: `npm run db:generate -- --name add_connector_instance_layout_plans`; apply with `npm run db:migrate` in the integration test setup.

### 6.3 Refactor

- Ensure `connectorInstances` soft-delete cascades to plan rows via the repository's `softDeleteMany` (the backend relies on repository-level cascade; add a test).

### 6.4 Swagger

Schema definitions already registered in Phase 2; no additional work beyond verifying the `components.schemas.LayoutPlan` entry matches the Drizzle `$type<LayoutPlan>` exactly (caught by the type-checks guard).

---

## Phase 7 — Layout plan endpoints: interpret, get, update-draft

**Goal**: three new routes exist, fully Swagger-documented, backed by integration tests. Commit is a separate phase because it also touches `ConnectorEntity` / `FieldMapping` / `entity_records`.

### 7.1 Red — `apps/api/src/__tests__/__integration__/routes/connector-instance-layout-plans.router.integration.test.ts`

- `POST /api/connector-instances/:id/layout-plan/interpret`:
  - Requires auth → 401 without bearer token.
  - Validates payload with `InterpretInputSchema` → 400 on malformed input with `ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD`.
  - Calls the parser module's `interpret()` with the adapted `Workbook` (uploaded via S3 presign or provided inline for tests) and the user's `regionHints`.
  - Persists the returned plan with `supersededBy: null`, returns `{ plan, interpretationTrace }`.
  - 403 when the requesting user doesn't own the connector instance's org (standard auth middleware).
- `GET /api/connector-instances/:id/layout-plan`:
  - Returns the current plan (row with `supersededBy: null`) or `404` with `LAYOUT_PLAN_NOT_FOUND`.
  - Accepts `?include=interpretationTrace` — omitting it drops the trace from the response.
- `PATCH /api/connector-instances/:id/layout-plan/:planId`:
  - Accepts a partial `LayoutPlan` patch; validates the merged result with `LayoutPlanSchema`.
  - Rejects with `LAYOUT_PLAN_EDIT_AFTER_COMMIT` if the plan is already referenced by a sync-history row (guarded only if the sync-history table exists — otherwise always allow).
- Drift gating: none at this stage; commit is Phase 8.

### 7.2 Green

1. `packages/core/src/contracts/connector-instance-layout-plans.contract.ts`:
   ```ts
   export const InterpretRequestBodySchema = InterpretInputSchema.omit({ workbook: true }).extend({
     workbook: WorkbookSchema,   // inline workbook for v1; S3 adapter path in Phase 8
   });
   export const InterpretResponsePayloadSchema = z.object({
     plan: LayoutPlanSchema,
     interpretationTrace: InterpretationTraceSchema.nullable(),
   });
   export const PatchLayoutPlanBodySchema = LayoutPlanSchema.deepPartial();
   ```
2. `apps/api/src/services/connector-instance-layout-plans.service.ts` — static class methods `interpret(instanceId, orgId, userId, body)`, `getCurrent(instanceId, include)`, `patch(instanceId, planId, body, userId)`.
3. `apps/api/src/routes/connector-instance-layout-plans.router.ts` — mounts under `/api/connector-instances/:connectorInstanceId/layout-plan`.
4. Register the router in `apps/api/src/app.ts`.
5. `apps/api/src/constants/api-codes.constants.ts` — add:
   - `LAYOUT_PLAN_INVALID_PAYLOAD`
   - `LAYOUT_PLAN_NOT_FOUND`
   - `LAYOUT_PLAN_INTERPRET_FAILED`
   - `LAYOUT_PLAN_EDIT_AFTER_COMMIT`
6. Every request validation uses the Zod schema exported from `@portalai/core/contracts` (per the `api_no_assumptions` memory — the handler accepts values from payload, no derivation from elsewhere).

### 7.3 Refactor

- Every list-shaped endpoint (currently only `GET` is list-shaped for traces under interpretation history — out of scope here; single-resource GET stays simple) follows the `include` convention from `CLAUDE.md` §Include / Join Convention. Repository adds `findCurrentByConnectorInstanceId(id, { include })` that post-batch-loads the trace.
- Pagination params (`limit`, `offset`, `sortBy`, `sortOrder`) are added only if a list endpoint is added; the single-plan GET doesn't need them.

### 7.4 Swagger

For every new route, add a JSDoc `@openapi` block above the handler with:

- `tags: [LayoutPlans]`
- `security: [{ bearerAuth: [] }]`
- `parameters` — path `connectorInstanceId`, query `include`.
- `requestBody` / `responses` referencing the `components.schemas.*` names registered in Phase 2 (e.g. `$ref: "#/components/schemas/InterpretRequestBody"`).
- Error responses: 400, 401, 403, 404, 409 as applicable.

Round-trip test (extends `apps/api/src/__tests__/swagger.test.ts`):

- `GET /api/docs/spec` lists all three new paths.
- The `requestBody` schema for `/interpret` serialises to the same JSON schema produced by `zod-to-json-schema(InterpretRequestBodySchema)`.
- The response schema for `/layout-plan` includes `LayoutPlan` under `components.schemas`.

---

## Phase 8 — Commit endpoint + plan-driven sync write path

**Goal**: `POST /api/connector-instances/:id/layout-plan/:planId/commit` runs `replay()` against a fresh workbook, materializes one `ConnectorEntity` per `targetEntityDefinitionId`, reconciles `FieldMapping` rows (union of per-region bindings, deduplicated by `ColumnDefinition`), writes `entity_records`, and links a sync-history row (if the table exists) back to the plan.

### 8.1 Red

`apps/api/src/__tests__/__integration__/routes/connector-instance-layout-plans.router.integration.test.ts` (add to the suite from Phase 7):

- `POST /api/connector-instances/:id/layout-plan/:planId/commit`:
  - Happy path, one region, `rows-as-records`: creates one `ConnectorEntity`, N `FieldMapping` rows matching column bindings, M `entity_records` where M matches the fixture row count minus skip-rule exclusions.
  - Two regions sharing a `targetEntityDefinitionId`: creates **one** `ConnectorEntity`, `FieldMapping` rows are the deduplicated union (assert by count + per-column-definition uniqueness).
  - Three regions across two distinct `targetEntityDefinitionId`s: creates **two** `ConnectorEntity` rows, per-region records grouped under the right entity.
  - Pivoted region: records carry `{ [recordsAxisName.name]: axisLabel }` attached to the JSONB row.
  - Crosstab region: records carry the three-field crosstab shape.
  - Drift gating:
    - `identityChanging: true` → responds `409 CONFLICT` with body `{ code: "LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED", drift: DriftReport }`; no `entity_records` are written (assert row count unchanged).
    - `severity: "blocker"` (non-identity) → same 409 with `LAYOUT_PLAN_DRIFT_BLOCKER`.
    - `severity: "warn"` with knobs requiring halt → 409 with `LAYOUT_PLAN_DRIFT_HALT`.
    - `severity: "warn"` with `addedColumns: "auto-apply"` → commits with `added` dropped, `warning.severity: "info"` logged.
- Re-commit with the same plan (idempotency):
  - `entity_records` use `source_id` upsert semantics from `record-import.util.ts`; second commit marks records as unchanged (checksum match) and does not duplicate.
- Legacy `/api/uploads/confirm` flow still works unchanged (regression test from the existing integration suite stays green).

### 8.2 Green

1. `apps/api/src/services/layout-plan-commit.service.ts` — the new service. Responsibilities:
   - Load the plan + workbook (workbook source is a storage key stored on the plan's `interpretationTrace` or passed alongside for Mode A — spec open question; follow the current `uploads.service.ts` S3 lookup pattern).
   - Import `replay` from the Node-only subpath: `import { replay } from "@portalai/spreadsheet-parsing/replay";` — **not** from `@portalai/core/contracts` (which doesn't re-export it).
   - Call `replay(plan, workbook)`.
   - If `drift.identityChanging || drift.severity === "blocker"` or `severity === "warn" && any-region has halt knob` → throw `ApiError(409, LAYOUT_PLAN_DRIFT_*, message, { drift })`.
   - Group `ExtractedRecord[]` by `targetEntityDefinitionId`.
   - For each group: `upsertConnectorEntity` (existing helper), then `reconcileFieldMappings(connectorEntityId, unionOfBindings)`, then `importRecords(records)` via the existing `record-import.util.ts`.
   - Set plan row's `supersededBy` only when a replan has happened — this endpoint commits the *current* plan, not a new one.
   - If a sync-history table exists (Phase 6 audit outcome), insert a row with `layout_plan_id: planId`.
2. `apps/api/src/services/field-mappings/reconcile.ts` (new helper; extracted from `uploads.service.ts` to avoid copy-paste) — takes `(connectorEntityId, bindings[])` and upserts deduplicated by `columnDefinitionId`, soft-deleting mappings that no longer appear.
3. `apps/api/src/constants/api-codes.constants.ts` — add:
   - `LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED`
   - `LAYOUT_PLAN_DRIFT_BLOCKER`
   - `LAYOUT_PLAN_DRIFT_HALT`
   - `LAYOUT_PLAN_COMMIT_FAILED`
4. Route handler mounted in Phase 7's router file; returns `{ connectorEntityIds, recordCounts: { created, updated, unchanged, invalid } }` on success.

### 8.3 Refactor

- Move shared entity/mapping upsert logic out of `uploads.service.ts` into `connector-entities.service.ts` / `field-mappings.service.ts` so both the legacy path and the commit service share one copy. Per the `no_compat_aliases` memory, if either path gains a subtly different upsert signature, we consolidate by adding an explicit parameter, not by wrapping.
- Audit `record-import.util.ts` — if it accepts `FieldMapping[]` + rows today, it can consume `ExtractedRecord[]` directly with minor adaptation; otherwise add a thin `toLegacyRows(records)` translator.

### 8.4 Swagger

Add JSDoc for the commit route with:

- `responses.200` — commit summary (new schema `LayoutPlanCommitResult`).
- `responses.409` — drift conflict with `DriftReport` body. Swagger spec needs a `DriftReport` schema (registered in Phase 2).

Round-trip test extends the Phase 7 swagger test.

---

## Phase 9 — Cost observability + structured warnings end-to-end

**Goal**: every `interpret()` call emits Pino logs with `{ stage, inputTokens, outputTokens, modelId, latencyMs }`; warnings from stages reach the `LayoutPlan.warnings` array and the integration test asserts them.

### 9.1 Red

`packages/spreadsheet-parsing/src/interpret/__tests__/observability.test.ts`:

- Capture Pino output via a writable stream; `interpret()` emits `{ event: "interpret.stage.completed", stage, tokens, latencyMs }` for each stage that made a model call.
- `interpret()` emits `{ event: "interpret.cost.summary", totalInputTokens, totalOutputTokens, totalLatencyMs }` at the end.

`apps/api/src/__tests__/__integration__/routes/connector-instance-layout-plans.router.integration.test.ts`:

- Warnings of severity `blocker` returned from `interpret` endpoint are preserved on re-fetch.
- The commit endpoint rejects when any region has a `blocker` warning, returning `409` with `LAYOUT_PLAN_BLOCKER_WARNINGS` listing the codes.

### 9.2 Green

- Wire `logger` (Pino) into the parser module via an injectable `logger: Pino.Logger` parameter (defaults to `console` in tests, wired to the app logger from `apps/api`).
- `LayoutPlanCommitService.commit()` gates on `plan.regions.some(r => r.warnings.some(w => w.severity === "blocker"))`.
- Add `LAYOUT_PLAN_BLOCKER_WARNINGS` ApiCode.

### 9.3 Refactor

- Confirm the commit-service observability logs tag every log line with `connectorInstanceId`, `planId`, `layoutPlanVersion` via `createLogger({ module: "layout-plan-commit", connectorInstanceId })`.

### 9.4 Swagger

No new routes; confirm the commit response's 409 schema includes an optional `warnings: Warning[]` alongside `drift: DriftReport`.

---

## Phase 10 — Final cleanup + docs

**Goal**: no duplicated parser concept remains; the legacy upload path is flagged as legacy in code comments; README and spec docs reflect reality.

### 10.1 Red

`apps/api/src/__tests__/audit.test.ts`:

- No file under `apps/api/src/` defines a TypeScript type literal matching `"rows-as-records" | "columns-as-records" | "cells-as-records"` outside of the import from `@portalai/core/contracts` (AST-grepped).
- No file under `apps/web/src/` defines `RegionDraft` locally.
- `csv-parser.util.ts` no longer exports a `hasHeader` field (it has moved to the parser module).

### 10.2 Green

- Delete stragglers surfaced by the audit test.
- Add a comment block at the top of `apps/api/src/services/uploads.service.ts` and `apps/api/src/routes/uploads.router.ts`:
  ```ts
  /**
   * Legacy simple-layout upload path. New flows should use
   * POST /api/connector-instances/:id/layout-plan/* per
   * docs/SPREADSHEET_PARSING.backend.spec.md.
   */
  ```
- Update `apps/api/README.md` §API Style Guide with a sub-section on the layout-plan endpoints, linking to the backend spec.
- Update `packages/core/README.md` with the new `@portalai/core/contracts` re-exports.
- Ensure `packages/spreadsheet-parsing/README.md` documents the three-subpath convention (main / `/replay` / `/ui`), the decision flow for new files, and the compile-time audit; link the spec's "Module layout" section to it.

### 10.3 Refactor

- Run `npm run lint:fix` + `npm run format` across the monorepo.
- Confirm `npm run build` succeeds from cold cache.

### 10.4 Swagger

Final verification pass: `GET /api/docs` loads without validation errors; the `LayoutPlan`, `Region`, `DriftReport`, `Warning`, `InterpretRequestBody`, `InterpretResponsePayload`, `LayoutPlanCommitResult` schemas all appear and match their Zod sources via the round-trip test.

---

## Exit criteria

- `npm run type-check` — clean across the monorepo.
- `npm run test` — unit suites green for `@portalai/spreadsheet-parsing`, `@portalai/core`, `@portalai/api`, `@portalai/web`.
- `npm --workspace apps/api run test:integration` — green, including the layout-plan and legacy-upload suites side by side.
- `GET /api/docs/spec` lists every new endpoint; round-trip Zod ↔ JSON-Schema parity test passes.
- No TypeScript file outside `@portalai/spreadsheet-parsing` (and its `@portalai/core/contracts` re-exports) declares `Region`, `LayoutPlan`, `SkipRule`, `ColumnBinding`, `HeaderStrategy`, `IdentityStrategy`, `Warning`, `DriftReport`, `Workbook`, or `ExtractedRecord` shapes. Verified by the Phase 10 audit test.
- Legacy `/api/uploads/*` path unchanged behaviourally; its integration tests stay green.
- The parser's three-subpath export convention is intact: main entry is cross-compatible (no `node:*` imports, no DOM APIs), `/replay` is Node-only, `/ui` exists as the browser-only landing zone. Verified by `forbidden-deps.test.ts`.
- `@portalai/core/contracts` re-exports only the parser's main entry — never `/replay`. `apps/web` and Storybook bundles contain zero `node:crypto` references.
- `packages/spreadsheet-parsing/README.md` documents the three-subpath convention, the decision flow for new files, and the audit contract.

## Risks and open questions

- **Workbook payload size.** The interpret endpoint accepts a `Workbook` inline in Phase 7; for very large sheets this payload blows past reasonable HTTP limits. Follow-up: store the adapted workbook in S3 and pass a reference on `InterpretRequestBody`. The commit path already expects S3 because it re-fetches the file. Flagged as the first post-plan follow-up.
- **Sync history table.** The audit in Phase 6 may determine that no `sync_history`-equivalent table exists today. The plan leaves a TODO rather than introducing one — that's its own design decision (retention, sharding). A narrow table can land as a follow-up.
- **Confidence threshold bands.** Spec open question (backend OQ1). Module emits raw scores; consumers apply thresholds. This plan does not pin `green/yellow/red` cutoffs — callers decide. Revisit after fixture regression data accumulates.
- **LangGraph migration.** v1 wires real LLM-backed deps in `apps/api/` behind the parser's DI slots; each stage is fixture-testable on a mocked slice of those slots. A future PR can replace the parser's internal orchestration with a `StateGraph` — or swap the api-side factory for a graph-backed one — without touching consumers, verified by keeping `interpret()`'s external signature and fixture set stable.
- **Cost envelope.** The sampling helper (Phase 4) caps sheets at 200 × 30 cells before model input. This is a default, not a proof; fixture regression should include at least one "oversized" sheet to catch behaviour drift.
- **`FileAnalysisService` shrink.** Phase 4 reduces `FileAnalysisService` to an adapter that builds `InterpretDeps` via `createInterpretDeps()` and calls the parser's `interpret()`. Any caller that imported `FileAnalysisService` directly keeps working; the inner Anthropic call simply moves behind the new factory (still in `apps/api/`). Parser module gains **no** new dep.

## Appendix — ordered PRs

To keep reviews bounded, ship in this order. Each PR ends green on `type-check`, `test:unit`, and `test:integration`.

1. **PR A — Phase 0 + Phase 1 + Phase 2**: package skeleton, `Workbook` + adapters, all Zod schemas + core re-exports, frontend type-only rewrite. No behaviour change yet. Largest "shape" PR.
2. **PR B — Phase 3 + Phase 4**: stage skeletons, single-LLM orchestration, `FileAnalysisService` shrink. `interpret()` works end-to-end against fixtures; no routes yet.
3. **PR C — Phase 5**: `replay()` + drift detection. Pure function only; still no routes.
4. **PR D — Phase 6 + Phase 7**: DB migration, repository, interpret + get + patch endpoints with Swagger.
5. **PR E — Phase 8 + Phase 9**: commit endpoint, plan-driven sync write path, drift gating, observability.
6. **PR F — Phase 10**: cleanup, audits, README, swagger final verification.
