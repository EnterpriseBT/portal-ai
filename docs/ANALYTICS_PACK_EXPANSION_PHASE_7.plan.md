# Analytics Pack Expansion — Phase 7 — Plan

**TDD-sequenced implementation of `portfolio_metrics`, `var_cvar`, and `bond_math`. Last phase on the discovery roadmap.**

Spec: `docs/ANALYTICS_PACK_EXPANSION_PHASE_7.spec.md`. Discovery: `docs/ANALYTICS_PACK_EXPANSION.discovery.md`. Phase 6 commit: `2c189c9`.

Three slices, in dependency order:

1. **`var_cvar`** — smallest. Historical sort + parametric formula. Re-uses `tInverseCDF` from phase 5 for the standard-normal quantile and the existing `regularizedIncompleteGamma` infrastructure for the standard-normal PDF (just `exp(-z²/2) / √(2π)` — no helper needed).

2. **`portfolio_metrics`** — medium. Cumulative wealth + drawdown computation, plus benchmark-relative metrics that re-use `ss.sampleCovariance` and existing primitives.

3. **`bond_math`** — largest. Four ops, including a Newton-Raphson YTM solver. Re-uses the convergence pattern from phase 3's `xirr`.

Each slice follows the established loop:

1. Write failing tests.
2. Implement.
3. Re-run; confirm green.

Lint + type-check after all three slices.

Run tests with `cd apps/api && npm run test:unit -- analytics.service` per `feedback_use_npm_test_scripts`.

---

## Slice 1 — `var_cvar`

**Files**

- New: `apps/api/src/tools/var-cvar.tool.ts`
- Edit: `apps/api/src/services/analytics.service.ts`:
  - Add `VarCvarResult` interface.
  - Add `static varCvar(...)`.
- Edit: `apps/api/src/services/tools.service.ts` — import, register, extend `PACK_TOOL_NAMES`.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — new `describe("varCvar()", ...)` block (spec cases 176–181).

**Steps**

1. **Write failing tests** (cases 176–181). For test 178 (parametric VaR on N(0,1) returns), the synthetic fixture should average ~0 with stddev ~1. Use deterministic perturbations:

   ```ts
   const records = Array.from({ length: 1000 }, (_, i) => ({
     // Sample N(0,1) approximately via an alternating sum that hits ±2σ
     // at peaks. Or use a simpler approach: ±1 alternating ±0.3 noise.
     value: Math.sin((i * 13) / 7) + Math.cos((i * 17) / 11),
   }));
   ```

   Empirically tune the fixture so its stddev is close to 1. Or precompute and inline expected mean / stddev once, then assert against the *expected* parametric VaR for that mean/stddev (rather than the textbook 1.6449). This decouples the test from the fixture's exact stats.

   Run; expect 6 failures.

2. **Service-side change** in `analytics.service.ts`. Add the result type near `DepreciationResult`, then the method near the other financial statics:

   ```ts
   export interface VarCvarResult {
     var: number;
     cvar: number;
     confidence: number;
     method: "historical" | "parametric";
     tailCount?: number;
   }

   static varCvar(params: {
     records: Record<string, unknown>[];
     returnColumn: string;
     confidence?: number;
     method?: "historical" | "parametric";
   }): VarCvarResult {
     const returns = this.extractNumericColumn(
       params.records,
       params.returnColumn
     );
     if (returns.length < 2) {
       throw new Error("var_cvar: at least 2 returns required");
     }
     const conf = params.confidence ?? 0.95;
     const method = params.method ?? "historical";

     if (method === "historical") {
       const sorted = [...returns].sort((a, b) => a - b);
       const tailFrac = 1 - conf;
       const cutoff = ss.quantile(sorted, tailFrac);
       const tail = sorted.filter((v) => v <= cutoff);
       const varVal = -cutoff;
       const cvarVal = tail.length > 0 ? -ss.mean(tail) : varVal;
       return {
         var: varVal,
         cvar: cvarVal,
         confidence: conf,
         method,
         tailCount: tail.length,
       };
     }

     // parametric (normal)
     const mu = ss.mean(returns);
     const sigma = ss.standardDeviation(returns);
     if (sigma === 0) {
       return { var: 0, cvar: 0, confidence: conf, method };
     }
     const z = this.tInverseCDF(1 - conf, 1000);
     const varVal = -(mu + z * sigma);
     // Standard-normal PDF at z
     const phi = Math.exp(-(z * z) / 2) / Math.sqrt(2 * Math.PI);
     const cvarVal = -(mu - sigma * (phi / (1 - conf)));
     return { var: varVal, cvar: cvarVal, confidence: conf, method };
   }
   ```

   Note the `ss.standardDeviation` quirk from earlier phases — it's *population* stddev. For VaR consistency with scipy/R, use `ss.sampleStandardDeviation`. Match phase 5's `studentT` style.

