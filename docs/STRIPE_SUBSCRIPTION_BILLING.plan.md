# Stripe subscription billing — Plan

**TDD-sequenced implementation of the #176 contract: Stripe linkage columns + `stripe_events`, the SDK wrapper + pure tier derivation + per-org period anchor, the signature-verified converge webhook, owner-only checkout/portal/tiers endpoints + org-delete cancellation, and the Settings "Subscription & Billing" tab.**

Spec: `docs/STRIPE_SUBSCRIPTION_BILLING.spec.md`. Discovery: `docs/STRIPE_SUBSCRIPTION_BILLING.discovery.md`. Issue: #176 (epic #177). Builds on the shipped #172 tier surface (`tiers` rows, `resolveTier`, `periodIdFor`) and the #197 delete cascade; keeps the `TierPolicy` contract untouched for #214.

Five slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/stripe-subscription-billing`** (PR base: `epic/subscription-billing`) — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale:

- **Slice 1** lands all schema/models/repos in one migration — pure-additive; nothing reads the new columns yet, so the repo stays green while the data surface freezes.
- **Slice 2** adds the only-file-that-imports-`stripe` (`StripeService`), the pure derivation function, and the `periodIdFor` org override — all leaf logic, SDK fully mocked, no routes yet.
- **Slice 3** wires the webhook end-to-end (raw-body mount → signature → dedup+converge transaction). Depends on 1 (tables) + 2 (service + derivation).
- **Slice 4** adds the user-facing API (tiers/checkout/portal) + org-delete cancellation + OpenAPI. Depends on 1 + 2; independent of 3.
- **Slice 5** is the visible end: `sdk.billing`, the Billing tab's four states, redirect/toast handling, and the user-facing doc-sync (glossary/FAQ).

---

## Slice 1 — schema: linkage columns, `stripe_events`, models, repo, migration, seed

All DB shape in one commit. Additive columns + one new table; no service reads them yet.

**Files**

- New: `packages/core/src/models/stripe-event.model.ts`; `packages/core/src/contracts/billing.contract.ts`.
- New: `apps/api/src/db/schema/stripe-events.table.ts`; `apps/api/src/db/repositories/stripe-events.repository.ts` (`insertIfNew`).
- New (migration): `<ts>_add_stripe_billing_columns_and_events` — tiers columns + UNIQUE, org columns + UNIQUEs + CHECK, `CREATE TABLE stripe_events`, hand-added `UPDATE tiers SET selectable = true WHERE slug = 'standard'`.
- Edit: `packages/core/src/models/tier.model.ts` (`stripePriceId`, `selectable` on `TierSchema` only), `models/organization.model.ts` (3 nullable fields), `models/index.ts`, `contracts/index.ts`.
- Edit: `apps/api/src/db/schema/tiers.table.ts`, `organizations.table.ts`, `zod.ts` (+`StripeEvent*`), `type-checks.ts` (+`StripeEvent` assertions), `schema/index.ts`, `repositories/index.ts`, `services/db.service.ts`, `services/seed.service.ts` (`standard` seeds `selectable: true`, update-if-changed).
- New tests: core model/contract tests; `apps/api` integration tests for constraints + `insertIfNew` + migration probe.

**Steps**

1. **Core tests (spec cases 1–5).** Org schema with defaulted nullable Stripe fields, `billingAnchorDay` bounds; `TierSchema` new fields; `StripeEventSchema` outcomes; `BillingTierSchema` purchasable-with-null-price; billing request/response contracts. Run; fail.
2. **Author the model/contract edits + `stripe-event.model.ts`.** Green 1–5. Existing org/tier fixtures updated in place.
3. **Integration tests (cases 6–9).** `stripe_price_id` UNIQUE allows multiple NULLs / rejects duplicates; org UNIQUEs + anchor CHECK; `insertIfNew` true-then-false + concurrent double-insert → one row; type-checks compile. Run; fail (no columns/table).
4. **Author the table edits + `stripe-events.table.ts` + repository; generate the migration** (`npm run db:generate -- --name add_stripe_billing_columns_and_events`), hand-add the `selectable` backfill UPDATE, `npm run db:migrate`. Register repo. Green 6–9.
5. **Migration/seed probe (case 34).** Columns + table exist; `standard.selectable = true`; existing orgs have null Stripe fields; seed idempotent. Green.
6. Lint + type-check.

**Done when:** cases 1–9 + 34 pass; the dev DB carries the new shape; no runtime behavior changed anywhere.

**Risk:** the hand-added backfill UPDATE drifting from `seedTiers` — same mitigation as #172's migration (cross-referencing comments; seed converges existing rows anyway).

---

## Slice 2 — `StripeService` + pure derivation + `periodIdFor` org override

The leaf logic: the SDK wrapper (the only file importing `stripe`), the Decision-3 status table as a pure function, and the Q5 anchor threading. SDK mocked throughout (`jest.unstable_mockModule`, per the house ESM pattern).

**Files**

- New: `apps/api/src/services/stripe.service.ts`; `apps/api/src/services/billing.service.ts` (this slice: `deriveTierFromSubscription` only).
- Edit: `apps/api/src/environment.ts` (+`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`), `apps/api/.env.example` (+ both keys + `stripe listen` note), `apps/api/package.json` (+`stripe`), `services/tier.service.ts` (`periodIdFor` optional `anchorDayOverride`), `services/usage.service.ts` + `services/cost-gate.service.ts` (thread `org.billingAnchorDay` at the two call sites).
- New tests: `stripe.service.test.ts`, `billing.service.test.ts`; edit `tier.service.test.ts` (override cases).

**Steps**

1. **Derivation tests (cases 10–11).** The six status-table rows; anchor clamp (31st → 28, terminal → null). Run; fail.
2. **Author `deriveTierFromSubscription`** (pure — no I/O). Green.
3. **`periodIdFor` tests (case 12).** Null override = regression-identical; override 15 straddling the boundary. Run; fail → **implement the override + thread both call sites** (`cost-gate.service.ts:223`, `usage.service.ts:113` pass `org.billingAnchorDay`). Green — including the untouched existing gate/usage suites (the null-override path must be behavior-identical).
4. **`StripeService` tests (case 13 + constructEvent).** `getPrice` TTL cache (one SDK call for two reads) + null-on-throw; `constructEvent` maps verification failure to `ApiError(400, WEBHOOK_INVALID_SIGNATURE)`; `isConfigured`. Run; fail → author `StripeService` (lazy client, pinned `apiVersion` const). Green.
5. Lint + type-check.

**Done when:** cases 10–13 pass; all pre-existing gate/usage tests still green (proves the override is inert for unsubscribed orgs); `stripe` dep installed; env documented.

**Risk:** the threading touches the cost gate's hot path — the "existing suites still green" check in step 3 is the guard; the acceptance criterion "gate counter and usage balance agree" gets its integration coverage in slice 3's applied-event test (which asserts the anchor lands where both readers see it).

---

## Slice 3 — webhook: `handleSubscriptionEvent` + `POST /api/webhooks/stripe`

The tier writer. Dedup insert + org UPDATE in one transaction; converge-to-source before it; raw-body route mounted inside the pre-`express.json()` webhook router.

**Files**

- Edit: `apps/api/src/services/billing.service.ts` (+`handleSubscriptionEvent`), `routes/webhook.router.ts` (+`/stripe` route with `express.raw`, `@openapi` block).
- New tests: `billing.service` handler cases; `apps/api/src/__tests__/__integration__/routes/stripe-webhook.integration.test.ts`.

**Steps**

1. **Handler tests (case 14).** applied (org tier/sub-id/anchor written + event row, one transaction); duplicate short-circuit (no org write); unmatched (outcome row, org untouched, resolves); mid-transaction DB failure → throws, **no event row survives** (rollback → retryable). Stripe fetch mocked. Run; fail.
2. **Author `handleSubscriptionEvent`** (converge fetch → transaction: `insertIfNew` + org UPDATE per `deriveTierFromSubscription`). Green.
3. **Route integration tests (cases 19–25).** Signed payload → 200 + writes; redelivery → single row; bad/missing signature → 400, nothing written; unknown customer → 200 `unmatched`; unhandled type → 200 `ignored`; converge failure → 500 + rollback; **raw-body exactness** (signature computed over posted bytes, not re-serialized JSON). Sign test payloads with the real `stripe` signature helper against a test secret. Run; fail.
4. **Author the route** (raw parser, 503-unconfigured guard, type filter, outcome→200 mapping, errors → `next(ApiError(500, WEBHOOK_SYNC_FAILED))`) + `@openapi`. Green.
5. Lint + type-check.

**Done when:** cases 14 + 19–25 pass; a locally-signed test event flips a seeded org's tier + anchor through the real mounting.

**Risk:** transaction plumbing — `insertIfNew` and the org UPDATE must share one client; the repository methods already accept `client` (base-`Repository` pattern), so the handler owns the `db.transaction` scope.

---

## Slice 4 — billing endpoints + org-delete cancellation + OpenAPI

The user-facing API: plan list, checkout, portal; the `BILLING_*` codes; the best-effort cancel in the delete cascade.

**Files**

- New: `apps/api/src/routes/billing.router.ts`; integration tests.
- Edit: `apps/api/src/services/billing.service.ts` (checkout/portal/tiers logic), `constants/api-codes.constants.ts` (+9 `BILLING_*` codes), `routes/protected.router.ts` (mount `/billing`), `config/swagger.config.ts` (register the 4 contract schemas), `services/organization-delete.service.ts` (post-commit best-effort cancel).
- Edit tests: `organization-delete` suite (+case 18).

**Steps**

1. **Guard tests (cases 15–17).** Checkout guard ladder in spec order (503/403/409-subscribed/409-managed/404/400); lazy customer creation (created once + persisted / skipped when present); portal 409-no-customer / happy / 502. SDK mocked. Run; fail.
2. **Author the service logic + router + codes + mount + swagger registrations** (success/cancel URLs from `environment.CORS_ORIGIN`). Green.
3. **Route integration tests (cases 26–27).** Tiers list: selectable-only, `standard` unpurchasable, price null on mock throw; auth: 401 anon, member can GET, member 403 on POSTs. Green.
4. **Org-delete test (case 18).** Subscription present → cancel called after commit; cancel throw → delete still succeeds (warn); absent → no call. Implement beside `cleanupS3`. Green.
5. Lint + type-check.

**Done when:** cases 15–18 + 26–27 pass; all four routes documented in Swagger UI; delete cascade unchanged for Stripe-less orgs.

**Risk:** none structural — the guard ladder's *order* is contract (tests assert specific codes, so a reorder surfaces immediately).

---

## Slice 5 — web: `sdk.billing`, the Subscription & Billing tab, doc-sync

The visible end: plan list + actions with the four states, redirect + return-toast, and the user-facing documentation surfaces.

**Files**

- New: `apps/web/src/api/billing.api.ts`; `apps/web/src/components/SubscriptionBilling.component.tsx` (container + `SubscriptionBillingUI`); `apps/web/src/__tests__/SubscriptionBilling.component.test.tsx`.
- Edit: `api/keys.ts` (+`billing`), `api/sdk.ts`, `views/Settings.view.tsx` (third tab), `utils/glossary.util.ts` + `utils/faq.util.ts` (subscription/plan/billing-portal entries — doc-sync, same PR).

**Steps**

1. **UI tests (cases 28–32).** Render `SubscriptionBillingUI` with props per the Dialog/Form checklist spirit: unsubscribed-owner plan list (Subscribe on purchasable only); subscribed → Manage, no list; managed → notice, no actions; non-owner → disabled + tooltip; checkout success → `window.location.replace` (mocked) / server error → `<FormAlert>`. Run; fail.
2. **Author the UI + container + `billing.api.ts` + sdk/keys wiring.** Green.
3. **Settings test (case 33).** `?billing=success` → toast + `invalidateQueries(queryKeys.organizations.root)` (spy via injected queryClient per `__tests__/test-utils.tsx`). Implement the tab + return handling. Green.
4. **Doc-sync.** Glossary: *Subscription plan*, *Billing portal*; FAQ: "How do I upgrade my plan?", "Who can manage billing?" (owner-only), "My plan says managed — what does that mean?". Pinning tests (`glossary.util.test.ts` / `faq.util.test.ts`) updated.
5. Lint + type-check; full `npm run test` at root.

**Done when:** cases 28–33 pass; the tab renders all four states against the dev stack; glossary/FAQ carry the new concepts.

**Risk:** none beyond MUI plumbing; the pure-UI split keeps the state-matrix tests mock-free.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | Columns + `stripe_events` + models + repo + migration/seed | cases 1–9, 34 |
| 2 | `StripeService`, pure derivation, `periodIdFor` override threading | cases 10–13 + existing gate/usage suites green |
| 3 | Webhook route + dedup/converge transaction | cases 14, 19–25 |
| 4 | tiers/checkout/portal + `BILLING_*` + org-delete cancel + OpenAPI | cases 15–18, 26–27 |
| 5 | `sdk.billing` + Billing tab + glossary/FAQ | cases 28–33 |

## Cross-slice notes

- **One migration, slice 1.** Unlike #172 (three slice-aligned migrations), all schema here is additive and independently inert — later slices add readers, not columns. Net schema identical to the spec's Migration section.
- **SDK mocking.** Only `stripe.service.ts` imports `stripe`; every other test mocks `StripeService` (plain `jest.unstable_mockModule`), so CI never needs keys. Slice 3's signature tests use the library's signing helper with a fixed test secret — still no network.
- **`TierPolicy` untouched** across all slices (#214 lands entitlements there); if any slice finds itself wanting a policy field, kick back to the spec rather than diverging.
- **Doc-sync inventory check:** glossary/FAQ (slice 5), `.env.example` (slice 2), OpenAPI (slices 3–4). No tool surfaces change (no `.tool.ts`, no `system.prompt.ts`); `README`s don't enumerate env keys; CLAUDE.md conventions unaffected. The Stripe CLI is already in the devcontainer image (commit `3e1dc2b0`) for the smoke.
- **Smoke prerequisites** (for `/smoke 176` after implementation): test-mode keys in `apps/api/.env`, `stripe listen --forward-to localhost:3001/api/webhooks/stripe`, one test product/price mapped to a scratch paid tier row.

## Next step

Implementation starts on this branch — slice 1, tests-first, one commit per slice — once you've confirmed discovery, spec, and this plan.
