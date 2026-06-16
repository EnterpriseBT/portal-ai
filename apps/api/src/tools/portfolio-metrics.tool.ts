import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import {
  withComputeInput,
  resolveComputeRecords,
} from "./compute-input.util.js";

// `withComputeInput` supplies the PRIMARY data source (queryHandle / rows)
// for the portfolio's returns. The optional benchmark is a SECOND dataset,
// so it gets its own optional source fields resolved separately.
const InputSchema = withComputeInput({
  returnColumn: z
    .string()
    .describe(
      "Column with per-period returns, decimal — 0.01 = 1% (a key in the rows)."
    ),
  benchmarkQueryHandle: z
    .string()
    .optional()
    .describe(
      "Optional queryHandle for benchmark returns. When supplied, the result adds beta, alpha, information ratio, tracking error, and up/down capture."
    ),
  benchmarkRows: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe("Inline benchmark rows (alternative to benchmarkQueryHandle)."),
  benchmarkReturnColumn: z
    .string()
    .optional()
    .describe(
      "Return column within the benchmark rows. Required when a benchmark source is supplied."
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
    "Compute portfolio performance metrics over a returns series you provide " +
    "(pass a `queryHandle` from sql_query or inline `rows`): total return, CAGR, " +
    "Sortino, Calmar, max drawdown. With a benchmark source: beta, alpha, " +
    "information ratio, tracking error, up/down capture.";

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

        const hasBenchmark =
          params.benchmarkQueryHandle != null || params.benchmarkRows != null;
        if (hasBenchmark && !params.benchmarkReturnColumn) {
          throw new Error(
            "benchmarkReturnColumn is required when a benchmark source is supplied"
          );
        }
        const benchmarkRecords = hasBenchmark
          ? await resolveComputeRecords({
              queryHandle: params.benchmarkQueryHandle,
              rows: params.benchmarkRows,
            })
          : undefined;

        return AnalyticsService.portfolioMetrics({
          records,
          returnColumn: params.returnColumn,
          benchmarkRecords,
          benchmarkReturnColumn: params.benchmarkReturnColumn,
          riskFreeRate: params.riskFreeRate,
          periodicity: params.periodicity,
        });
      },
    });
  }
}
