# Analytics Pack Expansion — Phase 1 — Spec

**Parameterize the hardcoded defaults flagged in the discovery audit and, per D1, bundle the `correlate` method widening (Pearson + Spearman + Kendall) into the same phase.** Six tools change; no new tools are added; no new dependencies are added.

Discovery: `docs/ANALYTICS_PACK_EXPANSION.discovery.md`. Resolved decision points (D1–D6):

- **D1 (scope of phase 1):** bundled. Phase 1 ships the parameterized defaults *and* the `correlate.method` widening. Both touch the same tools-and-service file pair; bundling is one spec, one PR, one round of review.
- **D2 (multivariate regression):** out of phase 1. Phase 1 only surfaces `degree` on the existing `regression` tool. Multivariate inputs land in phase 5.
- **D3 (one `hypothesis_test` tool):** out of phase 1. Phase 4.
- **D4 (`forecast` library choice):** out of phase 1. Phase 6.
- **D5 (result-shape policy):** ratified. Existing return shapes for the six tools do not change. New behavior is gated entirely on optional input fields; tool outputs add no new fields and reshape no existing ones in phase 1. (Phases 2+ that add new fields will follow the "presence-or-absence, never reshape" rule.)
- **D6 (test fixture sourcing):** ratified. Service-layer tests assert exact numerics against textbook reference values: Wackerly/Mendenhall for stats, Fabozzi for fixed-income amortization, Hyndman/Athanasopoulos for time-series. Reference values live inline in the test file with a citation comment.

After this phase: the model can pick its own outlier threshold, standardize before clustering, choose polynomial degree, vary amortization compounding, annualize Sharpe ratio for any frequency, and select between three correlation methods — without any new tool entries appearing in the tool roster.

---

## Scope

### In scope (six tools)

1. **`detect_outliers`** — add `threshold?: number`; add `"mad"` to the method enum.
2. **`cluster`** — add `standardize?: boolean`, `seed?: number`, `maxIterations?: number`.
3. **`regression`** — surface `degree?: number` on the tool's Zod schema (already exists in the service signature; only the tool surface is widened).
4. **`amortize`** — add `compounding?: enum` and `extraPayment?: number`.
5. **`sharpe_ratio`** — replace boolean `annualize` with `periodicity?: enum`. Clean cut, no compat alias.
6. **`correlate`** — add `method?: "pearson" | "spearman" | "kendall"`.

### Out of scope

- Any new tool slug. Phase 1 widens existing tools only; `ToolService.PACK_TOOL_NAMES` is unchanged.
- Any new field on tool outputs (no `pValue`, no `tStatistic`, no `residuals`, no `confidenceIntervals`). Result shapes are byte-stable; only the inputs widen.
- Multivariate, logistic, or robust regression (phase 5).
- Hypothesis tests, aggregate / pivot tools (phase 4).
- Forecasting, decomposition, changepoint (phase 6).
- TVM / XIRR / bond math / portfolio metrics / VaR (phases 3 and 7).
- Frontend changes. The `data-table` rendering path accepts the existing tool outputs unchanged; nothing to edit in `apps/web`.
- DB / contract / SDK changes.
- Any change to `tools.service.ts:88`'s `PACK_TOOL_NAMES` set or `ALL_TOOL_PACKS`.

---

## Tool-by-tool surface

The following sections define the exact Zod schema and execute-path semantics per tool. Service-method signatures change in lockstep; the tool file forwards to the service.

### 1. `detect_outliers`

Existing schema (`apps/api/src/tools/detect-outliers.tool.ts:11-15`):

```ts
const InputSchema = z.object({
  entity: z.string(),
  column: z.string(),
  method: z.enum(["iqr", "zscore"]),
});
```

New schema:

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

Service-side semantics (`AnalyticsService.detectOutliers`):

- **IQR**: `lower = q1 - threshold * iqr`, `upper = q3 + threshold * iqr`. `threshold ?? 1.5`.
- **Z-score**: `|z| > threshold`. `threshold ?? 3`.
- **MAD**: modified z-score `0.6745 * (v - median) / mad`, flag if `|modZ| > threshold`. `threshold ?? 3.5`. The 0.6745 constant and 3.5 default are the Iglewicz/Hoaglin convention.
- If MAD is zero (no spread), return `{ outliers: [], indices: [] }` — same fall-through as the existing zero-stddev guard for z-score.

