/**
 * The sheet canvas's stacking order, lowest first (#1005).
 *
 * Every layer here is a sibling in one stacking context (the canvas's
 * overlay wrapper sets no z-index), so these values compare directly. They
 * are integers because CSS `z-index` accepts nothing else: a fractional value
 * computes to `auto`, which once left an editable pivot × pivot block under
 * the selected region, so a click on it moved the region instead.
 *
 * To add a layer, renumber: never reach for a fraction.
 * `sheet-canvas-layers.guard.test.ts` fails on a `zIndex` in the module
 * that doesn't read this scale.
 */
export const SHEET_LAYER = {
  /** The sticky row-number column. */
  rowHeader: 2,
  /** The sticky column-letter row, above the row header where they cross. */
  headerRow: 3,
  /** The corner cell, above both header bands. */
  corner: 4,
  /** Header / axis-label / skipped decoration bands. */
  decoration: 4,
  /** The drag-select marquee. */
  marquee: 4,
  /** A non-editable intersection tint: above decorations, below segments. */
  intersection: 5,
  /** A per-segment tint and chip: above generic decorations. */
  segment: 6,
  /** A region outline and its extension fades. */
  region: 7,
  /** The selected region, above the others. */
  regionSelected: 8,
  /** An editable intersection block: above the selected region, so its
   *  click opens the editor instead of starting a region drag. */
  editableIntersection: 9,
  /** A selected region's resize handles. */
  handle: 10,
  /** An axis divider's hit area, above the selected region's header band. */
  divider: 11,
} as const;
