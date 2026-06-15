import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import {
  withComputeInput,
  resolveComputeRecords,
} from "./compute-input.util.js";

const InputSchema = withComputeInput({
  dateColumn: z
    .string()
    .optional()
    .describe(
      "Optional date column for output labels (a key in the rows). When omitted, indices are returned without dates."
    ),
  valueColumn: z.string().describe("Numeric value column (a key in the rows)"),
  threshold: z
    .number()
    .positive()
    .optional()
    .describe(
      "CUSUM threshold in standard deviations of the standardized series. Default 5.0; lower values produce more (smaller) detected shifts."
    ),
  minSegmentLength: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Minimum spacing between consecutive changepoints. Default ⌈n/20⌉, floor of 5."
    ),
});

export class ChangepointTool extends Tool<typeof InputSchema> {
  slug = "changepoint";
  name = "Changepoint";
  description =
    "Detect mean-shift changepoints in a numeric series via CUSUM, over a dataset you provide. Pass a `queryHandle` from sql_query (or inline `rows`) plus the value column. " +
    "Returns indices, optional dates, per-segment means, and segment ranges.";

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
        return AnalyticsService.changepoint({
          records,
          dateColumn: params.dateColumn,
          valueColumn: params.valueColumn,
          threshold: params.threshold,
          minSegmentLength: params.minSegmentLength,
        });
      },
    });
  }
}
