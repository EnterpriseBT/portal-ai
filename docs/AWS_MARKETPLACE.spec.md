# AWS Marketplace listing + entitlement-to-tier adapter — Spec

**Issue:** [EnterpriseBT/portal-ai#568](https://github.com/EnterpriseBT/portal-ai/issues/568) · **Epic:** #569 · **Discovery:** `docs/AWS_MARKETPLACE.discovery.md`

This spec pins the second `TierGrantSource` — `AwsMarketplaceGrantSource` — over the #565 seam, the generalization of `stripe_events` → `commercial_events`, the org `marketplaceEntitlementId` + `entitlementThrough` columns, the SNS webhook that drives it, and the term-derived org read-only enforcement. The Stripe rail stays working throughout; the entitlement stack (`org.tier` → `TierService.resolveTier`) is untouched.

## Key decisions (confirmed in discovery)

1. **D1 ✅** `stripe_events` → `commercial_events` renamed in place: add `source` discriminator, `event_id` → `external_id`, dedup arbiter becomes `unique(source, external_id)`. Existing rows default `source='stripe'`.
2. **D2 ✅** Org read-only is **derived** from `entitlementThrough < now` (no stored flag). The term is the durable record-of-truth; degrades even if an expiry SNS is missed. SaaS orgs (`entitlementThrough = null`) are never read-only.
3. **D3 (pinned here)** `requireOrgWritable` attaches at the top of `protectedRouter` (`protected.router.ts:32`, after `jwtCheck`), gates **mutating methods only** (`POST/PUT/PATCH/DELETE`), resolves the caller's org via `ApplicationService.getCurrentOrganization`, and 403s `ORG_ENTITLEMENT_EXPIRED` when the term has lapsed. `GET/HEAD/OPTIONS`, an explicit path allow-list, and no-org callers pass through. **← the enforcement-breadth call; flagged for review.**
4. **D4 ✅** Single-tenant residency: `GetEntitlements(productCode)` scoped to the install's AWS account → the install's one org.
5. **D5 ✅** SNS signature verification + `SubscriptionConfirmation` handling; route gated on `MarketplaceService.isConfigured()`.
6. `enterprise` is **already** a catalog tier (`packages/core/src/registries/tier-catalog.ts:190`, all-`null`/unlimited, `stripeLookupKey: null`) — reuse it, no new tier.

## Scope

### In scope

1. Generalize the dedup store: `commercial_events` table + model + repo + drizzle-zod + type-checks + migration (rename).
2. Org columns `marketplaceEntitlementId` (UNIQUE-where-not-null) + `entitlementThrough` (timestamptz, nullable) — dual-schema + migration.
3. `MarketplaceService` — wraps `@aws-sdk/client-marketplace-entitlement-service` `GetEntitlements` + `isConfigured()`.
4. `AwsMarketplaceGrantSource implements TierGrantSource<MarketplaceNotification>`.
5. `POST /api/webhooks/aws-marketplace` — SNS handler (raw body, signature verify, `SubscriptionConfirmation` auto-confirm, dispatch to `TierGrantService.apply`).
6. `requireOrgWritable` middleware + `ORG_ENTITLEMENT_EXPIRED` (+ `MARKETPLACE_*`) `ApiCode`s.
7. Org repo `findByMarketplaceEntitlementId`.
8. Docs: an operator runbook for the AWS Marketplace listing/SNS setup (`docs/AWS_MARKETPLACE.runbook.md` — durable, unsuffixed).

### Out of scope

- Creating the actual AWS Marketplace listing / SNS topic / product code (operator console task — the runbook covers it).
- GCP / Azure adapters; usage metering; SSO (#577); a multi-tenant registration landing page.

## Surface

### A. `commercial_events` store (rename of `stripe_events`)

**`packages/core/src/models/commercial-event.model.ts`** (renamed from `stripe-event.model.ts`):

```ts
export const CommercialEventSourceSchema = z.enum(["stripe", "aws_marketplace"]);
export const CommercialEventOutcomeSchema = z.enum([
  "applied", "noop", "unmatched", "ignored", "foreign",
]); // unchanged values
export const CommercialEventSchema = CoreSchema.extend({
  source: CommercialEventSourceSchema,
  externalId: z.string(),              // was eventId — Stripe evt_… or SNS MessageId
  type: z.string(),
  stripeCustomerId: z.string().nullable(),      // stripe-only audit; null for marketplace
  stripeSubscriptionId: z.string().nullable(),
  organizationId: z.string().nullable(),
  resultingTier: z.string().nullable(),
  outcome: CommercialEventOutcomeSchema,
});
// CommercialEventModel / …Factory mirror the current StripeEvent* classes.
```

**`apps/api/src/db/schema/commercial-events.table.ts`** (renamed from `stripe-events.table.ts`):

```ts
export const commercialEvents = pgTable("commercial_events", {
  ...baseColumns,
  source: text("source", { enum: ["stripe", "aws_marketplace"] }).notNull(),
  externalId: text("external_id").notNull(),
  type: text("type").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  organizationId: text("organization_id").references(() => organizations.id),
  resultingTier: text("resulting_tier"),
  outcome: text("outcome", { enum: ["applied","noop","unmatched","ignored","foreign"] }).notNull(),
}, (t) => [
  unique("commercial_events_source_external_id_unique").on(t.source, t.externalId), // dedup arbiter
  check("commercial_events_source_check", sql`${t.source} IN ('stripe','aws_marketplace')`),
  check("commercial_events_outcome_check", sql`${t.outcome} IN ('applied','noop','unmatched','ignored','foreign')`),
]);
```

**`apps/api/src/db/repositories/commercial-events.repository.ts`** — `insertIfNew(row, client)` with `onConflictDoNothing({ target: [commercialEvents.source, commercialEvents.externalId] })`. Singleton `commercialEventsRepo`; `DbService.repository.commercialEvents` (was `.stripeEvents`).

**Row builder** — generalize `BillingService.eventRow` to write a `CommercialEventInsert` with `source: "stripe"` and `externalId: event.id`; add a parallel builder the marketplace source uses (`source: "aws_marketplace"`, `externalId: notification.MessageId`). Both keep the existing `{ organizationId, resultingTier, outcome }` shape.

**`tier-grant.service.ts`** — the only edits: `EventRow` alias points at the new builder's return type; `apply`'s two `DbService.repository.stripeEvents.insertIfNew` calls → `commercialEvents`. The seam contract (`TierGrantSource`, `GrantResolution`, `apply`) is **unchanged**. `StripeGrantSource` changes only in the row it builds (adds `source: "stripe"`, `externalId`).

### B. Org columns

**`apps/api/src/db/schema/organizations.table.ts`** — add:

```ts
marketplaceEntitlementId: text("marketplace_entitlement_id"),  // AWS CustomerIdentifier
entitlementThrough: timestamp("entitlement_through", { withTimezone: true }), // the term end; null = not marketplace-granted
// constraint:
unique("organizations_marketplace_entitlement_id_unique").on(t.marketplaceEntitlementId), // #230 analog
```

**`packages/core/src/models/organization.model.ts`** — add `marketplaceEntitlementId: z.string().nullable()`, `entitlementThrough: z.date().nullable()` (or the repo's timestamp representation — match the existing `baseColumns` date handling).

**`organizations.repository.ts`** — add `findByMarketplaceEntitlementId(id, client)` mirroring `findByStripeCustomerId:37-52`.

### C. `MarketplaceService` + `AwsMarketplaceGrantSource`

**`apps/api/src/services/marketplace.service.ts`** (new):

```ts
export class MarketplaceService {
  static isConfigured(): boolean;   // AWS_MARKETPLACE_PRODUCT_CODE present
  /** Converge read — the calling AWS account's current entitlement. */
  static getEntitlement(): Promise<{
    customerIdentifier: string;
    dimension: string;
    expirationDate: Date | null;
  } | null>;   // null = no active entitlement (expired/unsubscribed)
}
```

Wraps `MarketplaceEntitlementServiceClient.GetEntitlements({ ProductCode })`. `dimensionToTier(dimension): TierSlug` maps the product dimension → `enterprise` (single flat dimension for v1; a map keyed by dimension for future SKUs).

**`apps/api/src/services/tier-grant.service.ts`** — add `AwsMarketplaceGrantSource implements TierGrantSource<MarketplaceNotification>`:

- `idempotencyKey(n) = n.MessageId`.
- `resolve(n)`: `MarketplaceService.getEntitlement()` (converge read) → resolve the install's single org (`ApplicationService`/the seeded residency org) → **foreign-guard**: if `org.marketplaceEntitlementId` is set and `!== customerIdentifier` → `foreign`. Else `grant` with `orgUpdate = { tier: dimensionToTier(dimension), entitlementThrough: expirationDate, marketplaceEntitlementId: customerIdentifier, updated, updatedBy: system }`; `changed` computed vs current org. A **null** entitlement (expired) → `grant` writing `entitlementThrough` in the past (or the returned expiry) so the derived read-only flips, **tier unchanged** (never data loss). `changed` false → `noop`.

`MarketplaceNotification` (the parsed SNS `Message`) shape is defined in `packages/core/src/models/` alongside the model, with the fields the handler reads (`action`, `customer-identifier`, `product-code`).

### D. SNS webhook route

**`apps/api/src/routes/webhook.router.ts`** — add, mounted under the existing `/api/webhooks` (pre-auth, `app.ts:38`):

- `POST /api/webhooks/aws-marketplace` — `express.raw` / `jsonWithRawBody` to preserve bytes; **verify the SNS signature** (X.509, via a maintained validator); handle message types: `SubscriptionConfirmation` → GET the `SubscribeURL` to confirm; `Notification` → parse `Message` → `TierGrantService.apply(new AwsMarketplaceGrantSource(), notification)`. Gated by `if (MarketplaceService.isConfigured())` (mirrors the `isSaas()` gate on the Stripe route); a POST when unconfigured 404s.
- Non-error outcomes → 200 (stop redelivery); processing errors → 500 (SNS retries). `@openapi` block referencing a registered `AwsMarketplaceNotification` component.

### E. `requireOrgWritable` + term-derived read-only

**`apps/api/src/middleware/require-org-writable.middleware.ts`** (new), attached at `protected.router.ts:32` right after `protectedRouter.use(jwtCheck)`:

```ts
export const requireOrgWritable = async (req, res, next) => {
  if (["GET","HEAD","OPTIONS"].includes(req.method)) return next();
  if (WRITABLE_EXEMPT_PATHS.some(p => req.path.startsWith(p))) return next();
  const org = await ApplicationService.getCurrentOrganization(userId).catch(() => null);
  if (org && isEntitlementExpired(org, Date.now())) {
    return next(new ApiError(ApiCode.ORG_ENTITLEMENT_EXPIRED, 403, …));
  }
  next();
};
export const isEntitlementExpired = (org, now) =>
  org.entitlementThrough != null && org.entitlementThrough.getTime() < now;
```

`isEntitlementExpired` is a pure exported helper (unit-testable without a request). `WRITABLE_EXEMPT_PATHS` starts empty (or minimal); the read-only org keeps full **read** access — never data loss.

### F. Error codes

**`apps/api/src/constants/api-codes.constants.ts`** — add (with message-map entries):

- `ORG_ENTITLEMENT_EXPIRED` — 403, a mutating request against a read-only (lapsed-entitlement) org.
- `MARKETPLACE_NOT_CONFIGURED` — 404/503 guard on the marketplace route when unconfigured.
- `MARKETPLACE_SIGNATURE_INVALID` — 400, SNS signature verification failed.

## Migration

`cd apps/api && npm run db:generate -- --name commercial_events_and_marketplace_entitlement`, one migration (template: `drizzle/0068_add_stripe_billing_columns_and_events.sql`), in order:

1. `ALTER TABLE stripe_events RENAME TO commercial_events;` `RENAME COLUMN event_id TO external_id;` `ADD COLUMN source text NOT NULL DEFAULT 'stripe';` drop the old `stripe_events_event_id_unique`, add `commercial_events_source_external_id_unique (source, external_id)` + the source CHECK. (No data loss; existing rows → `source='stripe'`.)
2. `ALTER TABLE organizations ADD COLUMN marketplace_entitlement_id text;` `ADD COLUMN entitlement_through timestamptz;` add the UNIQUE-where-not-null on `marketplace_entitlement_id`.

**Commit the drizzle journal + snapshot** with the `.sql` (per `project_drizzle_journal_must_be_committed`). Rename preserves dev rows; no backfill beyond the `source` default.

## Seed

None new — `enterprise` is already in `tier-catalog.ts` and seeded by the tier seed (global, safe to re-run).

## TDD test plan

Run via `cd apps/api && npm run test:unit` / `npm run test:integration` (never raw jest — `feedback_use_npm_test_scripts`).

### Layer 1 — core models (`packages/core`, `cd packages/core && npm run test:unit`)
1. `CommercialEventSchema` parses a stripe row (`source:"stripe"`) and a marketplace row (`source:"aws_marketplace"`); rejects an unknown `source`/`outcome`.
2. `OrganizationSchema` now includes `marketplaceEntitlementId`/`entitlementThrough` (nullable) and still parses a full org.

### Layer 2 — schema / repo / type-checks (integration)
3. `commercial_events` insert + dedup: two inserts of the same `(source, external_id)` → one row; **different `source`, same `external_id` → two rows** (the arbiter is the pair).
4. `insertIfNew` returns `false` on the conflicting redelivery.
5. Dual-schema guards compile for `CommercialEvent` + updated `Organization`.
6. `organizations.marketplace_entitlement_id` UNIQUE rejects a duplicate non-null; two nulls allowed.
7. `findByMarketplaceEntitlementId` round-trips; excludes soft-deleted.

### Layer 3 — services (unit, mocked deps)
8. `MarketplaceService.isConfigured()` true/false on env presence; `getEntitlement` maps a mocked `GetEntitlements` response (dimension + ExpirationDate); returns `null` on an empty entitlement.
9. `dimensionToTier` maps the flat dimension → `enterprise`; unknown dimension → a defined fallback/throw.
10. `AwsMarketplaceGrantSource.resolve`: fresh entitlement → `grant` with `{ tier:"enterprise", entitlementThrough, marketplaceEntitlementId }`, `changed:true`.
11. `resolve` when nothing changed → `changed:false` (→ `apply` returns `noop`).
12. `resolve` **foreign-guard**: org tracks a different `marketplaceEntitlementId` → `foreign`.
13. `resolve` on an **expired/null** entitlement → `grant` setting `entitlementThrough` in the past, **tier unchanged** (read-only via derivation, no data loss).
14. `TierGrantService.apply(new AwsMarketplaceGrantSource(), n)` reuses the D2 transaction: redelivered `MessageId` → `duplicate` (single row); the Stripe path still returns `applied|noop|foreign|unmatched|duplicate` unchanged (regression).
15. `isEntitlementExpired`: null term → false; future term → false; past term → true.

### Layer 4 — route + middleware (integration)
16. `POST /api/webhooks/aws-marketplace` `SubscriptionConfirmation` → confirms (mocked `SubscribeURL` GET), 200.
17. `Notification` with a valid signature → dispatches `apply`, 200; **invalid signature → 400 `MARKETPLACE_SIGNATURE_INVALID`**, no dispatch.
18. Route 404s when `MarketplaceService.isConfigured()` is false.
19. `requireOrgWritable`: a `GET` on a read-only org passes; a `POST/DELETE` on a read-only org → **403 `ORG_ENTITLEMENT_EXPIRED`**; a `POST` on a writable org passes; a `POST` with no resolvable org passes.
20. End-to-end: seed an org, POST a marketplace `Notification` whose entitlement resolves `enterprise` + future term → `org.tier="enterprise"`, `entitlementThrough` set, writes allowed; POST an expiry `Notification` → writes now 403, reads still 200.

**Totals:** ~2 core, ~5 integration-schema, ~8 service, ~5 route/middleware ≈ **20 cases**.

## Acceptance criteria

- [ ] A (mocked) AWS Marketplace subscription resolves to `org.tier = "enterprise"` through `AwsMarketplaceGrantSource` — **no Stripe object touched** (`StripeService.isConfigured()` may be false).
- [ ] Entitlement **expiry flips the org read-only** (mutations 403 `ORG_ENTITLEMENT_EXPIRED`, reads unaffected); **renewal restores** writes; **never data loss**.
- [ ] Redelivered SNS notifications are **idempotent** — single `commercial_events` row, `apply` returns `duplicate`.
- [ ] The foreign-guard records `foreign` when an org tracks a different `marketplaceEntitlementId`.
- [ ] The Stripe rail is unchanged end-to-end (all existing billing/tier-grant tests green); `commercial_events` holds pre-existing rows as `source='stripe'`.
- [ ] SNS signature verification rejects a forged notification; the route 404s when the marketplace isn't configured.
- [ ] `npm run lint && npm run type-check` clean; `npm run db:migrate` on a fresh DB yields `commercial_events` + the org columns.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| The rename breaks the live Stripe path. | Slice 1 renames + reruns the full Stripe/tier-grant suite green before any marketplace code; `apply`/`TierGrantSource` contract untouched. |
| **Fail-mode of the write-gate.** A read-only org must **fail-closed on writes**. But a transient org-load failure in the middleware must not 403 every mutation for a healthy org. | `getCurrentOrganization().catch(() => null)` → a load failure **passes** (fail-open on the *lookup*, since inability to prove expiry ≠ expired); only a *definitively* lapsed term 403s. Reads never gated. |
| Degrading on a transient `GetEntitlements` blip. | The source only writes `entitlementThrough` from a **definitive** converge read; an AWS error throws → `apply` errors → 500 → SNS retries, org untouched. |
| SNS signature bypass. | X.509 verification via a maintained validator (never trust the topic ARN alone); test 17 asserts a forged message is rejected. |
| Enforcement breadth wrong (too broad blocks a legit write; too narrow leaks). | `WRITABLE_EXEMPT_PATHS` + method allow-list are explicit and reviewed; blanket-non-GET is the fail-closed default. **Flagged for review.** |

**Rollback:** `git revert` + a down-migration renaming `commercial_events` back and dropping the org columns. No prod data (project memory); the rename is reversible.

## Files touched

**`packages/core`** — rename `models/stripe-event.model.ts` → `commercial-event.model.ts` (+ `source`); edit `models/organization.model.ts`, `models/index.ts`; new `MarketplaceNotification` model; tests.

**`apps/api`** — rename `db/schema/stripe-events.table.ts` → `commercial-events.table.ts`, `db/repositories/stripe-events.repository.ts` → `commercial-events.repository.ts`; edit `db/schema/organizations.table.ts`, `db/schema/zod.ts`, `db/schema/type-checks.ts`, `db/schema/index.ts`, `db/repositories/index.ts`, `db/repositories/organizations.repository.ts`, `services/db.service.ts`, `services/tier-grant.service.ts` (+ `AwsMarketplaceGrantSource`), `services/billing.service.ts` (`eventRow` → source), `routes/webhook.router.ts`, `routes/protected.router.ts`, `constants/api-codes.constants.ts`; new `services/marketplace.service.ts`, `middleware/require-org-writable.middleware.ts`, the migration, and tests. New dep `@aws-sdk/client-marketplace-entitlement-service` + an SNS-validator.

**`docs`** — new durable `docs/AWS_MARKETPLACE.runbook.md` (listing + SNS-topic + product-code setup).

## Next step

`docs/AWS_MARKETPLACE.plan.md` — TDD slices: (1) rename `stripe_events` → `commercial_events` + `source` (migration + dual-schema; Stripe path green — the whole risk surface for the existing rail, isolated); (2) org `marketplaceEntitlementId` + `entitlementThrough` columns + `findByMarketplaceEntitlementId`; (3) `MarketplaceService` + `AwsMarketplaceGrantSource` (mocked entitlement client); (4) SNS webhook route (verify + confirm + dispatch), gated on config; (5) `requireOrgWritable` + term-derived read-only enforcement + the runbook. Each slice independently green; the marketplace rail is provable end-to-end after slice 4, enforcement after slice 5.
