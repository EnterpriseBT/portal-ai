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
  horizon: z
    .number()
    .int()
    .positive()
    .describe("Number of future periods to forecast."),
  seasonalPeriod: z
    .number()
    .int()
    .min(2)
    .optional()
    .describe(
      "Seasonal cycle length (e.g. 12 for monthly with yearly seasonality, 7 for daily-with-weekly). Required for additive/multiplicative seasonality."
    ),
  seasonality: z
    .enum(["none", "additive", "multiplicative"])
    .optional()
    .describe(
      "Seasonal component. Default 'none'. 'multiplicative' requires positive observations."
    ),
  trend: z
    .enum(["none", "additive"])
    .optional()
    .describe("Trend component. Default 'additive'."),
  alpha: z
    .number()
    .gt(0)
    .lt(1)
    .optional()
    .describe("Level smoothing parameter (default 0.5)."),
  beta: z
    .number()
    .gt(0)
    .lt(1)
    .optional()
    .describe(
      "Trend smoothing parameter (default 0.1). Ignored when trend is 'none'."
    ),
  gamma: z
    .number()
    .gt(0)
    .lt(1)
    .optional()
    .describe(
      "Seasonal smoothing parameter (default 0.1). Ignored when seasonality is 'none'."
    ),
  confidence: z
    .number()
    .gt(0)
    .lt(1)
    .optional()
    .describe(
      "Confidence level for the prediction intervals (default 0.95). Uses a Gaussian-residual approximation: half-width = z · σ̂ · √h, where σ̂ is the in-sample residual stddev and h is the forecast step."
    ),
});

export class ForecastTool extends Tool<typeof InputSchema> {
  slug = "forecast";
  name = "Forecast";
  description =
    "Holt-Winters exponential smoothing forecast over a dataset you provide. Pass a `queryHandle` from sql_query (or inline `rows`) plus the date/value columns. " +
    "Returns in-sample fits, multi-step point forecasts, prediction intervals, and MAPE. " +
    "Smoothing parameters are not auto-optimized — defaults are 0.5 / 0.1 / 0.1.";

  get schema() {
    return InputSchema;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { queryHandle, rows, ...rest } = this.validate(input);
        const records = await resolveComputeRecords({ queryHandle, rows });
        return AnalyticsService.forecast({ ...rest, records });
      },
    });
  }
}
