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
  window: z.number().int().min(1).describe("Rolling window size"),
});

export class RollingReturnsTool extends Tool<typeof InputSchema> {
  slug = "rolling_returns";
  name = "Rolling Returns";
  description =
    "Compute period-over-period returns within a rolling window over a time series you provide. Pass a `queryHandle` from sql_query (or inline `rows`) plus the date/value columns.";

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
        return AnalyticsService.rollingReturns({
          records,
          dateColumn: params.dateColumn,
          valueColumn: params.valueColumn,
          window: params.window,
        });
      },
    });
  }
}
