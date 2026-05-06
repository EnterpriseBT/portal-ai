import { z } from "zod";
import { tool } from "ai";

import {
  AnalyticsService,
  type StationData,
} from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import { getRecords } from "../utils/tools.util.js";

const InputSchema = z.object({
  entity: z.string().describe("Entity (table) of per-period returns."),
  returnColumn: z
    .string()
    .describe("Column with per-period returns (decimal)."),
  confidence: z
    .number()
    .gt(0)
    .lt(1)
    .optional()
    .describe("Confidence level for VaR / CVaR (default 0.95)."),
  method: z
    .enum(["historical", "parametric"])
    .optional()
    .describe(
      "Estimation method (default 'historical'). Parametric assumes normal returns."
    ),
});

export class VarCvarTool extends Tool<typeof InputSchema> {
  slug = "var_cvar";
  name = "VaR / CVaR";
  description =
    "Compute Value-at-Risk and Conditional VaR (Expected Shortfall) at a " +
    "confidence level. Historical method sorts returns and reads the tail; " +
    "parametric assumes normal returns. Both return positive loss magnitudes.";

  get schema() {
    return InputSchema;
  }

  build(stationData: StationData) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entity, returnColumn, confidence, method } =
          this.validate(input);
        const records = getRecords(stationData, entity);
        return AnalyticsService.varCvar({
          records,
          returnColumn,
          confidence,
          method,
        });
      },
    });
  }
}
