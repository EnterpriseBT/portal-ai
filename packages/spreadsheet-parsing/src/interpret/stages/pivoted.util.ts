import type { Region } from "../../plan/index.js";

/**
 * A region is *pivoted* when its records axis (rows for `rows-as-records`,
 * columns for `columns-as-records`) differs from its `headerAxis`. In that
 * case the cells along `headerAxis` are records-axis labels (e.g. Q1/Q2/...),
 * **not** field names — field names live on the orthogonal axis instead.
 *
 * Crosstabs are always pivoted along both dimensions.
 */
export function isPivoted(region: Region): boolean {
  if (region.orientation === "cells-as-records") return true;
  if (
    region.orientation === "columns-as-records" &&
    region.headerAxis === "row"
  ) {
    return true;
  }
  if (
    region.orientation === "rows-as-records" &&
    region.headerAxis === "column"
  ) {
    return true;
  }
  return false;
}

/**
 * Which axis carries **field names** for a region. For non-pivoted regions
 * that's just `headerAxis`. For pivoted regions it's the orthogonal axis —
 * `headerAxis` itself is holding the records-axis labels, not field names.
 *
 * Returns `null` for `headerAxis === "none"`.
 */
export function fieldNamesAxis(region: Region): "row" | "column" | null {
  if (region.headerAxis === "none") return null;
  const base: "row" | "column" = region.headerAxis === "row" ? "row" : "column";
  if (!isPivoted(region)) return base;
  return base === "row" ? "column" : "row";
}
