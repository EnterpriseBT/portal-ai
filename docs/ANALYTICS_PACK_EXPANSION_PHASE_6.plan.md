# Analytics Pack Expansion — Phase 6 — Plan

**TDD-sequenced implementation of forecasting, decomposition, and changepoint detection.**

Spec: `docs/ANALYTICS_PACK_EXPANSION_PHASE_6.spec.md`. Discovery: `docs/ANALYTICS_PACK_EXPANSION.discovery.md`. Phase 5 commit: `aa915a9`.

Four slices, in increasing-complexity order:

1. **`trend.forecastPeriods`** — minimal extension of an existing tool; smallest diff.
2. **`changepoint`** — small new tool, single-pass CUSUM. ~30 LOC.
3. **`decompose`** — new tool, classical decomposition with centered moving average. ~50 LOC.
4. **`forecast`** — Holt-Winters; the largest diff. ~120 LOC including initialization, fit loop, forecast loop, and PI computation.

Each slice follows the established loop:

1. Write failing tests.
2. Implement.
3. Re-run; confirm green.

Lint + type-check after all four slices.

Run tests with `cd apps/api && npm run test:unit -- analytics.service` per `feedback_use_npm_test_scripts`.

---

## Slice 1 — `trend.forecastPeriods`

**Files**

- Edit: `apps/api/src/tools/trend.tool.ts` — add `forecastPeriods` to `InputSchema`; forward.
- Edit: `apps/api/src/services/analytics.service.ts`:
  - Update `TrendResult` interface with optional `forecast`.
  - Extend `trend(...)` with the projection.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — extend `describe("trend()", ...)` with cases 147–148.

**Steps**

1. **Audit the existing date-stepping logic in `trend()`.** Read `analytics.service.ts:trend(...)`. The bucket builder uses `aq.escape((d) => ...)` to compute the `_period` string (e.g., `"2024-01-01"` for daily, `"2024-01"` for monthly). For the projection, reverse-engineer the next dates by parsing the *last* observed bucket and stepping forward in the appropriate interval.

   Concretely, define a helper:

   ```ts
   const stepDate = (last: string, interval: string, n: number): string => {
     // interval-specific increment
   };
   ```

   For the four intervals already supported:
   - `"day"`: `last` is `"YYYY-MM-DD"`. Add `n` days. ISO output.
   - `"week"`: `last` is the Sunday date `"YYYY-MM-DD"`. Add `n*7` days.
   - `"month"`: `last` is `"YYYY-MM"`. Increment month by `n`, carry to year.
   - `"quarter"`: `last` is `"YYYY-Q1"` etc. Increment quarter by `n`, carry to year (new format `"YYYY-Q2"`).
   - `"year"`: `last` is `"YYYY"`. Increment year by `n`.