Output shape unchanged: `{ outliers: Record<string, unknown>[]; indices: number[] }`.

### 2. `cluster`

Existing schema (`apps/api/src/tools/cluster.tool.ts:11-15`):

```ts
const InputSchema = z.object({
  entity: z.string(),
  columns: z.array(z.string()),
  k: z.number().int().min(2),
});
```

New schema:

```ts
const InputSchema = z.object({
  entity: z.string().describe("Entity key (table name)"),
  columns: z.array(z.string()).describe("Numeric columns to cluster on"),
  k: z.number().int().min(2).describe("Number of clusters"),
  standardize: z
    .boolean()
    .optional()
    .describe(
      "Z-score each column (subtract mean, divide by stddev) before clustering. Default false."
    ),
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

Service-side semantics (`AnalyticsService.cluster`):

- `seed` and `maxIterations` are forwarded into the `kmeans(data, k, { seed, maxIterations })` options object. `ml-kmeans` already supports both (`node_modules/ml-kmeans/lib/kmeans.d.ts` — `seed`, `maxIterations` in `Options`).
- `standardize`: when true, compute `mean[col]` and `stddev[col]` over the input data, transform each row to `(v - mean) / stddev`, run kmeans on the transformed matrix, then **un-standardize the centroids before returning** (multiply by stddev, add mean). This keeps the returned `centroids` interpretable in the original input units. `clusters` (assignments) are unaffected by the back-transform.
- `standardize` falls through cleanly when a column has zero stddev: that column contributes 0 to every standardized row (no division by zero); the corresponding centroid component returns to the original mean on un-standardize.

Output shape unchanged: `{ clusters: number[]; centroids: number[][] }`.

### 3. `regression`

Existing schema (`apps/api/src/tools/regression.tool.ts:11-16`) is missing `degree`, even though the service signature already accepts it (`analytics.service.ts:1188-1194`). New schema:

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

Service signature unchanged. The `build(...)` body forwards `degree` through. The `min(2).max(10)` bounds prevent degree-1 polynomial (use `linear`) and degree explosions that overfit.

Output shape unchanged: `{ coefficients: number[]; rSquared: number }`.

### 4. `amortize`

Existing schema (`apps/api/src/tools/amortize.tool.ts:7-11`):

```ts
const InputSchema = z.object({
  principal: z.number(),
  annualRate: z.number(),
  periods: z.number().int(),
});
```

New schema:

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
      "Payment frequency. Default 'monthly'. Affects the periodic rate (annualRate / periodsPerYear) and the schedule cadence."
    ),
  extraPayment: z
    .number()
    .nonnegative()
    .optional()
    .describe(
      "Optional fixed extra principal payment applied each period after interest. Default 0."
    ),
});
```

Service-side semantics (`AnalyticsService.amortize`):

- **Periods-per-year map**:
  - `weekly`: 52
  - `biweekly`: 26
  - `monthly`: 12 (default)
  - `quarterly`: 4
  - `annual`: 1
- Periodic rate = `annualRate / periodsPerYear`. Replaces the hardcoded `annualRate / 12`.
- Standard amortization payment via `financial.pmt(periodicRate, periods, principal)`. (Negation handled the same as today.)
- For each period:
  - `interest = balance * periodicRate`
  - `principalPart = payment - interest + extraPayment`
  - `balance -= principalPart`
  - If `balance <= 0` after applying extra payment, clip `principalPart` so balance lands at exactly 0 and stop emitting subsequent rows. (Schedule shortens; `periods` becomes a *maximum*.)
- Output row shape unchanged: `{ period, payment, principal, interest, balance }`. When `extraPayment` is non-zero, the `payment` column is the *base* payment plus `extraPayment` so the row totals are internally consistent. Round to two decimals as today.

Default behavior (no `compounding`, no `extraPayment`) is byte-identical to current behavior — the hardcoded `/12` becomes the default branch.

### 5. `sharpe_ratio`

Existing schema (`apps/api/src/tools/sharpe-ratio.tool.ts:11-16`):

```ts
const InputSchema = z.object({
  entity: z.string(),
  valueColumn: z.string(),
  riskFreeRate: z.number().optional(),
  annualize: z.boolean().optional(),
});
```

New schema:

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

Service-side semantics (`AnalyticsService.sharpeRatio`):

