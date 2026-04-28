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
  x: z.string().describe("Independent variable column"),
  y: z.string().describe("Dependent variable column"),
  type: z.enum(["linear", "polynomial"]).describe("Regression type"),
});

export class RegressionTool extends Tool<typeof InputSchema> {
  slug = "regression";
  name = "Regression";
  description =
    "Perform linear or polynomial regression between two numeric columns. Returns coefficients and R-squared.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, x, y, type } = this.validate(input);
        const records = getRecords(stationData, entity);
        return AnalyticsService.regression({ records, x, y, type });
      },
    });
  }
}
