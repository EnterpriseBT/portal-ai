# Production environment — Epic Smoke Suite

Manual smoke for epic [#83](https://github.com/EnterpriseBT/portal-ai/issues/83) — standing up `app.portalsai.io`, `api.portalsai.io` and `www.portalsai.io`. **Branch under test:** `epic/prod-environment` (children #382, #384, #383, #385, #386, #325, #387).

> **This is not the usual smoke doc.** The children were never smoked individually — none of their acceptance criteria are exercisable until a production environment exists, and merging them created nothing. So this walkthrough **is** the provisioning: you execute the runbooks and verify as you go, in order.
>
> **Three steps prove themselves once and do not retry cleanly.** They are marked ⚠️ ONE-SHOT. Read each one fully before running it.
>
> Runbooks: `docs/PROD_PROVISIONING.runbook.md` · `docs/PROD_DEPLOY.runbook.md` · `docs/PROD_STRIPE_LIVE.runbook.md`

## Preflight

### Access

- [x] `aws sts get-caller-identity` succeeds against account `028987315524`, region `us-east-1`
- [x] `gh auth status` has `project` scope; you can edit repository secrets and variables
- [x] Console access: Stripe (live), Auth0, Google Cloud, Microsoft Entra, Mapbox, Anthropic, Tavily
- [x] `npx portalops --help` and `npx portalai --help` run from a **fresh build** — `npm run build -w @portalai/cli-env && npm run build -w @portalai/devops-cli` (the CLIs run `dist/`, not `src/`)

### Decisions that must already be made

- [ ] Which tax jurisdictions you are registering in *(a tax-advisor answer — `PROD_STRIPE_LIVE.runbook.md` §6c refuses to proceed without it)*
- [ ] Which product tax code applies to the Plus/Pro products *(§6b — never guessed)*
- [ ] Prod RDS sizing, and the statement descriptor on the Stripe account

### Reset between runs

- [ ] **There is no reset.** This walkthrough creates real infrastructure and takes a real payment. Sections §1–§3 are resumable; §4 onward are not casually repeatable.

---

## §1 — Vendor accounts and config (`PROD_PROVISIONING.runbook.md`)

- [ ] `portalops vars describe --env prod --json` lists **24** keys under `portalai/prod/…` and `/portalai/prod/…`
- [x] Every value written **per key from stdin** (`vars set KEY -`), never `vars template`/`vars apply` — confirm no plaintext secrets file was created on disk
- [ ] Auth0 prod tenant: SPA app, API audience `https://api.portalsai.io`, post-login Action, and the device-flow M2M app all exist
- [ ] Google OAuth client and Entra app registration each carry **only** the prod callback URL — not dev's
- [ ] **Google consent screen is publishable**: app logo uploaded, and the terms-of-service and privacy-policy URLs point at live pages on `www.portalsai.io`. An unverified external-user app is capped and shows a warning interstitial mid-connector-auth
- [ ] **Microsoft publisher verification**: MPN / Partner ID associated with the app registration, and the publisher domain verified by **hosting the association file** — `apps/site/public/.well-known/microsoft-identity-association.json`, served at `https://www.portalsai.io/.well-known/microsoft-identity-association.json`. Set the app's publisher domain to `www.portalsai.io` (not the apex — the apex serves nothing, and its redirect is out of scope for this epic)
- [ ] The file's `applicationId` is the real Entra **application (client) id**, not the placeholder. The deploy **fails closed** if `REPLACE_WITH` survives, so a wrong file cannot publish
- [ ] After the site is live (§6): `curl -sI https://www.portalsai.io/.well-known/microsoft-identity-association.json` returns 200 with `content-type: application/json` **and `cache-control: public, max-age=0, must-revalidate`** — not `immutable`, or a later change to the file would be invisible for a year
- [ ] Anthropic, Tavily and Mapbox keys are **prod-only**, each with an account-level spend cap set
- [x] **`NAMESPACE` and `SYSTEM_ID` written as real UUIDs** and read back. Not the `portalsai-prod` string the earlier draft specified: `UUIDv5Factory` throws `Invalid UUID` on a non-UUID namespace, so the string form is a latent trap that app-dev still carries. Neither value is consumed today (`id.v5` / `id.system` have no call sites), so the earlier "irreversible" warning was overstated — verified by `v5()` succeeding against the written namespace
- [x] `support@`, `sales@` and `admin@portalsai.io` all **deliver** (send a test to each) *before* their SSM values are written
- [ ] **The two Stripe secrets are written here, not at §5.** `backend.yml` declares 11 `SecretArn*` parameters with **no defaults**, including `SecretArnStripeSecretKey` and `SecretArnStripeWebhookSecret` — so the backend stack cannot deploy without them. Create the live restricted key and the webhook endpoint (the endpoint can be registered before `api.portalsai.io` resolves; deliveries simply fail until it does), then write both. §5 covers the *account configuration* — tax, portal, the six events, the round-trip — which genuinely comes later
- [ ] `portalops vars list --env prod` shows **no `(unset)`** except `DATABASE_URL`, which §3 writes
- [ ] The `github-dispatch-token` path was proven in **app-dev** first — a `vars set` there fired a `deploy-site-dev` run

## §2 — First deploy: infrastructure (`PROD_DEPLOY.runbook.md`)

- [ ] The **`prod` GitHub Environment exists with required reviewers**, and `PROD_AWS_ROLE_ARN`'s OIDC trust policy is scoped to it. *(Before this, the gate `deploy-site-prod.yml` has claimed since #311 is fictional — a referenced-but-missing environment is auto-created unprotected.)*
- [ ] `PROD_HOSTED_ZONE_ID` and `PROD_VITE_AUTH0_{DOMAIN,CLIENT_ID,AUDIENCE}` set as repository secrets
- [ ] **Capture every existing secret's ARN into `PROD_SECRET_ARN_*`.** The ARN carries a random suffix Secrets Manager assigns, so it cannot be reconstructed from the name — and `backend.yml` takes secrets *by ARN*, not by path. `gh secret list | grep -c PROD_SECRET_ARN_` should reach **11** before the backend stack can create (12 with the optional dispatch token)
- [ ] Publish a GitHub release from `main`. The run **pauses for approval** rather than proceeding
- [ ] **Expect the first release to get as far as the backend stack and stop.** `DATABASE_URL` does not exist yet, so its ARN secret is empty and the backend stack cannot create. Network, database, bastion, cache and frontend all succeed. That is the point at which you go to §3 — this is a **two-release** first deploy, not a failure
- [ ] ⚠️ **ONE-SHOT — the first-deploy bootstrap.** `deploy-infra` logs `::notice::First deploy — creating the ECS service with DesiredCount=0 (ECR is empty)`. If that notice is absent on a first run, stop and read the log before continuing: the alternative is the backend stack rolling back
- [ ] Stacks exist: `portalai-prod-{network,database,bastion,cache,frontend,backend}`
- [ ] `aws rds describe-db-instances --db-instance-identifier portalai-prod` reports `BackupRetentionPeriod >= 14` and `DeletionProtection: true`
- [ ] `MultiAZ: false` — **a deliberate launch-cost deviation from #383**, which specified `true`. Reversible with a modify + brief failover. Until then an AZ or instance failure is downtime plus a restore, not an automatic failover, so retention and the pre-migration snapshot carry the recovery story. Worth a calendar reminder to revisit before real traffic
- [ ] The prod cache is an **ElastiCache ReplicationGroup** with `AutomaticFailoverEnabled` and non-zero snapshot retention — *not* a single-node CacheCluster
- [ ] The prod VPC CIDR is `10.0.0.0/16` — **the same block as dev**, and deliberately so. #383 recommended a distinct one; the first deploy proved `VpcCidr` is a parameter in name only, since the four subnets are hardcoded to `10.0.x.0/24` and a `10.1.0.0/16` VPC rejects every one. Separate VPCs may overlap; the only thing given up is future dev↔prod peering, which is not wanted
- [ ] **No `portalai-prod-dns-certs` stack exists.** One wildcard certificate, owned by `portalai-dev-dns-certs`, fronts app + api + www
- [ ] The release **did not** deploy `portalai-dns-email` and **did not** write any `/portalai/prod/*-email` placeholder

## §3 — First deploy: the database (`PROD_PROVISIONING.runbook.md` §10)

⚠️ **ONE-SHOT, and it sits between two halves of the same release.** RDS creates only the `postgres` maintenance database; nothing in the repo creates `portal_ai`. The first release **will fail at the migrate step** until this is done — that is expected, not a defect.

- [ ] `portalops db url --env prod --db-name postgres --write --yes --confirm-prod`
- [ ] `portalops db psql --env prod --confirm-prod -- -c "CREATE DATABASE portal_ai"`
- [ ] `portalops db url --env prod --write --yes --confirm-prod` *(the real value)*
- [ ] `portalops db psql --env prod --confirm-prod -- -c "\l"` lists `portal_ai`
- [ ] `portalops db url --env prod` (no `--write`) prints the password as `***`. **There is no flag that prints it**
- [ ] Re-run the release: an **RDS snapshot** named `portalai-prod-premigrate-…` exists from immediately before the migrate task, and migrate then seed both exit `0`
- [ ] The seed left exactly the catalog tiers + connector definitions — **no fixture orgs**

## §4 — API and app are live

- [ ] `curl https://api.portalsai.io/api/health` → 200
- [ ] No ECS task stopped with `ResourceNotFoundException` — that would be an unresolved secret ARN
- [ ] `https://app.portalsai.io` loads; Auth0 login succeeds; the post-login webhook verifies against the prod secret
- [ ] `grep -r "api-dev\|app-dev" ` over the served bundle finds **nothing**
- [ ] The app's Help view shows `support@portalsai.io` — **not `qa@`**. A `qa@` here means the SSM contacts were unset at build time and the build used its fallback
- [ ] Google Sheets **and** Microsoft Excel OAuth each round-trip against the prod callback URLs
- [ ] A public-REST-API connector syncs end to end
- [ ] **A geocode call succeeds, and a `bulk_geocode_records` job completes.** This is the only check that proves `GEOCODING_API_KEY` resolved — it fails *open*, so nothing else will tell you
- [ ] A custom webhook toolpack receives a `readUrl`/`writeUrl` pointing at `https://api.portalsai.io/api/webhook/handle/…` — **not `localhost`**

## §5 — Stripe live mode (`PROD_STRIPE_LIVE.runbook.md`)

- [ ] Tax Settings status reads **`active`**, not `pending`
- [ ] At least one tax registration shows as **Collecting**
- [ ] Each product carries an explicit tax code, and none is `txcd_00000000` (Nontaxable)
- [ ] The app's key is a **restricted** key (`rk_live_…`) with `subscriptions` **write** — verify by deleting a test org with a live subscription and confirming no 403
- [ ] A **separate read-only** key exists for prod *and* app-dev, and `stripe` CLI inspection uses it
- [ ] The webhook endpoint subscribes to **all six** events — the three `customer.subscription.*` **and** the three `price.*`
- [ ] `portalops tier apply --env prod --yes --confirm-prod` reports the paid rows converged onto **live-mode** price ids
- [ ] ⚠️ **ONE-SHOT — the first live charge.** Full round-trip: checkout → `customer.subscription.created` verified against the prod signing secret → the org's tier advances → the billing portal opens **with plan switching available** → returns to `https://app.portalsai.io`
- [ ] **The invoice carries a non-zero tax line**, and the Checkout Session's `taxability_reason` is **not** `not_collecting` *(retrieve with `expand[]=line_items.data.taxes`)*. **Every other check in this section passes in a world where you collect nothing** — and completed transactions cannot be corrected through Stripe
- [ ] `stripe_events` holds a row per delivered event, including the `ignored` ones

## §6 — Marketing site (`PROD_DEPLOY.runbook.md` → Activating www)

- [ ] **Before** setting the variable: publish a release → `deploy-site-prod` exits with a notice and publishes nothing
- [ ] `curl https://api.portalsai.io/api/public/site-config` → 200 with the live tiers
- [ ] Set `PROD_SITE_CONFIG_URL`, publish a release → the run is green, the preflight **passes**, and the fixture-stamp check finds nothing
- [ ] `https://www.portalsai.io` serves over the wildcard cert; `/pricing/` shows live amounts
- [ ] Footer and contact page show `support@` / `sales@` / `admin@portalsai.io` — **no `qa@` anywhere**
- [ ] `portalops vars set SUPPORT_EMAIL … --env prod --yes --confirm-prod` fires the `site-config-changed` dispatch and republishes with **no code change**
- [ ] Change a price amount in Stripe → `price.updated` is recorded `ignored` → the site republishes and `/pricing/` updates

## §7 — Tier allocations and the cost gate

- [ ] `/api/public/site-config` returns the production allocations (`pro` metered **50,000**, not `null`)
- [ ] Settings plan cards on `app.portalsai.io` render the live tiers and amounts
- [ ] On a `standard` org, exhaust `expensive` (101 geocoded rows) → the tool returns a **typed `TOOL_USAGE_QUOTA_EXCEEDED` result the agent relays** — not a crash, not a thrown error
- [ ] A `free`-class tool still works on that exhausted org — `free` is never charged and never denied

## §8 — CLI guards and audit (live, first time)

- [ ] `portalai login --env prod` completes the device flow
- [ ] `portalops db tunnel --env prod --confirm-prod` connects through the bastion
- [ ] A **destructive** op against prod is refused with exit **`6`**: `npx portalops db reset --env prod --yes --confirm-prod; echo $?`
- [ ] A **non-destructive mutation without `--confirm-prod`** is refused with exit **`5`**
- [ ] `portalops vars list --env prod` and `portalai org list --env prod` return real prod data
- [ ] `~/.portalai/audit.log` has a line per mutating op, and **no line contains a secret value**
- [ ] `grep -rn "pending #83" docs/` returns only `*.smoke.md` / `*.discovery.md` / `*.spec.md` / `*.plan.md` — historical records, correctly untouched

## §9 — Dev is unaffected (regression)

- [ ] An app-dev deploy after all this is green
- [ ] The ECS task's rendered `GOOGLE_OAUTH_REDIRECT_URI` / `MICROSOFT_OAUTH_REDIRECT_URI` are byte-identical to before
- [ ] `portalai-dev-cache` is still a single-node `CacheCluster` — **not replaced**
- [ ] `site-dev.portalsai.io` still deploys and still resolves its own cert stack

## §10 — Error & edge cases

- [ ] A plain push to `main` deploys **only** to dev and never touches prod
- [ ] A release published while `PROD_SITE_CONFIG_URL` is unset publishes nothing rather than failing
- [ ] Rollback: re-running the previous release's workflow restores the previous image. **Confirm you understand it does not revert the schema** — migrations must stay backward-compatible with the previous image
- [ ] No dev credential appears in any `portalai/prod/*` path

## Sign-off

- [ ] Every section above verified against the live production environment
- [ ] ______________ (date) — ______________ (name) — confirmed

## Bug-filing template

```
Section:      §<n>
Expected:
Got:
Repro:
Identifiers:  (org / job / stack / task / Stripe event ids)
Irreversible? (was this one of the ⚠️ ONE-SHOT steps)
```
