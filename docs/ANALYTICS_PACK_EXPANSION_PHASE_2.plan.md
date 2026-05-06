# Analytics Pack Expansion — Phase 2 — Plan

**TDD-sequenced implementation of the two tool widenings in phase 2: `describe_column` and `technical_indicator`.**

Spec: `docs/ANALYTICS_PACK_EXPANSION_PHASE_2.spec.md`. Discovery: `docs/ANALYTICS_PACK_EXPANSION.discovery.md`. Phase 1 commit: `0417513`.

Two slices, one per tool. Each slice follows the same loop established in phase 1:

1. Write failing service-layer tests for the new behavior.
2. Implement the service-side change.
3. Widen the tool-file Zod schema and forward the new params.
4. Run the focused test suite; confirm green.
5. Run lint + type-check after both slices.

Run tests with `cd apps/api && npm run test:unit -- analytics.service` per `feedback_use_npm_test_scripts` — never invoke jest directly.

Slice order: `describe_column` first (smaller surface), `technical_indicator` second (eight new cases on a `switch`). They are independent; either could go first.

---

## Slice 1 — `describe_column` adds `variance`, `mode`, `skewness`, `kurtosis`, `iqr`, `percentiles`

**Files**

- Edit: `apps/api/src/tools/describe-column.tool.ts` — add `percentiles` to `InputSchema`, forward in `execute`.
- Edit: `apps/api/src/services/analytics.service.ts`:
  - Update `DescribeColumnResult` type (find the existing declaration; in the type-aliases block at the top of the file).
  - Add the five new always-present fields and the optional `percentiles` map.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — extend `describe("describeColumn()", ...)`.

**Steps**

1. **Audit the existing `DescribeColumnResult` declaration.** `cd apps/api && grep -n "DescribeColumnResult" src`. The interface lives in `analytics.service.ts` near the other result-type aliases. Record the current shape — every field is currently `number`. Mirror that style: new fields are `number`; `percentiles` is `Record<string, number>` and optional.

2. **Write failing tests** (spec cases 59–70). The spec lists 12 cases for this slice; all live inside the existing `describe("describeColumn()", ...)` block.
   - For test 59, the 1..15 fixture's hand-derived sample variance is 20 (verify by recomputing: mean = 8, sum of squared deviations = 280, n-1 = 14, 280/14 = 20).
   - For test 60, sample variance of `[1,2,3,4,5]` is exactly 2.5 (mean 3, sum sq dev 10, n-1 = 4, 10/4 = 2.5). Use `expect(result.variance).toBe(2.5)` — exact equality is fine because the math is closed-form on integers.
   - For test 61, multimodal `[1,1,2,2,3]` — `simple-statistics`'s `mode` returns the smallest value tied for highest frequency, so `1`. If the test surfaces a different convention, switch to `expect([1, 2]).toContain(result.mode)` and document.
   - For test 65, use the explicit `expect("percentiles" in result).toBe(false)` form. Jest's default `toBeUndefined()` would also pass on a literal `undefined` value, which is *not* what we want — the spec says the field must be absent, not present-with-undefined.
   - For test 68 (empty-array `percentiles`), `Object.keys(result.percentiles).length === 0` confirms presence.
   - For test 69, the empty-records fixture must omit `percentiles` even though the input requested it (no data to compute). This requires a service-level guard: when `values.length === 0`, return the existing zero-fill without a `percentiles` field. Lock in during implementation.
   - Run the suite; the new tests fail because the service still returns the original 8-field shape.

3. **Update `DescribeColumnResult`.** Locate the type declaration (top of `analytics.service.ts`); change to:

   ```ts
   export interface DescribeColumnResult {
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
     /** Excess kurtosis (0 for ~normal). */
     skewness: number;
     kurtosis: number;
     percentiles?: Record<string, number>;
   }
   ```

   Verify that `simple-statistics` exports `sampleVariance`, `sampleSkewness`, `sampleKurtosis`, `mode`, `quantile` (already used). All present per the audit in phase 1's discovery.

