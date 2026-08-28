import { describe, it, expect } from "@jest/globals";

import type { MapLayer, MapSpec } from "@portalai/core/contracts";
import {
  AGG_ZOOM_THRESHOLD,
  SEQUENTIAL_PALETTE,
} from "@portalai/core/constants";

import type {
  GeoBlockContent,
  WidgetRefreshResponse,
} from "@portalai/core/contracts";

import {
  boundsOf,
  buildLegend,
  EMPTY_ROWS,
  featuresForLayer,
  layerToMapLibre,
  pickMapRows,
  resolveBasemapStyle,
  resolveColorBy,
  sourceIdFor,
} from "../utils/map-config.util";
import type { MapLegend } from "../utils/map-config.util";

/** Swatch labels of a legend (or [] for null/gradient) — the discriminated
 *  MapLegend replaced the flat LegendEntry[] in #336. */
const swatchLabels = (l: MapLegend | null): string[] =>
  l && l.kind === "swatches" ? l.entries.map((e) => e.label) : [];

describe("featuresForLayer", () => {
  it("reads a geometry column as a GeoJSON geometry object", () => {
    const layer = {
      kind: "polygons",
      source: { geometryColumn: "geom" },
    } as MapLayer;
    const rows = [
      {
        geom: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 0],
            ],
          ],
        },
        id: 1,
      },
    ];
    const out = featuresForLayer(layer, 0, rows);
    expect(out.sourceId).toBe(sourceIdFor(0));
    expect(out.collection.features).toHaveLength(1);
    expect(out.collection.features[0].geometry.type).toBe("Polygon");
    expect(out.collection.features[0].properties.id).toBe(1);
    expect(out.truncated).toBe(false);
  });

  it("builds a Point from a lat/lng pair and skips non-finite / missing rows", () => {
    const layer = {
      kind: "points",
      source: { latColumn: "lat", lngColumn: "lng" },
    } as MapLayer;
    const rows = [
      { lat: 40.7, lng: -111.9 },
      { lat: "nope", lng: 1 }, // non-numeric → skipped
      { lat: 5 }, // missing lng → skipped
    ];
    const out = featuresForLayer(layer, 1, rows);
    expect(out.collection.features).toHaveLength(1);
    expect(out.collection.features[0].geometry).toEqual({
      type: "Point",
      coordinates: [-111.9, 40.7],
    });
    expect(out.total).toBe(1);
  });

  it("coerces numeric-string lat/lng (numeric columns arrive as strings) to numeric-coord Points (#314)", () => {
    const layer = {
      kind: "points",
      source: { latColumn: "lat", lngColumn: "lng" },
    } as MapLayer;
    // The Postgres driver returns `numeric` columns as strings — a lat/lng
    // column pair looks like this on the inline path.
    const rows = [
      { lat: "40.794", lng: "-111.909", name: "SLC" },
      { lat: "nope", lng: "1" }, // still skipped — unparseable
    ];
    const out = featuresForLayer(layer, 0, rows);
    expect(out.collection.features).toHaveLength(1);
    expect(out.collection.features[0].geometry).toEqual({
      type: "Point",
      coordinates: [-111.909, 40.794], // numbers, not strings
    });
    // The coords are real numbers so MapLibre/bounds math works.
    const [lng, lat] = (
      out.collection.features[0].geometry as { coordinates: number[] }
    ).coordinates;
    expect(typeof lng).toBe("number");
    expect(typeof lat).toBe("number");
  });

  it("clamps to the cap and flags truncation", () => {
    const layer = {
      kind: "points",
      source: { latColumn: "lat", lngColumn: "lng" },
    } as MapLayer;
    const rows = Array.from({ length: 5 }, (_, i) => ({ lat: i, lng: i }));
    const out = featuresForLayer(layer, 0, rows, 3);
    expect(out.collection.features).toHaveLength(3);
    expect(out.total).toBe(5);
    expect(out.truncated).toBe(true);
  });
});

