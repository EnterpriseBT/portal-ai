# Analytics Pack Expansion — Discovery

## Goal

Broaden the `statistics`, `regression`, and `financial` tool packs so the
portal-session model can answer analytical questions across a wider range of
domains than the current "first 80%" surface allows. Today each pack is a
thin enum-wall over a richer underlying library (`simple-statistics`,
`ml-kmeans`, `arquero`, `financial`, `technicalindicators`); the goal is to
widen those enums, parameterize defaults that are silently rigid, and add a
small number of net-new tools where a real capability gap exists.

Concretely, the audit on the current packs identified three classes of gap:

1. **Coverage** — common, well-known methods that the underlying libraries
   already implement but that no tool exposes (e.g. Spearman correlation,
   PV/FV/PMT/RATE/NPER, XIRR/XNPV, Sortino, Stochastic / ADX / VWAP).
2. **Configurability** — methods that exist but with hardcoded knobs the
   model cannot override (Z-score threshold = 3, IQR multiplier = 1.5,
   polynomial degree default = 2, Sharpe annualization = √252 only,
   amortization compounding = monthly only).
3. **Capability** — categories of analysis that are absent and require new
   tools: hypothesis tests, multivariate / logistic regression with
   diagnostics, time-series forecasting, bond/option math, portfolio risk
   versus a benchmark.

Out of scope for this discovery:

- Replacing or restructuring the four underlying libraries. The tools stay
  as forwarding wrappers; we are not adopting a new stats engine.
- AI-assisted method selection (e.g. "pick the right test for me"). The
  tools stay generic and deterministic; method selection is the model's
  job, the same way it picks `sql_query` versus `visualize` today.
- Per-organization or per-station gating of which methods inside a pack
  are exposed. v1 ships a uniform surface; gating is a follow-up if it
  becomes necessary.
- Custom user-defined tools beyond what the existing webhook mechanism
  already provides.
- Frontend rendering of new result shapes. Each new tool returns
  `data-table`-compatible output (rows / dates+values / scalar fields)
  unless a chart is genuinely the right surface, in which case the
  existing `visualize` / `visualize_tree` path handles it.

---

## Existing State

### Where tools live

Every analytics tool is a class under `apps/api/src/tools/<slug>.tool.ts`,
extending the abstract `Tool<TSchema>` base in
`apps/api/src/types/tools.ts`. Each class declares `slug`, `name`,
`description`, a Zod `schema`, and a `build(...)` method that returns the
Vercel AI SDK `tool({ description, inputSchema, execute })` object. The
`execute` body forwards to a static method on `AnalyticsService`.

Adding a new tool is mechanical: a new file under `tools/`, a new static
method on `AnalyticsService`, registration in `ToolService`. Widening an
existing tool is even smaller: extend the enum / Zod object, forward the
new parameter to the existing service method.

### Pack composition

`apps/api/src/services/tools.service.ts:159` (`buildAnalyticsTools`) is the
single place where pack membership is materialized:

- `statistics` → `describe_column`, `correlate`, `detect_outliers`,
  `cluster` (lines 204-209).
- `regression` → `regression`, `trend` (lines 214-217).
- `financial` → `technical_indicator`, `npv`, `irr`, `amortize`,
  `sharpe_ratio`, `max_drawdown`, `rolling_returns` (lines 222-232).

The `ALL_TOOL_PACKS` constant (line 67) is the source of truth for which
pack names a station may enable; `PACK_TOOL_NAMES` (line 88) gates webhook
name conflicts and must list every built-in tool.

### Underlying libraries already in scope

`apps/api/src/services/analytics.service.ts:25-31` imports:

- `simple-statistics` — descriptive stats, correlation, regression,
  hypothesis tests (t-test, χ², Mann–Whitney, Wilcoxon are present in
  the package but not surfaced).
- `arquero` — group-by / pivot / window functions (currently used only
  inside `trend`).
