import {
  MAP_LAYER_FEATURE_CAP,
  AGG_DENSITY_MAX,
  SEQUENTIAL_PALETTE,
} from "@portalai/core/constants";

import { resolveAggTreatment } from "@portalai/core/contracts";

import type {
  GeoBlockContent,
  MapBasemap,
  MapLayer,
  MapSpec,
  WidgetRefreshResponse,
} from "@portalai/core/contracts";

import type { InstallBasemap } from "../../../utils/runtime-config.util";

/**
 * Pure translation from a declarative `MapSpec` (+ result rows) to the
 * MapLibre primitives the widget mounts: GeoJSON sources, styled layers, a
 * legend, and a fit-bounds box. Kept free of `maplibre-gl` so it unit-tests
 * without a WebGL context — the widget's `useEffect` just applies what these
 * return. (#314, slice 4 — inline path.)
 */

// ── GeoJSON shapes (structural; avoids a maplibre-gl type dependency) ──

type Row = Record<string, unknown>;

/**
 * A single shared empty-rows reference (#341). The `MapWidget` container reads
 * `rows` on every render; for a tiled/handle map there are no inline rows, and
 * returning a fresh `[]` each render gave the map-lifecycle `useEffect` a new
 * dependency identity every parent re-render — remounting (and re-fetching
 * tiles for) every map whenever anything else in the chat re-rendered. A stable
 * reference keeps that effect from re-running on unrelated re-renders.
 */
export const EMPTY_ROWS: Row[] = Object.freeze([]) as unknown as Row[];

/**
 * Resolve the rows a map renders from, with a **stable identity** (#341): a
 * fresh inline refresh delivery's rows, else the block's own inline rows, else
 * the shared `EMPTY_ROWS` (tiled/handle maps have none — they render via
 * vector tiles, not inline rows). Pure so the container can memoize it.
 */
export function pickMapRows(
  fresh: WidgetRefreshResponse | null,
  content: GeoBlockContent
): Row[] {
  if (fresh?.kind === "inline") return fresh.rows as Row[];
  if (fresh == null && "rows" in content) return content.rows as Row[];
  return EMPTY_ROWS;
}

/**
 * Decide whether a geo block renders through vector **tiles** rather than
 * inline rows (#314/#371). Tiles when: a fresh refresh delivered a handle, or a
 * tiled pin's data read answered `tiles` (#640); or,
 * on mount (no refresh yet), the block is handle-backed — either a live message
 * block still carrying a `queryHandle`, or a materialized pin marked `tiled`
 * (its `queryHandle` was stripped at pin time) **and** a `blockRef` exists to
 * build the tile URL from. A fresh inline delivery always renders inline. The
 * `tiled` case requires `hasRef` on purpose: without a ref there is no tile URL,
 * so an already-materialized pin falls back to its inline `rows` snapshot rather
 * than the "too large — pin it" notice, which only fits an unpersisted handle.
 */
export function isTileBoundGeo(
  fresh: WidgetRefreshResponse | null,
  content: GeoBlockContent,
  hasRef: boolean
): boolean {
  if (fresh?.kind === "inline") return false;
  if (fresh?.kind === "handle" || fresh?.kind === "tiles") return true;
  if (fresh != null) return false;
  if ("queryHandle" in content) return true;
  return (content as { tiled?: boolean }).tiled === true && hasRef;
}

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

/**
 * The colours a map draws its data in (#1022): the theme's
 * `palette.dataViz`, which `theme-contrast.test.ts` holds at 3:1 against the
 * theme's basemap. The web colours categorical and step maps from these, so
 * a saved map follows the viewer's theme.
 */
export interface MapColours {
  /** In assignment order; values past the last share `other`. */
  categorical: readonly string[];
  /** Values past the last categorical colour, and features with no value. */
  other: string;
}

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

/** A single anchor of a continuous (interpolate) ramp — a numeric value and
 *  the colour at it. The gradient legend draws a bar across these (#336). */
