import {
  MAP_LAYER_FEATURE_CAP,
  AGG_ZOOM_THRESHOLD,
  AGG_DENSITY_MAX,
} from "@portalai/core/constants";

import { resolveAggTreatment } from "@portalai/core/contracts";

import type { MapBasemap, MapLayer, MapSpec } from "@portalai/core/contracts";

/**
 * Pure translation from a declarative `MapSpec` (+ result rows) to the
 * MapLibre primitives the widget mounts: GeoJSON sources, styled layers, a
 * legend, and a fit-bounds box. Kept free of `maplibre-gl` so it unit-tests
 * without a WebGL context — the widget's `useEffect` just applies what these
 * return. (#314, slice 4 — inline path.)
 */

// ── GeoJSON shapes (structural; avoids a maplibre-gl type dependency) ──

type Row = Record<string, unknown>;
export interface GeoFeature {
  type: "Feature";
  geometry: Record<string, unknown>;
  properties: Row;
}
export interface GeoFeatureCollection {
  type: "FeatureCollection";
  features: GeoFeature[];
}

export interface LayerData {
  sourceId: string;
  collection: GeoFeatureCollection;
  /** Convertible features in the result, before the per-layer cap. */
  total: number;
  /** `total` exceeded `MAP_LAYER_FEATURE_CAP` — only the first N are rendered. */
  truncated: boolean;
}

const isFiniteNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Coerce a coordinate value to a finite number. Accepts a number *or a numeric
 * string* — a lat/lng bound to a `numeric` column arrives as a string (the
 * Postgres driver returns numeric/decimal as strings to preserve precision),
 * and JSON coordinates can be stringy too. Returns `null` for anything
 * unparseable, so a bad row is skipped rather than plotted at NaN.
 */
const toFiniteNum = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

export const sourceIdFor = (index: number): string => `layer-${index}`;

/**
 * Build a GeoJSON FeatureCollection for one layer from result rows, clamped to
 * `cap`. A `geometryColumn` cell is a GeoJSON geometry object (already so from
 * #316's `ST_AsGeoJSON`); a lat/lng pair becomes a Point. Rows with missing or
 * non-finite geometry are skipped, never rendered at [0,0].
 */
export function featuresForLayer(
  layer: MapLayer,
  index: number,
  rows: Row[],
  cap: number = MAP_LAYER_FEATURE_CAP
): LayerData {
  const source = layer.source;
  const features: GeoFeature[] = [];
  let total = 0;
  for (const row of rows) {
    let geometry: Record<string, unknown> | null = null;
    if ("geometryColumn" in source) {
      const g = row[source.geometryColumn];
      if (g != null && typeof g === "object" && "type" in g) {
        geometry = g as Record<string, unknown>;
      }
    } else {
      const lng = toFiniteNum(row[source.lngColumn]);
      const lat = toFiniteNum(row[source.latColumn]);
      if (lng != null && lat != null) {
        geometry = { type: "Point", coordinates: [lng, lat] };
      }
    }
    if (geometry == null) continue;
    total += 1;
    if (features.length < cap) {
      features.push({ type: "Feature", geometry, properties: row });
    }
  }
  return {
    sourceId: sourceIdFor(index),
    collection: { type: "FeatureCollection", features },
    total,
    truncated: total > cap,
  };
}

// ── Styling ───────────────────────────────────────────────────────────

/** Fallback categorical palette (Tableau 10) when `colorBy` gives no stops. */
export const DEFAULT_PALETTE = [
  "#4e79a7",
  "#f28e2b",
  "#e15759",
  "#76b7b2",
  "#59a14f",
  "#edc948",
  "#b07aa1",
  "#ff9da7",
  "#9c755f",
  "#bab0ac",
];

