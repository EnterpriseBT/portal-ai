import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";

// -- Reusable primitives -----------------------------------------------------

const SignalRef = z.object({ signal: z.string() }).passthrough();
const NumOrSignal = z.union([z.number(), SignalRef]);
const StrOrSignal = z.union([z.string(), SignalRef]);

// -- Transform / Data / Signal -----------------------------------------------

const TransformSchema = z.record(z.string(), z.unknown()).describe(
  "Vega transform: aggregate, bin, collect, contour, cross, density, extent, " +
  "filter, flatten, fold, force, formula, geopath, geoshape, identifier, " +
  "joinaggregate, kde, linkpath, loess, lookup, nest, pack, partition, pie, " +
  "pivot, quantile, regression, sample, sequence, stack, stratify, tree, " +
  "treelinks, treemap, voronoi, window, wordcloud",
);

const DataSchema = z
  .object({
    name: z.string(),
    source: z.union([z.string(), z.array(z.string())]).optional(),
    url: StrOrSignal.optional(),
    values: z.unknown().optional().describe("Overwritten with SQL results for data[0]"),
    format: z
      .object({ type: z.enum(["json", "csv", "tsv", "dsv", "topojson"]).optional() })
      .passthrough()
      .optional(),
    transform: z.array(TransformSchema).optional(),
  })
  .passthrough();