- Annualization factor:
  - `daily`: √252
  - `weekly`: √52
  - `monthly`: √12
  - `quarterly`: √4 (= 2)
  - `annual`: 1 (no-op, exposed for symmetry)
  - omitted: 1 (no-op — equivalent to current `annualize: false`)
- Replaces the hardcoded `Math.sqrt(252)` block.

**This is a clean breaking change to the tool surface**, per `feedback_no_compat_aliases`. The `annualize` field is removed; callers that previously passed `annualize: true` migrate to `periodicity: "daily"`. The audit found no internal callers (the field is part of the model-facing tool schema, not internal API), so the migration is the model's prompt-text choice on the next turn — no runtime fallback.

Output shape unchanged: `{ sharpeRatio: number }`.

### 6. `correlate`

Existing schema (`apps/api/src/tools/correlate.tool.ts:11-15`):

```ts
const InputSchema = z.object({
  entity: z.string(),
  columnA: z.string(),
  columnB: z.string(),
});
```

New schema:

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

Service-side semantics (`AnalyticsService.correlate`):

- `pearson` (default): `ss.sampleCorrelation(a, b)` — existing path.
- `spearman`: `ss.sampleRankCorrelation(a, b)` — already in `simple-statistics`
  (`node_modules/simple-statistics/src/sample_rank_correlation.js`).
- `kendall`: hand-rolled τ-b (with tie correction), ~30 lines, lives as a private static method `kendallTau(a, b)` on `AnalyticsService`. Formula:

  ```
  Let n = a.length.
  Count concordant pairs (sign(a[i]-a[j]) === sign(b[i]-b[j])) for i<j.
  Count discordant pairs (opposite signs).
  Count ties in a (T_a), ties in b (T_b).
  τ_b = (concordant - discordant) / sqrt((n0 - T_a) * (n0 - T_b))
  where n0 = n*(n-1)/2.
  ```

  Reference: Kendall (1938); Wackerly/Mendenhall §15.10. The implementation walks the O(n²) pair loop directly — n is bounded by record count, which is already capped upstream by `loadStation` for the in-memory path, so quadratic on the row count is fine for phase 1.

Output shape unchanged: `{ correlation: number }`. The spec deliberately does not add a `method` field to the output — the model already knows which method it requested. (Phase 4 may add `pValue` and `tStatistic`; phase 1 does not, per "presence-or-absence, never-reshape" applied conservatively.)

---

## Test plan

All tests are service-layer assertions in `apps/api/src/__tests__/services/analytics.service.test.ts`. Tool-file changes are pure forwarding — no per-tool test additions needed. Run via `cd apps/api && npm run test:unit -- analytics.service` per `feedback_use_npm_test_scripts`.

Each new test references a textbook fixture (per D6) by inline citation comment.

### `detectOutliers()` — expand existing `describe` block

23. **Custom IQR threshold lowers detection sensitivity.** Same fixture as the existing IQR test (15-row `NUMERIC_RECORDS` + outlier at x=100). Re-run with `threshold: 3.0` (instead of 1.5 default). Assert the `100` outlier is *still* flagged but borderline points are not.
24. **Custom Z-score threshold raises detection sensitivity.** Run with `threshold: 1.5`. Assert that more than just the `100` outlier is flagged on the existing fixture.
25. **MAD method flags the same `x=100` outlier.** Same fixture, `method: "mad"`, default threshold (3.5). Assert `result.indices` contains the outlier index.
26. **MAD method honors custom threshold.** Same fixture, `method: "mad"`, `threshold: 1.5`. Assert more indices are flagged than at threshold 3.5.
27. **MAD with zero spread returns empty.** Records where every value of `x` is `5`. Assert `{ outliers: [], indices: [] }`.

### `cluster()` — expand existing `describe` block

28. **`seed` makes clustering deterministic.** Run twice on the same data with `seed: 42`. Assert `result.clusters` arrays are deep-equal between runs and `result.centroids` are deep-equal.
29. **Different `seed` values produce different initializations.** Run with `seed: 1` and `seed: 999` on a fixture engineered to have two near-equal local minima. Assert at least one of `clusters` or `centroids` differs between runs. (If determinism quirks of `ml-kmeans` make this flaky, use a 6-point fixture from Wackerly §11.x and verify the two outputs are *valid* k-means solutions for the data, even if equal — convert this to a property test rather than a strict-equality test.)
30. **`standardize: true` on un-standardized data yields the same cluster assignments as a manually-standardized-and-fit run.** Build a fixture where columns have very different scales (e.g., `a ∈ [0,1]`, `b ∈ [0,1000]`). Compare:
    - `cluster(records, ["a","b"], k=2, standardize: true)`
    - `cluster(standardized_records, ["a","b"], k=2)` (where the test pre-standardizes the records itself)
    Assert `clusters` arrays are identical.