4. **Service-side change.** Replace the body of `describeColumn`:

   ```ts
   static describeColumn(params: {
     records: Record<string, unknown>[];
     column: string;
     percentiles?: number[];
   }): DescribeColumnResult {
     const values = this.extractNumericColumn(params.records, params.column);
     if (values.length === 0) {
       return {
         count: 0,
         mean: 0,
         median: 0,
         stddev: 0,
         variance: 0,
         mode: 0,
         min: 0,
         max: 0,
         p25: 0,
         p75: 0,
         iqr: 0,
         skewness: 0,
         kurtosis: 0,
       };
     }

     const p25 = ss.quantile(values, 0.25);
     const p75 = ss.quantile(values, 0.75);
     const result: DescribeColumnResult = {
       count: values.length,
       mean: ss.mean(values),
       median: ss.median(values),
       stddev: ss.standardDeviation(values),
       variance: ss.sampleVariance(values),
       // simple-statistics returns the smallest value tied for highest
       // frequency on multimodal inputs.
       mode: ss.mode(values),
       min: ss.min(values),
       max: ss.max(values),
       p25,
       p75,
       iqr: p75 - p25,
       skewness: ss.sampleSkewness(values),
       // Excess kurtosis (≈ 0 for normal, < 0 for uniform/platykurtic).
       kurtosis: ss.sampleKurtosis(values),
     };

     if (params.percentiles !== undefined) {
       const map: Record<string, number> = {};
       for (const p of params.percentiles) {
         map[String(p)] = ss.quantile(values, p);
       }
       result.percentiles = map;
     }

     return result;
   }
   ```

   The two new `simple-statistics` imports (`sampleVariance`, `sampleSkewness`, `sampleKurtosis`, `mode`) are not new at the module level — the file already imports `* as ss from "simple-statistics"`. No import edit needed.

5. **Tool-side change.** Update `apps/api/src/tools/describe-column.tool.ts`:

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

   Update the `description` string on the tool to mention the wider surface:

   ```ts
   description =
     "Compute descriptive statistics (count, mean, median, stddev, variance, mode, min/max, p25/p75, IQR, skewness, kurtosis) for a numeric column. Optionally include arbitrary percentiles.";
   ```

   Forward in `execute`:
   ```ts
   const { entity, column, percentiles } = this.validate(input);
   const records = getRecords(stationData, entity);
   return AnalyticsService.describeColumn({ records, column, percentiles });
   ```

6. **Run focused suite.** `cd apps/api && npm run test:unit -- describeColumn`. All 12 new + existing 2 = 14 cases green.

7. **Lint + type-check** (deferred to end of phase if both slices change types similarly; safe to run now).

**Done when:** spec tests 59–70 pass; existing `describeColumn()` tests still pass.

**Risk:** the empty-records guard must run *before* the optional `percentiles` block so an empty-records call with `percentiles: [0.5]` still returns the 13-field zero-fill without an empty `percentiles` map. The `if (values.length === 0) return {...}` early-return handles this — verify against test 69.

---

## Slice 2 — `technical_indicator` adds Stochastic, ADX, VWAP, WilliamsR, CCI, ROC, PSAR, Ichimoku

**Files**

- Edit: `apps/api/src/tools/technical-indicator.tool.ts` — extend `indicator` enum; tweak description.
- Edit: `apps/api/src/services/analytics.service.ts`:
  - Extend the `technicalindicators` import to include `Stochastic`, `ADX`, `VWAP`, `WilliamsR`, `CCI`, `ROC`, `PSAR`, `IchimokuCloud`.
  - Extend the `indicator` type union on `technicalIndicator(...)`.
  - Add eight new `case` branches inside the existing `switch`.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — extend `describe("technicalIndicator()", ...)`.

**Steps**

