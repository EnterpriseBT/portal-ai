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
- [x] After the site is live (§6): `curl -sI https://www.portalsai.io/.well-known/microsoft-identity-association.json` returns 200 with `content-type: application/json` **and `cache-control: public, max-age=0, must-revalidate`** — not `immutable`, or a later change to the file would be invisible for a year
- [ ] Anthropic, Tavily and Mapbox keys are **prod-only**, each with an account-level spend cap set
- [x] **`NAMESPACE` and `SYSTEM_ID` written as real UUIDs** and read back. Not the `portalsai-prod` string the earlier draft specified: `UUIDv5Factory` throws `Invalid UUID` on a non-UUID namespace, so the string form is a latent trap that app-dev still carries. Neither value is consumed today (`id.v5` / `id.system` have no call sites), so the earlier "irreversible" warning was overstated — verified by `v5()` succeeding against the written namespace
- [x] `support@`, `sales@` and `admin@portalsai.io` all **deliver** (send a test to each) *before* their SSM values are written
- [ ] **The two Stripe secrets are written here, not at §5.** `backend.yml` declares 11 `SecretArn*` parameters with **no defaults**, including `SecretArnStripeSecretKey` and `SecretArnStripeWebhookSecret` — so the backend stack cannot deploy without them. Create the live restricted key and the webhook endpoint (the endpoint can be registered before `api.portalsai.io` resolves; deliveries simply fail until it does), then write both. §5 covers the *account configuration* — tax, portal, the six events, the round-trip — which genuinely comes later
- [ ] `portalops vars list --env prod` shows **no `(unset)`** except `DATABASE_URL`, which §3 writes
- [ ] The `github-dispatch-token` path was proven in **app-dev** first — a `vars set` there fired a `deploy-site-dev` run

## §2 — First deploy: infrastructure (`PROD_DEPLOY.runbook.md`)

