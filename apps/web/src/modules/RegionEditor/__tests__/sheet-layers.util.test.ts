import { SHEET_LAYER } from "../utils/sheet-layers.util";

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

  test("the sticky headers stack row header < header row < corner", () => {
    expect(SHEET_LAYER.rowHeader).toBeLessThan(SHEET_LAYER.headerRow);
    expect(SHEET_LAYER.headerRow).toBeLessThan(SHEET_LAYER.corner);
  });

  test("tints stack decoration < intersection < segment, under the region", () => {
    expect(SHEET_LAYER.decoration).toBeLessThan(SHEET_LAYER.intersection);
    expect(SHEET_LAYER.intersection).toBeLessThan(SHEET_LAYER.segment);
    expect(SHEET_LAYER.segment).toBeLessThan(SHEET_LAYER.region);
    expect(SHEET_LAYER.region).toBeLessThan(SHEET_LAYER.regionSelected);
  });

  test("an editable intersection sits above the selected region", () => {
    expect(SHEET_LAYER.editableIntersection).toBeGreaterThan(
      SHEET_LAYER.regionSelected
    );
  });

  test("resize handles and axis dividers stay on top", () => {
    expect(SHEET_LAYER.handle).toBeGreaterThan(
      SHEET_LAYER.editableIntersection
    );
    expect(SHEET_LAYER.divider).toBeGreaterThan(SHEET_LAYER.handle);
  });
});
