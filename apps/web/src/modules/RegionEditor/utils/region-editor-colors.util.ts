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
