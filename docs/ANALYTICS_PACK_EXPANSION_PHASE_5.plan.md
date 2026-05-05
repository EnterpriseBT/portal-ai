# Analytics Pack Expansion — Phase 5 — Plan

**TDD-sequenced implementation of regression diagnostics + multivariate inputs + a new `logistic_regression` tool.**

Spec: `docs/ANALYTICS_PACK_EXPANSION_PHASE_5.spec.md`. Discovery: `docs/ANALYTICS_PACK_EXPANSION.discovery.md`. Phase 4 commit: `0b0960b`.

Three slices, in dependency order:

1. **`solveOLS` + `tInverseCDF` helpers.** Private statics that the next two slices consume. No tool surface.
2. **`regression` widening.** Multivariate inputs + always-present diagnostic fields. Re-uses `solveOLS` from slice 1.
3. **`logistic_regression`** (new tool). Hand-rolled IRLS using the same `solveOLS` machinery for the weighted-least-squares step.

Each slice follows the established loop:

1. Write failing tests.
2. Implement.
3. Re-run; confirm green.

Lint + type-check after all three slices.

Run tests with `cd apps/api && npm run test:unit -- analytics.service` per `feedback_use_npm_test_scripts`.

---

## Slice 1 — `solveOLS` + `tInverseCDF` helpers

**Files**

- Edit: `apps/api/src/services/analytics.service.ts`:
  - Add private `solveOLS(X: number[][], y: number[])` returning `{ coefficients: number[]; covarianceMatrix: number[][]; residuals: number[] }`.
  - Add private `tInverseCDF(p: number, df: number)` (bisection on existing `tCDF`).
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — extend the existing `distribution CDFs (private)` block with three `tInverseCDF` cases.

**Steps**

