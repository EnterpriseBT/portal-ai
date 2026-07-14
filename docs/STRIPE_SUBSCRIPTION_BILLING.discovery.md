# Stripe subscription billing — Discovery

**Issue:** [EnterpriseBT/portal-ai#176](https://github.com/EnterpriseBT/portal-ai/issues/176) · child of epic [#177](https://github.com/EnterpriseBT/portal-ai/issues/177) · branch `feat/stripe-subscription-billing` → `epic/subscription-billing`

**Consumes:** [#172](https://github.com/EnterpriseBT/portal-ai/issues/172) (the tier surface — `tiers` rows, the `organizations.tier` slug FK, `resolveTier`). **Does not touch:** the cost gate (#169/#183/#184) or the `usage` balance.

**Why this exists.** #172 shipped the tier as a provider-agnostic slug + DB rows precisely so a payment provider could drive it with no re-plumbing: `resolveTier` reads a slug, so a webhook only has to *write* one. Today nothing writes it — every org sits on the seeded `standard` tier forever, and there is no way to buy a bigger allocation. This ticket is that provider: Stripe products/prices map to `tiers.slug`, subscription-lifecycle webhooks write `organizations.tier` (reverting to the default on cancel), and the app exposes hosted Checkout + Billing Portal entry points. This is the monetization layer that turns the tier contract into revenue — the piece that writes what #169 enforces and #172 declares.

## The current shape

### The tier surface (#172 — the write target)

| Touch point | File | Note |
|---|---|---|
| `tiers` table | `apps/api/src/db/schema/tiers.table.ts:22-66` | Unique `slug`, scalar charge grid, JSONB `per_tool_caps`. **Gets `stripe_price_id`** (Decision 1). |
| Org tier column | `apps/api/src/db/schema/organizations.table.ts:20-23` | `text NOT NULL DEFAULT 'standard'` FK → `tiers.slug`. The webhook's write target. |
| `resolveTier` | `apps/api/src/services/tier.service.ts:61-90` | Async, 60s TTL cache, unknown slug → standard. Unchanged — it just starts seeing real slugs. |
| `usage` balance | `apps/api/src/db/schema/usage.table.ts:21-44` | #172-owned, gate-incremented. **Not touched.** |

### Organizations dual-schema (where the linkage columns land)

| Touch point | File | Note |
|---|---|---|
| Drizzle table | `apps/api/src/db/schema/organizations.table.ts:9-24` | Add `stripe_customer_id`, `stripe_subscription_id` (nullable text, unique). |
| Zod core model | `packages/core/src/models/organization.model.ts:12-20` | Mirror the two fields; type-checks in `apps/api/src/db/schema/type-checks.ts` force the sync. |
| drizzle-zod | `apps/api/src/db/schema/zod.ts:50-60` | Auto-inferred from the table. |
| Org delete (#197) | `apps/api/src/services/organization-delete.service.ts:62-76` | Soft-deletes the org, preserves `usage` rows as billing record. Stripe ids survive the tombstone the same way (reconciliation); delete must also end the subscription (Open Q4). |

### Inbound-webhook precedent (Auth0 sync — the template)

The app already receives one signed inbound webhook. `apps/api/src/app.ts:22-124` mounts the webhook router **before** `express.json()` (line 36); the Auth0 sync route (`apps/api/src/routes/webhook.router.ts:112-166`) uses a `jsonWithRawBody` parser (`app.ts:21-25`) so `req.rawBody` is available for HMAC verification in `apps/api/src/middleware/webhook-auth.middleware.ts:17-76` (`crypto.timingSafeEqual`). The Stripe route follows this exact mounting/raw-body shape but verifies with the official SDK (`stripe.webhooks.constructEvent`) instead — Stripe's `t=…,v1=…` scheme with timestamp tolerance is not our HMAC middleware. Routes opting out of JWT (OAuth callbacks `app.ts:50-51`, SSE line 54) are established precedent for an unauthenticated `/api` path.

### Config & frontend surfaces

- Env: plain `process.env` reads in `apps/api/src/environment.ts:1-159` (`AUTH0_WEBHOOK_SECRET` at line 24 is the pattern for `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`); document in `apps/api/.env.example`.
- Settings → Organization tab (`apps/web/src/views/Settings.view.tsx`) already renders tier + usage from `sdk.organizations.current()` / `.usage()` (`apps/web/src/api/organizations.api.ts:1-52`); billing buttons land beside them. Redirect precedent: `auth.api.ts:18` uses `window.location.replace(url)` — checkout/portal URLs are backend-minted and the browser is sent to them.
- No Stripe SDK or code exists anywhere (grep: only two comments referencing Stripe's signature style). Greenfield.

## The design space

### Decision 1 — Where the price ↔ tier mapping lives

- **A — env/config map** (`STRIPE_PRICE_MAP=price_x:pro,…`): mapping is deploy-coupled config; contradicts #172's "tiers are data, not code" call.
- **B — `stripe_price_id` column on `tiers`** (nullable text, unique where not null): the tier row *is* the mapping. Checkout resolves tier → price; the webhook resolves price → slug. Adding a paid tier = `tiers` INSERT + Stripe price + one UPDATE. No deploy.
- **C — Stripe-side metadata** (`tier_slug` on the Stripe price): single-sourced in Stripe, but checkout needs the *forward* lookup (tier → price) anyway, so the app ends up listing Stripe prices at runtime or caching the map — which is option B with extra steps.

| | A — env map | B — `tiers` column | C — Stripe metadata |
|---|---|---|---|
| Add a paid tier | redeploy | **row UPDATE** | Stripe dashboard only |
| Forward lookup (checkout) | map | **indexed read** | Stripe API list call |
| Reverse lookup (webhook) | map | **indexed read** | in-payload |
| Consistent with #172 ethos | no | **yes** | partly |

**Lean: B.** One nullable `stripe_price_id` column on `tiers`; `NULL` = not purchasable (e.g. `standard`, bespoke enterprise rows). Both lookup directions are indexed DB reads, and the "adding a tier is data ops" property from #172 survives intact.

### Decision 2 — Webhook idempotency & ordering

Stripe retries webhooks (same event id redelivered) and does **not** guarantee ordering across events. Two hazards: double-processing, and a stale `updated` event arriving after a newer one and rolling the tier back.

- **A — trust the payload, no dedup:** tier writes are naturally idempotent per-event, but out-of-order delivery can regress the tier, and there is no record of what was processed.
- **B — `stripe_events` dedup table:** unique-insert on the Stripe event id (atomic, DB-enforced — safe across ECS instances); duplicate insert → no-op 200. Rows record `(eventId, type, subscriptionId, organizationId, resultingTier, processedAt)`.
- **C — B + derive-from-source:** handlers never trust the event payload's snapshot for the *decision*; on any subscription-lifecycle event they re-fetch the subscription from the Stripe API and derive the tier from its **current** state. Any event, in any order, converges the org to the truth — ordering ceases to be a correctness concern.

| | A | B | C |
|---|---|---|---|
| Duplicate-safe | payload-idempotent | **DB-enforced** | **DB-enforced** |
| Order-safe | no | mostly (needs `event.created` guard) | **yes (converges)** |
| Audit trail | none | **yes** | **yes** |
| Cost per event | — | 1 insert | 1 insert + 1 Stripe API read |

**Lean: C.** The extra API read per lifecycle event is negligible at webhook volumes, and "converge to Stripe's current state" eliminates the whole ordering class of bugs. The `stripe_events` table doubles as the tier-change audit trail — the first real writer #172's Open Q6 anticipated.

### Decision 3 — Tier derivation from subscription state

**Decided (falls out of Decision 2C; the grace behavior is PRD-confirmed):** one pure function `subscription state → tier slug`:

- `active` / `trialing` → the tier whose `stripe_price_id` matches the subscription's price; unknown price → log + keep current tier (never guess).
- `past_due` → **keep the paid tier** — Stripe's dunning/Smart Retries own the grace window; we don't duplicate that policy in app code.
- `canceled` / `unpaid` / `incomplete_expired` (or subscription deleted) → revert to the default `standard` tier and clear `stripe_subscription_id` (customer id stays).

`invoice.payment_failed` therefore needs no bespoke handler — it manifests as `customer.subscription.updated` with `past_due`/`unpaid` status, which the one converge path already handles.

### Decision 4 — Checkout & portal surface

- **A — Stripe-hosted Checkout Session + hosted Billing Portal:** backend mints session URLs; browser redirects out and back. Zero card data touches Portal.ai (SAQ-A PCI posture); plan switches, payment-method updates, cancellation, and invoices all live in the portal.
- **B — embedded Stripe Elements / custom plan-management UI:** in-app UX, but PCI surface, far more code, and a custom UI for flows the portal gives us free.

**Lean: A.** Two owner-only JWT-protected endpoints on a new `billing.router.ts` — `POST /api/billing/checkout` (body: target tier slug; creates the customer lazily if absent, returns the session URL) and `POST /api/billing/portal` (returns a portal session URL) — consumed via a new `sdk.billing.*` client. Success/cancel URLs land back on Settings; the **webhook, not the redirect, is what changes the tier** (the redirect is UX only).

### Decision 5 — A dedicated "Subscription & Billing" Settings tab

The PRD requires billing to be its own tab, not rows in the Organization tab. Today the tier + usage rows from #172 render inside the Organization tab's `MetadataList` (`apps/web/src/views/Settings.view.tsx`).

- **A — new tab, leave #172's rows where they are:** the tab holds plan selection + checkout / manage-subscription actions; the Organization tab keeps the tier/allocation/usage display.
- **B — new tab that *absorbs* the tier/usage display:** one "Subscription & Billing" tab shows everything — current tier, used/available, plan list, actions — and the #172 rows relocate.

**Decided: A** (user call). Managing billing and changing subscriptions is a different set of *actions* from viewing current organization usage — the Organization tab remains the read-only "what I have and what I've used" surface (#172 untouched), and the new tab owns "change what I have." The tab shows the current plan for context (from the existing `sdk.organizations.current()`), the selectable plan list (`GET /api/billing/tiers`, Decision 6), and the checkout/portal actions.

**Custom-tier state (PRD-confirmed):** for an org on a manually-assigned custom tier (`selectable = false`, no `stripe_subscription_id`), the tab shows the current plan with a "your plan is managed — contact us" notice and hides the plan list, checkout, and portal actions — self-serve must not be able to overwrite an enterprise deal, and there is no Stripe customer to open a portal for.

### Decision 6 — Standard selectable set vs custom (enterprise) subscriptions

The PRD requires custom subscriptions alongside the standard UI-selectable set. #172 Open Q2 already decided a bespoke deal is **its own `tiers` row** (e.g. `enterprise-acme`) — so the question is only how a row declares "listed in the checkout UI" vs "custom".

- **A — infer from `stripe_price_id`:** priced = selectable. Breaks immediately: a custom enterprise deal can *also* be Stripe-billed via a bespoke price, yet must not appear in the public plan list.
- **B — explicit `selectable` boolean on `tiers`:** the plan list is `selectable = true` (checkout additionally requires a `stripe_price_id`). A custom tier is a row with `selectable = false`, reached two ways: **(i) Stripe-driven** — a bespoke price on that row; the webhook converge path maps it like any other tier, no special casing; **(ii) manually assigned** — the admin CLI (`portalai`, which already owns org/tier management) writes `organizations.tier` directly; no subscription exists, so no webhook ever fires for that org and the assignment can't be clobbered.

**Lean: B.** One boolean column, seeded `true` for `standard`; both custom paths fall out of machinery this doc already builds — the enterprise case adds a flag, not a mechanism. `GET /api/billing/tiers` returns the selectable rows (slug, display name, allocations, price) for the plan list.

### Decision 7 — Customer creation timing

**Lean: lazily, at first checkout.** Free orgs never touch Stripe — no customer rows to reconcile for orgs that never pay. `POST /api/billing/checkout` creates the customer (org id + name in Stripe metadata), persists `stripe_customer_id`, then creates the session. Eager creation at org signup couples org creation to Stripe availability for zero benefit.

## Tradeoff comparison

| | D1: price id on `tiers` | D2: dedup + converge | D3: state → slug map | D4: hosted checkout/portal | D5: Billing tab | D6: `selectable` flag | D7: lazy customer |
|---|---|---|---|---|---|---|---|
| Spread to spec | 1 column + migration | `stripe_events` table + handler shape | one pure function (unit-testable) | 2 endpoints | 1 new tab (actions only) | 1 column + `GET /api/billing/tiers` | branch in checkout endpoint |
| New infra | none | 1 dual-schema table | none | `stripe` SDK dep, 2 env secrets | none (view-layer) | none | none |
| Reuses | dual-schema workflow | webhook mounting + raw-body precedent | `resolveTier` fallback ethos | SDK/`useAuthMutation` + redirect pattern | Settings tabs + #172 queries | #172 Q2 bespoke-row model + admin CLI | org repository |

## Recommendation

1. **Add `stripe_price_id` (nullable text, unique where not null) to `tiers`** — the price ↔ tier mapping is a tier-row attribute; `NULL` = not purchasable.
2. **Add `stripe_customer_id` / `stripe_subscription_id` (nullable text, unique) to `organizations`**, dual-schema; ids survive the #197 tombstone.
3. **`POST /api/webhooks/stripe`** mounted before `express.json()` with raw-body capture (Auth0-sync precedent), verified via `stripe.webhooks.constructEvent`, fail-closed on bad signature.
4. **A `stripe_events` dual-schema table** with a unique Stripe event id: atomic dedup across instances + the tier-change audit trail (#172 Q6's first writer).
5. **Converge-to-source handling:** on any subscription lifecycle event, re-fetch the subscription from Stripe and derive the tier via one pure `subscriptionState → tierSlug` function (Decision 3's status table); write `organizations.tier` and record the event row.
6. **Add `selectable` boolean to `tiers`** (seeded `true` for `standard`): the checkout plan list is `selectable = true`; a custom/enterprise subscription is a `selectable = false` row driven by a bespoke Stripe price **or** assigned manually via the admin CLI (no subscription → no webhook → never clobbered).
7. **Owner-only `POST /api/billing/checkout` + `POST /api/billing/portal`** minting hosted-session URLs (lazy customer creation), plus read-only `GET /api/billing/tiers` (the selectable plan list), exposed as `sdk.billing.*`; the webhook is the sole Stripe-driven tier writer. Org delete (#197) cancels an active subscription immediately — best-effort, never blocking the delete.
8. **A dedicated Settings → "Subscription & Billing" tab** owning the *actions* — current plan for context, the selectable plan list, checkout / manage-subscription; the Organization tab keeps the #172 tier/allocation/usage display unchanged (viewing usage and managing billing are different activities). Orgs on a manually-assigned custom tier see a "your plan is managed — contact us" notice with all self-serve actions hidden.
9. **Align usage periods to the subscription billing cycle** — nullable `billing_anchor_day` on `organizations` (webhook-written, clamped to 28, cleared on revert-to-standard); the two `periodIdFor` call sites apply the org override, unsubscribed orgs stay calendar-month, and a mid-month subscribe starts a fresh period with the paid allocation.
10. **`STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` in `environment.ts` + `.env.example`**; official `stripe` npm package, API-version-pinned.
11. **No changes** to `resolveTier` or the `usage` balance; the cost gate's only touch is passing the org's anchor override through the existing `periodIdFor` seam.

## Open questions

1. **Checkout for an org already subscribed — upgrade path?** Checkout Sessions create *new* subscriptions; plan *changes* belong to the Billing Portal (proration handled by Stripe). Lean: checkout endpoint 409s (`BILLING_ALREADY_SUBSCRIBED`) when `stripe_subscription_id` is set, and the UI shows "Manage subscription" (portal) instead of "Upgrade" (checkout) — one live subscription per org, enforced.
2. **Unknown `stripe_customer_id` on an inbound event (e.g. dashboard-created test subscription)?** Lean: log warning + 200-ack — a 4xx would put Stripe into a 3-day retry loop for an event we will never be able to process.
3. **~~Who may hit checkout/portal?~~ [RESOLVED — owner only, PRD-confirmed.]** Org **owner only** (`ownerUserId`), matching org delete (#197); RBAC roles (#198) can widen this later without contract change.
4. **~~What happens to the subscription when the org is deleted (#197)?~~ [RESOLVED — cancel immediately, PRD-confirmed.]** The delete cascade cancels the subscription immediately (no service exists to bill); delete **never blocks on Stripe** — a failed cancel call is logged for manual reconciliation and the delete proceeds; the tombstoned row keeps both Stripe ids. Extends `organization-delete.service.ts`.
5. **~~Should the usage `period` align to the Stripe billing-cycle anchor?~~ [RESOLVED — align now via a per-org anchor day, PRD-confirmed.]** The defer-lean assumed the re-keying was expensive; the survey shows otherwise — `TierService.periodIdFor(period, at)` (`tier.service.ts:97`) is the *single* derivation function, called from exactly two places (`cost-gate.service.ts:223`, `usage.service.ts:113`), and its anchored-month math already exists. Scope: nullable `billing_anchor_day` on `organizations` (webhook-written from the subscription anchor, clamped to 28, cleared on revert-to-standard); the two call sites apply the org override when set — **not** baked into the cached-by-slug `TierPolicy`, since the override is per-org. Unsubscribed orgs stay calendar-month. Mid-month subscribe changes the period key → fresh period row with the paid allocation immediately ("you paid, your period starts now"). Timestamp-mirroring (keying by Stripe's `current_period_*`) was rejected: rollover would depend on receiving each renewal webhook, whereas an anchor day is self-rolling.
6. **Test-mode vs live-mode keys per environment?** Lean: dev/staging run Stripe test mode with their own webhook endpoints + secrets (secrets are per-env already); Stripe CLI (`stripe listen`) for local webhook forwarding — goes in the smoke doc.
7. **Where does the plan list's displayed price come from?** The `tiers` row has the price *id*, not the amount. Lean: `GET /api/billing/tiers` fetches amounts from Stripe server-side by price id with a TTL cache (like `resolveTier`'s 60s) — Stripe stays the single price authority, no duplicated amount column to drift; Stripe outage degrades the display, not checkout correctness.

## Enterprise-scale considerations

- **Concurrency & correctness** — webhook delivery is at-least-once and multi-instance: dedup is a DB-unique insert on the Stripe event id (atomic check-then-act), and converge-to-source (Decision 2C) makes ordering irrelevant. The tier write is a single-column UPDATE keyed by org id — no read-modify-write race.
- **Accuracy & auditability** — `stripe_events` is a durable append-only record of every processed lifecycle event and the tier it produced (the #172 Q6 audit writer); Stripe itself is the payment record-of-truth for disputes/chargebacks. No ephemeral state anywhere in the path.
- **Failure modes** — signature verification **fails closed** (4xx, no processing). Handler errors → non-2xx → Stripe retries for ~3 days, and converge-to-source makes every retry safe. Stripe API down: checkout/portal endpoints surface a typed `ApiError` (tier untouched — degraded but safe); webhook converge-fetch failure → non-2xx → retried. Org delete's cancel call is best-effort — delete never blocks on a Stripe outage (failure logged for manual reconciliation). The org's *current* tier keeps working throughout any Stripe outage — `resolveTier` reads our DB, not Stripe.
- **Scale & unbounded growth** — event volume ∝ subscription changes (tiny); `stripe_events` grows append-only but small (retention policy can come with #179's ledger thinking). No fan-out, no polling.
- **Multi-tenancy** — customer/subscription ids are unique-indexed per org; an event resolves to exactly one org via `stripe_customer_id`. No cross-tenant path exists.
- **Contract stability** — the only writes into existing surfaces are `organizations.tier` (the slug #172 built to be written) and two nullable columns; `resolveTier`, the gate, and `usage` are untouched. Metered/usage-based Stripe billing later (#176's out-of-scope) plugs in beside this without rework.
- **Data lifecycle** — the billing window now matches what the customer paid for: usage periods anchor to the subscription's billing cycle (Q5, per-org override through the shared `periodIdFor` seam), calendar-month only for unsubscribed orgs. Stripe ids survive org tombstoning for reconciliation.

## What this doesn't decide

- **Usage-based/metered billing to Stripe** — reporting `usage` rows as Stripe usage records is explicitly out of scope (issue); the `usage` balance stays internal.
- **The audit ledger (#179)** — `stripe_events` audits *tier changes*; the per-call charge ledger remains #179.
- **Tier-management/admin UI** — tiers (now with a price id) are still rows edited via seed/SQL.
- **RBAC for billing actions** — owner-only for now; #198 roles widen it later.
- **Refunds, invoices UI, tax/VAT configuration** — all live in Stripe's hosted surfaces; nothing to build.

## Next step

Write `docs/STRIPE_SUBSCRIPTION_BILLING.spec.md` (contract: the four new columns + `stripe_events` table shapes, webhook route + verification + converge handler, the `subscriptionState → tierSlug` function's status table, checkout/portal/tiers endpoint contracts + error codes, env vars, the Billing tab's states) and `.plan.md`. Likely slicing: (1) schema — `stripe_price_id` + `selectable` on `tiers`, org linkage columns + `billing_anchor_day`, `stripe_events` table, migrations + type-checks; (2) Stripe service + the pure derivation function + the `periodIdFor` org-override threading (unit-tested, SDK mocked); (3) webhook route — mounting, signature verification, dedup, converge handler (tier + anchor-day writes); (4) billing endpoints (checkout / portal / tiers list) + org-delete cancellation; (5) frontend — `sdk.billing.*`, the Subscription & Billing tab (actions only; #172's Organization-tab rows untouched), plan list + subscribed/unsubscribed/managed states. PR targets `epic/subscription-billing`.