describe("resolveColorBy", () => {
  it("zips distinct column values with the palette when no stops given", () => {
    const rows = [
      { klass: "vacant" },
      { klass: "improved" },
      { klass: "vacant" },
    ];
    const { expression, legend } = resolveColorBy({ column: "klass" }, rows);
    const expr = expression as unknown[];
    expect(expr[0]).toBe("match");
    expect(expr[1]).toEqual(["get", "klass"]);
    // vacant, <color>, improved, <color>, <fallback>
    expect(expr).toContain("vacant");
    expect(expr).toContain("improved");
    expect(swatchLabels(legend)).toEqual(["vacant", "improved"]);
  });

  it("returns a solid colour (not a zero-pair match) when no categories resolve", () => {
    // Tiled layer: no rows to derive categories from, no explicit stops.
    const { expression, legend } = resolveColorBy({ column: "klass" }, []);
    expect(typeof expression).toBe("string");
    expect(legend).toBeNull();
  });

  it("compiles numeric (graduated) stops to a step scale, not an exact match (#330)", () => {
    const { expression, legend } = resolveColorBy(
      {
        column: "mkt_value",
        stops: [
          [0, "#f7fbff"],
          [100000, "#c6dbef"],
          [300000, "#6baed6"],
        ],
      },
      []
    );
    // `step` (ranges), NOT `match` (exact) — a continuous value like 152,397
    // must land in a band, not fall to the grey fallback. Wrapped in a `case`
    // on `has` so a null/absent value doesn't make `step` throw → black.
    const expr = expression as unknown[];
    expect(expr[0]).toBe("case");
    expect(expr[1]).toEqual(["has", "mkt_value"]);
    expect(expr[2]).toEqual([
      "step",
      ["to-number", ["get", "mkt_value"], 0], // coerced so null can't throw → black
      "#f7fbff",
      100000,
      "#c6dbef",
      300000,
      "#6baed6",
    ]);
    expect(typeof expr[3]).toBe("string"); // no-data fallback colour
    expect(swatchLabels(legend)).toEqual(["0", "100000", "300000"]);
  });

  it("routes null/absent numeric values to a no-data colour (no step throw → black) (#330)", () => {
    const { expression } = resolveColorBy(
      {
        column: "mkt_value",
        stops: [
          [0, "#a"],
          [100000, "#b"],
        ],
      },
      []
    );
    const expr = expression as unknown[];
    // case( has(col), step, <no-data> ) — features lacking the key never reach step.
    expect(expr[0]).toBe("case");
    expect(expr[1]).toEqual(["has", "mkt_value"]);
    expect((expr[2] as unknown[])[0]).toBe("step");
  });

  it("sorts numeric stops ascending before building the step scale", () => {
    const { expression } = resolveColorBy(
      {
        column: "v",
        stops: [
          [300000, "#3"],
          [0, "#0"],
          [100000, "#1"],
        ],
      },
      []
    );
    // The step (inside the null-guard `case`) is sorted ascending.
    expect((expression as unknown[])[2]).toEqual([
      "step",
      ["to-number", ["get", "v"], 0],
      "#0",
      100000,
      "#1",
      300000,
      "#3",
    ]);
  });

  it("honours explicit stops", () => {
    const { expression, legend } = resolveColorBy(
      { column: "klass", stops: [["vacant", "#ff8a00"]] },
      []
    );
    expect(expression).toEqual([
      "match",
      ["get", "klass"],
      "vacant",
      "#ff8a00",
      expect.any(String),
    ]);
    expect(legend).toEqual({
      kind: "swatches",
      entries: [{ label: "vacant", color: "#ff8a00" }],
    });
  });

  it("treats numeric-STRING stops as graduated → step with number breakpoints (#346)", () => {
    // The server back-fill stores numeric column values as strings; they must
    // still compile to a `step` (not a `match` that never hits a number feature).
    const { expression, legend } = resolveColorBy(
      {
        column: "acres",
        stops: [
          ["640", "#a"],
          ["480", "#b"],
        ],
      },
      []
    );
    const expr = expression as unknown[];
    expect(expr[0]).toBe("case");
    const step = expr[2] as unknown[];
    expect(step[0]).toBe("step");
    expect(step[1]).toEqual(["to-number", ["get", "acres"], 0]);
    // sorted ascending, breakpoints are NUMBERS (480 base, then 640) — not "640".
    expect(step[2]).toBe("#b"); // base color (lowest)
    expect(step[3]).toBe(640); // number breakpoint, not the string "640"
    expect(step[4]).toBe("#a");
    expect(swatchLabels(legend)).toEqual(["480", "640"]);
  });

  it("stays categorical (match) when stops are not all numeric (#346)", () => {
    const { expression } = resolveColorBy(
      {
        column: "mixed",
        stops: [
          ["640", "#a"],
          ["vacant", "#b"],
        ],
      },
      []
    );
    expect((expression as unknown[])[0]).toBe("match");
  });

  it("scale:'interpolate' + ≥2 numeric stops → a continuous interpolate expr + gradient legend (#336)", () => {
    const { expression, legend } = resolveColorBy(
      {
        column: "mkt",
        scale: "interpolate",
        stops: [
          [0, "#000000"],
          [100, "#ffffff"],
        ],
      },
      []
    );
    const expr = expression as unknown[];
    // Same null-guard shape as step: case(has, interpolate(to-number …), no-data).
    expect(expr[0]).toBe("case");
    expect(expr[1]).toEqual(["has", "mkt"]);
    const interp = expr[2] as unknown[];
    expect(interp[0]).toBe("interpolate");
    expect(interp[1]).toEqual(["linear"]);
    expect(interp[2]).toEqual(["to-number", ["get", "mkt"], 0]);
    expect(interp.slice(3)).toEqual([0, "#000000", 100, "#ffffff"]);
    expect(typeof expr[3]).toBe("string"); // no-data colour, never black
    expect(legend).toEqual({
      kind: "gradient",
      min: 0,
      max: 100,
      stops: [
        { value: 0, color: "#000000" },
        { value: 100, color: "#ffffff" },
      ],
    });
  });

  it("interpolate sorts + dedupes stops ascending (MapLibre requires strictly increasing) (#336)", () => {
    const { legend } = resolveColorBy(
      {
        column: "v",
        scale: "interpolate",
        stops: [
          [300, "#3"],
          [0, "#0"],
          [300, "#dup"],
          [100, "#1"],
        ],
      },
      []
    );
    expect(legend).toEqual({
      kind: "gradient",
      min: 0,
      max: 300,
      stops: [
        { value: 0, color: "#0" },
        { value: 100, color: "#1" },
        { value: 300, color: "#3" },
      ],
    });
  });

  it("scale:'interpolate' with <2 distinct numeric stops → falls back to step, never a broken expr (#336)", () => {
    const { expression, legend } = resolveColorBy(
      { column: "mkt", scale: "interpolate", stops: [[42, "#abc"]] },
      []
    );
    const expr = expression as unknown[];
    expect(expr[0]).toBe("case");
    expect((expr[2] as unknown[])[0]).toBe("step"); // not interpolate
    expect(legend?.kind).toBe("swatches");
  });

  it("scale:'interpolate' with no stops derives min→max from rows using SEQUENTIAL_PALETTE (#336)", () => {
    const rows = [{ v: 10 }, { v: 30 }, { v: 20 }];
    const { expression, legend } = resolveColorBy(
      { column: "v", scale: "interpolate" },
      rows
    );
    const interp = (expression as unknown[])[2] as unknown[];
    expect(interp[0]).toBe("interpolate");
    const colors = interp.slice(3).filter((_, i) => i % 2 === 1);
    for (const c of colors) expect(SEQUENTIAL_PALETTE).toContain(c);
    expect(legend).toMatchObject({ kind: "gradient", min: 10, max: 30 });
  });

  it("scale:'categorical' forces a match even for numeric stops (#336)", () => {
    const { expression } = resolveColorBy(
      {
        column: "code",
        scale: "categorical",
        stops: [
          [1, "#a"],
          [2, "#b"],
        ],
      },
      []
    );
    expect((expression as unknown[])[0]).toBe("match");
  });

  it("scale:'step' keeps numeric stops as discrete bands (#336)", () => {
    const { expression } = resolveColorBy(
      {
        column: "v",
        scale: "step",
        stops: [
          [0, "#a"],
          [100, "#b"],
        ],
      },
      []
    );
    const expr = expression as unknown[];
    expect(expr[0]).toBe("case");
    expect((expr[2] as unknown[])[0]).toBe("step");
  });
});

