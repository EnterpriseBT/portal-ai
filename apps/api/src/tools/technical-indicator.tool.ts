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
  valueColumn: z.string().describe("Price/value column key"),
  indicator: z
    .enum([
      "SMA",
      "EMA",
      "RSI",
      "MACD",
      "BB",
      "ATR",
      "OBV",
      "Stochastic",
      "ADX",
      "VWAP",
      "WilliamsR",
      "CCI",
      "ROC",
      "PSAR",
      "Ichimoku",
      "Donchian",
    ])
    .describe("Indicator type"),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Optional indicator parameters (e.g. period, stdDev, signalPeriod, conversionPeriod, basePeriod, spanPeriod, displacement, step, max)"
    ),
});

export class TechnicalIndicatorTool extends Tool<typeof InputSchema> {
  slug = "technical_indicator";
  name = "Technical Indicator";
  description =
    "Compute a technical indicator (SMA, EMA, RSI, MACD, Bollinger Bands, ATR, OBV, " +
    "Stochastic, ADX, VWAP, Williams %R, CCI, ROC, PSAR, Ichimoku Cloud, Donchian Channels) on a time series.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData, organizationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, dateColumn, valueColumn, indicator, params } =
          this.validate(input);
        const records = await fetchEntityRows(
          stationData,
          entity,
          [dateColumn, valueColumn],
          organizationId
        );
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
