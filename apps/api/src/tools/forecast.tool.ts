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
    "Holt-Winters exponential smoothing forecast. Returns in-sample fits, " +
    "multi-step point forecasts, prediction intervals, and MAPE. " +
    "Smoothing parameters are not auto-optimized — defaults are 0.5 / 0.1 / 0.1.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData, organizationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const validated = this.validate(input);
        const records = await fetchEntityRows(
          stationData,
          validated.entity,
          [validated.dateColumn, validated.valueColumn],
          organizationId
        );
        return AnalyticsService.forecast({
          ...validated,
          records,
        });
      },
    });
  }
}
