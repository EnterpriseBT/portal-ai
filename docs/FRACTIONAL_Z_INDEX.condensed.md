# Integer layers on the sheet canvas — Condensed design (#1005)

**Issue:** [EnterpriseBT/portal-ai#1005](https://github.com/EnterpriseBT/portal-ai/issues/1005) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Epic child of #791 (follow-up from #996's smoke walk).

**Why.** A pointer user can't open an editable pivot × pivot block while its region is selected. The block's `zIndex: 6.5` and the segment overlay's `4.5` / the non-editable intersection's `4.4` are cast past tsc (`as unknown as number`), but CSS `z-index` takes integers only, so the browser computes `auto` and the selected region (`6`) wins hit-testing. The keyboard path works (2.1.1 holds), but the control looks clickable and isn't, and segment tints layer in source order rather than as intended. The fix is in `apps/web` only (RegionEditor).

## Current shape

All the layers below are siblings in one stacking context: the overlay wrapper (`SheetCanvas.component.tsx:1390`) is `position: relative` with no z-index, so the values compare directly with each other.

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

- **Chosen:** a `SHEET_LAYER` constant in `modules/RegionEditor/utils/sheet-layers.util.ts`. It has one integer per layer, in the order the comments intend, and every `zIndex` in the module reads from it. Renumbered (relative order unchanged):
  - `rowHeader` 2, `headerRow` 3, `corner` 4, `decoration` 4, `marquee` 4;
  - `intersection` 5, `segment` 6;
  - `region` 7, `regionSelected` 8;
  - `editableIntersection` 9, `handle` 10, `divider` 11.
- **Why a constant, not just rounding the three values:** rounding has no free integers between 4 and 5, or between 6 and 7, so every layer above them shifts anyway. A named scale keeps the next insertion from reaching for another fraction.
- **The guard:** a source guard fails CI on any `zIndex:` in the module that doesn't read `SHEET_LAYER`, which also rules out the casts. A unit test holds every value an integer and holds the intended order:
  - editable intersection above the selected region;
  - segment above intersection above decoration;
  - handle and divider on top.
- **Rejected:** fixing it in the DOM order (moving the intersection blocks after the region overlays). The order would then live in JSX position, which is invisible, and the segment/intersection tints still need values.

## Plan — 1 slice

- **Files:** new `modules/RegionEditor/utils/sheet-layers.util.ts`; edit `SheetCanvas.component.tsx` and `RegionOverlay.component.tsx` to read `SHEET_LAYER`, dropping the casts and the stale numeric comments.
- **Tests (first, red):**
  - new `modules/RegionEditor/__tests__/sheet-layers.util.test.ts` (integers and order);
  - new `apps/web/src/__tests__/sheet-canvas-layers.guard.test.ts` (on `guard-source.util.ts`: every `zIndex` in the module reads `SHEET_LAYER`);
  - existing `npm run test:unit -- --testPathPattern "RegionEditor|SheetCanvas|region-editor|sheet-canvas"` stays green.
- **Order with #996 (PR #1004):** both edit the same overlay `sx` blocks. Whichever merges into the epic second rebases. The conflicts are adjacent lines (colours vs z-index), not overlapping logic.

## Smoke (manual, against your dev stack)

1. Connectors → File Upload → upload `supported_layouts.xlsx`. On "Crosstab - Table 1", draw `B4:F9`, bind it, add a row axis and a column axis, each with a pivot segment. With the region still selected, hover the amber pivot × pivot block: it tints. Click it: its cell-value editor opens, and the region doesn't move.
2. In devtools, inspect the computed z-index with the region selected: the editable block reads `9`, the segment overlay `6`, the region `8`. None reads `auto`.
3. Still selected, drag a resize handle and an axis divider: each still works (handles and dividers stay above the block).
4. Click the region body outside any block: it selects or moves as before. Tab to the block and press Enter: the editor opens (keyboard path unchanged).

## Out of scope

- Whether overlays should paint above the sticky headers when scrolled (today's order, kept).
- Canvas colours (#996).
