# Stripe subscription billing — Spec

**Issue:** [EnterpriseBT/portal-ai#176](https://github.com/EnterpriseBT/portal-ai/issues/176) · **Epic:** #177 · **Discovery:** `docs/STRIPE_SUBSCRIPTION_BILLING.discovery.md` · **Branch:** `feat/stripe-subscription-billing` → `epic/subscription-billing`

Drive `organizations.tier` from a real Stripe subscription: a `stripe_price_id` on `tiers` maps prices to slugs, signature-verified webhooks converge the org to the subscription's current state (dedup'd through a `stripe_events` audit table), owner-only checkout/portal endpoints mint hosted-session URLs, usage periods anchor to the subscription's billing cycle, and Settings gains a "Subscription & Billing" actions tab. `resolveTier`, the cost gate's logic, and the `usage` balance are untouched.

## Key decisions (flag for review)

1. **D1 — price↔tier mapping is a `tiers` column** (`stripe_price_id`, nullable, unique). Checkout: tier→price; webhook: price→slug. Both indexed reads.
2. **D2 — dedup + converge-to-source.** A `stripe_events` row is unique-inserted per Stripe event id (atomic across instances); handlers re-fetch the subscription from Stripe and derive tier from **current** state — ordering can't regress the tier. The event row insert and the org write commit in **one transaction**, so a failed handler retries cleanly (rollback removes the dedup row).
3. **D3 — tier derivation status table (PRD-confirmed):** `active`/`trialing` → mapped tier; `past_due` → keep paid tier (Stripe dunning owns grace); `canceled`/`unpaid`/`incomplete_expired`/deleted → `standard`, clear subscription id + anchor (customer id stays).
4. **D4 — hosted Checkout + Billing Portal only** (SAQ-A). The webhook, never the redirect, writes the tier.
5. **D5 — Billing tab is actions-only** (user call): current plan context, plan list, checkout/manage. The Organization tab's #172 usage display is untouched. Managed (custom-tier, no-subscription) orgs see a notice; self-serve hidden **and server-blocked**.
6. **D6 — `selectable` boolean on `tiers`.** Plan list = `selectable = true`; custom tiers are unlisted rows (Stripe-driven via bespoke price, or CLI-assigned — no subscription → no webhook → never clobbered).
7. **D7 — lazy customer creation** at first checkout.
8. **Q1 — one live subscription per org:** checkout 409s (`BILLING_ALREADY_SUBSCRIBED`) when `stripe_subscription_id` is set; plan changes happen in the portal.
9. **Q2 — unknown customer → record `unmatched` + 200-ack** (never a retry loop for unprocessable events).
10. **Q4 — org delete cancels the subscription immediately, best-effort** (post-commit, like S3 cleanup — a Stripe outage never blocks deletion).
11. **Q5 — per-org billing anchor:** `organizations.billing_anchor_day` (webhook-written, clamped ≤ 28, cleared on revert); `TierService.periodIdFor` gains an org override applied at its two call sites — **not** baked into the slug-keyed policy cache.
12. **Q6/Q7 — per-env keys (test mode off-prod); prices fetched from Stripe with a 60 s TTL cache** (Stripe is the single price authority; outage degrades the display only).
13. **#214 contract-shaping:** nothing here assumes a tier differs only by allocation numbers; `GET /api/billing/tiers` returns whole-tier objects so entitlements later add a field, not a reshape.

## Scope

### In scope

