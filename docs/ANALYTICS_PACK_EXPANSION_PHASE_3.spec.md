# Analytics Pack Expansion — Phase 3 — Spec

**TVM consolidation: four new tools that close the most-asked-for finance gaps — `tvm`, `xnpv`, `xirr`, `depreciation`.**

Discovery: `docs/ANALYTICS_PACK_EXPANSION.discovery.md`. Prior phases: phase 1 commit `0417513`, phase 2 commit `4fd2548`, Donchian follow-up `874fefe`.

The phase-3 wedge from the discovery's phasing table:

> **3. TVM consolidation** | `tvm`, `xirr`, `xnpv`, `depreciation` | Plugs the most-asked-for finance gaps; all backed by `financial`.

**Discovery delta.** Reconnaissance against the installed `financial` package's `.d.ts` shows it exports `fv`, `pmt`, `nper`, `ipmt`, `ppmt`, `pv`, `rate`, `irr`, `npv`, `mirr` — but **not** `xirr`, `xnpv`, `sln`, or `ddb`. So:

- `tvm` is pure forwarding to `financial`'s five core TVM functions (`pv/fv/pmt/nper/rate`).
- `xnpv` is hand-rolled (one closed-form formula, ~10 lines).
- `xirr` is hand-rolled (Newton-Raphson on `xnpv`, ~30 lines).
- `depreciation` is hand-rolled across three methods (straight-line, declining-balance, double-declining-balance; ~25 lines total).

The discovery's "all backed by `financial`" claim was loose. The delta is documented in this spec so the dependency footprint is unambiguous: phase 3 ships **no new dependencies**; one library (`financial`, already installed) is consumed by `tvm` only.

After this phase: a station with the `financial` pack enabled covers the standard personal-finance and basic corporate-finance question set — present/future value, mortgage cadences, irregular-date cashflow analysis (VC/PE, dividend reinvestment, capital calls), and depreciation schedules.

---

## Scope

### In scope (four new tools)

1. **`tvm`** — single time-value-of-money tool with `op: "pv" | "fv" | "pmt" | "rate" | "nper"`. Forwards to `financial.pv/fv/pmt/rate/nper`.
2. **`xnpv`** — net present value over irregular-date cashflows. Inputs: `rate`, `cashFlows: { date, amount }[]`. Output: `{ xnpv: number }`.
3. **`xirr`** — internal rate of return over irregular-date cashflows. Inputs: `cashFlows: { date, amount }[]`, optional `guess` (default 0.1). Output: `{ xirr: number }`.
4. **`depreciation`** — `method: "straight_line" | "declining_balance" | "double_declining_balance"`. Inputs: `cost, salvage, life`, optional `period`. Output: a single row when `period` is supplied, or the full schedule when omitted.

All four ship as new tool-class files under `apps/api/src/tools/` and new static methods on `AnalyticsService`. Each enters the **`financial` pack** in `ToolService.buildAnalyticsTools` and `PACK_TOOL_NAMES`.

### Out of scope

- Bond math (YTM, duration, convexity, price). Phase 7.
- Portfolio metrics (Sortino, Calmar, alpha/beta vs. benchmark, capture ratios). Phase 7.
- VaR / CVaR. Phase 7.
- MIRR (Modified IRR). The package ships it, but no demand has surfaced; trivial to add later as a fifth `tvm` op or a sibling tool.
- Per-period interest/principal split (`ipmt`/`ppmt`). The existing `amortize` tool already exposes this via the schedule rows; no separate tool needed.
- Replacing the existing `npv`/`irr` tools. They stay; `xnpv`/`xirr` are explicitly for *irregular-date* series. The model picks based on whether dates are present in the input.
- Frontend changes. Each new tool returns a flat object or a row-array — both render through the existing `data-table` path unchanged.
- DB / contract / SDK changes.

---

## Tool-by-tool surface

### 1. `tvm`

