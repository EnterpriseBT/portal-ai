# Hint fields the plan check rejects — Condensed design (#1011)

**Issue:** [EnterpriseBT/portal-ai#1011](https://github.com/EnterpriseBT/portal-ai/issues/1011) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Interpret copies several region-hint fields onto the region as given. When one breaks a `RegionSchema` rule, the final `LayoutPlanSchema.parse` throws a ZodError after the model stages have run, and the API answers a scrubbed `500 LAYOUT_PLAN_INTERPRET_FAILED`. A survey sent one malformed hint per rule through the real `interpret()` (6 × 6 sheet). **12 reach the 500:**
- the anchor cell outside the bounds;
- a header axis listed twice;
- user-authored segments whose counts don't fit the span: a fixed sum, and a dynamic tail with no room;
- field `headers` / `skipped` of the wrong length;
- a pivot id repeated across axes;
- `recordsAxis` alongside a header axis, or missing on a headerless region;
- a dynamic pivot that isn't last, or two on one axis;
- a terminator on a crosstab.

**5 don't:** field-only segments of the wrong sum, segments on an undeclared axis, intersection fields on a 1D region or with bad keys, and a cell-value field without a pivot. Interpret replaces or reconciles those.

The change is in `packages/spreadsheet-parsing` only, following #1002 / #1008: these become `UNSUPPORTED_LAYOUT_SHAPE` 400s naming the region, raised before any model call.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Hint → region | `src/interpret/stages/detect-regions.ts` (`skeletonRegionFromHint`) | copies `headerAxes`, `segmentsByAxis`, `cellValueField`, `intersectionCellValueFields`, `recordsAxis`, `recordAxisTerminator`, `axisAnchorCell` and `identityStrategy` verbatim; #1008's bounds check runs here |
| Region rules | `src/plan/region.schema.ts:193-510` (`RegionSchema` superRefine) | the canonical refinements, keyed by issue `path` |
| Which segments survive | `src/interpret/stages/pivoted.util.ts:66-108` (`segmentsAreUserAuthored`, `resolveEffectiveSegments`) | hint segments are kept only when user-authored (a user-named pivot, or field `headers` / `skipped` overrides); otherwise detect-segments replaces them |
| Reconciled later | `propose-bindings.ts` (`reconcileCellValueFields`, #998) | cell-value and intersection fields are made to agree with the settled segments |
| The input error | `src/interpret/input-error.ts` (#1008) | `UNSUPPORTED_LAYOUT_SHAPE: …`, capped at 20 problems; the API answers 400 with it |

## Decision — run the region rules on the hint's skeleton in stage 1

- **Chosen:** for each hint, after #1008's bounds check, `detectRegions` runs `RegionSchema.safeParse` on the skeleton region. Placeholder header strategies fill the declared axes so refinement 6 (strategy required) stays quiet. It keeps only issues whose path starts at a field the hint passes through unrepaired:
  - `axisAnchorCell`, `headerAxes`, `recordsAxis`, `recordAxisTerminator`;
  - `segmentsByAxis`, only when `segmentsAreUserAuthored(hint.segmentsByAxis)`, the same rule interpret uses to keep them.

  Each kept issue becomes one sentence, `Region <A1> on "<sheet>": <the rule's message>.`, in the shared input error (with #1008's bounds problems, capped at 20).
- **Why reuse the schema:** the rules stay in one place, so a refinement added later is enforced at the input automatically. A hand-written copy of a dozen rules would drift.
- **Why filter by path:** fields interpret repairs (cell-value and intersection fields, non-user segments) must not be refused, or hints that work today would 400. The survey's 5 OK cases are the regression set.
- **Rejected:**
  - mapping the final parse's ZodError to a 400 wholesale, which would answer real parser bugs with a 400 that blames the caller;
  - hand-written per-rule checks, which duplicate the schema and drift.
- **The messages** are the rules' own wording ("headerAxes entries must be unique"). These hints come from API clients or stale plans; the editor can't produce them. Precise field-level wording suits that reader.

## Plan — 1 slice

- **Files:** `src/interpret/stages/detect-regions.ts` (the skeleton check, the path filter, and its sentences into the shared problems list).
- **Tests (first, red):**
  - `src/interpret/stages/__tests__/detect-regions.test.ts`: each of the 12 surveyed cases throws `UNSUPPORTED_LAYOUT_SHAPE` naming the region and the rule; each of the 5 OK cases still passes stage 1; a hint with problems on two regions is named in one error;
  - `src/interpret/__tests__/` (end to end): a hint with a duplicated header axis rejects with the input error, with a mock classifier never called.
  - `npm run test:unit` in `packages/spreadsheet-parsing`, then build it for the API.

## Smoke (manual, against your dev stack) — backend

The editor can't produce these hints, so the smoke runs against the API (`POST /api/layout-plans/interpret`, a File Upload session for `supported_layouts.csv`, region `B67:G71`).

1. `headerAxes: ["row", "column"]`, `axisAnchorCell: { row: 9, col: 9 }` → 400 `UNSUPPORTED_LAYOUT_SHAPE: Region B67:G71 on "supported_layouts": axisAnchorCell must be within the region's bounds.`, not a 500. — backend
2. `headerAxes: ["row", "row"]` → 400 naming "headerAxes entries must be unique". — backend
3. `headerAxes: ["row"]`, `recordsAxis: "row"` → 400 naming "recordsAxis is only allowed when headerAxes is empty". — backend
4. `B67:G71` with `headerAxes: ["row"]` and no segments → 200, unchanged; with a cell-value field and no pivot → 200 (reconciled, #998). — backend
5. In the wizard: draw `B67:G71`, bind it, add a row axis and a pivot segment, Interpret → Review as before.

## Out of scope

- Hint fields no rule checks (an `identityStrategy` locator outside the region).
- The request schema itself (`RegionHintSchema`): left as is, so a stored plan replayed as hints and the editor's hints keep going through one path.
