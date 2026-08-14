# Environment provisioning — Runbook

**Issue:** [EnterpriseBT/portal-ai#384](https://github.com/EnterpriseBT/portal-ai/issues/384) (epic [#83](https://github.com/EnterpriseBT/portal-ai/issues/83)) · Spec: `docs/PROD_VENDOR_PROVISIONING.spec.md`

The half of #384 that cannot be code. Creating an Auth0 tenant, a Google OAuth client or a Mapbox token needs a console and a human — the charter classifies these as **out-of-band, runbook-driven** (`docs/CLI_OPERATIONS_CHARTER.md`), and this is the executable artifact behind that classification.

**This is written for any environment, not just prod.** Every command takes `$ENV`; prod is simply the first environment that has needed it end to end. Set it once:

```bash
export ENV=prod
export GUARD="--yes --confirm-prod"   # prod only; "--yes" for staging, "" for local
export CONNECT="--confirm-prod"       # prod only; "" everywhere else
export PREFIX=PROD                    # the GitHub Actions secret prefix (DEV for app-dev)
```

**Run it in order.** The ordering is not stylistic — several steps cannot physically happen before the one above them, and two of them wait on the AWS stacks from #383.

---

## Read this first

**Values are written one at a time, from stdin.** Not with `vars template` / `vars apply`:

```bash
printf '%s' 'the-value' | portalops vars set SOME_KEY - --env $ENV $GUARD
```

The `-` argument makes `vars set` read stdin, so the value never appears in your shell history or in `ps` output. `vars template` writes **every** value of an environment to a plaintext file — a real convenience on app-dev, and for a production environment it is a file containing every production secret on a laptop. It also cannot round-trip a fresh environment: `vars apply` rejects empty values, so a template of an unprovisioned env has to be hand-edited before it will apply at all. Per-key writes are also **resumable**, which matters because this runbook spans however long your vendor approvals take.

**Nothing here is reversible by re-running it.** `NAMESPACE` and `SYSTEM_ID` in particular are write-once — see step 7.

**The guards are real.** Against a production environment every mutation needs `--yes --confirm-prod` (exit 5 without) and destructive operations are refused outright (exit 6). You cannot work around this with a `~/.portalai/environments.json` override; the registry refuses to shadow a built-in.

## Prerequisites

- [ ] `aws sts get-caller-identity` succeeds, with access to Secrets Manager, SSM, CloudFormation and RDS in `us-east-1`.
- [ ] `portalops vars describe --env $ENV` resolves — proves the environment is in the registry (`packages/cli-env/src/registry.ts`).
- [ ] Check what is already set, so a re-run doesn't clobber anything: `portalops vars list --env $ENV`.

---

## 0 — Start the long-lead vendor items *now*

These have external review queues. Everything else in this runbook is same-day.

- [ ] **Stripe business verification** — owned by [#385](https://github.com/EnterpriseBT/portal-ai/issues/385), but *start it today*. Live mode needs a legal entity, a representative, a bank account and a statement descriptor, and Stripe's review expects a public site describing the product and pricing (that is [#386](https://github.com/EnterpriseBT/portal-ai/issues/386)).
- [ ] **Google OAuth consent screen** — check whether the client you are about to create needs verification for external users. An unverified app is capped and shows a warning interstitial. Find out now, not at go-live.

## 1 — Generated secrets

Three values are generated, not obtained. Each must be **fresh per environment** — never copy dev's.

```bash
for KEY in ENCRYPTION_KEY OAUTH_STATE_SECRET AUTH0_WEBHOOK_SECRET; do
  openssl rand -base64 32 | portalops vars set $KEY - --env $ENV $GUARD
done
```

- [ ] All three written.
- [ ] **Keep `AUTH0_WEBHOOK_SECRET` to hand** — step 2 pastes the same value into the Auth0 Action. If you lose it, re-run for that one key and update both sides.

`ENCRYPTION_KEY` encrypts `connector_instances.credentials` and toolpack auth headers at rest. Rotating it later strands existing rows, so treat it as write-once in practice.

## 2 — Auth0 tenant

Each environment has its own tenant; `app-dev` is `portalsai-staging.us.auth0.com`.

- [ ] Create the tenant.
- [ ] **SPA application.** Allowed Callback URLs, Logout URLs, Web Origins and CORS Origins all `https://app.portalsai.io`.
- [ ] **API** with identifier (audience) `https://api.portalsai.io`.
- [ ] **Connections** mirroring whatever dev has today — Google, Microsoft, username-password. ([#199](https://github.com/EnterpriseBT/portal-ai/issues/199) is independent; don't wait for it.)
- [ ] **Post-login Action** posting to `https://api.portalsai.io/api/webhooks/auth0`, signed with the `AUTH0_WEBHOOK_SECRET` from step 1.
- [ ] **Machine-to-machine app for the device flow** ([#194](https://github.com/EnterpriseBT/portal-ai/issues/194)) — this is what `portalai login --env $ENV` uses.

```bash
printf '%s' 'your-tenant.us.auth0.com'   | portalops vars set AUTH0_DOMAIN - --env $ENV $GUARD
printf '%s' 'https://api.portalsai.io'   | portalops vars set AUTH0_AUDIENCE - --env $ENV $GUARD
printf '%s' '<m2m client id>'            | portalops vars set AUTH0_CLI_CLIENT_ID - --env $ENV $GUARD
```

- [ ] The **SPA** client id, domain and audience also go into GitHub Actions secrets — `${PREFIX}_VITE_AUTH0_CLIENT_ID`, `${PREFIX}_VITE_AUTH0_DOMAIN`, `${PREFIX}_VITE_AUTH0_AUDIENCE`. They are build-time inputs to the web bundle, not runtime config, which is why they are repo secrets rather than catalog keys.

## 3 — Google OAuth client (Sheets connector)

- [ ] Google Cloud Console → Credentials → **OAuth client ID → Web application**. A new client for this environment; do not add prod URIs to dev's client.
- [ ] Authorized redirect URI, exactly: `https://api.portalsai.io/api/connectors/google-sheets/callback`
- [ ] Enable the **Google Sheets API** and **Google Drive API** on the project.

```bash
printf '%s' '<client id>'     | portalops vars set GOOGLE_OAUTH_CLIENT_ID - --env $ENV $GUARD
printf '%s' '<client secret>' | portalops vars set GOOGLE_OAUTH_CLIENT_SECRET - --env $ENV $GUARD
```

## 4 — Microsoft Entra ID app (Excel connector)

"Azure" here means **Entra ID (Azure AD)** — an app registration for Microsoft Graph. There is no other Azure dependency.

- [ ] Azure portal → **App registrations → New registration**, Web platform.
- [ ] Redirect URI, exactly: `https://api.portalsai.io/api/connectors/microsoft-excel/callback`
- [ ] Delegated permissions: `openid`, `profile`, `email`, `offline_access`, `User.Read`, `Files.Read.All`.
- [ ] Create a client secret and note its **expiry** — Entra secrets expire, and nothing in the app warns you.

```bash
printf '%s' '<application (client) id>' | portalops vars set MICROSOFT_OAUTH_CLIENT_ID - --env $ENV $GUARD
printf '%s' '<client secret VALUE>'     | portalops vars set MICROSOFT_OAUTH_CLIENT_SECRET - --env $ENV $GUARD
printf '%s' 'common'                    | portalops vars set MICROSOFT_OAUTH_TENANT - --env $ENV $GUARD
```

`common` accepts personal and work/school accounts. Use a tenant id only for a single-tenant deployment.

## 5 — Metered vendor keys

All three are **Portal-paid**: the cost gate meters usage against an org's quota, but the vendor invoices us. Set an account-level cap on each — that cap, not application logic, is the backstop.

- [ ] **Anthropic** — a key on its own workspace with its own limit, so a runaway loop in one environment cannot exhaust the other's budget.
- [ ] **Tavily** — backs `web_search` (`expensive` cost class). Set a plan limit.
- [ ] **Mapbox** — backs `geocode` / `reverse_geocode` / `bulk_geocode_records`. Scope the token to the geocoding APIs and set a spend limit. `bulk_geocode_records` can fan out across an entire column, which makes this the highest-variance line item in the product.

```bash
printf '%s' '<sk-ant-…>' | portalops vars set ANTHROPIC_API_KEY - --env $ENV $GUARD
printf '%s' '<tvly-…>'   | portalops vars set TAVILY_API_KEY - --env $ENV $GUARD
printf '%s' '<pk.…>'     | portalops vars set GEOCODING_API_KEY - --env $ENV $GUARD
```

> **`GEOCODING_API_KEY` fails open.** Absent or wrong, the geocode tools are simply not constructed and maps keep working — nothing errors. It is the one key whose absence you will not notice, which is why step 11 calls a geocode explicitly.

## 6 — GitHub dispatch token

A fine-grained PAT scoped to `EnterpriseBT/portal-ai` with **Contents: read** and **repository dispatch: write**. It lets a config change republish the marketing site with no code change.

- [ ] **Provision app-dev's first and prove the loop there.** As of #384 `portalai/dev/github-dispatch-token` does not exist and neither does the `DEV_SECRET_ARN_GITHUB_DISPATCH_TOKEN` repo secret, so this path has never executed in any environment. Production must not be its first run.

```bash
printf '%s' '<github_pat_…>' | portalops vars set GITHUB_DISPATCH_TOKEN - --env app-dev --yes
# prove it: a siteConfig key write should trigger deploy-site-dev
printf '%s' 'qa@portalsai.io' | portalops vars set SUPPORT_EMAIL - --env app-dev --yes
gh run list --workflow deploy-site-dev.yml --limit 3
```

- [ ] Then the same for `$ENV` with a separate token.

## 7 — Identity and CORS config

```bash
printf '%s' 'https://app.portalsai.io' | portalops vars set CORS_ORIGIN - --env $ENV $GUARD
```

> **Order matters beyond CORS.** `billing.service.ts` derives Stripe checkout `success_url` / `cancel_url` and the billing-portal `return_url` from **the first entry** of `CORS_ORIGIN`. If you ever add origins, the app URL stays first.

```bash
printf '%s' 'portalsai-prod'  | portalops vars set NAMESPACE - --env $ENV $GUARD
openssl rand -hex 16          | portalops vars set SYSTEM_ID - --env $ENV $GUARD
```

> **These two are write-once.** Both seed deterministic uuidv5 generation. Changing either after the environment holds data orphans every id already generated, and nothing detects it — there is no migration back. Confirm the values before you press enter. They must also differ from every other environment, so a deterministic id can never collide across environments.

## 8 — Contact addresses

These render on the public marketing site and in the app's Help view. Outside prod all three are `qa@portalsai.io`, so no non-prod surface can advertise a customer-facing inbox.

- [ ] **Confirm all three inboxes deliver before writing them.** A wrong address here is published, not errored.

```bash
printf '%s' 'support@portalsai.io' | portalops vars set SUPPORT_EMAIL - --env $ENV $GUARD
printf '%s' 'sales@portalsai.io'   | portalops vars set SALES_EMAIL - --env $ENV $GUARD
printf '%s' 'admin@portalsai.io'   | portalops vars set ADMIN_EMAIL - --env $ENV $GUARD
```

Each of these fires a site-rebuild dispatch. Against prod that runs `deploy-site-prod`, which exits early until `PROD_SITE_CONFIG_URL` is set (#386) — expected and harmless.

## 9 — Stripe keys

Values come from [#385](https://github.com/EnterpriseBT/portal-ai/issues/385); the write is here.

```bash
printf '%s' '<rk_live_…>' | portalops vars set STRIPE_SECRET_KEY - --env $ENV $GUARD
printf '%s' '<whsec_…>'   | portalops vars set STRIPE_WEBHOOK_SECRET - --env $ENV $GUARD
```

Use a **restricted** key, not the account secret key. The operator/agent key for inspection is a separate read-only one — mutation safety for vendor CLIs is the credential, never a prompt.

---

> ### ⛔ Wait here for [#383](https://github.com/EnterpriseBT/portal-ai/issues/383) to deploy `portalai-$ENV-database`
>
> Everything above is independent of the AWS stacks. Everything below needs the database to exist.

---

## 10 — Database bootstrap

RDS creates **only** the `postgres` maintenance database — `database.yml` sets no `DBName` — so the application database is created by hand. Nothing in the repo does it; this is the only place the step is written down.

`portalops db tunnel` / `db psql` resolve their connection from the `database-url` secret, which does not exist yet and cannot yet name a database that does not exist yet. `db url` breaks that cycle because it composes from the stack's exports instead.

```bash
# a. point database-url at the maintenance DB, so psql has a way in
portalops db url --env $ENV --db-name postgres --write $GUARD

# b. create the application database
portalops db psql --env $ENV $CONNECT -- -c "CREATE DATABASE portal_ai"

# c. repoint database-url at the application database — the real value
portalops db url --env $ENV --write $GUARD
```

- [ ] `portalops db psql --env $ENV $CONNECT -- -c "\l"` lists `portal_ai`.
- [ ] Step (a)'s value is deliberately transient. Both writes are audited; `putSecret` is idempotent.

## 11 — Capture the secret ARNs into GitHub

`backend.yml` takes every secret **by ARN parameter**, so each one needs a repository secret before #383's backend stack can deploy. Twelve of them:

```bash
for KEY in database-url encryption-key auth0-webhook-secret anthropic-api-key \
           tavily-api-key geocoding-api-key google-oauth-client-secret \
           microsoft-oauth-client-secret oauth-state-secret stripe-secret-key \
           stripe-webhook-secret github-dispatch-token; do
  ARN=$(aws secretsmanager describe-secret --secret-id portalai/$ENV/$KEY \
        --query ARN --output text)
  NAME="${PREFIX}_SECRET_ARN_$(echo "$KEY" | tr 'a-z-' 'A-Z_')"
  echo "$ARN" | gh secret set "$NAME" --repo EnterpriseBT/portal-ai
done
```

- [ ] Also set `${PREFIX}_HOSTED_ZONE_ID` and `${PREFIX}_AWS_ROLE_ARN` (the prod deploy role from #383).
- [ ] `gh secret list --repo EnterpriseBT/portal-ai | grep -c "${PREFIX}_SECRET_ARN_"` → **12**.

---

> ### ⛔ Wait here for [#383](https://github.com/EnterpriseBT/portal-ai/issues/383) to deploy `portalai-$ENV-backend`

---

## 12 — Verify

- [ ] `portalops vars list --env $ENV` — **every key resolved**, no `(unset)`.
- [ ] `portalai login --env $ENV` completes the device flow.
- [ ] `https://api.portalsai.io/api/health` returns 200.
- [ ] The ECS task started — no `ResourceNotFoundException` in any stopped task's reason. A missing secret shows up here.
- [ ] Auth0 login works on `https://app.portalsai.io`, and the post-login webhook verifies.
- [ ] Google Sheets **and** Microsoft Excel OAuth each round-trip against the prod callback URLs.
- [ ] **Call a geocode, and run a `bulk_geocode_records` job.** This is the only check that proves `GEOCODING_API_KEY` resolved — it fails open, so nothing else will tell you.
- [ ] The app and the marketing site render `support@` / `sales@` / `admin@portalsai.io` — no `qa@` anywhere.
- [ ] A destructive op against `$ENV` exits 6; a mutation without `--confirm-prod` exits 5.
- [ ] `~/.portalai/audit.log` has a line per mutation, and **no line contains a secret value**.

## Appendix — the managed keys

| Key | Kind | Source | Step |
|---|---|---|---|
| `DATABASE_URL` | secret | `db url --write` | 10 |
| `ENCRYPTION_KEY` | secret | generated | 1 |
| `OAUTH_STATE_SECRET` | secret | generated | 1 |
| `AUTH0_WEBHOOK_SECRET` | secret | generated | 1 |
| `ANTHROPIC_API_KEY` | secret | vendor | 5 |
| `TAVILY_API_KEY` | secret | vendor | 5 |
| `GEOCODING_API_KEY` | secret | vendor (Mapbox) | 5 |
| `GOOGLE_OAUTH_CLIENT_SECRET` | secret | Google Cloud | 3 |
| `MICROSOFT_OAUTH_CLIENT_SECRET` | secret | Entra ID | 4 |
| `STRIPE_SECRET_KEY` | secret | Stripe (#385) | 9 |
| `STRIPE_WEBHOOK_SECRET` | secret | Stripe (#385) | 9 |
| `GITHUB_DISPATCH_TOKEN` | secret | GitHub PAT | 6 |
| `AUTH0_DOMAIN` | ssm | Auth0 | 2 |
| `AUTH0_AUDIENCE` | ssm | Auth0 | 2 |
| `AUTH0_CLI_CLIENT_ID` | ssm | Auth0 M2M | 2 |
| `GOOGLE_OAUTH_CLIENT_ID` | ssm | Google Cloud | 3 |
| `MICROSOFT_OAUTH_CLIENT_ID` | ssm | Entra ID | 4 |
| `MICROSOFT_OAUTH_TENANT` | ssm | `common` | 4 |
| `CORS_ORIGIN` | ssm | the app URL | 7 |
| `NAMESPACE` | ssm | **write-once** | 7 |
| `SYSTEM_ID` | ssm | **write-once** | 7 |
| `SUPPORT_EMAIL` | ssm | real inbox | 8 |
| `SALES_EMAIL` | ssm | real inbox | 8 |
| `ADMIN_EMAIL` | ssm | real inbox | 8 |

The catalog is `packages/devops-cli/src/catalog.ts`. A key belongs in it **iff** it is an operator-settable per-environment value stored in Secrets Manager or SSM — template-computed values (`REDIS_URL`, the `UPLOAD_S3_*` trio, the OAuth redirect URIs) are correctly absent, and a guard test asserts every secret the task definition consumes has an entry.

## Reusing this for a new environment

Change `$ENV` and `$GUARD`, swap the URLs, and skip nothing. The only prod-specific content is the hostnames and the real contact addresses — every other step applies to any environment the registry knows about. A new environment also needs its entry in `BUILTIN_ENVIRONMENTS` first; there is no way to provision one that only exists in a local override file, by design.
