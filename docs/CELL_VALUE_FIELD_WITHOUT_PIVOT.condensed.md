# A cellValueField without a pivot fails commit and re-interpret — Condensed design (#998)

**Issue:** [EnterpriseBT/portal-ai#998](https://github.com/EnterpriseBT/portal-ai/issues/998) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** After Interpret, the web merges the user's region config over interpret's plan (`preserveUserRegionConfig`). It always puts the user's segments back, even when they're only the full-span field segment the editor seeds on "+ Add row axis". Interpret replaces such a seed with what it detects (a date column as a pivot), and its bindings and `cellValueField` follow that. So the merged region had a pivot-less segment, interpret's `cellValueField` (which the region schema allows only alongside a pivot) and no binding for the date column. Commit then refuses the plan (`400 LAYOUT_PLAN_INVALID_PAYLOAD`). The draft carries that `cellValueField` into the next interpret hint, and interpret copies it onto the region and fails its own final plan parse with a Zod error, which the route answers as a 500. Packages: `apps/web` (the merge) and `packages/spreadsheet-parsing` (the hint schema the API validates requests with).

## Current shape

| Piece | Location | Note |
|---|---|---|
| Merge after Interpret | `apps/web/src/workflows/FileUploadConnector/utils/layout-plan-mapping.util.ts:181` (`preserveUserRegionConfig`) | spreads interpret's region, then replaces `segmentsByAxis` with the user's; touches `cellValueField` only when the prior draft had one |
| Callers | the file-upload, Google Sheets and Microsoft Excel workflows | the merged plan becomes the drafts and is what Commit sends |
| The panel's own sync | `apps/web/src/modules/RegionEditor/RegionConfigurationPanel.component.tsx:132` (`withPivotSync`) | already adds or drops `cellValueField` as the user edits segments; the merge is the path that skips it |
| Interpret's own precedence | `packages/spreadsheet-parsing/src/interpret/stages/pivoted.util.ts` (`resolveEffectiveSegments`) | keeps a hint's segments only when the user authored them (a user-named pivot, or field header/skip overrides); otherwise detect-segments wins |
| Region rule | `packages/spreadsheet-parsing/src/plan/region.schema.ts:405` | refinement 7: `cellValueField` required iff ≥1 pivot; 6a: intersection keys must name pivots on both axes |
| Hint schema | `packages/spreadsheet-parsing/src/plan/interpret-input.schema.ts:19` (`RegionHintSchema`) | no such rule; the interpret routes validate request bodies with it |
| Where the 500 comes from | `packages/spreadsheet-parsing/src/interpret/stages/detect-regions.ts:41`, `interpret/index.ts:57` | the hint's `cellValueField` is copied onto the region; `LayoutPlanSchema.parse` throws; `interpretFailure` maps a non-input error to 500 |

## Decision — the merge keeps the segments interpret kept; the cell-value rule backs it up

- **Web, the fix:** `preserveUserRegionConfig` puts the user's segments back only when interpret would have kept them, by the same rule interpret uses. `spreadsheet-parsing` exports it as `segmentsAreUserAuthored` (re-exported through core's contracts), so the two can't drift apart. Otherwise interpret's segments, bindings and `cellValueField` stay together.
- **Web, the backstop:** `reconcileCellValueFields` applies the panel's rule to every merged region, and to each hint that carries segments (without inventing a name there):
  - with no pivot, no `cellValueField` and no intersection fields;
  - a pivot gets a `cellValueField`;
  - an intersection entry must name existing pivots.
- **Server, a 400 rather than a 500:** `RegionHintSchema` gets the rule refinements 7 and 6a state. When a hint carries `segmentsByAxis`, a `cellValueField` with no pivot segment, or an intersection key naming a missing pivot, fails with the region schema's wording. The interpret routes already answer a body failure with `400 LAYOUT_PLAN_INVALID_PAYLOAD` naming the field. Without segments, interpret detects pivots itself, so there's nothing to check.
- **Found on the way:** dropping only the `cellValueField` (the first version of this fix) turned the 400 into a commit job that halted on drift, because the date column was left unbound. Hence the segment rule above.
- Rejected: silently dropping the field on the server, and mapping the final plan's Zod error to 400. The first hides a client bug; the second also hides interpreter bugs.

## Plan — 3 slices

**Slice 1 — web merge.**
- Files: `layout-plan-mapping.util.ts`: a `reconcileCellValueFields(region)` used by `preserveUserRegionConfig` and `regionDraftsToHints`.
- Tests (`apps/web/src/workflows/FileUploadConnector/__tests__/layout-plan-mapping.util.test.ts`):
  - the #998 shape (user field-only segments, response pivot plus `cellValueField`) merges with no `cellValueField`;
  - user segments with a pivot keep interpret's `cellValueField`, or get the default;
  - an intersection entry for a removed pivot is dropped;
  - `regionDraftsToHints` drops a stale `cellValueField`.
- Command: `cd apps/web && npm run test:unit -- --testPathPattern layout-plan-mapping`.

**Slice 3 — the merge keeps the segments interpret kept.**
- Files: `spreadsheet-parsing/src/interpret/stages/pivoted.util.ts` (`segmentsAreUserAuthored`, used by `resolveEffectiveSegments`) and its exports; `core/src/contracts/spreadsheet-parsing.contract.ts`; `layout-plan-mapping.util.ts`.
- Tests (`layout-plan-mapping.util.test.ts`):
  - the #998 shape keeps interpret's segments and `cellValueField`;
  - user-authored pivot-less segments are kept and drop interpret's `cellValueField`;
  - a user-named pivot gets the default when interpret proposed none.

**Slice 2 — hint rule.**
- Files: `interpret-input.schema.ts`.
- Tests:
  - the schema's own tests: a hint with field-only segments plus `cellValueField` fails at `cellValueField`; one with a pivot passes; one without segments passes; an intersection key naming a missing pivot fails;
  - an api route test: interpret with that hint answers `400 LAYOUT_PLAN_INVALID_PAYLOAD` naming `regionHints.0.cellValueField`.
- Commands: `npm run build --workspace=packages/spreadsheet-parsing`, then `cd packages/spreadsheet-parsing && npm run test:unit` and the api route test.

## Smoke (manual, against your dev stack)

1. Upload `supported_layouts.csv`. Draw `B22:F27` (the "Single Axis Static" table), pick an entity, add a row header axis, and Interpret. Review loads.
2. Commit plan: the connector is created (no 400, no drift halt), and its entity has a field mapping for every column, the date pivot and its value included.
3. Repeat step 1, then Back to regions, narrow End col to E, and Interpret again: Review loads (no 500).
4. On a pivoted layout (the CSV's "Pivot" table), Interpret, then Commit: the cell-value chip is still there and the commit succeeds. — blocked: Interpret answers 500 on this table on `main` too (a separate bug, filed separately)

## Out of scope

- Changing what interpret proposes (a date column classified as a pivot) — the user's segments win, as they do today.
