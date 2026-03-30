import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";

// ---------------------------------------------------------------------------
// Vega spec schema — kept minimal to reduce tool-definition token cost.
//
// Same rationale as the Vega-Lite simplification in visualize.tool.ts:
// Claude knows the Vega grammar natively; the renderer is the real
// validator. We only enforce the structural contract the execute()
// function relies on (data array present) and guide the model via
// the description.
// ---------------------------------------------------------------------------

// NOTE: Do NOT use .transform() or .refine() here — the Vercel AI SDK
// converts Zod schemas to JSON Schema via zodToJsonSchema, and ZodEffects
// types break that serialization.

const VegaSpecSchema = z
  .record(z.string(), z.unknown())
  .describe(
    "A complete Vega v5 JSON spec for hierarchical or network visualizations. " +
    "Must include a `data` array — data[0].values will be overwritten with SQL query results. " +
    "Use Vega transforms (stratify, tree, treelinks, treemap, force, pack, partition) " +
    "to derive layout from flat row data. Include `marks` array with encode blocks " +
    "(enter/update) for visual properties. Supports scales, axes, legends, signals, " +
    "and projections as top-level arrays."
  );

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
