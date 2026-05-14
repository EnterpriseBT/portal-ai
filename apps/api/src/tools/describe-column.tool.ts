import { z } from "zod";
import { tool } from "ai";

import {
  AnalyticsService,
  type StationData,
} from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import { fetchEntityRows } from "../utils/tools.util.js";

const InputSchema = z.object({
  entity: z.string().describe("Entity key (table name)"),
  column: z.string().describe("Numeric column key"),
  percentiles: z
    .array(z.number().min(0).max(1))
    .optional()
    .describe(
      "Optional list of percentiles to compute (each in [0, 1]). " +
        "Returned under `percentiles` keyed by the input number stringified."
    ),
});

export class DescribeColumnTool extends Tool<typeof InputSchema> {
  slug = "describe_column";
  name = "Describe Column";
  description =
    "Compute descriptive statistics (count, mean, median, stddev, variance, mode, min/max, p25/p75, IQR, skewness, kurtosis) for a numeric column. Optionally include arbitrary percentiles.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData, organizationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, column, percentiles } = this.validate(input);
        const records = await fetchEntityRows(
          stationData,
          entity,
          [column],
          organizationId
        );
        return AnalyticsService.describeColumn({
          records,
          column,
          percentiles,
        });
      },
    });
  }
}
