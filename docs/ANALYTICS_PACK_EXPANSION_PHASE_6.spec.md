# Analytics Pack Expansion — Phase 6 — Spec

**Time-series forecasting, decomposition, and changepoint detection. Largest single-phase capability addition; described in the discovery as deserving its own phase.**

Discovery: `docs/ANALYTICS_PACK_EXPANSION.discovery.md`. Prior phases: `0417513`, `4fd2548`, `874fefe`, `4165899`, `0b0960b`, `aa915a9`.

Phase-6 wedge from the discovery's phasing table:

> **6. Forecasting** | `forecast` (Holt-Winters), `decompose`, `changepoint`, `trend.forecastPeriods` | Largest single capability addition; deserves its own phase.

Decision point D4 from the discovery is already resolved:

> **`forecast` library choice.** Pure-JS Holt-Winters first (no dep), ARIMA via `@stdlib/stats-arima` or equivalent in a follow-up. Locked in spec.

After this phase: a station with the `regression` pack enabled can answer the standard set of forecasting questions — multi-step projections of seasonal time-series, additive decomposition into trend / seasonal / residual, and detection of structural breaks in level.

---

## Scope

### In scope (1 widening, 3 new tools — all enter the `regression` pack)

1. **`trend.forecastPeriods`** — extend the existing `trend` tool with an optional `forecastPeriods` field. When supplied, project the linear fit `n` aggregated buckets past the last observed bucket. Output gains a `forecast: { dates, values }` field, present-or-absent based on the input flag.

2. **`forecast` (new)** — Holt-Winters exponential smoothing with optional seasonality. Inputs: `entity, dateColumn, valueColumn, horizon`, plus `seasonalPeriod`, `seasonality: "none" | "additive" | "multiplicative"`, `trend: "none" | "additive"`, and optional smoothing parameters `alpha, beta, gamma`. Returns the in-sample fit alongside multi-step point forecasts and Gaussian prediction intervals.

3. **`decompose` (new)** — classical seasonal decomposition (centered moving-average trend + per-season averaging + residual). Additive or multiplicative.

4. **`changepoint` (new)** — mean-shift detection via CUSUM (cumulative-sum) on the standardized series. Returns indices of detected breaks plus per-segment means.

### Out of scope

- ARIMA / SARIMA / Auto-ARIMA. Phase 6b (with one focused dep, per D4).
- ETS (state-space exponential smoothing with automatic model selection). Phase 6b alongside ARIMA — the same dep typically covers both.
- STL (seasonal-trend-loess). More complex than classical decomposition; phase 6 ships the classical version first. STL via the same future dep.
- Prophet / sktime-style multi-model selection. Out of project scope.
- PELT changepoint detection (multiple-changepoint optimal partition). CUSUM is single-pass and sufficient for retail use cases; PELT lands as an enum option in a follow-up.
- Variance / volatility changepoints. Phase 6 detects mean shifts only.
- Cross-validation, train/test split, accuracy metrics. Spec returns in-sample fit; the model can compare prediction intervals to held-out values but the tool does not partition.
- Frontend / DB / contract / SDK changes.

---

## Tool-by-tool surface

### 1. `trend.forecastPeriods` (existing tool widening)

Existing schema (`apps/api/src/tools/trend.tool.ts`, after phase 1):

```ts
const InputSchema = z.object({
  entity: z.string(),
  dateColumn: z.string(),
  valueColumn: z.string(),
  interval: z.enum(["day", "week", "month", "quarter", "year"]),
});
```

New schema:

```ts
const InputSchema = z.object({
  entity: z.string().describe("Entity key (table name)"),
  dateColumn: z.string().describe("Date column key"),
  valueColumn: z.string().describe("Numeric value column key"),
  interval: z
    .enum(["day", "week", "month", "quarter", "year"])
    .describe("Aggregation interval"),
  forecastPeriods: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Optional number of future buckets to project the linear fit. When supplied, the result includes a `forecast` field with the projected `dates` and `values`."
    ),
});
```

Existing `TrendResult`:

```ts
export interface TrendResult {
  dates: string[];
  values: number[];
  trendLine: { slope: number; intercept: number };
}
```

Extended (per D5 — new field is present-or-absent based on input flag):

