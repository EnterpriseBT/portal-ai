# A cellValueField without a pivot fails commit and re-interpret — Condensed design (#998)

**Issue:** [EnterpriseBT/portal-ai#998](https://github.com/EnterpriseBT/portal-ai/issues/998) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** After Interpret, the web merges the user's region config over interpret's plan (`preserveUserRegionConfig`). It takes the user's segments (no pivot) but keeps interpret's `cellValueField`, which the region schema allows only alongside a pivot. Commit then refuses the plan (`400 LAYOUT_PLAN_INVALID_PAYLOAD`). The draft carries that `cellValueField` into the next interpret hint, and interpret copies it onto the region and fails its own final plan parse with a Zod error, which the route answers as a 500. Packages: `apps/web` (the merge) and `packages/spreadsheet-parsing` (the hint schema the API validates requests with).

## Current shape

| Piece | Location | Note |
|---|---|---|
| Merge after Interpret | `apps/web/src/workflows/FileUploadConnector/utils/layout-plan-mapping.util.ts:181` (`preserveUserRegionConfig`) | spreads interpret's region, then replaces `segmentsByAxis` with the user's; touches `cellValueField` only when the prior draft had one |
| Callers | the file-upload, Google Sheets and Microsoft Excel workflows | the merged plan becomes the drafts and is what Commit sends |
| The panel's own sync | `apps/web/src/modules/RegionEditor/RegionConfigurationPanel.component.tsx:132` (`withPivotSync`) | already adds or drops `cellValueField` as the user edits segments; the merge is the path that skips it |
| Region rule | `packages/spreadsheet-parsing/src/plan/region.schema.ts:405` | refinement 7: `cellValueField` required iff ≥1 pivot; 6a: intersection keys must name pivots on both axes |
| Hint schema | `packages/spreadsheet-parsing/src/plan/interpret-input.schema.ts:19` (`RegionHintSchema`) | no such rule; the interpret routes validate request bodies with it |
| Where the 500 comes from | `packages/spreadsheet-parsing/src/interpret/stages/detect-regions.ts:41`, `interpret/index.ts:57` | the hint's `cellValueField` is copied onto the region; `LayoutPlanSchema.parse` throws; `interpretFailure` maps a non-input error to 500 |

## Decision — reconcile in the merge, and refuse the contradiction at the request boundary

- **Web (the fix):** after `preserveUserRegionConfig` merges a region, apply the same rule the panel applies:
  - with no pivot segment, drop `cellValueField` and `intersectionCellValueFields`;
  - with a pivot and no `cellValueField`, keep interpret's, or default to `{ name: "value", nameSource: "user" }` as the panel does;
  - drop any `intersectionCellValueFields` entry whose key no longer names a row and a column pivot.

  `regionDraftsToHints` applies the same reconciliation, so a stale draft can't send a contradictory hint either.
- **Server (a 400, not a 500):** `RegionHintSchema` gets the rule refinements 7 and 6a state. When a hint carries `segmentsByAxis`, a `cellValueField` with no pivot segment, or an intersection key naming a missing pivot, fails with the region schema's wording. The interpret routes already answer a body failure with `400 LAYOUT_PLAN_INVALID_PAYLOAD` naming the field (`regionHints.0.cellValueField`).
  - The rule applies only when the hint gives segments. Without them interpret may detect pivots itself, so a `cellValueField` there is legitimate.
- Rejected: dropping the field silently on the server. It would hide a client bug that the web fix should never produce again.
- Rejected: mapping the final plan's Zod error to 400. That error can also be an interpreter bug, which should stay a 500.

## Plan — 2 slices

**Slice 1 — web merge.**
- Files: `layout-plan-mapping.util.ts`: a `reconcileCellValueFields(region)` used by `preserveUserRegionConfig` and `regionDraftsToHints`.
- Tests (`apps/web/src/workflows/FileUploadConnector/__tests__/layout-plan-mapping.util.test.ts`):
  - the #998 shape (user field-only segments, response pivot plus `cellValueField`) merges with no `cellValueField`;
  - user segments with a pivot keep interpret's `cellValueField`, or get the default;
  - an intersection entry for a removed pivot is dropped;
  - `regionDraftsToHints` drops a stale `cellValueField`.
- Command: `cd apps/web && npm run test:unit -- --testPathPattern layout-plan-mapping`.

**Slice 2 — hint rule.**
- Files: `interpret-input.schema.ts`.
- Tests:
  - the schema's own tests: a hint with field-only segments plus `cellValueField` fails at `cellValueField`; one with a pivot passes; one without segments passes; an intersection key naming a missing pivot fails;
  - an api route test: interpret with that hint answers `400 LAYOUT_PLAN_INVALID_PAYLOAD` naming `regionHints.0.cellValueField`.
- Commands: `npm run build --workspace=packages/spreadsheet-parsing`, then `cd packages/spreadsheet-parsing && npm run test:unit` and the api route test.

## Smoke (manual, against your dev stack)

1. Upload `supported_layouts.csv`. Draw `B22:F27` (the "Single Axis Static" table), pick an entity, add a row header axis, and Interpret. Review loads.
2. Commit plan: the connector is created (no 400).
3. Repeat step 1, then Back to regions, narrow End col to E, and Interpret again: Review loads (no 500).
4. On a pivoted layout (the CSV's "Pivot" table), Interpret, then Commit: the cell-value chip is still there and the commit succeeds.

## Out of scope

- Changing what interpret proposes (a date column classified as a pivot) — the user's segments win, as they do today.
