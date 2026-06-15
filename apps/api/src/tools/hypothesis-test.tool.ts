import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { Tool } from "../types/tools.js";
import {
  type ComputeRecord,
  resolveComputeRecords,
} from "./compute-input.util.js";

// hypothesis_test does NOT use `withComputeInput`: chi_squared reads
// `observed`/`expected` directly and needs no row data, so the data
// source (queryHandle / rows) is optional here rather than required.
const InputSchema = z.object({
  test: z
    .enum([
      "t_test_one_sample",
      "t_test_two_sample",
      "t_test_paired",
      "mann_whitney",
      "chi_squared",
    ])
    .describe(
      "Which test to run. Each test reads a different combination of the inputs below."
    ),
  queryHandle: z
    .string()
    .optional()
    .describe(
      "A queryHandle from sql_query whose rows hold the sample columns. " +
        "Required for t- and Mann-Whitney tests; omit for chi_squared."
    ),
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe("Inline rows holding the sample columns (alternative to queryHandle)."),
  columnA: z
    .string()
    .optional()
    .describe(
      "First numeric column. Used by t_test_one_sample (the sample), t_test_two_sample / t_test_paired / mann_whitney (sample 1)."
    ),
  columnB: z
    .string()
    .optional()
    .describe(
      "Second numeric column. Used by t_test_two_sample / t_test_paired / mann_whitney (sample 2)."
    ),
  mu: z
    .number()
    .optional()
    .describe(
      "Hypothesized population mean for t_test_one_sample. Default 0."
    ),
  observed: z
    .array(z.number().nonnegative())
    .optional()
    .describe("Observed counts for chi_squared."),
  expected: z
    .array(z.number().positive())
    .optional()
    .describe(
      "Expected counts for chi_squared. Same length as observed; each must be > 0."
    ),
  df: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Degrees of freedom for chi_squared. Default observed.length - 1; override for r×c independence tests (df = (r-1)(c-1))."
    ),
});

export class HypothesisTestTool extends Tool<typeof InputSchema> {
  slug = "hypothesis_test";
  name = "Hypothesis Test";
  description =
    "Run a hypothesis test (one-sample / two-sample / paired t-test, Mann-Whitney U, or chi-squared) " +
    "and return the statistic and a two-tailed p-value. For column-based tests, pass a `queryHandle` " +
    "from sql_query (or inline `rows`) plus the sample columns; chi_squared takes `observed`/`expected` " +
    "directly with no data source. Mann-Whitney p-values use the normal approximation and degrade for " +
    "small samples (n < 10) with heavy ties. The two-sample t-test assumes equal variance (Student's t, not Welch's).";

  get schema() {
    return InputSchema;
  }

  build() {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { queryHandle, rows, ...rest } = this.validate(input);
        let records: ComputeRecord[] | undefined;
        if (queryHandle != null || rows != null) {
          records = await resolveComputeRecords({ queryHandle, rows });
        }
        return AnalyticsService.hypothesisTest({ ...rest, records });
      },
    });
  }
}
