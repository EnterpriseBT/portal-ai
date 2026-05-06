# Analytics Pack Expansion — Phase 1 — Plan

**TDD-sequenced implementation of the six tool widenings in phase 1: `detect_outliers`, `cluster`, `regression`, `amortize`, `sharpe_ratio`, `correlate`.**

Spec: `docs/ANALYTICS_PACK_EXPANSION_PHASE_1.spec.md`. Discovery: `docs/ANALYTICS_PACK_EXPANSION.discovery.md`.

The change is small but spans six tools and one service module. Six slices, one per tool, each behind a green test suite. Slices are mergeable in any order — there are no inter-tool dependencies — but the listed order is the recommended sequence (smallest diff first; `sharpe_ratio` last because it is the only breaking change).

Run tests with `cd apps/api && npm run test:unit -- analytics.service` per `feedback_use_npm_test_scripts` — never invoke jest directly.

Each slice follows the same loop:

1. Write failing service-layer tests for the new behavior.
2. Implement the service-side change.
3. Widen the tool-file Zod schema and forward the new params.
4. Run the focused test suite; confirm green.
5. Run lint + type-check.

No frontend, DB, contract, or SDK changes in any slice.

---

## Slice 1 — `regression` surfaces `degree`

Smallest diff: the service already accepts `degree`; only the tool schema needs widening. Lands first to set the pattern for the other five slices.

**Files**

- Edit: `apps/api/src/tools/regression.tool.ts` — add `degree` to `InputSchema`, forward in `execute`.
- Edit (possibly): `apps/api/src/__tests__/tools/regression.tool.test.ts` — Zod-validation test for the `[2, 10]` bound. Audit `apps/api/src/__tests__/` for an existing tool-test directory; create if absent.

**Steps**

1. **Audit existing tool tests.** `cd apps/api && find src/__tests__ -type d`. If `__tests__/tools/` does not exist, the Zod-validation case (test 36) lands inline as a service-test sibling — extend the existing `describe("regression()", ...)` block in `analytics.service.test.ts` with a Zod-only assertion using `RegressionTool.prototype.schema.safeParse(...)`. Decide here, not later.