describe("layerToMapLibre", () => {
  it("points → a circle layer with a literal colour", () => {
    const layer = {
      kind: "points",
      source: { latColumn: "lat", lngColumn: "lng" },
      style: { color: "#123456", radius: 8 },
    } as MapLayer;
    const { layers, legend } = layerToMapLibre(layer, 0, []);
    expect(layers).toHaveLength(1);
    expect(layers[0].type).toBe("circle");
    expect(layers[0].paint["circle-color"]).toBe("#123456");
    expect(layers[0].paint["circle-radius"]).toBe(8);
    expect(legend).toBeNull();
  });

  it("polygons → a fill layer + an outline line layer", () => {
    const layer = {
      kind: "polygons",
      source: { geometryColumn: "geom" },
    } as MapLayer;
    const { layers } = layerToMapLibre(layer, 2, []);
    expect(layers.map((l) => l.type)).toEqual(["fill", "line"]);
    expect(layers[0].source).toBe(sourceIdFor(2));
  });

  it("raw polygon fill is translucent by default; style.opacity may only make it MORE translucent, never more opaque (#330)", () => {
    const fill = (l: MapLayer) =>
      layerToMapLibre(l, 0, []).layers.find(
        (x) => x.id === `${sourceIdFor(0)}-fill`
      )!;
    const def = fill({
      kind: "polygons",
      source: { geometryColumn: "geom" },
    } as MapLayer);
    const base = def.paint["fill-opacity"] as number;
    expect(base).toBeLessThan(0.5); // translucent default

    // Agents author ~0.8 → capped to the translucent ceiling (basemap stays visible).
    const opaque = fill({
      kind: "polygons",
      source: { geometryColumn: "geom" },
      style: { opacity: 0.8 },
    } as MapLayer);
    expect(opaque.paint["fill-opacity"]).toBe(base);

    // A lower value is honored (more translucent).
    const lighter = fill({
      kind: "polygons",
      source: { geometryColumn: "geom" },
      style: { opacity: 0.15 },
    } as MapLayer);
    expect(lighter.paint["fill-opacity"]).toBe(0.15);
  });

  it("passes a MapLibre expression through as the colour verbatim", () => {
    const expr = ["case", ["==", ["get", "k"], "v"], "#f00", "#eee"];
    const layer = {
      kind: "polygons",
      source: { geometryColumn: "geom" },
      style: { color: expr },
    } as MapLayer;
    const { layers } = layerToMapLibre(layer, 0, []);
    expect(layers[0].paint["fill-color"]).toEqual(expr);
  });

  it("compiles colorBy into a match expression + legend on the primary colour", () => {
    const layer = {
      kind: "polygons",
      source: { geometryColumn: "geom" },
      style: { colorBy: { column: "klass" } },
    } as MapLayer;
    const rows = [{ klass: "a" }, { klass: "b" }];
    const { layers, legend } = layerToMapLibre(layer, 0, rows);
    expect((layers[0].paint["fill-color"] as unknown[])[0]).toBe("match");
    expect(swatchLabels(legend)).toEqual(["a", "b"]);
  });

  it("heatmap → a heatmap layer", () => {
    const layer = {
      kind: "heatmap",
      source: { latColumn: "lat", lngColumn: "lng" },
    } as MapLayer;
    const { layers } = layerToMapLibre(layer, 0, []);
    expect(layers[0].type).toBe("heatmap");
  });
});

