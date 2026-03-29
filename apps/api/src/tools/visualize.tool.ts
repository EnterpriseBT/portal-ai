import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
// ---------------------------------------------------------------------------
// Vega-Lite spec schema — kept minimal to reduce tool-definition token cost.
//
// Claude already knows Vega-Lite well. Rather than encoding every mark type,
// encoding channel, and composition variant in Zod (which serialises to a
// huge JSON Schema in the API payload), we accept an opaque object and rely
// on the tool description to guide the model. Runtime validation is
// intentionally loose; the Vega-Lite renderer itself is the real validator.
//
// NOTE: Do NOT use .transform() or .refine() here — the Vercel AI SDK
// converts Zod schemas to JSON Schema via zodToJsonSchema, and ZodEffects
// types break that serialization.
// ---------------------------------------------------------------------------

const VegaLiteSpecSchema = z
  .record(z.string(), z.unknown())
  .describe(
    "A complete Vega-Lite v5 JSON spec (unit, layered, or composed). " +
    "Do NOT include a `data` field — it will be populated from the SQL query results. " +
    "Must contain `mark` + `encoding` for single views, or a composition key " +
    "(`layer`, `concat`, `hconcat`, `vconcat`, `facet`, `repeat`). " +
    "Use standard Vega-Lite encoding channels (x, y, color, size, tooltip, etc.) " +
    "with field, type (quantitative/ordinal/nominal/temporal), and optional " +
    "aggregate/bin/timeUnit/scale/axis properties."
  );

export type VegaLiteSpecInput = Record<string, unknown>;

// -- Tool input & class ------------------------------------------------------

const InputSchema = z.object({
  sql: z.string().describe("SQL query to fetch chart data"),
  vegaLiteSpec: VegaLiteSpecSchema,
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
