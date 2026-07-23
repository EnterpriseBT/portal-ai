# IN_APP_PLAN_CHANGE — Smoke Suite

Manual smoke test for [#260](https://github.com/EnterpriseBT/portal-ai/issues/260) — in-app plan upgrade/downgrade for non-custom orgs: the subscribed billing tab shows the full plan grid with a **"Switch to this plan"** CTA that opens the Stripe billing portal's subscription-update flow; the existing webhook reconciles the tier. **Branch under test:** `feat/in-app-plan-change` (PR [#262](https://github.com/EnterpriseBT/portal-ai/pull/262)).

Run **§Preflight** once. The rest can be walked top-to-bottom; each section is independent after preflight. This is a **manual** walkthrough against your own dev stack — nothing here runs itself, and no box is pre-checked.

Filing bugs: use the template at the bottom.

## Preflight

### Environment

- [ ] `git checkout feat/in-app-plan-change && git pull --ff-only`
- [ ] `npm install`
- [ ] `npm run build --workspace=@portalai/core` — the **billing contract** changed (`BillingPortalRequest`); `apps/api` + `apps/web` compile against core's `dist`, so rebuild it first.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`); log in as **bbgrabbag@gmail.com**.
- [ ] **Stripe webhooks reach the app:** `stripe listen --forward-to localhost:3001/api/billing/webhook --api-key sk_test_…` is running (the switch reconciles the tier **only** via `customer.subscription.updated`). (Local Stripe gotchas: project memory — `--api-key` required; `STRIPE_AUTOMATIC_TAX=false` for a fresh test account.)

### The load-bearing Stripe setup (Open Q1)

- [ ] In the **Stripe test dashboard → Billing → Customer portal**, enable **"Customers can switch plans"** and add the tier **products/prices** (Standard-not-applicable, **Pro**, and a second paid tier for switching, e.g. **Scale**) to the portal configuration's allowed products. Without this, `flow_data.subscription_update_confirm` is **rejected** and the Switch returns a 502. *(This is the config prerequisite the discovery flagged — verifying it here is the point of §1/§7.)*
- [ ] At least **two priced tiers** exist locally with resolvable Stripe prices — run `DATABASE_URL=… STRIPE_SECRET_KEY=sk_test_… npx portalops tier apply --env local` after ensuring the catalog/prices include a second paid tier (or create one in Stripe + a `tiers` row). `db:studio` → `tiers`: two rows with `cta='subscribe'` and non-null `stripe_price_id`.

### Fixtures

- [ ] A **subscribed** org on a priced tier: from the billing tab, **Subscribe** to **Pro** (real test-mode checkout, card `4242…`). After `stripe listen` delivers the webhook, `db:studio` → `organizations` shows your org with `tier='pro'`, a `stripe_customer_id`, and a `stripe_subscription_id`.

### Reset between runs

- [ ] To re-run: use the Stripe portal (Manage) or dashboard to move the subscription back to Pro / cancel; `db:studio` reflects the tier after the webhook. No app-side reset needed — the app never writes the tier directly.

## §1 — Switch: upgrade (AC1)

- [ ] On the subscribed org (on Pro), open Settings → Subscription & Billing. Expect the **full grid**: Standard (Free), **Pro** with a **"Current plan"** chip and **no** button, and the second paid tier (e.g. **Scale**) with a **"Switch to this plan"** button. **Manage subscription** appears below the grid.
- [ ] Click **"Switch to this plan"** on Scale → the browser redirects to a **Stripe-hosted confirm screen** for the Pro→Scale change (showing proration), **not** the portal home.
- [ ] Confirm the change in Stripe → you're returned to `/settings`. After `stripe listen` delivers `customer.subscription.updated`, `db:studio` → `organizations.tier = 'scale'` (the webhook reconciled it — no immediate local write).
- [ ] Reload the billing tab → **Scale** now carries the "Current plan" chip; **Pro** now offers "Switch to this plan".

## §2 — Switch: downgrade + free (AC2)

- [ ] From Scale, click **"Switch to this plan"** on **Pro** (a downgrade) → same Stripe confirm flow; after the webhook, `organizations.tier = 'pro'`. Downgrade works symmetrically.
- [ ] The **Standard (Free)** card shows **no** Switch button (free has no price — a switch can't target it).
- [ ] Downgrading to free is **cancellation**: click **Manage subscription** → Stripe portal → cancel; after the webhook, the org drops to the free/default tier. (No dedicated "downgrade to Free" button — by design.)

## §3 — Manage unchanged (AC4)

- [ ] Click **Manage subscription** (no plan chosen) → opens the Stripe **portal home** (payment methods, invoices, cancellation) — the bodyless `/portal` behavior, unchanged from before #260.

## §4 — Custom / contact exclusion (AC3)

- [ ] With a **custom-plan** org (on a `contact` tier, e.g. via `portalops tier create --visible-to-org <you> --cta contact` + `portalai org set-tier`): the billing tab shows **only** that one card with **"Contact support"** — **no** grid, **no** Switch (sales-gated per #241). *(Note: a custom org has no Stripe subscription, so it isn't in the "subscribed" state; confirm the single-card + contact-support rendering.)*
- [ ] A `contact` tier appearing as an option in a non-custom org's grid shows **"Contact support"**, never a Switch button.

## §5 — Guards & errors (AC4)

- [ ] **Non-owner:** as a member (not the org owner), the "Switch to this plan" button is **disabled** with the "Only the organization owner can manage billing" tooltip. (Server also 403s `BILLING_NOT_OWNER` if forced.)
- [ ] **Unsubscribed org:** an org with no subscription shows **"Subscribe"** (checkout), not "Switch" — there's no subscription to update.
- [ ] **Malformed body:** `curl` (with a valid bearer) `POST /api/billing/portal` `{"tier": 5}` → **400** `BILLING_INVALID_PAYLOAD`. `{}` (or no body) → 200 (Manage).
- [ ] **Bad target:** force a Switch to an unknown slug → **404** `BILLING_TIER_NOT_FOUND`; to an unpriced tier → **400** `BILLING_TIER_NOT_PURCHASABLE` (craft via API if the UI won't offer it).
- [ ] **Portal-config failure (fail-closed):** if the Stripe portal configuration does **not** allow plan switching (temporarily disable it), the Switch returns **502** `BILLING_PORTAL_FAILED`, surfaced via the in-tab `FormAlert` — and the org's `tier`/subscription are **unchanged**.

## §6 — No-desync invariant (AC5)

- [ ] During §1/§2, confirm `organizations.tier` changes **only after** the webhook fires (stop `stripe listen` briefly: the redirect completes in Stripe, but the DB tier does **not** change until the webhook is delivered) — the app never writes the tier from the redirect. This is the property #259 guards; the in-app switch preserves it.
- [ ] `git diff main...HEAD` touches no migration and no webhook handler (`webhook.router.ts` / `handleSubscriptionEvent` unchanged).

## §7 — API docs (AC4)

- [ ] `http://localhost:3001/api-docs` → `POST /api/billing/portal` documents an **optional** `BillingPortalRequest` request body and the 400/404/409 responses; the `BillingPortalRequest` schema is present under components.

## Sign-off

- [ ] §1 (upgrade) — Switch opens the Stripe update flow; tier reconciles via the webhook.
- [ ] §2 (downgrade + free) — symmetric switch; free has no Switch; cancel = free.
- [ ] §3 (Manage) — bodyless portal still opens the portal home.
- [ ] §4 (custom/contact) — sales-gated, no Switch.
- [ ] §5 (guards) — owner-gate, unsubscribed shows Subscribe, malformed 400, bad target 404/400, portal-config failure 502 (fail-closed).
- [ ] §6 (no desync) — tier changes only via the webhook; no migration/webhook change.
- [ ] §7 (api-docs) — optional body + schema documented.
- [ ] `npm run lint && npm run type-check` clean (also the CI gate).
- [ ] ______________________  (date + name) — confirmed against my own running stack.

## Bug-filing template

```
**Section:** §<X> — <name>
**Step:** <which step>
**Expected:** <what this doc says should happen>
**Got:** <screenshot / DB row / Stripe dashboard state / API response + code>
**Repro:** <exact click path or curl>
**Identifiers:** <org id / tier slug / stripe sub id>
```
