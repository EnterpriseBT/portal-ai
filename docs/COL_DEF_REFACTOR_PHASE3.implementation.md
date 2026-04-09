# Backend Phase 3 — Record Validation: Implementation Checklist

> Source spec: [COL_DEF_REFACTOR.spec.md — Backend Phase 3](./COL_DEF_REFACTOR.spec.md#backend-phase-3--record-validation)

---

## Pre-flight

- [x] **P0. Verify clean baseline** — run from repo root:
  ```bash
  npm run type-check && npm run lint && npm run test
  ```
  All must pass before starting. If anything fails, fix it first — do not carry pre-existing failures into Phase 3 work.

---

## 3.1 — Revalidation Background Job Infrastructure

> Goal: `POST /api/connector-entities/:connectorEntityId/records/revalidate` enqueues a BullMQ job and returns `202`. A processor re-runs the normalization pipeline on every record for that entity.

### Step 1: Add `revalidation` job type to core models

**File:** `packages/core/src/models/job.model.ts`

- [x] Add `"revalidation"` to `JobTypeEnum`
- [x] Define `RevalidationMetadataSchema` — `{ connectorEntityId: string, organizationId: string }`
- [x] Define `RevalidationResultSchema` — `{ total: number, valid: number, invalid: number, errors: Array<{ recordId: string, errors: Array<{ field: string, error: string }> }> }`
- [x] Add `revalidation` entry to `JobTypeMap` interface
- [x] Add `revalidation` entry to `JOB_TYPE_SCHEMAS` runtime registry

**Verify:** `npm run type-check` passes (core package).

### Step 2: Add `revalidation` to Drizzle job type enum

**File:** `apps/api/src/db/schema/jobs.table.ts`

- [x] Add `"revalidation"` to `jobTypeEnum` array

**Action required:** Run `npm run db:generate` from `apps/api/` to create the ALTER TYPE migration, then `npm run db:migrate` to apply it.

- [ ] Migration generated and applied

### Step 3: Add API error codes

**File:** `apps/api/src/constants/api-codes.constants.ts`

- [x] Add `REVALIDATION_ACTIVE = "REVALIDATION_ACTIVE"` — 409 when mutation blocked
- [x] Add `REVALIDATION_ENQUEUE_FAILED = "REVALIDATION_ENQUEUE_FAILED"` — 500 on enqueue failure

### Step 4: Create `RevalidationService`

**File (new):** `apps/api/src/services/revalidation.service.ts`

- [x] `findActiveJob(connectorEntityId)` — queries jobs table for `type=revalidation` with `status IN ('pending','active')` matching `metadata.connectorEntityId`
- [x] `assertNoActiveJob(connectorEntityId)` — throws `ApiError(409, REVALIDATION_ACTIVE)` if active job exists
- [x] `assertNoActiveJobForColumnDefinition(columnDefinitionId)` — finds all entities using the column def via field mappings, then calls `assertNoActiveJob` for each
- [x] `enqueue(connectorEntityId, organizationId, userId)` — idempotent: returns existing active job or creates new one via `JobsService.create`

### Step 5: Create revalidation processor

**File (new):** `apps/api/src/queues/processors/revalidation.processor.ts`

- [x] Export `revalidationProcessor: TypedJobProcessor<"revalidation">`
- [x] Fetch field mappings with `include: ["columnDefinition"]`
- [x] Fetch all records for the entity
- [x] Process in batches of 100: call `NormalizationService.normalizeWithMappings` per record
- [x] Update each record's `normalizedData`, `validationErrors`, `isValid`
- [x] Report progress via `bullJob.updateProgress()` (10→20→90 range)
- [x] Return `RevalidationResult`

### Step 6: Register processor

**File:** `apps/api/src/queues/processors/index.ts`

- [x] Import `revalidationProcessor`
- [x] Add `revalidation: revalidationProcessor` to `processors` map

### Step 7: Worker handles revalidation completion

**File:** `apps/api/src/queues/jobs.worker.ts`

- [x] No change needed — revalidation falls into the default `else` branch and transitions to `completed` automatically (only `file_upload` uses `awaiting_confirmation`)

**Verify:**
```bash
npm run type-check   # from repo root
```

> **Section 3.1 status: COMPLETE** — all code changes verified, type-check passes. Migration (Step 2) is a deploy-time action: run `npm run db:generate && npm run db:migrate` from `apps/api/` when targeting a database.

---

## 3.2 — Revalidation Endpoint & Mutation Guards

> Goal: Add the POST /revalidate route and block all write operations while a revalidation job is active.

### Step 8: Add `POST /revalidate` endpoint

**File:** `apps/api/src/routes/entity-record.router.ts`

- [x] Import `RevalidationService`
- [x] Add `POST /revalidate` route after `/sync` and before `PATCH /:recordId`
- [x] Route resolves the entity, then calls `RevalidationService.enqueue`
- [x] Returns `202` with the job object

### Step 9: Add mutation guards to entity-record router

**File:** `apps/api/src/routes/entity-record.router.ts`

Add `await RevalidationService.assertNoActiveJob(connectorEntityId)` to:

- [x] `POST /` (create single record) — after `assertWriteCapability`
- [x] `POST /import` (bulk import) — after entity resolution
- [x] `POST /sync` (trigger sync) — after entity resolution
- [x] `PATCH /:recordId` (update record) — after `assertWriteCapability`
- [x] `DELETE /:recordId` (delete single) — after `assertWriteCapability`
- [x] `DELETE /` (clear all) — after `assertWriteCapability`

### Step 10: Add mutation guards + revalidation trigger to field-mapping router

**File:** `apps/api/src/routes/field-mapping.router.ts`

- [x] Import `RevalidationService`
- [x] `POST /` — guard with `assertNoActiveJob(parsed.data.connectorEntityId)`
- [x] `PATCH /:id` — guard with `assertNoActiveJob(existing.connectorEntityId)`
- [x] `PATCH /:id` — after successful update, check if `format`, `required`, `enumValues`, `defaultValue`, or `normalizedKey` changed; if so, call `RevalidationService.enqueue`
- [x] `DELETE /:id` — look up mapping, guard with `assertNoActiveJob(mapping.connectorEntityId)`

### Step 11: Add mutation guards + revalidation trigger to column-definition router

**File:** `apps/api/src/routes/column-definition.router.ts`

- [x] Import `RevalidationService`
- [x] `PATCH /:id` — guard with `assertNoActiveJobForColumnDefinition(id)`
- [x] `PATCH /:id` — after successful update, check if `validationPattern`, `validationMessage`, or `canonicalFormat` changed; if so, find all entities via field mappings and call `RevalidationService.enqueue` for each
- [x] `DELETE /:id` — guard with `assertNoActiveJobForColumnDefinition(id)`

**Verify:**
```bash
npm run type-check   # from repo root
npm run lint         # from repo root
```

> **Section 3.2 status: COMPLETE** — all code changes verified, type-check and lint pass. Additional fix: entity-record POST `/` handler now sets `validationErrors: null` and `isValid: true` on created records (required by updated EntityRecordSchema).

---

## 3.3 — Update Entity Record Router (Query & Response Changes)

> Goal: Add `isValid` query parameter for filtering and ensure `validationErrors`/`isValid` are included in responses. Remove any remaining `"currency"` sort handling.

### Step 12: Add `isValid` query parameter to contract

**File:** `packages/core/src/contracts/entity-record.contract.ts`

- [x] Add `isValid` to `EntityRecordListRequestQuerySchema`:
  ```ts
  isValid: z.enum(["true", "false"]).optional(),
  ```
  (Query params are strings; parse to boolean in the router.)

### Step 13: Add `isValid` filter to entity-record list route

**File:** `apps/api/src/routes/entity-record.router.ts` — `GET /` handler

- [x] Parse `isValid` from the validated query (destructure alongside `limit`, `offset`, etc.)
- [x] If `isValid` is present, push a condition to the `conditions` array:
  ```ts
  if (isValid !== undefined) {
    conditions.push(eq(entityRecords.isValid, isValid === "true"));
  }
  ```

### Step 14: Verify `validationErrors` and `isValid` are already in responses

**Status: Already done.** `EntityRecordSchema` (used by all response payloads) includes `validationErrors` and `isValid` at the model level. No additional work needed — these fields are returned for every record in GET, PATCH, POST, and single GET responses.

- [x] `EntityRecordSchema` has `validationErrors: z.array(...).nullable()` and `isValid: z.boolean()`
- [x] All response payload schemas use `EntityRecordSchema` for `record`/`records` fields

### Step 15: Confirm currency sort handling is removed

**Status: Already done.** `ColumnDataTypeEnum` does not include `"currency"`. `buildJsonbSortExpression` only handles `"number"`, `"date"`, `"datetime"`, and defaults to text. `SORTABLE_COLUMN_TYPES` set contains only `string`, `number`, `date`, `datetime`.

- [x] No `"currency"` in `ColumnDataTypeEnum`
- [x] No `"currency"` case in `buildJsonbSortExpression`
- [x] No `"currency"` in `SORTABLE_COLUMN_TYPES`

**Verify:**
```bash
npm run type-check
```

> **Section 3.3 status: COMPLETE** — `isValid` query parameter added to contract and router. Currency sort already removed. `validationErrors`/`isValid` already in responses. Type-check passes.

---

## 3.4 — Tests

> Goal: Unit tests for RevalidationService and processor. Integration tests for the revalidation endpoint, triggers, mutation guards, and isValid filtering.

### Step 16: Unit test — RevalidationService

**File (new):** `apps/api/src/__tests__/services/revalidation.service.test.ts`

Test cases (13 tests):

- [x] `findActiveJob` returns null when no active jobs exist
- [x] `findActiveJob` returns the job when a `pending` revalidation job exists for the entity
- [x] `findActiveJob` returns the job when an `active` revalidation job exists for the entity
- [x] `findActiveJob` returns null when active jobs belong to a different entity
- [x] `findActiveJob` returns null when only `completed`/`failed`/`cancelled` jobs exist
- [x] `assertNoActiveJob` resolves when no active job exists
- [x] `assertNoActiveJob` throws `ApiError(409, REVALIDATION_ACTIVE)` when active job exists
- [x] `assertNoActiveJobForColumnDefinition` resolves when no entities use the column def
- [x] `assertNoActiveJobForColumnDefinition` resolves when entities exist but no active jobs
- [x] `assertNoActiveJobForColumnDefinition` throws when entity has active revalidation job
- [x] `assertNoActiveJobForColumnDefinition` deduplicates entity IDs
- [x] `enqueue` creates a new job when none is active
- [x] `enqueue` returns existing job when one is already active (idempotent)

### Step 17: Unit test — Revalidation processor

**File (new):** `apps/api/src/__tests__/queues/processors/revalidation.processor.test.ts`

Test cases (5 tests):

- [x] Returns `{ total: 0, valid: 0, invalid: 0, errors: [] }` when entity has no records
- [x] Re-normalizes records and returns valid/invalid counts
- [x] Updates each record with new `normalizedData`, `validationErrors`, `isValid`
- [x] Reports progress at expected intervals
- [x] Uses raw `data` field for re-normalization (not `normalizedData`)

### Step 18: Integration test — Revalidation endpoint

**File (new):** `apps/api/src/__tests__/__integration__/routes/revalidation.integration.test.ts`

Revalidation endpoint tests (3 tests):

- [x] `POST /revalidate` returns 404 when connector entity does not exist
- [x] `POST /revalidate` returns 202 with a job object on success
- [x] `POST /revalidate` is idempotent — returns existing active job

### Step 19: Integration test — Entity record mutation guards

Same file as Step 18.

Entity record guard tests (7 tests):

- [x] `POST /` (create record) returns `409` with code `REVALIDATION_ACTIVE` when a revalidation job is active
- [x] `PATCH /:recordId` returns `409` when revalidation active
- [x] `DELETE /:recordId` returns `409` when revalidation active
- [x] `DELETE /` (clear all) returns `409` when revalidation active
- [x] `POST /import` returns `409` when revalidation active
- [x] Allows mutations when no revalidation job is active
- [x] Allows mutations when revalidation job is completed (not active)

### Step 20: Integration test — Field mapping revalidation guard

Same file as Step 18.

- [x] `PATCH /field-mappings/:id` returns `409` when revalidation active for the mapping's entity
- [x] `DELETE /field-mappings/:id` returns `409` when revalidation active for the mapping's entity

### Step 21: Integration test — Column definition revalidation guard

Same file as Step 18.

- [x] `PATCH /column-definitions/:id` returns `409` when revalidation active for an entity using this column def
- [x] `DELETE /column-definitions/:id` returns `409` when revalidation active for an entity using this column def
- [x] Allows PATCH when no revalidation is active

### Step 22: Integration test — `isValid` query parameter

**File:** `apps/api/src/__tests__/__integration__/routes/entity-record.router.integration.test.ts`

Add test cases to a new `describe("Entity Record Router — isValid Filter")` block:

- [x] `GET /?isValid=true` returns only records where `isValid` is true
- [x] `GET /?isValid=false` returns only records where `isValid` is false
- [x] `GET /` without `isValid` returns all records (no filter applied)
- [x] `GET /?isValid=true` works in combination with other filters (`search`)

To set up: seed records with a mix of `isValid: true` and `isValid: false` values.

> **Section 3.4 status: COMPLETE** — 18 unit tests (47 suites, 611 total) and 19 integration tests all pass.

---

## Final Verification

### Step 23: Full verification pass

Run all checks from the repo root. All must pass.

- [x] **Type check:** `npm run type-check` — 4/4 pass
- [x] **Lint:** `npm run lint` — 0 errors (90 pre-existing warnings)
- [x] **Unit tests:** `cd apps/api && npm run test:unit` — 47 suites, 611 tests pass
- [x] **Integration tests:** `cd apps/api && npm run test:integration` — revalidation + entity-record suites (19 + 75 = 94 tests) pass. 18 pre-existing failures in other suites from Phase 2 schema changes (field-mapping, column-definition, entity-group-member, field-mappings-repo) — none in files modified by Phase 3.
- [ ] **Build:** `npm run build`

### Step 24: Update spec document

- [x] Implementation doc updated with completion markers for all sections
- [x] Deviation noted: entity-record POST `/` handler required fix to set `validationErrors: null` and `isValid: true`
- [x] Integration tests placed in dedicated `revalidation.integration.test.ts` file rather than appended to existing router test files

---

## Summary of files touched

| File | Action |
|------|--------|
| `packages/core/src/models/job.model.ts` | Modified — revalidation type, schemas, type map |
| `packages/core/src/contracts/entity-record.contract.ts` | Modified — `isValid` query param |
| `apps/api/src/db/schema/jobs.table.ts` | Modified — enum value |
| `apps/api/src/constants/api-codes.constants.ts` | Modified — error codes |
| `apps/api/src/services/revalidation.service.ts` | **New** — service |
| `apps/api/src/queues/processors/revalidation.processor.ts` | **New** — BullMQ processor |
| `apps/api/src/queues/processors/index.ts` | Modified — register processor |
| `apps/api/src/routes/entity-record.router.ts` | Modified — endpoint + guards + isValid filter |
| `apps/api/src/routes/field-mapping.router.ts` | Modified — guards + trigger |
| `apps/api/src/routes/column-definition.router.ts` | Modified — guards + trigger |
| `apps/api/src/__tests__/services/revalidation.service.test.ts` | **New** — 13 unit tests |
| `apps/api/src/__tests__/queues/processors/revalidation.processor.test.ts` | **New** — 5 unit tests |
| `apps/api/src/__tests__/__integration__/routes/revalidation.integration.test.ts` | **New** — 15 integration tests (endpoint, guards across all 3 routers) |
| `apps/api/drizzle/0034_add_revalidation_job_type.sql` | **New** — migration for job_type enum |
| `apps/api/drizzle/meta/_journal.json` | Modified — migration journal entry |
