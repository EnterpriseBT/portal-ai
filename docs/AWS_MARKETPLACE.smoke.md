# aws-marketplace — Smoke Suite

Manual smoke test for [#568](https://github.com/EnterpriseBT/portal-ai/issues/568) — the AWS Marketplace entitlement-to-tier adapter: `commercial_events` store, the `AwsMarketplaceGrantSource`, the SNS webhook, and the term-derived read-only degradation.

**Branch under test:** `feat/568-aws-marketplace` (base `epic/enterprise-deployment`). **PR:** _to be opened_.

Run **§Preflight** once. Sections are independent after it. Steps tagged **`— manual`** need a real AWS Marketplace listing / test-account subscription (an operator/console step — see `docs/AWS_MARKETPLACE.runbook.md`); everything else is locally runnable against your own dev stack (commands + `db:studio` inspection, and the read-only gate through the app).

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, type `Bug`, link this file's section (template at the bottom).

---

## Preflight

### Environment

- [ ] `git checkout feat/568-aws-marketplace && git pull --ff-only`
- [ ] `npm install` — adds `@aws-sdk/client-marketplace-entitlement-service` + `sns-validator`.
- [ ] `cd apps/api && npm run db:migrate` — applies **0094** (rename `stripe_events` → `commercial_events` + `source`) and **0095** (org `marketplace_entitlement_id` + `entitlement_through`). Confirm both apply cleanly.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`); the API log shows no error registering the webhook router.

### Fixtures

- [ ] A seeded org + a signed-in user (the dev login, `bbgrabbag@gmail.com`) so the app resolves a current org. `db:studio` (from `apps/api/`) to inspect/edit `organizations` + `commercial_events`.
- [ ] **`— manual`** For the real marketplace path: an AWS Marketplace **test-account subscription** to the EKS listing, with `AWS_MARKETPLACE_PRODUCT_CODE` set and the SNS topic subscribed to `…/api/webhooks/aws-marketplace` (runbook §"One-time listing setup").

### Reset between runs

- [ ] `db:studio` → `organizations`: reset the test org's `entitlement_through` to `NULL` and `marketplace_entitlement_id` to `NULL` between §3 runs. `git checkout` any local edits.

## §1 — `commercial_events` rename (AC5, AC7)

- [ ] `db:studio` → the **`commercial_events`** table exists (no `stripe_events`); columns include `source`, `external_id`, and the outcome enum. *(agent-walkable — command)*
- [ ] Any pre-existing Stripe rows carry **`source = 'stripe'`** (the rename preserved them). *(agent-walkable — command)*
- [ ] `organizations` has `marketplace_entitlement_id` (UNIQUE where not null) + `entitlement_through`. *(agent-walkable — command)*

## §2 — Marketplace subscription → tier (AC1)

- [ ] **`— manual`** Subscribe the AWS test account to the listing. An SNS `Notification` hits the webhook → `db:studio` → `organizations`: the install's org has `tier = 'enterprise'` and a future `entitlement_through`; `marketplace_entitlement_id` is the AWS CustomerIdentifier.
- [ ] **`— manual`** A `commercial_events` row exists with `source = 'aws_marketplace'`, `outcome = 'applied'`; **no Stripe object** was created (`StripeService.isConfigured()` may be false).
- [ ] _Locally, the mocked equivalent is covered by_ `aws-marketplace-grant.test.ts` _(cases 10–14) and_ `commercial-events.repository.integration.test.ts`.

## §3 — Read-only degradation (AC2)

The gate is fully local — flip the term directly and observe the app.

- [ ] In `db:studio` → `organizations`, set the current org's `entitlement_through` to a **past** epoch-ms value (e.g. `1700000000000`). *(agent-walkable — command)*
- [ ] In the running app, attempt a **write** (create/edit a station, connector, or record). It is rejected **403 `ORG_ENTITLEMENT_EXPIRED`** (an error toast; the network response `code` is `ORG_ENTITLEMENT_EXPIRED`). *(agent-walkable — browser)*
- [ ] A **read** (loading any list/detail view) still works — reads are never gated, no data lost. *(agent-walkable — browser)*
- [ ] Set `entitlement_through` to a **future** value → the same write now succeeds (renewal restores writes). *(agent-walkable — browser)*
- [ ] Set `entitlement_through` to `NULL` (SaaS/never-granted) → writes succeed (a null term is never read-only). *(agent-walkable — browser)*

## §4 — Idempotency + foreign-guard (AC3, AC4)

- [ ] **`— manual`** Redeliver the same SNS `MessageId` (re-publish from the SNS console) → a **single** `commercial_events` row for that `(aws_marketplace, MessageId)`; the second delivery is a no-op (`duplicate`).
- [ ] **`— manual`** With the org already tracking one `marketplace_entitlement_id`, a notification whose `GetEntitlements` returns a **different** CustomerIdentifier records `outcome = 'foreign'` and does **not** move the org.
- [ ] _Locally covered by_ `aws-marketplace-grant.test.ts` _(case 12 foreign, case 14 duplicate) and_ `commercial-events.repository.integration.test.ts` _(the `(source, external_id)` arbiter)._

## §5 — Stripe rail unchanged (AC5)

- [ ] The SaaS Stripe billing flow is unaffected — the webhook still dedups + writes `org.tier` through `commercial_events` with `source = 'stripe'`. *(agent-walkable — command:* `cd apps/api && npm run test:integration -- --testPathPattern stripe-webhook` *— export `STRIPE_WEBHOOK_SECRET`/`STRIPE_SECRET_KEY` first)*

## §6 — SNS signature + config gate (AC6)

- [ ] With `AWS_MARKETPLACE_PRODUCT_CODE` **unset** (default), `curl -sS -X POST localhost:3001/api/webhooks/aws-marketplace -H 'Content-Type: text/plain' -d '{"Type":"Notification","MessageId":"x"}'` → **404** `MARKETPLACE_NOT_CONFIGURED`. *(agent-walkable — command)*
- [ ] With the product code **set** (restart the API), the same `curl` of an **unsigned/forged** body → **400 `MARKETPLACE_SIGNATURE_INVALID`** (sns-validator rejects it); no tier change. *(agent-walkable — command)*
- [ ] **`— manual`** A genuinely AWS-signed `Notification` is accepted (200) — requires a real SNS delivery.

## §7 — Automated gates (AC7)

- [ ] `cd apps/api && npm run test:unit` — green (includes `marketplace.service`, `aws-marketplace-grant`, `require-org-writable`, the renamed `commercial-events`/`tier-grant`/`billing` suites). *(agent-walkable — command)*
- [ ] `cd apps/api && npm run test:integration` — green (commercial-events dedup, org unique+finder, the SNS route, the read-only gate). *(agent-walkable — command; needs the DB harness + `STRIPE_*` exported)*
- [ ] `npm run type-check` + `npm run lint` clean at repo root; `npm run build --workspace @portalai/api` builds. *(agent-walkable — command)*

---

## Sign-off

- [ ] §1 (rename) — `commercial_events` + `source`; existing rows `source='stripe'`; org columns present.
- [ ] §2 (subscription → tier) — **manual**, epic smoke against a test AWS account.
- [ ] §3 (read-only) — lapsed term 403s writes with `ORG_ENTITLEMENT_EXPIRED`; reads pass; renewal + null restore writes.
- [ ] §4 (idempotency + foreign) — **manual**, epic smoke (locally unit/integration-covered).
- [ ] §5 (Stripe rail) — unchanged.
- [ ] §6 (signature + config gate) — 404 unconfigured; 400 on a forged body.
- [ ] §7 (gates) — unit + integration + type-check + lint + build green.
- [ ] _date + name_ — confirmed against my own running stack.

**Gate:** the PR merges only when CI is green **and** a human confirms this walkthrough. The **`— manual`** marketplace-flow sections (§2, §4, the §6 signed happy-path) are completed during the #569 epic smoke against a real AWS Marketplace test-account subscription, not in isolation.

## Bug-filing template

```
Section: §<X> — <name>
Expected: <what the smoke doc says>
Got: <curl output / db row / error code>
Repro: <config + steps>
Identifiers: <org id, commercial_events external_id, AWS CustomerIdentifier>
```
