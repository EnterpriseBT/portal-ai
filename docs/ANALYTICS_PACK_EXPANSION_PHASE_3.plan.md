# Analytics Pack Expansion — Phase 3 — Plan

**TDD-sequenced implementation of four new financial-pack tools: `tvm`, `xnpv`, `xirr`, `depreciation`.**

Spec: `docs/ANALYTICS_PACK_EXPANSION_PHASE_3.spec.md`. Discovery: `docs/ANALYTICS_PACK_EXPANSION.discovery.md`. Phase 2 commit: `4fd2548`. Donchian follow-up: `874fefe`.

Four slices, in dependency order:

1. **`tvm`** — pure forwarding to `financial`'s five core functions. Smallest diff; lands first to set the new-tool pattern under the `financial` pack.
2. **`xnpv`** — hand-rolled, but standalone (no other tool depends on it).
3. **`xirr`** — Newton-Raphson that calls `xnpv` internally. Lands after slice 2 so the helper is in place.
4. **`depreciation`** — three methods, no dependencies on the other three slices.

Each slice follows the established loop:

1. Write failing service-layer tests for the new behavior.
2. Implement the service-side change.
3. Add the tool-class file and register it in `ToolService`.
4. Run the focused test suite; confirm green.
5. Run lint + type-check after all four slices.

Run tests with `cd apps/api && npm run test:unit -- analytics.service` per `feedback_use_npm_test_scripts`.

---

## Slice 1 — `tvm`

**Files**

- New: `apps/api/src/tools/tvm.tool.ts`
- Edit: `apps/api/src/services/analytics.service.ts` — add `static tvm(...)` and a private `requireFields(...)` helper.
- Edit: `apps/api/src/services/tools.service.ts` — import `TvmTool`, add `"tvm"` to `PACK_TOOL_NAMES`, register under the `financial` pack block.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — new `describe("tvm()", ...)` block with spec cases 81–86.

**Steps**