const DEFAULT_COLOR = "#4e79a7";
const UNMATCHED_COLOR = "#cfd8dc";
/**
 * Default fill opacity for low-zoom aggregate bins (#330). Deliberately
 * translucent so the basemap underneath — city labels, roads, landmarks — reads
 * through the coloured grid; a solid bin obscures the very context that makes an
 * overview useful. Dataset-agnostic (applies to category and density bins) and
 * overridable per layer via `style.opacity`. The density ramp tops out here too.
 */
const AGG_FILL_OPACITY = 0.35;
/**
 * Default fill opacity for raw (non-aggregated) polygon layers. Translucent so a
 * filled choropleth (e.g. parcels by value) doesn't hide the basemap features
 * underneath; a touch more opaque than the aggregate bins since it's the detail
 * layer. Overridable per layer via `style.opacity`.
 */
const RAW_FILL_OPACITY = 0.4;

/**
 * Cap a fill's opacity at a translucent ceiling so a map fill never fully
 * obscures the basemap (labels, roads, landmarks) — the context that makes the
 * overview useful. A spec/agent-authored `style.opacity` can only make a fill
 * *more* translucent, never more opaque than the ceiling (agents tend to author
 * ~0.8, which hides everything). A number is clamped; a MapLibre expression is
 * passed through (can't clamp statically); omitted → the ceiling.
 */
const cappedFillOpacity = (styleOpacity: unknown, ceiling: number): unknown =>
  typeof styleOpacity === "number"
    ? Math.min(styleOpacity, ceiling)
    : (styleOpacity ?? ceiling);

export interface LegendEntry {
  label: string;
  color: string;
}

/**
 * Compile a `colorBy` (categorical) into a MapLibre `match` expression plus the
 * legend the widget draws. Explicit `stops` win; otherwise the column's
 * distinct values (in first-seen order) are zipped with the palette.
 */
export function resolveColorBy(
  colorBy: NonNullable<MapLayer["style"]>["colorBy"] & object,
  rows: Row[]
): { expression: unknown; legend: LegendEntry[] } {
  const palette =
    colorBy.palette && colorBy.palette.length
      ? colorBy.palette
      : DEFAULT_PALETTE;

  let pairs: Array<[string | number, string]>;
  if (colorBy.stops && colorBy.stops.length) {
    pairs = colorBy.stops;
  } else {
    const seen: Array<string | number> = [];
    for (const row of rows) {
      const v = row[colorBy.column];
      if (
        (typeof v === "string" || typeof v === "number") &&
        !seen.includes(v)
      ) {
        seen.push(v);
      }
    }
    pairs = seen.map((v, i) => [v, palette[i % palette.length]]);
  }

  // No categories resolved (e.g. a tiled layer whose stops weren't computed) —
  // return a solid visible colour rather than a `["match", input, fallback]`
  // with zero pairs, which MapLibre rejects / paints as the invisible fallback.
  if (pairs.length === 0) {
    return { expression: DEFAULT_COLOR, legend: [] };
  }

  // Numeric stops are graduated breakpoints (value bands), not exact
  // categories: compile to a `step` scale so a *continuous* value lands in the
  // right band. A `match` (exact equality) would leave every non-breakpoint
  // value on the fallback colour — i.e. an all-grey map for "colour by value",
  // even though the legend renders. String stops stay categorical (`match`).
  const graduated = pairs.every(([value]) => typeof value === "number");
  if (graduated) {
    const sorted = [...pairs].sort(
      (a, b) => (a[0] as number) - (b[0] as number)
    );
    // step(input, base, break1, c1, break2, c2, …): input < break1 → base.
    // Coerce the input with `to-number` (null/absent → 0): `step` THROWS on a
    // null input ("expected number, found null") and MapLibre then paints the
    // WHOLE layer its default — black. ST_AsMVT can emit a property present-but-
    // null, so `["has", col]` alone doesn't stop null reaching `step`; the
    // coercion makes it impossible to throw.
    const step: unknown[] = [
      "step",
      ["to-number", ["get", colorBy.column], 0],
      sorted[0][1],
    ];
    for (let i = 1; i < sorted.length; i++)
      step.push(sorted[i][0], sorted[i][1]);
    // Features that genuinely lack a value render the neutral no-data colour
    // (not the lowest band); those with a value band via the coerced `step`.
    const expression = ["case", ["has", colorBy.column], step, UNMATCHED_COLOR];
    return {
      expression,
      legend: sorted.map(([value, color]) => ({ label: String(value), color })),
    };
  }

  const match: unknown[] = ["match", ["get", colorBy.column]];
  for (const [value, color] of pairs) {
    match.push(value, color);
  }
  match.push(UNMATCHED_COLOR); // fallback for values not in the mapping
  return {
    expression: match,
    legend: pairs.map(([value, color]) => ({ label: String(value), color })),
  };
}

