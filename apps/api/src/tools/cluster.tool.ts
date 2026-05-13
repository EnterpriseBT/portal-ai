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
  columns: z.array(z.string()).describe("Numeric columns to cluster on"),
  k: z.number().int().min(2).describe("Number of clusters"),
  standardize: z
    .boolean()
    .optional()
    .describe(
      "Z-score each column before clustering. Centroids are returned in original units. Default false."
    ),
  seed: z
    .number()
    .int()
    .optional()
    .describe("Seed for reproducible cluster initialization"),
  maxIterations: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Maximum k-means iterations (default 100)"),
});

export class ClusterTool extends Tool<typeof InputSchema> {
  slug = "cluster";
  name = "Cluster";
  description = "Perform k-means clustering on specified numeric columns.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData, organizationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, columns, k, standardize, seed, maxIterations } =
          this.validate(input);
        const records = await fetchEntityRows(
          stationData,
          entity,
          columns,
          organizationId
        );
        return AnalyticsService.cluster({
          records,
          columns,
          k,
          standardize,
          seed,
          maxIterations,
        });
      },
    });
  }
}
