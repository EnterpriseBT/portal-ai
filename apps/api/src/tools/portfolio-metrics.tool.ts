import { z } from "zod";
import { tool } from "ai";

import {
  AnalyticsService,
  type StationData,
} from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import { fetchEntityRows } from "../utils/tools.util.js";

const InputSchema = z.object({
  entity: z.string().describe("Entity (table) of per-period returns."),
  returnColumn: z
    .string()
    .describe(
      "Column with per-period returns (decimal — 0.01 = 1% per period)."
    ),
  benchmarkEntity: z
    .string()
    .optional()
    .describe(
      "Optional benchmark entity. When supplied, the result includes beta, alpha, information ratio, tracking error, and up/down capture."
    ),
  benchmarkReturnColumn: z
    .string()
    .optional()
    .describe(
      "Column on the benchmark entity. Required when benchmarkEntity is supplied."
    ),
  riskFreeRate: z
    .number()
    .optional()
    .describe(
      "Per-period risk-free rate used by Sortino's downside deviation and alpha (default 0)."
    ),
  periodicity: z
    .enum(["daily", "weekly", "monthly", "quarterly", "annual"])
    .optional()
    .describe(
      "Periodicity of the returns, used to annualize CAGR / alpha / Sortino / tracking error / information ratio. When omitted, raw per-period values are returned."
    ),
});

export class PortfolioMetricsTool extends Tool<typeof InputSchema> {
  slug = "portfolio_metrics";
  name = "Portfolio Metrics";
  description =
    "Compute portfolio performance metrics: total return, CAGR, Sortino, " +
    "Calmar, max drawdown. With a benchmark: beta, alpha, information ratio, " +
    "tracking error, up/down capture.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData, organizationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const {
          entity,
          returnColumn,
          benchmarkEntity,
          benchmarkReturnColumn,
          riskFreeRate,
          periodicity,
        } = this.validate(input);
        if (benchmarkEntity !== undefined && !benchmarkReturnColumn) {
          throw new Error(
            "benchmarkReturnColumn is required when benchmarkEntity is supplied"
          );
        }
        const records = await fetchEntityRows(
          stationData,
          entity,
          [returnColumn],
          organizationId
        );
        const benchmarkRecords =
          benchmarkEntity !== undefined && benchmarkReturnColumn !== undefined
            ? await fetchEntityRows(
                stationData,
                benchmarkEntity,
                [benchmarkReturnColumn],
                organizationId
              )
            : undefined;
        return AnalyticsService.portfolioMetrics({
          records,
          returnColumn,
          benchmarkRecords,
          benchmarkReturnColumn,
          riskFreeRate,
          periodicity,
        });
      },
    });
  }
}
