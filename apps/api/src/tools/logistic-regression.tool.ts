import { z } from "zod";
import { tool } from "ai";

import { COMPUTE_MAX_ROWS } from "@portalai/core/constants";

import { AnalyticsService } from "../services/analytics.service.js";
import { PortalSqlHandleService } from "../services/portal-sql-handle.service.js";
import { Tool } from "../types/tools.js";
import {
  withComputeInput,
  resolveComputeRecords,
} from "./compute-input.util.js";
import { resolveRecordStream } from "./record-source.js";

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
    "Binary logistic regression over a dataset you provide. Pass a `queryHandle` from sql_query (or inline `rows`) plus the columns. " +
    "Small datasets get the exact IRLS fit (coefficients + per-row probabilities + log-loss + accuracy + iterations); a large query handle folds online via AdaGrad SGD — exact-within-tolerance at any N — returning coefficients + prequential log-loss/accuracy (the O(N) per-row probabilities are omitted at scale).";

  get schema() {
    return InputSchema;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { queryHandle, rows, ...params } = this.validate(input);

        // Decide exact IRLS vs streaming SGD by source N (#153). Small N (and
        // inline rows) gets the exact fit with per-row probabilities; a large
        // handle folds online with bounded memory (the coefficient vector).
        const sourceCount =
          rows != null
            ? rows.length
            : (await PortalSqlHandleService.getMeta(queryHandle!)).rowCount;

        if (queryHandle == null || sourceCount <= COMPUTE_MAX_ROWS) {
          const records = await resolveComputeRecords({ queryHandle, rows });
          return AnalyticsService.logisticRegression({
            records,
            x: params.x,
            xColumns: params.xColumns,
            y: params.y,
            maxIterations: params.maxIterations,
          });
        }

        // Streaming SGD — order by the outcome column for a stable cursor
        // keyset (the fit is order-tolerant).
        const stream = resolveRecordStream(
          { queryHandle },
          { mode: "streaming" },
          { orderBy: params.y }
        );
        return AnalyticsService.logisticRegressionFromStream(stream, {
          x: params.x,
          xColumns: params.xColumns,
          y: params.y,
        });
      },
    });
  }
}
