/**
 * The sheet canvas's stacking order, lowest first (#1005).
 *
 * Every layer except `corner` is a sibling in one stacking context: the
 * canvas's overlay wrapper and its rows set no z-index, so these values
 * compare directly. A layer rendered inside another positioned element with
 * a z-index is ordered only within that element, so a layer that must win
 * against these is rendered beside them, never inside one (the resize
 * handles sit beside their region overlay for that reason).
 *
 * The values are integers because CSS `z-index` accepts nothing else: a
 * fractional value computes to `auto`, which once left an editable pivot ×
 * pivot block under the selected region, so a click on it moved the region
 * instead. Each layer has its own value, so no order falls back to the DOM.
 *
 * To add a layer, renumber: never reach for a fraction.
 * `sheet-canvas-layers.guard.test.ts` fails on a z-index in the module that
 * doesn't read this scale.
 */
export const SHEET_LAYER = {
  /** Header / axis-label / skipped decoration bands. */
  decoration: 1,
  /** A non-editable intersection tint: above decorations, below segments. */
  intersection: 2,
  /** A per-segment tint and chip: above the generic decorations. */
  segment: 3,
  /** The drag-select marquee. */
  marquee: 4,
  /** A region outline and its extension fades. */
  region: 5,
  /** The selected region, above the others. */
  regionSelected: 6,
  /** An editable intersection block: above the selected region, so its
   *  click opens the editor instead of starting a region drag. */
  editableIntersection: 7,
  /** A selected region's resize handles, above any block they overlap. */
  handle: 8,
  /** An axis divider's hit area, above the selected region's header band. */
  divider: 9,
  /** The sticky row-number column: above every overlay, like a frozen
   *  pane, so overlays scroll under it and its clicks reach it. */
  rowHeader: 10,
  /** The sticky column-letter row, above the row header where they cross. */
  headerRow: 11,
  /** The corner cell. It lives inside the header row, so this orders it only
   *  against the column headers it covers when scrolled sideways. */
  corner: 1,
} as const;
