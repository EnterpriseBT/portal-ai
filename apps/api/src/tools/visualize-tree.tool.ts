import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { PortalSqlHandleService } from "../services/portal-sql-handle.service.js";
import { Tool } from "../types/tools.js";
import { INLINE_ROWS_THRESHOLD } from "@portalai/core/constants";

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
    "Full Vega spec — data[0].values will be overwritten with query results"
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

  build(stationId: string, organizationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { sql, vegaSpec } = this.validate(input);

        const inlineResponse = await AnalyticsService.sqlQuery({
          sql,
          stationId,
          organizationId,
        });

        const rowCount = countRows(inlineResponse);
        if (rowCount <= INLINE_ROWS_THRESHOLD) {
          return AnalyticsService.visualizeVega({
            sql,
            vegaSpec,
            stationId,
            organizationId,
          });
        }

        // Handle path: tree specs accumulate the full dataset before
        // rendering — the widget batches arrivals client-side and
        // debounces re-layout, but the wire shape is the same as
        // visualize.
        const { envelope } = await PortalSqlHandleService.produce({
          stationId,
          organizationId,
          sql,
        });
        return {
          type: "vega",
          ...envelope,
          spec: vegaSpec,
        };
      },
    });
  }
}

function countRows(
  response: Awaited<ReturnType<typeof AnalyticsService.sqlQuery>>
): number {
  if ("sample" in response) {
    return response.totalCount;
  }
  if ("truncated" in response && response.truncated) {
    return response.totalCount;
  }
  return response.rows.length;
}
