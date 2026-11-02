# Rename during the first checkout — Condensed design (#938)

**Issue:** [EnterpriseBT/portal-ai#938](https://github.com/EnterpriseBT/portal-ai/issues/938) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** An org's first checkout creates its Stripe customer with the name it read at the start of the request, then stores `stripe_customer_id`. A rename (#907) that commits in between syncs nothing, because its post-commit sync finds no customer id yet. The customer keeps the old name on every invoice, and nothing is logged. Fix it in the checkout, where the window is. API only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Lazy customer creation | `apps/api/src/services/billing.service.ts:263-276` (`createCheckout`) | `createCustomer({ name: org.name })`, then `organizations.update(org.id, { stripeCustomerId })`, no transaction |
| Rename write | `apps/api/src/services/organization-update.service.ts` (`apply`) | `findByIdForUpdate` + update in one transaction |
| Rename's Stripe sync | same file, `syncStripeCustomerName` | post-commit; re-reads the org, returns early without `stripeCustomerId`; best effort, warns "reconcile manually" |
| `StripeService.updateCustomerName` | `apps/api/src/services/stripe.service.ts:107` | `customers.update(id, { name })` |

## Decision — reconcile from the stored row after writing the customer id

- **A. Lock the org row around customer creation.** Correct, but it holds a row lock (and a connection from the 10-connection pool) across a Stripe HTTP call, and blocks renames and default-station writes for its duration. Rejected.
- **B. After storing the id, compare the stored name with the name sent to Stripe; if they differ, run the rename's own sync.** Chosen.

Why B closes the window: `organizations.update` is an `UPDATE … RETURNING`. Under read committed it waits for a rename holding the row lock and returns the row as committed. So for the checkout write S and a rename commit C:
- **C before S:** the returned name is the new one. It differs from the name sent, so checkout syncs it.
- **C after S:** the rename's sync runs after C, sees `stripe_customer_id`, and syncs it.

There's no third ordering, so no extra read is needed. The sync is `OrganizationUpdateService.syncStripeCustomerName(org.id)`, reused as is. It re-reads and sends the current name, never throws, and logs the same warning on failure, so a Stripe error can't fail the checkout.

## Plan — one slice

**Files**
- Edit: `apps/api/src/services/billing.service.ts`. Keep the name sent to `createCustomer`, read `name` from the row `organizations.update` returns, and when they differ `await OrganizationUpdateService.syncStripeCustomerName(org.id)` before minting the session. Add a comment on why the returned row is fresh.

**Tests**
- `apps/api/src/__tests__/services/billing.service.endpoints.test.ts` (`npm run test:unit`):
  - the returned row carries a different name → the sync runs with the org id;
  - same name → no sync;
  - an existing customer → no update and no sync.
- `apps/api/src/__tests__/__integration__/routes/billing.router.integration.test.ts` (`npm run test:integration`): deterministic, same pattern as the #907 station-delete test. A second connection locks the org row and renames it, uncommitted. `POST /api/billing/checkout` starts, is still pending after 500ms, then the rename commits. Expect the checkout to return 200, `createCustomer` to have been called with the old name, and `updateCustomerName(cus, "<new name>")`. Stripe calls are spied, as the suite already does.
- `npm run lint`, `npm run type-check`.

## Smoke (manual, against your dev stack)

1. **Customer gets the new name** (Stripe test mode, an org with no `stripe_customer_id`):
   - from `psql`, run `begin; select id from organizations where id='<org>' for update; update organizations set name='Renamed Mid Checkout' where id='<org>';` and leave the transaction open;
   - click a plan in Settings → Subscription & Billing (the checkout request hangs);
   - `commit;`.

   Checkout opens. `stripe customers retrieve <cus>` shows the name `Renamed Mid Checkout`.
2. **No rename, no extra call:** a first checkout on another fresh org with no concurrent rename. The customer has the org's name, and the API log shows no extra Stripe call or warning.
3. **Existing customer:** checkout for an org that already has a customer and no subscription works as before.

## Out of scope

- Duplicate subscriptions when the webhook is late (#939).
- Backfilling customers already left with a stale name (reconcile manually in Stripe; none are known).
