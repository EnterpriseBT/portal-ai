# ElastiCache encryption at rest + in transit — Plan

**This plan implements the encrypted-cache cutover test-first: the Redis connection seam, row-id dispatch, lossless job re-dispatch, the phased CloudFormation, the `portalops` cutover commands, the Helm CA knob, and the runbook.**

Spec: `docs/ELASTICACHE_ENCRYPTION.spec.md`. Discovery: `docs/ELASTICACHE_ENCRYPTION.discovery.md`. Issue: #852 (epic #578; public-claim follow-up #858). It builds on shipped #391 (reconciliation sweep), #464 (`lost_executions`), #581 (`portalops db upgrade` / ECS one-off) and #566 (Helm chart + `lint:helm`).

There are eight slices. Each sits behind a green test suite and leaves the repo compilable, and each lands as **one commit on `feat/852-elasticache-encryption`**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package; never invoke jest directly (`feedback_use_npm_test_scripts`). Scope a local run to the touched files with `-- --testPathPattern <file>`. The full suite is CI's job.

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd packages/devops-cli && npm run test:unit
npm run lint:helm && npm run lint:doc-pointers   # repo root
```

Each slice follows the same loop:

1. Write the failing tests.
2. Make the smallest change that turns them green.
3. Run the focused tests.
4. Run `npm run lint && npm run type-check` in each touched package, plus `npm run format:check`.
5. Move to the next slice.

## Sequencing rationale

The app-side pieces come first because nothing in infra depends on them, and they ship inert: every environment still runs `redis://`. Infra and the CLI follow, and the docs come last.

- **Slice 1:** the connection seam. Its behavior is a no-op for `redis://`, so it's pure leaf work, and every later TLS concern goes through it.
- **Slice 2:** the dispatch `jobId`. It's a one-line behavior change, but slice 3's idempotency rests on it.
- **Slice 3:** `JobRedispatchService` and its entrypoint. It's the lossless-cutover guarantee, proven against real Postgres and Redis.
- **Slice 4:** the CloudFormation phases and the infra guard tests. Both defaults are `legacy`, so deploying this changes nothing.
- **Slice 5:** the `ecs.ts` npm fix plus `jobs status|redispatch`. It's the first CLI slice because it calls slice 3's entrypoint.
- **Slice 6:** `cache status|phase|switch` and `service scale`. They drive slice 4's parameters, and `service scale 0` reuses slice 5's job count.
- **Slice 7:** the Helm CA knob. It needs slice 1's `REDIS_TLS_CA`.
- **Slice 8:** the runbook and the doc sync. It references every command from slices 5–6.

There's no migration (spec → Migration).

---

## Slice 1 — `redisConnection()` seam + `REDIS_TLS_CA`

This slice puts all Redis connection options in one function, so TLS follows `REDIS_URL` and an optional CA can be pinned. Behavior is unchanged for `redis://`.

**Files**

- Edit: `apps/api/src/utils/redis.util.ts` — `RedisConnection`, `redisConnection()`, `redisTlsEnabled()`. `getRedisClient()` destructures `{ url, ...options }`, and the connect log carries `{ tls, customCa }` with no URL.
- Edit: `apps/api/src/environment.ts` — `REDIS_TLS_CA`.
- Edit: `apps/api/src/queues/jobs.queue.ts:27`, `jobs.worker.ts:285`, `maintenance.queue.ts:58`, `maintenance.worker.ts:53` — `connection: redisConnection()`.
- Edit: `apps/api/src/__integration__/queues/queue.util.ts:3-7` — the same.
- Edit: `apps/api/src/__tests__/…/subprocessor-egress-parity.test.ts` — classify `REDIS_TLS_CA` as `"aws"`.
- New: `apps/api/src/__tests__/utils/redis.util.test.ts`.

**Steps**

1. **Tests (spec → API unit, `redis.util.test.ts`, ≈6).** Write these cases:
   - `redis://` has no `tls`;
   - `rediss://` has no explicit `tls`;
   - `rediss://` with a CA gets `tls.ca`;
   - a CA with `redis://` throws the named error;
   - `maxRetriesPerRequest: null` is always set;
   - the connect log omits the URL.

   Add the queue-site cases (≈2: the four sites take `redisConnection()`) to the existing `__tests__/queues/*` tests. Run them; they fail.