describe("layerToMapLibre aggregation (#330)", () => {
  const catLayer = {
    kind: "polygons",
    source: { geometryColumn: "geom" },
    style: { colorBy: { column: "c_city", stops: [["SLC", "#111"]] } },
  } as MapLayer;

  it("tiled category layer → raw layers gated minzoom + an -agg fill gated maxzoom, same colorBy match", () => {
    const { layers } = layerToMapLibre(catLayer, 0, [], { tiled: true });
    const agg = layers.find((l) => l.id === `${sourceIdFor(0)}-agg`)!;
    const raw = layers.filter((l) => l.id !== `${sourceIdFor(0)}-agg`);
    // Clean handoff: raw at/above threshold, agg below it.
    expect(agg.type).toBe("fill");
    expect(agg.maxzoom).toBe(AGG_ZOOM_THRESHOLD);
    expect(raw.every((l) => l.minzoom === AGG_ZOOM_THRESHOLD)).toBe(true);
    // Bins colour by the same colorBy match as the raw fill.
    expect((agg.paint["fill-color"] as unknown[])[0]).toBe("match");
  });

  it("no-colorBy tiled layer → agg fill uses a _count density interpolate", () => {
    const layer = {
      kind: "polygons",
      source: { geometryColumn: "geom" },
    } as MapLayer;
    const { layers } = layerToMapLibre(layer, 0, [], { tiled: true });
    const agg = layers.find((l) => l.id === `${sourceIdFor(0)}-agg`)!;
    const op = agg.paint["fill-opacity"] as unknown[];
    expect(op[0]).toBe("interpolate");
    expect(JSON.stringify(op)).toContain("_count");
  });

  it("honours a per-layer zoomThreshold override", () => {
    const layer = {
      ...catLayer,
      aggregation: { zoomThreshold: 9 },
    } as MapLayer;
    const { layers } = layerToMapLibre(layer, 0, [], { tiled: true });
    expect(layers.find((l) => l.id === `${sourceIdFor(0)}-agg`)!.maxzoom).toBe(
      9
    );
    expect(
      layers.filter((l) => l.id !== `${sourceIdFor(0)}-agg`)[0].minzoom
    ).toBe(9);
  });

  it("aggregation.enabled === false → no agg layer, raw layers not zoom-gated", () => {
    const layer = { ...catLayer, aggregation: { enabled: false } } as MapLayer;
    const { layers } = layerToMapLibre(layer, 0, [], { tiled: true });
    expect(layers.some((l) => l.id === `${sourceIdFor(0)}-agg`)).toBe(false);
    expect(layers.every((l) => l.minzoom === undefined)).toBe(true);
  });

  it("inline (not tiled) → no agg layer even with a colorBy", () => {
    const { layers } = layerToMapLibre(catLayer, 0, [], { tiled: false });
    expect(layers.some((l) => l.id === `${sourceIdFor(0)}-agg`)).toBe(false);
  });

  it("bins are translucent so the basemap shows through, and honour style.opacity (#330)", () => {
    const agg = (l: MapLayer) =>
      layerToMapLibre(l, 0, [], { tiled: true }).layers.find(
        (x) => x.id === `${sourceIdFor(0)}-agg`
      )!;
    // Default category bin: translucent (basemap reads through), not near-opaque.
    const base = agg(catLayer).paint["fill-opacity"] as number;
    expect(base).toBeLessThanOrEqual(0.6);
    // An agent-authored opaque style.opacity is capped to the translucent ceiling.
    const overridden = agg({
      ...catLayer,
      style: { ...catLayer.style, opacity: 0.9 },
    } as MapLayer);
    expect(overridden.paint["fill-opacity"]).toBe(base);
    // Density ramp also tops out translucent.
    const density = agg({
      kind: "polygons",
      source: { geometryColumn: "geom" },
    } as MapLayer);
    const ramp = density.paint["fill-opacity"] as number[];
    expect(ramp[ramp.length - 1]).toBeLessThanOrEqual(0.6);
  });
});

