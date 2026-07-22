# Wire app-dev to Stripe sandbox + a Pro tier — Discovery

**Issue:** [EnterpriseBT/portal-ai#239](https://github.com/EnterpriseBT/portal-ai/issues/239)

**Why this exists.** The Stripe billing stack (#176, #217, #218) is fully coded but **dormant in app-dev**: `StripeService`, the billing router (`/api/billing/checkout`, `/portal`), the webhook router (`/api/webhooks/stripe`), and the tier-convergence path all ship, but the app-dev deploy delivers no Stripe secrets to the ECS task, so `StripeService.isConfigured()` is `false` and every billing/webhook surface `503`s by design. Meanwhile `TIER_CATALOG` holds exactly one row — `standard`, `stripeLookupKey: null` — so there is nothing to buy.

This ticket flips Stripe **on in app-dev against a Stripe sandbox** — delivering the sandbox secrets through the portalops config catalog and the CI → CloudFormation → ECS injection path — and adds one purchasable tier (**Pro**) backed by a sandbox price, so the whole checkout → webhook → convergence loop is exercisable end-to-end before any live wiring. This is the *activation-and-catalog* change that makes the already-built billing machinery reachable.

**app-dev is a QA sandbox**, so allocation *magnitudes* are not the point — every tier (including `standard`) carries generous QA allocations so quota denials never interrupt manual testing. The tiers exist here to exercise the purchase/convergence loop, not to model production pricing. **Enterprise / the Custom plan is deferred to #241**; this ticket ships `standard` + `pro`.

## The current shape

### Tier catalog & model

`TierCatalogEntrySchema` (`packages/core/src/registries/tier-catalog.ts:23-47`) is the env-agnostic policy record. A row carries: `slug`, `displayName`, `periodKind` (`z.literal("monthly")`), `periodAnchorDay` (1–28), `overage` (`z.literal("hard-deny")`), the six-scalar charge grid `{free,metered,expensive}{UnitsPerPeriod,RatePerMin}` (each `int().nonnegative().nullable()`, **null = unlimited**), `perToolCaps` (nullable, `Record<toolName,{unitsPerPeriod}>`, `tier.model.ts:42-45`), `selectable`, `builtinToolpacks` (compile-time-checked pack slugs), `customToolpacks` (bool), and `stripeLookupKey` (nullable; null = not purchasable). The single `standard` row (`tier-catalog.ts:58-75`): metered 2500u/20pm, expensive 300u/5pm, free all-null, `perToolCaps: null`, `selectable: true`, `builtinToolpacks: [...all 6]`, `customToolpacks: true`, `stripeLookupKey: null`.

The six built-in pack slugs (`builtin-toolpacks.ts:32-39`): `data_query`, `statistics`, `regression`, `financial`, `web_search` (the Tavily-backed *expensive* one), `entity_management`. The runtime DB row (`TierSchema`, `tier.model.ts:91-117`) mirrors the catalog but carries a resolved `stripePriceId` (`:106`) in place of `stripeLookupKey`; the cost-class vocabulary is `CostHintSchema` = `free | metered | expensive` (`tool-capability.model.ts:98`).

> **Load-bearing finding:** `standard` already grants **every** entitlement — all 6 packs *and* custom toolpacks. Since app-dev is a QA sandbox and we're widening `standard` to generous allocations too (Decision 1), `standard` and `pro` are near-identical policy rows here — `pro` differs only in being **purchasable** (`stripeLookupKey` non-null). Meaningful tier *differentiation* is a production-pricing concern, out of scope for this QA-activation ticket.

### `tier apply` & lookup-key resolution

`tierApply` (`packages/devops-cli/src/commands/tier.ts:247-301`): resolve Stripe → read DB rows → `computeTierChanges` diff (`:95-144`, per-slug `insert|update|noop` + never-touched `unmanaged`) → `--dry-run` returns before any guard/write (`:277`) → guard once → one transaction of upserts-by-slug through `TierStore` (`:169-195`, `tiers` table) → per-slug audit. Lookup keys are resolved by `stripePriceResolver` (`stripe.ts:66-85`, one read-only `prices.list({lookup_keys, active:true})`); `TierApplyMissingPricesError` throws at `tier.ts:266-267` **before any DB write** if a declared key resolves to no active price — the fail-closed path. `resolveStripeKey` (`stripe.ts:43-57`) reads `STRIPE_SECRET_KEY` (local) or the `stripe-secret-key` AWS secret; the code comment recommends a read-only `rk_` key **for tier apply**. API version pinned `2026-06-24.dahlia` (`stripe.ts:17`).

### StripeService gating & convergence

`isConfigured()` (`stripe.service.ts:43-47`) is true **only when both** `STRIPE_SECRET_KEY` **and** `STRIPE_WEBHOOK_SECRET` are set; `environment.ts:28-34` exposes the three Stripe vars as plain `process.env` reads (`STRIPE_AUTOMATIC_TAX` defaults ON). `POST /api/billing/checkout` (`billing.router.ts:148`) takes a **tier slug** (`BillingCheckoutRequestSchema = {tier: string}`), and `BillingService.createCheckout` (`billing.service.ts:286-377`) resolves slug → `tier.stripePriceId` → Checkout session; `503 BILLING_NOT_CONFIGURED` when unconfigured. The webhook (`webhook.router.ts:237`, `express.raw`) `503`s if unconfigured (`:244`), verifies the signature via `StripeService.constructEvent` (400 on mismatch), and routes `customer.subscription.{created,updated,deleted}` (`:172-176`) to `handleSubscriptionEvent` (`billing.service.ts:116-232`). Convergence re-fetches the live subscription, finds the org by `stripeCustomerId`, and maps **by Stripe price id** through `tiers.repository.ts:47-52` `priceIndex()` (`stripe_price_id → slug`); `deriveTierFromSubscription` (`:70-103`) → active+known-price ⇒ that slug, terminal ⇒ `standard`, unknown price ⇒ keep current. **So the `pro` row must carry a resolved `stripePriceId` — which is exactly what `tier apply` writes.** Allocations are consumed at `cost-gate.service.ts:143` (`checkAdmission` → `policy.allocations[costHint]`, rate window `:166-185`, quota `:189-196`, atomic `commitCharge` `:232`); `free` class is immune, org-paid custom tools never charged. Semantics: `docs/SUBSCRIPTION_TIER_POLICY.spec.md`.

### Config catalog, `vars`, infra & CI

`catalog.ts` is a flat table (`CATALOG`, `:40-61`) of `CatalogEntry` (`:18-26`: `key`, `kind: "secret"|"ssm"`, `name`, optional `ssmType`) built from `secret()`/`ssm()` helpers (`:28-38`); paths derived by `pathFor` (`:75-82`), applied uniformly across envs. `STRIPE_SECRET_KEY` exists as `secret("STRIPE_SECRET_KEY","stripe-secret-key")` (`:50`); **`STRIPE_WEBHOOK_SECRET` is absent.** `vars set` (`vars.ts:169-191`) routes secrets → Secrets Manager, guarded by `guardMutation` (`:40-45`, `--yes` required on app-dev/staging), and warns a **brand-new secret's ARN must be added to CloudFormation before the next deploy** (`:160-166`). app-dev = AWS env `dev`, `kind: "staging"` (`registry.ts:51-56`) ⇒ mutations need `--yes` (`guard.ts:39-45`); AWS auth is ambient IAM (`aws.ts:1-13`). In `infra/cloudformation/backend.yml`, secret ARNs are string `Parameters` (`:47-70`), granted `secretsmanager:GetSecretValue` in the exec role (`:218-230`) and injected via the task-def `Secrets` block (`:472-504`, e.g. `DATABASE_URL` `:473-474`); **no Stripe parameter/grant/binding exists yet.** `.github/workflows/deploy-dev.yml` passes `--parameter-overrides SecretArn*=${{ secrets.DEV_SECRET_ARN_* }}` in the deploy-infra step (`:98-116`); the later re-deploy step only overrides `BuildVersion`/`BuildSha` (`:294-304`), so CFN retains prior ARN values.

## The design space

### Decision 1 — The QA-generous grid (standard + pro)

app-dev is a QA sandbox: the goal is that no quota/rate denial ever interrupts a manual test, on *any* tier. So both rows get the same generous allocation shape; `pro` differs only by being purchasable. The one real choice is how "generous" is expressed:

- **A — Large finite numbers.** Every field a big integer (e.g. metered 1,000,000 / 10,000-per-min). Nothing is `null`.
- **B — `null` (unlimited) on metered, generous-finite on expensive.** `metered = null` removes the quota entirely; `expensive` stays a big finite number.

| | A (all finite) | B (metered null, expensive finite) |
|---|---|---|
| Denials during QA | Effectively never (huge caps) | Never on metered; effectively never on expensive |
| `web_search`→Tavily cost exposure | Bounded (finite expensive) | Bounded (finite expensive) |
| Exercises the "unlimited" (`null`) code path | No | **Yes** — validates null-allocation handling in the cost gate |

**Lean: B.** It removes any chance of a metered denial *and* exercises the `null`-allocation path in `cost-gate.service.ts`, while keeping `expensive` finite so `web_search`→Tavily (Portal-billed even in QA) can't run up an uncapped vendor bill. `perToolCaps: null` on both. Concrete rows (magnitudes are QA-arbitrary — Open Q1):

| field | **standard** (widened, `stripeLookupKey: null`) | **pro** (`stripeLookupKey: "pro_monthly"`) |
|---|---|---|
| meteredUnitsPerPeriod | `null` (unlimited) | `null` (unlimited) |
| meteredRatePerMin | `null` (unlimited) | `null` (unlimited) |
| expensiveUnitsPerPeriod | 1_000_000 | 1_000_000 |
| expensiveRatePerMin | 10_000 | 10_000 |
| free{Units,Rate} | null / null | null / null |
| perToolCaps | null | null |
| builtinToolpacks | all 6 | all 6 |
| customToolpacks | true | true |
| selectable | true | true |
| periodKind / anchorDay / overage | monthly / 1 / hard-deny | monthly / 1 / hard-deny |

`expensive` stays **finite** on purpose: `web_search`→Tavily is Portal-billed, so an unlimited expensive class is an uncapped vendor bill, not a feature — even in QA.

### Decision 2 — The `STRIPE_SECRET_KEY` value: writable `sk_test_`, not read-only `rk_`

`tier apply` recommends a read-only `rk_` key — but the **running app** (checkout session / customer / subscription writes in `billing.service.ts`) needs write scope, and it reads the **same** `stripe-secret-key` secret the ECS task is injected with. One secret, two consumers.

**Lean: set the app-dev `STRIPE_SECRET_KEY` to a full-capability sandbox `sk_test_…` key.** `tier apply` runs fine against a writable key (it only issues reads); the `rk_` recommendation is a local-operator nicety that cannot satisfy the app's write path. (Sandbox keys are non-production by construction, so the widened scope is contained to the sandbox account.)

### Decision 3 — Lookup-key naming

The `pro` key must be stable and portable across sandbox→live (convergence resolves it per-env). Options: `pro_monthly` (kind+cadence) · `tier_pro` (kind only) · `portal_pro_monthly` (product-prefixed).

**Lean: `pro_monthly`.** Encodes cadence (room for `_annual` later), no env or price-amount leakage, matches the "lookup keys cross envs, never price ids" convention. (Enterprise's key is #241's to choose.)

### Decision 4 — Secret-delivery bootstrap ordering

A `Secrets` binding whose `ValueFrom` ARN doesn't yet exist makes the ECS task **fail to start**. The safe order is fixed, not a preference: **(1)** `portalops vars set` both secrets on env `dev` (creates them, prints ARNs) → **(2)** set GitHub secrets `DEV_SECRET_ARN_STRIPE_SECRET_KEY` / `DEV_SECRET_ARN_STRIPE_WEBHOOK_SECRET` to those ARNs → **(3)** merge `catalog.ts` + `backend.yml` + `deploy-dev.yml` → **(4)** deploy. **Lean: encode this ordering explicitly in the plan and smoke doc**; it's the highest-risk sequencing in the ticket.

### Decision 5 — Webhook endpoint provisioning & the whsec_ chicken-and-egg

The `whsec_` value only exists once the sandbox webhook endpoint is created pointing at `https://api-dev.portalsai.io/api/webhooks/stripe`. The endpoint can be created before the app is configured (Stripe just gets `503`s until secrets land, and can be re-tried). **Lean: create the sandbox endpoint first, capture `whsec_`, feed it into Decision 4 step 1.** Endpoint event selection ⊇ `customer.subscription.{created,updated,deleted}`.

## Tradeoff comparison

| | D1 (grid=B) | D2 (`sk_test_`) | D3 (`pro_monthly`) | D4 (ordering) | D5 (endpoint-first) |
|---|---|---|---|---|---|
| Spreads to spec | Yes (grid table) | Yes (secret contract) | Yes (catalog value) | Yes (plan slices) | Yes (smoke steps) |
| Reversible cheaply | Yes (edit + re-apply) | Yes (rotate secret) | **No** — key is the cross-env identity | Yes | Yes |
| Vendor-cost risk | Handled (expensive capped) | Contained (sandbox) | N/A | N/A | N/A |

## Recommendation

1. Add a `pro` row to `TIER_CATALOG` (`stripeLookupKey: "pro_monthly"`, `selectable: true`, all 6 packs, `customToolpacks: true`) with the Decision-1 grid, and **widen the existing `standard` row** to the same generous QA grid (keeping `stripeLookupKey: null`).
2. Create a Pro product/price in the Stripe **sandbox** with `lookup_key` `pro_monthly`.
3. Set the app-dev `STRIPE_SECRET_KEY` secret to a writable `sk_test_…` sandbox key; add `STRIPE_WEBHOOK_SECRET` to `catalog.ts` and set its `whsec_…` value.
4. Add both Stripe secrets to `backend.yml` (two `Parameters`, two IAM `!Ref`s, two `Secrets` bindings) and pass both ARNs via `deploy-dev.yml` `--parameter-overrides` from new `DEV_SECRET_ARN_*` GitHub secrets.
5. Create the sandbox webhook endpoint at the app-dev URL; capture its `whsec_`.
6. Follow the Decision-4 ordering; run `portalops tier apply --env app-dev --dry-run` (expect `pro` as a **resolved** add and `standard` as an update), then a real apply.

## Open questions

1. **The exact grid magnitudes.** QA-arbitrary by decision — app-dev is a test sandbox, so the finite `expensive` numbers (1M units / 10k-per-min) are placeholders, not pricing. **Lean: ship the drafted values; they're tunable via a follow-up `tier apply` since the catalog is the record-of-truth and re-converging is cheap. Real per-tier differentiation is a production concern (not this ticket, not #241's card-enrichment).**
2. **`web_search` per-tool cap.** Do we want to fence the one Portal-billed tool below the class budget? **Lean: no (`perToolCaps: null`); the finite `expensive` class budget already bounds Tavily spend, and adding caps is a one-field follow-up if sandbox usage shows a hot spot.**
3. **Price amounts.** Out of code by policy (pricing lives in Stripe). **Lean: set the amount in the Stripe sandbox dashboard only; the catalog references the lookup key, never an amount — nothing about price magnitude enters the repo.**

## Enterprise-scale considerations

- **Concurrency & correctness.** `tier apply` is one transaction of upserts-by-slug and fails closed pre-write (`tier.ts:266-277`); convergence writes tier+subscription+dedup in one tx (`billing.service.ts:210`) keyed on `stripe_events`. `N/A` — no new race introduced; we ride existing atomicity.
- **Accuracy & auditability.** Every mutating CLI op appends to `~/.portalai/audit.log`; `tier apply` audits per changed slug. Webhook events dedup via `stripe_events`. **Lean: rely on existing ledgers; add nothing.**
- **Failure modes.** `tier apply` fails **closed** on a missing price (no partial catalog). Missing secrets ⇒ billing/webhook `503` (app still boots). A dangling `ValueFrom` ARN ⇒ **ECS task won't start** — the one hard-fail, mitigated by Decision-4 ordering. **Lean: fail-closed everywhere; ordering is the safeguard.**
- **Scale & unbounded growth.** `metered = null` is unbounded *by design* (QA), but `expensive` (the Portal-billed class) stays finite on every tier — the deliberate cap on third-party cost. **Lean: never leave `expensive` null, even in QA.**
- **Multi-tenancy.** Per-org isolation is unchanged; allocations are per-org via `UsageService`. Non-purchasing orgs stay on `standard` (now QA-generous, still the non-purchasable default). `N/A` — no shared-fate surface added.
- **Contract stability.** The new `pro` row and the widened `standard` are pure data on the existing `TierCatalogEntrySchema`; the lookup key is the env-portable identity, so live wiring (#83) and Enterprise (#241) reuse the same shape with a different price resolution. **Lean: additive-only, no schema change.**
- **Data lifecycle.** `periodKind: monthly` / `periodAnchorDay` align usage windows to the billing period (already contract-aligned). `N/A` — reuse standard's period semantics.

## What this doesn't decide

- **Enterprise / Custom plan** — deferred to #241; this ticket ships `standard` + `pro` only.
- **Live/production Stripe & a prod env** — prod isn't in the env registry (#83); sandbox + app-dev only.
- **Renaming `standard` → `free`** — out of scope; the (now QA-generous) non-purchasable default keeps its slug.
- **Production tier differentiation** — meaningful per-tier allocation/entitlement gaps are a pricing concern; here every tier is QA-generous.
- **Frontend pricing/upgrade UI** — only what already consumes `selectable` tiers; no new UI unless the spec surfaces a concrete gap.
- **Stripe Tax rollout** — `STRIPE_AUTOMATIC_TAX` keeps its current default.

## Next step

`docs/STRIPE_SANDBOX_TIERS.spec.md` (contract: the exact `standard`/`pro` catalog rows + grid, the `STRIPE_WEBHOOK_SECRET` catalog addition, the backend.yml + deploy-dev.yml parameter shapes, and the acceptance assertions) then `docs/STRIPE_SANDBOX_TIERS.plan.md`. The plan slices roughly as: (1) `TIER_CATALOG` `pro` row + widened `standard` + registry-pin test; (2) `catalog.ts` `STRIPE_WEBHOOK_SECRET` entry; (3) `backend.yml` Stripe parameters/IAM/Secrets bindings; (4) `deploy-dev.yml` overrides + COMMANDS.md docs; then the **operator runbook** slices (create the sandbox product/price + webhook endpoint, `vars set`, set GitHub secrets, deploy, `tier apply`) captured in the smoke doc since they run against live infra, not CI. Each code slice is independently green-testable; the infra/operator slices land as reviewed config + a walked smoke checklist.