1. **Write failing tests** (cases 81–86). The reference values for tests 81–84 come from manually invoking `financial.pv/fv/pmt/nper` once and inlining the results — closed-form, deterministic. For test 85 (round-trip), pick a known rate (0.04), compute `pv` from `(rate, nper, pmt)`, then re-invoke `tvm` with `op: "rate"` to recover it.

   Test 86 (missing-input error) needs an exact-match assertion. Standardize the error message format upfront:
   ```
   throw new Error(`Missing input for op="${op}": ${missing.join(", ")}`);
   ```
   Then `expect(...).toThrow(/Missing input for op="pv".*pmt/)` succeeds.

   Run; expect 6 failures (the static method doesn't exist).

2. **Service-side change.** Add to `analytics.service.ts` next to the other financial methods (`amortize`, `npv`, `irr`):

   ```ts
   /**
    * Time-value-of-money. Picks one of pv/fv/pmt/nper/rate to solve for,
    * given the others. Forwards to the `financial` package.
    */
   static tvm(params: {
     op: "pv" | "fv" | "pmt" | "rate" | "nper";
     rate?: number;
     nper?: number;
     pmt?: number;
     pv?: number;
     fv?: number;
     guess?: number;
   }): { result: number } {
     const { op } = params;
     const have = (k: keyof typeof params): boolean => params[k] !== undefined;

     const required: Record<typeof op, (keyof typeof params)[]> = {
       pv: ["rate", "nper", "pmt"],
       fv: ["rate", "nper", "pmt", "pv"],
       pmt: ["rate", "nper", "pv"],
       nper: ["rate", "pmt", "pv"],
       rate: ["nper", "pmt", "pv", "fv"],
     };
     const missing = required[op].filter((k) => !have(k));
     if (missing.length > 0) {
       throw new Error(
         `Missing input for op="${op}": ${missing.join(", ")}`
       );
     }

     switch (op) {
       case "pv":
         return { result: financial.pv(params.rate!, params.nper!, params.pmt!, params.fv ?? 0) };
       case "fv":
         return { result: financial.fv(params.rate!, params.nper!, params.pmt!, params.pv!) };
       case "pmt":
         return { result: financial.pmt(params.rate!, params.nper!, params.pv!, params.fv ?? 0) };
       case "nper":
         return { result: financial.nper(params.rate!, params.pmt!, params.pv!, params.fv ?? 0) };
       case "rate":
         return {
           result: financial.rate(
             params.nper!,
             params.pmt!,
             params.pv!,
             params.fv!,
             undefined,
             params.guess
           ),
         };
     }
   }
   ```

   The `!` non-null assertions are safe because the `required` map gates every branch. The `guess` parameter on `rate` is forwarded as-is; `financial.rate` defaults it internally.

3. **Tool-class file.** Create `apps/api/src/tools/tvm.tool.ts`:

   ```ts
   import { z } from "zod";
   import { tool } from "ai";

   import { AnalyticsService } from "../services/analytics.service.js";
   import { Tool } from "../types/tools.js";

   const InputSchema = z.object({
     op: z
       .enum(["pv", "fv", "pmt", "rate", "nper"])
       .describe(
         "Which TVM quantity to solve for. Provide all the other TVM inputs."
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
       .describe("Number of periods. Required for op = pv | fv | pmt | rate."),
     pmt: z
       .number()
       .optional()
       .describe(
         "Periodic payment (cash outflow is negative by convention). Required for op = pv | fv | nper | rate."
       ),
     pv: z
       .number()
       .optional()
       .describe("Present value. Required for op = fv | pmt | nper | rate."),
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

   export class TvmTool extends Tool<typeof InputSchema> {
     slug = "tvm";
     name = "TVM";
     description =
       "Time-value-of-money. Solve for present value, future value, payment, " +
       "rate, or number of periods given the other inputs.";

     get schema() {
       return InputSchema;
     }

     build() {
       return tool({
         description: this.description,
         inputSchema: this.schema,
         execute: async (input) => {
           const validated = this.validate(input);
           return AnalyticsService.tvm(validated);
         },
       });
     }
   }
   ```

4. **Register in `ToolService`.** Three edits to `apps/api/src/services/tools.service.ts`:

   - Add the import near the other financial tool imports:
     ```ts
     import { TvmTool } from "../tools/tvm.tool.js";
     ```
   - Add `"tvm"` to `PACK_TOOL_NAMES` (line 88).
   - Inside the `financial` pack block (around line 222), after the existing entries:
     ```ts
     tools.tvm = new TvmTool().build();
     ```

5. **Run focused suite.** `cd apps/api && npm run test:unit -- 'analytics.service' -t 'tvm'`. All 6 cases green.

**Done when:** spec tests 81–86 pass; existing tests untouched.

**Risk:** the `required` map's keys must match the `op` enum exactly; a typo silently breaks one branch. Test 86 indirectly catches this — it asserts the missing-input throw — but only for `op: "pv"`. If the team wants tighter coverage, add one negative-case test per op as a follow-up; for phase 3 the single test is sufficient.

---

## Slice 2 — `xnpv`

**Files**

- New: `apps/api/src/tools/xnpv.tool.ts`
- Edit: `apps/api/src/services/analytics.service.ts` — add `static xnpv(...)` and a private `xnpvOnSorted(...)` helper that takes pre-sorted flows (re-used by `xirr` in slice 3).
- Edit: `apps/api/src/services/tools.service.ts` — import `XnpvTool`, add `"xnpv"` to `PACK_TOOL_NAMES`, register under `financial` pack.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — new `describe("xnpv()", ...)` block with spec cases 87–91.

**Steps**

1. **Write failing tests** (cases 87–91). For test 87, the comparison value is `financial.npv(0.1, [-1000, 300, 400, 500])`; the test calls that to derive the expected value rather than hardcoding (xnpv on yearly cash flows is *almost* `financial.npv` but with leap-year drift). Use a generous tolerance (`1e-2`).

   For test 90, exercise the Zod schema directly via `XnpvTool.prototype.schema.safeParse(...)` — same pattern as the regression-tool test in phase 1.

   Run; expect 5 failures (4 service + 1 schema; the schema test fails until the tool file exists).

2. **Service-side change.** Add to `analytics.service.ts`:

   ```ts
   /**
    * NPV over irregular-date cash flows (Excel XNPV semantics, 365-day year).
    */
   static xnpv(params: {
     rate: number;
     cashFlows: { date: string; amount: number }[];
   }): { xnpv: number } {
     const sorted = this.parseAndSortFlows(params.cashFlows);
     return { xnpv: this.xnpvOnSorted(params.rate, sorted) };
   }

   private static parseAndSortFlows(
     flows: { date: string; amount: number }[]
   ): { time: number; amount: number }[] {
     const parsed = flows.map((f) => {
       const t = Date.parse(f.date);
       if (Number.isNaN(t)) {
         throw new Error(`Invalid cash-flow date: ${f.date}`);
       }
       return { time: t, amount: f.amount };
     });
     parsed.sort((a, b) => a.time - b.time);
     return parsed;
   }

   private static xnpvOnSorted(
     rate: number,
     sorted: { time: number; amount: number }[]
   ): number {
     const anchor = sorted[0].time;
     let sum = 0;
     for (const f of sorted) {
       const years = (f.time - anchor) / (365 * 86400 * 1000);
       sum += f.amount / Math.pow(1 + rate, years);
     }
     return sum;
   }
   ```

3. **Tool-class file.** Create `apps/api/src/tools/xnpv.tool.ts` mirroring the `tvm.tool.ts` pattern:

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
             .describe(
               "ISO date string (YYYY-MM-DD or any format Date can parse)."
             ),
           amount: z
             .number()
             .describe(
               "Cash flow amount. Initial investment is typically negative."
             ),
         })
       )
       .min(2)
       .describe(
         "Cash flows with explicit dates. Order does not matter; the earliest date is the discount anchor."
       ),
   });

   export class XnpvTool extends Tool<typeof InputSchema> {
     slug = "xnpv";
     name = "XNPV";
     description =
       "Net present value over irregular-date cashflows (Excel XNPV semantics).";

     get schema() {
       return InputSchema;
     }

     build() {
       return tool({
         description: this.description,
         inputSchema: this.schema,
         execute: async (input) => {
           const validated = this.validate(input);
           return AnalyticsService.xnpv(validated);
         },
       });
     }
   }
   ```

4. **Register in `ToolService`.** Mirror slice 1's three edits.

5. **Run focused suite.** `cd apps/api && npm run test:unit -- 'analytics.service' -t 'xnpv'`. All 5 cases green.

**Done when:** spec tests 87–91 pass.

**Risk:** the 365-day denominator differs from a "real" calendar over leap years. The Excel convention this implementation matches uses 365 — verified by the test-87 cross-check against `financial.npv` (which also uses period-1 = year-1 semantics). If a future spec needs strict calendar-day arithmetic, the helper signature is small enough to extend.

---

## Slice 3 — `xirr`

**Files**

- New: `apps/api/src/tools/xirr.tool.ts`
- Edit: `apps/api/src/services/analytics.service.ts` — add `static xirr(...)` that re-uses `parseAndSortFlows` and `xnpvOnSorted` from slice 2.
- Edit: `apps/api/src/services/tools.service.ts` — import `XirrTool`, add `"xirr"` to `PACK_TOOL_NAMES`, register under `financial` pack.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — new `describe("xirr()", ...)` block with spec cases 92–96.

**Steps**

1. **Write failing tests** (cases 92–96). Test 92 hardcodes Excel's reference value `0.373362535` against the published Microsoft fixture. Test 93 cross-checks via `xnpv(xirr, flows) ≈ 0`.

   Run; expect 5 failures.

2. **Service-side change.**

   ```ts
   /**
    * IRR over irregular-date cash flows (Excel XIRR semantics).
    * Newton-Raphson on xnpv with a 100-iteration cap.
    */
   static xirr(params: {
     cashFlows: { date: string; amount: number }[];
     guess?: number;
   }): { xirr: number } {
     const sorted = this.parseAndSortFlows(params.cashFlows);
     const hasPositive = sorted.some((f) => f.amount > 0);
     const hasNegative = sorted.some((f) => f.amount < 0);
     if (!hasPositive || !hasNegative) {
       throw new Error(
         "xirr requires at least one positive and one negative amount"
       );
     }

     const anchor = sorted[0].time;
     const dxnpv = (rate: number): number => {
       let sum = 0;
       for (const f of sorted) {
         const years = (f.time - anchor) / (365 * 86400 * 1000);
         sum += (-years * f.amount) / Math.pow(1 + rate, years + 1);
       }
       return sum;
     };

     let rate = params.guess ?? 0.1;
     for (let i = 0; i < 100; i++) {
       const f = this.xnpvOnSorted(rate, sorted);
       const fp = dxnpv(rate);
       if (Math.abs(fp) < 1e-12) {
         throw new Error("xirr did not converge (zero derivative)");
       }
       const next = rate - f / fp;
       if (Math.abs(next - rate) < 1e-10) {
         return { xirr: next };
       }
       rate = next;
     }
     throw new Error("xirr did not converge after 100 iterations");
   }
   ```

3. **Tool-class file.** Create `apps/api/src/tools/xirr.tool.ts` analogous to `xnpv.tool.ts`:

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
       .describe(
         "Initial-guess rate for Newton-Raphson (default 0.1)."
       ),
   });

   export class XirrTool extends Tool<typeof InputSchema> {
     slug = "xirr";
     name = "XIRR";
     description =
       "Internal rate of return over irregular-date cashflows (Excel XIRR semantics).";
     // ...standard build()
   }
   ```

