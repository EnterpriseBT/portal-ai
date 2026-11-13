/**
 * The site's theme (#798): how it's stored, resolved before first paint, and
 * switched by the header toggle (an APG toggle button named "Dark theme",
 * pressed while the dark theme is on).
 *
 * The choice is stored the way the app stores it (`THEME_STORAGE_KEY`, a JSON
 * string naming a theme), so it travels with the visitor into the product.
 * The key and names come from `@portalai/core/constants`, one source for both
 * surfaces. The head script that resolves the theme before first paint is
 * generated here from the same function the toggle uses (`themeHeadScript`),
 * so the two can't drift.
 */

import {
  DARK_THEME_NAME,
  LIGHT_THEME_NAME,
  THEME_STORAGE_KEY,
} from "@portalai/core/constants";

export { THEME_STORAGE_KEY };

export type SiteTheme = "light" | "dark";
export type ThemeName = typeof LIGHT_THEME_NAME | typeof DARK_THEME_NAME;

export const toThemeName = (theme: SiteTheme): ThemeName =>
  theme === "dark" ? DARK_THEME_NAME : LIGHT_THEME_NAME;

export const nextTheme = (theme: SiteTheme): SiteTheme =>
  theme === "dark" ? "light" : "dark";

/** The toggle's `aria-pressed` value: pressed means the dark theme is on. */
export const pressedFor = (theme: SiteTheme): "true" | "false" =>
  theme === "dark" ? "true" : "false";

/** The toggle's tooltip names what a click does: the pressed state is only
 *  announced to assistive technology, and the icon shows the current theme. */
export const titleFor = (theme: SiteTheme): string =>
  theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

/**
 * Self-contained on purpose: `themeHeadScript` embeds this function's source,
 * so it may read only its parameters (no imports, no outer names).
 */
function resolveWith(
  stored: string | null,
  prefersDark: boolean,
  lightName: string,
  darkName: string
): SiteTheme {
  try {
    const name = stored ? JSON.parse(stored) : null;
    if (name === darkName) return "dark";
    if (name === lightName) return "light";
    return prefersDark ? "dark" : "light";
  } catch {
    return "light";
  }
}

/**
 * The theme a stored value resolves to: an explicit choice wins, otherwise
 * the system preference. An unreadable value resolves to light.
 */
export const resolveTheme = (
  stored: string | null,
  prefersDark: boolean
): SiteTheme =>
  resolveWith(stored, prefersDark, LIGHT_THEME_NAME, DARK_THEME_NAME);

/**
 * The inline, synchronous head script (`Base.astro`): sets `data-theme` before
 * first paint, so the light theme never flashes before dark, and `data-js`,
 * which the toggle's CSS waits on so it appears without a reflow and stays
 * out of the way with JS off. Storage can throw (private mode): light then.
 */
export const themeHeadScript = (): string =>
  [
    "(function () {",
    "  var root = document.documentElement;",
    '  root.setAttribute("data-js", "");',
    '  var theme = "light";',
    "  try {",
    `    theme = (${resolveWith.toString()})(`,
    `      localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}),`,
    '      window.matchMedia("(prefers-color-scheme: dark)").matches,',
    `      ${JSON.stringify(LIGHT_THEME_NAME)},`,
    `      ${JSON.stringify(DARK_THEME_NAME)}`,
    "    );",
    "  } catch (e) {}",
    '  root.setAttribute("data-theme", theme);',
    "})();",
  ].join("\n");
