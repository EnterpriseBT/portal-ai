/**
 * Human-readable labels for station tool packs.
 */
const TOOL_PACK_LABELS: Record<string, string> = {
  data_query: "Data Query",
  statistics: "Statistics",
  regression: "Regression",
  financial: "Financial",
  web_search: "Web Search",
  entity_management: "Entity Management",
};

export class ToolPackUtil {
  /**
   * Resolve a tool pack key to its display label, falling back to the raw key.
   */
  static getLabel(pack: string): string {
    return TOOL_PACK_LABELS[pack] ?? pack;
  }
}
