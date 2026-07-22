# STRIPE_SANDBOX_TIERS — Smoke Suite

Manual smoke test for [#239](https://github.com/EnterpriseBT/portal-ai/issues/239) — Stripe turned on in **app-dev** against a Stripe **sandbox**, plus a purchasable **Pro** tier. **Branch under test:** `feat/stripe-sandbox-tiers` (PR [#253](https://github.com/EnterpriseBT/portal-ai/pull/253)).

> **Read first — where this runs.** This is an operator runbook against **live app-dev + a Stripe sandbox account**, not `localhost`. Most steps are `portalops`/`stripe`/`aws` CLI + the app-dev web app. Because **app-dev auto-deploys from `main`**, the full checkout→webhook loop (§4) only lights up once this branch's `backend.yml`/`deploy-dev.yml` is deployed. Two honest ways to walk it pre-merge:
> - **(A) manual branch deploy** — after §2's secrets + GitHub secrets exist, deploy this branch's template to app-dev by hand (§2 step) and walk §3–§6 live, then merge; or
> - **(B) confirm on the merge deploy** — check §1–§3 + §5–§6 pre-merge, merge with CI green, then confirm §4 against the auto-deploy. Note which path you took in Sign-off.
>
> **Ordering is load-bearing** (spec §Risks): a `ValueFrom` ARN referencing a not-yet-created secret hard-fails ECS startup. Do §1 → §2 in order.

## Preflight

### Environment

- [ ] `git checkout feat/stripe-sandbox-tiers && git pull --ff-only`
- [ ] `npm install`; **rebuild the CLI _and_ core** — `npm run build -w @portalai/core -w @portalai/devops-cli` (or just `npm run build`). ⚠️ `npx portalops` runs `dist/`, not `src/`, for **both** packages: the new `STRIPE_WEBHOOK_SECRET` key won't resolve until `devops-cli` is rebuilt, and `tier apply` reads the widened `standard` + new `pro` rows from `TIER_CATALOG` in `@portalai/core` — a stale `core/dist` makes the dry-run show old allocations and omit `pro`.
- [ ] **AWS creds for app-dev** reach the JS SDK. In this devcontainer: `aws login --remote` in a real terminal, then `eval "$(aws configure export-credentials --format env)"`. Verify: `npx portalops vars describe --env app-dev` prints the catalog (now **19** keys — 10 secrets + 9 SSM — `STRIPE_WEBHOOK_SECRET` present at `portalai/dev/stripe-webhook-secret`).
- [ ] **Stripe sandbox access** — `stripe` CLI logged into the *sandbox* account (`stripe config --list` shows the sandbox, or use `--api-key sk_test_…`), and dashboard access to the same sandbox. Confirm it is a sandbox, not live.
- [ ] No migration; no schema change (spec §Migration).

### Fixtures

- [ ] An **app-dev org you own** with an authenticated owner session in the app-dev web app (`https://app-dev.portalsai.io`). Local dev identity is `bbgrabbag@gmail.com` if you exercise via the shared dev stack.
- [ ] The org is currently on the `standard` tier (default) — note its `tier` before you start (Settings → Organization, or `db psql`).

### Reset between runs

- [ ] `portalops tier apply` is idempotent — re-running converges to the same rows (second run = all `noop`). To re-test a purchase: in the Stripe sandbox, cancel the test subscription and clear the org's `stripeSubscriptionId`/`tier` back to `standard` via `portalops` app-data tooling or `db psql`. Sandbox test cards never charge real money.

## §1 — Provision the Pro product/price + webhook endpoint (Stripe sandbox)

Covers the preconditions for AC-3/AC-1/AC-2.

- [ ] Create the Pro product + a recurring price carrying the lookup key (dashboard, or CLI against the sandbox):
      `stripe prices create -d "product_data[name]=Pro" -d "unit_amount=4900" -d "currency=usd" -d "recurring[interval]=month" -d "lookup_key=pro_monthly"`
      **Expected:** a `price_…` id is returned; the amount (4900/whatever) is your sandbox choice — it never enters the repo.
- [ ] `stripe prices list --lookup-keys pro_monthly --active` → **exactly one active** price with `lookup_key: "pro_monthly"`.
- [ ] Create the sandbox **webhook endpoint** → URL `https://api-dev.portalsai.io/api/webhooks/stripe`, events ⊇ `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. **Capture the signing secret** (`whsec_…`) shown once on creation.

## §2 — Deliver the secrets to app-dev, in order (AC-5)

- [ ] `npx portalops vars set STRIPE_SECRET_KEY <sk_test_…> --env app-dev --yes` — a **writable** `sk_test_` key (not `rk_`). **Expected:** `{"key":"STRIPE_SECRET_KEY","updated":true,"created":…}`; a stderr warning if newly created; `~/.portalai/audit.log` gains a `vars set` line **containing no value**.
- [ ] `npx portalops vars set STRIPE_WEBHOOK_SECRET <whsec_…> --env app-dev --yes` — same shape; audit line, no value.
- [ ] Capture both ARNs: `aws secretsmanager describe-secret --secret-id portalai/dev/stripe-secret-key --query ARN --output text` and `… portalai/dev/stripe-webhook-secret …`. **Expected:** full ARNs incl. the random suffix.
- [ ] Set the two **GitHub secrets** on the repo: `DEV_SECRET_ARN_STRIPE_SECRET_KEY` and `DEV_SECRET_ARN_STRIPE_WEBHOOK_SECRET` = those ARNs (`gh secret set DEV_SECRET_ARN_STRIPE_SECRET_KEY --repo EnterpriseBT/portal-ai --body "<arn>"`).
- [ ] **Deploy the template** (path A — pre-merge) or note you'll confirm on merge (path B). Path A: `aws cloudformation deploy --stack-name portalai-dev-backend --template-file infra/cloudformation/backend.yml --parameter-overrides Environment=dev … SecretArnStripeSecretKey=<arn> SecretArnStripeWebhookSecret=<arn> --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset`. **Expected:** stack updates; the ECS service reaches **steady state** (task starts — proves the ARNs resolve; a dangling ARN would fail startup here).
- [ ] **Secret hygiene (AC-5):** the deploy-dev GitHub Actions run log shows only `SecretArn*=***`/ARNs, **no** `sk_test_`/`whsec_` values; `aws ecs describe-task-definition --task-definition portalai-api-dev` shows the `secrets` block referencing the two ARNs via `valueFrom` (not literal values); `git grep -nE "sk_test_|whsec_"` in the repo returns **nothing**.

## §3 — `tier apply` converges the catalog (AC-3, AC-4)

- [ ] `npx portalops tier apply --env app-dev --dry-run --json` → exit **0**; `changes` includes `{"slug":"pro","action":"insert","stripePriceId":"price_…"}` (a **resolved** sandbox price id, non-null) and `{"slug":"standard","action":"update", …}` (widened allocation fields, `from`→`to`). No write yet.
- [ ] `npx portalops tier apply --env app-dev` **without** `--yes` → exit **5** (`ENV_CONFIRMATION_REQUIRED`); nothing written.
- [ ] `npx portalops tier apply --env app-dev --yes` → exit **0**; upserts both; `~/.portalai/audit.log` gains a line per changed slug.
- [ ] Verify in DB: `npx portalops db psql --env app-dev -- -tAc "select slug, stripe_price_id, selectable, metered_units_per_period, expensive_units_per_period from tiers order by slug"` → `pro | price_… | t | (null) | 1000000` and `standard | (null) | t | (null) | 1000000`.

## §4 — The live checkout → webhook → convergence loop (AC-1, AC-2)

Requires the deployed template (path A or B). Perform as the org owner in the app-dev web app.

- [ ] `StripeService.isConfigured()` is true: `curl -s -o /dev/null -w "%{http_code}" -X POST https://api-dev.portalsai.io/api/billing/checkout` (authenticated, body `{"tier":"pro"}`) → **not 503**. Easiest via the app: trigger the Pro upgrade/checkout affordance and confirm it opens a real Stripe **Checkout** page (a `checkout.stripe.com` URL), not a `BILLING_NOT_CONFIGURED` error.
- [ ] Complete the checkout with a sandbox test card (`4242 4242 4242 4242`, any future expiry/CVC).
- [ ] The webhook fires and verifies: the Stripe sandbox webhook endpoint's recent deliveries show `customer.subscription.created` → **200** (signature verified; a 400 would mean the `whsec_` is wrong).
- [ ] The purchasing org converges to **`pro`**: Settings → Organization shows tier **Pro**; `db psql … "select tier, stripe_subscription_id from organizations where id = '<org>'"` → `pro | sub_…`.

## §5 — Non-purchasers are unaffected (AC-6)

- [ ] A **different** app-dev org that did **not** purchase still reads `tier = standard`; its `stripe_subscription_id` is null.
- [ ] That org's normal (non-Stripe) behavior is unchanged — it can use tools/connectors as before; the widened `standard` means no metered quota denial (metered is now unlimited), and `standard` remains **non-purchasable** (`stripeLookupKey: null` — no checkout affordance selects it as a *purchase*).

## §6 — Error & edge cases

- [ ] **Fail-closed on missing price (AC-4):** in the sandbox, temporarily archive the `pro_monthly` price (or `transfer_lookup_key` it away), then `npx portalops tier apply --env app-dev --dry-run` → **non-zero** exit with `TierApplyMissingPricesError`, **no DB write**. Restore the price afterward and re-run §3 to reconverge.
- [ ] **Wrong-scope key:** if `STRIPE_SECRET_KEY` were a read-only `rk_`, `isConfigured()` is still true but `POST /api/billing/checkout` errors at runtime (can't write a session). (Verify only if you want to confirm the failure mode — otherwise N/A; you set a writable `sk_test_` in §2.)
- [ ] **Bootstrap ordering:** confirm you never referenced an ARN before the secret existed — the §2 order (set → capture ARN → GitHub secret → deploy) is the safeguard; the ECS steady-state in §2 is the proof it held.

## Sign-off

- [ ] Every section above verified (path **B** chosen — §4 confirmed on the merge auto-deploy)
- [ ] CI green on PR #253 (`unit-test` + `integration-test`)
- [ ] __________ (date + name) — confirmed against app-dev + the Stripe sandbox

### Results recorded (evidence — the boxes above remain the operator's to check)

- **CI — green (2026-07-22).** On `fb4be44f`: `Unit Tests` ✅ (run 29944191160) + `Integration Tests` ✅ (run 29944191353). Unit Tests were red on the two prior commits (`952ac692`, `1d6f8a12`) because the #239 catalog change (widened `standard` + added purchasable `pro`) made the default `TIER_CATALOG` carry a `stripeLookupKey`, so six `tierApply` unit cases began hitting the real Stripe resolver with a fixture key — fixed in `fb4be44f` by scoping those cases to a standard-only injected catalog (`test(devops-cli)`). Filed follow-up [#254](https://github.com/EnterpriseBT/portal-ai/issues/254) for the missing-price `code:"UNKNOWN"`/exit-1 nit surfaced by §6 box 1 (behavior correct; typed-code granularity only).
- **Local §4 — bonus pre-verification (2026-07-22), NOT the app-dev gate.** Full checkout→webhook→convergence loop passed against the **local test-mode** Stripe account (`acct_1TtUZIBIP9e8yBAe`, product `Pro (Local)`, `$9`): `customer.subscription.created` → **`200`** (signature verified), and org `My Organization` converged to `pro` (`sub_1Tw428BIP9e8yBAefSfqDCXv`, fresh `cus_UvvtD0ceicqtxZ`). This exercises the same handler logic AC-1/AC-2 rely on; **app-dev §4 is still to be confirmed on the merge deploy (path B).**
- **App-dev §1–§3, §5, §6 box 1 — verified pre-merge (2026-07-22)** against the app-dev Stripe **sandbox** (`acct_1TtUgoLKUJkEyCTp`): Pro price `price_1Tw2PeLKUJkEyCTpOG2b2ezg`, secrets + GitHub ARNs delivered in order, `tier apply` converged (`pro`/`standard` rows as specified), fail-closed confirmed.

**Gate:** PR #253 merges only when CI is green **and** this walkthrough is confirmed. Enterprise/Custom plan (#241) is out of scope.

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org id / subscription id / price id / secret ARN / CFN stack event):
