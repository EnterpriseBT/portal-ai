import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import {
  withComputeInput,
  resolveComputeRecords,
} from "./compute-input.util.js";

const InputSchema = withComputeInput({
  groupBy: z
    .array(z.string())
    .describe(
      "Columns to group by (keys in the rows). Pass [] to aggregate over the whole dataset."
    ),
  metrics: z
    .array(
      z.object({
        column: z
          .string()
          .optional()
          .describe(
            "Numeric column the operation runs over. Omit when op is 'count'."
          ),
        op: z
          .enum([
            "count",
            "sum",
            "mean",
            "median",
            "min",
            "max",
            "stddev",
            "p25",
            "p75",
          ])
          .describe(
            "Aggregation op. 'count' tallies rows; the others reduce the named numeric column. " +
              "stddev uses the sample (n-1) divisor; single-row groups produce undefined for stddev."
          ),
        as: z
          .string()
          .optional()
          .describe(
            "Alias for the result column. Defaults to '<op>_<column>' or 'count'."
          ),
      })
    )
    .min(1)
    .describe("One or more aggregations to compute per group."),
});

export class AggregateTool extends Tool<typeof InputSchema> {
  slug = "aggregate";
  name = "Aggregate";
  description =
    "Group-by + reduce over a dataset you provide. Produces one row per group with the requested metrics. Pass a `queryHandle` from sql_query (or inline `rows`) plus `groupBy` and `metrics`.";

  get schema() {
    return InputSchema;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const params = this.validate(input);
        const records = await resolveComputeRecords(params);
        return AnalyticsService.aggregate({
          records,
          groupBy: params.groupBy,
          metrics: params.metrics,
        });
      },
    });
  }
}
