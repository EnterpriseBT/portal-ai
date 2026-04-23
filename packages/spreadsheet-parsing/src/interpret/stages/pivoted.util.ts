import { isPivoted as regionIsPivoted, type Region } from "../../plan/index.js";

/**
 * A region is *pivoted* when it carries at least one pivot-kind segment along
 * either axis. Re-exported from the plan helper so stage code has a local
 * import point.
 */
export function isPivoted(region: Region): boolean {
  return regionIsPivoted(region);
}

/**
 * Which axis carries field-name labels — i.e., the axis the classifier should
 * scan. For 1D regions that's the single declared header axis. For crosstab
 * (2D) regions, field-name classification is not meaningful in PR-1 and the
 * stage returns `null`.
 */
export function fieldNamesAxis(region: Region): "row" | "column" | null {
  if (region.headerAxes.length === 1) return region.headerAxes[0];
  return null;
}
