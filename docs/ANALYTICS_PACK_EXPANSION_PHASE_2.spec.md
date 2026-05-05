# Analytics Pack Expansion — Phase 2 — Spec

**Widen the `describe_column` and `technical_indicator` enums to surface methods that already ship in the underlying libraries (`simple-statistics`, `technicalindicators`).** Two tools change; no new tools are added; no new dependencies are added.

Discovery: `docs/ANALYTICS_PACK_EXPANSION.discovery.md`. Phase 1 (committed in `0417513`): `docs/ANALYTICS_PACK_EXPANSION_PHASE_1.spec.md`.

The phase 2 wedge from the discovery's phasing table:

> **2. Widen enums** — `describe_column` extra stats + `percentiles[]`; `correlate` Spearman/Kendall + p-value; `technical_indicator` extra indicators

`correlate.method` already shipped in phase 1 (Slice 2). The remaining phase-2 work is:

1. `describe_column` — add `variance`, `mode`, `skewness`, `kurtosis`, `iqr`; add an optional `percentiles: number[]` for arbitrary quantiles. New fields are present-or-absent based on input flags per D5; existing fields are byte-stable.
2. `technical_indicator` — add `Stochastic`, `ADX`, `VWAP`, `WilliamsR`, `CCI`, `ROC`, `PSAR`, `Ichimoku` to the indicator enum.

p-values on `correlate` are deferred to phase 4, where the t-distribution / Fisher-z infrastructure for inferential output is built once for the whole `hypothesis_test` tool.

Donchian Channels — listed in the discovery — turns out **not** to ship in `technicalindicators` (verified against `node_modules/technicalindicators/declarations/index.d.ts`). Out of phase 2; would be a hand-rolled addition in a follow-up if demand warrants.

After this phase: a model that asks `describe_column` gets a richer descriptive surface plus arbitrary percentiles in one tool call, and `technical_indicator` covers the canonical retail-trading indicator set without needing nine separate enum extensions across future PRs.

---

## Scope

### In scope (two tools)

1. **`describe_column`** — extend the result with `variance`, `mode`, `skewness`, `kurtosis`, `iqr`. Add an optional `percentiles: number[]` input; when supplied, the result includes a `percentiles: Record<string, number>` map keyed by the percentile string (e.g. `"0.05"`, `"0.95"`).
2. **`technical_indicator`** — extend the indicator enum from `"SMA" | "EMA" | "RSI" | "MACD" | "BB" | "ATR" | "OBV"` to include `"Stochastic" | "ADX" | "VWAP" | "WilliamsR" | "CCI" | "ROC" | "PSAR" | "Ichimoku"`. Service-side: forward to the corresponding `*.calculate({...})` static on the existing import.

### Out of scope

- p-values / t-statistics on `correlate`. Phase 4.
- Donchian Channels. Not in `technicalindicators`; deferred.
- Multivariate / logistic regression. Phase 5.
- Forecasting / decomposition / changepoint. Phase 6.
- TVM / XIRR / bond math / portfolio metrics / VaR. Phases 3 and 7.
- New tool slugs. Phase 2 widens existing tools only; `ToolService.PACK_TOOL_NAMES` is unchanged.
- Frontend changes. The `data-table` rendering path accepts the wider result objects unchanged — it iterates entries on the result, so additional keys render as additional columns automatically.
- DB / contract / SDK changes.

---

## Tool-by-tool surface

### 1. `describe_column`

Existing schema (`apps/api/src/tools/describe-column.tool.ts:11-14`):

```ts
const InputSchema = z.object({
  entity: z.string(),
  column: z.string(),
});
```

New schema:

```ts
const InputSchema = z.object({
  entity: z.string().describe("Entity key (table name)"),
  column: z.string().describe("Numeric column key"),
  percentiles: z
    .array(z.number().min(0).max(1))
    .optional()
    .describe(
      "Optional list of percentiles to compute (each in [0, 1]). " +
        "Returned under `percentiles` keyed by the input number stringified."
    ),
});
```

Existing service-method signature (`AnalyticsService.describeColumn`) returns:

