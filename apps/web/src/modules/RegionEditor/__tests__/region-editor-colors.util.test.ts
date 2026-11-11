import { THEME_MAP } from "@portalai/core/ui";

import {
  ENTITY_SLOT_COUNT,
  confidenceBand,
  entitySlot,
} from "../utils/region-editor-colors.util";

describe("entitySlot", () => {
  test("an unbound region is 'none'", () => {
    expect(entitySlot(null, [])).toBe("none");
  });

  test("an entity not in the order is 'none'", () => {
    expect(entitySlot("ent_missing", ["ent_a"])).toBe("none");
  });

  test("assigns slots by order", () => {
    const order = ["ent_a", "ent_b", "ent_c"];
    expect(entitySlot("ent_a", order)).toBe("0");
    expect(entitySlot("ent_b", order)).toBe("1");
    expect(entitySlot("ent_c", order)).toBe("2");
  });

  test("cycles past the last slot", () => {
    const big = Array.from(
      { length: ENTITY_SLOT_COUNT + 2 },
      (_, i) => `e${i}`
    );
    expect(entitySlot(big[ENTITY_SLOT_COUNT + 1], big)).toBe("1");
  });

  // Every slot needs a colour in every theme, or its regions render
  // uncoloured (#996). The colours' contrast is held in core.
  test.each(Object.keys(THEME_MAP) as (keyof typeof THEME_MAP)[])(
    "%s defines a colour for every slot",
    (name) => {
      expect(THEME_MAP[name].palette.sheet.entities).toHaveLength(
        ENTITY_SLOT_COUNT
      );
    }
  );
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