1. **Confirm the import surface.** Read `analytics.service.ts` lines 30-40 (the `technicalindicators` import block). Verify the package's runtime exports match the type-declaration filenames seen in `node_modules/technicalindicators/declarations/index.d.ts`. Concretely: `Stochastic`, `ADX`, `VWAP`, `WilliamsR`, `CCI`, `ROC`, `PSAR`, `IchimokuCloud` — note Ichimoku's *class* name is `IchimokuCloud` even though the indicator enum uses the shorter `"Ichimoku"`.

2. **Build the synthetic OHLCV fixture helper** at the top of the existing `describe("technicalIndicator()", ...)` block (or in a `beforeAll` if helpers already aggregate there). The phase-1 tests use inline fixtures — match that style:

   ```ts
   const makeOHLCV = (n: number) =>
     Array.from({ length: n }, (_, i) => {
       const close = 100 + Math.sin(i / 3) * 5 + i * 0.1;
       return {
         date: `2024-01-${String(i + 1).padStart(2, "0")}`,
         high: close + 1,
         low: close - 1,
         close,
         open: close - 0.5,
         volume: 1000 + i * 10,
       };
     });
   ```

   Deterministic — `Math.sin` is stable, no `Math.random()`. Used by every new indicator test.

3. **Write failing tests** (spec cases 71–80). All eight new indicator tests use `makeOHLCV(30)` (or `makeOHLCV(60)` for `Ichimoku`). Per-test pattern:

   ```ts
   it("Stochastic returns objects with k and d numeric fields", () => {
     const records = makeOHLCV(30);
     const result = AnalyticsService.technicalIndicator({
       records,
       dateColumn: "date",
       valueColumn: "close",
       indicator: "Stochastic",
     });
     expect(result.values.length).toBeGreaterThan(0);
     expect(result.dates.length).toBe(result.values.length);
     for (const v of result.values) {
       expect(typeof (v as { k: number }).k).toBe("number");
       expect(typeof (v as { d: number }).d).toBe("number");
     }
   });
   ```

   For test 79 (`params` overrides), pick three indicators where the override visibly changes output length:
   - `Stochastic` with `period: 5, signalPeriod: 2` produces more elements than the default `14, 3`.
   - `ADX` with `period: 5` vs default `14`.
   - `Ichimoku` with the shorter periods `5, 10, 20, 10` produces output starting earlier.

   Run; expect all 8 indicator-specific tests to fail because the `default: throw new Error('Unsupported indicator')` branch fires.

4. **Service-side change — extend the import.** Locate the existing import block:

   ```ts
   import {
     SMA,
     EMA,
     RSI,
     MACD,
     BollingerBands,
     ATR,
     OBV,
   } from "technicalindicators";
   ```

   Extend to:

   ```ts
   import {
     SMA,
     EMA,
     RSI,
     MACD,
     BollingerBands,
     ATR,
     OBV,
     Stochastic,
     ADX,
     VWAP,
     WilliamsR,
     CCI,
     ROC,
     PSAR,
     IchimokuCloud,
   } from "technicalindicators";
   ```