31. **`standardize: true` returns centroids in original units.** Same fixture as test 30. Assert each centroid's component for `b` is in the original `[0, 1000]` range (not in `[-2, 2]` standardized space).
32. **`standardize: true` survives a zero-stddev column.** Column `c` is constant (every row = 7). Assert no division-by-zero error and that the centroids' `c` component is exactly 7 in every cluster.
33. **`maxIterations: 1` truncates and still returns valid results.** Assert `clusters` has the right length and `centroids` has length `k`. (Convergence is not asserted.)

### `regression()` — expand existing `describe` block

34. **`degree: 3` on a cubic dataset achieves high R².** Records: `y = x³ + small noise`, `x ∈ [-5, 5]`. Assert `degree: 3` returns 4 coefficients and `rSquared > 0.99`.
35. **`degree` defaults to 2 when omitted on `polynomial`.** Existing test 987 already covers this — preserve.
36. **`degree` is rejected outside `[2, 10]`.** This is a Zod validation — assert at the tool layer (one tool-file test) that the schema's `safeParse` rejects `degree: 1` and `degree: 11`. Either add a tiny `apps/api/src/__tests__/tools/regression.tool.test.ts` or extend an existing tool test file (audit first).

### `amortize()` — new `describe` block (no existing block in the test file)

37. **Default behavior is byte-identical to pre-change.** Fixture: principal $200,000, annualRate 0.06, periods 360. Assert: total interest, total payment, and the final-row balance match the pre-change snapshot. Compute pre-change values once via the current code path (one-shot, manual) and inline as the assertion.
38. **Quarterly compounding produces 4× fewer rows for the same nominal "year-count".** Principal $10,000, annualRate 0.06, periods 20, compounding `quarterly`. Verify schedule has 20 rows (5 years × 4 quarters), the periodic rate is `0.06 / 4 = 0.015`, and the first-row interest is `10000 * 0.015 = $150`. Reference: Fabozzi §3.4.
39. **Annual compounding has interest = principal × annualRate in row 1.** Principal $10,000, annualRate 0.06, periods 5, compounding `annual`. Assert row 1 interest is exactly $600.00.
40. **`extraPayment` shortens the schedule.** Principal $200,000, annualRate 0.06, periods 360 (monthly). Without extra: schedule has 360 rows. With `extraPayment: 500`: schedule has fewer rows; the final-row balance is exactly `0`.
41. **`extraPayment` row totals are internally consistent.** Same fixture as 40. For each row, assert `principal + interest === payment` (within 1 cent rounding) where `payment` is the row's emitted `payment` field (base + extraPayment).
42. **Zero `annualRate` produces a flat schedule.** Principal $1,000, annualRate 0, periods 10, compounding monthly. Each row has interest = 0, principal = 100, payment = 100, balances stepping down by 100.

### `sharpeRatio()` — replace existing tests for `annualize`

43. **Omitted `periodicity` returns the raw ratio.** Returns sequence with positive mean and known stddev (Hyndman §3 Table 3.1 fixture: 10 monthly returns). Assert ratio matches the closed-form `(mean - 0) / stddev` exactly.
44. **`periodicity: "daily"` multiplies by √252.** Same returns. Assert the new ratio is `raw * sqrt(252)` to within 1e-9.
45. **`periodicity: "weekly"` multiplies by √52.** Assert.
46. **`periodicity: "monthly"` multiplies by √12.** Assert.
47. **`periodicity: "quarterly"` multiplies by 2 exactly.** Assert.
48. **`periodicity: "annual"` is a no-op.** Returns the same ratio as the omitted case.
49. **Existing tests that pass `annualize: true` are migrated.** Audit `analytics.service.test.ts` for any `annualize:` keyword; rewrite each as `periodicity: "daily"`. If no such test exists, this case is a no-op.

### `correlate()` — expand existing `describe` block

