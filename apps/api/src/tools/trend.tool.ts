import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import {
  withComputeInput,
  resolveComputeRecords,
} from "./compute-input.util.js";

const InputSchema = withComputeInput({
  dateColumn: z.string().describe("Date column (a key in the rows)"),
  valueColumn: z.string().describe("Numeric value column (a key in the rows)"),
  interval: z
    .enum(["day", "week", "month", "quarter", "year"])
    .describe("Aggregation interval"),
  forecastPeriods: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Optional number of future buckets to project the linear fit. When supplied, the result includes a `forecast` field with the projected `dates` and `values`."
    ),
});

export class TrendTool extends Tool<typeof InputSchema> {
  slug = "trend";
  name = "Trend";
  description =
    "Aggregate a time series by interval and compute a linear trend line, over a dataset you provide. Pass a `queryHandle` from sql_query (or inline `rows`) plus the date/value columns.";

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
        return AnalyticsService.trend({
          records,
          dateColumn: params.dateColumn,
          valueColumn: params.valueColumn,
          interval: params.interval,
          forecastPeriods: params.forecastPeriods,
        });
      },
    });
  }
}