4. **Register in `ToolService`.** Mirror slice 1.

5. **Run focused suite.** `cd apps/api && npm run test:unit -- 'analytics.service' -t 'xirr'`. All 5 cases green.

**Done when:** spec tests 92–96 pass.

**Risk:** Newton-Raphson divergence on adversarial inputs. The 100-iteration cap throws a clear error rather than spinning. Test 96 verifies convergence under a deliberately bad initial guess (5.0) on the standard fixture — proves the cap doesn't block realistic cases.

---

## Slice 4 — `depreciation`

**Files**

- New: `apps/api/src/tools/depreciation.tool.ts`
- Edit: `apps/api/src/services/analytics.service.ts` — add `static depreciation(...)`; export new result types `DepreciationRow`, `DepreciationResult`.
- Edit: `apps/api/src/services/tools.service.ts` — import `DepreciationTool`, add `"depreciation"` to `PACK_TOOL_NAMES`, register under `financial` pack.
- Edit: `apps/api/src/__tests__/services/analytics.service.test.ts` — new `describe("depreciation()", ...)` block with spec cases 97–102.

**Steps**

1. **Write failing tests** (cases 97–102). For tests 97 and 99, hand-derive the row values (constants for straight-line; geometric for declining-balance). For test 100, sum all `depreciation` field values and assert they equal `cost - salvage` (= 9000 in the fixture).

   For test 102 (period > life), the spec resolved this as a service-layer error rather than a Zod refinement — `period: 7` with `life: 5` should throw.

   Run; expect 6 failures.

