/**
 * The visitor's theme choice, shared by the app and the marketing site
 * (#798): both read and write `localStorage[THEME_STORAGE_KEY]` as a JSON
 * string naming one of these themes, so a choice made on one surface holds
 * on the other. The names are `ThemeProvider`'s `THEME_MAP` keys, which a
 * test holds equal.
 */
export const THEME_STORAGE_KEY = "portalai-theme";
export const LIGHT_THEME_NAME = "brand";
export const DARK_THEME_NAME = "brand.dark";