describe("layerToMapLibre per-kind treatment (#337)", () => {
  const lineLayer = {
    kind: "lines",
    source: { geometryColumn: "geom" },
  } as MapLayer;
  const polyLayer = {
    kind: "polygons",
    source: { geometryColumn: "geom" },
    style: { colorBy: { column: "c_city", stops: [["SLC", "#111"]] } },
  } as MapLayer;
  const aggId = `${sourceIdFor(0)}-agg`;

  it("tiled line layer → no -agg fill, raw line renders at all zoom (no minzoom)", () => {
    const { layers } = layerToMapLibre(lineLayer, 0, [], { tiled: true });
    expect(layers.some((l) => l.id === aggId)).toBe(false);
    expect(layers.every((l) => l.minzoom === undefined)).toBe(true);
  });

  it("treatment:'bins' forces an -agg fill on a line layer", () => {
    const layer = {
      ...lineLayer,
      aggregation: { treatment: "bins" },
    } as MapLayer;
    const { layers } = layerToMapLibre(layer, 0, [], { tiled: true });
    expect(layers.some((l) => l.id === aggId)).toBe(true);
  });

  it("treatment:'none' opts a polygon out of bins (raw at all zoom)", () => {
    const layer = {
      ...polyLayer,
      aggregation: { treatment: "none" },
    } as MapLayer;
    const { layers } = layerToMapLibre(layer, 0, [], { tiled: true });
    expect(layers.some((l) => l.id === aggId)).toBe(false);
    expect(layers.every((l) => l.minzoom === undefined)).toBe(true);
  });
});

