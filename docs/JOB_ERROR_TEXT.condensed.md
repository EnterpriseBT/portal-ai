# Job error text stops carrying raw DB errors — Condensed design (#719)

**Issue:** [EnterpriseBT/portal-ai#719](https://github.com/EnterpriseBT/portal-ai/issues/719) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** When a job fails, the worker stores `formatJobError(err)` in `jobs.error`. For a database failure that string is the Postgres root error: its message, its `detail` (which quotes row values, e.g. `Key (source_id)=(…) already exists.`) and its SQLSTATE. When there is no pg cause it is the Drizzle wrapper, i.e. **the full SQL statement and its bound params**.

Every org member can read every job (#692), and payload redaction blanks `metadata` and `result` but not `error`. The same string is also copied into more places: the SSE events, `JobDetail`, the portal assistant message a bulk transform posts on failure, and the `sql_query` tool's error, which reaches the model and the chat.

This is the job-row twin of #687. Only `apps/api` is touched.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Formatter | `apps/api/src/queues/jobs.worker.ts:29-58` (`formatJobError`) | walks `.cause` to the root, prefers the pg message + `detail` + `code` + `constraint`; falls back to the wrapper's message |
| Writers using it | `jobs.worker.ts:264,278` (attempt failure; also passed to the bulk-transform terminal hook `:283` → `portal.service.ts:563` `Failed: ${errorMessage}`), `:354-370` (out-of-band `UnrecoverableError`) | the other writers are fixed strings (`:243` batch total failure, reconciliation's `STRANDED_JOB_REASON`) or a Redis enqueue failure (`services/jobs.service.ts:96-99`) |
| Same text, other column | `connector_instances.last_error_message` ← raw `err.message`: `queues/processors/layout-plan-commit.processor.ts:118-121` → `services/layout-plan-draft.service.ts:401`; `services/google-access-token-cache.service.ts:93` | shown on the connector instance page |
| Readers | REST list/by-id `routes/jobs.router.ts:175,282`, SSE `routes/job-events.router.ts:108,134`, `apps/web/src/views/JobDetail.view.tsx:156-170`, `utils/await-job-terminal.util.ts` → `tools/sql-query.tool.ts:294` | all read the stored string; there is no single read choke point |
| Deliberately useful text | REST adapter (`adapters/rest-api/cause.util.ts`: "other side closed \| code: UND_ERR_SOCKET"), Google/Microsoft auth errors, `ProcessorError` parse failures, the #468 stall reason | must survive |

## Decision — scrub database errors where the text is written

Options:
- **(a) Redact on read.** Hide `error` from non-controllers. This needs three router edits, misses the copies already made (the portal message, the tool result, `last_error_message`), and hides the useful upstream text too.
- **(b) Two columns.** A safe `error` plus a controller-only `error_detail`. That means a migration and a core contract change, and the raw SQL still isn't text an end user should read; operators have the log.
- **(c) Classify at write time.** A database error becomes a fixed, data-free sentence, and everything else keeps today's text.

**Chosen: (c).** Every reader and every copy inherits the fix from the one place the text is built, with no schema or contract change.

**The new util.** `utils/job-error-text.util.ts` exports `jobErrorText(err)`:
- **Database error.** This means any error in the cause chain is a Postgres error (`postgres`'s `PostgresError`, or an object with a 5-char SQLSTATE `code` plus `severity`), or a message starts `Failed query:`. It returns `Database error (<category>, SQLSTATE <code>). See the server log.`
  - The categories come from a small SQLSTATE map: unique violation, foreign key violation, not-null violation, invalid input, query cancelled, serialization failure, deadlock, too many connections. Anything else is "database error".
  - The pg message, `detail`, constraint name, SQL and params are all dropped. The pg message alone can quote values, e.g. `invalid input syntax for type uuid: "…"`.
- **Anything else.** It returns today's text unchanged, so upstream, auth, parse and stall reasons keep reading the same.
- `formatJobError` becomes this util. The worker already logs `err` in full next to each write, so nothing is lost for operators.

**Same util, other writers.** It also replaces the two raw `err.message` writes to `last_error_message`.

**Existing rows.** A data migration rewrites `jobs.error` and `connector_instances.last_error_message` rows that already hold raw DB text to the generic sentence. It matches `Failed query:%`, plus the formatter's ` | code: <SQLSTATE>` shape. It is an `UPDATE`, not DDL, so `lint:migrations` is unaffected.

## Plan — 2 slices

**Slice 1: classify at write time.**
- **Files:**
  - New `apps/api/src/utils/job-error-text.util.ts`.
  - Edit `queues/jobs.worker.ts`: `formatJobError` delegates to the util.
  - Edit `services/layout-plan-draft.service.ts` and `services/google-access-token-cache.service.ts` (the `last_error_message` writes).
- **Tests:**
  - New `__tests__/utils/job-error-text.util.test.ts`:
    - A Drizzle-wrapped pg unique violation yields the category, the SQLSTATE and no SQL, values or constraint.
    - A bare `Failed query:` message is scrubbed.
    - An `ApiError` with a socket cause, a `ProcessorError` and the stall `UnrecoverableError` pass through unchanged.
  - Extend `__tests__/queues/jobs.worker.test.ts`: a processor that throws a Drizzle-wrapped pg error records the scrubbed text on the row, and the bulk-transform terminal hook receives the same.
  - The existing `jobs.worker.retry.test.ts` expectations ("Fetch failed: fetch failed", the stall reason) stay green.

**Slice 2: rewrite existing rows.**
- **Files:** a new migration via `npm run db:generate -- --name scrub-raw-db-job-errors --custom`, committed with its journal and snapshot.
- **Tests:** an integration test seeds a job with `Failed query: …` and one with `… | code: 23505`, runs the migration's statement, and asserts both now read the generic sentence while an upstream error row is untouched.

Run the touched tests with `npm run test:unit` / `test:integration -- --testPathPattern …`, plus `type-check` and `lint`.

## Smoke (manual, against your dev stack)

1. `npm run db:migrate`. In psql, `select count(*) from jobs where error like 'Failed query:%'` returns 0.
2. Make a job fail on a DB error. For example, a connector sync whose wide table has had a NOT NULL column added by hand with no default, then reverted after. The job's `JobDetail` shows `Database error (not-null violation, SQLSTATE 23502). See the server log.` The API log line for that job has the full pg error.
3. As a **different member**, open the same job (and its SSE stream): the same sentence, with no SQL or values.
4. A REST API connector sync pointed at an unreachable host still shows the upstream text (`… | code: ECONNREFUSED` or similar), unchanged.

## Out of scope

- **Redacting `error` per reader, or a controller-only detail column (option b).** Revisit if users need richer self-serve diagnostics.
- **The Redis enqueue-failure message** (`jobs.service.ts:96-99`). It's infrastructure text, not tenant data.
- **Error text outside jobs and `last_error_message`** (tool results built from other errors). Separate audit if wanted.
