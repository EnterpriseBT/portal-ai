import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";

const InputSchema = z.object({
  op: z
    .enum(["price", "ytm", "duration", "convexity"])
    .describe(
      "Which bond quantity to compute. price/duration/convexity require `yield`; ytm requires `price`."
    ),
  face: z
    .number()
    .positive()
    .describe("Face / par value of the bond (commonly 100 or 1000)."),
  couponRate: z
    .number()
    .nonnegative()
    .describe(
      "Annual coupon rate as decimal (0.05 for 5%). Use 0 for zero-coupon bonds."
    ),
  maturity: z
    .number()
    .positive()
    .describe("Years to maturity."),
  frequency: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Coupon payments per year (default 2 for semi-annual; 1 for annual)."
    ),
  yield: z
    .number()
    .optional()
    .describe(
      "Annual yield as decimal. Required for op = price | duration | convexity."
    ),
  price: z
    .number()
    .positive()
    .optional()
    .describe(
      "Current bond price. Required for op = ytm."
    ),
  guess: z
    .number()
    .optional()
    .describe(
      "Initial-guess yield for the YTM Newton-Raphson solver (default 0.05)."
    ),
});

export class BondMathTool extends Tool<typeof InputSchema> {
  slug = "bond_math";
  name = "Bond Math";
  description =
    "Fixed-coupon bond pricing: price, yield-to-maturity, Macaulay/modified " +
    "duration, and convexity. Bullet bonds only — no callable / floating-rate / " +
    "inflation-linked features and no day-count conventions.";

  get schema() {
    return InputSchema;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const validated = this.validate(input);
        return AnalyticsService.bondMath(validated);
      },
    });
  }
}
