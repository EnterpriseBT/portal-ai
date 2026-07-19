# Stripe webhook foreign-subscription guard — Condensed design (#230)

**Issue:** [EnterpriseBT/portal-ai#230](https://github.com/EnterpriseBT/portal-ai/issues/230) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `BillingService.handleSubscriptionEvent` resolves the org by **Stripe customer id** and then applies whatever subscription the event carries. When a customer holds two subscriptions (double-checkout before the first webhook lands), a terminal event for the *orphan* subscription clears the org's tracked `stripe_subscription_id` + `billing_anchor_day` and reverts the tier — a paying org silently downgraded by the cancellation of a stray subscription. The org tracks exactly one subscription; only events for *that* one may move its billing state. Single package (`apps/api`) + one enum value in `@portalai/core`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Webhook handler | `apps/api/src/services/billing.service.ts:116` | `handleSubscriptionEvent` — converge-reads the sub, resolves org |
| Org resolution (by customer) | `billing.service.ts:127` | `findByStripeCustomerId(customerId)` — **not** by subscription id |
| The clobber | `billing.service.ts:160-191` | `nextSubscriptionId`/`changed` computed from the *event's* sub; org UPDATE clears tracked state for a terminal orphan |
| Checkout "already subscribed" guard | `billing.service.ts:276` | blocks re-checkout once `org.stripeSubscriptionId` is set — but null during the first-webhook race |
| `eventRow` outcome union | `billing.service.ts:405` | `"applied" \| "noop" \| "unmatched" \| "ignored"` |
| Outcome enum + CHECK (drizzle) | `apps/api/src/db/schema/stripe-events.table.ts:33,41` | `text` col, drizzle enum + DB `CHECK … IN (…)` |
| Outcome enum (core, dual-schema) | `packages/core/src/models/stripe-event.model.ts:22` | `StripeEventOutcomeSchema` (`type-checks.ts` asserts parity) |
| Route caller | `apps/api/src/routes/webhook.router.ts:269` | logs the outcome, always returns 200 — no exhaustive switch |

## Decision — foreign-subscription guard, recorded as a distinct outcome

In `handleSubscriptionEvent`, after the org is resolved and before deriving tier: if the org **already tracks a subscription** and the event's subscription id **differs** (`org.stripeSubscriptionId && org.stripeSubscriptionId !== sub.id`), do **not** mutate org state. Record the event (dedup, mirroring the `unmatched` branch at `:137`) with `outcome: "foreign"`, log a warning, and return `"foreign"`. When no subscription is tracked (`null`), behaviour is unchanged — the initial subscribe still adopts, and a cancel of the tracked sub still clears.

This is safe against the only legitimate id transitions the app produces: `null → id` (adopt) and `id → null` (cancel). A direct `id_A → id_B` swap in one event is never legitimate — portal plan changes update the *same* subscription in place, and a resubscribe can only be checked out after the tracked sub is already cleared (guard at `:276`). So "same customer, different subscription" always means an orphan.

**Distinct `"foreign"` outcome** (vs. reusing `"noop"`/`"ignored"`): billing is auditable — a distinct value lets us count/inspect double-checkout orphans in `stripe_events` (`organizationId` set, `resultingTier` null). Standard dual-schema enum add; no production data at risk.

## Decision — do NOT add a checkout-time Stripe query

The ticket floats blocking checkout when the customer already has a live subscription. Rejected: at checkout-**session-creation** time neither session has completed, so no subscription is active yet — a Stripe list-subscriptions query wouldn't see the race. The existing `:276` guard already blocks re-checkout once state is set. Truly closing the create-time race needs a pending-checkout lock — out of scope (below).

## Plan — 1 slice

**Files**
- Edit `packages/core/src/models/stripe-event.model.ts` — add `"foreign"` to `StripeEventOutcomeSchema`.
- Edit `apps/api/src/db/schema/stripe-events.table.ts` — add `"foreign"` to the drizzle `enum` and the `CHECK` sql.
- Migration — `npm run db:generate -- --name stripe_events_outcome_foreign`, then `npm run db:migrate`.
- Edit `apps/api/src/services/billing.service.ts` — the guard (early return with the `foreign` event row) + widen the `eventRow` outcome union and `handleSubscriptionEvent`'s return type to include `"foreign"`.

**Tests** (npm scripts only — `npm run test:unit`, `npm run test:integration`)
- `apps/api/src/__tests__/services/billing.service.handler.test.ts` — new cases: (a) tracked `sub_A`, terminal event for `sub_B` → org row **unchanged**, outcome `"foreign"`; (b) tracked `sub_A`, active event for `sub_B` → unchanged, `"foreign"`; (c) tracked `null` + active `sub_B` → still adopts; (d) tracked `sub_A`, terminal for `sub_A` → still clears.
- `apps/api/src/__tests__/__integration__/routes/stripe-webhook.integration.test.ts` (or `stripe-events.repository.integration.test.ts`) — a `"foreign"` row persists under the CHECK constraint.

## Smoke (manual, against your dev stack)

1. With Stripe test mode + a customer that has **two** active subscriptions (`sub_A` tracked in `organizations.stripe_subscription_id`, `sub_B` orphan — reproduce via two Subscribe tabs, or create the second in the Dashboard), confirm the org row tracks `sub_A` and its paid tier.
2. Cancel the **orphan** `sub_B` (Dashboard/CLI). → Webhook fires; the org row's `stripe_subscription_id`, `billing_anchor_day`, and `tier` are **unchanged**; a `stripe_events` row records `outcome = 'foreign'` for that event.
3. Cancel the **tracked** `sub_A`. → org reverts to `standard`, `stripe_subscription_id` cleared (outcome `applied`) — the real cancellation still works.
4. Fresh org, first-ever Subscribe → tier applied as before (no regression when nothing is tracked).

## Out of scope

- **Preventing** double-checkout (a pending-checkout lock / idempotency on session creation) — bigger; this ticket stops the *state corruption*, not the double charge.
- **Cleaning up / refunding** the orphan subscription — manual ops for now.
- Reconciling against Stripe's full subscription list on every event — unnecessary given the app's `null↔id`-only transitions.
