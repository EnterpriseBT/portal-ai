import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService, type StationData } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import { getRecords } from "../utils/tools.util.js";

const InputSchema = z.object({
  entity: z.string().describe("Entity key (table name)"),
  dateColumn: z.string().describe("Date column key"),
  valueColumn: z.string().describe("Price/value column key"),
  indicator: z
    .enum(["SMA", "EMA", "RSI", "MACD", "BB", "ATR", "OBV"])
    .describe("Indicator type"),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Optional indicator parameters (e.g. period, stdDev)"),
});

export class TechnicalIndicatorTool extends Tool<typeof InputSchema> {
  slug = "technical_indicator";
  name = "Technical Indicator";
  description =
    "Compute a technical indicator (SMA, EMA, RSI, MACD, Bollinger Bands, ATR, OBV) on a time series.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, dateColumn, valueColumn, indicator, params } = this.validate(input);
        const records = getRecords(stationData, entity);
        return AnalyticsService.technicalIndicator({
          records,
          dateColumn,
          valueColumn,
          indicator,
          params,
        });
      },
    });
  }
}
