import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import {
  withComputeInput,
  resolveComputeRecords,
} from "./compute-input.util.js";

const InputSchema = withComputeInput({
  column: z.string().describe("Numeric column to describe (a key in the rows)"),
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
    "Compute descriptive statistics (count, mean, median, stddev, variance, mode, min/max, p25/p75, IQR, skewness, kurtosis) for a numeric column over a dataset you provide. Pass a `queryHandle` from sql_query (or inline `rows`) plus the `column` to describe.";

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
        return AnalyticsService.describeColumn({
          records,
          column: params.column,
          percentiles: params.percentiles,
        });
      },
    });
  }
}