```ts
{ count, mean, median, stddev, min, max, p25, p75 }
```

New return type (additive — no field removed or renamed; `percentiles` is the only conditionally-present field, present iff the input `percentiles` was supplied):

```ts
{
  count: number;
  mean: number;
  median: number;
  stddev: number;
  variance: number;
  mode: number;
  min: number;
  max: number;
  p25: number;
  p75: number;
  iqr: number;
  skewness: number;
  kurtosis: number;
  percentiles?: Record<string, number>;
}
```

Service-side semantics:

- `variance`: `ss.sampleVariance(values)` (n-1 divisor, the convention `simple-statistics` exports under `sampleVariance`).
- `mode`: `ss.mode(values)`. When the input is multimodal, `simple-statistics` returns the smallest mode (deterministic). Document this in a one-line comment on the service method.
- `skewness`: `ss.sampleSkewness(values)`.
- `kurtosis`: `ss.sampleKurtosis(values)` (returns excess kurtosis — `0` for normal). Document the "excess" convention in the result type.
- `iqr`: `p75 - p25`. Computed inline; no library call.
- `percentiles`: when input contains `[0.05, 0.95]`, output contains `{ "0.05": <value>, "0.95": <value> }`. Each percentile passes through `ss.quantile(values, p)`. The string-keyed map keeps the result shape JSON-stable across calls (ordering of keys reflects input order in modern JS).
- Empty-input behavior is preserved: when `values.length === 0`, every numeric field returns `0` (as today) and `percentiles` is omitted from the result if input had `percentiles` non-empty (see "Behavior on edge cases").

`TypeError` / `RangeError` for percentiles outside `[0, 1]` is caught at the Zod layer; the service trusts the input. Single-value inputs (`length === 1`) produce defined `mean`/`median`/`min`/`max`/`mode`, while `stddev`/`variance`/`skewness`/`kurtosis` may be `0` or `NaN` from the underlying library. Document this fall-through behavior in a service comment; do not add custom guards beyond what `simple-statistics` already does.

### 2. `technical_indicator`

Existing schema (`apps/api/src/tools/technical-indicator.tool.ts:11-22`):

```ts
const InputSchema = z.object({
  entity: z.string(),
  dateColumn: z.string(),
  valueColumn: z.string(),
  indicator: z.enum(["SMA", "EMA", "RSI", "MACD", "BB", "ATR", "OBV"]),
  params: z.record(z.string(), z.unknown()).optional(),
});
```

New schema:

```ts
const InputSchema = z.object({
  entity: z.string().describe("Entity key (table name)"),
  dateColumn: z.string().describe("Date column key"),
  valueColumn: z.string().describe("Price/value column key"),
  indicator: z
    .enum([
      "SMA",
      "EMA",
      "RSI",
      "MACD",
      "BB",
      "ATR",
      "OBV",
      "Stochastic",
      "ADX",
      "VWAP",
      "WilliamsR",
      "CCI",
      "ROC",
      "PSAR",
      "Ichimoku",
    ])
    .describe("Indicator type"),
  params: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Optional indicator parameters (e.g. period, stdDev, conversionPeriod, basePeriod, step, max, signalPeriod)"
    ),
});
```

Service-side semantics: extend the existing `switch (indicator)` block in `AnalyticsService.technicalIndicator`. Each new case mirrors the existing pattern — pull supporting columns out of the sorted records when the indicator needs them (HLC, HLCV), apply per-indicator defaults for `period` and friends, and forward to `<Indicator>.calculate({...})`.

Per-indicator input maps and defaults (drawn from `node_modules/technicalindicators/declarations/`):

| Indicator | Required series | Default params |
|---|---|---|
| `Stochastic` | high, low, close | `period: 14`, `signalPeriod: 3` |
| `ADX` | high, low, close | `period: 14` |
| `VWAP` | high, low, close, volume | none |
| `WilliamsR` | high, low, close | `period: 14` |
| `CCI` | high, low, close | `period: 20` |
| `ROC` | close | `period: 12` |
| `PSAR` | high, low | `step: 0.02`, `max: 0.2` |
| `Ichimoku` | high, low | `conversionPeriod: 9`, `basePeriod: 26`, `spanPeriod: 52`, `displacement: 26` |

