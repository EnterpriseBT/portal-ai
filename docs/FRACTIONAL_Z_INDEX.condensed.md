# Integer layers on the sheet canvas — Condensed design (#1005)

**Issue:** [EnterpriseBT/portal-ai#1005](https://github.com/EnterpriseBT/portal-ai/issues/1005) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Epic child of #791 (follow-up from #996's smoke walk).

**Why.** A pointer user can't open an editable pivot × pivot block while its region is selected. The block's `zIndex: 6.5` and the segment overlay's `4.5` / the non-editable intersection's `4.4` are cast past tsc (`as unknown as number`), but CSS `z-index` takes integers only, so the browser computes `auto` and the selected region (`6`) wins hit-testing. The keyboard path works (2.1.1 holds), but the control looks clickable and isn't, and segment tints layer in source order rather than as intended. The fix is in `apps/web` only (RegionEditor).

## Current shape

All the layers below are siblings in one stacking context, except two. The overlay wrapper (`SheetCanvas.component.tsx:1390`) is `position: relative` with no z-index, so the sibling values compare directly. The exceptions:
- the corner sits inside the header row;
- the resize handles sit inside the region overlay, whose z-index makes it a stacking context, so their `7` orders them only inside it.

| Layer | Location | z-index today |
|---|---|---|
| row header (sticky) | `SheetCanvas.component.tsx:1112` | 2 |
| header row (sticky) | `SheetCanvas.component.tsx:1176` | 3 |
| corner header | `SheetCanvas.component.tsx:1195` | 4 |
| decoration bands | `SheetCanvas.component.tsx:1493` | 4 |
| marquee | `SheetCanvas.component.tsx:2021` | 4 |
| non-editable intersection | `SheetCanvas.component.tsx:1773` | **4.4 → auto** |
| segment overlay | `SheetCanvas.component.tsx:1585` | **4.5 → auto** |
| region overlay + extension fades | `RegionOverlay.component.tsx:192`, `:318`, `:335` | 5 (6 selected) |
| editable intersection | `SheetCanvas.component.tsx:1773` | **6.5 → auto** |
| resize handles | `RegionOverlay.component.tsx:279` | 7 |
| axis divider hit area | `SheetCanvas.component.tsx:1920` | 8 |

The fractional values came in with `547176b0` (crosstab per-intersection fields). The comments at `:1582-1584` and `:1766-1772` state the intended order, which the table follows.

## Decision — one named integer scale for the canvas layers

- **Chosen:** a `SHEET_LAYER` constant in `modules/RegionEditor/utils/sheet-layers.util.ts`. It has one distinct integer per layer, so no order falls back to the DOM, and every `zIndex` in the module reads from it:
  - `decoration` 1, `intersection` 2, `segment` 3, `marquee` 4;
  - `region` 5, `regionSelected` 6;
  - `editableIntersection` 7, `handle` 8, `divider` 9;
  - `rowHeader` 10, `headerRow` 11;
  - `corner` 1, inside the header row only.
- **Handles beside the overlay (code review):** with the block now above the selected region, handles nested in the overlay would sit under any block they overlap. They move to a sibling frame that repeats the overlay's box, so `handle` is a real global layer.
- **Sticky headers on top (code review, user decision):** the fractional tints used to compute `auto` and paint under the headers. Integers would have put them, and the editable block, over the headers. The headers now top the scale like a frozen pane: every overlay, region outlines and decorations included, scrolls under them, and header clicks always reach the header.
- **Why a constant, not just rounding the three values:** rounding has no free integers between 4 and 5, or between 6 and 7, so every layer above them shifts anyway. A named scale keeps the next insertion from reaching for another fraction.
- **The guard:** a source guard fails CI on a `zIndex` in the module whose value isn't `SHEET_LAYER.<layer>` (or a ternary of them), and also on:
  - a shorthand or variable `zIndex`;
  - a z-index spelled in a string.

  Unit tests hold every value an integer, distinct and in the order above, with the headers over every overlay. A canvas test holds the handles outside the overlay.
- **Rejected:** fixing it in the DOM order (moving the intersection blocks after the region overlays). The order would then live in JSX position, which is invisible, and the segment/intersection tints still need values.

## Plan — 1 slice

- **Files:** new `modules/RegionEditor/utils/sheet-layers.util.ts`; edit `SheetCanvas.component.tsx` and `RegionOverlay.component.tsx` to read `SHEET_LAYER`, dropping the casts and the stale numeric comments. The handles move to a sibling frame.
- **Tests (first, red):**
  - new `modules/RegionEditor/__tests__/sheet-layers.util.test.ts` (integers and order);
  - new `apps/web/src/__tests__/sheet-canvas-layers.guard.test.ts` (on `guard-source.util.ts`: every `zIndex` in the module reads `SHEET_LAYER`);
  - `__tests__/SheetCanvas.test.tsx`: the handles render beside the overlay;
  - existing `npm run test:unit -- --testPathPattern "RegionEditor|SheetCanvas|region-editor|sheet-canvas"` stays green.
- **Order with #996 (PR #1004):** #996 merged first, so this branch rebases onto it.

## Smoke (manual, against your dev stack)

1. Connectors → File Upload → upload `supported_layouts.xlsx`. On "Crosstab - Table 1", draw `B4:F9`, bind it, add a row axis and a column axis, each with a pivot segment. With the region still selected, hover the amber pivot × pivot block: it tints. Click it: its cell-value editor opens, and the region doesn't move.
2. In devtools, inspect the computed z-index with the region selected: the editable block reads `7`, the segment overlay `3`, the region `6`, the handle frame `8`. None reads `auto`.
3. Still selected, drag a resize handle and an axis divider: each still works (handles and dividers stay above the block).
4. Click the region body outside any block: it selects or moves as before. Tab to the block and press Enter: the editor opens (keyboard path unchanged).
5. Scroll the region under the sticky column-letter row and row-number column: the outline, tints and blocks pass under both headers, and clicking a header still draws its band.

## Out of scope

- Canvas colours (#996).
