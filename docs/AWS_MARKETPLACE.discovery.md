# AWS Marketplace listing + entitlement-to-tier adapter — Discovery

**Issue:** [EnterpriseBT/portal-ai#568](https://github.com/EnterpriseBT/portal-ai/issues/568)

**Why this exists.** Enterprise customers buy a client-owned install through **cloud marketplaces only** (AWS first) — no self-hosted broker, no phone-home license server. The commercial mechanism is small because the entitlement stack already reads a single column: `organizations.tier`. #565 lifted the "write `org.tier` from a commercial event" logic out of the Stripe webhook into a narrow **`TierGrantSource`** seam whose transaction owner (`TierGrantService.apply`) is source-agnostic. #568 adds the **second** source: an `AwsMarketplaceGrantSource` that resolves an AWS Marketplace entitlement to a tier, generalizes the Stripe-specific dedup store into a `commercial_events` store, and adds the one net-new concept the residency licensing model needs — an **entitlement term** whose lapse degrades the org to read-only (never data loss).

This is the first enterprise commercial rail: the AWS Marketplace EKS listing on the #566 Helm chart, plus the adapter that turns a marketplace purchase into `org.tier` with no Stripe involvement.

**Confirmed decisions (2026-09-17).** D1 rename `stripe_events` → `commercial_events` **✅ approved**. D2 keep the read-only org, **derived** from `entitlementThrough < now` **✅ approved** (read-only is a genuinely new axis: `org.tier` gates AI/tool quotas, *not* core data writes, so tier-downgrade alone wouldn't stop a lapsed customer from operating — and the install runs in the customer's own account, so the term is the only commercial lever, degrading to read-only rather than to data loss). D4 single-tenant residency model **✅ approved**. D5 SNS signature verification **✅** (lean). **Still open for spec:** D3 — the *breadth* of what the `requireOrgWritable` write-gate covers (open Q1).

## The current shape

### The `TierGrantSource` seam (#565) — the extension point

| Symbol | Location | Role |
|---|---|---|
| `TierGrantSource<E>` | `apps/api/src/services/tier-grant.service.ts:69-74` | Interface: `idempotencyKey(event): string` + `resolve(event): Promise<GrantResolution>` |
| `GrantResolution` | `tier-grant.service.ts:53-62` | Tagged union `unmatched \| foreign \| grant`; grant arm carries `organizationId`, `changed`, `orgUpdate` (column-generic partial write to `organizations`), `eventRow` (dedup row) |
| `TierGrantService.apply<E>(source, event)` | `tier-grant.service.ts:83-117` | Source-agnostic transaction owner: `source.resolve` → on grant, `DbService.transaction` does `stripeEvents.insertIfNew(eventRow, tx)` then `organizations.update(organizationId, orgUpdate, tx)` — **dedup insert + org UPDATE commit-or-rollback together** (the D2 invariant). Returns `applied\|noop\|duplicate\|unmatched\|foreign` |
| `StripeGrantSource` | `tier-grant.service.ts:127-229` | `implements TierGrantSource<Stripe.Event>`; converge re-fetch → `findByStripeCustomerId` → #230 foreign guard → `BillingService.deriveTierFromSubscription` |
| `TierGrantOutcome` | `tier-grant.service.ts:30-35` | Outcome vocabulary |

There is **no registry/DI** — a source is a class instantiated at the webhook call site (`TierGrantService.apply(new StripeGrantSource(), event)`). The doc comment at `tier-grant.service.ts:14-16` says generalizing the dedup store to `commercial_events` "lands with the first non-Stripe source (#568), not here."

### The `stripe_events` dedup store

`apps/api/src/db/schema/stripe-events.table.ts` — columns `eventId` (dedup key), `type`, `stripeCustomerId`, `stripeSubscriptionId`, `organizationId` (FK, nullable), `resultingTier`, `outcome` (text enum `applied|noop|unmatched|ignored|foreign` + DB CHECK, `:33-43`). Dedup arbiter: `unique("stripe_events_event_id_unique").on(t.eventId)` (`:39`). Repo `stripe-events.repository.ts`: `insertIfNew(row, client)` (`:29-39`) is `INSERT … ON CONFLICT (event_id) DO NOTHING … RETURNING`, `false` on redelivery. Core Zod: `packages/core/src/models/stripe-event.model.ts` (`StripeEventOutcomeSchema:24-30`). Rows built by `BillingService.eventRow(event, fields)` (`billing.service.ts:402-416`), public so both `StripeGrantSource` and `recordIgnoredEvent` write identical rows.

### Webhook route + signature verification

`apps/api/src/routes/webhook.router.ts`. The Stripe handler (`:249-309`) is wrapped in `if (isSaas())` — **not registered in residency** (#579), where the marketplace is the entitlement channel (`:246-248`); a residency POST 404s. It uses `express.raw({type:"application/json"})`, reads `stripe-signature`, calls `StripeService.constructEvent` (`stripe.service.ts:70`, throws 400 on mismatch), then dispatches `STRIPE_SUBSCRIPTION_EVENTS.has(event.type) ? TierGrantService.apply(new StripeGrantSource(), event) : recordIgnoredEvent`. Non-error → 200 (stop redelivery); error → 500 (retry). A **second** signature pattern for SNS to mirror: the Auth0 sync webhook (`:119-173`) uses a `jsonWithRawBody` parser capturing `req.rawBody` (`:28-32`) + `verifyWebhookSignature` middleware (HMAC-SHA256, `webhook-auth.middleware.ts`). **No existing SNS code** in the repo.

### `organizations` + tier + enforcement

`organizations.table.ts`: `tier` = `text().notNull().default("standard").references(() => tiers.slug)` (`:23-26`); billing cols `stripeCustomerId`, `stripeSubscriptionId`, `billingAnchorDay` (`:30-32`) with UNIQUE-where-not-null on both stripe ids + anchor CHECK (`:34-44`). Zod: `organization.model.ts:12-25`. **Tier write path is exclusively** `organizations.update(id, orgUpdate, tx)` from `TierGrantService.apply`. Read: `TierService.resolveTier(org, now)` (`tier.service.ts:72-101`, TTL-cached, falls back to `standard`, never throws). `EntitlementService` (`entitlement.service.ts`) reads only `org.tier`. Org repo `findByStripeCustomerId` (`organizations.repository.ts:37-52`) is the model for a new `findByMarketplaceEntitlementId`.

### Org read-only degradation — **does not exist yet**

There is **no** org `status`/`readOnly`/`suspended`/`past_due` field. `authorization.middleware.ts` is JWT-scope gating; `assertWriteCapability` (in `tools/*.tool.ts`) gates connector read-vs-write, not org billing state. `past_due` appears only in `deriveTierFromSubscription` (`billing.service.ts:117-119`) as a Stripe status that *holds* the paid tier. The "expiry → read-only, renewal restores" mechanism is entirely net-new.

### The #230 foreign-guard

Implemented in `StripeGrantSource.resolve` (`tier-grant.service.ts:163-190`): once `org.stripeSubscriptionId` is set, an event with a different subscription id records outcome `foreign` and is skipped. DB-level "one entitlement per org" = the UNIQUE constraints on the two stripe ids (`organizations.table.ts:35-39`). `foreign` is a first-class outcome with integration coverage (`__integration__/db/repositories/stripe-events.repository.integration.test.ts:118`).

### Dual-schema + deploy-mode gate

Pattern: Zod model (`packages/core/src/models/*.model.ts`) → Drizzle table (`apps/api/src/db/schema/*.table.ts`) → drizzle-zod (`db/schema/zod.ts`) → bidirectional `IsAssignable` (`db/schema/type-checks.ts`) → `npm run db:generate`. Org-column exemplar: `drizzle/0068_add_stripe_billing_columns_and_events.sql` (creates `stripe_events` + `ALTER TABLE organizations ADD COLUMN` + UNIQUE + CHECK + a hand-appended backfill). Latest migration ~`0092`. `config/deploy-mode.ts` (#579): `isSaas()`/`isResidency()` + `assertDeployModeConsistency:78-105` (residency must carry **no** Stripe creds + OIDC config). Helm chart: `deploy/helm/portalai/`.

## The design space

### Decision 1 — `commercial_events`: rename in place, or a new table beside `stripe_events`

**A.** Rename `stripe_events` → `commercial_events`, `event_id` → `external_id`, add a `source` discriminator (`stripe|aws_marketplace`), generalize the outcome enum, change the unique to `(source, external_id)`; existing rows default `source='stripe'`. **B.** New `commercial_events` table for marketplace, leave `stripe_events` for Stripe. **C.** Add `source` to `stripe_events` but keep the name.

| | A (rename in place) | B (parallel tables) | C (add col, keep name) |
|---|---|---|---|
| Matches issue ("generalize → commercial_events") | Yes | No | Half |
| Dedup arbiter | `unique(source, external_id)` | two stores | `unique(source, external_id)` |
| Stripe path touched | rename thread-through | untouched | column add |
| "One seam" honesty | high | low (two stores) | low (misnamed) |

**Lean: A.** No production data yet (project memory), so a rename migration with `source='stripe'` default preserves any dev rows cleanly and matches the issue verbatim. Threads `source` through `eventRow`, `insertIfNew`'s conflict target, and the outcome enum — a bounded refactor the seam was designed to accept.

### Decision 2 — org read-only: derive from the term, or a stored flag

**A.** Store `entitlementThrough` (the term end) as the record-of-truth; read-only is **derived** = `entitlementThrough != null && entitlementThrough < now`. **B.** Store an explicit `readOnly` boolean the SNS handler flips. **C.** A `status` enum (`active|read_only|…`).

| | A (derive from term) | B (boolean flag) | C (status enum) |
|---|---|---|---|
| Drift risk (missed SNS) | none — time is truth | flag can lag the term | flag can lag |
| Degrades if expiry SNS never arrives | yes (time check) | no | no |
| Auditability | the term is the durable fact | flag ≠ why | enum ≠ when |
| Columns | `entitlement_through` | `+ read_only` | `+ status` |

**Lean: A.** The entitlement term is the durable record-of-truth (enterprise auditability); read-only as a *function* of it can't drift from what the customer bought, and it degrades correctly even if the expiry notification is missed. SaaS orgs have `entitlementThrough = null` → never read-only. The SNS converge-read just keeps `entitlementThrough` current.

### Decision 3 — write-gate placement & breadth

**A.** A `requireOrgWritable` middleware on the authenticated router for mutating methods (non-GET) that 403s `ORG_ENTITLEMENT_EXPIRED` when the org is read-only. **B.** A check inside each mutation service/tool path. **C.** Gate only the agent tool-write path + the primary entity-mutation routes.

**Lean: A, keyed on the org already loaded for auth.** A single middleware is the one enforcement point (mirrors how the cost gate is one wrap). The read-only check reads `entitlementThrough` from the org the auth layer already resolves — no new failure surface. Read endpoints always pass (never data loss). **Breadth is the open question** (see below): exactly which mutating surfaces it covers.

### Decision 4 — AWS entitlement acquisition + org binding

The marketplace source's `resolve` must converge-read the current entitlement (like `StripeGrantSource` re-fetches the subscription). AWS exposes **Marketplace Entitlement Service `GetEntitlements(ProductCode)`**, returning the calling AWS account's entitlements + `ExpirationDate`. A residency install runs **in the customer's AWS account**, so `GetEntitlements` scoped to the product returns *that* customer's entitlement. Residency is **single-tenant** (one org, seeded per #566/#583), so the grant targets the install's org.

**Lean:** `AwsMarketplaceGrantSource.resolve` calls `GetEntitlements(productCode)` via `@aws-sdk/client-marketplace-entitlement-service`, maps the product dimension → tier (`dimensionToTier`), applies a foreign-guard on `marketplaceEntitlementId` (once an org tracks one entitlement, a different `CustomerIdentifier` is `foreign`), and writes `orgUpdate = { tier, entitlementThrough: ExpirationDate, marketplaceEntitlementId }` for the single install org. Idempotency key = the SNS `MessageId`. Converge-read (not the notification payload) is the source of truth, so out-of-order/duplicate SNS is safe.

### Decision 5 — SNS handler: verification + route gating

AWS Marketplace entitlement-change notifications arrive via **SNS**, which signs messages with an X.509 cert (not HMAC) and sends a `SubscriptionConfirmation` control message. **A.** Validate with an SNS message-validator (`sns-validator`/equivalent) + auto-confirm `SubscriptionConfirmation`, handle `Notification` → `apply()`. **B.** Skip validation (trust the topic ARN) — unacceptable for a billing signal. Gate the route on marketplace-configured (a `MarketplaceService.isConfigured()` mirroring `StripeService.isConfigured()`), which in practice is residency.

**Lean: A.** Verify the SNS signature, confirm the subscription, gate the route on marketplace config presence (mirrors the `isSaas()` gate on the Stripe route). A billing-affecting webhook must verify its source.

## Tradeoff comparison

| | D1 rename | D2 derive term | D3 middleware | D4 converge-read | D5 SNS verify |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes |
| Touches Stripe path | thread `source` | no | no | no | no |
| New external dep | — | — | — | `@aws-sdk/client-marketplace-entitlement-service` | SNS validator |

## Recommendation

1. Rename `stripe_events` → `commercial_events` with a `source` discriminator and `unique(source, external_id)`; thread `source` through `eventRow`/`insertIfNew`/the outcome enum; existing rows default `source='stripe'`.
2. Add `organizations.marketplaceEntitlementId` (UNIQUE-where-not-null, the #230 analog) + `entitlementThrough` (timestamptz, nullable); dual-schema (Zod + Drizzle + type-checks) + one migration modeled on `0068`.
3. Add `AwsMarketplaceGrantSource implements TierGrantSource<SnsNotification>`: `idempotencyKey = MessageId`; `resolve` = `GetEntitlements(productCode)` → `dimensionToTier` → `marketplaceEntitlementId` foreign-guard → `orgUpdate { tier, entitlementThrough, marketplaceEntitlementId }`. Reuse `TierGrantService.apply`'s transaction unchanged.
4. Derive org read-only from `entitlementThrough < now`; add a `requireOrgWritable` middleware returning 403 `ORG_ENTITLEMENT_EXPIRED` on mutating routes; add the `ApiCode`.
5. Add the SNS webhook route (raw body, signature validation, `SubscriptionConfirmation` handling), gated on marketplace config, dispatching `TierGrantService.apply(new AwsMarketplaceGrantSource(), notification)`.
6. Map the flat contract dimension → an `enterprise` (all-`null`/unlimited) tier; ensure that tier is seeded (global tier seed, safe to re-run).
7. The AWS Marketplace EKS product listing on the #566 chart — a console/operator provisioning step (see "what this doesn't decide").

## Open questions

1. **Write-gate breadth.** Does `requireOrgWritable` cover *every* non-GET authenticated route, or the entity-mutation + agent-tool-write surfaces specifically? A blanket non-GET gate is simplest but may catch benign POSTs (e.g. search). **Lean: gate the data-mutation + tool-write paths, allow-list benign non-GET reads** — enumerate at spec time from the router.
2. **Is an `enterprise` unlimited tier already seeded?** The survey confirmed `standard` is seeded; the marketplace maps to `enterprise`. **Lean: add/confirm a global `enterprise` tier (all allocations `null`, `stripeLookupKey: null`) in the tier seed** — global seeds are safe to re-run (unlike per-org seeds, per CLAUDE.md).
3. **Grace period on expiry.** Flip read-only exactly at `entitlementThrough`, or after a grace window? **Lean: exactly at the term** (the term already reflects what the customer bought; a grace period is a contract decision, not a technical default) — revisit if the business wants grace.
4. **SNS validator dependency.** Vendor a small validator vs. pull `sns-validator`. **Lean: a maintained validator lib** (SNS signature verification is security-sensitive; don't hand-roll X.509 chain validation).
5. **Multi-tenant marketplace binding.** If marketplace ever serves a multi-tenant SaaS (not just single-tenant residency), the AWS `CustomerIdentifier` → org mapping needs a registration landing page. **Lean: out of scope — residency is single-org; note the seam accepts it later.**

## Enterprise-scale considerations

- **Concurrency & correctness** — reuse `TierGrantService.apply`'s atomic dedup-insert + org-update transaction; idempotency on the SNS `MessageId` via `unique(source, external_id)`; converge-read (`GetEntitlements`) is the truth, so out-of-order/redelivered SNS is safe. **Lean: no new concurrency machinery.**
- **Accuracy & auditability** — `commercial_events` is the durable event log (every grant decision + outcome, per source); `entitlementThrough` is the durable term. Chargeback/renewal disputes read both. **Engaged.**
- **Failure modes** — **fail-closed on writes** when the term has lapsed (read-only), but degrade **only on a definitive converge-read** (empty/expired entitlement); a *transient* `GetEntitlements` error → `apply` errors → SNS retries (500), the org is **not** degraded on a blip. The write-gate rides the already-loaded org, adding no new failure surface. **Engaged.**
- **Scale & unbounded growth** — `commercial_events` grows per commercial event (low cardinality, a handful per org); same profile as `stripe_events`. Retention is deferrable. **Lean: N/A now.**
- **Multi-tenancy** — marketplace install is single-tenant (one org); the `source` discriminator + `marketplaceEntitlementId` foreign-guard keep an entitlement from clobbering the wrong org. **Engaged.**
- **Contract stability** — `TierGrantSource` is the stable extension point; `commercial_events(source, …)` already anticipates GCP/Azure adapters. Adding a cloud = a new source class, no call-site re-plumbing. **Engaged.**
- **Data lifecycle** — `entitlementThrough` is aligned to the marketplace **contract term** (business semantics), not an arbitrary technical window. **Engaged.**

## What this doesn't decide

- **Creating the actual AWS Marketplace listing** — registering the EKS/container product, the SNS topic, the product code, and seller-account setup are AWS-console/operator tasks the user drives; this ticket delivers the *adapter + handler* the listing calls into, and a runbook. (External-account setup is not code.)
- **GCP / Azure marketplace adapters** — same seam, later, on demand (deferred: no current deal).
- **Usage metering** — flat contract entitlement only; if ever wanted, via the marketplace's metering service, never a self-run counter (deferred).
- **SSO / OIDC provisioning** — #577 (separate residency child).
- **A multi-tenant marketplace registration landing page** — residency is single-org; deferred until a multi-tenant marketplace need is real.

## Next step

Write `docs/AWS_MARKETPLACE.spec.md` (the `commercial_events` schema + org columns + `AwsMarketplaceGrantSource` contract + the SNS route + `requireOrgWritable` + `ApiCode`s + TDD plan) and `.plan.md` (slices). The plan will likely slice as: (1) rename `stripe_events` → `commercial_events` + `source` discriminator (migration + dual-schema, Stripe path green); (2) org `marketplaceEntitlementId` + `entitlementThrough` columns + `findByMarketplaceEntitlementId` + the `enterprise` tier seed; (3) `AwsMarketplaceGrantSource` (`GetEntitlements` → dimension → tier → foreign-guard) unit-tested with a mocked entitlement client; (4) the SNS webhook route (verify + confirm + dispatch), gated on marketplace config; (5) `entitlementThrough`-derived read-only + `requireOrgWritable` middleware + enforcement tests. Each slice independently green; the Stripe rail stays working throughout.
