import { z } from "zod";
import { tool } from "ai";

import {
  AnalyticsService,
  type StationData,
} from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import { getRecords } from "../utils/tools.util.js";

const InputSchema = z.object({
  entity: z.string().describe("Entity key (table name)"),
  x: z
    .string()
    .optional()
    .describe(
      "Independent-variable column name. Required when `xColumns` is omitted. Required for `type: polynomial`."
    ),
  xColumns: z
    .array(z.string())
    .optional()
    .describe(
      "List of independent-variable columns for multivariate linear regression. Use this OR `x`, not both. Rejected for `type: polynomial`."
    ),
  y: z.string().describe("Dependent variable column"),
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
    "Perform linear, multivariate-linear, or polynomial regression. " +
    "Returns coefficients, R-squared, residuals, standard errors, t-statistics, " +
    "p-values, and confidence intervals on each coefficient.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, x, xColumns, y, type, degree, confidence } =
          this.validate(input);
        const records = getRecords(stationData, entity);
        return AnalyticsService.regression({
          records,
          x,
          xColumns,
          y,
          type,
          degree,
          confidence,
        });
      },
    });
  }
}
