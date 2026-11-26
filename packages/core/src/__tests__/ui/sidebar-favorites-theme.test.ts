/**
 * #1077: the expanded sidebar sizes to its content, so the Favorites group's
 * empty hint and its entries (long names truncate, not wrap) must not add to
 * that width. `contain: inline-size` keeps them out of the drawer's
 * intrinsic width; jsdom can't measure it, so this pins the rule.
 */
import { THEME_MAP, type ThemeName } from "../../ui/ThemeProvider";

type Overrides = Record<string, Record<string, unknown>>;
const root = (theme: ThemeName, component: string) =>
  (
    THEME_MAP[theme].components as Record<
      string,
      { styleOverrides?: { root?: Overrides } }
    >
  )[component]?.styleOverrides?.root ?? {};

describe.each(Object.keys(THEME_MAP) as ThemeName[])(
  "sidebar favorites keep the drawer's width (%s)",
  (theme) => {
    it("contains a favorite entry's inline size", () => {
      expect(
        root(theme, "MuiListItemButton")["&.SidebarNavItem-nested"]
      ).toEqual(expect.objectContaining({ contain: "inline-size" }));
    });

    it("contains the empty hint's inline size", () => {
      expect(root(theme, "MuiList")["& .SidebarFavorites-hint"]).toEqual(
        expect.objectContaining({ contain: "inline-size" })
      );
    });
  }
);