1. Columns: `tiers.stripe_price_id` + `tiers.selectable`; `organizations.stripe_customer_id` / `stripe_subscription_id` / `billing_anchor_day` — dual-schema.
2. `stripe_events` table + model + repository (atomic dedup + audit trail — #172 Q6's first writer).
3. `StripeService` (SDK wrapper, API-version-pinned) + `BillingService` (pure derivation + endpoint logic) + webhook handler.
4. `POST /api/webhooks/stripe` (raw-body, signature-verified, JWT-exempt).
5. `GET /api/billing/tiers`, `POST /api/billing/checkout`, `POST /api/billing/portal` + `sdk.billing.*`.
6. `periodIdFor` org-anchor override threading (both call sites).
7. Org-delete best-effort subscription cancellation.
8. Settings → "Subscription & Billing" tab (states: unsubscribed / subscribed / managed / non-owner).
9. Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (+ `.env.example`); `stripe` npm dependency (apps/api only).

### Out of scope

- Tier model/allocations/usage (#172); cost enforcement (#169); usage-based Stripe billing; the per-call ledger (#179).
- Toolpack entitlements — #214 (contract kept open here, nothing built).
- Entitlement/price admin UI; refunds/invoices/tax (Stripe-hosted); RBAC widening (#198).

## Surface

### Core models (`packages/core`)

**`models/organization.model.ts`** — `OrganizationSchema` adds:

```ts
/** Stripe linkage (#176). Null until first checkout / while unsubscribed. */
stripeCustomerId: z.string().nullable().default(null),
stripeSubscriptionId: z.string().nullable().default(null),
/** Billing-cycle anchor day (1–28, webhook-written; null = calendar month). */
billingAnchorDay: z.number().int().min(1).max(28).nullable().default(null),
```

These auto-flow to `OrganizationGetResponse` (same mechanism as `tier` in #172); the ids are opaque and non-secret.

**`models/tier.model.ts`** — `TierSchema` (row shape) adds:

```ts
/** Stripe price mapped to this tier. Null = not purchasable (standard, bespoke). */
stripePriceId: z.string().nullable(),
/** Listed in the self-serve plan list. Custom/enterprise rows are false. */
selectable: z.boolean(),
```

`TierPolicySchema` is **unchanged** (the gate-facing contract; #214 extends it later).

**`models/stripe-event.model.ts`** (new) — `StripeEventSchema = CoreSchema.extend({...})`:

```ts
eventId: z.string(),                                  // Stripe evt_… id — the dedup key
type: z.string(),                                     // e.g. "customer.subscription.updated"
stripeCustomerId: z.string().nullable(),
stripeSubscriptionId: z.string().nullable(),
organizationId: z.string().nullable(),                // null when unmatched
resultingTier: z.string().nullable(),                 // tier written (null if none)
outcome: z.enum(["applied", "noop", "unmatched", "ignored"]),
```

(`applied` = tier/anchor written; `noop` = converged with no change; `unmatched` = Q2; `ignored` = non-subscription event type that carried a signature we verified but don't handle.) `StripeEventModel`/`Factory` mirror `TierModel`.

**`contracts/billing.contract.ts`** (new), re-exported from `contracts/index.ts`:

```ts
export const BillingTierSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  allocations: TierPolicySchema.shape.allocations,
  purchasable: z.boolean(),                            // stripePriceId present
  price: z.object({
    unitAmount: z.number().int(),                      // cents
    currency: z.string(),
    interval: z.enum(["month", "year"]),
  }).nullable(),                                       // null: not purchasable OR price fetch degraded
});
export const BillingTiersGetResponseSchema = z.object({ tiers: z.array(BillingTierSchema) });
export const BillingCheckoutRequestSchema = z.object({ tier: z.string() });
export const BillingCheckoutResponseSchema = z.object({ url: z.string() });
export const BillingPortalResponseSchema = z.object({ url: z.string() });
```

`purchasable` is distinct from `price` so a Stripe outage (price `null`) can't be confused with "not for sale".

### Drizzle tables (`apps/api/src/db/schema/`)

**`tiers.table.ts`** — add columns + constraint:

```ts
stripePriceId: text("stripe_price_id"),
selectable: boolean("selectable").notNull().default(false),
// …
unique("tiers_stripe_price_id_unique").on(t.stripePriceId),  // PG UNIQUE ignores NULLs — "unique where not null"
```

**`organizations.table.ts`** — add:

```ts
stripeCustomerId: text("stripe_customer_id"),
stripeSubscriptionId: text("stripe_subscription_id"),
billingAnchorDay: integer("billing_anchor_day"),
// table extras:
unique("organizations_stripe_customer_id_unique").on(t.stripeCustomerId),
unique("organizations_stripe_subscription_id_unique").on(t.stripeSubscriptionId),
check("organizations_anchor_day_check", sql`${t.billingAnchorDay} IS NULL OR ${t.billingAnchorDay} BETWEEN 1 AND 28`),
```

**`stripe-events.table.ts`** (new):

```ts
export const stripeEvents = pgTable("stripe_events", {
  ...baseColumns,
  eventId: text("event_id").notNull(),
  type: text("type").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  organizationId: text("organization_id").references(() => organizations.id),
  resultingTier: text("resulting_tier"),
  outcome: text("outcome").notNull(),
}, (t) => [
  unique("stripe_events_event_id_unique").on(t.eventId),   // FULL unique — the atomic dedup key
  check("stripe_events_outcome_check", sql`${t.outcome} IN ('applied', 'noop', 'unmatched', 'ignored')`),
]);
```

drizzle-zod (`zod.ts`) + `type-checks.ts` gain the `StripeEvent` entries; the `Tier`/`Organization` pairs cover the new columns automatically.

### `StripeEventsRepository` (`db/repositories/stripe-events.repository.ts`, new)

```ts
/** Atomic dedup: INSERT … ON CONFLICT (event_id) DO NOTHING; returns false when the id was already recorded. */
async insertIfNew(row: StripeEventInsert, client: DbClient = db): Promise<boolean>
```

Registered in `repositories/index.ts` + `DbService.repository`.

### `StripeService` (`services/stripe.service.ts`, new — the only file importing `stripe`)

```ts
static isConfigured(): boolean                          // both env keys present
static client(): Stripe                                 // lazy singleton; apiVersion pinned as a const
static constructEvent(rawBody: Buffer, signature: string): Stripe.Event
  // throws ApiError(400, WEBHOOK_INVALID_SIGNATURE) on verification failure (fail-closed)
static fetchSubscription(id: string): Promise<Stripe.Subscription>          // the converge read
static createCheckoutSession(args: { customerId: string; priceId: string; successUrl: string; cancelUrl: string; organizationId: string }): Promise<{ url: string }>
static createCustomer(args: { organizationId: string; name: string }): Promise<{ id: string }>   // metadata.organizationId set for reconciliation
static createPortalSession(args: { customerId: string; returnUrl: string }): Promise<{ url: string }>
static cancelSubscription(id: string): Promise<void>    // immediate cancel (org delete)
static getPrice(priceId: string, now?: number): Promise<{ unitAmount: number; currency: string; interval: "month" | "year" } | null>
  // 60 s in-process TTL cache; returns null (never throws) on Stripe failure — display degradation only
```

### `BillingService` (`services/billing.service.ts`, new)

```ts
/** PURE — the Decision-3 status table. No I/O. */
static deriveTierFromSubscription(
  sub: { status: string; priceId: string | null; billingCycleAnchor: number /* unix s */ },
  priceIndex: Map<string, string>,          // stripe_price_id → tiers.slug
  currentTier: string,
): { tier: string; subscriptionLive: boolean; anchorDay: number | null }
// active|trialing + known price   → { tier: mapped, subscriptionLive: true, anchorDay: min(UTC day of anchor, 28) }
// active|trialing + unknown price → { tier: currentTier, subscriptionLive: true, anchorDay: min(…, 28) }  + warn log
// past_due                        → { tier: currentTier, subscriptionLive: true, anchorDay: min(…, 28) }
// canceled|unpaid|incomplete_expired (or deleted event) → { tier: "standard", subscriptionLive: false, anchorDay: null }

/** Webhook entry. Re-fetches the subscription (converge), then in ONE transaction:
 *  stripeEvents.insertIfNew (false → return "duplicate", no further work) + the org UPDATE
 *  (tier, stripe_subscription_id or null, billing_anchor_day or null). Unmatched customer →
 *  record outcome "unmatched", warn, return. Never throws for unmatched/duplicate; throws
 *  (→ 500 → Stripe retry) on DB/Stripe-fetch failure. */
static async handleSubscriptionEvent(event: Stripe.Event): Promise<"applied" | "noop" | "unmatched" | "duplicate">
```

### Webhook route (`routes/webhook.router.ts` — extend)

**`POST /api/webhooks/stripe`** — mounted inside the existing pre-`express.json()` webhook router (`app.ts:36`):

```ts
webhookRouter.post("/stripe", express.raw({ type: "application/json" }), handler)
```

Flow: `503 WEBHOOK_MISSING_SECRET` if unconfigured → `StripeService.constructEvent(req.body, req.headers["stripe-signature"])` (400 `WEBHOOK_MISSING_SIGNATURE`/`WEBHOOK_INVALID_SIGNATURE` — existing codes) → event type in `customer.subscription.{created,updated,deleted}` → `BillingService.handleSubscriptionEvent`; other types → record `ignored` (dedup'd) → **200 `{ received: true }` for every non-error outcome** (applied/noop/unmatched/duplicate/ignored). Handler exceptions → `next(ApiError(500, WEBHOOK_SYNC_FAILED))` so Stripe retries. Full `@openapi` block per house style.

### Billing router (`routes/billing.router.ts`, new — mounted on `protectedRouter` at `/billing`)

All three routes resolve the caller's current org (same helper the organization router uses). Owner = `org.ownerUserId === callerUserId`.

| Route | Auth | Behavior |
|---|---|---|
| `GET /api/billing/tiers` | any member | `tiers` rows `selectable = true` (live), mapped to `BillingTierSchema`; `price` via `StripeService.getPrice` (null on degradation). |
| `POST /api/billing/checkout` | **owner** | Guards in order: configured (`503 BILLING_NOT_CONFIGURED`) → owner (`403 BILLING_NOT_OWNER`) → not already subscribed (`409 BILLING_ALREADY_SUBSCRIBED`) → current tier not managed-custom, i.e. org has no subscription AND its tier row is `selectable = false` → `409 BILLING_TIER_MANAGED` → body tier exists+selectable+priced (`404 BILLING_TIER_NOT_FOUND` / `400 BILLING_TIER_NOT_PURCHASABLE`) → lazy-create customer (persist `stripe_customer_id`) → session with `success_url`/`cancel_url` = `${environment.CORS_ORIGIN}/settings?billing={success,cancelled}` → `200 { url }`. Stripe API failure → `502 BILLING_CHECKOUT_FAILED`. |
| `POST /api/billing/portal` | **owner** | configured → owner → `stripe_customer_id` present (`409 BILLING_NO_SUBSCRIPTION`) → portal session (`return_url` = settings) → `200 { url }`. Stripe failure → `502 BILLING_PORTAL_FAILED`. |

### Error codes (`constants/api-codes.constants.ts` — new `// Billing (#176)` block)

`BILLING_NOT_CONFIGURED` (503) · `BILLING_NOT_OWNER` (403) · `BILLING_ALREADY_SUBSCRIBED` (409) · `BILLING_TIER_MANAGED` (409) · `BILLING_TIER_NOT_FOUND` (404) · `BILLING_TIER_NOT_PURCHASABLE` (400) · `BILLING_NO_SUBSCRIPTION` (409) · `BILLING_CHECKOUT_FAILED` (502) · `BILLING_PORTAL_FAILED` (502). Webhook path reuses the existing `WEBHOOK_*` codes.

### `periodIdFor` org-anchor override

**`services/tier.service.ts`** — signature gains an optional override (backward-compatible):

```ts
static periodIdFor(period: TierPolicy["period"], at: Date, anchorDayOverride?: number | null): string
// effective anchor = anchorDayOverride ?? period.anchorDay
```

Both call sites thread the org's value: `cost-gate.service.ts:223` and `usage.service.ts:113` pass `org.billingAnchorDay`. The policy cache stays slug-keyed and override-free (Q5).

### Org delete (`services/organization-delete.service.ts`)

`deleteOrganization` reads the org row before the cascade; **after** the transaction commits (beside `cleanupS3`), if `stripeSubscriptionId` was set: `StripeService.cancelSubscription(id)` in try/catch — failure logs `warn` with the ids for manual reconciliation and never throws. Tombstoned row keeps both Stripe ids.

### Environment + dependency

`environment.ts`: `STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET` (pattern: `AUTH0_WEBHOOK_SECRET`, line 24). Both documented in `apps/api/.env.example` with a local-dev note (`stripe listen --forward-to localhost:3001/api/webhooks/stripe`). New dep: `stripe` in `apps/api/package.json`; the pinned `apiVersion` is a named const in `stripe.service.ts`.

### Frontend (`apps/web`)

- **`api/billing.api.ts`** (new): `tiers` (`useAuthQuery`, key `queryKeys.billing.tiers()`), `checkout` / `portal` (`useAuthMutation`, POST). `keys.ts` gains `billing: { root, tiers() }`. `sdk.ts` composes `billing`.
- **`components/SubscriptionBilling.component.tsx`** (new — container + `SubscriptionBillingUI` per the Component File Policy): consumes `sdk.billing.tiers()`, `sdk.organizations.current()`, and hands the UI: current plan name, plan cards, and callbacks that `window.location.replace(url)` on checkout/portal responses (precedent `auth.api.ts:18`). Mutations' errors surface via `toServerError` + `<FormAlert>`.
- **`views/Settings.view.tsx`**: third tab `Subscription & Billing` rendering the container. State derivation (from data already on hand):
  - `subscribed` = `organization.stripeSubscriptionId != null` → current plan + **Manage subscription** (portal); plan list hidden.
  - `managed` = `!subscribed && organization.tier ∉ tiers[].slug` (not in the selectable list) → plan name + "Your plan is managed — contact us" notice; no plan list, no buttons.
  - otherwise → plan list with per-tier **Subscribe** buttons (`purchasable` only; price row shows "—" when `price` is null-degraded).
  - non-owner (`profile.user.id !== organization.ownerUserId`) → buttons `disabled` + tooltip "Only the organization owner can manage billing".
  - On mount with `?billing=success`: toast ("Subscription confirmed — your plan updates within a few seconds") + `invalidateQueries(queryKeys.organizations.root)`; `?billing=cancelled` → neutral toast. The **webhook** is the writer; the redirect only refreshes.

### OpenAPI

Register `BillingTiersGetResponse`, `BillingCheckoutRequest`, `BillingCheckoutResponse`, `BillingPortalResponse` in `swagger.config.ts` (`z.toJSONSchema` from the contracts); `@openapi` blocks on all four routes (webhook + three billing).

## Migration

`cd apps/api && npm run db:generate -- --name add_stripe_billing_columns_and_events`:

1. `ALTER TABLE tiers` — add `stripe_price_id` (+ UNIQUE), `selectable NOT NULL DEFAULT false`.
2. Hand-added backfill: `UPDATE tiers SET selectable = true WHERE slug = 'standard';` (the plan list must show the free plan from day one).
3. `ALTER TABLE organizations` — add the three nullable columns + two UNIQUEs + anchor CHECK. Nullable ⇒ no backfill; every existing org stays calendar-month, unsubscribed.
4. `CREATE TABLE stripe_events` with the full UNIQUE on `event_id`.

No FK ordering hazards (no new FK-defaulted columns). Rollback = drop table + columns; data-lossless pre-launch.

## Seed

`seed.service.ts` `seedTiers`: the `standard` row now seeds `selectable: true`, `stripePriceId: null` (idempotent — update-if-changed on existing rows so already-seeded DBs converge). No new tier rows are seeded; paid tiers are created as data when real prices exist (D1).

## TDD test plan

Per-package npm scripts only (`npm run test:unit` / `test:integration`).

### Layer 1 — core models & contracts (`packages/core`)

1. `OrganizationSchema` parses with the three new nullable fields defaulted; rejects `billingAnchorDay: 29`/`0`.
2. `TierSchema` round-trips `stripePriceId: null` + `selectable`; rejects a missing `selectable`.
3. `StripeEventSchema` accepts each `outcome`; rejects an unknown one.
4. `BillingTierSchema`: `purchasable: true` with `price: null` is valid (degraded display); `TierPolicySchema` unchanged (compile-time: no new fields).
5. Billing request/response contracts parse representative payloads.

### Layer 2 — schema & repository integration (`apps/api` integration)

6. `tiers.stripe_price_id` UNIQUE rejects a duplicate; **allows multiple NULLs**.
7. `organizations` UNIQUEs reject duplicate customer/subscription ids; anchor CHECK rejects 0/29.
8. `stripeEvents.insertIfNew` returns true then false for the same `event_id`; concurrent double-insert yields exactly one row.
9. Dual-schema type-checks compile for all three entities.

### Layer 3 — services (unit; Stripe SDK mocked)

10. `deriveTierFromSubscription`: the six status-table rows (active/known, active/unknown-price→keep+warn, trialing, past_due→keep, canceled→standard+clear, unpaid→standard+clear).
11. Anchor clamp: `billing_cycle_anchor` on the 31st → `anchorDay = 28`; terminal → `null`.
12. `periodIdFor` override: override null → tier anchor (existing behavior, regression); override 15 with `at` on the 14th → previous month's period; on the 15th → current.
13. `StripeService.getPrice`: caches within TTL (one SDK call for two reads); returns null on SDK throw.
14. `handleSubscriptionEvent`: applied (org updated + event row, one transaction); duplicate (insertIfNew false → no org write, no Stripe fetch beyond converge — assert short-circuit); unmatched (org untouched, outcome row written, resolves — no throw); DB failure mid-transaction → throws and **no** event row survives (rollback → retryable).
15. Checkout guards, in order: unconfigured 503; non-owner 403; already-subscribed 409; managed-custom 409; unknown tier 404; unpurchasable (selectable but `stripe_price_id` null) 400.
16. Checkout happy path: no customer → `createCustomer` called once, id persisted, session URL returned; existing customer → no create.
17. Portal: no customer 409; happy path returns URL; Stripe failure 502.
18. Org delete: subscription present → `cancelSubscription` called after commit; cancel throws → delete still succeeds (warn logged); no subscription → no call.

### Layer 4 — webhook route (integration; SDK mocked)

19. Valid signature + subscription.updated → 200, org tier/anchor written, `stripe_events` row `applied`.
20. Same event id redelivered → 200, single row, org written once.
21. Bad/missing signature → 400, nothing written.
22. Unknown customer → 200, `unmatched` row.
23. Unhandled event type → 200, `ignored` row.
24. Converge fetch failure → 500 (Stripe will retry), no event row (rollback).
25. Route works with **raw body** through the real mounting (posted bytes ≠ re-serialized JSON — signature computed over the exact payload).

### Layer 5 — billing routes (integration)

26. `GET /api/billing/tiers`: returns only `selectable` rows; `standard` present with `purchasable: false`; price populated from mocked Stripe, null when the mock throws.
27. Endpoint auth: 401 unauthenticated; tiers list accessible to a non-owner member; checkout/portal 403 for the same member.

### Layer 6 — web (`apps/web`)

28. Billing tab, unsubscribed owner: plan list renders, Subscribe enabled on purchasable tiers only.
29. Subscribed org: Manage subscription button; no plan list.
30. Managed org (tier not in list, no subscription): notice rendered; no actions.
31. Non-owner: buttons disabled with tooltip.
32. Checkout mutation success → `window.location.replace` called with the URL (mocked); server error renders `<FormAlert>`.
33. `?billing=success` → toast + `invalidateQueries(queryKeys.organizations.root)` (spy via injected queryClient).

### Layer 7 — migration/seed

34. Post-migrate probe: new columns + `stripe_events` exist; `standard.selectable = true` (backfill); existing org rows have null Stripe fields.

**Totals ≈ 34 cases** (5 core, 4 schema, 9 service, 7 webhook, 2 route, 6 web, 1 migration).

## Acceptance criteria

- [ ] All new tests pass; existing suites green; `npm run lint && npm run type-check` clean at root.
- [ ] With Stripe CLI forwarding locally: completing a test-mode checkout flips the org's tier to the mapped slug within seconds (webhook-driven, not redirect-driven), sets `billing_anchor_day` to the subscription anchor (≤ 28), and writes an `applied` `stripe_events` row.
- [ ] Cancelling the subscription (portal or dashboard) reverts the org to `standard`, clears `stripe_subscription_id` + `billing_anchor_day`, keeps `stripe_customer_id`.
- [ ] A `past_due` subscription leaves the paid tier in place; terminal states revert it.
- [ ] Redelivering any webhook event is a no-op (one `stripe_events` row per event id); out-of-order delivery cannot regress the tier (converge).
- [ ] Checkout is owner-only, blocked when already subscribed (409) or on a managed custom tier (409); the portal 409s without a customer.
- [ ] The Billing tab shows the correct one of its four states; the Organization tab's usage display is byte-identical to before.
- [ ] Subscribing mid-month starts a fresh usage period keyed by the new anchor (gate counter and `usage` balance agree — same `periodIdFor`).
- [ ] Org delete cancels an active subscription; a Stripe outage during delete does not block it.
- [ ] Adding a paid tier requires only: a `tiers` INSERT (selectable, priced) + a Stripe price — no deploy.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Webhook processed but org write fails → event marked processed, update lost. | Dedup insert + org UPDATE share one transaction (D2); failure rolls back the dedup row, Stripe retries, converge makes the retry safe. Test 24. |
| Out-of-order events regress the tier. | Converge-to-source: the decision reads Stripe's *current* subscription, never the event snapshot. |
| Signature bypass / forged events. | `constructEvent` fail-closed 400 (fail-closed is the *safe* direction: a dropped genuine event is retried by Stripe for ~3 days; a forged accepted event would write tiers). Test 21/25 (raw-body exactness). |
| Anchor re-keying strands used units (org subscribes mid-period → fresh period row). | Accepted by design (PRD: "you paid, your period starts now") — the abandoned calendar-period row remains as history; allocation resets in the customer's favor. |
| `periodIdFor` override missed at one call site → gate counter and balance diverge. | Both call sites are named in this spec; test 12 covers the helper, and the integration criterion "gate and balance agree" covers the threading. |
| Stripe outage. | Checkout/portal: typed 502s, tier untouched. Webhooks: Stripe queues + retries. Price display: null-degraded. Org delete: best-effort cancel never blocks. `resolveTier` reads our DB — org capability unaffected throughout. |
| Keys absent in an env (fresh dev). | Endpoints 503 `BILLING_NOT_CONFIGURED`; webhook 503s (Stripe retries until configured); app boots fine. |
| Managed-custom org self-serves onto a standard tier, destroying the deal. | Server-blocked (`BILLING_TIER_MANAGED`), not just hidden UI. Test 15. |

**Rollback:** revert the migration (drop `stripe_events`, drop the five columns) + `git revert`; the org rows lose only provider linkage. Pre-launch, no live subscriptions at stake; post-launch, rollback additionally requires cancelling Stripe-side subscriptions manually (they'd otherwise keep billing) — noted as the operational cost of backing out after real customers exist.

## Files touched

**`packages/core`** — new: `models/stripe-event.model.ts`, `contracts/billing.contract.ts`; edit: `models/organization.model.ts`, `models/tier.model.ts`, `models/index.ts`, `contracts/index.ts`; tests.

**`apps/api`** — new: `db/schema/stripe-events.table.ts`, `db/repositories/stripe-events.repository.ts`, `services/stripe.service.ts`, `services/billing.service.ts`, `routes/billing.router.ts`, migration, tests; edit: `db/schema/tiers.table.ts`, `db/schema/organizations.table.ts`, `db/schema/zod.ts`, `db/schema/type-checks.ts`, `db/schema/index.ts`, `db/repositories/index.ts`, `services/db.service.ts`, `services/tier.service.ts` (`periodIdFor` override), `services/usage.service.ts` + `services/cost-gate.service.ts` (threading), `services/organization-delete.service.ts`, `services/seed.service.ts`, `routes/webhook.router.ts`, `routes/protected.router.ts` (mount), `constants/api-codes.constants.ts`, `config/swagger.config.ts`, `environment.ts`, `.env.example`, `package.json` (+`stripe`).

**`apps/web`** — new: `api/billing.api.ts`, `components/SubscriptionBilling.component.tsx`, tests; edit: `api/keys.ts`, `api/sdk.ts`, `views/Settings.view.tsx`.

## Next step

`docs/STRIPE_SUBSCRIPTION_BILLING.plan.md` — likely 5 slices, each a green testable commit: (1) schema + models + repos + seed (columns, `stripe_events`, migration, type-checks); (2) `StripeService` + `BillingService.deriveTierFromSubscription` + `periodIdFor` override threading (pure logic, SDK mocked); (3) webhook route end-to-end (raw-body mount, signature, dedup+converge transaction); (4) billing endpoints + org-delete cancellation + OpenAPI; (5) web — `sdk.billing`, the Subscription & Billing tab's four states, redirect/toast handling. Smoke (`/smoke 176`) will need the Stripe CLI forwarding setup from Q6.
