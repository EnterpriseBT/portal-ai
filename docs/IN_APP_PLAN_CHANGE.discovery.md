# In-app plan upgrade/downgrade for non-custom orgs — Discovery

**Issue:** [EnterpriseBT/portal-ai#260](https://github.com/EnterpriseBT/portal-ai/issues/260)

**Why this exists.** After #241/#257, a **subscribed** org's Subscription & Billing tab shows only "Manage subscription" (→ Stripe billing portal home) and a read-only current-plan card. There is no in-app way to move between plans — a paying customer can't upgrade or downgrade without hunting through the Stripe portal (which today lands on its home page, not a plan switch). Custom (`contact`) orgs deliberately have no self-serve path (their arrangement goes through sales). This adds an in-app **"Switch to this plan"** affordance for non-custom orgs that routes the change through Stripe — so proration/payment stay in Stripe's hosted flow and the existing webhook reconciles the tier, with **no** direct subscription mutation in our code. This is the surface that lets self-serve customers change plans without a desync (cf. #259) or a bespoke payments endpoint.

## The current shape

### Portal session (the seam to extend)

| Piece | Location | Note |
|---|---|---|
| `StripeService.createPortalSession` | `apps/api/src/services/stripe.service.ts:143` | Passes only `customer` + `return_url` — **no `flow_data`, no configuration id**; lands on the portal home |
| `BillingService.createPortal` | `apps/api/src/services/billing.service.ts:389` | Guard ladder (configured 503 → owner 403 → has-customer 409) + `returnUrl = settingsUrl()` (`:28`) |
| Subscription retrieve seam | `stripe.service.ts:89` | Already exists — needed to fetch the current subscription **item id** for a `flow_data` update |
| Checkout (price-threading template) | `stripe.service.ts:108` (`createCheckoutSession`) | Already threads a `priceId` — the shape to mirror |

### Routes & contracts

| Piece | Location | Note |
|---|---|---|
| `POST /api/billing/portal` | `billing.router.ts:224` | **Bodyless**, returns `{ url }`; `@openapi` at `:191` |
| `POST /api/billing/checkout` | `billing.router.ts:152` | Validates `BillingCheckoutRequestSchema` (`{ tier }`), returns `{ url }` — the request-body template |
| Contracts | `packages/core/src/contracts/billing.contract.ts:48` (`BillingCheckoutRequestSchema`), `:60` (`BillingPortalResponseSchema`) | No portal *request* schema yet |

### Webhook → tier reconciliation (already sufficient)

`webhook.router.ts:237` verifies + routes `customer.subscription.{created,updated,deleted}` (`:172`) → `BillingService.handleSubscriptionEvent` (`billing.service.ts:116`), which builds `priceIndex` (`:178`), maps price→slug via the pure `deriveTierFromSubscription` (`:70`), and updates `organizations.tier`/`stripeSubscriptionId`/`billingAnchorDay` in one transaction (`:210`), dedup'd by `stripeEvents.insertIfNew`. **A portal-routed switch reconciles here with zero changes** — the `updated` event stays on the same subscription id (passes the foreign-sub guard at `:156`) and carries the new price. This is the crux: we don't mutate the subscription ourselves.

### Tier → Stripe price

`TiersRepository` (`apps/api/src/db/repositories/tiers.repository.ts`): `findBySlug` (`:24`, resolves slug → `stripePriceId`, used by `createCheckout` with its 404/400 guards at `billing.service.ts:332`), `findSelectableForOrg` (`:49`, org-scoped list), `priceIndex` (`:71`, webhook map). A switch handler reuses `findBySlug` → `stripePriceId`, replicating checkout's selectable/priced guards.

### Frontend subscribed-state UI

`SubscriptionBilling.component.tsx`: state derivation (`:232`); **subscribed** branch (`:141`) renders only the #257 current-plan card + "Manage" (`onManage` → `portalMutation`, `:215`); the full grid renders only in the **unsubscribed** branch (`:161`) via `displayTiers`, with the custom-only collapse at `:110`. `TierCard.component.tsx` gates the CTA on `tier.cta`: `subscribe` + `!isCurrentPlan` → the Subscribe button (`:153`); `contact` → support mailto (`:167`). SDK `billing.api.ts`: `portal()` (`:32`) is a bodyless `useAuthMutation`; `checkout()` (`:25`) threads a body. Owner gating is server-side (`billing.service.ts:400`/`304` → 403) + a disabled-button affordance (`withOwnerGate`).

## The design space

### Decision 1 — How the switch is executed

| | A: portal `subscription_update_confirm` flow | B: bespoke `change-plan` endpoint | C: generic portal (home) |
|---|---|---|---|
| Payments/proration | Stripe-hosted (confirm screen) | **our code** (subscription item swap + proration flags) | Stripe-hosted |
| Reconciliation | existing webhook, no change | existing webhook | existing webhook |
| Payment surface / risk | low | high (we drive the mutation) | low |
| UX | deep-linked to the target change | in-app, no redirect | poor — user hunts in the portal |

**Lean: A.** Extend the portal session with `flow_data: { type: "subscription_update_confirm", subscription_update_confirm: { subscription, items: [{ id: <current item>, price: <target> }] } }`. Stripe hosts the proration/confirm; the webhook reconciles. B is the ticket's explicit out-of-scope (more payment surface); C is poor UX and config-fragile.

### Decision 2 — Contract shape for the target tier

| | A: extend `/portal` with optional `{ tier? }` | B: new `/portal/switch` route |
|---|---|---|
| Manage (no tier) | same endpoint, bodyless still works | untouched |
| Backward-compat | additive/optional | additive route |
| Handler branching | one handler: tier → flow_data, else home | two handlers |

**Lean: A.** Add `BillingPortalRequestSchema` = `{ tier: z.string().optional() }`; `/portal` with no tier = today's Manage (portal home), with a tier = a subscription-update flow to that tier's price. One endpoint, backward-compatible; `billing.api.ts` `portal()` extends to send an optional body (mirror `checkout()`).

### Decision 3 — Which cards get a "Switch" CTA (and the custom rule)

Render the full org-scoped grid in the **subscribed** state (as unsubscribed does), current plan flagged. Per tier: current → chip, no CTA (the #257 read-only card); non-current **`cta === "subscribe"`** → owner-gated **"Switch to this plan"**; `contact` → support mailto (never a Switch). The #241 custom-only collapse still applies — an org **on** a custom plan sees only that card (sales-gated, no switching). Keep the **"Manage subscription"** button for payment method / invoices / cancellation.

**Lean: as above.** Switch appears only on priced, non-current tiers, only when the org isn't on a custom plan; Manage stays for non-plan-change billing management.

### Decision 4 — Downgrade to the **free** tier (`standard`, no price)

The free/`standard` tier has no `stripePriceId`, so moving to it is a **cancellation**, not a price swap. `subscription_update_confirm` can't target a priceless tier.

**Decided: the free tier shows no "Switch" — cancelling the subscription (via **Manage**) *is* the downgrade to free.** No dedicated "downgrade to Free" button (confirmed): cancel implies going to free. Switch moves only between *priced* tiers. Documented so it isn't read as a gap.

## Tradeoff comparison

| | D1 portal flow | D2 extend `/portal` | D3 subscribed grid + Switch | D4 free = cancel |
|---|---|---|---|---|
| Spreads to spec | Yes | Yes | Yes | Yes |
| Backend change | portal session `flow_data` | contract + handler | — | — (Manage covers it) |
| Frontend change | — | SDK `portal()` body | subscribed-state render + handler | render (no Switch on free) |
| New payment surface | No (Stripe-hosted) | No | No | No |

## Recommendation

1. Extend `StripeService.createPortalSession` to accept an optional target price and, when present, build a `subscription_update_confirm` `flow_data` (fetching the current subscription item id via the existing retrieve seam).
2. `BillingService.createPortal` accepts an optional `tierSlug`; when given, resolve it via `findBySlug` with checkout's **selectable + priced** guards (404/400), then pass the price into the portal flow. Owner/has-customer guards unchanged.
3. Add `BillingPortalRequestSchema = { tier?: string }`; `/portal` parses an optional body (bodyless = Manage, as today); update the `@openapi` block. `billing.api.ts` `portal()` sends the optional `{ tier }`.
4. `SubscriptionBilling` renders the full org-scoped grid in the **subscribed** state; a non-current `cta === "subscribe"` tier gets an owner-gated **"Switch to this plan"** CTA → `portalMutation({ tier })` → redirect. Keep Manage. The #241 custom-only collapse and `contact` support-mailto are unchanged.
5. The free/`standard` tier shows no Switch; downgrading to free is Manage→cancel (D4).
6. No webhook change — `handleSubscriptionEvent` already reconciles the tier from the `updated` event.

## Open questions

1. **Does the env's Stripe billing-portal *configuration* allow subscription updates for these products?** `flow_data.subscription_update_confirm` requires the portal configuration to have "switch plans" enabled and the tier products/prices in its allow-list; otherwise Stripe rejects the flow. **Lean: treat it as a per-env Stripe-config prerequisite** (like the #239 sandbox wiring) — enable subscription updates + list the products in the portal configuration; the spec names it as a setup step and the smoke verifies it in app-dev's sandbox.
2. **Proration policy.** `subscription_update_confirm` uses the portal configuration's proration behavior. **Lean: use Stripe's portal-configured default proration in v1** — don't override per-call; revisit only if product wants a specific proration.
3. **Keep the separate "Manage" button, or fold plan-switch into it?** **Lean: keep both** — Manage owns payment method / invoices / cancellation (and the free downgrade); Switch owns plan change. Distinct affordances, distinct flows.

## Enterprise-scale considerations

- **Concurrency & correctness** — the switch is Stripe-hosted; reconciliation is the existing webhook, idempotent via `stripeEvents.insertIfNew`. No new check-then-act in our code. **Lean: safe; Stripe + webhook own atomicity.**
- **Accuracy & auditability** — Stripe is the record of truth for the subscription; the tier update + `stripeEvents` row give the audit trail. **Lean: covered by the existing billing-event log.**
- **Failure modes** — portal-session creation failure (Stripe down) → 502/503 surfaced via `FormAlert`, **fail-closed** (no local mutation); tier reflects after webhook delivery (eventual). **Lean: fail-closed + eventual reconciliation, acceptable — never a silent local tier write (that's exactly what #259 guards).**
- **Scale & unbounded growth** — per-org, low-frequency, one portal session per click. **N/A because there's no fan-out.**
- **Multi-tenancy** — owner-gated (403) + org-scoped tier resolution (`findSelectableForOrg`/`findBySlug` on the caller's org); a switch can only target a tier visible+selectable to that org. **Lean: reuse the owner gate + org-scoped resolution; a target the org can't see is a 404.**
- **Contract stability** — `/portal` gains an *optional* `tier`; bodyless Manage is unchanged. **Lean: additive/optional — no re-plumbing of existing callers.**
- **Data lifecycle** — no new persistence; Stripe owns the subscription, the webhook owns the tier write. **N/A because nothing new is stored.**

## What this doesn't decide

- A bespoke `POST /api/billing/change-plan` (direct subscription mutation, no redirect) — deferred (D1 B) unless the portal flow proves insufficient; more payment surface.
- Custom-plan self-service — stays sales-gated by design (#241 rule).
- The Stripe portal **configuration** content itself (which products/proration) — an env setup step, not app code (Open Q1).
- A dedicated in-app cancel/downgrade-to-free flow — Manage→cancel covers it in v1 (D4).

## Next step

`docs/IN_APP_PLAN_CHANGE.spec.md` (contract: the extended `createPortalSession` `flow_data`, `createPortal(tierSlug?)` + its guards, `BillingPortalRequestSchema`, the `/portal` `@openapi`, and the subscribed-state render + "Switch" handler) then `docs/IN_APP_PLAN_CHANGE.plan.md`. Rough slices: (1) backend — portal `flow_data` + `createPortal(tierSlug?)` + contract + route; (2) frontend — subscribed-state grid + "Switch to this plan" + SDK `portal({tier})`; (3) the Stripe portal-config prerequisite documented + smoke-verified. Each slice green-testable; the webhook needs none.
