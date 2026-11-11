import { SHEET_LAYER } from "../utils/sheet-layers.util";

/** The layers that share the canvas's one stacking context. */
const { corner: _corner, ...SIBLING_LAYERS } = SHEET_LAYER;

describe("SHEET_LAYER (#1005)", () => {
  test("every layer is an integer, the only z-index CSS accepts", () => {
    // A fractional z-index computes to `auto`, which is how an editable
    // intersection ended up under the selected region.
    for (const [layer, value] of Object.entries(SHEET_LAYER)) {
      expect({ layer, integer: Number.isInteger(value) }).toEqual({
        layer,
        integer: true,
      });
    }
  });

  test("no two sibling layers tie, so no order falls back to the DOM", () => {
    const values = Object.values(SIBLING_LAYERS);
    expect(new Set(values).size).toBe(values.length);
  });

  test("the layers stack in the intended order, lowest first", () => {
    const order = [
      "decoration",
      "intersection",
      "segment",
      "marquee",
      "region",
      "regionSelected",
      "editableIntersection",
      "handle",
      "divider",
      "rowHeader",
      "headerRow",
    ] as const;
    expect(Object.keys(SIBLING_LAYERS).sort()).toEqual([...order].sort());
    const values = order.map((layer) => SHEET_LAYER[layer]);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  test("the sticky headers sit above every overlay", () => {
    const { rowHeader, headerRow, ...overlays } = SIBLING_LAYERS;
    for (const value of Object.values(overlays)) {
      expect(value).toBeLessThan(rowHeader);
      expect(value).toBeLessThan(headerRow);
    }
  });

  test("the corner sits above the column headers inside its row", () => {
    expect(SHEET_LAYER.corner).toBeGreaterThan(0);
  });
});