describe("buildLegend", () => {
  it("concatenates each layer's colorBy legend", () => {
    const spec = {
      layers: [
        {
          kind: "polygons",
          source: { geometryColumn: "geom" },
          style: { colorBy: { column: "klass", stops: [["x", "#111"]] } },
        },
      ],
    } as unknown as MapSpec;
    expect(buildLegend(spec, [])).toEqual([
      { kind: "swatches", entries: [{ label: "x", color: "#111" }] },
    ]);
  });

  it("returns a gradient legend for an interpolate layer alongside a swatch layer (#336)", () => {
    const spec = {
      layers: [
        {
          kind: "polygons",
          source: { geometryColumn: "geom" },
          style: { colorBy: { column: "klass", stops: [["x", "#111"]] } },
        },
        {
          kind: "polygons",
          source: { geometryColumn: "geom" },
          style: {
            colorBy: {
              column: "v",
              scale: "interpolate",
              stops: [
                [0, "#000"],
                [9, "#fff"],
              ],
            },
          },
        },
      ],
    } as unknown as MapSpec;
    expect(buildLegend(spec, []).map((l) => l.kind)).toEqual([
      "swatches",
      "gradient",
    ]);
  });
});

describe("boundsOf", () => {
  it("computes a bbox over points and polygons", () => {
    const fc = {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: { type: "Point", coordinates: [-5, 2] },
          properties: {},
        },
        {
          type: "Feature" as const,
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [10, 0],
                [10, 8],
                [0, 0],
              ],
            ],
          },
          properties: {},
        },
      ],
    };
    expect(boundsOf([fc])).toEqual([
      [-5, 0],
      [10, 8],
    ]);
  });

  it("returns null when there are no features", () => {
    expect(boundsOf([{ type: "FeatureCollection", features: [] }])).toBeNull();
  });
});

describe("resolveBasemapStyle", () => {
  it("keys the CARTO family to the theme mode", () => {
    expect(resolveBasemapStyle("carto-light", "light")).toContain("positron");
    expect(resolveBasemapStyle("carto-light", "dark")).toContain("dark-matter");
  });
  it("honours an explicit url and osm verbatim", () => {
    expect(resolveBasemapStyle({ url: "https://x/y.json" }, "light")).toBe(
      "https://x/y.json"
    );
    expect(resolveBasemapStyle("osm", "light")).toMatchObject({ version: 8 });
  });
});

describe("pickMapRows (#341 — stable rows identity)", () => {
  const handleContent = {
    spec: { layers: [] },
    queryHandle: "qh_abc",
    rowCount: 5,
  } as unknown as GeoBlockContent;
  const inlineContent = {
    spec: { layers: [] },
    rows: [{ a: 1 }],
  } as unknown as GeoBlockContent;

  it("returns the shared EMPTY_ROWS reference for a handle/no-rows content", () => {
    expect(pickMapRows(null, handleContent)).toBe(EMPTY_ROWS);
  });

  it("returns the SAME reference across calls (stable across re-renders)", () => {
    expect(pickMapRows(null, handleContent)).toBe(
      pickMapRows(null, handleContent)
    );
  });

  it("returns a fresh inline delivery's rows when present", () => {
    const fresh = {
      kind: "inline",
      rows: [{ b: 2 }],
    } as unknown as WidgetRefreshResponse;
    expect(pickMapRows(fresh, handleContent)).toEqual([{ b: 2 }]);
  });

  it("returns the content's inline rows when there is no fresh delivery", () => {
    expect(pickMapRows(null, inlineContent)).toEqual([{ a: 1 }]);
  });

  it("falls back to EMPTY_ROWS for a handle-kind fresh delivery with no inline rows", () => {
    const fresh = { kind: "handle" } as unknown as WidgetRefreshResponse;
    expect(pickMapRows(fresh, handleContent)).toBe(EMPTY_ROWS);
  });

  it("EMPTY_ROWS is empty", () => {
    expect(EMPTY_ROWS).toHaveLength(0);
  });
});
