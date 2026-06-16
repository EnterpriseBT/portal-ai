import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import {
  withComputeInput,
  resolveComputeRecords,
} from "./compute-input.util.js";

const InputSchema = withComputeInput({
  dateColumn: z.string().describe("Date column (a key in the rows)"),
  valueColumn: z.string().describe("Value/price column (a key in the rows)"),
});

export class MaxDrawdownTool extends Tool<typeof InputSchema> {
  slug = "max_drawdown";
  name = "Max Drawdown";
  description =
    "Compute maximum drawdown (peak-to-trough decline) from a time series you provide. Pass a `queryHandle` from sql_query (or inline `rows`) plus the date/value columns.";

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
        return AnalyticsService.maxDrawdown({
          records,
          dateColumn: params.dateColumn,
          valueColumn: params.valueColumn,
        });
      },
    });
  }
}
