# stripe-subscription-billing — Smoke Suite

Manual smoke test for [#176](https://github.com/EnterpriseBT/portal-ai/issues/176) — Stripe subscription billing: `organizations.tier` driven by a real Stripe subscription (signature-verified webhook, dedup'd through `stripe_events`), owner-only checkout/portal endpoints, per-org billing-anchor usage periods, and the Settings "Subscription & Billing" tab. **Branch under test:** `feat/stripe-subscription-billing` (PR [#215](https://github.com/EnterpriseBT/portal-ai/pull/215) into `epic/subscription-billing`).

**All sections verified 2026-07-15** (§6 member-token checks and §8 key-flip steps skipped — see inline notes). Run **§Preflight** once. §1–§4 are a continuous story (unsubscribed → checkout → subscribed → cancel) and should be walked in order; §5–§8 are independent after preflight. The "all new tests pass, lint/type-check clean" acceptance criterion is the **CI half of the gate**, not a walkthrough step here.

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, set type `Bug`, link this file's section in the issue body (template at the bottom).

---

## Preflight

### Environment

- [x] `git checkout feat/stripe-subscription-billing && git pull --ff-only`
- [x] `npm install && npm run build --workspace=packages/core` — new billing contracts + `StripeEvent` model; the API and web need the rebuilt core dist.
- [x] `cd apps/api && npm run db:migrate && cd ../..` — migration `0068_add_stripe_billing_columns_and_events.sql` adds the `tiers`/`organizations` Stripe columns, creates `stripe_events`, and backfills `standard.selectable = true`. Confirm it applies cleanly.
- [x] Stripe **test-mode** keys in `apps/api/.env`: `STRIPE_SECRET_KEY` (prefer a restricted `rk_test_…` key scoped per `.env.example`; a plain `sk_test_…` also works, and `stripe sandbox create` mints sandbox credentials without an account) and `STRIPE_WEBHOOK_SECRET=whsec_…` (printed by `stripe listen` below).
- [x] `stripe login` (once), then in its own terminal: `stripe listen --forward-to localhost:3001/api/webhooks/stripe` — leave it running for the whole walkthrough. Copy its `whsec_…` into `.env` **before** booting the API.
- [x] `npm run dev` boots cleanly (API `:3001`, web `:3000`); Auth0 dev login lands on `/dashboard`.
- [x] `http://localhost:3001/api-docs` shows the four new routes: `POST /api/webhooks/stripe`, `GET /api/billing/tiers`, `POST /api/billing/checkout`, `POST /api/billing/portal`.

### Fixtures

This preflight **is** the "adding a paid tier requires only a `tiers` INSERT + a Stripe price — no deploy" acceptance criterion: nothing below touches code.

- [x] Create a test product + monthly price:
  ```bash
  stripe prices create --unit-amount 4900 --currency usd \
    -d "recurring[interval]=month" -d "product_data[name]=Portal Pro (smoke)"
  ```
  Note the returned `price_…` id.
- [x] Insert a scratch **purchasable** tier mapped to it (psql or `npm run db:studio` from `apps/api/`):
  ```sql
  INSERT INTO tiers (id, created, created_by, slug, display_name, period_kind,
    period_anchor_day, overage, metered_units_per_period, metered_rate_per_min,
    expensive_units_per_period, expensive_rate_per_min, stripe_price_id, selectable)
  VALUES (gen_random_uuid()::text, (extract(epoch from now())*1000)::bigint, 'SYSTEM',
    'pro-smoke', 'Pro (smoke)', 'monthly', 1, 'hard-deny', 10000, 50, 1000, 10,
    '<price_… id from above>', true);
  ```
- [x] Insert a scratch **managed/custom** tier (unlisted, unpriced) for §6:
  ```sql
  INSERT INTO tiers (id, created, created_by, slug, display_name, period_kind,
    period_anchor_day, overage, metered_units_per_period, metered_rate_per_min,
    expensive_units_per_period, expensive_rate_per_min, stripe_price_id, selectable)
  VALUES (gen_random_uuid()::text, (extract(epoch from now())*1000)::bigint, 'SYSTEM',
    'enterprise-smoke', 'Enterprise (smoke)', 'monthly', 1, 'hard-deny', 99999, 99,
    9999, 99, NULL, false);
  ```
- [x] Your dev org is **unsubscribed**: in `db:studio` → `organizations`, your org row has `tier = 'standard'`, `stripe_customer_id`, `stripe_subscription_id`, `billing_anchor_day` all NULL.
- [x] *(for §6, optional)* A second, **non-owner** member in your org (e.g. via the `portalai` admin CLI member commands). If you don't have one, §6's curl fallback covers the server side.
- [x] *(for §3)* A station with a metered tool available (e.g. `web_search`) so a usage charge can be observed.

### Reset between runs

- [x] Cancel any test subscription (Stripe Dashboard → test mode → Subscriptions → Cancel immediately), then let the webhook revert the org — or reset by hand:
  ```sql
  UPDATE organizations SET tier='standard', stripe_subscription_id=NULL,
    billing_anchor_day=NULL WHERE id='<org id>';
  DELETE FROM stripe_events;
  ```
  (`stripe_customer_id` may stay — checkout reuses it.)

---

## §1 — Plan list & tab states (Billing tab, Organization tab untouched)

- [x] Settings → a third tab **Subscription & Billing** exists after Profile / Organization.
- [x] As the org **owner**, open it (unsubscribed state): "Current plan: **Standard**" and plan cards for **Standard** and **Pro (smoke)** — and **not** `Enterprise (smoke)` (unlisted).
- [x] Standard card shows "Free" and **no** Subscribe button; Pro (smoke) shows **$49 / month** (live from Stripe) and an enabled **Subscribe**.
- [x] The **Organization** tab still renders the same "Subscription & Usage" display as before this branch (tier name + free/metered/expensive usage rows) — the #172 surface is untouched.
- [x] `GET http://localhost:3001/api/billing/tiers` (Swagger UI → Authorize with your bearer token) returns `{ tiers: [...] }` with `purchasable: false, price: null` for standard and `purchasable: true, price: { unitAmount: 4900, currency: "usd", interval: "month" }` for pro-smoke.

## §2 — Checkout → the webhook writes the tier

- [x] Click **Subscribe** on Pro (smoke). The browser redirects to a `checkout.stripe.com` page showing Portal Pro (smoke), $49.00/month.
- [x] Pay with the test card `4242 4242 4242 4242` (any future expiry, any CVC/ZIP).
- [x] You land back on `/settings?billing=success` → toast: **"Subscription confirmed — your plan updates within a few seconds"**, and the `billing` param is stripped from the URL.
- [x] The `stripe listen` terminal shows `customer.subscription.created`/`updated` forwarded with `[200]` responses.
- [x] `db:studio` → `organizations`: your org now has `tier = 'pro-smoke'`, `stripe_customer_id = cus_…`, `stripe_subscription_id = sub_…`, and `billing_anchor_day` = **today's UTC day-of-month** (≤ 28 — if today is the 29th–31st, it must read 28).
- [x] `db:studio` → `stripe_events`: at least one row with `outcome = 'applied'`, `resulting_tier = 'pro-smoke'`, `organization_id` = your org. (Extra rows with `noop`/`ignored` from the same checkout are fine.)
- [x] The tier flip happened **without** reloading anything server-side — the webhook, not the redirect, wrote it (the redirect only refreshed the page's cache).

## §3 — Anchored usage period (gate counter and balance agree)

- [x] Settings → Organization: the tier now reads **Pro (smoke)** and the metered/expensive allocations show pro-smoke's numbers (10000 / 1000) — a fresh period for the new plan.
- [x] In a portal session, run one metered call (e.g. prompt **"search the web for today's weather in Denver"**).
- [x] `db:studio` → `usage`: the charge landed in a row whose `period_id` is the current period (e.g. `2026-07`) for your org — and Settings → Organization metered "used" reflects the same count (both readers key the same anchored period).

## §4 — Portal, plan management, cancel → revert

- [x] Back on Subscription & Billing (subscribed state): the plan list is **hidden**; a **Manage subscription** button shows with the "handled in the secure Stripe billing portal" note.
- [x] Click it → redirects to a `billing.stripe.com` portal session for your customer showing the active Pro (smoke) subscription.
- [x] In the portal, **cancel the subscription immediately** — walked note: the portal config offers end-of-period only (desired); the immediate cancel was performed via the Stripe CLI (the sanctioned Dashboard-equivalent). Bonus observed: the end-of-period toggle produced two `noop` converge events, org untouched.
- [x] `stripe listen` shows `customer.subscription.deleted` → `[200]`.
- [x] `db:studio` → `organizations`: `tier` reverted to `standard`, `stripe_subscription_id` and `billing_anchor_day` are NULL, **`stripe_customer_id` is kept**.
- [x] The Billing tab (after a refresh) is back to the unsubscribed plan list.

## §5 — Webhook robustness: redelivery, out-of-order, unmatched, forged

- [x] **Redelivery is a no-op:** pick an `evt_…` id from `stripe_events.event_id` (or the `stripe listen` output) and `stripe events resend <evt_id>`. Expect `[200]` in the listener, **no new row** in `stripe_events` for that id (still exactly one), and the org row unchanged.
- [x] **Unmatched customer:** `stripe trigger customer.subscription.created` (creates a fixture subscription for a customer no org owns). Expect `[200]` and a new `stripe_events` row with `outcome = 'unmatched'`, `organization_id` NULL — and your org untouched.
- [x] **Forged event is rejected:**
  ```bash
  curl -i -X POST http://localhost:3001/api/webhooks/stripe \
    -H 'content-type: application/json' -H 'stripe-signature: t=1,v1=deadbeef' \
    -d '{"id":"evt_forged","type":"customer.subscription.updated","data":{"object":{}}}'
  ```
  Expect **400** `WEBHOOK_INVALID_SIGNATURE`, no `stripe_events` row for `evt_forged`, org untouched. Repeat without the `stripe-signature` header → **400** `WEBHOOK_MISSING_SIGNATURE`.

## §6 — Server-enforced guards (owner-only, subscribed, managed)

Grab a bearer token for curl: DevTools → Network → any `/api/` request → copy the `Authorization` header value.

- [ ] ~~**Non-owner (UI)**~~ — **skipped** (single-user dev stack; pinned by unit case 31 + integration case 27).
- [ ] ~~**Non-owner (server)**~~ — **skipped** (no second member; pinned by integration case 27):
  ```bash
  curl -s -X POST http://localhost:3001/api/billing/checkout \
    -H "Authorization: Bearer <member token>" -H 'content-type: application/json' \
    -d '{"tier":"pro-smoke"}'
  ```
  Expect **403** `BILLING_NOT_OWNER`.
- [x] **Already subscribed:** while subscribed (re-run §2 first, or before §4's cancel), the same checkout curl with the **owner's** token → **409** `BILLING_ALREADY_SUBSCRIBED`. The UI equivalently hides the plan list.
- [x] **Managed custom tier is server-blocked:** while unsubscribed, `UPDATE organizations SET tier='enterprise-smoke' WHERE id='<org id>';` then:
  - [x] The Billing tab shows "Current plan: **Enterprise (smoke)**" + the info notice "Your plan is managed — contact us to make changes" — no plan list, no buttons.
  - [x] The owner checkout curl (`{"tier":"pro-smoke"}`) → **409** `BILLING_TIER_MANAGED` (hidden **and** blocked).
  - [x] Reset: `UPDATE organizations SET tier='standard' WHERE id='<org id>';`
- [x] **Portal without a customer:** on a fresh org that has never checked out (`stripe_customer_id` NULL — reset it if needed), `POST /api/billing/portal` with the owner's token → **409** `BILLING_NO_SUBSCRIPTION`.
- [x] **Unknown/unpurchasable tier:** owner checkout with `{"tier":"bogus"}` → **404** `BILLING_TIER_NOT_FOUND`; with `{"tier":"standard"}` → **400** `BILLING_TIER_NOT_PURCHASABLE`.

## §7 — Org delete cancels the subscription

> Destructive — use a **scratch org** (create one via the `portalai` admin CLI or a second account), not your main dev org.

- [x] Subscribe the scratch org to Pro (smoke) (§2 flow, its own owner login).
- [x] Settings → Organization → Danger zone → **Delete organization** (type-to-confirm). The delete succeeds.
- [x] Stripe Dashboard (test mode) → Subscriptions: the scratch org's subscription is **canceled** (immediately, not at period end).
- [x] `db:studio` → `organizations`: the tombstoned row (deleted ≠ NULL) **keeps** both `stripe_customer_id` and `stripe_subscription_id`.
- [x] *(Not manually smokeable: a Stripe outage during delete. The "cancel throws → delete still succeeds, warn logged" half is covered by the integration suite — case 18.)*

## §8 — Error & edge cases

- [ ] ~~**Unconfigured env degrades, never breaks:**~~ — **skipped** (integration-covered; the configured direction was verified live — unsigned webhook POST → 400 MISSING_SIGNATURE, not 503): stop the API, comment out both `STRIPE_*` keys in `.env`, restart. The app boots; the Billing tab's plan list still renders (tiers read is DB-backed) but **Subscribe** → error alert with **503** `BILLING_NOT_CONFIGURED`; the webhook curl from §5 → **503** `WEBHOOK_MISSING_SECRET`. Restore the keys and restart.
- [ ] ~~**Price display degradation:**~~ — **skipped** per the doc's own note (unit case 13 / integration case 26): with the API up but Stripe unreachable (temporarily set `STRIPE_SECRET_KEY=sk_test_invalid`), the plan list still renders; Pro (smoke) shows **—** for its price but remains purchasable-looking; nothing 500s. Restore the key. *(Skip if you'd rather not touch keys twice — covered by unit case 13/26.)*
- [x] **Checkout cancelled return:** start a checkout, click Stripe's back/cancel link → you land on `/settings?billing=cancelled` → neutral toast "Checkout cancelled — your plan is unchanged"; org row untouched.
- [x] *(Not manually smokeable in reasonable time: `past_due` dunning grace — forcing a failed renewal needs Stripe test clocks. The D3 status table (past_due holds the paid tier; terminal states revert) is pinned by unit cases 10–11 and the §4 revert above exercises the terminal path end-to-end.)*

## Sign-off

- [x] Every section above verified
- [x] 2026-07-15 — Ben Turner (@bbgrabbag) — confirmed against my own running stack (browser flows walked by me; CLI/DB/curl probes driven via Claude Code in the shared devcontainer)

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/subscription/event ids):