- [x] The **`prod` GitHub Environment exists with required reviewers**, and `PROD_AWS_ROLE_ARN`'s OIDC trust policy is scoped to it. *(Before this, the gate `deploy-site-prod.yml` has claimed since #311 is fictional — a referenced-but-missing environment is auto-created unprotected.)*
- [x] `PROD_HOSTED_ZONE_ID` and `PROD_VITE_AUTH0_{DOMAIN,CLIENT_ID,AUDIENCE}` set as repository secrets
- [x] **Capture every existing secret's ARN into `PROD_SECRET_ARN_*`.** The ARN carries a random suffix Secrets Manager assigns, so it cannot be reconstructed from the name — and `backend.yml` takes secrets *by ARN*, not by path. `gh secret list | grep -c PROD_SECRET_ARN_` should reach **11** before the backend stack can create (12 with the optional dispatch token)
- [x] Publish a GitHub release from `main`. The run **pauses for approval** rather than proceeding
- [x] **Expect the first release to get as far as the backend stack and stop.** `DATABASE_URL` does not exist yet, so its ARN secret is empty and the backend stack cannot create. Network, database, bastion, cache and frontend all succeed. That is the point at which you go to §3 — this is a **two-release** first deploy, not a failure
- [ ] ⚠️ **ONE-SHOT — the first-deploy bootstrap.** `deploy-infra` logs `::notice::First deploy — creating the ECS service with DesiredCount=0 (ECR is empty)`. If that notice is absent on a first run, stop and read the log before continuing: the alternative is the backend stack rolling back

  **Left unchecked deliberately — this did not hold on the real first run.** The bootstrap keyed on *"does ECR hold any image"*, found the `prod-<sha>` tag pushed moments earlier, and scaled to `DesiredCount=2` while `ImageTag` was still `latest` — a tag prod never publishes. Result: an hour of `ECSService NotStabilized`. [#402](https://github.com/EnterpriseBT/portal-ai/issues/402) changed the signal to **stack existence** and stopped `deploy-infra` scaling up at all, so the notice text above is now stale as well. **Only re-verifiable on the next environment built from scratch** — do not check it against this one
- [x] Stacks exist: `portalai-prod-{network,database,bastion,cache,frontend,backend}`
- [x] `aws rds describe-db-instances --db-instance-identifier portalai-prod` reports `BackupRetentionPeriod >= 14` and `DeletionProtection: true`
- [x] `MultiAZ: false` — **a deliberate launch-cost deviation from #383**, which specified `true`. Reversible with a modify + brief failover. Until then an AZ or instance failure is downtime plus a restore, not an automatic failover, so retention and the pre-migration snapshot carry the recovery story. Worth a calendar reminder to revisit before real traffic
- [x] The prod cache is an **ElastiCache ReplicationGroup** with `AutomaticFailoverEnabled` and non-zero snapshot retention — *not* a single-node CacheCluster
- [x] The prod VPC CIDR is `10.0.0.0/16` — **the same block as dev**, and deliberately so. #383 recommended a distinct one; the first deploy proved `VpcCidr` is a parameter in name only, since the four subnets are hardcoded to `10.0.x.0/24` and a `10.1.0.0/16` VPC rejects every one. Separate VPCs may overlap; the only thing given up is future dev↔prod peering, which is not wanted
- [x] **No `portalai-prod-dns-certs` stack exists.** One wildcard certificate, owned by `portalai-dev-dns-certs`, fronts app + api + www
- [x] The release **did not** deploy `portalai-dns-email` and **did not** write any `/portalai/prod/*-email` placeholder

## §3 — First deploy: the database (`PROD_PROVISIONING.runbook.md` §10)

⚠️ **ONE-SHOT, and it sits between two halves of the same release.** RDS creates only the `postgres` maintenance database; nothing in the repo creates `portal_ai`. The first release **will fail at the migrate step** until this is done — that is expected, not a defect.

- [x] `portalops db url --env prod --db-name postgres --write --yes --confirm-prod`
- [x] `portalops db psql --env prod --confirm-prod -- -c "CREATE DATABASE portal_ai"`
- [x] `portalops db url --env prod --write --yes --confirm-prod` *(the real value)*
- [x] `portalops db psql --env prod --confirm-prod -- -c "\l"` lists `portal_ai`
- [x] `portalops db url --env prod` (no `--write`) prints the password as `***`. **There is no flag that prints it**
- [x] Re-run the release: an **RDS snapshot** named `portalai-prod-premigrate-…` exists from immediately before the migrate task, and migrate then seed both exit `0`
- [x] The seed left exactly the catalog tiers + connector definitions — **no fixture orgs**

  Verified: `connector_definitions` = 5, `tiers` = 1, `organizations` = 1. **Read the tier count correctly** — seed writes only `standard` (`is_public = false`), not the four-tier catalog; `plus` / `pro` / `enterprise` arrive with `portalops tier apply`, which is §6's prerequisite and had not run yet. The single org is `My Organization` / `admin@portalsai.io`, created by the **first Auth0 login**, not by seed — its existence is the positive proof the post-login webhook verified (§4)

## §4 — API and app are live

- [x] `curl https://api.portalsai.io/api/health` → 200
- [x] No ECS task stopped with `ResourceNotFoundException` — that would be an unresolved secret ARN
- [x] `https://app.portalsai.io` loads; Auth0 login succeeds; the post-login webhook verifies against the prod secret
- [x] `grep -r "api-dev\|app-dev" ` over the served bundle finds **nothing**
- [x] The app's Help view shows `support@portalsai.io` — **not `qa@`**. A `qa@` here means the SSM contacts were unset at build time and the build used its fallback

  ⚠️ **This check was wrong as written — a bare `grep qa@` flags a *correct* build.** `QA_EMAIL` (`apps/web/src/utils/contact.util.ts:24`) is the fallback *constant* and is always present in the bundle, because the fallback helper that references it survives minification. What matters is which value the helper *returned*. In the shipped bundle it reads `XY("support@portalsai.io")` / `XY("sales@portalsai.io")` — real values passed, so the fallback is never selected. **The correct assertion:** the bundle contains the helper called with the real addresses — `grep -c '("support@portalsai.io")'` returns `1`. Note `mailto:` is **not** greppable either way: it is built from a template literal (`` `mailto:${…}` ``), so both `mailto:support@…` and `mailto:qa@…` return `0` on a correct build. Verified on `index-JbOwZ_DK.js`; the visual confirmation in the Help view remains the definitive check
- [x] Google Sheets **and** Microsoft Excel OAuth each round-trip against the prod callback URLs

  Both authorized and synced against prod callbacks. Server-side: credentials stored as an AES-GCM envelope (`{"iv":…,"authTag":…}`) with no plaintext token, so `ENCRYPTION_KEY` resolved; `layout_plan_commit` and `connector_sync` both reached `completed`, which is the first thing in this walk to exercise **prod Redis / BullMQ**; 2 entities and 61 records materialized.

  Excel is the first real exercise of the Microsoft client id corrected during this walk — token exchange succeeding proves the id and secret are a matching pair. Three job failures along the way were all benign: two `CONNECTOR_ENTITY_KEY_IN_USE_BY_OTHER_CONNECTOR` (the duplicate-entity-key guard working) and one sync against an instance deleted in between.

  ⚠️ **Both consent screens still show the *unverified app* warning** — Google verification for the Sheets/Drive sensitive scopes, and Microsoft publisher verification. See §1
- [x] A public-REST-API connector syncs end to end
- [x] **A geocode call succeeds, and a `bulk_geocode_records` job completes.** This is the only check that proves `GEOCODING_API_KEY` resolved — it fails *open*, so nothing else will tell you

  ❌ **FAILED.** Job `ce6c6931…` reported **`Completed`** with `geocoded: 0, failed: 10` — every record `GEOCODE_PROVIDER_UNAVAILABLE / "Geocoding provider returned 403"`. **The check earned its place:** the per-record errors are typed and honest, but the *job status* is not, so anything reading job status alone would call this a success.

  **Root cause: the token carries a Mapbox URL restriction, and the caller is server-side.** Mapbox enforces URL restrictions against the HTTP `Referer` header, which only browsers send. Geocoding runs in `bulk-geocode.processor.ts` on the API, where Node sends no `Referer` — so a URL-restricted token can never work from the backend, whatever URL is listed.

  Proven by varying only the `Referer` against the prod key (read into a variable, never printed):

  | `Referer` sent | result |
  |---|---|
  | *(none — what the server actually sends)* | **403** |
  | `https://api.portalsai.io` | **200** |
  | `https://app.portalsai.io/` | 403 |

  **`dev` is restricted the same way and is equally broken** — 403 with no `Referer`, 200 with `https://api-dev.portalsai.io`. app-dev geocoding has therefore never worked server-side; it fails open, so nothing ever said so. Do not treat app-dev as the working reference here.

  **Fix: remove the URL restriction on both tokens — do not add scopes.** Scopes are not involved. The restriction protects nothing: the token lives in Secrets Manager and never reaches a browser (the served bundle contains no `pk.` token and no `api.mapbox.com` reference), so its protection is secrecy, not referrer.

  A wrong turn worth recording: this was first diagnosed as *"the Mapbox account has no activated payment method"*, on the basis that a free endpoint returned 200 while every metered one returned 403. That split was real but coincidental — the URL-restriction test behind it had only tried `app.` and `www.` referers, never `api.`, so it could not have found the actual cause. Vary one input at a time, and make sure the negative test could have succeeded.

  ✅ **Passes after removing the URL restrictions.** Re-run: `geocoded: 8`, and **all 10 records carry correct GeoJSON** — Eiffel Tower `[2.294501, 48.85826]`, Colosseum `[12.49427, 41.889955]`, Liberty Island `[-74.044809, 40.689203]`, Taj Mahal `[78.04348, 27.16675]`. Verified in `entity_records.data->>'geocode'`, not from job status.

  ⚠️ **But the job's result summary is not trustworthy, and that is a separate defect.** The same run reported `failed: 2` — Sagrada Família (`GEOCODE_PROVIDER_UNAVAILABLE`) and Bennelong Point (`GEOCODE_ADDRESS_UNRESOLVED`, relevance 0.596) — yet **both records hold correct coordinates**. A record cannot be geocoded by an unavailable provider, so a retry is likely succeeding without clearing its failure entry. Together with the first run reporting **`Completed`** while geocoding 0 of 10, the summary both over- and under-reports. Anything alerting on job status or `failed` counts will be wrong in both directions
- [x] A custom webhook toolpack receives a `readUrl`/`writeUrl` pointing at `https://api.portalsai.io/api/webhook/handle/…` — **not `localhost`**

  Verified against a purpose-built ephemeral endpoint (AWS Lambda behind API Gateway) registered as a real toolpack. `ephemeral_stage_rows` — declaring `production: {kind: "rows", onLarge: "handle"}` to *earn* the write-grant — received `https://api.portalsai.io/api/webhook/handle/55ba62e1…` and `…/0cee963e…` on two separate invocations. **`PUBLIC_API_BASE_URL` (#383) is therefore resolving correctly in prod**, which nothing else in this walk exercised.

  Negative control in the same log: every `ephemeral_echo` call (`production: {kind: "value"}`) received **no** write grant, so the grant is earned by the declaration rather than issued to every custom tool.

  **Signing verified too.** Real calls carried all three `x-portalai-*` headers and the HMAC validated over the raw body inside the freshness window (`ok: true`, `age: 0`). The verifier was itself proven first against three cases — valid, unsigned, tampered-body — so a `false` verdict could only have meant Portal's signing, not the test endpoint's.

  ⚠️ **Lambda Function URLs do not work in this AWS account.** `AuthType: NONE` with a textbook resource policy returns `AccessDeniedException` on every public request while direct invoke succeeds, and the account is in no organization so no SCP explains it. API Gateway works. Worth knowing before reaching for Function URLs in real infrastructure

## §5 — Stripe live mode (`PROD_STRIPE_LIVE.runbook.md`)

- [x] Tax Settings status reads **`active`**, not `pending`

  `status: active`, `status_details: {"active": {}}`. Head office Provo, UT, US. Account defaults: `tax_behavior=inferred_by_currency`, `tax_code=txcd_10000000`
- [x] At least one tax registration shows as **Collecting**

  One: `taxreg_1U4roA…`, `US` / **Utah**, `type: state_sales_tax`, `status: active`. **Utah only** — see the tax-line check below, which cannot pass on a non-Utah billing address
- [x] Each product carries an explicit tax code, and none is `txcd_00000000` (Nontaxable)

  ✅ **Set 2026-08-18:** both active products carry **`txcd_10103001`** (*Software as a service (SaaS) — business use*) — prewritten software accessed over the internet, no download, sold to organizations. Utah taxes remotely-accessed prewritten software, so this is the code that makes the non-zero tax line below reachable; an exempt code would have produced a $0.00 invoice indistinguishable from a misconfiguration.

  Previously **not met** — `Plus` (`prod_UwKax8…`) and `Pro` (`prod_UvuEDE…`) both report `tax_code: null`, so both inherit the account default `txcd_10000000` (*General — Electronically Supplied Services*). **Not** the `txcd_00000000` failure this check guards against, and tax will still calculate — but it is inherited rather than declared, which is what the check asks for and what `PROD_STRIPE_LIVE.runbook.md` §6b means by *never guessed*. Setting it is a Stripe-side write; the inspection key is deliberately read-only.

  Also noted: six **inactive** leftovers rode along from the sandbox migration — `Standard (tax smoke #217)`, `Standard (smoke #218)`, `Portal Pro (smoke)` ×2, `myproduct` ×2. Harmless (inactive, no prices in use) but they are clutter in a live account
- [ ] The app's key is a **restricted** key (`rk_live_…`) with `subscriptions` **write** — verify by deleting a test org with a live subscription and confirming no 403

  **Destructive test waived** by the operator: the org-delete → `subscriptions.cancel` path was exercised in app-dev when Stripe was first integrated and the logic is unchanged. Reasonable — and it would have meant deleting the only prod org, which now carries the live subscription.

  ⚠️ **But note what the waiver does and does not cover.** app-dev proves the *code path*; this check's actual subject is whether **prod's restricted key was granted `subscriptions: write`**, which is a per-key scope decision made in the live dashboard and cannot be inferred from app-dev. The failure mode is a 403 that surfaces only when a paying customer's org is deleted. The non-destructive substitute is to read the key's permissions in the dashboard (Developers → API keys → the `rk_live_` key) and confirm Subscriptions is **write**, not read
- [ ] A **separate read-only** key exists for prod *and* app-dev, and `stripe` CLI inspection uses it

  **Prod: done.** `rk_live_***IezNnT`, and `stripe` CLI inspection uses it — proven, not assumed: `customers update` against a non-existent id returns `more_permissions_required` (*"Enabling \"Customers Write\"…"*) while reads succeed. The probe mutates nothing because the target id cannot exist.

  **app-dev: deferred** by the operator. Until it exists, app-dev inspection borrows the application's write-capable key
- [x] The webhook endpoint subscribes to **all six** events — the three `customer.subscription.*` **and** the three `price.*`

  `we_1U5W0n…` → `https://api.portalsai.io/api/webhooks/stripe`, `status: enabled`, exactly six: `customer.subscription.{created,deleted,updated}` + `price.{created,deleted,updated}`
- [x] `portalops tier apply --env prod --yes --confirm-prod` reports the paid rows converged onto **live-mode** price ids

  Converged 2026-08-18: `plus` → `price_1U4rmx…`, `pro` → `price_1U4rmw…`, resolved by lookup key (`plus_monthly` / `pro_monthly`) through prod's live restricted key — a test-mode price cannot resolve through a live key. `standard` and `enterprise` carry no price by design (`cta: none` / `contact`). The published site renders $19 / $49 from these rows
- [x] ⚠️ **ONE-SHOT — the first live charge.** Full round-trip: checkout → `customer.subscription.created` verified against the prod signing secret → the org's tier advances → the billing portal opens **with plan switching available** → returns to `https://app.portalsai.io`

  Completed 2026-08-18. Checkout paid ($53.14 incl. tax), `evt_1U5tHP…` verified and applied, `My Organization` advanced `standard` → `pro`, billing portal opened with plan switching and returned to the app. Confirmed by the operator for the browser-side legs
- [x] **The invoice carries a non-zero tax line**, and the Checkout Session's `taxability_reason` is **not** `not_collecting` *(retrieve with `expand[]=line_items.data.taxes`)*.

  Invoice `in_1U5tHL…`, status `paid`: subtotal **$49.00**, tax **$4.14** (8.45%), total **$53.14**. `total_taxes[0] = {taxability_reason: "standard_rated", tax_behavior: "exclusive", taxable_amount: 4900}` — **not** `not_collecting`. Billing address Salt Lake City, UT, inside the sole registration. `automatic_tax.status: complete`.

  Two notes for whoever reads this next. The field is **`total_taxes`** (an array), *not* `total_tax` — reading the singular returns nothing and looks exactly like zero tax collected. And `tax_behavior` resolved to **`exclusive`** even though both prices carry `tax_behavior: unspecified`, because the account default is `inferred_by_currency`; the prices are fine as they are. **Every other check in this section passes in a world where you collect nothing** — and completed transactions cannot be corrected through Stripe
- [x] `stripe_events` holds a row per delivered event, including the `ignored` ones

  Complete, not merely non-empty: of the 30 most recent live events exactly **one** matched the endpoint's six subscriptions (`customer.subscription.created`, `evt_1U5tHP…`), and `stripe_events` holds exactly that one — `outcome: applied`, `resulting_tier: pro`. Everything else Stripe emitted (invoice, charge, payment_intent, customer, and the two `product.updated` from the tax-code edits) is deliberately unsubscribed.

  ⚠️ **The `ignored` outcome is still unexercised** — it requires a `price.*` event, which §6's price-change check produces. This box is green for delivery completeness only.

## §6 — Marketing site (`PROD_DEPLOY.runbook.md` → Activating www)

- [x] **Before** setting the variable: publish a release → `deploy-site-prod` exits with a notice and publishes nothing

  Observed across five runs (`v1.0.0`, `v1.0.1`, `v1.0.2` and two dispatches), each completing green in ~10s with `resolve` reporting `ready=false` and no deploy job. The gate behaved exactly as designed — a green run that published nothing
- [x] `curl https://api.portalsai.io/api/public/site-config` → 200 with the live tiers
- [x] Set `PROD_SITE_CONFIG_URL`, publish a release → the run is green, the preflight **passes**, and the fixture-stamp check finds nothing
- [x] `https://www.portalsai.io` serves over the wildcard cert; `/pricing/` shows live amounts
- [x] Footer and contact page show `support@` / `sales@` / `admin@portalsai.io` — **no `qa@` anywhere**

  ✅ **Passes as of `v1.0.3`.** Across home / contact / pricing / terms / privacy: 14 `support@`, 12 `sales@`, 4 `admin@`, **zero `qa@`**; every `mailto:` resolves to a real address. `admin@` appears only on terms and privacy, which is its documented role (legal / data-controller contact). Prices unchanged at $19 / $49 and the build stamp reads `b883c496`, so the republish did not regress config resolution.

  ❌ **FAILED on first publish — [#405](https://github.com/EnterpriseBT/portal-ai/issues/405).** The live site rendered `qa@portalsai.io` on every page, 14 occurrences, zero real addresses. Cause: Turbo 2 runs tasks in a strict environment and `apps/site/turbo.json`'s `passThroughEnv` allowlist omitted `SUPPORT_EMAIL` / `SALES_EMAIL` / `ADMIN_EMAIL`, so the build never saw them and `contact.ts` fell back to `QA_EMAIL`. Prices were correct because `SITE_CONFIG_URL` **is** allowlisted — that split is the tell. **This step is the only thing that caught it:** the unit tests set `process.env` directly and never exercise the plumbing, the preflight checks tiers, and `verify-pages`' empty-`mailto:` gate is satisfied because `qa@` is a valid address. Re-verify after the fix republishes
- [ ] `portalops vars set SUPPORT_EMAIL … --env prod --yes --confirm-prod` fires the `site-config-changed` dispatch and republishes with **no code change**
- [ ] Change a price amount in Stripe → `price.updated` is recorded `ignored` → the site republishes and `/pricing/` updates

## §7 — Tier allocations and the cost gate

- [x] `/api/public/site-config` returns the production allocations (`pro` metered **50,000**, not `null`)
- [ ] Settings plan cards on `app.portalsai.io` render the live tiers and amounts

  **Out of scope for this walk (operator decision).** This exercises *application logic*, which is covered in app-dev. A production smoke verifies that **vendor integrations and environment configuration** work — the things that can only differ in prod. Re-testing tier arithmetic here would cost real Mapbox spend against a live card (the only prod org is `pro`: 20,000 expensive units) and prove nothing app-dev has not already proven.
- [ ] On a `standard` org, exhaust `expensive` (101 geocoded rows) → the tool returns a **typed `TOOL_USAGE_QUOTA_EXCEEDED` result the agent relays** — not a crash, not a thrown error

  **Out of scope for this walk (operator decision).** This exercises *application logic*, which is covered in app-dev. A production smoke verifies that **vendor integrations and environment configuration** work — the things that can only differ in prod. Re-testing tier arithmetic here would cost real Mapbox spend against a live card (the only prod org is `pro`: 20,000 expensive units) and prove nothing app-dev has not already proven.
- [ ] A `free`-class tool still works on that exhausted org — `free` is never charged and never denied

  **Out of scope for this walk (operator decision).** This exercises *application logic*, which is covered in app-dev. A production smoke verifies that **vendor integrations and environment configuration** work — the things that can only differ in prod. Re-testing tier arithmetic here would cost real Mapbox spend against a live card (the only prod org is `pro`: 20,000 expensive units) and prove nothing app-dev has not already proven.

## §8 — CLI guards and audit (live, first time)

- [x] `portalai login --env prod` completes the device flow

  Proven transitively: `portalai org list --env prod` returned real data (exit 0), which is only reachable with a valid device-flow token.
- [x] `portalops db tunnel --env prod --confirm-prod` connects through the bastion

  Proven by use rather than in isolation: every `portalops db psql --env prod` in this walk — the tier rows, the connector instances, the job errors, the geocoded records — connected through the bastion tunnel.
- [x] A **destructive** op against prod is refused with exit **`6`**: `npx portalops db reset --env prod --yes --confirm-prod; echo $?`

  Exit **6**, `Destructive operations are never allowed against production environment "prod"`. Run only after confirming statically that `reset.ts:84` calls `assertOperationAllowed({destructive: true})` as its **first statement**, before `resolveEnvConnection` and any SQL — a live destructive test against production is worth taking on faith from nobody. Verified after: 34 tables still present.
- [x] A **non-destructive mutation without `--confirm-prod`** is refused with exit **`5`**

  Exit **5** via `vars set CORS_ORIGIN` with its existing value, so even a guard failure would have been a no-op write.

  ⚠️ **A first attempt used `tier apply --env prod --yes` and exited 0, which looked like a guard failure and was not.** `tier.ts:339` guards inside `if (dirty.length > 0)`, so a fully-converged run never reaches it. The command was chosen *because* it was idempotent and safe — which is exactly why it could not exercise a guard on the write path. Pick a command that actually reaches the mutation.
- [x] `portalops vars list --env prod` and `portalai org list --env prod` return real prod data

  `vars list` returns the 24-key catalog with secrets masked; `org list` returns `My Organization` at tier `pro`.
- [x] `~/.portalai/audit.log` has a line per mutating op, and **no line contains a secret value**

  31 `"env":"prod"` lines covering every `tier apply` change and each `vars set`. `vars set MICROSOFT_OAUTH_CLIENT_ID` records the **key and `kind`, never the value**. No `whsec_` / `rk_live` / `sk_live` / `pk.` / PEM material anywhere in the file.
- [x] `grep -rn "pending #83" docs/` returns only `*.smoke.md` / `*.discovery.md` / `*.spec.md` / `*.plan.md` — historical records, correctly untouched

  Returns 11 files: the smoke/discovery/spec/plan set plus `PROD_CLI_ACTIVATION.md`, which is a **condensed** doc — design + smoke in one un-suffixed file. `deploy-parity.test.ts:463` excludes exactly that case, so it is expected rather than a miss.

## §9 — Dev is unaffected (regression)

- [x] An app-dev deploy after all this is green

  The four most recent `Deploy Dev` runs are `push` on `main`, all `success`. `api-dev.portalsai.io/api/health` → 200.
- [x] The ECS task's rendered `GOOGLE_OAUTH_REDIRECT_URI` / `MICROSOFT_OAUTH_REDIRECT_URI` are byte-identical to before

  Read from the running task definitions. dev renders `https://api-dev.portalsai.io/api/connectors/{google-sheets,microsoft-excel}/callback`; prod renders the `api.portalsai.io` equivalents. **Scope note:** no pre-#383 snapshot exists to diff against, so this confirms the values are *correct for each environment* rather than literally unchanged — which is what the check is protecting against, since #383 switched these from `${Environment}` to `Subdomain` derivation.
- [x] `portalai-dev-cache` is still a single-node `CacheCluster` — **not replaced**

  `portalai-dev` — engine `redis`, `NumCacheNodes: 1`, `ReplicationGroupId: None`. Prod's conditional replication group did not disturb it.
- [x] `site-dev.portalsai.io` still deploys and still resolves its own cert stack

  `https://site-dev.portalsai.io` → 200, unaffected by prod's site stack sharing the wildcard certificate.

## §10 — Error & edge cases

- [x] A plain push to `main` deploys **only** to dev and never touches prod

  `deploy-prod.yml` is `on: release: types: [published]` and nothing else; `deploy-dev.yml` is `on: push`. Run history agrees — every `Deploy Prod` run fired from a `release`, never a push. (The `workflow_dispatch` entries in the history predate making it release-only.)
- [x] A release published while `PROD_SITE_CONFIG_URL` is unset publishes nothing rather than failing

  Observed five times before the switch was set — `v1.0.0`, `v1.0.1`, `v1.0.2` and two dispatches — each green in ~10s with `resolve` reporting `ready=false` and no deploy job.
- [ ] Rollback: re-running the previous release's workflow restores the previous image. **Confirm you understand it does not revert the schema** — migrations must stay backward-compatible with the previous image

  **Not exercised.** Deliberately untested: proving it means rolling production back, and the value is low next to the risk on a live environment carrying a paying subscription. The mechanism is understood and recorded — re-running a prior release redeploys that release's immutable `prod-<sha>` image, and **migrations are not reverted**, so backward compatibility with the previous image is a standing requirement on every migration.
- [x] No dev credential appears in any `portalai/prod/*` path

  Verified by comparing SHA-256 digests of every same-named secret across environments — values were hashed, never printed. All 11 shared names (`anthropic-api-key`, `auth0-webhook-secret`, `database-url`, `encryption-key`, `geocoding-api-key`, `google-oauth-client-secret`, `microsoft-oauth-client-secret`, `oauth-state-secret`, `stripe-secret-key`, `stripe-webhook-secret`, `tavily-api-key`) are **distinct** between prod and dev.

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
