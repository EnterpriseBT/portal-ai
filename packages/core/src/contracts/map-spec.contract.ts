import { z } from "zod";

import { VizPipelineSchema } from "./d3-widget.contract.js";
import { QueryHandleEnvelopeFieldsSchema } from "./portal-sql.contract.js";

/**
 * Declarative map-visualization contract (#84, child #314).
 *
 * `visualize_map` authors a `MapSpec` — a small, closed vocabulary the agent
 * writes directly (the same reason it writes SQL), so there is no codegen
 * sub-call and no model-authored JS. Style values accept **MapLibre
 * expressions** (`case` / `match` / `interpolate` / `get`), which gives full
 * per-feature, data-driven symbology as JSON with no network channel opened to
 * model output. A geometry column read back from PostGIS (#316) is already a
 * GeoJSON object, so a spec binds layers to result columns by name.
 */

// ── Basemap ──────────────────────────────────────────────────────────

/** A named key-free basemap, or a custom style URL. */
export const MapBasemapSchema = z.union([
  z.enum(["carto-light", "carto-dark", "osm"]),
  z.object({ url: z.string().url() }),
]);
export type MapBasemap = z.infer<typeof MapBasemapSchema>;

// ── Geometry source ──────────────────────────────────────────────────

/**
 * Where a layer's geometry comes from — a GeoJSON `geometry` column, or a
 * lat/lng numeric pair. Explicit and authoritative: an entity may carry two
 * coordinate pairs (origin/destination), so the columns are named, never
 * guessed. This names *columns*, not transport — inline-vs-tiles is the block
 * union's job (see `GeoBlockContentSchema`).
 */
export const MapGeometrySourceSchema = z.union([
  z.object({ geometryColumn: z.string().min(1) }),
  z.object({ latColumn: z.string().min(1), lngColumn: z.string().min(1) }),
]);
export type MapGeometrySource = z.infer<typeof MapGeometrySourceSchema>;

// ── Style values & expressions ───────────────────────────────────────

/**
 * A MapLibre expression — a JSON array whose head is an operator
 * (`["case", …]`, `["match", …]`, `["interpolate", …]`, `["get", "col"]`).
 * Recursive: an operand may itself be an expression. Passed through to
 * MapLibre as-is; a malformed expression surfaces as the widget's typed error
 * state, never a silent mis-render. The `min(1)` rejects a bare `[]` (an
 * expression must have an operator head).
 */
export const MapExpressionSchema: z.ZodType<unknown> = z.lazy(() =>
  z
    .array(
      z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.null(),
        MapExpressionSchema,
      ])
    )
    .min(1)
);

/** A style value is either a literal of type `T` or a MapLibre expression. */
const styleValue = <T extends z.ZodTypeAny>(literal: T) =>
  z.union([literal, MapExpressionSchema]);

export const MapLayerStyleSchema = z.object({
  color: styleValue(z.string()).optional(),
  /** Sugar over an expression: categorical/threshold colouring keyed to a
   *  result column. The renderer reads this to auto-generate a legend. */
  colorBy: z
    .object({
      column: z.string().min(1),
      palette: z.array(z.string()).optional(),
      /** Explicit value→colour pairs; omitted ⇒ palette assigned in sort order. */
      stops: z
        .array(z.tuple([z.union([z.string(), z.number()]), z.string()]))
        .optional(),
      /** Colour scale (#336). Absent ⇒ inferred (string stops → categorical,
       *  numeric → step). "interpolate" is a smooth continuous blend across the
       *  value range; a present value forces that mode against the inference. */
      scale: z.enum(["categorical", "step", "interpolate"]).optional(),
    })
    .optional(),
  opacity: styleValue(z.number().min(0).max(1)).optional(),
  radius: styleValue(z.number().positive()).optional(),
  width: styleValue(z.number().positive()).optional(),
  /** Outline colour/width for polygons + lines — expression-capable, which is
   *  how "highlight the vacant ones" gets a heavier stroke as well as a fill. */
  outlineColor: styleValue(z.string()).optional(),
  outlineWidth: styleValue(z.number().nonnegative()).optional(),
});
export type MapLayerStyle = z.infer<typeof MapLayerStyleSchema>;

// ── Layer ────────────────────────────────────────────────────────────

/**
 * Low-zoom overview control (#330). Below `zoomThreshold` the layer's features
 * are aggregated server-side into a square grid — each cell a bin colored by the
 * dominant `colorBy` category (count-density when there is no `colorBy`) — so a
 * dense layer stays legible zoomed out instead of clipping to an arbitrary
 * subset. All fields optional: an absent block means aggregation is ON with the
 * shared defaults (`AGG_ZOOM_THRESHOLD` / `AGG_GRID_PX`); `enabled: false` opts
 * the layer out.
 */
export const MapLayerAggregationSchema = z.object({
  enabled: z.boolean().optional(),
  gridSizePx: z.number().int().positive().max(128).optional(),
  zoomThreshold: z.number().int().min(0).max(22).optional(),
  /**
   * Low-zoom shape (#337). Absent ⇒ per-kind auto: `lines` → `"none"`,
   * everything else → `"bins"`. `"bins"` draws square grid bins; `"none"`
   * keeps raw features at all zooms (line layers are importance-ranked by
   * length so the per-tile cap keeps the major features, not an arbitrary
   * subset). A future `"density"` value would add a length-weighted surface.
   *
   * `"dissolve"` (#472): a polygon choropleth rendered as real, colored
   * polygons at low zoom — merged per `colorBy` value, served from a per-pin
   * precomputed + per-zoom-simplified geometry (raw-simplified polygons when no
   * precompute exists). Never centroid bins.
   */
  treatment: z.enum(["bins", "none", "dissolve"]).optional(),
});
export type MapLayerAggregation = z.infer<typeof MapLayerAggregationSchema>;
export type AggTreatment = NonNullable<MapLayerAggregation["treatment"]>;

