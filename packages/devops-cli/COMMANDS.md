# portalops — command reference

Machine-oriented reference: enough to operate the CLI without trial and error. Human docs: [README.md](./README.md). Agent-operability contract (exit codes, server-enforced guards, auth, audit): [CLAUDE.md → Operating the Portal CLIs](../../CLAUDE.md). Invariants: `--env <name>` **required** on every command (no default); banner `[env: <name> (<kind>)]` on **stderr**; payload (or the `--json` envelope) alone on **stdout**.

## Exit codes

| Exit | Meaning |
|---|---|
| 0 | success |
| 1 | unclassified error |
| 2 | usage error (missing/unknown flags or arguments) |
| 3 | `ENV_NOT_CONFIGURED` — unknown env, unknown catalog key, or missing local config |
| 4 | `ENV_NOT_AUTHORIZED` — AWS credentials absent/expired or IAM-denied |
| 5 | `ENV_CONFIRMATION_REQUIRED` — missing `--yes` and/or `--confirm-prod` |
| 6 | `ENV_DESTRUCTIVE_BLOCKED` — destructive op against production (no override exists) |
| 7 | `ENV_INFRA_ERROR` — AWS / tunnel / psql / ECS failure (message carries the cause) |
| 8 | not-found family — `TIER_APPLY_MISSING_PRICES` (a declared tier's Stripe lookup key resolves to no price; `tier apply` fails closed before any DB write) or `TIER_NOT_FOUND` (`tier update`/`tier description` target a slug that doesn't exist). Mirrors admin-cli's 8. |
| 9 | conflict family — `TIER_ALREADY_EXISTS` (`tier create` targets a slug that already exists); `CACHE_CUTOVER_CONFLICT` (a `cache phase`/`cache switch` step taken out of order, #852). Mirrors admin-cli's 9. |

`--json` errors: `{"error":{"code":"<CODE>","message":"<human text>"}}` on stdout, exit code as above.

## Guard classes

| Class | development | staging | production |
|---|---|---|---|
| read (`cache status`, …) | — | — | — |
| connect (`db tunnel`, `db psql`, `jobs status`) | — | — | `--confirm-prod` |
| mutation (`vars set/apply`, `db seed`, `db upgrade`, `db url --write`, `jobs redispatch`, `cache phase legacy\|both`, `cache switch`, `cache refresh-template`, `service scale`) | — | `--yes` | `--yes --confirm-prod` |
| destructive (`db reset`, `db reset-seed`, `cache phase encrypted`, `cache refresh-template` that removes or replaces a resource) | — | `--yes` | **refused** (exit 6) |

Every mutation/destructive command appends a JSONL audit entry to `~/.portalai/audit.log` (no secret values).

---

## vars

### `portalops vars describe --env <env> [--json]`
Read. The catalog with resolved paths — fetches **no** values.
`--json`: `{ "env": string, "region": string|null, "entries": [{ "key", "kind": "secret"|"ssm", "path", "ssmType"? }] }`

### `portalops vars list --env <env> [--unmask] [--json]`
Read. Every key with its live value. Secrets masked (`abcd…yz (len=N)`) unless `--unmask`; SSM params plain; missing → `"(unset)"`. Authorization failures exit 4 (they do **not** read as unset).
`--json`: `{ "entries": [{ "key", "kind", "value", "masked": boolean }] }`

### `portalops vars get <KEY> --env <env> [--json]`
Read. One **raw** value (an explicit single read is never masked). Human output: the bare value.
`--json`: `{ "key", "value" }` · Unknown key → exit 3.

### `portalops vars set <KEY> <VALUE|-> --env <env> --yes [--confirm-prod] [--json]`
Mutation. `-` reads the value from stdin. Empty values refused (exit 1). Creating a **new** secret succeeds with a stderr warning (its ARN must be added to the deploy workflow / CloudFormation).
`--json`: `{ "key", "updated": true, "created": boolean }`

### `portalops vars apply <FILE> --env <env> --yes [--confirm-prod] [--json]`
Mutation. Batch-apply a `KEY=VALUE` env file (comments `#`, blanks, single surrounding quotes stripped). **Every line is validated before any write**; any error (unknown key, empty value, missing `=`) aborts the whole file naming `file:line`.
`--json`: `{ "applied": [string] }`

### `portalops vars template [out] --env <env> [--json]`
Read (writes a **local** file). Default `./cloud-vars.<env>.env`; refuses overwrite; mode 0600; contains **plaintext secrets** (stderr warning).
`--json`: `{ "path", "warning" }`

### Marketing-site business config (#311)

`SUPPORT_EMAIL`, `SALES_EMAIL`, `ADMIN_EMAIL` and `SECURITY_EMAIL` are SSM catalog entries (`support-email` / `sales-email` / `admin-email` / `security-email` under the env's parameter prefix). They are the **single place a business email is written**; every consumer reads it as an environment variable injected at deploy time — the API serves no contact address, the marketing site bakes them at build, and the web app bakes the first three into its bundle. `SECURITY_EMAIL` (#613) is site-only: the `security.txt` contact and the `/security/` reporting address.

They are marked `siteConfig` in the catalog: a successful `vars set` (or a `vars apply` batch carrying one) fires the marketing-site rebuild dispatch, so the published site picks the value up without waiting for a code deploy. **The web app has no equivalent dispatch** — it takes the new value on its next deploy. That asymmetry is deliberate: an address changes about never, and the deploy is the mechanism.

**Same key set in every environment, differing only in value.** `qa@portalsai.io` serves every role in local and app-dev, so no non-prod surface can advertise a customer-facing inbox; only prod points at the role-split addresses (#369).

**The rebuild dispatch.** Three independent triggers refresh the published site, so no single one is load-bearing:

| Trigger | Fires when | Credential |
|---|---|---|
| `portalops` | `vars set`/`vars apply` of a `siteConfig` key, or a non-dry-run `tier apply` that changed ≥1 row | your shell `GITHUB_TOKEN` |
| API | a Stripe `price.created`/`price.updated`/`price.deleted` webhook (first delivery only) | `GITHUB_DISPATCH_TOKEN` |
| Schedule | nightly, unconditionally — the safety net | the workflow's own token |

The `portalops` dispatch **never blocks the write**: the value is already committed when it fires, so an unset `GITHUB_TOKEN` or a GitHub outage prints one stderr notice and still exits 0. Double-firing (a Stripe price change followed by a `tier apply`) is expected and harmless — rebuilds are idempotent and the workflow's concurrency group serializes them.

`GITHUB_DISPATCH_TOKEN` is a **secret** catalog entry (`github-dispatch-token`): a fine-grained PAT scoped to this repo with Contents: read + repository dispatch. It is the API's identity, deliberately separate from your operator token. Set it with `portalops vars set GITHUB_DISPATCH_TOKEN <pat> --env <env> --yes`; leaving it unset makes the API-side dispatch a no-op and leaves the nightly schedule as the freshness guarantee.

---

## db

### `portalops db tunnel --env <env> [--local-port <n>] [--db-name <name>] [--confirm-prod]`
Connect. Opens the env's DB path — `local`: prints the `.env` connection string; AWS envs: SSM port-forward via the bastion (default local port 15432). Prints a `psql` hint on stderr and **stays attached** until Ctrl+C (signal hooks close the tunnel; no orphaned plugin).

### `portalops db url --env <env> [--db-name <name>] [--ssl-mode <mode>] [--write] [--yes] [--confirm-prod] [--json]`
Read by default; **mutation** with `--write`. Composes the env's `DATABASE_URL` from the database stack's `<envName>-Db{Endpoint,Port,MasterSecretArn}` exports and the RDS-managed master credential, so the password moves AWS-API to AWS-API and is never rendered.

Without `--write` the password is **redacted** (`***`) — there is no flag that prints it. `--write` stores the real value at the `database-url` secret and is guarded like any other mutation (prod needs `--yes --confirm-prod`). Creating a **new** secret warns that its ARN must reach the deploy workflow.

`--db-name` defaults to `portal_ai`. RDS creates only the `postgres` maintenance database (the template sets no `DBName`), so the application database is created by hand — pass `--db-name postgres` to reach the maintenance DB during that bootstrap:

```bash
# after the database stack exists, before the app database does
portalops db psql --env prod --confirm-prod --db-name postgres -- -c "CREATE DATABASE portal_ai"
portalops db url --env prod --write --yes --confirm-prod   # the ECS bootstrap artifact
```

`--json`: `{ "connectionString", "endpoint", "port", "written": bool, "created": bool }`

### `portalops db psql --env <env> [--db-name <name>] [--confirm-prod] [-- <psql args…>]`
Connect. psql against the env connection. No extra args → interactive REPL (inherited stdio). Args after `--` pass through for one-shot use:
```
portalops db psql --env app-dev -- -tAc "select 1"
```
Exits with psql's own exit code. Missing psql binary → exit 7 with install guidance.

### `portalops db reset --env <env> --yes [--json]`
**Destructive** (never production). The infra reset: `DROP TABLE "er__…" CASCADE` for dynamic wide tables, one `TRUNCATE … CASCADE` for everything else, `__drizzle_migrations` untouched, and so is every table an extension owns (e.g. PostGIS's `spatial_ref_sys`, which nothing reseeds; #784). Works for `--env local` (`.env` DB).
`--json`: `{ "dropped": [string], "truncated": [string] }`

### `portalops db seed --env <env> --yes [--confirm-prod] [--json]`
Mutation. Restores the system rows a reset removes — the `standard` tier row the `organizations.tier` FK needs, plus the connector definitions. **Dispatches on the env's shape** (#295): a deployed env runs `db:seed:ci` as a FARGATE one-off ECS task in its cluster (live service network config + task definition; waits for completion; non-zero container exit → exit 7 naming CloudWatch); an env with no ECS (`--env local`) spawns the app's own `db:seed` script with `DATABASE_URL` injected from the env connection — the same route `portalai org create` / `org reset` take.
`--json`: `{ "via": "ecs", "taskArn", "exitCode": 0 }` or `{ "via": "local", "script": "db:seed" }`

### `portalops db reset-seed --env <env> --yes [--json]`
**Destructive** (never production). `reset` then `seed`, in that order — a total truncate and re-seed, meaning the same thing for every env. The schema and `__drizzle_migrations` survive the truncate, so no migration step is involved.
`--json`: `{ "reset": {…}, "seed": {…} }`

### `portalops db upgrade --env <env> --yes [--confirm-prod] [--json]`
Mutation (not destructive — migrations are expand-only, so `prod` is gated by `--yes --confirm-prod`, never refused). Applies pending migrations **and** the idempotent global seed as one advisory-locked operation (`db:upgrade`, #581) — a second concurrent pass acquires no lock and does no work. **Dispatches on the env's shape** exactly like `db seed`, with **no saas/residency branch**: a deployed env runs `db:upgrade:ci` as a FARGATE one-off ECS task (non-zero container exit → exit 7 naming CloudWatch); `--env local` spawns the app's own `db:upgrade`. A residency install upgrades via the Helm chart's `pre-upgrade` job and never uses this command — it serves our own SaaS/ECS channel.
`--json`: `{ "via": "ecs", "taskArn", "exitCode": 0 }` or `{ "via": "local", "script": "db:upgrade" }`

Every ECS one-off runs the built script with `node` (`node dist/db/seed.js`, `node dist/scripts/db-upgrade.js`, `node dist/scripts/jobs-redispatch.js`), the command each `:ci` package script names. The runtime image has no npm (#573), so `npm run` there fails (#852).

## cache

The ElastiCache encryption cutover (#852). `cache.yml` holds the plaintext cache and the encrypted one side by side behind `RedisCutoverPhase` (`legacy` → `both` → `encrypted`), and `backend.yml`'s `REDIS_URL` follows `RedisEndpointSource` (`legacy` | `encrypted`). The deploy workflows never pass either, so a routine deploy keeps whatever these commands set. Every change is an UpdateStack on the **deployed** template, with every other parameter at its previous value: a step never redeploys code. A step taken out of order exits 9 (`CACHE_CUTOVER_CONFLICT`). Full sequence: [`docs/REDIS_ENCRYPTION_CUTOVER.runbook.md`](../../docs/REDIS_ENCRYPTION_CUTOVER.runbook.md).

### `portalops cache status --env <env> [--json]`
Read. The phase, the endpoint source, each cache present (`portalai-<env>` legacy, `portalai-<env>-tls` encrypted) with its status and encryption flags, and the API service's desired/running counts. A stack whose template predates #852 reads as `legacy`.
`--json`: `{ "phase", "endpointSource", "caches": [{ "id", "kind": "cache-cluster|replication-group", "status", "atRestEncryption", "transitEncryption", "transitEncryptionMode" }], "service": { "desired", "running" } }`

### `portalops cache phase <legacy|both|encrypted> --env <env> --yes [--confirm-prod] [--json]`
`both` creates the encrypted cache (mutation; 10–20 min, waits for `UPDATE_COMPLETE`). `encrypted` removes the legacy cache and is **destructive**: refused on prod, where the legacy cache goes with the cleanup release. A phase may only drop the cache the backend isn't using (else exit 9). Re-applying the current phase reports `changed: false`. If the deployed template predates `RedisCutoverPhase`, it exits 9 and points at `cache refresh-template --phase` (#861).
`--json`: `{ "stack", "phase", "changed" }`

### `portalops cache refresh-template --env <env> [--phase <legacy|both|encrypted>] [--dry-run] --yes [--confirm-prod] [--json]`
Mutation (**destructive** when the preview removes or replaces a resource). Applies `main`'s `infra/cloudformation/cache.yml` to the cache stack, for a template the deploy workflows skipped. They use `aws cloudformation deploy`, which skips a change set with no resource changes, so a template that only adds parameters, conditions or outputs never lands (#861).
- **Checkout:** refuses (exit 9) unless the checkout is clean for that file and `HEAD` is `origin/main`.
- **Parameters:** every parameter the template declares and the stack has keeps its previous value. A new one must have a default.
- **`--phase`:** sets `RedisCutoverPhase` with the template, under `cache phase`'s preconditions. CloudFormation applies a template only together with a resource change (a template-only update is "No updates" too), so a template that only adds the parameter lands with the phase whose resource change carries it: `--phase both` adds the encrypted group.
- **Apply:** with resource changes, it executes the previewed change set itself, so what's applied is what was shown.
- **Preview:** a change set runs first, and is deleted after. A removal or replacement counts as destructive, so prod refuses it. `--dry-run` stops after the preview.
- **Audit:** records the template path and the commit.

`--json`: `{ "stack", "template", "commit", "phase", "resourceChanges": [{ "logicalId", "action", "replacement" }], "dryRun", "changed" }`

### `portalops cache switch <legacy|encrypted> --env <env> --yes [--confirm-prod] [--json]`
Mutation. Points the backend's `REDIS_URL` at the other cache (`rediss://` for `encrypted`). Requires phase `both` and the service at zero desired and running tasks (else exit 9), and holds `DesiredCount` at 0, so the tasks start against the new cache only after `jobs redispatch`. `legacy` is the rollback, until the legacy cache is retired.
`--json`: `{ "stack", "endpointSource", "changed" }`

## service

### `portalops service scale <count> --env <env> --yes [--confirm-prod] [--allow-active] [--json]`
Mutation. Sets the API service's task count through the backend stack's `DesiredCount` (never ECS UpdateService, so the stack stays the record), and waits for the stack update, which CloudFormation completes only once the service is stable. A count already in place reports `changed: false` and isn't audited. The workers run in the API process, so 0 stops both enqueuing and processing. Scaling to 0 refuses (exit 5) while any job is `active` unless `--allow-active`; those jobs would re-run through `jobs redispatch`.
`--json`: `{ "service", "desired", "changed" }`

## jobs

The job queue across a Redis replacement (#852). The cutover sequence is in [`docs/REDIS_ENCRYPTION_CUTOVER.runbook.md`](../../docs/REDIS_ENCRYPTION_CUTOVER.runbook.md).

### `portalops jobs status --env <env> [--confirm-prod] [--json]`
Connect (prod needs `--confirm-prod`). Counts live non-terminal `jobs` rows (`pending`, `active`, `awaiting_confirmation`, `stalled`) by status and type, from Postgres over the env connection (local: `.env`; AWS: the SSM tunnel). Postgres is the record of truth, so this works whether or not Redis does. A drain is done when `byStatus.active` is absent.
`--json`: `{ "counts": [{ "status", "type", "count" }], "byStatus": { "<status>": n }, "total": n }`

### `portalops jobs redispatch --env <env> --yes [--confirm-prod] [--dry-run] [--json]`
Mutation. Puts every live `pending` / `active` / `stalled` row whose BullMQ entry is gone back on the queue, under its row id. Run it after a Redis replacement, with the API service at zero and **before** it scales up: the API's boot sweep (#391) would otherwise reap the queued rows as stranded. Each row is flipped while non-terminal before it's added, so a cancelled or reaped job is never revived. A second pass finds the rows queued and adds nothing, and an interrupted `active` row resumes as a lost execution (#464). Dispatches on the env's shape like `db upgrade`: a deployed env runs `node dist/scripts/jobs-redispatch.js` as a FARGATE one-off (the summary JSON line is in its CloudWatch log; non-zero exit → exit 7), and `--env local` spawns the app's `jobs:redispatch`. `--dry-run` reports without writing and isn't audited. A re-queued row keeps what is left of its retry budget, and its attempt count carries on. The pass's own summary comes back in the payload: parsed from the script's stdout locally, read back from the task's CloudWatch stream on ECS (`null` if that read fails; the pass still ran).
`--json`: `{ "via": "ecs", "taskArn", "exitCode": 0, "log": { "region", "group", "stream" }, "summary" }` or `{ "via": "local", "script": "jobs:redispatch", "summary" }`, where `summary` is `{ "acquiredLock", "scanned", "redispatched": [{ "id", "type", "priorStatus" }], "present", "skippedTerminal", "dryRun" } | null`

## tier

### `portalops tier apply --env <env> [--dry-run] [--yes] [--confirm-prod] [--json]`
Mutation (`--dry-run` is read-only — no `--yes` needed). Converges the environment's `tiers` rows to the in-repo declarative catalog (`packages/core/src/registries/tier-catalog.ts`, #218): upserts **declared slugs only**, converging every policy field plus the env-local `stripe_price_id` resolved from each entry's Stripe `lookup_key` (read-only `prices.list` — apply never creates or mutates Stripe objects). Rows the catalog doesn't name (ad-hoc enterprise deals) are never touched; they're listed once as `unmanaged`. Validate-all-then-write: a declared lookup key with no price in the env's Stripe account aborts before any DB write. Audits per changed slug.
`--json`: `{ "dryRun": bool, "changes": [{ "slug", "action": "insert|update|noop", "fields": { "<field>": { "from", "to" } }, "stripePriceId" }], "unmanaged": [string] }`

**Stripe key:** AWS envs read the `stripe-secret-key` secret (`portalops vars set STRIPE_SECRET_KEY … --env <env>`); `--env local` reads `STRIPE_SECRET_KEY` from the process env. A **restricted key** (`rk_`, Prices read) is recommended **for a `tier-apply`-only credential** — apply never writes to Stripe. A catalog with no non-null lookup keys needs no Stripe key at all.

> **Shared-secret caveat (#239):** when the *same* environment's running app performs checkout (`POST /api/billing/checkout` writes sessions/customers/subscriptions), `STRIPE_SECRET_KEY` is shared by both the app and `tier apply` — so it must be a **writable** key (`sk_test_…` in a sandbox, `sk_live_…` in prod), **not** `rk_`. The read-only `rk_` recommendation applies only to an env where nothing but `tier apply` reads the secret. That app also needs the companion managed secret **`STRIPE_WEBHOOK_SECRET`** (`stripe-webhook-secret`) for webhook signature verification — set it the same way (`portalops vars set STRIPE_WEBHOOK_SECRET whsec_… --env <env> --yes`). A brand-new secret's ARN must be wired into `infra/cloudformation/backend.yml` + `.github/workflows/deploy-dev.yml` before the next deploy.

**Local invocation:**
```
DATABASE_URL=postgresql://… STRIPE_SECRET_KEY=rk_test_… portalops tier apply --env local --dry-run
```

### Price runbook (Stripe-side — pricing never lives in code)

- **New purchasable tier / fresh environment:** create the product + price in the env's Stripe (dashboard, or `stripe prices create -d "product_data[name]=Pro" -d "unit_amount=4900" -d "currency=usd" -d "recurring[interval]=month" -d "lookup_key=pro"`), then `tier apply` — the row adopts the env-local price id. Note: a price created via `product_data` becomes its product's **default price**, and Stripe refuses to archive a default price — to retire it later, archive (or re-default) the product first.
- **Price change:** Stripe prices are immutable — create the NEW price carrying the lookup key with `-d "transfer_lookup_key=true"`, then `tier apply` to re-point the row. Existing subscriptions stay on the old price (Stripe semantics); new checkouts get the new one. Post-rotation, check in-flight subscriptions on the old price (`stripe subscriptions list --price <old-price-id>`) — the webhook warn-and-keeps orgs whose subscription price is no longer mapped (never a downgrade), so migrate or let them renew per your pricing policy.
- **Retire a tier from sale:** set `selectable: false` in the catalog + apply. Apply never deletes rows; removing an entry entirely just orphans the row as `unmanaged`.

### `portalops tier create --env <env> --slug <slug> --display-name <name> [--cta <kind>] [--visible-to-org <orgId>] [--description <text>] [--overage <mode>] [--stripe-price-id <id>] --yes [--confirm-prod] [--json]`
Mutation. Creates a **per-client custom tier** row directly (outside the catalog — `tier apply` never touches it, #241). Defaults are the enterprise posture: `--cta contact`, unlimited allocations (all `null`), all built-in toolpacks + custom toolpacks allowed, monthly period, `overage hard-deny`, listed (`selectable`). `--visible-to-org <orgId>` scopes the tier so it appears **only** in that org's Settings → Subscription & Billing (omit = public to all orgs). Conflict (**exit 9**) if the slug already exists. Audited.

### `portalops tier update --env <env> --slug <slug> [--display-name <name>] [--cta <kind>] [--visible-to-org <orgId>] [--description <text>] [--overage <mode>] [--stripe-price-id <id>] --yes [--confirm-prod] [--json]`
Mutation. Updates **only the fields provided** on an existing tier. Not-found (**exit 8**) if the slug is absent. Audited.

### `portalops tier description --env <env> --slug <slug> (--set <text> | --clear) --yes [--confirm-prod] [--json]`
Mutation. Sets or clears a tier's operator-authored **blurb** — the copy shown on its billing card. `description` is deliberately **excluded from `tier apply` convergence**, so a subsequent apply never reverts it. Not-found (**exit 8**) if the slug is absent. Audited.

### Custom-tier runbook (#241)

To stand up a bespoke enterprise plan for a client and put them on it:

```
# 1. Create the tier, scoped to the client's org (business config — portalops).
portalops tier create --env app-dev --slug acme_enterprise \
  --display-name "Acme Enterprise" --visible-to-org <orgId> \
  --description "Tailored to Acme — unlimited usage, priority support." --yes

# 2. (Optional) refine the blurb later without any code change.
portalops tier description --env app-dev --slug acme_enterprise \
  --set "Updated copy." --yes

# 3. Switch the client's org onto the tier (customer app data — portalai).
portalai org set-tier <orgId> acme_enterprise --env app-dev --yes
```

The card renders a **"Contact support"** CTA while the org is only *viewing* the tier as an upgrade, and its full policy once the org is *on* it (#241). Switching an org's tier is `portalai org set-tier` — not a portalops command (see `packages/admin-cli/COMMANDS.md`).

**The standing `demo` tier (#511)** is this pattern applied to the internal demo org (#507): free, unlimited, all toolpacks, `cta contact`, no Stripe price. In app-dev/prod it is created org-scoped (`--visible-to-org <demo orgId>`); **locally it is created automatically** by `local provision` (the `demo-tier` step, unscoped + non-public so it stays off `site-config` yet is `set-tier`-able onto any local org). `tier apply` leaves it `unmanaged` in every env. Provisioning runbook: `docs/DEMO_ORG.runbook.md`.

## local

### `portalops local provision --env local [--e2e-org [member-email]] [--owner-tier <slug>] [--yes] [--json]`
Mutation, **local-only by contract** (#490) — `--env` accepts only `local`; anything else is a usage error (**exit 2**) before any env resolution. Deployed envs are provisioned by CI/deploy (`db:seed:ci` ECS one-off, nightly `tier apply`). One idempotent command for "fresh reset → fully provisioned": it composes the existing steps, in order, stopping at the first failure — nothing is reimplemented.

| Step | Delegates to | Effect |
|---|---|---|
| `migrate` | apps/api `db:migrate` (spawned with `DATABASE_URL` injected) | applies pending drizzle migrations (no-op when current) |
| `seed` | `portalops db seed` (local dispatch → `db:seed`) | system rows: bootstrap `standard` tier + connector definitions |
| `tier-apply` | `portalops tier apply` | catalog tiers + env-local Stripe price ids (fail-closed on a missing price) |
| `demo-tier` | `portalops tier create demo` (idempotent) | the standing unlimited `demo` tier (unscoped, non-public); `exists` on a re-run |
| `e2e-org` | apps/api `db:seed:org --name e2e-fixture --member-email <email> [--tier <slug>]` | only with `--e2e-org`; otherwise reported `skipped` |

`--e2e-org [member-email]`: an explicit value wins; a bare flag defaults from `E2E_AUTH0_USERNAME` in the process env; neither present → usage error (**exit 2**) before any step runs. The member user must already exist — it is created on the test user's first login (`e2e:auth`, see `packages/e2e/README.md`), which stays a separate step because it is interactive by nature.

`--owner-tier <slug>` (#537): assign this tier to the seeded e2e org — e.g. `--owner-tier demo` for an org with unlimited allocations + all toolpack entitlements, ready to test against with no manual `org set-tier`. **Requires `--e2e-org`** (the tier is applied to that org; the login-created default org doesn't exist until first login) — passing it alone is a usage error (**exit 2**). The slug must already exist; since `tier-apply`/`demo-tier` run first, `demo` and every catalog tier (`enterprise`, …) are available. An unknown slug fails the `e2e-org` step loudly rather than silently no-opping. Fastest unlimited-org bring-up: `portalops local provision --env local --e2e-org admin@portalsai.io --owner-tier demo`, then `portalai member switch <orgId> admin@portalsai.io --env local`.

Local env config: `DATABASE_URL` (the local connection) and `STRIPE_SECRET_KEY` (the tier step — missing key fails that step `ENV_NOT_CONFIGURED`, exit 3; a key whose account lacks a declared lookup key's price fails it `TIER_APPLY_MISSING_PRICES`, exit 8) are read from this package's own `.env` (`packages/devops-cli/.env`, git-ignored, auto-loaded for `--env local` — #632; copy from `.env.example`) or from the shell (an export wins).

`--json`: `{ "steps": [{ "name": "migrate"|"seed"|"tier-apply"|"demo-tier"|"e2e-org", "status": "ok"|"skipped"|"failed", "result"?: {…}, "error"?: { "code", "message" } }] }` (the `e2e-org` result carries `ownerTier` when `--owner-tier` was set)

> **Failure shape — a deliberate deviation.** Every other command emits either a payload or the `{"error":{…}}` envelope. Here a mid-run step failure emits the **steps payload** — earlier steps' results intact, the failed step carrying its `{code,message}` — and the process exit code is mapped from that code (e.g. a missing Stripe price exits 8 with the migrate + seed results still on stdout). For this command, branch on `steps[].status`, not on the envelope.

Idempotent: safe to re-run against an already-provisioned local DB (each delegated step already is; a converged re-run reports every step `ok` with `tier-apply` all-noop). Audits one `local provision` line; the seed and tier-apply steps also audit individually.