3. **Tool-class file.** Create `apps/api/src/tools/var-cvar.tool.ts` mirroring the phase 6 patterns. Standard `build(stationData)` → `getRecords` → service forwarding.

4. **Register in `ToolService`.** Three edits: import, `PACK_TOOL_NAMES` entry, registration line under the `financial` pack block.

5. **Run focused suite.** `cd apps/api && npm run test:unit -- 'analytics.service' -t 'varCvar'`. All 6 cases green.

**Done when:** spec tests 176–181 pass.

**Risk:** `ss.quantile` interpolation differs from numpy/scipy on small samples. The historical-VaR test uses a 16-point fixture sized so the 5th-percentile lands on a single observation — minimizes interpolation ambiguity. If the test still drifts, swap to a larger fixture (n=100) where the quantile is robust.

---

## Slice 2 — `portfolio_metrics`

**Files**

- New: `apps/api/src/tools/portfolio-metrics.tool.ts`
- Edit: `apps/api/src/services/analytics.service.ts`:
  - Add `PortfolioMetricsResult` interface.
  - Add `static portfolioMetrics(...)`.
- Edit: `apps/api/src/services/tools.service.ts` — import, register, extend `PACK_TOOL_NAMES`.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — new `describe("portfolioMetrics()", ...)` block (spec cases 169–175).

**Steps**

1. **Write failing tests** (cases 169–175).

   For test 169 (24 monthly returns), use deterministic perturbations:
   ```ts
   const records = Array.from({ length: 24 }, (_, i) => ({
     value: 0.01 + ((i % 5) - 2) * 0.002, // mean 0.01, range ±0.004
   }));
   ```

   For test 174 (hand-computed MDD), inline the fixture and the expected ≈ 0.3.

   For test 173 (Sortino > Sharpe on positively-skewed series), call both `portfolioMetrics` and the existing `sharpeRatio` tool. Note `sharpeRatio` operates on *prices* (computes returns internally), while `portfolioMetrics` takes *returns* directly. Build a price series for `sharpeRatio` and the matching return series for `portfolioMetrics`.

   Run; expect 7 failures.

2. **Tool input** has `entity` for portfolio + optional `benchmarkEntity`. Both arrays of records. The service signature accepts both directly:

   ```ts
   static portfolioMetrics(params: {
     records: Record<string, unknown>[];
     returnColumn: string;
     benchmarkRecords?: Record<string, unknown>[];
     benchmarkReturnColumn?: string;
     riskFreeRate?: number;
     periodicity?: "daily" | "weekly" | "monthly" | "quarterly" | "annual";
   }): PortfolioMetricsResult
   ```

   The tool layer does the `benchmarkEntity` → `getRecords(benchmarkEntity)` translation; the service stays focused on numerics.

