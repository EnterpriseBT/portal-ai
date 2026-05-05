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
  column: z.string().describe("Numeric column key"),
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
    "Detect outliers in a numeric column using IQR, Z-score, or modified Z (MAD).";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, column, method, threshold } = this.validate(input);
        const records = getRecords(stationData, entity);
        return AnalyticsService.detectOutliers({
          records,
          column,
          method,
          threshold,
        });
      },
    });
  }
}
