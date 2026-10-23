# ElastiCache encryption at rest + in transit — Discovery

**Issue:** [EnterpriseBT/portal-ai#852](https://github.com/EnterpriseBT/portal-ai/issues/852) · child of #578

**Why this exists.** The public `/security/` page (#613) claims encryption at rest only for the database, object storage and logs, and encryption in transit only at the edge. The reason is that our ElastiCache Redis has neither encryption mode, and the API talks to it over plain `redis://`. Redis holds BullMQ payloads (job metadata), the chunked workbook cache (uploaded spreadsheet cells), rate-limit windows and SSE pub/sub. Customer data therefore sits in it, private subnet or not. Enterprise buyers expect "encrypted at rest and in transit" without an asterisk.

Neither mode can be switched on in place for our resources, so this is a **replacement-cluster cutover** in two environments. It also touches every Redis client in the API, gives operators a runbook plus a `portalops` surface for the repeatable steps, adds an optional TLS knob to the Helm chart, and widens the public claim once both environments are done. This ticket replaces the Redis behind the job queue without losing a job, then lets the security page say so.

## The current shape

### Infrastructure

| Piece | Location | Note |
|---|---|---|
| Dev cache | `infra/cloudformation/cache.yml:79-93` | `AWS::ElastiCache::CacheCluster` named `portalai-${Environment}`, Redis 7.1, no encryption, port 6379 by default |
| Prod cache | `infra/cloudformation/cache.yml:98-116` | `RedisReplicationGroup` named `portalai-${Environment}`, 2 nodes, automatic failover, Multi-AZ, no encryption |
| Resource selector | `cache.yml:28,43-44` | `ReplicationEnabled` → `IsReplicated` / `IsSingleNode` |
| Security group | `cache.yml:59-76` | tcp 6379 open to the whole VPC CIDR (the comment says it will be narrowed later) |
| Exports | `cache.yml:120-136` | `${Env}-RedisEndpoint`, `${Env}-RedisPort` (each branches on the condition), `${Env}-CacheSecurityGroupId` |
| Stale comment | `cache.yml:19-23` | Says jobs have "no reconciliation"; #391 added it |
| Only consumer | `infra/cloudformation/backend.yml:602-608` | `REDIS_URL: !Sub "redis://${Endpoint}:${Port}"` as a plain env var on the single `api` container. Workers run in-process (:671) |
| Deploys | `deploy-dev.yml:176-182`, `deploy-prod.yml:170-180` | The cache stack deploys before backend in the same job. Prod passes `ReplicationEnabled=true SnapshotRetentionLimit=7` |

Three constraints from AWS behavior (to be confirmed against the docs during spec):

- `CacheCluster` has **no at-rest encryption property**, so dev must become a single-node `ReplicationGroup`.
- At-rest encryption can't be modified on an existing replication group.
- A resource with a fixed custom name can't be replaced by CloudFormation, and an export another stack imports can't change value.

So the encrypted cluster has to be a **new resource with a new name and new export names**, created side by side with the old one.

### Redis clients (API)

| Client | Location | Construction |
|---|---|---|
| Shared ioredis | `apps/api/src/utils/redis.util.ts:10-21` | `new Redis(environment.REDIS_URL, { maxRetriesPerRequest: null })` |
| BullMQ jobs queue / worker | `queues/jobs.queue.ts:27`, `queues/jobs.worker.ts:285` | `connection: { url, maxRetriesPerRequest: null }` (duplicated) |
| BullMQ maintenance queue / worker | `queues/maintenance.queue.ts:58`, `queues/maintenance.worker.ts:53` | same, duplicated |
| Pub/sub | `services/job-events.service.ts:42`, `routes/portal-events.router.ts:320` | `getRedisClient().duplicate()` |
| Rate limit / cost gate | `utils/rate-limit.util.ts:87-91` | shared client |
| Workbook cache | `services/workbook-cache.service.ts:108` | shared client |
| Readiness | `routes/health.router.ts:138-142` | shared client |
| Default URL | `apps/api/src/environment.ts:153` | `redis://localhost:6380` |

ioredis 5.11 parses `rediss://` into `tls: {}`. BullMQ 5.81 hands `url` straight to `new IORedis(url, rest)` (`bullmq/dist/cjs/classes/redis-connection.js:182-183`). So **TLS already follows the scheme**; no client sets `tls` explicitly today. Local `docker-compose.yml:38-51` runs a plaintext `redis:7-alpine` on 6380. Integration setup duplicates the connection options in `__integration__/queues/queue.util.ts:3-7`.

### Job durability

- **Enqueue** is two steps: insert the Postgres row, then `JobsService.dispatch` (`services/jobs.service.ts:109-125`), which calls `queue.add` and records `bullJobId`.
- **Maintenance schedulers** are idempotent `upsertJobScheduler` calls at boot (`queues/maintenance.queue.ts:90-125`), so they re-register against a fresh Redis on their own.
- **Reconciliation:** the Postgres row is the source of truth. `JobReconciliationService.sweepStrandedJobs` (`services/job-reconciliation.service.ts:22-80`, at boot and every 5 min) marks a row `failed` when BullMQ positively reports it absent **and** its heartbeat is older than `JOB_STRANDED_THRESHOLD_MS` (15 min).
- **No re-enqueue or pause:** reconciliation only reaps and never re-enqueues, and there is no enqueue-pause or maintenance switch. A naive cutover therefore turns every undrained row into a `failed` job, which is exactly what the acceptance criteria forbid.

### Operator CLI, Helm, public claims

- **`portalops`:** commands are registered with `common(...)` + `execute` in `packages/devops-cli/src/bin.ts:72-103`. `src/ecs.ts:45-111` `runOneOffTask` is the ECS pattern (`db seed`, `db upgrade`), and the guards live in `packages/cli-env/src/guard.ts:31`. No command scales a service or reads job/queue counts. `REDIS_URL` is deliberately not in the `vars` catalog: it's template-computed (`docs/PROD_PROVISIONING.runbook.md:397`).
- **Helm:** `deploy/helm/portalai/templates/_helpers.tpl:77-82` builds `redis://<release>-redis-master:6379` when Redis is bundled, else passes `redis.external.url` through verbatim (`values.yaml:140-154`, `README.md:46-47,72-73`). A `rediss://` external URL already works; nothing documents it, and there's no way to pin a CA.
- **Claims:** `apps/site/src/lib/security-controls.ts`:
  - `:8-9` says to widen only with #852.
  - `encryption-in-transit` (:30-54) covers the edge only, and `encryption-at-rest` (:56-70) covers DB / S3 / logs.
  - `FORBIDDEN_CLAIMS` (:204-217) holds "Redis".

  Tests at `apps/site/src/lib/__tests__/security-controls.test.ts:68-80,124-137` enforce the claims (one says "until #852 ships"). The privacy sentence is `apps/site/src/pages/privacy.astro:87`. `docs/AWS_CLI_OPS.md:71` lists the plain dev endpoint.

## The design space

### Decision 1 — How the encrypted cluster replaces the old one in CloudFormation

- **A. Flip flags on the existing resources.** Not possible: there's no at-rest property on `CacheCluster`, at-rest is immutable on a replication group, and the fixed names block replacement.
- **B. Rename the existing resources so CloudFormation replaces them.** CloudFormation creates the new resource, then deletes the old one in the same stack update, so the old cluster dies before anything has drained. The export value would also change while `backend.yml` imports it, which fails the update.
- **C. Side by side in `cache.yml`.** Add a new `EncryptedRedisReplicationGroup` (dev: 1 node, no failover; prod: 2 nodes, failover, Multi-AZ) named `portalai-${Environment}-tls`, with `AtRestEncryptionEnabled: true`, `TransitEncryptionEnabled: true` and the `TransitEncryptionMode: required` property, plus new exports (`${Env}-RedisTlsEndpoint` / `-RedisTlsPort`). Old and new coexist; `backend.yml` switches its imports at cutover; a follow-up stack change removes the old resource and its exports.

| | A | B | C |
|---|---|---|---|
| Feasible | No | Fails on the imported export | Yes |
| Drain before teardown | — | No | Yes |
| Stack changes | — | 1 | 3 (add → switch → remove) |
| Rollback | — | None | Re-point imports at the old cluster until it's removed |

**Lean: C.** It's the only option that keeps the old cluster alive through the drain and gives a real rollback. Dev's single-node shape becomes a one-node replication group, which also unifies the two branches of the condition.

### Decision 2 — Sequencing the three stack changes across deploys

The cache stack deploys on every push to `main` (dev) and on every release (prod). The add → switch → remove steps have to be gated so that a routine deploy can't switch over before the drain.

- **A. Three PRs.** Each merges when its step is ready. Prod would need three releases.
- **B. One PR with parameters.** `cache.yml` gains `RedisCutoverPhase` (`legacy` | `both` | `encrypted`), and `backend.yml` gains `RedisEndpointSource` (`legacy` | `encrypted`). The workflows read both values from repo/environment **variables** (`vars.REDIS_CUTOVER_PHASE`), not from code, so the operator moves an environment through the phases with the runbook and the code ships once. A later cleanup PR removes the legacy branch once both environments are on `encrypted`.

| | A | B |
|---|---|---|
| Prod release coupling | Three releases | One release; the phase moves per env |
| Risk of an accidental switch | Low | Low (a variable, not a merge) |
| Template complexity | Low | Conditions on both stacks, removed by cleanup |

**Lean: B.** Prod ships with the next gated release (the PRD), and a phase variable lets app-dev and prod each step through on their own schedule without more releases. The cleanup PR is small and mechanical.

### Decision 3 — Draining the queue without a pause switch

Workers live in the API process, so "stop enqueuing" and "stop serving" are the same lever unless we add one.

- **A. Wait for a quiet moment.** The operator watches the count of non-terminal rows reach zero, then switches. Anything enqueued in between is lost to the reap.
- **B. Server-side enqueue pause.** A flag makes `dispatch` refuse with a 503 while workers finish. This needs a new runtime switch (env var → redeploy, or a DB/SSM flag read per request) and a new user-visible error state on every job-starting surface.
- **C. Scale to zero, then re-dispatch from Postgres.** Steps:
  1. `portalops cache drain-status` reports non-terminal job rows (by status) and BullMQ counts until active work is zero.
  2. Scale the API service to 0.
  3. Switch `REDIS_URL` (backend stack, phase `encrypted`, still at 0).
  4. Run `portalops jobs redispatch` as an ECS one-off task against the new Redis. It re-`add`s every `pending` row (and any `active` row the scale-down interrupted) with a fresh `bullJobId`.
  5. Scale back up.

  Postgres being the source of truth is what makes this sound.

| | A | B | C |
|---|---|---|---|
| "No jobs lost" holds | No (race) | Yes | Yes |
| New runtime surface | None | Pause flag + 503 copy | One idempotent CLI path |
| User-visible during window | Nothing | 503s on job starts | Full outage (minutes; accepted by the PRD) |
| Reuses existing semantics | — | — | Re-delivery: `lost_executions` (#464), sync lock (#460), retry budget (#441) |

**Lean: C.** The PRD accepts a short maintenance window. Re-dispatching from the row is the guarantee, and draining first keeps it a rare safety net rather than the main path. It has to run **before** the API boots against the new Redis: the boot sweep would otherwise reap queued rows whose heartbeat is older than 15 minutes.

### Decision 4 — Where Redis connection construction lives

- **A. Leave it.** Every site already passes the URL, so TLS follows the scheme today.
- **B. Centralize** a `redisConnectionOptions()` in `redis.util.ts` that every client uses: the shared client, the four BullMQ sites and the integration helper. It's the one place to apply `tls` (servername, optional CA from `REDIS_TLS_CA`) and to log the scheme at boot.

**Lean: B.** It's five duplicates of the same object, and the Helm "pin a CA" knob (Decision 5) needs a single seam. Boot logs `redis: tls=on|off` (never the URL) so the runbook can verify the switch from logs.

### Decision 5 — Helm TLS knob

- **A. Document only:** "use `rediss://` in `redis.external.url`."
- **B. Add `redis.external.tls.caSecret`** (an optional Secret key mounted and passed as `REDIS_TLS_CA`), plus the docs. The bundled Redis subchart stays plaintext in-cluster.

**Lean: B.** A customer's managed Redis often uses a private CA, and without a way to supply it `rediss://` fails with a certificate error. The schema gains the field; the bundled default doesn't change.

### Decision 6 — Enforcing "TLS outside local"

The PRD makes TLS scheme-driven, so the API doesn't refuse `redis://`. What keeps SaaS on TLS is the template: after the switch, `backend.yml` builds `rediss://` only. The cluster itself refuses plaintext (`TransitEncryptionMode: required`), which is the acceptance criterion. **Lean:** add a `cache.yml` template test (cfn-lint or a parsed-YAML unit test) asserting both encryption flags plus `required` on the encrypted resource, so a later edit can't silently drop them.

## Tradeoff comparison

|  | D1 side-by-side | D2 phase variable | D3 scale-0 + redispatch | D4 central options | D5 CA knob | D6 template test |
|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes |
| New code surface | CFN only | CFN + workflows | `portalops cache drain-status`, `jobs redispatch` + an API one-off entrypoint | `redis.util.ts` | chart values/template | one test |

## Recommendation

1. Add an `EncryptedRedisReplicationGroup` (`portalai-${Environment}-tls`, at-rest + transit encryption, `TransitEncryptionMode: required`) beside the existing cache resources, with new `RedisTls*` exports. Dev runs one node; prod keeps two nodes with failover and Multi-AZ.
2. Gate it behind `RedisCutoverPhase` (`cache.yml`) and `RedisEndpointSource` (`backend.yml`), both set from per-environment GitHub variables. `backend.yml` builds `rediss://` for the encrypted source.
3. Centralize Redis connection options in `redis.util.ts`. Every client uses it, an optional `REDIS_TLS_CA` is honored, and boot logs whether TLS is on.
4. Add `portalops cache drain-status --env` (read) and `portalops jobs redispatch --env` (a mutation guarded by `--yes` and `--confirm-prod`, run as an ECS one-off against the API image). Redispatch is idempotent: it re-adds only non-terminal, non-`awaiting_confirmation` rows whose `bullJobId` is absent from the current queue.
5. Write a durable `docs/REDIS_ENCRYPTION_CUTOVER.runbook.md`: phase `both` → drain-status → scale to 0 → phase `encrypted` → redispatch → scale up → verify (`describe-replication-groups`, the boot log, a plaintext `redis-cli` refused) → rollback path → remove the legacy resource (cleanup PR).
6. Helm: add `redis.external.tls.caSecret`, plus README and schema updates.
7. Template test pinning the encryption flags; fix the stale `cache.yml:19-23` comment.
8. After **both** environments are cut over: widen `encryption-at-rest` / `encryption-in-transit` with the new evidence paths, drop "Redis" from `FORBIDDEN_CLAIMS`, update the privacy sentence and its test, and update `docs/AWS_CLI_OPS.md` and `docs/DEPLOYMENT_SECURITY_REVIEW.md`.

## Open questions

1. **The claim change lands after prod, but prod waits on the gated release.** Should the claim slice ride in this PR (merging leaves the claims stale until prod is cut over), or in a follow-up PR? Lean: a **follow-up claim PR** opened after prod's cutover. This PR merges with app-dev cut over, so the security page never names the cache before it's true (acceptance criterion 4).
2. **Who scales the service:** `portalops` or raw `aws ecs update-service` in the runbook? Lean: a `portalops service scale --env --count` mutation, since it's repeatable, guarded and audited. It's a small `UpdateService` wrapper beside `runOneOffTask`.
3. **Redispatching an interrupted `active` row:** is it safe for every job type? Sync is (the #460 lock plus the watermark), and the retry budget assumes re-runs. A layout-plan commit or bulk transform re-running from the start needs confirming. Lean: redispatch `active` rows by default, list them in the command's output, and confirm per job type in spec. Draining first makes this rare.
4. **Is the workbook cache's loss user-visible?** An upload session mid-preview loses its chunks. Lean: acceptable within the window. The runbook says so, and the session's existing "cache expired" path handles it (verify in spec).
5. **Narrow the security group** to the ECS SG while we're replacing it? `backend.yml:741` exports `EcsSecurityGroupId`, but `cache.yml` can't import it: backend already imports from cache, and cache deploys first. Lean: **not here**. Narrowing needs the ingress rule moved into `backend.yml` (an `AWS::EC2::SecurityGroupIngress` on the imported cache SG), which is a separate hardening change. Record it as a follow-up under #578.

## Enterprise-scale considerations

- **Concurrency & correctness.** Lean: re-dispatch runs with the service at 0, so it can't race a worker. The `bullJobId`-absent predicate makes it idempotent, so re-running after a partial failure is safe. Re-delivered work gets the existing protections: `lost_executions`, `SyncLockService`, `superseded`.
- **Accuracy & auditability.** Lean: Postgres `jobs` stays the record of truth. `redispatch` prints the re-added ids (JSON) and writes the `portalops` audit line. The runbook records each cutover's timestamps in the PR.
- **Failure modes.** Lean: fail closed on transport, so the encrypted cluster refuses plaintext. Rollback works until the legacy resource is removed: re-point `RedisEndpointSource` back and redispatch again. The rate-limit fail-open (`redis-timeout.util.ts`) is unchanged.
- **Scale & unbounded growth.** Lean: the number of non-terminal rows is bounded by worker concurrency plus the queued backlog. Redispatch pages through them in chunks and reuses `MAX_REAP_PER_PASS`-style caps.
- **Multi-tenancy.** N/A because the cluster is shared infrastructure and the change is transport and storage encryption, not tenant scoping.
- **Contract stability.** Lean: `REDIS_URL` stays the one contract; scheme-driven TLS means residency installs need nothing new, and `REDIS_TLS_CA` is optional.
- **Data lifecycle.** Lean: the old cluster's data, BullMQ history included, is discarded with it; nothing durable lives there after the drain. Snapshot retention carries over to the new prod resource (`SnapshotRetentionLimit=7`).

## What this doesn't decide

- Redis AUTH / RBAC users (out of scope per PRD; transit encryption doesn't require an auth token).
- Multi-AZ RDS / DR (deliberately `MultiAZ=false`; separate decision).
- A general maintenance-mode switch for the app (Decision 3 avoids needing one).
- The prod release timing itself; that's the mock-client gate.

## Next step

`/spec 852` turns the Recommendation into contracts: the CFN parameters and exports, `redisConnectionOptions`, the `portalops` command signatures and exit codes, the redispatch predicate, and the runbook outline. `/plan 852` then slices it test-first. The likely order is:

1. Central connection options.
2. The template test, plus `cache.yml` and `backend.yml` phases.
3. `portalops cache drain-status` and `service scale`.
4. `jobs redispatch` (API entrypoint + CLI).
5. The Helm CA knob.
6. The runbook.
7. The app-dev cutover walk as smoke.

The claim widening follows in its own PR after prod.