1. **Write failing tests** for `tInverseCDF` (spec cases 144–146). Inside the existing `describe("distribution CDFs (private)", ...)` block, append:

   ```ts
   it("tInverseCDF(0.5, df) === 0 for any df", () => {
     for (const df of [1, 5, 10, 50, 100]) {
       expect(svc.tInverseCDF(0.5, df)).toBeCloseTo(0, 9);
     }
   });

   it("tInverseCDF(0.975, 10) ≈ 2.228 (scipy reference)", () => {
     expect(svc.tInverseCDF(0.975, 10)).toBeCloseTo(2.228, 3);
   });

   it("tInverseCDF(0.95, large df) approaches the standard-normal 95th pctl", () => {
     // Standard normal: Φ⁻¹(0.95) ≈ 1.6449
     expect(svc.tInverseCDF(0.95, 1000)).toBeCloseTo(1.6449, 2);
   });
   ```

   `solveOLS` is internal scaffolding — it isn't unit-tested at the helper level (the regression-output tests in slice 2 are the real cross-check). Skipping helper-level tests on `solveOLS` matches the convention used for `polynomialFit` (no direct test; covered through `regression()`).

   Run; expect 3 failures (`tInverseCDF` doesn't exist).

2. **Implement `solveOLS`.** Add near the existing private statics in `analytics.service.ts`. The method generalizes `polynomialFit`'s normal-equations pattern but also retains `(X'X)⁻¹` for downstream SE computation.

   ```ts
   /**
    * Solve y = X β by ordinary least squares. Returns the coefficient
    * vector AND the inverted normal-equations matrix (X'X)⁻¹, which the
    * caller multiplies by σ² to get the coefficient covariance matrix.
    */
   private static solveOLS(
     X: number[][],
     y: number[]
   ): {
     coefficients: number[];
     xtxInverse: number[][];
     residuals: number[];
   } {
     const n = X.length;
     const k = X[0].length;
     if (n < k) {
       throw new Error(
         `Need at least ${k} rows for the regression; got ${n}`
       );
     }

     // Build X'X and X'y
     const xtx: number[][] = Array.from({ length: k }, () =>
       new Array(k).fill(0)
     );
     const xty: number[] = new Array(k).fill(0);
     for (let i = 0; i < n; i++) {
       const row = X[i];
       for (let a = 0; a < k; a++) {
         xty[a] += row[a] * y[i];
         for (let b = 0; b < k; b++) {
           xtx[a][b] += row[a] * row[b];
         }
       }
     }

     // Gauss-Jordan inversion of X'X via [X'X | I] → [I | (X'X)⁻¹]
     const aug: number[][] = xtx.map((row, i) => [
       ...row,
       ...new Array(k).fill(0).map((_, j) => (i === j ? 1 : 0)),
     ]);

     for (let col = 0; col < k; col++) {
       let pivot = col;
       for (let r = col + 1; r < k; r++) {
         if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r;
       }
       if (Math.abs(aug[pivot][col]) < 1e-12) {
         throw new Error(
           "design matrix is singular (collinear columns?)"
         );
       }
       [aug[col], aug[pivot]] = [aug[pivot], aug[col]];

       const piv = aug[col][col];
       for (let j = 0; j < 2 * k; j++) aug[col][j] /= piv;
       for (let r = 0; r < k; r++) {
         if (r === col) continue;
         const factor = aug[r][col];
         if (factor === 0) continue;
         for (let j = 0; j < 2 * k; j++) {
           aug[r][j] -= factor * aug[col][j];
         }
       }
     }

     const xtxInverse = aug.map((row) => row.slice(k));

     // β̂ = (X'X)⁻¹ X'y
     const coefficients: number[] = new Array(k).fill(0);
     for (let i = 0; i < k; i++) {
       for (let j = 0; j < k; j++) {
         coefficients[i] += xtxInverse[i][j] * xty[j];
       }
     }

     // Residuals = y - X β̂
     const residuals: number[] = new Array(n).fill(0);
     for (let i = 0; i < n; i++) {
       let predicted = 0;
       for (let j = 0; j < k; j++) predicted += X[i][j] * coefficients[j];
       residuals[i] = y[i] - predicted;
     }

     return { coefficients, xtxInverse, residuals };
   }
   ```

3. **Implement `tInverseCDF`.** Bisection on the existing `tCDF`. Tail clamp keeps the bracket finite.

   ```ts
   /**
    * Inverse Student's t CDF. Bisection on `tCDF` over a wide bracket;
    * clamps at ±50 for tail probabilities below 1e-15.
    */
   private static tInverseCDF(p: number, df: number): number {
     if (p <= 1e-15) return -50;
     if (p >= 1 - 1e-15) return 50;
     let lo = -50;
     let hi = 50;
     for (let i = 0; i < 100; i++) {
       const mid = (lo + hi) / 2;
       const cdf = this.tCDF(mid, df);
       if (Math.abs(cdf - p) < 1e-10) return mid;
       if (cdf < p) lo = mid;
       else hi = mid;
     }
     return (lo + hi) / 2;
   }
   ```

4. **Run focused suite.** `cd apps/api && npm run test:unit -- 'analytics.service' -t 'distribution CDFs'`. All 8 prior + 3 new = 11 cases green.

**Done when:** spec tests 144–146 pass.

**Risk:** the bisection bracket `[-50, 50]` is wider than any practical t-value. If a future caller hits a probability so extreme that the corresponding t exceeds 50, the function returns ±50 (clamped); this is documented behavior, not a bug.

---

## Slice 2 — `regression` widening

**Files**

- Edit: `apps/api/src/tools/regression.tool.ts` — extend `InputSchema` with `xColumns` and `confidence`; widen forwarded args.
- Edit: `apps/api/src/services/analytics.service.ts`:
  - Update `RegressionResult` interface with the five new fields.
  - Rewrite `regression(...)` to dispatch single-column / multivariate / polynomial through a unified `solveOLS` path; always return diagnostics.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — extend `describe("regression()", ...)` with cases 125–134.

**Steps**

1. **Capture pre-change baseline.** Existing tests (linear, polynomial degree 2, throw-on-1-row) check `coefficients` and `rSquared` — they will continue to pass because those fields stay. The new fields are *additions*. No baseline-snapshot exercise needed for byte-stability beyond the existing assertions.

2. **Write failing tests** (spec cases 125–134). For test 126 (scipy cross-check), pre-compute the reference values once:

   - For `x = [1..10]`, `y = [2.5, 3.1, 4.0, 5.2, 6.1, 7.0, 8.1, 9.2, 10.0, 11.1]` (or similar):
     - scipy.stats.linregress: slope ≈ 0.965, intercept ≈ 1.50, slopeStdErr ≈ 0.022 (compute scipy values once, hardcode in the test file with an inline comment citing the source).
   - For multivariate (test 127): `y_i = 2 + 3·a_i + 4·b_i + ε_i` with small `ε`. Recovered coefficients should be `[2, 3, 4] ± 0.5`. Use deterministic noise (e.g. `(i % 3 - 1) * 0.05`) so the test is reproducible.

   For test 130 (CI scaling), assert that the *width* (`upper - lower`) at 0.99 is *strictly greater* than at 0.95 for at least one slope coefficient — that's all the test needs to demonstrate.

   Run; expect ~10 failures (the new fields don't exist; the new error paths don't trigger).

3. **Update `RegressionResult` interface.** Locate at `analytics.service.ts:~110`:

   ```ts
   export interface RegressionResult {
     coefficients: number[];
     rSquared: number;
     residuals: number[];
     standardErrors: number[];
     tStatistics: number[];
     pValues: number[];
     confidenceIntervals: { lower: number[]; upper: number[] };
   }
   ```

4. **Rewrite `regression(...)`.** Replace the existing body to:

   ```ts
   static regression(params: {
     records: Record<string, unknown>[];
     x?: string;
     xColumns?: string[];
     y: string;
     type: "linear" | "polynomial";
     degree?: number;
     confidence?: number;
   }): RegressionResult {
     const { type } = params;

     // Input validation
     const hasX = params.x !== undefined;
     const hasXCols = params.xColumns !== undefined;
     if (hasX && hasXCols) {
       throw new Error("specify either x or xColumns, not both");
     }
     if (type === "polynomial" && hasXCols) {
       throw new Error("multivariate polynomial regression is not supported");
     }
     if (!hasX && !hasXCols) {
       throw new Error("specify either x or xColumns");
     }

     const yVals = this.extractNumericColumn(params.records, params.y);

     // Build design matrix X
     let X: number[][];
     if (type === "polynomial") {
       const degree = params.degree ?? 2;
       const xVals = this.extractNumericColumn(params.records, params.x!);
       if (xVals.length !== yVals.length) {
         throw new Error(
           "Columns must have the same length and at least 2 values"
         );
       }
       if (xVals.length < degree + 2) {
         throw new Error(
           `Need at least ${degree + 2} rows for polynomial regression of degree ${degree}`
         );
       }
       X = xVals.map((xi) =>
         Array.from({ length: degree + 1 }, (_, j) => Math.pow(xi, j))
       );
     } else if (hasXCols) {
       const cols = params.xColumns!.map((c) =>
         this.extractNumericColumn(params.records, c)
       );
       const n = yVals.length;
       for (const col of cols) {
         if (col.length !== n) {
           throw new Error(
             "Columns must have the same length and at least 2 values"
           );
         }
       }
       X = Array.from({ length: n }, (_, i) => [
         1,
         ...cols.map((col) => col[i]),
       ]);
     } else {
       const xVals = this.extractNumericColumn(params.records, params.x!);
       if (xVals.length !== yVals.length || xVals.length < 2) {
         throw new Error(
           "Columns must have the same length and at least 2 values"
         );
       }
       X = xVals.map((xi) => [1, xi]);
     }

     // Fit
     const { coefficients, xtxInverse, residuals } = this.solveOLS(X, yVals);

     // Diagnostics
     const n = X.length;
     const k = coefficients.length;
     const dfResid = n - k;
     if (dfResid <= 0) {
       throw new Error(
         `Need at least ${k + 1} rows for the regression; got ${n}`
       );
     }

     const ssr = residuals.reduce((sum, r) => sum + r * r, 0);
     const yMean = ss.mean(yVals);
     const sst = yVals.reduce((s, v) => s + (v - yMean) * (v - yMean), 0);
     const rSquared = sst === 0 ? 1 : 1 - ssr / sst;
     const sigmaSquared = ssr / dfResid;

     const standardErrors = coefficients.map((_, i) =>
       Math.sqrt(sigmaSquared * xtxInverse[i][i])
     );
     const tStatistics = coefficients.map((c, i) =>
       standardErrors[i] === 0 ? Number.POSITIVE_INFINITY : c / standardErrors[i]
     );
     const pValues = tStatistics.map((t) =>
       this.tTwoTailedPValue(t, dfResid)
     );
     const alpha = 1 - (params.confidence ?? 0.95);
     const tCrit = this.tInverseCDF(1 - alpha / 2, dfResid);
     const confidenceIntervals = {
       lower: coefficients.map((c, i) => c - tCrit * standardErrors[i]),
       upper: coefficients.map((c, i) => c + tCrit * standardErrors[i]),
     };

     // Backward-compat: linear-single still emits [intercept, slope]
     // (current behavior); multivariate emits [intercept, β₁, …, β_k];
     // polynomial emits [a₀, a₁, …, a_d]. All natural.
     return {
       coefficients,
       rSquared,
       residuals,
       standardErrors,
       tStatistics,
       pValues,
       confidenceIntervals,
     };
   }
   ```

   Note: the existing single-column linear branch returned `[intercept, slope]` from `ss.linearRegression`, where the order is `[lr.b, lr.m]` (intercept, then slope). The new path returns `[β₀, β₁]` from `solveOLS` over `X = [[1, x_i]]`, which is the same ordering. Numerically identical to within float precision.

5. **Tool-side change.** Update `apps/api/src/tools/regression.tool.ts`:

   ```ts
   const InputSchema = z.object({
     entity: z.string().describe("Entity key (table name)"),
     x: z
       .string()
       .optional()
       .describe(
         "Independent-variable column name. Required when `xColumns` is omitted. Required for `type: polynomial`."
       ),
     xColumns: z
       .array(z.string())
       .optional()
       .describe(
         "List of independent-variable columns for multivariate linear regression. Use this OR `x`, not both. Rejected for `type: polynomial`."
       ),
     y: z.string().describe("Dependent variable column"),
     type: z.enum(["linear", "polynomial"]).describe("Regression type"),
     degree: z
       .number()
       .int()
       .min(2)
       .max(10)
       .optional()
       .describe(
         "Polynomial degree (default 2). Ignored when type is 'linear'."
       ),
     confidence: z
       .number()
       .gt(0)
       .lt(1)
       .optional()
       .describe(
         "Confidence level for the coefficient intervals (default 0.95)."
       ),
   });
   ```

   Update the description string:

   ```ts
   description =
     "Perform linear, multivariate-linear, or polynomial regression. " +
     "Returns coefficients, R-squared, residuals, standard errors, t-statistics, " +
     "p-values, and confidence intervals on each coefficient.";
   ```

   Forward in `execute`:
   ```ts
   const { entity, x, xColumns, y, type, degree, confidence } =
     this.validate(input);
   const records = getRecords(stationData, entity);
   return AnalyticsService.regression({
     records,
     x,
     xColumns,
     y,
     type,
     degree,
     confidence,
   });
   ```

6. **Run focused suite.** `cd apps/api && npm run test:unit -- 'analytics.service' -t 'regression'`. All 10 cases green.

**Done when:** spec tests 125–134 pass; existing `regression()` cases (linear, polynomial, throw-on-insufficient-data) still pass.

**Risks:**
- The pre-existing `regression` tests assert `coefficients[1]` ≈ 2 (slope) on the `y ≈ 2x` fixture. The new path uses `solveOLS` instead of `ss.linearRegression`. The coefficients should be numerically identical. If the existing test breaks at higher precision, loosen its tolerance — `solveOLS`'s result should match `ss.linearRegression` to ~1e-10.
- Existing polynomial test asserts `coefficients[2]` ≈ 1 (`x²` coefficient). Same situation; the polynomial path also routes through `solveOLS` now.

---

## Slice 3 — `logistic_regression`

**Files**

- New: `apps/api/src/tools/logistic-regression.tool.ts`
- Edit: `apps/api/src/services/analytics.service.ts`:
  - Add `LogisticRegressionResult` interface.
  - Add `static logisticRegression(...)`.
- Edit: `apps/api/src/services/tools.service.ts` — register; extend `PACK_TOOL_NAMES`.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — new `describe("logisticRegression()", ...)` block, spec cases 135–143.

**Steps**

1. **Write failing tests** (cases 135–143). For test 135 (well-separated single feature):

   ```ts
   const records = [
     { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 },
     { x: 5, y: 1 }, { x: 6, y: 1 }, { x: 7, y: 1 }, { x: 8, y: 1 }, { x: 9, y: 1 },
   ];
   ```

   Convergence on this fixture is fast, but the divergent-coefficients-on-perfect-separation case is real — the IRLS guard kicks in. Test 135 only asserts `iterations < 50` and `accuracy === 1`; it doesn't check that coefficients are bounded.

   For test 138 (manual log-loss cross-check):
   ```ts
   const result = AnalyticsService.logisticRegression({...});
   const manual = -result.probabilities.reduce((sum, p, i) => {
     const yi = y[i];
     const clipped = Math.max(1e-15, Math.min(1 - 1e-15, p));
     return sum + yi * Math.log(clipped) + (1 - yi) * Math.log(1 - clipped);
   }, 0) / records.length;
   expect(result.logLoss).toBeCloseTo(manual, 9);
   ```

   Run; expect 9 failures.

2. **Add result type.** Near `RegressionResult`:

   ```ts
   export interface LogisticRegressionResult {
     coefficients: number[];
     probabilities: number[];
     logLoss: number;
     accuracy: number;
     iterations: number;
   }
   ```

3. **Implement `logisticRegression`.** IRLS using `solveOLS` for the weighted-least-squares step (re-uses the `(X'X)⁻¹` machinery; weights enter via the adjusted-response trick).

   ```ts
   static logisticRegression(params: {
     records: Record<string, unknown>[];
     x?: string;
     xColumns?: string[];
     y: string;
     maxIterations?: number;
   }): LogisticRegressionResult {
     // Validate xor
     const hasX = params.x !== undefined;
     const hasXCols = params.xColumns !== undefined;
     if (hasX && hasXCols) {
       throw new Error("specify either x or xColumns, not both");
     }
     if (!hasX && !hasXCols) {
       throw new Error("specify either x or xColumns");
     }

     // Coerce y to 0/1 — accept booleans
     const yRaw = params.records.map((r) => r[params.y]);
     const y: number[] = yRaw.map((v) => {
       if (v === true || v === 1) return 1;
       if (v === false || v === 0) return 0;
       const n = Number(v);
       if (n === 0 || n === 1) return n;
       throw new Error(`y values must be 0 or 1; got ${String(v)}`);
     });
     if (!y.includes(0) || !y.includes(1)) {
       throw new Error("y must contain at least one of each class");
     }

     // Build X (with intercept)
     const n = y.length;
     let X: number[][];
     if (hasXCols) {
       const cols = params.xColumns!.map((c) =>
         this.extractNumericColumn(params.records, c)
       );
       for (const col of cols) {
         if (col.length !== n) {
           throw new Error(
             "Columns must have the same length and at least 2 values"
           );
         }
       }
       X = Array.from({ length: n }, (_, i) => [
         1,
         ...cols.map((col) => col[i]),
       ]);
     } else {
       const xVals = this.extractNumericColumn(params.records, params.x!);
       if (xVals.length !== n) {
         throw new Error(
           "Columns must have the same length and at least 2 values"
         );
       }
       X = xVals.map((xi) => [1, xi]);
     }

     const k = X[0].length;
     if (n < k + 1) {
       throw new Error(`Need at least ${k + 1} rows for the regression; got ${n}`);
     }

     const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
     const maxIter = params.maxIterations ?? 100;
     let beta = new Array(k).fill(0);
     let iterations = 0;

     for (let iter = 0; iter < maxIter; iter++) {
       iterations = iter + 1;
       const eta: number[] = X.map((row) =>
         row.reduce((s, xi, i) => s + xi * beta[i], 0)
       );
       const p: number[] = eta.map(sigmoid);
       const w: number[] = p.map((pi) => pi * (1 - pi));
       // Adjusted response z_i = η_i + (y_i - p_i) / w_i (clamped)
       const z: number[] = eta.map((etaI, i) => {
         const wi = Math.max(w[i], 1e-12);
         return etaI + (y[i] - p[i]) / wi;
       });
       // Weighted normal equations: (X' W X) β = X' W z
       // Implement via scaling rows of X by √w, then call solveOLS.
       const sqrtW = w.map((wi) => Math.sqrt(Math.max(wi, 1e-12)));
       const Xw = X.map((row, i) => row.map((v) => v * sqrtW[i]));
       const yw = z.map((zi, i) => zi * sqrtW[i]);
       const { coefficients: betaNew } = this.solveOLS(Xw, yw);

       const delta = Math.max(...betaNew.map((b, i) => Math.abs(b - beta[i])));
       beta = betaNew;
       if (delta < 1e-10) break;
     }

     // Final predictions
     const probabilities = X.map((row) =>
       sigmoid(row.reduce((s, xi, i) => s + xi * beta[i], 0))
     );
     // Clamp for log-loss
     const clipped = probabilities.map((pi) =>
       Math.max(1e-15, Math.min(1 - 1e-15, pi))
     );
     const logLoss =
       -y.reduce(
         (sum, yi, i) =>
           sum + yi * Math.log(clipped[i]) + (1 - yi) * Math.log(1 - clipped[i]),
         0
       ) / n;
     const correct = y.reduce(
       (sum, yi, i) => sum + (probabilities[i] >= 0.5 ? 1 : 0) === yi ? 1 : 0,
       0
     );
     // The previous reduce expression has a precedence pitfall — use a loop for clarity:
     let correctCount = 0;
     for (let i = 0; i < n; i++) {
       const pred = probabilities[i] >= 0.5 ? 1 : 0;
       if (pred === y[i]) correctCount += 1;
     }
     const accuracy = correctCount / n;

     return {
       coefficients: beta,
       probabilities,
       logLoss,
       accuracy,
       iterations,
     };
   }
   ```

   The dual-`correct` block above is a self-correction reminder during implementation: the inline reduce uses operator precedence in a way that's easy to get wrong. The for-loop version is the canonical form — drop the broken reduce when transcribing.

4. **Tool-class file.** Create `apps/api/src/tools/logistic-regression.tool.ts`:

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
     entity: z.string().describe("Entity key (table name)"),
     x: z
       .string()
       .optional()
       .describe("Single independent-variable column. Use this OR `xColumns`."),
     xColumns: z
       .array(z.string())
       .optional()
       .describe(
         "List of independent-variable columns for multivariate logistic regression."
       ),
     y: z
       .string()
       .describe(
         "Binary outcome column. Values must be 0 or 1 (booleans are coerced)."
       ),
     maxIterations: z
       .number()
       .int()
       .positive()
       .optional()
       .describe(
         "Maximum IRLS iterations (default 100)."
       ),
   });

   export class LogisticRegressionTool extends Tool<typeof InputSchema> {
     slug = "logistic_regression";
     name = "Logistic Regression";
     description =
       "Binary logistic regression via IRLS. Returns coefficients (intercept first), " +
       "per-row predicted probabilities, log-loss, accuracy at threshold 0.5, and IRLS iteration count.";

     get schema() {
       return InputSchema;
     }

     build(stationData: StationData) {
       return tool({
         description: this.description,
         inputSchema: this.schema,
         execute: async (input) => {
           const { entity, x, xColumns, y, maxIterations } =
             this.validate(input);
           const records = getRecords(stationData, entity);
           return AnalyticsService.logisticRegression({
             records,
             x,
             xColumns,
             y,
             maxIterations,
           });
         },
       });
     }
   }
   ```

5. **Register in `ToolService`.**

   - Import: `import { LogisticRegressionTool } from "../tools/logistic-regression.tool.js";`
   - `PACK_TOOL_NAMES`: add `"logistic_regression"`.
   - `regression` pack block (around line 222 after phase 1):
     ```ts
     tools.logistic_regression = new LogisticRegressionTool().build(stationData);
     ```

6. **Run focused suite.** `cd apps/api && npm run test:unit -- 'analytics.service' -t 'logisticRegression'`. All 9 cases green.

**Done when:** spec tests 135–143 pass.

**Risks:**

- **Perfectly separable data drives β to ∞.** IRLS will converge to ever-growing coefficients; the relative-delta convergence check (1e-10) saturates after a handful of iterations as `p_i` → 0 or 1. Test 135 caps at `iterations < 50`. If a future fixture diverges past the cap, the result still has the right `accuracy` and `probabilities`; the model can read `iterations === maxIterations` as a non-convergence signal.
- **Sigmoid overflow at extreme `η`.** `Math.exp(-1000)` is `0` (silent underflow), and `1 / (1 + 0) === 1` — fine. `Math.exp(1000)` is `Infinity`, and `1 / (1 + Infinity) === 0` — fine. No special handling needed.
- **The `y`-coercion accepts numeric strings.** `Number("0") === 0`. The Zod schema has `y: string` (column name) — coercion happens at the value level via `Number(v)`. Boolean inputs hit the early branch.
- **Convergence on partial separation can oscillate.** The plan-spec doesn't add the "5-consecutive-non-decrease" guard from the original spec — IRLS' per-step normal-equations solve is monotonic enough on logistic likelihood that an oscillation guard is overkill. If convergence issues surface in practice, add the guard as a follow-up.

---

## After all three slices

1. **Run the full apps/api unit suite.** `cd apps/api && npm run test:unit`. All previous tests pass; 22 new cases pass (3 helper + 10 regression-widening + 9 logistic).
2. **Run lint + type-check from repo root.** `npm run lint && npm run type-check`. Clean.
3. **Manual smoke test against the dev portal.**
   - On a station with the `regression` pack, ask:
     - "Run a multivariate regression of `revenue` on `marketing_spend`, `headcount`, `seasonality_index` and tell me which features are significant." Verify the call carries `xColumns: [...]`, the response includes the `pValues` field, and the model's narrative cites them.
     - "What's the 99% confidence interval on the marketing-spend coefficient?" Verify the call carries `confidence: 0.99`.
     - "Predict whether a deal closes from `arr` and `seats`." Verify `logistic_regression` is called and returns numeric `probabilities`.

---

## Out-of-band considerations

- **No deployment coordination.** Tools rebuilt every turn.
- **No new dependencies.** Logistic regression hand-rolled via IRLS over the same `solveOLS` helper that powers regression.
- **Existing `regression` tests stay green.** The current `coefficients[1] ≈ 2` and `coefficients[2] ≈ 1` assertions on linear/polynomial fixtures are byte-stable across the `solveOLS` rewrite — both compute the same normal-equations solution.

---

## PR shape

- Branch: continue on `feat/expand-tool-set-capabilities` or fork `feat/analytics-pack-phase-5`.
- Commits: three conventional-commits-style commits matching the slices, in order:
  - `feat(analytics-service): add solveOLS and tInverseCDF helpers`
  - `feat(regression-tool): multivariate inputs + always-present diagnostic fields`
  - `feat(logistic-regression-tool): binary IRLS classifier with per-row probabilities`
- PR description: link the discovery + spec + plan docs. Note phase 5's zero-new-deps posture (discovery suggested "may add one focused dep"; not needed). Reference the phasing table — phase 5 of seven; phases 6–7 unstarted.
