import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import {
  withComputeInput,
  resolveComputeRecords,
} from "./compute-input.util.js";

const InputSchema = withComputeInput({
  columns: z
    .array(z.string())
    .describe("Numeric columns to cluster on (keys in the rows)"),
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
  description =
    "Perform k-means clustering on specified numeric columns over a dataset you provide. Pass a `queryHandle` from sql_query (or inline `rows`) plus the `columns` and `k`.";

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
        return AnalyticsService.cluster({
          records,
          columns: params.columns,
          k: params.k,
          standardize: params.standardize,
          seed: params.seed,
          maxIterations: params.maxIterations,
        });
      },
    });
  }
}
