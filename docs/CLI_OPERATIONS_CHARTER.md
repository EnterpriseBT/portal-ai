# Portal.ai CLI Operations Charter

The standing **operation → CLI index** for maintaining, inspecting, and configuring Portal.ai environments (`local`, `app-dev`, and future `prod`), usable by a **human or a Claude agent**. Every relevant maintenance, logging, and configuration task appears once, mapped to its owning CLI, rated operable or not, and pointed at the per-surface guide that carries the full runbook.

This charter is a **thin index**, not a runbook. It answers *"which CLI, and roughly how"* and reports coverage; the exact commands, flags, examples, auth setup, and allowlists live in the four per-surface guides:

| Surface | Guide | Owning CLI(s) |
|---|---|---|
| AWS | [#224](https://github.com/EnterpriseBT/portal-ai/issues/224) | `aws` |
| Stripe | [#225](https://github.com/EnterpriseBT/portal-ai/issues/225) | `stripe` |
| Auth0 | [#226](https://github.com/EnterpriseBT/portal-ai/issues/226) | `auth0` |
| Native | [#227](https://github.com/EnterpriseBT/portal-ai/issues/227) | `portalops`, `portalai` |

> **Priority:** AWS and Auth0 are where operator console time concentrates — they are the surfaces this charter (and its guides) covers most thoroughly.

## How to read this

Each surface below carries one operations table. Every row is one operation, with these columns:

| Column | Meaning | Allowed values |
|---|---|---|
| **Operation** | The task an operator/agent actually asks for, in imperative phrasing (e.g. "Tail app-dev API logs for an error"). | free text |
| **Category** | Which kind of work; drives the coverage denominator (logging reported separately). | `maintenance` · `logging` · `configuration` |
| **Envs** | Which environments the operation applies to. | subset of `local` · `app-dev` · `prod` |
| **Owning CLI** | The one CLI that performs it. | `aws` · `stripe` · `auth0` · `portalops` · `portalai` |
| **Command** | A canonical, copy-paste one-liner **including any guard flags** — the starting point; the full runbook is in the guide. `—` if none exists. | command or `—` |
| **Operable?** | Whether the operation meets the CLI-operable predicate (below) in **every** env it applies to. | `yes` · `no` |
| **Guide ref** | Link to the per-surface guide section with the full command/flags/examples. | link or `—` |
| **Disposition** | The classification of the row — never blank. | `covered` · `gap → #<n>` · `exception: <reason>` · `deploy-infra: <reason>` |

**CLI-operable predicate.** An operation is **operable** iff **all three** hold:

1. **A documented command exists** — native (`portalops`/`portalai`) or vendor-CLI (`aws`/`stripe`/`auth0`).
2. **Non-interactive or flag-guarded** — runnable without an interactive-only prompt; confirmations are explicit flags (`--yes`, `--confirm-prod`). A REPL/hold-open with a documented one-shot form (e.g. `portalops db psql -- <sql>`) counts as operable via that form.
3. **Machine-readable output** — emits JSON (`--json` / `--output json`) or the guide documents how to parse it.

`Operable? = yes` requires the predicate to hold in **every** environment listed in `Envs`. An operation operable in `local` but not `app-dev` is a **parity defect** — rated `no`, with the disposition naming the missing environment.

**Coverage bar.** Let `D` = the count of `maintenance` + `configuration` operations (logging excluded) and `N` = those rated `operable`. The bar passes iff:

- `N / D ≥ 0.90`, **and**
- every operation in the whole table (all categories) has a non-blank `Disposition` (100% classified).

The [Coverage](#coverage) section reports `N/D` as a fraction and percent, the logging sub-figure separately, and any parity defects. Numbers are reported honestly — a shortfall is enumerated and routed, never rounded up to clear the bar.

**Guard convention.** Per-environment guard expectations are not a separate column — they live inline in the `Command` as the flags the task actually needs: `--yes` for `app-dev` (staging) mutations; `--yes --confirm-prod` for the future prod non-destructive case; destructive `prod` operations are shown as blocked, not as a runnable command. There is no actor/role tagging — authentication is configured per-env and the human drives the session, so every operable row is assumed unattended-operable.

**Overlap rule (compose-test).** Native-over-vendor glue is allowed **only** when the native command *composes* vendor primitives into a Portal-domain operation; a thin passthrough of a vendor CLI is rejected (use the vendor CLI directly, per its guide). See [Overlap decisions](#overlap-decisions).

## AWS

_Auth: ambient AWS credentials (SSO / `AWS_PROFILE` / CI OIDC); per-env scoping is the identity's ability to act on that env's resources. `local` has **no** AWS surface (it runs from `.env` / docker-compose), so these operations apply to `app-dev` (and future `prod`). Region `us-east-1`. Resource names follow `portalai-${env}` (`app-dev` → `dev`); exact identifiers and full flag sets are pinned in [#224](https://github.com/EnterpriseBT/portal-ai/issues/224) — the `Command` here is the canonical starting point._

| Operation | Category | Envs | Owning CLI | Command | Operable? | Guide ref | Disposition |
|---|---|---|---|---|---|---|---|
| Tail live API logs for an error | logging | app-dev | aws | `aws logs tail /ecs/portalai-api-dev --follow --format short` | yes | [#224](https://github.com/EnterpriseBT/portal-ai/issues/224) | covered |
| Search API logs over a time window | logging | app-dev | aws | `aws logs filter-log-events --log-group-name /ecs/portalai-api-dev --filter-pattern ERROR --start-time <epoch-ms>` | yes | [#224](https://github.com/EnterpriseBT/portal-ai/issues/224) | covered |
| Check API service health / running task count | maintenance | app-dev | aws | `aws ecs describe-services --cluster portalai-dev --services portalai-api-dev` | yes | [#224](https://github.com/EnterpriseBT/portal-ai/issues/224) | covered |
| Open a shell in a running API task (debug) | maintenance | app-dev | aws | `aws ecs execute-command --cluster portalai-dev --task <task-id> --container <container> --interactive --command "/bin/sh"` | yes | [#224](https://github.com/EnterpriseBT/portal-ai/issues/224) | covered |
| Force a new deployment / restart the API | maintenance | app-dev | aws | `aws ecs update-service --cluster portalai-dev --service portalai-api-dev --force-new-deployment` | yes | [#224](https://github.com/EnterpriseBT/portal-ai/issues/224) | covered |
| Run an ad-hoc one-off task (e.g. migration) | maintenance | app-dev | aws | `aws ecs run-task --cluster portalai-dev --task-definition portalai-api-dev --overrides <json>` | yes | [#224](https://github.com/EnterpriseBT/portal-ai/issues/224) | covered |
| Check the RDS instance status | maintenance | app-dev | aws | `aws rds describe-db-instances --query "DBInstances[?contains(DBInstanceIdentifier,'portalai')]"` | yes | [#224](https://github.com/EnterpriseBT/portal-ai/issues/224) | covered |
| Inspect a CloudFormation stack's status / outputs | maintenance | app-dev | aws | `aws cloudformation describe-stacks --stack-name portalai-backend-dev` | yes | [#224](https://github.com/EnterpriseBT/portal-ai/issues/224) | covered |
| Deploy / update an infra stack (ad-hoc; normal path is CI) | configuration | app-dev | aws | `aws cloudformation deploy --stack-name portalai-backend-dev --template-file infra/cloudformation/backend.yml` | yes | [#224](https://github.com/EnterpriseBT/portal-ai/issues/224) | covered |
| Inspect uploaded files in the S3 upload bucket | maintenance | app-dev | aws | `aws s3 ls s3://<upload-bucket>/` | yes | [#224](https://github.com/EnterpriseBT/portal-ai/issues/224) | covered |
| Inject a new secret into the running API task | configuration | app-dev | aws | `—` | no | [#224](https://github.com/EnterpriseBT/portal-ai/issues/224) | deploy-infra: needs a `ValueFrom` mapping in `backend.yml` (no single CLI command wires a secret into the task def) — see `stripe-secret-key` finding |

## Auth0

_Auth: `auth0` CLI, authenticated per-tenant (`auth0 login`). **Each environment has its own Auth0 tenant — `local` and `app-dev` are separate** (`app-dev` → `portalsai-staging.us.auth0.com`); select the target tenant with `auth0 tenants use <tenant>` before running directory ops, and never assume a change in one tenant reflects in the other. Future `prod` gets its own tenant (#83). The `auth0` CLI is non-interactive with a global `--json` flag; exact subcommand syntax is pinned in [#226](https://github.com/EnterpriseBT/portal-ai/issues/226)._

| Operation | Category | Envs | Owning CLI | Command | Operable? | Guide ref | Disposition |
|---|---|---|---|---|---|---|---|
| Tail tenant logs (login / auth troubleshooting) | logging | local · app-dev | auth0 | `auth0 logs tail --json` | yes | [#226](https://github.com/EnterpriseBT/portal-ai/issues/226) | covered |
| Search tenant logs (e.g. failed logins) | logging | local · app-dev | auth0 | `auth0 logs list --filter "type:f" --json` | yes | [#226](https://github.com/EnterpriseBT/portal-ai/issues/226) | covered |
| Find a user by email | maintenance | local · app-dev | auth0 | `auth0 users search --query "email:user@example.com" --json` | yes | [#226](https://github.com/EnterpriseBT/portal-ai/issues/226) | covered |
| Get a user's profile | maintenance | local · app-dev | auth0 | `auth0 users show <user-id> --json` | yes | [#226](https://github.com/EnterpriseBT/portal-ai/issues/226) | covered |
| Block / unblock or update a user | configuration | local · app-dev | auth0 | `auth0 users update <user-id> --json` | yes | [#226](https://github.com/EnterpriseBT/portal-ai/issues/226) | covered |
| Delete a user | configuration | local · app-dev | auth0 | `auth0 users delete <user-id> --force` | yes | [#226](https://github.com/EnterpriseBT/portal-ai/issues/226) | covered |
| Assign / remove a user's role | configuration | local · app-dev | auth0 | `auth0 users roles add <user-id> --roles <role-id>` | yes | [#226](https://github.com/EnterpriseBT/portal-ai/issues/226) | covered |
| List roles & their permissions | maintenance | local · app-dev | auth0 | `auth0 roles list --json` | yes | [#226](https://github.com/EnterpriseBT/portal-ai/issues/226) | covered |
| List / inspect applications | configuration | local · app-dev | auth0 | `auth0 apps list --json` | yes | [#226](https://github.com/EnterpriseBT/portal-ai/issues/226) | covered |
| Update an application (callbacks, grant types) | configuration | local · app-dev | auth0 | `auth0 apps update <client-id> --json` | yes | [#226](https://github.com/EnterpriseBT/portal-ai/issues/226) | covered |
| Select the tenant for an environment | configuration | local · app-dev | auth0 | `auth0 tenants use <tenant>` | yes | [#226](https://github.com/EnterpriseBT/portal-ai/issues/226) | covered |
| Inspect APIs / audiences | maintenance | local · app-dev | auth0 | `auth0 apis list --json` | yes | [#226](https://github.com/EnterpriseBT/portal-ai/issues/226) | covered |

## Stripe

_Auth: `stripe` CLI with a per-env (restricted) key — test-mode for `local`/`app-dev`, live-mode for future `prod` (#83). Prices are the source of truth in Stripe (no amounts in code — the app resolves by **lookup key** only); creating/updating prices is an operator act here, the app never creates them. Full runbook: [#225](https://github.com/EnterpriseBT/portal-ai/issues/225)._

| Operation | Category | Envs | Owning CLI | Command | Operable? | Guide ref | Disposition |
|---|---|---|---|---|---|---|---|
| List / inspect recent Stripe events (webhook debugging) | logging | local · app-dev | stripe | `stripe events list --json` | yes | [#225](https://github.com/EnterpriseBT/portal-ai/issues/225) | covered |
| Retrieve a specific event | maintenance | local · app-dev | stripe | `stripe events retrieve <event-id>` | yes | [#225](https://github.com/EnterpriseBT/portal-ai/issues/225) | covered |
| Inspect a customer's subscription(s) | maintenance | local · app-dev | stripe | `stripe subscriptions list --customer <cus-id>` | yes | [#225](https://github.com/EnterpriseBT/portal-ai/issues/225) | covered |
| Look up a customer by email | maintenance | local · app-dev | stripe | `stripe customers list --email user@example.com` | yes | [#225](https://github.com/EnterpriseBT/portal-ai/issues/225) | covered |
| List products & prices (incl. lookup keys) | configuration | local · app-dev | stripe | `stripe prices list --lookup-keys <key> --json` | yes | [#225](https://github.com/EnterpriseBT/portal-ai/issues/225) | covered |
| Create a price + lookup key (new / updated tier) | configuration | local · app-dev | stripe | `stripe prices create --product <prod-id> --currency usd --unit-amount <cents> --lookup-key <key>` | yes | [#225](https://github.com/EnterpriseBT/portal-ai/issues/225) | covered |
| Move a subscription to a new price | configuration | local · app-dev | stripe | `stripe subscriptions update <sub-id> -d "items[0][price]"=<price-id>` | yes | [#225](https://github.com/EnterpriseBT/portal-ai/issues/225) | covered |
| Forward webhook events to a local endpoint (dev) | logging | local | stripe | `stripe listen --forward-to localhost:3001/api/webhooks/stripe` | yes | [#225](https://github.com/EnterpriseBT/portal-ai/issues/225) | covered |
| Trigger a test webhook event | maintenance | local · app-dev | stripe | `stripe trigger checkout.session.completed` | yes | [#225](https://github.com/EnterpriseBT/portal-ai/issues/225) | covered |

## Native (`portalops` / `portalai`)

_Auth: `cli-env` — AWS-IAM (infra/DB) + Auth0 device-flow (app API); `--env` required on every command, `--json` on every command. Guards are keyed on env `kind`: `local` unrestricted, `app-dev` (staging) mutations need `--yes`, `prod` destructive **blocked** + non-destructive needs `--yes --confirm-prod`. Full runbook: [#227](https://github.com/EnterpriseBT/portal-ai/issues/227)._

| Operation | Category | Envs | Owning CLI | Command | Operable? | Guide ref | Disposition |
|---|---|---|---|---|---|---|---|
| List env config values (masked) | configuration | local · app-dev | portalops | `portalops vars list --env app-dev --json` | yes | [#227](https://github.com/EnterpriseBT/portal-ai/issues/227) | covered |
| Get one config value | configuration | local · app-dev | portalops | `portalops vars get <KEY> --env app-dev --json` | yes | [#227](https://github.com/EnterpriseBT/portal-ai/issues/227) | covered |
| Set a config value / secret | configuration | local · app-dev | portalops | `portalops vars set <KEY> <value> --env app-dev --yes` | yes | [#227](https://github.com/EnterpriseBT/portal-ai/issues/227) | covered |
| Apply a full config file (validate-then-write) | configuration | local · app-dev | portalops | `portalops vars apply <file> --env app-dev --yes` | yes | [#227](https://github.com/EnterpriseBT/portal-ai/issues/227) | covered |
| Open a DB tunnel to the env's database | maintenance | app-dev | portalops | `portalops db tunnel --env app-dev` | yes | [#227](https://github.com/EnterpriseBT/portal-ai/issues/227) | covered (hold-open stream) |
| Run a one-shot SQL query | maintenance | local · app-dev | portalops | `portalops db psql --env app-dev -- "SELECT 1"` | yes | [#227](https://github.com/EnterpriseBT/portal-ai/issues/227) | covered |
| Reset the database (destructive) | maintenance | local · app-dev | portalops | `portalops db reset --env app-dev --yes` | yes | [#227](https://github.com/EnterpriseBT/portal-ai/issues/227) | covered (destructive — blocked in prod) |
| Seed the database | maintenance | local · app-dev | portalops | `portalops db seed --env app-dev --yes` | yes | [#227](https://github.com/EnterpriseBT/portal-ai/issues/227) | covered |
| Converge tier catalog to the DB (Stripe price resolution) | configuration | local · app-dev | portalops | `portalops tier apply --env app-dev --yes` | yes | [#227](https://github.com/EnterpriseBT/portal-ai/issues/227) | covered |
| List / inspect organizations | maintenance | local · app-dev | portalai | `portalai org list --env app-dev --json` | yes | [#227](https://github.com/EnterpriseBT/portal-ai/issues/227) | covered |
| Create / provision an organization | configuration | local · app-dev | portalai | `portalai org create --env app-dev --yes` | yes | [#227](https://github.com/EnterpriseBT/portal-ai/issues/227) | covered |
| Set an org's tier | configuration | local · app-dev | portalai | `portalai org set-tier <org-id> <tier> --env app-dev --yes` | yes | [#227](https://github.com/EnterpriseBT/portal-ai/issues/227) | covered |
| Add / remove an org member | configuration | local · app-dev | portalai | `portalai member add <email> --org <org-id> --env app-dev --yes` | yes | [#227](https://github.com/EnterpriseBT/portal-ai/issues/227) | covered |
| List / inspect users | maintenance | local · app-dev | portalai | `portalai user list --env app-dev --json` | yes | [#227](https://github.com/EnterpriseBT/portal-ai/issues/227) | covered |

## Common workflows

Cross-surface recipes for tasks that span more than one CLI — the one piece of substance this charter owns, since no single per-surface guide can. Each step names its owning CLI + canonical command; the step's detail lives in that surface's guide.

### Add a subscription tier

1. **Stripe** — create the price + a unique lookup key (no amounts in code; the lookup key is the app's handle):
   `stripe prices create --product <prod-id> --currency usd --unit-amount <cents> --lookup-key <tier-lookup-key>`
2. **core** — add the tier entry to `packages/core/src/registries/tier-catalog.ts` referencing that `<tier-lookup-key>` (+ its toolpack entitlements). Commit through the normal PR flow.
3. **portalops** — converge the DB to the catalog (resolves the lookup key → the env's price id):
   `portalops tier apply --env app-dev --yes`

### Update a tier's price

1. **Stripe** — create the new price and **transfer the existing lookup key** to it (prices are immutable; the lookup key is what moves):
   `stripe prices create --product <prod-id> --currency usd --unit-amount <new-cents> --lookup-key <tier-lookup-key> --transfer-lookup-key`
2. **portalops** — re-converge so the DB resolves the lookup key to the new price id:
   `portalops tier apply --env app-dev --yes`

_(No `TIER_CATALOG` change — the catalog references the lookup key, not the price id.)_

### Provision a new app secret to app-dev

1. **portalops** — set the value in the env's Secrets Manager (exactly what `portalops vars` is for):
   `portalops vars set <KEY> <value> --env app-dev --yes`
2. **deploy-infra (one-time)** — add a `ValueFrom` mapping for `<KEY>` to `infra/cloudformation/backend.yml` so the ECS task receives it, then redeploy. This half is **not** a `portalops` op — it is CI/IaC (the ownership line: `portalops` owns the config *value*, deploy/IaC owns wiring it into the task). See finding (a).

## Overlap decisions

**Rule (compose-test):** native-over-vendor glue is allowed **only** when the native command *composes* vendor primitives into a Portal-domain operation. A thin passthrough of a vendor CLI (e.g. a hypothetical `portalops aws-logs` that just shells out to `aws logs`) is **rejected** — use the vendor CLI directly, per its guide.

**Recorded precedent** — the three shipped native-over-vendor cases all pass the test and stand as the pattern:

| Native op | Vendor primitive(s) | What it composes into (Portal domain) |
|---|---|---|
| `portalops vars *` | Secrets Manager + SSM read/write | a curated env-config catalog with masking + validate-then-write |
| `portalops db tunnel` / `db psql` | `aws ssm start-session` + bastion | a `resolveEnvConnection`-backed DB session (connection-string rewrite, lifecycle) |
| `portalops tier apply` | Stripe `prices.list` (read) | tier-catalog → DB convergence in one transaction (lookup-key resolution) |

**Standing rule:** any *new* native-over-vendor command a guide proposes must clear the compose-test **in this document** (add a row above with its Portal-domain justification) or it is rejected and becomes a vendor-CLI runbook entry instead. No wrapping for convenience.

## Gap list & findings

**Non-operable operations** (from the tables above):

| Operation | Surface | Why not operable | Disposition |
|---|---|---|---|
| Inject a new secret into the running API task | AWS | No single `aws` CLI command wires a secret into the ECS task definition — it needs a `ValueFrom` mapping in `backend.yml` (CloudFormation/CI). The config *value* is settable via `portalops vars set` (operable); only the deploy-side wiring is missing. | **deploy-infra** — see finding (a) |

**Findings:**

- **(a) `stripe-secret-key` deploy wiring.** The key is in the `portalops vars` catalog and settable via `portalops vars set STRIPE_SECRET_KEY --env app-dev --yes` (operable), but is **not yet provisioned into the CloudFormation backend stack** (`backend.yml` has no Stripe secret `ValueFrom`), so the live `app-dev` app can't resolve it for `tier apply`. **Route:** deploy-infra (add the `ValueFrom`), documented in [#225](https://github.com/EnterpriseBT/portal-ai/issues/225). Illustrates the ownership line — `portalops` owns the config *value*; deploy/IaC owns wiring it into the task.
- **(b) Audit-log reader — declined (conscious exception).** Every mutating native CLI op appends to `~/.portalai/audit.log` (best-effort, local JSONL), but there is **no query command** to read it. Decision: the log stays **write-only**; a reader is out of scope. AWS-side operation auditing is covered by **CloudTrail** (see the AWS surface / [#224](https://github.com/EnterpriseBT/portal-ai/issues/224)); centralized/server-side audit is a separate concern (#179). **Disposition:** `exception` — not a gap to fill.

No other non-operable operations. Every inventoried operation carries a disposition (100% classified).

## Coverage

Computed from the tables above (46 operations total).

**Maintenance + configuration (the bar's denominator):** `D = 40`, of which `N = 39` are operable → **97.5%** (`39/40`) — clears the **≥ 90%** bar.

**Logging (reported separately):** `6 / 6` operable → **100%**.

**Classified:** `46 / 46` operations carry a non-blank disposition → **100% classified**, zero unclassified gaps.

**Parity defects:** none. AWS operations are `app-dev`-only *by nature* (no AWS surface exists for `local`), not parity defects; Auth0 (separate per-env tenants) and native operations are operable across every environment they list.

Per-surface:

| Surface | Ops | Operable | Non-operable | Maint+config operable |
|---|---:|---:|---:|---:|
| AWS | 11 | 10 | 1 | 8 / 9 |
| Auth0 | 12 | 12 | 0 | 10 / 10 |
| Stripe | 9 | 9 | 0 | 7 / 7 |
| Native | 14 | 14 | 0 | 14 / 14 |
| **Total** | **46** | **45** | **1** | **39 / 40 (97.5%)** |

The single non-operable operation — inject a secret into the running ECS task — is a deploy-side wiring step (finding (a)), not a missing CLI command; its config *value* half is operable via `portalops vars set`. See [Gap list & findings](#gap-list--findings).
