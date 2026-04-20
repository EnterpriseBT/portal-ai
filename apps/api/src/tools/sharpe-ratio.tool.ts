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
  riskFreeRate: z.number().optional().describe("Risk-free rate (default 0)"),
  annualize: z.boolean().optional().describe("Multiply by √252 for daily data"),
});

export class SharpeRatioTool extends Tool<typeof InputSchema> {
  slug = "sharpe_ratio";
  name = "Sharpe Ratio";
  description =
    "Compute the Sharpe ratio from a series of values. Optionally annualize for daily data.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, valueColumn, riskFreeRate, annualize } =
          this.validate(input);
        const records = getRecords(stationData, entity);
        return AnalyticsService.sharpeRatio({
          records,
          valueColumn,
          riskFreeRate,
          annualize,
        });
      },
    });
  }
}
