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
    "seasonal, and residual components. Additive or multiplicative. " +
    "Trend uses a centered moving average; edge values are null where the MA cannot be computed.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData, organizationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, dateColumn, valueColumn, seasonalPeriod, seasonality } =
          this.validate(input);
        const records = await fetchEntityRows(
          stationData,
          entity,
          [dateColumn, valueColumn],
          organizationId
        );
        return AnalyticsService.decompose({
          records,
          dateColumn,
          valueColumn,
          seasonalPeriod,
          seasonality,
        });
      },
    });
  }
}
