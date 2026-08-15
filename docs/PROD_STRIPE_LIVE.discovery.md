# Stripe live mode — Discovery

**Issue:** [EnterpriseBT/portal-ai#385](https://github.com/EnterpriseBT/portal-ai/issues/385) · child of epic [#83](https://github.com/EnterpriseBT/portal-ai/issues/83)

**Why this exists.** Every piece of billing mechanics has shipped — subscriptions (#176), Stripe Tax wiring (#217), the declarative tier catalog and `portalops tier apply` (#218), the sandbox account (#239), the webhook subscription guard (#230), in-app plan switching (#260). What has never existed is a **live-mode** Stripe account. Each Portal environment is a separate account; nothing crosses environments except lookup keys.

Almost none of this ticket is code. It is an account, a key, three products, a webhook endpoint, and a tax configuration — and the reason it needs a discovery rather than a checklist is that **the tax half fails silently and cannot be corrected afterwards**. That is the finding this document exists for.

## The current shape

| Piece | Location | Behavior |
|---|---|---|
| SDK wrapper | `apps/api/src/services/stripe.service.ts` | API version pinned `2026-06-24.dahlia` |
| Billing decisions | `apps/api/src/services/billing.service.ts` | checkout, portal, webhook handling, tier derivation |
| Webhook | `apps/api/src/routes/webhook.router.ts:237` | raw body, fail-closed: 503 unconfigured, 400 on bad signature |
| Handled events | `webhook.router.ts:172-176` | `customer.subscription.{created,updated,deleted}` |
| Price events | `billing.service.ts:31-36`, `:275` | recorded `ignored`, **and each first delivery fires a marketing-site rebuild** |
| Tax toggle | `environment.ts:33`, `stripe.service.ts:127-131` | `STRIPE_AUTOMATIC_TAX` defaults **on**; adds `automatic_tax`, `billing_address_collection: required`, `customer_update.address: auto` |
| Plan switching | `stripe.service.ts:159-161` | portal `flow_data.subscription_update_confirm` (#260) |
| Price resolution | `packages/devops-cli/src/stripe.ts` | **deliberately read-only** — resolves lookup keys, never creates |
| Lookup keys | `tier-catalog.ts:120,143` | `plus_monthly`, `pro_monthly`; `standard`/`enterprise` are `null` |
| Return URLs | `billing.service.ts:39-42` | derived from `CORS_ORIGIN[0]` — #384 already pins that ordering |

The integration itself is in good shape against current Stripe guidance: no `payment_method_types` anywhere (dynamic payment methods are left enabled), keys come from Secrets Manager rather than source, and the app already uses a restricted key in dev.

## The design space

### Decision 1 — Stripe Tax is the one thing that can go wrong invisibly and permanently

`STRIPE_AUTOMATIC_TAX` defaults **on** and is not set in `backend.yml`, so prod inherits `true`. The ticket says "that requires the origin address and a default `tax_behavior`, plus registrations." That is correct as far as it goes and badly understates the failure mode:

- Tax Settings has a `status` that stays **`pending` until a head-office address is set**, and `automatic_tax` **does not calculate at all** while pending.
- Stripe Tax only collects in jurisdictions with an **active registration**. Without one it **does not error** — it calculates zero. Enabling `automatic_tax` without an active registration is the single most common Stripe Tax mistake: the operator believes tax is on while collecting nothing.
- **Retroactive correction is not possible.** Transactions completed with zero tax cannot be fixed through Stripe. The only path is a tax advisor and amended filings with the authority.

So the exposure is not "tax might be misconfigured for a while." It is: **every live checkout between go-live and the first active registration is an unrecoverable under-collection**, and nothing in Stripe, our logs, or the app will say so.

| | A — go live with `automatic_tax` on, register later | B — registrations active **before** the first live checkout | C — set `STRIPE_AUTOMATIC_TAX=false` until registrations exist |
|---|---|---|---|
| Tax on early transactions | silently zero | correct | zero, but **deliberately and visibly** |
| Recoverable | **no** | n/a | it is a known, recorded decision |
| Signals the state | nothing | n/a | an explicit env var someone must flip back |

**Lean: B, with C as the honest fallback if registrations slip.** Never A. If the business is not ready to register before the first charge, the right move is to make the gap *explicit* — `STRIPE_AUTOMATIC_TAX=false` is already the documented "conscious, visible downgrade" for unconfigured sandboxes, and using it in prod turns an invisible unrecoverable loss into a recorded decision with a flag that has to be flipped back. The wrong move is to leave the default on and hope.

**This ticket cannot decide where to register.** That is a tax-advisor question about nexus and obligations. What this ticket owns is refusing to take the first live payment until someone has answered it.

### Decision 2 — product tax codes have no owner

A product tax code (PTC) goes on the **Product**; `tax_behavior` goes on the **Price**. Both are set when the object is created — and `portalops tier apply` is *deliberately read-only* (`devops-cli/src/stripe.ts:1-6`), so **the products and prices are created by hand and nothing in this repo sets or validates their tax code.**

That matters because a missing or wrong PTC produces the *same* silent zero-tax as a missing registration, and `taxability_reason: not_collecting` **cannot distinguish the two**. The Nontaxable code `txcd_00000000` is the trap.

The remediation ordering is also counter-intuitive and worth writing down: **verify the product tax code first, then add registrations.** Registering before confirming taxability can leave a registration in a jurisdiction where there is no taxable product.

**Lean: the runbook creates products with an explicit PTC and `tax_behavior`, and the choice of code is presented to the business rather than picked here.** Digital/SaaS candidates exist (the generic *Electronically Supplied Services* code is explicitly too broad for US state-level taxability), but which one is legally correct is not an engineering call. Whatever is chosen, it should also be applied to app-dev's sandbox products so the two accounts do not diverge in a way only prod discovers.

### Decision 3 — how many restricted keys, and the one that does not exist

Least privilege, one key per use case. The application needs, and only needs: **Customers** write, **Checkout Sessions** write, **Billing Portal Sessions** write, **Subscriptions** read, **Products/Prices** read.

The standing vendor rule is that operator/agent inspection uses a **separate read-only** key — mutation safety is the credential, not a prompt. **That key does not exist in any environment.** The Stripe CLI is installed in the devcontainer but unconfigured (`stripe config --list` → no config file), so today the only way to inspect any Stripe account from here is to borrow the application's write-capable key, which is exactly what the rule forbids.

| | A — one app RAK per env | B — app RAK + read-only inspection RAK per env |
|---|---|---|
| Matches the standing rule | no | yes |
| Inspection today | borrow the write key | its own credential |
| Cost | none | one more key per env |

**Lean: B, and create the app-dev read-only key in this ticket too.** Prod should not be the first environment where the rule is actually honored, and the inspection key is what makes `tier apply`'s fail-closed price resolution debuggable without handing an agent write access.

Also worth doing here: Stripe's recommended migration path is to prove a RAK's permission set in **test mode first** (`stripe logs tail`, fix 403s), then mint the live equivalent. That converts "did I tick the right boxes" from a live-mode discovery into a sandbox one.

### Decision 4 — which events the endpoint subscribes to

The ticket says subscribe to `customer.subscription.{created,updated,deleted}`. That is the set `webhook.router.ts:172` *handles* — but it is not the whole set the product *depends on*.

`billing.service.ts:275` fires a **marketing-site rebuild** on the first delivery of `price.created` / `price.updated` / `price.deleted`. Those events are recorded `ignored` (they change no tier state), but they are the mechanism by which a price change in Stripe republishes the amounts baked into the static site. **If the prod endpoint subscribes only to the three subscription events, that loop silently never fires** — a price change would leave the public pricing page stale until some other deploy happened.

**Lean: subscribe to all six** — the three `customer.subscription.*` and the three `price.*`. Everything else stays unsubscribed; unhandled types are recorded and ignored, so a narrow subscription is a feature, not an omission.

### Decision 5 — sequencing against verification lead time

Live mode requires a completed account: legal entity, representative, bank account, statement descriptor, support contact — and Stripe's review expects a **public site describing the product and pricing**, which is #386.

**Lean: start the account application on day one; submit once `www.portalsai.io` is reachable.** The paperwork does not depend on the site; only the submission does. The epic already sequences #386 before this ticket's submission, and that ordering is worth restating rather than rediscovering.

## Tradeoff comparison

| | Tax-before-charge (D1-B) | PTC in runbook (D2) | Two RAKs (D3-B) | Six events (D4) | Start-now (D5) |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes |
| Repo code change | **none** | none | none | none | none |
| Blocks go-live | **Yes** | Yes | No | No | Yes |
| Reversible if wrong | **No** | partly | yes | yes | n/a |

The striking row is the second: **this entire ticket changes no application code.** Its deliverable is a runbook plus a set of account-side facts, and its acceptance is a live subscription round-trip.

## Recommendation

1. **No live charge is taken until Stripe Tax is genuinely configured** — head-office address set (status `active`, not `pending`) *and* at least one active registration covering where we will actually charge. If that slips, set `STRIPE_AUTOMATIC_TAX=false` explicitly rather than leaving the default on and collecting nothing.
2. **Products carry an explicit product tax code and prices an explicit `tax_behavior`**, chosen by the business from Stripe's canonical list. Verify the code *before* adding registrations. Apply the same codes to the app-dev sandbox so the accounts do not diverge.
3. **Two restricted keys per environment**: the application's (customers/checkout/portal write, subscriptions/prices read) and a separate **read-only** key for operator and agent inspection. Create app-dev's read-only key too.
4. **Prove the RAK's permission set in the sandbox first** (`stripe logs tail`, fix 403s), then mint the live equivalent.
5. **The webhook endpoint subscribes to six events**, not three — the `price.*` trio is what republishes the marketing site.
6. **Begin the account application immediately**; submit for review once `www.portalsai.io` is live (#386).
7. **The deliverable is `docs/PROD_STRIPE_LIVE.runbook.md`**, written for any environment, with the tax verification as a gate rather than a step.

## Open questions

1. **Where are we obligated to register?** A nexus/obligation question, not an engineering one. **Lean: the business answers it with a tax advisor before the first charge; this ticket's job is to refuse to proceed without an answer.** Stripe's threshold monitoring (Dashboard → Tax → Locations) will flag new obligations later, which is a reason to check it periodically rather than once.
2. **Which product tax code?** **Lean: present the digital/SaaS candidates from Stripe's canonical list and let the business confirm** — never invent or hardcode a `txcd_`. The generic *Electronically Supplied Services* code is explicitly too broad for US state taxability.
3. **Does app-dev's sandbox get the same treatment?** **Lean: partly — yes to the read-only key and the product tax codes, no to registrations.** Test-mode tax needs no real registration, and matching the PTCs is what stops prod being the first place a taxability surprise appears.
4. **Statement descriptor and support contact?** Account-application fields with customer-visible consequences (the descriptor is what appears on a card statement and drives chargeback confusion when wrong). **Lean: use the business name and `support@portalsai.io`** — the address #384 provisions.

## Enterprise-scale considerations

- **Concurrency & correctness.** Webhook delivery is at-least-once and out-of-order; the handler already dedupes via `insertIfNew` on the event id and re-fetches the subscription before deriving a tier, so ordering cannot corrupt state. **Lean: no change** — this was designed in #176/#230.
- **Accuracy & auditability.** Every event is persisted to `stripe_events` with its outcome, including `ignored`. That is the audit trail for "why did this org's tier change", and it is exactly what a billing dispute needs. **Lean: sufficient.**
- **Failure modes.** Deliberately split, and correctly: an unconfigured webhook **fails closed** (503, Stripe retries, tier never silently advances); a bad signature fails closed (400); the site-rebuild dispatch **fails open** (swallowed, logged) so a rebuild outage cannot 500 a real billing event. The one that fails *open and silent* is **tax** — which is Decision 1 and the reason it is a gate.
- **Scale & unbounded growth.** `stripe_events` grows with delivery volume and has no retention policy of its own; the ledger purge covers the usage ledger, not this table. **Lean: out of scope, worth noting** — at current volumes it is nothing, and a retention decision on billing evidence is a compliance question, not a cleanup task.
- **Multi-tenancy.** One Stripe customer per org, created lazily and persisted before the session so a failed checkout cannot orphan one. Prod starts empty. **Lean: no change — and never repoint prod at a different Stripe account**, which would orphan every `stripe_customer_id` and 502 the billing endpoints.
- **Contract stability.** Lookup keys are the cross-environment identity; a live price is resolved, never created, by `tier apply`. Adding a tier or an environment needs no re-plumbing. **Lean: additive only.**
- **Data lifecycle.** Billing periods are Stripe's, not ours. `NAMESPACE`/`SYSTEM_ID` immutability (#384) and the customer-mapping warning above are the two write-once facts. **Lean: recorded, no action here.**

## What this doesn't decide

- **The amounts and the tier allocations** — that is **#325**. This ticket creates the products, the key, the webhook and the portal configuration; #325 sets the numbers and reruns `tier apply`.
- **Where to register for tax** and **which product tax code is legally correct** — open questions 1 and 2, answered by the business.
- **Billing mechanics of any kind** — checkout, webhook handling, portal flows, the subscription guard: all shipped.
- **The Stripe API version.** The SDK is pinned at `2026-06-24.dahlia` in two places (`stripe.service.ts` and `devops-cli/src/stripe.ts`, kept in sync by comment). A newer version exists. Upgrading is a deliberate, separately-testable change with its own migration guide — **not something to fold into a go-live ticket.** Worth its own issue.
- **`stripe_events` retention** (see the enterprise pass).
- New tiers or a new pricing model.

## Next step

`/spec 385` pins the contract: the exact RAK permission sets, the six-event webhook subscription, the tax configuration gate and its verification commands, the product/price creation shape (PTC + `tax_behavior` + lookup key), and the acceptance criteria for a live round-trip. `/plan 385` then slices it — likely a single runbook commit plus a doc-sync pass, since no application code changes. The verification that matters is not a test suite: it is a real subscription in live mode, with a non-zero tax line on the invoice.
