# Stripe live mode — Runbook

**Issue:** [EnterpriseBT/portal-ai#385](https://github.com/EnterpriseBT/portal-ai/issues/385) (epic [#83](https://github.com/EnterpriseBT/portal-ai/issues/83)) · Spec: `docs/PROD_STRIPE_LIVE.spec.md`

Standing up a **live-mode** Stripe account. Every Portal environment is a separate Stripe account — `local` is test mode, `app-dev` is its own Sandbox — and nothing crosses environments except lookup keys.

Written for any environment; prod is simply the first live one. Where a step is prod-only it says so.

> ## ⛔ Read this before you take a single payment
>
> **`STRIPE_AUTOMATIC_TAX` defaults to `true` and is not set in `backend.yml`, so production inherits it.** That is the correct posture — *and* it is dangerous in a specific way:
>
> - Stripe Tax collects tax **only** in jurisdictions where you hold an **active registration**.
> - With no registration it **does not error**. It calculates **zero tax**, on every transaction, while the Dashboard shows automatic tax enabled.
> - **Completed transactions cannot be corrected through Stripe.** There is no retroactive fix. The only path is a tax advisor and amended filings with the authority.
>
> So section 6 is a **gate, not a step**. Do not take a live payment until it passes. If registrations are not ready and the business needs to charge anyway, that is a decision someone makes deliberately — see 6d.

---

## What you end up with

| Thing | Where it goes |
|---|---|
| Live account, activated | Stripe |
| Application restricted key | `portalai/<env>/stripe-secret-key` |
| **Read-only** inspection key | operator credential — **not** the catalog |
| Products `Plus` / `Pro` + monthly prices | Stripe, carrying `plus_monthly` / `pro_monthly` |
| Webhook endpoint + signing secret | Stripe → `portalai/<env>/stripe-webhook-secret` |
| Tax: head-office address + registrations | Stripe |
| Billing portal with plan switching | Stripe |

Amounts are **not** here — they are [#325](https://github.com/EnterpriseBT/portal-ai/issues/325). This runbook creates the objects; that ticket sets the numbers and reruns `tier apply`.

---

## 1 — Start the account application (do this first)

The only step with an external review queue. Everything else is same-day.

- [ ] Legal entity, business representative, bank account for payouts.
- [ ] **Statement descriptor** — what appears on a customer's card statement. A descriptor nobody recognizes is a chargeback generator; use the business name.
- [ ] **Support contact** — `support@portalsai.io` (provisioned in `docs/PROD_PROVISIONING.runbook.md`).
- [ ] Stripe's review expects a **public website describing the product and pricing**. That is `www.portalsai.io` ([#386](https://github.com/EnterpriseBT/portal-ai/issues/386)). Start the paperwork now; **submit once the site is reachable.**

## 2 — The application's restricted key

Create a **restricted** key (`rk_live_…`), never a secret key (`sk_…`). Grant exactly these, and nothing else:

| Resource | Access | Why |
|---|---|---|
| Customers | **write** | `customers.create` — lazy customer creation at first checkout |
| Checkout Sessions | **write** | `checkout.sessions.create` |
| Billing Portal Sessions | **write** | `billingPortal.sessions.create` |
| Subscriptions | **write** | `subscriptions.retrieve` **and `subscriptions.cancel`** |
| Prices | read | `prices.retrieve` for display, and `prices.list` for `tier apply` |

> **Subscriptions is `write`, not `read`.** Earlier drafts of this epic said read. `StripeService.cancelSubscription` calls `subscriptions.cancel` on the organization-delete path — a read-only grant produces a 403 that surfaces only when somebody deletes an org with a live subscription.

**Prove the permission set in the sandbox first.** Mint the *test-mode* equivalent, run the app against it with `stripe logs tail`, fix any 403s, and only then create the live key. This turns "did I tick the right boxes" into a sandbox question rather than a live-mode discovery.

- [ ] Store it: `printf '%s' 'rk_live_…' | portalops vars set STRIPE_SECRET_KEY - --env prod --yes --confirm-prod`

## 3 — The read-only inspection key

A **separate** key with **no write permissions at all** — Customers, Subscriptions, Products, Prices, all read.

This is the credential an operator or an agent uses to inspect the account (`stripe` CLI, diagnosing a `tier apply` failure). Per the standing rule, mutation safety for vendor CLIs is **the credential**, not a prompt and not an allowlist.

- [ ] Create it for **prod**.
- [ ] Create it for **app-dev** too. It does not exist in any environment today, which means inspection currently borrows the application's write-capable key. Production should not be the first place the rule is honored.
- [ ] Do **not** put it in the `portalops` catalog — it is an operator credential, not application config.

## 4 — Products and prices

Two products, one recurring monthly price each.

| Product | Lookup key on the price |
|---|---|
| Plus | `plus_monthly` |
| Pro | `pro_monthly` |

For each one:

- [ ] **Set a product tax code.** Required. See section 6b — it is *not* optional, and the wrong one is indistinguishable from having no tax registration.
- [ ] **Set `tax_behavior`** on the price (inclusive or exclusive).
- [ ] Recurring interval **`month`**. `getPrice` renders only `month`/`year` prices with a non-null `unit_amount`; anything else degrades to a plan card with no number.
- [ ] The **lookup key is the contract** — `portalops tier apply` resolves by it and fails closed (`TIER_APPLY_MISSING_PRICES`) if absent.

`standard` and `enterprise` carry no lookup key and need no Stripe object.

**Amounts:** #325. Create the prices with whatever the business has decided; if that decision is pending, this runbook stops here and resumes at section 5 once it is made.

## 5 — The webhook endpoint

- [ ] Endpoint URL: `https://api.portalsai.io/api/webhooks/stripe`
- [ ] Subscribe to **all six** of these:

```
customer.subscription.created     → handled; derives the org's tier
customer.subscription.updated     → handled
customer.subscription.deleted     → handled
price.created                     → recorded `ignored`, fires a site rebuild
price.updated                     → recorded `ignored`, fires a site rebuild
price.deleted                     → recorded `ignored`, fires a site rebuild
```

> **Do not subscribe to only the first three.** The `price.*` trio changes no tier state, which is exactly why it looks optional — and it is the mechanism that republishes the amounts baked into `www.portalsai.io`'s static HTML. Subscribe to three and billing works perfectly while the public pricing page silently goes stale forever.
>
> A guard test (`apps/api/src/__tests__/stripe-webhook-events.test.ts`) asserts this runbook lists exactly what the code consumes, so if someone adds a handled event type this list fails CI rather than drifting.

Everything else stays unsubscribed — unhandled types are recorded and ignored, so a narrow subscription is deliberate.

- [ ] Store the signing secret: `printf '%s' 'whsec_…' | portalops vars set STRIPE_WEBHOOK_SECRET - --env prod --yes --confirm-prod`

Until it is set the endpoint returns **503** and Stripe retries — non-fatal, but no org's tier advances.

## 6 — Stripe Tax ⛔ (the gate)

**In this order.** The ordering is load-bearing, not stylistic.

### 6a — Head-office address

- [ ] Dashboard → Tax → Settings → set the origin/head-office address.
- [ ] Confirm the settings **status reads `active`, not `pending`**. While it is `pending`, `automatic_tax` calculates nothing at all.

### 6b — Verify the product tax codes *before* registering

- [ ] Each product from section 4 has an explicit tax code.
- [ ] None of them is `txcd_00000000` (**Nontaxable**) — that produces the same silent zero-tax as having no registration, and `taxability_reason` **cannot tell the two apart**.
- [ ] The code came from Stripe's canonical list (Tax Codes API or the tax-code guide) — never invented, never copied from memory. The generic *Electronically Supplied Services* code is explicitly too broad for US state-level taxability; pick a specific digital/SaaS code.
- [ ] **Which code is legally correct is a business decision**, not an engineering one. Confirm it with whoever owns tax.

*Why before registrations:* registering first can leave you registered in a jurisdiction where you have no taxable product.

### 6c — Registrations

- [ ] Add a registration for **every jurisdiction you are obligated to collect in**, and confirm each shows as *Collecting*.
- [ ] **Which jurisdictions is a nexus question for a tax advisor.** This runbook does not answer it; it refuses to proceed without an answer.
- [ ] Note Stripe's threshold monitoring (Dashboard → Tax → Locations → "Needs attention") flags new obligations as you grow. Check it periodically — this is not a one-time task.

### 6d — If registrations are not ready

If the business must charge before registrations exist, **do not leave the default on and hope**:

```bash
printf '%s' 'false' | portalops vars set STRIPE_AUTOMATIC_TAX - --env prod --yes --confirm-prod
```

That turns an invisible, permanent under-collection into a recorded decision with a flag someone has to flip back. (`STRIPE_AUTOMATIC_TAX` is not a catalog key today — set it as a task-definition environment variable, or accept the default and complete 6c first.)

### 6e — Verify with a real transaction

- [ ] Run a live checkout and retrieve the session with `expand[]=line_items.data.taxes`.
- [ ] Confirm `taxability_reason` is **not** `not_collecting`.
- [ ] Confirm the invoice shows a **non-zero tax line**.

**This is the only check that distinguishes "tax is enabled" from "tax is being collected."** Every other step passes in a world where you collect nothing.

## 7 — Billing portal

- [ ] Dashboard → Settings → Billing → Customer portal.
- [ ] **Enable plan switching** and **allow-list the Plus and Pro products**.

Without this, [#260](https://github.com/EnterpriseBT/portal-ai/issues/260)'s in-app upgrade/downgrade deep-links `flow_data.subscription_update_confirm` at a price the portal will not accept — it fails at Stripe, not in our code, so the error is opaque.

- [ ] Confirm the portal returns to `https://app.portalsai.io`. The return URL derives from `CORS_ORIGIN[0]`, which `docs/PROD_PROVISIONING.runbook.md` pins as the app URL.

## 8 — Converge the tiers

- [ ] `portalops tier apply --env prod --yes --confirm-prod`

Resolves `plus_monthly` / `pro_monthly` against the live account and writes the price ids onto the tier rows. **Read-only against Stripe** — it never creates or mutates a price. It fails closed if a lookup key does not resolve, which is the check that section 4 was done correctly.

Run it **after** the first database seed, so it converges the seeded rows.

## 9 — Verify

- [ ] `portalops tier apply --env prod` reports the paid rows on **live-mode** price ids.
- [ ] Settings plan cards on `app.portalsai.io` render the live tiers with amounts.
- [ ] **Full round-trip:** checkout → `customer.subscription.created` verified against the prod signing secret → the org's tier advances → the billing portal opens with plan switching → returns to `app.portalsai.io`.
- [ ] **The invoice carries a non-zero tax line** (6e).
- [ ] Change a price in the live account → `price.updated` is recorded `ignored` → `www.portalsai.io` republishes with no code change.
- [ ] Delete an org with a live subscription → cancels in Stripe with no 403 (the `subscriptions` write grant).
- [ ] `stripe_events` holds a row per delivered event, including the ignored ones.

## Never

- **Never repoint an environment at a different Stripe account.** Every `stripe_customer_id` orphans and the billing endpoints 502 with "No such customer". Treat the account as permanent.
- **Never commit a key.** `rk_live_…` / `sk_live_…` in source control is a live credential; the catalog and Secrets Manager are the only homes.
- **Never use the application key for inspection.** That is what section 3 exists for.
