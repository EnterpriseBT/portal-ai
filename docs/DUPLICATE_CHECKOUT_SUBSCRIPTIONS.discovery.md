# Duplicate checkout subscriptions — Discovery

**Issue:** [EnterpriseBT/portal-ai#939](https://github.com/EnterpriseBT/portal-ai/issues/939)

**Why this exists.** An owner who pays for a plan while the subscription webhook is delayed comes back to Settings, still sees the old plan, and checks out again. Every retry creates another active subscription on the same Stripe customer: six were observed locally on 2026-11-01. Each one bills every period until someone notices. The trigger is ordinary: Stripe retries a failing webhook for up to 3 days, and the UI invites the retry.

The root cause is that every piece of billing state the app trusts is written by that same webhook. Checkout guards on `organizations.stripe_subscription_id`. The plan card renders from it. The webhook converges one subscription at a time, so once a duplicate exists, nothing reconciles the customer as a whole. #938's review added a sibling gap: two first checkouts in flight each create a Stripe customer, and one is orphaned. This is the change that makes checkout and plan state read **Stripe's current state for the customer**, instead of waiting for an event that may not arrive.

## The current shape

### Checkout

| Piece | Location | Note |
|---|---|---|
| Guard ladder | `apps/api/src/services/billing.service.ts:211-325` (`createCheckout`) | configured → `billing.manage` → **`org.stripeSubscriptionId` → 409 `BILLING_ALREADY_SUBSCRIBED`** (`:227`) → managed tier → target tier → price |
| Lazy customer creation | `billing.service.ts:267-305` | check-then-act: `createCustomer`, then an unconditional `organizations.update` (no `stripe_customer_id IS NULL` predicate); the #938 name sync follows |
| Catch-all | `billing.service.ts:314-324` | every throw inside the `try` becomes `502 BILLING_CHECKOUT_FAILED`, so a new 409 must sit outside it or pass `ApiError` through |
| Session creation | `apps/api/src/services/stripe.service.ts:116-147` | `mode: "subscription"`, session `metadata.organizationId`; no `subscription_data`, no `client_reference_id`, no idempotency key |
| Stripe surface | `stripe.service.ts` | `fetchSubscription`, `createCustomer`, `createCheckoutSession`, `createPortalSession`, `cancelSubscription`, `getPrice`, …; **no** `subscriptions.list`, `checkout.sessions.list` or `.expire` |
| Error codes | `apps/api/src/constants/api-codes.constants.ts:141-159` | `BILLING_ALREADY_SUBSCRIBED` already exists |

### Webhook convergence

| Piece | Location | Note |
|---|---|---|
| Router | `apps/api/src/routes/webhook.router.ts:34-38, 102-162` | `customer.subscription.{created,updated,deleted}` → `TierGrantService.apply(new StripeGrantSource(), event)`; others (incl. `checkout.session.completed`) recorded as ignored |
| Resolve | `apps/api/src/services/tier-grant.service.ts:135-231` | re-fetches **the event's** subscription, finds the org by customer id, derives tier from `deriveTierFromSubscription` (`billing.service.ts:91-124`) |
| Foreign guard (#230) | `tier-grant.service.ts:166-193` | an org tracking subscription X records events for Y as `foreign` and skips them |
| Dedupe | `apps/api/src/db/repositories/commercial-events.repository.ts:32-45` | `insertIfNew` on (source, external_id), same transaction as the org write |

The #230 guard stops a duplicate from clobbering the tracked subscription, but nothing ever adopts it. Cancel the tracked subscription while a duplicate is live, and the org drops to `standard` and clears its id while the customer still pays. The duplicate's events were all recorded `foreign`, so they're never replayed.

### Other readers of the tracked subscription

- `apps/api/src/services/organization-delete.service.ts:87, 321-335`: an org delete cancels **only** the tracked subscription, so a duplicate keeps billing a deleted org.
- `packages/admin-cli/src/commands/org.ts:55-59`: `org set-tier` refuses while a subscription id is set unless `--allow-stripe-desync` is passed.
- `apps/api/src/services/tier.service.ts:111` reads `billingAnchorDay`. No billing reconciler exists; the startup reconcilers cover jobs and wide tables only.

### Web

| Piece | Location | Note |
|---|---|---|
| Return handling | `apps/web/src/views/Settings.view.tsx:80-105` | `?billing=success` invalidates `organizations.root` once and toasts "plan updates within a few seconds", then strips the param; no processing state |
| Plan state | `apps/web/src/components/SubscriptionBilling.component.tsx:219-307` | `subscribed = organization.stripeSubscriptionId != null` (`:263`) |
| Buttons | `TierCard.component.tsx:197-212` | Subscribe stays enabled after a paid-but-unconverged checkout |
| SDK | `apps/web/src/api/billing.api.ts` | `tiers`, `checkout`, `portal` |

### Tests to extend

- Unit: `billing.service.endpoints.test.ts` (guards `:189`), `billing.service.handler.test.ts` (foreign cases `:205-270`), `tier-grant.service.test.ts`, `stripe.service.test.ts`.
- Integration: `billing.router.integration.test.ts` (the #938 held-lock race at `:304` is the model for the concurrency tests), `stripe-webhook.integration.test.ts` (real signatures, `fetchSubscription` spy; no multi-subscription case today).
- Web: `SettingsBilling.test.tsx` (`:152`), `SubscriptionBilling.component.test.tsx`.

## The design space

### Decision 1 — What checkout trusts before minting a session

- **A. Ask Stripe.** When the org has a customer, list its subscriptions and refuse with `409 BILLING_ALREADY_SUBSCRIBED` if any is live (`active`, `trialing`, `past_due`, `incomplete`). This is one read-only `subscriptions.list` call.
- **B. Trust the session-completed event.** Handle `checkout.session.completed` and write the subscription id from it. The same delivery path can be delayed, so this doesn't close the gap.
- **C. Pending marker in the DB.** Store "checkout paid" from the success redirect. It's driven by the client and is easy to skip.

| | A | B | C |
|---|---|---|---|
| Works with the webhook down | yes | no | partly |
| Source of truth | Stripe | the event | the browser |
| Cost | 1 Stripe read per checkout | new event type, runbook change | schema + trust problem |

**Lean: A.** Checkout is rare, and one read buys correctness regardless of webhook health. The refusal is thrown before the `try`, or passed through the catch-all, so it stays a 409.

### Decision 2 — Two checkouts open at once (two tabs, double click across reloads)

D1 can't see a session that hasn't been paid yet. Two open sessions can both be paid.

- **A. Expire the others.** Before creating a session, list the customer's `open` Checkout sessions and expire them. The newest tab wins; paying in an older tab fails at Stripe with "session expired".
- **B. Reuse.** Store the open session id on the org and return its URL while it's open. That needs a column and its lifecycle, and the reused session may be for a different plan.
- **C. Nothing.** Rely on D3 to converge and leave the duplicate billing.

**Lean: A**, run under a **per-org lock held for the whole checkout**: a transaction-scoped advisory lock keyed on the org id, not the org row lock, so renames and default-station writes aren't blocked. Without the lock, two concurrent checkouts each list, each find nothing, and each create a session. The cost is one pooled connection held across 3–4 Stripe calls (~1–2 s), for an action an org takes a handful of times a year.

### Decision 3 — How the org's plan converges when a customer has several subscriptions

- **A. Today: per subscription, plus the #230 foreign guard.** It's safe against clobbering, but never adopts a duplicate.
- **B. Per customer.** Every convergence lists the customer's subscriptions and picks a **governing** one: the tracked subscription if it's still live, otherwise the most recently created live one. Tier, id and anchor come from it, and with none live the org reverts to `standard`. The event only says *when* to converge, never *what*.
- **C. B, plus cancelling the others automatically.**

| | A | B | C |
|---|---|---|---|
| Duplicate keeps paying after the tracked one is cancelled | yes, and the org drops to standard | org follows the live one | cancelled |
| Moves money on its own | no | no | yes (proration, refunds) |
| Ordering-safe | via re-fetch | via re-list | via re-list |

**Lean: B.** It's the issue's "converge from the customer's current subscriptions" rule, and it replaces the foreign guard with something strictly stronger. Auto-cancelling (C) is a money decision. Instead, B **flags** a customer with more than one live subscription: a `warn` log and the commercial event's outcome. Support then cancels and refunds the extra one in the Stripe dashboard. See Open question 1.

### Decision 4 — Who triggers convergence besides the webhook

- **A. Only the webhook (today).** The user waits up to 3 days in the worst case.
- **B. Checkout return.** `success_url` already lands on `?billing=success`. The web calls a new `POST /api/billing/sync`, which runs D3's convergence for the caller's org and returns the organization.
- **C. B, plus polling** `organizations.current` until the plan changes.

**Lean: B.** One server-side convergence makes the success page right without depending on webhook health, and D1 already blocks a second purchase whatever the UI shows. If the sync finds no live subscription yet (an async payment method, a 3DS delay), the billing tab shows an info `Alert`, "Your payment is being processed — this page updates when it completes", and the Subscribe buttons get a `disable` gate with that reason until a later load converges. No polling (CLAUDE.md: polling isn't a toast surface, and this needs none). The route is gated by `billing.manage` like checkout and portal, and goes in the route map with `locks: none`.

### Decision 5 — Two first checkouts each creating a customer (#938)

- **A. The D2 lock covers it.** Customer creation runs inside the per-org checkout lock, so the second checkout sees the stored id.
- **B. Conditional write.** `UPDATE … SET stripe_customer_id = $1 WHERE id = $2 AND stripe_customer_id IS NULL RETURNING`; the loser deletes its customer and uses the winner's.

**Lean: A plus B's conditional write.** The lock removes the race. The predicate costs nothing and keeps a future writer that skips the lock from silently orphaning a customer; a lost conditional write then deletes its own customer best effort.

## Tradeoff comparison

|  | D1 ask Stripe | D2 expire + per-org lock | D3 per-customer converge | D4 sync on return | D5 lock + conditional |
|---|---|---|---|---|---|
| Spread to spec | Yes (guard order, statuses) | Yes (lock key, expire semantics) | Yes (governing rule, outcomes) | Yes (route contract, web states) | Yes |
| New Stripe calls | `subscriptions.list` | `checkout.sessions.list`, `.expire` | `subscriptions.list` | — | `customers.del` (loser only) |
| Schema change | no | no | no | no | no |

## Recommendation

1. Checkout takes a per-org advisory lock for its whole duration and, inside it, refuses with `409 BILLING_ALREADY_SUBSCRIBED` when the DB tracks a subscription **or** Stripe lists a live one (`active`, `trialing`, `past_due`, `incomplete`) for the customer. An `ApiError` passes through the catch-all unchanged.
2. Inside the same lock, checkout expires the customer's other `open` Checkout sessions before creating its own.
3. Lazy customer creation stores the id with a conditional `WHERE stripe_customer_id IS NULL` write and deletes its customer, best effort, if it loses.
4. `BillingService.convergeCustomer(org)` lists the customer's subscriptions, picks the governing one (the tracked one if live, else the newest live), and writes tier, subscription id and anchor under the org row lock. With nothing live it reverts to `standard`. More than one live subscription logs a `warn` and is recorded on the event.
5. The webhook's `StripeGrantSource.resolve` uses that convergence in place of the per-subscription derive and the #230 foreign guard. Event dedupe stays as it is.
6. `POST /api/billing/sync` (`billing.manage`, route-mapped, `@openapi`) runs the same convergence and returns the organization. The web calls it on `?billing=success`, then renders the result. If the plan didn't change, it shows a processing `Alert` and a disable gate on Subscribe.
7. Org delete cancels **every** live subscription on the customer, not just the tracked one.

## Open questions

1. **Should a duplicate subscription be cancelled automatically?** It's money moving without a person; the remaining question is whether support will notice a `warn`. Lean: no auto-cancel; record it as outcome `duplicate` on the commercial event and log it, and leave the cancel and refund to a person.
2. **How does a pull convergence (D4) show up in the `commercial_events` ledger,** given it has no Stripe event id to dedupe on? Lean: record a row only when it changes the org, with `external_id = sync:<subscription id>:<status>`, so a repeat sync for the same state is a no-op through the existing `insertIfNew`.
3. **Does `incomplete` block a new checkout?** Such a subscription expires in 23 hours if unpaid, and blocking would strand a user whose first card failed. Lean: block while `incomplete`, with a message pointing to the billing portal to finish paying; it's live billing intent, and the portal can complete or cancel it.
4. **Expiring an older open session while the user is mid-payment in that tab.** Lean: accept. The newest tab wins, Stripe shows "expired" in the old one, and that's preferable to two charges.

## Enterprise-scale considerations

- **Concurrency & correctness:** the core of the ticket. Lean: a per-org advisory lock serialises checkout (list → expire → create); convergence writes under the org row lock and is idempotent, because it reads current Stripe state. The residual window: a session already completing at Stripe when another tab's checkout tries to expire it (a completed session can't be expired), whose subscription hasn't been created yet when D1 lists. If the user then pays the new session too, D3 converges on the newest and flags the duplicate. The window is seconds wide and needs two tabs, and nothing in Stripe Checkout closes it further.
- **Accuracy & auditability:** tier changes stay in `commercial_events`, the ledger. Lean: pull convergences are recorded too (Open question 2), and duplicates get an outcome a report can find.
- **Failure modes:** Lean: **fail closed on checkout**. If Stripe's list call fails, checkout fails with the existing 502 rather than risking a duplicate charge. Sync fails soft: the page shows the processing state and the webhook still converges later.
- **Scale & unbounded growth:** `subscriptions.list` per customer is bounded (default page of 10, `status: all` capped with `limit: 100`). Lean: one page is enough; a customer with more than 100 subscriptions is itself the anomaly to log.
- **Multi-tenancy:** every path resolves the org from the caller (`getApplicationMetadata`) and the customer from the org; the lock key is the org id. Lean: no cross-tenant input.
- **Contract stability:** `BILLING_ALREADY_SUBSCRIBED` is unchanged; `POST /api/billing/sync` is additive. Lean: the governing-subscription rule lives in one function, so a future multi-product or seat-based billing model changes one place.
- **Data lifecycle:** N/A because no new stored state is introduced; Stripe stays the record of subscription state.

## What this doesn't decide

- **Refunding the duplicates already created** (the six on `cus_VYDXXG1wyGm6TM` were cancelled by hand). That's support work in the Stripe dashboard, not code.
- **A billing reconciliation sweep** over every org. D4 and the webhook cover the paths a user takes; a sweep has no concrete caller yet.
- **Handling `checkout.session.completed`.** D1 + D4 make it unnecessary, and adding it would change the runbook's event list (`docs/PROD_STRIPE_LIVE.runbook.md:100-102`) for no gain.
- **Marketplace entitlements.** That rail has its own foreign guard and no checkout.

## Next step

`/spec 939` pins the contract: the checkout guard order and statuses, the lock key, the governing-subscription rule and its outcomes, the `POST /api/billing/sync` request and response, and the web states. `/plan 939` slices it in roughly four commits: (1) `StripeService` list/expire methods and `convergeCustomer` with the webhook switched over; (2) the checkout lock, live-subscription guard, session expiry and conditional customer write; (3) the sync route plus org-delete cancelling every live subscription; (4) the web return flow and processing state, with the doc sync (billing FAQ, `STRIPE_CLI_OPS.md`).
