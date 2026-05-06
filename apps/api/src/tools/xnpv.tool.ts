import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";

const InputSchema = z.object({
  rate: z
    .number()
    .describe("Discount rate per year as decimal (e.g. 0.10 for 10%)."),
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
            "Cash flow amount. Initial investment is typically negative."
          ),
      })
    )
    .min(2)
    .describe(
      "Cash flows with explicit dates. Order does not matter; the earliest date is the discount anchor."
    ),
});

export class XnpvTool extends Tool<typeof InputSchema> {
  slug = "xnpv";
  name = "XNPV";
  description =
    "Net present value over irregular-date cashflows (Excel XNPV semantics).";

  get schema() {
    return InputSchema;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const validated = this.validate(input);
        return AnalyticsService.xnpv(validated);
      },
    });
  }
}
