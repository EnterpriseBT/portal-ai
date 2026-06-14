# bulk_aggregate — reduce N records to a single value — Plan

**TDD-sequenced implementation of `docs/BULK_AGGREGATE.spec.md`. Four slices, each behind a green test suite, each one commit. Flows core → service → processor → tool, then smoke. The whole feature is backend-only (no frontend, no route, no migration).**

Spec: `docs/BULK_AGGREGATE.spec.md`. Discovery: `docs/BULK_AGGREGATE.discovery.md`. Issue: [#100](https://github.com/EnterpriseBT/portal-ai/issues/100).

Run tests with:

```bash
npm run test:unit --workspace=packages/core
npm run test:unit --workspace=apps/api
npm run test:integration --workspace=apps/api
npm run lint
npm run type-check
```

Each slice loop: write failing tests → confirm red → implement smallest change → confirm green → full unit suite (+ integration when touched) → lint + type-check → commit.

---

## Slice 0 — Job-model schemas + type wiring

**Why first.** Every other slice imports these schemas; the compile-time `JobTypeMap`/`JOB_TYPE_SCHEMAS` completeness check gates the build.

**Files**
- Edit: `packages/core/src/models/job.model.ts` — `bulk_aggregate` enum entry, `BulkAggregateMetadataSchema`, `BulkAggregateResultSchema`, `JobTypeMap` + `JOB_TYPE_SCHEMAS` entries.
- New: `packages/core/src/__tests__/models/job.bulk-aggregate.test.ts` — case 1.

**Steps**
1. Write the failing schema round-trip test (case 1): valid metadata/result parse; `JOB_TYPE_SCHEMAS.bulk_aggregate` is defined.
2. Confirm red.
3. Add the enum entry + both schemas following the `BulkTransform*` shape (minus targets/writes/batchSize); wire the type-map + registry.
4. Confirm green; `type-check` clean (proves the `JobTypeMap` completeness).
5. Lint + type-check. Commit.

**Done when:** the new job type compiles and its schemas round-trip.

---

## Slice 1 — `bulk-aggregate.service` (EXPLAIN + runAggregate)

**Why now.** The execution primitive the processor wraps. Reuses the `READ ONLY` + `statement_timeout` pattern from `portal-sql.service.ts` and the EXPLAIN posture from `bulk-transform.service.ts`.

**Files**
- New: `apps/api/src/services/bulk-aggregate.service.ts` — `explainExpression`, `runAggregate`.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `BULK_AGGREGATE_EXPRESSION_INVALID`, `BULK_AGGREGATE_TIMEOUT` (+ `BULK_AGGREGATE_RESULT_TOO_LARGE`, used in slice 2) + recommendations.
- New: `apps/api/src/__tests__/services/bulk-aggregate.service.test.ts` — cases 2–5.

**Steps**
1. Write failing tests: SQL assembly + EXPLAIN (2), invalid-expression error (3), COUNT-stripping into `recordsProcessed` (4), statement_timeout → `BULK_AGGREGATE_TIMEOUT` (5).
2. Confirm red.
3. Implement `explainExpression` (assemble `SELECT {expression} … LIMIT 1`, run `EXPLAIN`) and `runAggregate` (`READ ONLY` txn, `SET LOCAL statement_timeout = '120s'`, `SELECT {expression}, COUNT(*) AS __records_processed …`, strip the helper alias).
4. Confirm green. Full `apps/api` unit suite.
5. Lint + type-check. Commit.

**Done when:** `runAggregate` returns `{ result, recordsProcessed }` for a seeded source and errors correctly on bad SQL / timeout.

**Risk:** the `er__{source}` wide-table name + `c_`-column convention — confirm against the source entity's wide-table statement (same cache `bulk_transform` uses) before assembling SQL.

---

## Slice 2 — Processor + result-size cap + registration

**Why now.** Wraps the service as a job so the tool can enqueue it.

**Files**
- New: `apps/api/src/queues/processors/bulk-aggregate.processor.ts`.
- Edit: `apps/api/src/queues/processors/index.ts` — register `bulk_aggregate`.
- New: `apps/api/src/__tests__/queues/processors/bulk-aggregate.processor.test.ts` — cases 6–8.

**Steps**
1. Write failing tests: scalar `COUNT(*)` (6), multi-alias object result (7), over-cap → `BULK_AGGREGATE_RESULT_TOO_LARGE` (8).
2. Confirm red.
3. Implement: parse metadata, call `runAggregate`, enforce `JSON.stringify(result).length <= BULK_AGGREGATE_RESULT_LIMIT` (1 MB), return `{ result, recordsProcessed, durationMs }`. Register in the processors map.
4. Confirm green. Full `apps/api` unit suite.
5. Lint + type-check. Commit.

**Done when:** a `bulk_aggregate` job runs end-to-end in a test harness and persists the envelope via the existing worker → `JobEventsService.transition` path.

---

## Slice 3 — Tool (pre-flight + enqueue + await-terminal) + registration

**Why now.** Processor works; this is the agent's entry point and the await-inline delivery decision.

**Files**
- New: `apps/api/src/tools/bulk-aggregate-entity-records.tool.ts`.
- Edit: `apps/api/src/services/tools.service.ts` — `BUILTIN_TOOL_NAMES` + instantiate under `data_query` in `buildAnalyticsTools`.
- New: `apps/api/src/__tests__/tools/bulk-aggregate-entity-records.tool.test.ts` — cases 9–13.

**Steps**
1. Write failing tests: unknown source (9), invalid expression (10), happy-path enqueue→await→envelope (11), terminal failure rethrow (12), **no lock check** (13 — spy `assertConnectorEntityUnlocked`, assert not called).
2. Confirm red.
3. Implement the tool: 2-step pre-flight (source exists, EXPLAIN), `JobsService.create`, await terminal via the job-events channel (mock the channel in tests), return/throw on terminal status. Wire the abort signal → `JobsService.cancel`; the in-flight-query `pg_cancel_backend` wiring lands here (the processor records its backend pid; `statement_timeout` is the backstop if cancel can't reach it).
4. Register under `data_query`.
5. Confirm green; existing tools-service tests still green.
6. Lint + type-check. Commit.

**Done when:** the agent can dispatch `bulk_aggregate_records` and receive the computed value inline in the same turn.

**Risk:** awaiting a job from the producer side isn't an existing pattern. Lean: subscribe to the job-events Redis channel for the `jobId` and resolve on the terminal event, with a poll-the-job-row fallback bounded by `statement_timeout + buffer`. Decide the concrete await primitive at implementation.

---

## Slice 4 — Integration test + smoke section

**Why last.** Verifies the real worker + PG path and documents the manual walk.

**Files**
- New: `apps/api/src/__tests__/__integration__/bulk-aggregate-smoke.integration.test.ts` — case 14.
- Edit: `docs/LARGE_DATA_OPS.smoke.md` — new aggregate section.

**Steps**
1. Write the integration test: seed ~1,000-row source, dispatch the tool end-to-end, assert returned `result` matches a hand-computed `SUM`/`AVG`/`COUNT`, `recordsProcessed === 1000`, and the job row's persisted `result` matches.
2. Confirm red; iterate to green (most failures are wiring bugs from earlier slices).
3. Write the smoke section: NEO `COUNT(*)`; diameter `SUM`/`AVG` multi-alias; verify the envelope + `recordsProcessed` on the job row via `db:studio`.
4. Verify the spec's acceptance-criteria checkboxes.
5. Lint + type-check. Commit.

**Done when:** integration test green; manual smoke walk verified.

---

## Cross-slice gates

After every slice: `npm run test:unit` (core + api) green; `npm run test:integration --workspace=apps/api` green when touched (slices 1–2 partial, 4 full); `npm run lint && npm run type-check` clean; `git diff --stat` matches the slice's Files list.

After all slices: cases 1–14 pass; acceptance checkboxes ticked; a grep for `bulk_aggregate_records` hits the tool, the `tools.service.ts` registration, the smoke doc, the spec, the discovery; a grep for `bulk_aggregate` hits the enum, schemas, processor, and processors map.

## What this plan does *not* attempt

- `fold_tool` / `tool_map` aggregators — dropped (discovery Decision 1).
- Source locking — reads don't lock (Decision 2).
- Grouped N→M materialization — [#112](https://github.com/EnterpriseBT/portal-ai/issues/112).
- Frontend result widget; late-read of an over-long aggregate — deferred (spec § Out of scope).

## Next step

Implementation lands slice-by-slice on this `feat/bulk-aggregate` branch, flowing into draft PR [#111](https://github.com/EnterpriseBT/portal-ai/pull/111). The two decisions flagged for review before coding starts: **(a)** the await-inline result delivery + 120s `statement_timeout`, and **(b)** the in-flight-query cancel mechanism (`pg_cancel_backend` vs. relying on the timeout).