5. **Service-side change — extend the type union and switch.** Update the `indicator` field type:

   ```ts
   indicator:
     | "SMA"
     | "EMA"
     | "RSI"
     | "MACD"
     | "BB"
     | "ATR"
     | "OBV"
     | "Stochastic"
     | "ADX"
     | "VWAP"
     | "WilliamsR"
     | "CCI"
     | "ROC"
     | "PSAR"
     | "Ichimoku";
   ```

   Add eight `case` branches inside the existing `switch (indicator)`. Pattern (use `ATR`/`OBV` as templates — they already pull HLC/HLCV columns out of `sorted`):

   ```ts
   case "Stochastic": {
     const period = (extraParams.period as number) ?? 14;
     const signalPeriod = (extraParams.signalPeriod as number) ?? 3;
     const high = sorted.map((r) =>
       Number(r[(extraParams.highColumn as string) ?? "high"])
     );
     const low = sorted.map((r) =>
       Number(r[(extraParams.lowColumn as string) ?? "low"])
     );
     values = Stochastic.calculate({
       period,
       signalPeriod,
       high,
       low,
       close: closePrices,
     }) as object[];
     break;
   }
   case "ADX": {
     const period = (extraParams.period as number) ?? 14;
     const high = sorted.map((r) =>
       Number(r[(extraParams.highColumn as string) ?? "high"])
     );
     const low = sorted.map((r) =>
       Number(r[(extraParams.lowColumn as string) ?? "low"])
     );
     values = ADX.calculate({ period, high, low, close: closePrices }) as object[];
     break;
   }
   case "VWAP": {
     const high = sorted.map((r) =>
       Number(r[(extraParams.highColumn as string) ?? "high"])
     );
     const low = sorted.map((r) =>
       Number(r[(extraParams.lowColumn as string) ?? "low"])
     );
     const volume = sorted.map((r) =>
       Number(r[(extraParams.volumeColumn as string) ?? "volume"])
     );
     values = VWAP.calculate({
       high,
       low,
       close: closePrices,
       volume,
     });
     break;
   }
   case "WilliamsR": {
     const period = (extraParams.period as number) ?? 14;
     const high = sorted.map((r) =>
       Number(r[(extraParams.highColumn as string) ?? "high"])
     );
     const low = sorted.map((r) =>
       Number(r[(extraParams.lowColumn as string) ?? "low"])
     );
     values = WilliamsR.calculate({
       period,
       high,
       low,
       close: closePrices,
     });
     break;
   }
   case "CCI": {
     const period = (extraParams.period as number) ?? 20;
     const high = sorted.map((r) =>
       Number(r[(extraParams.highColumn as string) ?? "high"])
     );
     const low = sorted.map((r) =>
       Number(r[(extraParams.lowColumn as string) ?? "low"])
     );
     values = CCI.calculate({
       period,
       high,
       low,
       close: closePrices,
     });
     break;
   }
   case "ROC": {
     const period = (extraParams.period as number) ?? 12;
     values = ROC.calculate({ period, values: closePrices });
     break;
   }
   case "PSAR": {
     const step = (extraParams.step as number) ?? 0.02;
     const max = (extraParams.max as number) ?? 0.2;
     const high = sorted.map((r) =>
       Number(r[(extraParams.highColumn as string) ?? "high"])
     );
     const low = sorted.map((r) =>
       Number(r[(extraParams.lowColumn as string) ?? "low"])
     );
     values = PSAR.calculate({ step, max, high, low });
     break;
   }
   case "Ichimoku": {
     const conversionPeriod =
       (extraParams.conversionPeriod as number) ?? 9;
     const basePeriod = (extraParams.basePeriod as number) ?? 26;
     const spanPeriod = (extraParams.spanPeriod as number) ?? 52;
     const displacement = (extraParams.displacement as number) ?? 26;
     const high = sorted.map((r) =>
       Number(r[(extraParams.highColumn as string) ?? "high"])
     );
     const low = sorted.map((r) =>
       Number(r[(extraParams.lowColumn as string) ?? "low"])
     );
     values = IchimokuCloud.calculate({
       conversionPeriod,
       basePeriod,
       spanPeriod,
       displacement,
       high,
       low,
     }) as object[];
     break;
   }
   ```

   Notes:
   - The `as object[]` cast matches the existing pattern for indicators that return objects (`MACD`, `BB`).
   - Scalar indicators (`VWAP`, `WilliamsR`, `CCI`, `ROC`, `PSAR`) return `number[]`; no cast needed because `values` is typed `(number | object)[]`.
   - `PSAR` returns the same length as input (`offset === 0`); the existing `dates.slice(offset)` math handles this.
   - Ichimoku's class is `IchimokuCloud` (the package's runtime class name) but the indicator enum exposes it as `"Ichimoku"` for ergonomics.

