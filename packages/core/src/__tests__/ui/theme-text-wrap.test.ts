/**
 * #984: a long unbroken token (a 120-character name, a URL, an id) ran past a
 * dialog's edge and was clipped (WCAG 1.4.10). Both themes let dialog text
 * break anywhere it must. jsdom has no layout, so this pins the theme; the
 * smoke walk measures the overflow in a browser.
 */
import { THEME_MAP, type ThemeName } from "../../ui/ThemeProvider";

type RootOverride = { root?: Record<string, unknown> };

describe.each(Object.keys(THEME_MAP) as ThemeName[])(
  "%s dialog text wrapping (#984)",
  (name) => {
    const { components } = THEME_MAP[name];

    it.each(["MuiDialogContent", "MuiDialogTitle"] as const)(
      "%s breaks a long token and keeps its padding",
      (component) => {
        const root = (components?.[component]?.styleOverrides as RootOverride)
          ?.root;
        expect(root?.overflowWrap).toBe("anywhere");
        expect(root?.padding).toBeDefined();
      }
    );
  }
);
