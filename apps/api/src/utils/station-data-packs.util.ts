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
 * Whether any of a station's configured built-in packs reads or writes entity
 * data. Pass the configured set (effective and unentitled alike): the question
 * is what the station is set up for, not what the plan currently allows.
 */
export function usesStationData(slugs: readonly string[]): boolean {
  return slugs.some(
    (slug) => isBuiltinToolpackSlug(slug) && PACK_USES_STATION_DATA[slug]
  );
}