3. **Service-side implementation.** Roughly:

   ```ts
   const r = this.extractNumericColumn(params.records, params.returnColumn);
   const n = r.length;
   if (n < 2) throw new Error("portfolio_metrics: at least 2 returns required");

   const periodsPerYear = {
     daily: 252,
     weekly: 52,
     monthly: 12,
     quarterly: 4,
     annual: 1,
   }[params.periodicity ?? "annual"];
   const annualize = params.periodicity !== undefined;

   // Cumulative wealth
   let wealth = 1;
   const wealthSeries: number[] = [];
   for (const ri of r) {
     wealth *= 1 + ri;
     wealthSeries.push(wealth);
   }
   const totalReturn = wealth - 1;

   // CAGR
   const cagr = annualize
     ? Math.pow(1 + totalReturn, periodsPerYear / n) - 1
     : Math.pow(1 + totalReturn, 1 / n) - 1;

   // Max drawdown
   let peak = wealthSeries[0];
   let mdd = 0;
   for (const w of wealthSeries) {
     if (w > peak) peak = w;
     const dd = (peak - w) / peak;
     if (dd > mdd) mdd = dd;
   }

   // Sortino
   const rfr = params.riskFreeRate ?? 0;
   const excessReturns = r.map((ri) => ri - rfr);
   const downsideSqSum = excessReturns
     .map((e) => (e < 0 ? e * e : 0))
     .reduce((a, b) => a + b, 0);
   const downsideDev = Math.sqrt(downsideSqSum / n);
   const meanExcess = ss.mean(excessReturns);
   const sortinoBase = downsideDev === 0 ? 0 : meanExcess / downsideDev;
   const sortino = annualize
     ? sortinoBase * Math.sqrt(periodsPerYear)
     : sortinoBase;

   // Calmar
   const calmar = mdd === 0 ? Number.POSITIVE_INFINITY : cagr / mdd;

   const result: PortfolioMetricsResult = {
     totalReturn,
     cagr,
     sortino,
     calmar,
     maxDrawdown: mdd,
   };

   // Benchmark-relative
   if (params.benchmarkRecords && params.benchmarkReturnColumn) {
     const rb = this.extractNumericColumn(
       params.benchmarkRecords,
       params.benchmarkReturnColumn
     );
     if (rb.length !== n) {
       throw new Error("benchmark length must match portfolio length");
     }

     const varB = ss.sampleVariance(rb);
     const beta = varB === 0 ? 0 : ss.sampleCovariance(r, rb) / varB;
     const meanR = ss.mean(r);
     const meanB = ss.mean(rb);
     let alpha = meanR - rfr - beta * (meanB - rfr);
     if (annualize) alpha = Math.pow(1 + alpha, periodsPerYear) - 1;

     const diff = r.map((ri, i) => ri - rb[i]);
     let trackingError = ss.sampleStandardDeviation(diff);
     if (annualize) trackingError *= Math.sqrt(periodsPerYear);

     const meanDiff = ss.mean(diff);
     const sdDiff = ss.sampleStandardDeviation(diff);
     let informationRatio = sdDiff === 0 ? 0 : meanDiff / sdDiff;
     if (annualize) informationRatio *= Math.sqrt(periodsPerYear);

     // Up/down capture
     const upMaskR: number[] = [];
     const upMaskB: number[] = [];
     const downMaskR: number[] = [];
     const downMaskB: number[] = [];
     for (let i = 0; i < n; i++) {
       if (rb[i] > 0) {
         upMaskR.push(r[i]);
         upMaskB.push(rb[i]);
       } else if (rb[i] < 0) {
         downMaskR.push(r[i]);
         downMaskB.push(rb[i]);
       }
     }
     const meanUpB = upMaskB.length ? ss.mean(upMaskB) : 0;
     const meanDownB = downMaskB.length ? ss.mean(downMaskB) : 0;
     const upCapture =
       upMaskB.length && meanUpB !== 0
         ? ss.mean(upMaskR) / meanUpB
         : null;
     const downCapture =
       downMaskB.length && meanDownB !== 0
         ? ss.mean(downMaskR) / meanDownB
         : null;

     result.beta = beta;
     result.alpha = alpha;
     result.trackingError = trackingError;
     result.informationRatio = informationRatio;
     // null only when one side has no observations; the test for capture
     // ratio coverage does not exercise the null branch in phase 7.
     if (upCapture !== null) result.upCapture = upCapture;
     if (downCapture !== null) result.downCapture = downCapture;
   }

   return result;
   ```

   The result type's optional fields (beta, alpha, etc.) match D5: present-or-absent based on input.

4. **Tool-class file.** Standard pattern; the tool layer pulls `benchmarkEntity` records via a second `getRecords` call.

5. **Register in `ToolService`.** Standard pattern.