2. **Implement** the seam and swap the five construction sites. Green.
3. Lint, type-check and format-check (`apps/api`). Run the egress-parity test.

**Done when:** the ≈8 cases pass, `grep -rn "url: environment.REDIS_URL" apps/api/src` finds only `redis.util.ts`, and the integration suite's queue helper still connects.

**Risk:** whether ioredis lets explicit options override URL-parsed ones (`tls`). The `rediss://` + CA case pins it.

---

## Slice 2 — Dispatch with `jobId: job.id`

New BullMQ jobs take the Postgres row id, so a fresh Redis can't collide with a stored `bullJobId`.

**Files**

- Edit: `apps/api/src/services/jobs.service.ts:111-119` — add `jobId: job.id` to the `add` options.
- Edit: `apps/api/src/__tests__/services/jobs.service.test.ts`.

**Steps**

1. **Tests (spec → `jobs.service.test.ts`, ≈2).** `add` receives `{ jobId: job.id, attempts: job.maxAttempts }`, and the stored `bullJobId` equals the row id. Run them; they fail.
2. **Implement.** Green.
3. Run the existing reconciliation and worker unit tests unchanged, because `getJob(bullJobId)` still resolves. Then lint and type-check.

**Done when:** both cases pass, and `job-reconciliation` / `jobs.worker*` tests stay green with no edits.

**Risk:** BullMQ rejects a custom `jobId` that is integer-like or contains `:`. A UUID is neither, and the test asserts the real row-id format.

---

## Slice 3 — `JobRedispatchService` + `jobs-redispatch` entrypoint

Non-terminal rows whose BullMQ entry is gone get re-added. The pass is idempotent and advisory-locked, and it never revives a terminal row.

**Files**

- Edit: `apps/api/src/db/repositories/jobs.repository.ts` — `findRedispatchCandidates(cursor, limit)` (keyset on `(created, id)`; statuses `pending|active|stalled`; not deleted) and `markRedispatched(id) → boolean` (the conditional flip).
- Edit: `apps/api/src/services/sync-lock.service.ts` — `REDISPATCH_LOCK_NAMESPACE`.
- New: `apps/api/src/services/job-redispatch.service.ts` — `RedispatchSummary`, `JobRedispatchService.redispatchOrphans({ dryRun })`.
- New: `apps/api/src/scripts/jobs-redispatch.ts` — `--dry-run`, a JSON summary line on stdout, and the exit-code mapping.
- Edit: `apps/api/package.json` — `jobs:redispatch` and `jobs:redispatch:ci`.
- New: `apps/api/src/__tests__/services/job-redispatch.service.test.ts`.
- New: `apps/api/src/__integration__/services/job-redispatch.integration.test.ts`.

**Steps**

1. **Unit tests (spec → `job-redispatch.service.test.ts`, ≈9; mocked queue and repository).**
   - a present row is skipped (with `data.jobId` matching);
   - an absent row is flipped, then added with `jobId`/`attempts`;
   - a false flip gives `skippedTerminal` and no add;
   - a `getJob` throw aborts;
   - an `add` throw aborts and leaves the row re-dispatchable;
   - a dry run makes no writes;
   - an `active` row is reported as `priorStatus`;
   - paging crosses `PAGE_SIZE`;
   - a held lock means no work.

   Run them; they fail.
2. **Integration tests (spec → `job-redispatch.integration.test.ts`, ≈5).**
   - An obliterated `system_check` row is re-added and reaches `completed`.
   - A terminal row isn't revived.
   - Two runs make one add.
   - An `active` row ends with `lost_executions = 1`.
   - The candidates exclude `awaiting_confirmation` and deleted rows.

   Run them; they fail.
3. **Implement** the repository methods, then the service, then the entrypoint (following the shape of `db-upgrade.ts`: injectable steps and a `pathToFileURL` main guard). Green.
4. Lint, type-check, and the focused unit and integration runs.