50. **Spearman correlation on a perfectly monotonic non-linear relationship.** Fixture: `x = [1,2,3,4,5,6,7,8,9,10]`, `y = x.map(v => v**3)`. Pearson on this is < 1; Spearman should be exactly 1. Assert `method: "spearman"` returns `correlation === 1`.
51. **Spearman matches Pearson on a perfectly linear relationship.** Same `x`, `y = 2x + 3`. Both methods return `correlation === 1` (within 1e-9).
52. **Spearman handles ties.** `x = [1,2,2,3,4]`, `y = [10,20,20,30,40]`. Assert correlation is `1` (`sample_rank_correlation` averages tied ranks).
53. **Kendall correlation on a perfectly monotonic relationship.** `x = [1..10]`, `y = x.map(v => v**3)`. Assert `correlation === 1`.
54. **Kendall correlation on a perfectly anti-monotonic relationship.** `x = [1..10]`, `y = x.map(v => -v)`. Assert `correlation === -1`.
55. **Kendall on a known textbook fixture.** From Wackerly/Mendenhall ex. 15.10: `x = [4,7,5,6,2,3,1]`, `y = [4,5,6,7,2,3,1]`. Reference τ-b = `0.7142857...` (5/7). Assert within 1e-6.
56. **Kendall handles ties (τ-b denominator correction).** `x = [1,1,2,3,4]`, `y = [1,2,2,3,4]`. Reference computed by hand or `scipy.stats.kendalltau` and inlined as the expected value. Assert within 1e-9.
57. **Default method is Pearson.** Existing test 856 already covers this — preserve.
58. **Method choice survives the throw-on-mismatched-length guard.** `correlate({ records: [{x:1,y:2}], columnA: "x", columnB: "y", method: "spearman" })` throws with the existing "at least 2 values" message. (Validation runs before method dispatch.)

Total new cases: 35 across the six tools. All are deterministic given inline numeric fixtures; none rely on randomness once `seed` is fixed for the cluster cases.

---

## Behavior on edge cases

- **`detect_outliers` with `threshold: 0`.** Schema's `.positive()` rejects at parse time. Fail-fast with a Zod validation error.
- **`cluster` with `standardize: true` and a single-row dataset.** Existing behavior throws because k-means needs ≥ k rows; standardization computes stddev = 0 for a single row. The existing test for empty-records (test 946) covers the empty case; single-row falls through to the same kmeans-error path. No new edge case introduced.
- **`amortize` with `extraPayment > basePayment`.** First-period principal payment exceeds remaining principal; the clamp (`balance <= 0` → final row, schedule terminates) handles this. Document in tool description: "extraPayment is added to scheduled principal each period, and the schedule may terminate before `periods` if principal pays off."
- **`amortize` with `compounding: "biweekly"` and a non-multiple `periods`.** `periods` is treated literally — 26 biweekly periods is one calendar year. No date arithmetic; schedule rows are indexed `1..periods`. Calendar dates are the caller's job.
- **`sharpe_ratio` with all-equal returns.** Stddev is 0; existing zero-stddev guard returns `{ sharpeRatio: 0 }`. Periodicity multiplier on 0 is still 0. Unchanged.
- **`correlate` with `method: "kendall"` and identical sequences.** All pairs concordant, no ties; τ-b = 1. Direct.
- **`correlate` with `method: "kendall"` and *fully* tied sequences.** Both ties-corrections collapse to the same denominator factor as the numerator's missing pair count. The hand-rolled implementation must guard against `0/0`; in that case return `correlation: 0` (no meaningful association), matching SciPy convention.

---

## Result-shape policy ratification (D5)

The phase-1 changes preserve byte-stable output shapes. Future phases adopt the same rule:

1. **No existing field is removed or renamed.** `correlation`, `sharpeRatio`, `coefficients`, `rSquared`, `outliers`, `indices`, `clusters`, `centroids`, and the amortization row shape are stable.
2. **New optional fields, when added in later phases, are present-or-absent based on input flags, not on data values.** A field that is present sometimes and missing other times based on row content is forbidden.
3. **`null` is reserved for values that exist but are unknown.** Absent fields are simply absent from the JSON object.