2. **Write failing tests** (cases 147–148):

   ```ts
   it("forecast field is absent when forecastPeriods is omitted", () => {
     const result = AnalyticsService.trend({
       records: TIMESERIES_RECORDS,
       dateColumn: "date",
       valueColumn: "revenue",
       interval: "month",
     });
     expect("forecast" in result).toBe(false);
   });

   it("forecastPeriods: 3 projects three values along the linear fit", () => {
     const result = AnalyticsService.trend({
       records: TIMESERIES_RECORDS,
       dateColumn: "date",
       valueColumn: "revenue",
       interval: "month",
       forecastPeriods: 3,
     });
     expect(result.forecast).toBeDefined();
     expect(result.forecast!.values).toHaveLength(3);
     // Each successive forecast value differs by `slope`
     for (let i = 1; i < 3; i++) {
       const delta = result.forecast!.values[i] - result.forecast!.values[i - 1];
       expect(delta).toBeCloseTo(result.trendLine.slope, 9);
     }
   });
   ```

   Run; expect 2 failures (the field doesn't exist).

3. **Update `TrendResult` interface.**

4. **Implement the projection** at the end of `trend(...)`:

   ```ts
   if (params.forecastPeriods !== undefined) {
     const fc = { dates: [] as string[], values: [] as number[] };
     const lastDate = sortedDates.at(-1);
     const n = result.values.length;
     for (let i = 1; i <= params.forecastPeriods; i++) {
       const nextDate = lastDate
         ? stepDate(lastDate, interval, i)
         : `+${i}`;
       fc.dates.push(nextDate);
       fc.values.push(
         result.trendLine.intercept + result.trendLine.slope * (n + i - 1)
       );
     }
     result.forecast = fc;
   }
   ```

   The `(n + i - 1)` exponent matches the linear fit's domain (bucket index 0..n-1, so the next index is `n`, `n+1`, …, hence `n + i - 1` for `i = 1..forecastPeriods`).

5. **Tool-side change.** Add `forecastPeriods` to the Zod schema and forward in `execute`.

6. **Run focused suite.** `cd apps/api && npm run test:unit -- 'analytics.service' -t 'trend'`. All cases green.

**Done when:** spec tests 147–148 pass; existing trend tests still pass.

**Risk:** the `stepDate` helper has to mirror the existing bucket-builder's date format conventions. Any drift in format produces non-parseable forecast dates downstream. Test 148 only asserts on values; consider adding an assertion that `forecast.dates` are ISO-parseable strings for safety.

---

## Slice 2 — `changepoint`

**Files**

- New: `apps/api/src/tools/changepoint.tool.ts`
- Edit: `apps/api/src/services/analytics.service.ts`:
  - Add `ChangepointResult` interface.
  - Add `static changepoint(...)`.
- Edit: `apps/api/src/services/tools.service.ts` — register; extend `PACK_TOOL_NAMES`.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — new `describe("changepoint()", ...)` block, spec cases 163–168.

**Steps**

1. **Write failing tests** (cases 163–168). Inline fixtures with deterministic perturbations so the tests reproduce. For test 163:

   ```ts
   const records = Array.from({ length: 100 }, (_, i) => ({
     date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
     value: i < 50
       ? 0 + (i % 2 === 0 ? 0.3 : -0.3)
       : 5 + (i % 2 === 0 ? 0.3 : -0.3),
   }));
   ```

   Run; expect 6 failures.

2. **Service-side implementation:**

   ```ts
   static changepoint(params: {
     records: Record<string, unknown>[];
     dateColumn?: string;
     valueColumn: string;
     threshold?: number;
     minSegmentLength?: number;
   }): ChangepointResult {
     const sorted = params.dateColumn
       ? [...params.records].sort(
           (a, b) =>
             new Date(a[params.dateColumn!] as string).getTime() -
             new Date(b[params.dateColumn!] as string).getTime()
         )
       : [...params.records];

     const values = this.extractNumericColumn(sorted, params.valueColumn);
     const n = values.length;
     const threshold = params.threshold ?? 5;
     const minSeg = params.minSegmentLength ?? Math.max(5, Math.ceil(n / 20));

     if (n < 2 * minSeg) {
       return {
         changepoints: [],
         segmentMeans: n === 0 ? [] : [ss.mean(values)],
         segments: n === 0 ? [] : [{ start: 0, end: n - 1 }],
       };
     }

     const mu = ss.mean(values);
     const sigma = ss.standardDeviation(values);
     if (sigma === 0) {
       return {
         changepoints: [],
         segmentMeans: [mu],
         segments: [{ start: 0, end: n - 1 }],
       };
     }

     const k = 0.5;
     const changepoints: number[] = [];
     let sPos = 0;
     let sNeg = 0;
     let i = 0;
     while (i < n) {
       const z = (values[i] - mu) / sigma;
       sPos = Math.max(0, sPos + z - k);
       sNeg = Math.min(0, sNeg + z + k);
       if (sPos > threshold || -sNeg > threshold) {
         changepoints.push(i);
         sPos = 0;
         sNeg = 0;
         i += minSeg;
       } else {
         i += 1;
       }
     }

     const segments: { start: number; end: number }[] = [];
     const segmentMeans: number[] = [];
     const boundaries = [0, ...changepoints, n];
     for (let s = 0; s < boundaries.length - 1; s++) {
       const start = boundaries[s];
       const end = boundaries[s + 1] - 1;
       segments.push({ start, end });
       segmentMeans.push(ss.mean(values.slice(start, end + 1)));
     }

     const result: ChangepointResult = {
       changepoints,
       segmentMeans,
       segments,
     };
     if (params.dateColumn) {
       result.changepointDates = changepoints.map((idx) =>
         String(sorted[idx][params.dateColumn!])
       );
     }
     return result;
   }
   ```

3. **Tool-class file + registration.** Standard pattern (mirrors phase-3 / phase-4 tools).

4. **Run focused suite.** All 6 cases green.

**Done when:** spec tests 163–168 pass.

**Risk:** the deterministic-perturbation fixture might be too noisy with `threshold: 5`. If test 163 fails to detect the obvious shift at i=50, lower the per-step perturbation amplitude or temporarily lower the test's threshold to 4.

---

## Slice 3 — `decompose`

**Files**

- New: `apps/api/src/tools/decompose.tool.ts`
- Edit: `apps/api/src/services/analytics.service.ts`:
  - Add `DecomposeResult` interface.
  - Add `static decompose(...)`.
- Edit: `apps/api/src/services/tools.service.ts` — register; extend `PACK_TOOL_NAMES`.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — new `describe("decompose()", ...)` block, spec cases 157–162.

**Steps**

1. **Write failing tests** (cases 157–162).

2. **Service-side implementation:**

   ```ts
   static decompose(params: {
     records: Record<string, unknown>[];
     dateColumn: string;
     valueColumn: string;
     seasonalPeriod: number;
     seasonality?: "additive" | "multiplicative";
   }): DecomposeResult {
     const sorted = [...params.records].sort(
       (a, b) =>
         new Date(a[params.dateColumn] as string).getTime() -
         new Date(b[params.dateColumn] as string).getTime()
     );
     const dates = sorted.map((r) => String(r[params.dateColumn]));
     const observed = this.extractNumericColumn(sorted, params.valueColumn);
     const n = observed.length;
     const m = params.seasonalPeriod;
     const seasonality = params.seasonality ?? "additive";

     if (n < 2 * m) {
       throw new Error(
         `Decomposition requires at least 2 full seasons (need ${2 * m} rows, got ${n})`
       );
     }
     if (seasonality === "multiplicative" && observed.some((v) => v <= 0)) {
       throw new Error(
         "multiplicative decomposition requires all observations > 0"
       );
     }

     // Centered moving average
     const trend: (number | null)[] = new Array(n).fill(null);
     const halfWindow = Math.floor(m / 2);
     const isEven = m % 2 === 0;
     for (let i = halfWindow; i < n - halfWindow; i++) {
       if (isEven) {
         // 2-by-m MA: average of two adjacent m-MAs
         let sum = 0;
         for (let j = i - halfWindow; j < i - halfWindow + m; j++) {
           sum += observed[j];
         }
         let sum2 = 0;
         for (let j = i - halfWindow + 1; j < i - halfWindow + 1 + m; j++) {
           sum2 += observed[j];
         }
         if (i - halfWindow + 1 + m > n) continue;
         trend[i] = (sum / m + sum2 / m) / 2;
       } else {
         let sum = 0;
         for (let j = i - halfWindow; j <= i + halfWindow; j++) {
           sum += observed[j];
         }
         trend[i] = sum / m;
       }
     }

     // Detrended → per-position seasonal averages
     const detrended: (number | null)[] = observed.map((v, i) =>
       trend[i] === null
         ? null
         : seasonality === "additive"
           ? v - (trend[i] as number)
           : v / (trend[i] as number)
     );

     const seasonalAverages = new Array(m).fill(0);
     const seasonalCounts = new Array(m).fill(0);
     for (let i = 0; i < n; i++) {
       if (detrended[i] !== null) {
         seasonalAverages[i % m] += detrended[i] as number;
         seasonalCounts[i % m] += 1;
       }
     }
     for (let p = 0; p < m; p++) {
       if (seasonalCounts[p] > 0) {
         seasonalAverages[p] /= seasonalCounts[p];
       }
     }

     // Center the seasonal component around 0 (additive) or 1 (multiplicative)
     const meanSeasonal =
       seasonalAverages.reduce((s, v) => s + v, 0) / m;
     const seasonal: number[] = new Array(n);
     for (let i = 0; i < n; i++) {
       seasonal[i] =
         seasonality === "additive"
           ? seasonalAverages[i % m] - meanSeasonal
           : seasonalAverages[i % m] / meanSeasonal;
     }

     // Residual
     const residual: (number | null)[] = observed.map((v, i) => {
       if (trend[i] === null) return null;
       return seasonality === "additive"
         ? v - (trend[i] as number) - seasonal[i]
         : v / ((trend[i] as number) * seasonal[i]);
     });

     return { dates, observed, trend, seasonal, residual };
   }
   ```

3. **Tool-class file + registration.** Standard pattern.

4. **Run focused suite.** All 6 cases green.

**Done when:** spec tests 157–162 pass.

**Risk:** the centered-moving-average index math is fiddly. Test 158 (`trend[24]` ≈ 74) is the canary — if my algorithm computes the trend at the wrong offset, that test catches it immediately.

---

## Slice 4 — `forecast`

**Files**

- New: `apps/api/src/tools/forecast.tool.ts`
- Edit: `apps/api/src/services/analytics.service.ts`:
  - Add `ForecastResult` interface.
  - Add `static forecast(...)`.
- Edit: `apps/api/src/services/tools.service.ts` — register; extend `PACK_TOOL_NAMES`.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — new `describe("forecast()", ...)` block, spec cases 149–156.

**Steps**

1. **Write failing tests** (cases 149–156). For test 150 (additive seasonal recovery), verify the synthetic series produces a peaked seasonal pattern. For test 152 (PI widens with horizon), the assertion is on relative widths, not absolute values.

2. **Service-side implementation.** Holt-Winters with three flavors based on `trend × seasonality`:

   ```ts
   static forecast(params: {
     records: Record<string, unknown>[];
     dateColumn: string;
     valueColumn: string;
     horizon: number;
     seasonalPeriod?: number;
     seasonality?: "none" | "additive" | "multiplicative";
     trend?: "none" | "additive";
     alpha?: number;
     beta?: number;
     gamma?: number;
     confidence?: number;
   }): ForecastResult {
     const sorted = [...params.records].sort(
       (a, b) =>
         new Date(a[params.dateColumn] as string).getTime() -
         new Date(b[params.dateColumn] as string).getTime()
     );
     const dates = sorted.map((r) => String(r[params.dateColumn]));
     const observed = this.extractNumericColumn(sorted, params.valueColumn);
     const n = observed.length;
     const seasonality = params.seasonality ?? "none";
     const trendType = params.trend ?? "additive";
     const m = seasonality !== "none" ? params.seasonalPeriod : undefined;
     const alpha = params.alpha ?? 0.5;
     const beta = params.beta ?? 0.1;
     const gamma = params.gamma ?? 0.1;

     // Pre-validation
     if (seasonality !== "none") {
       if (!m || m < 2) {
         throw new Error(
           "seasonalPeriod is required (≥ 2) when seasonality is not 'none'"
         );
       }
       if (n < 2 * m) {
         throw new Error(
           `Forecasting with seasonality requires at least 2 full seasons (need ${2 * m} rows, got ${n})`
         );
       }
       if (seasonality === "multiplicative" && observed.some((v) => v <= 0)) {
         throw new Error(
           "multiplicative seasonality requires positive observations"
         );
       }
     } else if (n < 4) {
       throw new Error(
         `Forecasting requires at least 4 observations; got ${n}`
       );
     }

     // Initialize level / trend / seasonal arrays
     let level = m
       ? observed.slice(0, m).reduce((s, v) => s + v, 0) / m
       : observed[0];
     let trendComp =
       trendType === "additive"
         ? m
           ? (observed.slice(m, 2 * m).reduce((s, v) => s + v, 0) -
               observed.slice(0, m).reduce((s, v) => s + v, 0)) /
             (m * m)
           : (observed[1] - observed[0])
         : 0;
     const seasonal: number[] =
       m && seasonality !== "none"
         ? observed.slice(0, m).map((v) =>
             seasonality === "additive" ? v - level : v / level
           )
         : [];

     const fitted: number[] = new Array(n).fill(0);
     for (let t = 0; t < n; t++) {
       // 1-step-ahead fit
       const seasonalIdx = m ? (t - m + seasonal.length) % m : 0;
       const sPrev = m ? seasonal[seasonalIdx] : seasonality === "multiplicative" ? 1 : 0;
       fitted[t] =
         seasonality === "multiplicative"
           ? (level + (trendType === "additive" ? trendComp : 0)) * sPrev
           : level + (trendType === "additive" ? trendComp : 0) + sPrev;

       // Updates
       const yt = observed[t];
       const lvlBefore = level;
       const trendBefore = trendComp;
       if (seasonality === "additive") {
         level =
           alpha * (yt - sPrev) + (1 - alpha) * (lvlBefore + trendBefore);
       } else if (seasonality === "multiplicative") {
         level = alpha * (yt / sPrev) + (1 - alpha) * (lvlBefore + trendBefore);
       } else {
         level = alpha * yt + (1 - alpha) * (lvlBefore + trendBefore);
       }
       if (trendType === "additive") {
         trendComp = beta * (level - lvlBefore) + (1 - beta) * trendBefore;
       }
       if (m && seasonality !== "none") {
         const newSeason =
           seasonality === "additive"
             ? gamma * (yt - lvlBefore - trendBefore) + (1 - gamma) * sPrev
             : gamma * (yt / (lvlBefore + trendBefore)) + (1 - gamma) * sPrev;
         seasonal[seasonalIdx] = newSeason;
       }
     }

     // Forecast
     const fcDates: string[] = [];
     const fcValues: number[] = [];
     for (let h = 1; h <= params.horizon; h++) {
       const seasonalIdx = m ? (n - m + ((h - 1) % m) + m) % m : 0;
       const sFwd = m ? seasonal[seasonalIdx] : seasonality === "multiplicative" ? 1 : 0;
       const point =
         seasonality === "multiplicative"
           ? (level + (trendType === "additive" ? h * trendComp : 0)) * sFwd
           : level + (trendType === "additive" ? h * trendComp : 0) + sFwd;
       fcValues.push(point);
       fcDates.push(`+${h}`); // placeholder — see below
     }

     // Generate proper forecast dates by re-using the date-stepping logic
     // from `trend.forecastPeriods`. Simplest: increment the last observed
     // date in days at a uniform spacing inferred from the median spacing.
     // For phase 6, accept that forecast `dates` are "+1", "+2", ... when
     // spacing is irregular; document.
     // — Replace fcDates with proper dates using inferred spacing —

     // PIs: residual stddev (post-warmup) × √h × z
     const warmup = m ?? 1;
     const residuals: number[] = [];
     for (let t = warmup; t < n; t++) {
       residuals.push(observed[t] - fitted[t]);
     }
     const sigmaHat =
       residuals.length > 1 ? ss.standardDeviation(residuals) : 0;
     const conf = params.confidence ?? 0.95;
     const z = this.tInverseCDF(1 - (1 - conf) / 2, 1000); // ≈ Φ⁻¹
     const lower = fcValues.map((v, i) => v - z * sigmaHat * Math.sqrt(i + 1));
     const upper = fcValues.map((v, i) => v + z * sigmaHat * Math.sqrt(i + 1));

     // MAPE on post-warmup window
     let mapeSum = 0;
     let mapeCount = 0;
     for (let t = warmup; t < n; t++) {
       if (observed[t] !== 0) {
         mapeSum += Math.abs((observed[t] - fitted[t]) / observed[t]);
         mapeCount += 1;
       }
     }
     const mape = mapeCount > 0 ? (100 * mapeSum) / mapeCount : 0;

     return {
       dates,
       observed,
       fitted,
       forecast: { dates: fcDates, values: fcValues, lower, upper },
       parameters: { alpha, beta, gamma },
       mape,
     };
   }
   ```

   The forecast-date generation is left as `+1`, `+2`, … in the body above for compactness — during implementation, infer the median date spacing from the input and produce real ISO dates, mirroring the slice-1 `stepDate` helper. (Either wire `trend.forecastPeriods`'s `stepDate` into a private static and reuse it, or duplicate; settle in implementation.)

3. **Tool-class file + registration.** Standard pattern.

4. **Run focused suite.** All 8 cases green.

**Done when:** spec tests 149–156 pass.

**Risks:**

- **Initialization sensitivity.** The trend-init formula `(mean(season2) − mean(season1)) / m²` is a common rule-of-thumb; some texts use `/m`. If test 150 fails because the forecast tracks slightly off, try `/m` instead. Spec test 150 has 1.5-tolerance, leaving room for either choice.
- **Seasonal-index buffer wrap-around.** The `seasonal` array has length `m` and is indexed by `t mod m`. The `(t - m + seasonal.length) % m` expression handles negative-result modulo. Cross-check test 150 by hand-stepping through 2 cycles before merging.
- **MAPE divides by `observed`.** Series with zero entries cause skipped denominators; documented behavior.
- **Multiplicative + trend interaction.** The standard Holt-Winters multiplicative form has the trend multiplying the seasonal component, not adding to the level. The spec uses an additive-trend approximation inside multiplicative seasonality; verify test 150-style tests for the multiplicative case give reasonable forecasts. If accuracy degrades, swap to the textbook multiplicative-trend form.

---

## After all four slices

1. **Run the full apps/api unit suite.** `cd apps/api && npm run test:unit`. All previous tests pass; 22 new cases pass.
2. **Run lint + type-check from repo root.** `npm run lint && npm run type-check`. Clean.
3. **Manual smoke test against the dev portal.**
   - "Forecast monthly revenue 12 periods out, accounting for yearly seasonality." Verify `forecast` is called with `seasonalPeriod: 12, seasonality: "additive", horizon: 12`; result renders.
   - "Decompose this monthly series into trend, seasonal, and residual." Verify `decompose` returns four arrays; the `data-table` block handles `null` values gracefully.
   - "When did our churn rate level shift?" Verify `changepoint` returns indices; if a date column is supplied, the response narrates the change date.

---

## Out-of-band considerations

- **No deployment coordination.** Tools rebuilt every turn.
- **No new dependencies.** All four slices stay in pure JavaScript.
- **`trend.forecastPeriods` and `forecast` overlap.** Documented in both descriptions; the model picks based on whether seasonality is needed.

---

## PR shape

- Branch: continue on `feat/expand-tool-set-capabilities` or fork `feat/analytics-pack-phase-6`.
- Commits: four conventional-commits-style commits matching the slices, in order:
  - `feat(trend-tool): project the linear fit forward via forecastPeriods`
  - `feat(changepoint-tool): mean-shift detection via CUSUM`
  - `feat(decompose-tool): classical seasonal decomposition (additive/multiplicative)`
  - `feat(forecast-tool): Holt-Winters exponential smoothing with prediction intervals`
- PR description: link the discovery + spec + plan docs. Note D4 lock-in (Holt-Winters in phase 6; ARIMA / ETS / STL in phase 6b). Reference the phasing table — phase 6 of seven; phase 7 unstarted.
