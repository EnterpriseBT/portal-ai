import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";

const InputSchema = z.object({
  cashFlows: z
    .array(
      z.object({
        date: z
          .string()
          .describe(
            "ISO date string (YYYY-MM-DD or any format Date can parse)."
          ),
        amount: z
          .number()
          .describe(
            "Cash flow amount. Must include at least one positive and one negative value."
          ),
      })
    )
    .min(2)
    .describe(
      "Cash flows with explicit dates. Must contain at least one positive and one negative amount."
    ),
  guess: z
    .number()
    .optional()
    .describe("Initial-guess rate for Newton-Raphson (default 0.1)."),
});

export class XirrTool extends Tool<typeof InputSchema> {
  slug = "xirr";
  name = "XIRR";
  description =
    "Internal rate of return over irregular-date cashflows (Excel XIRR semantics).";

  get schema() {
    return InputSchema;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const validated = this.validate(input);
        return AnalyticsService.xirr(validated);
      },
    });
  }
}
