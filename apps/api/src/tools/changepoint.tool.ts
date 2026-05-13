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
  dateColumn: z
    .string()
    .optional()
    .describe(
      "Optional date column for output labels. When omitted, indices are returned without dates."
    ),
  valueColumn: z.string().describe("Numeric value column key"),
  threshold: z
    .number()
    .positive()
    .optional()
    .describe(
      "CUSUM threshold in standard deviations of the standardized series. Default 5.0; lower values produce more (smaller) detected shifts."
    ),
  minSegmentLength: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Minimum spacing between consecutive changepoints. Default ⌈n/20⌉, floor of 5."
    ),
});

export class ChangepointTool extends Tool<typeof InputSchema> {
  slug = "changepoint";
  name = "Changepoint";
  description =
    "Detect mean-shift changepoints in a numeric series via CUSUM. " +
    "Returns indices, optional dates, per-segment means, and segment ranges.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData, organizationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const {
          entity,
          dateColumn,
          valueColumn,
          threshold,
          minSegmentLength,
        } = this.validate(input);
        const cols = dateColumn ? [dateColumn, valueColumn] : [valueColumn];
        const records = await fetchEntityRows(
          stationData,
          entity,
          cols,
          organizationId
        );
        return AnalyticsService.changepoint({
          records,
          dateColumn,
          valueColumn,
          threshold,
          minSegmentLength,
        });
      },
    });
  }
}