- `ml-kmeans` — k-means clustering (no other clusterer in scope).
- `financial` — IRR, NPV, PMT, FV, PV, RATE, NPER, SLN, DDB, XIRR, XNPV
  (only `npv`, `irr`, and `pmt`-via-`amortize` are surfaced).
- `technicalindicators` — SMA, EMA, RSI, MACD, BB, ATR, OBV exposed;
  Stochastic, ADX, VWAP, Donchian, Williams %R, CCI, ROC, PSAR, Ichimoku
  are also in the package but not surfaced.

This is important: most of the recommended additions below are *zero new
dependencies* — they widen what we already pull in.

### Where defaults are hardcoded

The audit flagged the following fixed knobs:

| File | Line | Hardcoded value | Why it matters |
|---|---|---|---|
| `analytics.service.ts` | 1140 | `Math.abs((v - m) / std) > 3` | Z threshold not tunable. |
| `analytics.service.ts` | 1128-1129 | `q1 - 1.5 * iqr`, `q3 + 1.5 * iqr` | IQR multiplier not tunable. |
| `analytics.service.ts` | 1219 | `params.degree ?? 2` | Polynomial degree exposed in service but not in `regression.tool.ts:15`. |
| `analytics.service.ts` | 1410 | `annualRate / 12` | Amortization is monthly-only. |
| `analytics.service.ts` | 1465 | `Math.sqrt(252)` | Sharpe annualization assumes daily data. |

These are independently fixable inside each existing tool — they do not
require new tools, only Zod-schema additions.

### Existing tests

`apps/api/src/__tests__/services/analytics.service.test.ts` covers the
service-layer happy paths for every method already in the service. It is
the natural home for new method tests; the per-tool `*.tool.ts` files are
thin enough that a single forwarding-shape test per tool is sufficient.

---

## Approach

The guiding principle: **prefer widening existing tools over creating new
ones.** A model that already knows about `correlate` will reach for it
before reading a new tool's description; if `correlate` accepts a `method`
parameter for `pearson | spearman | kendall`, the model gets the new
capability for free without bloating the tool roster. New tools land only
where the input shape or output shape is genuinely different (hypothesis
tests, forecasting, bond math).

The work breaks naturally into three layers per pack:

1. **Parameterize hardcoded defaults** (no schema change for the user; new
   optional fields on existing tools).
2. **Widen enums** to expose methods already in the underlying libraries.
3. **Add new tools** for capabilities the existing roster cannot represent.

### Statistics pack

**Parameterize defaults**

- `detect_outliers`: add `threshold` (default 3 for `zscore`, 1.5 for
  `iqr`); add `mad` as a third method (median-absolute-deviation).
- `cluster`: add optional `standardize: boolean` (z-score each column
  before fitting), optional `seed`, optional `maxIterations`.

**Widen enums**

- `describe_column`: add `variance`, `mode`, `skewness`, `kurtosis`,
  `iqr`, plus an optional `percentiles: number[]` array so the model
  can ask for arbitrary quantiles (e.g. `[0.05, 0.95]` for tails).
  All available in `simple-statistics`.
- `correlate`: add `method: "pearson" | "spearman" | "kendall"`
  (default `pearson` — existing callers unchanged) and return
  `pValue` alongside the coefficient when the method supports it.

**New tools**

- `hypothesis_test` — single tool with a `test` enum:
  `t_test_one_sample | t_test_two_sample | t_test_paired | chi_squared |
  mann_whitney | wilcoxon | ks_two_sample`. Inputs are entity/column
  references plus method-specific params; output is `{ statistic,
  pValue, df?, criticalValue? }`. All seven exist in
  `simple-statistics`; one tool with a switch is cheaper than seven
  tools.
