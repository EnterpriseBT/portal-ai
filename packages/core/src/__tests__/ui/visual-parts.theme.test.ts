import { describe, it, expect } from "@jest/globals";

import { THEME_MAP } from "../../ui/ThemeProvider";

// #796: the chart/map figure, its feature list and the map's layout are styled
// from the theme (CLAUDE.md: no ad hoc sx in apps/web). The web components
// mark themselves with `data-visual-part`; every theme carries the same rules.

const part = (name: string) => `[data-visual-part][data-visual-part="${name}"]`;

const SELECTORS = [
  part("figure"),
  part("map-body"),
  part("map-main"),
  part("feature-panel"),
  part("feature-list"),
  part("feature-item"),
];

const baselineOf = (theme: (typeof THEME_MAP)[keyof typeof THEME_MAP]) =>
  (theme.components?.MuiCssBaseline?.styleOverrides ?? {}) as Record<
    string,
    unknown
  >;

describe("visual-part theme rules (#796)", () => {
  it.each(Object.keys(THEME_MAP))("%s styles every visual part", (name) => {
    const rules = baselineOf(THEME_MAP[name as keyof typeof THEME_MAP]);
    for (const selector of SELECTORS) {
      expect(rules[selector]).toEqual(expect.any(Object));
    }
  });

  it("keeps the layout the same in every theme", () => {
    const [first, ...rest] = Object.values(THEME_MAP).map((t) =>
      Object.fromEntries(SELECTORS.map((s) => [s, baselineOf(t)[s]]))
    );
    for (const other of rest) expect(other).toEqual(first);
  });

  it("puts the feature list beside the map only from md up", () => {
    const rules = baselineOf(
      THEME_MAP[Object.keys(THEME_MAP)[0] as keyof typeof THEME_MAP]
    );
    expect(rules[part("map-body")]).toMatchObject({
      '&[data-layout="side"]': {
        "@media (min-width:900px)": { display: "flex" },
      },
    });
  });
});
