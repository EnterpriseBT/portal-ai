import { describe, expect, it } from "@jest/globals";

import {
  GeoBlockContentSchema,
  GeoInlineContentSchema,
  MapExpressionSchema,
  MapGeometrySourceSchema,
  MapSpecSchema,
  resolveAggTreatment,
} from "../../contracts/map-spec.contract.js";
import { MAP_LAYER_FEATURE_CAP } from "../../constants/large-data-ops.constants.js";
import { PINNED_CONTENT_SCHEMAS } from "../../contracts/pinned-result.contract.js";

// A minimal valid handle envelope (mirrors QueryHandleEnvelopeFieldsSchema).
const handleEnvelope = {
  queryHandle: "qh_abc",
  rowCount: 1234,
  schema: [{ name: "geom", type: "geometry" }],
  sampled: false,
  truncated: false,
  samplePeek: [],
  sql: "SELECT geom FROM er__x",
};

const pointsLayer = {
  kind: "points" as const,
  source: { latColumn: "latitude", lngColumn: "longitude" },
};
const polygonsLayer = {
  kind: "polygons" as const,
  source: { geometryColumn: "boundary" },
};

describe("MapSpecSchema", () => {
  it("applies defaults for basemap and initialView", () => {
    const parsed = MapSpecSchema.parse({ layers: [pointsLayer] });
    expect(parsed.basemap).toBe("carto-light");
    expect(parsed.initialView).toBe("fit");
  });

  it("requires at least one layer", () => {
    expect(MapSpecSchema.safeParse({ layers: [] }).success).toBe(false);
  });

  it("rejects more than 8 layers", () => {
    const layers = Array.from({ length: 9 }, () => pointsLayer);
    expect(MapSpecSchema.safeParse({ layers }).success).toBe(false);
  });

  it("accepts 1..8 layers", () => {
    for (const n of [1, 4, 8]) {
      const layers = Array.from({ length: n }, () => pointsLayer);
      expect(MapSpecSchema.safeParse({ layers }).success).toBe(true);
    }
  });

  it("rejects a polygons layer bound to a lat/lng source", () => {
    const res = MapSpecSchema.safeParse({
      layers: [
        { kind: "polygons", source: { latColumn: "lat", lngColumn: "lng" } },
      ],
    });
    expect(res.success).toBe(false);
  });

  it("rejects a lines layer bound to a lat/lng source", () => {
    const res = MapSpecSchema.safeParse({
      layers: [
        { kind: "lines", source: { latColumn: "lat", lngColumn: "lng" } },
      ],
    });
    expect(res.success).toBe(false);
  });

  it("accepts a polygons layer bound to a geometryColumn", () => {
    expect(MapSpecSchema.safeParse({ layers: [polygonsLayer] }).success).toBe(
      true
    );
  });

  it("accepts a points layer bound to a lat/lng source", () => {
    expect(MapSpecSchema.safeParse({ layers: [pointsLayer] }).success).toBe(
      true
    );
  });

  it("accepts a custom basemap url and rejects a non-url string basemap object", () => {
    expect(
      MapSpecSchema.safeParse({
        basemap: { url: "https://tiles.example.com/style.json" },
        layers: [pointsLayer],
      }).success
    ).toBe(true);
    expect(
      MapSpecSchema.safeParse({
        basemap: { url: "not-a-url" },
        layers: [pointsLayer],
      }).success
    ).toBe(false);
  });

  it("accepts a popup template", () => {
    expect(
      MapSpecSchema.safeParse({
        layers: [pointsLayer],
        popup: { template: "{{address}} — {{prop_class}}" },
      }).success
    ).toBe(true);
  });
});

describe("MapLayerSchema aggregation (#330)", () => {
  const withAgg = (aggregation: unknown) =>
    MapSpecSchema.safeParse({ layers: [{ ...pointsLayer, aggregation }] });

  it("parses when aggregation is omitted (optional — default-on server-side)", () => {
    expect(MapSpecSchema.safeParse({ layers: [pointsLayer] }).success).toBe(
      true
    );
  });

  it("accepts a partial or empty aggregation block", () => {
    expect(withAgg({}).success).toBe(true);
    expect(withAgg({ enabled: false }).success).toBe(true);
    expect(withAgg({ zoomThreshold: 10 }).success).toBe(true);
    expect(withAgg({ gridSizePx: 32 }).success).toBe(true);
    expect(
      withAgg({ enabled: true, zoomThreshold: 9, gridSizePx: 16 }).success
    ).toBe(true);
  });

  it("rejects a zoomThreshold outside 0..22", () => {
    expect(withAgg({ zoomThreshold: -1 }).success).toBe(false);
    expect(withAgg({ zoomThreshold: 23 }).success).toBe(false);
  });

  it("rejects a non-positive or too-large gridSizePx", () => {
    expect(withAgg({ gridSizePx: 0 }).success).toBe(false);
    expect(withAgg({ gridSizePx: 256 }).success).toBe(false);
  });

  it("still enforces the polygons/lat-lng superRefine with aggregation present", () => {
    const res = MapSpecSchema.safeParse({
      layers: [
        {
          kind: "polygons",
          source: { latColumn: "lat", lngColumn: "lng" },
          aggregation: { zoomThreshold: 8 },
        },
      ],
    });
    expect(res.success).toBe(false);
  });
});

