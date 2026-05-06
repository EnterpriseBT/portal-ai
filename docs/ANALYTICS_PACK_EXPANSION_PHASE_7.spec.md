# Analytics Pack Expansion — Phase 7 — Spec

**Portfolio metrics, Value-at-Risk / Conditional VaR, and bond math. Closes the institutional-finance gap.**

Discovery: `docs/ANALYTICS_PACK_EXPANSION.discovery.md`. Prior phases: `0417513`, `4fd2548`, `874fefe`, `4165899`, `0b0960b`, `aa915a9`, `2c189c9`.

Phase-7 wedge from the discovery's phasing table:

> **7. Portfolio + risk** | `portfolio_metrics`, `var_cvar`, `bond_math` | Closes the institutional-finance gap.

Three new tools enter the **`financial` pack**:

1. **`portfolio_metrics`** — total return, CAGR, Sortino, Calmar, plus benchmark-relative metrics (beta, alpha, information ratio, tracking error, up/down capture) when a benchmark is supplied.
2. **`var_cvar`** — historical and parametric Value-at-Risk and Conditional VaR at a configurable confidence level.
3. **`bond_math`** — `op: "price" | "ytm" | "duration" | "convexity"` over a fixed-coupon bond. Hand-rolled (the installed `financial` package ships no bond functions).

After this phase: a station with the `financial` pack enabled covers the standard institutional-portfolio question set — performance attribution against a benchmark, tail-risk quantification, and bond-pricing primitives. **Phase 7 is the last on the discovery's phasing table.**

---

## Discovery delta

The discovery's phase-7 plan was largely accurate. Reconnaissance against installed packages confirms:

- **`financial` ships no bond math.** Hand-roll all four ops (Newton-Raphson for YTM, closed-form for price / duration / convexity). ~100 LOC.
- **`simple-statistics` ships `sampleCovariance`** — usable directly for portfolio beta. No additional helper needed.
- **No new dependencies.** Phase 7 maintains the zero-new-deps posture from phases 1–6.

---

## Scope

### In scope (three new tools)

1. **`portfolio_metrics`** — single tool, optional benchmark for the relative metrics.
2. **`var_cvar`** — single tool, two methods (historical, parametric).
3. **`bond_math`** — single tool, four ops (`price`, `ytm`, `duration`, `convexity`).

### Out of scope

- Beta computed against a *factor* model (Fama-French, custom multi-factor). Out — the model can use `regression` with `xColumns` for that.
- Treynor ratio. Trivial to add (excess return / beta) once beta is available; included as a follow-up if demand surfaces.
- Maximum-drawdown duration, recovery time, underwater curve. The existing `max_drawdown` tool returns scalar drawdown + peak/trough dates; richer drawdown analytics are a follow-up.
- Monte Carlo VaR. Phase 7 ships historical and parametric only.
- Expected shortfall under non-normal distributions (Cornish-Fisher, EVT). Out.
- Callable / putable / floating-rate / inflation-linked bonds. Phase 7 ships the fixed-coupon bullet bond only.
- Convertible / equity-linked / credit-derivative pricing. Out.
- Yield curves, bootstrap, par-coupon construction. Out.
- Currency hedging, FX forwards. Out.
- Transaction-cost / liquidity adjustments. Out.
- Frontend / DB / contract / SDK changes.

---

## Tool-by-tool surface

### 1. `portfolio_metrics`

```ts
const InputSchema = z.object({
  entity: z.string().describe("Entity (table) of per-period returns."),
  returnColumn: z
    .string()
    .describe(
      "Column with per-period returns (decimal — 0.01 = 1% per period)."
    ),
  benchmarkEntity: z
    .string()
    .optional()
    .describe(
      "Optional benchmark entity. When supplied, the result includes beta, alpha, information ratio, tracking error, and up/down capture."
    ),
  benchmarkReturnColumn: z
    .string()
    .optional()
    .describe(
      "Column on the benchmark entity. Required when benchmarkEntity is supplied."
    ),
  riskFreeRate: z
    .number()
    .optional()
    .describe(
      "Per-period risk-free rate used by Sortino's downside deviation and alpha (default 0)."
    ),
  periodicity: z
    .enum(["daily", "weekly", "monthly", "quarterly", "annual"])
    .optional()
    .describe(
      "Periodicity of the returns, used to annualize CAGR / alpha / tracking error. When omitted, raw per-period values are returned (no annualization)."
    ),
});
```

Output:

```ts
export interface PortfolioMetricsResult {
  /** Cumulative return: ∏(1 + r_i) − 1. */
  totalReturn: number;
  /** Compound annual growth rate (annualized when periodicity is supplied). */
  cagr: number;
  /** (mean − rfr) / downsideDev (annualized when periodicity is supplied). */
  sortino: number;
  /** CAGR / |maxDrawdown|. */
  calmar: number;
  /** maxDrawdown computed from the cumulative-wealth series of `returnColumn`. */
  maxDrawdown: number;
  // benchmark-relative — present iff benchmarkEntity is supplied
  beta?: number;
  alpha?: number;
  informationRatio?: number;
  trackingError?: number;
  upCapture?: number;
  downCapture?: number;
}
```

Service-side semantics (`AnalyticsService.portfolioMetrics`):

- Compute cumulative wealth `W_i = ∏_{j ≤ i} (1 + r_j)`. `totalReturn = W_n − 1`.
- `n = returns.length`. Periods-per-year `P` from `periodicity` (252 daily, 52 weekly, 12 monthly, 4 quarterly, 1 annual; `1` when omitted, i.e. raw values).
- `cagr = (1 + totalReturn)^(P / n) − 1`. (When `P = 1`, this collapses to `(1 + totalReturn)^(1/n) − 1` — per-period geometric average.)
- `maxDrawdown` = max over `i` of `(peak_i − W_i) / peak_i` where `peak_i = max_{j ≤ i} W_j`.
- `calmar = cagr / |maxDrawdown|` (Infinity if no drawdown).
- `sortino`: `downsideDev = sqrt(mean(min(r − rfr, 0)²))`; `sortino = (mean(r) − rfr) / downsideDev`. Annualize by `√P` when `periodicity` is supplied.

Benchmark-relative (when `benchmarkEntity` + `benchmarkReturnColumn` both supplied):

- `beta = cov(r, rb) / var(rb)` — both sample (n-1).
- `alpha`: `mean(r) − rfr − beta · (mean(rb) − rfr)`. Annualize multiplicatively by `(1 + alpha)^P − 1` when periodicity is supplied.
- `trackingError = stddev(r − rb)` (sample, n-1). Annualize by `√P`.
- `informationRatio = mean(r − rb) / stddev(r − rb)`. Annualize by `√P`.
- `upCapture = mean(r where rb > 0) / mean(rb where rb > 0)`.
- `downCapture = mean(r where rb < 0) / mean(rb where rb < 0)`.

**Pre-validation:**
- `n ≥ 2` (need ≥ 2 returns).
- When benchmark is supplied: lengths match; `benchmarkReturnColumn` present.

### 2. `var_cvar`

```ts
const InputSchema = z.object({
  entity: z.string().describe("Entity (table) of per-period returns."),
  returnColumn: z
    .string()
    .describe("Column with per-period returns (decimal)."),
  confidence: z
    .number()
    .gt(0)
    .lt(1)
    .optional()
    .describe(
      "Confidence level for VaR / CVaR (default 0.95)."
    ),
  method: z
    .enum(["historical", "parametric"])
    .optional()
    .describe(
      "Estimation method (default 'historical'). Parametric assumes normal returns."
    ),
});
```

Output:

```ts
export interface VarCvarResult {
  /** Loss at the (1 − confidence) quantile (positive). */
  var: number;
  /** Mean loss in the tail beyond VaR (positive). */
  cvar: number;
  confidence: number;
  method: "historical" | "parametric";
  /** Number of returns in the tail (historical only; absent for parametric). */
  tailCount?: number;
}
```

Service-side semantics (`AnalyticsService.varCvar`):

**Historical:**
- Sort returns ascending.
- Tail = returns ≤ quantile at `1 − confidence`. (For confidence = 0.95 on n = 100, tail is ~5 worst returns.)
- `var = -quantile(returns, 1 − confidence)`.
- `cvar = -mean(tailReturns)`.
- `tailCount = tail.length`.

**Parametric (normal):**
- `μ = mean(returns)`, `σ = stddev(returns)` (sample).
- Standard-normal quantile: `z = Φ⁻¹(1 − confidence)` via `tInverseCDF(p, 1000)` (large-df approximation, already used by `forecast`).
- `var = -(μ + z · σ)`.
- `cvar = -(μ − σ · φ(z) / (1 − confidence))` where `φ(z) = exp(-z²/2) / √(2π)` is the standard-normal PDF.
- `tailCount` is omitted (the parametric form does not enumerate a tail).

**Pre-validation:**
- `n ≥ 2` for both methods.
- For historical: `n · (1 − confidence) ≥ 1` (need at least one observation in the tail to be meaningful). Don't *throw*, but document — historical VaR with very small `n · (1 − confidence)` is noisy.