const SignalSchema = z
  .object({
    name: z.string(),
    value: z.unknown().optional(),
    update: z.string().optional(),
    on: z.array(z.record(z.string(), z.unknown())).optional(),
    bind: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

// -- Scale / Axis / Legend / Projection --------------------------------------

const ScaleSchema = z
  .object({
    name: z.string(),
    type: z
      .enum([
        "linear", "pow", "sqrt", "log", "symlog", "time", "utc", "sequential",
        "ordinal", "band", "point",
        "quantile", "quantize", "threshold", "bin-ordinal", "identity",
      ])
      .optional(),
    domain: z.unknown().optional(),
    range: z.unknown().optional(),
    padding: NumOrSignal.optional(),
    paddingInner: NumOrSignal.optional(),
    paddingOuter: NumOrSignal.optional(),
    nice: z.union([z.boolean(), z.number(), z.string(), SignalRef]).optional(),
    zero: z.union([z.boolean(), SignalRef]).optional(),
    reverse: z.union([z.boolean(), SignalRef]).optional(),
    round: z.union([z.boolean(), SignalRef]).optional(),
    clamp: z.union([z.boolean(), SignalRef]).optional(),
  })
  .passthrough();

const AxisSchema = z
  .object({
    orient: z.union([z.enum(["top", "bottom", "left", "right"]), SignalRef]),
    scale: z.string(),
    title: z.union([z.string(), z.array(z.string()), SignalRef]).optional(),
    format: StrOrSignal.optional(),
    formatType: z.union([z.enum(["number", "time", "utc"]), SignalRef]).optional(),
    values: z.union([z.array(z.unknown()), SignalRef]).optional(),
    tickCount: z.union([z.number(), z.string(), SignalRef]).optional(),
    grid: z.boolean().optional(),
    labels: z.boolean().optional(),
    domain: z.boolean().optional(),
    encode: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const LegendSchema = z
  .object({
    fill: z.string().optional(),
    stroke: z.string().optional(),
    size: z.string().optional(),
    shape: z.string().optional(),
    opacity: z.string().optional(),
    strokeDash: z.string().optional(),
    type: z.enum(["gradient", "symbol", "discrete"]).optional(),
    direction: z.enum(["vertical", "horizontal"]).optional(),
    orient: z
      .enum(["none", "left", "right", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"])
      .optional(),
    title: z.union([z.string(), z.array(z.string()), SignalRef]).optional(),
    encode: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const ProjectionSchema = z
  .object({
    name: z.string(),
    type: z
      .union([
        z.enum([
          "albers", "albersUsa", "azimuthalEqualArea", "azimuthalEquidistant",
          "conicConformal", "conicEqualArea", "conicEquidistant", "equalEarth",
          "equirectangular", "gnomonic", "identity", "mercator", "naturalEarth1",
          "orthographic", "stereographic", "transverseMercator",
        ]),
        SignalRef,
      ])
      .optional(),
    center: z.unknown().optional(),
    rotate: z.unknown().optional(),
    scale: NumOrSignal.optional(),
    translate: z.unknown().optional(),
    fit: z.unknown().optional(),
    extent: z.unknown().optional(),
    size: z.unknown().optional(),
  })
  .passthrough();

// -- Marks -------------------------------------------------------------------

const MarkTypeSchema = z.enum([
  "arc", "area", "group", "image", "line", "path",
  "rect", "rule", "shape", "symbol", "text", "trail",
]);

const EncodeSchema = z
  .object({
    enter: z.record(z.string(), z.unknown()).optional(),
    update: z.record(z.string(), z.unknown()).optional(),
    exit: z.record(z.string(), z.unknown()).optional(),
    hover: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .describe(
    "Encode channels: x, y, x2, y2, xc, yc, width, height, fill, stroke, opacity, " +
    "size, shape, angle, text, font, fontSize, path, startAngle, endAngle, " +
    "innerRadius, outerRadius, cornerRadius, interpolate, tooltip, cursor",
  );

const MarkSchema: z.ZodType = z
  .object({
    type: MarkTypeSchema,
    name: z.string().optional(),
    from: z
      .object({
        data: z.string().optional(),
        facet: z
          .object({ name: z.string(), data: z.string() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    encode: EncodeSchema.optional(),
    transform: z.array(TransformSchema).optional(),
    interactive: z.union([z.boolean(), SignalRef]).optional(),
    on: z.array(z.record(z.string(), z.unknown())).optional(),
    // Group mark sub-elements
    marks: z.lazy((): z.ZodType => z.array(MarkSchema)).optional(),
    scales: z.array(ScaleSchema).optional(),
    axes: z.array(AxisSchema).optional(),
    legends: z.array(LegendSchema).optional(),
    signals: z.array(SignalSchema).optional(),
    data: z.array(DataSchema).optional(),
    layout: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

// -- Top-level Vega spec -----------------------------------------------------

const VegaSpecSchema = z
  .object({
    $schema: z.string().optional().describe("https://vega.github.io/schema/vega/v5.json"),
    description: z.string().optional(),
    width: NumOrSignal.optional(),
    height: NumOrSignal.optional(),
    padding: z
      .union([
        z.number(),
        z.object({
          top: z.number().optional(),
          bottom: z.number().optional(),
          left: z.number().optional(),
          right: z.number().optional(),
        }),
        SignalRef,
      ])
      .optional(),
    autosize: z
      .union([
        z.enum(["pad", "fit", "fit-x", "fit-y", "none"]),
        z.object({ type: z.enum(["pad", "fit", "fit-x", "fit-y", "none"]) }).passthrough(),
        SignalRef,
      ])
      .optional(),
    background: StrOrSignal.optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    // Scope
    data: z.array(DataSchema).describe("Data sources — data[0].values overwritten with SQL results"),
    signals: z.array(SignalSchema).optional(),
    scales: z.array(ScaleSchema).optional(),
    projections: z.array(ProjectionSchema).optional(),
    axes: z.array(AxisSchema).optional(),
    legends: z.array(LegendSchema).optional(),
    marks: z.array(MarkSchema).describe("Visual mark definitions"),
    title: z.union([z.string(), z.object({ text: StrOrSignal }).passthrough(), SignalRef]).optional(),
    encode: EncodeSchema.optional(),
    layout: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

// -- Tool input & class ------------------------------------------------------

const InputSchema = z.object({
  sql: z.string().describe("SQL query to fetch node/link data"),
  vegaSpec: VegaSpecSchema.describe(
    "Full Vega spec — data[0].values will be overwritten with query results",
  ),
});

export class VisualizeTreeTool extends Tool<typeof InputSchema> {
  slug = "visualize_tree";
  name = "Visualize Tree";
  description =
    "Build a full Vega spec for hierarchical or network visualizations " +
    "(trees, treemaps, sunbursts, force-directed graphs). " +
    "Use this instead of visualize when the chart requires Vega transforms " +
    "like stratify, tree, force, or treemap.";

  get schema() {
    return InputSchema;
  }

  build(stationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { sql, vegaSpec } = this.validate(input);
        return AnalyticsService.visualizeVega({
          sql,
          vegaSpec,
          stationId,
        });
      },
    });
  }
}
