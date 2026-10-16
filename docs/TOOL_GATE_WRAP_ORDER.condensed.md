# Tool gates: refusals never reach the cost gate — Condensed design (#811)

**Issue:** [EnterpriseBT/portal-ai#811](https://github.com/EnterpriseBT/portal-ai/issues/811) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `ToolService.buildAnalyticsTools` decorates each tool's `execute` in place, so the **last** wrap applied is the **outermost**. Today the order is: output cap → input-character gate → **cost → permission → lock** → tool. The permission gate's comments (`tools.service.ts`, `permission-gate.service.ts:16–17`) say it sits *outside* the cost gate, "so a denied call never reaches cost admission". It doesn't. Two costs follow:
- **Charges:** `wrapWithCostGate` commits the charge for any result that resolves, without inspecting it. A permission or lock refusal of a charged, non-deferred tool would be billed.
- **Rate slots:** admission itself increments the org's Redis rate window (`checkAdmission` → `incrementRateWindow`). So even a refusal that would never be charged uses up a rate slot today.

The charge is latent: every tool with a `TOOL_AUTHORIZATION` descriptor is free or defers its charge to a job. But the first metered write tool would bill refusals. `apps/api` only, billing-adjacent.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Wrap sequence | `apps/api/src/services/tools.service.ts`, end of `buildAnalyticsTools` | lock → permission → cost → input → cap (applied in that order) |
| Cost gate | `services/cost-gate.service.ts:327` `wrapWithCostGate` | `checkAdmission` (charges the rate window) → `original` → `commitCharge` on any resolved result |
| Permission gate | `services/permission-gate.service.ts` | doc says "applied *outside*" the cost gate |
| Lock gate | `services/lock-gate.service.ts` | doc says "inside the cost gate (a write tool is free or charges on job success, so a refusal is never charged)" |
| Order guards | `__tests__/services/tools.service.test.ts` | #769: lock applied before permission (inside it). #805: a NUL refusal never reaches admission. Permission and lock gates are spies there. |

## Decision — reorder vs. teaching the cost gate to skip refusals

- **A. Reorder (chosen).** Apply the cost gate **first**, so it wraps innermost: output cap → input → **permission → lock → cost** → tool. Every gate refusal returns before admission, so no refusal is charged and none uses a rate slot. That's the order the comments already describe, and it keeps the existing invariant that lock sits inside permission.
- B. Keep the order and have `wrapWithCostGate` skip `commitCharge` for typed refusals. That couples the cost gate to other gates' result codes, still spends a rate slot per refusal, and leaves the wrong comments' premise in place.

**Cost of A:** the lock gate holds its scope locks (and one pooled connection) across admission and commit too. That adds a Redis increment and the usage UPSERT to the hold, a few milliseconds, and only on `target`-locked write tools, which are free today and so skip both. Accepted.

A tool's *own* error result (one its `execute` returns) is still charged as today. Whether failed calls should be billed is a policy question (#183), not this ordering bug.

## Plan — 1 slice

**Files**
- edit `apps/api/src/services/tools.service.ts`: move `wrapWithCostGate` ahead of `wrapWithLockGate`, and rewrite the three gate comments so they say where each gate sits and why.
- edit `apps/api/src/services/lock-gate.service.ts` header: the lock gate is *outside* the cost gate, so a refusal neither charges nor uses a rate slot.
- `permission-gate.service.ts` header: already describes the intended order; keep it.

**Tests** (`apps/api/src/__tests__/services/tools.service.test.ts`)
- **#811 guard, behavioural:** make the permission-gate spy refuse every call (`{ error: { code: PERMISSION_DENIED } }`), build the tools, and call each one. `checkAdmission` and `commitCharge` are never called. Do the same for the lock-gate spy (`ENTITY_LOCKED_BY_JOB`). This is the issue's "a charged tool whose permission check fails leaves usage unchanged".
- **Order assertion:** `wrapWithCostGate` is applied before the lock gate, which is applied before the permission gate (`invocationCallOrder`). The existing #769 assertion stays.
- Run: `npm run test:unit -- --testPathPattern "tools.service|cost-gate|lock-gate|permission-gate"`.

## Smoke (manual, against your dev stack)

1. Open a portal on a station with a writable connector, and ask the agent for a metered call, e.g. a `web_search`. It answers, and Settings → Usage shows that one charge, the same as before.
2. As a member without write on an entity, ask the agent to update one of its records. The agent relays a permission refusal, and Settings → Usage is unchanged.
3. Start a long job on an entity (a revalidation), then ask the agent to edit a record there. The agent relays that the entity is locked by the running job, and usage is unchanged.

## Out of scope

- Whether a tool's own failed result should be charged (bill-on-success policy, #183).
- The output-cap and input-character gates' positions. They're already outside the cost gate and stay there.
