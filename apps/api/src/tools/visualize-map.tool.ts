import { z } from "zod";
import { tool } from "ai";

import { MapSpecSchema } from "@portalai/core/contracts";

import { Tool } from "../types/tools.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { resolveSqlDelivery as defaultResolveSqlDelivery } from "./result-sink.js";

// -- Tool input --------------------------------------------------------------
//
// Unlike `visualize_d3`, the agent authors the render spec directly: a MapSpec
// is a small closed vocabulary (the same reason the agent writes SQL), so there
// is no codegen sub-call and no model-written JS. `spec` is intentionally typed
// loosely here so a malformed spec reaches `execute` and is returned as a typed
// `MAP_SPEC_INVALID` result the agent can read and repair — rather than a
// framework-level arg-rejection. The authoritative shape is `MapSpecSchema`,
// taught in the system prompt.

const InputSchema = z.object({
  sql: z
    .string()
    .describe(
      "SQL selecting the rows to map. Select the raw geometry column (aliased `geom`) when the result may be large so it can render as vector tiles; do not add a LIMIT — result size is handled automatically."
    ),
  spec: z
    .record(z.string(), z.unknown())
    .describe(
      "A MapSpec object: { basemap?, initialView?, layers: [{ kind: points|polygons|lines|heatmap|cluster, source: {geometryColumn} | {latColumn,lngColumn}, style?, label? }], popup? }. Style values accept MapLibre expressions (case/match/interpolate/get) for per-feature symbology; `colorBy` is sugar that also drives a legend. 1–8 layers."
    ),
  title: z.string().optional(),
});

/** Injectable dependencies (test seam; mirrors the DI style used elsewhere). */
export interface VisualizeMapDeps {
  resolveSqlDelivery?: typeof defaultResolveSqlDelivery;
}

/** Inline rows out of a delivery result (inline path only). */
function inlineRows(
  delivery: Awaited<ReturnType<typeof defaultResolveSqlDelivery>>
): Array<Record<string, unknown>> {
  if (delivery.kind === "handle") return [];
  const result = delivery.result as {
    rows?: Array<Record<string, unknown>>;
    sample?: Array<Record<string, unknown>>;
  };
  return result.rows ?? result.sample ?? [];
}

export class VisualizeMapTool extends Tool<typeof InputSchema> {
  slug = "visualize_map";
  name = "Visualize (Map)";
  description =
    "Render an interactive map from a SQL query and a declarative MapSpec. Bind layers to result columns (a `geometry` column, or a lat/lng pair); style with literals or MapLibre expressions for per-feature colouring. Large results render as vector tiles automatically, small ones inline — do not add a LIMIT.";

  get schema() {
    return InputSchema;
  }

  build(
    stationId: string,
    organizationId: string,
    deps: VisualizeMapDeps = {}
  ) {
    const resolveSqlDelivery =
      deps.resolveSqlDelivery ?? defaultResolveSqlDelivery;

    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { sql, spec: rawSpec, title } = this.validate(input);

        // Validate the spec explicitly so a malformed one is a typed result
        // the agent relays + repairs — never a partial or mis-styled render
        // (Visibility of limits, row 8).
        const specResult = MapSpecSchema.safeParse(rawSpec);
        if (!specResult.success) {
          return {
            error: {
              code: ApiCode.MAP_SPEC_INVALID,
              message: specResult.error.issues
                .map((i) => `${i.path.join(".") || "spec"}: ${i.message}`)
                .join("; "),
            },
          };
        }
        const spec = specResult.data;

        const delivery = await resolveSqlDelivery(
          { sql },
          { stationId, organizationId }
        );
        const titleField = title ? { title } : {};
        // Durable, re-executable pipeline so the widget can re-run its SQL for
        // live data (and tile the handle branch) after the Redis handle expires.
        const pipeline = { sql, stationId, organizationId };

        // Handle branch first — a large result rides its query-handle envelope
        // and the widget renders it through vector tiles; a small one inlines
        // its GeoJSON rows. Same size threshold the sink already applies.
        if (delivery.kind === "handle") {
          return {
            type: "geo",
            spec,
            ...titleField,
            pipeline,
            ...delivery.envelope,
          };
        }
        return {
          type: "geo",
          spec,
          ...titleField,
          pipeline,
          rows: inlineRows(delivery),
        };
      },
    });
  }
}
