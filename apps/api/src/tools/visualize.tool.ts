import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import { type TopLevelSpec } from "vega-lite";

// -- Mark --------------------------------------------------------------------

const MarkTypeSchema = z.enum([
  "arc", "area", "bar", "boxplot", "circle", "errorband", "errorbar",
  "geoshape", "image", "line", "point", "rect", "rule", "square",
  "text", "tick", "trail",
]);

const MarkDefSchema = z
  .object({
    type: MarkTypeSchema,
    color: z.string().optional(),
    fill: z.string().nullable().optional(),
    stroke: z.string().nullable().optional(),
    opacity: z.number().optional(),
    size: z.number().optional(),
    orient: z.enum(["horizontal", "vertical"]).optional(),
    interpolate: z.string().optional(),
    point: z.union([z.boolean(), z.literal("transparent")]).optional(),
    line: z.boolean().optional(),
    tooltip: z.union([z.boolean(), z.null()]).optional(),
  })
  .passthrough();

const MarkSchema = z.union([MarkTypeSchema, MarkDefSchema]).describe("Mark type or definition");

// -- Encoding ----------------------------------------------------------------

const DataTypeSchema = z.enum(["quantitative", "ordinal", "nominal", "temporal", "geojson"]);

const AggregateSchema = z.union([
  z.enum([
    "count", "sum", "mean", "average", "median", "min", "max",
    "q1", "q3", "ci0", "ci1", "variance", "stdev", "stdevp",
    "distinct", "product", "values", "valid", "missing",
  ]),
  z.object({ argmin: z.string() }),
  z.object({ argmax: z.string() }),
]);

const ChannelDefSchema = z
  .object({
    field: z.string().optional(),
    type: DataTypeSchema.optional(),
    aggregate: AggregateSchema.optional(),
    bin: z.union([z.boolean(), z.literal("binned"), z.record(z.string(), z.unknown())]).optional(),
    timeUnit: z.string().optional().describe("e.g. year, month, yearmonth, yearmonthdate"),
    sort: z.union([z.enum(["ascending", "descending"]), z.string(), z.array(z.unknown()), z.null()]).optional(),
    scale: z.record(z.string(), z.unknown()).nullable().optional(),
    axis: z.record(z.string(), z.unknown()).nullable().optional(),
    legend: z.record(z.string(), z.unknown()).nullable().optional(),
    title: z.union([z.string(), z.null()]).optional(),
    stack: z.union([z.boolean(), z.null(), z.enum(["zero", "center", "normalize"])]).optional(),
    condition: z.unknown().optional(),
    value: z.unknown().optional(),
    datum: z.unknown().optional(),
  })
  .passthrough();

const EncodingSchema = z
  .object({
    x: ChannelDefSchema.optional(),
    y: ChannelDefSchema.optional(),
    x2: ChannelDefSchema.optional(),
    y2: ChannelDefSchema.optional(),
    xOffset: ChannelDefSchema.optional(),
    yOffset: ChannelDefSchema.optional(),
    theta: ChannelDefSchema.optional(),
    theta2: ChannelDefSchema.optional(),
    radius: ChannelDefSchema.optional(),
    radius2: ChannelDefSchema.optional(),
    color: ChannelDefSchema.optional(),
    fill: ChannelDefSchema.optional(),
    stroke: ChannelDefSchema.optional(),
    size: ChannelDefSchema.optional(),
    shape: ChannelDefSchema.optional(),
    opacity: ChannelDefSchema.optional(),
    angle: ChannelDefSchema.optional(),
    text: ChannelDefSchema.optional(),
    tooltip: z.union([ChannelDefSchema, z.array(ChannelDefSchema), z.null()]).optional(),
    detail: z.union([ChannelDefSchema, z.array(ChannelDefSchema)]).optional(),
    order: z.union([ChannelDefSchema, z.array(ChannelDefSchema)]).optional(),
    row: ChannelDefSchema.optional(),
    column: ChannelDefSchema.optional(),
    facet: ChannelDefSchema.optional(),
  })
  .passthrough()
  .describe("Channel-to-field encoding mappings");

// -- Transforms / Params -----------------------------------------------------

const TransformSchema = z.record(z.string(), z.unknown()).describe(
  "Transform: filter, calculate, bin, timeUnit, aggregate, window, fold, flatten, " +
    "pivot, sample, lookup, density, quantile, regression, loess, stack, impute, extent",
);

const ParamSchema = z
  .object({
    name: z.string(),
    select: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
    value: z.unknown().optional(),
    bind: z.unknown().optional(),
  })
  .passthrough();

// -- Top-level properties ----------------------------------------------------

