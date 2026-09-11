# Extract `TierGrantSource` seam from the Stripe webhook — Condensed design (#565)

**Issue:** [EnterpriseBT/portal-ai#565](https://github.com/EnterpriseBT/portal-ai/issues/565) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic [#569](https://github.com/EnterpriseBT/portal-ai/issues/569) — branches off `epic/enterprise-deployment`.

**Why.** `organizations.tier` is the single runtime entitlement source (read by `TierService.resolveTier` → cost-gate / entitlement / agent-turn ceiling, with zero commerce dependency), but it's written from a commercial event in exactly one place — the Stripe subscription webhook. To sell installs through cloud marketplaces, a marketplace entitlement must set the same column. This lifts the write path into a reusable seam so Stripe becomes *one* grant source, **with no behavior change**. Single package (`apps/api`), pure internal refactor, no schema change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `handleSubscriptionEvent` | `billing.service.ts:133–249` | The whole flow: converge-fetch sub → org by customer → #230 foreign guard → `deriveTierFromSubscription` → `changed` → **D2 transaction** (dedup `insertIfNew` + `organizations.update`). Returns `applied \| noop \| unmatched \| duplicate \| foreign`. |
| Pure tier derivation | `billing.service.ts:87` `deriveTierFromSubscription` | Untouched — status/priceId/anchor → `{ tier, subscriptionLive, anchorDay }`. |
| Dedup event row | `billing.service.ts:527` `eventRow` | Builds a `stripe_events` row via `StripeEventModelFactory`; `outcome ∈ {applied,noop,unmatched,ignored,foreign}`. |
| Dedup store | `stripeEvents.insertIfNew(row, tx?)` | Insert-if-new keyed by Stripe `event.id`; one row per redelivered event → `duplicate`. |
| #230 foreign guard | `billing.service.ts:168–192` | Once an org tracks a subscription, only that sub may move its billing state. |
| Caller | `webhook.router.ts:273` | `handleSubscriptionEvent(event)` vs `recordIgnoredEvent(event)` on event type. |
| Behavior pin | `billing.service.handler.test.ts`, `billing.service.test.ts`, `stripe-webhook-events.test.ts` (+ integration) | The "no observable change" guarantee. |

## Decision — a source that `resolve`s, an `apply` that transacts

New `apps/api/src/services/tier-grant.service.ts`:

- **`TierGrantSource<E>` interface**
  - `idempotencyKey(e: E): string` — the dedup identity (Stripe `event.id` today).
  - `resolve(e: E): Promise<GrantResolution>` where `GrantResolution` is a tagged union:
    - `{ outcome: "unmatched", eventRow }`
    - `{ outcome: "foreign", eventRow }`
    - `{ outcome: "grant", organizationId, changed, orgUpdate, eventRow }` — `orgUpdate` is the column-generic partial write (`{ tier, stripeSubscriptionId, billingAnchorDay, updated, updatedBy }` today), and `changed` is computed against the current org row inside `resolve`.
- **`TierGrantService.apply(source, event)`** — the lifted, source-agnostic outcome dispatch:
  - `unmatched` / `foreign` → `insertIfNew(eventRow)` (no tx) → `inserted ? outcome : "duplicate"`.
  - `grant` → the **D2 transaction** unchanged: `insertIfNew(eventRow, tx)`; `!inserted → duplicate`; `!changed → noop`; else `organizations.update(organizationId, orgUpdate, tx)` → `applied`.
- **`StripeGrantSource implements TierGrantSource<Stripe.Event>`** (co-located) — moves the Stripe-specific body of `handleSubscriptionEvent` into `resolve`: converge-fetch, org lookup, #230 guard, `deriveTierFromSubscription` (called, **not** changed), `changed`, and building the `orgUpdate` + `eventRow`s. `deriveTierFromSubscription` and `eventRow` stay in `billing.service.ts` and are reused (`eventRow` becomes accessible to the source).

**Clean cut (no compat alias).** `handleSubscriptionEvent` is **removed**; `webhook.router.ts` calls `TierGrantService.apply(new StripeGrantSource(), event)`. The handler tests are re-pointed to call `apply(new StripeGrantSource(), event)` — assertions are unchanged because behavior is identical.

**Dedup store stays `stripe_events`.** `apply` calls `stripeEvents.insertIfNew` directly for now — the source builds the row. Generalizing the store to `commercial_events` is explicitly the AWS-Marketplace child's job (#568), not this one; abstracting it now would be speculative. `apply` is generic over the **org column write**, which is the seam this ticket needs.

## Plan — 1 slice

**Files:**
- `apps/api/src/services/tier-grant.service.ts` (new) — `TierGrantSource` interface, `GrantResolution` union, `TierGrantService.apply`, `StripeGrantSource`.
- `apps/api/src/services/billing.service.ts` (edit) — remove `handleSubscriptionEvent`; expose `deriveTierFromSubscription` + `eventRow` to the source (unchanged logic).
- `apps/api/src/routes/webhook.router.ts` (edit) — call `TierGrantService.apply(new StripeGrantSource(), event)`.

**Tests** (`npm run test:unit`):
- `billing.service.handler.test.ts` re-pointed to `apply(new StripeGrantSource(), …)` — every existing case (applied/noop/unmatched/duplicate/foreign, redelivery, #230) unchanged.
- New `tier-grant.service.test.ts` — a **fake** `TierGrantSource` proving `apply` is source-agnostic: a `grant` with `changed` writes `organizations.update` + returns `applied`; `!changed` → `noop`; redelivery (`insertIfNew` returns false) → `duplicate`; `unmatched`/`foreign` recorded without an org write. This is the "second source could write `org.tier`" acceptance, tested directly.

## Smoke (manual, against your dev stack — local Stripe)

With the dev stack + `stripe listen --forward-to localhost:3001/api/webhooks/stripe` (see the local-Stripe notes):

1. **Subscribe** to a paid tier via checkout → the webhook fires; `organizations.tier` moves to the new tier (unchanged from today).
2. **Upgrade / downgrade / cancel** → tier converges each time; `stripe_events` gets exactly one row per event.
3. **Redeliver** an event from the Stripe CLI/dashboard → returns `duplicate`, no second row, tier unchanged.
4. **Foreign sub** (#230): with an org already tracking a subscription, an event for a *different* sub id is recorded `foreign` and does not move the tier.
5. Existing billing unit + integration suites are green (`npm run test:unit`, the billing integration test) — the primary "no behavior change" evidence.

## Out of scope

- Any marketplace adapter — the AWS Marketplace child (#568) adds the second `TierGrantSource`.
- Generalizing `stripe_events` → `commercial_events` and any new org columns — they land with that first non-Stripe source.
- Touching `deriveTierFromSubscription`, `TierService.resolveTier`, or any downstream entitlement code — the write seam only.