interface MapLibreLayer {
  id: string;
  type: "circle" | "fill" | "line" | "heatmap";
  source: string;
  paint: Record<string, unknown>;
  /** Zoom gating for the low-zoom aggregation handoff (#330). MapLibre bounds
   *  are min-inclusive / max-exclusive, so a raw layer (`minzoom = threshold`)
   *  and an aggregate fill (`maxzoom = threshold`) hand off cleanly at the
   *  threshold with no overlap. */
  minzoom?: number;
  maxzoom?: number;
}

/**
 * Translate one MapSpec layer into the MapLibre layer(s) it renders as. A
 * `colorBy` compiles to a `match` expression for the primary colour; every
 * other style value is passed through verbatim, so a literal or an
 * agent-authored expression both work. Polygons emit a fill **and** an outline
 * line layer.
 */
export function layerToMapLibre(
  layer: MapLayer,
  index: number,
  rows: Row[],
  opts: { tiled?: boolean } = {}
): { layers: MapLibreLayer[]; legend: LegendEntry[] } {
  const source = sourceIdFor(index);
  const style = layer.style ?? {};
  let legend: LegendEntry[] = [];

  let color: unknown = style.color ?? DEFAULT_COLOR;
  if (style.colorBy) {
    const resolved = resolveColorBy(style.colorBy, rows);
    color = resolved.expression;
    legend = resolved.legend;
  }

  const layers: MapLibreLayer[] = [];
  switch (layer.kind) {
    case "points":
    case "cluster": {
      layers.push({
        id: `${source}-circle`,
        type: "circle",
        source,
        paint: {
          "circle-color": color,
          "circle-radius": style.radius ?? 5,
          "circle-opacity": style.opacity ?? 0.9,
          ...(style.outlineColor != null
            ? { "circle-stroke-color": style.outlineColor }
            : {}),
          ...(style.outlineWidth != null
            ? { "circle-stroke-width": style.outlineWidth }
            : {}),
        },
      });
      break;
    }
    case "polygons": {
      layers.push({
        id: `${source}-fill`,
        type: "fill",
        source,
        // Translucent by default so the basemap (labels, roads, landmarks) reads
        // through a filled polygon layer — same rationale as the aggregate bins.
        // Overridable per layer via style.opacity.
        paint: {
          "fill-color": color,
          "fill-opacity": cappedFillOpacity(style.opacity, RAW_FILL_OPACITY),
        },
      });
      layers.push({
        id: `${source}-outline`,
        type: "line",
        source,
        paint: {
          "line-color": style.outlineColor ?? color,
          "line-width": style.outlineWidth ?? 1,
        },
      });
      break;
    }
    case "lines": {
      layers.push({
        id: `${source}-line`,
        type: "line",
        source,
        paint: {
          "line-color": color,
          "line-width": style.width ?? 2,
          ...(style.opacity != null ? { "line-opacity": style.opacity } : {}),
        },
      });
      break;
    }
    case "heatmap": {
      layers.push({
        id: `${source}-heatmap`,
        type: "heatmap",
        source,
        paint: {
          ...(style.opacity != null
            ? { "heatmap-opacity": style.opacity }
            : {}),
        },
      });
      break;
    }
  }

  // Low-zoom aggregation (#330): a tiled layer renders as grid bins below the
  // zoom threshold (server-side). Gate the raw layers to at/above the threshold
  // and add a bin fill below it — colored by the same colorBy `match` (dominant
  // category) when there's a colorBy, or a `_count` density ramp when there
  // isn't. Inline (non-tiled) layers are unaffected.
  // #337: only "bins" kinds get square-grid aggregation. Line layers resolve to
  // "none" — they render as raw (importance-ranked, server-side) lines at every
  // zoom, so we skip the aggregate fill and don't zoom-gate the raw layer.
  const agg = layer.aggregation;
  const treatment = resolveAggTreatment(layer.kind, agg?.treatment);
  if (opts.tiled && agg?.enabled !== false && treatment === "bins") {
    const threshold = agg?.zoomThreshold ?? AGG_ZOOM_THRESHOLD;
    for (const l of layers) l.minzoom = threshold;
    layers.push({
      id: `${source}-agg`,
      type: "fill",
      source,
      maxzoom: threshold,
      paint: style.colorBy
        ? {
            "fill-color": color,
            "fill-opacity": cappedFillOpacity(style.opacity, AGG_FILL_OPACITY),
          }
        : {
            "fill-color": color,
            // Density: opacity scales with the per-cell count over a fixed log
            // domain (consistent across tiles, never per-tile normalized), and
            // tops out at the translucent AGG_FILL_OPACITY so even the densest
            // cell lets the basemap read through.
            "fill-opacity": [
              "interpolate",
              ["linear"],
              ["log10", ["max", ["get", "_count"], 1]],
              0,
              0.1,
              Math.log10(AGG_DENSITY_MAX),
              AGG_FILL_OPACITY,
            ],
          },
    });
  }

  return { layers, legend };
}