```ts
export interface TrendResult {
  dates: string[];
  values: number[];
  trendLine: { slope: number; intercept: number };
  forecast?: { dates: string[]; values: number[] };
}
```

Service-side semantics:

- Compute the existing aggregated buckets and the linear fit (unchanged).
- When `forecastPeriods > 0`:
  - Generate `forecastPeriods` synthetic future dates, one per bucket past the last observed period (using the same date-stepping logic as the bucket builder — `+1 day` for `day`, `+1 week` for `week`, etc.).
  - Compute `value_i = trendLine.intercept + trendLine.slope * (n + i)` for `i = 1..forecastPeriods`, where `n` is the number of observed buckets. (Slope is over bucket index, the same scale used to compute it.)
  - Return them in `forecast: { dates, values }`.

Default behavior (no `forecastPeriods`) is byte-stable: the `forecast` field is *absent* from the result, not `undefined`.

### 2. `forecast` (new)

```ts
const InputSchema = z.object({
  entity: z.string().describe("Entity key (table name)"),
  dateColumn: z.string().describe("Date column key"),
  valueColumn: z.string().describe("Numeric value column key"),
  horizon: z
    .number()
    .int()
    .positive()
    .describe("Number of future periods to forecast."),
  seasonalPeriod: z
    .number()
    .int()
    .min(2)
    .optional()
    .describe(
      "Seasonal cycle length (e.g. 12 for monthly data with yearly seasonality, 7 for daily-with-weekly). Required for additive/multiplicative seasonality."
    ),
  seasonality: z
    .enum(["none", "additive", "multiplicative"])
    .optional()
    .describe(
      "Seasonal component. Default 'none'. 'multiplicative' requires all observations > 0."
    ),
  trend: z
    .enum(["none", "additive"])
    .optional()
    .describe("Trend component. Default 'additive'."),
  alpha: z
    .number()
    .gt(0)
    .lt(1)
    .optional()
    .describe(
      "Level smoothing parameter in (0, 1). Default 0.5 (or grid-searched if `optimize: true`)."
    ),
  beta: z
    .number()
    .gt(0)
    .lt(1)
    .optional()
    .describe(
      "Trend smoothing parameter in (0, 1). Default 0.1. Ignored when trend is 'none'."
    ),
  gamma: z
    .number()
    .gt(0)
    .lt(1)
    .optional()
    .describe(
      "Seasonal smoothing parameter in (0, 1). Default 0.1. Ignored when seasonality is 'none'."
    ),
  confidence: z
    .number()
    .gt(0)
    .lt(1)
    .optional()
    .describe(
      "Confidence level for the prediction intervals (default 0.95). PIs use a Gaussian-residual approximation: half-width = z · σ̂ · √h, where σ̂ is the in-sample residual stddev and h is the forecast step."
    ),
});
```

Service-side semantics (`AnalyticsService.forecast`):

Standard Holt-Winters formulation (additive seasonality + additive trend, simplest case):

```
For t in 1..n:
  ℓ_t = α(y_t − s_{t−m}) + (1−α)(ℓ_{t−1} + b_{t−1})
  b_t = β(ℓ_t − ℓ_{t−1}) + (1−β)b_{t−1}
  s_t = γ(y_t − ℓ_{t−1} − b_{t−1}) + (1−γ)s_{t−m}
  fit_t = ℓ_{t−1} + b_{t−1} + s_{t−m}

For h in 1..horizon:
  ŷ_{n+h} = ℓ_n + h·b_n + s_{n−m+((h−1) mod m)+1}
```

Initialization (standard practice):

- `ℓ_0 = mean(y[0..m-1])` (level: average of first season)
- `b_0 = (mean(y[m..2m-1]) − mean(y[0..m-1])) / m` (trend: average season-to-season change)
- `s_t = y_t − ℓ_0` for `t ∈ [-m, -1]` (seasonal: deviation from initial level)

When `seasonality === "none"`, fall through to Holt's linear (no seasonal term). When `trend === "none"`, fall through to simple exponential smoothing (level only, no trend).

Multiplicative seasonality replaces the additive `(y_t − s_{t−m})` term with `y_t / s_{t−m}` and additive seasonal updates with multiplicative ones; standard Holt-Winters formulation.

