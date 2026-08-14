# Production vendor tenants & config provisioning — Spec

Pins the contract for [#384](https://github.com/EnterpriseBT/portal-ai/issues/384) (child of epic [#83](https://github.com/EnterpriseBT/portal-ai/issues/83)): the `prod` registry entry, the `portalops db url` subcommand, the CloudFormation export it reads, and the exact value + source of all 24 catalog keys. Design rationale is in [`PROD_VENDOR_PROVISIONING.discovery.md`](./PROD_VENDOR_PROVISIONING.discovery.md).

## Verified against live AWS (2026-08-14)

Checked in account `028987315524` (`us-east-1`) before pinning the contract. Four things the repo could not tell us:

- **The database is named `portal_ai`, and RDS did not create it.** `describe-db-instances` reports `DBName: null` (the template sets no `DBName`, `database.yml:60-82`), yet dev's `database-url` is `…/portal_ai?sslmode=require`. **Nothing in this repo creates that database** — `grep -rn "CREATE DATABASE"` across `packages/`, `apps/api/src/db/`, `infra/` and `.github/workflows/` finds only the integration-test harness. It was created by hand on dev, is written down nowhere, and `db:migrate:ci` will fail on prod without it. See "The database-creation gap" below.
- **`sslmode=require` is part of the connection string** on dev. A composed URL must carry it.
- **The RDS-managed master secret exists and holds `{username, password}`**, `username: portalai` — so the proposed `MasterUserSecret.SecretArn` export works and the composition is a two-field read.
- **Export names confirmed:** `dev-DbEndpoint`, `dev-DbPort`, `dev-BastionInstanceId` are live; there is **no** `dev-DbMasterSecretArn`, confirming the output below is a genuine addition.

Also resolved, closing discovery's open questions:

- **OQ1 (operator IAM reach) — no scoping exists.** The operator identity is `arn:aws:iam::028987315524:user/Admin`, a full-admin IAM **user**, not a scoped role. So prod paths are reachable and this ticket is unblocked — but the premise that a scoped operator role gates prod access is false today. Recording it here rather than fixing it: a least-privilege operator role is real work with its own blast radius and belongs in its own ticket, not smuggled into a provisioning child.
- **`portalai/prod/*` and `/portalai/prod/*` are completely empty** (0 secrets, 0 parameters) — the fresh-environment assumption holds.
- **Dev is missing `github-dispatch-token` at the AWS layer too**, not just as a GitHub Actions secret: dev has 11 of 12 secrets and all 12 SSM parameters. Decision 6 therefore writes `portalai/dev/github-dispatch-token` as well as the repo secret.

## Key decisions (flag for review)

1. **The `prod` registry entry lands here, not in #387.** Overrides force `kind: "development"` and cannot shadow a built-in (`registry.ts:109-118`), so there is no way to reach prod except in code — and reaching it via an override would run every production write with *no* guards.
2. **Prod values are written per-key from stdin** (`vars set KEY -`), never via `vars template` / `vars apply`. `template` re-run against a populated environment writes every live secret to disk in plaintext.
3. **`portalops db url` composes the database credential** so the production DB password moves AWS-API-to-AWS-API and is never rendered to a human.
4. **`NAMESPACE=portalsai-prod` and a freshly generated `SYSTEM_ID`.** Both seed deterministic uuidv5 generation and are **write-once** — changing either after prod holds data orphans existing ids.
5. **Google and Microsoft OAuth clients are per-environment**, mirroring Auth0 and Stripe. No credential is shared across environments.
6. **The dev `GITHUB_DISPATCH_TOKEN` is provisioned here too**, so production is not the first place the site-rebuild dispatch path ever executes.
7. **This ticket interleaves with #383.** `DATABASE_URL` cannot be written until the prod database stack exists; every other key can be written before it.
8. **The `portal_ai` database must be created by hand before migrations run**, and the runbook owns that step (see below). This is not a new requirement — it is an existing undocumented one that only surfaced because prod is the second environment.

## Scope

### In scope

- The `prod` entry in `BUILTIN_ENVIRONMENTS` and its guard tests.
- `portalops db url --env <env> [--write]`, plus the two `cli-env` helpers and one CloudFormation export it needs.
- Provisioning the vendor accounts and all 24 prod catalog values (an operator act, specified here and stepped in the runbook).
- Provisioning `GITHUB_DISPATCH_TOKEN` in **app-dev** and proving the dispatch loop there.
- `docs/PROD_PROVISIONING.runbook.md` — re-runnable for any future environment, not a prod-only checklist.

### Out of scope

- The AWS stacks (#383), Stripe live mode (#385), `www` activation (#386), tier amounts (#325), live guard verification + the doc sweep (#387).
- Any schema change — **there is no migration and no seed change in this ticket.**
- A CLI secret *generator*; `openssl rand -base64 32` stays a runbook step (discovery OQ5).

## Surface

### `packages/cli-env/src/registry.ts`

Add to `BUILTIN_ENVIRONMENTS`, replacing the placeholder comment at `:57`:

```ts
prod: {
  name: "prod",
  kind: "production",
  apiBaseUrl: "https://api.portalsai.io",
  aws: { region: "us-east-1", envName: "prod" },
},
```

Derived automatically, no other change: `secretsPrefix` → `portalai/prod`, `ssmPrefix` → `/portalai/prod`, `clusterName` → `portalai-prod`, `bastionExportName` → `prod-BastionInstanceId`. Guard behavior follows from `kind: "production"` (`guard.ts:52-60`) with no new code.

### `packages/cli-env/src/aws.ts` — one new export

```ts
/** Secrets Manager by full ARN — for secrets outside our naming convention,
 *  e.g. the RDS-managed `rds!db-…` master credential. */
export async function getSecretByArn(
  def: EnvironmentDefinition,
  arn: string
): Promise<string>
```

Same client construction, `classify()` error handling and `EnvInfraError` semantics as `getSecret` (`aws.ts:78-97`). It does **not** compose a path — the ARN is passed through.

### `packages/cli-env/src/tunnel.ts` → promote export resolution

`resolveBastionInstanceId` (`tunnel.ts:42-56`) already resolves a CloudFormation export via `ListExportsCommand`. Extract its lookup into a reusable, exported helper and re-implement the bastion resolver on top of it — no behavior change:

```ts
/** Resolve one CloudFormation export by name, or throw ENV_NOT_CONFIGURED. */
export async function resolveExport(
  def: EnvironmentDefinition,
  exportName: string
): Promise<string>
```

### `infra/cloudformation/database.yml` — one new export

RDS mints the master password into its own secret (`ManageMasterUserPassword: true`, `:73`) whose ARN is not currently exported. Add it beside the existing outputs (`:85-98`):

```yaml
  DbMasterSecretArn:
    Value: !GetAtt DBInstance.MasterUserSecret.SecretArn
    Export:
      Name: !Sub "${Environment}-DbMasterSecretArn"
```

Purely additive — a new output on an existing stack. Landing it updates the **dev** database stack first, which is how it gets proven before prod ever runs.

### `packages/devops-cli/src/commands/db.ts` — `dbUrl`

```ts
export interface DbUrlOptions extends MutateOptions {
  /** Database name. Defaults to `portal_ai` — dev's value, and the database
   *  an operator must CREATE by hand since the template sets no DBName.
   *  Pass `postgres` to reach the maintenance database during bootstrap. */
  dbName?: string;
  /** Appended as `?sslmode=<mode>`. Defaults to `require`, matching dev. */
  sslMode?: string;
  /** Write the composed value to the `database-url` secret. */
  write?: boolean;
}

export interface DbUrlResult {
  /** Password redacted as `***` unless `write` was requested. */
  connectionString: string;
  endpoint: string;
  port: number;
  written: boolean;
  /** True when a NEW secret was created (its ARN must reach the workflow). */
  created: boolean;
}

export async function dbUrl(
  def: EnvironmentDefinition,
  opts: DbUrlOptions = {}
): Promise<DbUrlResult>
```

Behavior, in order:

1. `resolveExport(def, "<envName>-DbEndpoint")` and `"-DbPort"`; `resolveExport(def, "<envName>-DbMasterSecretArn")`.
2. `getSecretByArn` on the master ARN → RDS's `{"username","password"}` JSON.
3. Compose `postgresql://<username>:<urlencoded password>@<endpoint>:<port>/<dbName ?? "portal_ai">?sslmode=<sslMode ?? "require">`, byte-compatible with dev's existing value.
4. **Read-only by default.** Without `--write` it returns the string with the password replaced by `***` and touches nothing. **The unredacted value is never printed** — `--write` is the only path to the real credential, and it goes to Secrets Manager.
5. With `--write`: `guardMutation(def, opts)` first — so prod requires `--yes --confirm-prod` — then `putSecret(def, "database-url", composed)`, then `recordAudit` with `{ command: "db url --write", endpoint, created }` and **never the value**.

`local` (`aws: null`) throws `ENV_NOT_CONFIGURED` through the existing `requireAws` path.

### `packages/devops-cli/src/bin.ts`

Register under the existing `db` command group (`bin.ts:176-239`), matching its siblings' flag and `--json` envelope conventions:

```
portalops db url --env <name> [--db-name <name>] [--ssl-mode <mode>] [--write] [--yes] [--confirm-prod] [--json]
```

`--write` is a mutation and inherits exit codes `5` (confirmation required) and `6` (destructive blocked) from the guard; the read-only form is not a mutation and needs no flags.

### The database-creation gap and its bootstrap sequence

`database.yml` sets no `DBName`, so RDS creates only the `postgres` maintenance database — yet the app connects to `portal_ai`. Dev's was created by hand and the step exists in no script, workflow or doc. Prod hits it the moment #383's `db:migrate:ci` task runs.

The awkwardness is that `portalops db tunnel` / `db psql` resolve their connection from the **`database-url` secret** (`connection.ts:27`, `aws.ts:126`), which does not yet exist — and cannot yet name `portal_ai`, which does not yet exist either. `db url` breaks the cycle because it composes from stack exports rather than from the secret. The runbook pins this exact order, using only existing tooling plus the new subcommand:

```bash
# 1. #383 deploys portalai-prod-database
# 2. Point database-url at the maintenance DB so psql has a way in
portalops db url --env prod --db-name postgres --write --yes --confirm-prod
# 3. Create the application database
portalops db psql --env prod --confirm-prod -- -c "CREATE DATABASE portal_ai"
# 4. Repoint database-url at the application database (the real value)
portalops db url --env prod --write --yes --confirm-prod
# 5. #383 deploys portalai-prod-backend, whose migrate task now succeeds
```

Step 2's value is deliberately transient. Two writes are acceptable: `putSecret` is idempotent, both are audited, and the alternative — teaching `db tunnel`/`db psql` a `--db-name` override — widens a connect path used every day to serve a bootstrap that happens once per environment. **DDL stays out of `db url`**; composing a connection string and creating a database are different responsibilities, and a config command that quietly runs `CREATE DATABASE` is a worse surprise than an extra documented step.

### The 24 prod catalog values

The contract for what gets provisioned. **Every value is prod-only; nothing is copied from dev.**

| Key | Kind | Prod value / source |
|---|---|---|
| `DATABASE_URL` | secret | `portalops db url --env prod --write` — **after #383's database stack, and after `CREATE DATABASE portal_ai`** (see the bootstrap sequence above) |
| `ENCRYPTION_KEY` | secret | `openssl rand -base64 32`, fresh |
| `OAUTH_STATE_SECRET` | secret | `openssl rand -base64 32`, fresh |
| `AUTH0_WEBHOOK_SECRET` | secret | `openssl rand -base64 32`, fresh; same value into the Auth0 post-login Action |
| `ANTHROPIC_API_KEY` | secret | prod key on its own workspace limit |
| `TAVILY_API_KEY` | secret | prod key, account plan/cap set |
| `GEOCODING_API_KEY` | secret | prod Mapbox token, scoped to geocoding, spend limit set |
| `GOOGLE_OAUTH_CLIENT_SECRET` | secret | prod-only Google client |
| `MICROSOFT_OAUTH_CLIENT_SECRET` | secret | prod-only Entra app registration |
| `STRIPE_SECRET_KEY` | secret | live restricted key — **value from #385** |
| `STRIPE_WEBHOOK_SECRET` | secret | live endpoint signing secret — **value from #385** |
| `GITHUB_DISPATCH_TOKEN` | secret | fine-scoped PAT (`repository_dispatch` on this repo) |
| `AUTH0_DOMAIN` | ssm | prod tenant domain |
| `AUTH0_AUDIENCE` | ssm | `https://api.portalsai.io` |
| `AUTH0_CLI_CLIENT_ID` | ssm | prod device-flow M2M app (#194) |
| `CORS_ORIGIN` | ssm | `https://app.portalsai.io` — **must be first in the list**; `billing.service.ts:29` derives checkout and portal return URLs from `CORS_ORIGIN[0]` |
| `GOOGLE_OAUTH_CLIENT_ID` | ssm | prod-only Google client |
| `MICROSOFT_OAUTH_CLIENT_ID` | ssm | prod-only Entra app |
| `MICROSOFT_OAUTH_TENANT` | ssm | `common` unless single-tenant is chosen |
| `NAMESPACE` | ssm | `portalsai-prod` — **write-once** |
| `SYSTEM_ID` | ssm | freshly generated — **write-once** |
| `SUPPORT_EMAIL` | ssm | `support@portalsai.io` |
| `SALES_EMAIL` | ssm | `sales@portalsai.io` |
| `ADMIN_EMAIL` | ssm | `admin@portalsai.io` |

Writing any of the last three fires the site-rebuild dispatch (`vars.ts:186-189`); against prod that runs `deploy-site-prod`, which early-exits while `PROD_SITE_CONFIG_URL` is unset. Harmless, and expected.

### `docs/PROD_PROVISIONING.runbook.md`

Ordered so each step's prerequisites already hold: vendor accounts → generated secrets → SSM config → contact addresses → **[#383 database stack]** → the four-step database bootstrap above → capture 12 ARNs into `PROD_SECRET_ARN_*` → **[#383 backend stack]**. Each secret's ARN is captured with `aws secretsmanager describe-secret --secret-id portalai/prod/<name> --query ARN --output text` feeding `gh secret set` (Decision 4 — runbook, not CLI).

## Migration / Seed

**None.** No Drizzle table, Zod model or seed data changes in this ticket. The only infrastructure change is one additive CloudFormation output.

## TDD test plan

### `packages/cli-env` — `npm run test:unit -w @portalai/cli-env`

`src/__tests__/registry.test.ts` (extend)
- `prod` resolves with `kind: "production"`, `apiBaseUrl` `https://api.portalsai.io`, `envName` `prod`.
- Derived names: `secretsPrefix` → `portalai/prod`; `ssmPrefix` → `/portalai/prod`; `clusterName` → `portalai-prod`; `bastionExportName` → `prod-BastionInstanceId`.
- An override named `prod` is **rejected** as shadowing a built-in — the property that makes the guards unbypassable.

`src/__tests__/guard.test.ts` (extend)
- Against the real `prod` definition: destructive → `EnvDestructiveBlockedError` (exit 6); mutation with `--yes` only → `EnvConfirmationRequiredError` (exit 5); with both flags → allowed.

`src/__tests__/aws.test.ts` (extend)
- `getSecretByArn` passes the ARN through unmodified as `SecretId` (no prefix composition).
- A missing secret classifies to `EnvInfraError`, matching `getSecret`.

`src/__tests__/tunnel.test.ts` (extend)
- `resolveExport` returns the value for a present export and throws `ENV_NOT_CONFIGURED` naming the export when absent.
- `resolveBastionInstanceId` still behaves identically after the extraction (regression pin).

### `packages/devops-cli` — `npm run test:unit -w @portalai/devops-cli`

`src/__tests__/db.test.ts` (extend)
- Composes `postgresql://user:pass@host:5432/portal_ai?sslmode=require` from mocked exports + master secret — the default shape, pinned byte-for-byte against dev's live value.
- `--db-name postgres` reaches the maintenance database (the bootstrap escape hatch); `--ssl-mode` overrides the query segment.
- A password containing `@ : / # ?` is URL-encoded — the case that silently produces an unusable string.
- **Default output redacts the password**; the unredacted value never appears in any returned field without `--write`.
- `--write` calls `putSecret` with `database-url` and reports `created`.
- `--write --env prod` without `--confirm-prod` → `EnvConfirmationRequiredError`; with both flags → proceeds.
- The audit record carries endpoint and `created` and **never** the password or the composed string.
- `local` (`aws: null`) → `ENV_NOT_CONFIGURED`.

`src/__tests__/deploy-parity.test.ts` (from #382, extend)
- The parity assertions run against the `prod` definition too, so a prod-only catalog gap is caught by the same guard.

### Not tested by unit tests

The CloudFormation output has no unit-test surface — it is verified by the app-dev database-stack deploy before prod uses it. Vendor-console provisioning is verified by the smoke checklist.

**Totals ≈ 20 cases** (10 `cli-env`, 10 `devops-cli`).

## Acceptance criteria

- `portalops vars list --env prod` shows **all 24 keys resolved** — no `(unset)`.
- `psql \l` against prod lists `portal_ai`, and #383's migrate task exits `0` on its first run rather than on a retry.
- `portalops db url --env prod` prints a connection string with the password redacted; the unredacted value exists only in Secrets Manager.
- A destructive op against prod exits `6`; `db url --write --env prod` without `--confirm-prod` exits `5`.
- `portalai login --env prod` completes the device flow.
- The prod ECS task starts with every secret and SSM parameter resolved (no `ResourceNotFoundException` in its stopped reason).
- Auth0 login works on `https://app.portalsai.io` and the post-login webhook verifies against the prod secret.
- Google Sheets and Microsoft Excel OAuth both round-trip against the prod callback URLs.
- A `geocode` call succeeds on prod **and** a `bulk_geocode_records` job completes — the only way to notice the Mapbox key, since its absence fails open.
- `support@`, `sales@` and `admin@portalsai.io` all deliver **before** their values are written.
- A `portalops vars set` of a `siteConfig` key in **app-dev** fires the dispatch and re-runs `deploy-site-dev` — the loop proven outside production.
- No dev credential appears in any `portalai/prod/*` path.
- Every mutating command appended a line to `~/.portalai/audit.log`, and no line contains a secret value.

## Risks & rollback

| Risk | Detection | Rollback |
|---|---|---|
| **Wrong `NAMESPACE` / `SYSTEM_ID`** — write-once; changing them after data exists orphans every deterministic id | Nothing detects it later; only review at write time does | None once data exists. Mitigation: both are pinned in this spec and the runbook states the consequence at the point of writing |
| **`CORS_ORIGIN` ordering** — a non-app origin first silently misdirects Stripe checkout returns | First live checkout returns to the wrong host | `vars set CORS_ORIGIN` + task restart |
| **Mapbox key absent or wrong** — fails **open**: geocode tools are silently not constructed, maps keep working | Only the explicit geocode acceptance check | `vars set GEOCODING_API_KEY` + task restart |
| **`portal_ai` never created on prod** — RDS creates only `postgres`, and nothing in the repo creates the app database | #383's `db:migrate:ci` task exits non-zero before the service rolls | Run the bootstrap sequence above, then re-run the deploy. Detected loudly, which is why it is a sequencing risk rather than a correctness one |
| **`db url --write` composes a wrong DB name or drops `sslmode`** | ECS task cannot connect; crash-loop on start | Re-run with `--db-name` / `--ssl-mode`. Mitigated by pinning the default against dev's live value in tests |
| **A vendor account has verification lead time** (Google consent screen, Stripe) | Discovered at submission | None — mitigated by starting both first, per the epic |

**Fail modes are deliberately split.** Missing config fails **closed** everywhere it can (the task will not start without a resolvable secret; `/api/public/site-config` 503s without contacts) — the one exception is Mapbox, which fails **open** by design so a keyless environment keeps maps, and is therefore the one that needs an explicit acceptance check rather than trusting a startup error.

## Files touched

- Edit: `packages/cli-env/src/registry.ts` — the `prod` entry
- Edit: `packages/cli-env/src/aws.ts` — `getSecretByArn`
- Edit: `packages/cli-env/src/tunnel.ts` — extract + export `resolveExport`
- Edit: `packages/cli-env/src/index.ts` — re-export both helpers
- Edit: `packages/devops-cli/src/commands/db.ts` — `dbUrl`
- Edit: `packages/devops-cli/src/bin.ts` — `db url` wiring
- Edit: `infra/cloudformation/database.yml` — `DbMasterSecretArn` output
- Edit: `packages/cli-env/src/__tests__/{registry,guard,aws,tunnel}.test.ts`
- Edit: `packages/devops-cli/src/__tests__/db.test.ts`
- New: `docs/PROD_PROVISIONING.runbook.md`

## Next step

`/plan 384` slices this into three testable commits on this branch: (1) the `prod` registry entry with its registry + guard tests — the unblocking change every sibling child waits on; (2) `resolveExport` + `getSecretByArn` + `dbUrl` + bin wiring + the `database.yml` output; (3) the runbook. The vendor-console and `vars set` work is not a commit — it is the runbook's content, executed by an operator and verified by `/smoke`.