- `aggregate` — group-by + aggregation surface backed by Arquero.
  Inputs: `entity`, `groupBy: string[]`, `metrics: { column, op:
  count|sum|mean|median|min|max|stddev|p25|p75 }[]`. This is the
  escape hatch we keep finding ourselves wishing for in the audit; it
  sidesteps a long tail of one-off tools (`count_by`, `sum_by`,
  `pivot`) by exposing the primitive directly. Arquero is already
  imported; the implementation is small.

### Regression pack

**Parameterize defaults**

- `regression`: surface `degree` on the tool's Zod schema (it already
  exists in the service signature). Add optional `intercept: boolean`
  (default true) for fits forced through the origin.
- `trend`: add optional `forecastPeriods: number` so the linear fit is
  projected `n` periods past the last bucket. This is a one-line
  service-layer change and turns a descriptive tool into a minimum-viable
  forecast.

**Widen tools**

- `regression`: add `multivariate: boolean` plus an `xColumns: string[]`
  alternative to the single `x` field, returning a coefficient vector.
  `simple-statistics` does not support multivariate directly; we either
  add `ml-regression-multivariate-linear` (small, focused) or implement
  via normal equations the same way `polynomialFit` already does
  (`analytics.service.ts:1595`).
- `regression`: extend output with `residuals`, `standardErrors`,
  `tStatistics`, `pValues`, and `confidenceIntervals` so the model can
  reason about fit quality, not just R².

**New tools**

- `logistic_regression` — binary outcome, returns coefficients +
  per-row probabilities + log-loss. The classification companion to
  `regression`. Use `ml-logistic-regression` (small, focused dep) or
  the gradient-descent path already common in the JS ecosystem.
- `forecast` — time-series forecasting with `method: "ets" | "arima" |
  "holt_winters"` and `horizon: number`. Output mirrors `trend`'s shape
  (`dates`, `values`) plus `forecast: { date, point, lower, upper }`.
  This is the largest single addition; it requires either
  `nixtla`-style endpoints (out of scope — external service) or pure-JS
  packages such as `@stdlib/stats-arima`. Recommended scoping: ship
  Holt-Winters first (no new dep — implementable in ~50 lines on top of
  existing series handling); ARIMA in a follow-up.
- `decompose` — STL / classical seasonal decomposition. Output:
  `{ trend, seasonal, residual }` arrays. Cheap once we have the
  Holt-Winters helper.
- `changepoint` — detect structural breaks in a series via PELT or a
  CUSUM heuristic. Single optional dep (`changepoint-detection` or
  hand-rolled CUSUM in ~40 lines).

### Financial pack

**Parameterize defaults**

- `amortize`: add `compounding: "monthly" | "weekly" | "biweekly" |
  "quarterly" | "annual"` (default `"monthly"`); add optional
  `extraPayment` per period for prepayment scenarios.
- `sharpe_ratio`: replace the boolean `annualize` with `periodicity:
  "daily" | "weekly" | "monthly" | "annual"` so √252, √52, √12, or 1
  is selected appropriately.

**Widen tools**

- `technical_indicator`: extend the indicator enum to include
  `Stochastic`, `ADX`, `VWAP`, `Donchian`, `WilliamsR`, `CCI`, `ROC`,
  `PSAR`, `Ichimoku`. All are already in `technicalindicators`; this
  is a switch-statement extension, no new dep.

**New tools**

- `tvm` — single time-value-of-money tool with `op: "pv" | "fv" | "pmt"
  | "rate" | "nper"` and the appropriate other parameters. All five
  functions are in `financial`. Bundling them into one tool keeps the
  roster small and matches how the model already reasons about TVM
  problems (the unknown shifts; the formula does not).
- `xirr` / `xnpv` — irregular-cash-flow IRR/NPV with explicit dates.
  Critical for VC/PE/portfolio cashflow analysis where periods are not
  evenly spaced. Already in the `financial` library.
- `bond_math` — `op: "ytm" | "duration" | "convexity" | "price"` over a
  bond with `face`, `coupon`, `maturity`, `frequency`, optional `yield`
  / `price`. Hand-rolled (~80 lines, no new dep).
