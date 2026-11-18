import {
  isBuiltinToolpackSlug,
  type BuiltinToolpackSlug,
} from "./builtin-toolpacks.js";

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
 * #1045: how a station stands with entity data.
 * - `usable`: a pack whose tools exist in the session works on data. Missing
 *   views or connectors are a real gap.
 * - `plan-excluded`: packs that work on data are attached, but the plan
 *   excludes every one of them. The plan is the reason nothing here reads
 *   data; attaching a view would change nothing.
 * - `none`: no pack on the station works on data. That is how it is set up.
 */
export type StationDataSetup = "usable" | "plan-excluded" | "none";

/**
 * One derivation for the system prompt and `platform_help`, so the two can't
 * describe a station differently. `effective` and `unentitled` are built-in
 * slugs; a custom pack counts as working on data (see `usesStationData`),
 * usable when the plan includes custom packs and excluded when it doesn't.
 */
export function stationDataSetup(packs: {
  effective: readonly string[];
  unentitled: readonly string[];
  hasUsableCustomPack: boolean;
  hasExcludedCustomPack: boolean;
}): StationDataSetup {
  if (usesStationData(packs.effective, packs.hasUsableCustomPack)) {
    return "usable";
  }
  if (usesStationData(packs.unentitled, packs.hasExcludedCustomPack)) {
    return "plan-excluded";
  }
  return "none";
}

/**
 * Whether any pack in a set reads or writes entity data. `stationDataSetup`
 * asks it of the usable packs and of the plan-excluded ones separately.
 *
 * A custom pack counts. A custom tool can take the station's records as
 * input (`consumption` in docs/CUSTOM_TOOLPACK_INTEGRATION.md), and nothing
 * here can classify one, so the safe reading is that it does.
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
