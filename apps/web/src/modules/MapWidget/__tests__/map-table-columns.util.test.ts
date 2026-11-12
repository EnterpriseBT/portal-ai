import { mapTableColumns } from "../utils/map-table-columns.util";

import type { MapSpec } from "@portalai/core/contracts";

// #796: a map's data table shows its attributes, not raw geometry.

const spec = {
  layers: [
    { kind: "polygons", source: { geometryColumn: "parcel_geom" } },
    { kind: "points", source: { latColumn: "lat", lngColumn: "lng" } },
  ],
} as unknown as MapSpec;

describe("mapTableColumns", () => {
  it("drops each layer's geometry column and keeps lat/lng", () => {
    expect(
      mapTableColumns(spec, [
        { name: "parcel_geom" },
        { name: "zoning" },
        { name: "lat" },
        { name: "lng" },
      ])
    ).toEqual(["zoning", "lat", "lng"]);
  });

  it("drops a column the schema types as geometry or geography", () => {
    expect(
      mapTableColumns(spec, [
        { name: "geom", type: "geometry" },
        { name: "area", type: "geography(Polygon,4326)" },
        { name: "zoning", type: "text" },
      ])
    ).toEqual(["zoning"]);
  });
});
