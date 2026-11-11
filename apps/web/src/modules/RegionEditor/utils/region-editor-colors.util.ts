/** How many entity colours each theme defines (`palette.sheet.entities`). */
export const ENTITY_SLOT_COUNT = 12;

/**
 * An entity's colour slot, for `data-entity` on whatever wears its colour
 * (#996). The theme maps each slot to a mode-specific colour, so a region
 * reads the same entity in both themes at AA. "none" is a region with no
 * entity, or an entity not in the order.
 */
export function entitySlot(
  entityId: string | null | undefined,
  entityOrder: string[]
): string {
  if (!entityId) return "none";
  const index = entityOrder.indexOf(entityId);
  return index < 0 ? "none" : String(index % ENTITY_SLOT_COUNT);
}

export function confidenceBand(
  score: number | undefined
): "green" | "yellow" | "red" | "none" {
  if (score === undefined) return "none";
  if (score >= 0.85) return "green";
  if (score >= 0.6) return "yellow";
  return "red";
}
