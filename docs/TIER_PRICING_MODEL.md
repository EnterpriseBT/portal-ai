# Tier pricing cost model

The durable cost/margin model behind the production tier catalog (`packages/core/src/registries/tier-catalog.ts`) — what each tier costs Portals to serve, and the thresholds its price and allocations must clear. Born in #495; **re-run before any repricing** (§7). Decided dollar amounts appear here only as dated snapshots — **Stripe live is the pricing record of truth** (`plus_monthly` / `pro_monthly` lookup keys), never this file or the repo.

Status of this revision (2026-09-02): §1–§3 populated from fetched sources and live prod reads; §5 pending the analysis pass; §6 baseline recorded (price amounts recovered from the baked marketing page — direct Stripe confirmation blocked by #496 and the absent live inspection key). All `TODO(source)` markers are resolved: the Stripe baseline is operator-confirmed (§6), and Auth0 is a bounded $0 assumption (§2) pending a dashboard check (billing is not API-readable). §5's analysis can proceed once thresholds are confirmed.

## 1. Vendor rate table

All rates fetched from the official pricing pages on the as-of date. Anthropic model ids must match `AiService.DEFAULT_MODEL` / `CODEGEN_MODEL` (`apps/api/src/services/ai.service.ts`: `claude-sonnet-4-6`, `claude-opus-4-8`) — re-check on every re-run.

| Driver | Unit | USD | Source | As-of |
|---|---|---|---|---|
| Sonnet 4.6 input (agent turns) | 1M tokens | $3.00 | platform.claude.com/docs/en/about-claude/pricing | 2026-09-02 |
| Sonnet 4.6 output | 1M tokens | $15.00 | same | 2026-09-02 |
| Sonnet 4.6 cache read / write (5m) | 1M tokens | $0.30 / $3.75 | same | 2026-09-02 |
| Opus 4.8 input (`visualize_d3` codegen) | 1M tokens | $5.00 | same | 2026-09-02 |
| Opus 4.8 output | 1M tokens | $25.00 | same | 2026-09-02 |
| Tavily basic search (`web_search`) | 1 search = 1 credit | $0.008 | tavily.com/pricing + docs.tavily.com/documentation/api-credits | 2026-09-02 |
| Tavily advanced search | 1 search = 2 credits | $0.016 | same | 2026-09-02 |
| Tavily free tier | credits/mo | 1,000 | tavily.com/pricing | 2026-09-02 |
| Mapbox temporary geocoding (`geocode`/`reverse_geocode`/`bulk_geocode_records`) | 1K requests | $0.75 (first 100K/mo free; $0.60 >500K; $0.45 >1M) | mapbox.com/pricing | 2026-09-02 |
| Stripe US domestic card fee | per successful charge | 2.9% + $0.30 | stripe.com/pricing | 2026-09-02 |

Notes: Anthropic rates are default global routing (`inference_geo: "us"` would add 1.1×; not set — `apps/api/src/services/ai.service.ts`). Margin math uses the **marginal** Mapbox rate ($0.75/1K) even inside the free 100K — the free tier is shared across all tenants and offers no per-org guarantee.

### Per-unit vendor cost by charged tool (the cost gate's unit → dollars)

| Charged tool | Class | Units | Vendor $ per unit | Basis |
|---|---|---|---|---|
| `web_search` | metered | 1/call | $0.008 — the tool passes no `searchDepth`, so the SDK default **basic** (1 credit) applies, with `includeAnswer: true` (`apps/api/src/tools/web-search.tool.ts:30-33`); re-check if depth or answer pricing changes | Tavily |
| `geocode` / `reverse_geocode` | metered | 1/live call (cache hit = 0) | $0.00075 | Mapbox |
| `bulk_geocode_records` | expensive | 1/newly-geocoded row | $0.00075 | Mapbox |
| `visualize_d3` | expensive | **80/call** (#499 — the measured cost ratio; `VISUALIZE_D3_UNITS_PER_CALL`) | ≈ $0.06/call ⇒ ≈ **$0.00075/unit** *(ratio from the ~6K in / 1.5K out Opus 4.8 estimate; `generateCode` now logs actual tokens per call — refine at the next re-run)* | Anthropic Opus |
| `transform_entity_records`, `cluster`, `logistic_regression` | expensive | 1/call | ≈ $0 vendor (own-compute) — the LLM cost of the turn that invokes them is counted in the turn model, not per unit | — |

**Worst-rate per class** (used for ceiling exposure): metered = $0.008/unit (`web_search` basic), expensive = ≈**$0.00075/unit** — uniform since #499 re-united `visualize_d3` at 80 units/call (was ≈$0.06/unit, the 80× spread behind §5 finding 2).

## 2. Fixed monthly cost (prod)

Region us-east-1, on-demand, 730 h/mo. Sizes pinned by `deploy-prod.yml` parameter overrides and **live-verified 2026-09-02** via `aws cloudformation describe-stacks` against `portalai-prod-{backend,database,cache}` — all match (Cpu 1024 / Memory 8192 / DesiredCount 2; db.t4g.micro / 20 GB / MultiAZ false; cache.t4g.micro / ReplicationEnabled true).

| Item | Size (source) | Rate | $/mo |
|---|---|---|---|
| ECS Fargate ARM64 API tasks | 1 vCPU / 8 GB × **2 tasks** (`deploy-prod.yml:537` DesiredCount=2; Cpu/Memory `:83-84`) | $0.03238/vCPU-h + $0.00356/GB-h | 88.86 |
| RDS PostgreSQL | db.t4g.micro, 20 GB gp3, **single-AZ** (deliberate deviation recorded at `deploy-prod.yml:131`) | $0.016/h + $0.115/GB-mo | 13.98 |
| ElastiCache Redis | cache.t4g.micro × 2 (ReplicationEnabled=true, Multi-AZ) | $0.016/node-h | 23.36 |
| ALB | 1, fixed hourly (LCU extra, negligible at current traffic) | $0.0225/h | 16.43 |
| NAT Gateway | 1 (`network.yml:93`) | $0.045/h + $0.045/GB | 32.85 + data |
| Bastion EC2 | t4g.nano (`bastion.yml:11`) | ≈ $0.0042/h | 3.07 |
| Route 53 | 1 hosted zone | $0.50/zone | 0.50 |
| CloudFront + S3 (app + marketing site) | low traffic | grounded estimate | ≈ 2–5 |
| CloudWatch logs, SES, ECR | misc | estimate | ≈ 3 |
| **Total fixed** | | | **≈ $185/mo** |

Rate sources: aws.amazon.com/fargate/pricing, /elasticloadbalancing/pricing, /route53/pricing; AWS Price List CSVs (AmazonRDS, AmazonEC2 NAT rows effective 2026-08-01, AmazonCloudFront); ElastiCache/S3 page-backing JSONs. All fetched 2026-09-02. Auth0 (prod tenant `portalsai.us.auth0.com`): **$0/mo assumed** — MAU is single-digit (2 orgs), far inside Auth0's free-plan 25K-MAU ceiling, and the plan is not readable via the Management API (billing is dashboard-only; the CLI session here covers only the dev tenant). Even a paid Essentials plan would add ~$35/mo — bounded either way. Confirm in the Auth0 dashboard Billing page at the next §7 re-run.

Fixed cost is **not** apportioned per org in T1 arithmetic while org count is small (it would dominate any per-org number and produce nonsense at n<50); it enters as a break-even line instead: `orgs × avg(price − variable cost) ≥ $185/mo`. Revisit apportionment at real scale (§7).

## 3. Usage scenarios

**Ledger snapshot (read 2026-09-02, prod, read-only `portalops db psql`):** production is pre-traction — the ledger holds **one org, six charged calls, all in `2026-08`** (`bulk_geocode_records` ×1 = 8 units expensive; `geocode` ×5 = 5 units metered), and `portal_messages` holds 2 rows total. Org base: 2 live orgs (1 `pro` — the only live subscription, plausibly internal — and 1 `standard`). **Every scenario parameter below is therefore an estimate by necessity**; the queries below are the §7 re-run contract, and this paragraph is the durable record of what the ledger said when the first pricing pass ran. Ledger retention (`LEDGER_RETENTION_MONTHS`) time-bounds re-reads:

```sql
-- per period, per tool, per class: calls and units
SELECT period_id, tool_name, cost_class, COUNT(*) AS calls, SUM(units) AS units
FROM tool_usage_ledger GROUP BY 1,2,3 ORDER BY 1,2;
-- org count + per-org monthly units distribution
SELECT period_id, cost_class, COUNT(DISTINCT organization_id) AS orgs,
       PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY units) AS p50_units,
       MAX(units) AS max_units
FROM (SELECT period_id, cost_class, organization_id, SUM(units) AS units
      FROM tool_usage_ledger GROUP BY 1,2,3) t GROUP BY 1,2;
```

**Per-turn Sonnet cost** (the unmetered exposure — #495 discovery Decision 1: nothing bounds turns per org; `stopWhen: stepCountIs(10)` bounds steps *per turn* only, `portal.service.ts:697-704`). Derivation, all estimates pending real token telemetry: a typical turn ≈ 12K cache-read ($0.0036) + 2K fresh input ($0.006) + 3K cache write ($0.0113) + 0.9K output ($0.0135) ≈ **$0.035/turn**; a heavy turn (multi-step tool use, long history) ≈ **$0.08/turn**; light ≈ $0.02.

Scenario parameters (2026-09-02 pass — **all estimates**; the ledger is pre-traction, so "expected" is a stated assumption about a plausibly-active org of each tier's kind, not a measurement):

| Parameter (per org / mo) | standard | plus | pro | heavy multiplier |
|---|---|---|---|---|
| Agent turns, expected | 100 | 130 | 400 | heavy: 600 / 2,000 / 6,000 |
| Gated-tool cost, expected (mixed) | $0.35 | $1.00 | $5.00 | heavy: allocation ceiling × worst-rate |
| Expected turn cost basis | $0.035 | $0.035 | $0.035 | heavy turns costed at $0.08 |

## 4. Formulas & thresholds

```
variableCost(tier, scenario) = turns × turnCost                        (LLM, unmetered)
                             + Σ_class units(scenario) × mixRate(class) (gated tools)
expectedCost(tier) = variableCost(tier, expected)
ceilingCost(tier)  = variableCost(tier, heavy) with gated classes at allocation ceiling × worst-rate
netRevenue(price)  = price − (0.029 × price + 0.30)                    (Stripe fee)
```

Thresholds (**confirmed by the operator 2026-09-02**, as proposed in the spec):

- **T1** margin floor: `netRevenue(price) ≥ expectedCost / (1 − 0.80)`… stated precisely: `(netRevenue − expectedCost) / netRevenue ≥ 0.80` per paid tier.
- **T2** ceiling exposure: `ceilingCost(tier) ≤ 2 × price` per paid tier.
- **T3** free-tier CAC budget: `expectedCost(standard) ≤ $5/org/mo`; if the stated heavy worst case exceeds **$25/org/mo**, the un-charged agent-turn rate-ceiling follow-up ticket must be filed at close-out.
- **T4** custom-deal floor: no org-scoped custom tier is quoted below `variableCost(negotiated allocations, heavy) + a stated fixed-cost share`.
- Break-even line (fixed costs): `payingOrgs × avg(netRevenue − expectedCost) ≥ $185/mo`.

## 5. Per-tier results (2026-09-02 pass)

Computed at the **proposed** prices and allocations in §6 (netRevenue: $29 → $27.86; $99 → $95.83). Three structural findings frame the table:

> **#498 update (2026-09-03):** the loop is no longer unbounded — every self-serve tier now carries an un-charged send ceiling (`agentTurnsPerMin`/`agentTurnsPerDay`: 3/9 standard, 5/13 plus, 10/26 pro; enterprise null). Bounded heavy-LLM terms at $0.08/turn: standard 9×30×0.08 = **$21.60** (+ gated tools ≈ $4.1 ⇒ worst ≈ **$25.7**, a hair over the $25 T3 budget — accepted and stated, one catalog number from strict-under); plus 13×30×0.08 = $31.20 + $25.50 ⇒ **$56.7 ≤ $58 (T2 pass)**; pro 26×30×0.08 = $62.40 + $135 ⇒ **$197.4 ≤ $198 (T2 pass)**. Findings 1–3 below are preserved as the record of the pre-#498 state.

1. **The unmetered agent loop, not tool spend, is the margin driver.** At $0.035/turn, LLM cost alone consumes a paid tier's entire net revenue at ≈ **800 turns/mo (plus @ $29)** and ≈ **2,750 turns/mo (pro @ $99)** — ordinary active-team volumes, not abuse. At the *current* prices the zero-margin points are 520 ($19) and 1,350 ($49) turns. T1's 80%-margin bar holds only below ≈ **160 (plus)** / **460 (pro)** turns+tools per month. Margin is therefore a function of an unbounded variable until a per-org turn ceiling exists.
2. **T2's adversarial ceiling cannot pass at any defensible price this pass**, because the `expensive` class prices two tools 80× apart per unit: `visualize_d3` at 1 unit/call (≈$0.06 vendor) shares a class with bulk-geocode rows (≈$0.00075). 20,000 pro units spent adversarially on d3 = ~$1,200. Geocode-friendly allocations and a d3-proof ceiling are irreconcilable **within this ticket's levers** (allocations/prices only — `resolveCallCost`/`perToolCaps` are enforcement code, out of scope). Closure path: the two follow-ups in §6, with post-follow-up ceilings computed below.
3. **T3's worst-case trigger fires**: a heavy free org models at ≈ $53/mo (600 turns × $0.08 + $4 metered + $0.075 expensive post-re-unit) > $25 — the un-charged agent-turn rate-ceiling follow-up is **mandatory** at close-out.

| Tier | Price (proposed) | expectedCost | Margin @ expected | ceiling (adversarial, today) | ceiling (post-follow-ups) | T1 | T2 | T3 |
|---|---|---|---|---|---|---|---|---|
| standard | free | $3.85 | — | $58 | ≈ $25 (turn ceiling ~260/mo) | — | — | expected **pass** ($3.85 ≤ $5); worst-case **trigger fires** |
| plus | **$29** | $5.55 | **80.1% pass** | $304 → **fail** | $58 budget → turn ceiling ~400/mo | pass | fail today / closes with follow-ups | — |
| pro | **$99** | $19.00 | **80.2% pass** | $1,800 → **fail** | $198 budget → turn ceiling ~790/mo | pass | fail today / closes with follow-ups | — |
| enterprise | contact | per deal | — | unbounded by design (#241 custom tiers carry negotiated numbers) | — | — | — | — |
| demo (#511) | — (internal) | $0 | n/a | unlimited (all allocations null) | all built-in + custom toolpacks | — | — | standing custom tier for the demo org (#507), not sold |

The **`demo`** tier is a standing custom tier (#241 pattern), never in the declarative catalog and never converged by `tier apply`. It carries no Stripe price (`cta contact`), unlimited allocations, and every toolpack, so a presenter never hits a quota or a checkout CTA. In app-dev/prod it is org-scoped to the demo org; locally it is created unscoped-but-non-public by `portalops local provision` — either way it is excluded from `GET /api/public/site-config`. See `docs/DEMO_ORG.runbook.md`.

T1's "pass" is exactly as strong as the expected-turn assumption (130/400) — the sensitivity in finding 1 is the honest statement. **Break-even on fixed costs (~$185/mo): ≈ 3 paying orgs at the proposed prices** (e.g. 2 pro + 1 plus nets ≈ $176/mo margin at expected usage; 3 pro clears it).

## 6. Decision record

> Amounts below are a **dated snapshot; Stripe live is authoritative.** Re-run this model (§7) before any repricing.

- **Baseline (pre-decision), 2026-09-02:** **Plus $19/mo · Pro $49/mo** — confirmed by the operator against the Stripe live account (2026-09-02), matching the statically-baked `www.portalsai.io/pricing`. (The live `GET /api/public/site-config` currently 500s — **#496** — which blocks this ticket's rollout verification until fixed.) Prod DB: both paid tier rows carry a `stripe_price_id`; **live subscriptions: 1** (`organizations.stripe_subscription_id`, the internal `pro` org).
- **Decided amounts + allocations (2026-09-02 — operator-confirmed at the slice-2 gate):**

  | Tier | Price | metered (units / rpm) | expensive (units / rpm) | Entitlements |
  |---|---|---|---|---|
  | standard | free (unchanged) | 500 / 10 (unchanged) | 100 / 2 (unchanged) | **+ `entity_management`** |
  | plus | **$29** (from $19) | **3,000** / 60 (from 5,000) | 2,000 / 10 (unchanged) | **+ `regression`, `financial`** (all packs except visualize/gis) |
  | pro | **$99** (from $49) | **15,000** / 120 (from 50,000) | 20,000 / 30 (unchanged) | unchanged |
  | enterprise | contact (unchanged) | unlimited (unchanged) | unlimited (unchanged) | unchanged |

  Rationale: prices are value-anchored on the org-level (multi-user, pre-#198-seats) ladder and sized so the 80%-margin bar survives a realistically active org (§5 finding 1); with exactly **one live subscriber (internal)**, repricing now is churn-free — the cheapest moment it will ever have. The metered cuts trim pure adversarial surface (all-`web_search` ceilings of $40/$400 → $24/$120) while staying far above observed usage (5 geocode calls, ever) and any plausible team month (3,000 ≈ 100 searches/day); expensive allocations stay geocode-sized on purpose — their adversarial exposure closes via the re-unit follow-up, not by making bulk geocoding unusable. Entitlements (operator decisions, 2026-09-02): **`entity_management` added to `standard`**, and **`regression` + `financial` added to `plus`** — both margin-neutral (the packs' tools are `free`-class pure/own-compute; `logistic_regression` and `transform_entity_records` are expensive-class but vendor-$0, consuming allocation only). The upgrade story: free = query/search/record-editing; Plus = analytics depth (statistics, regression, financial) + 6×/20× credits; **Pro's exclusives = `visualize`, `gis`, and custom toolpacks** + 5×/10× credits over Plus. Copy synced: the glossary "Plan Entitlement" example now illustrates gating with `gis` (Pro+) instead of the now-universal `entity_management`.

- **Executed in Stripe live, 2026-09-02:** `plus_monthly` = **$29.00** via in-place amount edit on the existing price (`price_1U4rmx…2n2mVybz` — permitted because it had zero subscriptions; the id is unchanged, so the prod `tiers.stripe_price_id` for plus needs no convergence). `pro_monthly` = **$99.00** on a **new** price (`price_1UBO0K…E2SUhfIE`, lookup key transferred); the old $49 price (`price_1U4rmw…BtxJQF6r`) stays active and keyless as the rollback target, carrying the one grandfathered subscription. Known window: until PR #497 merges and `tier apply --env prod` converges the pro row onto the new id, a new Pro checkout would still charge $49 (the DB row points at the old price) — acceptable at current traffic, close it promptly.
- **Grandfather posture:** grandfather via lookup-key transfer (spec D4), executed as above. Subscriber count at execution: **1, internal**, verified still attached to the $49 price post-transfer. Expected side effect: its future webhook events log "unmapped Stripe price; keeping the org's current tier" once tier apply moves the pro row — correct behavior, not a regression.
- **Structural verdicts (2026-09-02):**
  - **Un-charged per-org agent-turn rate ceiling** — **implemented (#498, 2026-09-03):** `agentTurnsPerMin`/`agentTurnsPerDay` tier fields (3/9, 5/13, 10/26; enterprise null — monthly-equivalents 270/390/780 ≈ the budgeted 260/400/790), gated at the message POST before anything is written; deny is un-charged, never mid-turn, fail-open on infra loss. T2 flips to pass on both paid tiers; T3's worst case lands at ≈$25.7 vs the $25 budget (stated, accepted; standard→8/day is the strict-under lever).
  - **Re-unit `visualize_d3`** — **implemented (#499, 2026-09-03):** `registerCostResolver("visualize_d3", () => 80)` at tool build; `perToolCaps` stays inert (rejected — new enforcement machinery for the same outcome). Gated-tool adversarial ceilings recompute at $0.00075/unit: standard ≈ $4.08, plus ≈ $25.50, pro ≈ **$135** (vs $1,800) — **inside 2× price for the tool term**; T2's remaining gap is solely the unbounded LLM-turn term, which closes with #498's turn ceiling.
  - **Annual prices** — **rejected(premature):** one subscriber; checkout/site-config/plan cards assume one price per tier, so annual is real plumbing for zero retention benefit today. Revisit at ≥20 paying orgs.
  - **Top-up credit packs** — **rejected(premature):** hard-deny + the upgrade ladder is sufficient until quota denials actually appear in the ledger. Revisit on first organic `TOOL_USAGE_QUOTA_EXCEEDED` from a paying org.
  - **Per-seat pricing** — out of scope here (#198 RBAC), but noted as the durable fix: LLM cost scales with users, and org-flat pricing cannot track it forever.
- **T4 custom-deal floor:** quote ≥ heavy-scenario variable cost at the negotiated allocations **+ $20/mo fixed share**, computed from this model at deal time.

## 7. Re-run procedure

Re-run before any repricing, on a vendor rate change, or quarterly while usage is growing:

1. **Vendor rates (§1):** re-fetch the four pricing pages; re-check `ai.service.ts` model ids — a model bump changes the turn cost silently.
2. **Fixed costs (§2):** `aws login --remote`, then `aws cloudformation describe-stacks --stack-name portalai-prod-{backend,database,cache}` for live sizes; re-price via the cited AWS sources.
3. **Usage (§3):** re-run the two ledger queries against prod (`portalops db psql --env prod`, read-only) and re-snapshot; pull actual Anthropic/Tavily/Mapbox spend from their consoles as the ground-truth cross-check of the turn-cost estimate.
4. **Stripe baseline (§6):** read-only inspection key; current prices + subscription counts per price.
5. Recompute §5 against the standing thresholds; a failed threshold moves price or allocation (catalog PR + `portalops tier apply --env prod --yes --confirm-prod` + Billing-Portal allow-list + vendor caps — full rollout order in `docs/TIER_PRICING_MARGIN.spec.md` §Rollout, which outlives this note as PR history if swept).
