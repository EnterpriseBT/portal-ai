# Rotation-proof database credentials — Spec

**Issue:** [EnterpriseBT/portal-ai#500](https://github.com/EnterpriseBT/portal-ai/issues/500) · **Discovery:** `docs/DB_SECRET_ROTATION.discovery.md`

Pins the contract for surviving the RDS-managed master-password rotation without restarts: a TTL-cached, single-flight, fail-open **password resolver** wired into the postgres-js pool via its dynamic-password option; the ECS task-role grant + env var that feed it; and the cli-env switch to composing connection strings live from the master secret.

## Key decisions (flag for review)

1. **D1 — runtime resolution, verified feasible:** `postgres` (installed types, `node_modules/postgres/types/index.d.ts:359`) accepts `password?: string | (() => string | Promise<string>)`, evaluated per new connection; and options passed alongside a URL override the URL's parts. So `client.ts` keeps `postgres(environment.DATABASE_URL, {...})` and adds one `password` option — no URL-parsing rewrite.
2. **Staleness bound, refined from discovery:** postgres-js exposes no global connection-error hook, so invalidate-on-auth-failure becomes: TTL-bounded cache (**5 min** default) + an exported `invalidateDbPassword()` called from `connectDatabase`'s failure path. Accepted residual: after a rotation, at most one TTL window of new-connection failures per task (~5 min once a week, self-healing) — versus 7 days today.
3. **Fail-open:** resolver failure (Secrets Manager unreachable, bad JSON) returns last-known-good, else the URL's embedded password, with a structured warn — a stale password is the status quo, never a new outage. Cost/safety: bounded by the TTL; a *deliberately revoked* credential is not enforced faster than the TTL, accepted.
4. **CLI composes live** (`db tunnel`/`psql`); `database-url` is demoted to a bootstrap artifact (still injected for host/user/dbname; its password is non-authoritative). `getDatabaseUrl` is deleted, not aliased (clean-cut rule).
5. **No deep DB health check** — deliberate rejection carried from discovery (ALB health gating on DB converts a DB blip into a restart storm). Detection = the two structured warns.
6. **Both envs**: app-dev and prod share the wiring and the bug; rollout covers both, and app-dev hosts the forced-rotation smoke.

## Scope

### In scope
1. `apps/api`: password resolver util + pool wiring + env vars + `@aws-sdk/client-secrets-manager` dep.
2. `infra/cloudformation/backend.yml`: task-role Secrets Manager grant + `DB_MASTER_SECRET_ARN` env import.
3. `packages/cli-env`: `composeDatabaseUrl()` + `connection.db()` switch; `packages/devops-cli`: `dbUrl` delegates to it.
4. Docs sync: `docs/PROD_PROVISIONING.runbook.md` §10 note + `docs/DEPLOYED_ENV_CONFIG.md` row for the new env var.

### Out of scope
- Least-privilege application DB user; alerting/alarms on the new warns; #496's 500-vs-503 nit; disabling managed rotation (rejected).

## Surface

### `apps/api/src/db/credentials.util.ts` (new)

```ts
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

export interface DbPasswordResolverOptions {
  /** ARN of the RDS-managed master secret. Absent ⇒ resolver is a constant
   *  (local/dev/test unchanged). */
  masterSecretArn: string | undefined;
  /** The DATABASE_URL's embedded password — the fail-open floor. */
  fallbackPassword: string;
  ttlMs?: number;              // default 300_000; env-overridable
  client?: SecretsManagerClient; // injected in tests
}

export interface DbPasswordResolver {
  /** The function handed to postgres-js `password`. Cached ≤ ttl, single-flight. */
  resolve(): Promise<string>;
  /** Drop the cache; next resolve() fetches. Called on boot-connect failure. */
  invalidate(): void;
}

export function createDbPasswordResolver(opts: DbPasswordResolverOptions): DbPasswordResolver;
```

Behavior contract (what the tests assert):
- No `masterSecretArn` → `resolve()` returns `fallbackPassword`; the SDK client is **never constructed**.
- With ARN: first `resolve()` fetches (`GetSecretValueCommand`), parses `{ username, password }` JSON, caches `password`; repeat calls within `ttlMs` do **not** re-fetch; past TTL re-fetches.
- **Single-flight:** N concurrent `resolve()` during a fetch → exactly one SDK call.
- **Fail-open:** fetch throws or JSON lacks `password` → warn (`logger` module `db-credentials`, fields `{ secretArn, cause }`) and return last-known-good, else `fallbackPassword`. Never throws.
- Successful re-fetch that *changed* the password logs warn `rotation absorbed` (the weekly heartbeat; a burst = fetch trouble).
- `invalidate()` clears cache + last-known-good is retained as fallback.

### `apps/api/src/db/client.ts` (edit)

Current pool (`client.ts:15-19`) gains one option; everything else (`db`, `reserveConnection`, `connectDatabase`, `closeDatabase`) keeps its exact signature:

```ts
const passwordResolver = createDbPasswordResolver({
  masterSecretArn: environment.DB_MASTER_SECRET_ARN,
  fallbackPassword: new URL(environment.DATABASE_URL).password
    ? decodeURIComponent(new URL(environment.DATABASE_URL).password) : "",
  ttlMs: environment.DB_PASSWORD_CACHE_TTL_MS,
});
const connection = postgres(environment.DATABASE_URL, {
  max: 10, idle_timeout: 20, connect_timeout: 10,
  password: () => passwordResolver.resolve(),   // overrides the URL's password per new connection
});
```

`connectDatabase()` catch path calls `passwordResolver.invalidate()` before rethrowing (boot retry surface).

### `apps/api/src/environment.ts` (edit)

Add after `DATABASE_URL` (`environment.ts:21`):

```ts
DB_MASTER_SECRET_ARN: process.env.DB_MASTER_SECRET_ARN,           // absent locally
DB_PASSWORD_CACHE_TTL_MS: process.env.DB_PASSWORD_CACHE_TTL_MS
  ? Number(process.env.DB_PASSWORD_CACHE_TTL_MS) : undefined,
```

Dep: `@aws-sdk/client-secrets-manager` added to `apps/api/package.json` (sibling of the existing S3/SSM clients).

### `infra/cloudformation/backend.yml` (edit)

1. Container `Environment` (beside the `REDIS_URL` ImportValue precedent): `DB_MASTER_SECRET_ARN` ← `!ImportValue ${Environment}-DbMasterSecretArn` (export exists, `database.yml:118-125`). Plain env — an ARN is an identifier, not a secret. No new stack Parameter.
2. **Task role** policy (the S3/SSM statement block): add, mirroring the execution role's `rds!` grant (`backend.yml:287-305`) with the same comment style:
   ```yaml
   - Effect: Allow
     Action: [secretsmanager:GetSecretValue]
     Resource: !Sub "arn:${AWS::Partition}:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:rds!*"
   ```

### `packages/cli-env/src/aws.ts` + `connection.ts` (edit)

- `aws.ts`: new `composeDatabaseUrl(def, opts?: { dbName?: string; sslMode?: string }): Promise<string>` — the compose logic lifted from `devops-cli/src/commands/db.ts:105-160` (resolve `${envName}-DbEndpoint` / `-DbPort` / `-DbMasterSecretArn` exports, `getSecretByArn`, JSON-parse `{username,password}`, percent-encode both halves, `postgresql://…?sslmode=require` default). **Delete `getDatabaseUrl`** (`aws.ts:151-153`) — its one consumer switches.
- `connection.ts` `db()` (`connection.ts:82`): `const dbUrl = await composeDatabaseUrl(def);` — tunnel/rewrite logic unchanged. Local (non-AWS) branch unchanged.
- `devops-cli/src/commands/db.ts`: `dbUrl()` delegates composition to `composeDatabaseUrl` (keeps its `--write` putSecret + audit + redaction behavior verbatim).

### Docs sync

- `docs/PROD_PROVISIONING.runbook.md` §10: note that `database-url` is bootstrap-only (host/user/dbname); password freshness comes from runtime resolution; the weekly repair loop is retired.
- `docs/DEPLOYED_ENV_CONFIG.md`: add `DB_MASTER_SECRET_ARN` (plain, CFN-imported, required in AWS envs).

## Migration / Seed

None — no schema change.

## TDD test plan

### `apps/api` — `npm run test:unit` · new `src/__tests__/db/credentials.util.test.ts`

1. No ARN → returns fallback; SDK never constructed (constructor spy).
2. Fetch + parse `{username,password}`; caches — second call within TTL: no second SDK send.
3. TTL expiry → re-fetch; changed password logs `rotation absorbed` warn.
4. Single-flight: 5 concurrent `resolve()` → exactly 1 send.
5. Fetch throws → warn + last-known-good returned; first-ever fetch throws → fallback returned; never rejects.
6. Secret JSON missing `password` → treated as failure (case 5 path).
7. `invalidate()` → next resolve re-fetches; last-known-good still served if that re-fetch fails.
8. TTL override honored (`ttlMs` from options).

### `apps/api` — `npm run test:integration` · new `src/__tests__/__integration__/db/dynamic-password.integration.test.ts`

9. A `postgres()` pool built with a **wrong** URL password + `password` fn returning the correct one executes `SELECT 1` (proves the option overrides the URL per connection — the load-bearing postgres-js behavior, pinned against upgrades).
10. Same pool with the fn returning a wrong password fails with password-auth error (`28P01`) — proves the fn is actually consulted.

### `packages/cli-env` — `npm run test:unit` (extend existing suites)

11. `composeDatabaseUrl` composes `postgresql://user:pass@host:port/portal_ai?sslmode=require` from mocked exports + secret; both halves percent-encoded (password containing `@:/#?` round-trips).
12. Missing export / non-JSON master secret → `EnvInfraError` with the actionable message (behavior lifted from `dbUrl`, re-pinned at its new home).
13. `resolveEnvConnection().db()` (AWS env, mocked) uses `composeDatabaseUrl` — `getDatabaseUrl` is gone (import absence is compile-time; the test pins the compose call).

### `packages/devops-cli` — `npm run test:unit` (extend `db`/parity suites)

14. `db url` output unchanged in shape (redacted unless `--write`) — now via the shared compose.
15. Guard (in `deploy-parity.test.ts` if it reads `backend.yml`, else a small new yaml-pin test): the task definition injects `DB_MASTER_SECRET_ARN` and the task role grants `secretsmanager:GetSecretValue` on `secret:rds!*` — the two infra lines the app silently depends on.

**Totals ≈ 15 cases** (8 unit resolver, 2 integration, 3 cli-env, 2 devops-cli/parity). No migration test (no migration).

## Acceptance criteria

- [ ] All new cases pass; root `lint` / `type-check` / suites green.
- [ ] **Forced-rotation smoke (app-dev):** `aws secretsmanager rotate-secret` on app-dev's `rds!` secret → within one TTL window the app serves DB-backed endpoints on fresh connections **without any restart**, logging one `rotation absorbed` warn; `portalops db psql --env app-dev` works immediately with no `db url --write`.
- [ ] Local dev (`DATABASE_URL` only, no ARN) boots and queries with zero behavior change and zero AWS SDK traffic.
- [ ] Prod: the **2026-09-08** natural rotation passes without incident (site-config stays 200; no manual repair) — the ticket's closing observation.
- [ ] `db tunnel`/`db psql` authenticate with the current password in all AWS envs regardless of when `db url --write` last ran.
- [ ] Runbook + deployed-env-config docs describe the new contract (docs-sync rule).

## Risks & rollback

| Risk | Mitigation |
|---|---|
| postgres-js changes password-fn semantics in an upgrade | Integration cases 9–10 pin the behavior; a breaking upgrade fails CI, not prod. |
| Secrets Manager throttling/outage at connect time | Fail-open to last-known-good/fallback + warn; TTL caps call volume (~1/task/5min worst case). |
| `!ImportValue` couples backend stack to database stack export | Export exists since #384 and deploy workflows already order database → backend; a missing export fails the *deploy*, loudly, not runtime. |
| Fail-open blunts deliberate credential revocation | Accepted + recorded: revocation takes effect within one TTL for new connections (old sessions were never killed by rotation anyway). |
| Boot during rotation window with a just-rotated secret | Boot fetch returns the current password (managed rotation is single-user strategy — the secret is authoritative the moment it rotates); `connectDatabase` retry path invalidates and re-fetches. |

**Rollback:** revert the branch — the app returns to URL-only credentials and the documented weekly manual repair (`db url --write` + forced deployment) resumes as the operating procedure. No data or schema exposure in either direction.

## Files touched

- **New:** `apps/api/src/db/credentials.util.ts`, `apps/api/src/__tests__/db/credentials.util.test.ts`, `apps/api/src/__tests__/__integration__/db/dynamic-password.integration.test.ts`.
- **Edit:** `apps/api/src/db/client.ts`, `apps/api/src/environment.ts`, `apps/api/package.json` (+`@aws-sdk/client-secrets-manager`), `infra/cloudformation/backend.yml`, `packages/cli-env/src/aws.ts`, `packages/cli-env/src/connection.ts`, `packages/devops-cli/src/commands/db.ts`, cli-env/devops-cli test suites, `docs/PROD_PROVISIONING.runbook.md`, `docs/DEPLOYED_ENV_CONFIG.md`.

## Next step

`docs/DB_SECRET_ROTATION.plan.md` — four TDD slices on this branch: (1) the resolver util (cases 1–8), (2) pool wiring + integration pins (9–10) + env vars + dep, (3) cli-env compose-live + devops-cli delegation (11–14), (4) CFN grant/env + parity guard (15) + docs sync; then app-dev deploy + forced-rotation smoke, prod deploy before 2026-09-08.

## Implementation addendum (slice 4)

Two contract refinements surfaced during implementation, both additive:

1. **`--db-name` passthrough on the connect commands.** Composing live hardcoded `portal_ai`, which broke the §10 bootstrap (the maintenance DB must be reachable before `portal_ai` exists — previously done by temporarily re-pointing the stored copy, a path psql no longer reads). `EnvConnection.db(opts?: { dbName?: string })` + `db tunnel`/`db psql --db-name <name>` restore it; runbook §10 and COMMANDS.md rewritten to the simpler two-step bootstrap.
2. **Env-var documentation landed in `.env.example` + the runbook appendix, not `DEPLOYED_ENV_CONFIG.md`** — the #382 parity guard requires every `environment.ts` key to appear in `.env.example` (CI caught the omission), so both new vars are documented there as commented AWS-only/tunable entries; `DEPLOYED_ENV_CONFIG.md` itself (a design doc about the tier structure) needed no edit.
