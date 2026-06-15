import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import {
  withComputeInput,
  resolveComputeRecords,
} from "./compute-input.util.js";

const InputSchema = withComputeInput({
  column: z.string().describe("Numeric column to scan (a key in the rows)"),
  method: z
    .enum(["iqr", "zscore", "mad"])
    .describe(
      "Detection method: iqr, zscore, or mad (median absolute deviation)"
    ),
  threshold: z
    .number()
    .positive()
    .optional()
    .describe(
      "Cutoff: IQR multiplier (default 1.5), |z| cutoff (default 3), or |modified z| cutoff (default 3.5)"
    ),
});

export class DetectOutliersTool extends Tool<typeof InputSchema> {
  slug = "detect_outliers";
  name = "Detect Outliers";
  description =
    "Detect outliers in a numeric column using IQR, Z-score, or modified Z (MAD), over a dataset you provide. Pass a `queryHandle` from sql_query (or inline `rows`) plus the `column`.";

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
        return AnalyticsService.detectOutliers({
          records,
          column: params.column,
          method: params.method,
          threshold: params.threshold,
        });
      },
    });
  }
}
