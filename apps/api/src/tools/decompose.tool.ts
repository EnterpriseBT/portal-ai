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
  seasonalPeriod: z
    .number()
    .int()
    .min(2)
    .describe(
      "Seasonal cycle length (12 for monthly with yearly seasonality, etc.)."
    ),
  seasonality: z
    .enum(["additive", "multiplicative"])
    .optional()
    .describe(
      "Decomposition type. Default 'additive'. 'multiplicative' requires all observations > 0."
    ),
});

export class DecomposeTool extends Tool<typeof InputSchema> {
  slug = "decompose";
  name = "Decompose";
  description =
    "Classical seasonal decomposition of a time series into trend, " +
    "seasonal, and residual components, over a dataset you provide. Pass a `queryHandle` from sql_query (or inline `rows`) plus the date/value columns. Additive or multiplicative. " +
    "Trend uses a centered moving average; edge values are null where the MA cannot be computed.";

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
        return AnalyticsService.decompose({
          records,
          dateColumn: params.dateColumn,
          valueColumn: params.valueColumn,
          seasonalPeriod: params.seasonalPeriod,
          seasonality: params.seasonality,
        });
      },
    });
  }
}
