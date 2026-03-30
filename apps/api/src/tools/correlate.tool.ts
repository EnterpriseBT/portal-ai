import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService, type StationData } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import { getRecords } from "../utils/tools.util.js";

const InputSchema = z.object({
  entity: z.string().describe("Entity key (table name)"),
  columnA: z.string().describe("First numeric column"),
  columnB: z.string().describe("Second numeric column"),
});

export class CorrelateTool extends Tool<typeof InputSchema> {
  slug = "correlate";
  name = "Correlate";
  description =
    "Compute Pearson correlation coefficient between two numeric columns.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, columnA, columnB } = this.validate(input);
        const records = getRecords(stationData, entity);
        return AnalyticsService.correlate({ records, columnA, columnB });
      },
    });
  }
}