6. **Run focused suite.** All 7 cases green.

**Done when:** spec tests 169–175 pass.

**Risks:**

- **Sortino downside-deviation convention.** Some texts square deviations only over `(r - rfr) < 0`; others over `min(r - rfr, 0)`. Both produce the same numerator (squared excess returns are zeroed for non-negative values). The denominator is divided by `n` (full count) rather than the count of negative entries. Documented in service comments.

- **Up/down capture with all-positive (or all-negative) benchmark.** One mask is empty; division by zero. Handle by emitting `null` for that field; the spec's edge-case section already documents this as expected behavior.

---

## Slice 3 — `bond_math`

**Files**

- New: `apps/api/src/tools/bond-math.tool.ts`
- Edit: `apps/api/src/services/analytics.service.ts`:
  - Add `BondMathResult` type union.
  - Add `static bondMath(...)`.
- Edit: `apps/api/src/services/tools.service.ts` — import, register, extend `PACK_TOOL_NAMES`.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — new `describe("bondMath()", ...)` block (spec cases 182–189).

**Steps**

1. **Write failing tests** (cases 182–189).

   - Test 182 (par bond at par yield): hand-derive — when `yield === couponRate`, price equals face. Assert `result.price === 1000` within 1e-6.
   - Test 185 (round-trip): compute price at yield 0.045, then YTM on that price, expect 0.045 within 1e-6.
   - Test 186 (zero-coupon Macaulay): with `couponRate: 0, maturity: 5, frequency: 1`, Macaulay = 5 (years), Modified = 5 / (1 + 0.05) = 4.7619.
   - Test 187 (zero-coupon convexity): for a zero with `t=N=5`, `f=1`, `r=y=0.05`, the textbook convexity is `t(t+1)/(1+y)² = 30/1.1025 ≈ 27.21`. (No frequency squared since `f=1`.)

   Run; expect 8 failures.

2. **Service-side implementation:**

   ```ts
   export type BondMathResult =
     | { price: number }
     | { yield: number; iterations: number }
     | { macaulayDuration: number; modifiedDuration: number }
     | { convexity: number };

   static bondMath(params: {
     op: "price" | "ytm" | "duration" | "convexity";
     face: number;
     couponRate: number;
     maturity: number;
     frequency?: number;
     yield?: number;
     price?: number;
     guess?: number;
   }): BondMathResult {
     const { op, face, couponRate, maturity } = params;
     const f = params.frequency ?? 2;
     const N = Math.round(maturity * f);
     const C = (couponRate * face) / f;

     const priceFromYield = (y: number): number => {
       const r = y / f;
       if (r === 0) return C * N + face;
       const annuity = C * (1 - Math.pow(1 + r, -N)) / r;
       const principal = face / Math.pow(1 + r, N);
       return annuity + principal;
     };

     if (op === "price") {
       if (params.yield === undefined) {
         throw new Error("yield is required for op = price");
       }
       return { price: priceFromYield(params.yield) };
     }

     if (op === "ytm") {
       if (params.price === undefined) {
         throw new Error("price is required for op = ytm");
       }
       const targetPrice = params.price;
       // Newton-Raphson on (priceFromYield(y) - targetPrice)
       const dPriceDY = (y: number): number => {
         const r = y / f;
         let sum = 0;
         for (let t = 1; t <= N; t++) {
           const cf = t === N ? C + face : C;
           sum += -t * cf / (f * Math.pow(1 + r, t + 1));
         }
         return sum;
       };
       let y = params.guess ?? 0.05;
       let iterations = 0;
       for (let i = 0; i < 100; i++) {
         iterations = i + 1;
         const fVal = priceFromYield(y) - targetPrice;
         const fp = dPriceDY(y);
         if (Math.abs(fp) < 1e-12) {
           throw new Error("ytm did not converge (zero derivative)");
         }
         const next = y - fVal / fp;
         if (Math.abs(next - y) < 1e-10) {
           return { yield: next, iterations };
         }
         y = next;
       }
       throw new Error("ytm did not converge after 100 iterations");
     }

     if (op === "duration") {
       if (params.yield === undefined) {
         throw new Error("yield is required for op = duration");
       }
       const r = params.yield / f;
       const P = priceFromYield(params.yield);
       let weightedSum = 0;
       for (let t = 1; t <= N; t++) {
         const cf = t === N ? C + face : C;
         weightedSum += t * cf / Math.pow(1 + r, t);
       }
       const macaulayPeriods = weightedSum / P;
       const macaulayDuration = macaulayPeriods / f;
       const modifiedDuration = macaulayDuration / (1 + r);
       return { macaulayDuration, modifiedDuration };
     }

     // convexity
     if (params.yield === undefined) {
       throw new Error("yield is required for op = convexity");
     }
     const r = params.yield / f;
     const P = priceFromYield(params.yield);
     let weightedSum = 0;
     for (let t = 1; t <= N; t++) {
       const cf = t === N ? C + face : C;
       weightedSum += t * (t + 1) * cf / Math.pow(1 + r, t + 2);
     }
     const convexityPeriods = weightedSum / P;
     const convexity = convexityPeriods / (f * f);
     return { convexity };
   }
   ```