**Pre-validation:**
- `n ≥ max(2 * seasonalPeriod, 4)` for seasonal models — need ≥ 2 full seasons to initialize.
- `n ≥ 4` for non-seasonal models (Holt's linear needs 2 points for trend; exponential smoothing needs ≥ 2 for variance).
- Multiplicative seasonality requires all `y_i > 0`.
- Requested `horizon > 0` (Zod-enforced).

**Smoothing-parameter defaults**: when `alpha`/`beta`/`gamma` are omitted, use 0.5 / 0.1 / 0.1 (textbook starting points). Auto-optimization is *not* in phase 6 — the model can override defaults explicitly. Document in the tool description.

**Prediction intervals**: in-sample residuals = `y_t − fit_t` for `t ≥ 2m+1` (after initialization warmup). σ̂ = sample stddev of residuals. PI half-width at horizon `h` = `z_{1−α/2} · σ̂ · √h` where `z` is the standard-normal quantile. This is a Gaussian-residual approximation — wider than the exact Holt-Winters formula but conservative and easy to compute. Document the approximation in the tool description.

Output:

```ts
export interface ForecastResult {
  /** In-sample dates (same length as the observed series). */
  dates: string[];
  /** Observed values. */
  observed: number[];
  /** In-sample one-step-ahead fits. */
  fitted: number[];
  /** Forecasts past the last observed date. */
  forecast: {
    dates: string[];
    values: number[];
    lower: number[];
    upper: number[];
  };
  /** Smoothing parameters actually used (echoed back for transparency). */
  parameters: { alpha: number; beta: number; gamma: number };
  /** Mean absolute percentage error on the in-sample fit (post-warmup). */
  mape: number;
}
```

### 3. `decompose` (new)

```ts
const InputSchema = z.object({
  entity: z.string().describe("Entity key (table name)"),
  dateColumn: z.string().describe("Date column key"),
  valueColumn: z.string().describe("Numeric value column key"),
  seasonalPeriod: z
    .number()
    .int()
    .min(2)
    .describe(
      "Seasonal cycle length (12 for monthly with yearly seasonality, etc.)."
    ),
  seasonality: z
    .enum(["additive", "multiplicative"])
    .optional()
    .describe(
      "Decomposition type. Default 'additive'. 'multiplicative' requires all observations > 0."
    ),
});
```

Service-side semantics (`AnalyticsService.decompose`):

Classical decomposition (Hyndman §3.4):

1. **Trend** via centered moving average (CMA) with window `2m+1` (when `m` is even: 2-by-m MA; weights `1/(2m), 1/m, …, 1/m, 1/(2m)`). The first `m/2` and last `m/2` indices have NaN trend; report as `null`.
2. **Detrended** = `observed − trend` (additive) or `observed / trend` (multiplicative). NaNs at edges propagate.
3. **Seasonal** = average detrended value over each season-of-cycle position; broadcast to the full length. Center each cycle's average around 0 (additive) or 1 (multiplicative).
4. **Residual** = `observed − trend − seasonal` (additive) or `observed / (trend × seasonal)` (multiplicative). NaNs at edges propagate.

Output:

```ts
export interface DecomposeResult {
  dates: string[];
  observed: number[];
  trend: (number | null)[];
  seasonal: number[];
  residual: (number | null)[];
}
```

`trend` and `residual` use `null` (not `NaN`) at the edges so the JSON renders cleanly in the `data-table` block.

**Pre-validation:**
- `n ≥ 2 * seasonalPeriod` (need ≥ 2 full cycles).
- Multiplicative requires all `y_i > 0`.

### 4. `changepoint` (new)

```ts
const InputSchema = z.object({
  entity: z.string().describe("Entity key (table name)"),
  dateColumn: z
    .string()
    .optional()
    .describe(
      "Optional date column for output labels. When omitted, indices are returned without dates."
    ),
  valueColumn: z.string().describe("Numeric value column key"),
  threshold: z
    .number()
    .positive()
    .optional()
    .describe(
      "CUSUM threshold in standard deviations of the standardized series. Default 5.0; lower values produce more (smaller) detected shifts."
    ),
  minSegmentLength: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Minimum spacing between consecutive changepoints. Default ⌈n/20⌉, floor of 5."
    ),
});
```

Service-side semantics (`AnalyticsService.changepoint`):

Mean-shift CUSUM:

1. Standardize the series: `z_i = (y_i − μ) / σ` where `μ`, `σ` are the global mean and stddev.
2. Maintain a running positive CUSUM `S⁺_i = max(0, S⁺_{i−1} + z_i − k)` and negative CUSUM `S⁻_i = min(0, S⁻_{i−1} + z_i + k)`, with `k = 0.5` (industry-standard sensitivity).
3. Whenever `|S⁺_i| > threshold` or `|S⁻_i| > threshold`, record a changepoint at index `i`, reset both CUSUMs to 0, and skip ahead `minSegmentLength` indices before resuming detection.

After detecting all changepoints, compute per-segment means (mean of `y` between consecutive changepoint indices, including the boundaries 0 and `n`).

Output:

```ts
export interface ChangepointResult {
  /** Indices into the (sorted) input where a level shift was detected. */
  changepoints: number[];
  /** Optional date strings at those indices, when `dateColumn` was supplied. */
  changepointDates?: string[];
  /** Mean of `y` in each segment between consecutive changepoints. */
  segmentMeans: number[];
  /** Index ranges [start, end] for each segment, for context. */
  segments: { start: number; end: number }[];
}
```

**Pre-validation:**
- `n ≥ 2 * minSegmentLength` after default expansion.
- All `y_i` numeric.
- `σ > 0` (constant series → zero changepoints; do not throw).

### Result-shape policy reminder (D5)

- `trend`: `forecast` field is present-or-absent based on input flag.
- `forecast`: every field is always present; `mape` is `NaN` if all post-warmup residuals are zero (unlikely but possible). The `parameters` object echoes the smoothing parameters used.
- `decompose`: every field always present; edge-NaN values are `null`.
- `changepoint`: `changepointDates` is present-or-absent based on input flag.

---

## Pack registration

`apps/api/src/services/tools.service.ts`:

1. Extend `PACK_TOOL_NAMES` with `"forecast"`, `"decompose"`, `"changepoint"`.
2. Inside `buildAnalyticsTools` under the `regression` pack block (next to `trend` and `regression`), append:
   ```ts
   tools.forecast = new ForecastTool().build(stationData);
   tools.decompose = new DecomposeTool().build(stationData);
   tools.changepoint = new ChangepointTool().build(stationData);
   ```

`trend` itself is already registered; only its Zod schema and service body change for the `forecastPeriods` widening.

---

## Test plan

All tests are service-layer assertions in `apps/api/src/__tests__/services/analytics.service.test.ts`. Run via `cd apps/api && npm run test:unit -- analytics.service`.

Test fixtures rely on a single helper `synthMonthlySeries(n)` that produces `n` rows of `{ date, value }` with a known seasonal+trend signal:

```ts
const synthMonthlySeries = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    date: `2020-${String((i % 12) + 1).padStart(2, "0")}-15`,
    // monthly date close enough — distinct dates per row, parseable
    value: 100 + i * 2 + 10 * Math.sin((2 * Math.PI * i) / 12),
  }));
```

(The date strings repeat after 12 rows but each forecast/decompose/changepoint test only cares about the series order, not absolute dates.)

### `trend.forecastPeriods` — extend existing `describe` block

147. **Default behavior is byte-stable: no `forecast` field when `forecastPeriods` is omitted.** Existing fixture; assert `"forecast" in result === false`.
148. **`forecastPeriods: 3` returns three projected values that lie on the linear fit.** Existing trend fixture; assert `result.forecast` exists, `result.forecast.values.length === 3`, and each forecast value differs from the prior by exactly the slope (within 1e-9).

### `forecast()` — new `describe` block

149. **Non-seasonal Holt's linear: forecast extends the trend.** Series `y_i = 10 + 2i` for `i ∈ [0, 19]`, no seasonality. `horizon: 5`, `trend: "additive"`. Assert `forecast.values[0]` is close to the next observation (`10 + 2·20 = 50`) — within 0.5.
150. **Additive seasonality recovers the seasonal pattern.** Series `y_i = 100 + 10·sin(2π·i/12)` for `i ∈ [0, 47]` (4 years monthly, no trend). `seasonalPeriod: 12, seasonality: "additive", trend: "none", horizon: 12`. Assert `forecast.values[0]` is within 1.5 of `100 + 10·sin(2π·48/12) = 100`. Assert peaks and troughs of the forecast match the input pattern.
151. **`mape` is small for a clean signal.** Same fixture as test 150. Assert `mape < 5` (percent).
152. **Prediction intervals widen with horizon.** Same fixture. Assert `forecast.upper[h] − forecast.lower[h]` is monotone non-decreasing in `h`.
153. **Multiplicative seasonality requires positive observations.** Series with `y_i < 0` somewhere. Throws `/multiplicative seasonality requires positive/`.
154. **`seasonalPeriod` exceeding `n/2` throws.** Series of length 10 with `seasonalPeriod: 8`. Throws `/at least 2 full seasons/`.
155. **`parameters` echo back the smoothing values used.** Pass `alpha: 0.7, beta: 0.2, gamma: 0.3`. Assert returned `parameters` deep-equals input.
156. **Defaults fire when smoothing parameters omitted.** Pass nothing; assert `parameters: { alpha: 0.5, beta: 0.1, gamma: 0.1 }`.

### `decompose()` — new `describe` block

157. **Additive decomposition recovers the seasonal component on a clean signal.** Series `y_i = 50 + i + 5·sin(2π·i/12)` for `i ∈ [0, 47]`. `seasonalPeriod: 12, seasonality: "additive"`. Assert `seasonal[0]` is close to `5·sin(0) = 0` within tolerance 0.5; assert the seasonal component sums to ≈ 0 over one period.
158. **Trend recovers the linear component (away from edges).** Same fixture. Assert `trend[24]` (mid-series) is close to `50 + 24 = 74` within tolerance 1.0.
159. **Edge values of `trend` and `residual` are `null`.** Same fixture, `seasonalPeriod: 12`. Assert the first 6 and last 6 entries of `trend` are `null`. Same for `residual`.
160. **Multiplicative decomposition seasonal component centers around 1.** Series `y_i = 100 · (1 + 0.1·sin(2π·i/12))`. Assert mean of seasonal over one period is close to 1 within 0.05.
161. **Multiplicative requires positive observations.** Series with zeros or negatives. Throws.
162. **`n < 2·seasonalPeriod` is rejected.** Series of length 10 with `seasonalPeriod: 12`. Throws `/at least 2 full seasons/`.

### `changepoint()` — new `describe` block

163. **Detects a single mean shift.** Series of 100 values: first 50 drawn from N(0, 1), last 50 from N(5, 1). (Use deterministic noise — alternating `[-0.3, 0.3]` perturbations — so the test is reproducible without `Math.random`.) Assert `changepoints.length === 1` and the detected index is within 5 of 50.
164. **Detects multiple shifts.** Series with three regimes (means 0, 5, 10) of 50 points each. Assert `changepoints.length === 2` and detected indices are roughly at 50 and 100.
165. **Constant series produces zero changepoints.** All values equal 7. Assert `changepoints.length === 0`, `segmentMeans === [7]`.
166. **`segmentMeans` and `segments` lengths align.** Any fixture with ≥ 1 changepoint. Assert `segmentMeans.length === segments.length === changepoints.length + 1`.
167. **`changepointDates` is present iff `dateColumn` is supplied.** Run twice on the same fixture with and without `dateColumn`. Assert presence in one, absence in the other.
168. **Lower `threshold` flags more shifts.** Run a noisy two-regime fixture twice with `threshold: 5` and `threshold: 2`; assert the lower-threshold run has ≥ as many changepoints.

Total new cases: 22 across the four areas.

---

## Behavior on edge cases

- **`trend.forecastPeriods` with empty input.** `n = 0` returns the existing empty-fixture shape. Add `forecast: { dates: [], values: [] }` when `forecastPeriods` is supplied — the model can read that as "no input to project from."
- **`forecast` with `seasonalPeriod` but `seasonality: "none"`.** Treat seasonality as `"none"` (the explicit option wins). Document as a "your `seasonalPeriod` is ignored" no-op.
- **`forecast` with all-equal input.** σ̂ = 0 → prediction intervals collapse to the point forecast. No throw.
- **`decompose` with constant series.** Trend = constant, seasonal = 0 (additive) or 1 (multiplicative), residual = 0 / 1. No throw.
- **`changepoint` with `minSegmentLength` larger than `n/2`.** Detection skips so far ahead the whole series fits in one segment. Returns `changepoints: []`, single-segment output.
- **All four time-series tools with mismatched-length `dateColumn` values.** The `extractNumericColumn` helper drops non-numeric entries; if `dateColumn` rows count differs from `valueColumn`, the *aligned* arrays are off. Document in the tool descriptions: tools assume one row per observation. Pre-validation catches mismatched lengths via the `extractNumericColumn` call.

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Holt-Winters initialization on short series produces wild forecasts. | Pre-validation requires `n ≥ 2 · seasonalPeriod`. The `mape` field surfaces in-sample fit quality; the model can read a high `mape` as "this fit isn't great, take the forecast with skepticism." |
| Gaussian-PI approximation underestimates uncertainty under heavy seasonality. | Documented as approximation; conservative for typical inputs. Replacement with the exact Holt-Winters PI formula is a follow-up — small diff once implemented. |
| Smoothing parameter defaults (0.5 / 0.1 / 0.1) underfit some series. | The model can override; tool description names the defaults explicitly. Auto-optimization deferred to a follow-up — gradient descent or grid search adds ~30 LOC. |
| CUSUM detects false positives under heteroskedasticity. | Threshold default 5.0 is conservative; the `threshold` field is exposed for tuning. PELT (multi-changepoint optimal partition) is the principled upgrade in a follow-up. |
| Classical decomposition's centered moving average smears trend across structural breaks. | Documented limitation; STL handles this better and is the planned follow-up. The current implementation is fine for retail-quality time series. |
| Tool roster grows by 3; total goes from 32 (phase 5) to 35. | Within Claude's known-good range. Each new tool has a distinct purpose (forecast / decompose / changepoint) with non-overlapping inputs; the model picks unambiguously. |
| `forecast` and `trend.forecastPeriods` overlap in capability. | Intentional — `trend.forecastPeriods` is a degenerate linear forecast over aggregated buckets (matches the existing trend tool's vocabulary); `forecast` is the proper Holt-Winters variant. The model picks based on whether seasonality / non-linear trend matters. Documented in both descriptions. |

**Rollback** is a single-commit revert. No DB / contract / SDK / frontend touch.

---

## Acceptance criteria

- [ ] All 22 new test cases pass; pre-existing cases pass without modification.
- [ ] `cd apps/api && npm run test:unit -- analytics.service` is green.
- [ ] `cd apps/api && npm run test:unit` (full suite) is green.
- [ ] `npm run lint && npm run type-check` from repo root are clean.
- [ ] Three new entries in `ToolService.PACK_TOOL_NAMES` (`forecast`, `decompose`, `changepoint`); three new tool registrations under the `regression` pack.
- [ ] No frontend, DB, contract, or SDK file is touched.
- [ ] Manual spot-check via the dev portal: a station with the `regression` pack enabled responds correctly to:
  - "Forecast monthly revenue 12 periods out, accounting for yearly seasonality." → `forecast` with `horizon: 12, seasonalPeriod: 12, seasonality: "additive"`.
  - "Decompose this monthly series into trend, seasonal, and residual." → `decompose`.
  - "When did our churn rate level shift?" → `changepoint`.

---

## Files touched

- Edit: `apps/api/src/tools/trend.tool.ts` — add `forecastPeriods` field; widen forwarded args.
- New: `apps/api/src/tools/forecast.tool.ts`
- New: `apps/api/src/tools/decompose.tool.ts`
- New: `apps/api/src/tools/changepoint.tool.ts`
- Edit: `apps/api/src/services/analytics.service.ts`:
  - Update `TrendResult` interface with optional `forecast`.
  - Extend `trend(...)` with the `forecastPeriods` projection.
  - Add `static forecast(...)`, `static decompose(...)`, `static changepoint(...)`.
  - Add `ForecastResult`, `DecomposeResult`, `ChangepointResult` interfaces.
- Edit: `apps/api/src/services/tools.service.ts` — register three new tools under the `regression` pack; extend `PACK_TOOL_NAMES`.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — 22 new test cases.

No DB migration. No contract change. No frontend change. No SDK change. No new dependency.
