import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import {
  withComputeInput,
  resolveComputeRecords,
} from "./compute-input.util.js";

const InputSchema = withComputeInput({
  valueColumn: z.string().describe("Value/price column (a key in the rows)"),
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
    "Compute the Sharpe ratio from a series of values you provide. Pass a `queryHandle` from sql_query (or inline `rows`) plus the value column. Optionally annualize via " +
    "the `periodicity` field (daily, weekly, monthly, quarterly, annual).";

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
        return AnalyticsService.sharpeRatio({
          records,
          valueColumn: params.valueColumn,
          riskFreeRate: params.riskFreeRate,
          periodicity: params.periodicity,
        });
      },
    });
  }
}
