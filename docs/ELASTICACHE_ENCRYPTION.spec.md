# ElastiCache encryption at rest + in transit — Spec

**Issue:** [EnterpriseBT/portal-ai#852](https://github.com/EnterpriseBT/portal-ai/issues/852) · **Epic:** #578 · **Discovery:** `docs/ELASTICACHE_ENCRYPTION.discovery.md`

This spec pins:

- the CloudFormation phases that put an encrypted replication group beside the plaintext cache;
- the single Redis connection seam that makes TLS follow `REDIS_URL`;
- the job re-dispatch that makes the cutover lossless;
- the `portalops` commands an operator runs;
- the Helm CA knob;
- the cutover runbook.

The public claim widening isn't in this PR. It ships in a follow-up ticket after prod is cut over.

## Key decisions (flag for review)

1. **Side by side, three phases** (D1/D2). `cache.yml` gains a `RedisCutoverPhase` parameter (`legacy` → `both` → `encrypted`), and `backend.yml` gains `RedisEndpointSource` (`legacy` | `encrypted`).
   - **The deploy workflows never pass either parameter**, so every deploy inherits the operator's value. This is the same "omit it to inherit" rule `deploy-prod.yml` already relies on for `DesiredCount`.
   - Only `portalops` moves them.
   - Both default to `legacy`, so merging this PR changes nothing in any environment.
2. **Maintenance window: scale to 0, switch, re-dispatch, scale up** (D3). Re-dispatch runs as an ECS one-off **before** the service boots against the new Redis. Otherwise the boot sweep (`JobReconciliationService`) reaps queued rows whose heartbeat is over 15 min old.
3. **The BullMQ job id becomes the `jobs` row id** (new, found during spec). `dispatch` currently lets BullMQ assign sequential ids, and a fresh Redis restarts the counter at 1. A stored `bullJobId` of `"57"` would then point at an unrelated job on the new cluster. `{ jobId: job.id }` removes the collision for good and makes a re-add idempotent: BullMQ ignores an `add` whose `jobId` already exists.
4. **Re-dispatch covers `pending`, `active` and `stalled`, excludes `awaiting_confirmation`, and flips the row before re-adding** (discovery Q3, resolved). Every job type re-runs safely:
   - `connector_sync`: instance lock plus jobId-generated identities.
   - `layout_plan_commit`: echoes a completed result.
   - `bulk_*`: upserts by `sourceKey` and charges once after the loop.

   Three caveats remain, all mitigated by draining first:
   - a `bulk_transform` whose source is also its target, with a non-idempotent expression, compounds on a re-run;
   - `commitCharge` increments usage before its ledger insert, so a run killed between the two would double-count on re-run;
   - a re-added job's retry budget resets, because the worker derives `attempts` from BullMQ's `attemptsMade`.

   An interrupted `active` row gets `lost_executions + 1` through the existing #464 path.
5. **Fail-closed transport.** The encrypted group sets `TransitEncryptionMode: required`, so plaintext is refused at the cluster. The API stays scheme-driven (PRD) and doesn't refuse `redis://`.
6. **Retiring the legacy cluster is destructive.** `portalops cache phase encrypted` is a destructive op: allowed on app-dev with `--yes`, and refused on prod by the guard. Prod's legacy cluster goes away through the cleanup PR's release.
7. **Discovery Q1 resolved:** the claim widening is a follow-up ticket. **Q2:** `portalops service scale`. **Q4:** an upload preview's workbook cache is lost in the window (the runbook says so). **Q5:** narrowing the security group is out of scope (it would create a circular stack import).
8. **Fixed here because the cutover depends on it:** `packages/devops-cli/src/ecs.ts:24-25` runs `npm run db:seed:ci` / `db:upgrade:ci`, but the runtime image has no npm (`apps/api/Dockerfile:59-65`, #573). So `portalops db seed|upgrade` against a deployed env fails today. The one-off commands become `node dist/...`.

## Scope

### In scope

1. `cache.yml`: phase parameter, encrypted replication group, `RedisTls*` exports, conditioned legacy resources and exports, and the stale comment at `:19-23` corrected.
2. `backend.yml`: the `RedisEndpointSource` parameter and a `REDIS_URL` that branches between `redis://` and `rediss://`.
3. API: `redisConnection()` seam, `REDIS_TLS_CA`, `dispatch` with `jobId`, `JobRedispatchService`, and the `jobs-redispatch` entrypoint.
4. `portalops`: `cache status|phase|switch`, `service scale`, `jobs status|redispatch`; the `ecs.ts` npm fix; `COMMANDS.md`.
5. Helm: `redis.external.tls.caSecret`, plus README and `check-helm` scenarios.
6. `docs/REDIS_ENCRYPTION_CUTOVER.runbook.md` (durable), and `docs/AWS_CLI_OPS.md:71`.
7. File the follow-up claim ticket under #578.

### Out of scope

- `/security/` and privacy claims, `FORBIDDEN_CLAIMS`, and `DEPLOYMENT_SECURITY_REVIEW.md`'s SaaS baseline (the follow-up ticket, after prod).
- The cleanup PR that deletes the legacy resources and parameters (after both environments reach `encrypted`).
- Redis AUTH / RBAC, narrowing the security group, Multi-AZ RDS.
- A general maintenance mode, and reconciliation re-enqueueing on its own (the sweep keeps its #391 reap-only contract).

## Surface

### `infra/cloudformation/cache.yml`

- **Parameter** `RedisCutoverPhase`: `String`, `AllowedValues: [legacy, both, encrypted]`, `Default: legacy`.
- **Conditions:**
  - `HasLegacy: !Not [!Equals [!Ref RedisCutoverPhase, encrypted]]`
  - `HasEncrypted: !Not [!Equals [!Ref RedisCutoverPhase, legacy]]`
  - `LegacySingle: !And [HasLegacy, IsSingleNode]`
  - `LegacyReplicated: !And [HasLegacy, IsReplicated]`
- **Legacy resources:** `RedisCluster` → `Condition: LegacySingle`, and `RedisReplicationGroup` → `Condition: LegacyReplicated`. Properties unchanged.
- **New `EncryptedRedisReplicationGroup`** (`AWS::ElastiCache::ReplicationGroup`, `Condition: HasEncrypted`):
  - `ReplicationGroupId: !Sub "portalai-${Environment}-tls"`, `Engine: redis`, `EngineVersion: "7.1"`, `CacheNodeType: !Ref NodeType`
  - `NumCacheClusters: !If [IsReplicated, 2, 1]`
  - `AutomaticFailoverEnabled: !If [IsReplicated, true, false]`, `MultiAZEnabled: !If [IsReplicated, true, false]`
  - `SnapshotRetentionLimit: !Ref SnapshotRetentionLimit`
  - **`AtRestEncryptionEnabled: true`, `TransitEncryptionEnabled: true`, `TransitEncryptionMode: required`**
  - the same `CacheSubnetGroupName` / `SecurityGroupIds`, and a `Name` tag of `portalai-${Environment}-redis-tls`.
- **Outputs:**
  - `RedisEndpoint` / `RedisPort` → `Condition: HasLegacy`, with the `!If` branches unchanged and the same export names.
  - New `RedisTlsEndpoint` (`!GetAtt EncryptedRedisReplicationGroup.PrimaryEndPoint.Address`) and `RedisTlsPort` (`.PrimaryEndPoint.Port`), each with `Condition: HasEncrypted`, exported as `${Environment}-RedisTlsEndpoint` / `-RedisTlsPort`.
  - `CacheSecurityGroupId` unchanged.

### `infra/cloudformation/backend.yml`

- **Parameter** `RedisEndpointSource`: `AllowedValues: [legacy, encrypted]`, `Default: legacy`. **Condition** `UseEncryptedRedis: !Equals [!Ref RedisEndpointSource, encrypted]`.
- `REDIS_URL` (`:602-608`) becomes `!If [UseEncryptedRedis, !Sub ["rediss://${E}:${P}", {E: !ImportValue "${Environment}-RedisTlsEndpoint", P: …RedisTlsPort}], <the existing redis:// Sub>]`.
- **Workflows unchanged:** `deploy-dev.yml` / `deploy-prod.yml` pass neither new parameter. A guard test enforces it.

### API: the connection seam (`apps/api/src/utils/redis.util.ts`)

```ts
export type RedisConnection = RedisOptions & { url: string };

/** The one place Redis connection options are built. TLS follows the scheme:
 *  `rediss://` → ioredis TLS, `redis://` → plaintext. REDIS_TLS_CA (PEM)
 *  pins a private CA and requires rediss://. */
export const redisConnection = (): RedisConnection;
export const redisTlsEnabled = (): boolean;   // REDIS_URL protocol === "rediss:"
```

- The result is `{ url: environment.REDIS_URL, maxRetriesPerRequest: null, ...(ca ? { tls: { ca } } : {}) }`.
- When `REDIS_TLS_CA` is set and the scheme is `redis://`, it **throws** `Error("REDIS_TLS_CA is set but REDIS_URL is not rediss://")`: a CA with no TLS is a misconfiguration, not a preference.
- `getRedisClient()` does `const { url, ...options } = redisConnection(); new Redis(url, options)`. Its `"connect"` log becomes `logger.info({ tls: redisTlsEnabled(), customCa: !!environment.REDIS_TLS_CA }, "Redis connected")`, never with the URL.
- `connection: redisConnection()` replaces the inline object at `queues/jobs.queue.ts:27`, `jobs.worker.ts:285`, `maintenance.queue.ts:58`, `maintenance.worker.ts:53`. A guard test keeps `environment.REDIS_URL` to that one reader. The integration helper `__tests__/__integration__/queues/queue.util.ts` builds its own plaintext test connections and stays as is.
- `environment.ts` gains `REDIS_TLS_CA: process.env.REDIS_TLS_CA || undefined`. `subprocessor-egress-parity.test.ts` classifies it `"aws"` alongside `REDIS_URL` (`:38`).

### API: dispatch id (`apps/api/src/services/jobs.service.ts:111-119`)

The `add` options become `{ jobId: job.id, attempts: job.maxAttempts }`. The stored `bullJobId` therefore equals `job.id` for every new dispatch. Older rows keep their numeric ids until they finish or are re-dispatched. Reconciliation is unchanged.

### API: `JobRedispatchService` (`apps/api/src/services/job-redispatch.service.ts`, new)

```ts
export interface RedispatchSummary {
  scanned: number;
  redispatched: { id: string; type: JobType; priorStatus: "pending" | "active" | "stalled" }[];
  present: number;          // already in the current queue under this row's id
  skippedTerminal: number;  // went terminal between read and flip
  dryRun: boolean;
}
export class JobRedispatchService {
  static readonly PAGE_SIZE = 200;
  static async redispatchOrphans(opts: { dryRun: boolean }): Promise<RedispatchSummary>;
}
```

1. **Pages** with `DbService.repository.jobs.findRedispatchCandidates(cursor, PAGE_SIZE)` (new, `jobs.repository.ts`). The predicate is `status IN ('pending','active','stalled') AND deleted IS NULL ORDER BY created, id`, keyset on `(created, id)`. It doesn't filter on heartbeat: unlike the sweep, it is run deliberately.
2. **Present:** the row counts as present if `queue.getJob` returns a job whose `data.jobId === row.id`, looked up under the row id and, for a row dispatched before this change, under its stored legacy `bullJobId`. The `data.jobId` match is what keeps a reused legacy number on a replacement Redis from counting as present. Any `getJob` throw aborts the run, unlike the sweep: an unreachable queue means re-dispatch can't do its job.
3. **Absent:** a conditional flip `UPDATE jobs SET bull_job_id = id WHERE id = $1 AND status NOT IN (<TERMINAL_JOB_STATUSES>)`, via a new `jobs.markRedispatched(id)` that returns a boolean.
   - If it returns false, count `skippedTerminal`.
   - If it returns true, `getJobsQueue().add(row.type, { jobId: row.id, type: row.type, ...metadata }, { jobId: row.id, attempts: row.maxAttempts })`.
   - An `add` failure aborts the run. The row keeps `bullJobId = id` but is absent from the queue, so re-running the command picks it up again (idempotent).
4. **Locking:** the whole pass runs under `SyncLockService.withAdvisoryLock` (namespace `REDISPATCH_LOCK_NAMESPACE`, key `"jobs-redispatch"`). A second concurrent pass returns `{ acquiredLock: false }` and does nothing.
5. **Dry run:** `dryRun` reports the same summary without the flip or the add.

**Entrypoint** `apps/api/src/scripts/jobs-redispatch.ts`:

- It parses `--dry-run`, prints the summary as one JSON line on stdout, and logs it.
- It exits `0` on success, and `1` on any abort or when another pass holds the lock (fail-closed, like `db-upgrade`: a pass that didn't run isn't a success).
- Scripts: `"jobs:redispatch": "dotenv -e .env -- tsx src/scripts/jobs-redispatch.ts"` and `"jobs:redispatch:ci": "node dist/scripts/jobs-redispatch.js"`.

### `portalops` (`packages/devops-cli`)

Every command follows `common(...)` + `execute(...)` (`src/bin.ts:72-103`), writes the audit line on mutations, and routes on the env's shape: `local` has no stacks, so the `cache`/`service` commands exit `3` with a hint.

| Command | Class | Behavior |
|---|---|---|
| `cache status --env` | read | Reads the cache stack's `RedisCutoverPhase` and the backend's `RedisEndpointSource` (DescribeStacks). For `portalai-<env>` and `portalai-<env>-tls` (DescribeReplicationGroups / DescribeCacheClusters) it reports `status`, `atRestEncryption`, `transitEncryption` and `transitEncryptionMode`. It also reports service `desired`/`running` (DescribeServices). |
| `cache phase <legacy\|both\|encrypted> --env` | `both`, `legacy`: mutation. `encrypted`: **destructive** (removes the legacy cluster) | UpdateStack on `portalai-<env>-cache` with `UsePreviousTemplate`, every parameter `UsePreviousValue` except the phase, then waits for `UPDATE_COMPLETE`. Preconditions (exit `9`, `CACHE_CUTOVER_CONFLICT`, the conflict family): `encrypted` requires backend source `encrypted`; `legacy` requires backend source `legacy`. |
| `cache switch <legacy\|encrypted> --env` | mutation | Preconditions (exit `9`, `CACHE_CUTOVER_CONFLICT`, the conflict family): phase `both`, service `desired == 0 && running == 0`. Then UpdateStack on the backend with `UsePreviousTemplate`, `RedisEndpointSource=<to>`, `DesiredCount=0`, the rest `UsePreviousValue`, and `CAPABILITY_NAMED_IAM`; waits. |
| `service scale <count> --env [--allow-active]` | mutation | Backend UpdateStack with `DesiredCount=<count>` (through CloudFormation, never `UpdateService`, so the stack stays the source of truth), then waits for `services-stable`. When `count == 0`, it first counts `active` job rows over the DB connection and refuses with exit `5` naming them, unless `--allow-active`. |
| `jobs status --env` | connect | Non-terminal `jobs` counts by status and type over `resolveEnvConnection` (the tunnel). |
| `jobs redispatch --env [--dry-run]` | mutation | Deployed env: an ECS one-off running `node dist/scripts/jobs-redispatch.js [--dry-run]`. Local: `runApiScript(def, "jobs:redispatch")`. Returns `{ via, taskArn? }`, and the summary is in the task's CloudWatch log. |

- **`ecs.ts`:** `SEED_COMMAND = ["node", "dist/db/seed.js"]`, `UPGRADE_COMMAND = ["node", "dist/scripts/db-upgrade.js"]`, and a new `REDISPATCH_COMMAND`. Mirrors `apps/api/package.json:31,35`.
- **Stack names** come from one `stackName(def, "cache" | "backend")` helper: `portalai-${def.aws.envName}-<kind>`.
- **Dependencies:** `@aws-sdk/client-cloudformation` and `@aws-sdk/client-elasticache` join `devops-cli`'s dependencies.
- **`COMMANDS.md`** gains the `cache`/`service`/`jobs` sections and the guard-class rows.

### Helm (`deploy/helm/portalai`)

- `values.yaml` → `redis.external.tls.caSecret: { name: "", key: "ca.crt" }`.
- `api-deployment.yaml` adds env `REDIS_TLS_CA` from `secretKeyRef` when `caSecret.name` is set (it's absent otherwise).
- The README documents `redis.external.url=rediss://…` and the CA row; the bundled Redis is unchanged.
- `values.schema.json` stays permissive (`redis` is an open object).

### Runbook: `docs/REDIS_ENCRYPTION_CUTOVER.runbook.md` (durable)

**Sections:** Preconditions, Provision, Window, Verify, Rollback, Retire.

**Preconditions:** the release carrying this PR is deployed, and `cache status` shows phase `legacy`.

**Provision:** `cache phase both`, then `cache status` shows `-tls` `available` with both flags on and mode `required`.

**Window:**

1. `jobs status` until `active` is 0.
2. `service scale 0`.
3. `cache switch encrypted`.
4. `jobs redispatch`.
5. `service scale <prior count>`.

**Verify:**

- the `Redis connected {tls:true}` boot log;
- `/api/health/ready` returns 200;
- plaintext `redis-cli -h <tls endpoint> PING` from the bastion is refused, and `redis-cli --tls` returns `PONG`;
- `jobs status` shows nothing stuck;
- the `system_check` job round-trips.

**Rollback** (until Retire): scale 0, `cache switch legacy`, `jobs redispatch`, then scale up.

**Retire:** app-dev uses `cache phase encrypted`. Prod uses the cleanup PR's release, because the guard refuses destructive ops on prod.

The runbook also records what starts cold: the workbook cache (open upload previews must re-upload), rate-limit windows, and SSE subscribers (they reconnect).

## Migration

None. There is no schema change: `bull_job_id` is already `text`, and `markRedispatched` writes an existing column.

## Seed

None.

## TDD test plan

Run with `npm run test:unit` / `npm run test:integration` from each package, plus `npm run lint:helm` and `npm run lint:doc-pointers` from the root. Never invoke jest directly.

### Infra guards: `packages/devops-cli/src/__tests__/cache-encryption.test.ts` (new; `yaml` is already a devDependency)

- The encrypted group sets `AtRestEncryptionEnabled: true`, `TransitEncryptionEnabled: true` and `TransitEncryptionMode: required`, with condition `HasEncrypted`.
- The legacy resources and exports are conditioned on `HasLegacy`, and the `RedisTls*` exports on `HasEncrypted`.
- Both phase parameters default to `legacy`.
- `backend.yml`'s `REDIS_URL` builds `rediss://` on the encrypted branch and `redis://` on the legacy one.
- **No deploy workflow passes `RedisCutoverPhase` or `RedisEndpointSource`** (added to `deploy-parity.test.ts`).
- ≈ 7 cases.

### API unit

- `__tests__/utils/redis.util.test.ts` (new):
  - `redis://` → no `tls`;
  - `rediss://` → `tls` comes from the URL (no explicit `tls`);
  - `rediss://` with a CA → `tls.ca`;
  - a CA with `redis://` throws;
  - `maxRetriesPerRequest: null` always;
  - the connect log carries no URL.
  - ≈ 6 cases.
- `__tests__/services/jobs.service.test.ts`: `add` receives `jobId: job.id`, and `bullJobId` is stored equal to the row id. ≈ 2 cases.
- `__tests__/services/job-redispatch.service.test.ts` (new, mocked queue and repository):
  - present is skipped;
  - absent is flipped, then added with `jobId`/`attempts`;
  - a flip that returns false → `skippedTerminal` and no add;
  - a `getJob` throw aborts;
  - an `add` throw aborts with the row left re-dispatchable;
  - dry run writes nothing;
  - `active` is reported as `priorStatus`;
  - paging crosses `PAGE_SIZE`;
  - a held lock does nothing.
  - ≈ 9 cases.
- `__tests__/queues/*`: the four BullMQ sites take `redisConnection()`. ≈ 2 cases.

### API integration: `__integration__/services/job-redispatch.integration.test.ts` (new; real Postgres + Redis)

- A row whose BullMQ entry was obliterated is re-added and processed to `completed` (`system_check`).
- A terminal row isn't revived.
- Running it twice adds once.
- An `active` row ends with `lost_executions = 1`.
- `findRedispatchCandidates` excludes `awaiting_confirmation` and deleted rows.
- ≈ 5 cases.

### portalops unit (`packages/devops-cli/src/__tests__/`, mocked AWS SDK clients like `ecs.test.ts`)

- `cache.test.ts`:
  - status assembles both groups' flags;
  - phase sends `UsePreviousTemplate` with only the phase changed;
  - the phase preconditions (two cases);
  - `encrypted` is destructive (app-dev needs `--yes`, prod is refused with exit 6);
  - switch refuses with a non-zero service, refuses outside phase `both`, and sends `DesiredCount=0` and the source;
  - local → exit 3.
  - ≈ 9 cases.
- `service` cases (in `cache.test.ts`, which holds the shared fake AWS): scale goes through UpdateStack; scale 0 with active rows → exit 5, unless `--allow-active`; prod needs `--confirm-prod`. ≈ 4 cases.
- `jobs.test.ts`: status counts; redispatch routes to ECS with `node dist/scripts/jobs-redispatch.js`, routes to local `runApiScript`, passes `--dry-run`, and writes the audit line. ≈ 5 cases.
- `ecs.test.ts`: the seed/upgrade commands are `node dist/...`. ≈ 2 cases (updated).
- `bin.test.ts`: the new commands are registered with the common flags. ≈ 1 case.

### Helm: `scripts/check-helm.mjs`

- An external `rediss://` URL with `caSecret` renders `REDIS_TLS_CA` from a `secretKeyRef`.
- Without `caSecret`, there's no `REDIS_TLS_CA`.
- The bundled render is unchanged.
- ≈ 3 scenarios.

**Totals ≈ 55 cases.**

## Acceptance criteria

- [ ] Merging and deploying changes nothing: both stacks report phase/source `legacy`, and `REDIS_URL` stays `redis://`.
- [ ] After the app-dev runbook, `aws elasticache describe-replication-groups --replication-group-id portalai-dev-tls` reports `AtRestEncryptionEnabled: true`, `TransitEncryptionEnabled: true` and `TransitEncryptionMode: required`.
- [ ] app-dev's API boots with `tls: true`, readiness is green, jobs run end to end, and a plaintext `PING` to the TLS endpoint is refused.
- [ ] No job row goes `failed` across the cutover: every pre-window non-terminal row reaches a terminal status through a worker, not through the sweep.
- [ ] A later routine deploy keeps app-dev on `encrypted` (the parameters are inherited).
- [ ] `portalops db seed|upgrade --env app-dev` succeeds again (the npm fix).
- [ ] A Helm install with an external `rediss://` URL and `caSecret` connects over TLS.
- [ ] The follow-up claim ticket is filed under #578, and the `/security/` claims are unchanged in this PR.

## Risks & rollback

- **An operator param drift from a workflow passing a phase value** would silently switch or revert an environment. The deploy-parity guard fails CI on it.
- **A double count across a killed `commitCharge`**: the usage total is over-counted by one call's units, and the ledger stays correct. The risk is limited to `bulk_*` jobs, and draining to zero `active` rows prevents it. `service scale 0` refuses while any `active` row exists, unless overridden.
- **A self-target `bulk_transform` re-run compounds.** Same mitigation, and redispatch lists every interrupted `active` row so the operator can inspect it.
- **Transport is fail-closed** (`required`), so a client without TLS can't connect. Readiness fails, and the ECS deploy circuit breaker rolls back. Recovery is the Rollback section.
- **Rollback works until Retire.** After Retire, recovery means a new cluster. This is why Retire waits for a clean verify and is refused on prod.
- **AWS behavior assumptions** (no at-rest setting on a `CacheCluster`, at-rest immutable on a group, `UsePreviousValue` across every parameter) are verified by `cache phase both` on app-dev before prod. The runbook's Provision step is the check.

## Files touched

- **Edited:**
  - `infra/cloudformation/cache.yml`, `infra/cloudformation/backend.yml`
  - `apps/api/src/utils/redis.util.ts`, `apps/api/src/environment.ts`, `apps/api/src/queues/{jobs,maintenance}.{queue,worker}.ts`
  - `apps/api/src/services/jobs.service.ts`, `apps/api/src/db/repositories/jobs.repository.ts`, `apps/api/src/services/sync-lock.service.ts` (namespace constant)
  - `apps/api/package.json`, `apps/api/src/__integration__/queues/queue.util.ts`, `apps/api/src/__tests__/…/subprocessor-egress-parity.test.ts`
  - `packages/devops-cli/src/{bin.ts,ecs.ts}`, `packages/devops-cli/package.json`, `packages/devops-cli/COMMANDS.md`
  - `deploy/helm/portalai/{values.yaml,templates/api-deployment.yaml,README.md}`, `scripts/check-helm.mjs`
  - `docs/AWS_CLI_OPS.md`
- **New:**
  - `apps/api/src/services/job-redispatch.service.ts`, `apps/api/src/scripts/jobs-redispatch.ts`
  - `packages/devops-cli/src/commands/{cache,service,jobs}.ts`
  - `docs/REDIS_ENCRYPTION_CUTOVER.runbook.md`
  - the tests above

## Next step

`/plan 852` slices this test-first on this branch. The likely slices:

1. The connection seam and `REDIS_TLS_CA`.
2. The dispatch `jobId`.
3. `JobRedispatchService`, the entrypoint and the integration test.
4. The CloudFormation phases and the infra guards.
5. The `ecs.ts` npm fix and `jobs status|redispatch`.
6. `cache status|phase|switch` and `service scale`.
7. The Helm CA knob.
8. The runbook and docs.

The app-dev cutover walk is the smoke.