Sign convention: VaR and CVaR are reported as **positive** loss magnitudes. A 95% VaR of 0.03 means "we are 95% confident losses will not exceed 3% per period."

### 3. `bond_math`

```ts
const InputSchema = z.object({
  op: z
    .enum(["price", "ytm", "duration", "convexity"])
    .describe(
      "Which bond quantity to compute. price/duration/convexity require `yield`; ytm requires `price`."
    ),
  face: z
    .number()
    .positive()
    .describe("Face / par value of the bond (commonly 100 or 1000)."),
  couponRate: z
    .number()
    .nonnegative()
    .describe(
      "Annual coupon rate as decimal (0.05 for 5%). Use 0 for zero-coupon bonds."
    ),
  maturity: z
    .number()
    .positive()
    .describe("Years to maturity."),
  frequency: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Coupon payments per year (default 2 for semi-annual; 1 for annual)."
    ),
  yield: z
    .number()
    .optional()
    .describe(
      "Annual yield as decimal. Required for op = price | duration | convexity."
    ),
  price: z
    .number()
    .positive()
    .optional()
    .describe(
      "Current bond price. Required for op = ytm."
    ),
  guess: z
    .number()
    .optional()
    .describe(
      "Initial-guess yield for the YTM Newton-Raphson solver (default 0.05)."
    ),
});
```

Service-side semantics (`AnalyticsService.bondMath`):

Standard formulas (per Fabozzi §3, Tuckman §1). Define:

- `f` = frequency (periods per year)
- `N` = maturity · f (total periods)
- `C` = couponRate · face / f (coupon payment per period)
- `r` = yield / f (per-period yield)

**Price:**

```
P = Σ_{t=1..N} C / (1+r)^t  +  face / (1+r)^N
  = C · (1 − (1+r)^-N) / r  +  face / (1+r)^N      (for r ≠ 0)
  = C · N + face                                    (for r = 0)
```

**YTM:** Newton-Raphson on the price function. Initial guess defaults to 0.05; converges in ~5–10 iterations on typical inputs. 100-iteration cap. Throws on non-convergence.

**Duration:**

```
Macaulay D = (Σ_{t=1..N} t · CF_t / (1+r)^t) / P    (in periods)
            ÷ f                                       (convert to years)
Modified D_mod = D_mac / (1 + r)                     (in years)
```

where `CF_t = C` for `t < N`, `CF_t = C + face` for `t = N`.

**Convexity:**

```
Convexity = (Σ_{t=1..N} t·(t+1) · CF_t / (1+r)^(t+2)) / P    (in periods²)
            ÷ f²                                                (convert to years²)
```

Output (per-op flat):

```ts
export type BondMathResult =
  | { price: number }
  | { yield: number; iterations: number }
  | { macaulayDuration: number; modifiedDuration: number }
  | { convexity: number };
```

Single-discriminator-field outputs match `tvm`'s pattern (one field per op result type). Per D5: field presence is determined entirely by the `op` input.

**Pre-validation:**
- For `op: "price" | "duration" | "convexity"`, `yield` must be provided.
- For `op: "ytm"`, `price` must be provided.
- `frequency` defaults to 2 (semi-annual, US convention).

---

## Pack registration

`apps/api/src/services/tools.service.ts`:

1. Extend `PACK_TOOL_NAMES` with `"portfolio_metrics"`, `"var_cvar"`, `"bond_math"`.
2. Inside `buildAnalyticsTools` under the `financial` pack block (next to `tvm`, `xirr`, `xnpv`, `depreciation`), append:
   ```ts
   tools.portfolio_metrics = new PortfolioMetricsTool().build(stationData);
   tools.var_cvar = new VarCvarTool().build(stationData);
   tools.bond_math = new BondMathTool().build();
   ```

`portfolio_metrics` and `var_cvar` consume `stationData` (they read records from named entities). `bond_math` is parameterless — same shape as `npv` / `irr` / `tvm` / `amortize`.

---

## Test plan

All tests are service-layer assertions in `apps/api/src/__tests__/services/analytics.service.test.ts`. Run via `cd apps/api && npm run test:unit -- analytics.service`.

### `portfolioMetrics()` — new `describe` block

169. **Standalone metrics on a clean monthly fixture.** 24 monthly returns averaging 1% with mild noise. Assert:
     - `totalReturn` close to `(1.01)^24 − 1 ≈ 0.2697` within 0.05.
     - `cagr` annualized → close to `(1.01)^12 − 1 ≈ 0.1268` (with `periodicity: "monthly"`).
     - `sortino > 0`, `calmar` finite and positive.
     - All benchmark-relative fields absent (`"beta" in result === false`, etc.).

