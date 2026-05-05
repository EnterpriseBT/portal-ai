# Analytics Pack Expansion — Phase 4 — Plan

**TDD-sequenced implementation of `aggregate` and `hypothesis_test` in the `statistics` pack.**

Spec: `docs/ANALYTICS_PACK_EXPANSION_PHASE_4.spec.md`. Discovery: `docs/ANALYTICS_PACK_EXPANSION.discovery.md`. Phase 3 commit: `4165899`.

Three slices, in dependency order:

1. **`aggregate`** — pure Arquero forwarding. Independent. Lands first because it's the smaller, lower-risk diff.
2. **Distribution CDF helpers** — private statics on `AnalyticsService`: `regularizedIncompleteBeta`, `regularizedIncompleteGamma`, the t-CDF and χ²-CDF wrappers around them. No tool surface; test against known reference values from scipy/textbooks.
3. **`hypothesis_test`** — the five test branches, each consuming the slice-2 helpers (or `simple-statistics` directly).

Slice 2 ships *behind* the public surface — its tests exercise the private helpers via `(AnalyticsService as any).privateName(...)` for unit-level confidence before slice 3 wires them in. This is the same convention `polynomialFit` and `kendallTau` use elsewhere in the file.

Each slice follows the established loop:

1. Write failing tests.
2. Implement.
3. Re-run; confirm green.

Lint + type-check after all three slices.

Run tests with `cd apps/api && npm run test:unit -- analytics.service` per `feedback_use_npm_test_scripts`.

---

## Slice 1 — `aggregate`

**Files**

- New: `apps/api/src/tools/aggregate.tool.ts`
- Edit: `apps/api/src/services/analytics.service.ts` — `static aggregate(...)`.
- Edit: `apps/api/src/services/tools.service.ts` — import `AggregateTool`, add `"aggregate"` to `PACK_TOOL_NAMES`, register under the `statistics` pack.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — new `describe("aggregate()", ...)` block, spec cases 116–124.

**Steps**

