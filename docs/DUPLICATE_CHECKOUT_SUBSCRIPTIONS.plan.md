# Duplicate checkout subscriptions — Plan

**TDD-sequenced implementation of #939: the `duplicate_subscription` outcome and sync contract, per-customer convergence with the webhook switched over, the locked and Stripe-guarded checkout, the sync route and org-delete cancel-all, and the web return flow.**

Spec: `docs/DUPLICATE_CHECKOUT_SUBSCRIPTIONS.spec.md`. Discovery: `docs/DUPLICATE_CHECKOUT_SUBSCRIPTIONS.discovery.md`. Issue: #939. Builds on #938 (the checkout's rename sync, merged as `79dbac8c`).

Five slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/939-duplicate-checkout-subscriptions` / PR #942**, one fix and one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run (`--testPathPattern`); (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — leaf contracts first, then the convergence every later slice reuses, then the writers that call it:

- **Slice 1:** the core contract and the outcome migration. Nothing reads them yet, but slices 2 and 4 need both.
- **Slice 2:** `StripeService` reads and `resolveCustomer`, with the webhook switched over. This is the behaviour change most likely to surprise, so it lands alone.
- **Slice 3:** checkout. It needs slice 2's `listSubscriptions` and the expire/delete methods, but not convergence.
- **Slice 4:** `POST /api/billing/sync` and org-delete cancel-all. Sync composes slice 2's `resolveCustomer` and `applyResolution`.
- **Slice 5:** web return flow and processing state against slice 4's route, plus the doc sync.

One migration (slice 1), widening a CHECK.

---

## Slice 1 — Sync contract and `duplicate_subscription` outcome

The shapes every later slice imports, and the ledger value slice 2 writes.

**Files**

- Edit: `packages/core/src/contracts/billing.contract.ts`: `BillingSyncRequestSchema` (strict, empty), `BillingSyncResponseSchema` (`tier`, `subscription: live | pending | none`) and their types.
- Edit: `packages/core/src/models/commercial-event.model.ts`: `CommercialEventOutcomeSchema` gains `duplicate_subscription`.
- Edit: `apps/api/src/db/schema/commercial-events.table.ts`: the `outcome` enum and `commercial_events_outcome_check`.
- New: `apps/api/drizzle/<n>_commercial-events-duplicate-subscription-outcome.sql` (+ `meta/_journal.json`, snapshot), via `npm run db:generate -- --name commercial-events-duplicate-subscription-outcome`, carrying `-- destructive-ok: widens a CHECK; no row can fail it`.
- Edit: `BillingService.eventRow`'s `outcome` union (`apps/api/src/services/billing.service.ts`).

**Steps**

1. **Tests (spec: core 2, webhook integration "CHECK accepts `duplicate_subscription`").** Core contract cases (strict request, response enum); an integration insert of a `commercial_events` row with the new outcome. Run; fail.
2. **Implement** the schemas, enum, CHECK and migration; `npm run db:migrate` locally. Green.
3. `npm run lint:migrations`, then a full root `npm run build` (a core model change reaches web/site fixtures), lint + type-check.

**Done when:** both cases pass, the migration applies on a fresh DB in CI, and type-checks between core and the Drizzle table agree.

**Risk:** the migration linter flags the `DROP CONSTRAINT`; the `destructive-ok` marker is the answer. Commit the journal and snapshot with the `.sql`.

---

## Slice 2 — Per-customer convergence; webhook switched over

The governing-subscription rule, and the webhook converging from it instead of skipping foreign subscriptions.

**Files**

- Edit: `apps/api/src/services/stripe.service.ts`: `listSubscriptions`, `listOpenCheckoutSessions`, `expireCheckoutSession`, `deleteCustomer`; `subscription_data.metadata.organizationId` on sessions.
- Edit: `apps/api/src/services/billing.service.ts`: `BLOCKING_SUBSCRIPTION_STATUSES`, `GOVERNING_SUBSCRIPTION_STATUSES`, `selectGoverningSubscription`, `resolveCustomer`, `EventRowFields`.
- Edit: `apps/api/src/services/tier-grant.service.ts`: `StripeGrantSource.resolve` drops the foreign branch and delegates to `resolveCustomer`; `TierGrantService.apply` splits out `applyResolution`.

**Steps**

1. **Tests (spec: StripeService 5, selectGoverning 6, tier-grant/handler 6, webhook integration "tracked cancelled + live duplicate").** Rewrite the existing #230 foreign cases in `billing.service.handler.test.ts` to the new expectation (converge to the tracked live subscription); add the adopt-the-duplicate and two-governing → `duplicate_subscription` cases; keep marketplace `foreign` and `unmatched` unchanged. Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** all listed cases pass and no test still expects a Stripe event recorded as `foreign`.

**Risk:** existing webhook integration cases spy only `fetchSubscription`. Each now also needs a `listSubscriptions` spy; give the suite a default that returns the fetched subscription, so the single-subscription cases behave as before.

---

## Slice 3 — Locked, Stripe-guarded checkout

**Files**

- Edit: `apps/api/src/services/sync-lock.service.ts`: `BILLING_CHECKOUT_LOCK_NAMESPACE = 0x4243_484b`.
- Edit: `apps/api/src/services/billing.service.ts`: `createCheckout`'s transaction (lock → re-read → list and refuse → expire → conditional customer write → session; Stripe failures returned as `{ failure }` so the id commits; `ApiError` passes through).

**Steps**

1. **Tests (spec: endpoints 7 of 10, the checkout ones; billing integration "two concurrent first checkouts" and "Stripe lists a live subscription → 409").** The concurrency test reuses #938's held-lock pattern: hold the advisory lock (or the first request) open, start a second, assert one `createCustomer`. Keep the #938 rename-race integration test green. Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** the listed cases and every existing `createCheckout` case pass, including the 409s staying 409 (not 502).

**Risk:** the unit mocks `DbService.transaction` as `fn({})`. The lock's `tx.execute` and `updateWhere` need mock entries. Also check the #938 integration test still drives the rename race through the conditional write.

---

## Slice 4 — `POST /api/billing/sync` and org-delete cancel-all

**Files**

- Edit: `apps/api/src/services/billing.service.ts`: `syncFromStripe`, `syncRow`.
- Edit: `apps/api/src/routes/billing.router.ts`: the route, with `@openapi`.
- Edit: `apps/api/src/config/swagger.config.ts`: `BillingSyncRequest`, `BillingSyncResponse` components.
- Edit: `apps/api/src/constants/api-codes.constants.ts`: `BILLING_SYNC_FAILED`.
- Edit: `apps/api/src/__tests__/config/route-authorization.map.ts`: the route entry.
- Edit: `apps/api/src/services/organization-delete.service.ts`: cancel every blocking subscription, falling back to the tracked id.

**Steps**

1. **Tests (spec: endpoints 3 sync cases, org delete 2, billing integration sync converge/no-repeat-row/403/route map).** Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** sync converges an org with no webhook and writes one `billing.sync` row, a repeat writes none, a member gets 403, and the route-authorization guard passes.

**Risk:** the org-delete integration suite may spy `cancelSubscription` only; add a `listSubscriptions` spy there too.

---

## Slice 5 — Web return flow, processing state, docs

**Files**

- Edit: `apps/web/src/api/billing.api.ts`: `sync` mutation, invalidating `organizations.root`.
- Edit: `apps/web/src/views/Settings.view.tsx`: `?billing=success` → `await sync.mutateAsync()`; `live` toast, otherwise `paymentProcessing`.
- Edit: `apps/web/src/components/SubscriptionBilling.component.tsx`: `paymentProcessing` prop, the info `Alert`, the Subscribe gates.
- Edit: `apps/web/src/components/TierCard.component.tsx`: `subscribeGate`, rendered through `GatedButton`.
- Docs: the "How do I upgrade my plan?" FAQ (`packages/core/src/content/faq.util.ts:84`), and `docs/STRIPE_CLI_OPS.md` (finding and cancelling a flagged duplicate).

**Steps**

1. **Tests (spec: web 6).** `SettingsBilling.test.tsx`: success calls sync once and toasts on `live`, shows the alert on `pending` and on error. `SubscriptionBilling` / TierCard: the alert renders and Subscribe is `aria-disabled` with the reason. Run; fail.
2. **Implement.** Green. Update the docs.
3. Lint + type-check; `faq.util.test.ts` still passes.

**Done when:** the web cases pass, the effect-mutation and action-gate guards stay green, and the FAQ no longer implies the plan depends only on Stripe telling us.

**Risk:** the web tests mock `api.util` partially (memory: a new export a shared module imports breaks CI only); grep the fakes before pushing.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | core contract, `duplicate_subscription` + migration | core + CHECK cases, fresh-DB migrate, root build |
| 2 | Stripe reads, governing rule, webhook converges per customer | StripeService, governing, tier-grant/handler, webhook integration |
| 3 | per-org lock, Stripe guard, session expiry, conditional customer write | checkout unit + concurrency integration, #938 race still green |
| 4 | `POST /api/billing/sync`, org-delete cancel-all | sync unit + integration, route-map guard |
| 5 | web return flow + processing state, FAQ + STRIPE_CLI_OPS | web cases, guards |

## Cross-slice notes

- **Stripe spies.** After slice 2 every billing/webhook integration case that converges needs `listSubscriptions` mocked. Slice 3 adds `listOpenCheckoutSessions`/`expireCheckoutSession`. Give each suite defaults in `beforeEach` rather than per case.
- **Local smoke needs the migration.** `npm run dev` seeds but doesn't migrate; run `npm run db:migrate` in `apps/api` after slice 1.
- **Root build after slice 1** (core model change), and rebuild core before running web tests in slice 5.
- **Docs in sync:** `docs/PROD_STRIPE_LIVE.runbook.md`'s event list doesn't change (no new webhook event). The FAQ and `STRIPE_CLI_OPS.md` change in slice 5.
- The full integration suite here needs `STRIPE_*` exported; run only the touched suites locally.

## Next step

Implementation starts on this branch with slice 1, tests first, one commit per slice, once this plan is confirmed.
