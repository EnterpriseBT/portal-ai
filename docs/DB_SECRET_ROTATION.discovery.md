# Rotation-proof database credentials — Discovery

**Issue:** [EnterpriseBT/portal-ai#500](https://github.com/EnterpriseBT/portal-ai/issues/500)

**Why this exists.** The RDS-managed master password (`ManageMasterUserPassword: true`, `database.yml:89`) auto-rotates every 7 days on AWS's fixed managed schedule — there is no rotation-schedule knob and no hook configured. Every consumer of that credential holds a **point-in-time copy**: the app's `DATABASE_URL` is injected at ECS task start from the statically-composed `portalai/<env>/database-url` secret (`backend.yml:571-573`), and `portalops db tunnel`/`db psql` read the same stored secret (`cli-env/src/aws.ts:151-153` → `connection.ts:82`). After each rotation (last: 2026-09-01; next: **2026-09-08**), existing pool connections survive while every *new* connection fails password auth — the app looks healthy (the ALB health check is shallow, `health.router.ts` never touches the DB) while request paths needing a fresh connection 500. This was #496's actual root cause. This is the fix that makes DB credentials rotation-proof instead of rotation-raced.

## The current shape

### Credential flow (all point-in-time copies)

| Piece | Location | Note |
|---|---|---|
| RDS-managed master secret (`rds!db-…`) | `database.yml:89` (`ManageMasterUserPassword`), ARN exported `${Environment}-DbMasterSecretArn` (`database.yml:118-125`, #384) | The one always-current source; rotates every 7 days, schedule not configurable |
| Composed copy | `portalai/<env>/database-url` secret; recomposed only manually via `portalops db url --write` (`devops-cli/src/commands/db.ts:105-182`) | Stale from the first rotation after write |
| App injection | `backend.yml:571-573` `Secrets: DATABASE_URL ← SecretArnDatabaseUrl` (param `:64-66`; deploy passes ARN, `deploy-prod.yml:240`) | Injected **once at task start** |
| App pool | `apps/api/src/db/client.ts:15-19` — `postgres(environment.DATABASE_URL, { max: 10, idle_timeout: 20 … })`, singleton at module load; `environment.ts:21` freezes the URL at boot | **No seam** to swap credentials or recreate the pool; boot `SELECT 1` (`client.ts:47`, `index.ts:39`) proves only the moment of boot |
| CLI | `db tunnel`/`db psql` read the stored copy; `db url` composes live from the master secret | The CLI already contains the correct compose logic (`db.ts:116-136`) — used only on demand |

### IAM / SDK groundwork (what a fix can lean on)

- The task **execution** role already reads `secret:rds!*` (`backend.yml:287-305`) — boot-time injection from the master secret is IAM-ready today.
- The task **role** (runtime identity) has **no** Secrets Manager grant (`backend.yml:333-362`: S3 + SSM only) and `apps/api` has no `@aws-sdk/client-secrets-manager` dep — runtime resolution needs both added.
- Precedent for TTL-cached runtime AWS reads existed (an earlier `SSMClient` pattern); nothing wired today.

## The design space

### Decision 1 — App credential strategy

- **A. Runtime password resolution per new connection.** Keep injecting `DATABASE_URL` exactly as today (host/port/user/dbname stay valid forever; only the password rotates), but construct the pool with postgres-js's `password`-as-async-function option: each **new** connection resolves the current password from the `rds!` master secret via a TTL-cached fetch, invalidated on a password-auth failure (single-flight). Rotation becomes a non-event: old connections keep working, new ones fetch the new password. No CFN task-def change, no deploy-workflow change; needs the task-role grant + SDK dep + `client.ts` change. Local/dev unaffected: strategy activates only when a master-secret ARN is present in the environment.
- **B. Boot-time JSON-key `ValueFrom` from the `rds!` secret.** Change the task def to inject username/password via JSON-key extraction (execution role already permitted). Removes the stale-copy secret from the app path — but injection is still **at task start**, so a task older than the last rotation still breaks for new connections until restarted. Fixes deploys and repairs, not the running-task degradation that is the actual incident.
- **C. Rotation hook.** EventBridge rule on the secret's `RotationSucceeded` → Lambda that recomposes `database-url` (reusing `dbUrl()`'s logic) and forces a new ECS deployment. Keeps all current wiring; adds a Lambda + rule per env, a forced restart every 7 days, and a new failure mode (hook silently broken = back to today).
- **D. Turn off managed rotation** (`ManageMasterUserPassword: false`, self-managed static password). One-line CFN change plus password plumbing; abandons rotation hygiene and re-introduces a hand-carried prod password — the thing #384 built `db url` to avoid.

| | A runtime resolve | B JSON-key inject | C rotation hook | D disable rotation |
|---|---|---|---|---|
| Heals running tasks without restart | **Yes** | No | Via forced restart | N/A (no rotation) |
| Infra change | task-role grant only | task-def + workflow | Lambda + rule + perms | database.yml + password mgmt |
| App change | `client.ts` + dep | none | none | none |
| New failure mode | secret fetch at connect (cached, fail-open to last known) | unchanged from today | hook rot | static credential risk |
| Security posture | keeps managed rotation | keeps | keeps | **downgrades** |

**Lean: A.** It is the only option that fixes the actual incident (a *running* task surviving rotation), it keeps managed rotation, and its blast radius is one file plus an IAM statement. B is strictly weaker for more churn; C automates the workaround rather than removing the problem; D trades away security to avoid a small code change.

### Decision 2 — The CLI path and the fate of `database-url`

`db tunnel`/`db psql` fail identically after rotation because `resolveEnvConnection().db()` reads the stored copy. The compose-live logic already exists in the same package family.

- **A. CLI composes live** — `cli-env`'s AWS db path resolves the master secret + endpoint exports (the `dbUrl()` logic moves down into `cli-env`), and the stored `database-url` secret is **demoted to a bootstrap artifact**: still written by `db url --write` (ECS still injects it for host/user/dbname), but nothing depends on its password being fresh, so the weekly repair disappears.
- **B. Keep CLI on the stored copy** and rely on operators re-running `db url --write` after rotations — today's manual loop, permanently.

**Lean: A.** One compose function, two consumers; the staleness class disappears for operators and app alike.

### Decision 3 — Detection: make the failure loud if it ever recurs

The shallow health check hid this for two days. Options: deepen `/api/health` to touch the DB (risks ALB flapping the service on transient DB pressure — the health check gates task replacement), vs. a lighter signal: log + count password-auth failures and re-fetch events in the pool's error path.

**Lean: the light signal.** Structured warn on every credential re-fetch (they should be ~weekly; a burst means the fetch itself is failing) and on `28P01` auth failures. Deep health stays out — coupling task replacement to DB reachability converts a DB blip into a rolling restart storm; recorded as a deliberate rejection.

## Tradeoff comparison

| | D1: runtime resolve | D2: CLI composes live | D3: log-based detection |
|---|---|---|---|
| Spread to spec | Yes (pool option, cache, IAM, dep) | Yes (cli-env function move) | Yes (log fields only) |

## Recommendation

1. Rebuild the app pool on postgres-js's dynamic-password option: password resolved per new connection from the `rds!` master secret (ARN supplied via a new plain env var from the `DbMasterSecretArn` export), TTL-cached (~5 min), single-flight, invalidated on password-auth failure; falls back to the URL's embedded password when no ARN is configured (local/dev unchanged).
2. Grant the ECS **task role** `secretsmanager:GetSecretValue` on `secret:rds!*` (mirroring the execution role's existing statement) and add `@aws-sdk/client-secrets-manager` to `apps/api`.
3. Move the compose-live logic into `cli-env` so `db tunnel`/`db psql` always authenticate with the current password; `db url --write` remains for bootstrap and the ECS host/user/dbname injection, documented as non-authoritative for the password.
4. Log (warn, structured) every runtime credential re-fetch and every `28P01` auth failure; no deep health check (deliberate rejection — see Decision 3).
5. Apply to **both** app-dev and prod (both databases use `ManageMasterUserPassword`; app-dev has been silently living the same 7-day cycle).
6. If the implementation cannot merge before **2026-09-08**, run the documented manual repair on that date (`db url --write` + forced deployment) — the deadline pressures sequencing, not design.

## Open questions

1. **Does postgres-js accept an async `password` function?** The design hinges on it. Lean: yes (documented option; functions are evaluated per connection) — spec slice 1 verifies with a failing-first test; the fallback is an explicit pool-recreation seam behind the same resolver, same contract, more code.
2. **Where does the master-secret ARN reach the app?** Lean: a plain CFN task-def env var (`DB_MASTER_SECRET_ARN: !ImportValue ${Environment}-DbMasterSecretArn` equivalent via parameter) — it's an identifier, not a secret; SSM would work but adds a hop.
3. **Fetch failure while the cache is cold (task boot during a Secrets Manager outage)?** Lean: fail open to the URL's embedded password (it's usually still valid — rotation is weekly), warn loudly; boot's `SELECT 1` still gates a truly-dead credential pair.
4. **Should the `rds!` secret's `username` also be resolved at runtime?** Lean: no — the master username never rotates (`database.yml:88`); password-only keeps the URL parse trivial.

## Enterprise-scale considerations

- **Concurrency & correctness** — Lean: single-flight the re-fetch (concurrent new connections during a rotation must not stampede Secrets Manager); the cache is per-process, which is correct — each task heals independently.
- **Accuracy & auditability** — Lean: re-fetch warns are the audit trail of rotations being absorbed; Secrets Manager access is CloudTrail-logged. N/A beyond that — no billing/data records involved.
- **Failure modes** — Lean: fail-open to the last-known/embedded password with a loud warn (a stale password is the status quo, not a new risk); the fetch path never takes the request down — a failed resolve surfaces as the same auth error we have today, now logged with cause.
- **Scale & unbounded growth** — Lean: TTL cache bounds Secrets Manager call volume to ~1 per task per TTL; N/A otherwise.
- **Multi-tenancy** — N/A because the credential is infrastructure-wide, not per-org.
- **Contract stability** — Lean: `DATABASE_URL` stays the public contract (local dev, tests, CLI unchanged); the resolver is additive and keyed on one new env var, so future per-service DB users (least-privilege app user, #397's spirit) plug into the same seam.
- **Data lifecycle** — N/A; no stored data changes.

## What this doesn't decide

- A least-privilege **application DB user** (separate from the master user) — the right end-state, but a schema/permissions project of its own; the resolver seam built here serves it later.
- Deep DB-touching health checks — deliberately rejected (Decision 3), not deferred.
- Alerting infrastructure (CloudWatch alarms on the new warn logs) — worth doing when an alerting story exists; the structured logs are shaped for it.
- #496's residual 500-vs-503 status nit — stays on #496.

## Next step

`docs/DB_SECRET_ROTATION.spec.md` pins the resolver contract (option shape, cache/single-flight semantics, env var name, fallback rules, log fields), the IAM statement, and the cli-env compose-live function signature; `docs/DB_SECRET_ROTATION.plan.md` slices roughly: (1) resolver + pool option in `client.ts` with unit tests (including the postgres-js option verification), (2) cli-env compose-live + `db tunnel`/`psql` switch, (3) CFN task-role grant + env var + deploy-workflow parameter, (4) rollout to app-dev then prod + smoke (observe a forced rotation or the 2026-09-08 natural one absorbed without incident).
