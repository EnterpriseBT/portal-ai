# Stripe live mode — Plan

**Implements the spec TDD-first: pin the event sets the code consumes, then write the runbook that instructs an operator to subscribe to exactly those.**

Spec: `docs/PROD_STRIPE_LIVE.spec.md`. Discovery: `docs/PROD_STRIPE_LIVE.discovery.md`. Issue: #385 (epic #83). Builds on #384, whose `portalops vars set` path is how this ticket's two secrets reach `portalai/prod/*`, and #383, which deploys the API the webhook posts to.

**2 slices** — this ticket is almost entirely account configuration, and configuration is not testable from here. The single testable seam is where the code and the operator instruction can drift apart, and it is worth more than its size suggests: it is the only automated protection a code-free go-live ticket can have. Padding it into more slices would be dishonest about where the work actually is.

They land as **commits on `feat/prod-stripe-live`**, which PRs into `epic/prod-environment` — never into `main`.

```bash
npm run test:unit -w @portalai/api
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

**Sequencing rationale.** Slice 1 pins the code side and has no dependency on anything. Slice 2 adds the runbook *and the assertion that guards it* together, so the doc-coverage case lands with the document it covers rather than failing across a boundary. The account work — the key, the products, the webhook, the tax registrations — is not a commit in either slice; it is slice 2's content, executed by an operator.

---

## Slice 1 — pin the event sets the code consumes

Export the two module-private sets and pin their contents, so the union the webhook endpoint must subscribe to has a single machine-checked definition.

**Files**

- Edit: `apps/api/src/routes/webhook.router.ts` — export `STRIPE_SUBSCRIPTION_EVENTS` (`:172`).
- Edit: `apps/api/src/services/billing.service.ts` — export `STRIPE_PRICE_EVENTS` (`:31`).
- New: `apps/api/src/__tests__/stripe-webhook-events.test.ts`.

**Steps**

1. **Tests (spec cases 1, 2, 3, 5).** Import both sets — this fails first on the imports, since neither is exported yet. Then:
   - `STRIPE_SUBSCRIPTION_EVENTS` is exactly the three `customer.subscription.{created,updated,deleted}` types.
   - `STRIPE_PRICE_EVENTS` is exactly the three `price.{created,updated,deleted}` types.
   - The two sets are **disjoint** — a type in both would be handled *and* fire a rebuild, a shape `recordIgnoredEvent` cannot produce, so it would be a real bug rather than a redundancy.
   - The union has **six** members. A count pin, so adding a type is a deliberate act rather than something that slips past.
   Run; fail.
2. **Implement**: add `export` to both consts. No behavior change — nothing else moves.
3. Lint + type-check.

**Done when:** the four code-side cases pass and the six-event union has one definition the runbook can be checked against.

**Risk:** essentially none — `export` on two consts. The only thing to watch is that neither set is re-declared elsewhere; both are single-site definitions today.

---

## Slice 2 — the runbook, its guard, and the docs sync

The operator artifact, plus the assertion that keeps it honest against slice 1's sets.

**Files**

- New: `docs/PROD_STRIPE_LIVE.runbook.md`.
- Edit: `apps/api/src/__tests__/stripe-webhook-events.test.ts` — spec case 4.
- Edit: `docs/STRIPE_CLI_OPS.md` — the read-only inspection key, and the stale line at `:18` claiming the Stripe secret is "not yet wired into `backend.yml` for app-dev" (it is: `SecretArnStripeSecretKey` / `SecretArnStripeWebhookSecret`).

**Steps**

1. **Tests (spec case 4).** Read `docs/PROD_STRIPE_LIVE.runbook.md` and assert **every member of the union appears in it**. Run; fail — the runbook does not exist yet, which is the correct first failure.
2. **Write the runbook**, in the spec's order, with the tax section as a **gate rather than a step**:
   - the account application and what it needs (legal entity, representative, bank account, statement descriptor, support contact), started first because of the review queue;
   - the two restricted keys and their exact permissions — including that **`subscriptions` is write**, not read, because `cancelSubscription` runs on the org-delete path, and that the read-only key is created for app-dev too;
   - proving the key's permission set in the sandbox first (`stripe logs tail`, fix 403s) before minting the live equivalent;
   - creating the two products with an explicit **product tax code** and the prices with `tax_behavior` and the `plus_monthly` / `pro_monthly` lookup keys — amounts are #325's;
   - the webhook endpoint and **all six** events, spelling out that the `price.*` trio changes no tier state and is what republishes the marketing site;
   - **the tax gate**: head-office address → verify the product tax codes → registrations → verify with a real transaction expanding `line_items.data.taxes` and confirming `taxability_reason` is not `not_collecting`. State plainly that without an active registration Stripe collects **zero tax, raises no error, and the transactions cannot be corrected afterwards**, and that `STRIPE_AUTOMATIC_TAX=false` is the honest fallback if registrations slip;
   - the billing-portal configuration with plan switching and the Plus/Pro products allow-listed;
   - handing the two secret values to `portalops vars set … --env prod` (#384's path).
   Green.
3. **Sync `docs/STRIPE_CLI_OPS.md`** — document the read-only inspection key as the credential agent/operator inspection uses, and correct the stale app-dev line.
4. Lint + format.

**Done when:** the runbook exists, the guard proves it lists exactly the six events the code consumes, and `STRIPE_CLI_OPS.md` no longer states something untrue about app-dev.

**Risk:** the runbook is the only place several irreversible facts are written down — the tax gate above all. The failure mode is not a broken build; it is someone following it and collecting no tax. Write the gate as a gate: a step someone can skip is worse than useless here.

---

## Sequence summary

| # | Lands | Gating check |
|---|---|---|
| 1 | Exported event sets + four code-side pins | `npm run test:unit -w @portalai/api` green |
| 2 | Runbook + doc-coverage guard + `STRIPE_CLI_OPS.md` sync | same suite green, now including case 4 |

## Cross-slice notes

- **Case 4 is deliberately in slice 2, not slice 1.** It asserts the runbook covers the union, and the runbook does not exist until slice 2 — putting it in slice 1 would mean a test failing across a commit boundary, which the plan's own rules forbid. Splitting the guard file across two commits is not artificial: each case lands with the subject it guards.
- **Nothing in this PR provisions anything.** Merging it creates no Stripe object. The account, keys, products, webhook and registrations are operator acts against slice 2's runbook, and the acceptance evidence is a live invoice with a non-zero tax line — not a passing suite.
- **Two decisions stay open by design** and the runbook must ask rather than answer them: which jurisdictions to register in, and which product tax code is legally correct. Both are business/tax-advisor calls. The runbook's job is to refuse to proceed without them.
- **This ticket blocks #325**, which sets the amounts on the products created here — `tier apply` fails closed on an unresolvable lookup key, so the prices must exist first.
- **Doc surfaces in this PR:** `docs/STRIPE_CLI_OPS.md` (the read-only key + the stale line). Its "prod (pending #83)" section belongs to **#387**, which rewrites the whole family once the epic's outcome is real.
- **Out of scope but noted in the spec:** the Stripe API version is pinned at `2026-06-24.dahlia` in two places while a newer version exists. That upgrade is deliberate, separately testable, and does not belong in a go-live ticket.

## Next step

Implementation begins on this branch once discovery, spec and plan are confirmed — slice 1 first, tests-first, one commit per slice, PR into `epic/prod-environment`.
