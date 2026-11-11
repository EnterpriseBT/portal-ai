# A header axis with no header row — Condensed design (#1002)

**Issue:** [EnterpriseBT/portal-ai#1002](https://github.com/EnterpriseBT/portal-ai/issues/1002) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Interpret answers `500 LAYOUT_PLAN_INTERPRET_FAILED` ("Something went wrong") whenever a region declares a header axis but no row (or column) in it scores as a header. The API log carries the real error: the final `LayoutPlanSchema.parse` fails with `headerStrategyByAxis.row is required when "row" ∈ headerAxes`.

The issue's repro region isn't the pivot table. The CSV's quoted multi-line cells shift its rows, so the editor (and interpret) put "Account, Product, 2020…2023" at rows 67–71. `B72:G75` is a blank row, a one-cell note, another blank and a title in column A. The real table, `B67:G71`, interprets fine (`field × 2` + `pivot × 4`).

The 500 itself is real and wider than the repro: a **one-column region with a header** (`B67:B71`, "Account" over four names) fails the same way. That's a legitimate region a user can draw. The change is in `packages/spreadsheet-parsing` only; the AI stages aren't involved (the bare parser fails identically).

## Current shape

| Piece | Location | Note |
|---|---|---|
| Header scoring | `packages/spreadsheet-parsing/src/interpret/stages/detect-headers.ts:22-40` | `scoreHeaderRow` returns 0 below two non-empty cells (meant to skip a title row) |
| Candidates | `detect-headers.ts:69-113`, stage at `:127-145` | only rows/columns scoring > 0 become candidates; none → empty list |
| Strategy | `interpret/stages/propose-bindings.ts:220-231` | writes `headerStrategyByAxis[axis]` from the best candidate; with none it `continue`s and writes nothing |
| The parse | `plan/region.schema.ts:338-352`, `interpret/index.ts` (`assemblePlan`) | refinement 6 rejects the region, and the throw becomes the route's 500 |
| Error mapping | `apps/api/src/utils/interpret-error.util.ts:9-23` | `UNSUPPORTED_LAYOUT_SHAPE: …` / `UNKNOWN_SHEET: …` → 400 with the message; anything else → scrubbed 500 |
| Model stages | `interpret/index.ts` (classify, recommend axis names) | run after detect-headers, so a doomed region still pays for model calls |

## Decision 1 — a one-cell-wide header axis can score

- **The problem:** the two-label minimum separates a header from a title in a *wide* region. In a region one cell wide on that axis, a single label is the whole header.
- **Chosen:** where the region is one cell wide along the header (columns for a row header, rows for a column header), one **text** label scores. A number alone is a data value and never a header (code review). A one-column region's top text cell then scores, and the existing ranking picks it as usual.
- **Rejected:** always falling back to the first row. In a wide region whose top row is a lone title, that would silently bind a title as the only header and leave blank field names.

## Decision 2 — no header on a declared axis is the user's input error (400), raised before any model call

- **Chosen:** at the end of `detectHeaders`, every declared header axis with no candidate, across all regions, goes into one `UNSUPPORTED_LAYOUT_SHAPE: …` error, so one round trip names them all (code review).
- **The message** gives one sentence per region and axis, naming the region and what to change, e.g. `UNSUPPORTED_LAYOUT_SHAPE: Region B72:G75 on "supported_layouts" has no header row (no row in it has two or more labels). Redraw it to include its header row, or remove its row header axis.` For a column axis it says "header column" / "column header axis". A one-cell-wide region's reason reads "has a text label". The range comes from a shared `formatA1Range` (`workbook/a1.ts`).
- **How it reaches the user:** `interpretFailure` already maps that prefix to a 400 carrying the message, and the wizard shows the server message.
- **Why in detect-headers:** it fails before the classifier and axis-name recommender, so a region that can't produce a plan costs no model call.
- **Rejected:**
  - making the API catch the schema error. The parser would still assemble an invalid plan, and every other caller (replay, re-interpret) would need the same catch;
  - dropping the axis silently. The user declared it, so guessing "headerless" changes the meaning of their region.

## Plan — 1 slice

- **Files:** `interpret/stages/detect-headers.ts` (the one-cell-wide rule and the input error); new `workbook/a1.ts` (`columnLetters`, `formatA1Range`, exported from `workbook/index.ts`).
- **Tests (first, red):**
  - `interpret/stages/__tests__/detect-headers.test.ts`:
    - a one-column region scores its top cell, and a one-row region with a column header does the same;
    - a one-column region of numbers (or a blank over numbers) throws, with the text-label reason;
    - a wide region with no two-label row throws the message naming its A1 range and axis;
    - two failing regions are named in one error;
  - `workbook/__tests__/a1.test.ts`: column letters to `AAA`, and a single cell collapsing;
  - `interpret/__tests__/` (beside `cell-value-fields.interpret.test.ts`): end to end, the one-column region interprets to a valid plan, and the no-header region rejects with the input error rather than a schema error, with a mock classifier and axis-name recommender that are never called;
  - `apps/api` `interpret-error.util` test (existing): the message maps to 400 (already covered by the prefix).
  - `npm run test:unit -- --testPathPattern "detect-headers|interpret"` in `packages/spreadsheet-parsing`; build it before the API picks it up.
- **Issue amendment:** the issue's repro coordinates and scope get corrected (`/ticket` amendment), since the region it names isn't the table.

## Smoke (manual, against your dev stack)

1. Connectors → File Upload → `supported_layouts.csv`. Draw `B67:G71` (the "Account, Product, 2020…2023" table), bind it, add a row axis, Interpret. Review loads with `field × 2` and a `year` pivot × 4 (unchanged; it already worked).
2. Draw `B67:B71` (the Account column alone), bind it, add a row axis, Interpret. Review loads with one field named from "Account".
3. Draw `B72:G75` (the note and blanks under the table), bind it, add a row axis, Interpret. The wizard stays on Draw regions and shows "Region B72:G75 on "supported_layouts" has no header row …". It doesn't show "Something went wrong", and the network response is a 400.

## Out of scope

- The header heuristic's scoring beyond the minimum.
- Auto-detecting a header row outside the drawn region.
