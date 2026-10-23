# elasticache-encryption — Adversarial Review

Adversarial probes for [#852](https://github.com/EnterpriseBT/portal-ai/issues/852): the encrypted ElastiCache cutover, the TLS client seam, job re-dispatch, the worker's terminal-row skip, and the `portalops` cutover commands. **Branch under test:** `feat/852-elasticache-encryption` (PR [#859](https://github.com/EnterpriseBT/portal-ai/pull/859)).

The change has no new browser or HTTP surface; its attack surface is operator commands, the API process's Redis configuration, and the queue across a Redis replacement. So every probe is `— backend` (CLI/AWS/DB/log) or `— manual`. Probes marked **(app-dev)** need the merged release on app-dev, like smoke §3–§6, and run with the post-merge walk. The rest run against the local stack now.

## Preflight

### Environment
- [ ] Local stack up (`npm run dev`; Postgres + Redis from docker-compose); `npm run build --workspace @portalai/devops-cli`
- [ ] For **(app-dev)** probes: the merged release on app-dev, and an AWS session (`aws sts get-caller-identity`)

### Fixtures
- [ ] Local: an org with a connector you can sync (`npm run db:seed` + the demo connector)
- [ ] Hand-inserted `jobs` rows for the lifecycle probes: insert through `psql` with `created_by` set to a real user id, and delete them afterwards

### Reset between runs
- [ ] Local: delete the probe's `jobs` rows; `redis-cli -n 0 DEL` is **not** needed (re-added entries complete or are skipped)
- [ ] app-dev: as smoke §7 (Rollback)

## §1 — Boundary & limit inputs
- [ ] `REDIS_URL=REDISS://localhost:6380 npm run jobs:redispatch -- --dry-run` (uppercase scheme) — SAFE: the API reports `tls: false`, matching what ioredis does. It never logs TLS while connecting in plaintext. — backend
- [ ] `REDIS_URL=localhost:6380` (no scheme, which ioredis accepts) — SAFE: boots; `redisTlsEnabled()` doesn't throw inside the `connect` handler. — backend
- [ ] `npx portalops service scale -1 --env app-dev --yes` and `… scale 1.5 …` — SAFE: exit 2 (usage) before any AWS call. — backend
- [ ] Exactly `PAGE_SIZE` (200) live pending rows whose BullMQ entries are absent, then `npm run jobs:redispatch` — SAFE: all 200 re-added. The page loop's `< PAGE_SIZE` exit doesn't drop the row past the boundary; with 201 rows, all 201 are re-added. — backend

## §2 — Malformed & injection input
- [ ] `REDIS_TLS_CA="not a pem" REDIS_URL=rediss://…` — SAFE: the TLS handshake fails and readiness stays red. It never falls back to plaintext or to "accept any cert" (no `rejectUnauthorized: false` anywhere in the diff). — backend
- [ ] `REDIS_TLS_CA=<pem> REDIS_URL=redis://redis:6379` — SAFE: the API refuses to start with `REDIS_TLS_CA is set but REDIS_URL is not rediss://`. — backend
- [ ] A job row whose `metadata` carries `jobId`, `type` or `attemptOffset` keys (`UPDATE jobs SET metadata = metadata || '{"jobId":"<other row id>","attemptOffset":-5}'`), then `jobs redispatch` — SAFE: the worker transitions **the row's own id**, not the other row's; `jobs.attempts` never goes negative. If the payload's `jobId` can be overridden by metadata, that is a finding (the spread order is `jobId, type, ...metadata, attemptOffset`). — backend
- [ ] `grep -rn "jobId\|attemptOffset" packages/core/src/models/job.model.ts` metadata schemas — SAFE: no job type's metadata schema declares those keys, so no server-built metadata can collide. — backend

## §3 — Concurrency & races
- [ ] Two `npm run jobs:redispatch` started together against the same orphaned rows — SAFE: one reports `acquiredLock: false` and exits 1. Each row is added once (`getJobCountByTypes` equals the row count). — backend
- [ ] `jobs redispatch` while the API (and its workers) is **running** (operator skips the scale-down) — SAFE: rows already queued are `present` and untouched; nothing runs twice (a row being processed is `active` in BullMQ, so it isn't re-added). — backend
- [ ] **(app-dev)** A job turns `active` between `service scale 0`'s count and the stack update (start a sync seconds before) — SAFE: the job is interrupted, re-queued by `jobs redispatch` with `priorStatus: "active"`, and completes with `lost_executions = 1`. It doesn't end `failed`. — backend
- [ ] **(app-dev)** `cache phase both` while a `deploy-dev` run is mid-flight — SAFE: one stack update fails cleanly with "UPDATE_IN_PROGRESS". The CLI exits 7 naming the stack; nothing is half-applied. — backend

## §4 — Auth & permission boundaries
- [ ] `npx portalops cache phase both --env app-dev` without `--yes` — SAFE: exit 5, no UpdateStack. — backend
- [ ] `npx portalops cache switch encrypted --env prod --yes` without `--confirm-prod` — SAFE: exit 5 before any AWS call. — backend
- [ ] `npx portalops cache phase encrypted --env prod --yes --confirm-prod` — SAFE: exit 6 (destructive blocked), no AWS call. — backend
- [ ] No HTTP route or agent tool reaches re-dispatch: `grep -rn "redispatch" apps/api/src/routes apps/api/src/tools` is empty, and `route-authorization.map.ts` is unchanged by the branch — SAFE: re-dispatch is reachable only through an operator with AWS credentials. — backend
- [ ] An AWS identity without CloudFormation write (a read-only role) runs `cache phase both --env app-dev --yes` — SAFE: exit 7 with the AccessDenied message; no partial change. — manual

## §5 — Multi-tenant isolation
- [ ] Two orgs each with a pending orphaned row; `jobs redispatch` — SAFE: each re-queued job runs as **its own** creator and org (the payload is built from its own row). Org A's job result and progress events never appear on org B's job stream (`/api/sse/jobs/:id/events` as an org-B member for org A's job id → 404). — backend
- [ ] The redispatch summary (CloudWatch / stdout) lists job ids and types only — SAFE: no metadata, no customer data, no Redis URL in the summary or the boot log. — backend

## §6 — State & lifecycle abuse
- [ ] A row `cancelled` by the user after `jobs status` but before `jobs redispatch` — SAFE: `skippedTerminal: 1`, not re-added. — backend
- [ ] **Rollback stale entries:** a row completed on the new Redis whose legacy entry is still `waiting` in the old Redis; switch back to legacy and start a worker — SAFE: the worker logs "Skipping a queued job whose row is already terminal" and the row stays `completed`; the processor never runs. Locally: complete a row, then `queue.add(type, {jobId}, {jobId: <id>})` against a second Redis DB and point a worker at it. — backend
- [ ] A soft-deleted row (`deleted IS NOT NULL`) and an `awaiting_confirmation` row — SAFE: neither is re-added; `scanned` excludes both. — backend
- [ ] A row whose BullMQ entry under its own id is `completed` while the row is still `active` (worker died before its terminal write) — SAFE: re-dispatch removes the stale entry and re-adds the row (`redispatched`, not `present`), and it runs. — backend
- [ ] A row that already spent its last attempt (`attempts = maxAttempts`, status `pending`) — SAFE: re-added with **1** attempt (never 0 or negative); `jobs.attempts` reads `maxAttempts + 1` at most, never resets to 1. — backend
- [ ] **(app-dev)** `cache phase both` **before** the release carrying #852 is deployed (template without the parameter) — SAFE: exit 9 "has no RedisCutoverPhase parameter — deploy the release that adds it first", no UpdateStack. — backend

## §7 — Misuse sequences
- [ ] **(app-dev)** Operator skips `jobs redispatch` and scales up after the switch — SAFE (documented failure mode, not a silent one): queued rows older than 15 min are reaped as `failed` with the stranded-job error, and `jobs status` shows the loss. Recovery: none for reaped rows (they're terminal). Confirm the runbook's warning is prominent enough. — manual
- [ ] **(app-dev)** `cache switch encrypted` run twice — SAFE: the second reports `changed: false`, exits 0, writes no audit line. — backend
- [ ] **(app-dev)** `service scale 1` before `cache switch` (out of order) — SAFE: the service comes back on the **legacy** cache (switch hasn't happened); no job loss. `cache switch` then refuses (exit 9) until it's scaled to 0 again. — backend
- [ ] **(app-dev)** `cache phase encrypted` (Retire) attempted before `cache switch` — SAFE: exit 9, the legacy cache untouched. — backend
- [ ] **(prod)** A release published mid-window (phase `both`, service at 0) — SAFE: `deploy-prod`'s "Decide the restored task count" warns and leaves `DesiredCount` at 0; the API doesn't boot before redispatch. Verify on the first prod cutover's release, or with a dry `act` run of the step. — manual

## Findings
| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| §2 metadata carrying `jobId` / `attemptOffset` | A row whose `metadata` holds `{"jobId":"<other row>","attemptOffset":-5}` is queued with `data.jobId` = **the other row's id** and `attemptOffset` = -5: the payload spreads metadata after `jobId`/`type`, so metadata wins. The worker would transition the wrong row. **Not reachable today:** no job type's metadata schema declares either key, and metadata is server-built. The ordering predates this PR (`JobsService.dispatch`); `queuePayload` inherited it, and `attemptOffset` is new. | low (defense in depth) | fixed-in-PR: `queuePayload` strips the reserved keys from metadata and writes the row's `jobId`/`type` last. The unit tests and the `job-redispatch` integration test pin it, and a re-walk of the probe now queues `data.jobId` = the row's own id with no `attemptOffset`. |

### Local walk: 2026-10-23 (agent, evidence only; boxes left for the human)

Run against the integration-test Postgres and Redis logical DB 15 (never the dev stack's queue), through a throwaway harness that was deleted afterwards. Every other local probe held:

- **§1:**
  - `REDISS://redis:6379` → `{"tls":false,"ping":"PONG"}`, matching ioredis, which connects in plaintext.
  - `redis:6379` → `{"tls":false,"ping":"PONG"}`, no throw.
  - `service scale -1` and `1.5` exit 2.
  - 200 orphaned rows → 200 re-queued; 201 → 201.
- **§2:** a CA with `redis://` → `THREW: REDIS_TLS_CA is set but REDIS_URL is not rediss://`. No `rejectUnauthorized` or `checkServerIdentity` anywhere in the diff. No metadata schema declares `jobId` or `attemptOffset`.
- **§3:**
  - Two concurrent passes → one `acquiredLock:false`; 2 rows → 2 queued.
  - A second pass while a worker runs the job → `present:1`; the processor ran once and the row completed.
- **§4:** `cache phase both` without `--yes` → exit 5. `cache switch` on prod without `--confirm-prod` → exit 5. `cache phase encrypted --env prod` → exit 6. No route or tool references re-dispatch, and `route-authorization.map.ts` is unchanged.
- **§5:** two orgs → each processor call saw its own row's `jobId` and `organizationId`. Summary keys are `acquiredLock, scanned, redispatched, present, skippedTerminal, dryRun`; entry keys are `id, type, priorStatus` (no metadata).
- **§6:**
  - Cancelled between read and flip → `skippedTerminal:1`, not queued, still `cancelled`.
  - A stale entry for a completed row → processor calls 0, return `{"skipped":true,"status":"completed"}`, row still `completed`.
  - Deleted and `awaiting_confirmation` rows → `scanned:0`, neither queued.
  - A finished entry while the row is `active` → re-queued (`waiting`), `present:0`.
  - A row at its last attempt (3/3) → `opts.attempts:1`, `attemptOffset:2`, `jobs.attempts` 3 after the run.
- **Not walked locally:**
  - every **(app-dev)** and **(prod)** probe (with the post-merge walk);
  - §2's garbage-CA handshake (local Redis has no TLS);
  - §4's read-only-IAM probe — manual;
  - §5's cross-org SSE 404 (#692 behavior, unchanged by this PR).

## Sign-off
- [ ] Every probe walked (the **(app-dev)** ones with the post-merge smoke walk); findings resolved or waived with a reason
- [ ] <date + name>: confirmed against my own running stack and app-dev

## Bug-filing template
Section: · Probe: · Expected (safe): · Got: · Repro: · Identifiers (env, job ids, stack event ids, CloudWatch task id):
