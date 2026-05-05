import { z } from "zod";
import { tool } from "ai";

import {
  AnalyticsService,
  type StationData,
} from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import { getRecords } from "../utils/tools.util.js";

const InputSchema = z.object({
  entity: z.string().describe("Entity (table) to aggregate."),
  groupBy: z
    .array(z.string())
    .describe(
      "Columns to group by. Pass [] to aggregate over the whole table."
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
    "Group-by + reduce. Produces one row per group with the requested metrics.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, groupBy, metrics } = this.validate(input);
        const records = getRecords(stationData, entity);
        return AnalyticsService.aggregate({ records, groupBy, metrics });
      },
    });
  }
}
