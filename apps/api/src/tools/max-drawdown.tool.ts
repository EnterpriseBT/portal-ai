import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService, type StationData } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import { getRecords } from "../utils/tools.util.js";

const InputSchema = z.object({
  entity: z.string().describe("Entity key (table name)"),
  dateColumn: z.string().describe("Date column key"),
  valueColumn: z.string().describe("Value/price column key"),
});

export class MaxDrawdownTool extends Tool<typeof InputSchema> {
  slug = "max_drawdown";
  name = "Max Drawdown";
  description =
    "Compute maximum drawdown (peak-to-trough decline) from a time series.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, dateColumn, valueColumn } = this.validate(input);
        const records = getRecords(stationData, entity);
        return AnalyticsService.maxDrawdown({
          records,
          dateColumn,
          valueColumn,
        });
      },
    });
  }
}
