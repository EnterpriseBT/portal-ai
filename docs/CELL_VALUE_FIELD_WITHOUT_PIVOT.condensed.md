# A cellValueField without a pivot fails commit and re-interpret — Condensed design (#998)

**Issue:** [EnterpriseBT/portal-ai#998](https://github.com/EnterpriseBT/portal-ai/issues/998) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** After Interpret, the web merges the user's region config over interpret's plan (`preserveUserRegionConfig`). It always puts the user's segments back, even when they're only the full-span field segment the editor seeds on "+ Add row axis". Interpret replaces such a seed with what it detects (a date column as a pivot), and its bindings and `cellValueField` follow that. So the merged region had a pivot-less segment, interpret's `cellValueField` (which the region schema allows only alongside a pivot) and no binding for the date column. Commit then refuses the plan (`400 LAYOUT_PLAN_INVALID_PAYLOAD`). The draft carries that `cellValueField` into the next interpret hint, and interpret copies it onto the region and fails its own final plan parse with a Zod error, which the route answers as a 500. Packages: `apps/web` (the merge), `packages/spreadsheet-parsing` (interpret and the shared rule) and `packages/core` (re-export).

## Current shape

| Piece | Location | Note |
|---|---|---|
| Merge after Interpret | `apps/web/src/workflows/FileUploadConnector/utils/layout-plan-mapping.util.ts:181` (`preserveUserRegionConfig`) | spreads interpret's region, then replaces `segmentsByAxis` with the user's; touches `cellValueField` only when the prior draft had one |
| Callers | the file-upload, Google Sheets and Microsoft Excel workflows | the merged plan becomes the drafts and is what Commit sends |
| The panel's own sync | `apps/web/src/modules/RegionEditor/RegionConfigurationPanel.component.tsx:132` (`withPivotSync`) | already adds or drops `cellValueField` as the user edits segments; the merge is the path that skips it |
| Interpret's own precedence | `packages/spreadsheet-parsing/src/interpret/stages/pivoted.util.ts` (`resolveEffectiveSegments`) | keeps a hint's segments only when the user authored them (a user-named pivot, or field header/skip overrides); otherwise detect-segments wins |
| Region rule | `packages/spreadsheet-parsing/src/plan/region.schema.ts:405` | refinement 7: `cellValueField` required iff ≥1 pivot; 6a: intersection keys must name pivots on both axes |
| Where the 500 comes from | `packages/spreadsheet-parsing/src/interpret/stages/detect-regions.ts:41`, `interpret/index.ts:57` | the hint's `cellValueField` is copied onto the region; `LayoutPlanSchema.parse` throws; `interpretFailure` maps a non-input error to 500 |

## Decision — interpret settles cell-value fields; the merge keeps the segments interpret kept

- **Interpret, the server fix:** once `proposeBindings` has settled a region's segments, it applies the cell-value rule (`reconcileCellValueFields`, in `spreadsheet-parsing/src/plan/cell-value-fields.util.ts`):
  - no pivot means no `cellValueField` and no intersection fields;
  - a pivot without a `cellValueField` gets interpret's default `{ name: "value", nameSource: "ai" }`;
  - an intersection key must name a row and a column pivot on a two-axis region.

  A hint's cell-value fields are copied onto the region as given, but its segments win only when user-authored, so the two could disagree and fail the final plan parse as a 500. Any hint the request schema accepts now interprets to a valid plan.
- **Web, the fix for Commit:** `preserveUserRegionConfig` puts the user's segments back only when interpret would have kept them, by interpret's own rule, exported as `segmentsAreUserAuthored`. It tests only the segments on the region's header axes, which is what the hint sent. Otherwise interpret's segments, bindings and `cellValueField` stay together. The merged region then goes through the same `reconcileCellValueFields`, which the web takes from core's contracts so the rule lives in one place.
- **Changed after code review:** a first version refused contradictory hints at the request boundary with a 400. Interpret, not the request, decides the final segments, so that check passed hints that still failed (an AI-named pivot that wasn't detected; a user pivot with no cell-value field; no segments plus a user cell-value field), and refused one interpret could handle. Reconciling inside interpret covers them all.
- **Found during smoke:** dropping only the `cellValueField` turned Commit's 400 into a drift halt, because the date column was left unbound. Hence the segment rule.
- Rejected: mapping the final plan's Zod error to 400. It would also hide real interpreter bugs.

## Plan — 3 slices

**Slice 1 — the cell-value rule, shared.**
- Files: `spreadsheet-parsing/src/plan/cell-value-fields.util.ts`, exported through `plan/index.ts` and core's `spreadsheet-parsing.contract.ts`.
- Tests: `src/plan/__tests__/cell-value-fields.util.test.ts`.

**Slice 2 — interpret applies it.**
- Files: `interpret/stages/propose-bindings.ts`.
- Tests: `src/interpret/__tests__/cell-value-fields.interpret.test.ts`. Each case is a hint that used to fail the final parse: an undetected AI pivot, a user pivot with no `cellValueField`, no segments plus a user `cellValueField`, and intersection fields on a one-axis region.

**Slice 3 — the web merge.**
- Files: `spreadsheet-parsing/src/interpret/stages/pivoted.util.ts` (`segmentsAreUserAuthored`) and `layout-plan-mapping.util.ts`.
- Tests: `layout-plan-mapping.util.test.ts`:
  - the #998 shape keeps interpret's segments and `cellValueField`;
  - user-authored pivot-less segments drop it;
  - a user pivot gets the default;
  - a stale pivot on a removed axis doesn't win.
- Commands: `cd packages/spreadsheet-parsing && npm run test:unit`; `cd apps/web && npm run test:unit -- --testPathPattern layout-plan-mapping`.

## Smoke (manual, against your dev stack)

1. Upload `supported_layouts.csv`. Draw `B22:F27` (the "Single Axis Static" table), pick an entity, add a row header axis, and Interpret. Review loads.
2. Commit plan: the connector is created (no 400, no drift halt), and its entity has a field mapping for every column, the date pivot and its value included.
3. Repeat step 1, then Back to regions, narrow End col to E, and Interpret again: Review loads (no 500).
4. On a pivoted layout (the CSV's "Pivot" table), Interpret, then Commit: the cell-value chip is still there and the commit succeeds. — blocked: Interpret answers 500 on this table on `main` too (a separate bug, filed separately)

## Out of scope

- Changing what interpret proposes (a date column classified as a pivot) — the user's segments win, as they do today.
