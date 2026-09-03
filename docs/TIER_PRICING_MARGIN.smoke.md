# tier-pricing-margin — Smoke Suite

Manual smoke test for [#495](https://github.com/EnterpriseBT/portal-ai/issues/495) — margin-tuned production pricing: Plus **$19 → $29**, Pro **$49 → $99**, metered allocations 5,000→3,000 / 50,000→15,000, cost model in `docs/TIER_PRICING_MODEL.md`. **Branch under test:** `feat/tier-pricing-margin` (PR [#497](https://github.com/EnterpriseBT/portal-ai/pull/497)).

This ticket's smoke is predominantly a **production rollout walkthrough** (live Stripe, prod `tier apply`, vendor dashboards) — per the prod-smoke convention it verifies vendor integrations; app logic is covered by CI. Known blocker: **#496** (prod `site-config` 500) blocks §5's first two boxes until fixed — an unchecked box there carries that reason, not silence.

## Preflight

### Environment

- [x] `git checkout feat/tier-pricing-margin && git pull --ff-only`; no migration on this branch (docs + core catalog only)
- [x] CI green on PR #497 (`gh pr checks 497`)
- [x] AWS authenticated (`aws sts get-caller-identity`) and Stripe **live** dashboard access at hand — manual

### Fixtures

- [x] None to create — the walkthrough runs against prod's real state (2 orgs, 1 internal `pro` subscription)

### Reset between runs

- [x] §1–§2 read-only. §3–§4 are idempotent to re-run (`--transfer-lookup-key` moves the key; `tier apply` converges). No destructive step anywhere.

## §1 — Analysis artifacts (AC1, AC2)

- [ ] `docs/TIER_PRICING_MODEL.md` has all seven sections populated; every §1 rate row carries source + as-of date; §2 states ~$185/mo live-verified — manual read
- [ ] §5 states T1–T4 per tier: T1 **pass** at $29/$99 (80.1%/80.2% at stated expected), T2 **fail-with-closure-path** (two follow-ups named), T3 expected **pass** / worst-case **trigger fired**, T4 floor stated — manual read

## §2 — Catalog + guard invariants (AC3)

- [x] `packages/core/src/registries/tier-catalog.ts`: plus `meteredUnitsPerPeriod: 3_000`, pro `15_000`; expensive unchanged; `standard.builtinToolpacks` now includes `entity_management`, `plus.builtinToolpacks` now includes `regression` + `financial` (Pro exclusives: visualize, gis, custom toolpacks); doc comment cites `docs/TIER_PRICING_MODEL.md` (no "separate pass" deferral remains)
- [ ] Glossary "Plan Entitlement" example now illustrates gating with `gis` (a genuinely Pro+ pack), not `entity_management`; a free-tier station in the app offers record create/update/delete via the assistant — manual (dev stack or app.portalsai.io after merge)
- [x] `cd packages/core && npm run test:unit -- --testPathPattern tier-catalog` → 23 passed, including the three #495 invariants (metered ascent, entitlement monotonicity, rate-reaches-quota)
- [x] Root `npm run lint && npm run type-check && npm run lint:doc-pointers` clean

## §3 — Stripe live repricing (AC4a, AC5) — manual

- [x] In the Stripe **live** account, create the new prices carrying the transferred lookup keys (Dashboard, or CLI with a live key holding Prices write):
  ```bash
  stripe prices create -d "product=<live Plus product id>" -d unit_amount=2900 -d currency=usd \
    -d "recurring[interval]=month" -d lookup_key=plus_monthly -d transfer_lookup_key=true --api-key rk_live_…
  stripe prices create -d "product=<live Pro product id>" -d unit_amount=9900 -d currency=usd \
    -d "recurring[interval]=month" -d lookup_key=pro_monthly -d transfer_lookup_key=true --api-key rk_live_…
  ```
- [x] `stripe prices list -d "lookup_keys[]=plus_monthly" -d "lookup_keys[]=pro_monthly" --api-key rk_live_…` → exactly two active prices, $29.00 and $99.00, each carrying its lookup key
- [x] The pre-existing internal `pro` subscription still references the **old** $49 price object (grandfathered — untouched by the transfer); expected side effect: webhook events for it will log "unmapped Stripe price; keeping the org's current tier" — that warning is correct behavior, not a regression
- [ ] Billing Portal configuration (live Dashboard → Settings → Billing → Customer portal): the plan-switch product list offers the **new** $29/$99 prices (#260 plan switching targets them)

## §4 — Prod convergence (AC4b)

- [ ] Merge PR #497 first (convergence reads the catalog from the checked-out tree — converge from `main`, not the branch)
- [ ] `npm run build` (CLIs run `dist/`), then:
  ```bash
  portalops tier apply --env prod --yes --confirm-prod
  ```
  → reports plus/pro converged onto the **new** live price ids; exit 0 (exit 8 = a lookup key didn't resolve — re-check §3)
- [ ] Prod rows match the catalog: `portalops db psql --env prod --yes --confirm-prod -- -X -A -c "SELECT slug, metered_units_per_period, expensive_units_per_period FROM tiers WHERE deleted IS NULL ORDER BY slug;"` → plus 3000/2000, pro 15000/20000, standard 500/100, enterprise null/null

## §5 — Public price surfaces (AC4c) — blocked by #496 until fixed

- [ ] `curl https://api.portalsai.io/api/public/site-config` → 200 with plus $29 / pro $99 *(currently 500s — #496; do not check this box with a recorded-reason substitute, fix #496 first)*
- [ ] `www.portalsai.io/pricing` renders Plus $29 / Pro $99 (rebuild fires from `tier apply` / `price.updated`; requires #496 fixed) — manual
- [ ] Settings → Subscription & Billing on `app.portalsai.io` shows the plan cards with the new amounts and the new credit figures — manual
- [ ] One live checkout charges **$29.00** (Plus) on a real card, then immediately refund/cancel via the Dashboard — manual

## §6 — Vendor spend caps (AC6) — manual

Model ceilings (post-follow-up turn budgets; `docs/TIER_PRICING_MODEL.md` §5): the caps are the real backstop while the agent loop is unmetered.

- [ ] Anthropic console: prod workspace spend cap set and recorded in the smoke evidence (suggested: ≥ modeled all-tenant heavy month, small multiple of current spend)
- [ ] Tavily: plan limit recorded; consistent with all-tenant metered ceilings (3,000 + 15,000 + 500 units ≈ $148/mo worst-case at $0.008)
- [ ] Mapbox: token scoped to geocoding APIs + spend limit recorded (expensive ceilings 22,100 units ≈ $17/mo worst-case at $0.75/1K)

## §7 — Close-out (AC7)

- [x] Follow-up tickets filed, each carrying the model's numbers: (a) **#498** — un-charged per-org agent-turn rate ceiling (mandatory — T3 trigger fired; budgets ≈ 260/400/790 turns-per-month equivalents), (b) **#499** — `visualize_d3` re-unit (≈80 units/call) or `perToolCaps` enforcement (T2 closure)
- [x] Rejected structural options recorded with reasons in `docs/TIER_PRICING_MODEL.md` §6 (annual: premature at 1 subscriber; top-ups: no denial signal)
- [x] Issue #495 body links all artifacts; `docs/TIER_PRICING_MODEL.md` §6 decision record shows the executed amounts + date

**Agent-walk evidence:** `packages/e2e/test-results/smoke-walk-TIER_PRICING_MARGIN.md` (checked boxes above are agent-verified with observed values, marked on the operator's instruction; unchecked boxes are manual, blocked, or post-merge). **New finding from the walk:** the live account has **zero Billing-Portal configurations** — §3's portal box needs the portal *created* in live mode, not just an allow-list edit.

## Sign-off

- [ ] Every section above verified (or its blocker named inline)
- [ ] <date + name> — confirmed against the live production environment

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/price/subscription ids):
