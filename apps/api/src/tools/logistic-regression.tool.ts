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
  x: z
    .string()
    .optional()
    .describe(
      "Single independent-variable column. Use this OR `xColumns`."
    ),
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
    "Binary logistic regression via IRLS. Returns coefficients (intercept first), " +
    "per-row predicted probabilities, log-loss, accuracy at threshold 0.5, and IRLS iteration count.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData, organizationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, x, xColumns, y, maxIterations } =
          this.validate(input);
        const cols = [
          ...(xColumns ?? (x !== undefined ? [x] : [])),
          y,
        ];
        const records = await fetchEntityRows(
          stationData,
          entity,
          cols,
          organizationId
        );
        return AnalyticsService.logisticRegression({
          records,
          x,
          xColumns,
          y,
          maxIterations,
        });
      },
    });
  }
}