This keeps `data-table` rendering and pinning behavior stable across optional inputs and across phases.

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Removing the `annualize` field on `sharpe_ratio` regresses any portal session in flight that was about to call the tool with the old shape. | Tool schemas are not persisted — they are rebuilt on every turn from the current code. There is no "in flight" call that survives a deploy. The model picks from the schema it was just shown. Risk is theoretical, not real. |
| Hand-rolled Kendall τ-b deviates from a reference implementation under tie-heavy data. | Tests 55 and 56 use textbook and SciPy reference values respectively. Implementation passes both before merge. |
| Hardcoded-default removal silently changes results. | Each parameterized field's `.default(...)` keeps the current behavior. Test 37 explicitly pins amortization byte-stability against the pre-change baseline. |
| `cluster` standardization back-transform is computed wrong (centroids returned in mixed-space). | Test 31 asserts centroids land in original-data range. Test 30 asserts cluster assignments match a manual standardize-then-fit baseline. |
| The `degree` Zod bound (`min(2).max(10)`) is too restrictive for a legitimate use case. | Phase 1 picks safe limits. If a higher-degree fit is ever requested the bound widens trivially in a follow-up patch — Zod schemas are easy to relax. |
| The Kendall O(n²) loop is slow on large in-memory record sets. | The in-memory path is already bounded by `loadStation`'s record cap (verified during the audit). For row counts in the thousands the pair loop is sub-second. If a future phase exposes correlate over disk-backed datasets, that path can switch to the O(n log n) merge-sort variant. |
| Test 29 (different seeds) is flaky if `ml-kmeans`'s seeding is per-run-only. | Convert to a property test (both runs return valid k-means solutions) per the explicit fallback in the test plan. |

**Rollback** is a single-commit revert of the tool, service, and test changes. Because output shapes are unchanged, downstream renderers and pinned results are unaffected. No DB migration to undo.

---

## Acceptance criteria

- [ ] All 35 new test cases pass; all pre-existing cases in `analytics.service.test.ts` pass without modification, except the existing `annualize` cases migrated to `periodicity` per test 49.
- [ ] `cd apps/api && npm run test:unit -- analytics.service` is green.
- [ ] `cd apps/api && npm run test:unit` (full suite) is green.
- [ ] `npm run lint && npm run type-check` from repo root are clean.
- [ ] No new entries in `ToolService.PACK_TOOL_NAMES` (`tools.service.ts:88`) and no new entries in `ALL_TOOL_PACKS` (`tools.service.ts:67`).
- [ ] No frontend, DB, contract, or SDK file is touched.
- [ ] Manual spot-check via the dev portal: a station with `statistics` + `regression` + `financial` packs enabled responds correctly to "compute Spearman correlation between X and Y", "cluster these points after standardizing", "amortize this loan with quarterly compounding and a $200 extra payment". Each call hits the new code path; results render in the existing `data-table` block.

---

## Files touched

- Edit: `apps/api/src/tools/detect-outliers.tool.ts` — add `mad` to enum, add `threshold` field.
- Edit: `apps/api/src/tools/cluster.tool.ts` — add `standardize`, `seed`, `maxIterations` fields.
- Edit: `apps/api/src/tools/regression.tool.ts` — surface `degree` field.
- Edit: `apps/api/src/tools/amortize.tool.ts` — add `compounding`, `extraPayment` fields.
- Edit: `apps/api/src/tools/sharpe-ratio.tool.ts` — replace `annualize` with `periodicity`.
- Edit: `apps/api/src/tools/correlate.tool.ts` — add `method` field.
- Edit: `apps/api/src/services/analytics.service.ts`:
  - `detectOutliers`: thread `threshold`, add `mad` branch.
  - `cluster`: thread `seed`, `maxIterations`; implement `standardize` + un-standardize-centroids.
  - `regression`: no signature change; only the tool surface widens.
  - `amortize`: thread `compounding`, `extraPayment`; remove hardcoded `/12`.
  - `sharpeRatio`: thread `periodicity`; remove hardcoded `Math.sqrt(252)`.
  - `correlate`: branch on `method`; add private `kendallTau` static.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — 35 new cases per the test plan; migrate `annualize:` usages to `periodicity:`.
- Edit (possibly, for test 36): `apps/api/src/__tests__/tools/regression.tool.test.ts` — single Zod-validation case for `degree` bounds. Audit first; if a tool-test directory does not yet exist, the test goes inline alongside the service tests.

No DB migration. No contract change. No frontend change. No SDK change. No new dependency.
