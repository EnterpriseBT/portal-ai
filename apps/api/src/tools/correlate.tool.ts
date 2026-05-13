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
  columnA: z.string().describe("First numeric column"),
  columnB: z.string().describe("Second numeric column"),
  method: z
    .enum(["pearson", "spearman", "kendall"])
    .optional()
    .describe(
      "Correlation method. Default 'pearson'. " +
        "Use 'spearman' for monotonic non-linear relationships or ranked data. " +
        "Use 'kendall' for small samples or ordinal data with ties."
    ),
});

export class CorrelateTool extends Tool<typeof InputSchema> {
  slug = "correlate";
  name = "Correlate";
  description =
    "Compute the correlation between two numeric columns. " +
    "Supports Pearson (default), Spearman (rank-based, monotonic), and Kendall τ-b.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData, organizationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, columnA, columnB, method } = this.validate(input);
        const records = await fetchEntityRows(
          stationData,
          entity,
          [columnA, columnB],
          organizationId
        );
        return AnalyticsService.correlate({
          records,
          columnA,
          columnB,
          method,
        });
      },
    });
  }
}
