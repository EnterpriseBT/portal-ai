/**
 * Pricing-card labels (#615).
 *
 * Pack names come from the built-in toolpack registry, the same names the app
 * shows, rather than a title-cased slug: that read "Rbac Management" and "Gis"
 * on every card where the app says "Access & Roles" and "GIS".
 */

import type { PublicSiteTier } from "@portalai/core/contracts";
import { BUILTIN_TOOLPACK_BY_SLUG } from "@portalai/core/registries";

/** The registry name for a pack slug; an unknown slug renders as itself. */
export function packLabel(slug: string): string {
  const pack = (
    BUILTIN_TOOLPACK_BY_SLUG as Record<string, { name: string } | undefined>
  )[slug];
  return pack?.name ?? slug;
}

/** Plan features a card lists beyond its toolpacks, in display order. */
export function planFeatures(
  tier: Pick<
    PublicSiteTier,
    "customToolpacks" | "customRbac" | "advancedViewFilters"
  >
): string[] {
  const features: string[] = [];
  if (tier.customToolpacks) features.push("Your own webhook tools");
  if (tier.advancedViewFilters) features.push("Advanced (SQL) view filters");
  if (tier.customRbac) features.push("Custom roles & policies");
  return features;
}
