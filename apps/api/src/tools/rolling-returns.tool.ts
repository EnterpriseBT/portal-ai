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
  dateColumn: z.string().describe("Date column key"),
  valueColumn: z.string().describe("Value/price column key"),
  window: z.number().int().min(1).describe("Rolling window size"),
});

export class RollingReturnsTool extends Tool<typeof InputSchema> {
  slug = "rolling_returns";
  name = "Rolling Returns";
  description = "Compute period-over-period returns within a rolling window.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const {
          entity,
          dateColumn,
          valueColumn,
          window: w,
        } = this.validate(input);
        const records = getRecords(stationData, entity);
        return AnalyticsService.rollingReturns({
          records,
          dateColumn,
          valueColumn,
          window: w,
        });
      },
    });
  }
}