export const MapLayerSchema = z
  .object({
    kind: z.enum(["points", "polygons", "lines", "heatmap", "cluster"]),
    source: MapGeometrySourceSchema,
    label: z.string().optional(),
    style: MapLayerStyleSchema.optional(),
    aggregation: MapLayerAggregationSchema.optional(),
  })
  .superRefine((l, ctx) => {
    // polygons/lines need real geometry — a coordinate pair cannot express them.
    if (
      (l.kind === "polygons" || l.kind === "lines") &&
      !("geometryColumn" in l.source)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["source"],
        message: `layer kind '${l.kind}' requires geometryColumn`,
      });
    }
  });
export type MapLayer = z.infer<typeof MapLayerSchema>;
export type MapLayerKind = MapLayer["kind"];

/**
 * Resolve a layer's low-zoom aggregation treatment (#337) — the single source
 * of truth shared by the server tile query (`aggregationFromSpec`) and the web
 * paint (`layerToMapLibre`). An explicit `treatment` always wins; otherwise the
 * per-kind default: `lines` render raw + importance-ranked (`"none"`), every
 * other kind gets square grid bins (`"bins"`). Deterministic — the fail-safe
 * never depends on an LLM guess.
 */
export function resolveAggTreatment(
  kind: MapLayerKind,
  treatment?: AggTreatment,
  // #472: `hasColorBy` gates the polygon `"dissolve"` default — a dissolve needs
  // a categorical value to merge on. A polygon choropleth (colorBy present)
  // renders as real dissolved polygons at low zoom; a polygon layer without a
  // colorBy keeps `"bins"` (density overview).
  opts?: { hasColorBy?: boolean }
): AggTreatment {
  if (treatment) return treatment;
  if (kind === "lines") return "none";
  if (kind === "polygons" && opts?.hasColorBy) return "dissolve";
  return "bins";
}

// ── Spec ─────────────────────────────────────────────────────────────

export const MapSpecSchema = z.object({
  basemap: MapBasemapSchema.default("carto-light"),
  initialView: z
    .union([
      z.object({ center: z.tuple([z.number(), z.number()]), zoom: z.number() }),
      z.literal("fit"),
    ])
    .default("fit"),
  layers: z.array(MapLayerSchema).min(1).max(8),
  /** Mustache-style template over the feature's row fields. */
  popup: z.object({ template: z.string().min(1) }).optional(),
});
export type MapSpec = z.infer<typeof MapSpecSchema>;

// ── Geo block content (mirrors d3-widget.contract.ts, handle branch first) ──

const GeoBaseContentSchema = z.object({
  spec: MapSpecSchema,
  title: z.string().optional(),
  /** Durable re-executable pipeline (shared with d3). */
  pipeline: VizPipelineSchema.optional(),
  /**
   * Reserved (contract seam, unused in #314). `visualize_map` never emits it
   * and the #314 renderer ignores it; reserving the field lets a future child
   * add a sandboxed codegen renderer without a block-type or pinned-schema
   * change. Contract: `program` present ⇒ sandbox path, else spec path.
   */
  program: z.string().min(1).optional(),
});

/** Inline binding — GeoJSON-bearing rows baked into the block (small results). */
export const GeoInlineContentSchema = GeoBaseContentSchema.extend({
  rows: z.array(z.record(z.string(), z.unknown())),
  /**
   * Materialized-pin marker (#371): the pinned source exceeded the inline
   * snapshot cap, so the widget must render the **full** dataset through the
   * pin's tile endpoint on mount — not the bounded `rows` subset (which would
   * show a spatial fraction of a choropleth and read as missing data). Only
   * set when the pin is refreshable (`pipeline` present), since the tile
   * endpoint re-runs that pipeline; `rows` stay as an inline fallback for a
   * render with no server-addressable ref. Absent/false ⇒ render inline.
   */
  tiled: z.boolean().optional(),
});
export type GeoInlineContent = z.infer<typeof GeoInlineContentSchema>;

/**
 * Handle binding — the full query-handle envelope rides the content (large
 * results). The widget renders this branch through vector **tiles** keyed to
 * the block's own message/pin coordinates (the spatial analogue of a query
 * handle), not by hydrating rows.
 */
export const GeoHandleContentSchema = GeoBaseContentSchema.extend(
  QueryHandleEnvelopeFieldsSchema.shape
);
export type GeoHandleContent = z.infer<typeof GeoHandleContentSchema>;

/**
 * Handle branch first: content carrying a `queryHandle` must resolve to the
 * handle branch (the inline schema would otherwise accept it as an extra key
 * when `rows` is also present — the producer never emits both).
 */
export const GeoBlockContentSchema = z.union([
  GeoHandleContentSchema,
  GeoInlineContentSchema,
]);
export type GeoBlockContent = z.infer<typeof GeoBlockContentSchema>;