```ts
const InputSchema = z.object({
  op: z
    .enum(["pv", "fv", "pmt", "rate", "nper"])
    .describe(
      "Which TVM quantity to solve for. Provide all the *other* TVM inputs."
    ),
  rate: z
    .number()
    .optional()
    .describe(
      "Per-period interest rate as decimal (e.g. 0.005 for 0.5%/period). Required for op = pv | fv | pmt | nper."
    ),
  nper: z
    .number()
    .optional()
    .describe(
      "Number of periods. Required for op = pv | fv | pmt | rate."
    ),
  pmt: z
    .number()
    .optional()
    .describe(
      "Periodic payment (cash outflow is negative by convention). Required for op = pv | fv | nper | rate."
    ),
  pv: z
    .number()
    .optional()
    .describe(
      "Present value. Required for op = fv | pmt | nper | rate."
    ),
  fv: z
    .number()
    .optional()
    .describe(
      "Future value (default 0 for op = pv | pmt | nper). Required for op = rate."
    ),
  guess: z
    .number()
    .optional()
    .describe(
      "Initial-guess rate for the iterative solver (default 0.1). Only used for op = rate."
    ),
});
```

Service-side semantics (`AnalyticsService.tvm`):

```ts
switch (op) {
  case "pv":   require("rate", "nper", "pmt"); return { result: financial.pv(rate, nper, pmt, fv ?? 0) };
  case "fv":   require("rate", "nper", "pmt", "pv"); return { result: financial.fv(rate, nper, pmt, pv) };
  case "pmt":  require("rate", "nper", "pv"); return { result: financial.pmt(rate, nper, pv, fv ?? 0) };
  case "nper": require("rate", "pmt", "pv"); return { result: financial.nper(rate, pmt, pv, fv ?? 0) };
  case "rate": require("nper", "pmt", "pv", "fv"); return { result: financial.rate(nper, pmt, pv, fv, undefined, guess) };
}
```

`require(...)` is a private static helper that throws a clear `Error` when an op's mandatory inputs are absent: e.g. `Missing input for op="pv": rate, nper, pmt`. This is the only validation beyond Zod — the Zod schema can't make any one field's required-ness conditional on `op` without a discriminated-union design, which adds enough complexity to warrant a dedicated phase.

Output shape: `{ result: number }`. Single-field flat object so the `data-table` rendering path is uniform across ops. The model knows from `op` what `result` represents (PV, FV, etc.); putting the op in the output adds no information.

### 2. `xnpv`

```ts
const InputSchema = z.object({
  rate: z
    .number()
    .describe("Discount rate per year as decimal (e.g. 0.10 for 10%)."),
  cashFlows: z
    .array(
      z.object({
        date: z
          .string()
          .describe("ISO date string (YYYY-MM-DD or any format Date can parse)."),
        amount: z
          .number()
          .describe(
            "Cash flow amount. Initial investment is typically negative."
          ),
      })
    )
    .min(2)
    .describe(
      "Cash flows with explicit dates. Order does not matter; the first flow's date is the discount anchor."
    ),
});
```

Service-side semantics (`AnalyticsService.xnpv`):

```
sortedFlows = cashFlows sorted by date asc
anchorDate = sortedFlows[0].date
xnpv = Σ amount_i / (1 + rate) ^ ((date_i - anchorDate) / 365)
```

Output shape: `{ xnpv: number }`.

Date semantics: convert each `date` to a JS `Date` and compute day-difference via `(Date.parse(date) - anchor) / 86400000`. Dates that fail to parse throw `Error("Invalid cash-flow date: ...")`. The 365-day-year convention matches Excel's `XNPV`.

### 3. `xirr`

```ts
const InputSchema = z.object({
  cashFlows: z
    .array(
      z.object({
        date: z.string(),
        amount: z.number(),
      })
    )
    .min(2)
    .describe(
      "Cash flows with explicit dates. Must contain at least one positive and one negative amount."
    ),
  guess: z
    .number()
    .optional()
    .describe("Initial-guess rate for Newton-Raphson (default 0.1)."),
});
```

Service-side semantics (`AnalyticsService.xirr`):

Newton-Raphson on the `xnpv` function:

```
let rate = guess ?? 0.1
for iter in 0..100:
  f  = xnpv(rate, sortedFlows)
  f' = xnpvDerivative(rate, sortedFlows)
  if |f'| < ε: throw "xirr did not converge (zero derivative)"
  next = rate - f / f'
  if |next - rate| < 1e-10: return next
  rate = next
throw "xirr did not converge after 100 iterations"
```

The derivative is closed-form:
```
d/d(rate) [Σ amount_i / (1 + rate)^t_i] = Σ -t_i * amount_i / (1 + rate)^(t_i + 1)
```

Output shape: `{ xirr: number }`.

Pre-validation: after sorting flows by date, throw `Error("xirr requires at least one positive and one negative amount")` if the inputs do not span both signs. Without sign-spanning, no real root exists.

### 4. `depreciation`

