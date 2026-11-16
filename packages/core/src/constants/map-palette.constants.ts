/**
 * Ordered, colourblind-safe multi-hue ramp for continuous (`interpolate`)
 * colorBy (#336). Distinct from the categorical Tableau-10 palette used by
 * `match`/`step`: a smooth gradient needs a perceptually monotonic sequence,
 * not a set of distinct hues. Defined once here so the web renderer
 * (`resolveColorBy`) and the api back-fill (`visualize_map`) share one
 * definition — no per-surface palette drift.
 *
 * The six stops are the viridis ramp (dark violet → teal → green → yellow).
 */
export const SEQUENTIAL_PALETTE = [
  "#440154",
  "#414487",
  "#2a788e",
  "#22a884",
  "#7ad151",
  "#fde725",
] as const;

/**
 * The land colour of the CARTO basemap each theme's map draws on (#1022):
 * the `background` layer's `background-color` in
 * https://basemaps.cartocdn.com/gl/positron-gl-style/style.json (light) and
 * https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json (dark),
 * read 2026-11-15. `theme-contrast.test.ts` holds every `dataViz` colour at
 * ≥3:1 against them; re-read both if CARTO restyles.
 */
export const BASEMAP_BACKGROUND = {
  light: "#fafaf8",
  dark: "#0e0e0e",
} as const;