3. **Tool-class file.** No `stationData` parameter — `bond_math` is purely numeric. Mirror `npv.tool.ts` / `irr.tool.ts` / `tvm.tool.ts` `build()` shape.

4. **Register in `ToolService`.** Standard.

5. **Run focused suite.** All 8 cases green.

**Done when:** spec tests 182–189 pass.

**Risks:**

- **Convexity formula scaling.** Two conventions exist: (a) `(1/P) Σ t(t+1) CF / (1+r)^(t+2)` in *period²* units, dividing by `f²` to get *year²*; (b) the same sum without final scaling. The spec tests use convention (a) — matches Fabozzi §4. Verify against the zero-coupon hand-computed value (test 187) before merge.

- **YTM round-trip precision.** Newton-Raphson tolerance is 1e-10; test 185 asserts 1e-6 — comfortable margin.

- **Integer rounding of `N = maturity · f`.** A 10.5-year bond at semi-annual is 21 periods. Rounding to integer is correct for cleanly-defined maturities; non-integer-period inputs are out of scope (no day-count conventions). Document in tool description.

---

## After all three slices

1. **Run the full apps/api unit suite.** `cd apps/api && npm run test:unit`. All previous tests pass; 21 new cases pass.
2. **Run lint + type-check from repo root.** `npm run lint && npm run type-check`. Clean.
3. **Manual smoke test against the dev portal.**
   - On a station with the `financial` pack enabled:
     - "Compute portfolio metrics for `daily_return` against the S&P stored in `spy_returns`, with daily periodicity." Verify `portfolio_metrics` returns benchmark-relative fields.
     - "What's the 99% historical VaR on `daily_return`?" Verify `var_cvar` returns positive `var` and `cvar`.
     - "Price a 10-year 5% semi-annual coupon bond at 4.5% yield." Verify `bond_math.price` ≈ 1040.
     - "What's the modified duration of that bond?" Verify follow-up call carries `op: "duration"`.

---

## Out-of-band considerations

- **No deployment coordination.** Tools rebuilt every turn.
- **No new dependencies.** All three slices stay in pure JavaScript with hand-rolled math.
- **Phase 7 closes the discovery roadmap.** Future analytics expansion (additional tests, ARIMA, STL, Welch, ridge/lasso, multi-class logistic, Treynor, callable bonds, day-count conventions, Cornish-Fisher) belongs to a new discovery pass.

---

## PR shape

- Branch: continue on `feat/expand-tool-set-capabilities` or fork `feat/analytics-pack-phase-7`.
- Commits: three conventional-commits-style commits matching the slices, in order:
  - `feat(var-cvar-tool): historical and parametric Value-at-Risk and Conditional VaR`
  - `feat(portfolio-metrics-tool): standalone and benchmark-relative portfolio analytics`
  - `feat(bond-math-tool): price, YTM, duration, and convexity for fixed-coupon bonds`
- PR description: link the discovery + spec + plan docs. Note that phase 7 closes the discovery roadmap. Reference the phasing table — phase 7 of seven; future work belongs to a new discovery pass.
