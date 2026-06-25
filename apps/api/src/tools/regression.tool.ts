import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import {
  withComputeInput,
  resolveComputeRecords,
} from "./compute-input.util.js";

const InputSchema = withComputeInput({
  x: z
    .string()
    .optional()
    .describe(
      "Independent-variable column name (a key in the rows). Required when `xColumns` is omitted. Required for `type: polynomial`."
    ),
  xColumns: z
    .array(z.string())
    .optional()
    .describe(
      "List of independent-variable columns for multivariate linear regression. Use this OR `x`, not both. Rejected for `type: polynomial`."
    ),
  y: z.string().describe("Dependent variable column (a key in the rows)"),
  type: z.enum(["linear", "polynomial"]).describe("Regression type"),
  degree: z
    .number()
    .int()
    .min(2)
    .max(10)
    .optional()
    .describe(
      "Polynomial degree (default 2). Ignored when type is 'linear'."
    ),
  confidence: z
    .number()
    .gt(0)
    .lt(1)
    .optional()
    .describe(
      "Confidence level for the coefficient intervals (default 0.95)."
    ),
});

export class RegressionTool extends Tool<typeof InputSchema> {
  slug = "regression";
  name = "Regression";
  description =
    "Perform linear, multivariate-linear, or polynomial regression over a dataset you provide. " +
    "Pass a `queryHandle` from sql_query (or inline `rows`) plus the column names. " +
    "Returns coefficients, a parallel `direction` array (increasing/decreasing/flat per " +
    "coefficient), R-squared, residuals, standard errors, t-statistics, p-values, and " +
    "confidence intervals on each coefficient. Report a trend's direction from the " +
    "`direction` field — do not infer it from the coefficient's sign yourself.";

  get schema() {
    return InputSchema;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const params = this.validate(input);

        // Engine-pushdown (#130 E2c): for a re-executable handle, accumulate
        // X'X / X'y / y'y as SQL sums and solve in-tool — exact at any N
        // (per-row residuals omitted). `regressionPushdown` returns null for
        // a non-re-executable handle, so we fall through to the in-memory
        // path; inline `rows` always use in-memory (and keep residuals).
        if (params.queryHandle != null) {
          const pushed = await AnalyticsService.regressionPushdown(
            params.queryHandle,
            {
              x: params.x,
              xColumns: params.xColumns,
              y: params.y,
              type: params.type,
              degree: params.degree,
              confidence: params.confidence,
            }
          );
          if (pushed !== null) return pushed;
        }

        const records = await resolveComputeRecords(params);
        return AnalyticsService.regression({
          records,
          x: params.x,
          xColumns: params.xColumns,
          y: params.y,
          type: params.type,
          degree: params.degree,
          confidence: params.confidence,
        });
      },
    });
  }
}
