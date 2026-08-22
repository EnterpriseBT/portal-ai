# Uniform tool cost gate — Plan

**TDD-sequenced implementation of the enforcement gate: `resolveCallCost` + who-pays units, the atomic charge/rate primitives, `CostGateService.resolveCostGate`, the `buildAnalyticsTools` wrap + guard test, and the agent-relayed deny result.**

Spec: `docs/TOOL_COST_GATE.spec.md`. Discovery: `docs/TOOL_COST_GATE.discovery.md`. Issue: #169 (epic #177). Builds on **shipped #172** (`TierService.resolveTier`, `UsageService`, the `usage` table) — all live on `main`.

Five slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/tool-cost-gate` / PR #171** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — the gate's *logic* is unit-testable in isolation before it's *wired* to real tools:

- **Slice 1** — the units rule (pure functions), no gate.
- **Slice 2** — the charge + rate primitives (DB + Redis), no gate; carries the two `ApiCode`s so the gate slice has no forward dep.
- **Slice 3** — `resolveCostGate` composes 1 + 2 with mocked deps: free-immune, who-pays, rate, quota, deny-result, fail-open. Pure gate logic, not yet attached to any tool.
- **Slice 4** — wire it: decorate `buildAnalyticsTools`, guard-test the wrap, charge `web_search`, and prove a deny surfaces as a `tool-result` chunk end-to-end. **#84 unblocks after this slice** (a metered tool inherits the gate by construction).
- **Slice 5** — the advisory `costHint` surface + docs.

No migration (the audit ledger is #179; #169 reuses #172's `usage` table).

---

## Slice 1 — `resolveCallCost` + who-pays units

Pure, dependency-free unit logic. Nothing charges yet.

**Files**

- New: `apps/api/src/services/cost-gate.service.ts` — export `resolveCallCost(toolName, input) → number` + the `COST_RESOLVERS` registry + the `CostBearer` type. (The `CostGateService` class arrives in slice 3; this slice ships only the pure helpers.)
- New: `apps/api/src/__tests__/services/cost-gate.service.test.ts` — the `resolveCallCost` cases.

**Steps**

1. **Tests (spec cases 3, 10).** `resolveCallCost` defaults to `1`; a registered fan-out resolver returns `f(N)` (stub one in the test); `0`/negative handling. Run; fail.
2. **Implement** `resolveCallCost` + empty `COST_RESOLVERS` (web_search uses the default `1`; #84 will register `geocode`'s `f(N)` later). Green.
3. Lint + type-check.

**Done when:** the `resolveCallCost` cases pass; nothing else references it yet.

**Risk:** none — pure code.

---

## Slice 2 — charge + rate primitives (+ the two `ApiCode`s)

Extend #172's `UsageService`/`UsageRepository` with the atomic conditional charge; add the Redis rate util; add the deny codes. Still no gate.

**Files**

- Edit: `apps/api/src/constants/api-codes.constants.ts` — `TOOL_USAGE_RATE_LIMITED`, `TOOL_USAGE_QUOTA_EXCEEDED`.
- Edit: `apps/api/src/db/repositories/usage.repository.ts` — `chargeConditional(row, allocation, client?) → number | null`.
- Edit: `apps/api/src/services/usage.service.ts` — `tryCharge(...) → ChargeResult`.
- New: `apps/api/src/utils/rate-limit.util.ts` — `incrementRateWindow(key, now)`.
- New/extend tests: `…/__integration__/db/repositories/usage.repository.integration.test.ts` (charge cases 11–15); a small unit test for `incrementRateWindow` against a fake/real Redis.

**Steps**

1. **Integration tests (spec cases 11–15).** first charge within allocation returns new used; over-allocation charge → `null`, row unchanged; **concurrent charges never overshoot** (two awaited `tryCharge` at the boundary — at most one succeeds); `allocation === null` always charges; accumulation across calls. Run; fail.
2. **Implement `chargeConditional`** per spec — a transaction: seed-`INSERT … onConflictDoNothing` (row exists at 0) + a guarded `UPDATE … WHERE unitsUsed + units <= allocation RETURNING`. The `UPDATE` is the atomic gate (row lock); `allocation === null` ⇒ `TRUE` guard.
3. **Implement `UsageService.tryCharge`** — builds the row via `UsageModelFactory`, calls `chargeConditional`, maps to `ChargeResult` (`allowed`, `used`, `available`); on deny, reads current for the message.
4. **Rate util** + its test (`incr` + `expire` fixed window; first call sets TTL). Add the two `ApiCode`s.
5. Green; lint + type-check.

**Done when:** cases 11–15 pass; concurrency test proves no overshoot; the codes + rate util exist. Nothing gates yet.

**Risk:** the initial-INSERT path over-charges. Mitigated by seeding `unitsUsed = 0` and doing the guarded `+= units` in the `UPDATE` (test 12). Confirm the `onConflictDoNothing` target matches #172's partial unique index (`(org,period,class) WHERE deleted IS NULL`).

---

## Slice 3 — `CostGateService.resolveCostGate` (gate logic, mocked deps)

The decision logic, composed from slices 1–2, unit-tested in isolation. Not attached to any tool.

**Files**

- Edit: `apps/api/src/services/cost-gate.service.ts` — add `CostGateService.resolveCostGate(ctx) → GateResult`, the `CostGateContext`/`GateResult` types, and the `deny(...)` helper.
- Edit: `apps/api/src/__tests__/services/cost-gate.service.test.ts` — cases 1–9.

**Steps**

1. **Unit tests (spec cases 1–9)**, mocking `TierService.resolveTier`, `UsageService.tryCharge`, `incrementRateWindow`: `free` → allowed, no resolve/charge; `costBearer: organization` → allowed, no charge; `units 0` → allowed; within allocation → charged, allowed; rate over → `TOOL_USAGE_RATE_LIMITED` (quota **not** charged); quota exceeded → `TOOL_USAGE_QUOTA_EXCEEDED`; `expensive` charged; infra error → fail-open + warn; deny result shape `{ error: { code, message, retryAfter? } }`, never throws. Run; fail.
2. **Implement `resolveCostGate`** per spec — free short-circuit → who-pays short-circuit → `resolveCallCost` → `resolveTier` → rate (Redis) → quota (`tryCharge`) → `deny`/allow; wrap the resolve/rate/charge in a `try/catch` that fails open + logs. Green cases 1–9.
3. Lint + type-check.

**Done when:** cases 1–9 pass. The gate is a pure function of its context; still unreferenced by tool dispatch.

**Risk:** rate-before-quota ordering (a rate denial must not charge). Test 5 asserts `tryCharge` isn't called on a rate denial.

---

## Slice 4 — Wire the gate: `buildAnalyticsTools` wrap + guard + `web_search` + relay

The gate goes live. After this slice, every tool call is charged/denied.

**Files**

- Edit: `apps/api/src/services/tools.service.ts` — track `customToolNames: Set<string>` in the assembly; after building `tools`, decorate every entry's `execute` with the gate prelude (built-in `costHint` from `ALL_TOOL_CAPABILITIES`, custom from the tool's capability; `costBearer` = custom ? `organization` : `application`).
- New/extend tests: a guard test over `buildAnalyticsTools` output (case 16); `web_search` charge/deny integration (17); custom-tool-never-charged (18); `free` tool runs under exhausted quota (19); agent-relay (20).

**Steps**

1. **Guard test (case 16).** Build the tools for a fixture org/station and assert **every** entry (built-in and custom) routes through the gate — e.g. a spy on `CostGateService.resolveCostGate` is invoked for each tool name, or a marker the wrap sets. Run; fail.
2. **Behavior tests (17–19).** `web_search` past quota → returns the `TOOL_USAGE_QUOTA_EXCEEDED` **result object** (not a throw); within budget → normal result + `usage` incremented. A custom webhook tool: `tryCharge` **not** called (spy). `current_time` (`free`) runs even with metered/expensive exhausted. Run; fail.
3. **Implement the wrap** per spec — the decorate loop over `Object.entries(tools)`, tracking custom names. `free`/org-paid short-circuit inside the gate, so the wrap is unconditional but cheap.
4. **Relay test (case 20).** A denied call surfaces as a `tool-result` chunk (not a stream `error`) — the turn continues. Exercise through the portal/stream path (or assert the wrap returns an object, not throws, and reference `portal.service.ts:661` handling).
5. Green; lint + type-check.

**Done when:** cases 16–20 pass; `web_search` is gated end-to-end; the guard proves no tool is un-wrapped. **#84's metered GIS tools now unblock** — they register a `resolveCallCost` and inherit the gate.

**Risk:** the wrap changes `execute`'s effective signature/behavior for tools the dispatcher calls directly (bulk-dispatch resolves the wrapped `ai.tool()` for built-ins — covered; custom bulk fan-out builds a separate executor and is 0-units anyway — discovery Open Q7). Confirm the bulk-transform dispatcher still works (its built-in executor is the wrapped one; charging happens at the outer call).

---

## Slice 5 — Advisory `costHint` to the agent + docs

Non-enforcement: help the agent be a good citizen with org-hosted tools; sync the docs.

**Files**

- Edit: `apps/api/src/prompts/system.prompt.ts` — annotate custom/org toolpack tools whose `costHint` is `metered`/`expensive` with advisory copy ("the organization pays per call"). Built-in gated tools' guidance unchanged.
- Edit: `docs/CUSTOM_TOOLPACK_INTEGRATION.md` — "`costHint` is advisory for org-hosted tools; built-in `metered`/`expensive` is server-enforced."
- Edit: `README` / `CLAUDE.md` — the cost-control convention (the gate exists; who-pays rule).
- Edit tests: `system.prompt.test.ts` pinning test if the advisory copy is asserted there.

**Steps**

1. Add the advisory annotation in `system.prompt.ts`; update the pinning test if present.
2. Update the three doc surfaces.
3. Lint + type-check; run `system.prompt.test.ts`.

**Done when:** the agent sees advisory cost context for org tools; docs describe the shipped behavior (doc-sync convention satisfied).

**Risk:** none (advisory copy + docs).

---

## Sequence summary

| Slice | Lands | Spec cases | Tests |
|---|---|---|---|
| 1 | `resolveCallCost` + who-pays units | 3, 10 | api unit |
| 2 | `chargeConditional` + `tryCharge` + rate util + `ApiCode`s | 11–15 | api unit + integration |
| 3 | `CostGateService.resolveCostGate` (mocked deps) | 1–9 | api unit |
| 4 | `buildAnalyticsTools` wrap + guard + `web_search` + relay | 16–20 | api integration |
| 5 | advisory `costHint` + docs | — | api unit (prompt pin) |

Total ≈ **20 cases**, no migration. Commits on `feat/tool-cost-gate`; PR #171 grows commit-by-commit.

---

## Cross-slice notes

- **No new table, no migration.** #169 charges #172's shipped `usage` table via the new `chargeConditional`; the durable balance + Settings display are #172's. The per-call audit ledger is **#179** (post-Stripe).
- **Who-pays is a wrap-time flag, not a runtime lookup.** `buildAnalyticsTools` already knows which entries are custom (added in the org-toolpack loop) — the wrap tags them `costBearer: "organization"`, so the gate short-circuits to 0 units without inspecting the tool. Built-ins are `"application"`, charged per `ALL_TOOL_CAPABILITIES[name].costHint`.
- **`free` and org-paid short-circuit first** — the gate touches no DB/Redis for them, so the unconditional wrap is cheap for the common case (most calls are `free`).
- **Uniform fail-open** (D6) lives in `resolveCostGate`'s `try/catch`; a Redis outage drops only the rate check (quota is Postgres), a `tryCharge` DB error fails open + logs.
- **`expensive` composition:** the gate charges `expensive` against the allocation; the existing `CostAcknowledgementService` handshake is untouched and still runs tool-local. The two are independent (accounting vs. human consent).
- **Charge-before-execute:** a tool that errors after being charged keeps the charge (the upstream cost was likely incurred). Refund-on-throw is a later refinement that wants the audit ledger (#179) to be clean.
- **CLAUDE.md compliance:** file suffixes (`*.service.ts`, `*.util.ts`, `*.repository.ts`), server-enforced gate (not prompt-based — the advisory copy is *not* the enforcement, per `feedback_no_prompt_safety_gates`), and the doc-sync surfaces (slice 5) all hold. No SDK/env changes.

---

## Next step

Implement slice 1. Before coding, re-read the spec's *Surface* skeletons — they're faithful to the shipped `UsageService`/`UsageRepository` (from #172) and the real `buildAnalyticsTools` shape; lift, don't reinvent.
