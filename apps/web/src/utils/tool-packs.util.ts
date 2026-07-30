import {
  BUILTIN_TOOLPACK_BY_SLUG,
  BuiltinToolpackSlugSchema,
  isBuiltinToolpackSlug,
} from "@portalai/core/registries";

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