170. **Benchmark-relative metrics emitted only when benchmark is supplied.** Same fixture twice — once without benchmark, once with a benchmark of identical returns. Assert presence/absence of `beta`, `alpha`, `informationRatio`, `trackingError`, `upCapture`, `downCapture`. With identical benchmark, `beta` ≈ 1, `alpha` ≈ 0, `trackingError` ≈ 0.

171. **`beta = 1` when portfolio === benchmark, `beta = 0` for uncorrelated.** Two-fixture pair: portfolio = benchmark gives β=1 (within 1e-9). Portfolio = constant 0 with non-trivial benchmark gives β=0.

172. **Up/down capture on a benchmark with mixed signs.** Construct portfolio that captures 1.5x the benchmark's positive moves and 0.5x the negative moves. Assert `upCapture` ≈ 1.5, `downCapture` ≈ 0.5 (within 0.05).

173. **Sortino is greater than the equivalent Sharpe for a positively-skewed series.** Compute Sortino via `portfolioMetrics`; compute Sharpe via the existing `sharpeRatio` tool on the same fixture. Pure-positive-skew fixture (e.g., mostly small positives + a few large positives): assert `sortino > sharpe`.

174. **`maxDrawdown` matches a hand-computed value.** Returns `[+0.1, +0.1, -0.3, +0.05, +0.05]`. Wealth: 1 → 1.1 → 1.21 → 0.847 → 0.889 → 0.934. Peak = 1.21, trough = 0.847. MDD = (1.21 − 0.847) / 1.21 ≈ 0.3. Assert within 1e-9.

175. **Throws when benchmark length mismatches portfolio length.** Lengths 24 and 12. Throws `/benchmark length must match portfolio length/`.

### `varCvar()` — new `describe` block

176. **Historical VaR at 95% on a known fixture.** Returns `[-0.05, -0.04, -0.03, ..., +0.10]` (sorted ascending, n = 16). The 0.05 quantile of n=16 is the worst observation; assert `var ≈ 0.05` within 1e-9.

177. **Historical CVaR ≥ Historical VaR.** CVaR is the mean of tail losses, which dominates VaR (worst-case quantile boundary). Assert `cvar >= var`.

