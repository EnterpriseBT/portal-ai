import {
  isBuiltinToolpackSlug,
  type BuiltinToolpackSlug,
} from "@portalai/core/registries";

/**
 * #848: whether a built-in pack works on the station's attached data.
 *
 * A station carrying none of these is complete with no views or connectors:
 * the provisioned Administrate station has only the access pack. On such a
 * station the absence of data isn't a gap, so `platform_help` doesn't give it
 * as the reason an answer came back empty and the system prompt doesn't tell
 * the agent that data is missing.
 *
 * Exhaustive over the slugs, so a new pack has to be classified to compile.
 */
export const PACK_USES_STATION_DATA: Record<BuiltinToolpackSlug, boolean> = {
  data_query: true,
  statistics: true,
  regression: true,
  financial: true,
  visualize: true,
  gis: true,
  entity_management: true,
  // Control-plane and off-station work.
  rbac_management: false,
  view_management: false,
  web_search: false,
};

/**
 * Whether a station is set up to read or write entity data. Pass the
 * configured built-in set (effective and unentitled alike): the question is
 * what the station is set up for, not what the plan currently allows.
 *
 * An attached custom pack counts, whether or not the plan includes custom
 * packs, for the same reason. A custom tool can take the station's records as
 * input (`consumption` in docs/CUSTOM_TOOLPACK_INTEGRATION.md), and nothing
 * here can classify one, so the safe reading is that it does. One the plan
 * excludes is named to the user as a plan limit (#1045), like an excluded
 * built-in pack.
 */
export function usesStationData(
  builtinSlugs: readonly string[],
  hasCustomPack: boolean
): boolean {
  return (
    hasCustomPack ||
    builtinSlugs.some(
      (slug) => isBuiltinToolpackSlug(slug) && PACK_USES_STATION_DATA[slug]
    )
  );
}
