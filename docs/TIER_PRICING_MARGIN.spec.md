# Profit-optimized production tier pricing — Spec

**Issue:** [EnterpriseBT/portal-ai#495](https://github.com/EnterpriseBT/portal-ai/issues/495) · **Discovery:** `docs/TIER_PRICING_MARGIN.discovery.md`

This spec pins the contract for the margin pass: the required shape of the durable cost model (`docs/TIER_PRICING_MODEL.md`), the acceptance thresholds every price/allocation decision must clear, the exact catalog surface that may change, the production rollout procedure with its verification steps, and the follow-up-ticket criteria. The dollar amounts and final allocation numbers are the *output* of executing this contract, not part of it.

## Key decisions (flag for review)

Ratified from discovery (D1–D5, Q1–Q6):

1. **D1 — agent loop stays unmetered; exposure is priced in.** The model quantifies per-tier Anthropic exposure explicitly; an un-charged per-org agent-turn rate ceiling is a follow-up ticket, filed if threshold T3 below is breached. Metering turns is rejected (contradicts the capability-tiering monetization rule).
2. **D2 — value-anchored pricing with a cost floor.** Prices come from the upgrade ladder; the model verifies them against thresholds T1/T2. Allocations are the tuning knob when a tier fails T2.
3. **D3 — the model is durable.** `docs/TIER_PRICING_MODEL.md` (unsuffixed → never swept) joins the maintained reference set. Decided amounts appear only as dated, explicitly non-authoritative snapshots — Stripe live remains the pricing record of truth.
4. **D4 — grandfather.** Repricing uses `stripe prices create --lookup-key <key> --transfer-lookup-key`; existing subscriptions stay on their old price object. Safe by construction: `deriveTierFromSubscription` downgrades terminal statuses *before* the price lookup (`apps/api/src/services/billing.service.ts:96-98`) and holds the current tier for a live-but-unmapped price with a logged warning (`:105-114`). Subscriber count is read first; at 0 the posture is moot.
5. **D5 — structure evaluated, not implemented.** Annual prices, top-up packs, tier-shape changes: modeled, and filed as follow-ups with numbers if justified. This ticket changes no contract surface.
6. **Thresholds (business inputs — proposed here, confirm before the analysis slice runs):**
   - **T1 (margin floor):** each paid tier's price ≥ expected-usage cost / (1 − 0.80) — i.e. ≥ 80% gross margin at expected usage.
   - **T2 (ceiling exposure):** each paid tier's allocation-ceiling vendor cost ≤ 2× its monthly price.
   - **T3 (free-tier CAC budget):** `standard`'s expected-usage cost ≤ **$5/org/month**, and its modeled worst case (bounded classes at ceiling + heavy-scenario agent turns) is stated; if that worst case exceeds **$25/org/month**, the agent-turn-ceiling follow-up is filed as part of this ticket's close-out.
   - **T4 (custom-deal floor):** no org-scoped custom tier (`portalops tier create`) is quoted below its modeled cost at the negotiated allocations.

## Scope

### In scope

1. `docs/TIER_PRICING_MODEL.md` — the durable cost model (shape pinned below), populated with live inputs.
2. The decision pass: prices for `plus`/`pro`, allocations + entitlements for all four catalog tiers, `standard`'s CAC posture, the enterprise/custom floor — each verified against T1–T4.
3. `packages/core/src/registries/tier-catalog.ts` — new magnitudes/entitlements + doc-comment replacement; guard-test extensions.
4. Production rollout: Stripe live price writes, `tier apply`, Billing-Portal switch-list, vendor spend caps.
5. Follow-up tickets filed with the model's numbers (whichever of: agent-turn ceiling, annual prices, top-ups, `perToolCaps` enforcement).

### Out of scope

- Any change to enforcement code (`cost-gate.service.ts`, `usage.service.ts`), billing mechanics, checkout, webhooks, or contracts (`site-config.contract.ts` et al.). Zero API-surface change.
- Implementing annual/top-up/turn-ceiling structures — follow-up tickets only.
- Seats/per-user pricing (#198). Metering the agent loop (rejected).

## Surface

### `docs/TIER_PRICING_MODEL.md` (new, durable)

Required sections — this shape is the contract; the analysis fills it:

1. **`## Vendor rate table`** — one row per cost driver: `driver` (e.g. Sonnet 4.6 input tokens, Sonnet 4.6 output tokens, Opus 4.8 codegen per `visualize_d3` call, Tavily per search, Mapbox per geocode request), `unit`, `rate` (USD), `source` (URL or dashboard), `as-of` (date). Anthropic model ids must match `AiService.DEFAULT_MODEL` / `CODEGEN_MODEL` (`apps/api/src/services/ai.service.ts`) at time of writing.
2. **`## Fixed monthly cost`** — AWS prod line items read from the **live** stack parameters (`aws cloudformation describe-stacks` against the prod stacks in `infra/cloudformation/`: backend ECS size + count, RDS class + storage + MultiAZ, ElastiCache class, CloudFront/S3, ALB, bastion), plus Auth0 plan and any other flat vendor fees. Stated total $/month with an as-of date.
3. **`## Usage scenarios`** — three named scenarios (`light` / `expected` / `heavy`) per tier: agent turns/org/month, avg tool calls per turn split by cost class, `bulk_geocode_records` rows/month, `visualize_d3` calls/month. Each assumption justified from the `tool_usage_ledger` aggregates (snapshot the aggregates into the doc — ledger retention time-bounds re-reads) or explicitly marked as an estimate.
4. **`## Formulas`** — `expectedCost(tier) = LLM(scenario=expected) + Σ class usage × rate + fixedShare`; `ceilingCost(tier) = LLM(scenario=heavy) + Σ allocation ceiling × worst-rate`; Stripe fee modeled as `2.9% + $0.30` per charge; the T1–T4 inequalities spelled with the confirmed threshold values.
5. **`## Per-tier results`** — one table: tier × (price snapshot, expectedCost, ceilingCost, margin at expected, T1/T2/T3 pass-fail).
6. **`## Decision record`** — dated snapshot of the decided amounts + allocations with the banner: *"Amounts are a dated snapshot; Stripe live is authoritative. Re-run this model before any repricing."*
7. **`## Re-run procedure`** — how to refresh inputs (which dashboards, which portalops/aws/stripe commands) for the next pass.

### `packages/core/src/registries/tier-catalog.ts`

**May change:** the six charge-grid numbers per tier (`meteredUnitsPerPeriod`, `meteredRatePerMin`, `expensiveUnitsPerPeriod`, `expensiveRatePerMin`; `free*` stays `null`), `builtinToolpacks` arrays, `customToolpacks` booleans, and the catalog doc comment.

**Must not change:** slugs, `displayName`s, `stripeLookupKey`s (`plus_monthly`/`pro_monthly` — repricing reuses them via `--transfer-lookup-key`), `cta`, `selectable`, `public`, `displayOrder`, `periodKind`/`periodAnchorDay`, `overage`, `perToolCaps` (stays `null` — inert, per discovery Q4), and the schema itself.

**Doc comment (lines 57-85):** the "safety ceilings, not a pricing lever … separate pass" paragraph is replaced by one stating the allocations are margin-tuned against `docs/TIER_PRICING_MODEL.md` (with the model's as-of date), preserving the existing statements of the capability-tiering rule, the enterprise exception, and the `tier apply` change path. The pointer to `docs/TIER_PRICING_MODEL.md` is a durable-doc citation, so `lint:doc-pointers` gates its existence.

**Invariants that must hold after the numbers change** (existing guard tests, `packages/core/src/__tests__/registries/tier-catalog.test.ts:182-220`): every `subscribe`/`none` tier bounds all four metered/expensive knobs; `expensiveUnitsPerPeriod` strictly ascends standard < plus < pro; enterprise stays unlimited/contact.

### Guard-test extensions (`tier-catalog.test.ts`)

Add to the existing `describe` blocks:

1. `meteredUnitsPerPeriod` strictly ascends standard < plus < pro (mirror of the existing expensive-class ascent — an inverted ladder is a copy-paste slip either way).
2. `plus.builtinToolpacks ⊆ pro.builtinToolpacks` and `standard.builtinToolpacks ⊆ plus.builtinToolpacks` — the entitlement ladder is monotonic; a downgrade never *adds* packs.
3. Paid-tier rate/quota coherence: for each bounded tier, `ratePerMin × 60 × 24 × 28 ≥ unitsPerPeriod` per class — the burst rate must permit reaching the monthly quota (an over-tight rate silently shrinks the real allocation below the advertised one).

### Copy surfaces (conditional)

- Allocation-number changes need **no copy edits**: `apps/site/src/pages/pricing.astro` and `apps/web/src/components/TierCard.component.tsx`/`SubscriptionBilling.component.tsx` render from `site-config`/`TierPolicy` data.
- **Entitlement-set changes do**: `packages/core/src/content/faq.util.ts:237` hard-codes "Mapping is part of the GIS tool pack, available on the Pro and Enterprise plans" — if GIS entitlement moves, this sentence moves with it (and the FAQ pinning test re-pins). `glossary.util.ts:414-422` ("Subscription Plan") is qualitative and survives number changes unedited.

### Rollout procedure (production; operator-run, in this order)

1. **Baseline read** (read-only inspection key, `docs/STRIPE_CLI_OPS.md`): current live prices for both lookup keys; live subscription count. Record both in the model doc's decision record.
2. **Merge the PR** (model doc + catalog + tests) — the PR is the review gate on the numbers.
3. **Reprice** (only if amounts change): `stripe prices create` per changed tier with `--lookup-key <key> --transfer-lookup-key` and `-d "product=<live product id>"` — old price stays attached to grandfathered subs, new checkouts resolve the transferred key.
4. **Converge:** `portalops tier apply --env prod --yes --confirm-prod` — fails closed (exit 8) if a lookup key is unresolvable; converged rows fire the marketing-site rebuild.
5. **Billing Portal:** update the switch allow-list in the Stripe live Dashboard to the new price objects (plan switching #260 targets them).
6. **Vendor caps:** resize Anthropic/Tavily/Mapbox account caps to the new ceiling model (`docs/PROD_PROVISIONING.runbook.md` §5) — the cap must exceed the modeled all-tenant ceiling but stay the real backstop.
7. **Verify:** prod `GET /api/public/site-config` returns the new figures; `www.portalsai.io/pricing` and the Settings plan cards render them; one live checkout charges the new amount (smoke).

**Rollback:** re-transfer the lookup key back to the previous price (`--transfer-lookup-key` again, old amount) + `git revert` the catalog commit + re-run `tier apply`. Grandfathered subs are untouched in both directions.

## Migration / Seed

**No schema change; no migration.** Catalog changes reach prod via `tier apply` (which converges the existing `standard` row too); fresh DBs pick the new `standard` numbers up through `SeedService.seedTiers` reading `TIER_CATALOG_BY_SLUG` — no seed-code edit.

## TDD test plan

`cd packages/core && npm run test:unit` (all changes live in core):

### `packages/core/src/__tests__/registries/tier-catalog.test.ts`

1. Existing invariants stay green against the new magnitudes (bounded self-serve tiers; expensive ascent; enterprise exception; schema parse).
2. New: metered-class strict ascent standard < plus < pro.
3. New: entitlement-ladder monotonicity (standard ⊆ plus ⊆ pro `builtinToolpacks`).
4. New: per-class rate/quota coherence on every bounded tier (`ratePerMin × 60 × 24 × 28 ≥ unitsPerPeriod`).

### `packages/core/src/__tests__/content/faq.util.test.ts`

5. Only if an entitlement set changes: the pinned FAQ copy is re-pinned to the corrected plan names (else untouched).

Plus full suites green at root (`npm run test`, `lint`, `type-check`) — the catalog values flow into api/web tests via fixtures, so a magnitude change that breaks an assumption elsewhere surfaces there.

**Totals ≈ 4–5 cases** (3 new invariants + existing suite adjustments; case 5 conditional). The substance of this ticket is gated by the smoke walk, not the unit suite.

## Acceptance criteria

- [ ] `docs/TIER_PRICING_MODEL.md` exists with all seven required sections populated, every vendor rate carrying source + as-of date, and per-tier T1–T4 pass/fail stated.
- [ ] Every paid tier passes T1 and T2; `standard` passes T3 (or the agent-turn-ceiling follow-up is filed per T3's trigger); the T4 custom-deal floor is stated.
- [ ] `tier-catalog.ts` carries the decided allocations/entitlements; its comment cites the model doc; all guard tests (existing + 3 new) pass; root `lint`/`type-check`/`test` green.
- [ ] Stripe live carries the decided amounts on `plus_monthly`/`pro_monthly`; `portalops tier apply --env prod` reports converged; prod `site-config`, the public pricing page, and the Settings plan cards all show the new figures; a live checkout charges the decided amount.
- [ ] Existing subscribers (count recorded at baseline) are grandfathered — no subscription's price object was mutated; a cancellation still downgrades to `standard`.
- [ ] Anthropic/Tavily/Mapbox caps match the model's ceiling figures (recorded in the smoke doc).
- [ ] Each justified structural change exists as a filed follow-up ticket carrying the model's numbers; each rejected one has its rejection recorded in the model doc.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Thresholds T1–T3 rest on thin usage data (prod ~2.5 weeks old). | Three-scenario sensitivity in the model; assumptions labeled; the re-run procedure exists precisely to redo this with real data next quarter. |
| Grandfathered subs log "unmapped Stripe price" warnings on every webhook event. | Known + accepted (`billing.service.ts:110-113` warns and holds); the count is recorded at baseline. At count 0 the branch never runs. |
| `tier apply` fails closed mid-rollout (missing lookup key). | Exit 8 before any row write; fix the Stripe side and re-run — apply is idempotent convergence. |
| A pricing-page cache shows stale amounts post-rollout. | `tier apply` fires the site rebuild; `price.updated` webhooks also do; verify step 7 checks the rendered page, and site-config fails closed (503) rather than serving a phantom price. |
| Over-tight new `ratePerMin` makes an advertised quota unreachable. | New coherence guard test (case 4) makes that a CI failure, not a support ticket. |
| Vendor caps not resized → either a false outage (cap below modeled ceiling) or no backstop (cap far above). | Rollout step 6 is a deliverable with its own smoke line, not an aside. |

**Fail-mode posture (billing-facing):** unchanged and correct — price surfaces fail closed (503 on unresolvable price), enforcement quota fails closed on exhaustion, rate limiting fails open on Redis loss. This ticket adds no new failure surface; it only changes numbers flowing through existing ones.

## Files touched

- **New:** `docs/TIER_PRICING_MODEL.md` (durable).
- **Edit:** `packages/core/src/registries/tier-catalog.ts` (magnitudes, entitlements, doc comment), `packages/core/src/__tests__/registries/tier-catalog.test.ts` (+3 invariants).
- **Conditional edit:** `packages/core/src/content/faq.util.ts` (+ its pinning test) — only if entitlement sets change.
- **No changes:** apps/api, apps/web, apps/site, schema, contracts, env vars.
- **Out-of-repo:** Stripe live prices, Billing-Portal allow-list, vendor caps, `tier apply --env prod` (all recorded in the smoke doc + model doc's decision record).

## Next step

`docs/TIER_PRICING_MARGIN.plan.md` — roughly five slices on this branch: (1) model-doc skeleton + live input gathering (Stripe baseline, prod stack params, vendor rates, ledger aggregates); (2) the analysis + decision pass filling the model and its decision record (the user confirms thresholds T1–T4 and the decided numbers here); (3) `tier-catalog.ts` + guard tests + conditional copy (the code commit); (4) rollout execution + smoke evidence; (5) follow-up tickets filed. Slices 1–2 are analysis commits, 3 is the TDD slice, 4 is operator work gated by the smoke doc.
