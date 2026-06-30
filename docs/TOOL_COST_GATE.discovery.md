# Uniform tool cost gate + per-org usage tier — Discovery

**Issue:** [EnterpriseBT/portal-ai#169](https://github.com/EnterpriseBT/portal-ai/issues/169)

**Blocks:** [#84](https://github.com/EnterpriseBT/portal-ai/issues/84) (GIS toolpack — `geocode`/`reverse_geocode` are the first new metered consumers).

**Why this exists.** Tools *declare* their cost (`costHint: free | metered | expensive` on `ToolCapability`) but enforcement is fragmented: `expensive` has a bulk-job acknowledgement handshake wired into exactly one tool, `metered` has **nothing** (`web_search` hits Tavily with no rate limit, no quota, no per-org metering), and there is no per-org usage accounting anywhere. A runaway agent loop bills uncapped. This is the **cost mirror of the cardinality surface** (#161): the declaration half exists (`costHint`); this adds the missing shared *enforcement* half — a `resolveCostGate` every tool call routes through, keyed by `costHint` + a per-org **tier** that sets the rate/quota numbers. v1 ships one default tier from env, but `tier` is a first-class input so monetization plugs in later with no re-plumbing. This is the gate that makes "no tool, GIS or otherwise, can run away with metered spend" true.

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

`organizations.table.ts` is minimal — `id, name, timezone, ownerUserId, defaultStationId` + baseColumns; `organization.model.ts` mirrors it. **No settings/JSONB column today.** `organizationId` comes from `req.application!.metadata.organizationId` (e.g. `portal.router.ts:100`), flows into `buildAnalyticsTools(...)`, and is closed over in every `execute` — so the gate can resolve the org's tier per call with no refetch plumbing.

### Error surfacing

`ApiCode` enum (`api-codes.constants.ts`) already has `BULK_DISPATCH_COST_NOT_ACKNOWLEDGED:491`, `BULK_DISPATCH_COST_ACKNOWLEDGEMENT_INVALID:489`, `SQL_QUERY_COST_NOT_ACKNOWLEDGED:308`. A tool that **throws** `ApiError` inside `execute` becomes a stream *error* chunk (`portal.service.ts:685`) — which tends to kill the turn rather than let the agent react.

### Built-in vs. custom toolpack tools — one contract, one wrap (confirmed)

Both tool families are constructed identically: a built-in is `new SqlQueryTool().build()` and a custom/webhook tool is `new WebhookTool(...).build()` (`webhook.tool.ts:102`), and **both `.build()` return `ai.tool({ inputSchema, execute })`** assigned into the same `tools` record inside `buildAnalyticsTools` (`tools.service.ts:611-647` for the custom path). Both also declare `costHint` through the **same** `ToolCapabilitySchema` — built-ins via `ALL_TOOL_CAPABILITIES` (`tool-capabilities.ts:62`), custom via `tool.capability?.costHint ?? bulkDispatch.costHint` (`tools.service.ts:309`). So a single build-time wrap meters `web_search` (built-in) and a metered webhook tool through the *identical* code path and the *same* tier numbers — **criterion: custom toolpacks and built-ins share the rate-limit/cost contract by construction**, not by parallel implementations. **One seam differs:** the bulk-dispatch fan-out of a *custom* tool builds a separate executor (`ToolService.callWebhook`) in `lookupBulkDispatchable` (`tools.service.ts:300`) that bypasses the wrapped `execute` (built-ins dispatched in bulk are still covered, because that path resolves the wrapped `ai.tool()` from `buildAnalyticsTools`) — see Open Q7.

### Frontend — Settings → Organization tab (where the tier surfaces)

`apps/web/src/views/Settings.view.tsx` renders a two-tab Settings view (`Profile`, `Organization`); the Organization tab (tab index 1) shows org metadata through a read-only `<MetadataList>` (name, timezone, created, updated). It fetches the org via `sdk.organizations.current()` → `GET /api/organization/current` → `OrganizationGetResponse` (`@portalai/core/contracts`), query key `organizations.current()`. The frontend org object carries exactly the `OrganizationSchema` fields — so a `tier` added to that schema (Decision 3) rides `OrganizationGetResponse` with **no extra api plumbing**, and the tab gains the value by adding one `MetadataList` item (Decision 7).

## The design space

### Decision 1 — Where the gate hooks in

| | A — hand-call in each `execute` | B — wrap at `ai.tool()` build | C — SDK middleware |
|---|---|---|---|
| Uniform | no (discipline; easy to forget) | **yes (by construction)** | n/a |
| Guard-testable | weak | **assert `buildTools` wraps all** | n/a |
| Feasible | yes | yes | **no — SDK exposes none** |

**Lean: B.** `buildTools` decorates each tool's `execute` with a gate prelude (`await resolveCostGate({ organizationId, toolName, costHint })` → throw/return on deny, else delegate). One wrap site, every tool covered, and a guard test asserts no tool is constructed un-wrapped — the exact mirror of the cardinality follow-up's "no tool open-codes a threshold check."

### Decision 2 — Rate-limit + quota mechanism

The API runs multiple instances (ECS/CloudFormation), so an in-process bucket meters *per instance*, not per org. The gate needs cross-instance state.

| | A — in-process token bucket | B — Redis fixed-window counters | C — Redis token bucket (Lua) |
|---|---|---|---|
| Per-org-global correctness | **no** (per instance) | yes | yes |
| Complexity | low | **low (`INCR`+`EXPIRE`)** | high (Lua script) |
| Burst smoothness | good | boundary burst at window edge | best |

**Lean: B.** Two Redis counters per org — a short window for rate (`usage:rate:{org}:{epochMinute}`, TTL ~2 min) and a rolling window for quota (`usage:quota:{org}:{UTCdate}`, TTL ~25 h) — incremented in the gate prelude, compared to the tier's limits. Reuses the cost-ack Redis patterns; the in-process token-bucket util stays for the dispatcher (right tool for per-batch pacing, wrong one for org quotas). Boundary-burst is acceptable for v1; sliding-log is overkill.

### Decision 3 — Where `tier` lives

| | A — `tier` text column + code/env mapping | B — JSONB numbers on org | C — separate `tiers` table + FK |
|---|---|---|---|
| v1 cost | one column + dual-schema migration | one column | new table + repo + joins |
| "first-class input, one default tier" fit | **exact** | loose (numbers scattered per org) | over-built for v1 |
| Monetization path | move mapping to a table later, call sites unchanged | messy migration | already there (but premature) |

**Lean: A.** Add `tier TEXT NOT NULL DEFAULT 'standard'` to `organizations` (dual-schema: Zod model + Drizzle table + type-checks + named migration). The tier **name** is the first-class per-org input; the tier→limits mapping is a code lookup against env-configured defaults (Decision 4). v1 has one tier (`standard`); when monetization adds paid tiers, the mapping graduates to option C with **no gate call-site change** — exactly the "tier is the input shape" decision. It also keeps the eventual **payment-provider integration shallow**: a subscription-based portal (Stripe or similar, *out of scope here* — see *What this doesn't decide* / Open Q8) writes a tier **name** into this one column from its subscription webhooks; nothing else in the gate moves, and the column stays provider-agnostic (no `stripe_*` fields in v1).

### Decision 4 — Tier → limits resolution + default tier

**Lean: env-configured default tier, resolved through a single `resolveTier(org)` function.** `environment.ts` declares `TOOL_METERED_RATE_PER_MIN` / `TOOL_METERED_QUOTA_PER_DAY` (and `EXPENSIVE_*` analogues), following the existing `parseInt(... || default)` pattern (`environment.ts:155`). `resolveTier` maps a tier name → `{ ratePerMin, quotaPerDay }` per cost class; v1 returns the env defaults for every org regardless of the column value, with the column already plumbed so per-tier numbers are a later data change.

### Decision 5 — Composing the `expensive` ack handshake

The ack handshake is parameterized by an operation-specific signature the gate can't compute generically. So the gate cannot *absorb* it.

**Lean: split responsibilities.** The gate owns **counting + rate/quota for all three classes uniformly** (an `expensive` call still increments the quota). The **human-consent handshake stays tool-local** (it needs the `acknowledgeCost` param + the per-operation signature). So `expensive` = "gate counts it against quota/rate" + "tool runs its own ack handshake as today." Uniform where it can be (accounting), operation-specific where it must be (consent). No change to `CostAcknowledgementService`.

### Decision 6 — How a denial reaches the agent

Throwing `ApiError` in `execute` becomes a stream-error chunk that tends to end the turn — the agent can't gracefully relay "budget exhausted."

**Lean: return a typed error *result*, not throw.** On deny the gate returns a structured tool result (`{ error: { code: "TOOL_USAGE_QUOTA_EXCEEDED", message, retryAfter? } }`) so the SDK delivers it as a normal tool-result the LLM reads and relays to the user, never a silent skip and never a dead turn. New `ApiCode`s `TOOL_USAGE_RATE_LIMITED` / `TOOL_USAGE_QUOTA_EXCEEDED` name the conditions; the structured result carries the code.

### Decision 7 — Surfacing the current tier to the user

Criterion: the org's current subscription tier must be visible in **Settings → Organization**. v1 has one default tier, but it should still be *shown* (not hidden behind "no UI") so the affordance exists before paid tiers arrive and the user can see what plan they're on.

**Lean: a read-only `MetadataList` row in the Organization tab.** `tier` is already added to `OrganizationSchema` (Decision 3), so it rides `OrganizationGetResponse` automatically; `Settings.view.tsx` adds one `{ label: "Subscription Tier", value: <display(tier)> }` item to the existing `<MetadataList>`. No mutation, no new query, no api change — it reuses the same `sdk.organizations.current()` the tab already calls. A tiny display map turns the stored name (`standard`) into a presentable label (`Standard`). This is the **only** frontend surface in v1; usage counters/history/charts stay out (What this doesn't decide).

## Tradeoff comparison

| | D1: build-wrap | D2: Redis counters | D3: tier column | D4: env default tier | D5: split ack | D6: error result | D7: tier in Settings |
|---|---|---|---|---|---|---|---|
| Spread to spec | gate prelude + guard test | counter keys + windows | migration + model | `resolveTier` + env | gate ⟂ handshake boundary | result shape + codes | 1 `MetadataList` row + display map |
| New infra | wrap in `buildTools` | 2 Redis counters | 1 column | env vars | none (reuse) | 2 ApiCodes | none (rides `OrganizationGetResponse`) |
| Reuses | `tools.service` build | cost-ack Redis patterns | dual-schema workflow | `environment.ts` pattern | `CostAcknowledgementService` | `ApiError`/result path | `Settings.view` `MetadataList` + `sdk.organizations.current` |

## Recommendation

1. **Gate as a build-time wrap.** `buildTools` decorates every `ai.tool()`'s `execute` with `resolveCostGate({ organizationId, toolName, costHint })`; a guard test asserts no tool is constructed un-wrapped.
2. **Redis fixed-window counters** for per-org rate (per-minute) + rolling quota (per-day), incremented in the gate prelude; the in-process token-bucket util is untouched.
3. **`tier TEXT NOT NULL DEFAULT 'standard'`** on `organizations` (full dual-schema + migration); the tier *name* is the per-org input.
4. **`resolveTier(org)` maps name → limits per cost class**, sourced from env defaults in v1 (`TOOL_METERED_RATE_PER_MIN`, `TOOL_METERED_QUOTA_PER_DAY`, `EXPENSIVE_*`).
5. **Gate owns accounting for all classes; the `expensive` ack handshake stays tool-local** — `CostAcknowledgementService` unchanged, just also counted against quota.
6. **Denials return a typed tool result** (`TOOL_USAGE_RATE_LIMITED` / `TOOL_USAGE_QUOTA_EXCEEDED`), not a thrown stream error, so the agent relays them.
7. **Built-ins and custom toolpacks share one contract by construction.** Both are built through the same `buildAnalyticsTools` → `ai.tool()` wrap and both declare `costHint` via the same `ToolCapabilitySchema`, so the gate meters them through one code path with one set of tier numbers — no per-source special-casing. (Caveat: bulk-dispatch fan-out of a *custom* webhook tool builds a separate executor that bypasses the wrap — Open Q7; out of v1 scope.)
8. **Surface the current tier read-only in Settings → Organization** — one `MetadataList` row off the `tier` that already rides `OrganizationGetResponse`. The v1 default tier is *shown*, not hidden.
9. **`web_search` is the first guarded `metered` tool** — proves the gate end-to-end before GIS lands.

## Open questions

1. **Per-call count or weighted cost?** A call that fans out (bulk) costs more than one geocode. **Lean: per-call count for v1**, one increment per tool invocation; weighted "this call = N units" is a later refinement (noted out-of-scope in the issue). Bulk fan-out is already separately gated by the ack handshake.
2. **Quota window: rolling-via-TTL or calendar-day?** **Lean: calendar UTC day** (`usage:quota:{org}:{YYYY-MM-DD}`, TTL ~25 h) — trivially correct, self-expiring, and "resets at midnight UTC" is explainable to users. Rolling 24 h needs a sorted-set log; overkill for v1.
3. **Does the gate run for `alwaysAvailable` system tools** (`current_time`, `station_context`)? **Lean: yes, but they're `free` so the prelude is a no-op cost-class check** — keeps the wrap unconditional (simpler guard test) without metering free calls.
4. **Where does `acknowledgeCost`-style consent live for a *non-bulk* expensive tool** if one ever appears (no bulk signature to hash)? **Lean: don't solve it now** — v1 has no non-bulk expensive tool; when one appears, generalize the signature to `(toolName, canonicalized-args)` then. Flag it so the spec doesn't over-fit to the bulk shape.
5. **Counter increment vs. limit check atomicity.** Increment-then-check can let a burst slip 1–2 over. **Lean: `INCR` then compare (accept ±1 slop)** rather than a Lua check-and-incr — the slop is immaterial against a daily quota and keeps the gate a two-liner. Revisit only if exactness matters.
6. **Failure mode when Redis is down.** Fail-open (allow, unmetered) or fail-closed (deny all metered)? **Lean: fail-open with a logged warning** — a Redis outage shouldn't take down the agent; the metered tools degrade to today's unguarded behavior, which is the current baseline, not a regression.
7. **Does the gate cover the bulk-dispatch fan-out of a *custom* webhook tool?** `lookupBulkDispatchable` builds a *separate* executor (`ToolService.callWebhook`, `tools.service.ts:300`) for custom tools that bypasses the `buildAnalyticsTools` wrap, so per-row webhook calls aren't individually metered. **Lean: out of scope for v1** — per-call counting (Open Q1) counts the *outer* `transform_entity_records` invocation once (it's a built-in and **is** wrapped), and bulk fan-out is already gated by the ack handshake. If we later meter the fan-out, the second seam is the dispatcher's injected `toolExecutor` (`bulk-transform-tool.dispatcher.ts`), not the build wrap. Built-in tools dispatched in bulk *are* covered (that path resolves the wrapped `ai.tool()` from `buildAnalyticsTools`).
8. **How does a payment provider set the tier?** When the Stripe-style subscription portal lands, what writes `organizations.tier`? **Lean: don't build it now, keep the column provider-agnostic** — a later provider webhook (subscription created/updated/cancelled) maps the plan → a tier *name* and writes this one column; `resolveTier` already turns the name into limits, so no gate or call-site change. Flag so v1 doesn't model the column as provider-specific (no `stripe_customer_id` / `subscription_id` columns yet).

## What this doesn't decide

- **Configurable / paid / multiple named tiers, admin UI, and the subscription *payment portal*.** v1 is one env default tier; `tier` is just the input shape. The monetization layer — a **subscription-based payment provider (Stripe or similar)** whose webhooks set the org's `tier` name — is a **later, separate ticket** that *consumes* this surface (Decisions 3–4 keep call sites stable; the provider writes a tier name and nothing more). No payment-provider code, SDK, or `subscriptions`/customer-id columns ship in v1 (Open Q8).
- **Weighted per-tool cost units.** Per-call counting only (Open Q1).
- **Cross-org / global provider-account rate limiting.** Per-org is the v1 unit; protecting the upstream account as a whole is separate.
- **Usage analytics / dashboards.** Only the minimal queryable counter ships (issue's "usage observability" line) — no usage UI. **Exception:** the org's *current tier* is shown read-only in Settings → Organization (Decision 7); that one field **is** in v1. Usage *counts* / history / charts are not.
- **Metering the bulk-dispatch fan-out of custom webhook tools.** The outer `transform_entity_records` call is counted once; per-row custom-webhook fan-out is not individually metered in v1 (Open Q7).
- **The GIS tools themselves (#84).** This is the surface they consume.

## Next step

Write `docs/TOOL_COST_GATE.spec.md` (contract: the `resolveCostGate` signature + deny-result shape, the counter keys/windows, `resolveTier` + env vars, the `tier` column dual-schema, the new `ApiCode`s, and the `buildTools` wrap + guard test) and `docs/TOOL_COST_GATE.plan.md` (TDD slices). Likely slicing: (1) `tier` column dual-schema + migration + `resolveTier` (no behavior change yet; `tier` rides `OrganizationGetResponse`); (2) Redis counter util + `resolveCostGate` resolver, unit-tested against a fake Redis; (3) the `buildTools` wrap + guard test (asserting **every** built-in *and* custom tool is wrapped — the shared-contract guard), gating `web_search` as the first `metered` consumer; (4) deny-result wiring + the two `ApiCode`s + agent-relay test; (5) surface the tier read-only in Settings → Organization (`MetadataList` item + display map + a render test); (6) docs (`CUSTOM_TOOLPACK_INTEGRATION.md` "costHint now enforced — same contract as built-ins", README/CLAUDE.md cost-control convention, and the Help glossary/faq if "tier" becomes a user-facing term). Each slice green and independent; #84's metered tools unblock after slice 3.
