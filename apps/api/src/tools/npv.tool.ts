import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";

const InputSchema = z.object({
  rate: z.number().describe("Discount rate (e.g. 0.1 for 10%)"),
  cashFlows: z
    .array(z.number())
    .describe("Cash flows (first is usually negative initial investment)"),
});

export class NpvTool extends Tool<typeof InputSchema> {
  slug = "npv";
  name = "NPV";
  description =
    "Compute net present value given a discount rate and cash flow series.";

  get schema() {
    return InputSchema;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { rate, cashFlows } = this.validate(input);
        return AnalyticsService.npv({ rate, cashFlows });
      },
    });
  }
}