export interface GradientStop {
  value: number;
  color: string;
}

/**
 * A layer's legend — discriminated because a colorBy renders *either* discrete
 * swatches (categorical `match` / banded `step`) *or* a continuous gradient bar
 * (`interpolate`, #336). `buildLegend` returns one per colorBy layer.
 */
export type MapLegend =
  | {
      kind: "swatches";
      /** The column the colours encode, the legend's heading (#1022). */
      column: string;
      entries: LegendEntry[];
      /** Values past the last categorical colour, drawn in `other`. */
      more: number;
    }
  | {
      kind: "gradient";
      column: string;
      min: number;
      max: number;
      stops: GradientStop[];
    };

/** A column's distinct string or number values, in first-seen order. */
function distinctValues(values: Iterable<unknown>): Array<string | number> {
  const seen = new Set<string | number>();
  for (const v of values) {
    if (typeof v === "string" || typeof v === "number") seen.add(v);
  }
  return [...seen];
}

/**
 * Compile a `colorBy` into a MapLibre colour expression plus the legend the
 * widget draws.
 *
 * Categorical and step colouring take the theme's colours (#1022): the
 * values come from `colorBy.categories`, else the values of stored `stops`
 * (whose colours are ignored), else the rows' values in first-seen order,
 * and the i-th gets `categorical[i]`; values past the last share `other`.
 * `scale: "interpolate"` keeps its own ramp (stored stop colours, `palette`,
 * or `SEQUENTIAL_PALETTE`).
 */