describe("MapLayerStyleSchema (via MapSpecSchema)", () => {
  const withStyle = (style: unknown) =>
    MapSpecSchema.safeParse({ layers: [{ ...polygonsLayer, style }] });

  it("accepts colorBy with just a column", () => {
    expect(withStyle({ colorBy: { column: "prop_class" } }).success).toBe(true);
  });

  it("accepts colorBy with explicit value→colour stops", () => {
    expect(
      withStyle({
        colorBy: {
          column: "prop_class",
          stops: [
            ["vacant", "#ff8a00"],
            ["improved", "#2e7d32"],
          ],
        },
      }).success
    ).toBe(true);
  });

  it("accepts a MapLibre expression anywhere a literal style value is allowed", () => {
    expect(
      withStyle({
        color: [
          "case",
          ["==", ["get", "prop_class"], "vacant"],
          "#ff8a00",
          "#cfd8dc",
        ],
      }).success
    ).toBe(true);
  });

  it("accepts nested expressions", () => {
    expect(
      withStyle({
        opacity: [
          "interpolate",
          ["linear"],
          ["get", "score"],
          0,
          0.2,
          100,
          0.9,
        ],
      }).success
    ).toBe(true);
  });

  it("rejects a non-array, non-literal garbage style value", () => {
    expect(withStyle({ color: { r: 1 } }).success).toBe(false);
  });
});

describe("MapLayerAggregationSchema — treatment (via MapSpecSchema)", () => {
  const withAgg = (aggregation: unknown) =>
    MapSpecSchema.safeParse({ layers: [{ ...polygonsLayer, aggregation }] });

  it("accepts treatment: 'bins'", () => {
    expect(withAgg({ treatment: "bins" }).success).toBe(true);
  });

  it("accepts treatment: 'none'", () => {
    expect(withAgg({ treatment: "none" }).success).toBe(true);
  });

  it("rejects an unknown treatment value", () => {
    expect(withAgg({ treatment: "grid" }).success).toBe(false);
  });

  it("accepts an aggregation block with no treatment (per-kind auto)", () => {
    expect(withAgg({}).success).toBe(true);
  });
});

describe("resolveAggTreatment", () => {
  it("defaults lines to 'none' (raw, importance-ranked)", () => {
    expect(resolveAggTreatment("lines")).toBe("none");
  });

  it("defaults points/polygons/heatmap/cluster to 'bins'", () => {
    expect(resolveAggTreatment("points")).toBe("bins");
    expect(resolveAggTreatment("polygons")).toBe("bins");
    expect(resolveAggTreatment("heatmap")).toBe("bins");
    expect(resolveAggTreatment("cluster")).toBe("bins");
  });

  it("lets an explicit treatment override the per-kind default", () => {
    expect(resolveAggTreatment("lines", "bins")).toBe("bins");
    expect(resolveAggTreatment("polygons", "none")).toBe("none");
  });
});

describe("MapExpressionSchema", () => {
  it("rejects an empty array (needs an operator head)", () => {
    expect(MapExpressionSchema.safeParse([]).success).toBe(false);
  });

  it("accepts an operator-headed array", () => {
    expect(MapExpressionSchema.safeParse(["get", "prop_class"]).success).toBe(
      true
    );
  });
});

describe("MapGeometrySourceSchema", () => {
  it("accepts a geometryColumn source", () => {
    expect(
      MapGeometrySourceSchema.safeParse({ geometryColumn: "boundary" }).success
    ).toBe(true);
  });
  it("accepts a lat/lng source", () => {
    expect(
      MapGeometrySourceSchema.safeParse({ latColumn: "lat", lngColumn: "lng" })
        .success
    ).toBe(true);
  });
});

describe("Geo block content", () => {
  const spec = { layers: [pointsLayer] };

  it("resolves the inline branch when rows are present", () => {
    const parsed = GeoBlockContentSchema.parse({
      spec,
      rows: [{ latitude: 1, longitude: 2 }],
    });
    expect("rows" in parsed).toBe(true);
  });

  it("resolves the handle branch first when a queryHandle envelope is present", () => {
    const parsed = GeoBlockContentSchema.parse({ spec, ...handleEnvelope });
    expect("queryHandle" in parsed).toBe(true);
  });

  it("parses the reserved `program` field but it plays no part on the spec path", () => {
    const res = GeoInlineContentSchema.safeParse({
      spec,
      rows: [],
      program: "someReservedProgram()",
    });
    expect(res.success).toBe(true);
  });
});

describe("MAP_LAYER_FEATURE_CAP", () => {
  it("is a positive integer bound", () => {
    expect(Number.isInteger(MAP_LAYER_FEATURE_CAP)).toBe(true);
    expect(MAP_LAYER_FEATURE_CAP).toBeGreaterThan(0);
  });
});

describe("PINNED_CONTENT_SCHEMAS.geo", () => {
  it("is defined and accepts the inline geo shape", () => {
    expect(PINNED_CONTENT_SCHEMAS.geo).toBeDefined();
    const res = PINNED_CONTENT_SCHEMAS.geo!.safeParse({
      spec: { layers: [pointsLayer] },
      rows: [{ latitude: 1, longitude: 2 }],
    });
    expect(res.success).toBe(true);
  });
});
