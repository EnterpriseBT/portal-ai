# duplicate_checkout_subscriptions — Adversarial Review

Adversarial probes for [#939](https://github.com/EnterpriseBT/portal-ai/issues/939): the per-org locked, Stripe-checked checkout, `POST /api/billing/sync`, per-customer webhook convergence, and org-delete cancelling every live subscription. **Branch under test:** `fix/939-duplicate-checkout-subscriptions` (PR [#942](https://github.com/EnterpriseBT/portal-ai/pull/942)).

The change is a billing write path with new Stripe reads and one new route, so §2–§7 are engaged and §1 is `N/A`. Untagged probes are browser-drivable; `— backend` probes are `curl` / `psql` / `stripe` against the local stack; `— manual` needs a human (Stripe-hosted pages, the Stripe dashboard).

## Preflight

### Environment
- [ ] Same as the smoke doc's Preflight: branch checked out, migration `0132` applied, `npm run dev` up, test-mode Stripe keys, tier catalog applied.
- [ ] Webhook **down** unless a probe says otherwise; for those, `stripe listen --events customer.subscription.created,customer.subscription.updated,customer.subscription.deleted --forward-to localhost:3001/api/webhooks/stripe` with a matching `STRIPE_WEBHOOK_SECRET`.
- [ ] Playwright MCP available; owner and member sessions fresh (`e2e:auth`, `e2e:auth:member`).

### Fixtures
- [ ] A fresh org per probe group (`npx portalai org create … --owner-email <owner> --env local --yes` + `member switch`), as in the smoke doc. A paid subscription can be stood in with the CLI: `stripe payment_methods attach pm_card_visa --customer <cus>` then `stripe subscriptions create --customer <cus> -d "items[0][price]=<plus price>" -d default_payment_method=<pm>`, with `stripe_customer_id` set on the org first. — backend
- [ ] A **second** org `<OTHER>` with its own Stripe customer and an active subscription, not reachable by the walking identities. — backend
- [ ] Access tokens for API probes: `OWNER_TOKEN`, `MEMBER_TOKEN` (from the identities' `packages/e2e/.auth/*.storageState.json`); delete any copies afterwards. `U=localhost:3001/api/billing`.

### Reset between runs
- [ ] Delete the probe orgs (`npx portalai org delete <id> --env local --yes`) and their Stripe customers (`stripe customers delete <cus> --confirm`, which cancels their subscriptions). Switch the identities back to `e2e-fixture`. — backend

## §1 — Boundary & limit inputs
- N/A — the sync route takes no fields, and checkout's only input (`tier`) is unchanged by this PR. The one new bound (a customer's subscription list read as one page of 100) can't be reached without creating 100+ subscriptions, and past it the plan still converges from the newest 100.

## §2 — Malformed & injection input
- [ ] `curl -X POST $U/sync -H "Authorization: Bearer $OWNER_TOKEN" -H Content-Type:application/json -d '{"organizationId":"<OTHER>"}'` — expected SAFE: `400 BILLING_INVALID_PAYLOAD` naming the unknown key; no Stripe call (no new `commercial_events` row for either org). — backend
- [ ] Same with `-d '[]'`, `-d '"x"'` and `-d 'null'` — expected SAFE: each a 400, never a 500. — backend
- [ ] Form-encoded: `curl -X POST $U/sync -H "Authorization: Bearer $OWNER_TOKEN" -d 'organizationId=<OTHER>'` — expected SAFE: `415 REQUEST_UNSUPPORTED_MEDIA_TYPE`. — backend
- [ ] Bodiless: `curl -X POST $U/sync -H "Authorization: Bearer $OWNER_TOKEN" -H "Content-Length: 0"` — expected SAFE: `200` (an empty body is `{}`), syncing the caller's own org. — backend

## §3 — Concurrency & races
- [ ] Double-click **Subscribe** (two clicks under 100 ms), then also press it again after "Redirecting…" — expected SAFE: exactly one `POST /api/billing/checkout` in devtools → Network; one Checkout session for the customer (`stripe checkout sessions list --customer <cus>`).
- [ ] Ten parallel syncs on an org whose paid subscription the webhook never recorded: `for i in $(seq 10); do curl -s -X POST $U/sync -H "Authorization: Bearer $OWNER_TOKEN" -o /dev/null -w "%{http_code} " & done; wait` — expected SAFE: all `200`; the org ends on the paid tier; **exactly one** `billing.sync` row (the rest find it already converged under the row lock); no `DB_ADMISSION_TIMEOUT` 503. — backend
- [ ] Rename racing a first checkout (#938 regression under the new lock): hold the org row in psql (`begin; select … for update; update organizations set name='Renamed 939' …;`), click Subscribe, then `commit;` within 20 s — expected SAFE: Checkout opens, and `stripe customers retrieve <cus>` shows `name = Renamed 939`. — backend + browser
- [ ] Rename while a checkout for an org that **already has a customer** is held on the checkout lock (hold `pg_advisory_lock(1111705675, hashtext('<org>'))` in psql, click Subscribe, then rename from Settings → Organization) — expected SAFE: the rename saves immediately (the advisory lock doesn't take the org row); release the lock and the checkout completes. — backend + browser
- [ ] Sync racing a late webhook: with `stripe listen` up but paused (Ctrl-Z) while you pay, open the return page (sync converges), then resume the forwarder (`fg`) — expected SAFE: the delivered events record `noop` (or `applied` with the same tier); the plan stays on the paid tier. — manual

## §4 — Auth & permission boundaries
- [ ] Member drives sync anyway: `curl -X POST $U/sync -H "Authorization: Bearer $MEMBER_TOKEN"` on an org whose paid subscription the webhook never recorded — expected SAFE: `403 PERMISSION_DENIED` "You don't have permission to manage billing."; the org's tier unchanged; no `billing.sync` row. — backend
- [ ] Member opens `/settings?tab=billing&billing=success` — expected SAFE: a 403 toast naming the permission, no plan change; no Subscribe buttons (member lacks `billing.manage`); no misleading "payment is being processed" claim.
- [ ] Unauthenticated: `curl -X POST $U/sync` — expected SAFE: `401`, nothing written. — backend

## §5 — Multi-tenant isolation
- [ ] Owner of org A tries to reach `<OTHER>` through sync: `curl -X POST "$U/sync?organizationId=<OTHER>" -H "Authorization: Bearer $OWNER_TOKEN" -H "X-Organization-Id: <OTHER>"` — expected SAFE: `200` for **org A only**; `<OTHER>`'s tier and `commercial_events` untouched. — backend
- [ ] Forged metadata: on org A's customer, create a subscription tagged for `<OTHER>` (`stripe subscriptions create --customer <A's cus> … -d "metadata[organizationId]=<OTHER>"`) with the webhook up — expected SAFE: only org A converges (it owns the customer); `<OTHER>` unchanged; metadata is never read to route a grant. — backend
- [ ] Delete org A while `<OTHER>` has an active subscription — expected SAFE: only subscriptions on A's customer are cancelled; `<OTHER>`'s subscription stays `active`. — backend + browser

## §6 — State & lifecycle abuse
- [ ] Stripe customer deleted out from under the org: `stripe customers delete <cus> --confirm`, keep `stripe_customer_id` on the org, then click Subscribe and open the return page — expected SAFE: checkout `502 BILLING_CHECKOUT_FAILED`, sync `502 BILLING_SYNC_FAILED` (fixed copy, no Stripe error text leaked); no 500; nothing written. — backend + browser
- [ ] Resubscribe after cancelling: cancel the paid subscription (`stripe subscriptions cancel <sub> --confirm`, webhook up) so the org reverts to Standard, then Subscribe again — expected SAFE: allowed (an ended subscription doesn't block); pays into one new subscription. — manual
- [ ] Managed org with a leftover live subscription: on an org with an active Plus subscription, `npx portalai org set-tier <org> enterprise --env local --yes --allow-stripe-desync`, then open `/settings?tab=billing&billing=success` — expected: the plan follows Stripe (Plus), the same rule the webhook applies; the operator's flag says they accept the desync. Record what the page shows; a revert here is by design, not a finding.
- [ ] Sync with a token minted before the org was deleted: capture `OWNER_TOKEN`, delete the org from Settings → Danger zone, replay `curl -X POST $U/sync -H "Authorization: Bearer $OWNER_TOKEN"` — expected SAFE: `404` (no current org) or a sync of the user's *other* current org, never a write to the tombstoned row. — backend

## §7 — Misuse sequences
- [ ] Forged return link: an org that never checked out opens `/settings?tab=billing&billing=success` — expected SAFE: "Stripe hasn't confirmed a subscription yet…" toast; nothing written; Subscribe still enabled.
- [ ] Reload the return URL repeatedly (5×) after a converged checkout — expected SAFE: one `billing.sync` row total; later loads change nothing.
- [ ] Pay, then before returning click **Subscribe** on Pro in another tab — expected SAFE: `409 BILLING_ALREADY_SUBSCRIBED` (Stripe already lists the Plus subscription); no second Checkout session. — manual
- [ ] Use Stripe's Back link from Checkout, then the browser's Back button to return to the Checkout page and pay — expected SAFE: the session is still payable once (not expired by a cancel); exactly one subscription results. — manual

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| _(filled during the walk; empty when every probe held)_ | | | |

## Sign-off
- [ ] Every probe walked; findings resolved or waived-with-reason
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (org id / Stripe customer / subscription / commercial_events row):
