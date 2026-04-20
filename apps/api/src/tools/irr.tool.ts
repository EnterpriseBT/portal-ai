import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";

const InputSchema = z.object({
  cashFlows: z
    .array(z.number())
    .describe("Cash flows (first is usually negative initial investment)"),
});

export class IrrTool extends Tool<typeof InputSchema> {
  slug = "irr";
  name = "IRR";
  description = "Compute internal rate of return for a cash flow series.";

  get schema() {
    return InputSchema;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { cashFlows } = this.validate(input);
        return AnalyticsService.irr({ cashFlows });
      },
    });
  }
}
