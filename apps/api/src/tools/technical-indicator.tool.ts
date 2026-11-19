import { z } from "zod";
import { tool } from "ai";

import { INLINE_ROWS_THRESHOLD } from "@portalai/core/constants";

import { AnalyticsService } from "../services/analytics.service.js";
import { PortalSqlHandleService } from "../services/portal-sql-handle.service.js";
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
    "Stochastic, ADX, VWAP, Williams %R, CCI, ROC, PSAR, Ichimoku Cloud, Donchian Channels) on a time series you provide. Pass a `queryHandle` from sql_query (or inline `rows`) plus the date/value columns. " +
    "A per-row series: a small input returns `{ dates, values }` inline; a large query handle is folded in a single ordered pass into a new query handle (returned as a `data-table` you can chart or query further) — so it scales to any row count without flooding context.";

  get schema() {
    return InputSchema;
  }

  build(stationId: string, organizationId: string, userId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { queryHandle, rows, ...rest } = this.validate(input);

        // Decide inline vs handle by the source's row count — mirrors
        // sql_query's INLINE_ROWS_THRESHOLD auto-switch. Inline `rows` are
        // bounded small by the transport, so they always take the inline
        // (array) path; only a large query handle escalates to a transform
        // handle (which needs a re-foldable source).
        const sourceMeta =
          rows != null
            ? null
            : await PortalSqlHandleService.getMeta(queryHandle!);
        const sourceCount = sourceMeta?.rowCount ?? rows!.length;

        if (queryHandle == null || sourceCount <= INLINE_ROWS_THRESHOLD) {
          // Inline: the array path, returning the established { dates, values }.
          const records = await resolveComputeRecords({ queryHandle, rows });
          return AnalyticsService.technicalIndicator({
            records,
            dateColumn: rest.dateColumn,
            valueColumn: rest.valueColumn,
            indicator: rest.indicator,
            params: rest.params,
          });
        }

        // Large source: fold it into a cursor-backed transform handle (#159).
        const transform = {
          kind: "technical_indicator" as const,
          dateColumn: rest.dateColumn,
          valueColumn: rest.valueColumn,
          indicator: rest.indicator,
          params: rest.params,
        };
        const { envelope } = await PortalSqlHandleService.produceFromTransform({
          transform: { ...transform, sourceHandle: queryHandle },
          stationId,
          organizationId,
          userId,
        });
        // #1038: the table re-runs as its reader: the source's query, then
        // the same fold. A source with no query (staged rows) leaves nothing
        // to re-run, so the table carries no pipeline and isn't kept.
        const sourceSql = sourceMeta?.sql;
        return {
          type: "data-table",
          ...envelope,
          ...(sourceSql
            ? {
                pipeline: {
                  sql: sourceSql,
                  stationId,
                  organizationId,
                  transform,
                },
              }
            : {}),
        };
      },
    });
  }
}