- `portfolio_metrics` — single tool returning `{ totalReturn, cagr,
  sortino, calmar, beta?, alpha?, informationRatio?, trackingError?,
  upCapture?, downCapture? }`. Inputs: an `entity` of returns plus an
  optional `benchmarkEntity`. The benchmark-relative metrics are
  emitted only when a benchmark is supplied. Implementation is
  arithmetic over `simple-statistics` primitives.
- `var_cvar` — historical Value-at-Risk and Conditional VaR at a
  configurable confidence level. Inputs: returns column, `confidence:
  number` (default 0.95), `method: "historical" | "parametric"`. ~30
  lines.
- `depreciation` — `method: "straight_line" | "declining_balance" |
  "double_declining_balance"`. `financial` already provides `sln` and
  `ddb`; the tool is a thin forwarding wrapper.

### Cross-cutting changes

- **Defaults expressed via `.optional().default(...)` in Zod**, not via
  `??` fallbacks inside `execute`. This makes the JSON schema the model
  sees self-document the default and matches the project's existing
  convention.
- **Result shapes stay JSON-stable.** New optional fields (`pValue`,
  `residuals`) are always present-or-absent based on input flags, never
  reshape based on data. Pinning + `data-table` rendering rely on
  predictable column lists.
- **No backwards-compat aliases.** Existing tool slugs and result fields
  do not move. New params are additive. If a future revision *renames*
  something, that lands as a clean cut, not a deprecation alias.
- **Heuristic, not AI.** None of these tools call the model internally.
  They are deterministic numeric functions; the model picks the right
  one. (Consistent with how `correlate`, `regression`, etc. work today.)

---

## Recommended phasing

The work decomposes naturally; each phase ships independently and
provides standalone value.

| Phase | Scope | Why first |
|---|---|---|
| 1. **Parameterize defaults** | `detect_outliers` thresholds, `cluster` standardization, `regression.degree`, `amortize.compounding`, `sharpe_ratio.periodicity` | Smallest diff, highest user-visible flexibility, no new tools or deps. |
| 2. **Widen enums** | `describe_column` extra stats + `percentiles[]`; `correlate` Spearman/Kendall + p-value; `technical_indicator` extra indicators | Pure forwarding to libs already in scope. Doubles indicator coverage and triples descriptive coverage with ~150 lines. |
| 3. **TVM consolidation** | `tvm`, `xirr`, `xnpv`, `depreciation` | Plugs the most-asked-for finance gaps; all backed by `financial`. |
| 4. **Statistics inference** | `hypothesis_test`, `aggregate` | Adds inferential capability + the Arquero escape hatch. |
| 5. **Regression diagnostics + multivariate** | Multivariate inputs, residuals, t-stats, p-values, CIs on `regression`; `logistic_regression` | First substantive change to the regression pack. May add one focused dep. |
| 6. **Forecasting** | `forecast` (Holt-Winters), `decompose`, `changepoint`, `trend.forecastPeriods` | Largest single capability addition; deserves its own phase. |
| 7. **Portfolio + risk** | `portfolio_metrics`, `var_cvar`, `bond_math` | Closes the institutional-finance gap. |

