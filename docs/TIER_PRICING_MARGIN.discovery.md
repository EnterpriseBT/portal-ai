# Profit-optimized production tier pricing — Discovery

**Issue:** [EnterpriseBT/portal-ai#495](https://github.com/EnterpriseBT/portal-ai/issues/495)

**Why this exists.** #325 (closed with epic #83, PR #394) put the first real numbers on production: live Stripe prices carrying `plus_monthly`/`pro_monthly` and finite allocations on every self-serve tier. That pass deliberately stopped short of economics — its commit message and the catalog comment (`packages/core/src/registries/tier-catalog.ts:57-85`) both record the allocations as "safety ceilings, not a pricing/margin lever … Tuning them for margin against projected cost is a separate pass." Nobody has ever computed what a tier *costs Portals to serve* — per-unit vendor rates, fixed infra, Stripe fees — or checked the prices against that. This is the pass that builds that cost model and re-decides prices, allocations, and entitlements against it: the analysis that makes the numbers a profit decision instead of a safety decision.

## The current shape

### What is charged, and what is not

| Surface | Metered? | Where |
|---|---|---|
| Tool calls, `metered` class (`web_search`→Tavily, `geocode`/`reverse_geocode`→Mapbox) | Yes — 1 unit/call (geocode cache hit = 0) | `apps/api/src/services/cost-gate.service.ts`, resolvers in `apps/api/src/services/geocoding/cost-resolvers.ts` |
| Tool calls, `expensive` class (`bulk_geocode_records` 1 unit/row, `visualize_d3` Opus codegen, `transform_entity_records`, `cluster`, `logistic_regression`) | Yes — admission + post-success commit; job tools charge on job success | same |
| Tool calls, `free` class | Never — immune by contract | `tier-catalog.ts:67-68` |
| **Agent conversation itself (Anthropic Sonnet per turn)** | **No — completely unmetered** | `apps/api/src/services/portal.service.ts:697-704` — `streamText` with `DEFAULT_MODEL = "claude-sonnet-4-6"` (`ai.service.ts:6-13`), bounded only by `stopWhen: stepCountIs(10)` per turn; no per-org message cap or rate limit on the send path (`portal-events.router.ts:109`) |
| Custom/webhook tools | Never (org-hosted, org-paid) | `resolveCallCost` returns 0 |

The unmetered agent loop is the standing product rule ("the core query/visualise/refresh loop is never charged" — capability tiering is the paid axis), but it means **the largest vendor line item (Anthropic) has no per-org bound of any kind** — a free-tier org can drive unlimited Sonnet turns. Margin control today = account-level vendor spend caps only (`docs/PROD_PROVISIONING.runbook.md` §5).

### The pricing/allocation machinery (all shipped, this ticket only feeds it numbers)

| Piece | Location | Note |
|---|---|---|
| Tier catalog (allocations, entitlements, lookup keys — never amounts) | `packages/core/src/registries/tier-catalog.ts:86-185` | standard 500/10 metered + 100/2 expensive; plus 5k/60 + 2k/10; pro 50k/120 + 20k/30; enterprise unlimited |
| Guard test: no self-serve tier unbounded | `packages/core/src/__tests__/registries/tier-catalog.test.ts:177-204` | the #325 invariant, pinned |
| `perToolCaps` | `apps/api/src/db/schema/tiers.table.ts:41-44` | **defined but inert** — null on every tier, no enforcement site; only class-level allocations are enforced |
| Rate limits (`ratePerMin` per class) | `cost-gate.service.ts:166-185` | Redis sliding window, fails open on Redis outage; quota (`unitsPerPeriod`) enforced at admission + commit |
| Convergence to prod | `packages/devops-cli/src/commands/tier.ts` (`tier apply`, fails closed on missing lookup key) | repricing = new Stripe price with `--transfer-lookup-key`, then apply |
| Price→tier mapping (the effective "allow-list") | `apps/api/src/services/billing.service.ts:195` (`priceIndex`); unmapped price holds current tier (`:106-112`) | Stripe Billing Portal's own switch allow-list is Dashboard config, not repo |
| Public price surfaces | `apps/api/src/services/site-config.service.ts` → `apps/site/src/pages/pricing.astro:28-92`; in-app `apps/web/src/components/SubscriptionBilling.component.tsx`, `TierCard.component.tsx` | fail-closed on unresolvable price (503, never a phantom price change) |
| Tax / currency / fees | `stripe.service.ts:129` (`automatic_tax: enabled`), currency read from the price (`:212`); **no fee modeling anywhere** | Stripe's ~2.9% + 30¢ must be modeled externally |

### Usage data available for projections

- `usage` table (`apps/api/src/db/schema/usage.table.ts:21-44`) — per `(org, period, costClass)` balance.
- `tool_usage_ledger` (`tool-usage-ledger.table.ts:27-59`) — per-charge itemization (`toolName`, `units`, `periodId`, org/station/portal/user), indexed `(organizationId, periodId)`; **purged past `LEDGER_RETENTION_MONTHS`**, so projection data is time-bounded.
- Endpoints: `GET /api/organization/usage` and `/usage/ledger` (`organization.router.ts:576,715`).
- Prod is ~2.5 weeks old, so real usage is thin — the model must lean on ceiling scenarios and stated assumptions, refined later from the ledger.

### Fixed-cost inputs (AWS prod)

`infra/cloudformation/`: `backend.yml:37-46,488-493` (ECS Fargate, prod defaults 1 vCPU / 8 GB ARM64 + ALB), `database.yml:9-87` (RDS Postgres 17.9, default `db.t4g.micro`), `cache.yml:11,84-109` (ElastiCache Redis `cache.t4g.micro`, Multi-AZ — carries BullMQ, not just cache), `frontend.yml` + `site.yml` (S3 + CloudFront). Sizes are CFN params — the model must read the *live* stack params, not the defaults.

## The design space

### Decision 1 — What to do about the unmetered agent loop

The single biggest margin unknown. Options:

- **A. Accept and price it in.** Model expected Anthropic cost per tier from turn-count assumptions, fold it into each tier's price as a blended cost, keep the loop unmetered per the standing rule. Backstop = Anthropic account spend cap + alerting.
- **B. Meter agent turns against `metered` credits.** Contract change; directly contradicts the standing "core loop is never charged" monetization rule.
- **C. Un-charged per-org rate ceiling on agent messages.** Not monetization — an abuse backstop (like `ratePerMin`), e.g. N turns/min per org. Contract-adjacent (new denial state in chat), so per the ticket it would split into a follow-up.

| | A price-in | B meter turns | C abuse ceiling |
|---|---|---|---|
| Respects "core loop never charged" | Yes | **No** | Yes (deny ≠ charge) |
| Bounds worst-case per-org exposure | No (account cap only) | Yes | Yes |
| Lands in this ticket | Yes | No (rule change) | Follow-up ticket |

**Lean: A now, C as a filed follow-up.** The model quantifies the exposure per tier; if the free tier's worst case is material, the follow-up ticket ships the ceiling. B is off the table — it re-litigates the monetization model, which the issue's out-of-scope already forbids.

### Decision 2 — Pricing methodology

- **A. Cost-plus:** price = modeled cost × target multiple. Mechanical, but anchors price to cost rather than value and produces weird numbers.
- **B. Value-anchored with a cost floor:** choose price points from the upgrade ladder (what plus→pro buys: 10× credits + all packs + custom webhooks) and market comparables; the cost model then *verifies* each price clears a stated margin target at expected usage and a stated worst-case exposure at ceiling usage. Allocations become the tuning knob that keeps ceiling exposure inside bounds.
- **C. Pure value pricing, no cost check** — what exists today; the thing this ticket ends.

**Lean: B.** The cost model's job is floors and ceilings, not the sticker price. Concretely: for each tier, compute `worst-case vendor cost at allocation ceiling`, `expected cost at assumed usage`, and require `price ≥ expected cost / (1 − target margin)` and `ceiling cost ≤ k × price` for a chosen exposure multiple `k`; where a tier fails, move price *or* allocation until it passes.

### Decision 3 — Where the cost model lives

Phase docs are swept at the next feature; a cost model written as `*.discovery.md` content dies with this branch. But repricing recurs (vendor rate changes, new expensive tools), so the model must outlive the ticket.

- **A. Discovery-doc only** — swept; the next repricing rebuilds from scratch.
- **B. Durable `docs/TIER_PRICING_MODEL.md`** (unsuffixed) — methodology, per-vendor rate table with as-of dates and sources, the margin formulas, and the worked computation. Dollar *decisions* recorded as as-of snapshots with "Stripe live is authoritative" stamped on them — analysis history, not a price registry, so it doesn't collide with the pricing-lives-in-Stripe rule.
- **C. Spreadsheet outside the repo** — invisible to the next operator, unreviewable.

**Lean: B.** The discovery doc carries the *decisions*; the durable doc carries the *model* and joins the maintained reference set (charter/runbooks tier).

### Decision 4 — Existing-subscriber posture (the ticket defers this here)

Discovery must count live subscriptions (Stripe live, read-only inspection key per `docs/PROD_STRIPE_LIVE.runbook.md` §3) before rollout. Options: grandfather (new price via `--transfer-lookup-key`; existing subs keep the old price object) vs migrate (update each subscription item to the new price).

**Lean: grandfather.** Prod is 2.5 weeks old; the subscriber count is plausibly zero, and grandfathering is the no-churn-risk default that `--transfer-lookup-key` gives for free. If the count at execution time is 0, the two options are identical and we simply transfer the key. Migration is only worth its churn risk if the count is material *and* the old price is underwater — the model will say.

### Decision 5 — Structural options (annual, top-ups, tier shape)

The ticket allows structure changes where the profit case supports them. Candidates: annual prices (`plus_yearly`/`pro_yearly` lookup keys — catalog schema takes them without contract change, but Checkout/site-config/plan cards all assume one price per tier), overage/top-up credit packs (real contract change: new purchase flow, `overage` is `hard-deny` today), and tier-count changes.

**Lean: evaluate all three in the model; implement none here.** Each is a revenue optimization on top of a correct base price — get the base right first, file follow-ups with the model's numbers attached (annual is the likely first: pure retention win, moderate plumbing).

## Tradeoff comparison

| | D1: price-in + ceiling follow-up | D2: value-anchored, cost-floored | D3: durable model doc | D4: grandfather | D5: defer structure |
|---|---|---|---|---|---|
| Spread to spec | Yes (exposure figures + follow-up ticket) | Yes (the formulas + targets) | Yes (doc contract) | Yes (rollout steps) | No (follow-up tickets) |

## Recommendation

1. Build the cost model as durable `docs/TIER_PRICING_MODEL.md`: per-unit rates with sources and as-of dates for Anthropic (Sonnet 4.6 in/out tokens; Opus 4.8 for `visualize_d3` codegen), Tavily per search, Mapbox per geocode, Stripe fee (2.9% + 30¢ modeled), and monthly AWS fixed cost read from the live prod stack params.
2. Per tier, compute expected cost (stated usage assumptions) and ceiling cost (allocation grid maxed, including the unmetered agent-turn assumption made explicit), then set prices value-anchored on the upgrade ladder subject to `price ≥ expected cost / (1 − target margin)` and bounded ceiling exposure; tune allocations where a tier fails the ceiling check.
3. Keep the agent loop unmetered (standing rule); quantify its per-tier exposure in the model and file a follow-up ticket for an un-charged per-org agent-turn rate ceiling if the free-tier worst case is material.
4. Re-decide `standard`'s allocations as a deliberate CAC budget (max $/mo per free org, stated), and write the enterprise/custom-tier price floor (`portalops tier create` deals never quoted below modeled cost).
5. Roll out: new live prices via `stripe prices create --lookup-key … --transfer-lookup-key` (grandfathering existing subs; count them first), `tier-catalog.ts` PR for allocations/entitlements with the margin rationale replacing the safety-ceiling note, `portalops tier apply --env prod --yes --confirm-prod`, Billing-Portal switch-list update in the Stripe Dashboard, vendor spend caps resized to the new ceilings.
6. Copy-check every allocation surface: `pricing.astro`, `TierCard`/`SubscriptionBilling`, `glossary.util.ts:418-420`, `faq.util.ts:72,247-249` — per the docs-sync rule.
7. Evaluate annual pricing, top-up packs, and tier-shape changes inside the model; file follow-ups with numbers, implement none here.

## Open questions

1. **What are the current live amounts?** Not readable from the repo by design. Needs the read-only inspection key (`STRIPE_CLI_OPS.md`) against live. Lean: first act of the analysis phase; the model tables them as the baseline.
2. **What are the actual prod stack params?** CFN sizes are params, defaults may not match reality (app-dev deviates). Lean: read live via `aws cloudformation describe-stacks` / `portalops` during analysis; model uses actuals.
3. **Agent turn-volume assumption.** With 2.5 weeks of thin data, what's a defensible turns/org/month figure per tier? Lean: model three scenarios (light/expected/heavy) from the ledger's tool-call counts as a proxy (tool calls ≤ 10× turns), and state the sensitivity — the point is bounded exposure, not a precise forecast.
4. **`perToolCaps` is inert — use it?** Enforcing it would let one hungry tool (`bulk_geocode_records`) get a tighter cap than its whole class. Lean: don't rely on it for this pass (pricing assumes class-level enforcement only); note enforcement as a candidate follow-up if the model shows one tool dominating a class.
5. **Does the durable model doc record decided dollar amounts?** Tension with "no amounts in the repo." Lean: yes, as dated as-of snapshots labeled non-authoritative (Stripe live is the record of truth) — an analysis that can't name the price it analyzed is useless.
6. **Target margin and exposure multiple `k`.** Business inputs, not derivable from code. Lean: propose 80% gross margin target at expected usage and ceiling exposure ≤ 2× monthly price for paid tiers, free tier capped by the stated CAC budget — the user confirms or adjusts at spec review.

## Enterprise-scale considerations

- **Concurrency & correctness** — N/A because the deliverable is operator-run config (Stripe writes + one `tier apply`); the runtime enforcement paths (atomic UPSERT charge, admission checks) already exist and don't change.
- **Accuracy & auditability** — Lean: the durable model doc is the audit trail for *why* each number; `tool_usage_ledger` remains the per-charge record. Note: ledger retention (`LEDGER_RETENTION_MONTHS`) time-bounds future re-analysis — the model doc must snapshot the aggregates it used.
- **Failure modes** — Lean: unchanged and correct — site-config fails closed on unresolvable prices; `tier apply` fails closed on missing lookup keys; rate limiting fails open on Redis loss while quota stays enforced. New: vendor spend caps re-sized to the new ceilings are the fail-safe for the unmetered agent loop; that resize is a deliverable, not a hope.
- **Scale & unbounded growth** — Lean: this ticket exists to close the last unbounded dimension (per-org agent-turn exposure is quantified; the abuse-ceiling follow-up bounds it). All self-serve tool classes are already ceiling-bounded (#394's invariant, pinned by test).
- **Multi-tenancy** — Lean: per-org quotas and rate windows already isolate tenants for tool spend; the agent loop is the one shared-cost surface with no per-tenant bound — covered by Decision 1.
- **Contract stability** — Lean: no contract changes in this ticket by construction; lookup keys stay the only cross-env pricing identifier, so annual/top-up follow-ups plug in additively (`plus_yearly` is just another key + catalog field).
- **Data lifecycle** — Lean: periods stay billing-anchored (`periodKind: monthly`, `periodAnchorDay`) — already contract-aligned; no new windows introduced.

## What this doesn't decide

- The actual dollar amounts and final allocation numbers — those are the *output* of the spec/analysis phase, made with the model in hand and the business inputs (margin target, CAC budget) confirmed.
- Whether to ship annual pricing / top-up packs / an agent-turn ceiling — each gets a follow-up ticket with the model's numbers if justified (deferred to keep this ticket's contract surface at zero).
- Metering the agent loop (Decision 1 option B) — explicitly rejected; it contradicts the standing monetization rule and the issue's out-of-scope.
- `perToolCaps` enforcement — candidate follow-up only.
- Seats / per-user pricing — RBAC epic #198.

## Next step

`docs/TIER_PRICING_MARGIN.spec.md` will fix the contract: the model doc's required shape (rate table, formulas, scenario definitions), the margin/exposure acceptance thresholds (open question 6 confirmed), the rollout procedure with its verification steps, and the copy-check list. `docs/TIER_PRICING_MARGIN.plan.md` will slice roughly as: (1) durable cost-model doc with live inputs gathered (Stripe baseline, stack params, vendor rates), (2) decision pass — prices + allocations + entitlements chosen against the model, recorded; (3) `tier-catalog.ts` + copy-surface PR slice; (4) rollout slice (Stripe live writes, `tier apply`, portal allow-list, vendor caps) + smoke; (5) follow-up tickets filed with numbers attached.
