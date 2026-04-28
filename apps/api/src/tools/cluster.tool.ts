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
  columns: z.array(z.string()).describe("Numeric columns to cluster on"),
  k: z.number().int().min(2).describe("Number of clusters"),
});

export class ClusterTool extends Tool<typeof InputSchema> {
  slug = "cluster";
  name = "Cluster";
  description = "Perform k-means clustering on specified numeric columns.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, columns, k } = this.validate(input);
        const records = getRecords(stationData, entity);
        return AnalyticsService.cluster({ records, columns, k });
      },
    });
  }
}