**Done when:** the ≈14 cases pass, `npm run jobs:redispatch -- --dry-run` against the local stack prints a summary line, and `npm run build` emits `dist/scripts/jobs-redispatch.js`.

**Risk:** the `lost_executions` case depends on the worker's pre-read (`jobs.worker.ts:175-181`) seeing the row still `active`. The flip must leave `status` untouched, and the test pins that.

---

## Slice 4 — CloudFormation phases + infra guards

This slice adds the encrypted replication group beside the legacy cache and branches `REDIS_URL` on `RedisEndpointSource`. Both default to `legacy`, so a deploy is a no-op.

**Files**

- Edit: `infra/cloudformation/cache.yml`:
  - the `RedisCutoverPhase` parameter;
  - the conditions `HasLegacy`, `HasEncrypted`, `LegacySingle` and `LegacyReplicated`;
  - conditioning the legacy resources and outputs;
  - `EncryptedRedisReplicationGroup`;
  - the `RedisTls*` outputs;
  - correcting the stale comment at `:19-23`.
- Edit: `infra/cloudformation/backend.yml` — the `RedisEndpointSource` parameter, the `UseEncryptedRedis` condition and the branched `REDIS_URL`.
- New: `packages/devops-cli/src/__tests__/cache-encryption.test.ts`.
- Edit: `packages/devops-cli/src/__tests__/deploy-parity.test.ts` — no workflow passes either phase parameter.

**Steps**

1. **Tests (spec → Infra guards, ≈7).**
   - The encryption flags and `required` mode are present.
   - The conditions are wired: legacy on `HasLegacy`, `RedisTls*` on `HasEncrypted`.
   - Both defaults are `legacy`.
   - `REDIS_URL` builds `rediss://` on the encrypted branch and `redis://` on the legacy one.
   - The workflows pass neither parameter.

   Parse with `yaml`'s `parseDocument`, as `deploy-parity.test.ts:67-70` already does: it keeps CloudFormation's short tags rather than throwing. Run them; they fail.
2. **Implement** the template changes. Green.
3. Run `aws cloudformation validate-template --template-body file://…` on both templates (needs credentials; skip if there are none) and `cfn-lint` if it's available. Then run devops-cli lint and type-check.

**Done when:** the ≈7 cases pass, and a change-set preview against app-dev (`aws cloudformation deploy --no-execute-changeset`) shows **no resource changes** for either stack: the parameters are added, the legacy resources aren't replaced, and the exports are unchanged.

**Risk:** adding a `Condition` to an existing resource whose condition is true leaves the resource in place. Confirm that with the no-execute change set before merging. This is the slice's real proof.

---

## Slice 5 — `ecs.ts` npm fix + `portalops jobs status|redispatch`

This slice repairs the ECS one-off commands for a runtime image with no npm, and adds the two job commands the cutover window needs.

**Files**

- Edit: `packages/devops-cli/src/ecs.ts` — `SEED_COMMAND` / `UPGRADE_COMMAND` → `node dist/...`; `runRedispatchTask(def, { dryRun })`.
- New: `packages/devops-cli/src/commands/jobs.ts`:
  - `jobsStatus(def)`: non-terminal counts by status and type, over `resolveEnvConnection`, using the connection-and-dispose shape from `tier.ts`;
  - `jobsRedispatch(def, opts)`: a guarded mutation, routed by env shape, with an audit line;
  - `countActiveJobs(def)`: exported for slice 6.
- Edit: `packages/devops-cli/src/bin.ts` — the `jobs` group.
- Edit: `packages/devops-cli/COMMANDS.md` — the `jobs` section and the guard-class rows.
- New: `packages/devops-cli/src/__tests__/jobs.test.ts`.
- Edit: `packages/devops-cli/src/__tests__/{ecs,bin}.test.ts`.

**Steps**

1. **Tests (spec → `jobs.test.ts` ≈5, `ecs.test.ts` ≈2, `bin.test.ts` part).**
   - status counts;
   - redispatch on ECS runs `node dist/scripts/jobs-redispatch.js`;
   - redispatch locally runs `runApiScript(def, "jobs:redispatch")`;
   - `--dry-run` is passed through;
   - the audit line is written;
   - the seed and upgrade commands are `node dist/...`;
   - `jobs status|redispatch` are registered with the common flags.

   Run them; they fail.