export function resolveColorBy(
  colorBy: NonNullable<MapLayer["style"]>["colorBy"] & object,
  rows: Row[],
  colours: MapColours
): { expression: unknown; legend: MapLegend | null } {
  const { column } = colorBy;
  const scale = colorBy.scale;

  // Interpolate: a continuous blend across a strictly-ascending numeric ramp,
  // in the author's colours. MapLibre rejects duplicate/unsorted stops, so
  // sort + dedupe; if fewer than two distinct anchors survive, fall through
  // to step (never a broken expr).
  if (scale === "interpolate") {
    const ramp: readonly string[] =
      colorBy.palette && colorBy.palette.length
        ? colorBy.palette
        : SEQUENTIAL_PALETTE;
    const pairs: Array<readonly [string | number, string]> =
      colorBy.stops && colorBy.stops.length
        ? colorBy.stops
        : distinctValues(rows.map((r) => r[column])).map(
            (v, i) => [v, ramp[i % ramp.length]] as const
          );
    if (pairs.length && pairs.every(([v]) => toFiniteNum(v) != null)) {
      const sorted = pairs
        .map(([value, color]) => [toFiniteNum(value) as number, color] as const)
        .sort((a, b) => a[0] - b[0]);
      const deduped: Array<readonly [number, string]> = [];
      for (const pair of sorted) {
        if (deduped.length === 0 || deduped[deduped.length - 1][0] < pair[0]) {
          deduped.push(pair);
        }
      }
      if (deduped.length >= 2) {
        // `to-number` coerces null/absent → 0 so a present-but-null property
        // can't make `interpolate` throw (→ black layer); the outer
        // `case(has, …)` routes genuinely-absent values to `other`.
        const interp: unknown[] = [
          "interpolate",
          ["linear"],
          ["to-number", ["get", column], 0],
        ];
        for (const [value, color] of deduped) interp.push(value, color);
        return {
          expression: ["case", ["has", column], interp, colours.other],
          legend: {
            kind: "gradient",
            column,
            min: deduped[0][0],
            max: deduped[deduped.length - 1][0],
            stops: deduped.map(([value, color]) => ({ value, color })),
          },
        };
      }
    }
    // <2 distinct numeric anchors — fall through to step / categorical.
  }

  const values = distinctValues(
    colorBy.categories && colorBy.categories.length
      ? colorBy.categories
      : colorBy.stops && colorBy.stops.length
        ? colorBy.stops.map(([v]) => v)
        : rows.map((r) => r[column])
  );

  // No categories resolved (e.g. a tiled layer with nothing back-filled):
  // a solid visible colour rather than a `["match", input, fallback]` with
  // zero pairs, which MapLibre rejects / paints as the invisible fallback.
  if (values.length === 0) {
    return { expression: colours.categorical[0], legend: null };
  }

  const colourAt = (i: number) =>
    i < colours.categorical.length ? colours.categorical[i] : colours.other;
  const more = Math.max(0, values.length - colours.categorical.length);

  // Numeric OR numeric-string values are graduated (#346): the server
  // back-fill stores numeric columns as strings (the pg driver returns
  // numeric as text), so `"640"` is a number, not a category.
  // `scale: "categorical"` forces the match path even for numbers.
  const allNumeric = values.every((v) => toFiniteNum(v) != null);
  if (allNumeric && scale !== "categorical") {
    // Deduped after coercion: 1, "1" and "1.0" are one value, and MapLibre
    // rejects a step whose breakpoints aren't strictly ascending.
    const distinct = [
      ...new Set(values.map((v) => toFiniteNum(v) as number)),
    ].sort((a, b) => a - b);
    // At most one band per palette colour: past that, the lower bounds are
    // spread evenly through the sorted values, so every band keeps a colour
    // instead of the tail going to `other`.
    const k = colours.categorical.length;
    const sorted =
      distinct.length <= k
        ? distinct
        : Array.from(
            { length: k },
            (_, i) => distinct[Math.floor((i * distinct.length) / k)]
          );
    // step(input, base, break1, c1, …): a continuous value lands in its band.
    // `to-number` (null/absent → 0) because `step` THROWS on null and
    // MapLibre then paints the WHOLE layer black; ST_AsMVT can emit a
    // present-but-null property. Absent values get `other` via the `case`.
    const step: unknown[] = [
      "step",
      ["to-number", ["get", column], 0],
      colourAt(0),
    ];
    for (let i = 1; i < sorted.length; i++) step.push(sorted[i], colourAt(i));
    return {
      expression: ["case", ["has", column], step, colours.other],
      legend: {
        kind: "swatches",
        column,
        entries: sorted.map((value, i) => ({
          label: String(value),
          color: colourAt(i),
        })),
        more: 0,
      },
    };
  }

  // Exact categories: the first `categorical.length` values get a colour;
  // the rest, and values not listed, fall to `other`.
  const shown = values.slice(0, colours.categorical.length);
  const match: unknown[] = ["match", ["get", column]];
  shown.forEach((value, i) => match.push(value, colourAt(i)));
  match.push(colours.other);
  return {
    expression: match,
    legend: {
      kind: "swatches",
      column,
      entries: shown.map((value, i) => ({
        label: String(value),
        color: colourAt(i),
      })),
      more,
    },
  };
}

interface MapLibreLayer {
  id: string;
  type: "circle" | "fill" | "line" | "heatmap";
  source: string;
  paint: Record<string, unknown>;
  /** Optional zoom gating (kept for general MapLibre use). #532 removed the
   *  aggregation zoom handoff — raw and aggregate tiles now coexist at every
   *  zoom and are separated by the `_agg` feature filter below, not by zoom. */
  minzoom?: number;
  maxzoom?: number;
  /** Feature-property filter (#532). The aggregate fill draws only bins
   *  (`_agg == 1`); the raw layers draw only features without `_agg`. This lets
   *  a raw tile and a binned tile render correctly at the same zoom. */
  filter?: unknown[];
}

/** True for the feature picked from "Features in view" (#796), which the
 *  widget marks with `setFeatureState(…, { selected: true })`. */
const SELECTED = ["boolean", ["feature-state", "selected"], false];
/** Stroke/outline width of a selected point or polygon. */
const SELECTED_STROKE = 3;
/** Extra width of a selected line. */
const SELECTED_LINE_EXTRA = 2;
/** Extra radius of a selected point. */
const SELECTED_RADIUS_EXTRA = 3;
/** The selection ring's colour when the caller gives none: black, which
 *  contrasts with the light basemaps. */