const TopLevelPropsSchema = z.object({
  $schema: z.string().optional().describe("https://vega.github.io/schema/vega-lite/v5.json"),
  description: z.string().optional(),
  title: z.union([z.string(), z.object({ text: z.string() }).passthrough()]).optional(),
  width: z.union([z.number(), z.literal("container")]).optional(),
  height: z.union([z.number(), z.literal("container")]).optional(),
  autosize: z
    .union([
      z.enum(["pad", "none", "fit", "fit-x", "fit-y"]),
      z.object({ type: z.enum(["pad", "none", "fit", "fit-x", "fit-y"]) }).passthrough(),
    ])
    .optional(),
  background: z.string().optional(),
  padding: z.union([z.number(), z.object({ top: z.number().optional(), bottom: z.number().optional(), left: z.number().optional(), right: z.number().optional() })]).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  params: z.array(ParamSchema).optional(),
});

// -- Spec variants -----------------------------------------------------------

const UnitSpecSchema = z
  .object({
    mark: MarkSchema,
    encoding: EncodingSchema.optional(),
    transform: z.array(TransformSchema).optional(),
    selection: z.record(z.string(), z.unknown()).optional(),
    projection: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const LayerSpecSchema: z.ZodType = z
  .object({
    layer: z.array(z.union([UnitSpecSchema, z.lazy((): z.ZodType => LayerSpecSchema)])),
    encoding: EncodingSchema.optional(),
    transform: z.array(TransformSchema).optional(),
  })
  .passthrough();

const SubSpecSchema: z.ZodType = z.lazy(() =>
  z.union([UnitSpecSchema, LayerSpecSchema, ComposedSpecSchema]),
);

const ComposedSpecSchema = z.union([
  z.object({ facet: z.unknown(), spec: SubSpecSchema, columns: z.number().optional() }).passthrough(),
  z.object({ repeat: z.union([z.array(z.string()), z.object({ row: z.array(z.string()).optional(), column: z.array(z.string()).optional(), layer: z.array(z.string()).optional() })]), spec: SubSpecSchema, columns: z.number().optional() }).passthrough(),
  z.object({ concat: z.array(SubSpecSchema), columns: z.number().optional() }).passthrough(),
  z.object({ hconcat: z.array(SubSpecSchema) }).passthrough(),
  z.object({ vconcat: z.array(SubSpecSchema) }).passthrough(),
]);

// -- Top-level schemas -------------------------------------------------------

const VegaLiteUnitSpecSchema = TopLevelPropsSchema.merge(UnitSpecSchema)
  .passthrough()
  .describe("Single-view spec with mark and encoding");

const VegaLiteLayerSpecSchema = TopLevelPropsSchema.merge(
  z.object({
    layer: z.array(z.union([UnitSpecSchema, z.lazy((): z.ZodType => LayerSpecSchema)])),
    encoding: EncodingSchema.optional(),
    transform: z.array(TransformSchema).optional(),
  }),
).passthrough().describe("Layered spec with overlaid views");

const VegaLiteFacetSpecSchema = TopLevelPropsSchema.merge(
  z.object({ facet: z.unknown(), spec: SubSpecSchema, columns: z.number().optional(), transform: z.array(TransformSchema).optional() }),
).passthrough();

const VegaLiteRepeatSpecSchema = TopLevelPropsSchema.merge(
  z.object({ repeat: z.union([z.array(z.string()), z.object({ row: z.array(z.string()).optional(), column: z.array(z.string()).optional(), layer: z.array(z.string()).optional() })]), spec: SubSpecSchema, columns: z.number().optional() }),
).passthrough();

const VegaLiteConcatSpecSchema = TopLevelPropsSchema.merge(
  z.object({ concat: z.array(SubSpecSchema), columns: z.number().optional() }),
).passthrough();

const VegaLiteHConcatSpecSchema = TopLevelPropsSchema.merge(
  z.object({ hconcat: z.array(SubSpecSchema) }),
).passthrough();

const VegaLiteVConcatSpecSchema = TopLevelPropsSchema.merge(
  z.object({ vconcat: z.array(SubSpecSchema) }),
).passthrough();

const TopLevelVegaLiteSpecSchema = z
  .union([
    VegaLiteUnitSpecSchema,
    VegaLiteLayerSpecSchema,
    VegaLiteFacetSpecSchema,
    VegaLiteRepeatSpecSchema,
    VegaLiteConcatSpecSchema,
    VegaLiteHConcatSpecSchema,
    VegaLiteVConcatSpecSchema,
  ])
  .transform((val) => val as unknown as TopLevelSpec)
  .describe("Complete Vega-Lite spec. Data field will be overwritten with query results.");

export type VegaLiteSpecInput = TopLevelSpec;

// -- Tool input & class ------------------------------------------------------

const InputSchema = z.object({
  sql: z.string().describe("SQL query to fetch chart data"),
  vegaLiteSpec: TopLevelVegaLiteSpecSchema,
});

export class VisualizeTool extends Tool<typeof InputSchema> {
  slug = "visualize";
  name = "Visualize";
  description =
    "Run a SQL query and inject the results into a Vega-Lite specification for charting.";

  get schema() {
    return InputSchema;
  }

  build(stationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { sql, vegaLiteSpec } = this.validate(input);
        return AnalyticsService.visualize({
          sql,
          vegaLiteSpec,
          stationId,
        });
      },
    });
  }
}