2. **Service-side change.** Add result types near the existing `AmortizationRow`:

   ```ts
   export interface DepreciationRow {
     period: number;
     depreciation: number;
     accumulated: number;
     bookValue: number;
   }

   export type DepreciationResult =
     | { schedule: DepreciationRow[] }
     | { row: DepreciationRow };
   ```

   And the method:

   ```ts
   static depreciation(params: {
     cost: number;
     salvage: number;
     life: number;
     method:
       | "straight_line"
       | "declining_balance"
       | "double_declining_balance";
     period?: number;
     factor?: number;
   }): DepreciationResult {
     const { cost, salvage, life, method, period } = params;
     if (period !== undefined && period > life) {
       throw new Error(`period ${period} exceeds life ${life}`);
     }

     const round2 = (n: number) => Math.round(n * 100) / 100;
     const schedule: DepreciationRow[] = [];

     if (method === "straight_line") {
       const expense = (cost - salvage) / life;
       let accumulated = 0;
       for (let i = 1; i <= life; i++) {
         accumulated += expense;
         schedule.push({
           period: i,
           depreciation: round2(expense),
           accumulated: round2(accumulated),
           bookValue: round2(cost - accumulated),
         });
       }
     } else {
       const factor =
         params.factor ?? (method === "double_declining_balance" ? 2 : 1);
       const rate = factor / life;
       let bookValue = cost;
       let accumulated = 0;
       for (let i = 1; i <= life; i++) {
         let expense = rate * bookValue;
         if (bookValue - expense < salvage) expense = bookValue - salvage;
         if (expense < 0) expense = 0;
         accumulated += expense;
         bookValue -= expense;
         schedule.push({
           period: i,
           depreciation: round2(expense),
           accumulated: round2(accumulated),
           bookValue: round2(bookValue),
         });
       }
     }

     if (period !== undefined) {
       return { row: schedule[period - 1] };
     }
     return { schedule };
   }
   ```