const DEFAULT_HIGHLIGHT_COLOR = "#000000";

/** True when a style value is, or contains, a `["zoom"]` expression. */
const usesZoom = (value: unknown): boolean =>
  JSON.stringify(value ?? null).includes('["zoom"]');

/**
 * A paint value that changes while its feature is selected (#796). A literal
 * or a data expression is wrapped in a feature-state `case`. A `["zoom"]`
 * expression is left as authored, unhighlighted: MapLibre accepts zoom only
 * as the input of a top-level step/interpolate, so nesting it fails
 * `addLayer` and blanks the map.
 */
function whenSelected(base: unknown, selected: unknown): unknown {
  if (usesZoom(base)) return base;
  return ["case", SELECTED, selected, base];
}

/** `base + extra`, as a number for a literal or an expression otherwise. */
const plus = (base: unknown, extra: number): unknown =>
  typeof base === "number" ? base + extra : ["+", base, extra];

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
  opts: {
    tiled?: boolean;
    /** The selection ring's colour (#796): chosen by the widget to contrast
     *  with its basemap, never the author's outline colour, which can match
     *  the basemap (a white outline on a light map showed no selection). */
    highlightColor?: string;
    /** The theme's data colours (#1022). */
    colours: MapColours;
  }
): { layers: MapLibreLayer[]; legend: MapLegend | null } {
  const { colours } = opts;
  const highlight = opts.highlightColor ?? DEFAULT_HIGHLIGHT_COLOR;
  const source = sourceIdFor(index);
  const style = layer.style ?? {};
  let legend: MapLegend | null = null;

  let color: unknown = style.color ?? colours.categorical[0];
  if (style.colorBy) {
    const resolved = resolveColorBy(style.colorBy, rows, colours);
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
          "circle-radius": whenSelected(
            style.radius ?? 5,
            plus(style.radius ?? 5, SELECTED_RADIUS_EXTRA)
          ),
          "circle-opacity": style.opacity ?? 0.9,
          // #1022: a full-opacity stroke in `other` gives every point its
          // contrast against the basemap, whatever its fill.
          "circle-stroke-color": whenSelected(
            style.outlineColor ?? colours.other,
            highlight
          ),
          "circle-stroke-width": whenSelected(
            style.outlineWidth ?? 1,
            SELECTED_STROKE
          ),
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
          "line-color": whenSelected(style.outlineColor ?? color, highlight),
          // #1022: the fill is translucent, so this full-opacity outline in
          // the category colour is what carries the 3:1 against the basemap.
          "line-width": whenSelected(
            style.outlineWidth ?? 1.5,
            SELECTED_STROKE
          ),
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
          // A line keeps its data colour; it widens instead.
          "line-width": whenSelected(
            style.width ?? 2,
            plus(style.width ?? 2, SELECTED_LINE_EXTRA)
          ),
          // #1022: no `line-opacity`. A line is its own mark, so it stays at
          // full opacity, where its colour is held at 3:1.
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
  // #337/#472: only "bins" kinds get square-grid aggregation. Lines resolve to
  // "none" (raw, importance-ranked at every zoom). A polygon choropleth
  // (colorBy present) resolves to "dissolve" — the server serves real dissolved
  // geometry at low zoom, so the base fill/outline render ungated at all zooms
  // (painted by the same colorBy expression), exactly like the "none" path;
  // there is no centroid-bin fill.
  const agg = layer.aggregation;
  const treatment = resolveAggTreatment(layer.kind, agg?.treatment);
  // #532: an over-cap tile carries aggregate bins (`_agg:1`). Points bin below
  // the cap ("bins" treatment); lines serve a HYBRID (slice 4) — the longest
  // lines drawn raw plus the remainder as density bins — so a tiled line layer
  // also needs the split + a bin fill. Polygons never bin (dissolve/raw).
  const hybridLines = layer.kind === "lines";
  if (
    opts.tiled &&
    agg?.enabled !== false &&
    (treatment === "bins" || hybridLines)
  ) {
    // The server decides raw-vs-aggregate per tile by feature count, so a raw
    // tile and a binned tile can occur at the same zoom. Separate them by the
    // `_agg` feature flag rather than a min/max-zoom handoff: raw layers draw
    // only features without `_agg`; the aggregate fill draws only bins.
    for (const l of layers) l.filter = ["!", ["has", "_agg"]];
    // The line hybrid's bins carry only `_count` (density), never a colorBy value,
    // so they always use the density ramp.
    const densityFill = hybridLines || !style.colorBy;
    layers.push({
      id: `${source}-agg`,
      type: "fill",
      source,
      filter: ["==", ["get", "_agg"], 1],
      paint: densityFill
        ? {
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
          }
        : {
            "fill-color": color,
            "fill-opacity": cappedFillOpacity(style.opacity, AGG_FILL_OPACITY),
          },
    });
  }

  return { layers, legend };
}

/** The legend for the whole spec — the concatenation of each layer's colorBy. */
export function buildLegend(
  spec: MapSpec,
  rows: Row[],
  colours: MapColours
): MapLegend[] {
  const out: MapLegend[] = [];
  spec.layers.forEach((layer, i) => {
    const legend = layerToMapLibre(layer, i, rows, { colours }).legend;
    if (legend) out.push(legend);
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
 * How long a map waits for its basemap style before falling back to
 * `emptyBasemapStyle` (#910). A firewall that silently drops packets raises no
 * `error` event, so the timeout is what bounds that case.
 */
export const BASEMAP_LOAD_TIMEOUT_MS = 10_000;

/**
 * `palette.background.default` of the brand themes
 * (`packages/core/src/assets/themes/brand-theme{,-dark}.json`), which core
 * doesn't export as data.
 */
const EMPTY_BG = { light: "#ffffff", dark: "#0f0f1f" } as const;

/**
 * The no-basemap style (#910): no sources, so no tile egress and nothing for
 * the attribution control to credit, and one theme-coloured background layer.
 * Data layers need no glyphs or sprites, so they render on it unchanged.
 */
export function emptyBasemapStyle(
  mode: "light" | "dark"
): Record<string, unknown> {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": EMPTY_BG[mode] },
      },
    ],
  };
}

/** Wrap a raster XYZ template (`…/{z}/{x}/{y}.png`) in a MapLibre style. */
function rasterStyle(
  url: string,
  attribution: string
): Record<string, unknown> {
  return {
    version: 8,
    sources: {
      basemap: {
        type: "raster",
        tiles: [url],
        tileSize: 256,
        ...(attribution ? { attribution } : {}),
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap" }],
  };
}

/**
 * Resolve a MapSpec basemap to a MapLibre style. Under the install's `custom`
 * or `none` basemap (#910) the spec's choice is ignored entirely — a stored pin
 * or an agent-authored `{url}` can't reach a host the operator didn't
 * configure. Under `default`, the CARTO family is keyed to the active MUI
 * theme so the map matches light/dark; an explicit `{url}` or `osm` is
 * honoured verbatim.
 */
export function resolveBasemapStyle(
  basemap: MapBasemap,
  mode: "light" | "dark",
  // Required, not defaulted: a caller that forgot it would get CARTO on an
  // install configured to have no third-party basemap.
  install: InstallBasemap
): string | Record<string, unknown> {
  if (install.mode === "none") return emptyBasemapStyle(mode);
  if (install.mode === "custom") {
    const url =
      mode === "dark" && install.styleUrlDark
        ? install.styleUrlDark
        : install.styleUrl;
    return url.includes("{z}") ? rasterStyle(url, install.attribution) : url;
  }
  if (typeof basemap === "object") return basemap.url;
  if (basemap === "osm") return OSM_STYLE;
  return mode === "dark" ? CARTO_DARK : CARTO_LIGHT;
}
