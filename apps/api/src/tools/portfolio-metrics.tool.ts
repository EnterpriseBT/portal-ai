import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import { withComputeInput } from "./compute-input.util.js";
import { resolveRecordStream } from "./record-source.js";

// `withComputeInput` supplies the PRIMARY data source (queryHandle / rows)
// for the portfolio's returns. The optional benchmark is a SECOND dataset,
// so it gets its own optional source fields resolved separately.
const InputSchema = withComputeInput({
  returnColumn: z
    .string()
    .describe(
      "Column with per-period returns, decimal — 0.01 = 1% (a key in the rows)."
    ),
  dateColumn: z
    .string()
    .optional()
    .describe(
      "Date/period column the returns are ordered by. Total return and max drawdown are order-sensitive, so supply this to fix the chronological order. Required to stream past 100k rows (the cursor needs a declared order); without it the series is read in its existing order and capped at the in-memory limit."
    ),
  benchmarkDateColumn: z
    .string()
    .optional()
    .describe(
      "Date/period column ordering the benchmark series, aligned by position with the portfolio returns. Required to stream a benchmark past 100k rows."
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
        const { queryHandle, rows, ...params } = this.validate(input);

        const hasBenchmark =
          params.benchmarkQueryHandle != null || params.benchmarkRows != null;
        if (hasBenchmark && !params.benchmarkReturnColumn) {
          throw new Error(
            "benchmarkReturnColumn is required when a benchmark source is supplied"
          );
        }

        // Streaming reduce (#152): fold over the returns in `dateColumn`
        // order. The cursor delivers any N a batch at a time; small
        // inline/≤cap sources resolve to a single ordered batch — same fold.
        // Total return and max drawdown are order-sensitive, so the order
        // matters; the other metrics are order-independent.
        const returnStream = resolveRecordStream(
          { queryHandle, rows },
          { mode: "streaming" },
          { orderBy: params.dateColumn }
        );
        const benchmarkStream = hasBenchmark
          ? resolveRecordStream(
              {
                queryHandle: params.benchmarkQueryHandle,
                rows: params.benchmarkRows,
              },
              { mode: "streaming" },
              { orderBy: params.benchmarkDateColumn }
            )
          : undefined;

        return AnalyticsService.portfolioMetricsFromStream(
          returnStream,
          benchmarkStream,
          {
            returnColumn: params.returnColumn,
            benchmarkReturnColumn: params.benchmarkReturnColumn,
            riskFreeRate: params.riskFreeRate,
            periodicity: params.periodicity,
          }
        );
      },
    });
  }
}
