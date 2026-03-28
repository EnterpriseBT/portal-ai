import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService, type StationData } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import { getRecords } from "../utils/tools.util.js";

const InputSchema = z.object({
  entity: z.string().describe("Entity key (table name)"),
  column: z.string().describe("Numeric column key"),
  method: z
    .enum(["iqr", "zscore"])
    .describe("Detection method: iqr or zscore"),
});

export class DetectOutliersTool extends Tool<typeof InputSchema> {
  slug = "detect_outliers";
  name = "Detect Outliers";
  description =
    "Detect outliers in a numeric column using IQR or Z-score method.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, column, method } = this.validate(input);
        const records = getRecords(stationData, entity);
        return AnalyticsService.detectOutliers({ records, column, method });
      },
    });
  }
}