2. **Implement.** Green.
3. Lint, type-check and the focused run. Rebuild with `npm run build` (`npx portalops` runs `dist/`).

**Done when:** the ≈8 cases pass, `portalops jobs status --env local --json` prints counts, and `portalops jobs redispatch --env local --dry-run` prints the summary.

**Risk:** the npm fix changes `db seed|upgrade` for deployed environments. Verify it in this PR's smoke with `portalops db upgrade --env app-dev --yes`, a no-op when nothing is pending.

---

## Slice 6 — `portalops cache status|phase|switch` + `service scale`

These are the operator levers for the phases and the maintenance window. They go through CloudFormation `UsePreviousTemplate`, and the switch refuses unless its preconditions hold.

**Files**

- Edit: `packages/devops-cli/package.json` (+ lockfile) — `@aws-sdk/client-cloudformation`, `@aws-sdk/client-elasticache`.
- New: `packages/devops-cli/src/commands/cache.ts`:
  - `stackName(def, kind)`;
  - `cacheStatus`;
  - `cachePhase`: a mutation, and destructive for `encrypted`;
  - `cacheSwitch`.
- New: `packages/devops-cli/src/commands/service.ts` — `serviceScale` (the CloudFormation `DesiredCount` update, the `services-stable` wait, and the active-job refusal through slice 5's `countActiveJobs`).
- Edit: `packages/devops-cli/src/bin.ts` — the `cache` and `service` groups.
- Edit: `packages/devops-cli/COMMANDS.md` — the `cache` and `service` sections and the guard-class rows, including `cache phase encrypted` as destructive.
- New: `packages/devops-cli/src/__tests__/{cache,service}.test.ts`.

**Steps**

1. **Tests (spec → `cache.test.ts` ≈9, `service.test.ts` ≈4, `bin.test.ts` ≈1; mocked SDK clients like `ecs.test.ts`).**
   - status assembles both groups' encryption flags;
   - phase sends `UsePreviousTemplate` with only the phase changed;
   - two phase-precondition refusals (exit 9, `CACHE_CUTOVER_CONFLICT`);
   - `encrypted` is destructive: app-dev needs `--yes`, and prod is refused with exit 6;
   - switch refuses with a non-zero service, refuses outside phase `both`, and sends `DesiredCount=0` and the source;
   - local gives exit 3;
   - scale goes through UpdateStack;
   - scale to 0 with active rows gives exit 5, unless `--allow-active`;
   - prod needs `--confirm-prod`;
   - the new commands are registered.

   Run them; they fail.
2. **Implement.** Green.
3. Lint, type-check, the focused run and the build.

**Done when:** the ≈14 cases pass, and `portalops cache status --env app-dev --json` reports phase `legacy`, the legacy cluster's encryption flags as `false`, and the service counts. That's a read-only live check.

**Risk:** CloudFormation's `UsePreviousValue` must list **every** existing parameter. Read the names from `DescribeStacks` rather than hard-coding them, so a later parameter can't be dropped silently. The tests assert that the parameter list comes from the describe call.

---

## Slice 7 — Helm `redis.external.tls.caSecret`

A residency install can point at a TLS Redis with a private CA.

**Files**

- Edit: `deploy/helm/portalai/values.yaml` — `redis.external.tls.caSecret: { name: "", key: "ca.crt" }`.
- Edit: `deploy/helm/portalai/templates/api-deployment.yaml` — `REDIS_TLS_CA` from a `secretKeyRef` when `name` is set.
- Edit: `deploy/helm/portalai/README.md` — the `rediss://` external example and the CA row.
- Edit: `scripts/check-helm.mjs` — three scenarios.

**Steps**

1. **Scenarios (spec → Helm, ≈3).**
   - An external `rediss://` URL with `caSecret` renders the `secretKeyRef`.
   - Without `caSecret`, there's no `REDIS_TLS_CA`.
   - The bundled render is unchanged.

   Run `npm run lint:helm`; it fails.
2. **Implement.** Green.

**Done when:** `lint:helm` passes all scenarios, existing and new.

**Risk:** none beyond templating. `values.schema.json` already leaves `redis` open.

---

## Slice 8 — Runbook + doc sync

This slice writes the durable cutover runbook and brings every surface that describes Redis or `portalops` into line.

**Files**

- New: `docs/REDIS_ENCRYPTION_CUTOVER.runbook.md` — Preconditions, Provision, Window, Verify, Rollback and Retire, plus what starts cold (spec → Runbook). It includes the prod note: Retire goes through the cleanup PR's release, and #858 opens after both environments are cut over.
- Edit: `docs/AWS_CLI_OPS.md:71` — the TLS endpoint and `rediss://`.
- Edit: `CLAUDE.md` monorepo table (the `@portalai/devops-cli` row) and its `.github/copilot-instructions.md` mirror — add the Redis cutover and job re-dispatch to the CLI's scope.
- Edit: `packages/devops-cli/COMMANDS.md` — cross-link the runbook.

**Steps**

1. **Test:** `npm run lint:doc-pointers`, which gates durable docs. A source comment citing `docs/REDIS_ENCRYPTION_CUTOVER.runbook.md` (in `cache.ts`'s header) has to resolve. Run it; it fails until the runbook exists.
2. **Write** the runbook and the edits. Green.
3. Walk the runbook's commands against `--env local` where they apply (`jobs status`, `jobs redispatch --dry-run`) to catch typos.

**Done when:** `lint:doc-pointers` passes, and every command in the runbook exists in `COMMANDS.md`.

**Risk:** none.

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | `redisConnection()` + `REDIS_TLS_CA` | api unit ≈8 |
| 2 | dispatch `jobId = row id` | api unit ≈2; reconciliation/worker unchanged |
| 3 | `JobRedispatchService` + entrypoint | api unit ≈9 + integration ≈5 |
| 4 | CloudFormation phases (inert) | devops-cli guards ≈7 + no-change change-set on app-dev |
| 5 | `ecs.ts` npm fix + `jobs status\|redispatch` | devops-cli ≈8 |
| 6 | `cache status\|phase\|switch` + `service scale` | devops-cli ≈14 + live read-only `cache status` |
| 7 | Helm CA knob | `lint:helm` ≈3 scenarios |
| 8 | Runbook + doc sync | `lint:doc-pointers` |

The total is ≈55 cases, matching the spec.

## Cross-slice notes

- **When the cutover happens.** app-dev deploys on every push to `main`, but **this PR's smoke is the app-dev cutover**. So the smoke runs from the branch before merge: `gh workflow run deploy-dev.yml --ref feat/852-elasticache-encryption`, then the runbook end to end on app-dev, then `cache phase encrypted` (Retire). After the merge, the routine `main` deploy inherits `encrypted`/`encrypted`, which is acceptance criterion 5. Prod follows with the next gated release.
- **Nothing activates without an operator.** Through slice 8, every environment stays on `legacy` until someone runs `cache phase both`. If the PR is reverted before any cutover, nothing changes. After a cutover, a revert would conflict with the stack, so roll back with the runbook instead.
- **A core change ripples.** Nothing in this plan touches `@portalai/core`. If a slice ends up needing a core type (it shouldn't; `JobType` is only read), run the full root `npm run build` before pushing (`feedback_core_model_change_run_full_build`).
- **Built CLI.** `npx portalops` runs `dist/`, so rebuild devops-cli after slices 5 and 6 before any live check.
- **Doc sync.** The surfaces are `COMMANDS.md` (slices 5, 6 and 8), the runbook, `AWS_CLI_OPS.md`, the Helm README (slice 7), and the `CLAUDE.md` / Copilot mirror (slice 8). `DEPLOYMENT_SECURITY_REVIEW.md` and the `/security/` claims are deliberately left for #858.

## Next step

Implementation starts on this branch with slice 1, tests first, one commit per slice, once discovery, spec and plan are confirmed.
