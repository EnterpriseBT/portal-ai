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
});

export class DescribeColumnTool extends Tool<typeof InputSchema> {
  slug = "describe_column";
  name = "Describe Column";
  description =
    "Compute descriptive statistics (count, mean, median, stddev, min, max, p25, p75) for a numeric column.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, column } = this.validate(input);
        const records = getRecords(stationData, entity);
        return AnalyticsService.describeColumn({ records, column });
      },
    });
  }
}
