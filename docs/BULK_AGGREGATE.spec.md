# bulk_aggregate — reduce N records to a single value — Spec

**After this lands, the agent can call `bulk_aggregate_records` with a `sourceConnectorEntityId`, an optional `sourceFilter.whereSqlFragment`, and a SQL aggregate `expression`. A `bulk_aggregate` job runs the aggregate in the worker (`READ ONLY` txn + `statement_timeout`, org-scoped); the tool awaits the terminal envelope and returns `{ result, recordsProcessed, durationMs }` inline, so the agent answers the user in the same turn. No entity writes, no lock, no frontend.**

Discovery: `docs/BULK_AGGREGATE.discovery.md`. Issue: [#100](https://github.com/EnterpriseBT/portal-ai/issues/100). Sibling template: `bulk_transform` (`apps/api/src/tools/bulk-transform-entity-records.tool.ts`, `apps/api/src/services/bulk-transform.service.ts`, `bulk-transform.processor.ts`).

## Key decision — result delivery (flag for review)

`bulk_transform` returns a progress block and injects a template terminal message; the agent is never re-prompted — fine for a side-effect. `bulk_aggregate`'s output *is the answer the agent must use*, so it needs the value in-hand. Per discovery Open Q2 (resolved: *"more concerned about large datasets than blocking the agent"*), the tool **awaits the job inline** and returns the value:

- The worker runs the aggregate in a `READ ONLY` transaction with `SET LOCAL statement_timeout` (reusing the `portal-sql.service.ts:347-359` pattern), org-scoped. This keeps the heavy scan **off the API request thread** (the API handler parks on a promise; PG + the worker do the work) and bounds the runtime.
- The tool polls/subscribes for the job's terminal status (the job-events Redis channel that `JobEventsService.transition` already publishes), then returns the persisted `result`.
- `statement_timeout` is the wait bound. Proposed **120s** (vs. interactive `sql_query`'s 30s — this is the async/large path). If it fires, the job fails `BULK_AGGREGATE_TIMEOUT` and the agent surfaces a "narrow the filter / use a coarser aggregate" recommendation.

This deliberately differs from `bulk_transform`'s fire-and-forget delivery; the divergence is the point (aggregate returns an answer, transform performs a side-effect).

## Scope

### In scope

1. **Job model** (`packages/core/src/models/job.model.ts`). Add `"bulk_aggregate"` to `JobTypeEnum`; add `BulkAggregateMetadataSchema` + `BulkAggregateResultSchema`; wire `JobTypeMap` + `JOB_TYPE_SCHEMAS` (the build fails if any of the three is incomplete — see the JSDoc recipe at `job.model.ts:397-403`). **Also** add `"bulk_aggregate"` to the Drizzle `jobTypeEnum` (`apps/api/src/db/schema/jobs.table.ts`) — `jobs.type` is a pg enum, so the compile-time `IsAssignable<Job, JobSelect>` check (`type-checks.ts:226`) fails unless both enums move together — and generate the migration (`ALTER TYPE "job_type" ADD VALUE 'bulk_aggregate'`).

   ```ts
   BulkAggregateMetadataSchema = z.object({
     /** Source entity to scan; read-only, no lock (Decision 2). */
     sourceConnectorEntityId: z.string(),
     organizationId: z.string(),
     /** SQL aggregate projection, e.g. "SUM(c_area) AS total, AVG(c_age) AS avg_age".
      *  Validated via EXPLAIN at pre-flight; runtime bounded by the org-scope guard. */
     expression: z.string(),
     /** Optional source-side WHERE fragment, injected into the scan. */
     sourceFilter: z.object({ whereSqlFragment: z.string() }).optional(),
   });

   BulkAggregateResultSchema = z.object({
     /** Any bounded serializable JSON value: scalar, object (multi-alias), or array. */
     result: z.unknown(),
     recordsProcessed: z.number().int().nonnegative(),
     durationMs: z.number().int().nonnegative(),
   });
   ```

   No `targetConnectorEntityIds`, no `writes[]`, no `batchSize`, no aggregator union (SQL-only per discovery Decision 1).

2. **Aggregate execution** — new `apps/api/src/services/bulk-aggregate.service.ts` (mirrors `bulk-transform.service.ts`):
   - `explainExpression({ sourceConnectorEntityId, organizationId, expression, whereSqlFragment? })` — assembles `EXPLAIN SELECT {expression}, COUNT(*) AS __records_processed FROM "er__{source}" WHERE "organization_id" = '<org>' [AND ({whereSqlFragment})]` and runs it. PG error → throw `BULK_AGGREGATE_EXPRESSION_INVALID` with `details.pgError`. (Org-scope only — wide tables aren't soft-deleted; this matches `bulk-transform.service`'s WHERE.)
   - `runAggregate(metadata)` — opens a `READ ONLY` transaction, `SET LOCAL statement_timeout = '120s'`, runs the org-scoped `SELECT {expression}, COUNT(*) AS __records_processed FROM "er__{source}" WHERE "organization_id" = '<org>' [AND (…)]`. Returns `{ result, recordsProcessed }` with `__records_processed` stripped out of `result`. On PG `statement_timeout` (SQLSTATE 57014) → throw `BULK_AGGREGATE_TIMEOUT`. The SQL builders (`buildAggregateSql` / `buildExplainSql`) are pure + exported for unit tests.

3. **Processor** — new `apps/api/src/queues/processors/bulk-aggregate.processor.ts`. Parse metadata via `BulkAggregateMetadataSchema`; call `BulkAggregateService.runAggregate`; enforce the **result-size cap** (`JSON.stringify(result).length <= BULK_AGGREGATE_RESULT_LIMIT`, propose 1 MB) — over the cap → fail `BULK_AGGREGATE_RESULT_TOO_LARGE` with a "use bulk_query / narrow the projection" recommendation. Return `{ result, recordsProcessed, durationMs }`. Register in `apps/api/src/queues/processors/index.ts`.

4. **Tool** — new `apps/api/src/tools/bulk-aggregate-entity-records.tool.ts`. `build(stationId, organizationId, userId)` returns the AI SDK tool. `execute` pre-flight, in order:
   1. Source entity exists + org-scoped (`repo.connectorEntities.findById`) → `CONNECTOR_ENTITY_NOT_FOUND`.
   2. `expression` EXPLAINs clean → `BULK_AGGREGATE_EXPRESSION_INVALID`.
   3. Enqueue via `JobsService.create(userId, { organizationId, type: "bulk_aggregate", metadata })`.
   4. **Await** the job's terminal status via the job-events channel (abort signal → `JobsService.cancel` + `pg_cancel_backend` for the in-flight query — see Risks).
   5. On `completed` → return the `result` envelope; on `failed`/`cancelled` → throw the carried `ApiError`.

   No lock check (reads only), no cost-ack gate (one query).

5. **Tool registration** — `apps/api/src/services/tools.service.ts`. Add the slug to `BUILTIN_TOOL_NAMES`; instantiate in `buildAnalyticsTools()` under the `data_query` pack (alongside `sql_query`/`bulk_transform`).

6. **API codes** — add to `apps/api/src/constants/api-codes.constants.ts` with `ApiCodeDefaultRecommendation` entries: `BULK_AGGREGATE_EXPRESSION_INVALID`, `BULK_AGGREGATE_TIMEOUT`, `BULK_AGGREGATE_RESULT_TOO_LARGE`.

7. **Smoke** — new section of `docs/LARGE_DATA_OPS.smoke.md`: total NEO count via `COUNT(*)`; sum + average of diameters via `SUM(...)/AVG(...)` multi-alias; verify the terminal envelope's `result` + `recordsProcessed` on the job row.

### Out of scope

- **`fold_tool` / `tool_map` aggregators.** Dropped on tool-purity grounds (discovery Decision 1). Non-SQL per-row values compose via `bulk_transform` → `bulk_aggregate`.
- **Source locking.** Reads don't lock (discovery Decision 2).
- **Grouped N→M materialization.** Separate primitive, [#112](https://github.com/EnterpriseBT/portal-ai/issues/112).
- **Frontend block.** The agent reads the value from the envelope and answers in prose; an inline result widget is a later UI ticket (discovery "What this doesn't decide").
- **Late-read of an aggregate that outran the await.** The `statement_timeout` is the bound; a job slower than that fails rather than detaching. A "read a finished job's result later" tool is a follow-up if real datasets need a longer timeout than the await tolerates.

## Surface

| File | Change |
|---|---|
| `packages/core/src/models/job.model.ts` | + `bulk_aggregate` enum, metadata/result schemas, type-map + registry entries |
| `apps/api/src/db/schema/jobs.table.ts` + `drizzle/*.sql` | + `bulk_aggregate` in the Drizzle `jobTypeEnum`; `ALTER TYPE` migration |
| `apps/api/src/services/bulk-aggregate.service.ts` | new — `explainExpression`, `runAggregate` (READ ONLY + statement_timeout + COUNT injection) |
| `apps/api/src/queues/processors/bulk-aggregate.processor.ts` | new — runs the aggregate, enforces size cap, returns envelope |
| `apps/api/src/queues/processors/index.ts` | + `bulk_aggregate` in the processors map |
| `apps/api/src/tools/bulk-aggregate-entity-records.tool.ts` | new — pre-flight + enqueue + await-terminal + return |
| `apps/api/src/services/tools.service.ts` | + slug in `BUILTIN_TOOL_NAMES`, instantiate under `data_query` |
| `apps/api/src/constants/api-codes.constants.ts` | + 3 codes + recommendations |
| `docs/LARGE_DATA_OPS.smoke.md` | + aggregate walk section |

## Tests

### Unit — job model
1. `BulkAggregateMetadataSchema` / `ResultSchema` round-trip; `JOB_TYPE_SCHEMAS.bulk_aggregate` present; `JobTypeMap` typed (compile-time).

### Unit — service
2. `explainExpression` assembles org-scoped SQL with the `whereSqlFragment` injected and runs EXPLAIN.
3. Invalid expression → `BULK_AGGREGATE_EXPRESSION_INVALID` with `details.pgError`.
4. `runAggregate` returns the aggregate row with `__records_processed` stripped into `recordsProcessed`.
5. `runAggregate` honors `statement_timeout` → `BULK_AGGREGATE_TIMEOUT` (mock a slow query / forced timeout).

### Unit — processor
6. Runs a scalar aggregate (`COUNT(*)`) → `{ result, recordsProcessed, durationMs }`.
7. Runs a multi-alias aggregate → `result` is an object keyed by alias.
8. Result over the size cap → `BULK_AGGREGATE_RESULT_TOO_LARGE`.

### Unit — tool
9. Pre-flight rejects unknown source entity (`CONNECTOR_ENTITY_NOT_FOUND`).
10. Pre-flight rejects invalid expression (`BULK_AGGREGATE_EXPRESSION_INVALID`).
11. Happy path enqueues, awaits terminal, returns the envelope.
12. Terminal `failed`/`cancelled` → tool throws the carried error.
13. No lock check is performed (assert `assertConnectorEntityUnlocked` is never called).

### Integration
14. End-to-end: seed a source entity (~1,000 rows), dispatch the tool, assert the returned `result` matches a hand-computed `SUM`/`AVG`/`COUNT`, `recordsProcessed === 1000`, and the job row's persisted `result` matches the envelope.

## Acceptance criteria

- [ ] Job-model schemas + type wiring; test 1 + `type-check` clean.
- [ ] `bulk-aggregate.service` passes tests 2–5.
- [ ] Processor registered; passes tests 6–8.
- [ ] Tool registered under `data_query`; passes tests 9–13.
- [ ] Integration test 14 green.
- [ ] Smoke section added; manual walk (NEO count + diameter sum/avg) verified.
- [ ] `npm run test:unit` (api + core) and `npm run test:integration` (api) green; `npm run lint && npm run type-check` clean.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| **Cancel doesn't stop the in-flight query.** `JobsService.cancel` only removes the BullMQ job; a query already executing in the worker keeps running. | The processor must register its PG backend pid and respond to a cancel signal with `pg_cancel_backend(pid)` (or rely on `statement_timeout` as the hard backstop). Implementation note for slice 3; the `statement_timeout` guarantees termination regardless. |
| Awaited tool holds the agent stream open for up to `statement_timeout`. | Bounded at 120s; acceptable per the resolved Open Q2. The API handler parks on a promise — no DB connection held on the API side (the worker owns it). |
| `statement_timeout` too short for a genuinely huge aggregate. | Tunable constant; if real datasets exceed it, raise it + add a late-read follow-up (out of scope here). Flagged. |
| `whereSqlFragment` injection. | Same posture as `bulk_transform`: EXPLAIN-validated at pre-flight, runtime bounded by the `organization_id = $1` guard inside a `READ ONLY` txn. |

**Rollback**: revert the merge commit. New job type, service, processor, and tool disappear. The only migration is an `ALTER TYPE … ADD VALUE` on the `job_type` enum — Postgres can't drop an enum value, but a leftover unused value is harmless (no rows reference it once the job type is gone), so the migration is effectively forward-only and needs no down-migration. Any in-flight `bulk_aggregate` job would fail "no processor registered" on retry — operator cancels via the existing job-cancel route; nothing was written to any entity.

## Cross-references

- `docs/BULK_AGGREGATE.discovery.md` — decisions (SQL-only, no lock, large-dataset rationale, result shape).
- `apps/api/src/services/portal-sql.service.ts:347-359` — `READ ONLY` + `statement_timeout` execution pattern to reuse.
- `apps/api/src/services/bulk-transform.service.ts` — `explainExpression` reference.
- `apps/api/src/services/jobs.service.ts` — `JobsService.create` / `cancel`.
- `apps/api/src/services/job-events.service.ts` — terminal `result` persistence + the channel the tool awaits on.
- `packages/core/src/models/job.model.ts:397-403` — the add-a-job-type recipe.
