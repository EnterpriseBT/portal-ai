import {
  BUILTIN_TOOLPACK_BY_SLUG,
  BuiltinToolpackSlugSchema,
  PACK_USES_STATION_DATA,
  isBuiltinToolpackSlug,
  stationDataSetup,
  type StationDataSetup,
} from "@portalai/core/registries";
import { STATION_PLAN_EXCLUDED_CUSTOM_PACKS } from "@portalai/core/content";
import type { AttachedToolpack } from "@portalai/core/contracts";

/**
 * Optional lookup map for custom toolpack labels. The toolpacks list
 * query populates this so `getLabel` can resolve `org:<id>` strings
 * to the user-facing pack name.
 */
export type CustomToolpackLabelMap = ReadonlyMap<string, string>;

export class ToolPackUtil {
  /**
   * Resolve a toolpack reference to its display label.
   *
   * - Built-in slugs (e.g. `"data_query"`) → registry name.
   * - Custom refs (`"org:<uuid>"`) → looked up via the optional map;
   *   falls back to the raw ref string for unknown values.
   */
  static getLabel(pack: string, customLabels?: CustomToolpackLabelMap): string {
    if (isBuiltinToolpackSlug(pack)) {
      return BUILTIN_TOOLPACK_BY_SLUG[pack].name;
    }
    if (pack.startsWith("org:") && customLabels) {
      const id = pack.slice("org:".length);
      const label = customLabels.get(id);
      if (label) return label;
    }
    return pack;
  }
}

/**
 * #1063: a station's own pack names (its `toolpacks`), as the id → name map
 * `ToolPackUtil.getLabel` takes. A station read names its packs for anyone
 * who can read the station, so a member gets a custom pack's name without
 * the organization's pack list, which they can't read.
 */
export function stationToolpackLabels(
  toolpacks: readonly AttachedToolpack[] | undefined
): CustomToolpackLabelMap {
  const labels = new Map<string, string>();
  for (const pack of toolpacks ?? []) {
    if (pack.kind === "custom" && pack.ref.startsWith("org:")) {
      labels.set(pack.ref.slice("org:".length), pack.name);
    }
  }
  return labels;
}

// ── Built-in entitlements (#284) ─────────────────────────────────────
//
// #214 shipped `TierPolicy.entitlements` with two axes: `customToolpacks`
// (a boolean, already surfaced) and `builtinToolpacks` (an allowlist of
// slugs, enforced in `ToolService.buildAnalyticsTools` and surfaced
// nowhere). The helpers below are the built-in axis's read side; the
// custom axis stays the boolean it already is.

/**
 * Every built-in slug — the permissive fallback used whenever the tier
 * policy isn't available (loading, error, offline). The UI fails **open**
 * on purpose: a stale side query must never forbid an action the server
 * would allow, and the server guard is the real gate.
 */
export const ALL_BUILTIN_SLUGS: ReadonlySet<string> = new Set(
  BuiltinToolpackSlugSchema.options
);

/** #690: some built-in pack is outside the org's plan (drives the upgrade
 *  note under the station dialogs' pack picker). */
export const someBuiltinUnentitled = (entitled: ReadonlySet<string>): boolean =>
  [...ALL_BUILTIN_SLUGS].some((slug) => !entitled.has(slug));

/**
 * Is this toolpack reference available on the organization's plan?
 *
 * Governs the **built-in** axis only. A custom ref (`org:<uuid>`) or any
 * unrecognized string reads as entitled — custom-pack availability is
 * #214's `customToolpacks` boolean and is not this predicate's business.
 */
export function isBuiltinPackEntitled(
  pack: string,
  entitledSlugs: ReadonlySet<string>
): boolean {
  if (!isBuiltinToolpackSlug(pack)) return true;
  return entitledSlugs.has(pack);
}

/**
 * The subset of `packs` that are built-in slugs outside `entitledSlugs`,
 * in input order. Non-built-in refs are never returned.
 */
export function unentitledBuiltins(
  packs: readonly string[],
  entitledSlugs: ReadonlySet<string>
): string[] {
  return packs.filter((p) => isBuiltinToolpackSlug(p) && !entitledSlugs.has(p));
}

/**
 * #1055: how a station stands with entity data, for its attachment notice,
 * classified the way the API does for the assistant (`stationDataSetup`).
 * Built-in packs split by the plan; any other ref is a custom pack, usable
 * or excluded by the plan's `customToolpacks`. In `plan-excluded`,
 * `excludedPackNames` names the excluded packs whose tools would read the
 * station's records, in the station's own order (as its chips show them).
 */
export function stationDataSetupFor(
  enabledToolpacks: readonly string[],
  isEntitled: (pack: string) => boolean,
  customPacksEntitled: boolean
): { dataSetup: StationDataSetup; excludedPackNames: string[] } {
  const builtins = enabledToolpacks.filter(isBuiltinToolpackSlug);
  // Only `org:` refs are custom packs; a retired or unknown slug is neither,
  // as the API reads the station.
  const hasCustom = enabledToolpacks.some((ref) => ref.startsWith("org:"));
  const unentitled = builtins.filter((slug) => !isEntitled(slug));
  const dataSetup = stationDataSetup({
    effective: builtins.filter((slug) => isEntitled(slug)),
    unentitled,
    hasUsableCustomPack: hasCustom && customPacksEntitled,
    hasExcludedCustomPack: hasCustom && !customPacksEntitled,
  });
  if (dataSetup !== "plan-excluded")
    return { dataSetup, excludedPackNames: [] };
  const excludedPackNames = unentitled
    .filter((slug) => PACK_USES_STATION_DATA[slug])
    .map((slug) => ToolPackUtil.getLabel(slug));
  if (hasCustom && !customPacksEntitled) {
    excludedPackNames.push(STATION_PLAN_EXCLUDED_CUSTOM_PACKS);
  }
  return { dataSetup, excludedPackNames };
}

// ── Entitlement copy ────────────────────────────────────────────────
//
// One source for every surface. `UNENTITLED_PACK_BADGE` is the string
// #214 already uses for the custom axis (`Toolpacks.view.tsx`), lifted
// here so the two axes can never drift apart. Copy is deliberately
// role-agnostic — identical for owners and non-owners — and never names
// the required tier (that answer lives one click away on the billing
// tab, which the catalog already populates).

export const UNENTITLED_PACK_BADGE = "Inactive on your plan";
export const UNENTITLED_PACK_REASON = "Not included in your plan";
export const UNENTITLED_PACK_TOOLTIP =
  "This tool pack isn't included in your plan, so its tools are unavailable in portal sessions.";
export const UPGRADE_CTA_LABEL = "View plans";
