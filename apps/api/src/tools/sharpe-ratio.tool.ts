import { z } from "zod";
import { tool } from "ai";

import {
  AnalyticsService,
  type StationData,
} from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import { getRecords } from "../utils/tools.util.js";

const InputSchema = z.object({
  entity: z.string().describe("Entity key (table name)"),
  valueColumn: z.string().describe("Value/price column key"),
  riskFreeRate: z
    .number()
    .optional()
    .describe("Per-period risk-free rate (default 0)"),
  periodicity: z
    .enum(["daily", "weekly", "monthly", "quarterly", "annual"])
    .optional()
    .describe(
      "Annualization frequency. When omitted, the raw per-period ratio is returned (no annualization)."
    ),
});

export class SharpeRatioTool extends Tool<typeof InputSchema> {
  slug = "sharpe_ratio";
  name = "Sharpe Ratio";
  description =
    "Compute the Sharpe ratio from a series of values. Optionally annualize via " +
    "the `periodicity` field (daily, weekly, monthly, quarterly, annual).";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, valueColumn, riskFreeRate, periodicity } =
          this.validate(input);
        const records = getRecords(stationData, entity);
        return AnalyticsService.sharpeRatio({
          records,
          valueColumn,
          riskFreeRate,
          periodicity,
        });
      },
    });
  }
}
