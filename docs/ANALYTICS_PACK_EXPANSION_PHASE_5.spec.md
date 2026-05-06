# Analytics Pack Expansion — Phase 5 — Spec

**Regression diagnostics + multivariate inputs + a new `logistic_regression` tool.** First substantive change to the regression pack.

Discovery: `docs/ANALYTICS_PACK_EXPANSION.discovery.md`. Prior phases: phase 1 `0417513`, phase 2 `4fd2548`, Donchian `874fefe`, phase 3 `4165899`, phase 4 `0b0960b`.

The phase-5 wedge from the discovery's phasing table:

> **5. Regression diagnostics + multivariate** | Multivariate inputs, residuals, t-stats, p-values, CIs on `regression`; `logistic_regression` | First substantive change to the regression pack. May add one focused dep.

After this phase:

1. The existing **`regression`** tool grows from "fit a line, see slope" to a real OLS surface — multivariate inputs (`xColumns: string[]`) plus per-call residuals, standard errors, t-stats, p-values, and confidence intervals on each coefficient.
2. A new **`logistic_regression`** tool ships in the regression pack — binary-outcome classifier via IRLS, returning coefficients + per-row probabilities + log-loss + accuracy.

**Discovery delta.** The discovery noted "may add one focused dep" — phase 5 keeps the zero-new-deps posture established across phases 1–4. The matrix-inversion machinery (Gauss-Jordan over the normal-equations system X'X) is generalized from the existing private `polynomialFit` helper; logistic regression hand-rolls IRLS using the same matrix routines. About 100 LOC of standard textbook math, no new packages.

---

## Scope

### In scope

1. **`regression` widening:**
   - Add `xColumns?: string[]` for multivariate. XOR with the existing `x: string`.
   - Add `confidence?: number` for the CI level (default 0.95, accepts `(0, 1)`).
   - Output gains five new fields, **always present** for `type: "linear"` (single or multivariate). Per D5, the fields are present-or-absent based on the *type* of regression, not on data values:
     - `residuals: number[]` — y_i − ŷ_i, in input order.
     - `standardErrors: number[]` — same length as `coefficients`.
     - `tStatistics: number[]`
     - `pValues: number[]` — two-tailed.
     - `confidenceIntervals: { lower: number[]; upper: number[] }` — at the supplied (or default 0.95) level.
   - For `type: "polynomial"`, all five new fields are also present (interpreted over the [a₀, a₁, …, a_d] coefficient vector). The polynomial path uses the same diagnostics machinery.

2. **`logistic_regression` (new tool, regression pack):**
   - Inputs: `entity, y` (binary 0/1 column), and either `x` (single column) or `xColumns` (multivariate).
   - IRLS optimization with a 100-iteration cap, 1e-10 convergence tolerance.
   - Output: `{ coefficients: number[], probabilities: number[], logLoss: number, accuracy: number, iterations: number }`.

### Out of scope

- Welch's two-sample t-test. Phase 4 already deferred; not part of phase 5.
- Robust regression (Huber, RANSAC, weighted least squares with caller-supplied weights). Future phase.
- Ridge / Lasso regularization. Future phase.
- Multiclass logistic regression. Phase 5 is binary only.
- Cross-validation, train/test split, out-of-sample prediction. Future phase.
- ROC curve / AUC. Future phase.
- Wald z-stats and p-values for logistic coefficients. Phase 5 ships logistic without coefficient inference; revisit when a use case surfaces.
- F-test for joint significance / nested-model tests. Future phase.
- Polynomial **and** multivariate (i.e., interactions). When `type: "polynomial"`, `xColumns` is rejected; only single `x` is supported.
- Frontend, DB, contract, SDK changes.

---

## Tool-by-tool surface

### 1. `regression` (widened)

Existing schema (`apps/api/src/tools/regression.tool.ts`, after phase 1):

```ts
const InputSchema = z.object({
  entity: z.string(),
  x: z.string(),
  y: z.string(),
  type: z.enum(["linear", "polynomial"]),
  degree: z.number().int().min(2).max(10).optional(),
});
```

New schema:

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

Service-side semantics (`AnalyticsService.regression`):

- **Branch dispatch** is unchanged in spirit but tightened:
  - If `type === "linear"`: choose between single-column (`x`) and multivariate (`xColumns`). Throw if both supplied or neither.
  - If `type === "polynomial"`: require `x`; throw if `xColumns` is supplied.
- **Single-column linear**: design matrix is `[1, x_i]` per row (intercept + slope). Same coefficients as today (`[intercept, slope]`).
- **Multivariate linear**: design matrix is `[1, x_{i,1}, x_{i,2}, …, x_{i,k}]`. Coefficients are `[intercept, β₁, β₂, …, β_k]`, in the order of `xColumns`.
- **Polynomial**: unchanged structurally — design matrix is `[1, x_i, x_i², …, x_i^d]`. Coefficients in `[a₀, a₁, …, a_d]` order. (Same as today.)

After fitting, **always** compute and return diagnostics:

```
ŷ = X β̂
residuals = y − ŷ
SSR = Σ residuals_i²
n = number of rows
p = number of coefficients
df_resid = n − p
σ² = SSR / df_resid                  (residual variance)
covariance = σ² · (X'X)⁻¹            (k×k matrix)
SE_i = √diagonal(covariance)_i
t_i = β̂_i / SE_i
p_i = 2 · (1 − tCDF(|t_i|, df_resid))
t_crit = tInverseCDF(1 − α/2, df_resid)   (where α = 1 − confidence)
CI_i = [β̂_i − t_crit · SE_i, β̂_i + t_crit · SE_i]
```

**Pre-validation:**
- Multivariate requires `n > k + 1` (more rows than parameters). Throw with a clear error otherwise.
- All `xColumns` (or `x`) must be parseable as numbers — re-uses `extractNumericColumn`.
- `confidence` defaults to 0.95.

`tInverseCDF(p, df)` is a new private static — bisection on the existing `tCDF`. ~20 LOC. Tolerance 1e-10, 100-iteration cap. Initial bracket `[-50, 50]` wide enough for any reasonable (df ≥ 2, p ∈ (0, 1)) input.

**Result-shape policy (D5):** the five new fields are *always present* for both linear and polynomial calls. They are not gated on a `diagnostics: boolean` flag — diagnostics are cheap, the model can ignore unused fields. Existing tests check field-by-field, not full key-equality, so byte-stability holds.

### 2. `logistic_regression` (new tool)

```ts
const InputSchema = z.object({
  entity: z.string().describe("Entity key (table name)"),
  x: z
    .string()
    .optional()
    .describe(
      "Single independent-variable column. Use this OR `xColumns`."
    ),
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
      "Maximum IRLS iterations (default 100). Increase if the model logs a non-convergence warning on highly separable data."
    ),
});
```

Service-side semantics (`AnalyticsService.logisticRegression`):

```
X = design matrix [1, x_{i,1}, ..., x_{i,k}]
y = binary vector (0 or 1)
β = zeros(k + 1)
for iter in 0..maxIterations:
  η = X · β
  p = sigmoid(η)
  W = diag(p * (1 - p))
  z = η + W⁻¹(y - p)               // adjusted-response trick
  β_new = (X' W X)⁻¹ X' W z         // weighted normal equations
  if ||β_new - β||∞ < 1e-10: break
  β = β_new

probabilities = sigmoid(X · β)
logLoss = -mean(y_i · log(p_i) + (1 - y_i) · log(1 - p_i))
predictions = probabilities ≥ 0.5
accuracy = mean(predictions == y)
```

Output: `{ coefficients, probabilities, logLoss, accuracy, iterations }`.

**Pre-validation:**
- `y` values must be in `{0, 1}` (boolean → 0/1 coercion is allowed). Throw a clear error on out-of-range values.
- `n > k + 1` (more rows than parameters).
- At least one row of each class (`y` cannot be all 0 or all 1).
- IRLS clips `p_i` to `[1e-15, 1 - 1e-15]` before computing log-loss to avoid `Infinity`.
- If `||β_new - β||` does not decrease for 5 consecutive iterations, throw a non-convergence error.

The output's `iterations` field is informative — the model can decide whether to ask the user for a higher `maxIterations`.

### Result-shape policy reminder (D5)

- `regression`: existing `coefficients` and `rSquared` keep their meaning; five new diagnostic fields are always present for both linear and polynomial calls. Field presence is determined by the call's `type`, not by data values. Result is JSON-stable across re-runs of the same input.
- `logistic_regression`: flat object with five always-present numeric scalars/arrays. No gated fields.

---

## Pack registration

`apps/api/src/services/tools.service.ts`:

1. Extend `PACK_TOOL_NAMES` with `"logistic_regression"`.
2. Inside `buildAnalyticsTools` under the `regression` pack block, append:
   ```ts
   tools.logistic_regression = new LogisticRegressionTool().build(stationData);
   ```

`regression` itself is already registered in the `regression` pack from earlier phases — no change beyond the Zod schema and service body.

---

## Test plan

All tests are service-layer assertions in `apps/api/src/__tests__/services/analytics.service.test.ts`. Run via `cd apps/api && npm run test:unit -- analytics.service`.

### `regression()` — extend existing block

125. **Linear-single returns the five new diagnostic fields.** Same fixture as the existing linear regression test (`y ≈ 2x`). Assert all five new fields exist with the right shapes:
     - `residuals.length === records.length`
     - `standardErrors.length === 2`
     - `tStatistics.length === 2`
     - `pValues.length === 2`
     - `confidenceIntervals.lower.length === 2 && upper.length === 2`
     - For all i, `lower[i] < coefficients[i] < upper[i]`.

126. **Linear-single t-stats match scipy on a textbook fixture.** Reference: scipy.stats.linregress on `x = [1..10]`, `y = [2.5, 3.1, 4.0, ...]` (define inline, compute scipy's slope/intercept/SE/t-stat against scipy.stats.linregress separately and inline). Tolerance 1e-3 on slope SE and t-stat.

127. **Multivariate fit on `xColumns: [a, b]` returns 3 coefficients (intercept + 2 slopes) and high R² for linear data.** Fixture: 20 rows where `y = 2 + 3a + 4b + small noise`. Assert `coefficients.length === 3`, recovered slopes ≈ `[2, 3, 4]` within 1e-1, `rSquared > 0.99`.

128. **Multivariate residuals sum to ≈ 0 (mean-zero by construction).** Same fixture. Assert `|sum(residuals)| < 1e-9`.

129. **Multivariate p-values for the two slopes are tiny when both are real signals.** Same fixture. Assert `pValues[1] < 0.001` and `pValues[2] < 0.001`. Intercept p-value is allowed to be anything.

130. **Multivariate confidence intervals span `coefficients` and respect `confidence`.** Same fixture. Assert `lower[i] ≤ coefficients[i] ≤ upper[i]` for all i. Re-run with `confidence: 0.99`; assert the 0.99 CI is wider than the 0.95 CI for at least the slopes.

131. **`xColumns` and `x` together is rejected.** Assert throws `/specify either x or xColumns, not both/`.

132. **`xColumns` with `type: "polynomial"` is rejected.** Throws `/multivariate polynomial regression is not supported/`.

133. **`n <= p` is rejected.** Linear, 1 row, 1 column. Throws `/at least.*rows for the regression/`.

134. **Polynomial degree 2 result has 5 diagnostic fields.** Existing polynomial-degree-2 test fixture. Assert the five new fields exist alongside the existing `coefficients` and `rSquared`.

### `logisticRegression()` — new `describe` block

135. **Well-separated single-feature fixture: classifier converges, 100% accuracy.** Fixture: `x ∈ [0..9]` mapped to `y = x >= 5 ? 1 : 0` (10 rows). Assert `accuracy === 1`, `iterations < 50`, `probabilities` for `x < 5` are all < 0.5 and for `x ≥ 5` are all ≥ 0.5.

136. **Multivariate logistic on a 2-feature linear separator.** Fixture: 20 rows, `y = (x1 + x2 > 5) ? 1 : 0` with both features in `[0, 5]`. Assert `coefficients.length === 3`, `accuracy >= 0.95`, `logLoss < 0.5`.

137. **Coefficient signs match feature direction.** Same single-feature fixture. Assert `coefficients[1] > 0` (slope of `x` is positive when y increases with x).

138. **Log-loss matches the manual calculation on the converged probabilities.** Run the well-separated fixture; recompute log-loss from `probabilities` and `y` inline. Assert match within 1e-9.

139. **All-positive `y` is rejected.** Fixture: `y = [1, 1, 1, 1, 1]`. Throws `/y must contain at least one of each class/`.

140. **All-negative `y` is rejected.** Mirror.

141. **Out-of-range `y` is rejected at the service.** Fixture: `y = [0, 1, 2]`. Throws `/y values must be 0 or 1/`.

142. **Boolean `y` is coerced.** Fixture: `y = [false, true, false, true, false, true, false, true]`, `x = [0..7]`. Assert no throw; `accuracy >= 0.5`.

143. **`maxIterations` cap is honored.** Pass `maxIterations: 1` on a non-trivial fixture. Assert `iterations === 1`. (No throw — IRLS just stops; the result may be inaccurate, that's the caller's problem.)

### Helper tests for `tInverseCDF` (private)

144. **`tInverseCDF(0.5, df) === 0` for any df.** Symmetry check.
145. **`tInverseCDF(0.975, 10)` ≈ 2.228 (scipy reference).** Tolerance 1e-3.
146. **`tInverseCDF(0.95, ∞)` ≈ 1.6449 (standard-normal limit).** Use `df = 1000`. Tolerance 1e-2.

Total new cases: 19 across `regression` + `logistic_regression`, plus 3 helper tests. **22 total.**

---

## Behavior on edge cases

- **Multivariate with collinear columns.** `(X'X)` is singular; Gauss-Jordan will divide by ~zero. Throw a clear error: `/design matrix is singular (collinear columns?)/`.
- **`confidence: 0.5`.** Valid input; CI half-width ≈ 0.674 · SE (interquartile-style band). The model can ask for unusual levels; the spec doesn't restrict beyond `(0, 1)`.
- **Logistic on perfectly-separable data.** IRLS coefficients diverge (β grows unboundedly) until either the convergence-tolerance check passes (because successive deltas shrink in relative terms) or `maxIterations` cap fires. Probabilities saturate to 0 or 1; log-loss goes to 0; accuracy is 1.0. The non-convergence guard (5 consecutive non-decreases) catches divergent oscillation.
- **Logistic with 100% one class.** Pre-validation throws.
- **`tInverseCDF(0, df)` or `(1, df)`.** Asymptotic to ±∞. Bisection won't converge inside `[-50, 50]`. Clamp inputs: if `p ≤ 1e-15` return `-50`; if `p ≥ 1 - 1e-15` return `50`. Document the clamp.

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Multivariate matrix inversion is numerically unstable on near-collinear features. | Throw a clear `singular matrix` error rather than returning garbage. Tests 131–133 don't exercise this path; if a downstream user hits it, the error names the cause. |
| Adding 5 always-present diagnostic fields to `regression` output increases payload size on every call. | The fields are small. On 100 rows, an extra ~kB of JSON. Trivial; matches the project's pattern of returning rich results for the data-table renderer to display. |
| IRLS convergence on adversarial inputs. | 100-iteration cap with a clear non-convergence error. Caller can supply a higher `maxIterations` or accept the result so far. |
| `tInverseCDF` bisection slow at extreme α. | 100-iteration cap on bisection over `[-50, 50]`; clamp at the bounds for tail cases. ~50 iterations to reach 1e-10 in the typical case. |
| Logistic regression result fields differ from the existing `regression` shape. | Intentional — they're different operations (real-valued vs. binary). Spec documents both; tool descriptions list each output's keys. |
| The model picks `regression` for binary outcomes (treating it as a probability). | `regression` description doesn't change to discourage this; rely on the model's training. If empirical evidence shows it picking wrong, tighten the description as a follow-up. |
| Polynomial regression's diagnostic fields are over [a₀, …, a_d] which is unusual to interpret. | Documented in the spec. The standard interpretation is the same — a t-stat for the leading coefficient `a_d` answers "does the d-th term contribute meaningfully?" — but it is admittedly an unusual report. The fields are still informative and cheap to compute. |

**Rollback** is a single-commit revert. No DB / contract / SDK / frontend touch.

---

## Acceptance criteria

- [ ] All 22 new test cases pass; pre-existing cases pass without modification.
- [ ] `cd apps/api && npm run test:unit -- analytics.service` is green.
- [ ] `cd apps/api && npm run test:unit` (full suite) is green.
- [ ] `npm run lint && npm run type-check` from repo root are clean.
- [ ] One new entry in `ToolService.PACK_TOOL_NAMES` (`"logistic_regression"`); one new tool registration under the `regression` pack.
- [ ] No frontend, DB, contract, or SDK file is touched.
- [ ] Manual spot-check via the dev portal: a station with the `regression` pack enabled responds correctly to:
  - "Run a multivariate regression of `revenue` on `marketing_spend`, `headcount`, `seasonality_index`." → `regression` with `xColumns: [...]`; result renders with diagnostics columns.
  - "Predict whether a deal closes from `arr` and `seats`." → `logistic_regression` returns probabilities in `[0, 1]`.

---

## Files touched

- Edit: `apps/api/src/tools/regression.tool.ts` — extend `InputSchema` with `xColumns`, `confidence`; widen forwarded args.
- New: `apps/api/src/tools/logistic-regression.tool.ts`
- Edit: `apps/api/src/services/analytics.service.ts`:
  - Generalize `regression` to handle multivariate; always return diagnostic fields. Refactor `polynomialFit` into a new `solveOLS(designMatrix, y)` returning both coefficients and the inverted (X'X)⁻¹ matrix needed for SE.
  - Add `static logisticRegression(...)`.
  - Add private `tInverseCDF(p, df)` (bisection on `tCDF`).
  - Update `RegressionResult` interface with the five new fields.
  - Add `LogisticRegressionResult` interface.
- Edit: `apps/api/src/services/tools.service.ts` — register `logistic_regression`; extend `PACK_TOOL_NAMES`.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — 22 new test cases.

No DB migration. No contract change. No frontend change. No SDK change. No new dependency.
