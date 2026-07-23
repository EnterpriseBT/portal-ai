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
| mutation (`vars set/apply`, `db seed`) | — | `--yes` | `--yes --confirm-prod` |
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

---

## db

### `portalops db tunnel --env <env> [--local-port <n>] [--confirm-prod]`
Connect. Opens the env's DB path — `local`: prints the `.env` connection string; AWS envs: SSM port-forward via the bastion (default local port 15432). Prints a `psql` hint on stderr and **stays attached** until Ctrl+C (signal hooks close the tunnel; no orphaned plugin).

### `portalops db psql --env <env> [--confirm-prod] [-- <psql args…>]`
Connect. psql against the env connection. No extra args → interactive REPL (inherited stdio). Args after `--` pass through for one-shot use:
```
portalops db psql --env app-dev -- -tAc "select 1"
```
Exits with psql's own exit code. Missing psql binary → exit 7 with install guidance.

### `portalops db reset --env <env> --yes [--json]`
**Destructive** (never production). The infra reset: `DROP TABLE "er__…" CASCADE` for dynamic wide tables, one `TRUNCATE … CASCADE` for everything else, `__drizzle_migrations` untouched. Works for `--env local` (`.env` DB).
`--json`: `{ "dropped": [string], "truncated": [string] }`

### `portalops db seed --env <env> --yes [--confirm-prod] [--json]`
Mutation. Runs `db:seed:ci` as a FARGATE one-off ECS task in the env's cluster (live service network config + task definition; waits for completion; non-zero container exit → exit 7 naming CloudWatch). **AWS envs only** — `--env local` exits 3 pointing at `npm run db:seed` (apps/api).
`--json`: `{ "taskArn", "exitCode": 0 }`

### `portalops db reset-seed --env <env> --yes [--json]`
**Destructive** (never production). `reset` then `seed`, in that order.
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