```ts
const InputSchema = z.object({
  cost: z.number().positive().describe("Initial cost / book value of the asset."),
  salvage: z
    .number()
    .nonnegative()
    .describe("Estimated salvage value at the end of life."),
  life: z.number().int().positive().describe("Useful life in periods (typically years)."),
  method: z
    .enum(["straight_line", "declining_balance", "double_declining_balance"])
    .describe(
      "straight_line: (cost - salvage) / life per period. " +
        "declining_balance: 1/life rate applied to current book value, never below salvage. " +
        "double_declining_balance: 2/life rate applied to current book value, never below salvage."
    ),
  period: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Optional 1-indexed period to return a single row for. When omitted, the full schedule is returned."
    ),
  factor: z
    .number()
    .positive()
    .optional()
    .describe(
      "Override factor for declining_balance / double_declining_balance (default 1 and 2 respectively)."
    ),
});
```

Service-side semantics (`AnalyticsService.depreciation`):

- **straight_line**: `expense = (cost - salvage) / life` per period (constant).
- **declining_balance**: `rate = (factor ?? 1) / life`; period expense = `min(rate * priorBookValue, priorBookValue - salvage)`. This clamps so book value never drops below salvage.
- **double_declining_balance**: same as declining_balance with `factor` defaulted to 2.

Both balance-based methods clamp the final period's expense to land book value exactly at salvage (so summed expense = `cost - salvage`).

Schedule row shape: `{ period, depreciation, accumulated, bookValue }`. All numeric, rounded to two decimals. When `period` is supplied, return a single row; when omitted, return `life` rows.

Output shape: `{ schedule: AmortizationRow[] }` (full) or `{ row: AmortizationRow }` (single-period). One discriminator field — `schedule` vs. `row` — keeps the result self-describing without forcing a separate tool. (Per D5: presence-or-absence of the field tracks presence-or-absence of the input.)

### Result-shape policy reminder (D5)

All four tools return flat objects or row arrays compatible with `data-table` rendering. No new presentation paths needed.

---

## Pack registration

`apps/api/src/services/tools.service.ts` — two changes:

1. Extend `PACK_TOOL_NAMES` (line 88) with the four new slugs:
   ```ts
   "tvm",
   "xnpv",
   "xirr",
   "depreciation",
   ```

2. Inside `buildAnalyticsTools` under the `financial` pack block (around line 222), append:
   ```ts
   tools.tvm = new TvmTool().build();
   tools.xnpv = new XnpvTool().build();
   tools.xirr = new XirrTool().build();
   tools.depreciation = new DepreciationTool().build();
   ```

   None of the four needs `stationData` — they operate on caller-supplied numerics, not station entities. They follow the same parameterless `build()` shape as `npv`, `irr`, `amortize`.

`ALL_TOOL_PACKS` (line 67) is unchanged — `financial` already exists as a pack.

---

## Test plan

All tests are service-layer assertions in `apps/api/src/__tests__/services/analytics.service.test.ts`. Run via `cd apps/api && npm run test:unit -- analytics.service`.

### `tvm()` — new `describe` block

81. **`op: "pv"` matches a textbook present-value calculation.** Compute the PV of $1,000/year for 10 years at 5% (regular annuity). Reference value: `financial.pv(0.05, 10, -1000)` ≈ `7721.7349`. Assert `expect(result.result).toBeCloseTo(7721.7349, 2)`.
82. **`op: "fv"` matches a textbook future-value calculation.** $200/month at 6%/year (0.005/period) for 10 years (120 months) ending at $0 PV. Reference: `financial.fv(0.005, 120, -200, 0)` ≈ `32775.87`. Assert.
83. **`op: "pmt"` matches a mortgage payment.** $200,000 principal at 6%/year (0.005 monthly) over 360 months. Reference: `financial.pmt(0.005, 360, 200000)` ≈ `-1199.10`. Assert.
84. **`op: "nper"` matches a textbook nper.** $10,000 PV, $200/period payment, 1%/period rate, $0 FV. Reference: `financial.nper(0.01, -200, 10000)` finite. Assert numeric and finite, > 0.
85. **`op: "rate"` matches a known rate.** Round-trip: pick a rate (e.g. 0.04), compute `pv`, then re-derive the rate. Assert recovered rate is within 1e-6 of 0.04.
86. **Missing input throws a clear error.** Call `op: "pv"` without `pmt`. Assert `expect(...).toThrow(/Missing input for op="pv".*pmt/)`.

