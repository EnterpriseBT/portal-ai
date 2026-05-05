import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";

const InputSchema = z.object({
  principal: z.number().positive().describe("Loan principal amount"),
  annualRate: z
    .number()
    .nonnegative()
    .describe("Annual interest rate (e.g. 0.06 for 6%)"),
  periods: z
    .number()
    .int()
    .positive()
    .describe(
      "Number of payment periods at the compounding frequency (e.g. 360 monthly periods for a 30-year mortgage)"
    ),
  compounding: z
    .enum(["weekly", "biweekly", "monthly", "quarterly", "annual"])
    .optional()
    .describe(
      "Payment frequency. Default 'monthly'. Affects the periodic rate and the schedule cadence."
    ),
  extraPayment: z
    .number()
    .nonnegative()
    .optional()
    .describe(
      "Optional fixed extra principal payment applied each period. Default 0. Schedule may terminate before `periods` if principal pays off."
    ),
});

export class AmortizeTool extends Tool<typeof InputSchema> {
  slug = "amortize";
  name = "Amortize";
  description =
    "Generate a loan amortization schedule with payment, principal, interest, and balance per period. " +
    "Supports weekly, biweekly, monthly, quarterly, or annual compounding and optional extra principal payments.";

  get schema() {
    return InputSchema;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { principal, annualRate, periods, compounding, extraPayment } =
          this.validate(input);
        return AnalyticsService.amortize({
          principal,
          annualRate,
          periods,
          compounding,
          extraPayment,
        });
      },
    });
  }
}