3. **Tool-class file.** Create `apps/api/src/tools/depreciation.tool.ts`:

   ```ts
   const InputSchema = z.object({
     cost: z
       .number()
       .positive()
       .describe("Initial cost / book value of the asset."),
     salvage: z
       .number()
       .nonnegative()
       .describe("Estimated salvage value at the end of life."),
     life: z
       .number()
       .int()
       .positive()
       .describe("Useful life in periods (typically years)."),
     method: z
       .enum([
         "straight_line",
         "declining_balance",
         "double_declining_balance",
       ])
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

   export class DepreciationTool extends Tool<typeof InputSchema> {
     slug = "depreciation";
     name = "Depreciation";
     description =
       "Compute a depreciation schedule (or a single period) using straight-line, " +
       "declining-balance, or double-declining-balance.";

     get schema() {
       return InputSchema;
     }

     build() {
       return tool({
         description: this.description,
         inputSchema: this.schema,
         execute: async (input) => {
           const validated = this.validate(input);
           return AnalyticsService.depreciation(validated);
         },
       });
     }
   }
   ```

4. **Register in `ToolService`.** Mirror slice 1.

5. **Run focused suite.** `cd apps/api && npm run test:unit -- 'analytics.service' -t 'depreciation'`. All 6 cases green.

**Done when:** spec tests 97–102 pass.

**Risk:** the final-period clamp on declining-balance methods can produce a row with smaller-than-expected expense (the rest landed on prior rows). Test 100 asserts the *summed* expense equals `cost - salvage` exactly, which catches both over- and under-depreciation drift.

---

## After all four slices

1. **Run the full apps/api unit suite.** `cd apps/api && npm run test:unit`. All previous tests pass; 22 new cases pass.
2. **Run lint + type-check from repo root.** `npm run lint && npm run type-check`. Clean across all packages.
3. **Manual smoke test against the dev portal.**
   - `npm run dev` from repo root.
   - On a station with the `financial` pack enabled, ask the model:
     - "What's the present value of a $1,000/year annuity at 5% for 10 years?" Verify `tvm` is called with `op: "pv"`.
     - "Compute XIRR for this PE fund: $-1M on 2020-01-01, $200K on 2021-06-30, $1.5M on 2024-12-31." Verify `xirr` returns within a turn.
     - "Build a 5-year double-declining depreciation schedule for a $50,000 truck with $5,000 salvage." Verify `depreciation` returns the schedule and the `data-table` block renders 5 rows.
   - Confirm none of the new tools require `stationData`.

---

## Out-of-band considerations

- **No deployment coordination.** Tools are rebuilt every turn.
- **No telemetry.** Tracking which `tvm.op` the model picks is a separate workstream.
- **Existing `npv`/`irr` tools stay.** They handle regular-cashflow inputs; `xnpv`/`xirr` handle dated inputs. The model picks based on input shape. No deprecation, no compat alias.

---

## PR shape

- Branch: continue on `feat/expand-tool-set-capabilities` or fork `feat/analytics-pack-phase-3`.
- Commits: four conventional-commits-style commits matching the slices, in the listed order:
  - `feat(tvm-tool): consolidate pv/fv/pmt/rate/nper into a single TVM tool`
  - `feat(xnpv-tool): irregular-date NPV (Excel XNPV semantics)`
  - `feat(xirr-tool): irregular-date IRR via Newton-Raphson on xnpv`
  - `feat(depreciation-tool): straight-line, declining-balance, and double-declining-balance schedules`
- PR description: link the discovery + spec + plan docs. Note the discovery delta (xirr/xnpv/sln/ddb hand-rolled because not exported by the installed `financial` package). Reference the phasing table — phase 3 of seven; phases 4–7 unstarted.
