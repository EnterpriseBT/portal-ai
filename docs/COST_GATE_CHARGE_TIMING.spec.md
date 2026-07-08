# Cost-gate charge timing — Spec

Pins the contract for #183: bill tool usage on **successful completion**, never refund. Discovery: `docs/COST_GATE_CHARGE_TIMING.discovery.md`. Issue: [#183](https://github.com/EnterpriseBT/portal-ai/issues/183) (epic #177). Supersedes the meter-on-attempt acceptance at `docs/TOOL_COST_GATE.spec.md:317`.

## Key decisions (flag for review)

1. **Estimate → charge-on-success, no refunds** ([[feedback_bill_on_success_no_refunds]]). The gate splits into a pre-flight **admission check** (rate + affordability of the *estimated* cost, **no charge**) and a post-**success** **commit** (`chargeConditional` on *actual* units). A thrown/failed call never reaches the commit.
2. **Pre-flight *denies* when over quota** (not just warns) — otherwise a conditional commit would hand an exhausted org unlimited free expensive calls. Hard cap at admission; the conditional commit only absorbs concurrency races (surplus completes **free**, never over-billed).
3. **Async-job tools charge in the processor.** `transform_entity_records` (`resultKind: "progress"`) does pre-flight at enqueue but commits in `bulk-transform.processor.ts` on **job** success; a failed job charges nothing. All other (sync) tools commit in the wrap after `execute` resolves.
4. **No refund path, no ledger dependency.** `chargeConditional` is reused as-is; nothing decrements; #183 no longer depends on #179.

## Scope

### In scope
- Split `CostGateService.resolveCostGate` into `checkAdmission` (pre-flight, no charge) + `commitCharge` (post-success).
- Rework `wrapWithCostGate`: admission before `original`; commit after `original` resolves; **skip** the commit for async-job tools.
- Commit the charge for `bulk_transform` on **job** success in `bulk-transform.processor.ts`.
- Docs: supersede `TOOL_COST_GATE.spec.md:317`; user-facing "failed calls are free" note.