/** The legend for the whole spec — the concatenation of each layer's colorBy. */
export function buildLegend(spec: MapSpec, rows: Row[]): LegendEntry[] {
  const out: LegendEntry[] = [];
  spec.layers.forEach((layer, i) => {
    out.push(...layerToMapLibre(layer, i, rows).legend);
  });
  return out;
}

// ── Bounds ──────────────────────────────────────────────────────────────

type Bounds = [[number, number], [number, number]];

function walkCoords(
  node: unknown,
  fn: (lng: number, lat: number) => void
): void {
  if (!Array.isArray(node)) return;
  if (isFiniteNum(node[0]) && isFiniteNum(node[1]) && !Array.isArray(node[0])) {
    fn(node[0], node[1]);
    return;
  }
  for (const child of node) walkCoords(child, fn);
}

/** Fit-bounds box over every feature's coordinates, or null when empty. */
export function boundsOf(collections: GeoFeatureCollection[]): Bounds | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const fc of collections) {
    for (const f of fc.features) {
      walkCoords(f.geometry.coordinates, (lng, lat) => {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      });
    }
  }
  if (minLng === Infinity) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

// ── Basemap ───────────────────────────────────────────────────────────

const CARTO_LIGHT =
  "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const CARTO_DARK =
  "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** OSM raster fallback (no key). A full MapLibre style object. */
const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

/**
 * Resolve a MapSpec basemap to a MapLibre style. The CARTO family is keyed to
 * the active MUI theme so the map matches light/dark; an explicit `{url}` or
 * `osm` is honoured verbatim.
 */
export function resolveBasemapStyle(
  basemap: MapBasemap,
  mode: "light" | "dark"
): string | Record<string, unknown> {
  if (typeof basemap === "object") return basemap.url;
  if (basemap === "osm") return OSM_STYLE;
  return mode === "dark" ? CARTO_DARK : CARTO_LIGHT;
}
