# Duplicate checkout subscriptions — Spec

Pins the contract for [#939](https://github.com/EnterpriseBT/portal-ai/issues/939): checkout reads Stripe's current subscriptions and serialises per org, the org's plan converges from the customer's live subscriptions (webhook and a new sync route), and the checkout return page stops depending on the webhook. Design: `docs/DUPLICATE_CHECKOUT_SUBSCRIPTIONS.discovery.md`.

## Key decisions (flag for review)

1. **Checkout fails closed on Stripe.** If listing the customer's subscriptions or open sessions fails, checkout answers the existing `502 BILLING_CHECKOUT_FAILED` and mints no session.
2. **Blocking statuses** for a new checkout: `active`, `trialing`, `past_due`, `incomplete`, `unpaid`, `paused` (anything not `canceled` or `incomplete_expired`). **Governing statuses** for the plan: `active`, `trialing`, `past_due`. `incomplete` blocks checkout but grants nothing; the user finishes or cancels it in the portal.
3. **Governing subscription** = the tracked one if its status is governing, else the governing one with the newest `created`. None governing → derive from the tracked subscription (or the event's), which reverts to `standard` on a terminal status exactly as today.
4. **Duplicates are flagged, never cancelled.** More than one governing subscription → a `warn` log and the commercial event's outcome becomes `duplicate_subscription` (new value; migration below). Discovery called it `duplicate`; renamed because `TierGrantOutcome` already uses `duplicate` for a redelivered event.
5. **Pull convergence is recorded only when it changes the org,** as `external_id = sync:<uuid>` rather than discovery's `sync:<sub>:<status>`. The write happens under the org row lock, so "changed" is decided once and there's nothing to dedupe; a state-derived id would wrongly dedupe a plan that flips back.
6. **One connection, one transaction, commit on failure.** The per-org checkout lock is `pg_advisory_xact_lock` in a transaction that also writes the customer id. A Stripe failure *after* that write is returned from the transaction callback, not thrown, so the id still commits and a retry never re-creates the customer (the existing D7 rule).

## Scope

### In scope
- `StripeService`: list subscriptions, list and expire open Checkout sessions, delete a customer.
- `BillingService.createCheckout`: lock, re-read, Stripe guard, session expiry, conditional customer write.
- Per-customer convergence shared by the webhook and `POST /api/billing/sync`; the #230 foreign guard is replaced.
- `commercial_events.outcome` gains `duplicate_subscription`.
- Org delete cancels every blocking-status subscription on the customer.
- Web: the `?billing=success` return calls sync; a processing alert and disabled Subscribe while payment is pending.

### Out of scope
Refunds for existing duplicates; a reconciliation sweep; `checkout.session.completed`; the marketplace rail (unchanged, its source keeps its own guard).

## Surface

### `apps/api/src/services/stripe.service.ts`
```ts
/** Every subscription on the customer, newest first (`status: "all"`, `limit: 100`, one page). */
static async listSubscriptions(customerId: string): Promise<Stripe.Subscription[]>;
/** Ids of the customer's Checkout sessions with `status: "open"` (`limit: 100`). */
static async listOpenCheckoutSessions(customerId: string): Promise<string[]>;
/** `checkout.sessions.expire`; a session that completed meanwhile (Stripe 400) is swallowed and returns false. */
static async expireCheckoutSession(id: string): Promise<boolean>;
/** `customers.del`, for a lost conditional write. Throws; the caller logs. */
static async deleteCustomer(id: string): Promise<void>;
```
`resetForTests` unchanged. `createCheckoutSession` additionally sets `subscription_data.metadata.organizationId` so a subscription identifies its org in the dashboard (not read by code).

### `apps/api/src/services/billing.service.ts`
```ts
/** Statuses that refuse a new checkout (decision 2). */
export const BLOCKING_SUBSCRIPTION_STATUSES: ReadonlySet<Stripe.Subscription.Status>;
/** Statuses that can govern the org's plan. */
export const GOVERNING_SUBSCRIPTION_STATUSES: ReadonlySet<Stripe.Subscription.Status>;

/** PURE. Decision 3. `basis` is what deriveTierFromSubscription reads; `governingCount` > 1 flags a duplicate. */
static selectGoverningSubscription(
  subscriptions: Stripe.Subscription[],
  trackedId: string | null,
  fallback: Stripe.Subscription | null
): { basis: Stripe.Subscription | null; governingCount: number };

/** Converge the org from the customer's subscriptions; builds the resolution, writes nothing. */
static async resolveCustomer(
  org: OrganizationSelect,
  customerId: string,
  fallback: Stripe.Subscription | null,
  row: (fields: EventRowFields) => EventRow
): Promise<GrantResolution & { outcome: "grant" }>;

/** POST /api/billing/sync. 503 when unconfigured; billing.manage; no customer → { status: "none" } without a Stripe call. */
static async syncFromStripe(
  org: OrganizationSelect,
  caller: PermissionContext
): Promise<BillingSyncResponse>;

/** A pull-convergence ledger row: source "stripe", type "billing.sync", externalId `sync:${uuid}`. */
static syncRow(fields: EventRowFields): EventRow;
```
`eventRow`'s `outcome` union and `EventRowFields` gain `"duplicate_subscription"`. `deriveTierFromSubscription` is unchanged.

**`createCheckout` order** (steps 1–6 unchanged: configured, `billing.manage`, tracked id → 409, managed tier, tier lookup, price). Then one `DbService.transaction(tx => …)`:
1. `SELECT pg_advisory_xact_lock(BILLING_CHECKOUT_LOCK_NAMESPACE, hashtext(org.id))`.
2. Re-read the org in `tx`; a tracked subscription id → `409 BILLING_ALREADY_SUBSCRIBED`.
3. With a customer: `listSubscriptions`; any blocking status → `409 BILLING_ALREADY_SUBSCRIBED`, message "The organization already has a subscription in Stripe — manage it in the billing portal". Then expire every open session from `listOpenCheckoutSessions`.
4. Without one: `createCustomer`, then `organizations.updateWhere(and(eq(id), isNull(stripeCustomerId)), {…}, tx)`. No row → `deleteCustomer` (best effort, `warn` on failure) and use the stored id. A row → the #938 name check, unchanged.
5. `createCheckoutSession`. A Stripe error in steps 3–5 is returned as `{ failure }`, so the transaction commits; the caller then throws `502 BILLING_CHECKOUT_FAILED`. An `ApiError` (step 2–3's 409) is thrown and rolls back nothing that needs keeping.

`BILLING_CHECKOUT_LOCK_NAMESPACE = 0x4243_484b` ("BCHK") joins the namespaces in `apps/api/src/services/sync-lock.service.ts`.

### `apps/api/src/services/tier-grant.service.ts`
- `StripeGrantSource.resolve(event)`: keeps the converge re-fetch of the event's subscription (for its customer id, and as `fallback`), keeps `unmatched`, **removes the `foreign` branch**, and returns `BillingService.resolveCustomer(org, customerId, sub, f => BillingService.eventRow(event, f))`.
- `TierGrantService.apply` splits into `apply(source, event)` = `resolve` + `applyResolution(resolution)`. `applyResolution` is what `syncFromStripe` calls, after building its resolution under `findByIdForUpdate` in the same transaction. The `foreign` outcome stays in the type for the marketplace source.
- In `resolveCustomer`, `governingCount > 1` makes the event row's outcome `duplicate_subscription` (whatever `changed` is) and logs `warn` "Customer has more than one live Stripe subscription — cancel the extra one in Stripe" with `organizationId`, `customerId` and the governing ids.

### `POST /api/billing/sync` (`apps/api/src/routes/billing.router.ts`)
- No body (an empty `{}` is accepted; any key → `400 BILLING_INVALID_PAYLOAD` via a `.strict()` `BillingSyncRequestSchema`).
- `200` `{ payload: BillingSyncResponse }`. `503 BILLING_NOT_CONFIGURED`, `403 PERMISSION_DENIED`, `502 BILLING_SYNC_FAILED` (new `ApiCode`, message "Could not reach Stripe — your plan will update shortly").
- `@openapi` with `$ref`s to `BillingSyncRequest` / `BillingSyncResponse`, registered in `apps/api/src/config/swagger.config.ts`.
- Route map (`__tests__/config/route-authorization.map.ts`): `{ kind: "authorized", by: "BillingService billing.manage", locks: { none: "billing; no job reads or writes it" } }`.

### `packages/core/src/contracts/billing.contract.ts`
```ts
export const BillingSyncRequestSchema = z.object({}).strict();
export const BillingSyncResponseSchema = z.object({
  tier: z.string(),
  /** live: a governing subscription; pending: only incomplete/other blocking ones; none: nothing blocking. */
  subscription: z.enum(["live", "pending", "none"]),
});
```

### `commercial_events.outcome`
Drizzle enum, `CommercialEventOutcomeSchema` (core) and `commercial_events_outcome_check` gain `duplicate_subscription`.

### `apps/api/src/services/organization-delete.service.ts`
`cancelStripeSubscription(organizationId, stripeCustomerId, stripeSubscriptionId)`: with a customer, list its subscriptions and cancel each one in a blocking status; if listing fails, cancel the tracked id as today. Each failure logs the existing "reconcile manually" `warn`; nothing blocks the delete.

### Web (`apps/web`)
- `api/billing.api.ts`: `sync: () => useAuthMutation<BillingSyncResponse, void>({ url: "/api/billing/sync", method: "POST", body: () => ({}) })`, `onSuccess` invalidating `queryKeys.organizations.root`.
- `views/Settings.view.tsx`: on `?billing=success`, `await sync.mutateAsync()` (effect-mutation rule: no per-call options). `live` → `toast.success("Subscription confirmed")`. `pending` or `none` → set `paymentProcessing` (view state, not persisted). Error → `toast.error(serverErrorMessage(err, …))` and `paymentProcessing`. `cancelled` unchanged.
- `components/SubscriptionBilling.component.tsx`: `SubscriptionBillingUIProps.paymentProcessing: boolean`. When true, an `<Alert severity="info">` "Your payment is being processed — this page updates when it completes. Reload to check again." above the plan list, and each card's Subscribe gets `disable{reason: "Your payment is being processed"}`.
- `components/TierCard.component.tsx`: `TierCardUIProps.subscribeGate?: ActionGate`; the action renders through `GatedButton` (the raw `disabled={isPending}` becomes the gate's pending state).

## Migration
`npm run db:generate -- --name commercial-events-duplicate-subscription-outcome`. It drops and re-adds `commercial_events_outcome_check` with the wider list and carries `-- destructive-ok: widens a CHECK; no row can fail it`. Commit the `.sql`, `meta/_journal.json` and the snapshot together.

## Seed
None.

## TDD test plan
Run from each package: `npm run test:unit`, `npm run test:integration`.

### api unit
- `__tests__/services/stripe.service.test.ts`: list subscriptions and open sessions (params), expire swallowing an already-completed 400, delete. **5**
- `__tests__/services/billing.service.test.ts`: `selectGoverningSubscription`: tracked live wins; newest governing when tracked is gone; incomplete-only → none governing; nothing live → fallback; count of 2. **6**
- `__tests__/services/billing.service.endpoints.test.ts`: checkout refuses on a blocking subscription (409, not 502); allows on canceled-only; expires open sessions before creating; list failure → 502 and no session; lost conditional write deletes its customer and uses the stored id; session failure after a new customer still commits the id; sync statuses live/pending/none, no customer → none without Stripe. **10**
- `__tests__/services/tier-grant.service.test.ts` + `billing.service.handler.test.ts`: the former foreign event now converges to the tracked live one; tracked cancelled + duplicate live → adopts the duplicate; two governing → `duplicate_subscription`; unmatched unchanged; marketplace `foreign` unchanged. **6**
- Org delete: cancels every blocking subscription; list failure falls back to the tracked id. **2**

### api integration
- `billing.router.integration.test.ts`: two concurrent first checkouts → one `createCustomer`, one stored id, second session expires the first (held-lock pattern from #938); Stripe lists a live subscription → 409; `POST /api/billing/sync` converges an org with no webhook and records one `billing.sync` row, a repeat records none; 403 for a member; route-map guard picks up the route. **6**
- `stripe-webhook.integration.test.ts`: cancel of the tracked subscription with a live duplicate keeps the paid tier and adopts the duplicate; the outcome CHECK accepts `duplicate_subscription`. **2**

### web
- `__tests__/SettingsBilling.test.tsx`: success → sync called once, `live` toasts, `pending` shows the alert, error toasts and shows the alert. **4**
- `__tests__/SubscriptionBilling.component.test.tsx` / TierCard: alert renders; Subscribe is `aria-disabled` with the reason. **2**

### core
- `billing.contract` test: sync request strict, response enum. **2**

**Totals ≈ 45 cases.**

## Acceptance criteria
- [ ] With the webhook not delivering, a second checkout after paying is refused with `409 BILLING_ALREADY_SUBSCRIBED`, and Stripe shows one subscription.
- [ ] Two checkouts opened in two tabs leave one payable session; the older one shows "expired" at Stripe.
- [ ] Two first checkouts at once create one Stripe customer.
- [ ] Returning from a paid checkout with the webhook down shows the new plan.
- [ ] A pending payment shows the processing alert and disables Subscribe.
- [ ] Cancelling the tracked subscription while a duplicate is live keeps the org on the duplicate's plan and records `duplicate_subscription`; nothing is cancelled automatically.
- [ ] Deleting an org cancels every live subscription on its customer.
- [ ] When Stripe is unreachable, checkout fails with 502 and creates nothing.

## Risks & rollback
- **Fail-closed checkout:** a Stripe list outage blocks upgrades (502, retryable) instead of risking a duplicate charge. Deliberate.
- **Pool:** one connection held for 3–5 Stripe calls per checkout. Detected as `DB_ADMISSION_TIMEOUT` in logs; checkouts are rare.
- **Convergence change:** the webhook now adopts a duplicate instead of ignoring it, and can change which subscription an org tracks. The ledger records every change, and the `warn` names the customer.
- **Rollback:** revert the PR. The migration only widens a CHECK, so it can stay.

## Files touched
- Edit: `apps/api/src/services/{stripe,billing,tier-grant,organization-delete,sync-lock}.service.ts`, `apps/api/src/routes/billing.router.ts`, `apps/api/src/constants/api-codes.constants.ts`, `apps/api/src/config/swagger.config.ts`, `apps/api/src/db/schema/commercial-events.table.ts`, `apps/api/src/__tests__/config/route-authorization.map.ts`.
- New: `apps/api/drizzle/<n>_commercial-events-duplicate-subscription-outcome.sql` (+ journal, snapshot).
- Edit: `packages/core/src/contracts/billing.contract.ts`, `packages/core/src/models/commercial-event.model.ts`.
- Edit: `apps/web/src/api/billing.api.ts`, `views/Settings.view.tsx`, `components/SubscriptionBilling.component.tsx`, `components/TierCard.component.tsx`.
- Tests listed above. Docs: `docs/STRIPE_CLI_OPS.md` (reconciling a flagged duplicate) and the "How do I upgrade my plan?" FAQ in `packages/core/src/content/faq.util.ts:84` (it promises "within a few seconds" because Stripe confirms directly; add that the return page confirms it and a second checkout is refused).

## Next step
`/plan 939` slices this into about five commits: (1) core contract + outcome migration; (2) `StripeService` methods and `selectGoverningSubscription`/`resolveCustomer` with the webhook switched over; (3) the checkout lock, guard, expiry and conditional customer write; (4) the sync route and org-delete cancel-all; (5) the web return flow and processing state, plus the doc sync.
