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
    .describe("Single independent-variable column. Use this OR `xColumns`."),
  xColumns: z
    .array(z.string())
    .optional()
    .describe(
      "List of independent-variable columns for multivariate logistic regression."
    ),
  y: z
    .string()
    .describe(
      "Binary outcome column. Values must be 0 or 1 (booleans are coerced)."
    ),
  maxIterations: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Maximum IRLS iterations (default 100)."),
});

export class LogisticRegressionTool extends Tool<typeof InputSchema> {
  slug = "logistic_regression";
  name = "Logistic Regression";
  description =
    "Binary logistic regression via IRLS over a dataset you provide. Pass a `queryHandle` from sql_query (or inline `rows`) plus the columns. " +
    "Returns coefficients (intercept first), per-row predicted probabilities, log-loss, accuracy at threshold 0.5, and IRLS iteration count.";

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
        return AnalyticsService.logisticRegression({
          records,
          x: params.x,
          xColumns: params.xColumns,
          y: params.y,
          maxIterations: params.maxIterations,
        });
      },
    });
  }
}
