import type { MapSpec } from "@portalai/core/contracts";

/**
 * The columns a map's data table shows (#796): every column except raw
 * geometry, which reads as GeoJSON or WKB rather than data. A column is
 * geometry when a layer binds it as its `geometryColumn`, or when the handle
 * schema types it `geometry`/`geography`. Lat/lng columns are plain numbers
 * and stay.
 */
export function mapTableColumns(
  spec: MapSpec,
  columns: Array<{ name: string; type?: string }>
): string[] {
  const bound = new Set(
    spec.layers.flatMap((layer) =>
      "geometryColumn" in layer.source ? [layer.source.geometryColumn] : []
    )
  );
  return columns
    .filter(
      (c) =>
        !bound.has(c.name) && !/^(geometry|geography)\b/i.test(c.type ?? "")
    )
    .map((c) => c.name);
}
