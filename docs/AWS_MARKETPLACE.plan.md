# AWS Marketplace listing + entitlement-to-tier adapter — Plan

**TDD-sequenced implementation of the second `TierGrantSource`: the `commercial_events` rename, the org entitlement columns, `MarketplaceService` + `AwsMarketplaceGrantSource`, the SNS webhook, and the term-derived read-only enforcement.**

Spec: `docs/AWS_MARKETPLACE.spec.md`. Discovery: `docs/AWS_MARKETPLACE.discovery.md`. Issue: #568 (epic #569). Builds on **shipped #565** (`TierGrantSource` seam, `TierGrantService.apply`) and **#579** (`isSaas()`/`isResidency()`), both on the epic branch.

Five slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/568-aws-marketplace`** (base `epic/enterprise-deployment`) — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd packages/core && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — **the entire risk to the live Stripe rail is isolated in slice 1** (the rename), proven green before any marketplace code exists; then the adapter builds bottom-up (schema → service → route → enforcement):

- **Slice 1** — rename `stripe_events` → `commercial_events` + `source` discriminator. Pure generalization; the Stripe path stays green. The one place the existing revenue rail is touched.
- **Slice 2** — org `marketplaceEntitlementId` + `entitlementThrough` columns + `findByMarketplaceEntitlementId` + the pure `isEntitlementExpired` helper. Schema + leaf logic, no marketplace flow yet.
- **Slice 3** — `MarketplaceService` + `AwsMarketplaceGrantSource` (mocked entitlement client), verified through `TierGrantService.apply`. The adapter logic, not yet wired to a route.
- **Slice 4** — the SNS webhook route (verify + confirm + dispatch), gated on config. The marketplace rail is live end-to-end after this.
- **Slice 5** — `requireOrgWritable` enforcement + the end-to-end expiry→read-only flow + the operator runbook.

Two migrations (slice 1 rename, slice 2 org columns); each commits its `.sql` + drizzle journal + snapshot (`project_drizzle_journal_must_be_committed`).

---

## Slice 1 — Rename `stripe_events` → `commercial_events` + `source`

Generalize the dedup store; the Stripe rail keeps working with `source='stripe'`. No marketplace code yet.

**Files**

- Rename: `packages/core/src/models/stripe-event.model.ts` → `commercial-event.model.ts` (add `CommercialEventSourceSchema`, `source`, `externalId`); edit `models/index.ts`.
- Rename: `apps/api/src/db/schema/stripe-events.table.ts` → `commercial-events.table.ts` (`source` col, `event_id`→`external_id`, `unique(source, external_id)`, source CHECK); edit `db/schema/index.ts`.
- Rename: `apps/api/src/db/repositories/stripe-events.repository.ts` → `commercial-events.repository.ts` (`insertIfNew` conflict target `[source, external_id]`, `commercialEventsRepo`); edit `db/repositories/index.ts`, `services/db.service.ts` (`repository.commercialEvents`).
- Edit: `db/schema/zod.ts` (`CommercialEventSelect/Insert`), `db/schema/type-checks.ts` (CommercialEvent block), `services/billing.service.ts` (`eventRow` writes `source:"stripe"`, `externalId: event.id`), `services/tier-grant.service.ts` (`EventRow` alias, `apply`'s `insertIfNew` calls → `commercialEvents`, `StripeGrantSource` row build adds `source`).
- Migration: `npm run db:generate -- --name rename_stripe_events_to_commercial_events` — hand-edit to `ALTER TABLE … RENAME` + `ADD COLUMN source … DEFAULT 'stripe'` + swap the unique (not a drop/recreate — preserve rows).
- Edit tests: `__tests__/services/tier-grant.service.test.ts`, `__tests__/services/billing.service.handler.test.ts`, `__integration__/db/repositories/stripe-events.repository.integration.test.ts` (→ `commercial-events…`), `__integration__/db/stripe-billing-schema.integration.test.ts` — renamed symbols, `source:"stripe"` rows.

**Steps**

1. **Tests (spec cases 1, 3, 4, 5).** `CommercialEventSchema` parses a `stripe` and an `aws_marketplace` row, rejects unknown `source`/`outcome`; dedup on `(source, external_id)` (same pair → one row; **same `external_id`, different `source` → two rows**); `insertIfNew` false on redelivery; dual-schema guards compile. Plus migrate the existing Stripe suites to the new names. Run; fail.
2. **Implement** the rename per the spec Surface + the rename migration. Green.
3. Lint + type-check. **Run the full Stripe/tier-grant suite** — the regression gate for the live rail.

**Done when:** cases 1, 3, 4, 5 pass; the pre-existing Stripe billing + tier-grant tests pass unchanged in behavior against `commercial_events`; nothing marketplace-specific exists yet.

**Risk:** the rename breaks the Stripe path. Mitigated: `apply`/`TierGrantSource`/`GrantResolution` contracts are untouched (only the store name + row `source`); the migration is a `RENAME` (preserves rows), not a drop; the full Stripe suite is the boundary gate.

---

## Slice 2 — Org entitlement columns + finder + `isEntitlementExpired`

The durable marketplace binding + term, and the pure read-only predicate. No marketplace flow yet.

**Files**

- Edit: `apps/api/src/db/schema/organizations.table.ts` (`marketplaceEntitlementId` text + UNIQUE-where-not-null; `entitlementThrough` timestamptz), `packages/core/src/models/organization.model.ts` (+ two nullable fields), `db/schema/zod.ts` + `type-checks.ts` (Organization block already covers via the added fields).
- Edit: `apps/api/src/db/repositories/organizations.repository.ts` — `findByMarketplaceEntitlementId(id, client)` mirroring `findByStripeCustomerId`.
- New: `apps/api/src/services/entitlement-term.util.ts` (or co-located) — `isEntitlementExpired(org, now): boolean` (pure).
- Migration: `npm run db:generate -- --name add_org_marketplace_entitlement_columns`.
- New tests: `__tests__/…/entitlement-term.util.test.ts`; extend org repo integration test.

**Steps**

1. **Tests (spec cases 2, 6, 7, 15).** `OrganizationSchema` includes the two nullable fields + still parses; `marketplace_entitlement_id` UNIQUE rejects a duplicate non-null, allows two nulls; `findByMarketplaceEntitlementId` round-trips + excludes soft-deleted; `isEntitlementExpired` (null → false, future → false, past → true). Run; fail.
2. **Implement** the columns + finder + helper + migration. Green.
3. Lint + type-check.

**Done when:** cases 2, 6, 7, 15 pass; the columns + finder + predicate exist; nothing reads them yet (the middleware is slice 5, the writer is slice 3).

**Risk:** none beyond the migration; no behavior change to existing paths (new nullable columns).

---

## Slice 3 — `MarketplaceService` + `AwsMarketplaceGrantSource`

The adapter logic, verified through the reused `TierGrantService.apply`. Mocked entitlement client; no route yet.

**Files**

- New dep: `@aws-sdk/client-marketplace-entitlement-service` (`apps/api`).
- New: `apps/api/src/services/marketplace.service.ts` (`isConfigured`, `getEntitlement`, `dimensionToTier`).
- New: `packages/core/src/models/marketplace-notification.model.ts` (the parsed SNS `Message` shape); export.
- Edit: `apps/api/src/services/tier-grant.service.ts` — add `AwsMarketplaceGrantSource implements TierGrantSource<MarketplaceNotification>`.
- New tests: `__tests__/services/marketplace.service.test.ts`, extend `__tests__/services/tier-grant.service.test.ts`.

**Steps**

1. **Tests (spec cases 8, 9, 10, 11, 12, 13, 14).** `isConfigured` on env; `getEntitlement` maps a mocked `GetEntitlements` (dimension + ExpirationDate), `null` on empty; `dimensionToTier` → `enterprise`; `resolve` → grant (`changed:true`), noop (`changed:false`), foreign (different `marketplaceEntitlementId`), expired/null → grant setting a past `entitlementThrough` with **tier unchanged**; `apply(new AwsMarketplaceGrantSource(), n)` redelivered `MessageId` → `duplicate` (single row). Run; fail.
2. **Implement** `MarketplaceService` (mock the AWS client in tests) + the grant source per the spec Surface. Green.
3. Lint + type-check.

**Done when:** cases 8–14 pass; the adapter resolves an entitlement to an `orgUpdate` and rides `apply`'s D2 transaction; still unreferenced by any route.

**Risk:** the single-org resolution (which org the install grants to). Confirm against the residency seed (#566/#583) — the source resolves the install's one org; tests use a fixture org.

---

## Slice 4 — SNS webhook route

The marketplace rail goes live. Verify + confirm + dispatch, gated on config.

**Files**

- New dep: an SNS message-signature validator (`apps/api`).
- Edit: `apps/api/src/routes/webhook.router.ts` — `POST /api/webhooks/aws-marketplace` (raw body, SNS signature verify, `SubscriptionConfirmation` auto-confirm, `Notification` → `apply`), gated `if (MarketplaceService.isConfigured())`; `@openapi` block.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `MARKETPLACE_NOT_CONFIGURED`, `MARKETPLACE_SIGNATURE_INVALID` (+ message map).
- New tests: extend a webhook integration test.

**Steps**

1. **Tests (spec cases 16, 17, 18).** `SubscriptionConfirmation` → confirms (mocked `SubscribeURL` GET), 200; `Notification` valid signature → dispatches `apply`, 200; **invalid signature → 400 `MARKETPLACE_SIGNATURE_INVALID`**, no dispatch; route 404s when unconfigured. Run; fail.
2. **Implement** the route + codes per the spec Surface. Green.
3. Lint + type-check.

**Done when:** cases 16–18 pass; a signed SNS notification drives a tier grant end-to-end; a forged one is rejected; the route is absent when the marketplace isn't configured.

**Risk:** SNS signature validation correctness — use a maintained validator (never hand-roll X.509); test 17 is the guard.

---

## Slice 5 — `requireOrgWritable` enforcement + runbook

The read-only degradation goes live, and the doc surface lands.

**Files**

- New: `apps/api/src/middleware/require-org-writable.middleware.ts` (uses `isEntitlementExpired` from slice 2).
- Edit: `apps/api/src/routes/protected.router.ts` — `protectedRouter.use(requireOrgWritable)` after `jwtCheck`.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `ORG_ENTITLEMENT_EXPIRED` (+ message map).
- New: `docs/AWS_MARKETPLACE.runbook.md` (durable, unsuffixed — listing + SNS-topic + product-code setup).
- New tests: middleware integration + the end-to-end flow.

**Steps**

1. **Tests (spec cases 19, 20).** `requireOrgWritable`: GET on a read-only org passes; POST/DELETE on a read-only org → 403 `ORG_ENTITLEMENT_EXPIRED`; POST on a writable org passes; POST with no resolvable org passes (fail-open on lookup). End-to-end: seed org → marketplace `Notification` (enterprise + future term) → `org.tier="enterprise"`, writes allowed; expiry `Notification` → writes 403, reads 200. Run; fail.
2. **Implement** the middleware + wire it on `protectedRouter` + the code + the runbook. Green.
3. Lint + type-check; **full `apps/api` suite** (the middleware sits in front of every protected route — confirm no regression).

**Done when:** cases 19, 20 pass; a lapsed entitlement blocks writes but not reads; renewal restores writes; the runbook documents the operator setup.

**Risk:** the middleware fronts every protected mutation — a bug 403s healthy orgs. Mitigated: `isEntitlementExpired` is null-safe (SaaS orgs → false), the org-lookup failure path fails **open**, and the full protected-route suite is the boundary gate.

---

## Sequence summary

| Slice | Lands | Spec cases | Tests |
|---|---|---|---|
| 1 | `commercial_events` rename + `source` (migration) | 1, 3, 4, 5 (+ Stripe regression) | core unit + api integration |
| 2 | org `marketplaceEntitlementId`/`entitlementThrough` + finder + `isEntitlementExpired` (migration) | 2, 6, 7, 15 | core unit + api integration/unit |
| 3 | `MarketplaceService` + `AwsMarketplaceGrantSource` | 8–14 | api unit |
| 4 | SNS webhook route (verify + confirm + dispatch) | 16, 17, 18 | api integration |
| 5 | `requireOrgWritable` + end-to-end + runbook | 19, 20 | api integration |

Total ≈ **20 cases**, two migrations. Commits on `feat/568-aws-marketplace`; the PR grows commit-by-commit.

---

## Cross-slice notes

- **Stripe-rail safety is the slice-1 invariant.** The rename touches the live revenue path once; `TierGrantService.apply`, `GrantResolution`, and `StripeGrantSource.resolve`'s logic are unchanged (only the store name + a `source` field). A Stripe regression is a slice-1 bug, isolated from all marketplace code.
- **Two migrations, both reversible.** Slice 1 is a `RENAME` (rows preserved, `source='stripe'` default); slice 2 adds nullable columns. No prod data (`project_no_production_data_yet`), but both are non-destructive regardless. Commit each `.sql` **with** `meta/_journal.json` + the snapshot.
- **No forward deps:** slice 3 uses slice 1 (`commercial_events` row) + slice 2 (org columns to write); slice 4 uses slice 3; slice 5 uses slice 2 (`isEntitlementExpired`) + slice 4 (case 20's route). Each boundary is green.
- **Fail policy (from discovery/spec):** the write-gate **fails closed on a definitively-expired term** but **fails open on a lookup failure** (`getCurrentOrganization().catch(() => null)`); the marketplace source degrades **only on a definitive converge-read**, never a transient `GetEntitlements` error (that 500s → SNS retries). These live in slices 3 and 5.
- **New deps:** `@aws-sdk/client-marketplace-entitlement-service` (slice 3), an SNS validator (slice 4) — each added in its slice so the boundary build stays green.
- **Doc-sync (per `CLAUDE.md` → "Keeping Documentation in Sync"):** the durable `docs/AWS_MARKETPLACE.runbook.md` (slice 5); `apps/api/README.md`'s billing/webhook section gains the marketplace rail; `deploy-mode.ts`'s "marketplace source #568" comment becomes accurate. No user-facing app copy changes.
- **CLAUDE.md compliance:** file suffixes (`*.service.ts`, `*.middleware.ts`, `*.repository.ts`, `*.table.ts`, `*.model.ts`), dual-schema workflow, `ApiError`/`ApiCode` + message map, `@openapi` on the new route, npm-script tests. Server-enforced read-only (middleware), not prompt-enforced.

## Next step

Implement slice 1 on this branch, tests-first, one commit per slice — only after discovery + spec + plan are reviewed and confirmed. Before coding, re-read the spec's *Surface*; the `commercial_events` rename and `AwsMarketplaceGrantSource` shapes are faithful to the real `tier-grant.service.ts` seam and `stripe-events` store — lift, don't reinvent.
