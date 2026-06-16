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
  valueColumn: z.string().describe("Price/value column (a key in the rows)"),
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
    "Stochastic, ADX, VWAP, Williams %R, CCI, ROC, PSAR, Ichimoku Cloud, Donchian Channels) on a time series you provide. Pass a `queryHandle` from sql_query (or inline `rows`) plus the date/value columns.";

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
        return AnalyticsService.technicalIndicator({
          records,
          dateColumn: params.dateColumn,
          valueColumn: params.valueColumn,
          indicator: params.indicator,
          params: params.params,
        });
      },
    });
  }
}