6. **Tool-side change.** Update `apps/api/src/tools/technical-indicator.tool.ts`:

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

   Update the tool description to enumerate the wider surface:

   ```ts
   description =
     "Compute a technical indicator (SMA, EMA, RSI, MACD, Bollinger Bands, ATR, OBV, " +
     "Stochastic, ADX, VWAP, Williams %R, CCI, ROC, PSAR, Ichimoku Cloud) on a time series.";
   ```

   The `execute` body forwards unchanged — it already destructures `indicator` and `params`.

7. **Run focused suite.** `cd apps/api && npm run test:unit -- technicalIndicator`. All 8 new + existing indicator tests green. Verify the existing `SMA/EMA/RSI/MACD/BB/ATR/OBV` tests pass byte-stably.

8. **Lint + type-check from repo root.** `npm run lint && npm run type-check`. Clean.

**Done when:** spec tests 71–80 pass; existing `technicalIndicator()` tests still pass.

**Risk:**
- **`technicalindicators` runtime exports differ from the type declarations.** Verify on the first failing test before assuming the lib is broken; check the package's published JS for the actual export names. If a class name turns out to differ, the import alias takes a one-line tweak.
- **`Stochastic`'s output begins at offset `period - 1 + signalPeriod - 1`**, deeper than other indicators. Test 71 uses `> 0` rather than a precise length so it tolerates the offset; if a precise length matters in a future spec, derive from the library's own tests.
- **Ichimoku on a 30-row fixture returns zero rows** because `spanPeriod: 52` exceeds the input. Test 78 mandates a 60-row fixture; do not relax that.

---

## After both slices

1. **Run the full apps/api unit suite.** `cd apps/api && npm run test:unit`. All previous tests pass; 22 new cases pass.
2. **Run lint + type-check from repo root.** `npm run lint && npm run type-check`. Clean across all packages.
3. **Manual smoke test against the dev portal.**
   - `npm run dev` from repo root.
   - On a station with `statistics` and `financial` packs enabled, ask the model:
     - "Describe `revenue` and include the 5th, 50th, and 95th percentiles." Verify the tool call carries `percentiles: [0.05, 0.5, 0.95]` and the rendered `data-table` shows three percentile rows alongside the existing descriptive rows.
     - "Compute the ADX for `close` over the last 60 days." Verify the tool call carries `indicator: "ADX"` and the rendered `data-table` has rows whose values are `{adx, pdi, mdi}` objects (the existing render path handles this).
     - "Show me the Ichimoku Cloud for `close`." Verify the tool call carries `indicator: "Ichimoku"` and the result is per-row objects.
   - Confirm each call returns within a turn.

---

## Out-of-band considerations

- **No deployment coordination.** Tools are rebuilt every turn; the change takes effect on the first portal-session message after deploy.
- **No telemetry change.** Tracking which new indicators / percentile lists the model uses is a separate analytics workstream.
- **Donchian follow-up.** The discovery promised Donchian; phase 2 doesn't ship it because `technicalindicators` doesn't export it. If demand surfaces, ~25 lines of rolling-window high/low computation and one new `case "Donchian"` branch in the switch — safe to land as a small follow-up rather than a phase.

---

## PR shape

- Branch: continue on `feat/expand-tool-set-capabilities` (the same branch phase 1 shipped on) or fork a new `feat/analytics-pack-phase-2` if the team prefers per-phase branches.
- Commits: two conventional-commits-style commits matching the slices, in the listed order:
  - `feat(describe-column-tool): add variance, mode, skewness, kurtosis, iqr, and arbitrary percentiles`
  - `feat(technical-indicator-tool): add Stochastic, ADX, VWAP, Williams %R, CCI, ROC, PSAR, Ichimoku`
- PR description: link the discovery + spec + plan docs. Note the discovery delta (Donchian deferred). Reference the phasing table — phase 2 of seven; phases 3–7 are tracked but unstarted.
