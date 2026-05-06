import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";

const InputSchema = z.object({
  op: z
    .enum(["pv", "fv", "pmt", "rate", "nper"])
    .describe(
      "Which TVM quantity to solve for. Provide all the other TVM inputs."
    ),
  rate: z
    .number()
    .optional()
    .describe(
      "Per-period interest rate as decimal (e.g. 0.005 for 0.5%/period). Required for op = pv | fv | pmt | nper."
    ),
  nper: z
    .number()
    .optional()
    .describe("Number of periods. Required for op = pv | fv | pmt | rate."),
  pmt: z
    .number()
    .optional()
    .describe(
      "Periodic payment (cash outflow is negative by convention). Required for op = pv | fv | nper | rate."
    ),
  pv: z
    .number()
    .optional()
    .describe("Present value. Required for op = fv | pmt | nper | rate."),
  fv: z
    .number()
    .optional()
    .describe(
      "Future value (default 0 for op = pv | pmt | nper). Required for op = rate."
    ),
  guess: z
    .number()
    .optional()
    .describe(
      "Initial-guess rate for the iterative solver (default 0.1). Only used for op = rate."
    ),
});

export class TvmTool extends Tool<typeof InputSchema> {
  slug = "tvm";
  name = "TVM";
  description =
    "Time-value-of-money. Solve for present value, future value, payment, " +
    "rate, or number of periods given the other inputs.";

  get schema() {
    return InputSchema;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const validated = this.validate(input);
        return AnalyticsService.tvm(validated);
      },
    });
  }
}
