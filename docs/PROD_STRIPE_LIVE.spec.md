# Stripe live mode — Spec

Pins the contract for [#385](https://github.com/EnterpriseBT/portal-ai/issues/385) (child of epic [#83](https://github.com/EnterpriseBT/portal-ai/issues/83)): the two restricted-key permission sets, the products/prices shape, the six-event webhook subscription, the tax configuration **gate**, the billing-portal configuration, and the one guard test that keeps the operator instruction honest against the code. Rationale is in [`PROD_STRIPE_LIVE.discovery.md`](./PROD_STRIPE_LIVE.discovery.md).

## Key decisions (flag for review)

1. **Tax is a gate, not a step.** No live charge is taken until Tax Settings reports `active` (head-office address set) **and** at least one active registration covers where we charge. Without a registration Stripe collects **zero tax, returns no error, and the transactions cannot be corrected afterwards**.
2. **If registrations slip, `STRIPE_AUTOMATIC_TAX=false` is set explicitly** rather than leaving the default on. An invisible unrecoverable under-collection becomes a recorded decision with a flag to flip back.
3. **The webhook subscribes to six events, not three.** The `price.*` trio is what republishes the marketing site's baked-in amounts.
4. **Two restricted keys per environment** — the application's, and a separate read-only one for operator/agent inspection. app-dev gets the read-only key too.
5. **The application key needs `subscriptions` WRITE, not read.** #83 and #385 both say "subscriptions read"; `StripeService.cancelSubscription` calls `subscriptions.cancel` on the org-delete path.
6. **Product tax code and `tax_behavior` are set at creation and chosen by the business.** Nothing in the repo sets or validates them, and a wrong code is indistinguishable from a missing registration.

## Scope

### In scope

- The live Stripe account: activation, statement descriptor, support contact.
- Two restricted keys per environment; the app-dev read-only key as well.
- Live products + prices carrying `plus_monthly` / `pro_monthly`, each with an explicit product tax code and `tax_behavior`.
- The webhook endpoint, its six-event subscription, and its signing secret.
- Stripe Tax: head-office address, registrations, verification.
- Billing-portal configuration with plan switching and the products allow-listed.
- `docs/PROD_STRIPE_LIVE.runbook.md`.
- **One code change:** export the two event sets so a guard test can assert the runbook documents exactly what the code consumes.

### Out of scope

- **The amounts and tier allocations** — #325. This ticket creates the products and the plumbing; #325 sets the numbers and reruns `tier apply`.
- **Where to register** and **which tax code is legally correct** — business decisions. This ticket refuses to proceed without them; it does not make them.
- All billing mechanics (checkout, webhook handling, portal flows, the subscription guard) — shipped in #176/#217/#218/#230/#239/#260.
- Writing the two secrets into AWS — the values originate here, the write path is #384's `portalops vars set`.
- **The Stripe API version.** Pinned at `2026-06-24.dahlia` in `stripe.service.ts` and `devops-cli/src/stripe.ts`; a newer version exists. A deliberate, separately-testable upgrade, not go-live work.
- `stripe_events` retention.
- **No schema change: no migration, no seed change.**

## Surface

### The application restricted key → `portalai/<env>/stripe-secret-key`

Derived from the actual call sites, not from the ticket's prose:

| API call | Site | Resource | Access |
|---|---|---|---|
| `customers.create` | `stripe.service.ts:99` | Customers | **write** |
| `checkout.sessions.create` | `:108` | Checkout Sessions | **write** |
| `billingPortal.sessions.create` | `:153` | Billing Portal Sessions | **write** |
| `subscriptions.retrieve` | `:89` | Subscriptions | read |
| `subscriptions.cancel` | `:180` | Subscriptions | **write** |
| `prices.retrieve` | `:196` | Prices | read |
| `prices.list({ lookup_keys })` | `devops-cli/src/stripe.ts:80` | Prices | read |
| `webhooks.constructEvent` | `:72` | — | none (local HMAC) |

**`subscriptions` is write.** `cancelSubscription` runs on the org-delete path (#197); a read-only grant makes org deletion fail with a 403 that only appears when someone deletes an organization.

**Note the same key is used by `portalops tier apply`** (`devops-cli/src/stripe.ts:60` reads `stripe-secret-key`), which calls `prices.list`. That is why Prices-read is required even though the app's own display path could be cached away — and it is the concrete instance of the gap Decision 4 closes.

### The operator read-only key

Separate credential, **no write permissions at all**: Prices read, Products read, Subscriptions read, Customers read. Stored outside the catalog — it is an operator credential, not application config — and used for `stripe` CLI inspection and agent-assisted diagnosis.

Per the standing rule, mutation safety for vendor CLIs is the credential itself, never a prompt or an allowlist. **Create app-dev's too**; prod must not be the first environment where the rule is honored.

**Prove the permission set in the sandbox first**: mint the test-mode key, run the integration against it with `stripe logs tail`, fix any 403s, then mint the live equivalent. This turns "did I tick the right boxes" into a sandbox question.

### Products and prices (live account)

Two products, each with one recurring monthly price:

| Product | Price lookup key | Required at creation |
|---|---|---|
| Plus | `plus_monthly` | product **tax code**; price `tax_behavior`; recurring `month` |
| Pro | `pro_monthly` | same |

- **The lookup key is the contract** — `tier apply` resolves by it and fails closed if absent (`TierApplyMissingPricesError`). Amounts are #325's.
- `getPrice` only renders a price whose `recurring.interval` is `month` or `year` and whose `unit_amount` is non-null; anything else degrades to a plan card with no number rather than an error.
- **The product tax code must be explicit and must not be `txcd_00000000` (Nontaxable)** — that code produces the same silent zero-tax as a missing registration, and `taxability_reason: not_collecting` cannot distinguish them.
- **Apply the same tax codes to the app-dev sandbox products** so the two accounts do not diverge in a way only prod discovers.
- `standard` and `enterprise` carry `stripeLookupKey: null` and need no Stripe object.

### Webhook endpoint

`https://api.portalsai.io/api/webhooks/stripe`, signing secret → `portalai/prod/stripe-webhook-secret`.

**Subscribed events — all six:**

```
customer.subscription.created     handled → derives the org's tier
customer.subscription.updated     handled
customer.subscription.deleted     handled
price.created                     recorded `ignored` → fires a site rebuild
price.updated                     recorded `ignored` → fires a site rebuild
price.deleted                     recorded `ignored` → fires a site rebuild
```

The `price.*` trio changes no tier state, which is why it is easy to leave off — and it is the mechanism that republishes amounts baked into the static marketing site (`billing.service.ts:275`). Subscribe to three and a prod price change leaves the public pricing page stale indefinitely.

Everything else stays unsubscribed. Unhandled types are recorded and ignored, so a narrow subscription is deliberate.

Until the signing secret is set the endpoint returns **503** and Stripe retries — non-fatal, but no org's tier advances.

### Stripe Tax — the gate

Ordered, and the ordering is load-bearing:

1. **Head-office address** in Tax Settings. Status reads `pending` until set, and `automatic_tax` does not calculate while pending.
2. **Verify each product's tax code** — before registrations, not after. Registering first can leave a registration in a jurisdiction with no taxable product.
3. **Add a registration** for each jurisdiction we are obligated to collect in. *Which jurisdictions is a business/tax-advisor decision this spec does not make.*
4. **Verify with a real transaction**: retrieve the Checkout Session with `expand[]=line_items.data.taxes` and confirm `taxability_reason` is **not** `not_collecting`.

`STRIPE_AUTOMATIC_TAX` is unset in `backend.yml`, so prod inherits `true`. If steps 1–3 are not complete before the first live charge, set it to `false` explicitly and record why.

### Billing portal configuration

Live-account configuration must **enable plan switching and allow-list the Plus and Pro products**. `createPortalSession` deep-links `flow_data.subscription_update_confirm` (#260) at a target price; without the products allow-listed that flow has no valid target and the in-app upgrade path fails at the portal rather than in our code.

`return_url` derives from `CORS_ORIGIN[0]` — #384 already pins that the prod app URL is first.

### The one code change

`STRIPE_SUBSCRIPTION_EVENTS` (`webhook.router.ts:172`) and `STRIPE_PRICE_EVENTS` (`billing.service.ts:31`) are module-private consts. **Export both** so a guard test can assert the runbook documents exactly the set the code consumes. No behavior change.

## Migration / Seed

**None.** No Drizzle table, Zod model or seed change.

## TDD test plan

This ticket is almost entirely account configuration, and configuration is not testable from here. The one thing that *is* testable is the seam where the code and the operator instruction can drift — which is precisely the failure this spec exists to prevent.

### `apps/api` — `npm run test:unit -w @portalai/api`

New: `src/__tests__/stripe-webhook-events.test.ts`

1. `STRIPE_SUBSCRIPTION_EVENTS` is exactly the three `customer.subscription.*` types.
2. `STRIPE_PRICE_EVENTS` is exactly the three `price.*` types.
3. The two sets are disjoint — a type in both would be handled *and* trigger a rebuild, which is not a shape the code supports.
4. **The runbook documents every event in the union.** Reading `docs/PROD_STRIPE_LIVE.runbook.md` and asserting each of the six appears is what stops a future handled type being added in code while the endpoint's subscription list silently under-covers it.
5. The union has six members — a count pin, so adding a type forces a deliberate update rather than passing by accident.

**Totals ≈ 5 cases.**

### Not covered by tests

Everything else: key permissions, tax registrations, portal configuration, product tax codes. These are verified by the acceptance criteria below against the live account, and by the smoke checklist.

## Acceptance criteria

- The live account is activated and can accept a charge.
- The app's key is **restricted** (`rk_live_…`), not a secret key, and carries exactly the permissions in the table above — verified by the integration working end to end with no 403s.
- A **separate read-only** key exists for prod *and* app-dev, and `stripe` CLI inspection uses it.
- `portalops tier apply --env prod --yes --confirm-prod` reports the paid rows converged onto **live-mode** price ids.
- The Settings plan cards on `app.portalsai.io` render the live tiers with amounts.
- **A live subscription round-trip**: checkout → `customer.subscription.created` verified against the prod signing secret → the org's tier advances → the billing portal opens with plan switching available and returns to `https://app.portalsai.io`.
- **The invoice shows a non-zero tax line**, and the Checkout Session's `taxability_reason` is not `not_collecting`. *This is the criterion that proves tax is real rather than nominally enabled.*
- Tax Settings status is `active`, not `pending`.
- A price change in the live account fires `price.updated`, is recorded `ignored`, and **republishes `www.portalsai.io`**.
- Deleting an organization with a live subscription cancels it in Stripe without a 403 — the `subscriptions` write grant.
- `stripe_events` holds a row per delivered event, including the ignored ones.
- Prod's org→customer mapping starts empty, and prod is never repointed at a different Stripe account.

## Risks & rollback

| Risk | Detection | Rollback |
|---|---|---|
| **`automatic_tax` on with no active registration** | None from Stripe — zero tax, no error. Only the acceptance check above catches it | **None. Completed transactions cannot be corrected through Stripe**; the path is a tax advisor and amended filings. This is why tax is a gate, not a step |
| **Product tax code missing or `txcd_00000000`** | Same silent zero tax; `taxability_reason` cannot distinguish it from a registration gap | Fix the code, re-test. Past transactions equally unrecoverable |
| **Key granted `subscriptions` read only** | Org deletion 403s — a path nobody exercises until someone deletes an org | Widen the key |
| **Endpoint subscribed to three events** | The pricing page silently goes stale after a price change | Add the `price.*` events; a manual site rebuild republishes |
| **Portal products not allow-listed** | #260's in-app plan switch fails at the portal | Dashboard configuration change, immediate |
| **Prod repointed at another Stripe account** | Every `stripe_customer_id` orphans; billing endpoints 502 "No such customer" | Effectively none — treat the account as permanent |

**Fail-mode posture.** Billing fails **closed** everywhere it can: an unconfigured webhook 503s and Stripe retries, a bad signature 400s, and no tier advances without a verified event. The site-rebuild dispatch fails **open** by design so a rebuild outage cannot 500 a real billing event. **Tax is the one thing that fails open *and silent*** — hence the gate.

## Files touched

- Edit: `apps/api/src/routes/webhook.router.ts` — export `STRIPE_SUBSCRIPTION_EVENTS`
- Edit: `apps/api/src/services/billing.service.ts` — export `STRIPE_PRICE_EVENTS`
- New: `apps/api/src/__tests__/stripe-webhook-events.test.ts`
- New: `docs/PROD_STRIPE_LIVE.runbook.md`
- Edit: `docs/STRIPE_CLI_OPS.md` — the read-only inspection key; also fix the stale line claiming the Stripe secret is "not yet wired into `backend.yml` for app-dev" (it is)

## Next step

`/plan 385` slices this into two commits: (1) export the two event sets behind the guard test, and (2) the runbook plus the `STRIPE_CLI_OPS.md` sync. The account work itself is not a commit — it is the runbook's content, executed by an operator, and the acceptance evidence is a live invoice with a tax line on it.