Phases 1-3 are essentially free (no new deps, no new tools or one trivial
new tool); phases 4-7 each warrant their own spec.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Tool roster grows large enough to dilute the model's tool-selection accuracy. | Prefer widening existing enums (`correlate.method`, indicator list) over new tools. The phasing above adds ~10 net-new tools across all phases, not 30. |
| New optional parameters confuse the model into always specifying them. | Defaults flow through Zod's `.default(...)` so the JSON schema documents "this is the safe value to omit." Tool descriptions stay short and example-free unless evals show the model getting it wrong. |
| Hardcoded-default removal silently changes results for existing portal sessions. | None of phase 1 changes default behavior — every parameterized field keeps the current value as its `.default(...)`. The widening is additive. |
| New deps (`ml-regression-multivariate-linear`, `ml-logistic-regression`, ARIMA pkg) bring transitive bloat. | Each new dep proposed above is small and focused. We evaluate per-phase; multivariate regression can land via normal equations (no dep) if an audit of the proposed package is unfavorable. |
| Statistical methods implemented incorrectly produce confidently wrong numbers. | All proposed methods have closed-form references in their underlying libraries or in standard texts. Service-layer tests assert against known fixtures (textbook examples). No method ships without a fixture test. |
| Forecast tool overpromises. | Tool description is explicit: "univariate, no exogenous variables, suitable for short horizons; not a substitute for a domain forecasting system." The model is much better at picking conservatively when the description names the limits. |
| Benchmark-relative portfolio metrics emit `null` fields and confuse downstream rendering. | Use field-presence rather than null: `portfolioMetrics` only emits the benchmark-relative keys when `benchmarkEntity` is supplied. `data-table` rendering of dynamic key-sets is already supported. |

---

## Decision points for the spec phase

1. **Scope of phase 1.** Just defaults, or also bundle the Spearman /
   Kendall enum extension since it is a one-line forwarding change?
   Recommend: bundle. Both touch the same files and ship together
   without raising the surface area.
2. **Where multivariate regression lives.** Add `multivariate: boolean`
   + `xColumns: string[]` to the existing `regression` tool, or split
   into a separate `multiple_regression` tool? Recommend: same tool,
   discriminator field. The model will reach for `regression` first
   regardless; one tool with a wider schema is friendlier than two
   tools that overlap.
3. **One `hypothesis_test` tool with a `test` enum vs. one tool per
   test.** Recommend: one tool, enum. Seven near-identical tool entries
   would crowd the tool list; the inputs are similar enough that a
   discriminated union on `test` is readable.
4. **`forecast` library choice.** Pure-JS Holt-Winters first (no dep),
   ARIMA via `@stdlib/stats-arima` or equivalent in a follow-up. Locked
   in spec.
5. **Result-shape policy for new fields.** Ratify the
   "presence-or-absence, never-reshape" rule above so `data-table`
   rendering and pinning behavior stay stable across optional inputs.
6. **Test fixture sourcing.** Use textbook reference values
   (Wackerly/Mendenhall for stats, Fabozzi for fixed income, Hyndman
   for time series) so service-layer tests can assert exact numerics
   rather than property-style "is finite" checks.

---

## Files touched (anticipated)

Per phase. Phase 1 alone touches the fewest:

**Phase 1 (parameterize defaults)**

- `apps/api/src/tools/detect-outliers.tool.ts` — add `threshold` field.
- `apps/api/src/tools/cluster.tool.ts` — add `standardize`, `seed`,
  `maxIterations`.
- `apps/api/src/tools/regression.tool.ts` — surface `degree`.
- `apps/api/src/tools/amortize.tool.ts` — add `compounding`,
  `extraPayment`.
- `apps/api/src/tools/sharpe-ratio.tool.ts` — replace `annualize` with
  `periodicity`.
- `apps/api/src/services/analytics.service.ts` — thread the new
  parameters through; remove hardcoded constants flagged above.
- `apps/api/src/__tests__/services/analytics.service.test.ts` — fixture
  tests for each new parameter at default and at non-default values.

**Phase 2 onward** adds new tool files under `apps/api/src/tools/`, new
static methods on `AnalyticsService`, registration entries in
`tools.service.ts:159` (and `PACK_TOOL_NAMES` at line 88), and
fixture-backed test blocks. Each phase gets its own spec with a precise
file list.

No DB migration, no contract change, no frontend change, no SDK surface
change in any phase. The portal session's rendering pipeline accepts
arbitrary `data-table` column sets, so new tool outputs flow through
unchanged.