For HLC / HLCV indicators, supporting-column names follow the existing convention used by `ATR` and `OBV`:

- `extraParams.highColumn ?? "high"`
- `extraParams.lowColumn ?? "low"`
- `extraParams.volumeColumn ?? "volume"`

Output shape unchanged at the *envelope* level: `{ dates: string[]; values: (number | object)[] }`. The element shape inside `values` is determined by the underlying library — scalars (e.g. `number[]` for `SMA`, `EMA`, `RSI`, `ROC`, `WilliamsR`, `CCI`, `VWAP`, `PSAR`, `OBV`, `ADX`'s `result.adx` if we choose to flatten) and objects for `MACD`, `BB`, `Stochastic`, `ADX` (raw output: `{adx, pdi, mdi}`), and `Ichimoku`. The existing `values: (number | object)[]` already accepts both shapes; no envelope change needed.

The existing date-alignment step (`dates.slice(offset)`) works generically and applies unchanged. For `PSAR` the library returns the same length as input — `offset` is 0 — and dates align directly.

### Result-shape policy reminder (D5)

Both changes are strictly additive at the envelope level:

- `describe_column` keeps every existing field; new descriptive fields are unconditionally present; `percentiles` is present iff the input asked for them.
- `technical_indicator` keeps the same `{ dates, values }` envelope; only the inner element shape varies per indicator (already true today for `MACD` vs `SMA`).

No frontend rendering change is needed.

---

## Test plan

All tests are service-layer assertions in `apps/api/src/__tests__/services/analytics.service.test.ts`. Run via `cd apps/api && npm run test:unit -- analytics.service` per `feedback_use_npm_test_scripts`.

Each new test references its fixture inline; references to underlying-library behavior cite the package's own contract.

### `describeColumn()` — expand existing `describe` block

59. **New descriptive fields are present and finite for `NUMERIC_RECORDS.x` (1..15).** Assert `variance`, `mode`, `skewness`, `kurtosis`, `iqr` are all numeric and finite. Hand-derived values for the 1..15 fixture:
    - `variance` = sample variance of 1..15 = 20 (using n-1 divisor).
    - `mode` = 1 (no duplicates → simple-statistics returns the smallest value).
    - `iqr` = p75 − p25.
    - `skewness` ≈ 0 (symmetric integer sequence).
    - `kurtosis` < 0 (uniform-like, platykurtic; excess kurtosis convention).
60. **`variance` is the sample variance (n-1 divisor).** Fixture `[1, 2, 3, 4, 5]`: hand-computed sample variance = 2.5. Assert.
61. **`mode` returns the smallest mode on multimodal inputs.** Fixture `[1, 1, 2, 2, 3]`: assert `mode === 1` (simple-statistics convention).
62. **`skewness` is positive for right-skewed data.** Fixture `[1, 1, 1, 2, 3, 10]` — long right tail. Assert `skewness > 0`.
63. **`kurtosis` is excess kurtosis (≈ 0 for ~normal, negative for uniform).** Fixture: 100 evenly-spaced values from 0 to 99. Assert `kurtosis < 0`.
64. **`iqr` equals `p75 − p25`.** Fixture `NUMERIC_RECORDS.x`. Assert `result.iqr === result.p75 - result.p25`.
65. **`percentiles` field is omitted when the input is omitted.** Default call returns no `percentiles` key. Use `expect("percentiles" in result).toBe(false)` rather than `expect(result.percentiles).toBeUndefined()` so the assertion catches accidental `undefined` values.
66. **`percentiles: [0.05, 0.95]` returns string-keyed entries.** Fixture `NUMERIC_RECORDS.x`. Assert `result.percentiles` exists, `Object.keys(result.percentiles)` deep-equals `["0.05", "0.95"]`, and the values match `ss.quantile(values, 0.05)` / `ss.quantile(values, 0.95)`.
67. **`percentiles: [0.0, 1.0]` returns the min and max.** Same fixture. Assert `result.percentiles["0"] === result.min` and `result.percentiles["1"] === result.max`.
68. **`percentiles: []` (empty array) — `percentiles` field is present and empty.** Assert `Object.keys(result.percentiles).length === 0`. (This distinguishes "user asked for nothing" from "user didn't ask" per D5: presence-or-absence of the *field* tracks presence-or-absence of the *input*.)
69. **Empty records preserve the existing zero-fill behavior and omit `percentiles` when the input had values.** Fixture `[]`, `percentiles: [0.5]`. Assert `result.count === 0`, `result.mean === 0`, and `"percentiles" in result === false` — there is no data to compute against.
70. **Existing fields keep their values byte-stable.** The original `count/mean/median/stddev/min/max/p25/p75` assertions for `NUMERIC_RECORDS.x` (test 824) keep passing without modification.

### `technicalIndicator()` — expand existing `describe` block

71. **`Stochastic` returns objects with `k` and `d` numeric fields.** Fixture: 30 rows with `date`, `high`, `low`, `close` (synthetic price walk). Default `period: 14, signalPeriod: 3`. Assert `result.values.length === records.length - period + 1 - (signalPeriod - 1)` (or just `> 0`), each element has numeric `k`, numeric `d`, and `result.dates.length === result.values.length`.
72. **`ADX` returns objects with `adx`, `pdi`, `mdi` numeric fields.** Same HLC fixture. Assert each element has those three numeric fields.
73. **`VWAP` returns numeric values aligned 1:1 with input rows.** Synthetic HLCV fixture (30 rows). Default no-period — `vwap` accumulates from row 1 onward. Assert `result.values.length === records.length`, every element is a number, `result.dates.length === result.values.length`.
74. **`WilliamsR` returns numeric values, all in the range [-100, 0].** Synthetic HLC fixture, `period: 14`. Assert each value is `≤ 0` and `≥ -100`.
75. **`CCI` returns numeric values.** HLC fixture, default `period: 20`. Assert numeric, length matches `records.length - period + 1`.
76. **`ROC` returns numeric values.** Close-only fixture, default `period: 12`. Assert length matches input length minus the offset.
77. **`PSAR` returns numeric values one-per-input-row (offset 0).** HL fixture, defaults `step: 0.02, max: 0.2`. Assert `result.values.length === records.length`.
78. **`Ichimoku` returns objects with `conversion`, `base`, `spanA`, `spanB` numeric fields.** HL fixture (60 rows so the longest period — `spanPeriod: 52` — produces output). Assert object shape on each element.
79. **Per-indicator `params` overrides flow through.** For `Stochastic`, pass `params: { period: 5, signalPeriod: 2 }`; for `ADX`, pass `params: { period: 5 }`; for `Ichimoku`, pass `params: { conversionPeriod: 5, basePeriod: 10, spanPeriod: 20, displacement: 10 }`. In each case assert the result length differs from the default-params length on the same fixture (proves the override is wired).
80. **Existing indicators' results are byte-stable.** The current tests for `SMA/EMA/RSI/MACD/BB/ATR/OBV` keep passing without modification.

Total new cases: 22 across the two tools. None require randomness; each fixture is small, deterministic, and inline.

---

## Behavior on edge cases

- **`describe_column` with `percentiles` containing duplicates.** `[0.5, 0.5]` → result keys are deduplicated by JS object semantics (second write overwrites first). Document in a one-line comment that callers should pass distinct percentiles. Not worth a Zod refinement — the model rarely sends duplicates and the back-stop is benign.
- **`describe_column` with NaN-producing inputs (single-value, all-equal).** Pass-through to `simple-statistics`; it returns `0` for variance/stddev when the input is uniform and may emit `NaN` for skewness/kurtosis when n < 3. The service does not transform these — consumers (the model interpreting the result) can read the inputs and reason about it. A guard would force an opinionated semantic that is not the service's call to make.
- **`technical_indicator` with insufficient data.** When `records.length < period`, `technicalindicators` returns an empty `result` array. The existing offset alignment (`dates.slice(offset)`) handles this — `dates.length` becomes 0. No new branch needed.
- **`technical_indicator` Ichimoku with `displacement` longer than the series.** The library still returns one element per "computable" row; the displacement only affects the cloud projection metadata. Output shape is preserved; no special handling.
- **`technical_indicator` with HLC indicators when `high`/`low`/`close` columns are missing.** Existing pattern (`Number(r[col] ?? "high")`) produces `NaN` for every row, and the underlying library either errors or returns garbage. The service does not pre-validate; the model is expected to know its own column names. Pre-validation is a phase-4 concern (we already deferred it for `ATR`/`OBV` which have the same shape).

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Adding fields to `describe_column` widens the per-call response payload. | The added fields are 5 numeric scalars + an optional `percentiles` map. Negligible bytes per call; no streaming change. |
| Frontend renderer breaks on new shapes. | The `data-table` block iterates `Object.entries(result)` and renders each as a row. New numeric keys render as new rows; the frontend has been doing this with `MACD`/`BB` object outputs from day one. No frontend change. |
| `simple-statistics` mode/skewness/kurtosis behavior on tiny inputs surprises users. | Test 69 covers the empty-input case; small-n cases fall through to library behavior, documented in a one-line service comment. |
| `Ichimoku` requires a long-enough fixture to produce output. | Test 78 uses a 60-row fixture explicitly; smaller fixtures would return zero-length output, which is "no error, no result," matching existing behavior. |
| `technicalindicators` PSAR output is the same length as input — different from other indicators. | Verified against the type definitions (`PSAR.calculate(...)` returns `number[]` aligned 1:1). The existing `dates.slice(offset)` math handles `offset === 0` correctly. |
| Donchian was promised in the discovery but isn't shipping in phase 2. | Documented in this spec's "Out of scope" + "Discovery delta" sections. If a user explicitly asks, hand-rolling Donchian (rolling N-period high and low) is ~25 lines — small follow-up. |
| The model's tool-selection accuracy degrades with a longer `indicator` enum. | Going from 7 to 15 indicators is well within Claude's known good range; the description list itself ("trend / momentum / volatility / volume") naturally chunks. Spot-check during manual smoke. |

**Rollback** is a single-commit revert. Output shapes are additive at the envelope level; downstream renderers and pinned results are unaffected. No DB migration to undo.

---

## Acceptance criteria

- [ ] All 22 new test cases pass; pre-existing cases pass without modification.
- [ ] `cd apps/api && npm run test:unit -- analytics.service` is green.
- [ ] `cd apps/api && npm run test:unit` (full suite) is green.
- [ ] `npm run lint && npm run type-check` from repo root are clean.
- [ ] No new entries in `ToolService.PACK_TOOL_NAMES` (`tools.service.ts:88`) and no new entries in `ALL_TOOL_PACKS` (`tools.service.ts:67`).
- [ ] No frontend, DB, contract, or SDK file is touched.
- [ ] Manual spot-check via the dev portal: a station with `statistics` + `financial` packs enabled responds correctly to "describe `revenue` with the 5th and 95th percentiles" (verify the `percentiles` map appears) and "compute the ADX of `close` with default period" (verify the 3-field per-row object output renders).

---

## Files touched

- Edit: `apps/api/src/tools/describe-column.tool.ts` — add `percentiles` field.
- Edit: `apps/api/src/tools/technical-indicator.tool.ts` — extend `indicator` enum; tweak description text.
- Edit: `apps/api/src/services/analytics.service.ts`:
  - `describeColumn`: add `variance`, `mode`, `skewness`, `kurtosis`, `iqr`, optional `percentiles`. Update return type (`DescribeColumnResult`).
  - `technicalIndicator`: extend the `switch` with eight new cases (Stochastic, ADX, VWAP, WilliamsR, CCI, ROC, PSAR, Ichimoku); extend the indicator type union.
  - Imports from `technicalindicators` widen to include the new classes.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — 22 new test cases per the test plan.

No DB migration. No contract change. No frontend change. No SDK change. No new dependency.
