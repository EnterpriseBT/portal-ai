import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";

const InputSchema = z.object({
  cost: z
    .number()
    .positive()
    .describe("Initial cost / book value of the asset."),
  salvage: z
    .number()
    .nonnegative()
    .describe("Estimated salvage value at the end of life."),
  life: z
    .number()
    .int()
    .positive()
    .describe("Useful life in periods (typically years)."),
  method: z
    .enum(["straight_line", "declining_balance", "double_declining_balance"])
    .describe(
      "straight_line: (cost - salvage) / life per period. " +
        "declining_balance: 1/life rate applied to current book value, never below salvage. " +
        "double_declining_balance: 2/life rate applied to current book value, never below salvage."
    ),
  period: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Optional 1-indexed period to return a single row for. When omitted, the full schedule is returned."
    ),
  factor: z
    .number()
    .positive()
    .optional()
    .describe(
      "Override factor for declining_balance / double_declining_balance (default 1 and 2 respectively)."
    ),
});

export class DepreciationTool extends Tool<typeof InputSchema> {
  slug = "depreciation";
  name = "Depreciation";
  description =
    "Compute a depreciation schedule (or a single period) using straight-line, " +
    "declining-balance, or double-declining-balance.";

  get schema() {
    return InputSchema;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const validated = this.validate(input);
        return AnalyticsService.depreciation(validated);
      },
    });
  }
}
