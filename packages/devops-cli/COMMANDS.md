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
| 9 | conflict family — `TIER_ALREADY_EXISTS` (`tier create` targets a slug that already exists). Mirrors admin-cli's 9. |

`--json` errors: `{"error":{"code":"<CODE>","message":"<human text>"}}` on stdout, exit code as above.

## Guard classes

| Class | development | staging | production |
|---|---|---|---|
| read | — | — | — |
| connect (`db tunnel`, `db psql`) | — | — | `--confirm-prod` |
| mutation (`vars set/apply`, `db seed`, `db url --write`) | — | `--yes` | `--yes --confirm-prod` |
| destructive (`db reset`, `db reset-seed`) | — | `--yes` | **refused** (exit 6) |

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

`SUPPORT_EMAIL`, `SALES_EMAIL` and `ADMIN_EMAIL` are SSM catalog entries (`support-email` / `sales-email` / `admin-email` under the env's parameter prefix). They are the **single place a business email is written**; every consumer reads it as an environment variable injected at deploy time — the API serves no contact address, the marketing site bakes them at build, and the web app bakes them into its bundle.

They are marked `siteConfig` in the catalog: a successful `vars set` (or a `vars apply` batch carrying one) fires the marketing-site rebuild dispatch, so the published site picks the value up without waiting for a code deploy. **The web app has no equivalent dispatch** — it takes the new value on its next deploy. That asymmetry is deliberate: an address changes about never, and the deploy is the mechanism.

**Same key set in every environment, differing only in value.** `qa@portalsai.io` serves all three roles in local and app-dev, so no non-prod surface can advertise a customer-facing inbox; only prod points at the role-split addresses (#369).

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
**Destructive** (never production). The infra reset: `DROP TABLE "er__…" CASCADE` for dynamic wide tables, one `TRUNCATE … CASCADE` for everything else, `__drizzle_migrations` untouched. Works for `--env local` (`.env` DB).
`--json`: `{ "dropped": [string], "truncated": [string] }`

### `portalops db seed --env <env> --yes [--confirm-prod] [--json]`
Mutation. Restores the system rows a reset removes — the `standard` tier row the `organizations.tier` FK needs, plus the connector definitions. **Dispatches on the env's shape** (#295): a deployed env runs `db:seed:ci` as a FARGATE one-off ECS task in its cluster (live service network config + task definition; waits for completion; non-zero container exit → exit 7 naming CloudWatch); an env with no ECS (`--env local`) spawns the app's own `db:seed` script with `DATABASE_URL` injected from the env connection — the same route `portalai org create` / `org reset` take.
`--json`: `{ "via": "ecs", "taskArn", "exitCode": 0 }` or `{ "via": "local", "script": "db:seed" }`

### `portalops db reset-seed --env <env> --yes [--json]`
**Destructive** (never production). `reset` then `seed`, in that order — a total truncate and re-seed, meaning the same thing for every env. The schema and `__drizzle_migrations` survive the truncate, so no migration step is involved.
`--json`: `{ "reset": {…}, "seed": {…} }`

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

### `portalops local provision --env local [--e2e-org [member-email]] [--yes] [--json]`
Mutation, **local-only by contract** (#490) — `--env` accepts only `local`; anything else is a usage error (**exit 2**) before any env resolution. Deployed envs are provisioned by CI/deploy (`db:seed:ci` ECS one-off, nightly `tier apply`). One idempotent command for "fresh reset → fully provisioned": it composes the existing steps, in order, stopping at the first failure — nothing is reimplemented.

| Step | Delegates to | Effect |
|---|---|---|
| `migrate` | apps/api `db:migrate` (spawned with `DATABASE_URL` injected) | applies pending drizzle migrations (no-op when current) |
| `seed` | `portalops db seed` (local dispatch → `db:seed`) | system rows: bootstrap `standard` tier + connector definitions |
| `tier-apply` | `portalops tier apply` | catalog tiers + env-local Stripe price ids (fail-closed on a missing price) |
| `e2e-org` | apps/api `db:seed:org --name e2e-fixture --member-email <email>` | only with `--e2e-org`; otherwise reported `skipped` |

`--e2e-org [member-email]`: an explicit value wins; a bare flag defaults from `E2E_AUTH0_USERNAME` in the process env; neither present → usage error (**exit 2**) before any step runs. The member user must already exist — it is created on the test user's first login (`e2e:auth`, see `packages/e2e/README.md`), which stays a separate step because it is interactive by nature.

Shell prerequisites: `DATABASE_URL` (the local env connection) and `STRIPE_SECRET_KEY` (the tier step — missing key fails that step `ENV_NOT_CONFIGURED`, exit 3; a key whose account lacks a declared lookup key's price fails it `TIER_APPLY_MISSING_PRICES`, exit 8).

`--json`: `{ "steps": [{ "name": "migrate"|"seed"|"tier-apply"|"e2e-org", "status": "ok"|"skipped"|"failed", "result"?: {…}, "error"?: { "code", "message" } }] }`

> **Failure shape — a deliberate deviation.** Every other command emits either a payload or the `{"error":{…}}` envelope. Here a mid-run step failure emits the **steps payload** — earlier steps' results intact, the failed step carrying its `{code,message}` — and the process exit code is mapped from that code (e.g. a missing Stripe price exits 8 with the migrate + seed results still on stdout). For this command, branch on `steps[].status`, not on the envelope.

Idempotent: safe to re-run against an already-provisioned local DB (each delegated step already is; a converged re-run reports every step `ok` with `tier-apply` all-noop). Audits one `local provision` line; the seed and tier-apply steps also audit individually.
