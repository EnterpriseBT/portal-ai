import {
  CONFIDENCE_BAND_COLOR,
  ENTITY_COLOR_PALETTE,
  colorForEntity,
  confidenceBand,
} from "../utils/region-editor-colors.util";

describe("colorForEntity", () => {
  test("returns fallback for null entity id", () => {
    expect(colorForEntity(null, [])).toBe("#64748b");
  });

  test("returns fallback when entity not in order list", () => {
    expect(colorForEntity("ent_missing", ["ent_a"])).toBe("#64748b");
  });

  test("assigns palette colors deterministically by order", () => {
    const order = ["ent_a", "ent_b", "ent_c"];
    expect(colorForEntity("ent_a", order)).toBe(ENTITY_COLOR_PALETTE[0]);
    expect(colorForEntity("ent_b", order)).toBe(ENTITY_COLOR_PALETTE[1]);
    expect(colorForEntity("ent_c", order)).toBe(ENTITY_COLOR_PALETTE[2]);
  });

  test("cycles palette when order exceeds palette length", () => {
    const big = Array.from({ length: ENTITY_COLOR_PALETTE.length + 2 }, (_, i) => `e${i}`);
    const last = big[big.length - 1];
    expect(colorForEntity(last, big)).toBe(
      ENTITY_COLOR_PALETTE[(big.length - 1) % ENTITY_COLOR_PALETTE.length]
    );
  });
});

describe("confidenceBand", () => {
  test("undefined → 'none'", () => {
    expect(confidenceBand(undefined)).toBe("none");
  });

  test(">= 0.85 → green", () => {
    expect(confidenceBand(0.85)).toBe("green");
    expect(confidenceBand(0.99)).toBe("green");
  });

  test("0.60–0.85 → yellow", () => {
    expect(confidenceBand(0.6)).toBe("yellow");
    expect(confidenceBand(0.84)).toBe("yellow");
  });

  test("< 0.60 → red", () => {
    expect(confidenceBand(0)).toBe("red");
    expect(confidenceBand(0.59)).toBe("red");
  });
});

describe("CONFIDENCE_BAND_COLOR", () => {
  test("has colors for every band", () => {
    expect(CONFIDENCE_BAND_COLOR.green).toBeTruthy();
    expect(CONFIDENCE_BAND_COLOR.yellow).toBeTruthy();
    expect(CONFIDENCE_BAND_COLOR.red).toBeTruthy();
    expect(CONFIDENCE_BAND_COLOR.none).toBeTruthy();
  });
});
