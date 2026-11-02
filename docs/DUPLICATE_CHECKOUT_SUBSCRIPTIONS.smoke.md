# duplicate_checkout_subscriptions — Smoke Suite

Manual smoke test for [#939](https://github.com/EnterpriseBT/portal-ai/issues/939): checkout reads Stripe and serialises per org, the checkout return confirms the plan with `POST /api/billing/sync`, the webhook converges per customer, and org delete cancels every live subscription. **Branch under test:** `fix/939-duplicate-checkout-subscriptions` (PR [#942](https://github.com/EnterpriseBT/portal-ai/pull/942)).

Run **Preflight** once. Each section then starts from a fresh org (Fixtures). Tags: untagged = agent-walkable in the browser; `— backend` = `psql` / `stripe` / CLI; `— manual` = Stripe-hosted pages or payment, a human walks it.

## Preflight

### Environment

- [ ] `git checkout fix/939-duplicate-checkout-subscriptions && git pull --ff-only && npm install && npm run build --workspace=packages/core`
- [ ] `cd apps/api && npm run db:migrate` — migration `0132_commercial-events-duplicate-subscription-outcome` widens the `commercial_events` outcome CHECK (`npm run dev` seeds but doesn't migrate). — backend
- [ ] `npm run dev` boots cleanly (API :3001, web :3000).
- [ ] `apps/api/.env`: Stripe **test-mode** keys, `STRIPE_AUTOMATIC_TAX=false`, and the local tier catalog applied (`npx portalops tier apply --env local`), so Plus and Pro show a price. — backend
- [ ] **Webhook state per section.** §1–§5 run with the webhook **down** (no `stripe listen`), so they prove the app no longer depends on it. §6 needs it **up**: `stripe listen --events customer.subscription.created,customer.subscription.updated,customer.subscription.deleted --forward-to localhost:3001/api/webhooks/stripe`, and `.env` `STRIPE_WEBHOOK_SECRET` equal to the `whsec_…` it prints (restart the API after changing it). — backend

### Fixtures

- [ ] A fresh org owned by your account, per section: `npx portalai org create --name "Smoke 939 §<n>" --owner-email <you> --env local --yes`, then `npx portalai member switch <orgId> <you> --env local --yes` and reload the app. Note `<orgId>`. — backend
- [ ] `psql "$(grep '^DATABASE_URL=' apps/api/.env | cut -d= -f2- | tr -d '"')"` open in a terminal, and `Q="select name, tier, stripe_customer_id, stripe_subscription_id from organizations where id='<orgId>';"` to re-read the org. — backend

### Reset between runs

- [ ] Each section uses its own org. Afterwards cancel its subscriptions (`stripe subscriptions cancel <sub> --confirm`) and delete it (`npx portalai org delete <orgId> --env local --yes`). Switch back to your main org at the end. — backend

## §1 — The checkout return confirms the plan without the webhook (webhook down)

- [ ] Settings → Subscription & Billing → **Subscribe** on Plus. Pay on Stripe Checkout with `4242 4242 4242 4242`, any future date, any CVC. — manual
- [ ] Expected: Stripe returns you to `/settings?tab=billing&billing=success`; the **Subscription & Billing** tab is open; a toast says "Subscription confirmed"; Current plan reads **Plus**; the URL no longer contains `billing=`.
- [ ] `$Q`: `tier = plus`, `stripe_subscription_id = sub_…`. `select type, outcome, resulting_tier, external_id from commercial_events where organization_id='<orgId>';` shows one `billing.sync` row, `applied`, `resulting_tier = plus`, `external_id` starting `sync:`. — backend
- [ ] Reload the page: no second toast, no second `billing.sync` row.

## §2 — Checkout refuses when Stripe already bills (webhook down)

Use §1's org after it has paid.

- [ ] Simulate the webhook never landing and the return page never syncing: `update organizations set tier='standard', stripe_subscription_id=null where id='<orgId>';`, then reload Settings → Subscription & Billing. — backend
- [ ] Click **Subscribe** on Pro. Expected: no redirect; the tab shows the error "The organization already has a subscription in Stripe — manage it in the billing portal" (`BILLING_ALREADY_SUBSCRIBED`). `stripe subscriptions list --customer <cus>` still shows exactly **one** active subscription.
- [ ] Open `/settings?tab=billing&billing=success` directly. Expected: "Subscription confirmed", plan back to **Plus** (sync re-converged it).

## §3 — Two tabs: only the newest session can be paid (webhook down)

Fresh org. First give it a customer: Subscribe on Plus, then close Stripe Checkout without paying (Back, or close the tab).

- [ ] Tab A: Settings → Subscribe on Plus; leave Stripe Checkout open, don't pay. — manual
- [ ] Tab B: open Settings → Subscription & Billing, Subscribe on Pro; Stripe Checkout opens. — manual
- [ ] Back in tab A, try to pay. Expected: Stripe shows the session as expired / no longer available; no charge. — manual
- [ ] Pay in tab B. Expected: one subscription in `stripe subscriptions list --customer <cus>`, on the Pro price; the return shows **Pro**. — manual

## §4 — Two first checkouts at once create one customer (webhook down)

Fresh org (no `stripe_customer_id`).

- [ ] In `psql`, hold the org's checkout lock: `select pg_advisory_lock(1111705675, hashtext('<orgId>'));` (1111705675 = `0x4243484b`, "BCHK"). — backend
- [ ] Open Settings → Subscription & Billing in **two tabs** and click Subscribe on Plus in both. Both buttons stay pending ("Redirecting…").
- [ ] In `psql`: `select pg_advisory_unlock(1111705675, hashtext('<orgId>'));`. — backend
- [ ] Expected: both tabs reach Stripe Checkout; `$Q` shows one `stripe_customer_id`; `stripe customers list --limit 5` shows **one** new customer named after the org (no orphan); the first tab's session, when you try to pay it, is expired. — backend + manual

## §5 — A pending payment holds Subscribe; a hand-set plan survives sync (webhook down)

Fresh org with a customer (Subscribe → close Checkout unpaid, as in §3).

- [ ] Create an unpaid subscription: `stripe subscriptions create --customer <cus> -d "items[0][price]=<plus price id>" -d payment_behavior=default_incomplete` (status `incomplete`). — backend
- [ ] `$Q`: `stripe_subscription_id` is still empty — an unpaid subscription is never tracked (with the webhook up too, its `created` event records `noop`). — backend
- [ ] Open `/settings?tab=billing&billing=success`. Expected: an info alert "Your payment is being processed — this page updates when it completes. Reload to check again."; every **Subscribe** button is greyed, and hovering one shows "Your payment is being processed"; plan unchanged (**Standard**).
- [ ] Cancel it (`stripe subscriptions cancel <sub> --confirm`), then `npx portalai org set-tier <orgId> enterprise --env local --yes`. Open `/settings?tab=billing&billing=success` again. Expected: an info toast "Stripe hasn't confirmed a subscription yet — if you paid, reload this page in a minute"; no processing alert; `$Q` still shows `tier = enterprise` (sync didn't reset it). — backend + browser

## §6 — Duplicates: the webhook follows the live one; delete cancels all (webhook up)

Fresh org; start `stripe listen` per Preflight.

- [ ] Subscribe on Plus and pay (`4242…`). Expected: plan **Plus**; `stripe_subscription_id = <subA>`. — manual
- [ ] Create a duplicate on the same customer, paid with the same card: `PM=$(stripe subscriptions retrieve <subA> | jq -r .default_payment_method)` then `stripe subscriptions create --customer <cus> -d "items[0][price]=<plus price id>" -d default_payment_method=$PM` → `<subB>`, `active`. — backend
- [ ] Expected: the API log has "Customer has more than one live Stripe subscription — cancel the extra one in Stripe"; the newest `commercial_events` row has `outcome = duplicate_subscription`; `<subB>` is **not** cancelled. — backend
- [ ] `stripe subscriptions cancel <subA> --confirm`. Expected: plan stays **Plus**; `$Q` shows `stripe_subscription_id = <subB>`. — backend + browser
- [ ] Create one more duplicate (`<subC>`, same command), then delete the org from Settings → Danger zone (type the org name, confirm).
- [ ] Expected: `stripe subscriptions list --customer <cus> --status all` shows `<subB>` and `<subC>` both `canceled`; the API log has "Cancelled Stripe subscription during organization delete" twice. — backend

## §7 — Error & edge cases

- [ ] **Stripe unreachable fails closed.** On an org with a customer, set `STRIPE_SECRET_KEY=sk_test_invalid` in `apps/api/.env`, restart the API, click Subscribe. Expected: the tab shows "Could not start checkout — please try again" (`BILLING_CHECKOUT_FAILED`), no redirect, no new customer or session in Stripe. Restore the key. — manual
- [ ] **FAQ.** Help → FAQ → "How do I upgrade my plan?" reads "…the Subscription & Billing tab confirms the payment with Stripe and shows your new plan; if the payment is still processing, it says so, and Subscribe stays unavailable so you can't pay twice."
- [ ] **Cancelled checkout.** Subscribe, then use Stripe's Back link. Expected: lands on the billing tab with "Checkout cancelled — your plan is unchanged"; no sync call (devtools → Network has no `/api/billing/sync`). — manual

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org id / Stripe customer / subscription / commercial_events row):
