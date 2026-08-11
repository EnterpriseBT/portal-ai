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