178. **Parametric VaR on N(0, 1) returns matches Φ⁻¹.** Generate large fixture with mean 0, stddev 1 (deterministic — sin-based perturbations). At 95%, parametric VaR = `-z_{0.05} ≈ 1.6449`. Assert `var ≈ 1.6449` within 0.1 (large tolerance to absorb the synthetic-fixture's deviation from true N(0,1)).

179. **Parametric CVaR follows the closed-form formula.** Same fixture. Verify `cvar` matches `-(μ − σ · φ(z)/(1-c))` to within 0.1.

180. **`tailCount` present for historical, absent for parametric.** Assert `"tailCount" in historical === true`, `"tailCount" in parametric === false`.

181. **Custom confidence widens or narrows the VaR.** Same fixture; compute at `0.95` and `0.99`. Assert `var(0.99) ≥ var(0.95)`.

### `bondMath()` — new `describe` block

182. **Price of a 5% semi-annual coupon, 10-year, par-1000 bond at 5% yield is exactly par.** When yield equals coupon rate, bond trades at par. Assert `result.price ≈ 1000` within 1e-6.

183. **Price of a discount bond.** Same bond at 6% yield (above coupon). Assert `price < 1000`.

184. **Price of a premium bond.** Same bond at 4% yield (below coupon). Assert `price > 1000`.

185. **YTM round-trips against price.** Compute `price` at yield 0.045; feed that price back with `op: "ytm"`; assert recovered yield within 1e-6 of 0.045.

186. **Macaulay duration of a zero-coupon bond equals time to maturity.** Couponrate 0, maturity 5, frequency 1, yield 0.05. Macaulay D = 5 (years). Modified D = 5 / 1.05 ≈ 4.7619. Assert.

187. **Convexity of a zero-coupon bond matches the closed form.** Couponrate 0, maturity 5, frequency 1, yield 0.05. Convexity = `5 · 6 / (1.05)² · (1.05)^-5 / (1.05)^-5 / 1²` = `30 / (1.05)²` ≈ 27.21. Assert within 0.5.

188. **Missing yield throws on op = price.** Throws `/yield is required for op = price/` (or similar named error).

189. **Missing price throws on op = ytm.** Mirror.

Total new cases: 21 across the three tools.

---

## Behavior on edge cases

- **`portfolio_metrics` with all-zero returns.** Stddev = 0 → Sortino, Sharpe-equivalent → Infinity or 0 depending on numerator. Document; do not throw.
- **`portfolio_metrics` with `maxDrawdown === 0`.** Calmar = `cagr / 0` = ±Infinity. Document.
- **`portfolio_metrics` with no positive (or no negative) benchmark returns.** `upCapture` (or `downCapture`) divides by zero — return `null` for that field rather than `Infinity`. The model can read `null` as "not applicable here."
- **`var_cvar` historical with `n` so small that the tail is one observation.** `var === cvar`. Documented; not an error.
- **`var_cvar` parametric on a constant series.** `σ = 0` → `var = 0`, `cvar = 0`. No throw.
- **`bond_math` with `yield = 0`.** Price formula's denominator vanishes; use the `r === 0` special-case branch (`P = C·N + face`).
- **`bond_math` YTM divergence.** Newton-Raphson 100-iteration cap; throws clear error. Caller can supply a better `guess`.
- **`bond_math` zero-coupon.** `couponRate = 0` → `C = 0`; price formula reduces to `face / (1+r)^N`. Duration = maturity, modified = maturity / (1+r).

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Annualization-factor convention varies (252 vs 250 vs 365 trading days). | The `periodicity` enum mirrors phase 1's `sharpe_ratio`. Documented per-pack consistency: "daily" = 252; "weekly" = 52; etc. Caller can omit periodicity to keep raw values. |
| Sortino downside-deviation convention varies (vs. zero, vs. MAR, vs. risk-free rate). | Use `(r − rfr)` for both numerator (excess return) and downside deviation. Documented in the result-type comment. |
| Bond-math conventions differ across markets (US Treasury, corporates, EU). | Phase 7 ships the textbook fixed-coupon formula. Day-count conventions (30/360, ACT/ACT) and accrued-interest computation are out of scope. |
| Newton-Raphson YTM divergence on adversarial inputs. | 100-iteration cap with a clear error message. Default initial guess 0.05 covers normal-range bonds; caller can override `guess`. |
| Parametric VaR assumes normality, which is wrong for fat-tailed returns. | Tool description names the assumption. Historical method is the safe default and is documented as such. EVT / Cornish-Fisher / Monte Carlo are follow-ups. |
| `portfolio_metrics` returns ~10 fields, including some that may be `null`. | Already covered by D5: benchmark-relative fields are present-or-absent based on input shape; `null` only for capture ratios when one direction of returns is empty (documented). |
| Tool roster grows by 3; total goes from 35 (phase 6) to 38. | Within Claude's known-good range. The tools are domain-distinct (portfolio analytics / tail risk / fixed income); the model picks unambiguously based on user intent. |

**Rollback** is a single-commit revert. No DB / contract / SDK / frontend touch.

---

## Acceptance criteria

- [ ] All 21 new test cases pass; pre-existing cases pass without modification.
- [ ] `cd apps/api && npm run test:unit -- analytics.service` is green.
- [ ] `cd apps/api && npm run test:unit` (full suite) is green.
- [ ] `npm run lint && npm run type-check` from repo root are clean.
- [ ] Three new entries in `ToolService.PACK_TOOL_NAMES`; three new tool registrations under the `financial` pack.
- [ ] No frontend, DB, contract, or SDK file is touched.
- [ ] Manual spot-check via the dev portal: a station with the `financial` pack enabled responds correctly to:
  - "Compute portfolio metrics for `daily_return` against the S&P benchmark stored in `spy_returns`." → `portfolio_metrics` with `benchmarkEntity: "spy_returns"`.
  - "What's the 99% historical VaR on this return series?" → `var_cvar` with `confidence: 0.99, method: "historical"`.
  - "Price a 10-year 5% semi-annual coupon bond at a 4.5% yield." → `bond_math` with `op: "price", couponRate: 0.05, yield: 0.045, maturity: 10, frequency: 2`.

---

## Files touched

- New: `apps/api/src/tools/portfolio-metrics.tool.ts`
- New: `apps/api/src/tools/var-cvar.tool.ts`
- New: `apps/api/src/tools/bond-math.tool.ts`
- Edit: `apps/api/src/services/analytics.service.ts`:
  - Add `static portfolioMetrics(...)`, `static varCvar(...)`, `static bondMath(...)`.
  - Add result interfaces `PortfolioMetricsResult`, `VarCvarResult`, `BondMathResult`.
  - Add private helpers as needed (none if `tInverseCDF` from phase 5 covers the standard-normal quantile for parametric VaR, which it does).
- Edit: `apps/api/src/services/tools.service.ts` — register three new tools under the `financial` pack; extend `PACK_TOOL_NAMES`.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — 21 new test cases.

No DB migration. No contract change. No frontend change. No SDK change. No new dependency.
