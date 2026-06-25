import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import {
  withComputeInput,
  resolveComputeRecords,
} from "./compute-input.util.js";

const InputSchema = withComputeInput({
  returnColumn: z
    .string()
    .describe("Column with per-period returns, decimal (a key in the rows)."),
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
    "confidence level, over a returns series you provide. Pass a `queryHandle` from sql_query (or inline `rows`) plus the return column. Historical method sorts returns and reads the tail; " +
    "parametric assumes normal returns. Both return positive loss magnitudes.";

  get schema() {
    return InputSchema;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const params = this.validate(input);

        // Engine-pushdown (#130 E2c): when the dataset is a re-executable
        // query handle, push the O(N) reduction into SQL — exact at any N,
        // no materialization. `varCvarPushdown` returns null for a
        // non-re-executable handle (externally-supplied rows), so we fall
        // through to the in-memory bounded path. Inline `rows` always use
        // the in-memory path.
        if (params.queryHandle != null) {
          const pushed = await AnalyticsService.varCvarPushdown(
            params.queryHandle,
            {
              returnColumn: params.returnColumn,
              confidence: params.confidence,
              method: params.method,
            }
          );
          if (pushed !== null) return pushed;
        }

        const records = await resolveComputeRecords(params);
        return AnalyticsService.varCvar({
          records,
          returnColumn: params.returnColumn,
          confidence: params.confidence,
          method: params.method,
        });
      },
    });
  }
}