2. **Write failing tests** (cases 34 and 36 from the spec):
   - `it("computes high-R² fit for cubic data with degree 3", ...)` — fixture: `Array.from({ length: 21 }, (_, i) => { const x = i - 10; return { x, y: x ** 3 + (Math.random() - 0.5) * 2 } })`. Assert `result.coefficients.length === 4` and `rSquared > 0.99`.
   - `it("rejects degree below 2 or above 10 at the schema layer", ...)` — `expect(new RegressionTool().schema.safeParse({ entity: "x", x: "x", y: "y", type: "polynomial", degree: 1 }).success).toBe(false)`. Same for `degree: 11`.
   - Run the suite; both fail (cubic test fails on `coefficients.length === 3` with the default degree=2 path; schema test fails because `degree` isn't in the schema yet).

3. **Edit `apps/api/src/tools/regression.tool.ts`:**
   ```ts
   const InputSchema = z.object({
     entity: z.string().describe("Entity key (table name)"),
     x: z.string().describe("Independent variable column"),
     y: z.string().describe("Dependent variable column"),
     type: z.enum(["linear", "polynomial"]).describe("Regression type"),
     degree: z
       .number()
       .int()
       .min(2)
       .max(10)
       .optional()
       .describe("Polynomial degree (default 2). Ignored when type is 'linear'."),
   });
   ```
   In `build(...)`'s `execute`, destructure `degree` and pass to the service:
   ```ts
   const { entity, x, y, type, degree } = this.validate(input);
   const records = getRecords(stationData, entity);
   return AnalyticsService.regression({ records, x, y, type, degree });
   ```

4. **Run the focused suite.** `cd apps/api && npm run test:unit -- analytics.service`. The cubic test passes (the service already handles `degree`). The schema test passes.

5. **Lint + type-check.** `npm run lint && npm run type-check` from repo root. Clean.

**Done when:** spec tests 34 and 36 pass; existing `regression()` tests still pass.

**Risk:** none — the service already implements the behavior; this is pure schema widening.

---

## Slice 2 — `correlate.method` (Pearson + Spearman + Kendall)

**Files**

- Edit: `apps/api/src/tools/correlate.tool.ts` — add `method` to `InputSchema`, forward.
- Edit: `apps/api/src/services/analytics.service.ts` — branch `correlate` on `method`; add private `static kendallTau(a, b)`.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — extend `describe("correlate()", ...)`.

**Steps**

1. **Write failing tests** (spec cases 50–58, all 9):
   - Spearman tests (50–52) and Kendall tests (53–56) live in the existing `correlate()` block.
   - For Kendall fixture (test 55), the Wackerly reference value is `0.7142857142857143` (5/7). Inline as `expect(result.correlation).toBeCloseTo(5 / 7, 6)`.
   - For tied-Kendall (test 56), compute the expected value by hand: with `x = [1,1,2,3,4]` and `y = [1,2,2,3,4]` the τ-b denominator correction matters. Use SciPy as the source of truth: `scipy.stats.kendalltau([1,1,2,3,4],[1,2,2,3,4]).correlation == 0.9128709291752769`. Inline as `expect(result.correlation).toBeCloseTo(0.9128709291752769, 6)` with a comment citing the SciPy reference.
   - Run the suite. All 9 new tests fail (no `method` field on the service yet).

2. **Add `kendallTau` private static** to `AnalyticsService`. Place it near the existing private helpers (`extractNumericColumn`, `computeRSquared`, `polynomialFit` — `analytics.service.ts:1563-1649`):

   ```ts
   /**
    * Kendall's τ-b (with tie correction).
    * Reference: Kendall (1938); Wackerly/Mendenhall §15.10.
    */
   private static kendallTau(a: number[], b: number[]): number {
     const n = a.length;
     if (n < 2) return 0;

     let concordant = 0;
     let discordant = 0;
     let tiesA = 0;
     let tiesB = 0;

     for (let i = 0; i < n - 1; i++) {
       for (let j = i + 1; j < n; j++) {
         const da = Math.sign(a[i] - a[j]);
         const db = Math.sign(b[i] - b[j]);
         if (da === 0 && db === 0) {
           tiesA++;
           tiesB++;
         } else if (da === 0) {
           tiesA++;
         } else if (db === 0) {
           tiesB++;
         } else if (da === db) {
           concordant++;
         } else {
           discordant++;
         }
       }
     }

     const n0 = (n * (n - 1)) / 2;
     const denom = Math.sqrt((n0 - tiesA) * (n0 - tiesB));
     if (denom === 0) return 0; // SciPy convention for fully-tied input
     return (concordant - discordant) / denom;
   }
   ```

3. **Branch `correlate` on `method`.** Replace the existing single line:

   ```ts
   return { correlation: ss.sampleCorrelation(a, b) };
   ```

   with:

   ```ts
   const method = params.method ?? "pearson";
   let correlation: number;
   switch (method) {
     case "pearson":
       correlation = ss.sampleCorrelation(a, b);
       break;
     case "spearman":
       correlation = ss.sampleRankCorrelation(a, b);
       break;
     case "kendall":
       correlation = this.kendallTau(a, b);
       break;
   }
   return { correlation };
   ```

   Update the `correlate` parameter type:

   ```ts
   static correlate(params: {
     records: Record<string, unknown>[];
     columnA: string;
     columnB: string;
     method?: "pearson" | "spearman" | "kendall";
   }): { correlation: number }
   ```

4. **Edit `apps/api/src/tools/correlate.tool.ts`** — add `method` to `InputSchema`, destructure and forward:

   ```ts
   const InputSchema = z.object({
     entity: z.string().describe("Entity key (table name)"),
     columnA: z.string().describe("First numeric column"),
     columnB: z.string().describe("Second numeric column"),
     method: z
       .enum(["pearson", "spearman", "kendall"])
       .optional()
       .describe(
         "Correlation method. Default 'pearson'. " +
           "Use 'spearman' for monotonic non-linear relationships or ranked data. " +
           "Use 'kendall' for small samples or ordinal data with ties."
       ),
   });
   ```

   In `execute`:
   ```ts
   const { entity, columnA, columnB, method } = this.validate(input);
   const records = getRecords(stationData, entity);
   return AnalyticsService.correlate({ records, columnA, columnB, method });
   ```

5. **Run the focused suite.** All 9 new + existing 2 = 11 cases green.

6. **Lint + type-check.** Clean.

**Done when:** spec tests 50–58 pass; existing `correlate()` tests still pass.

**Risk:** Kendall on a tied fixture deviates from SciPy. Test 56 is the canary; if it fails, the most likely bug is in the tie-counting branches (`da === 0 && db === 0` should increment both `tiesA` and `tiesB`, matching SciPy's "ties in both" convention). Re-derive against the formula in Wackerly if needed.

---

## Slice 3 — `detect_outliers` adds `threshold` and `mad`

**Files**

- Edit: `apps/api/src/tools/detect-outliers.tool.ts` — extend `method` enum, add `threshold` field.
- Edit: `apps/api/src/services/analytics.service.ts` — thread `threshold` through; add MAD branch.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — extend `describe("detectOutliers()", ...)`.

**Steps**

1. **Write failing tests** (spec cases 23–27). Re-use the existing `NUMERIC_RECORDS + outlier` fixture pattern from the current tests. Run; all 5 fail.

2. **Service-side change.** Replace the existing `detectOutliers` switch:

   ```ts
   static detectOutliers(params: {
     records: Record<string, unknown>[];
     column: string;
     method: "iqr" | "zscore" | "mad";
     threshold?: number;
   }): { outliers: Record<string, unknown>[]; indices: number[] } {
     const values = this.extractNumericColumn(params.records, params.column);
     const indices: number[] = [];
     const { method } = params;

     if (method === "iqr") {
       const t = params.threshold ?? 1.5;
       const q1 = ss.quantile(values, 0.25);
       const q3 = ss.quantile(values, 0.75);
       const iqr = q3 - q1;
       const lower = q1 - t * iqr;
       const upper = q3 + t * iqr;
       values.forEach((v, i) => {
         if (v < lower || v > upper) indices.push(i);
       });
     } else if (method === "zscore") {
       const t = params.threshold ?? 3;
       const m = ss.mean(values);
       const std = ss.standardDeviation(values);
       if (std === 0) return { outliers: [], indices: [] };
       values.forEach((v, i) => {
         if (Math.abs((v - m) / std) > t) indices.push(i);
       });
     } else {
       // mad — Iglewicz/Hoaglin modified z-score
       const t = params.threshold ?? 3.5;
       const median = ss.median(values);
       const deviations = values.map((v) => Math.abs(v - median));
       const mad = ss.median(deviations);
       if (mad === 0) return { outliers: [], indices: [] };
       values.forEach((v, i) => {
         const modZ = (0.6745 * (v - median)) / mad;
         if (Math.abs(modZ) > t) indices.push(i);
       });
     }

     return { outliers: indices.map((i) => params.records[i]), indices };
   }
   ```

3. **Tool-side change.** Update `apps/api/src/tools/detect-outliers.tool.ts`:

   ```ts
   const InputSchema = z.object({
     entity: z.string().describe("Entity key (table name)"),
     column: z.string().describe("Numeric column key"),
     method: z
       .enum(["iqr", "zscore", "mad"])
       .describe("Detection method: iqr, zscore, or mad (median absolute deviation)"),
     threshold: z
       .number()
       .positive()
       .optional()
       .describe(
         "Cutoff: IQR multiplier (default 1.5), |z| cutoff (default 3), or |modified z| cutoff (default 3.5)"
       ),
   });
   ```

   Forward in `execute`:
   ```ts
   const { entity, column, method, threshold } = this.validate(input);
   const records = getRecords(stationData, entity);
   return AnalyticsService.detectOutliers({ records, column, method, threshold });
   ```

4. **Run focused suite.** Cases 23–27 + existing 2 = 7 green.

5. **Lint + type-check.** Clean.

**Done when:** spec tests 23–27 pass; existing tests still pass.

**Risk:** the 0.6745 constant is the standard scaling so MAD-based modified z-scores are comparable to z-scores under a normal distribution. If a future test expects raw `(v - median) / mad`, the constant is the obvious culprit — but it is correct as written. Cite Iglewicz/Hoaglin in a comment.

---

## Slice 4 — `cluster` adds `standardize`, `seed`, `maxIterations`

**Files**

- Edit: `apps/api/src/tools/cluster.tool.ts` — add three optional fields.
- Edit: `apps/api/src/services/analytics.service.ts` — thread `seed`/`maxIterations` to `kmeans`; implement `standardize` + un-standardize.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — extend `describe("cluster()", ...)`.

**Steps**

1. **Write failing tests** (spec cases 28–33). For test 30, build the fixture inline:
   ```ts
   const records = [
     { a: 0.1, b: 100 },
     { a: 0.2, b: 200 },
     { a: 0.15, b: 150 },
     { a: 0.8, b: 800 },
     { a: 0.9, b: 900 },
     { a: 0.85, b: 850 },
   ];
   ```
   The pre-standardized version (test 30) is computed inline by the test:
   ```ts
   const cols = ["a", "b"];
   const means = cols.map((c) => ss.mean(records.map((r) => r[c])));
   const stddevs = cols.map((c) => ss.standardDeviation(records.map((r) => r[c])));
   const standardized = records.map((r) =>
     Object.fromEntries(cols.map((c, i) => [c, (r[c] - means[i]) / stddevs[i]]))
   );
   ```
   Then assert that
   ```ts
   AnalyticsService.cluster({ records, columns: cols, k: 2, standardize: true }).clusters
   ```
   equals
   ```ts
   AnalyticsService.cluster({ records: standardized, columns: cols, k: 2 }).clusters
   ```
   modulo a label permutation. (k-means cluster *labels* are not stable across runs; the partition is. Use a helper that maps each cluster's id to the canonical id of its first member, then compare.)

2. **Service-side change.** Replace the body of `cluster`:

   ```ts
   static cluster(params: {
     records: Record<string, unknown>[];
     columns: string[];
     k: number;
     standardize?: boolean;
     seed?: number;
     maxIterations?: number;
   }): { clusters: number[]; centroids: number[][] } {
     const data = params.records.map((r) =>
       params.columns.map((col) => {
         const v = Number(r[col]);
         if (isNaN(v)) throw new Error(`Non-numeric value in column "${col}"`);
         return v;
       })
     );

     if (data.length === 0) return { clusters: [], centroids: [] };

     let fitData = data;
     let means: number[] | null = null;
     let stddevs: number[] | null = null;

     if (params.standardize) {
       const cols = params.columns.length;
       means = Array(cols).fill(0);
       stddevs = Array(cols).fill(0);
       for (let c = 0; c < cols; c++) {
         const colVals = data.map((r) => r[c]);
         means[c] = ss.mean(colVals);
         stddevs[c] = ss.standardDeviation(colVals);
       }
       fitData = data.map((row) =>
         row.map((v, c) =>
           stddevs![c] === 0 ? 0 : (v - means![c]) / stddevs![c]
         )
       );
     }

     const opts: { seed?: number; maxIterations?: number } = {};
     if (params.seed !== undefined) opts.seed = params.seed;
     if (params.maxIterations !== undefined) opts.maxIterations = params.maxIterations;

     const result = kmeans(fitData, params.k, opts);

     const rawCentroids = result.centroids.map((c: any) =>
       Array.isArray(c) ? c : c.centroid
     );

     // Un-standardize centroids back to original-data units
     const centroids =
       params.standardize && means && stddevs
         ? rawCentroids.map((row) =>
             row.map((v, c) => (stddevs![c] === 0 ? means![c] : v * stddevs![c] + means![c]))
           )
         : rawCentroids;

     return { clusters: result.clusters, centroids };
   }
   ```

3. **Tool-side change.** Update `apps/api/src/tools/cluster.tool.ts`:

   ```ts
   const InputSchema = z.object({
     entity: z.string().describe("Entity key (table name)"),
     columns: z.array(z.string()).describe("Numeric columns to cluster on"),
     k: z.number().int().min(2).describe("Number of clusters"),
     standardize: z
       .boolean()
       .optional()
       .describe("Z-score each column before clustering. Default false."),
     seed: z
       .number()
       .int()
       .optional()
       .describe("Seed for reproducible cluster initialization"),
     maxIterations: z
       .number()
       .int()
       .positive()
       .optional()
       .describe("Maximum k-means iterations (default 100)"),
   });
   ```

   Forward in `execute`:
   ```ts
   const { entity, columns, k, standardize, seed, maxIterations } = this.validate(input);
   const records = getRecords(stationData, entity);
   return AnalyticsService.cluster({ records, columns, k, standardize, seed, maxIterations });
   ```

4. **Run focused suite.** Cases 28–33 + existing 3 = 9 green.

5. **Lint + type-check.** Clean.

**Done when:** spec tests 28–33 pass; existing `cluster()` tests still pass.

**Risk:** test 29 (different seeds → different outputs) may be flaky depending on `ml-kmeans`'s seeding semantics. If two seed values produce identical cluster assignments on the engineered fixture, fall back to the property-test variant in the spec: assert each run is internally consistent (clusters length matches data length, centroids length matches k) and skip the strict "different output" assertion. Document the demotion inline.

---

## Slice 5 — `amortize` adds `compounding` and `extraPayment`

**Files**

- Edit: `apps/api/src/tools/amortize.tool.ts` — add two optional fields.
- Edit: `apps/api/src/services/analytics.service.ts` — periodic-rate map; extra-payment loop.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — new `describe("amortize()", ...)` block. (The test file currently has no `amortize` block; add one near the other financial tools.)

**Steps**

1. **Capture pre-change baseline for test 37.** Before editing the service, run a one-shot script (or inline calc) to record the byte-stable schedule for `principal=200000, annualRate=0.06, periods=360`. Inline the baseline values needed for the test:
   ```ts
   const result = AnalyticsService.amortize({ principal: 200000, annualRate: 0.06, periods: 360 });
   // Pre-change baseline (captured before this slice):
   //   result.length === 360
   //   result[0].payment === 1199.10  (round(2))
   //   result[359].balance === 0
   //   sum of result.map(r => r.interest) ≈ 231676.38
   ```
   These constants land in the spec's test 37 directly.

2. **Write failing tests** (spec cases 37–42). All six new cases land in a new `describe("amortize()", ...)` block. Reference values:
   - Test 38 (quarterly): `periodicRate = 0.06 / 4 = 0.015`, `interest_row1 = 10000 * 0.015 = 150`.
   - Test 39 (annual): `interest_row1 = 10000 * 0.06 = 600`.
   - Test 40 (extra payment): just assert `result.length < 360` and `result[result.length - 1].balance === 0`. The exact length depends on the schedule and is the right shape for an empirical assertion (no need to inline the precise value).
   - Test 42 (zero rate): every row's interest is 0; principal portion is `principal / periods = 100`; final balance is 0.
   - Run; all 6 fail.

3. **Service-side change.** Replace the body of `amortize`:

   ```ts
   static amortize(params: {
     principal: number;
     annualRate: number;
     periods: number;
     compounding?: "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";
     extraPayment?: number;
   }): AmortizationRow[] {
     const { principal, annualRate, periods } = params;
     const periodsPerYear = {
       weekly: 52,
       biweekly: 26,
       monthly: 12,
       quarterly: 4,
       annual: 1,
     }[params.compounding ?? "monthly"];

     const periodicRate = annualRate / periodsPerYear;
     const basePayment =
       periodicRate === 0
         ? principal / periods
         : -financial.pmt(periodicRate, periods, principal);
     const extra = params.extraPayment ?? 0;
     const schedule: AmortizationRow[] = [];
     let balance = principal;

     for (let i = 1; i <= periods; i++) {
       if (balance <= 0) break;
       const interest = balance * periodicRate;
       let principalPart = basePayment - interest + extra;
       let payment = basePayment + extra;
       if (principalPart > balance) {
         principalPart = balance;
         payment = principalPart + interest;
       }
       balance -= principalPart;
       schedule.push({
         period: i,
         payment: Math.round(payment * 100) / 100,
         principal: Math.round(principalPart * 100) / 100,
         interest: Math.round(interest * 100) / 100,
         balance: Math.round(Math.max(balance, 0) * 100) / 100,
       });
     }

     return schedule;
   }
   ```

4. **Tool-side change.** Update `apps/api/src/tools/amortize.tool.ts`:

   ```ts
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
   ```

   Forward in `execute`:
   ```ts
   const { principal, annualRate, periods, compounding, extraPayment } = this.validate(input);
   return AnalyticsService.amortize({ principal, annualRate, periods, compounding, extraPayment });
   ```

5. **Run focused suite.** All 6 new tests pass; default-behavior test 37 confirms byte-stability.

6. **Lint + type-check.** Clean.

**Done when:** spec tests 37–42 pass; pre-change behavior is byte-stable per test 37.

**Risk:** the zero-rate path was implicit before (the existing `financial.pmt(0, ...)` handles it but produces NaN-adjacent results in some edge cases). The explicit `periodicRate === 0` branch avoids relying on that. Test 42 is the canary.

---

## Slice 6 — `sharpe_ratio` replaces `annualize` with `periodicity`

The only breaking-change slice. Lands last so the breaking change is isolated to a single commit.

**Files**

- Edit: `apps/api/src/tools/sharpe-ratio.tool.ts` — replace `annualize` field with `periodicity`.
- Edit: `apps/api/src/services/analytics.service.ts` — replace `Math.sqrt(252)` block with a periodicity-driven multiplier.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — migrate any `annualize:` usages, add the 6 new cases.

**Steps**

1. **Audit existing `annualize` usages.** `cd apps/api && grep -rn "annualize" src`. The only callers should be in `analytics.service.ts` itself, the `sharpe_ratio.tool.ts` schema, and any service tests. If any other call site references `annualize`, that's a new finding — pause and resolve before continuing.

2. **Write failing tests** (spec cases 43–48). Hyndman §3 Table 3.1 is the canonical fixture for short return series; use the first 10 monthly returns from that table inline:
   ```ts
   const returns = [0.012, -0.005, 0.018, 0.022, -0.008, 0.015, 0.003, 0.011, -0.002, 0.025];
   const recordsFromReturns = returns.map((r, i) => ({ d: `2024-${String(i + 1).padStart(2, "0")}-01`, v: 100 * (1 + r) }));
   ```
   Use `valueColumn: "v"` so the existing `(values[i] - values[i-1]) / values[i-1]` returns calculation reconstructs `returns` cleanly.
   - Compute the expected raw ratio inline using the exact same formula the service uses (`(mean(returns) - 0) / stddev(returns)`).
   - Assert against `result.sharpeRatio === expected_raw` for case 43.
   - For cases 44–47, assert `result.sharpeRatio === expected_raw * Math.sqrt(252)` etc., using `toBeCloseTo(..., 9)`.
   - For case 48 (`annual`), assert exactly equal to the raw value.
   - Run; all 6 fail because `periodicity` is unknown.

3. **Migrate existing tests** (spec case 49). Find every `annualize:` keyword in the test file; rewrite as `periodicity: "daily"` for `annualize: true` and as omission for `annualize: false`. If the existing test was asserting against `Math.sqrt(252) * raw`, the assertion stays correct under `periodicity: "daily"`.

4. **Service-side change.** Replace the body of `sharpeRatio`:

   ```ts
   static sharpeRatio(params: {
     records: Record<string, unknown>[];
     valueColumn: string;
     riskFreeRate?: number;
     periodicity?: "daily" | "weekly" | "monthly" | "quarterly" | "annual";
   }): { sharpeRatio: number } {
     const values = this.extractNumericColumn(params.records, params.valueColumn);
     if (values.length < 2) {
       throw new Error("At least 2 values required for Sharpe ratio");
     }

     const returns: number[] = [];
     for (let i = 1; i < values.length; i++) {
       returns.push((values[i] - values[i - 1]) / values[i - 1]);
     }

     const meanReturn = ss.mean(returns);
     const stdReturn = ss.standardDeviation(returns);
     const rfr = params.riskFreeRate ?? 0;

     if (stdReturn === 0) return { sharpeRatio: 0 };

     const annualizationFactor = {
       daily: Math.sqrt(252),
       weekly: Math.sqrt(52),
       monthly: Math.sqrt(12),
       quarterly: 2,
       annual: 1,
     };

     let ratio = (meanReturn - rfr) / stdReturn;
     if (params.periodicity) ratio *= annualizationFactor[params.periodicity];

     return { sharpeRatio: ratio };
   }
   ```

5. **Tool-side change.** Update `apps/api/src/tools/sharpe-ratio.tool.ts`:

   ```ts
   const InputSchema = z.object({
     entity: z.string().describe("Entity key (table name)"),
     valueColumn: z.string().describe("Value/price column key"),
     riskFreeRate: z
       .number()
       .optional()
       .describe("Per-period risk-free rate (default 0)"),
     periodicity: z
       .enum(["daily", "weekly", "monthly", "quarterly", "annual"])
       .optional()
       .describe(
         "Annualization frequency. When omitted, the raw per-period ratio is returned (no annualization)."
       ),
   });
   ```

   Forward in `execute`:
   ```ts
   const { entity, valueColumn, riskFreeRate, periodicity } = this.validate(input);
   const records = getRecords(stationData, entity);
   return AnalyticsService.sharpeRatio({ records, valueColumn, riskFreeRate, periodicity });
   ```

6. **Update tool description.** The `description` string on `SharpeRatioTool` mentions "Optionally annualize for daily data." Update to: "Compute the Sharpe ratio from a series of values. Optionally annualize via the `periodicity` field (daily, weekly, monthly, quarterly, annual)."

7. **Run focused suite.** All 6 new tests + migrated existing tests green.

8. **Lint + type-check.** Clean.

**Done when:** spec tests 43–49 pass; no `annualize` keyword survives in `apps/api/src` outside historical comments.

**Risk:** the breaking change to the tool surface is the visible-to-model change. Per `feedback_no_compat_aliases`, no fallback is added. Behavior risk is zero (the model rebuilds from the schema each turn; there is no in-flight call); copy risk is that the prompt-level guidance for the tool now refers to a new field. The `description` update in step 6 covers this.

---

## After all six slices

1. **Run the full apps/api unit suite.** `cd apps/api && npm run test:unit`. All previous tests pass; 35 new cases pass.
2. **Run integration tests if relevant.** `cd apps/api && npm run test:integration -- analytics` if such a script exists. (The existing integration-test directory tests repositories, not analytics; likely no-op.)
3. **Run lint + type-check from repo root.** `npm run lint && npm run type-check`. Clean across all packages.
4. **Manual smoke test against the dev portal.**
   - `npm run dev` from repo root.
   - On a station with `statistics`, `regression`, and `financial` packs enabled, ask the model:
     - "Compute the Spearman correlation between `revenue` and `headcount`." Verify the tool call carries `method: "spearman"`.
     - "Cluster the customer table on `arr` and `seats` after standardizing." Verify the tool call carries `standardize: true`.
     - "Amortize a $300,000 loan at 5% over 360 months with a $200 extra payment each month." Verify the schedule terminates short of 360 rows.
     - "Compute the Sharpe ratio of `daily_return` annualized for daily data." Verify the tool call carries `periodicity: "daily"`.
   - Confirm each call returns within a turn and the result renders as a `data-table` block in the chat.

---

## Out-of-band considerations

- **No deployment coordination.** Tools are rebuilt every turn; the change takes effect on the first portal-session message after deploy.
- **No telemetry change.** If we want to learn which tool variants the model reaches for (Spearman vs. Pearson share, MAD adoption rate), that's a separate analytics workstream and out of scope for phase 1.
- **No follow-up phase scoped in this PR.** Phase 2 (widen `describe_column` + `technical_indicator` enums) is the next natural slice and gets its own discovery → spec → plan triple before implementation.

---

## PR shape

- Branch: a new branch — suggestion `feat/analytics-pack-phase-1`.
- Commits: six conventional-commits-style commits matching the slices, in the listed order:
  - `feat(regression-tool): surface degree on the polynomial regression schema`
  - `feat(correlate-tool): add method enum (pearson/spearman/kendall)`
  - `feat(detect-outliers-tool): add threshold parameter and mad method`
  - `feat(cluster-tool): add standardize, seed, and maxIterations`
  - `feat(amortize-tool): add compounding and extraPayment`
  - `feat(sharpe-ratio-tool): replace annualize with periodicity enum`
- PR description: link the discovery + spec + plan docs. Note the one breaking change (sharpe_ratio.annualize → periodicity) explicitly and the "no compat alias" rationale. Reference the discovery's phasing table — phase 1 of seven; phases 2–7 are tracked but unstarted.
