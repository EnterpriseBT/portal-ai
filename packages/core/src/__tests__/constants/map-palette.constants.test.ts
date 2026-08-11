import { describe, expect, it } from "@jest/globals";

import { SEQUENTIAL_PALETTE } from "../../constants/map-palette.constants.js";

describe("SEQUENTIAL_PALETTE (#336)", () => {
  it("has at least two ordered ramp stops", () => {
    expect(SEQUENTIAL_PALETTE.length).toBeGreaterThanOrEqual(2);
  });

  it("is entirely #rrggbb hex colours", () => {
    for (const color of SEQUENTIAL_PALETTE) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
