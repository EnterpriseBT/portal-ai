import {
  BUILTIN_TOOLPACK_BY_SLUG,
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
  static getLabel(
    pack: string,
    customLabels?: CustomToolpackLabelMap
  ): string {
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
