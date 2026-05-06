# Analytics Pack Expansion — Phase 4 — Spec

**Inferential statistics + group-by escape hatch: two new tools — `hypothesis_test` and `aggregate`.**

Discovery: `docs/ANALYTICS_PACK_EXPANSION.discovery.md`. Prior phases: phase 1 `0417513`, phase 2 `4fd2548`, Donchian `874fefe`, phase 3 `4165899`.

The phase-4 wedge from the discovery's phasing table:

> **4. Statistics inference** | `hypothesis_test`, `aggregate` | Adds inferential capability + the Arquero escape hatch.

Two new tools enter the **`statistics` pack**:

1. **`hypothesis_test`** — single tool with a `test` enum dispatching across one-sample / two-sample / paired t-tests, Mann-Whitney U, and the chi-squared test (general). Returns `{ statistic, pValue, df? }`.
2. **`aggregate`** — group-by + reducer surface backed by Arquero (already imported, already in scope). Generic primitive that sidesteps the long tail of one-off `count_by`/`sum_by`/`pivot` tools.

---

## Discovery delta

The discovery's claim that the seven proposed hypothesis tests "all exist in `simple-statistics`" was loose. Reconnaissance against the installed package's `.d.ts` files:

| Test | Status in `simple-statistics` |
|---|---|
| `tTest(x, μ₀)` | Present — returns the t-statistic only (no p-value, no df) |
| `tTestTwoSample(x, y, diff?)` | Present — returns t only (no p-value, no df) |
| `wilcoxonRankSum(x, y)` | Present — returns the rank-sum statistic only |
| `chiSquaredGoodnessOfFit` | Present — parametric goodness-of-fit against a `Function` distribution; returns a *boolean* (rejects/doesn't reject). Not a general χ² test. |
| Paired t-test | **Absent** |
| KS two-sample | **Absent** |
| Wilcoxon signed-rank | **Absent** |
| Student-t CDF | **Absent** |
| Chi-squared CDF | **Absent** |
| Mann-Whitney U normal-approx | **Absent** |

To deliver real `pValue` outputs, phase 4 introduces two private numerical-methods helpers on `AnalyticsService`:

- `regularizedIncompleteBeta(x, a, b)` — used to compute Student's t CDF.
- `regularizedIncompleteGamma(s, x)` — used to compute the chi-squared CDF.

Both are well-known closed-form approximations (Lentz continued fraction for beta; series-then-continued-fraction for gamma) — about 60 LOC total. They live alongside the existing `polynomialFit` / `kendallTau` private helpers; no new module, no new dependency. The normal CDF (`cumulativeStdNormalProbability`) is already in `simple-statistics`.

### Tests in scope for phase 4

Phase 4 ships these five tests inside `hypothesis_test`:

- `t_test_one_sample` — t-stat via `simple-statistics` `tTest`; df = n - 1; p-value via the new t-CDF helper.
- `t_test_two_sample` — t-stat via `tTestTwoSample`; pooled-variance Welch is *not* used (Student's t with equal-variance assumption matches `simple-statistics`'s implementation); df derived inline.
- `t_test_paired` — hand-rolled differences then a one-sample t against 0.
- `mann_whitney` — U-statistic via the rank-sum from `wilcoxonRankSum`, then z-approximation (n₁n₂/2 mean, √(n₁n₂(n₁+n₂+1)/12) stddev), then two-tailed normal p-value.
- `chi_squared` — general χ² statistic over `observed` and `expected` arrays; df defaults to `observed.length - 1` (caller may override for χ² of independence); p-value via the new χ²-CDF helper.

### Tests deferred (out of phase 4)

- `ks_two_sample` (Kolmogorov–Smirnov two-sample) — needs the KS distribution series; ~30 LOC. Promote to a phase 4b or a separate spec when demand surfaces.
- `wilcoxon_signed_rank` (paired non-parametric) — `simple-statistics` does not export it; needs hand-rolling. Same disposition.

The deferral is named explicitly in the spec so future planners aren't surprised. The `test` enum is a Zod literal — adding entries later is non-breaking.

---

## Scope

### In scope (two new tools)

1. **`hypothesis_test`** — five test branches above. Each returns `{ statistic: number, pValue: number, df?: number }` shaped per result-shape policy D5.
2. **`aggregate`** — group-by + reducer, Arquero-backed.

### Out of scope

- KS two-sample, Wilcoxon signed-rank — listed above, deferred.
- Welch's t-test (unequal variance). The `simple-statistics` `tTestTwoSample` uses pooled variance; Welch is a follow-up.
- One-sided p-values. Phase 4 returns two-tailed p-values for t-tests and Mann-Whitney; one-sided is a `tail: "two" | "less" | "greater"` field that lands in a follow-up.
- Confidence intervals. Reported separately from p-values; the test outputs stay narrow in phase 4.
- ANOVA / multi-group tests. Phase 5 (regression diagnostics will add F-tests).
- Multiple-comparison corrections (Bonferroni, BH). Out of scope.
- Pivot tables (long → wide). The `aggregate` tool is grouped *long* output; pivoting to wide is a follow-up if needed.
- Frontend changes. Both tools render through the existing `data-table` block.
- DB / contract / SDK changes.

---

## Tool-by-tool surface

### 1. `hypothesis_test`

```ts
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
  entity: z
    .string()
    .optional()
    .describe(
      "Entity (table) to read columns from. Required for tests sourcing data from columns; omit for tests where you supply observed/expected arrays directly."
    ),
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
      "Hypothesized population mean. Used by t_test_one_sample (default 0)."
    ),
  observed: z
    .array(z.number().nonnegative())
    .optional()
    .describe(
      "Observed counts for chi_squared. Use this OR set entity+columnA to a column of observed counts."
    ),
  expected: z
    .array(z.number().positive())
    .optional()
    .describe(
      "Expected counts for chi_squared. Same length as `observed`. Each must be > 0."
    ),
  df: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Degrees of freedom for chi_squared. Default is `observed.length - 1`. Override when testing independence in an r×c table (df = (r-1)(c-1))."
    ),
});
```

Output shape: `{ statistic: number, pValue: number, df?: number }`. The `df` field is present for t-tests and chi-squared; absent for `mann_whitney` (which reports a z statistic from the normal approximation, not a t-distribution result). Per D5 result-shape policy.

Service-side semantics (`AnalyticsService.hypothesisTest`):

```
switch (test) {
  case "t_test_one_sample": {
    require entity + columnA. mu defaults to 0.
    const x = numeric column
    const t = ss.tTest(x, mu)
    const df = x.length - 1
    return { statistic: t, pValue: tTwoTailedPValue(t, df), df }
  }
  case "t_test_two_sample": {
    require entity + columnA + columnB.
    const x = numeric columnA, y = numeric columnB
    const t = ss.tTestTwoSample(x, y, 0)
    if t === null → throw "tTestTwoSample returned null (degenerate inputs)"
    // Pooled-variance df: nx + ny - 2
    const df = x.length + y.length - 2
    return { statistic: t, pValue: tTwoTailedPValue(t, df), df }
  }
  case "t_test_paired": {
    require entity + columnA + columnB. Same length.
    const diffs = columnA[i] - columnB[i]
    const t = ss.tTest(diffs, 0)
    const df = diffs.length - 1
    return { statistic: t, pValue: tTwoTailedPValue(t, df), df }
  }
  case "mann_whitney": {
    require entity + columnA + columnB.
    const W = ss.wilcoxonRankSum(x, y)  // rank-sum of x
    const nx = x.length, ny = y.length
    const U = W - nx * (nx + 1) / 2
    const meanU = nx * ny / 2
    const sdU = Math.sqrt(nx * ny * (nx + ny + 1) / 12)
    const z = (U - meanU) / sdU
    const p = 2 * (1 - ss.cumulativeStdNormalProbability(Math.abs(z)))
    return { statistic: z, pValue: p }   // no df
  }
  case "chi_squared": {
    require observed + expected (arrays). df defaults to observed.length - 1.
    const stat = sum_i (observed_i - expected_i)^2 / expected_i
    const p = 1 - chiSquaredCDF(stat, df)
    return { statistic: stat, pValue: p, df }
  }
}
```

Helpers added as private statics on `AnalyticsService`:

```
tTwoTailedPValue(t, df) = 2 * (1 - tCDF(|t|, df))

tCDF(t, df):
  if t >= 0:
    1 - 0.5 * regularizedIncompleteBeta(df / (df + t*t), df/2, 0.5)
  else:
    0.5 * regularizedIncompleteBeta(df / (df + t*t), df/2, 0.5)

chiSquaredCDF(x, k):
  regularizedIncompleteGamma(k/2, x/2)
```

Both `regularizedIncompleteBeta` and `regularizedIncompleteGamma` are textbook closed-forms. Inline implementations (Numerical Recipes §6.2 / §6.4 conventions; ~30 LOC each, with `1e-12` tolerance and 200-iteration cap).

**Required-input validation** mirrors phase 3's `tvm` pattern: a `requiredFor` map is keyed on `test` and lists which `params[k]` must be defined. Missing inputs throw `Missing input for test="...": <fields>`.

### 2. `aggregate`

```ts
const InputSchema = z.object({
  entity: z.string().describe("Entity (table) to aggregate."),
  groupBy: z
    .array(z.string())
    .describe(
      "Columns to group by. Pass an empty array to aggregate over the whole table."
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
            "Aggregation operation. 'count' tallies rows in each group; the others reduce the named numeric column."
          ),
        as: z
          .string()
          .optional()
          .describe(
            "Alias for the result column. Defaults to '<op>_<column>' or 'count' for count-without-column."
          ),
      })
    )
    .min(1)
    .describe("One or more aggregations to compute per group."),
});
```

Output shape: `{ rows: Record<string, unknown>[] }`. Each row is one group. Columns are the `groupBy` columns followed by each metric's resolved alias.

Service-side semantics (`AnalyticsService.aggregate`):

```
const dt = aq.from(records)
const grouped = groupBy.length === 0 ? dt : dt.groupby(...groupBy)
const rollupArgs: Record<string, ...> = {}
for each metric:
  alias = metric.as ?? (column ? `${op}_${column}` : "count")
  switch (op) {
    case "count":  rollupArgs[alias] = aq.op.count();
    case "sum":    rollupArgs[alias] = aq.op.sum(column);
    case "mean":   rollupArgs[alias] = aq.op.mean(column);
    case "median": rollupArgs[alias] = aq.op.median(column);
    case "min":    rollupArgs[alias] = aq.op.min(column);
    case "max":    rollupArgs[alias] = aq.op.max(column);
    case "stddev": rollupArgs[alias] = aq.op.stdev(column);   // n-1 divisor (Arquero default)
    case "p25":    rollupArgs[alias] = aq.op.quantile(column, 0.25);
    case "p75":    rollupArgs[alias] = aq.op.quantile(column, 0.75);
  }
  // require column when op !== "count"
const out = grouped.rollup(rollupArgs)
return { rows: out.objects() }
```

`aq.op.stdev` matches Arquero's documented default (sample standard deviation, n-1 divisor) — consistent with the project's earlier choice in `cluster.standardize` (which uses `simple-statistics`'s `standardDeviation`, population /n; the inconsistency between `aggregate` and `cluster` reflects each library's own default and is documented in the tool description rather than papered over).

**Required-input validation**: when any metric has `op !== "count"`, the metric must include a `column`. Throw a clear error: `Aggregation op "<op>" requires a column`.

### Result-shape policy reminder (D5)

Both new tools follow the rule:

- `hypothesis_test`: `{ statistic, pValue, df? }`. The `df` field is present-or-absent based on the test, never on data values.
- `aggregate`: `{ rows: Record<string, unknown>[] }`. The keys inside each row are determined entirely by the input schema (groupBy columns + metric aliases) — fully predictable from the call.

---

## Pack registration

`apps/api/src/services/tools.service.ts`:

1. Extend `PACK_TOOL_NAMES` with `"hypothesis_test"` and `"aggregate"`.
2. Inside `buildAnalyticsTools` under the `statistics` pack block, append:
   ```ts
   tools.hypothesis_test = new HypothesisTestTool().build(stationData);
   tools.aggregate = new AggregateTool().build(stationData);
   ```

Both tools need `stationData` to read records from named entities (mirroring the existing `cluster`, `correlate`, `regression`, `trend` pattern).

---

## Test plan

All tests are service-layer assertions in `apps/api/src/__tests__/services/analytics.service.test.ts`. Run via `cd apps/api && npm run test:unit -- analytics.service`.

### `hypothesisTest()` — new `describe` block

103. **`t_test_one_sample` returns t and p ≈ 0 when sample mean is far from μ₀.** Fixture: 100 draws of a constant value 5; assert `pValue < 1e-6` against `mu: 0`. (Constant value gives stddev = 0 — guard: skip this case if it triggers `tTest` returning Infinity; if so, use a near-constant sample with tiny perturbation.)
104. **`t_test_one_sample` returns p ≈ 1 (large) when sample mean ≈ μ₀.** Fixture: a sample with mean exactly = μ₀; t ≈ 0 ⇒ p ≈ 1.
105. **`t_test_one_sample` matches a known reference.** Reference fixture from a stats text or scipy: `x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]`, `mu = 0`. scipy.stats.ttest_1samp returns t = 5.7446, p = 0.000277, df = 9. Assert all three within tolerance 1e-3.
106. **`t_test_two_sample` returns small p when groups differ.** Fixture: x = `[1..10]`, y = `[5..14]`. Assert p < 0.05.
107. **`t_test_two_sample` returns large p when groups overlap.** Fixture: x = `[1..10]`, y = `[1..10]`. Assert p > 0.5 and statistic ≈ 0.
108. **`t_test_paired` returns small p for a directional shift.** Fixture: x = `[5, 6, 7, 8, 9]`, y = `[6, 7, 8, 9, 10]` (uniform +1 shift). All differences are -1; t-test of differences vs. 0 should give a finite t and very small p.
109. **`t_test_paired` errors on length mismatch.** Two unequal-length columns. Throw `/columns must be same length for paired test/`.
110. **`mann_whitney` returns small p when distributions differ.** Fixture: x = `[1..10]`, y = `[100..109]`. Assert p < 0.001.
111. **`mann_whitney` returns large p when distributions are equal.** Fixture: x = y = `[1..10]`. Assert p > 0.9.
112. **`chi_squared` matches a textbook fixture.** Reference (Wackerly §14.4 example): observed `[10, 20, 30, 40]`, expected `[25, 25, 25, 25]`, df = 3. χ² = (15²+5²+5²+15²)/25 = 500/25 = 20. p < 1e-3.
113. **`chi_squared` returns p ≈ 1 when observed === expected.** Same array for both; statistic = 0, p = 1 (within float noise).
114. **`chi_squared` honors a custom df override.** Same 4-element fixture, `df: 2` (override). Assert the result's `df: 2` and the p-value differs from the default-df run.
115. **Missing required input throws.** `t_test_two_sample` without `columnB`. Assert throws `/Missing input for test="t_test_two_sample"/`.

### `aggregate()` — new `describe` block

116. **Single group, single sum.** Fixture: 5 rows with `{ region, revenue }`. `groupBy: ["region"]`, metric `{ op: "sum", column: "revenue" }`. Assert one row per region with `sum_revenue` summing correctly.
117. **No groupBy aggregates over the whole table.** Same fixture, `groupBy: []`. Assert one row with the total sum.
118. **Count metric without column.** `groupBy: ["region"]`, metric `{ op: "count" }`. Assert each row has a `count` field equal to the rows-per-region.
119. **Multiple metrics in one call.** `groupBy: ["region"]`, metrics: sum + mean + count. Assert each output row carries all three columns.
120. **Custom alias via `as`.** Metric `{ op: "sum", column: "revenue", as: "total_rev" }`. Assert output row has `total_rev`, not `sum_revenue`.
121. **`stddev` uses sample (n-1) divisor (Arquero default).** Fixture: `[{ x: 1 }, { x: 2 }, { x: 3 }, { x: 4 }, { x: 5 }]`, no groupBy. Sample variance = 2.5, sample stddev ≈ √2.5 ≈ 1.5811. Assert.
122. **`p25` and `p75` work over groups.** Fixture: 10 rows, two regions. Assert quantiles are computed per group.
123. **Non-count op without column throws.** Metric `{ op: "sum" }` with no `column`. Throw `/op "sum" requires a column/`.
124. **Multi-column groupBy.** `groupBy: ["region", "quarter"]`. Each output row is keyed by both fields.

Total new cases: 22 across the two tools.

---

## Behavior on edge cases

- **`t_test_one_sample` with stddev = 0.** `ss.tTest` divides by stddev; with `stddev === 0`, the result is `±Infinity` or `NaN`. The wrapper passes it through without special-casing — the model can read the inputs and reason about it. Test 103 uses a near-constant fixture to avoid stepping on this in the happy path.
- **`t_test_two_sample` returning null.** `ss.tTestTwoSample` returns `null` when one sample has < 2 elements (degenerate). The wrapper throws a clear error rather than passing null through.
- **`mann_whitney` on tied data.** `ss.wilcoxonRankSum` averages ranks for ties (verified earlier in phase 1). The normal approximation is asymptotic and degrades for n < 10 + heavy ties; document in the tool description that small-n inputs lose accuracy.
- **`chi_squared` with `expected` zero.** Zod rejects (`.positive()` on each element).
- **`aggregate` with empty records.** Arquero's `rollup` on an empty grouped table returns one row with `count = 0` and the other reducers as `null`. Pass through unchanged; the model can interpret.
- **`aggregate` with non-existent `column`.** Arquero throws on the `rollup` call. The error bubbles up; mirror the existing convention — no special pre-validation.
- **`incompleteBeta` / `incompleteGamma` non-convergence.** 200-iteration cap throws a clear error. Tests don't probe this — adversarial inputs are not in scope.

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Hand-rolled distribution CDFs deviate from scipy at edge cases (very large t, very small df). | Tolerances on tests 105 and 112 are 1e-3 against published references — comfortably above the 1e-12 numeric tolerance of the helpers. If a future use case needs higher precision, the helpers are localized and easy to upgrade to a more accurate algorithm (e.g., Lentz with extended precision). |
| `mann_whitney` z-approximation is poor for small samples (n < 10) with many ties. | Documented in the tool description. Future phase can add the exact Mann-Whitney distribution (small lookup table + permutation test). |
| `tTestTwoSample` uses pooled variance (Student's t), not Welch's. The model may pick this when Welch is more appropriate (heteroscedastic samples). | Documented. Welch is a follow-up; a `welch: boolean` flag is a one-line addition. |
| `aggregate` with an empty `groupBy` returns a one-row table where group columns are absent — the model may expect them. | Documented in the tool description. Empty-groupBy is the explicit "aggregate over the whole table" case. |
| Tool roster grows by 2; total goes from 30 (phase 3) to 32. | Still within Claude's known-good range. The single-tool-with-enum design (`hypothesis_test` over five tests) keeps the surface narrower than five sibling tools would. |
| Discovery delta (KS, Wilcoxon signed-rank deferred) leaves a gap from the discovery's promise. | Spec documents the deferral and notes the enum is non-breaking-extensible. |

**Rollback** is a single-commit revert. No DB / contract / SDK / frontend touch.

---

## Acceptance criteria

- [ ] All 22 new test cases pass; pre-existing cases pass without modification.
- [ ] `cd apps/api && npm run test:unit -- analytics.service` is green.
- [ ] `cd apps/api && npm run test:unit` (full suite) is green.
- [ ] `npm run lint && npm run type-check` from repo root are clean.
- [ ] Two new entries in `ToolService.PACK_TOOL_NAMES`; two new tool registrations under the `statistics` pack.
- [ ] No frontend, DB, contract, or SDK file is touched.
- [ ] Manual spot-check via the dev portal: a station with the `statistics` pack enabled responds correctly to:
  - "Run a one-sample t-test on `revenue` against μ = 1000." → `hypothesis_test` with `test: "t_test_one_sample"`.
  - "Compare conversion rates between region A and region B." → `t_test_two_sample` (or `mann_whitney`).
  - "Sum revenue and count rows by quarter and region." → `aggregate` with two groupBy columns and two metrics.

---

## Files touched

- New: `apps/api/src/tools/hypothesis-test.tool.ts`
- New: `apps/api/src/tools/aggregate.tool.ts`
- Edit: `apps/api/src/services/analytics.service.ts`:
  - Add `static hypothesisTest(...)` and `static aggregate(...)`.
  - Add private statics: `regularizedIncompleteBeta`, `regularizedIncompleteGamma`, `tCDF`, `chiSquaredCDF`, `tTwoTailedPValue` (or fold helpers into the test branches — settle in implementation).
- Edit: `apps/api/src/services/tools.service.ts` — register both new tools under the `statistics` pack; extend `PACK_TOOL_NAMES`.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — 22 new test cases.

No DB migration. No contract change. No frontend change. No SDK change. No new dependency.
