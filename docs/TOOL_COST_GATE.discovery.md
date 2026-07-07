# Uniform tool cost gate — Discovery

**Issue:** [EnterpriseBT/portal-ai#169](https://github.com/EnterpriseBT/portal-ai/issues/169)

**Builds on:** [#172](https://github.com/EnterpriseBT/portal-ai/issues/172) — **shipped & merged** (PR #175). #172 delivered the allocation *and* the durable usage accounting this gate stands on: `TierService.resolveTier(org) → TierPolicy` (the per-org allocation, async + TTL-cached), the per-org **`usage`** balance table with `UsageService.increment(...)` (atomic UPSERT) + `UsageService.getBalance(...)`, `TierService.periodIdFor(...)`, and the Settings → Organization tier/usage display that reads `getBalance`. **Blocks:** [#84](https://github.com/EnterpriseBT/portal-ai/issues/84) (GIS toolpack — `geocode`/`reverse_geocode` are the first new metered consumers).

> **Scope reconciled to shipped #172 (2026-07).** This doc originally owned the per-org *tier* **and** planned to build its own durable usage ledger as the source of a Settings display. #172 has since shipped and merged **both** halves of that: the tier as a first-class subscription object (`tiers` table, `resolveTier → TierPolicy`, monthly unit allocation) **and** the durable per-org usage balance (`usage` table, `UsageService.increment`/`getBalance`) plus the Settings display that reads it. So this ticket is now purely **enforcement**: on each tool call, resolve the org's `TierPolicy`, decide allow/deny, and **increment #172's usage balance via `UsageService.increment`**. It builds no tier model, no durable usage store, and no display — those exist. What remains uniquely #169's: the build-time gate wrap, `resolveCallCost` (units per call), the hot-path atomic deny, and the deny→agent result. (A per-call **audit** ledger — the itemized "which calls" trail behind #172's aggregate balance — is **deferred to [#179](https://github.com/EnterpriseBT/portal-ai/issues/179)**, sequenced after Stripe billing #176; it adds no enforcement value here.)

**Why this exists.** Tools *declare* their cost (`costHint: free | metered | expensive` on `ToolCapability`) but enforcement is fragmented: `expensive` has a bulk-job acknowledgement handshake wired into exactly one tool, `metered` has **nothing** (`web_search` hits Tavily with no rate limit, no quota, no per-org metering). The *accounting* substrate now exists (#172's `usage` balance), but nothing **charges** it and nothing **denies** on exhaustion. A runaway agent loop still bills uncapped. This is the **cost mirror of the cardinality surface** (#161): the declaration half exists (`costHint`); this adds the missing shared *enforcement* half — a `resolveCostGate` every tool call routes through, keyed by `costHint` + the org's `TierPolicy`, that charges and caps #172's per-cost-class allocation.

**The metering model (enterprise-grade, not a prototype).** The gate counts **units, not calls** — flat per-call is the degenerate case `weight = 1`. Each call resolves a cost via `resolveCallCost(tool, input) → units`, deterministic and knowable *before* execute (input cardinality via `getMeta`). Because built-in metered tools do **not** report actual consumed units back (Tavily, geocoding bill opaquely), the tool's configured per-call unit charge *is* the cost model and the **`consumption` cardinality ceiling is the runaway guard** — a fan-out tool charges `N × per-call-units`, bounded by its input ceiling. So the gate is single-phase: **compute units → atomically check the allocation and charge → deny (typed result) or proceed.** No reconcile phase (nothing to reconcile against). The durable balance the charge lands in, and the Settings display of it, are #172's (shipped); #169 adds the enforcement (atomic deny). The per-call audit trail is a separate concern, deferred to [#179](https://github.com/EnterpriseBT/portal-ai/issues/179) (post-billing).

## The current shape

### Tool dispatch — where execution actually happens

| Step | Where | Note |
|---|---|---|
| Agent loop | `PortalService.streamResponse()` → `streamText({ tools })` (`portal.service.ts:630`) | The Vercel AI SDK owns the tool-calling loop |
| Tool set built | `ToolService.buildAnalyticsTools(organizationId, stationId, userId, portalId)` (`tools.service.ts:387`) | **The one place every tool is constructed** — `organizationId` in scope |
| Per-tool wrap | each tool's `.build()` returns `ai.tool({ inputSchema, execute })` | `execute` closes over `organizationId` etc. |
| Execution | **the SDK** calls each tool's `execute()` internally | **No application-level interception point at call time** |
| Existing gate | `CostAcknowledgementService` called *inside* `TransformEntityRecordsTool.execute` (`transform-entity-records.tool.ts:331`) | tool-specific, not uniform |

**The pivotal fact:** the SDK does not expose a tool-execute middleware, so a "uniform gate" cannot be runtime dispatch. The uniform point is **build-time**: `buildTools` wraps every `ai.tool()`, so decorating each `execute` there runs the gate on every call, by construction.

### `costHint` today

Declared at `tool-capability.model.ts:98` (built-ins) and `BulkDispatchMetadata.costHint` (custom/webhook tools, `organization-toolpack.model.ts`); values in the `CAPABILITIES` matrix (`builtin-toolpacks.ts`). Read in exactly two spots — `transform-entity-records.tool.ts:331` (branch on `=== "expensive"`) and `tools.service.ts:308` (capability vs `bulkDispatch` fallback). **No centralized read.**

### The existing `expensive` gate (to compose, not replace)

`cost-acknowledgement.service.ts` — Redis key `cost-ack:{portalId}:{signature}` (TTL 15 min). `recordRejection` stores `rejectedAt`; `validate` confirms a Redis entry exists **and** the portal's latest *user*-message timestamp is later than `rejectedAt` (the server-knowable "a human consented" signal), then consumes the entry. The signature (`cost-acknowledgement.service.ts:48`) hashes `(sourceEntity, targetEntity, expression, keyField, batchSize)` — **bulk-transform-specific**; it cannot be computed for an arbitrary tool.

### Rate-limit + Redis primitives

`token-bucket.util.ts` is **in-process only** (no persistence, no cross-instance coordination); its sole use is per-batch in `bulk-transform-tool.dispatcher.ts:99`. `redis.util.ts:10` exposes a singleton `getRedisClient()`; key convention `{domain}:{context}:{id}`, TTLs via `EXPIRE` (cost-ack 15 min, file-cache 60 min).

### Organization model + how `organizationId` reaches a tool

`organizations` now carries a `tier` slug (FK → `tiers.slug`, shipped #172). `organizationId` comes from `req.application!.metadata.organizationId` (e.g. `portal.router.ts:100`), flows into `buildAnalyticsTools(...)`, and is closed over in every `execute` — so the gate can call `TierService.resolveTier(org)` and `UsageService.increment(...)` per call with no refetch plumbing.

### Shipped in #172 — what this gate consumes (the concrete seams)

| Seam | Signature (shipped) | Gate uses it to… |
|---|---|---|
| `TierService.resolveTier(org)` | `→ Promise<TierPolicy>` (async, ~60s in-process TTL cache, default-tier fallback, never throws) | get the org's per-cost-class allocation + `period` |
| `TierService.periodIdFor(period, at)` | `→ "YYYY-MM"` | derive the billing-period key for the charge |
| `UsageService.increment(orgId, costClass, units, periodId, actor, client?)` | atomic per-`(org,period,class)` UPSERT (`+= units`) | **charge** the balance after an allow |
| `UsageService.getBalance(org, policy, at)` | `→ { periodId, byClass: {used, available} }` | read remaining allocation (for the deny check) |
| `usage` / `tiers` tables + `GET /api/organization/usage` + Settings display | — | already surface used/available; the gate just needs to charge |

`TierPolicy.allocations.{free,metered,expensive}.{unitsPerPeriod, ratePerMin}` (nullable = unlimited), `TierPolicy.period` (monthly, `anchorDay`), `TierPolicy.perToolCaps?`, `TierPolicy.overage` (`hard-deny | soft-alert`) are all live. The gate reads these; it defines none of them.

### Error surfacing

`ApiCode` enum (`api-codes.constants.ts`) already has `BULK_DISPATCH_COST_NOT_ACKNOWLEDGED:491`, `BULK_DISPATCH_COST_ACKNOWLEDGEMENT_INVALID:489`, `SQL_QUERY_COST_NOT_ACKNOWLEDGED:308`. A tool that **throws** `ApiError` inside `execute` becomes a stream *error* chunk (`portal.service.ts:685`) — which tends to kill the turn rather than let the agent react.

### Built-in vs. custom toolpack tools — one contract, one wrap (confirmed)

Both tool families are constructed identically: a built-in is `new SqlQueryTool().build()` and a custom/webhook tool is `new WebhookTool(...).build()` (`webhook.tool.ts:102`), and **both `.build()` return `ai.tool({ inputSchema, execute })`** assigned into the same `tools` record inside `buildAnalyticsTools` (`tools.service.ts:611-647` for the custom path). Both declare `costHint` through the **same** `ToolCapabilitySchema` (built-ins via `ALL_TOOL_CAPABILITIES` `tool-capabilities.ts:62`, custom via `tool.capability?.costHint ?? bulkDispatch.costHint` `tools.service.ts:309`). So a single build-time wrap covers **both** by construction — the guard test asserts every tool, built-in or custom, is wrapped.

**Criterion 3 is the shared *mechanism*, not identical charging.** Charging is **who-pays-aware** (see *The who-pays rule* below): a built-in metered tool (`web_search`→Tavily) is Portal-paid → charged units; a custom webhook is org-hosted → charged **0** units, its `costHint` advisory. Both route through the identical wrap; `resolveCallCost` returns `0` for the custom one. **Consequence for the fan-out seam:** the "custom bulk-dispatch bypasses the wrap" gap (`lookupBulkDispatchable` → `ToolService.callWebhook`, `tools.service.ts:300`) is a **non-issue for billing** — custom webhooks charge 0 on any path. The seam only matters for a *built-in* metered tool used as a bulk expression, which is charged at the outer `transform_entity_records` call (Open Q7).

### The who-pays rule — units meter *application*-incurred cost only

The subscription tier is what **Portal** charges an org for consuming **Portal's** paid capabilities. So the axis that decides whether a call charges units is *who pays the third party*:

- **Application-paid** (built-in tools that hit a third-party API Portal pays for, or run heavy Portal compute): `web_search`, `geocode`/`reverse_geocode` (#84), expensive compute → **charge units** against the tier.
- **Organization-paid** (custom webhook tools — the org hosts the endpoint and owns its API keys / infra / bill): **charge 0 units, always.** Portal incurs no metered third-party cost; the org already pays for their own webhook directly.

For v1 this is a **clean binary** by tool provenance: **custom/webhook ⇒ org-paid ⇒ 0 units**; built-in ⇒ charged per its `costHint`. An explicit declared "cost bearer" flag (to let a built-in be org-paid, or a custom tool opt into Portal-metering) is a later generalization, deferred.

A custom tool's declared `costHint` isn't discarded — it's surfaced to the **agent as advisory context** (in the tool description / `system.prompt.ts`) so the session reasons responsibly about the org's own endpoint (don't hammer a webhook the org marked `expensive`). This is *advisory*, not a server gate: there is no Portal cost to enforce, so it correctly stays out of the server-enforced path (no conflict with "safety gates get server enforcement, not prompt instructions" — that rule protects against real app-side cost/damage, which org-paid webhooks don't create for Portal).

### Frontend — Settings → Organization tab (shipped by #172)

The Settings → Organization "Subscription & Usage" section is **shipped** (#172): it reads `GET /api/organization/usage` → `getBalance` and renders tier + per-class used/available. **This ticket needs no frontend work** — once the gate calls `UsageService.increment`, the *existing* display reflects the charged usage automatically (verified in #172's smoke: an inserted usage row surfaced as `used`/`available` with no UI change). #169 is API-only.

## The design space

### Decision 1 — Where the gate hooks in

| | A — hand-call in each `execute` | B — wrap at `ai.tool()` build | C — SDK middleware |
|---|---|---|---|
| Uniform | no (discipline; easy to forget) | **yes (by construction)** | n/a |
| Guard-testable | weak | **assert `buildTools` wraps all** | n/a |
| Feasible | yes | yes | **no — SDK exposes none** |

**Lean: B.** `buildTools` decorates each tool's `execute` with a gate prelude (`await resolveCostGate({ organizationId, toolName, costHint, input })` → return a typed deny result on deny, else delegate). The prelude computes units (`resolveCallCost`), atomically checks-and-charges against the org's `TierPolicy`, and writes the ledger row. One wrap site, every tool covered, and a guard test asserts no tool is constructed un-wrapped — the exact mirror of the cardinality follow-up's "no tool open-codes a threshold check."

### Decision 2 — Rate-limit + quota mechanism (reconciled to #172's shipped `usage`)

Two different limits, two different homes now that #172 shipped a durable per-period balance:

**Quota (units per billing period).** #172's `usage` table **is** the billing-grade, cross-instance, durable source of truth, and `UsageService.increment` is already an atomic per-`(org,period,class)` UPSERT. The gate should charge *there*, not in a parallel Redis counter — a separate Redis quota counter would just be a second store to reconcile against the one that already backs the Settings display. **Lean: extend `UsageService` with an atomic *conditional* charge** — `tryCharge(org, costClass, units, allocation, periodId) → { allowed, used, available }` — a single DB statement that increments **only if** `used + units ≤ allocation` (e.g. `INSERT … ON CONFLICT … DO UPDATE SET units_used = units_used + :units WHERE usage.units_used + :units <= :allocation`, returning the row; no row updated ⇒ denied). Postgres gives the atomicity that avoids the "two concurrent N-unit calls both pass" overshoot — no Lua, no Redis/DB drift, and the charge lands in the exact table the display reads.

**Rate (burst, per minute).** Ephemeral, high-frequency, not worth a DB row per minute. **Lean: a Redis short-window counter** (`usage:rate:{org}:{epochMinute}`, `INCR`+`EXPIRE ~2 min`) checked against `TierPolicy.allocations.<class>.ratePerMin`. Reuses the cost-ack Redis patterns; fail-open on Redis-down for this cheap check (Open Q6).

| | quota | rate |
|---|---|---|
| Home | #172 `usage` table (durable, billing-grade) | Redis short window (ephemeral) |
| Mechanism | atomic conditional UPSERT (`UsageService.tryCharge`) | `INCR`+`EXPIRE` |
| Why | one store, no reconciliation, feeds the shipped display | per-minute burst doesn't belong in Postgres |

_(Supersedes the earlier "Redis Lua atomic check-and-charge + own Postgres ledger" plan, which predated #172 shipping the `usage` balance. The old plan built a durable store this ticket no longer needs.)_

### Decisions 3 & 4 — Where `tier` lives + tier→limits resolution → **shipped in #172**

The tier is a first-class subscription object **shipped** in #172: the `tiers` table (dual-schema), `TierService.resolveTier(org) → TierPolicy` (async, TTL-cached, default-tier fallback), and the tier→allocation data (seeded `standard`). This gate **consumes `TierPolicy`** and touches none of that model. What it reads (all live): `allocations.{free,metered,expensive}.{unitsPerPeriod, ratePerMin}` (nullable = unlimited); `period` → the `periodId` via `TierService.periodIdFor`; `perToolCaps?`; `overage` (`hard-deny | soft-alert`).

### Decision 8 — The units resolver + charge (this ticket's core)

The durable *balance* and its display are #172's (`usage` table, `getBalance`, Settings). What's uniquely this ticket's:

- **`resolveCallCost(tool, input, ctx) → units`** — a per-tool cost function, for **application-paid** tools only. `web_search` returns `1`; a fan-out tool returns `f(N)` where `N` is input cardinality read via `getMeta(handle).rowCount` *before* execute (the same lookup streaming tools already do). Flat is `weight = 1`; there is no flat-vs-weighted branch. **Custom/webhook (org-paid) tools return `0`** (the who-pays rule) — wrapped like everything else, never charged. Each app-paid tool declares its resolver alongside `costHint`.
- **Charge-before-execute against #172's balance.** Units are knowable pre-execute, so the gate calls `UsageService.tryCharge` (Decision 2) *before* running — an over-budget call is denied before it spends, not after. The charge lands in #172's `usage` balance, which the Settings display already reflects. No two-phase reserve/reconcile (no upstream actuals).
- **No per-call ledger here.** #172's `usage` table gives the aggregate balance (caps spend, feeds the display); recording *which calls* consumed the units earns its keep only for chargeback/dispute, which begins with billing. **Deferred to [#179](https://github.com/EnterpriseBT/portal-ai/issues/179)** (post-Stripe #176). #169 charges the aggregate and denies — no durable store of its own.

### Decision 5 — Composing the `expensive` ack handshake

The ack handshake is parameterized by an operation-specific signature the gate can't compute generically. So the gate cannot *absorb* it.

**Lean: split responsibilities.** The gate owns **counting + rate/quota for all three classes uniformly** (an `expensive` call still increments the quota). The **human-consent handshake stays tool-local** (it needs the `acknowledgeCost` param + the per-operation signature). So `expensive` = "gate counts it against quota/rate" + "tool runs its own ack handshake as today." Uniform where it can be (accounting), operation-specific where it must be (consent). No change to `CostAcknowledgementService`.

### Decision 6 — How a denial reaches the agent

Throwing `ApiError` in `execute` becomes a stream-error chunk that tends to end the turn — the agent can't gracefully relay "budget exhausted."

**Lean: return a typed error *result*, not throw.** On deny the gate returns a structured tool result (`{ error: { code: "TOOL_USAGE_QUOTA_EXCEEDED", message, retryAfter? } }`) so the SDK delivers it as a normal tool-result the LLM reads and relays to the user, never a silent skip and never a dead turn. New `ApiCode`s `TOOL_USAGE_RATE_LIMITED` / `TOOL_USAGE_QUOTA_EXCEEDED` name the conditions; the structured result carries the code.

### Decision 7 — Surfacing tier + units to the user → **shipped in #172; nothing to build**

The Settings display of tier + used/available is shipped (#172, reading `getBalance` via `GET /api/organization/usage`). Because the gate charges #172's `usage` balance (Decision 2), the existing display reflects real consumption **with no work here** — confirmed in #172's smoke (an inserted usage row surfaced as used/available with no UI change). This ticket ships no read and no frontend.

## Tradeoff comparison

| | D1: build-wrap | D2: DB quota + Redis rate | D5: split ack | D6: error result | D8: units resolver |
|---|---|---|---|---|---|
| Spread to spec | gate prelude + guard test | `UsageService.tryCharge` + rate key | gate ⟂ handshake boundary | result shape + codes | `resolveCallCost` per-tool cost fns |
| New infra | wrap in `buildTools` | 1 rate key (extend `UsageService`) | none (reuse) | 2 ApiCodes | per-tool cost fns (no new table) |
| Reuses | `tools.service` build | **#172 `usage` table + `UsageService`**, cost-ack Redis patterns | `CostAcknowledgementService` | `ApiError`/result path | dual-schema, `getMeta` for input cardinality |
| Consumes from #172 (shipped) | — | `resolveTier`, `usage` balance, `periodIdFor` | — | — | `resolveTier` for the charge |

## Recommendation

1. **Gate as a build-time wrap.** `buildTools` decorates every `ai.tool()`'s `execute` with `resolveCostGate({ organizationId, toolName, costHint, input })`; a guard test asserts no tool is constructed un-wrapped.
2. **Count units, not calls.** `resolveCallCost(tool, input) → units` (flat = `weight 1`; fan-out = `f(N)` from input cardinality via `getMeta`), charged **before** execute so an over-budget call is denied before it spends. No reconcile phase (built-in metered tools report no upstream actuals).
3. **Charge the quota atomically against #172's `usage` balance** — extend `UsageService` with a conditional `tryCharge` (a single DB UPSERT that increments only if within allocation, returning allow/deny); **plus a Redis short-window counter** for the per-minute rate. No parallel Redis quota store, no Lua, no reconciliation — the charge lands in the table the Settings display already reads.
4. **Consume #172's `resolveTier(org) → TierPolicy`** (shipped) for the allocation + `period`; this ticket adds no tier model.
5. **No durable store of its own.** #172's `usage` balance is the record; #169 charges it and denies. The per-call **audit** trail (itemized "which calls" for chargeback) is deferred to [#179](https://github.com/EnterpriseBT/portal-ai/issues/179), after billing (#176).
6. **Gate owns accounting for all classes; the `expensive` ack handshake stays tool-local** — `CostAcknowledgementService` unchanged, just also charged against the allocation.
7. **Denials return a typed tool result** (`TOOL_USAGE_RATE_LIMITED` / `TOOL_USAGE_QUOTA_EXCEEDED`), not a thrown stream error, so the agent relays them.
8. **Units meter application-incurred cost only (the who-pays rule).** Built-ins and custom tools share the *wrap mechanism* (guard test: every tool wrapped), but charging is **who-pays-aware**: app-paid built-ins (Tavily/geocode/heavy compute) charge units; **custom/webhook tools are org-hosted → `resolveCallCost` returns `0`, never charged**. A custom tool's `costHint` is surfaced to the agent as *advisory* context (not a server gate). Clean binary for v1 (custom ⇒ org-paid); an explicit cost-bearer flag is deferred.
9. **Uniform fail-open + log on infra error.** The quota lives in Postgres (#172's `usage`), so a Redis outage drops only the per-minute rate check, not the spend cap; a rare `tryCharge` DB error fails open + logs (a DB outage is total anyway — the tool's own `execute` can't run). No weight/class split.
10. **`web_search` is the first guarded `metered` tool** — proves the gate end-to-end before GIS lands.

## Open questions

1. **~~Per-call count or weighted cost?~~ [RESOLVED — both, via one resolver.]** Count **units, not calls**: `resolveCallCost(tool, input) → units`, flat is `weight 1`, fan-out is `f(N)`. There is no flat-vs-weighted mode switch (Decision 8).
2. **~~Quota window: rolling-via-TTL or calendar-day?~~ [RESOLVED — billing period.]** The window is `TierPolicy.period` from #172 — a **monthly, contract-aligned** billing period, not calendar UTC day. The quota key is `usage:quota:{org}:{periodId}`.
3. **~~Does the gate run for `alwaysAvailable` system tools?~~ [RESOLVED — `free` is immune to all gating.]** The wrap is unconditional (guard test stays simple), but a `free` tool is **never charged and never denied** — not even rate-limited. Even an org over quota on metered/expensive keeps `current_time`/`station_context` working. The `free` branch short-circuits before any `resolveTier`/DB/Redis work.
4. **~~Non-bulk `expensive` consent?~~ [RESOLVED — defer *consent* only.]** The deferral is scoped to the human-consent *prompt*, not enforcement: the units charge is signature-agnostic and already covers any `expensive` tool (bulk or not) the day it ships; only the `acknowledgeCost` handshake stays bulk-keyed until a non-bulk `expensive` tool actually exists (then generalize to `(toolName, canonicalized-args)`).
5. **~~Increment-then-check atomicity (±1 slop)?~~ [RESOLVED — DB-atomic conditional charge.]** The quota charge is a **single conditional Postgres UPSERT** (`UsageService.tryCharge`, Decision 2) that increments only if within allocation — atomic, no Redis/DB reconciliation. (Earlier this doc proposed a Redis Lua script; #172 shipping the durable `usage` table made the DB the correct home.)
6. **~~Failure mode when Redis is down?~~ [RESOLVED — uniform fail-open + log.]** Since the quota lives in Postgres (#172's `usage`), a Redis outage drops only the per-minute rate check, not the spend cap — no uncapped-spend risk, so no fail-closed needed. A rare `tryCharge` DB error also fails open + logs (a DB outage is total). The weight-threshold sub-question is retired.
7. **~~Bulk-dispatch fan-out of a *custom* webhook tool?~~ [RESOLVED — non-issue under who-pays.]** Custom webhooks are org-paid → charge `0` units on **any** dispatch path, so the "custom fan-out bypasses the wrap" seam doesn't affect billing. The seam matters only for a *built-in* metered tool used as a bulk expression (e.g. `geocode` over N rows) — app-paid, charged `f(N)` at the outer `transform_entity_records` call (which **is** wrapped). Per-row metering of that inner built-in is a later refinement; the seam for it is the dispatcher's `toolExecutor`, not the build wrap.
8. **~~How does a payment provider set the tier?~~ [MOVED to #172.]** The `tier` column, its provider-agnostic shape, and the payment-provider write path are #172's concern.

## What this doesn't decide

- **The tier + the durable usage balance + the Settings display.** All **shipped in #172**: `tier` column, `resolveTier`, tier→allocation data, the `usage` table + `UsageService.increment`/`getBalance`, `GET /api/organization/usage`, and the Settings tier/used/available display. This ticket consumes those; it charges the balance and denies.
- **Cross-org / global provider-account rate limiting.** Per-org is the unit; protecting the upstream account as a whole is separate.
- **Usage analytics / dashboards + the per-call audit ledger.** The used/available display is shipped (#172); the itemized per-call audit trail (chargeback/dispute, per-tool analytics) is **[#179](https://github.com/EnterpriseBT/portal-ai/issues/179)**, deferred to after Stripe billing (#176). #169 ships no audit store.
- **Charging custom/webhook tools any units.** Org-hosted ⇒ org-paid ⇒ `0` units, always (the who-pays rule). Their `costHint` is advisory to the agent, never billed.
- **An explicit "cost bearer" axis.** v1 uses a clean binary (custom ⇒ org-paid); a declared flag letting a built-in be org-paid or a custom tool opt into Portal-metering is a later generalization.
- **Per-row metering of a *built-in* metered tool used as a bulk expression.** The outer `transform_entity_records` charges `f(N)` for the fan-out; booking each inner call against its own cost class per-row is a later refinement (Open Q7). (Custom-webhook fan-out is a non-issue — 0 units.)
- **The GIS tools themselves (#84).** This is the surface they consume.

## Next step

**Unblocked — #172 shipped & merged (PR #175).** `TierPolicy`, `resolveTier`, the `usage` balance, and `UsageService.increment`/`getBalance` are live on `main`, so the spec can proceed now. Write `docs/TOOL_COST_GATE.spec.md` (contract: the `resolveCostGate` signature + `resolveCallCost` per-tool cost fn with the who-pays rule, the deny-result shape, `UsageService.tryCharge` — the atomic conditional-charge extension — + the Redis rate key, the new `ApiCode`s, and the `buildTools` wrap + guard test) and `docs/TOOL_COST_GATE.plan.md` (TDD slices). Likely slicing: (1) `resolveCallCost` per-tool cost fns + the units capability extension — app-paid built-ins charge, custom/webhook return `0` (built-in + custom, no gate yet); (2) `UsageService.tryCharge` (atomic conditional charge against the shipped `usage` table) + the Redis rate-limit util + `resolveCostGate` resolver consuming `TierPolicy`, unit + integration tested; (3) the `buildTools` wrap + guard test (asserting **every** built-in *and* custom tool is wrapped — the shared-contract guard), charging `web_search` as the first `metered` consumer; (4) deny-result wiring + the two `ApiCode`s + agent-relay test + uniform fail-open; (5) surface custom-tool `costHint` to the agent as advisory context (`system.prompt.ts` / tool description) + docs (`CUSTOM_TOOLPACK_INTEGRATION.md` "costHint is advisory for org-hosted tools; built-in metered/expensive is enforced", README/CLAUDE.md cost-control convention). The Settings display needs no work (#172), and the per-call audit ledger is out (#179). Each slice green and independent; #84's metered tools unblock after slice 3.
