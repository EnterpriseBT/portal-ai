# Tier pricing cost model

The durable cost/margin model behind the production tier catalog (`packages/core/src/registries/tier-catalog.ts`) — what each tier costs Portals to serve, and the thresholds its price and allocations must clear. Born in #495; **re-run before any repricing** (§7). Decided dollar amounts appear here only as dated snapshots — **Stripe live is the pricing record of truth** (`plus_monthly` / `pro_monthly` lookup keys), never this file or the repo.

Status of this revision (2026-09-02): §1–§3 populated from fetched sources and live prod reads; §5 pending the analysis pass; §6 baseline recorded (price amounts recovered from the baked marketing page — direct Stripe confirmation blocked by #496 and the absent live inspection key). Remaining `TODO(source)` marker: Stripe-side baseline confirmation (§6, blocked by #496 + absent inspection key). Auth0 is recorded as a bounded $0 assumption (§2) pending a dashboard check — prod-tenant billing is not API-readable.

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
| `visualize_d3` | expensive | 1/call | ≈ $0.06 *(estimate: ~6K in / 1.5K out Opus 4.8 per codegen call — replace with measured tokens)* | Anthropic Opus |
| `transform_entity_records`, `cluster`, `logistic_regression` | expensive | 1/call | ≈ $0 vendor (own-compute) — the LLM cost of the turn that invokes them is counted in the turn model, not per unit | — |

**Worst-rate per class** (used for ceiling exposure): metered = $0.008/unit (`web_search` basic; $0.016 if advanced — resolve the TODO), expensive = ≈$0.06/unit (`visualize_d3`).

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

Three scenarios per tier — parameters to fill (ledger-justified where possible, else labeled estimates):

| Parameter | light | expected | heavy (ceiling driver) |
|---|---|---|---|
| Agent turns / org / mo | TODO | TODO | TODO |
| Avg Sonnet tokens per turn (in cached / in uncached / out) | TODO | TODO | TODO |
| Metered units / org / mo (mix: web_search vs geocode) | TODO | TODO | allocation ceiling |
| Expensive units / org / mo (mix: bulk-geocode rows vs visualize_d3) | TODO | TODO | allocation ceiling at worst-rate |
| `visualize_d3` calls / org / mo | TODO | TODO | TODO |

The **agent-turn LLM cost** is the unmetered exposure (#495 discovery Decision 1): nothing bounds turns per org — `stopWhen: stepCountIs(10)` bounds steps *per turn* only (`portal.service.ts:697-704`). Until the ledger snapshot lands, the working per-turn figure is an *estimate*: ~15K input (mostly cache-read after turn 1) + ~1.2K output ≈ **$0.02–$0.07/turn** Sonnet 4.6 depending on cache mix. The heavy scenario must state the turns/mo figure that, multiplied by this, it accepts per free org.

## 4. Formulas & thresholds

```
variableCost(tier, scenario) = turns × turnCost                        (LLM, unmetered)
                             + Σ_class units(scenario) × mixRate(class) (gated tools)
expectedCost(tier) = variableCost(tier, expected)
ceilingCost(tier)  = variableCost(tier, heavy) with gated classes at allocation ceiling × worst-rate
netRevenue(price)  = price − (0.029 × price + 0.30)                    (Stripe fee)
```

Thresholds (proposed in the spec, **pending user confirmation** — the §5 arithmetic runs against the confirmed values):

- **T1** margin floor: `netRevenue(price) ≥ expectedCost / (1 − 0.80)`… stated precisely: `(netRevenue − expectedCost) / netRevenue ≥ 0.80` per paid tier.
- **T2** ceiling exposure: `ceilingCost(tier) ≤ 2 × price` per paid tier.
- **T3** free-tier CAC budget: `expectedCost(standard) ≤ $5/org/mo`; if the stated heavy worst case exceeds **$25/org/mo**, the un-charged agent-turn rate-ceiling follow-up ticket must be filed at close-out.
- **T4** custom-deal floor: no org-scoped custom tier is quoted below `variableCost(negotiated allocations, heavy) + a stated fixed-cost share`.
- Break-even line (fixed costs): `payingOrgs × avg(netRevenue − expectedCost) ≥ $185/mo`.

## 5. Per-tier results

**TODO(analysis — slice 2 of `docs/TIER_PRICING_MARGIN.plan.md`):** blocked on §3's ledger snapshot, the §6 Stripe baseline, and threshold confirmation.

| Tier | Price (snapshot) | expectedCost | ceilingCost | Margin @ expected | T1 | T2 | T3 |
|---|---|---|---|---|---|---|---|
| standard | — (free) | | | — | — | — | |
| plus | TODO | | | | | | — |
| pro | TODO | | | | | | — |
| enterprise | contact | modeled per deal (T4) | — | — | — | — | — |

## 6. Decision record

> Amounts below are a **dated snapshot; Stripe live is authoritative.** Re-run this model (§7) before any repricing.

- **Baseline (pre-decision), 2026-09-02:** **Plus $19/mo · Pro $49/mo** — recovered from the statically-baked `www.portalsai.io/pricing` (prices as of that page's last successful build; the live `GET /api/public/site-config` currently 500s — **#496**, which also blocks this ticket's rollout verification until fixed). Prod DB: both paid tier rows carry a `stripe_price_id`; **live subscriptions: 1** (`organizations.stripe_subscription_id`, the internal `pro` org). **TODO(source):** confirm amounts + subscription list Stripe-side with the read-only inspection key (`docs/PROD_STRIPE_LIVE.runbook.md` §3) once available — the baked page is evidence, not the record of truth.
- **Decided amounts + allocations:** *(slice 2 output — pending)*
- **Grandfather posture:** grandfather via `--transfer-lookup-key` (spec D4); executed posture recorded here with the subscriber count at rollout.
- **Structural verdicts** (annual prices / top-up packs / agent-turn ceiling / `perToolCaps` enforcement): *(slice 2 output — each ends `implement-here | file-follow-up(#N) | rejected(reason)`)*

## 7. Re-run procedure

Re-run before any repricing, on a vendor rate change, or quarterly while usage is growing:

1. **Vendor rates (§1):** re-fetch the four pricing pages; re-check `ai.service.ts` model ids — a model bump changes the turn cost silently.
2. **Fixed costs (§2):** `aws login --remote`, then `aws cloudformation describe-stacks --stack-name portalai-prod-{backend,database,cache}` for live sizes; re-price via the cited AWS sources.
3. **Usage (§3):** re-run the two ledger queries against prod (`portalops db psql --env prod`, read-only) and re-snapshot; pull actual Anthropic/Tavily/Mapbox spend from their consoles as the ground-truth cross-check of the turn-cost estimate.
4. **Stripe baseline (§6):** read-only inspection key; current prices + subscription counts per price.
5. Recompute §5 against the standing thresholds; a failed threshold moves price or allocation (catalog PR + `portalops tier apply --env prod --yes --confirm-prod` + Billing-Portal allow-list + vendor caps — full rollout order in `docs/TIER_PRICING_MARGIN.spec.md` §Rollout, which outlives this note as PR history if swept).
