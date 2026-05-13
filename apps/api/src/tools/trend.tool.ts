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
  dateColumn: z.string().describe("Date column key"),
  valueColumn: z.string().describe("Numeric value column key"),
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
    "Aggregate a time series by interval and compute a linear trend line.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData, organizationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, dateColumn, valueColumn, interval, forecastPeriods } =
          this.validate(input);
        const records = await fetchEntityRows(
          stationData,
          entity,
          [dateColumn, valueColumn],
          organizationId
        );
        return AnalyticsService.trend({
          records,
          dateColumn,
          valueColumn,
          interval,
          forecastPeriods,
        });
      },
    });
  }
}
