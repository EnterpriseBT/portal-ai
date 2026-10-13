# Jobs that can never succeed fail on their first attempt — Condensed design (#777)

**Issue:** [EnterpriseBT/portal-ai#777](https://github.com/EnterpriseBT/portal-ai/issues/777) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** #774 made the sync processor throw `UnrecoverableError` for a condition no retry can change. Three more places throw a retryable error for such a condition, so the job retries through its 3 attempts (2s/4s backoff, `jobs.queue.ts:32–33`) while it holds its lock scopes (#769):
- `bulk_transform` without `stationId`;
- `bulk_transform` whose tool is no longer bulk-dispatchable;
- `dissolve_precompute` without `userId`.

For those, the cost is seconds of lock and a misleading "retrying" status. The fourth case is much worse than the ticket says. The worker's **no processor registered** check (`jobs.worker.ts:144–146`) runs *before* the worker's `try`, so no catch writes the row. The `failed` handler then sees `pending` and treats it as handled (`jobs.worker.ts:313–315`), so the row stays `pending` and keeps its locks. The reconciliation sweep only reaps a row once its BullMQ entry is gone (`job-reconciliation.service.ts:79–80`), and `removeOnFail` keeps that entry **30 days** (`jobs.queue.ts:35`). `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Missing `stationId` | `apps/api/src/queues/processors/bulk-transform.processor.ts:163–170` | `ApiError(500, BULK_DISPATCH_TOOL_NOT_FOUND)`, retried |
| Tool not bulk-dispatchable | `bulk-transform.processor.ts:172–183` | `ApiError(400, …)` when `lookupBulkDispatchable` returns null, retried |
| Missing `userId` | `apps/api/src/queues/processors/dissolve-precompute.processor.ts:489–493` | plain `Error`; the same file already uses `UnrecoverableError` at `:226`, `:469` |
| No processor | `apps/api/src/queues/jobs.worker.ts:143–146` | thrown outside the `try`, so the row is never written |
| Processor map | `apps/api/src/queues/processors/index.ts:21` | `Record<string, JobProcessor>`, so a `JobType` without a processor compiles |
| Retry decision | `jobs.worker.ts:122–130` (`statusForFailedAttempt`) | `UnrecoverableError` → `failed`; otherwise `pending` until the budget is spent |

## Decision 1 — per-site `UnrecoverableError`, or a worker-wide rule

- **A. "A 4xx `ApiError` is final" in `statusForFailedAttempt`.** The #777 survey traced every processor and found this rule wrong both ways.
  - Two 4xx errors are actually transient:
    - `FILE_UPLOAD_PARSE_FAILED` 400 (`file-upload-session.service.ts:172`): `wrapXlsxError` wraps an S3 stream reset too (`xlsx.adapter.ts:75–87`);
    - `PORTAL_SQL_TIMEOUT` 400 (`portal-sql.service.ts:1234–1239`): a statement timeout under load.
  - Many permanent errors are 5xx, so a status rule would still retry them. Examples: this ticket's own `stationId` 500, REST `REST_API_AUTH_FAILED` 500, and the REST 502 config and data codes.
- **B. A new `PermanentJobError` class.** This duplicates `UnrecoverableError`, which already means exactly this and which the worker already honors. It would be a second name for one convention.
- **C. Per-site `UnrecoverableError`, plus a compile-time guard where one exists.** This is the convention #774 just documented in CLAUDE.md. Every site the survey found is fixed by name.

**Decision: C.** Status codes describe the HTTP answer, not whether a retry can help. That judgment belongs to the code that knows the cause, which is what the #774 convention says. A worker-wide rule would change a convention every processor follows and would need the two misclassified sources fixed first (see Out of scope). It isn't worth that, given C closes every known site.

## Decision 2 — the no-processor case

- **A.** Throw `UnrecoverableError` only. This doesn't help: the row is still never written.
- **B.** Write `failed` (with the reason) before throwing `UnrecoverableError`, so the row is terminal and the locks release at once. Also type the map `Record<JobType, JobProcessor>`, so a `JobType` with no processor fails type-check, and the runtime branch is reached only from a deploy mismatch (an old worker picking up a new type).

**Decision: B.** The type makes the bug unreachable within one build. The runtime write covers the mismatch. A retry can't fix a mismatch either, because the backoff (~6s in total) is far shorter than a rollout.

## Plan — one slice

**Files**
- Edit `bulk-transform.processor.ts:165,179`: throw `UnrecoverableError` with the same messages. The error code goes away, but these throws only ever set the job's `error` text, never an HTTP answer.
- Edit `dissolve-precompute.processor.ts:490`: throw `UnrecoverableError`.
- Edit `jobs.worker.ts:144–146`:
  - in the no-processor branch, `transition(jobId, "failed", { error })`, then throw `UnrecoverableError`;
  - the `JobEventsService` lookup moves above the check.
- Edit `processors/index.ts:21`: `Record<JobType, JobProcessor>`.

**Tests** (failing first; `npm run test:unit -- --testPathPattern …` from `apps/api`)
- `src/__tests__/queues/processors/bulk-transform.processor.test.ts`: missing `stationId`, and a null lookup → `UnrecoverableError` with the message, and no source rows are counted.
- `src/__tests__/queues/jobs.worker.retry.test.ts`: an unknown type writes `failed` with `No processor registered for job type: <t>` and throws `UnrecoverableError`.
- `dissolve-precompute`'s missing-`userId` path is integration-tested only (`src/__tests__/__integration__/queues/dissolve-precompute.processor.integration.test.ts`): add the case there (`AUTH_API_RATE_LIMIT_PER_MIN=1000000 npm run test:integration -- --testPathPattern dissolve-precompute`).
- Then `npm run type-check`, `npm run lint` (api).

## Smoke (manual, against your dev stack)

None of these paths can be reached from the running app without corrupt metadata or a mismatched deploy, so the tests above cover them. The smoke checks that the normal paths are unchanged:

1. In a portal, ask the agent to run a bulk transform on an entity (e.g. "uppercase the name column for every record"). The job completes and the entity unlocks. — manual
2. Pin a map with polygons. The `dissolve_precompute` job completes, and the map renders its dissolved layer.
3. `GET /api/jobs?type=…` (or the Jobs page) shows both jobs `completed` with `attempts` 1. — backend

## Out of scope

- **Two 4xx errors that are actually transient.** `FILE_UPLOAD_PARSE_FAILED` wraps stream and IO failures, and `PORTAL_SQL_TIMEOUT` is a 400 for a timeout; its message also hardcodes "30s" while the job uses `SQL_QUERY_JOB_TIMEOUT_MS`. Both still retry today, which is correct. They matter only if a status-based rule is ever proposed. Worth a ticket of their own.
- **Permanent 5xx/502 errors raised inside adapters** (REST config and data codes, missing OAuth definitions). Those are adapter failures during a real sync, and whether a retry helps is a per-adapter question. That belongs to a separate ticket if it's wanted.
- **`file_upload_parse` flipping the session to `parsed` before its post-parse steps** (`file-upload-session.service.ts:534–540`). It's a separate retry-safety question.
