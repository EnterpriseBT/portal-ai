export const ENTITY_COLOR_PALETTE: readonly string[] = [
  "#2563eb",
  "#db2777",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#dc2626",
  "#0891b2",
  "#9333ea",
  "#16a34a",
  "#ea580c",
  "#4f46e5",
  "#be185d",
];

export function colorForEntity(
  entityId: string | null | undefined,
  entityOrder: string[]
): string {
  if (!entityId) return "#64748b";
  const index = entityOrder.indexOf(entityId);
  if (index < 0) return "#64748b";
  return ENTITY_COLOR_PALETTE[index % ENTITY_COLOR_PALETTE.length] ?? "#64748b";
}

export function confidenceBand(
  score: number | undefined
): "green" | "yellow" | "red" | "none" {
  if (score === undefined) return "none";
  if (score >= 0.85) return "green";
  if (score >= 0.6) return "yellow";
  return "red";
}

export const CONFIDENCE_BAND_COLOR: Record<
  "green" | "yellow" | "red" | "none",
  string
> = {
  green: "#16a34a",
  yellow: "#ca8a04",
  red: "#dc2626",
  none: "#94a3b8",
};

/**
 * Theme-aware variant of `CONFIDENCE_BAND_COLOR` — maps each band to a MUI
 * palette token usable directly in `sx` props (e.g. `borderColor:
 * CONFIDENCE_BAND_PALETTE[band]`). Prefer this in new code so colors track
 * the active theme (light / dark / brand) instead of the hardcoded hex
 * values; `CONFIDENCE_BAND_COLOR` remains for cases that need a raw hex
 * (e.g. alpha-blending via concatenation, where token resolution doesn't
 * apply).
 */
export const CONFIDENCE_BAND_PALETTE: Record<
  "green" | "yellow" | "red" | "none",
  string
> = {
  green: "success.main",
  yellow: "warning.main",
  red: "error.main",
  none: "text.disabled",
};
