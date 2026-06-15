import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import {
  withComputeInput,
  resolveComputeRecords,
} from "./compute-input.util.js";

const InputSchema = withComputeInput({
  columnA: z.string().describe("First numeric column (a key in the rows)"),
  columnB: z.string().describe("Second numeric column (a key in the rows)"),
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
    "Compute the correlation between two numeric columns over a dataset you provide. " +
    "Pass a `queryHandle` from sql_query (or inline `rows`) plus the two columns. " +
    "Supports Pearson (default), Spearman (rank-based, monotonic), and Kendall τ-b.";

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
        return AnalyticsService.correlate({
          records,
          columnA: params.columnA,
          columnB: params.columnB,
          method: params.method,
        });
      },
    });
  }
}
