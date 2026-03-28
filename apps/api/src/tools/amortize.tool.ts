import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";

const InputSchema = z.object({
  principal: z.number().describe("Loan principal amount"),
  annualRate: z
    .number()
    .describe("Annual interest rate (e.g. 0.06 for 6%)"),
  periods: z.number().int().describe("Number of payment periods"),
});

export class AmortizeTool extends Tool<typeof InputSchema> {
  slug = "amortize";
  name = "Amortize";
  description =
    "Generate a loan amortization schedule with payment, principal, interest, and balance per period.";

  get schema() {
    return InputSchema;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { principal, annualRate, periods } = this.validate(input);
        return AnalyticsService.amortize({ principal, annualRate, periods });
      },
    });
  }
}