### Out of scope
- Refund/decrement machinery (retired — never charge failures).
- Per-tool unit weights / `f(N)` (`COST_RESOLVERS`, #84/#169) — this changes *when* the charge fires and that it uses *actual* units, not how units are computed.
- The `expensive` cost-acknowledgement (`acknowledgeCost`) flow — independent of unit-charge timing.

## Surface

### `apps/api/src/services/cost-gate.service.ts`

Replace `resolveCostGate` (clean cut — no back-compat alias, per `feedback_no_compat_aliases`) with two methods + a pending-charge value:

```ts
/** Resolved charge to apply on success — carried from admission to commit. */
export interface PendingCharge {
  organizationId: string;
  costClass: CostHint;         // "metered" | "expensive"
  units: number;               // estimated == actual for today's tools
  actor: { userId: string };
}

/** { allowed:true, charge } — charge is null for free/org-paid/0-unit calls
 *  (nothing to commit). { allowed:false, result } is the typed deny (unchanged
 *  shape: { error: { code, message, retryAfter? } }). */
export type AdmissionResult =
  | { allowed: true; charge: PendingCharge | null }
  | { allowed: false; result: { error: { code: ApiCode; message: string; retryAfter?: number } } };

class CostGateService {
  /** Pre-flight: free/org immune → estimate units (resolveCallCost) →
   *  rate (Redis, split-fail as today) → affordability (estimate ≤ available,
   *  via UsageService.getBalance). Denies on rate / quota. NEVER charges.
   *  Fail-open on infra error (returns { allowed:true, charge:null }). */
  static checkAdmission(ctx: CostGateContext): Promise<AdmissionResult>;

  /** Post-success commit: recompute policy + periodId at `now` (so a long
   *  async job bills the completion period), then UsageService.tryCharge
   *  (atomic chargeConditional). If the charge would exceed allocation it is
   *  simply skipped — a free call, never a failure. Never throws to the caller
   *  (logs + swallows infra errors). No-op when charge is null. */
  static commitCharge(charge: PendingCharge | null, now?: number): Promise<void>;
}
```

Affordability in `checkAdmission`: after the rate check, read `UsageService.getBalance(org, policy, now).byClass[costClass].available`; if `available !== null && estimatedUnits > available` → `deny(TOOL_USAGE_QUOTA_EXCEEDED, …)`. `available === null` (unlimited) → allow.

### `apps/api/src/services/cost-gate.service.ts` — `wrapWithCostGate` + `ToolCostMeta`

`ToolCostMeta` gains a discriminator:

```ts
export interface ToolCostMeta {
  costHint: CostHint;
  costBearer: CostBearer;
  deferChargeToJob: boolean;   // true ⇒ an async-job tool; the wrap does NOT commit
}
```

New wrap body per tool:

```ts
tool.execute = async (input, options) => {
  const admission = await CostGateService.checkAdmission({ ...ctxFor(name, input) });
  if (!admission.allowed) return admission.result;      // typed deny, agent relays
  const result = await original(input, options);         // throws ⇒ commit skipped (free)
  if (admission.charge && !meta.deferChargeToJob) {
    await CostGateService.commitCharge(admission.charge);
  }
  return result;
};
```

### `apps/api/src/services/tools.service.ts` — `metaFor`

`metaFor` sets `deferChargeToJob` from the capability's `resultKind` (a `"progress"` result ⇒ the tool dispatches an async job whose completion is tracked elsewhere):

```ts
deferChargeToJob:
  !isCustom && ALL_TOOL_CAPABILITIES[name]?.resultKind === "progress",
```

(Custom tools are org-paid and never charged, so the flag is irrelevant for them.)

### `apps/api/src/queues/processors/bulk-transform.processor.ts`

On **successful** completion of the job (both the tool-kind and sql-kind loops return `finalize(...)` without throwing), commit the charge **once**, before returning the `BulkTransformResult`:

```ts
// organizationId already resolved (top of processor); userId is in job metadata.
const costClass = ALL_TOOL_CAPABILITIES.transform_entity_records.costHint; // "expensive"
const units = await resolveCallCost("transform_entity_records", /* input n/a */ undefined); // 1 (flat)
await CostGateService.commitCharge({ organizationId, costClass, units, actor: { userId } });
```

A thrown loop (job failure) propagates before this line ⇒ **no charge**. No job-metadata schema change is needed — org + user are already in metadata (`transform-entity-records.tool.ts:711,723`), and cost class/units resolve from the capability + `resolveCallCost`.

### Error codes

**None new.** Pre-flight denials reuse `TOOL_USAGE_RATE_LIMITED` / `TOOL_USAGE_QUOTA_EXCEEDED`.

### Docs surfaces

- `docs/TOOL_COST_GATE.spec.md:317` — replace the meter-on-attempt acceptance with a pointer to this spec's charge-on-success contract.
- User-facing help (whichever of `apps/web/src/utils/faq.util.ts` / `glossary.util.ts` covers usage/units — verify in the plan): a line that a metered/expensive tool is billed **only when the call succeeds**; failed calls are free; usage resets each billing period.

## Migration / Seed

**None.** No schema change — reuses the `usage` table and `chargeConditional`; no new columns, no job-metadata field.

## TDD test plan

```bash
cd apps/api && npm run test:unit          # gate split + wrap
cd apps/api && npm run test:integration   # processor commit-on-success (if DB-backed)
```

### Layer 1 — `CostGateService` split (`apps/api/src/__tests__/services/cost-gate.resolve.test.ts`, rework)
- `checkAdmission`: free & org-paid → `{allowed:true, charge:null}`, no rate/balance calls; rate over limit → deny RATE_LIMITED, **no charge**; estimate > available → deny QUOTA_EXCEEDED, **no charge**; within allocation → `{allowed:true, charge:{units,costClass,…}}`; unlimited allocation → allowed; Redis-down → admission still allowed (split-fail preserved); infra error → fail-open `{allowed:true, charge:null}`.
- `commitCharge`: within allocation → `chargeConditional` called with actual units; over allocation → charge skipped (no throw); null charge → no-op; infra error → swallowed (no throw).

### Layer 2 — the wrap (`apps/api/src/__tests__/services/cost-gate.resolve.test.ts` + `tools.service.test.ts`)
- sync tool success → `commitCharge` called once after `original`.
- sync tool **throws** → `original` ran, `commitCharge` **not** called (the free-failed-call invariant — primary case).
- deny at admission → `original` not called, typed deny returned.
- `deferChargeToJob` tool (`resultKind:"progress"`) success → admission ran, wrap `commitCharge` **not** called.
- `metaFor` sets `deferChargeToJob` true only for `transform_entity_records`, false for sync built-ins, irrelevant for custom.

### Layer 3 — processor (`apps/api/src/__tests__/.../bulk-transform.processor` test, unit with mocked `CostGateService`)
- job success → `commitCharge` called once with `{costClass:"expensive", units:1, organizationId, actor}`.
- job failure (loop throws) → `commitCharge` **not** called.

**Totals ≈ 16–18 cases** (≈11 gate + ≈4 wrap + ≈3 processor). No migration test (no schema change).

## Acceptance criteria
- [ ] A tool whose `execute` throws consumes **0** units (the balance is unchanged).
- [ ] A successful metered/expensive call deducts its actual units on completion.
- [ ] An over-quota call is **denied at admission** (never runs), not run-then-free.
- [ ] A concurrency race that admits a surplus call bills at most the allocation (surplus completes free; usage never exceeds allocation via the conditional commit).
- [ ] A `transform_entity_records` job charges 1 expensive unit **only** if the job completes; a failed job charges nothing.
- [ ] No decrement/refund code exists anywhere; `usage` remains append-only.
- [ ] `TOOL_COST_GATE.spec.md:317` and the user-facing usage note reflect charge-on-success.
- [ ] `lint` + `type-check` clean.

## Risks & rollback
- **Fail mode = fail-toward-not-charging.** A thrown tool, Redis-down rate check, or failed job all yield no charge — a rare free call, never a wrong bill. This is the intended, safe direction for a customer-facing meter.
- **Existing `resolveCostGate` tests are reworked**, not extended — the clean cut replaces the method. Detected by the suite; rollback = revert the branch (behavior returns to meter-on-attempt).
- **Admission/commit are not one atomic step.** By design: enforcement is the admission deny; the commit is atomic and capped. The only imprecision is a bounded under-bill on a race — acceptable and intended.

## Files touched
- Edit: `apps/api/src/services/cost-gate.service.ts` — `checkAdmission` + `commitCharge` + `PendingCharge`; `wrapWithCostGate` commit-after-success + defer; `ToolCostMeta.deferChargeToJob`.
- Edit: `apps/api/src/services/tools.service.ts` — `metaFor` sets `deferChargeToJob`.
- Edit: `apps/api/src/queues/processors/bulk-transform.processor.ts` — commit on job success.
- Edit: `apps/api/src/__tests__/services/cost-gate.resolve.test.ts` — rework to the split.
- Edit: `apps/api/src/__tests__/services/tools.service.test.ts` — wrap defer + no-double-charge cases.
- New/Edit: `apps/api/src/__tests__/.../bulk-transform.processor` test — commit-on-success cases.
- Edit: `docs/TOOL_COST_GATE.spec.md` (supersede :317) + user-facing usage note (faq/glossary, verified in plan).

## Next step
`docs/COST_GATE_CHARGE_TIMING.plan.md` — **3 slices**: (1) split `resolveCostGate` → `checkAdmission` + `commitCharge`, rework the wrap for sync tools (charge-after-success, no-charge-on-throw) + rework the gate tests; (2) `deferChargeToJob` + the `bulk-transform.processor` commit-on-job-success + processor tests; (3) docs — supersede `spec.md:317`, user-facing "failed calls are free" note. Each a green-testable commit on `chore/cost-gate-charge-timing`.