1. **Write failing tests** (cases 116–124). Inline the fixtures — small, deterministic. For test 121 (sample stddev), the expected value is `Math.sqrt(2.5)` — assert `toBeCloseTo(Math.sqrt(2.5), 9)`.

   For test 122 (per-group quantiles), build a 10-row fixture with two regions of 5 rows each. Compute the expected p25/p75 inline — `ss.quantile([1,2,3,4,5], 0.25)` etc., — but the test file doesn't import `ss`. Use a hand-derived value (with comment explaining what Arquero's quantile yields for a 5-element series).

   Run the suite; expect 9 failures (`aggregate` doesn't exist).

2. **Implement `AnalyticsService.aggregate`.** Add near the existing Arquero-using code (`trend`):

   ```ts
   static aggregate(params: {
     records: Record<string, unknown>[];
     groupBy: string[];
     metrics: {
       column?: string;
       op:
         | "count"
         | "sum"
         | "mean"
         | "median"
         | "min"
         | "max"
         | "stddev"
         | "p25"
         | "p75";
       as?: string;
     }[];
   }): { rows: Record<string, unknown>[] } {
     // Validate metrics
     for (const m of params.metrics) {
       if (m.op !== "count" && !m.column) {
         throw new Error(`Aggregation op "${m.op}" requires a column`);
       }
     }

     const dt = aq.from(params.records);
     const grouped =
       params.groupBy.length === 0 ? dt : dt.groupby(...params.groupBy);

     const rollupArgs: Record<string, unknown> = {};
     for (const m of params.metrics) {
       const alias = m.as ?? (m.column ? `${m.op}_${m.column}` : "count");
       const col = m.column!;
       switch (m.op) {
         case "count":
           rollupArgs[alias] = aq.op.count();
           break;
         case "sum":
           rollupArgs[alias] = aq.op.sum(col);
           break;
         case "mean":
           rollupArgs[alias] = aq.op.mean(col);
           break;
         case "median":
           rollupArgs[alias] = aq.op.median(col);
           break;
         case "min":
           rollupArgs[alias] = aq.op.min(col);
           break;
         case "max":
           rollupArgs[alias] = aq.op.max(col);
           break;
         case "stddev":
           rollupArgs[alias] = aq.op.stdev(col);
           break;
         case "p25":
           rollupArgs[alias] = aq.op.quantile(col, 0.25);
           break;
         case "p75":
           rollupArgs[alias] = aq.op.quantile(col, 0.75);
           break;
       }
     }

     const out = grouped.rollup(rollupArgs);
     return { rows: out.objects() as Record<string, unknown>[] };
   }
   ```

   Note: Arquero's `rollup` accepts an *object* of aggregations — the existing `trend` helper uses `derive`/`rollup` with named-key syntax. Verify against `aq.op` documentation if any of the function calls (`aq.op.stdev`, `aq.op.quantile`) need a different invocation form. If `aq.op.quantile` is not available at runtime, fall back to `aq.op.fn` with an inline reducer or compute the quantile via a derived column — adjust during implementation.

3. **Tool-class file.** Create `apps/api/src/tools/aggregate.tool.ts`:

   ```ts
   import { z } from "zod";
   import { tool } from "ai";

   import {
     AnalyticsService,
     type StationData,
   } from "../services/analytics.service.js";
   import { Tool } from "../types/tools.js";
   import { getRecords } from "../utils/tools.util.js";

   const InputSchema = z.object({
     entity: z.string().describe("Entity (table) to aggregate."),
     groupBy: z
       .array(z.string())
       .describe(
         "Columns to group by. Pass [] to aggregate over the whole table."
       ),
     metrics: z
       .array(
         z.object({
           column: z
             .string()
             .optional()
             .describe(
               "Numeric column the operation runs over. Omit when op is 'count'."
             ),
           op: z
             .enum([
               "count",
               "sum",
               "mean",
               "median",
               "min",
               "max",
               "stddev",
               "p25",
               "p75",
             ])
             .describe(
               "Aggregation op. 'count' tallies rows; the others reduce the named numeric column. " +
                 "stddev uses the sample (n-1) divisor."
             ),
           as: z
             .string()
             .optional()
             .describe(
               "Alias for the result column. Defaults to '<op>_<column>' or 'count'."
             ),
         })
       )
       .min(1)
       .describe("One or more aggregations to compute per group."),
   });

   export class AggregateTool extends Tool<typeof InputSchema> {
     slug = "aggregate";
     name = "Aggregate";
     description =
       "Group-by + reduce. Produces one row per group with the requested metrics.";

     get schema() {
       return InputSchema;
     }

     build(stationData: StationData) {
       return tool({
         description: this.description,
         inputSchema: this.schema,
         execute: async (input) => {
           const { entity, groupBy, metrics } = this.validate(input);
           const records = getRecords(stationData, entity);
           return AnalyticsService.aggregate({ records, groupBy, metrics });
         },
       });
     }
   }
   ```

4. **Register in `ToolService`.**
   - Import: `import { AggregateTool } from "../tools/aggregate.tool.js";`
   - `PACK_TOOL_NAMES`: add `"aggregate"`.
   - `statistics` pack block: append `tools.aggregate = new AggregateTool().build(stationData);`.

5. **Run focused suite.** All 9 cases green.

**Done when:** spec tests 116–124 pass.

**Risk:** `aq.op.stdev` and `aq.op.quantile` runtime availability. If either is missing or named differently in the installed Arquero version, the implementation needs a fallback (custom reducer via `aq.op.fn` or a `derive` then `rollup` chain). Test 121 catches a wrong stddev formula immediately.

---

## Slice 2 — Distribution CDF helpers

**Files**

- Edit: `apps/api/src/services/analytics.service.ts` — add private statics:
  - `regularizedIncompleteBeta(x, a, b)` — Lentz continued fraction.
  - `regularizedIncompleteGamma(s, x)` — series for x < s+1, continued fraction otherwise.
  - `tCDF(t, df)` — built on `regularizedIncompleteBeta`.
  - `chiSquaredCDF(x, df)` — built on `regularizedIncompleteGamma`.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — new `describe("distribution CDFs (private)", ...)` block.

**Steps**

1. **Write failing tests** for the private helpers, accessed via `(AnalyticsService as any).tCDF(...)` etc.:

   - **`tCDF` matches scipy at standard percentiles.**
     - `tCDF(0, 10)` ≈ 0.5
     - `tCDF(1.812, 10)` ≈ 0.95 (one-tailed 95th percentile of t with df=10)
     - `tCDF(-1.812, 10)` ≈ 0.05
     - `tCDF(2.228, 10)` ≈ 0.975 (97.5th percentile)
     - Tolerance 1e-4.
   - **`chiSquaredCDF` matches scipy at standard percentiles.**
     - `chiSquaredCDF(0, 5)` ≈ 0
     - `chiSquaredCDF(11.07, 5)` ≈ 0.95 (95th percentile)
     - `chiSquaredCDF(15.09, 5)` ≈ 0.99 (99th percentile)
     - Tolerance 1e-3.

   Run; expect 7+ failures (helpers don't exist).

2. **Implement `regularizedIncompleteBeta`.** Numerical Recipes §6.4 formulation. The trick: compute `I_x(a, b) = e^lnBetaCF * x^a * (1-x)^b / (a * Beta(a,b))` where `lnBetaCF` is a Lentz continued fraction; reflect with `1 - I_{1-x}(b, a)` when `x > (a+1)/(a+b+2)` for faster convergence.

   ```ts
   private static regularizedIncompleteBeta(
     x: number,
     a: number,
     b: number
   ): number {
     if (x <= 0) return 0;
     if (x >= 1) return 1;
     // Use the symmetry transformation for faster convergence.
     if (x > (a + 1) / (a + b + 2)) {
       return 1 - this.regularizedIncompleteBeta(1 - x, b, a);
     }
     // ln Β(a,b) — log-gamma via simple-statistics' factorial / gamma helpers
     const lnBeta = this.lnGamma(a) + this.lnGamma(b) - this.lnGamma(a + b);
     const front = Math.exp(
       a * Math.log(x) + b * Math.log(1 - x) - lnBeta - Math.log(a)
     );
     // Lentz's algorithm for the continued fraction
     const eps = 1e-12;
     let cf = 1;
     let c = 1;
     let d = 1 - ((a + b) * x) / (a + 1);
     if (Math.abs(d) < 1e-30) d = 1e-30;
     d = 1 / d;
     cf = d;
     for (let m = 1; m <= 200; m++) {
       const m2 = 2 * m;
       // even step
       let aa =
         (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
       d = 1 + aa * d;
       if (Math.abs(d) < 1e-30) d = 1e-30;
       c = 1 + aa / c;
       if (Math.abs(c) < 1e-30) c = 1e-30;
       d = 1 / d;
       cf *= d * c;
       // odd step
       aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
       d = 1 + aa * d;
       if (Math.abs(d) < 1e-30) d = 1e-30;
       c = 1 + aa / c;
       if (Math.abs(c) < 1e-30) c = 1e-30;
       d = 1 / d;
       const delta = d * c;
       cf *= delta;
       if (Math.abs(delta - 1) < eps) break;
     }
     return front * cf;
   }
   ```

   `lnGamma` is available in `simple-statistics` as part of the package's helpers — confirm during implementation. If absent, the standard Lanczos approximation is ~15 LOC.

3. **Implement `regularizedIncompleteGamma`.** Two regimes: series for `x < s + 1`, continued fraction for `x >= s + 1`.

   ```ts
   private static regularizedIncompleteGamma(s: number, x: number): number {
     if (x < 0 || s <= 0) return 0;
     if (x === 0) return 0;
     if (x < s + 1) {
       // series
       let term = 1 / s;
       let sum = term;
       for (let n = 1; n <= 200; n++) {
         term *= x / (s + n);
         sum += term;
         if (Math.abs(term) < Math.abs(sum) * 1e-12) break;
       }
       return sum * Math.exp(-x + s * Math.log(x) - this.lnGamma(s));
     } else {
       // continued fraction (Lentz)
       const eps = 1e-12;
       let b = x + 1 - s;
       let c = 1e30;
       let d = 1 / b;
       let h = d;
       for (let i = 1; i <= 200; i++) {
         const an = -i * (i - s);
         b += 2;
         d = an * d + b;
         if (Math.abs(d) < 1e-30) d = 1e-30;
         c = b + an / c;
         if (Math.abs(c) < 1e-30) c = 1e-30;
         d = 1 / d;
         const delta = d * c;
         h *= delta;
         if (Math.abs(delta - 1) < eps) break;
       }
       return 1 - h * Math.exp(-x + s * Math.log(x) - this.lnGamma(s));
     }
   }
   ```

4. **Implement `tCDF` and `chiSquaredCDF`.** Thin wrappers:

   ```ts
   private static tCDF(t: number, df: number): number {
     const x = df / (df + t * t);
     const p = 0.5 * this.regularizedIncompleteBeta(x, df / 2, 0.5);
     return t >= 0 ? 1 - p : p;
   }

   private static chiSquaredCDF(x: number, df: number): number {
     return this.regularizedIncompleteGamma(df / 2, x / 2);
   }
   ```

5. **`lnGamma`.** Check whether `simple-statistics` exports it (`ss.gamma`, `ss.gammaln`?). If not, drop in the Lanczos approximation:

   ```ts
   private static lnGamma(x: number): number {
     const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
                -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
     let sum = 1.000000000190015;
     let xx = x;
     for (let i = 0; i < 6; i++) sum += c[i] / ++xx;
     return (x + 0.5) * Math.log(x + 5.5) - (x + 5.5)
            + Math.log(2.5066282746310005 * sum / x);
   }
   ```

   Numerical Recipes §6.1, accurate to ~1e-10.

6. **Run focused suite.** `cd apps/api && npm run test:unit -- analytics.service -t 'distribution CDFs'`. All cases green.

**Done when:** the seven CDF assertions pass; helpers are private but unit-tested.

**Risk:** the textbook continued-fraction formulations have many places where a sign error or indexing-off-by-one breaks convergence. Mitigations:
- Test against scipy at multiple percentiles (not just one).
- If a helper diverges, the 200-iteration cap catches it visibly rather than spinning forever.
- Mid-implementation sanity check: `tCDF(0, df) === 0.5` for any df is a one-line cross-check.

---

## Slice 3 — `hypothesis_test`

**Files**

- New: `apps/api/src/tools/hypothesis-test.tool.ts`
- Edit: `apps/api/src/services/analytics.service.ts`:
  - Add `static hypothesisTest(...)`.
  - Add private `tTwoTailedPValue(t, df)` helper.
- Edit: `apps/api/src/services/tools.service.ts` — register under `statistics` pack; extend `PACK_TOOL_NAMES`.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — new `describe("hypothesisTest()", ...)` block, spec cases 103–115.

**Steps**

1. **Write failing tests** (cases 103–115). 13 cases. Most are inline-fixture, finite-tolerance assertions:
   - Test 105 (scipy reference): hardcode `t = 5.7446`, `p = 0.000277`, `df = 9`. Assert within 1e-3.
   - Test 112 (Wackerly χ²): `statistic ≈ 20`, `p < 1e-3`, `df: 3`.
   - Test 115 (missing input): mirror phase 3's `tvm` error-message convention.

   Run; expect 13 failures.

2. **Service-side implementation.**

   ```ts
   static hypothesisTest(params: {
     test:
       | "t_test_one_sample"
       | "t_test_two_sample"
       | "t_test_paired"
       | "mann_whitney"
       | "chi_squared";
     records?: Record<string, unknown>[];
     columnA?: string;
     columnB?: string;
     mu?: number;
     observed?: number[];
     expected?: number[];
     df?: number;
   }): { statistic: number; pValue: number; df?: number } {
     const { test } = params;

     const requiredFor: Record<typeof test, (keyof typeof params)[]> = {
       t_test_one_sample: ["records", "columnA"],
       t_test_two_sample: ["records", "columnA", "columnB"],
       t_test_paired: ["records", "columnA", "columnB"],
       mann_whitney: ["records", "columnA", "columnB"],
       chi_squared: ["observed", "expected"],
     };
     const missing = requiredFor[test].filter(
       (k) => params[k] === undefined
     );
     if (missing.length > 0) {
       throw new Error(
         `Missing input for test="${test}": ${missing.join(", ")}`
       );
     }

     switch (test) {
       case "t_test_one_sample": {
         const x = this.extractNumericColumn(params.records!, params.columnA!);
         const mu = params.mu ?? 0;
         const t = ss.tTest(x, mu);
         const df = x.length - 1;
         return { statistic: t, pValue: this.tTwoTailedPValue(t, df), df };
       }
       case "t_test_two_sample": {
         const x = this.extractNumericColumn(params.records!, params.columnA!);
         const y = this.extractNumericColumn(params.records!, params.columnB!);
         const t = ss.tTestTwoSample(x, y, 0);
         if (t === null) {
           throw new Error("t_test_two_sample: degenerate inputs (sample length < 2)");
         }
         const df = x.length + y.length - 2;
         return { statistic: t, pValue: this.tTwoTailedPValue(t, df), df };
       }
       case "t_test_paired": {
         const x = this.extractNumericColumn(params.records!, params.columnA!);
         const y = this.extractNumericColumn(params.records!, params.columnB!);
         if (x.length !== y.length) {
           throw new Error("columns must be same length for paired test");
         }
         const diffs = x.map((xi, i) => xi - y[i]);
         const t = ss.tTest(diffs, 0);
         const df = diffs.length - 1;
         return { statistic: t, pValue: this.tTwoTailedPValue(t, df), df };
       }
       case "mann_whitney": {
         const x = this.extractNumericColumn(params.records!, params.columnA!);
         const y = this.extractNumericColumn(params.records!, params.columnB!);
         const W = ss.wilcoxonRankSum(x, y);
         const nx = x.length;
         const ny = y.length;
         const U = W - (nx * (nx + 1)) / 2;
         const meanU = (nx * ny) / 2;
         const sdU = Math.sqrt((nx * ny * (nx + ny + 1)) / 12);
         const z = sdU === 0 ? 0 : (U - meanU) / sdU;
         const p = 2 * (1 - ss.cumulativeStdNormalProbability(Math.abs(z)));
         return { statistic: z, pValue: p };
       }
       case "chi_squared": {
         const observed = params.observed!;
         const expected = params.expected!;
         if (observed.length !== expected.length) {
           throw new Error("observed and expected must have the same length");
         }
         let stat = 0;
         for (let i = 0; i < observed.length; i++) {
           const diff = observed[i] - expected[i];
           stat += (diff * diff) / expected[i];
         }
         const df = params.df ?? observed.length - 1;
         const p = 1 - this.chiSquaredCDF(stat, df);
         return { statistic: stat, pValue: p, df };
       }
     }
   }

   private static tTwoTailedPValue(t: number, df: number): number {
     return 2 * (1 - this.tCDF(Math.abs(t), df));
   }
   ```

3. **Tool-class file.** Create `apps/api/src/tools/hypothesis-test.tool.ts`:

   ```ts
   import { z } from "zod";
   import { tool } from "ai";

   import {
     AnalyticsService,
     type StationData,
   } from "../services/analytics.service.js";
   import { Tool } from "../types/tools.js";
   import { getRecords } from "../utils/tools.util.js";

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
     entity: z.string().optional().describe(/* ... */),
     columnA: z.string().optional().describe(/* ... */),
     columnB: z.string().optional().describe(/* ... */),
     mu: z.number().optional().describe(/* ... */),
     observed: z
       .array(z.number().nonnegative())
       .optional()
       .describe(/* ... */),
     expected: z.array(z.number().positive()).optional().describe(/* ... */),
     df: z.number().int().positive().optional().describe(/* ... */),
   });

   // ... full descriptions per the spec

   export class HypothesisTestTool extends Tool<typeof InputSchema> {
     slug = "hypothesis_test";
     name = "Hypothesis Test";
     description =
       "Run a hypothesis test (one-sample / two-sample / paired t-test, Mann-Whitney U, or chi-squared) " +
       "and return the statistic and two-tailed p-value.";

     get schema() {
       return InputSchema;
     }

     build(stationData: StationData) {
       return tool({
         description: this.description,
         inputSchema: this.schema,
         execute: async (input) => {
           const { entity, ...rest } = this.validate(input);
           const records =
             entity !== undefined ? getRecords(stationData, entity) : undefined;
           return AnalyticsService.hypothesisTest({ ...rest, records });
         },
       });
     }
   }
   ```

   The `entity → records` translation happens in the tool layer; the service receives records directly. This mirrors the existing `correlate`/`regression`/`cluster` pattern.

4. **Register in `ToolService`.**
   - Import: `import { HypothesisTestTool } from "../tools/hypothesis-test.tool.js";`
   - `PACK_TOOL_NAMES`: add `"hypothesis_test"`.
   - `statistics` pack block: append `tools.hypothesis_test = new HypothesisTestTool().build(stationData);`.

5. **Run focused suite.** All 13 hypothesis-test cases green.

**Done when:** spec tests 103–115 pass.

**Risk:** a CDF calibration error in slice 2 silently produces wrong p-values across all five tests in slice 3. Tests 105 (scipy 1-sample t) and 112 (Wackerly χ²) cross-check against published references — both must be within 1e-3 before merge.

---

## After all three slices

1. **Run the full apps/api unit suite.** `cd apps/api && npm run test:unit`. All previous tests pass; 22 new cases pass (plus the 7+ private-CDF tests in slice 2).
2. **Run lint + type-check from repo root.** `npm run lint && npm run type-check`. Clean across all packages.
3. **Manual smoke test against the dev portal.**
   - `npm run dev` from repo root.
   - On a station with the `statistics` pack enabled, ask the model:
     - "Run a one-sample t-test on `revenue` against $1,000." Verify `hypothesis_test` is called with the right args; result renders as a flat data table.
     - "Sum revenue and count rows by region." Verify `aggregate` returns one row per region with two metric columns.

---

## Out-of-band considerations

- **No deployment coordination.** Tools rebuilt every turn.
- **No new dependency.** Hand-rolled CDFs, no `@stdlib/stats` or similar.
- **`describe_column` already returns descriptive stats**; `aggregate` is its grouped sibling. They coexist; the model picks based on whether grouping is needed.

---

## PR shape

- Branch: continue on `feat/expand-tool-set-capabilities` or fork `feat/analytics-pack-phase-4`.
- Commits: three conventional-commits-style commits matching the slices, in order:
  - `feat(aggregate-tool): group-by + reduce backed by Arquero`
  - `feat(analytics-service): add t-distribution and chi-squared CDF helpers`
  - `feat(hypothesis-test-tool): t-tests, Mann-Whitney U, and chi-squared with two-tailed p-values`
- PR description: link the discovery + spec + plan docs. Note the discovery delta (KS and Wilcoxon signed-rank deferred; t- and χ²-CDFs hand-rolled because not in `simple-statistics`). Reference the phasing table — phase 4 of seven; phases 5–7 unstarted.
