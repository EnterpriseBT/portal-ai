/**
 * The site's theme toggle (#798): an APG toggle button named "Dark theme",
 * pressed while the dark theme is on.
 *
 * The theme is stored the way the app stores it (`portalai-theme`, a JSON
 * string: "brand" or "brand.dark"), so a visitor's choice travels with them
 * into the product. The head script in `layouts/Base.astro` resolves the theme
 * before first paint and must stay inline, so it can't import this module;
 * `resolveTheme` mirrors it exactly and the tests pin that behaviour.
 */

export type SiteTheme = "light" | "dark";
export type ThemeName = "brand" | "brand.dark";

export const THEME_STORAGE_KEY = "portalai-theme";

export const toThemeName = (theme: SiteTheme): ThemeName =>
  theme === "dark" ? "brand.dark" : "brand";

export const nextTheme = (theme: SiteTheme): SiteTheme =>
  theme === "dark" ? "light" : "dark";

/** The toggle's `aria-pressed` value: pressed means the dark theme is on. */
export const pressedFor = (theme: SiteTheme): "true" | "false" =>
  theme === "dark" ? "true" : "false";

/**
 * The theme a stored value resolves to: an explicit choice wins, otherwise
 * the system preference. An unreadable value resolves to light, as the head
 * script's `catch` does.
 */
export function resolveTheme(
  stored: string | null,
  prefersDark: boolean
): SiteTheme {
  try {
    const name = stored ? JSON.parse(stored) : null;
    if (name === "brand.dark") return "dark";
    if (name === "brand") return "light";
    return prefersDark ? "dark" : "light";
  } catch {
    return "light";
  }
}
