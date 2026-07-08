# Cost-gate charge timing — Discovery

**Issue:** [EnterpriseBT/portal-ai#183](https://github.com/EnterpriseBT/portal-ai/issues/183)

**Why this exists.** The #169 cost gate charges the org's allocation **before** it invokes a tool's `execute` (`apps/api/src/services/cost-gate.service.ts:222–232` — `resolveCostGate` charges at `:165`, then `original(input, options)` runs at `:232`). If `original` throws, the units are already spent for a call that produced no result. The #169 spec accepted this as meter-on-attempt (`docs/TOOL_COST_GATE.spec.md:317`, with refund deferred to the audit ledger #179). **Product decision on this ticket reverses that:** bill on **successful completion**, never refund — refunds on small, high-volume transactions are an accounting nightmare, and a customer should never be charged for a bad call. The model is **estimate before the call, deduct actual usage on completion**; the org eats the rare free failed call. This is the ticket that **moves the charge to the success path and retires the refund idea entirely** (see [[feedback_bill_on_success_no_refunds]]).

## The current shape

### The charge point (charge-then-call)

| Symbol | Location | Behavior |
|---|---|---|
| the wrap | `cost-gate.service.ts:222–232` | `execute = async (input, options) => { gate = await resolveCostGate(...); if (!allowed) return gate.result; return original(input, options); }` |
| the charge | `cost-gate.service.ts:165` | `UsageService.tryCharge(...)` — atomic conditional charge, committed **before** `original` runs |
| failure handling | — | no try/catch; a thrown `original` propagates uncaught, charge already landed |

The wrap already interposes on `execute`, so moving the charge to *after* `original` succeeds is a local change to this same seam — no new interception point.

### How tools signal failure

Built-in tools return a result on success and **throw** on error (`web-search.tool.ts:28–44` — Tavily failure bubbles out; `cluster`/`logistic_regression` propagate `AnalyticsService` exceptions). The AI SDK (`portal.service.ts:639–646`, `streamText({…, maxRetries: 3})`) catches a thrown `execute` into a tool-result/error chunk; `maxRetries` is for the model call, **not** tool re-execution — so a thrown tool call is **not** retried and won't double-charge.

### The charge primitives — additive only, which is exactly what we want

`UsageService`/`UsageRepository`: `increment`, `tryCharge`, `chargeConditional`, `getBalance`, `findForPeriod` — **all additive**; no decrement, and `usage.table.ts:36` `CHECK (units_used >= 0)`. The chosen design **needs no refund path** — it only ever charges on success, so `chargeConditional` (atomic, caps at allocation, never negative) is reused as-is. `getBalance` supplies the pre-flight affordability read.

### The charged tools have two completion shapes

| Tool | Class | Completion | Charge site under the new model |
|---|---|---|---|
| `web_search` | metered | sync `execute` returns | in the wrap, **after** `original` resolves |
| `cluster`, `logistic_regression` | expensive | sync `execute` returns | same — after `original` resolves |
| `transform_entity_records` | expensive | **async bulk job** — `execute` returns a `jobId` immediately (`transform-entity-records.tool.ts` ~`:604`, `:753–764`); real work runs in `queues/processors/bulk-transform.processor.ts` | in the **job processor's success path**, not on enqueue — the tool returning ≠ the work completing |

This split is the crux: for sync tools "completion" is `execute` resolving; for an async job it's the *job* succeeding, which is a different code site.

### Retry / idempotency

No idempotency key on the charge (`:222–232`); the SDK doesn't retry tool execution, so the agent loop won't double-charge. A user re-ask is a fresh, legitimately-billable call. The `usage` unique index prevents lost updates under concurrency.

## The design space

### Decision 1 — Charge timing model

**A. Meter-on-attempt (current).** Charge before `original`. Simple; over-charges failures; ratified at `spec.md:317`.

**B. Meter-on-attempt + refund-on-throw.** Charge up front, reverse on failure. Needs a decrement path + a durable ledger (#179) to be auditable; refunds on tiny high-volume calls are an accounting nightmare.

**C. Estimate-then-charge-on-success (chosen).** Pre-flight: rate limit + affordability of the *estimated* cost (deny if it can't fit remaining allocation), **no charge**. Then run `original`; on **success**, deduct *actual* units via `chargeConditional`. A failure never reaches the charge → no refund, ever.

| | A attempt | B attempt+refund | C success |
|---|---|---|---|
| Charges failed calls | yes | temporarily (refunded) | **no** |
| Needs a decrement/refund path | no | yes | **no** |
| Needs the #179 ledger | no | **yes** (auditable reversal) | **no** |
| Accounting shape | over-charges | reversals/disputes | usage = actual successful work |

**Lean: C.** It's the product decision, and it's structurally cleaner — no reversals means no ledger dependency and no negative adjustments. Supersedes `spec.md:317`; drops #183's former #179 coupling.

### Decision 2 — Sync commit: conditional vs unconditional

After a sync `original` succeeds, deduct actual units either **conditionally** (`chargeConditional` — charge only if within allocation; if a concurrency race pushed the org over, the completed call is simply **free**) or **unconditionally** (allow the balance to exceed allocation).

**Lean: conditional.** Reuse `chargeConditional` — it's atomic, caps at allocation, and "a completed over-limit call is free" is precisely the "rather a free call than a bad charge" stance. Enforcement lives at the pre-flight affordability gate; the commit never fails a completed call, it just may not bill it.

### Decision 3 — Where an async job charges

The wrap fires its post-success step when `execute` *returns* — which for `transform_entity_records` is enqueue-success, not job-success. To bill the job on completion, the charge must move into `bulk-transform.processor.ts`'s success path, with the cost context (org, costClass, estimated/actual units) carried in the **job metadata**.

**Lean: charge in the processor on job success.** The wrap does **pre-flight only** for async-job tools (affordability of the estimate at enqueue, deny → don't enqueue); the processor deducts actual on success; a failed job charges nothing. Requires threading cost context through the job metadata (the job model already carries per-type metadata, per `CLAUDE.md` → Async Job State).

## Tradeoff comparison

|  | D1: charge-on-success (C) | D2: conditional commit | D3: async charges in processor |
|---|---|---|---|
| Spread to spec | Yes — the new contract | Yes | Yes |
| Behavior change | Yes (charge moves) | Yes | Yes (new charge site) |
| Needs #179 | **No** (removed) | No | No |
| New code sites | wrap post-success | reuse `chargeConditional` | processor + job-metadata field |

## Recommendation

1. **Adopt estimate-then-charge-on-success** — the gate splits into a pre-flight check (rate + affordability of the estimated cost, deny if it can't fit, **no charge**) and a post-**success** commit (`chargeConditional` on actual units). Supersede `TOOL_COST_GATE.spec.md:317`.
2. **Sync tools** commit in the wrap **after** `original` resolves; a thrown `original` skips the commit (free failed call).
3. **Async-job tools** (`transform_entity_records`) do pre-flight at enqueue and commit in the **job processor's success path**; carry cost context in the job metadata; a failed job charges nothing.
4. **Estimate = actual** for today's tools (cost is deterministic from input via `resolveCallCost`); keep the two-phase shape so a future tool whose cost is only known at completion can report actual post-hoc.
5. **Retire the refund idea** — remove #183's dependency on #179 for refunds; no decrement path is added. Update the user-facing note to "you're billed when a call succeeds; failed calls are free."

## Open questions

1. **Does the pre-flight affordability check deny, or just warn?** With a conditional commit, an over-quota call would run then go unbilled (free). To preserve a real quota, the pre-flight should still **deny** when the estimate exceeds remaining allocation. **Lean: deny at pre-flight** (hard cap at admission), conditional commit only mops up concurrency races. Otherwise an exhausted org gets unlimited free expensive calls.
2. **Async job metadata shape for the charge.** What exactly does the processor need — `{organizationId, costClass, units, periodId?}` (recompute periodId at completion so a job spanning a period boundary bills the completion period)? **Lean: carry `{organizationId, costClass, estimatedUnits}` and recompute `periodId` + actual units at completion.**
3. **Does moving the charge affect the deny-relay UX?** Today a quota denial is a typed tool-result the agent relays. Pre-flight still denies the same way; only the *charge* moves. **Lean: no UX change** — the deny path is unchanged; success just now gates the charge.
4. **What about `expensive` cost-acknowledgement?** `expensive` also implies a pre-dispatch cost ack elsewhere; this ticket only moves the *unit charge* timing, not the ack. **Lean: out of scope** — confirm the ack flow is independent.

## Enterprise-scale considerations

- **Accuracy & auditability** — *strongly improved.* Usage now equals actual successful work; there are **no reversals**, so no ledger is needed to keep the count defensible. This is the cleanest possible input for the future #179 ledger (append-only successful charges).
- **Concurrency & correctness** — the pre-flight check is a non-atomic read (`getBalance`) and the commit is the atomic `chargeConditional`. Under concurrency, more calls may be *admitted* than fit; the conditional commit bounds actual billing to the allocation (the surplus completes free). Correct-by-construction: we never over-bill, at worst we under-bill a racing call. Accepted, and it matches the product stance.
- **Failure modes** — *fail toward not charging.* A thrown tool, a Redis-down rate check (already fails open per #169's split policy), or a failed job all result in **no charge**. The cost is a rare free call, never a wrong bill.
- **Multi-tenancy** — unchanged; charge is per-org keyed as today.
- **Scale / Data lifecycle** — `N/A` — no new period/retention semantics; the async charge recomputes `periodId` at completion (a plus for long jobs).
- **Contract stability** — the two-phase (estimate → commit) shape is the right long-term contract: it accommodates future tools whose actual cost is only known at completion, and Stripe metered-usage billing (#176) maps naturally onto "actual units on success."

## What this doesn't decide

- **The #179 audit ledger** — still worthwhile as an append-only record, but this ticket **removes** its role as a refund prerequisite. No refund machinery is built anywhere.
- **Per-tool unit weights** (`COST_RESOLVERS`, `f(N)`) — #84/#169; this ticket changes *when* the charge fires and that it uses *actual* units, not how a tool's units are computed.
- **The `expensive` cost-acknowledgement dispatch flow** — independent of charge timing.

## Next step

Write `docs/COST_GATE_CHARGE_TIMING.spec.md` — the two-phase contract (pre-flight `checkAdmission` vs post-success `commitCharge`), the wrap change for sync tools, the processor charge + job-metadata field for async jobs, and the superseded `spec.md:317` note. The plan will carve roughly **3 slices**: (1) split `resolveCostGate` into pre-flight check + commit and move the sync charge after `original`; (2) async-job charging in `bulk-transform.processor.ts` + the job-metadata cost context; (3) docs — supersede note, user-facing "failed calls are free" copy, and remove the #179 refund coupling. Each a green-testable commit on `chore/cost-gate-charge-timing`.
