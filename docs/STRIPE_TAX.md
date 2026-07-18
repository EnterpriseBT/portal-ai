# Stripe Tax on subscription checkout — Condensed design (#217)

**Issue:** [EnterpriseBT/portal-ai#217](https://github.com/EnterpriseBT/portal-ai/issues/217) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). Epic #177's final pre-go-live child. Packages: `apps/api`, `apps/web` (one copy line). Branch `feat/stripe-tax` → `epic/subscription-billing`.

**Why.** #176 shipped self-serve subscriptions with tax out of scope — a go-live compliance gap (stripe-best-practices `references/tax.md`, `billing.md`). This turns on Stripe Tax at the one place we mint checkout sessions, collects the address Stripe needs to determine jurisdiction, and documents the Dashboard-side activation. Code-light by design: tax calculation, display, and invoicing are Stripe-hosted.

## Current shape

| Piece | Location | Note |
|---|---|---|
| `createCheckoutSession` | `apps/api/src/services/stripe.service.ts:108-127` | mode subscription, customer + price line item, metadata; **no tax, no address collection** |
| Caller | `apps/api/src/services/billing.service.ts:330-336` | passes `tier.stripePriceId`; failures → 502 `BILLING_CHECKOUT_FAILED` |
| Env surface | `apps/api/src/environment.ts:28-29` | `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` only |
| Plan-list price copy | `apps/web/src/components/SubscriptionBilling.component.tsx:31-39,138` | `"$49 / month"` via `formatPrice`; no tax wording |
| Webhook tier-write | `billing.service.ts` `deriveTierFromSubscription` | tax adds invoice lines, not status semantics — unaffected (existing suite pins it) |
| Test seam | `billing.service.endpoints.test.ts:21-28` | StripeService mocked at the boundary — **session params untested today** |

## Decision — env-flag gate, default ON

Options: (a) always-on (breaks checkout 502-style in sandboxes without a Stripe Tax origin address); (b) probe-and-degrade (a Stripe read per session — complexity for a config problem); (c) **env flag `STRIPE_AUTOMATIC_TAX`, default `true`**.

**Decided: (c), default `true`.** Go-live posture by default; an unconfigured sandbox sets `STRIPE_AUTOMATIC_TAX=false` explicitly rather than silently skipping tax (conscious, visible downgrade — never a silent one). Per `tax.md:19`, enabling before registrations exist is safe (Stripe collects nothing until a registration is active) — the only hard requirement is the account's **origin address** + per-price `tax_behavior` (or the Dashboard default), both one-time Dashboard steps that test mode accepts with a dummy address. When the flag is on, the session gains `automatic_tax: { enabled: true }`, `billing_address_collection: "required"`, and `customer_update: { address: "auto" }` (persists the address onto the customer so Tax can locate them; we always pass `customer`). Plan-list copy: a single static footnote — "Prices exclude tax, which is calculated at checkout." — display-only, contract unchanged.

## Plan — 1 slice

**Files**

- Edit: `apps/api/src/environment.ts` — `STRIPE_AUTOMATIC_TAX: process.env.STRIPE_AUTOMATIC_TAX !== "false"` (default on).
- Edit: `apps/api/src/services/stripe.service.ts` — `createCheckoutSession` conditionally spreads the three tax params.
- Edit: `apps/api/.env.example` — document the flag + the Dashboard activation note (origin address, default `tax_behavior`, registrations; test mode = dummy address).
- Edit: `apps/web/src/components/SubscriptionBilling.component.tsx` — the footnote line under the plan list.
- New: `apps/api/src/__tests__/services/stripe.service.checkout.test.ts` — mock the `stripe` module; assert session params.
- Edit: the SubscriptionBilling web test — footnote renders.

**Tests** (npm scripts only)

1. Flag on (default): `checkout.sessions.create` called with `automatic_tax: {enabled: true}`, `billing_address_collection: "required"`, `customer_update: {address: "auto"}` — plus the pre-existing params unchanged.
2. `STRIPE_AUTOMATIC_TAX=false`: none of the three params present (byte-compatible with today's session).
3. Web: plan list renders the tax footnote (`apps/web` unit).
4. Existing webhook suite green untouched (tax adds invoice lines only).

## Smoke (manual, against your dev stack)

**✅ Walked + signed off 2026-07-18 — Ben Turner**, against the local dev stack + Stripe test Dashboard (all 8 steps green; session-verified DB/Stripe/webhook checks). Walk notes: (1) local webhook delivery requires a running `stripe listen --forward-to localhost:3001/api/webhooks/stripe` forwarder — no webhook endpoint is registered in the sandbox, and a dead forwarder is what enabled the double-checkout that surfaced #230 (webhook clobbers the tracked subscription when the customer holds two — pre-existing #176 edge, filed separately); (2) `stripe_events` dedup verified live (a replayed event id was ignored; a fresh `subscription.updated` re-synced); (3) `.env` changes need a full `npm run dev` restart (dotenv injects at start, not on nodemon reload).


1. Stripe Dashboard (test mode) → **Settings → Tax**: activate Stripe Tax with a dummy US origin address; set default tax behavior **exclusive**; add a test registration (e.g. CA). One-time per sandbox.
2. Ensure a purchasable tier exists (per `COMMANDS.md → tier`: create a price with a lookup key, set the catalog's `stripeLookupKey`, `portalops tier apply --env local` — or reuse any tier row with a live `stripe_price_id`).
3. `npm run dev`; Settings → Subscription & Billing shows the plan list with the footnote "Prices exclude tax, which is calculated at checkout."
4. Click Subscribe → Stripe-hosted checkout **requires a billing address**; enter a taxed test address (e.g. `354 Oyster Point Blvd, South San Francisco, CA 94080`) → a **tax line** appears on the hosted page.
5. Complete with `4242 4242 4242 4242` → redirect lands `?billing=success`; org tier updates via webhook as before (tax did not change tier-write semantics).
6. Stripe Dashboard → the subscription shows `automatic_tax: enabled`; its first invoice carries the tax line. Billing portal (Manage subscription) shows tax-inclusive amounts — zero code, verify visually.
7. Gate check: stop the API, set `STRIPE_AUTOMATIC_TAX=false`, restart, run a checkout → completes with **no** address requirement and no tax line (sandbox escape hatch works). Restore the flag (remove the line).
8. Cancel the test subscription in the Dashboard (or via the billing portal) to leave the sandbox clean.

## Out of scope

- Tax registration strategy/thresholds per jurisdiction (business/ops decision — Dashboard-side).
- Invoicing/receipt customization; tax-inclusive pricing models (`tax_behavior: inclusive`).
- Usage-based billing to Stripe (still internal, per #176).
- Existing-subscription migration to automatic tax (none exist in prod; new checkouts only).