### `xnpv()` — new `describe` block

87. **xnpv on an evenly-spaced annual series matches `financial.npv`.** Cash flows on Jan 1 of consecutive years; convert to a flat array and compare. Fixture: `[{ "2024-01-01", -1000 }, { "2025-01-01", 300 }, { "2026-01-01", 400 }, { "2027-01-01", 500 }]`. Assert `xnpv(0.1, flows)` ≈ `financial.npv(0.1, [-1000, 300, 400, 500])` (within 1e-2 — leap year offset is small).
88. **xnpv with mixed-order input is order-independent.** Same fixture, shuffled input. Assert the result matches the sorted-input result.
89. **xnpv anchor is the earliest date.** Two fixtures: same flows, one with anchor Jan 1 and one with all dates shifted by 30 days. The xnpv values should be approximately equal (the *spacing* matters, not the absolute anchor — but the anchor convention in this implementation is the *earliest* date, so the absolute year shift shouldn't change the result if relative spacing is preserved). Assert.
90. **Single-flow input rejected by Zod (.min(2)).** Assert `XnpvTool.schema.safeParse({ rate: 0.1, cashFlows: [{ date: "2024-01-01", amount: 100 }] }).success === false`.
91. **Invalid date string throws.** Cash flow with `date: "not-a-date"`. Assert throws `/Invalid cash-flow date/`.

### `xirr()` — new `describe` block

92. **xirr on a known fixture matches Excel's XIRR to 4 decimal places.** Reference fixture from Microsoft's XIRR docs:
    ```
    [
      { date: "2008-01-01", amount: -10000 },
      { date: "2008-03-01", amount: 2750 },
      { date: "2008-10-30", amount: 4250 },
      { date: "2009-02-15", amount: 3250 },
      { date: "2009-04-01", amount: 2750 },
    ]
    ```
    Excel returns `0.373362535` (≈ 37.34%). Assert `expect(result.xirr).toBeCloseTo(0.373362535, 4)`.
93. **xirr inverse-relationship to xnpv.** For the fixture from test 92, plug the computed xirr back into xnpv at that rate. Assert `xnpv(xirr, flows) ≈ 0` (within 1e-6).
94. **xirr throws when all flows are positive.** Fixture: 3 positive amounts. Assert throws `/at least one positive and one negative/`.
95. **xirr throws when all flows are negative.** Mirror of 94.
96. **xirr converges on a typical fixture in well under 100 iterations.** Use the test-92 fixture and a poor initial guess (`guess: 5.0`). Assert the call succeeds (does not throw the convergence-failure error) and result is the same as test 92.

### `depreciation()` — new `describe` block

97. **Straight-line full schedule has constant per-period expense.** Cost $10,000, salvage $1,000, life 5 years. Expected per-period expense: `(10000 - 1000) / 5 = 1800`. Assert all 5 rows have `depreciation === 1800`, accumulated rises by 1800 each row, final `bookValue === 1000`.
98. **Straight-line single-period query returns a `row` field.** Same fixture, `period: 3`. Assert result has shape `{ row: { period: 3, depreciation: 1800, accumulated: 5400, bookValue: 4600 } }` and no `schedule` field.
99. **Double-declining-balance frontloads expense.** Cost $10,000, salvage $1,000, life 5. Rate = 2/5 = 0.4. Row 1 expense = 0.4 * 10000 = 4000. Row 2 expense = 0.4 * 6000 = 2400. Final book value = 1000 (clamped). Assert.
100. **DDB final period clamps to salvage.** Same fixture as test 99: across 5 rows, accumulated depreciation = 9000 = cost - salvage. Assert summed `depreciation` rounds to 9000.
101. **Declining-balance with custom factor matches the manual formula.** Cost $10,000, salvage $1,000, life 5, factor 1.5 (1.5x declining balance). Rate = 1.5/5 = 0.3. Row 1 = 0.3 * 10000 = 3000. Assert row 1 matches.
102. **Single-period beyond `life` rejected by Zod or returns nothing meaningful.** Decision: reject at the service layer with a clear error. Test: cost $10000, salvage $1000, life 5, period 7. Assert throws `/period .* exceeds life/`.

Total new cases: 22 across the four tools.

---

## Behavior on edge cases

- **`tvm` with extraneous inputs.** Passing all five fields for `op: "pv"` is allowed; the service uses the three it needs and ignores the rest. Document in tool description.
- **`tvm` with `fv` omitted on `op: "pv"` / `pmt` / `nper`.** Default to `0` (the financial-library default). Document.
- **`xnpv` with a single date repeated.** Allowed — produces a flat-discount calculation per flow. Sum is meaningful.
- **`xirr` with cash flows summing to exactly zero.** rate = 0 satisfies `xnpv(0) = 0`; Newton-Raphson should land on it. Edge case, but handled.
- **`xirr` with extreme returns (e.g. 1000%).** Newton-Raphson with a poor guess can diverge. The 100-iteration cap throws a clear error rather than spinning. Caller can supply a better `guess`.
- **`depreciation` salvage > cost.** Zod allows it (both are ≥ 0). Straight-line returns negative per-period expense; balance methods immediately hit the clamp and return zero expense. Document; do not over-validate.
- **`depreciation` life = 1.** Straight-line returns one row with `cost - salvage` expense; balance methods either match (factor=1) or exceed and clamp.

---

## Risks & rollback

| Risk | Mitigation |
|---|---|
| `xirr` Newton-Raphson divergence on adversarial inputs. | 100-iteration cap with a clear error message. Caller can retry with a different `guess`. Test 96 uses an explicitly poor initial guess to verify the cap protects without preventing convergence on normal inputs. |
| `xnpv` 365-day convention diverges from Excel's `XNPV` on leap years. | Excel uses 365-day too. Test 87 cross-checks against `financial.npv` on yearly cash flows where the leap-year offset is negligible (< 1e-2 over 3 years). |
| `tvm` discriminated-input pattern (single tool, op-conditional required fields) confuses the model. | Tool description states clearly which fields each `op` requires; the service throws a *named* error listing the missing fields; spec test 86 verifies the error message names the missing field. |
| Tool roster grows by 4 tools, diluting tool-selection accuracy. | Going from 26 to 30 built-in tools is well within Claude's known-good range. The `tvm` consolidation prevents going from 26 to 31 (one tool per op). |
| `depreciation` schedule rounding accumulates. | Each row computes from the prior `bookValue` (also rounded). Test 100 asserts the summed depreciation equals `cost - salvage` exactly via the final-period clamp, isolating rounding drift to a single row. |
| Date parsing tolerance differs across Node versions. | Use `Date.parse(...)` and check for `NaN`. The standard parser handles ISO-8601 (`YYYY-MM-DD`) consistently across all supported Node versions; unusual formats (US-style `MM/DD/YYYY`) are explicitly tested-against in xnpv test 91. |

**Rollback** is a single-commit revert. No DB migration. No frontend / contract / SDK change. Pre-existing tools (`npv`, `irr`, `amortize`) are untouched and continue to handle the regular-cashflow case.

---

## Acceptance criteria

- [ ] All 22 new test cases pass; pre-existing cases pass without modification.
- [ ] `cd apps/api && npm run test:unit -- analytics.service` is green.
- [ ] `cd apps/api && npm run test:unit` (full suite) is green.
- [ ] `npm run lint && npm run type-check` from repo root are clean.
- [ ] Four new entries in `ToolService.PACK_TOOL_NAMES`; four new tool registrations under the `financial` pack.
- [ ] No frontend, DB, contract, or SDK file is touched.
- [ ] Manual spot-check via the dev portal: a station with the `financial` pack enabled responds correctly to:
  - "What's the present value of $1,000/year for 10 years at 5%?" → `tvm` with `op: "pv"`.
  - "Compute XIRR for these dated cashflows…" → `xirr` tool call.
  - "Show me a 5-year double-declining depreciation schedule for a $10,000 asset with $1,000 salvage." → `depreciation` tool call.

---

## Files touched

- New: `apps/api/src/tools/tvm.tool.ts`
- New: `apps/api/src/tools/xnpv.tool.ts`
- New: `apps/api/src/tools/xirr.tool.ts`
- New: `apps/api/src/tools/depreciation.tool.ts`
- Edit: `apps/api/src/services/analytics.service.ts` — four new static methods (`tvm`, `xnpv`, `xirr`, `depreciation`); one private helper (`xnpvFromSorted` reused by `xirr`); one new exported result type for the depreciation row.
- Edit: `apps/api/src/services/tools.service.ts` — extend `PACK_TOOL_NAMES` (line 88) and register the four tools under the `financial` pack block (line 222).
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — 22 new test cases per the test plan.

No DB migration. No contract change. No frontend change. No SDK change. No new dependency.
