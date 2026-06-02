# Large data operations — Phase 1: Shared infrastructure — Plan

**TDD-sequenced implementation of the contracts in `docs/LARGE_DATA_OPS_PHASE_1.spec.md`. Six slices, each behind a green test suite, each landing as one commit. Slices are ordered so the leaf contracts (constants, ApiError extension) land first and the consuming pieces (JobType, lock primitive) compose on top. No slice is user-visible.**

Spec: `docs/LARGE_DATA_OPS_PHASE_1.spec.md`. Discovery: `docs/LARGE_DATA_OPS.discovery.md`. Issue: [#85](https://github.com/EnterpriseBT/portal-ai/issues/85).

Run tests with:

```bash
# package gates
npm run test:unit --workspace=packages/core
npm run test:unit --workspace=apps/api
npm run test:integration --workspace=apps/api

# repo gates
npm run lint
npm run type-check
```

Each slice loop:

1. Write all failing tests for the slice's new behavior.
2. Confirm red — run the focused tests, observe the expected failure.
3. Implement the smallest change that makes them pass.
4. Confirm green — re-run the focused tests.
5. Run the full unit suite (and integration suite when touched).
6. Lint + type-check at slice boundary.
7. Commit.

---

## Slice 0 — Constants

**Why first.** Every later slice references `MAX_BULK_RECORDS`, `DEFAULT_BULK_BATCH`, `BATCH_ROW_PAYLOAD_LIMIT`, etc. Pure leaf — no consumers yet; lands behind a trivial test that asserts the values are non-zero and exported.

**Files**

- New: `packages/core/src/constants/large-data-ops.constants.ts` — exports the eight constants.
- New: `packages/core/src/__tests__/constants/large-data-ops.constants.test.ts` — case 1.
- Edit: `packages/core/src/index.ts` (if it re-exports from `constants/`) — add the new constants module.

**Steps**

1. **Write the failing test** — import each constant; assert it's a positive integer with the value documented in the spec (sanity-check against drift).

   ```ts
   it("exports the eight resource-limit constants with documented values", async () => {
     const C = await import("../../constants/large-data-ops.constants.js");
     expect(C.MAX_BULK_RECORDS).toBe(1_000_000);
     expect(C.DEFAULT_BULK_BATCH).toBe(1_000);
     expect(C.MAX_CONCURRENT_BULK_PER_ORG).toBe(2);
     expect(C.BATCH_ROW_PAYLOAD_LIMIT).toBe(256 * 1024);
     expect(C.READ_HANDLE_TTL_MS).toBe(24 * 60 * 60 * 1000);
     expect(C.SAMPLING_THRESHOLD).toBe(50_000);
     expect(C.STATEMENT_TIMEOUT_MS).toBe(30_000);
     expect(C.INLINE_ROWS_THRESHOLD).toBe(100);
   });
   ```

2. **Confirm red.** Import fails — file doesn't exist.

3. **Implement** the constants file with `export const` declarations + a one-line comment per constant pointing at where it's consumed.

4. **Confirm green.**

5. **Run the full `@portalai/core` unit suite.** Unchanged.

6. **Lint + type-check.** Clean.

**Done when:** the constants module exists, is re-exported from the package's barrel (if applicable), and has a single anchor test guarding the values.

**Risk:** none.

---

## Slice 1 — `ApiErrorSchema.recommendation` + `ApiError` constructor evolution

**Why now.** The error envelope is referenced by the new `ApiCode` entries (slice 5), the `BulkTransformResult` schema (slice 2), and `assertConnectorEntityUnlocked` (slice 4). Land it next.

**Files**

- Edit: `packages/core/src/contracts/api.contract.ts` — add `recommendation: z.string().optional()` to `ApiErrorSchema`.
- Edit: `apps/api/src/services/http.service.ts` — `ApiError` constructor accepts `{ recommendation?, details? }` as the fourth argument with overload preserving the existing `details`-only signature; `HttpService.error` writes `recommendation` to the response body when set.
- Edit (or new): `packages/core/src/__tests__/contracts/api.contract.test.ts` — cases 1–3.
- Edit (or new): `apps/api/src/__tests__/services/http.service.test.ts` — cases 20–23.

**Steps**

1. **Write the failing tests** for `ApiErrorSchema` (cases 1–3) and `ApiError` constructor (cases 20–23). Tests target the new fields and the back-compat overload.

2. **Confirm red.** Schema tests fail because the field doesn't exist; constructor tests fail because the option shape isn't accepted.

3. **Implement** — add the optional field to the Zod schema; widen the `ApiError` constructor signature using an overload to accept either `Record<string, unknown>` (legacy `details`) or `{ recommendation?: string; details?: Record<string, unknown> }`. Runtime branch distinguishes by presence of `recommendation`.

4. **Confirm green.**

5. **Run the full `@portalai/core` + `apps/api` unit suites.** Unchanged — existing call sites still compile (overload) and existing serializers don't reject the new field (Zod `.optional()`).

6. **Lint + type-check.** Clean.

**Done when:** `ApiErrorSchema` carries an optional `recommendation`; `ApiError` is constructible with the new options-shape; no existing call site needs an update.

**Risk:** the constructor overload is fiddly. If TypeScript can't infer the second overload's argument shape, fall back to a discriminator function `isApiErrorOptions(x): x is { recommendation?, details? }` and a single signature accepting `Record<string, unknown> | { … }`. Document the chosen shape in the source comment.

---

## Slice 2 — `BulkTransform` JobType + schemas

**Why now.** Slices 0 (constants) and 1 (ApiErrorSchema for `partialFailures` nesting) are in place. This slice adds the JobType + per-type schemas to `job.model.ts`. The `JobTypeMap` exhaustiveness check gates the addition at compile time.

**Files**

- Edit: `packages/core/src/models/job.model.ts` — add `"bulk_transform"` to `JobTypeEnum`; export `BulkTransformExpressionSchema`, `BulkTransformMetadataSchema`, `BulkTransformResultSchema` + inferred types; add the entry to `JobTypeMap`.
- Edit: `packages/core/src/__tests__/models/job.model.test.ts` (or new sibling) — cases 4–11.

**Steps**

1. **Write the failing tests** (cases 4–11) — each parses a fixture against the new schemas or asserts the JobTypeMap entry exists.

2. **Confirm red.** Tests fail to compile (schemas don't exist) and the JobTypeMap exhaustiveness check fails at the type level.

3. **Implement** — follow the 3-step pattern documented in `job.model.ts:240–287`:
   - Add `"bulk_transform"` to `JobTypeEnum`.
   - Declare `BulkTransformExpressionSchema` as a `z.discriminatedUnion("kind", [...])` covering both `sql` and `tool` shapes.
   - Declare `BulkTransformMetadataSchema` referencing the expression schema; default `batchSize` to `DEFAULT_BULK_BATCH` (imported from `../constants/large-data-ops.constants.js`); cap at 10_000.
   - Declare `BulkTransformResultSchema`; nest `ApiErrorSchema` under `partialFailures[*].error`.
   - Add a `bulk_transform` entry to `JobTypeMap` wiring both schemas.
   - JSDoc on `BulkTransformMetadataSchema`: "Locks `targetConnectorEntityId`."

4. **Confirm green.**

5. **Run the full `@portalai/core` unit suite.** Unchanged.

6. **Lint + type-check.** Clean — `JobTypeMap` is exhaustive again.

**Done when:** `BulkTransform` schemas round-trip; both expression kinds parse; mixed-shape expressions reject; `JobTypeMap` includes the entry.

**Risk:** the discriminated-union refinement might trip up on missing keys (e.g. a `kind: "sql"` payload that has the wrong key set). The 8 test cases cover the obvious shapes; add more if the schema author surfaces an edge case during implementation.

---

## Slice 3 — `JobBatchEvent` + `QueryHandleEnvelope` contracts

**Why now.** Pure leaf wire-shape additions; no producer yet. Both Phase 2 (writes-SQL) and Phase 3 (reads) reference these. Landing them in parallel-ready form unblocks both downstream phases.

**Files**

- New: `packages/core/src/contracts/job-events.contract.ts` — `JobBatchEventSchema`.
- New: `packages/core/src/contracts/portal-sql.contract.ts` — `QueryHandleEnvelopeSchema`.
- New: `packages/core/src/__tests__/contracts/job-events.contract.test.ts` — cases 12–15.
- New: `packages/core/src/__tests__/contracts/portal-sql.contract.test.ts` — cases 16–19.

**Steps**

1. **Write the failing tests** (cases 12–15 + 16–19).

2. **Confirm red.** Imports fail.

3. **Implement** both contract files. `JobBatchEventSchema` is a flat `z.object` with optional `rows` / `rowIds`; no superRefine needed since "exactly one set" is enforced by the producer (Phase 2), not the wire shape. `QueryHandleEnvelopeSchema` carries a `.superRefine` that requires `sampleSize` when `sampled: true`.

4. **Confirm green.**

5. **Run the `@portalai/core` unit suite.** Unchanged.

6. **Lint + type-check.** Clean.

**Done when:** both schemas parse the documented shapes and reject malformed payloads.

**Risk:** none — pure wire shapes.

---

## Slice 4 — `assertConnectorEntityUnlocked` + `JobsRepository.findOneByEntityLock`

**Why now.** Slices 2 (BulkTransform metadata) and 5 (`BULK_JOB_TARGET_LOCKED` ApiCode) are dependencies. Slice 5 lands first (it's a leaf), but for ordering simplicity we ship it before this slice. The lock primitive is the first piece of API code that consumes Phase 1's wire contracts.

**Order note:** swap slice 4 and slice 5 if slice 5 lands cleanly first; the only dependency is that `BULK_JOB_TARGET_LOCKED` must exist before the lock primitive's tests can assert on the thrown code. Slice 5 is small enough that it's reasonable to land first.

**Files**

- Edit: `apps/api/src/db/repositories/jobs.repository.ts` — add `findOneByEntityLock(entityId)`.
- Edit: `apps/api/src/services/job-lock.service.ts` — add `assertConnectorEntityUnlocked(connectorEntityId)`.
- Edit: `apps/api/src/__tests__/services/job-lock.service.test.ts` — cases 24–27.
- New: `apps/api/src/__tests__/__integration__/db/jobs-repository-entity-lock.integration.test.ts` — cases 28–31.

**Steps**

1. **Write the failing unit tests** (cases 24–27) — mock the repository's new method and assert the lock primitive's behavior on hit/miss/terminal/cross-entity inputs.

2. **Write the failing integration tests** (cases 28–31) — exercise the real query against a seeded `jobs` table.

3. **Confirm red.** Both suites fail — method doesn't exist on the repository; lock primitive doesn't exist on the service.

4. **Implement the repository method.** SQL: scan jobs where `type = 'bulk_transform'` AND `status` not in terminal AND `metadata->>'targetConnectorEntityId' = $1`. Return the first match or null. Generalize the signature to accept the entity id; the per-type metadata-key map (`type → metadata-field-name`) can live alongside as a constant so future job types extend it cleanly.

5. **Implement the lock primitive.** Call the repository method; if a job comes back, throw `ApiError(409, ApiCode.BULK_JOB_TARGET_LOCKED, "Target entity is locked by another bulk job.", { recommendation: <from default map>, details: { lockingJobId, lockingJobType, startedAt } })`.

6. **Confirm green.**

7. **Run the full `apps/api` unit suite + the new integration test.** Unchanged.

8. **Lint + type-check.** Clean.

**Done when:** the lock primitive is callable and correctly rejects when a non-terminal `bulk_transform` job locks the entity; terminal jobs are ignored; cross-entity isolation works.

**Risk:** the JSON-path query (`metadata->>'targetConnectorEntityId'`) is not currently indexed. Acceptable for v1 since non-terminal job count is small; flag in spec § Risks for follow-up if telemetry shows query latency growing.

---

## Slice 5 — `ApiCode` entries + default `recommendation` map

**Why now (alternate ordering — see slice 4 note).** Leaf addition. The 11 new enum entries + their default-recommendation strings are referenced by slices 4 (lock primitive throws `BULK_JOB_TARGET_LOCKED`) and by Phases 2/3/4 broadly.

**Files**

- Edit: `apps/api/src/constants/api-codes.constants.ts` — add the 11 entries to the `ApiCode` enum; export `ApiCodeDefaultRecommendation` as a `Record<ApiCode, string | undefined>`.
- New (if absent): `apps/api/src/__tests__/constants/api-codes.constants.test.ts` — guard tests.

**Steps**

1. **Write failing tests** — assert each new enum value exists; assert `ApiCodeDefaultRecommendation` has a string entry for each new code.

2. **Confirm red.** Enum entries don't exist; default-recommendation map is missing.

3. **Implement** — extend the enum; export the map. Each recommendation is a short actionable sentence per the spec § Concept changes.

4. **Confirm green.**

5. **Run the full `apps/api` unit suite.** Unchanged.

6. **Lint + type-check.** Clean.

**Done when:** all 11 new codes are exported; the default-recommendation map has an entry for each; both ship as a unit so consumers can default cheaply.

**Risk:** none.

---

## Cross-slice gates

After every slice:

1. `npm run test:unit --workspace=packages/core` is green.
2. `npm run test:unit --workspace=apps/api` is green.
3. `npm run test:integration --workspace=apps/api` is green when the slice touches integration surface (slice 4).
4. `npm run lint` reports no new errors. Pre-existing `drift.test.ts:617` lint error in `@portalai/spreadsheet-parsing` is orthogonal — ignore.
5. `npm run type-check` from repo root is clean.

After all slices land (Phase 1 end):

- All new test cases (1–31) pass.
- All 9 acceptance-criteria checkboxes from the spec are ticked.
- A grep for `bulk_transform` in `apps/api/src/queues/processors/` returns **zero matches** — no processor yet (Phase 2).
- A grep for `bulk_transform_entity_records` in `apps/api/src/tools/` returns **zero matches** — no tool yet (Phase 2).
- A grep for `recommendation` in `apps/api/src/services/http.service.ts` shows the constructor and response-body wiring.

---

## What this phase does *not* attempt

- **Any processor, route, tool, or display block.** Phase 1 is wire contracts only. Phases 2/3/4 ship the producers and consumers.
- **Migrating existing `ApiError(…)` call sites to populate `recommendation`.** Opportunistic per the discovery's open question 10; not blocking.
- **Index on `jobs.metadata->>'targetConnectorEntityId'`.** Add when telemetry warrants.
- **Generalized lock-target metadata-key map for future job types.** Phase 1 wires only `bulk_transform`'s key. Future job types add their entry alongside; not retrofitted.
- **`bulkDispatch` metadata on `ToolpackTool`.** Phase 4.
- **Vega-Lite spec rewrite.** Phase 3.
- **Frontend changes of any kind.** Phases 2/3 bring web work.

---

## Next phase

`docs/LARGE_DATA_OPS_PHASE_2.spec.md` and `.plan.md` — the writes-SQL track end-to-end. Phase 2 wires:

- `bulk_transform` JobType processor (uses Phase 1's lock primitive + schemas).
- `bulk_transform_entity_records` tool.
- `bulk-job-progress` display block.
- Chat-thread input lock.
- The `job:batch` SSE producer (uses Phase 1's `JobBatchEventSchema`).
- Smoke A (100k parcels, compute acreage).

Phases 2 and 3 can be developed in parallel since they share only Phase 1's contracts. Phase 4 (writes-tool-dispatch) builds on Phase 2.
